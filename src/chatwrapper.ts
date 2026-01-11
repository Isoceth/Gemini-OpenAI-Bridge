// src/chatwrapper.ts
import {
  AuthType,
  createContentGeneratorConfig,
  createContentGenerator,
} from '@google/gemini-cli-core/dist/src/core/contentGenerator.js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

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
let modelName: string;
const generatorPromise = (async () => {
  // Pass undefined for model so the helper falls back to DEFAULT_GEMINI_MODEL
  const cfg = await createContentGeneratorConfig(
    model, // let default model be used
    authTypeEnum
  );
  modelName = cfg.model;           // remember the actual model string
  console.log(`Gemini CLI returned model: ${modelName}`);

  return await createContentGenerator(cfg);
})();

/* ------------------------------------------------------------------ */
/* 2.  Helpers consumed by server.ts                                   */
/* ------------------------------------------------------------------ */
type GenConfig = Record<string, unknown>;

export async function sendChat({
  contents,
  generationConfig = {},
}: {
  contents: any[];
  generationConfig?: GenConfig;
  tools?: unknown;                // accepted but ignored for now
}) {
  const generator: any = await generatorPromise;
  return await generator.generateContent({
    model: modelName,
    contents,
    config: generationConfig,
  });
}

export async function* sendChatStream({
  contents,
  generationConfig = {},
}: {
  contents: any[];
  generationConfig?: GenConfig;
  tools?: unknown;
}) {
  const generator: any = await generatorPromise;
  const stream = await generator.generateContentStream({
    model: modelName,
    contents,
    config: generationConfig,
  });
  for await (const chunk of stream) yield chunk;
}

/* ------------------------------------------------------------------ */
/* 3.  Minimal stubs so server.ts compiles (extend later)              */
/* ------------------------------------------------------------------ */
export function listModels() {
  return [{ 
    id: modelName,
    object: 'model',
    owned_by: 'google'
  }];
}

export function getModel() {
  return modelName;
}
