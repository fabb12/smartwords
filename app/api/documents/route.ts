import { context, jsonBody, answer, fail, HttpError, validText } from '../../../lib/server';
export async function GET(request: Request) {
  try {
    const { db, owner } = context(request); const url = new URL(request.url); const id = url.searchParams.get('id');
    if (id && url.searchParams.has('history')) return answer((await db.prepare('SELECT id,title,content,created FROM revisions WHERE document=? AND owner=? ORDER BY created DESC LIMIT 30').bind(id, owner).all()).results);
    if (id) { const doc = await db.prepare('SELECT * FROM documents WHERE id=? AND owner=?').bind(id, owner).first();
      if (!doc) throw new HttpError(404, 'Documento non trovato.'); return answer(doc); }
    return answer((await db.prepare('SELECT id,title,updated,version FROM documents WHERE owner=? ORDER BY updated DESC').bind(owner).all()).results);
  } catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const { db, owner } = context(request); const input = await jsonBody(request);
    if (!validText(input.title, 150) || !input.content || input.content.type !== 'doc') throw new HttpError(400, 'Documento non valido.');
    const content = JSON.stringify(input.content); const now = Date.now();
    if (!input.id) { const id = crypto.randomUUID(); await db.prepare('INSERT INTO documents (id,owner,title,content,updated,version) VALUES (?,?,?,?,?,1)').bind(id,owner,input.title,content,now).run(); return answer({ id, version: 1, updated: now }); }
    if (!Number.isInteger(input.version)) throw new HttpError(400, 'Versione mancante.');
    const old = await db.prepare('SELECT content,title,updated FROM documents WHERE id=? AND owner=? AND version=?').bind(input.id,owner,input.version).first<{content:string;title:string;updated:number}>();
    if (!old) throw new HttpError(409, 'Il documento è cambiato in un’altra scheda. Esporta la tua copia prima di ricaricare.');
    const results = await db.batch([
      db.prepare('INSERT INTO revisions (id,document,owner,title,content,created) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT id FROM documents WHERE id=? AND owner=? AND version=?) AND NOT EXISTS (SELECT id FROM revisions WHERE document=? AND owner=? AND created>?)').bind(crypto.randomUUID(),input.id,owner,old.title,old.content,old.updated,input.id,owner,input.version,input.id,owner,now-60000),
      db.prepare('UPDATE documents SET title=?,content=?,updated=?,version=version+1 WHERE id=? AND owner=? AND version=?').bind(input.title,content,now,input.id,owner,input.version),
      db.prepare('DELETE FROM revisions WHERE document=? AND owner=? AND id NOT IN (SELECT id FROM revisions WHERE document=? AND owner=? ORDER BY created DESC LIMIT 30)').bind(input.id,owner,input.id,owner),
    ]);
    if (!results[1].meta.changes) throw new HttpError(409, 'Conflitto di salvataggio. Esporta la tua copia prima di ricaricare.');
    return answer({ id: input.id, version: input.version+1, updated: now });
  } catch (e) { return fail(e); }
}
