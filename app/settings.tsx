'use client';
import type { Dispatch, SetStateAction } from 'react';
import { ChevronRight, GitBranch, KeyRound, Monitor, Moon, PenLine, Settings2, ShieldCheck, SlidersHorizontal, Sun, X } from 'lucide-react';
import { ALL_PROVIDERS as PROVIDERS, DEVICE_PROVIDERS, DEVICE_CONNECTION_HELP, isDeviceProfile, isDeviceProvider, type AiProvider as Provider } from '../lib/device-models';
import { DEFAULT_WRITING_RULES, QUOTE_STYLES, RULES_MAX, writingRulesInstruction, type QuoteStyle, type WritingRules } from '../lib/writing-rules';
import { githubConnected, githubSettings } from '../lib/github-documents';
import { ModelPicker } from './model-picker';
import { TokenStats } from './token-stats';
import { GitHubConnection } from './github-documents';
import type { AiPreferences } from '../lib/ai-preferences';

export type SettingsTab = 'ai' | 'github' | 'rules' | 'general';
export type Profile = {id:string;name:string;provider:Provider;model:string;baseUrl?:string;hint:string;daily_limit:number;used:number};
export type ProfileForm = {id:string;name:string;provider:Provider;model:string;key:string;baseUrl:string;dailyLimit:number};
export type Theme = 'light' | 'dark' | 'system';
export const EMPTY_PROFILE_FORM: ProfileForm = {id:'',name:'',provider:'openai',model:PROVIDERS.openai.model,key:'',baseUrl:'',dailyLimit:500};

const TABS: {id:SettingsTab;label:string;hint:string;icon:typeof KeyRound}[] = [
  {id:'ai',label:'Provider AI',hint:'Account, chiavi API e consumi',icon:KeyRound},
  {id:'github',label:'GitHub',hint:'Salvataggio e sincronizzazione',icon:GitBranch},
  {id:'rules',label:'Regole di scrittura',hint:'Preferenze valide per ogni risposta',icon:PenLine},
  {id:'general',label:'Aspetto ed editor',hint:'Tema, pagine, suggerimenti',icon:SlidersHorizontal},
];

type ProviderProps = {local:boolean;owner:string;profiles:Profile[];vaultReady:boolean;error:string;form:ProfileForm;setForm:Dispatch<SetStateAction<ProfileForm>>;formBusy:boolean;onSave:()=>void;onRemove:(p:Profile)=>void};
type GitHubProps = {busy:boolean;loaded:boolean;onSaveNow:()=>void;onOpenDocuments:()=>void};
type RulesProps = {rules:WritingRules;onChange:(rules:WritingRules)=>void};
type GeneralProps = {theme:Theme;setTheme:(t:Theme)=>void;pages:number;pageViews:number[];setPages:(n:number)=>void;pagesAvailable:boolean;delay:number;setDelay:(n:number)=>void;aiOn:boolean;setAiOn:(on:boolean)=>void;narrow:boolean;simple:boolean;setSimple:(on:boolean)=>void;aiPreferences:AiPreferences;setAiPreferences:(p:AiPreferences)=>void};

export function SettingsModal({tab,setTab,onClose,provider,github,rules,general}:{tab:SettingsTab;setTab:(t:SettingsTab)=>void;onClose:()=>void;provider:ProviderProps;github:GitHubProps;rules:RulesProps;general:GeneralProps}) {
  return <div className="modal-backdrop" onClick={onClose}><section className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Impostazioni" onClick={e=>e.stopPropagation()}>
    <button className="modal-close tool" aria-label="Chiudi impostazioni" onClick={onClose}><X size={20}/></button>
    <div className="settings-head"><span className="modal-icon"><Settings2 size={23}/></span><div><h2>Impostazioni</h2><p className="modal-subtitle">Tutto in un unico posto: AI, salvataggio, regole e aspetto.</p></div></div>
    <nav className="settings-tabs" role="tablist" aria-label="Sezioni delle impostazioni">{TABS.map(t=><button key={t.id} role="tab" type="button" aria-selected={tab===t.id} className={tab===t.id?'active':''} onClick={()=>setTab(t.id)}><t.icon size={16}/><span>{t.label}<small>{t.hint}</small></span></button>)}</nav>
    <div className="settings-panel" role="tabpanel">
      {tab==='ai'&&<ProviderSettings {...provider}/>}
      {tab==='github'&&<GitHubSettingsPanel {...github}/>}
      {tab==='rules'&&<RulesSettings {...rules}/>}
      {tab==='general'&&<GeneralSettings {...general}/>}
    </div>
    <div className="form-footer"><span className="form-note">Le modifiche si salvano subito su questo dispositivo.</span><button type="button" className="quiet" onClick={onClose}>Chiudi</button></div>
  </section></div>;
}

function ProviderSettings({local,owner,profiles,vaultReady,error,form,setForm,formBusy,onSave,onRemove}:ProviderProps) {
  return <>
    <h3>Provider e chiavi API</h3><p className="form-note">Collega più account e scegli il modello adatto a ogni testo.</p>
    <div className="security-note"><ShieldCheck size={18}/><span>{local?'Versione statica: le chiavi restano solo in questo browser (localStorage) e il testo va direttamente al provider. Usa un dispositivo personale e chiavi con limiti di spesa.':'Provider cloud: chiavi cifrate sul server. Ollama e LM Studio: profili e token restano su questo dispositivo, nel browser o nel portachiavi dell’app desktop.'}</span></div>
    {!vaultReady&&<p className="warning">Il server non ha ancora una chiave di cifratura configurata.</p>}{error&&<p role="alert" className="warning">{error}</p>}
    <div className="profile-list">{profiles.map(p=><div className="profile-row" key={p.id}><span className={'provider-badge '+p.provider}>{PROVIDERS[p.provider].name.slice(0,1)}</span><div><strong>{p.name}</strong><small>{PROVIDERS[p.provider].name} · {p.model} · {isDeviceProvider(p.provider)?'Su questo dispositivo':<>••••{p.hint}</>}</small><small>{p.used} / {p.daily_limit} richieste oggi (UTC)</small></div><button data-tip="Cambia nome, modello, limite o chiave di questo profilo" onClick={()=>setForm({id:p.id,name:p.name,provider:p.provider,model:p.model,key:'',baseUrl:p.baseUrl||'',dailyLimit:p.daily_limit})}>Modifica</button><button aria-label={'Rimuovi '+p.name} data-tip="Elimina questo profilo e la sua chiave" onClick={()=>onRemove(p)}><X size={16}/></button></div>)}</div>
    <TokenStats owner={owner}/>
    <form onSubmit={e=>{e.preventDefault();onSave();}}><h3>{form.id?'Modifica profilo':'Aggiungi un profilo'}</h3><div className="form-grid"><label>Nome del profilo<input required maxLength={80} placeholder="Es. Account personale" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Provider<select value={form.provider} onChange={e=>{const p=e.target.value as Provider;setForm({...form,id:isDeviceProfile(form.id)!==isDeviceProvider(p)?'':form.id,provider:p,model:PROVIDERS[p].model,key:'',baseUrl:isDeviceProvider(p)?DEVICE_PROVIDERS[p].baseUrl:''});}}>{Object.entries(PROVIDERS).map(([id,p])=><option key={id} value={id}>{p.name}</option>)}</select></label>{isDeviceProvider(form.provider)&&<label>Indirizzo del server locale<input required type="url" value={form.baseUrl} placeholder={DEVICE_PROVIDERS[form.provider].baseUrl} onChange={e=>setForm({...form,baseUrl:e.target.value})}/></label>}<ModelPicker key={form.provider+':'+form.baseUrl+':'+form.id} provider={form.provider} model={form.model} baseUrl={form.baseUrl} token={form.key} profileId={form.id} onChange={model=>setForm(current=>({...current,model}))}/><label>Limite richieste al giorno<input type="number" min={1} max={10000} required value={form.dailyLimit} onChange={e=>setForm({...form,dailyLimit:+e.target.value})}/></label></div><label>{isDeviceProvider(form.provider)?'Token del server locale (facoltativo)':'Chiave API'} {form.id&&<small>(lascia vuoto per mantenerla)</small>}<input autoComplete="off" type="password" required={!form.id&&!isDeviceProvider(form.provider)} maxLength={4096} placeholder={isDeviceProvider(form.provider)?'Solo se il server richiede autenticazione':'Incolla la chiave del provider'} value={form.key} onChange={e=>setForm({...form,key:e.target.value})}/></label><p className="form-note">{isDeviceProvider(form.provider)?<>Il modello e il profilo restano su questo dispositivo. {DEVICE_CONNECTION_HELP}</>:<>Le richieste usano il credito del tuo account provider. Il limite conta i tentativi, anche quelli interrotti; non è un tetto di spesa in euro. Puoi modificare liberamente l’identificativo del modello; la disponibilità dipende dal tuo account provider.</>}</p>
      <div className="settings-actions">{form.id&&<button type="button" className="quiet" onClick={()=>setForm(EMPTY_PROFILE_FORM)}>Annulla modifica</button>}<button className="primary" disabled={formBusy||(!vaultReady&&!isDeviceProvider(form.provider))} type="submit">{formBusy?'Salvataggio…':form.id?'Salva modifiche':'Collega provider'}<ChevronRight size={16}/></button></div></form>
  </>;
}

function GitHubSettingsPanel({busy,loaded,onSaveNow,onOpenDocuments}:GitHubProps) {
  const connected=githubConnected(),saved=githubSettings();
  return <>
    <h3>Salvataggio su GitHub</h3><p className="form-note">Salva i documenti in un repository GitHub e ritrovali su ogni dispositivo collegando lo stesso repository e ramo.</p>
    <div className={connected?'security-note':'warning'}><GitBranch size={18}/><span>{connected?<>Collegato a <strong>{saved.repository}</strong>, ramo <strong>{saved.branch}</strong>.</>:'GitHub non è collegato su questo dispositivo.'}</span></div>
    <GitHubConnection busy={busy}/>
    <h3>Documenti</h3>
    <div className="settings-actions start"><button type="button" className="primary" disabled={busy||!loaded} onClick={onSaveNow}>Salva il documento aperto</button><button type="button" className="quiet" disabled={busy||!loaded} onClick={onOpenDocuments}>Apri documenti da GitHub</button></div>
  </>;
}

function RulesSettings({rules,onChange}:RulesProps) {
  const set=(patch:Partial<WritingRules>)=>onChange({...rules,...patch});
  const instruction=writingRulesInstruction(rules);
  const toggles:[keyof WritingRules,string,string][]=[
    ['noEmDash','Niente lineetta lunga (—)','Sostituita da virgole o frasi separate; anche quella dei dialoghi viene tolta'],
    ['noEnDash','Niente trattino medio (–)','Negli intervalli di numeri diventa un trattino normale (10-20)'],
    ['noEllipsisChar','Puntini come tre punti (...)','Al posto del carattere unico …'],
    ['noEmoji','Niente emoji','Le emoji vengono rimosse dalle proposte'],
  ];
  return <>
    <h3>Regole generali</h3><p className="form-note">Valgono per ogni richiesta all’AI: completamenti, riscritture, scene, direzioni e risposte. Sono aggiunte al system prompt e i caratteri esclusi vengono tolti anche dalle proposte prima che tu le veda.</p>
    <div className="rule-list">{toggles.map(([key,label,hint])=><label key={key} className="rule-toggle"><input type="checkbox" checked={rules[key] as boolean} onChange={e=>set({[key]:e.target.checked})}/><span>{label}<small>{hint}</small></span></label>)}</div>
    <label>Virgolette per dialoghi e citazioni<select value={rules.quotes} onChange={e=>set({quotes:e.target.value as QuoteStyle})}>{QUOTE_STYLES.map(q=><option key={q.id} value={q.id}>{q.label}</option>)}</select></label>
    <label>Parole o caratteri da evitare <small>(uno per riga)</small><textarea rows={3} maxLength={RULES_MAX.avoid} placeholder={'inoltre\nassolutamente\n;'} value={rules.avoid} onChange={e=>set({avoid:e.target.value})}/></label>
    <label>Istruzioni personali (system prompt) <small>{rules.custom.length}/{RULES_MAX.custom}</small><textarea rows={6} maxLength={RULES_MAX.custom} placeholder={'Esempi:\nScrivi frasi brevi e concrete.\nUsa la seconda persona singolare.\nNon iniziare mai una frase con «Inoltre».\nPreferisci l’italiano corrente ai termini inglesi.'} value={rules.custom} onChange={e=>set({custom:e.target.value})}/></label>
    <details className="rules-preview"><summary>Vedi il testo inviato all’AI</summary><p>{instruction||'Nessuna regola attiva.'}</p></details>
    <div className="settings-actions start"><button type="button" className="quiet" onClick={()=>{if(window.confirm('Ripristinare le regole predefinite? Le istruzioni personali verranno cancellate.'))onChange({...DEFAULT_WRITING_RULES});}}>Ripristina predefinite</button></div>
  </>;
}

function GeneralSettings({theme,setTheme,pages,pageViews,setPages,pagesAvailable,delay,setDelay,aiOn,setAiOn,narrow,simple,setSimple,aiPreferences,setAiPreferences}:GeneralProps) {
  const themes:[Theme,string,typeof Sun][]=[['light','Chiaro',Sun],['dark','Scuro',Moon],['system','Di sistema',Monitor]];
  return <>
    <h3>Aspetto</h3>
    <p className="form-note">Il documento si salva dopo le modifiche, con un ulteriore salvataggio automatico di documento e progetto ogni 5 minuti.</p>
    <div className="segmented settings-segmented" role="radiogroup" aria-label="Tema">{themes.map(([id,label,Icon])=><button key={id} type="button" role="radio" aria-checked={theme===id} className={theme===id?'active':''} onClick={()=>setTheme(id)}><Icon size={14}/>{label}</button>)}</div>
    {pagesAvailable&&<label>Vista del documento<select value={pages} onChange={e=>setPages(+e.target.value)}>{pageViews.map(n=><option key={n} value={n}>{n?n===1?'1 pagina A4':n+' pagine A4 affiancate':'Vista continua'}</option>)}</select></label>}
    {narrow&&<label className="rule-toggle"><input type="checkbox" checked={simple} onChange={e=>setSimple(e.target.checked)}/><span>Modalità semplice per telefono<small>Barra degli strumenti in basso e pannelli a scomparsa</small></span></label>}
    <h3>Suggerimenti mentre scrivi</h3>
    <label>Quando avviare l’AI<select aria-label="Quando avviare l’AI" value={aiPreferences.trigger} onChange={e=>setAiPreferences({...aiPreferences,trigger:e.target.value as AiPreferences['trigger']})}><option value="pause">Automaticamente dopo una pausa</option><option value="tab">Solo quando premo Tab</option></select></label>
    {aiPreferences.trigger==='tab'?<p className="form-note">In scrittura assistita, premi Tab nell’editor per chiedere un completamento o «Migliora frase». Premi di nuovo Tab per accettare la proposta pronta. Shift+Tab mantiene la navigazione normale. Sul telefono puoi usare «Chiedi ora».</p>:<>
      <label className="rule-toggle"><input type="checkbox" checked={aiOn} onChange={e=>setAiOn(e.target.checked)}/><span>Suggerimenti automatici<small>Propone la continuazione o una frase migliore dopo una breve pausa</small></span></label>
      <label>Pausa prima del suggerimento: <strong>{delay} ms</strong><input aria-label="Pausa suggerimenti" type="range" min="400" max="1600" step="100" value={delay} onChange={e=>setDelay(+e.target.value)}/></label>
      <p className="form-note">Una pausa più lunga riduce le richieste al provider.</p>
    </>}
    <label className="rule-toggle"><input type="checkbox" checked={aiPreferences.formatting} onChange={e=>setAiPreferences({...aiPreferences,formatting:e.target.checked})}/><span>Sistema anche la formattazione<small>Nei completamenti e in «Migliora frase», l’AI sceglie titoli, paragrafi, elenchi, grassetti e corsivi in base al significato e all’importanza del passaggio. Li vedi nell’anteprima prima di accettare.</small></span></label>
  </>;
}
