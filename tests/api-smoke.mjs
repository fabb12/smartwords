// Run only against the local preview. Creates documents in the local test database.
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:5173';
const signin=await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
const cookie=signin.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
assert.ok(cookie,'Local sign-in must set a development cookie');
async function req(path,body,extra={}){return fetch(origin+'/api/'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json',Origin:origin}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});}
const anon=await fetch(origin+'/api/documents');assert.equal(anon.status,401);
const content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Test automatico salvataggio'}]}]};
// Vite rejects the origin before consuming the body; do not reuse that socket.
assert.equal((await req('documents',{title:'Test CSRF',content},{Origin:'https://other.example',Connection:'close'})).status,403);
let r=await req('documents',{title:'Verifica API',content});assert.equal(r.status,200);const created=await r.json();assert.equal(created.version,1);
r=await req('documents',{id:created.id,version:1,title:'Verifica API aggiornata',content});assert.equal(r.status,200);assert.equal((await r.json()).version,2);
r=await req('documents',{id:created.id,version:1,title:'Versione obsoleta',content});assert.equal(r.status,409);
r=await req('documents?id='+created.id);assert.equal((await r.json()).title,'Verifica API aggiornata');
r=await req('documents?id='+created.id+'&history=1');assert.ok((await r.json()).length>=1);
const mixedVoice={id:'mix',intensity:'strong',custom:'',blend:[{id:'calvino',weight:75},{id:'hemingway',weight:25}]};
r=await req('projects',{document:created.id,data:{voice:mixedVoice}});assert.equal(r.status,200);
r=await req('projects?document='+created.id);assert.equal(r.status,200);assert.deepEqual((await r.json()).voice,mixedVoice);
r=await req('assist',{profile:'does-not-exist',mode:'complete',text:'Una frase'});assert.equal(r.status,400);
console.log('API: authentication, CSRF, persistence, revision history, conflict protection and invalid profile checks passed.');
