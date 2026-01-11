# Gemini OpenAI Bridge

An OpenAI-compatible API bridge for the [Gemini CLI](https://github.com/google-gemini/gemini-cli), serving **Google Gemini 2.5 Pro** (or Flash) through a local API endpoint.

Works with any client that speaks OpenAI: SillyTavern, llama.cpp, LangChain, VS Code Cline, etc.

---

## Features

| Feature | Notes |
|---------|-------|
| `/v1/chat/completions` | Non-streaming and streaming (SSE) |
| `/v1/models` | List available models |
| Vision support | `image_url` → Gemini `inlineData` |
| Function/tool calling | OpenAI `functions` → Gemini Tool Registry |
| Reasoning/chain-of-thought | `enable_thoughts:true`, streams `<think>` chunks |
| 1M token context | Auto-lifts Gemini CLI's default 200k cap |
| CORS | Enabled (`*`) by default |

---

## Quick Start

### With npm

```bash
git clone https://github.com/Isoceth/Gemini-OpenAI-Bridge
cd Gemini-OpenAI-Bridge
npm install
npm start  # Runs on port 11434 by default
```

### With Docker

```bash
docker build --tag gemini-openai-bridge .
docker run -p 11434:80 -e GEMINI_API_KEY gemini-openai-bridge
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `11434` | Server port |
| `AUTH_TYPE` | Auto-detected | `oauth-personal`, `gemini-api-key`, or `vertex-ai` |
| `GEMINI_API_KEY` | — | Required when `AUTH_TYPE=gemini-api-key` |
| `MODEL` | CLI default | `gemini-2.5-flash` or `gemini-2.5-pro` |

### Authentication

The bridge reads authentication settings from `~/.gemini/settings.json` by default (same as the Gemini CLI). You can override this by setting `AUTH_TYPE` explicitly.

- **oauth-personal**: Free access via Google account login
- **gemini-api-key**: Use a Gemini API key
- **vertex-ai**: Google Cloud Vertex AI

---

## Usage

### Minimal curl test

```bash
curl -X POST http://localhost:11434/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "model": "gemini-2.5-pro",
       "messages": [{"role": "user", "content": "Hello Gemini!"}]
     }'
```

### SillyTavern

- API type: Chat Completion
- API Base URL: `http://127.0.0.1:11434/v1`

---

## License

MIT — Based on [gemini-openai-proxy](https://github.com/Brioch/gemini-openai-proxy) by Brioch.
