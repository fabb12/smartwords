import { context, jsonBody, answer, fail, HttpError, validText } from '../../../lib/server';
import { EMPTY_PROJECT, sanitizeProject } from '../../../lib/project';
export async function GET(request: Request) {
  try {
    const { db, owner } = context(request); const id = new URL(request.url).searchParams.get('document');
    if (!validText(id, 100)) throw new HttpError(400, 'Documento mancante.');
    const row = await db.prepare('SELECT data FROM projects WHERE document=? AND owner=?').bind(id, owner).first<{ data: string }>();
    return answer(row ? sanitizeProject(JSON.parse(row.data)) : EMPTY_PROJECT);
  } catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const { db, owner } = context(request); const b = await jsonBody(request, 600_000);
    if (!validText(b.document, 100)) throw new HttpError(400, 'Documento mancante.');
    const doc = await db.prepare('SELECT id FROM documents WHERE id=? AND owner=?').bind(b.document, owner).first();
    if (!doc) throw new HttpError(404, 'Documento non trovato.');
    const data = JSON.stringify(sanitizeProject(b.data));
    await db.prepare('INSERT INTO projects (document,owner,data,updated) VALUES (?,?,?,?) ON CONFLICT(document) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE projects.owner=excluded.owner').bind(b.document, owner, data, Date.now()).run();
    return answer({ ok: true });
  } catch (e) { return fail(e); }
}
