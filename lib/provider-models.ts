import type { Provider } from './providers';

// Suggestions, not an entitlement list: availability depends on the provider/account.
// Newest models first. The custom model field remains available for new releases and fine-tuned models.
// Last reviewed: October 2026 (retired IDs removed: Groq Llama 3.x, DeepSeek deepseek-chat/reasoner,
// Claude 3.x and Opus 4.1, gpt-4.1-nano, gemini-2.0-flash).
export const PROVIDER_MODELS: Record<Provider, string[]> = {
  openai: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.5', 'gpt-5', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  anthropic: ['claude-haiku-4-5', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5'],
  gemini: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'groq/compound', 'groq/compound-mini'],
  mistral: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'mistral-large-4', 'codestral-latest', 'ministral-8b-latest'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  openrouter: ['openai/gpt-4.1-mini', 'openai/gpt-6.1-sol', 'anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5', 'google/gemini-3.8-flash', '~anthropic/claude-opus-latest', '~google/gemini-flash-latest', 'deepseek/deepseek-chat'],
};
