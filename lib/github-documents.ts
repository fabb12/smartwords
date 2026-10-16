// GitHub is contacted from the user's browser/desktop. Tokens never enter the
// document format or the application's backend.
import { desktop } from './desktop.ts';
import { sanitizeProject, type Project } from './project.ts';

export type GitHubSettings = { repository:string; branch:string; remember:boolean };
export type GitHubDocument = { format:'scrivia-document'; version:1; id:string; title:string; content:Record<string,unknown>; project:Project; updated:number };
export type RepositoryDocument = { document:GitHubDocument; path:string; sha:string };
type Connection = GitHubSettings & {token:string};
type Binding = {remoteId:string; path:string; sha:string; fingerprint:string};
type Metadata = {sha:string; size:number; encoding?:string; content?:string};
const SETTINGS='scrivia:github-settings', TOKEN='scrivia:github-token', BINDINGS='scrivia:github-bindings';
const DIRECTORY='scrivia-documents', MAX_BYTES=2_000_000;
let connection:Connection|undefined;

function read<T>(key:string,fallback:T):T {try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}}
function write(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value));}catch{throw new Error('Spazio del dispositivo insufficiente per salvare la connessione GitHub.');}}
export function githubSettings():GitHubSettings {return read(SETTINGS,{repository:'fabb12/smartwords',branch:'documenti-scrivia',remember:false});}
function validateSettings(s:GitHubSettings){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s.repository))throw new Error('Indica il repository nel formato proprietario/nome.');
  if(!s.branch||s.branch.length>200||/[\s~^:?*\[\\]/.test(s.branch)||s.branch.includes('..')||s.branch.includes('@{')||s.branch.split('/').some(p=>!p||p.startsWith('.')||p.endsWith('.')||p.endsWith('.lock')))throw new Error('Nome del ramo GitHub non valido.');
}
function current():Connection {
  const settings=githubSettings();
  if(connection&&connection.repository===settings.repository&&connection.branch===settings.branch)return connection;
  const stored=read<string>(TOKEN,'');
  const token=stored.startsWith('enc:')?desktop()?.reveal(stored.slice(4))||'':stored;
  if(!token)throw new Error('Collega GitHub su questo dispositivo prima di salvare o caricare.');
  validateSettings(settings);return connection={...settings,token};
}
export function githubConnected(){try{return !!current();}catch{return false;}}
export function disconnectGitHub(){connection=undefined;localStorage.removeItem(TOKEN);}
function endpoint(c:GitHubSettings,path:string){return 'https://api.github.com/repos/'+c.repository+(path?'/'+path:'');}
const encoded=(path:string)=>path.split('/').map(encodeURIComponent).join('/');
async function request(c:Connection,path:string,init:RequestInit={}){
  try{return await fetch(endpoint(c,path),{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+c.token,...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}});}
  catch{throw new Error('Connessione a GitHub non riuscita. La copia nell’app è conservata; ricollegati e aggiorna l’elenco prima di riprovare.');}
}
async function failure(r:Response):Promise<never>{
  if(r.status===401)throw new Error('Accesso GitHub scaduto o token non valido: ricollega l’account.');
  if(r.status===403)throw new Error('GitHub ha rifiutato l’accesso: controlla i permessi Contents del token, l’eventuale SSO e i limiti di richieste.');
  if(r.status===404)throw new Error('Repository, ramo o documento non disponibile: controlla nome e accesso del token.');
  throw new Error(`Operazione GitHub non riuscita (${r.status}). La copia nell’app è conservata.`);
}
type RepositoryInfo={private:boolean;default_branch:string;permissions?:{push?:boolean}};
async function repository(c:Connection):Promise<RepositoryInfo>{const r=await request(c,'');if(!r.ok)return failure(r);return await r.json() as RepositoryInfo;}
export async function connectGitHub(settings:GitHubSettings,token:string){
  validateSettings(settings);
  const previous=githubConnected()?current():undefined;
  const value=token.trim()||(previous?.repository===settings.repository?previous.token:'');
  if(!value||/\s/.test(value))throw new Error('Inserisci un token GitHub valido, con accesso al repository scelto.');
  const c={...settings,token:value},info=await repository(c);
  write(SETTINGS,settings);
  if(settings.remember){const encrypted=desktop()?.protect(value);write(TOKEN,encrypted?'enc:'+encrypted:value);}else localStorage.removeItem(TOKEN);
  connection=c;return info;
}
async function branchExists(c:Connection){
  const r=await request(c,'git/ref/heads/'+encoded(c.branch));if(r.status===404)return false;if(!r.ok)return failure(r);return true;
}
async function ensureBranch(c:Connection){
  if(await branchExists(c))return;
  const info=await repository(c);
  const base=await request(c,'git/ref/heads/'+encoded(info.default_branch));if(base.status===404)throw new Error('Il repository non ha ancora un commit iniziale: aggiungi un README su GitHub e riprova.');if(!base.ok)return failure(base);
  const ref=await base.json() as {object:{sha:string}};
  const created=await request(c,'git/refs',{method:'POST',body:JSON.stringify({ref:'refs/heads/'+c.branch,sha:ref.object.sha})});
  if(!created.ok&&!(created.status===422&&await branchExists(c)))await failure(created);
}
async function metadata(c:Connection,path:string):Promise<Metadata|null>{
  const r=await request(c,'contents/'+encoded(path)+'?ref='+encodeURIComponent(c.branch));if(r.status===404)return null;if(!r.ok)return failure(r);
  const file=await r.json() as Metadata;
  if(!file.sha||!Number.isFinite(file.size))throw new Error('Risposta GitHub non valida.');return file;
}
export function encodeDocument(text:string){const bytes=new TextEncoder().encode(text);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
function decodeDocument(text:string){const binary=atob(text.replace(/\s/g,''));return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));}
export function parseGitHubDocument(text:string):GitHubDocument {
  if(new TextEncoder().encode(text).length>MAX_BYTES)throw new Error('Il documento supera il limite di 2 MB.');
  const d=JSON.parse(text);
  if(d?.format!=='scrivia-document'||d.version!==1||typeof d.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(d.id)||typeof d.title!=='string'||!d.title.trim()||d.title.length>150||d.content?.type!=='doc'||!Array.isArray(d.content.content)||typeof d.updated!=='number'||!Number.isFinite(d.updated))throw new Error('Il file non è un documento Scrivia valido.');
  return {format:'scrivia-document',version:1,id:d.id,title:d.title,content:d.content,project:sanitizeProject(d.project),updated:d.updated};
}
async function readFile(c:Connection,path:string):Promise<RepositoryDocument>{
  if(!new RegExp('^'+DIRECTORY+'/[a-zA-Z0-9-]{1,100}\\.json$').test(path))throw new Error('Percorso del documento non valido.');
  const meta=await metadata(c,path);if(!meta)throw new Error('Il documento è stato rimosso da GitHub.');
  if(meta.size>MAX_BYTES)throw new Error('Il documento supera il limite di 2 MB.');
  let raw=meta;
  // Contents returns no inline content for files larger than 1 MB.
  if(meta.encoding!=='base64'){const r=await request(c,'git/blobs/'+encodeURIComponent(meta.sha));if(!r.ok)return failure(r);raw=await r.json() as Metadata;}
  if(raw.encoding!=='base64'||typeof raw.content!=='string')throw new Error('Contenuto del documento GitHub non disponibile.');
  const document=parseGitHubDocument(decodeDocument(raw.content));
  if(path!==DIRECTORY+'/'+document.id+'.json')throw new Error('Identificativo del documento GitHub non coerente con il file.');
  return {document,path,sha:meta.sha};
}
export async function listGitHubDocuments():Promise<RepositoryDocument[]>{
  const c=current();if(!await branchExists(c))return [];
  const r=await request(c,'contents/'+DIRECTORY+'?ref='+encodeURIComponent(c.branch));if(r.status===404)return [];if(!r.ok)return failure(r);
  const files=await r.json() as {type:string;name:string;path:string}[];
  if(!Array.isArray(files))throw new Error('La cartella dei documenti non è disponibile.');
  if(files.length>=1000)throw new Error('La cartella raggiunge il limite di 1000 file dell’API GitHub: scegli un altro archivio.');
  const paths=files.filter(f=>f.type==='file'&&/^[a-zA-Z0-9-]{1,100}\.json$/.test(f.name)).map(f=>f.path);
  const docs:RepositoryDocument[]=[];let next=0;
  await Promise.all(Array.from({length:Math.min(4,paths.length)},async()=>{while(next<paths.length){const path=paths[next++];docs.push(await readFile(c,path));}}));
  return docs.sort((a,b)=>b.document.updated-a.document.updated);
}
export function loadGitHubDocument(path:string){return readFile(current(),path);}
function bindingKey(c:GitHubSettings){return c.repository+'@'+c.branch;}
function bindings(){return read<Record<string,Record<string,Binding>>>(BINDINGS,{});}
async function fingerprint(title:string,content:Record<string,unknown>,project:Project){const data=new TextEncoder().encode(JSON.stringify({title,content,project:sanitizeProject(project)}));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');}
export async function bindGitHubDocument(localId:string,remote:RepositoryDocument,scope:GitHubSettings=current()){
  const hash=await fingerprint(remote.document.title,remote.document.content,remote.document.project);
  const all=bindings(),key=bindingKey(scope),previous=all[key]||{};
  const retained=Object.fromEntries(Object.entries(previous).filter(([id,b])=>id===localId||b.remoteId!==remote.document.id));
  all[key]={...retained,[localId]:{remoteId:remote.document.id,path:remote.path,sha:remote.sha,fingerprint:hash}};write(BINDINGS,all);
}
export function githubLocalId(remoteId:string,availableIds:string[]){return Object.entries(bindings()[bindingKey(current())]||{}).find(([localId,b])=>b.remoteId===remoteId&&availableIds.includes(localId))?.[0];}
export async function githubLocalUnchanged(localId:string,title:string,content:Record<string,unknown>,project:Project){return bindings()[bindingKey(current())]?.[localId]?.fingerprint===await fingerprint(title,content,project);}
export class GitHubConflict extends Error {constructor(){super('Il documento su GitHub è cambiato su un altro dispositivo. Carica la versione aggiornata oppure salva una copia; la tua versione nell’app è conservata.');}}
export async function saveGitHubDocument(localId:string,title:string,content:Record<string,unknown>,project:Project,copy=false):Promise<RepositoryDocument>{
  const c=current(),binding=copy?undefined:bindings()[bindingKey(c)]?.[localId];
  const id=binding?.remoteId||crypto.randomUUID(),path=DIRECTORY+'/'+id+'.json';
  const document=parseGitHubDocument(JSON.stringify({format:'scrivia-document',version:1,id,title,content,project,updated:Date.now()}));
  const serialized=JSON.stringify(document,null,2);parseGitHubDocument(serialized);
  await ensureBranch(c);
  const existing=await metadata(c,path);
  if(binding?existing?.sha!==binding.sha:existing!==null)throw new GitHubConflict();
  const r=await request(c,'contents/'+encoded(path),{method:'PUT',body:JSON.stringify({message:'Salva «'+title+'» con Scrivia',content:encodeDocument(serialized),branch:c.branch,...(binding?{sha:binding.sha}:{})})});
  if(r.status===409||r.status===422)throw new GitHubConflict();if(!r.ok)return failure(r);
  const saved=await r.json() as {content:{sha:string}};
  if(!saved.content?.sha)throw new Error('Salvataggio GitHub non confermato: aggiorna l’elenco prima di riprovare.');
  const remote={document,path,sha:saved.content.sha};await bindGitHubDocument(localId,remote,c);return remote;
}
