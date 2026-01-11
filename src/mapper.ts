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
  GeminiResponse,
  GeminiStreamChunk,
  MappedRequest,
} from './types';

/* ------------------------------------------------------------------ */

/**
 * Stub for local function calls in tool use.
 * TODO(debt): Implement proper function calling or remove if not needed.
 * See bean Gemini-OpenAI-Bridge-z9so.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function callLocalFunction(name: string, args: unknown) {
  return { ok: true };
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
  if (body.include_reasoning === true) {
    generationConfig.enable_thoughts = true;        // ← current flag
    generationConfig.thinking_budget ??= 2048;      // optional limit
  }

  /* ---- auto-enable reasoning & 1 M context ----------------------- */
  if (body.include_reasoning === true && generationConfig.thinking !== true) {
    generationConfig.thinking = true;
    generationConfig.thinking_budget ??= 2048;
  }
  generationConfig.maxInputTokens ??= 1_000_000; // lift context cap

  const geminiReq = {
    contents,
    generationConfig,
    stream: body.stream,
    systemInstruction,
  };

  console.log('Gemini request:', geminiReq);

  /* ---- Tool / function mapping ----------------------------------- */
  // ToolRegistry constructor expects a context object; empty object is acceptable.
  // Cast required: gemini-cli types are unstable between versions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = new ToolRegistry({} as any);

  if (body.functions?.length) {
    // registerTool method isn't exposed in public types; cast required.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reg = tools as any;
    body.functions.forEach((fn: OpenAIFunction) => {
      // OpenAI function parameters aren't Zod schemas, so we pass them through.
      // The tool registry accepts any object with inputSchema.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const schema = z.object((fn.parameters?.properties ?? {}) as any);
      reg.registerTool(
        fn.name,
        {
          title: fn.name,
          description: fn.description ?? '',
          inputSchema: schema,
        },
        async (args: unknown) => callLocalFunction(fn.name, args),
      );
    });
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
    model: getModel(),
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


