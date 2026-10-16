import { context, jsonBody, fail, HttpError, validText } from '../../../lib/server';
import { ASSIST_MODES, assistPrompts, isProvider, providerError, providerRequest, readTokens } from '../../../lib/providers';
import { unseal } from '../../../lib/vault';
export async function POST(request: Request) {
  try {
    const { db, owner, master } = context(request); const b=await jsonBody(request,60000);
    if (!validText(b.profile,100) || !validText(b.text,10000) || !(ASSIST_MODES as readonly string[]).includes(b.mode)) throw new HttpError(400,'Richiesta non valida.');
    const p=await db.prepare('SELECT * FROM profiles WHERE id=? AND owner=?').bind(b.profile,owner).first<{id:string;provider:string;model:string;secret:string;daily_limit:number}>();
    if (!p || !isProvider(p.provider)) throw new HttpError(400,'Configura e seleziona un profilo API.');
    const minute = owner+':minute:'+Math.floor(Date.now()/60000); const day=p.id+':'+new Date().toISOString().slice(0,10);
    const rate = await db.prepare('INSERT INTO usage (id,count) VALUES (?,1) ON CONFLICT(id) DO UPDATE SET count=count+1 WHERE count<30 RETURNING count').bind(minute).first();
    if (!rate) throw new HttpError(429,'Troppe richieste: attendi un minuto.');
    const quota = await db.prepare('INSERT INTO usage (id,count) VALUES (?,1) ON CONFLICT(id) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(day,p.daily_limit).first();
    if (!quota) throw new HttpError(429,'Limite giornaliero del profilo raggiunto.');
    await db.prepare('DELETE FROM usage WHERE id LIKE ? AND id != ?').bind(owner+':minute:%',minute).run();
    const key=await unseal(p.secret,master,owner);
    const {system,prompt,maxTokens}=assistPrompts(b);
    const config=providerRequest(p.provider,p.model,key,system,prompt,maxTokens); const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    request.signal.addEventListener('abort',()=>controller.abort(),{once:true});
    let upstream: Response;
    try { upstream=await fetch(config.url,{ method:'POST',headers:config.headers,body:JSON.stringify(config.body),signal:controller.signal,redirect:'error' }); }
    catch { clearTimeout(timer); throw new HttpError(502,'Il provider non risponde. Riprova.'); }
    if (!upstream.ok || !upstream.body) { clearTimeout(timer); await upstream.body?.cancel();
      throw new HttpError(upstream.status===429?429:502,providerError(upstream.status)); }
    const provider=p.provider; const encoder=new TextEncoder();
    const stream=new ReadableStream({
      async start(out) { try { let chars=0;
        for await (const token of readTokens(upstream.body!,provider)) { chars+=token.length; if(chars>16000) throw new Error('Risposta troppo lunga.'); out.enqueue(encoder.encode(JSON.stringify({text:token})+'\n')); }
        out.enqueue(encoder.encode(JSON.stringify({done:true})+'\n'));
      } catch { try { out.enqueue(encoder.encode(JSON.stringify({error:'Risposta interrotta. Riprova.'})+'\n')); } catch {} }
        finally { clearTimeout(timer); try {out.close();} catch {} } },
      cancel() { controller.abort(); clearTimeout(timer); },
    });
    return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  } catch(e) { return fail(e); }
}
