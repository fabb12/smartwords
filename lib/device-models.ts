// Local inference always runs on the user's device, even in the cloud-backed app.
// These profiles are deliberately separate from server-side profiles and keys.
import { PROVIDERS, ASSIST_MODES, assistPrompts, type Provider } from './providers.ts';
import { assistStream } from './assist-stream.ts';
import { desktop } from './desktop.ts';
import { localModelFetch } from './local-transport.ts';

export const DEVICE_PROVIDERS = {
  ollama: {name:'Ollama (locale)', model:'', baseUrl:'http://127.0.0.1:11434'},
  lmstudio: {name:'LM Studio (locale)', model:'', baseUrl:'http://127.0.0.1:1234'},
};
export const ALL_PROVIDERS = {...PROVIDERS, ...DEVICE_PROVIDERS};
export type DeviceProvider = keyof typeof DEVICE_PROVIDERS;
export type AiProvider = Provider | DeviceProvider;
export const isDeviceProvider = (p: unknown): p is DeviceProvider => p === 'ollama' || p === 'lmstudio';
export const isDeviceProfile = (id: unknown): id is string => typeof id === 'string' && id.startsWith('device:');
type DeviceProfile = {id:string; name:string; provider:DeviceProvider; model:string; baseUrl:string; key:string; hint:string; daily_limit:number};
const STORAGE = 'scrivia:device-profiles';
const USAGE = 'scrivia:device-usage';
function read<T>(key:string, fallback:T):T { try {return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;} catch {return fallback;} }
function write(key:string, value:unknown) { try {localStorage.setItem(key,JSON.stringify(value));} catch {throw new Error('Impossibile salvare il profilo su questo dispositivo.');} }
const today=()=>new Date().toISOString().slice(0,10);
function counts() { const u=read(USAGE,{day:today(),counts:{} as Record<string,number>});return u.day===today()?u.counts:{}; }
const valid=(s:unknown,max:number):s is string=>typeof s==='string'&&!!s.trim()&&s.length<=max;
function protect(key:string) {const data=desktop()?.protect(key);return data?'enc:'+data:key;}
function reveal(key:string) {return key.startsWith('enc:')?desktop()?.reveal(key.slice(4))||'':key;}

export function deviceBaseUrl(value:string):string {
  let url:URL;
  try {url=new URL(value);} catch {throw new Error('Indirizzo locale non valido.');}
  if (!['http:','https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !['','/','/v1','/v1/'].includes(url.pathname)) {
    throw new Error('Usa un indirizzo loopback, ad esempio http://127.0.0.1:11434, senza credenziali o percorsi aggiuntivi.');
  }
  return url.origin;
}

// Public metadata never includes the optional local server token.
export function deviceProfiles() {
  const used=counts();
  return read<DeviceProfile[]>(STORAGE,[]).map(({key,...p})=>({...p,used:used[p.id]||0}));
}
export function deviceProfileApi(body?:Record<string,unknown>,method='POST') {
  const profiles=read<DeviceProfile[]>(STORAGE,[]);
  if (!body) return {profiles:deviceProfiles()};
  if (method==='DELETE') {write(STORAGE,profiles.filter(p=>p.id!==body.id));return {ok:true};}
  if (!valid(body.name,80)||!isDeviceProvider(body.provider)||!valid(body.model,150)
    ||!Number.isInteger(body.dailyLimit)||Number(body.dailyLimit)<1||Number(body.dailyLimit)>10000) throw new Error('Controlla nome, provider, modello e limite.');
  const existing=profiles.find(p=>p.id===body.id);
  if (body.id&&!existing) throw new Error('Profilo locale non trovato.');
  const baseUrl=deviceBaseUrl(typeof body.baseUrl==='string'&&body.baseUrl?body.baseUrl:DEVICE_PROVIDERS[body.provider].baseUrl);
  if (body.key && (!valid(body.key,4096)||/\s/.test(body.key))) throw new Error('Token locale non valido.');
  const sameServer=existing?.baseUrl===baseUrl&&existing?.provider===body.provider;
  const p:DeviceProfile={id:existing?.id||'device:'+crypto.randomUUID(),name:body.name,provider:body.provider,model:body.model,baseUrl,
    key:body.key?protect(String(body.key)):sameServer?existing!.key:'',hint:body.key?String(body.key).slice(-4):sameServer?existing!.hint:'',daily_limit:Number(body.dailyLimit)};
  write(STORAGE,existing?profiles.map(old=>old.id===p.id?p:old):[...profiles,p]);return {id:p.id};
}

export const DEVICE_CONNECTION_HELP='Apri Ollama oppure avvia il server in LM Studio → Developer. Nell’app desktop il collegamento è nativo e non richiede CORS. Nel browser segui «Come collegare il server» nelle impostazioni e consenti l’accesso alla rete locale.';
export function deviceConnectionError(provider?:DeviceProvider):string {
  const server=provider==='lmstudio'?'Avvia il server in LM Studio → Developer → Start Server.':'Apri Ollama e verifica che sia in esecuzione.';
  return `${server} ${desktop()?.localRequest?'Controlla l’indirizzo e premi «Verifica connessione» nelle impostazioni.':'Il browser potrebbe bloccare il collegamento: apri «Come collegare il server» nelle impostazioni, oppure usa l’app desktop.'}`;
}
export async function deviceModels(baseUrl:string,key='',signal?:AbortSignal,profileId='',provider?:DeviceProvider):Promise<string[]> {
  const origin=deviceBaseUrl(baseUrl);
  const saved=profileId?read<DeviceProfile[]>(STORAGE,[]).find(p=>p.id===profileId&&p.baseUrl===origin&&(!provider||p.provider===provider)):undefined;
  const token=key||(saved?reveal(saved.key):'');
  if(saved?.key&&!token)throw new Error('Token locale non leggibile: inseriscilo di nuovo nel profilo.');
  const kind=provider||saved?.provider, paths=kind==='ollama'?['/api/tags','/v1/models']:kind==='lmstudio'?['/api/v0/models','/v1/models']:['/v1/models'];
  const combined=AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])]);
  for(const path of paths){
    let r:Response;
    try{r=await localModelFetch(origin+path,{token,signal:combined});}
    catch(err){if(signal?.aborted)throw err;throw new Error(deviceConnectionError(kind));}
    if((r.status===404||r.status===405)&&path!==paths.at(-1)){await r.body?.cancel();continue;}
    if(!r.ok){await r.body?.cancel();throw new Error(r.status===401||r.status===403?'Il server richiede un token valido: inseriscilo nel campo «Token del server locale».':`Il server locale ha rifiutato la lettura dei modelli (${r.status}).`);}
    const data=await r.json() as {data?:unknown;models?:unknown};
    const list=path==='/api/tags'?data.models:data.data;
    if(!Array.isArray(list))throw new Error('Risposta non riconosciuta. Controlla che l’indirizzo sia quello del server Ollama o LM Studio.');
    return [...new Set<string>(list.filter(m=>m&&m.type!=='embeddings'&&m.type!=='embedding').map(m=>path==='/api/tags'?m.name||m.model:m.id).filter((id:unknown)=>valid(id,150)))].sort();
  }
  return [];
}

export async function deviceAssist(b:Record<string,unknown>,signal:AbortSignal):Promise<Response> {
  const fail=(error:string,status=400)=>Response.json({error},{status});
  if (!valid(b.text,10000)||!(ASSIST_MODES as readonly unknown[]).includes(b.mode)) return fail('Richiesta non valida.');
  const p=read<DeviceProfile[]>(STORAGE,[]).find(p=>p.id===b.profile);
  if (!p) return fail('Configura un profilo locale su questo dispositivo.');
  const used=counts();if((used[p.id]||0)>=p.daily_limit)return fail('Limite giornaliero del profilo raggiunto.',429);
  const token=reveal(p.key);if(p.key&&!token)return fail('Token locale non leggibile: inseriscilo di nuovo nel profilo.');
  const baseUrl=deviceBaseUrl(p.baseUrl);
  const {system,prompt,maxTokens}=assistPrompts(b);
  const controller=new AbortController();
  const combined=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(120000)]);
  let upstream:Response;
  try {
    used[p.id]=(used[p.id]||0)+1;write(USAGE,{day:today(),counts:used});
    upstream=await localModelFetch(baseUrl+'/v1/chat/completions',{method:'POST',token,
      body:JSON.stringify({model:p.model,messages:[{role:'system',content:system},{role:'user',content:prompt}],max_tokens:maxTokens,stream:true,stream_options:{include_usage:true}}),signal:combined});
  } catch {if(signal.aborted)throw new DOMException('Richiesta annullata.','AbortError');return fail(deviceConnectionError(p.provider),502);}
  if(!upstream.ok||!upstream.body){await upstream.body?.cancel();return fail(upstream.status===401||upstream.status===403?'Il server locale richiede un token valido: aggiorna il profilo nelle impostazioni.':upstream.status===404?'Modello o endpoint non trovato. Premi «Verifica connessione» e scegli un modello installato.':`Il server locale ha rifiutato la richiesta (${upstream.status}). In LM Studio abilita il caricamento automatico (Just-In-Time) oppure carica il modello in Developer.`,502);}
  return new Response(assistStream(upstream.body,'openai',{provider:p.provider,model:p.model,system,prompt},()=>controller.abort(),'Risposta del modello locale interrotta. Riprova.'),{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'}});
}
