# PCB Review Web App

This web app supports multiple LLM backends for running PCB analysis prompts.

## LLM Provider Setup

Open **Settings** in the app and configure one of the providers below.

### Ollama Cloud

1. Set **LLM Provider** to **Ollama Cloud**.
2. Enter your Ollama Cloud API key in **API Key**.
3. Enter a model id in **Model** (for example `llama3.1:8b`).
4. Click **Validate** and then **Save**.

### Custom OpenAI-compatible provider

Use this for providers exposing OpenAI Chat Completions-compatible endpoints.

1. Set **LLM Provider** to **Custom OpenAI-compatible**.
2. Set **Base URL** to your provider endpoint root, for example:
   - `https://api.together.xyz/v1`
   - `https://openrouter.ai/api/v1`
   - `https://your-internal-gateway.example/v1`
3. Enter your provider API key in **API Key**.
4. Enter your model id in **Model**.
5. Click **Validate** and then **Save**.

> Note: if your Base URL is entered without `/v1`, the app appends `/v1` automatically.

## Docker

Build the production image from the repository root:

```bash
docker build -t pcb-review-web ./web
```

Run the container on port 8080:

```bash
docker run --rm -p 8080:80 pcb-review-web
```

The container serves the Vite build through nginx and includes:

- `EXPOSE 80`
- `GET /healthz` endpoint returning `200 ok`
- SPA fallback routing to `index.html`

## API configuration strategy in containers

This app currently stores provider URL, model, and API key through the UI settings in browser local storage, so no environment variables are required at runtime.

If you later want environment-driven values:

- **Build-time injection** (Vite): define `VITE_*` values at `docker build` time via `--build-arg`, then map them into the build stage environment before `npm run build`.
- **Runtime injection**: ship a startup script that renders a small `config.js` from container environment variables and load it in `index.html` before the app bootstraps.

For secrets, prefer runtime injection over build-time to avoid baking credentials into immutable image layers.
