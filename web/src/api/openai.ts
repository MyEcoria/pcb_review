/**
 * OpenAI API Client
 */

import type { ModelOption } from '../types';

export const OPENAI_MODELS: ModelOption[] = [
  // GPT-5 (newest flagship)
  { id: 'gpt-5', name: 'GPT-5 (Most Capable)', contextWindow: 128000 },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', contextWindow: 128000 },
  // Reasoning models (o-series)
  { id: 'o3-pro', name: 'o3-pro (Extended Reasoning)', contextWindow: 200000 },
  { id: 'o3', name: 'o3 (Advanced Reasoning)', contextWindow: 200000 },
  { id: 'o4-mini', name: 'o4-mini (Fast Reasoning)', contextWindow: 200000 },
  { id: 'o3-mini', name: 'o3-mini (Efficient Reasoning)', contextWindow: 200000 },
  { id: 'o1', name: 'o1 (Reasoning)', contextWindow: 200000 },
  // GPT-4.1 models (April 2025)
  { id: 'gpt-4.1', name: 'GPT-4.1 (Recommended)', contextWindow: 1000000 },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', contextWindow: 1000000 },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano (Fast/Cheap)', contextWindow: 1000000 },
  // GPT-4o models (legacy but available)
  { id: 'gpt-4o', name: 'GPT-4o (Legacy)', contextWindow: 128000 },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Legacy)', contextWindow: 128000 },
];

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIError {
  error: {
    message: string;
    type: string;
    code: string | null;
  };
}

// Reasoning models don't support streaming
const NON_STREAMING_MODELS = ['o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o3-pro', 'o4-mini'];

function supportsStreaming(model: string): boolean {
  return !NON_STREAMING_MODELS.some(m => model.startsWith(m));
}

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = baseUrl?.trim();
  if (!raw) {
    return 'https://api.openai.com/v1';
  }

  const withoutTrailing = raw.replace(/\/+$/, '');
  return withoutTrailing.endsWith('/v1') ? withoutTrailing : `${withoutTrailing}/v1`;
}

function buildEndpoint(baseUrl: string, path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
}

/**
 * Call the OpenAI API with messages
 */
export async function callOpenAI(
  apiKey: string,
  model: string,
  messages: OpenAIMessage[],
  onStream?: (chunk: string) => void,
  signal?: AbortSignal,
  baseUrl?: string
): Promise<string> {
  const canStream = supportsStreaming(model) && !!onStream;
  const effectiveBaseUrl = normalizeBaseUrl(baseUrl);

  const response = await fetch(buildEndpoint(effectiveBaseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: canStream,
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json() as OpenAIError;
    throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
  }

  if (canStream && response.body) {
    return await streamOpenAIResponse(response.body, onStream!, signal);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '';

  // For non-streaming models, emit the full content at once if callback provided
  if (onStream && content) {
    onStream(content);
  }

  return content;
}

async function streamOpenAIResponse(
  body: ReadableStream<Uint8Array>,
  onStream: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        throw new DOMException('Aborted', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              fullContent += content;
              onStream(content);
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw err;
  }

  return fullContent;
}

/**
 * Validate an OpenAI API key by making a simple request
 */
export async function validateOpenAIKey(apiKey: string, baseUrl?: string): Promise<boolean> {
  try {
    const effectiveBaseUrl = normalizeBaseUrl(baseUrl);
    const response = await fetch(buildEndpoint(effectiveBaseUrl, '/models'), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
