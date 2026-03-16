/**
 * Unified LLM Interface
 * Provides a common interface for calling different LLM providers
 */

import type { Provider, ModelOption } from '../types';
import { callOpenAI, validateOpenAIKey, OPENAI_MODELS, type OpenAIMessage } from './openai';
import { callAnthropic, validateAnthropicKey, ANTHROPIC_MODELS, type AnthropicMessage } from './anthropic';
import { callGemini, validateGeminiKey, GEMINI_MODELS, type GeminiMessage } from './gemini';

export interface LLMConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  organization?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Get available models for a provider
 */
export function getModelsForProvider(provider: Provider): ModelOption[] {
  switch (provider) {
    case 'openai':
      return OPENAI_MODELS;
    case 'anthropic':
      return ANTHROPIC_MODELS;
    case 'gemini':
      return GEMINI_MODELS;
    case 'ollama_cloud':
    case 'openai_compatible':
      // Dynamic provider catalogs can vary by deployment.
      // Return empty to allow free-form model entry in settings UI.
      return [];
    default:
      return [];
  }
}

/**
 * Get the default model for a provider
 */
export function getDefaultModel(provider: Provider): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
    case 'gemini':
      return 'gemini-2.0-flash';
    case 'ollama_cloud':
      return 'llama3.1:8b';
    case 'openai_compatible':
      return '';
    default:
      return '';
  }
}

/**
 * Validate an API key for a provider
 */
export async function validateApiKey(provider: Provider, apiKey: string, baseUrl?: string): Promise<boolean> {
  if (!apiKey || apiKey.trim().length === 0) {
    return false;
  }

  switch (provider) {
    case 'openai':
      return validateOpenAIKey(apiKey);
    case 'anthropic':
      return validateAnthropicKey(apiKey);
    case 'gemini':
      return validateGeminiKey(apiKey);
    case 'ollama_cloud':
      return validateOpenAIKey(apiKey, 'https://api.ollama.ai/v1');
    case 'openai_compatible':
      return validateOpenAIKey(apiKey, baseUrl);
    default:
      return false;
  }
}

/**
 * Validate API key and model together by making a minimal API call
 */
export async function validateApiKeyAndModel(
  provider: Provider,
  apiKey: string,
  model: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  if (!apiKey || apiKey.trim().length === 0) {
    return { valid: false, error: 'API key is required' };
  }
  if (!model || model.trim().length === 0) {
    return { valid: false, error: 'Model is required' };
  }
  if (provider === 'openai_compatible' && (!baseUrl || baseUrl.trim().length === 0)) {
    return { valid: false, error: 'Base URL is required for OpenAI-compatible providers' };
  }

  try {
    // Make a minimal API call to validate both key and model
    const config: LLMConfig = { provider, apiKey, model, baseUrl };
    await callLLM(config, 'You are a helpful assistant.', 'Reply with just the word "OK".', undefined);
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    // Parse common error messages for better UX
    if (message.includes('does not exist') || message.includes('not found')) {
      return { valid: false, error: `Model "${model}" not available` };
    }
    if (message.includes('Invalid API') || message.includes('Incorrect API') || message.includes('invalid_api_key')) {
      return { valid: false, error: 'Invalid API key' };
    }
    if (message.includes('quota') || message.includes('rate limit')) {
      return { valid: false, error: 'Rate limit or quota exceeded' };
    }

    return { valid: false, error: message };
  }
}

/**
 * Call an LLM with a system prompt and user prompt
 */
export async function callLLM(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  onStream?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const { provider, model, apiKey, baseUrl } = config;

  switch (provider) {
    case 'openai': {
      const messages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      return callOpenAI(apiKey, model, messages, onStream, signal);
    }

    case 'ollama_cloud': {
      const messages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      return callOpenAI(apiKey, model, messages, onStream, signal, 'https://api.ollama.ai/v1');
    }

    case 'openai_compatible': {
      if (!baseUrl || baseUrl.trim().length === 0) {
        throw new Error('Base URL is required for OpenAI-compatible providers');
      }

      const messages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      return callOpenAI(apiKey, model, messages, onStream, signal, baseUrl);
    }

    case 'anthropic': {
      const messages: AnthropicMessage[] = [
        { role: 'user', content: userPrompt },
      ];
      return callAnthropic(apiKey, model, messages, systemPrompt, onStream, signal);
    }

    case 'gemini': {
      const messages: GeminiMessage[] = [
        { role: 'user', parts: [{ text: userPrompt }] },
      ];
      return callGemini(apiKey, model, messages, systemPrompt, onStream, signal);
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Call an LLM with a full message history (for chat)
 */
export async function callLLMWithHistory(
  config: LLMConfig,
  systemPrompt: string,
  messages: Message[],
  onStream?: (chunk: string) => void
): Promise<string> {
  const { provider, model, apiKey, baseUrl } = config;

  switch (provider) {
    case 'openai': {
      const openAIMessages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];
      return callOpenAI(apiKey, model, openAIMessages, onStream);
    }

    case 'ollama_cloud': {
      const openAIMessages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];
      return callOpenAI(apiKey, model, openAIMessages, onStream, undefined, 'https://api.ollama.ai/v1');
    }

    case 'openai_compatible': {
      if (!baseUrl || baseUrl.trim().length === 0) {
        throw new Error('Base URL is required for OpenAI-compatible providers');
      }

      const openAIMessages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];
      return callOpenAI(apiKey, model, openAIMessages, onStream, undefined, baseUrl);
    }

    case 'anthropic': {
      // Anthropic requires alternating user/assistant messages
      // and system is separate
      const anthropicMessages: AnthropicMessage[] = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      // Ensure first message is from user
      if (anthropicMessages.length > 0 && anthropicMessages[0].role !== 'user') {
        anthropicMessages.unshift({ role: 'user', content: 'Continue.' });
      }

      return callAnthropic(apiKey, model, anthropicMessages, systemPrompt, onStream);
    }

    case 'gemini': {
      // Gemini uses 'model' instead of 'assistant' for AI responses
      const geminiMessages: GeminiMessage[] = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      // Ensure first message is from user
      if (geminiMessages.length > 0 && geminiMessages[0].role !== 'user') {
        geminiMessages.unshift({ role: 'user', parts: [{ text: 'Continue.' }] });
      }

      return callGemini(apiKey, model, geminiMessages, systemPrompt, onStream);
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Estimate token count for a string (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}
