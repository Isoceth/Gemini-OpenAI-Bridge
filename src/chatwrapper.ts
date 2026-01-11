// src/chatwrapper.ts
import {
  AuthType,
  createContentGeneratorConfig,
  createContentGenerator,
} from '@google/gemini-cli-core/dist/src/core/contentGenerator.js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { GeminiContent, GeminiResponse, GeminiStreamChunk } from './types';

// Read auth type from gemini CLI settings if not explicitly set via env var.
// Settings file structure: { security: { auth: { selectedType: "oauth-personal" } } }
function getAuthType(): AuthType {
  if (process.env.AUTH_TYPE) {
    return process.env.AUTH_TYPE as AuthType;
  }

  const settingsPath = join(homedir(), '.gemini', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const selectedType = settings?.security?.auth?.selectedType;
      if (selectedType) {
        return selectedType as AuthType;
      }
    } catch {
      // Fall through to default if settings file is malformed
    }
  }

  return 'gemini-api-key' as AuthType;
}

const authTypeEnum = getAuthType();

console.log(`Auth type: ${authTypeEnum}`);

const model = process.env.MODEL ?? undefined;

if (model) {
  console.log(`Model override: ${model}`);
}

/* ------------------------------------------------------------------ */
/* 1.  Build the ContentGenerator exactly like the CLI does           */
/* ------------------------------------------------------------------ */

/**
 * ContentGenerator interface - minimal typing for gemini-cli internals.
 * Cast required because gemini-cli types are unstable between versions.
 */
interface ContentGenerator {
  generateContent(params: {
    model: string;
    contents: GeminiContent[];
    config: Record<string, unknown>;
    systemInstruction?: string;
  }): Promise<GeminiResponse>;
  generateContentStream(params: {
    model: string;
    contents: GeminiContent[];
    config: Record<string, unknown>;
    systemInstruction?: string;
  }): AsyncIterable<GeminiStreamChunk>;
}

let modelName: string;
const generatorPromise: Promise<ContentGenerator> = (async () => {
  // Cast to function types - gemini-cli types are unstable between versions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createConfig = createContentGeneratorConfig as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createGenerator = createContentGenerator as any;

  const cfg = await createConfig(model, authTypeEnum);
  modelName = cfg.model ?? model ?? 'gemini-2.5-pro';
  console.log(`Gemini CLI returned model: ${modelName}`);

  // gcConfig stub - provides minimal interface expected by createContentGenerator v0.23+
  const gcConfig = {
    fakeResponses: undefined,
    recordResponses: undefined,
    getModel: () => modelName,
    getPreviewFeatures: () => [],
    getUsageStatisticsEnabled: () => false,
    getProxy: () => undefined,
    getContentGeneratorConfig: () => cfg,
  };

  return await createGenerator(cfg, gcConfig) as ContentGenerator;
})();

/* ------------------------------------------------------------------ */
/* 2.  Helpers consumed by server.ts                                   */
/* ------------------------------------------------------------------ */

/**
 * Request parameters for chat methods.
 */
interface ChatRequest {
  contents: GeminiContent[];
  generationConfig?: Record<string, unknown>;
  systemInstruction?: string;
  tools?: unknown;
}

export async function sendChat(request: ChatRequest): Promise<GeminiResponse> {
  const { contents, generationConfig = {}, systemInstruction } = request;
  const generator = await generatorPromise;
  return await generator.generateContent({
    model: modelName,
    contents,
    config: generationConfig,
    systemInstruction,
  });
}

export async function* sendChatStream(
  request: ChatRequest,
): AsyncGenerator<GeminiStreamChunk> {
  const { contents, generationConfig = {}, systemInstruction } = request;
  const generator = await generatorPromise;
  const stream = await generator.generateContentStream({
    model: modelName,
    contents,
    config: generationConfig,
    systemInstruction,
  });
  for await (const chunk of stream) yield chunk;
}

/* ------------------------------------------------------------------ */
/* 3.  Model listing and info                                          */
/* ------------------------------------------------------------------ */

// Known Gemini models available via the CLI
const KNOWN_MODELS = [
  { id: 'gemini-2.5-pro', description: 'Most capable model, best for complex tasks' },
  { id: 'gemini-2.5-flash', description: 'Fast and efficient, good balance of speed and capability' },
  { id: 'gemini-2.0-flash', description: 'Previous generation flash model' },
  { id: 'gemini-1.5-pro', description: 'Previous generation pro model' },
  { id: 'gemini-1.5-flash', description: 'Previous generation flash model' },
];

export function listModels() {
  return KNOWN_MODELS.map(m => ({
    id: m.id,
    object: 'model',
    created: 0,
    owned_by: 'google',
    description: m.description,
    active: m.id === modelName,
  }));
}

export function getModel() {
  return modelName;
}
