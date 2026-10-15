import { context, jsonBody, answer, fail, HttpError, validText } from '../../../lib/server';
import { isProvider } from '../../../lib/providers';
import { seal } from '../../../lib/vault';
export async function GET(request: Request) {
  try { const {db,owner,master} = context(request); const day = new Date().toISOString().slice(0,10);
    const result = await db.prepare('SELECT p.id,p.name,p.provider,p.model,p.hint,p.daily_limit,COALESCE(u.count,0) AS used FROM profiles p LEFT JOIN usage u ON u.id=p.id || ? WHERE p.owner=? ORDER BY p.created').bind(':'+day,owner).all();
    return answer({ profiles: result.results, vaultReady: master.length >= 32 });
  } catch(e) { return fail(e); }
}
export async function POST(request: Request) {
  try { const {db,owner,master} = context(request); const b = await jsonBody(request, 16000);
    if (!validText(b.name,80) || !isProvider(b.provider) || !validText(b.model,150) || !Number.isInteger(b.dailyLimit) || b.dailyLimit < 1 || b.dailyLimit > 10000) throw new HttpError(400,'Controlla nome, provider, modello e limite.');
    const existing = b.id ? await db.prepare('SELECT * FROM profiles WHERE id=? AND owner=?').bind(b.id,owner).first<{secret:string;hint:string;provider:string}>() : null;
    if (b.id && !existing) throw new HttpError(404,'Profilo non trovato.');
    if (!b.key && (!existing || existing.provider !== b.provider)) throw new HttpError(400,'Inserisci la chiave API del provider.');
    if (b.key && (!validText(b.key,4096) || /\s/.test(b.key))) throw new HttpError(400,'Chiave API non valida.');
    if (master.length < 32) throw new HttpError(503,'Archivio chiavi non configurato sul server.');
    const id = b.id || crypto.randomUUID(); const secret = b.key ? await seal(b.key,master,owner) : existing!.secret; const hint = b.key ? b.key.slice(-4) : existing!.hint;
    if (existing) await db.prepare('UPDATE profiles SET name=?,provider=?,model=?,secret=?,hint=?,daily_limit=? WHERE id=? AND owner=?').bind(b.name,b.provider,b.model,secret,hint,b.dailyLimit,id,owner).run();
    else await db.prepare('INSERT INTO profiles (id,owner,name,provider,model,secret,hint,daily_limit,created) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,owner,b.name,b.provider,b.model,secret,hint,b.dailyLimit,Date.now()).run();
    return answer({id});
  } catch(e) { return fail(e); }
}
export async function DELETE(request: Request) {
  try { const {db,owner} = context(request); const b=await jsonBody(request,2000);
    await db.prepare('DELETE FROM profiles WHERE id=? AND owner=?').bind(b.id,owner).run(); return answer({ok:true});
  } catch(e) { return fail(e); }
}
