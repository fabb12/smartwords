import { readTokens, type Provider } from './providers.ts';
import { finalizeUsage, type ProviderUsage } from './token-usage.ts';

// One wire format for cloud, direct-browser and local-model requests. Usage-only
// SSE frames are preserved as accounting events, independently of generated text.
export function assistStream(body: ReadableStream<Uint8Array>, parser: Provider,
  meta: { provider: string; model: string; system: string; prompt: string }, cleanup: () => void,
  errorMessage = 'Risposta interrotta. Riprova.') {
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(out) {
      const encoder = new TextEncoder(); let answer = '', completed = false, usage: ProviderUsage = {};
      const send = (data: unknown) => out.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      try {
        for await (const text of readTokens(body, parser, update => { usage = { ...usage, ...update }; })) {
          answer += text;
          if (answer.length > 16000) throw new Error('Risposta troppo lunga.');
          if (!cancelled) send({ text });
        }
        completed = true;
      } catch { /* Partial answers still consume tokens. */ }
      finally {
        if (!cancelled) {
          try {
            send({ usage: { ...finalizeUsage(usage, meta.system, meta.prompt, answer), provider: meta.provider, model: meta.model } });
            send(completed ? { done: true } : { error: errorMessage });
            out.close();
          } catch { /* The consumer may have disconnected. */ }
        }
        cleanup();
      }
    },
    cancel() { cancelled = true; cleanup(); },
  });
}
