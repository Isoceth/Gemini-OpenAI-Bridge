/* ------------------------------------------------------------------ */
/*  mapper.ts – OpenAI ⇆ Gemini (with reasoning/1 M context)           */
/* ------------------------------------------------------------------ */
import { fetchAndEncode } from './remoteimage';
import { z } from 'zod';
import { ToolRegistry } from '@google/gemini-cli-core/dist/src/tools/tool-registry.js';
import { getModel } from './chatwrapper';

/* ------------------------------------------------------------------ */
type Part = { text?: string; inlineData?: { mimeType: string; data: string } };

/* ------------------------------------------------------------------ */
async function callLocalFunction(_name: string, _args: unknown) {
  return { ok: true };
}

/* ================================================================== */
/* Request mapper: OpenAI ➞ Gemini                                     */
/* ================================================================== */

// Convert a single message's content to Gemini parts
async function contentToParts(content: any): Promise<Part[]> {
  const parts: Part[] = [];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === 'image_url') {
        parts.push({ inlineData: await fetchAndEncode(item.image_url.url) });
      } else if (item.type === 'text') {
        parts.push({ text: item.text });
      }
    }
  } else if (typeof content === 'string') {
    parts.push({ text: content });
  }
  return parts;
}

export async function mapRequest(body: any) {
  // Separate system messages from conversation messages
  let systemInstruction: string | undefined;
  const contents: Array<{ role: string; parts: Part[] }> = [];

  for (const m of body.messages) {
    if (m.role === 'system') {
      // Combine system messages into a single instruction
      const text = typeof m.content === 'string' ? m.content : m.content?.text ?? '';
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
  const tools = new ToolRegistry({} as any);

  if (body.functions?.length) {
    const reg = tools as any;
    body.functions.forEach((fn: any) =>
      reg.registerTool(
        fn.name,
        {
          title: fn.name,
          description: fn.description ?? '',
          inputSchema: z.object(fn.parameters?.properties ?? {}),
        },
        async (args: unknown) => callLocalFunction(fn.name, args),
      ),
    );
  }

  return { geminiReq, tools };
}

/* ================================================================== */
/* Non-stream response: Gemini ➞ OpenAI                                */
/* ================================================================== */
export function mapResponse(gResp: any) {
  const usage = gResp.usageMetadata ?? {};
  const hasError = typeof gResp.candidates === 'undefined';

  console.log('Received response:', gResp);

  if (hasError) {
    console.error('No candidates returned.');

    return {
      error: {
        message: gResp?.promptFeedback?.blockReason ?? 'No candidates returned.',
      }
    }
  }
  
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: getModel(),
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: gResp.text },
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

export function mapStreamChunk(chunk: any) {
  const part = chunk?.candidates?.[0]?.content?.parts?.[0] ?? {};
  const delta: any = { role: 'assistant' };

  if (part.thought === true) {
    delta.content = `<think>${part.text ?? ''}`;  // ST renders grey bubble
  } else if (typeof part.text === 'string') {
    delta.content = part.text;
  }
  return { choices: [ { delta, index: 0 } ] };
}


