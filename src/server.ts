import http from 'http';
import { sendChat, sendChatStream, listModels } from './chatwrapper';
import { mapRequest, mapResponse, createStreamMapper } from './mapper';
import { validateChatRequest, createError } from './validation';
import type { OpenAIChatRequest, OpenAIErrorResponse } from './types';

/* ── basic config ─────────────────────────────────────────────────── */
const PORT = Number(process.env.PORT ?? 11434);

/**
 * CORS configuration via environment variables:
 * - CORS_ORIGIN: Allowed origin(s). Defaults to '*'. Use comma-separated list for multiple.
 * - CORS_HEADERS: Allowed headers. Defaults to '*'.
 * - CORS_METHODS: Allowed methods. Defaults to 'GET,POST,OPTIONS'.
 */
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
const CORS_HEADERS = process.env.CORS_HEADERS ?? '*';
const CORS_METHODS = process.env.CORS_METHODS ?? 'GET,POST,OPTIONS';

/* ── CORS helper ──────────────────────────────────────────────────── */
function allowCors(res: http.ServerResponse, reqOrigin?: string) {
  // If CORS_ORIGIN contains commas, check if the request origin is in the list
  if (CORS_ORIGIN.includes(',') && reqOrigin) {
    const allowedOrigins = CORS_ORIGIN.split(',').map((o) => o.trim());
    if (allowedOrigins.includes(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    }
    // If origin not in list, don't set the header (browser will block)
  } else {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  }
  res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
  res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
}

/* ── JSON body helper ─────────────────────────────────────────────── */
function readJSON(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });
  });
}

/* ── Error response helper ────────────────────────────────────────── */
function sendError(
  res: http.ServerResponse,
  statusCode: number,
  error: OpenAIErrorResponse,
) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(error));
}

/* ── server ───────────────────────────────────────────────────────── */
http
  .createServer(async (req, res) => {
    // Extract origin header for CORS validation
    const reqOrigin = req.headers.origin as string | undefined;
    allowCors(res, reqOrigin);

    console.log('➜', req.method, req.url);

    /* -------- pre-flight ---------- */
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    /* -------- /health ---------- */
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    /* -------- /v1/models ---------- */
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: listModels() }));
      return;
    }

    /* ---- /v1/chat/completions ---- */
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      // Parse JSON body
      let rawBody: unknown;
      try {
        rawBody = await readJSON(req);
      } catch {
        console.log('HTTP 400: malformed JSON');
        sendError(res, 400, createError(
          'Invalid JSON in request body',
          'invalid_request_error',
          'invalid_json',
        ));
        return;
      }

      // Validate request structure
      const validation = validateChatRequest(rawBody);
      if (!validation.valid) {
        console.log('HTTP 400: validation failed');
        sendError(res, 400, validation.error);
        return;
      }

      // Cast to full request type after validation
      const body = rawBody as OpenAIChatRequest;

      try {
        const { geminiReq, tools } = await mapRequest(body);

        if (body.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });

          console.log('➜ sending HTTP 200 streamed response');

          // Use stateful mapper to track think tag state across chunks
          const mapChunk = createStreamMapper();

          for await (const chunk of sendChatStream({ ...geminiReq, tools })) {
            const mapped = mapChunk(chunk);
            res.write(`data: ${JSON.stringify(mapped)}\n\n`);
          }
          res.end('data: [DONE]\n\n');

          console.log('➜ done sending streamed response');
        } else {
          const gResp = await sendChat({ ...geminiReq, tools });
          const mapped = mapResponse(gResp);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mapped));

          console.log('✅ Replied HTTP 200 response', mapped);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('HTTP 500 Proxy error ➜', err);
        sendError(res, 500, createError(message, 'api_error'));
      }

      return;
    }

    /* ---- anything else ---------- */
    console.log('➜ unknown request, returning HTTP 404');
    sendError(res, 404, createError(
      `Unknown endpoint: ${req.method} ${req.url}`,
      'invalid_request_error',
      'unknown_url',
    ));
  })
  .listen(PORT, () => console.log(`OpenAI proxy listening on http://localhost:${PORT}`));
