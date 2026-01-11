/* ------------------------------------------------------------------ */
/*  types.ts – Shared type definitions for OpenAI and Gemini mapping  */
/* ------------------------------------------------------------------ */

/* ================================================================== */
/* OpenAI API Types                                                    */
/* ================================================================== */

/**
 * OpenAI message content item - either text or an image URL.
 */
export interface OpenAIContentItem {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

/**
 * OpenAI message - can have string content or structured content array.
 */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAIContentItem[];
}

/**
 * OpenAI function definition for tool calls.
 */
export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters?: {
    properties?: Record<string, unknown>;
  };
}

/**
 * OpenAI chat completion request body.
 */
export interface OpenAIChatRequest {
  messages: OpenAIMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  include_reasoning?: boolean;
  generationConfig?: Record<string, unknown>;
  functions?: OpenAIFunction[];
}

/**
 * OpenAI chat completion response choice.
 */
export interface OpenAIChoice {
  index: number;
  message: { role: string; content: string };
  finish_reason: string;
}

/**
 * OpenAI token usage statistics.
 */
export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * OpenAI chat completion response.
 */
export interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

/**
 * OpenAI error response.
 */
export interface OpenAIErrorResponse {
  error: {
    message: string;
    type?: string;
    code?: string;
  };
}

/**
 * OpenAI stream chunk delta.
 */
export interface OpenAIStreamDelta {
  role?: string;
  content?: string;
}

/**
 * OpenAI stream chunk response.
 */
export interface OpenAIStreamChunk {
  choices: Array<{
    delta: OpenAIStreamDelta;
    index: number;
  }>;
}

/* ================================================================== */
/* Gemini API Types                                                    */
/* ================================================================== */

/**
 * Gemini content part - text or inline data (images).
 */
export interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType: string; data: string };
}

/**
 * Gemini content with role and parts.
 */
export interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

/**
 * Gemini generation configuration.
 */
export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  enable_thoughts?: boolean;
  thinking?: boolean;
  thinking_budget?: number;
  maxInputTokens?: number;
  [key: string]: unknown;
}

/**
 * Gemini API request structure.
 */
export interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig: GeminiGenerationConfig;
  stream?: boolean;
  systemInstruction?: string;
}

/**
 * Gemini token usage metadata.
 */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  promptTokens?: number;
  candidatesTokenCount?: number;
  candidatesTokens?: number;
  totalTokenCount?: number;
  totalTokens?: number;
}

/**
 * Gemini response candidate.
 */
export interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
}

/**
 * Gemini API response structure.
 */
export interface GeminiResponse {
  text?: string;
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  promptFeedback?: {
    blockReason?: string;
  };
}

/**
 * Gemini stream chunk structure.
 */
export interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

/* ================================================================== */
/* Internal Types                                                      */
/* ================================================================== */

/**
 * Result of mapping an OpenAI request to Gemini format.
 */
export interface MappedRequest {
  geminiReq: GeminiRequest;
  tools: unknown;
}
