'use client';
import { useEffect, useState } from 'react';
import { X, GitBranch, RefreshCw } from 'lucide-react';
import { connectGitHub, disconnectGitHub, githubConnected, githubSettings, listGitHubDocuments, loadGitHubDocument, type RepositoryDocument } from '../lib/github-documents';

// Repository, branch and token: shown in Settings and, when GitHub is not linked yet, before saving or loading.
export function GitHubConnection({onConnected,onDisconnected,onChange,busy:outerBusy=false}:{onConnected?:()=>Promise<void>|void;onDisconnected?:()=>void;onChange?:()=>void;busy?:boolean}) {
  const [form,setForm]=useState(githubSettings),[token,setToken]=useState(''),[connected,setConnected]=useState(githubConnected);
  const [visibility,setVisibility]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function action(work:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{await work();}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
  return <div className="github-connection" aria-busy={busy}>
    <form onSubmit={e=>{e.preventDefault();void action(async()=>{const info=await connectGitHub(form,token);setToken('');setConnected(true);setVisibility(info.private);setMessage('GitHub collegato.');await onConnected?.();});}}>
      <fieldset disabled={busy||outerBusy}><div className="form-grid"><label>Repository<input aria-label="Repository GitHub" required placeholder="proprietario/repository" value={form.repository} onChange={e=>{setForm({...form,repository:e.target.value.trim()});setVisibility(null);onChange?.();}}/></label><label>Ramo<input aria-label="Ramo GitHub" required value={form.branch} onChange={e=>{setForm({...form,branch:e.target.value});onChange?.();}}/></label></div>
      <label>Token GitHub<input aria-label="Token GitHub" type="password" autoComplete="off" value={token} placeholder={connected?'Lascia vuoto per mantenere la connessione':'Token con accesso a questo repository'} onChange={e=>setToken(e.target.value)}/></label>
      <p className="form-note">Crea un <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">token GitHub con accesso al solo repository scelto</a> e permesso <strong>Contents: Read and write</strong>. Il token viene inviato soltanto a GitHub, mai salvato nei documenti.</p>
      <label className="github-remember"><input type="checkbox" checked={form.remember} onChange={e=>setForm({...form,remember:e.target.checked})}/>Ricorda il token su questo dispositivo</label>
      <p className="form-note">Se lo ricordi, il token resta nel browser o nel portachiavi dell’app desktop; altrimenti dura fino alla chiusura o al ricaricamento della pagina.</p>
      <div className="github-connection-actions"><button className="primary" type="submit">{busy?'Operazione in corso…':connected?'Aggiorna collegamento':'Collega GitHub'}</button>{connected&&<button type="button" className="quiet" onClick={()=>{disconnectGitHub();setToken('');setConnected(false);setMessage('Token rimosso da questo dispositivo.');onDisconnected?.();}}>Scollega</button>}</div></fieldset>
    </form>
    {visibility!==null&&<p className={visibility?'security-note':'warning'}>{visibility?'Repository privato: i documenti sono visibili a chi ha accesso.':'Repository pubblico: chiunque potrà leggere i documenti salvati. Per testi privati scegli un repository privato.'}</p>}
    {error&&<p className="warning" role="alert">{error}</p>}{message&&<p className="form-note" role="status">{message}</p>}
  </div>;
}

export function GitHubDocuments({intent,onSave,onLoad,onClose}:{intent:'save'|'load';onSave:(copy:boolean)=>Promise<void>;onLoad:(document:RepositoryDocument)=>Promise<void>;onClose:()=>void}) {
  const [connected,setConnected]=useState(githubConnected),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [documents,setDocuments]=useState<RepositoryDocument[]|null>(null),[search,setSearch]=useState('');
  async function action(work:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{await work();}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
  async function refresh(){setDocuments(await listGitHubDocuments());}
  useEffect(()=>{if(githubConnected())void action(refresh);},[]);
  function close(){if(!busy)onClose();}
  return <div className="modal-backdrop" onClick={close}><section className="modal github-modal" role="dialog" aria-modal="true" aria-label="Documenti su GitHub" aria-busy={busy} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}>
    <button className="modal-close tool" aria-label="Chiudi GitHub" disabled={busy} onClick={close}><X size={20}/></button>
    <span className="modal-icon"><GitBranch size={24}/></span><h2>I documenti, su ogni dispositivo.</h2>
    <p className="modal-subtitle">{connected?<>Collegato a <strong>{githubSettings().repository}</strong>, ramo <strong>{githubSettings().branch}</strong>. Repository e token si gestiscono in Impostazioni › GitHub.</>:'Salva su GitHub, poi collega lo stesso repository e ramo sugli altri dispositivi e carica il documento.'}</p>
    {!connected&&<GitHubConnection busy={busy} onConnected={async()=>{setConnected(true);await action(refresh);}} onChange={()=>setDocuments(null)}/>}
    {error&&<p className="warning" role="alert">{error}</p>}{message&&<p className="form-note" role="status">{message}</p>}
    {connected&&<><h3>{intent==='save'?'Salva il documento aperto':'Apri un documento dal repository'}</h3><p className="form-note">Ogni salvataggio crea una versione su GitHub. Il ramo indicato viene creato al primo salvataggio, se manca. Testo, formattazione e progetto creativo sono inclusi; le chiavi API sono escluse.</p>
      <div className="github-connection-actions"><button type="button" className="primary" disabled={busy} onClick={()=>void action(async()=>{await onSave(false);setMessage('Documento salvato su GitHub.');await refresh();})}>Salva su GitHub</button><button type="button" className="quiet" disabled={busy} onClick={()=>void action(async()=>{await onSave(true);setMessage('Copia salvata su GitHub.');await refresh();})}>Salva una copia</button></div>
      <h3>Documenti su GitHub</h3><button className="quiet" type="button" disabled={busy} onClick={()=>void action(refresh)}><RefreshCw size={14}/>Aggiorna elenco</button>
      {documents&&documents.length>0&&<label>Cerca documento<input value={search} onChange={e=>setSearch(e.target.value)}/></label>}
      <div className="github-document-list">{documents?.filter(d=>d.document.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(d=><div className="revision-row" key={d.path}><div><strong>{d.document.title}</strong><small>{new Date(d.document.updated).toLocaleString('it-IT')}</small></div><button disabled={busy} onClick={()=>void action(async()=>{await onLoad(await loadGitHubDocument(d.path));onClose();})}>Carica</button></div>)}</div>
      {documents?.length===0&&<p className="empty-state">Nessun documento in questo ramo. Salva il primo documento da uno dei dispositivi.</p>}
    </>}
    <div className="form-footer"><button className="quiet" disabled={busy} onClick={close}>Chiudi</button></div>
  </section></div>;
}
