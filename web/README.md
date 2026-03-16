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
