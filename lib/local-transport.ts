import { desktop } from './desktop.ts';

// Browser fetch when allowed; native streaming IPC in the packaged desktop app.
export function localModelFetch(url: string, options: { method?: 'GET' | 'POST'; token?: string; body?: string; signal: AbortSignal }): Promise<Response> {
  const bridge = desktop()?.localRequest, { signal, token = '', body, method = 'GET' } = options;
  if (!bridge) return fetch(url, { method, body, signal, redirect: 'error', headers: {
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}),
  } });
  return new Promise((resolve, reject) => {
    let output!: ReadableStreamDefaultController<Uint8Array>;
    let stop: (() => void) | undefined, finished = false, headers = false;
    const cleanup = () => { finished = true; signal.removeEventListener('abort', abort); stop?.(); };
    const abort = () => { const error = new DOMException('Richiesta annullata.', 'AbortError'); if (headers) output.error(error); else reject(error); cleanup(); };
    const stream = new ReadableStream<Uint8Array>({ start(controller) { output = controller; }, cancel() { cleanup(); } });
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    try {
      stop = bridge({ id: crypto.randomUUID(), url, method, token, body }, event => {
        if (finished) return;
        if (event.type === 'headers') { headers = true; resolve(new Response([204, 205, 304].includes(event.status) ? null : stream, { status: event.status })); }
        else if (event.type === 'chunk') output.enqueue(new TextEncoder().encode(event.text));
        else if (event.type === 'done') { output.close(); cleanup(); }
        else { const error = new Error(event.message); if (headers) output.error(error); else reject(error); cleanup(); }
      });
      if (finished) stop();
    } catch (error) { if (headers) output.error(error); else reject(error); cleanup(); }
  });
}
