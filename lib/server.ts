import { env } from 'cloudflare:workers';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function context(request: Request) {
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) throw new HttpError(401, 'Accedi per continuare.');
  if (request.method !== 'GET') {
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new HttpError(403, 'Origine non autorizzata.');
    if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'Formato non supportato.');
  }
  if (!env.DB) throw new HttpError(503, 'Archivio documenti non disponibile.');
  return { owner, db: env.DB, master: (env as unknown as { VAULT_MASTER_KEY?: string }).VAULT_MASTER_KEY ?? '' };
}
export async function jsonBody(request: Request, limit = 2_000_000) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new HttpError(413, 'Contenuto troppo grande.');
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, 'Contenuto mancante.');
  const parts: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Contenuto troppo grande.'); } parts.push(value); }
  const all = new Uint8Array(size); let offset = 0; for (const part of parts) { all.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new HttpError(400, 'Contenuto non valido.'); }
}
export function answer(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
export function fail(error: unknown) { return answer({ error: error instanceof HttpError ? error.message : 'Operazione non riuscita. Riprova.' }, error instanceof HttpError ? error.status : 500); }
export function validText(value: unknown, max: number) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
