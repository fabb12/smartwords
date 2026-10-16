// Local inference always runs on the user's device, even in the cloud-backed app.
// These profiles are deliberately separate from server-side profiles and keys.
import { PROVIDERS, ASSIST_MODES, assistPrompts, readTokens, type Provider } from './providers.ts';
import { desktop } from './desktop.ts';

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

export const DEVICE_CONNECTION_HELP='Avvia il server locale e abilita CORS per l’origine di Scrivia (OLLAMA_ORIGINS in Ollama; Enable CORS in LM Studio). Consenti l’accesso alla rete locale se il browser lo richiede. Nell’app desktop il collegamento è diretto.';
export async function deviceModels(baseUrl:string,key='',signal?:AbortSignal,profileId=''):Promise<string[]> {
  const origin=deviceBaseUrl(baseUrl);
  const saved=profileId?read<DeviceProfile[]>(STORAGE,[]).find(p=>p.id===profileId&&p.baseUrl===origin):undefined;
  const token=key||(saved?reveal(saved.key):'');
  if(saved?.key&&!token)throw new Error('Token locale non leggibile: inseriscilo di nuovo nel profilo.');
  const r=await fetch(origin+'/v1/models',{headers:token?{Authorization:'Bearer '+token}:{},redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])])});
  if (!r.ok) throw new Error(`Il server locale ha rifiutato la lettura dei modelli (${r.status}).`);
  const data=await r.json() as {data?:unknown};
  return [...new Set<string>((Array.isArray(data?.data)?data.data:[]).map((m:{id?:unknown})=>m?.id).filter((id:unknown)=>valid(id,150)))].sort();
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
    upstream=await fetch(baseUrl+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
      body:JSON.stringify({model:p.model,messages:[{role:'system',content:system},{role:'user',content:prompt}],max_tokens:maxTokens,stream:true}),signal:combined,redirect:'error'});
  } catch {if(signal.aborted)throw new DOMException('Richiesta annullata.','AbortError');return fail('Connessione al modello locale non riuscita. '+DEVICE_CONNECTION_HELP,502);}
  if(!upstream.ok||!upstream.body){await upstream.body?.cancel();return fail(`Il server locale ha rifiutato la richiesta (${upstream.status}). Controlla modello caricato e token.`,502);}
  const encoder=new TextEncoder();
  return new Response(new ReadableStream({
    async start(out){try{let chars=0;for await(const text of readTokens(upstream.body!,'openai')){chars+=text.length;if(chars>16000)throw new Error('Risposta troppo lunga.');out.enqueue(encoder.encode(JSON.stringify({text})+'\n'));}out.enqueue(encoder.encode('{"done":true}\n'));}
      catch {try{out.enqueue(encoder.encode('{"error":"Risposta del modello locale interrotta. Riprova."}\n'));}catch{}}
      finally{controller.abort();try{out.close();}catch{}}},
    cancel(){controller.abort();},
  }),{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'}});
}
