export const PROVIDERS = {
  openai: { name: 'OpenAI', model: 'gpt-4.1-mini', url: 'https://api.openai.com/v1/chat/completions' },
  anthropic: { name: 'Anthropic', model: 'claude-haiku-4-5', url: 'https://api.anthropic.com/v1/messages' },
  gemini: { name: 'Google Gemini', model: 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' },
  groq: { name: 'Groq', model: 'llama-3.3-70b-versatile', url: 'https://api.groq.com/openai/v1/chat/completions' },
  mistral: { name: 'Mistral', model: 'mistral-small-latest', url: 'https://api.mistral.ai/v1/chat/completions' },
  deepseek: { name: 'DeepSeek', model: 'deepseek-chat', url: 'https://api.deepseek.com/chat/completions' },
  openrouter: { name: 'OpenRouter', model: 'openai/gpt-4.1-mini', url: 'https://openrouter.ai/api/v1/chat/completions' },
} as const;
export type Provider = keyof typeof PROVIDERS;
export function isProvider(value: string): value is Provider { return Object.hasOwn(PROVIDERS, value); }
export function providerRequest(provider: Provider, model: string, key: string, system: string, prompt: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: Record<string, unknown>;
  if (provider === 'anthropic') {
    headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01';
    body = { model, system, messages: [{ role: 'user', content: prompt }], max_tokens: 1024, stream: true };
  } else {
    headers.Authorization = `Bearer ${key}`;
    body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], stream: true,
      ...(provider === 'openai' ? { max_completion_tokens: 1024 } : { max_tokens: 1024 }) };
  }
  return { url: PROVIDERS[provider].url, headers, body };
}
export async function* readTokens(body: ReadableStream<Uint8Array>, provider: Provider) {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data === '[DONE]') { finished = true; continue; }
        const event = JSON.parse(data);
        if (event.error || event.type === 'error') throw new Error('Risposta interrotta.');
        if (provider === 'anthropic') {
          if (event.type === 'message_delta' && event.delta?.stop_reason === 'max_tokens') throw new Error('Limite risposta raggiunto.');
          if (event.type === 'message_stop') finished = true;
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') yield event.delta.text as string;
        } else {
          if (['length','content_filter'].includes(event.choices?.[0]?.finish_reason)) throw new Error('Risposta troncata dal provider.');
          if (event.choices?.[0]?.finish_reason) finished = true;
          const token = event.choices?.[0]?.delta?.content;
          if (typeof token === 'string') yield token;
        }
      }
      if (done) break;
    }
    if (!finished) throw new Error('Risposta incompleta.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
