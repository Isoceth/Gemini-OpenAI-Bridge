/* ------------------------------------------------------------------ */
/*  mapper.ts – OpenAI ⇆ Gemini (with reasoning/1 M context)           */
/* ------------------------------------------------------------------ */
import { fetchAndEncode } from './remoteimage';
import { z } from 'zod';
import { ToolRegistry } from '@google/gemini-cli-core/dist/src/tools/tool-registry.js';
import { getModel } from './chatwrapper';
import type {
  OpenAIChatRequest,
  OpenAIContentItem,
  OpenAIFunction,
  OpenAIChatResponse,
  OpenAIErrorResponse,
  OpenAIStreamChunk,
  GeminiPart,
  GeminiContent,
  GeminiRequest,
  GeminiResponse,
  GeminiStreamChunk,
  MappedRequest,
} from './types';

/* ------------------------------------------------------------------ */

/**
 * Tool names that map to Gemini's built-in Google Search grounding.
 * When these are requested, we enable grounding on the generation config
 * instead of registering them as function call tools.
 */
const GOOGLE_SEARCH_TOOL_NAMES = new Set([
  'web_search',
  'google_search',
  'google_web_search',
  'search',
  'internet_search',
]);

/**
 * Checks if any of the requested functions are Google Search tools.
 * Returns the names of built-in tools found (to filter from custom registration).
 */
function findBuiltInTools(functions: OpenAIFunction[] | undefined): Set<string> {
  const builtIn = new Set<string>();
  if (!functions) return builtIn;

  for (const fn of functions) {
    if (GOOGLE_SEARCH_TOOL_NAMES.has(fn.name.toLowerCase())) {
      builtIn.add(fn.name);
    }
  }
  return builtIn;
}

/* ================================================================== */
/* Request mapper: OpenAI ➞ Gemini                                     */
/* ================================================================== */

// Convert a single message's content to Gemini parts
async function contentToParts(
  content: string | OpenAIContentItem[],
): Promise<GeminiPart[]> {
  const parts: GeminiPart[] = [];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === 'image_url' && item.image_url) {
        parts.push({ inlineData: await fetchAndEncode(item.image_url.url) });
      } else if (item.type === 'text' && item.text) {
        parts.push({ text: item.text });
      }
    }
  } else if (typeof content === 'string') {
    parts.push({ text: content });
  }
  return parts;
}

export async function mapRequest(body: OpenAIChatRequest): Promise<MappedRequest> {
  // Separate system messages from conversation messages
  let systemInstruction: string | undefined;
  const contents: GeminiContent[] = [];

  for (const m of body.messages) {
    if (m.role === 'system') {
      // Combine system messages into a single instruction.
      // System content is typically a string; extract text if structured.
      const text = typeof m.content === 'string'
        ? m.content
        : (Array.isArray(m.content)
          ? m.content.find((c) => c.type === 'text')?.text
          : '') ?? '';
      systemInstruction = systemInstruction ? `${systemInstruction}\n\n${text}` : text;
    } else {
      // Map OpenAI roles to Gemini roles (user stays user, assistant becomes model)
      const geminiRole = m.role === 'assistant' ? 'model' : 'user';
      const parts = await contentToParts(m.content);
      contents.push({ role: geminiRole, parts });
    }
  }

  /* ---- base generationConfig ------------------------------------- */
  const generationConfig: Record<string, unknown> = {
    temperature: body.temperature,
    maxOutputTokens: body.max_tokens,
    topP: body.top_p,
    ...(body.generationConfig ?? {}), // copy anything ST already merged
  };

  /* ---- reasoning configuration ----------------------------------- */
  // Gemini supports two flags for reasoning/thinking:
  // - `thinking`: Primary flag for enabling thinking mode (Gemini 2.x)
  // - `enable_thoughts`: Alternative flag (may be used in older versions)
  // We set both for maximum compatibility, with a shared budget.
  if (body.include_reasoning === true) {
    generationConfig.thinking = true;
    generationConfig.enable_thoughts = true;
    generationConfig.thinking_budget ??= 2048;
  }

  /* ---- context limit --------------------------------------------- */
  generationConfig.maxInputTokens ??= 1_000_000; // lift to 1M token context

  /* ---- Tool / function mapping ----------------------------------- */
  // Check for built-in tools that should be mapped to Gemini grounding
  const builtInTools = findBuiltInTools(body.functions);
  const hasGoogleSearch = builtInTools.size > 0;

  // Build the Gemini tools array
  // If Google Search is requested, add the googleSearch grounding tool
  const geminiTools: unknown[] = [];
  if (hasGoogleSearch) {
    geminiTools.push({ googleSearch: {} });
    console.log('Enabled Google Search grounding for tools:', Array.from(builtInTools));
  }

  const geminiReq: GeminiRequest = {
    model: body.model,
    contents,
    generationConfig,
    stream: body.stream,
    systemInstruction,
    tools: geminiTools.length > 0 ? geminiTools : undefined,
  };

  console.log('Gemini request:', geminiReq);

  // ToolRegistry for any custom (non-built-in) function definitions
  // Cast required: gemini-cli types are unstable between versions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = new ToolRegistry({} as any);

  if (body.functions?.length) {
    // Filter out built-in tools - they're handled via Gemini grounding
    const customFunctions = body.functions.filter(fn => !builtInTools.has(fn.name));

    if (customFunctions.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reg = tools as any;
      customFunctions.forEach((fn: OpenAIFunction) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schema = z.object((fn.parameters?.properties ?? {}) as any);
        reg.registerTool(
          fn.name,
          {
            title: fn.name,
            description: fn.description ?? '',
            inputSchema: schema,
          },
          // Stub handler - custom function execution not supported
          async () => ({ error: 'Custom function execution not supported by proxy' }),
        );
      });
    }
  }

  return { geminiReq, tools };
}

/* ================================================================== */
/* Non-stream response: Gemini ➞ OpenAI                                */
/* ================================================================== */
export function mapResponse(
  gResp: GeminiResponse,
): OpenAIChatResponse | OpenAIErrorResponse {
  const usage = gResp.usageMetadata ?? {};
  const hasError = typeof gResp.candidates === 'undefined';

  console.log('Received response:', gResp);

  if (hasError) {
    console.error('No candidates returned.');

    return {
      error: {
        message: gResp?.promptFeedback?.blockReason ?? 'No candidates returned.',
      },
    };
  }

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: gResp.modelVersion ?? getModel(),
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: gResp.text ?? '' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      // Gemini uses *TokenCount naming convention
      prompt_tokens: usage.promptTokenCount ?? usage.promptTokens ?? 0,
      completion_tokens: usage.candidatesTokenCount ?? usage.candidatesTokens ?? 0,
      total_tokens: usage.totalTokenCount ?? usage.totalTokens ?? 0,
    },
  };
}

/* ================================================================== */
/* Stream chunk mapper: Gemini ➞ OpenAI                                */
/* ================================================================== */

/**
 * Creates a stateful stream chunk mapper that tracks thinking state
 * to properly open/close think tags across chunks.
 */
export function createStreamMapper() {
  let wasThinking = false;

  return function mapChunk(chunk: GeminiStreamChunk): OpenAIStreamChunk {
    const candidate = chunk?.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const usage = chunk?.usageMetadata;

    // Combine all text parts from this chunk
    let content = '';
    let isThinking = false;

    for (const part of parts) {
      if (part.thought === true) {
        isThinking = true;
        // Opening think tag if we weren't thinking before
        if (!wasThinking) {
          content += '<think>';
        }
        content += part.text ?? '';
      } else if (typeof part.text === 'string') {
        // Close think tag if we were thinking but this part isn't
        if (wasThinking && !isThinking) {
          content += '</think>';
        }
        content += part.text;
      }
    }

    // Update state for next chunk
    wasThinking = isThinking;

    const result: OpenAIStreamChunk = {
      choices: [{
        delta: {
          role: 'assistant',
          content: content || undefined,
        },
        index: 0,
        finish_reason: null,
      }],
    };

    // Include usage metadata if present (typically on final chunk)
    if (usage) {
      result.usage = {
        prompt_tokens: usage.promptTokenCount ?? usage.promptTokens ?? 0,
        completion_tokens: usage.candidatesTokenCount ?? usage.candidatesTokens ?? 0,
        total_tokens: usage.totalTokenCount ?? usage.totalTokens ?? 0,
      };
    }

    return result;
  };
}

/**
 * Creates a final chunk to close any open think tags.
 */
export function createFinalStreamChunk(wasThinking: boolean): OpenAIStreamChunk | null {
  if (!wasThinking) return null;

  return {
    choices: [{
      delta: { content: '</think>' },
      index: 0,
      finish_reason: 'stop',
    }],
  };
}

// Legacy single-chunk mapper for backwards compatibility
export function mapStreamChunk(chunk: GeminiStreamChunk): OpenAIStreamChunk {
  const part = chunk?.candidates?.[0]?.content?.parts?.[0] ?? {};
  const delta: { role: string; content?: string } = { role: 'assistant' };

  if (part.thought === true) {
    // SillyTavern renders grey bubble for think tags
    delta.content = `<think>${part.text ?? ''}`;
  } else if (typeof part.text === 'string') {
    delta.content = part.text;
  }
  return { choices: [{ delta, index: 0 }] };
}


