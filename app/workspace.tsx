'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import { Ghost, ghostKey } from '../lib/ghost';
import { AiGovernor, sameText, sentenceTarget, wordDiff } from '../lib/ai-governor';
import { PROVIDERS, splitWarning, type Provider } from '../lib/providers';
import { localApi, localAssist } from '../lib/local-backend';
import { blocksFromDoc, chapters, describeFingerprint, detectIntent, locate, fingerprint, memorySummary, wordsOf, styleSimilarity, INTENTS, type DetectedIntent, type Fingerprint } from '../lib/narrative';
import { voiceInstruction } from '../lib/author-styles';
import { onInstallAvailable, promptInstall, setupPwa } from '../lib/pwa';
import { EMPTY_PROJECT, briefText, type Project } from '../lib/project';
import { Directions, FreeCard, IntentRow, isMode, ModeSwitch, ProjectChip, ProjectModal, Review, type Ctx, type Mode, type Run } from './companion';
import { ArrowDownToLine, AlignCenter, AlignLeft, AlignRight, Bold, Check, ChevronDown, ChevronRight, Clock3, Download, FileText, GitBranch, Drama, PenLine, Highlighter, ImagePlus, Italic, KeyRound, Link2, List, ListOrdered, Maximize2, Monitor, Moon, PanelLeftClose, Plus, Redo2, Search, Settings2, ShieldCheck, Sparkles, Sun, Table2, TriangleAlert, Underline, Undo2, WandSparkles, X } from 'lucide-react';

type Doc = {id:string; title:string; updated:number; version:number};
type Profile = {id:string;name:string;provider:Provider;model:string;hint:string;daily_limit:number;used:number};
// base/para: paragraph text and start for completions; original: the text a rewrite would replace;
// trail: whitespace between the rewritten sentence and the cursor, kept after accepting.
type Suggestion = {text:string;from:number;to:number;revision:number;mode:string;done:boolean;base?:string;para?:number;original?:string;cached?:boolean;trail?:number};
type Revision = {id:string;title:string;content:string;created:number};
const EMPTY = {type:'doc',content:[{type:'paragraph'}]};
const WELCOME = {type:'doc',content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:'Spazio alle tue idee.'}]},{type:'paragraph',content:[{type:'text',text:'Ogni grande testo comincia con un pensiero. Scrivilo qui: alle parole successive ci pensiamo insieme.'}]},{type:'heading',attrs:{level:2},content:[{type:'text',text:'La tua voce, con una marcia in più'}]},{type:'paragraph',content:[{type:'text',text:'Collega il tuo provider AI dal pannello a destra e inizia a scrivere. Scrivia suggerisce come completare la frase, oppure la rende più chiara mentre prende forma.'}]},{type:'paragraph',content:[{type:'text',text:'Premi Tab per accettare una proposta, Esc per lasciarla andare. Le tue parole restano sempre una tua scelta.',marks:[{type:'italic'}]}]}]};
// The static GitHub Pages build sets this flag: storage and AI calls then stay in the browser.
const LOCAL=typeof window!=='undefined'&&window.__SCRIVIA_LOCAL__===true;
type Theme='light'|'dark'|'system';
const THEMES:Theme[]=['light','dark','system'];
function readMode():Mode{try{const m=localStorage.getItem('scrivia:mode');return isMode(m)?m:'assistita';}catch{return 'assistita';}}
const EMPTY_FP=fingerprint('');
const SUGGESTION_TITLES:Record<string,string>={complete:'Continuazione proposta',continue:'Scena proposta',voice:'Riscrittura nella voce scelta'};
function readTheme():Theme{try{const t=localStorage.getItem('scrivia:theme');return THEMES.includes(t as Theme)?t as Theme:'system';}catch{return 'system';}}
async function api(path:string,body?:unknown,method='POST'):Promise<any> { if(LOCAL)return localApi(path,body,method); const res=await fetch('/api/'+path,body===undefined?undefined:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const data:any=await res.json(); if(!res.ok) throw new Error(data.error||'Operazione non riuscita.'); return data; }
const date=(n:number)=>new Date(n).toLocaleDateString('it-IT',{day:'numeric',month:'short'});
// Paragraph text before the cursor; leaf nodes (line breaks) count as one character, so offsets map to positions.
const beforeCursor=($from:Editor['state']['selection']['$from'])=>$from.parent.textBetween(0,$from.parentOffset,'\n','\n');
function download(blob:Blob,name:string) { const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }

export default function Workspace() {
  const [docs,setDocs]=useState<Doc[]>([]),[active,setActive]=useState(''),[title,setTitle]=useState('Senza titolo'),[loaded,setLoaded]=useState(false);
  const [profiles,setProfiles]=useState<Profile[]>([]),[profile,setProfile]=useState(''),[vaultReady,setVaultReady]=useState(false);
  const [settings,setSettings]=useState(false),[history,setHistory]=useState<Revision[]|null>(null),[menu,setMenu]=useState(false),[focus,setFocus]=useState(false),[sidebar,setSidebar]=useState(true),[mobileAI,setMobileAI]=useState(false);
  const [search,setSearch]=useState(''),[find,setFind]=useState(''),[replace,setReplace]=useState(''),[showFind,setShowFind]=useState(false);
  const [status,setStatus]=useState('Caricamento…'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[words,setWords]=useState(0),[characters,setCharacters]=useState(0);
  const [aiOn,setAiOn]=useState(true),[autoMode,setAutoMode]=useState('complete'),[tone]=useState('Naturale'),[delay,setDelay]=useState(700);
  const [mode,setMode]=useState<Mode>('assistita'),[intentChoice,setIntentChoice]=useState('auto'),[detected,setDetected]=useState<DetectedIntent>(()=>detectIntent('')),[fp,setFp]=useState<Fingerprint>(EMPTY_FP),[coTab,setCoTab]=useState<'genera'|'direzioni'>('genera');
  const [project,setProjectState]=useState<Project>(EMPTY_PROJECT),[projectOpen,setProjectOpen]=useState(false);
  const [suggestion,setSuggestion]=useState<Suggestion|null>(null),[busy,setBusy]=useState(false),[aiError,setAiError]=useState(''),[aiWarning,setAiWarning]=useState('');
  const [theme,setTheme]=useState<Theme>('system'),[installable,setInstallable]=useState(false);
  const [form,setForm]=useState({id:'',name:'',provider:'openai' as Provider,model:PROVIDERS.openai.model as string,key:'',dailyLimit:500}),[formBusy,setFormBusy]=useState(false);
  const editorRef=useRef<Editor|null>(null),revision=useRef(0),pending=useRef<AbortController|null>(null),aiTimer=useRef<ReturnType<typeof setTimeout>|null>(null),saveTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const current=useRef<{id:string;version:number;title:string}>({id:'',version:0,title:'Senza titolo'}),dirty=useRef(false),saving=useRef<Promise<boolean>|null>(null),selection=useRef<Suggestion|null>(null),suppress=useRef(false),settled=useRef<{para:number;text:string}|null>(null);
  const options=useRef({profile,aiOn,autoMode,tone,delay,mode});options.current={profile,aiOn,autoMode,tone,delay,mode};
  const projectRef=useRef(project),projectDoc=useRef(''),projectDirty=useRef(false),projectTimer=useRef<ReturnType<typeof setTimeout>|null>(null),fpTimer=useRef<ReturnType<typeof setTimeout>|null>(null);projectRef.current=project;
  // What the model needs to know about the work: voice, scene intent, project and story memory.
  const narrative=useMemo<Ctx>(()=>{const chosen=INTENTS.find(i=>i.id===intentChoice);
    const intent=intentChoice!=='auto'&&chosen?`${chosen.name}: ${chosen.tone} (chosen by the author)`:detected.confidence>0?`probably ${detected.name.toLowerCase()} (${detected.tone}); cues: ${detected.cues.join(', ')}. Verify against the context.`:'';
    return {style:voiceInstruction(project.voice.id,project.voice.intensity,project.voice.custom,describeFingerprint(fp)),intent,brief:briefText(project.brief),memory:memorySummary(project.facts)};},[project,fp,detected,intentChoice]);
  const narrativeRef=useRef(narrative);narrativeRef.current=narrative;
  const [governor]=useState(()=>new AiGovernor());
  const callbacks=useRef({update:()=>{},selection:(()=>{}) as (typing:boolean)=>void,accept:():boolean=>false,cancel:()=>{}});
  const proposalDiff=useMemo(()=>suggestion?.done&&suggestion.original!==undefined?wordDiff(suggestion.original,suggestion.text):null,[suggestion]);
  const proposalVoice=useMemo(()=>{if(!suggestion?.done||fp.words<150||wordsOf(suggestion.text).length<25)return null;return styleSimilarity(fp,fingerprint(suggestion.text));},[suggestion,fp]);
  const editor=useEditor({immediatelyRender:false,shouldRerenderOnTransaction:true,
    extensions:[StarterKit.configure({link:{openOnClick:false}}),TextStyleKit,TableKit.configure({table:{resizable:true}}),TextAlign.configure({types:['heading','paragraph']}),Image.configure({allowBase64:true}),Highlight.configure({multicolor:true}),Placeholder.configure({placeholder:'Un pensiero, una frase… inizia a scrivere.'}),Ghost],
    content:EMPTY,editorProps:{attributes:{class:'manuscript',role:'textbox','aria-label':'Contenuto del documento',spellcheck:'true'},handleKeyDown:(_view,event)=>{
      if(event.key==='Tab' && callbacks.current.accept()){event.preventDefault();return true;}
      if(event.key==='Escape'){callbacks.current.cancel();return false;}
      return false;
    }},onUpdate:()=>callbacks.current.update(),onSelectionUpdate:({transaction})=>callbacks.current.selection(transaction.docChanged),
  }); editorRef.current=editor;

  function clearSuggestion() { if(aiTimer.current)clearTimeout(aiTimer.current);pending.current?.abort();pending.current=null;selection.current=null;setSuggestion(null);setBusy(false);const e=editorRef.current;if(e&&!e.isDestroyed)e.view.dispatch(e.state.tr.setMeta(ghostKey,null)); }
  function showSuggestion(s:Suggestion|null) { selection.current=s;setSuggestion(s);const e=editorRef.current;if(e&&!e.isDestroyed)e.view.dispatch(e.state.tr.setMeta(ghostKey,s?{kind:s.mode==='complete'||s.mode==='continue'?'complete':'replace',from:s.from,to:s.to,text:s.text,done:s.done}:null)); }
  // Typing the first characters of a completion keeps the rest on screen instead of asking again.
  function continued():Suggestion|null { const s=selection.current,e=editorRef.current;if(!s||!e||s.mode!=='complete'||!s.done||s.base===undefined||!e.state.selection.empty)return null;
    const {$from}=e.state.selection;if($from.start()!==s.para)return null;const now=beforeCursor($from);if(!now.startsWith(s.base))return null;
    // A space typed before a proposal that starts with a word keeps it: the space was implied.
    const typed=now.slice(s.base.length),text=/^\s/.test(typed)&&!/^\s/.test(s.text)?' '+s.text:s.text;if(!typed||!text.startsWith(typed)||text.length<=typed.length)return null;
    return {...s,text:text.slice(typed.length),from:$from.pos,to:$from.pos,base:now}; }
  function acceptSuggestion() { const s=selection.current,e=editorRef.current;if(!s||!s.done||!e||s.revision!==revision.current)return false;
    clearSuggestion(); e.chain().focus().insertContentAt({from:s.from,to:s.to},s.text.split('\n').flatMap((line,i)=>[...(i?[{type:'hardBreak'}]:[]),...(line?[{type:'text',text:line}]:[])])).run();
    // An improved sentence is settled: automatic rewrites move on to the next one instead of improving it again.
    if(s.mode==='rewrite'){const {$from}=e.state.selection;settled.current={para:$from.start(),text:beforeCursor($from)};}
    if(s.trail)e.commands.setTextSelection(Math.min(e.state.selection.to+s.trail,e.state.selection.$to.end()));return true; }

  const save=useCallback(async():Promise<boolean>=>{
    if(saving.current)return saving.current;
    const job=(async()=>{while(dirty.current){const e=editorRef.current;if(!e)return false;const rev=revision.current;const payload={...current.current,content:e.getJSON()};setStatus('Salvataggio…');
      try{const result=await api('documents',payload);current.current={...current.current,id:result.id,version:result.version};setActive(result.id);
        setDocs(old=>[{id:result.id,title:payload.title,updated:result.updated,version:result.version},...old.filter(d=>d.id!==result.id)]);
        if(rev===revision.current)dirty.current=false;setStatus(dirty.current?'Salvataggio…':'Tutte le modifiche salvate');setError('');
      }catch(err){setStatus('Non salvato');setError((err as Error).message);return false;}}
      return true;})();saving.current=job;try{return await job;}finally{saving.current=null;}
  },[]);
  function markDirty(){dirty.current=true;revision.current++;setStatus('Modifiche da salvare');if(saveTimer.current)clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>void save(),900);}

  // Streams an /api/assist answer. onText sees the growing answer and may return false to stop.
  // Returns null when stopped; rate limits and provider/network failures pause automatic requests.
  async function streamAssist(payload:Record<string,unknown>,signal:AbortSignal,onText?:(answer:string)=>boolean|void):Promise<string|null> {
    const penalize=(rateLimited:boolean)=>` Suggerimenti automatici in pausa per ${Math.round(governor.failed(rateLimited)/1000)} s.`;
    let res:Response;
    try{res=LOCAL?await localAssist(payload,signal):await fetch('/api/assist',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify(payload)});}
    catch(err){if(signal.aborted)throw err;throw new Error('Connessione non riuscita.'+penalize(false));}
    if(!res.ok){const b:any=await res.json().catch(()=>({}));const msg=b.error||'Provider non disponibile.';throw new Error(res.status===429||res.status>=500?msg+penalize(res.status===429):msg);}
    if(!res.body)throw new Error('Risposta vuota.');const reader=res.body.getReader();const decoder=new TextDecoder();let buffer='',answer='',complete=false;
    while(true){const {value,done}=await reader.read();if(signal.aborted){await reader.cancel();throw new DOMException('Richiesta annullata.','AbortError');}if(done)break;buffer+=decoder.decode(value,{stream:true});let i:number;
      while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;const data=JSON.parse(line);if(data.error)throw new Error(data.error+penalize(false));if(data.done)complete=true;if(data.text)answer+=data.text;
        if(onText&&onText(answer)===false){await reader.cancel();return null;}}
    }
    if(!complete||!answer.trim())throw new Error('Nessuna risposta ricevuta. Riprova.');
    governor.succeeded();setProfiles(old=>old.map(p=>p.id===payload.profile?{...p,used:p.used+1}:p));return answer;
  }
  // Analyses requested from the companion panel: always manual, never shown as ghost text.
  const run:Run=async(mode,fields,signal)=>{const opts=options.current;if(!opts.profile){setSettings(true);throw new Error('Collega un provider AI per usare questa funzione.');}
    const wait=governor.wait(false);if(wait>0)throw new Error(`Pausa per rispettare i limiti del provider: riprova tra ${Math.ceil(wait/1000)} s.`);
    governor.started();const answer=await streamAssist({profile:opts.profile,mode,tone:opts.tone,...fields},signal);if(answer===null)throw new DOMException('Richiesta annullata.','AbortError');return answer;};

  async function ask(mode:string,automatic=false,direction='') { const e=editorRef.current;if(!e)return;const opts=options.current;if(!opts.profile){if(!automatic)setSettings(true);return;}
    clearSuggestion();setAiError('');setAiWarning('');const {from,to,$from}=e.state.selection;
    if(automatic&&!e.state.selection.empty)return;
    // No proposal is drawn inside an IME composition (mobile keyboards): try again once it is over.
    if(automatic&&e.view.composing){aiTimer.current=setTimeout(()=>void ask(mode,true),opts.delay);return;}
    const inline=mode==='complete'||mode==='continue',para=$from.start();
    // Automatic improvements work on the sentence being written, never on text already accepted.
    const sentence=automatic&&mode==='rewrite'?sentenceTarget(beforeCursor($from),settled.current?.para===para?settled.current.text:''):null;
    const start=sentence?para+sentence.start:inline?from:(from===to?para:from);
    // A voice rewrite without selection takes the whole paragraph, so the voice applies to a full unit.
    const end=sentence?para+sentence.end:inline?from:mode==='voice'&&from===to?$from.end():to;
    const text=sentence?beforeCursor($from).slice(sentence.start,sentence.end):mode==='complete'?beforeCursor($from):mode==='continue'?e.state.doc.textBetween(Math.max(0,from-2000),from,'\n'):e.state.doc.textBetween(start,end,'\n');
    if(text.trim().length<(mode==='continue'?20:3)){if(!automatic)setAiError(mode==='continue'?'Scrivi qualche frase: la scena continuerà dal cursore.':'Scrivi o seleziona almeno qualche parola.');return;}
    if(text.length>10000){setAiError('Seleziona un brano più breve (massimo 10.000 caratteri).');return;}
    const contextEnd=mode==='continue'?Math.max(0,from-2000):start,n=narrativeRef.current;
    const payload={profile:opts.profile,mode,text:text.slice(-10000),context:e.state.doc.textBetween(Math.max(0,contextEnd-6000),contextEnd,'\n'),after:e.state.doc.textBetween(to,Math.min(e.state.doc.content.size,to+1000),'\n'),tone:opts.tone,
      style:mode==='formal'?'':n.style,intent:mode==='formal'?'':n.intent,brief:n.brief,memory:mode==='complete'?n.memory.slice(0,1500):mode==='continue'||mode==='voice'?n.memory:'',direction};
    const rev=revision.current,scope=String(para),key=AiGovernor.key([payload]);
    const extra=mode==='complete'?{base:text,para}:mode==='continue'?{}:{original:text,trail:sentence?from-end:0};
    // A generated scene starting right after a word needs a separating space.
    const spaced=(a:string)=>mode==='continue'&&/\S$/.test(text)&&/^[\p{L}\p{N}«"“(]/u.test(a)?' '+a:a;
    // A problem reported by the model is shown as a warning, never as text to accept;
    // an automatic improvement that changes nothing is not shown either.
    const finish=(answer:string,cached:boolean)=>{if(automatic)governor.asked(mode,scope,text);const p=splitWarning(answer);setAiWarning(p.warning);
      if(!p.text.trim()||(automatic&&mode==='rewrite'&&sameText(p.text,text))){showSuggestion(null);return;}showSuggestion({text:spaced(p.text),from:start,to:end,revision:rev,mode,done:true,cached,...extra});};
    const hit=governor.cached(key);
    if(hit!==undefined){finish(hit,true);return;}
    if(automatic&&!governor.worthAsking(mode,scope,text))return;
    const wait=governor.wait(automatic);
    if(wait>0){if(automatic)aiTimer.current=setTimeout(()=>void ask(mode,true),wait);else setAiError(`Pausa per rispettare i limiti del provider: riprova tra ${Math.ceil(wait/1000)} s.`);return;}
    governor.started();const controller=new AbortController();pending.current=controller;setBusy(true);
    try{const answer=await streamAssist(payload,controller.signal,a=>{if(controller.signal.aborted||rev!==revision.current)return false;const p=splitWarning(a);if(p.warning)setAiWarning(p.warning);if(p.text)showSuggestion({text:spaced(p.text),from:start,to:end,revision:rev,mode,done:false,...extra});});
      if(answer===null)return;governor.remember(key,answer);
      if(!controller.signal.aborted&&rev===revision.current)finish(answer,false);
    }catch(err){if(!controller.signal.aborted){if(automatic)governor.asked(mode,scope,text);showSuggestion(null);setAiError((err as Error).message);}}
    finally{if(pending.current===controller){pending.current=null;setBusy(false);}}
  }
  // Local, free analyses: the scene intent follows the cursor, the fingerprint is refreshed after a pause.
  function analyseLocally(full=false){const e=editorRef.current;if(!e)return;const from=e.state.selection.from;const next=detectIntent(e.state.doc.textBetween(Math.max(0,from-1500),from,'\n'));
    setDetected(old=>old.id===next.id&&old.cues.join()===next.cues.join()?old:next);
    if(fpTimer.current)clearTimeout(fpTimer.current);fpTimer.current=setTimeout(()=>{const ed=editorRef.current;if(ed&&!ed.isDestroyed)setFp(fingerprint(ed.getText({blockSeparator:'\n'})));},full?0:2500);}
  callbacks.current={update:()=>{if(suppress.current||!loaded)return;const next=continued();if(!next)clearSuggestion();markDirty();const e=editorRef.current;setWords(e?.getText().trim().split(/\s+/).filter(Boolean).length||0);setCharacters(e?.getText().length||0);const opts=options.current;analyseLocally();
    if(next){showSuggestion({...next,revision:revision.current});return;}
    if(opts.mode==='assistita'&&opts.aiOn&&opts.profile)aiTimer.current=setTimeout(()=>void ask(opts.autoMode,true),opts.delay);
  },selection:(typing)=>{if(!typing)clearSuggestion();},accept:acceptSuggestion,cancel:clearSuggestion};

  // The creative project (brief, voice, story memory) is saved separately from the text, per document.
  const setProject=useCallback((update:(p:Project)=>Project)=>{projectDirty.current=true;setProjectState(p=>update(p));},[]);
  const saveProject=useCallback(async()=>{if(projectTimer.current)clearTimeout(projectTimer.current);if(!projectDirty.current||!projectDoc.current)return;projectDirty.current=false;
    try{await api('projects',{document:projectDoc.current,data:projectRef.current});}catch(err){projectDirty.current=true;setError('Progetto non salvato: '+(err as Error).message);}},[]);
  useEffect(()=>{if(!projectDirty.current)return;if(projectTimer.current)clearTimeout(projectTimer.current);projectTimer.current=setTimeout(()=>void saveProject(),800);},[project,saveProject]);
  async function attachProject(id:string){await saveProject();projectDoc.current=id;projectDirty.current=false;setProjectState(EMPTY_PROJECT);if(!id)return;
    try{const data=await api('projects?document='+encodeURIComponent(id));if(projectDoc.current===id&&!projectDirty.current)setProjectState(data);}catch(err){setError((err as Error).message);}}
  async function loadDocument(id:string) { if(!await save())return;clearSuggestion();setError('');try{const d=await api('documents?id='+encodeURIComponent(id));suppress.current=true;editorRef.current?.commands.setContent(JSON.parse(d.content));suppress.current=false;
    current.current={id:d.id,version:d.version,title:d.title};setActive(d.id);setTitle(d.title);dirty.current=false;revision.current++;setStatus('Tutte le modifiche salvate');setWords(editorRef.current?.getText().trim().split(/\s+/).filter(Boolean).length||0);setCharacters(editorRef.current?.getText().length||0);analyseLocally(true);await attachProject(d.id);
  }catch(err){setError((err as Error).message);}}
  async function newDocument(){if(!await save())return;clearSuggestion();suppress.current=true;editorRef.current?.commands.setContent(EMPTY);suppress.current=false;current.current={id:'',version:0,title:'Senza titolo'};setActive('');setTitle('Senza titolo');setWords(0);setCharacters(0);markDirty();await save();await attachProject(current.current.id);analyseLocally(true);editorRef.current?.commands.focus();}
  async function reloadProfiles(){const data=await api('profiles');setProfiles(data.profiles);setVaultReady(data.vaultReady);setProfile(p=>data.profiles.some((x:Profile)=>x.id===p)?p:data.profiles[0]?.id||'');}
  useEffect(()=>{if(!editor)return;let cancelled=false;(async()=>{try{const list=await api('documents');if(cancelled)return;setDocs(list);await reloadProfiles();if(cancelled)return;if(list.length)await loadDocument(list[0].id);else{suppress.current=true;editor.commands.setContent(WELCOME);suppress.current=false;current.current.title='Benvenuto in Scrivia';setTitle('Benvenuto in Scrivia');markDirty();await save();await attachProject(current.current.id);}setMode(readMode());setLoaded(true);}catch(err){setError((err as Error).message);setStatus('Connessione non riuscita');}})();return()=>{cancelled=true;};},[editor]);
  useEffect(()=>{const before=(e:BeforeUnloadEvent)=>{void saveProject();if(dirty.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',before);return()=>{window.removeEventListener('beforeunload',before);void saveProject();if(fpTimer.current)clearTimeout(fpTimer.current);pending.current?.abort();if(aiTimer.current)clearTimeout(aiTimer.current);if(saveTimer.current)clearTimeout(saveTimer.current);};},[saveProject]);
  useEffect(()=>{clearSuggestion();setAiWarning('');},[profile,aiOn,autoMode,tone,mode]);
  function changeMode(next:Mode){setMode(next);try{localStorage.setItem('scrivia:mode',next);}catch{}}
  useEffect(()=>{setTheme(readTheme());},[]);
  // The static build registers the service worker in site/main.tsx; the server build does it here.
  useEffect(()=>{if(!LOCAL)setupPwa('/sw.js',process.env.NODE_ENV==='production');return onInstallAvailable(setInstallable);},[]);
  useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const apply=()=>{document.documentElement.dataset.theme=theme==='system'?(media.matches?'dark':'light'):theme;};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);},[theme]);
  function cycleTheme(){const next=THEMES[(THEMES.indexOf(theme)+1)%THEMES.length];setTheme(next);try{localStorage.setItem('scrivia:theme',next);}catch{}}
  const themeLabel=theme==='light'?'Tema chiaro':theme==='dark'?'Tema scuro':'Tema di sistema';
  useEffect(()=>{editor?.setEditable(loaded,false);},[editor,loaded]);
  useEffect(()=>{if(!settings&&!history&&!projectOpen)return;const previous=document.activeElement as HTMLElement|null;const modal=document.querySelector('[role="dialog"]') as HTMLElement|null;const controls=()=>Array.from(modal?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]')||[]);controls()[0]?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setSettings(false);setHistory(null);setProjectOpen(false);}if(event.key==='Tab'){const list=controls();if(!list.length)return;const first=list[0],last=list[list.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[settings,history,projectOpen]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(timer);},[notice]);

  async function saveProfile(){setFormBusy(true);setError('');try{const result=await api('profiles',form);await reloadProfiles();setProfile(result.id);setForm({id:'',name:'',provider:'openai',model:PROVIDERS.openai.model,key:'',dailyLimit:500});setNotice('Profilo API salvato');}catch(err){setError((err as Error).message);}finally{setFormBusy(false);}}
  async function removeProfile(p:Profile){if(!window.confirm(`Rimuovere il profilo “${p.name}”? Potrai aggiungerlo nuovamente con la tua chiave.`))return;try{await api('profiles',{id:p.id},'DELETE');await reloadProfiles();}catch(err){setError((err as Error).message);}}
  async function exportFile(type:string){if(!editor)return;setMenu(false);const safe=title.replace(/[<>:"/\\|?*]/g,'_')||'Documento';try{
    if(type==='txt')download(new Blob([editor.getText()],{type:'text/plain;charset=utf-8'}),safe+'.txt');
    if(type==='html')download(new Blob([`<!doctype html><html lang="it"><meta charset="utf-8"><body>${editor.getHTML()}</body></html>`],{type:'text/html;charset=utf-8'}),safe+'.html');
    if(type==='json')download(new Blob([JSON.stringify(editor.getJSON(),null,2)],{type:'application/json'}),safe+'.scrivia.json');
    if(type==='docx'){const {exportDocx}=await import('../lib/docx');download(await exportDocx(editor.getJSON()),safe+'.docx');}
    if(type==='pdf')window.print();
  }catch(err){setError((err as Error).message);}}
  async function importFile(file:File){if(!editor)return;if(file.size>2_000_000){setError('Scegli un file fino a 2 MB.');return;}if(!await save())return;
    try{let content:any;if(file.name.endsWith('.docx')){const mammoth=await import('mammoth');const result=await mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()});content=result.value;}
      else if(file.name.endsWith('.json')){content=JSON.parse(await file.text());if(content.type!=='doc')throw new Error('Formato Scrivia non valido.');}
      else {const text=await file.text();content={type:'doc',content:text.split('\n').map(t=>({type:'paragraph',content:t?[{type:'text',text:t}]:[]}))};}
      clearSuggestion();suppress.current=true;editor.commands.setContent(content);suppress.current=false;const name=file.name.replace(/\.(docx|txt|json)$/i,'').slice(0,150);current.current={id:'',version:0,title:name};setTitle(name);setActive('');markDirty();await save();await attachProject(current.current.id);analyseLocally(true);setNotice('Documento importato');
    }catch(err){suppress.current=false;setError('Importazione non riuscita: '+(err as Error).message);}}
  function findNext(doReplace=false){if(!editor||!find)return;const matches:{from:number;to:number}[]=[];editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text){let at=0;while((at=node.text.toLocaleLowerCase().indexOf(find.toLocaleLowerCase(),at))!==-1){matches.push({from:pos+at,to:pos+at+find.length});at+=find.length;}}});const sel=editor.state.selection;const match=doReplace?matches.find(m=>m.from===sel.from&&m.to===sel.to):undefined;
    if(match){editor.chain().focus().insertContentAt(match,replace?[{type:'text',text:replace}]:[]).run();return;}const next=matches.find(m=>m.from>=sel.to)||matches[0];if(next)editor.chain().focus().setTextSelection(next).run();else setNotice('Nessuna corrispondenza');}
  const activeProfile=profiles.find(p=>p.id===profile);
  // Brings the writer to a piece of evidence: the quote is searched again, since the text may have changed.
  function jump(quote:string,fallback?:number){const e=editorRef.current;if(!e)return;const found=locate(chapters(blocksFromDoc(e.state.doc)),quote);setMobileAI(false);
    if(found)e.chain().focus().setTextSelection({from:found.from,to:found.to}).scrollIntoView().run();
    else if(fallback!==undefined&&fallback<=e.state.doc.content.size){e.chain().focus().setTextSelection(fallback).scrollIntoView().run();setNotice('Il passaggio è cambiato: ti porto dove si trovava.');}
    else setNotice('Il passaggio non è più nel testo.');}
  const Tool=({label,icon:Icon,action,on=false}:{label:string;icon:any;action:()=>void;on?:boolean})=><button className={'tool '+(on?'active':'')} title={label} aria-label={label} aria-pressed={on} onMouseDown={e=>e.preventDefault()} onClick={action}><Icon size={17}/></button>;

  return <div className={'app '+(focus?'focus-mode':'')+(sidebar?'':' sidebar-hidden')+(mobileAI?' mobile-ai':'')}>
    <aside className="library"><div className="brand"><span className="brand-icon"><WandSparkles size={21}/></span><span>scrivia<span className="brand-dot">.</span></span><small>AI</small></div>
      <button className="new-doc" onClick={()=>void newDocument()} disabled={!loaded}><Plus size={17}/>Nuovo documento<span>＋</span></button>
      <div className="library-label">IL TUO SPAZIO</div><div className="library-current"><FileText size={17}/>Tutti i documenti <small>{docs.length}</small></div>
      <label className="doc-search"><Search size={15}/><input placeholder="Cerca un documento" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <div className="library-label recent-label">RECENTI</div><div className="doc-list">{docs.filter(d=>d.title.toLowerCase().includes(search.toLowerCase())).map(d=><button key={d.id} className={'doc-item '+(active===d.id?'selected':'')} onClick={()=>void loadDocument(d.id)}><FileText size={18}/><span><strong>{d.title}</strong><small>{date(d.updated)}</small></span>{active===d.id&&<span className="selected-dot"/>}</button>)}{!docs.length&&loaded&&<p className="muted">Crea il tuo primo documento.</p>}</div>
      <div className="library-bottom"><div className="privacy-mini"><ShieldCheck size={18}/><div><strong>Il tuo spazio privato</strong><small>{LOCAL?'Documenti salvati in questo browser':'Documenti salvati nel cloud'}</small></div></div><button onClick={()=>setSettings(true)}><Settings2 size={18}/>Provider e chiavi API<ChevronRight size={15}/></button><div className="user"><span>F</span><div>Il mio spazio<small>Scrivia AI · personale</small></div></div></div>
    </aside>
    <main className="main"><header className="topbar"><div className="document-heading"><button className="tool sidebar-toggle" aria-label="Mostra o nascondi documenti" onClick={()=>setSidebar(!sidebar)}><PanelLeftClose size={19}/></button><div><input aria-label="Titolo documento" maxLength={150} value={title} onChange={e=>{setTitle(e.target.value);current.current.title=e.target.value.trim()||'Senza titolo';markDirty();}}/><div className={'save-state '+(status==='Non salvato'?'bad':'')}><span className="save-dot"/>{status}</div></div></div><div className="header-actions"><button className="tool mobile-ai-toggle" aria-label="Mostra assistente AI" onClick={()=>setMobileAI(!mobileAI)}><Sparkles size={17}/></button>{installable&&<button className="quiet install-app" title="Installa Scrivia come app" onClick={()=>void promptInstall()}><Download size={17}/><span>Installa</span></button>}<button className="tool" title={themeLabel+' (clic per cambiare)'} aria-label={themeLabel+': cambia tema'} onClick={cycleTheme}>{theme==='light'?<Sun size={17}/>:theme==='dark'?<Moon size={17}/>:<Monitor size={17}/>}</button><button className="tool" aria-label="Impostazioni provider" onClick={()=>setSettings(true)}><Settings2 size={17}/></button><button className="quiet" title="Cronologia versioni" onClick={async()=>{try{setHistory(await api('documents?id='+active+'&history=1'));}catch(err){setError((err as Error).message);}}}><Clock3 size={17}/><span>Cronologia</span></button><button className={'tool '+(focus?'active':'')} aria-label="Modalità concentrazione" onClick={()=>setFocus(!focus)}><Maximize2 size={17}/></button><div className="export-wrap"><button className="export" onClick={()=>setMenu(!menu)}><ArrowDownToLine size={16}/>Esporta<ChevronDown size={14}/></button>{menu&&<div className="dropdown">{[['docx','Word (.docx)'],['pdf','Stampa / PDF'],['txt','Testo (.txt)'],['html','Pagina HTML'],['json','Backup Scrivia']].map(([v,l])=><button key={v} onClick={()=>void exportFile(v)}>{l}</button>)}</div>}</div></div></header>
      <nav className="menu-bar"><select className="mobile-docs" aria-label="Apri documento" value={active} onChange={e=>void loadDocument(e.target.value)}><option value="" disabled>Documenti</option>{docs.map(d=><option value={d.id} key={d.id}>{d.title}</option>)}</select><button className="mobile-newdoc" aria-label="Crea nuovo documento" disabled={!loaded} onClick={()=>void newDocument()}><Plus size={17}/></button><button className="chosen" onClick={()=>setShowFind(false)}>Scrivi</button><label className="import-label">Importa<input type="file" accept=".docx,.txt,.json" onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.target.value='';}}/></label><button onClick={()=>setShowFind(!showFind)}>Trova e sostituisci</button><div className="menu-spacer"/><span><Sparkles size={13}/>Il tuo prossimo pensiero, un po’ più chiaro.</span></nav>
      <div className="formatbar" aria-label="Formattazione"><Tool label="Annulla" icon={Undo2} action={()=>{editor?.chain().focus().undo().run();}}/><Tool label="Ripeti" icon={Redo2} action={()=>{editor?.chain().focus().redo().run();}}/><i/>
        <select aria-label="Stile paragrafo" value={editor?.isActive('heading',{level:1})?'h1':editor?.isActive('heading',{level:2})?'h2':'p'} onChange={e=>{if(e.target.value==='p')editor?.chain().focus().setParagraph().run();else editor?.chain().focus().toggleHeading({level:e.target.value==='h1'?1:2}).run();}}><option value="p">Testo normale</option><option value="h1">Titolo</option><option value="h2">Sottotitolo</option></select>
        <select aria-label="Carattere" defaultValue="Georgia" onChange={e=>editor?.chain().focus().setFontFamily(e.target.value).run()}><option>Georgia</option><option>Arial</option><option>Times New Roman</option><option>Verdana</option></select>
        <select className="font-size" aria-label="Dimensione carattere" defaultValue="18px" onChange={e=>editor?.chain().focus().setFontSize(e.target.value).run()}>{['14px','16px','18px','20px','24px','32px'].map(s=><option key={s}>{s}</option>)}</select><i/>
        <Tool label="Grassetto" icon={Bold} on={editor?.isActive('bold')} action={()=>{editor?.chain().focus().toggleBold().run();}}/><Tool label="Corsivo" icon={Italic} on={editor?.isActive('italic')} action={()=>{editor?.chain().focus().toggleItalic().run();}}/><Tool label="Sottolineato" icon={Underline} on={editor?.isActive('underline')} action={()=>{editor?.chain().focus().toggleUnderline().run();}}/><Tool label="Evidenzia" icon={Highlighter} on={editor?.isActive('highlight')} action={()=>{editor?.chain().focus().toggleHighlight({color:'#e0e8b9'}).run();}}/><label className="color-tool" title="Colore testo"><span>A</span><input type="color" aria-label="Colore testo" defaultValue="#272b29" onChange={e=>editor?.chain().focus().setColor(e.target.value).run()}/></label><i/>
        <Tool label="Allinea a sinistra" icon={AlignLeft} action={()=>{editor?.chain().focus().setTextAlign('left').run();}}/><Tool label="Centra" icon={AlignCenter} action={()=>{editor?.chain().focus().setTextAlign('center').run();}}/><Tool label="Allinea a destra" icon={AlignRight} action={()=>{editor?.chain().focus().setTextAlign('right').run();}}/><i/>
        <Tool label="Elenco puntato" icon={List} action={()=>{editor?.chain().focus().toggleBulletList().run();}}/><Tool label="Elenco numerato" icon={ListOrdered} action={()=>{editor?.chain().focus().toggleOrderedList().run();}}/><Tool label="Inserisci tabella" icon={Table2} action={()=>{editor?.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run();}}/><Tool label="Inserisci collegamento" icon={Link2} action={()=>{const url=window.prompt('Indirizzo del collegamento (https://…)');if(url&&/^https?:\/\//i.test(url))editor?.chain().focus().setLink({href:url}).run();}}/>
        <label className="tool image-upload" title="Inserisci immagine"><ImagePlus size={17}/><input type="file" aria-label="Inserisci immagine" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>800000){setError('Scegli un’immagine fino a 800 KB.');return;}const reader=new FileReader();reader.onload=()=>editor?.chain().focus().setImage({src:String(reader.result),alt:f.name}).run();reader.readAsDataURL(f);e.target.value='';}}/></label>
      </div>
      {editor?.isActive('table')&&<div className="table-actions"><button onClick={()=>editor.chain().focus().addRowAfter().run()}>+ Riga</button><button onClick={()=>editor.chain().focus().addColumnAfter().run()}>+ Colonna</button><button onClick={()=>editor.chain().focus().deleteRow().run()}>Elimina riga</button><button onClick={()=>editor.chain().focus().deleteColumn().run()}>Elimina colonna</button><button onClick={()=>editor.chain().focus().deleteTable().run()}>Rimuovi tabella</button></div>}
      {showFind&&<div className="findbar"><Search size={15}/><input aria-label="Cerca nel testo" placeholder="Trova nel testo" value={find} onChange={e=>setFind(e.target.value)}/><input aria-label="Sostituisci con" placeholder="Sostituisci con" value={replace} onChange={e=>setReplace(e.target.value)}/><button onClick={()=>findNext()}>Trova</button><button onClick={()=>findNext(true)}>Sostituisci selezione</button><button aria-label="Chiudi ricerca" onClick={()=>setShowFind(false)}><X size={16}/></button></div>}
      {error&&<div role="alert" className="error-banner">{error}<button onClick={()=>void save()}>Riprova salvataggio</button><button aria-label="Chiudi errore" onClick={()=>setError('')}><X size={15}/></button></div>}
      <div className="writing-area"><div className="canvas"><div className="page-topline"><span>DOCUMENTO PERSONALE</span><span><span className="tiny-dot"/>Spazio alle parole</span></div><div className="paper"><EditorContent editor={editor}/></div><div className="page-bottom">Le idee sono tue. Le possibilità, infinite.</div></div>
        <aside className="assistant"><div className="assistant-title"><span className="spark-icon"><Sparkles size={19}/></span><div><h2>Il tuo assistente</h2><p>Un passo avanti, insieme.</p></div><span className="live-dot"/></div>
          <ModeSwitch mode={mode} setMode={changeMode}/>
          {mode==='libera'?<FreeCard fp={fp}/>:<>
          <ProjectChip project={project} onOpen={()=>setProjectOpen(true)}/>
          <label className="profile-select">PROFILO AI<select value={profile} onChange={e=>setProfile(e.target.value)}><option value="">Collega un provider</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {PROVIDERS[p.provider].name}</option>)}</select></label>
          {mode==='assistita'&&<section className="ai-card"><div className="ai-card-heading"><span>Suggerimenti discreti</span><button role="switch" aria-checked={aiOn} aria-label="Suggerimenti automatici" className={'switch '+(aiOn?'on':'')} onClick={()=>setAiOn(!aiOn)}><span/></button></div><p>Le parole giuste, nella tua voce, mentre scrivi.</p><div className="segmented"><button className={autoMode==='complete'?'active':''} onClick={()=>setAutoMode('complete')}>Completa</button><button className={autoMode==='rewrite'?'active':''} onClick={()=>setAutoMode('rewrite')}>Migliora frase</button></div><IntentRow detected={detected} choice={intentChoice} setChoice={setIntentChoice}/><label className="delay-label">Pausa prima del suggerimento <strong>{delay} ms</strong><input aria-label="Pausa suggerimenti" type="range" min="400" max="1600" step="100" value={delay} onChange={e=>setDelay(+e.target.value)}/></label><div className="ai-card-footer"><span className={'tiny-dot '+(!aiOn?'off':'')}/>{!aiOn?'Suggerimenti in pausa':activeProfile?'Pronto a scrivere con te':'In attesa del tuo provider'}</div></section>}
          {mode==='coscrittura'&&<><IntentRow detected={detected} choice={intentChoice} setChoice={setIntentChoice}/>
            <div className="segmented cowrite-tabs" role="tablist"><button role="tab" aria-selected={coTab==='genera'} className={coTab==='genera'?'active':''} onClick={()=>setCoTab('genera')}><PenLine size={13}/>Genera</button><button role="tab" aria-selected={coTab==='direzioni'} className={coTab==='direzioni'?'active':''} onClick={()=>setCoTab('direzioni')}><GitBranch size={13}/>Direzioni</button></div>
            {coTab==='genera'?<div className="rewrite-actions"><button onClick={()=>void ask('continue')}><PenLine size={17}/><span>Continua la scena<small>Un paragrafo dal cursore, nella voce scelta</small></span><ChevronRight size={15}/></button><button onClick={()=>void ask('voice')}><Drama size={17}/><span>Riscrivi nella voce scelta<small>Selezione o paragrafo, stesso contenuto</small></span><ChevronRight size={15}/></button><button onClick={()=>void ask('rewrite')}><WandSparkles size={17}/><span>Migliora la scrittura<small>Più chiara, sempre tua</small></span><ChevronRight size={15}/></button><button onClick={()=>void ask('shorten')}><AlignLeft size={17}/><span>Rendi più conciso<small>Vai dritto al punto</small></span><ChevronRight size={15}/></button><button onClick={()=>void ask('formal')}><FileText size={17}/><span>Tono professionale<small>Il registro giusto</small></span><ChevronRight size={15}/></button></div>
            :editor&&<Directions editor={editor} run={run} ctx={narrative} ready={!!activeProfile} onWrite={direction=>void ask('continue',false,direction)}/>}</>}
          {mode==='revisione'&&editor&&<Review editor={editor} project={project} setProject={setProject} run={run} ctx={narrative} fp={fp} ready={!!activeProfile} jump={jump}/>}
          {mode!=='revisione'&&<div className={'suggestion-box'+(suggestion?' has-proposal':'')+(busy?' is-busy':'')} aria-live="polite"><div><Sparkles size={15}/><strong>{busy&&!suggestion?'Sto pensando…':suggestion?(SUGGESTION_TITLES[suggestion.mode]||'Correzione proposta'):'Il prossimo pensiero'}</strong>{(busy||suggestion)&&<button aria-label="Scarta suggerimento" onClick={clearSuggestion}><X size={14}/></button>}</div>{[aiWarning,aiError].filter(Boolean).map(w=><p key={w} className="ai-warning" role="alert"><TriangleAlert size={14}/><span>{w}</span><button aria-label="Chiudi avviso" onClick={()=>{setAiWarning('');setAiError('');}}><X size={12}/></button></p>)}{suggestion?<><p className="proposal">{suggestion.mode==='complete'||suggestion.mode==='continue'?<>{suggestion.base&&<span className="proposal-context">{suggestion.base.length>70?'…'+suggestion.base.slice(-70).trimStart():suggestion.base}</span>}<mark>{suggestion.text}</mark></>:proposalDiff?proposalDiff.map((part,i)=>part.type==='same'?<span key={i}>{part.text}</span>:part.type==='add'?<ins key={i}>{part.text}</ins>:<del key={i}>{part.text}</del>):suggestion.text}</p>{proposalDiff&&<small className="proposal-note">{proposalDiff.some(p=>p.type!=='same')?<><ins>in verde</ins> le parole nuove, <del>barrate</del> quelle rimosse</>:'Nessuna modifica necessaria: il testo va già bene.'}</small>}{proposalVoice!==null&&<small className="proposal-note voice-match"><Drama size={12}/>Vicinanza alla tua impronta stilistica: <strong>{proposalVoice}%</strong></small>}{suggestion.cached&&<small className="proposal-note">Dalla memoria: nessuna nuova chiamata al provider.</small>}<div className="proposal-actions"><button className="accept" disabled={!suggestion.done} onClick={acceptSuggestion}><Check size={15}/>Accetta<kbd>Tab</kbd></button><button className="dismiss" onClick={clearSuggestion}>Scarta<kbd>Esc</kbd></button></div></>:!aiWarning&&!aiError&&<p>{!profiles.length?'Collega una chiave API per dare una marcia in più alle tue idee.':'Scrivi una frase. Il suggerimento apparirà qui, senza interrompere il tuo ritmo.'}</p>}{!profiles.length&&<button className="connect" onClick={()=>setSettings(true)}><Plus size={14}/>Collega il tuo provider</button>}</div>}
          </>}
          <div className="assistant-footnote"><ShieldCheck size={15}/><p>Il testo viene inviato solo al provider selezionato quando l’AI è attiva. <button onClick={()=>setSettings(true)}>Gestisci le API</button></p></div><div className="shortcuts"><span><kbd>Tab</kbd> accetta</span><span><kbd>Esc</kbd> ignora</span></div>
        </aside></div>
      <footer className="statusbar"><span>{words} parole<span className="status-divider">|</span>{characters} caratteri</span><span>Controllo ortografico del browser</span><span><span className="tiny-dot"/>Scrivia AI</span></footer>
    </main>
    {notice&&<div className="toast" role="status"><Check size={16}/>{notice}</div>}
    {settings&&<div className="modal-backdrop" onClick={()=>setSettings(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="Provider e chiavi API" onClick={e=>e.stopPropagation()}><button className="modal-close tool" aria-label="Chiudi impostazioni" onClick={()=>setSettings(false)}><X size={20}/></button><span className="modal-icon"><KeyRound size={23}/></span><h2>La tua AI, alle tue condizioni.</h2><p className="modal-subtitle">Collega più account e scegli il modello adatto a ogni testo.</p><div className="security-note"><ShieldCheck size={18}/><span>{LOCAL?'Versione statica: le chiavi restano solo in questo browser (localStorage) e il testo va direttamente al provider. Usa un dispositivo personale e chiavi con limiti di spesa.':'Chiavi cifrate sul server. Non vengono salvate nel browser o incluse nel codice.'}</span></div>{!vaultReady&&<p className="warning">Il server non ha ancora una chiave di cifratura configurata.</p>}{error&&<p role="alert" className="warning">{error}</p>}
      <div className="profile-list">{profiles.map(p=><div className="profile-row" key={p.id}><span className={'provider-badge '+p.provider}>{PROVIDERS[p.provider].name.slice(0,1)}</span><div><strong>{p.name}</strong><small>{PROVIDERS[p.provider].name} · {p.model} · ••••{p.hint}</small><small>{p.used} / {p.daily_limit} richieste oggi (UTC)</small></div><button onClick={()=>setForm({id:p.id,name:p.name,provider:p.provider,model:p.model,key:'',dailyLimit:p.daily_limit})}>Modifica</button><button aria-label={'Rimuovi '+p.name} onClick={()=>void removeProfile(p)}><X size={16}/></button></div>)}</div>
      <form onSubmit={e=>{e.preventDefault();void saveProfile();}}><h3>{form.id?'Modifica profilo':'Aggiungi un profilo'}</h3><div className="form-grid"><label>Nome del profilo<input required maxLength={80} placeholder="Es. Account personale" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Provider<select value={form.provider} onChange={e=>{const p=e.target.value as Provider;setForm({...form,provider:p,model:PROVIDERS[p].model});}}>{Object.entries(PROVIDERS).map(([id,p])=><option key={id} value={id}>{p.name}</option>)}</select></label><label>Modello<input required maxLength={150} value={form.model} onChange={e=>setForm({...form,model:e.target.value})}/></label><label>Limite richieste al giorno<input type="number" min={1} max={10000} required value={form.dailyLimit} onChange={e=>setForm({...form,dailyLimit:+e.target.value})}/></label></div><label>Chiave API {form.id&&<small>(lascia vuoto per mantenerla)</small>}<input autoComplete="off" type="password" required={!form.id} maxLength={4096} placeholder="Incolla la chiave del provider" value={form.key} onChange={e=>setForm({...form,key:e.target.value})}/></label><p className="form-note">Le richieste usano il credito del tuo account provider. Il limite conta i tentativi, anche quelli interrotti; non è un tetto di spesa in euro. Puoi modificare liberamente l’identificativo del modello.</p><div className="form-footer"><button type="button" className="quiet" onClick={()=>setSettings(false)}>Chiudi</button><button className="primary" disabled={formBusy||!vaultReady} type="submit">{formBusy?'Salvataggio…':form.id?'Salva modifiche':'Collega provider'}<ChevronRight size={16}/></button></div></form>
    </section></div>}
    {projectOpen&&<ProjectModal project={project} setProject={setProject} onClose={()=>setProjectOpen(false)}/>}
    {history&&<div className="modal-backdrop" onClick={()=>setHistory(null)}><section className="modal history-modal" role="dialog" aria-modal="true" aria-label="Cronologia versioni" onClick={e=>e.stopPropagation()}><button className="modal-close tool" aria-label="Chiudi cronologia" onClick={()=>setHistory(null)}><X size={20}/></button><Clock3 size={26}/><h2>La storia delle tue idee.</h2><p className="modal-subtitle">Fino a 30 versioni precedenti, registrate al massimo una volta al minuto.</p>{!history.length&&<p className="empty-state">Le versioni appariranno qui dopo le prossime modifiche salvate.</p>}{history.map(r=><div className="revision-row" key={r.id}><div><strong>{r.title}</strong><small>{new Date(r.created).toLocaleString('it-IT')}</small></div><button onClick={async()=>{if(!window.confirm('Ripristinare questa versione? La versione attuale sarà conservata nella cronologia.'))return;if(!await save())return;try{await api('revisions',{document:active,title:current.current.title,content:editor?.getJSON()});clearSuggestion();editor?.commands.setContent(JSON.parse(r.content));current.current.title=r.title;setTitle(r.title);markDirty();if(await save())setHistory(null);}catch(err){setError((err as Error).message);}}}>Ripristina</button></div>)}</section></div>}
  </div>;
}

