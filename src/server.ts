import http from 'http';
import { sendChat, sendChatStream, listModels } from './chatwrapper';
import { mapRequest, mapResponse, mapStreamChunk } from './mapper';
import { validateChatRequest, createError } from './validation';
import type { OpenAIChatRequest, OpenAIErrorResponse } from './types';

/* ── basic config ─────────────────────────────────────────────────── */
const PORT = Number(process.env.PORT ?? 11434);

/* ── CORS helper ──────────────────────────────────────────────────── */
function allowCors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
    allowCors(res);

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
      res.end(
        JSON.stringify({
          data: listModels(),
        }),
      );
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

          for await (const chunk of sendChatStream({ ...geminiReq, tools })) {
            res.write(`data: ${JSON.stringify(mapStreamChunk(chunk))}\n\n`);
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
