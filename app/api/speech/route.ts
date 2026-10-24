import { context, jsonBody, fail, HttpError, validText } from '../../../lib/server';
import { openaiSpeechRequest, speechError } from '../../../lib/read-aloud';
import { unseal } from '../../../lib/vault';

// Neural read-aloud with the writer's OpenAI profile: the key stays on the server.
export async function POST(request: Request) {
  try {
    const { db, owner, master } = context(request); const b = await jsonBody(request, 20000);
    if (!validText(b.profile, 100) || !validText(b.text, 4000) || !validText(b.voice, 40) || !validText(b.model, 80)) throw new HttpError(400, 'Richiesta non valida.');
    const p = await db.prepare('SELECT * FROM profiles WHERE id=? AND owner=?').bind(b.profile, owner).first<{ provider: string; secret: string }>();
    if (!p || p.provider !== 'openai') throw new HttpError(400, 'Per le voci neurali scegli un profilo OpenAI.');
    const minute = owner + ':speech:' + Math.floor(Date.now() / 60000);
    const rate = await db.prepare('INSERT INTO usage (id,count) VALUES (?,1) ON CONFLICT(id) DO UPDATE SET count=count+1 WHERE count<60 RETURNING count').bind(minute).first();
    if (!rate) throw new HttpError(429, 'Troppe richieste di lettura: attendi un minuto.');
    await db.prepare('DELETE FROM usage WHERE id LIKE ? AND id != ?').bind(owner + ':speech:%', minute).run();
    const key = await unseal(p.secret, master, owner);
    const config = openaiSpeechRequest(key, b.model, b.voice, { text: b.text });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
    request.signal.addEventListener('abort', () => controller.abort(), { once: true });
    let upstream: Response;
    try { upstream = await fetch(config.url, { method: 'POST', headers: config.headers, body: JSON.stringify(config.body), signal: controller.signal, redirect: 'error' }); }
    catch { clearTimeout(timer); throw new HttpError(502, 'Il servizio vocale non risponde. Riprova.'); }
    if (!upstream.ok || !upstream.body) { clearTimeout(timer); await upstream.body?.cancel(); throw new HttpError(upstream.status === 429 ? 429 : 502, speechError(upstream.status)); }
    const audio = await upstream.arrayBuffer(); clearTimeout(timer);
    return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (e) { return fail(e); }
}
