/* ------------------------------------------------------------------ */
/*  validation.ts – Request validation and OpenAI-style error helpers  */
/* ------------------------------------------------------------------ */
import type { OpenAIMessage, OpenAIErrorResponse } from './types';

/**
 * Validation result - either success with the validated value or failure with error.
 */
export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: OpenAIErrorResponse };

/**
 * Creates an OpenAI-style error response.
 */
export function createError(
  message: string,
  type: string = 'invalid_request_error',
  code: string | null = null,
): OpenAIErrorResponse {
  return {
    error: {
      message,
      type,
      code: code ?? undefined,
    },
  };
}

/**
 * Validates that the messages array exists and is properly structured.
 */
function validateMessages(
  messages: unknown,
): ValidationResult<OpenAIMessage[]> {
  if (!Array.isArray(messages)) {
    return {
      valid: false,
      error: createError(
        'messages is required and must be an array',
        'invalid_request_error',
        'missing_required_parameter',
      ),
    };
  }

  if (messages.length === 0) {
    return {
      valid: false,
      error: createError(
        'messages must contain at least one message',
        'invalid_request_error',
        'invalid_value',
      ),
    };
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Validate role
    if (typeof msg.role !== 'string') {
      return {
        valid: false,
        error: createError(
          `messages[${i}].role is required and must be a string`,
          'invalid_request_error',
          'invalid_type',
        ),
      };
    }

    const validRoles = ['system', 'user', 'assistant'];
    if (!validRoles.includes(msg.role)) {
      return {
        valid: false,
        error: createError(
          `messages[${i}].role must be one of: ${validRoles.join(', ')}`,
          'invalid_request_error',
          'invalid_value',
        ),
      };
    }

    // Validate content - can be string or array of content items
    if (msg.content === undefined || msg.content === null) {
      return {
        valid: false,
        error: createError(
          `messages[${i}].content is required`,
          'invalid_request_error',
          'missing_required_parameter',
        ),
      };
    }

    if (typeof msg.content !== 'string' && !Array.isArray(msg.content)) {
      return {
        valid: false,
        error: createError(
          `messages[${i}].content must be a string or array`,
          'invalid_request_error',
          'invalid_type',
        ),
      };
    }

    // Validate content items if array
    if (Array.isArray(msg.content)) {
      for (let j = 0; j < msg.content.length; j++) {
        const item = msg.content[j];
        if (typeof item.type !== 'string') {
          return {
            valid: false,
            error: createError(
              `messages[${i}].content[${j}].type is required`,
              'invalid_request_error',
              'missing_required_parameter',
            ),
          };
        }

        if (item.type === 'text' && typeof item.text !== 'string') {
          return {
            valid: false,
            error: createError(
              `messages[${i}].content[${j}].text must be a string for type "text"`,
              'invalid_request_error',
              'invalid_type',
            ),
          };
        }

        if (item.type === 'image_url') {
          if (!item.image_url || typeof item.image_url.url !== 'string') {
            return {
              valid: false,
              error: createError(
                `messages[${i}].content[${j}].image_url.url is required for type "image_url"`,
                'invalid_request_error',
                'missing_required_parameter',
              ),
            };
          }

          // Validate URL format (basic check)
          try {
            new URL(item.image_url.url);
          } catch {
            return {
              valid: false,
              error: createError(
                `messages[${i}].content[${j}].image_url.url is not a valid URL`,
                'invalid_request_error',
                'invalid_value',
              ),
            };
          }
        }
      }
    }
  }

  return { valid: true, value: messages as OpenAIMessage[] };
}

/**
 * Validates an incoming chat completion request body.
 * Returns the validated body or an error response.
 */
export function validateChatRequest(
  body: unknown,
): ValidationResult<{ messages: OpenAIMessage[] }> {
  if (typeof body !== 'object' || body === null) {
    return {
      valid: false,
      error: createError(
        'Request body must be a JSON object',
        'invalid_request_error',
      ),
    };
  }

  const obj = body as Record<string, unknown>;

  // Validate messages (required)
  const messagesResult = validateMessages(obj.messages);
  if (!messagesResult.valid) {
    return messagesResult;
  }

  return {
    valid: true,
    value: { messages: messagesResult.value },
  };
}
