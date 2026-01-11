/* ------------------------------------------------------------------ */
/*  remoteimage.ts – Fetch and encode remote images with safety limits */
/* ------------------------------------------------------------------ */
import { fetch } from 'undici';

/* ── Configuration ─────────────────────────────────────────────────── */

// Maximum time to wait for image fetch (milliseconds)
// Gemini can generate large images (up to ~24 MB) which may take time to transfer
const FETCH_TIMEOUT_MS = Number(process.env.IMAGE_FETCH_TIMEOUT_MS ?? 120_000);

// Maximum image size in bytes (default 50 MB)
// Gemini supports up to 4K output; uncompressed RGBA at 3840×2160 is ~32 MB
const MAX_IMAGE_SIZE_BYTES = Number(process.env.MAX_IMAGE_SIZE_BYTES ?? 50 * 1024 * 1024);

// Allowed content types for images
const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

/* ── Exported function ─────────────────────────────────────────────── */

/**
 * Fetches a remote image and encodes it as base64 with safety limits.
 *
 * @param url - The URL of the image to fetch
 * @returns Object with mimeType and base64-encoded data
 * @throws Error if fetch fails, times out, or image exceeds size limit
 */
export async function fetchAndEncode(url: string) {
  // Create an AbortController for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // Don't follow too many redirects
      redirect: 'follow',
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch image: ${url} (HTTP ${res.status})`);
    }

    // Check content-length header if available
    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(
        `Image too large: ${url} (${contentLength} bytes exceeds ${MAX_IMAGE_SIZE_BYTES} byte limit)`,
      );
    }

    // Validate content type
    const contentType = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
    if (contentType && !ALLOWED_CONTENT_TYPES.some((t) => contentType.startsWith(t))) {
      console.warn(`Unexpected content type for image: ${contentType}`);
    }

    // Read response body with size limit enforcement
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    // Handle body as async iterable if available, otherwise use arrayBuffer
    if (res.body) {
      for await (const chunk of res.body) {
        totalSize += chunk.length;
        if (totalSize > MAX_IMAGE_SIZE_BYTES) {
          // Abort the request immediately when size limit is exceeded
          controller.abort();
          throw new Error(
            `Image too large: ${url} (exceeds ${MAX_IMAGE_SIZE_BYTES} byte limit during download)`,
          );
        }
        chunks.push(chunk);
      }
    } else {
      // Fallback for environments where body isn't iterable
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_SIZE_BYTES) {
        throw new Error(
          `Image too large: ${url} (${buf.length} bytes exceeds ${MAX_IMAGE_SIZE_BYTES} byte limit)`,
        );
      }
      return {
        mimeType: contentType || 'image/png',
        data: buf.toString('base64'),
      };
    }

    const buf = Buffer.concat(chunks);
    const mimeType = contentType || 'image/png';

    return { mimeType, data: buf.toString('base64') };
  } catch (err) {
    // Re-throw with more context if it's an abort error
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Image fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
