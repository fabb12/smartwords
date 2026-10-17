'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import { Ghost, ghostKey } from '../lib/ghost';
import { completionProposal } from '../lib/completion';
import { AiGovernor, sameText, sentenceTarget, wordDiff } from '../lib/ai-governor';
import { splitWarning } from '../lib/providers';
import { ALL_PROVIDERS as PROVIDERS, DEVICE_PROVIDERS, DEVICE_CONNECTION_HELP, deviceAssist, deviceProfileApi, isDeviceProfile, isDeviceProvider, type AiProvider as Provider } from '../lib/device-models';
import { ModelPicker } from './model-picker';
import { WritingMemoryModal } from './writing-memory';
import { EMPTY_WRITING_MEMORY, PERSONAL_VOICE_MODES, authorVoiceInstruction, learnWriting, readWritingMemory, storeWritingMemory, writingMemoryKey, writingTextFromDocument, type WritingMemory } from '../lib/writing-memory';
import { GitHubDocuments } from './github-documents';
import { bindGitHubDocument, githubConnected, githubLocalId, githubLocalUnchanged, saveGitHubDocument, type RepositoryDocument } from '../lib/github-documents';
import { localApi, localAssist } from '../lib/local-backend';
import { blocksFromDoc, chapters, describeFingerprint, detectIntent, locate, fingerprint, memorySummary, wordsOf, styleSimilarity, INTENTS, type DetectedIntent, type Fingerprint } from '../lib/narrative';
import { voiceById, voiceInstruction } from '../lib/author-styles';
import { KB_MODES, buildKbIndex, kbInstruction, parsePersona, personaSample, styleSource, type KnowledgeBase } from '../lib/knowledge-base';
import { deleteKnowledgeBase, listKnowledgeBases, readActiveKb, saveKnowledgeBase, storeActiveKb } from '../lib/kb-store';
import { KnowledgeBaseModal, SourceBadge } from './knowledge-base';
import { applyUpdate, onInstallAvailable, promptInstall, setupPwa, watchForUpdates } from '../lib/pwa';
import { buildLabel } from '../lib/version';
import { dictationSupported, dictationText, startDictation, type Dictation } from '../lib/dictation';
import { findInstaller, type Installer } from '../lib/desktop';
import { EMPTY_PROJECT, briefText, type Project } from '../lib/project';
import { Tooltips } from './tooltips';
import { InstallSteps, Sheet, useSimpleMode, useStandalone, useVisibleHeight } from './mobile';
import { Directions, FreeCard, IntentRow, isMode, ModeSwitch, ProjectChip, ProjectModal, Review, type Ctx, type Mode, type Run } from './companion';
import { ArrowDownToLine, AlignCenter, AlignLeft, AlignRight, Bold, Check, ChevronDown, ChevronRight, Clock3, Columns2, Download, Ellipsis, FileText, Heading2, Menu, Fullscreen, GitBranch, Drama, PenLine, Highlighter, ImagePlus, Italic, KeyRound, Link2, List, ListOrdered, Maximize2, Mic, Monitor, MonitorDown, Moon, PanelLeftClose, Plus, RefreshCw, Redo2, Search, Settings2, ShieldCheck, Minimize, Sparkles, Sun, Table2, TriangleAlert, Underline, Undo2, WandSparkles, X } from 'lucide-react';

type Doc = {id:string; title:string; updated:number; version:number};
type Profile = {id:string;name:string;provider:Provider;model:string;baseUrl?:string;hint:string;daily_limit:number;used:number};
// base/para: paragraph text and start for completions; original: the text a rewrite would replace;
// trail: whitespace between the rewritten sentence and the cursor, kept after accepting.
type Suggestion = {text:string;from:number;to:number;revision:number;mode:string;done:boolean;base?:string;para?:number;original?:string;cached?:boolean;trail?:number};
type Revision = {id:string;title:string;content:string;created:number};
const EMPTY = {type:'doc',content:[{type:'paragraph'}]};
// The static GitHub Pages build sets this flag: storage and AI calls then stay in the browser.
const LOCAL=typeof window!=='undefined'&&window.__SCRIVIA_LOCAL__===true;
type Theme='light'|'dark'|'system';
const THEMES:Theme[]=['light','dark','system'];
function readMode():Mode{try{const m=localStorage.getItem('scrivia:mode');return isMode(m)?m:'assistita';}catch{return 'assistita';}}
const EMPTY_FP=fingerprint('');
// Page view: A4 pages (CSS px) laid out side by side as columns of the editor; 0 is the continuous sheet.
const PAGE={width:794,height:1123,margin:76,gap:28},PAGE_VIEWS=[0,1,2,3,4];
function readPages(){try{const n=Number(localStorage.getItem('scrivia:pages'));return PAGE_VIEWS.includes(n)?n:0;}catch{return 0;}}
const SUGGESTION_TITLES:Record<string,string>={complete:'Continuazione proposta',continue:'Scena proposta',voice:'Riscrittura nella voce scelta'};
function readTheme():Theme{try{const t=localStorage.getItem('scrivia:theme');return THEMES.includes(t as Theme)?t as Theme:'system';}catch{return 'system';}}
async function api(path:string,body?:any,method='POST',signal?:AbortSignal):Promise<any> {
  if(path==='profiles'&&body&&(isDeviceProvider(body.provider)||isDeviceProfile(body.id)))return deviceProfileApi(body,method);
  let data:any;
  if(LOCAL)data=await localApi(path,body,method);
  else {const res=await fetch('/api/'+path,body===undefined?{signal}:{method,signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});data=await res.json();if(!res.ok)throw new Error(data.error||'Operazione non riuscita.');}
  return path==='profiles'&&body===undefined?{...data,profiles:[...data.profiles,...deviceProfileApi().profiles!]}:data;
}
const date=(n:number)=>new Date(n).toLocaleDateString('it-IT',{day:'numeric',month:'short'});
// Paragraph text before the cursor; leaf nodes (line breaks) count as one character, so offsets map to positions.
const beforeCursor=($from:Editor['state']['selection']['$from'])=>$from.parent.textBetween(0,$from.parentOffset,'\n','\n');
function download(blob:Blob,name:string) { const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }

export default function Workspace({owner='local'}:{owner?:string}={}) {
  const [writingMemory,setWritingMemory]=useState<WritingMemory>(EMPTY_WRITING_MEMORY),[memoryOpen,setMemoryOpen]=useState(false),[memoryError,setMemoryError]=useState('');
  const writingRef=useRef(writingMemory),writingReady=useRef(false),ownerRef=useRef(owner);ownerRef.current=owner;
  // Knowledge bases (style + mindset of an author) and the one guiding the predictions.
  const [kbs,setKbs]=useState<KnowledgeBase[]>([]),[activeKbId,setActiveKbId]=useState(''),[kbOpen,setKbOpen]=useState(false),[kbError,setKbError]=useState('');
  const activeKb=useMemo(()=>kbs.find(k=>k.id===activeKbId)||null,[kbs,activeKbId]);
  const kbIndex=useMemo(()=>activeKb?buildKbIndex(activeKb):null,[activeKb]);
  const kbRef=useRef<{kb:KnowledgeBase|null;index:ReturnType<typeof buildKbIndex>|null}>({kb:null,index:null});kbRef.current={kb:activeKb,index:kbIndex};
  const [docs,setDocs]=useState<Doc[]>([]),[active,setActive]=useState(''),[title,setTitle]=useState('Senza titolo'),[loaded,setLoaded]=useState(false);
  const [profiles,setProfiles]=useState<Profile[]>([]),[profile,setProfile]=useState(''),[vaultReady,setVaultReady]=useState(false);
  const [repoOpen,setRepoOpen]=useState<null|'save'|'load'>(null),[repoBusy,setRepoBusy]=useState(false),[repoError,setRepoError]=useState('');
  const [settings,setSettings]=useState(false),[history,setHistory]=useState<Revision[]|null>(null),[menu,setMenu]=useState(false),[focus,setFocus]=useState(false),[sidebar,setSidebar]=useState(true),[mobileAI,setMobileAI]=useState(false);
  const [search,setSearch]=useState(''),[find,setFind]=useState(''),[replace,setReplace]=useState(''),[showFind,setShowFind]=useState(false);
  const [status,setStatus]=useState('Caricamento…'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[words,setWords]=useState(0),[characters,setCharacters]=useState(0);
  const [aiOn,setAiOn]=useState(true),[autoMode,setAutoMode]=useState('complete'),[tone]=useState('Naturale'),[delay,setDelay]=useState(700);
  const [mode,setMode]=useState<Mode>('assistita'),[intentChoice,setIntentChoice]=useState('auto'),[detected,setDetected]=useState<DetectedIntent>(()=>detectIntent('')),[fp,setFp]=useState<Fingerprint>(EMPTY_FP),[coTab,setCoTab]=useState<'genera'|'direzioni'>('genera');
  const [project,setProjectState]=useState<Project>(EMPTY_PROJECT),[projectOpen,setProjectOpen]=useState(false);
  const [suggestion,setSuggestion]=useState<Suggestion|null>(null),[busy,setBusy]=useState(false),[aiError,setAiError]=useState(''),[aiWarning,setAiWarning]=useState('');
  const [theme,setTheme]=useState<Theme>('system'),[installable,setInstallable]=useState(false),[fullscreen,setFullscreen]=useState(false),[canFullscreen,setCanFullscreen]=useState(false),[pagePref,setPages]=useState(0),[update,setUpdate]=useState<string|null>(null),[versionLabel,setVersionLabel]=useState(''),[installer,setInstaller]=useState<Installer|null>(null);
  // Phones: simplified mode (bottom toolbar, panels as sheets); the A4 page view is desktop-only.
  const [narrow,simple,setSimple]=useSimpleMode(),standalone=useStandalone(),[sheet,setSheet]=useState<null|'docs'|'more'|'install'>(null);
  const pages=simple?0:pagePref;
  // Voice input: phrases are written at the cursor while the microphone listens.
  const [canDictate,setCanDictate]=useState(false),[listening,setListening]=useState(false),[heard,setHeard]=useState(''),[dictError,setDictError]=useState(''),dictation=useRef<Dictation|null>(null);
  useVisibleHeight(simple);
  const canvasRef=useRef<HTMLDivElement|null>(null),paperRef=useRef<HTMLDivElement|null>(null);
  const [form,setForm]=useState({id:'',name:'',provider:'openai' as Provider,model:PROVIDERS.openai.model as string,key:'',baseUrl:'',dailyLimit:500}),[formBusy,setFormBusy]=useState(false);
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
  const source=useMemo(()=>styleSource({kb:activeKb?.chunks.length?activeKb:null,voiceId:project.voice.id,voiceName:voiceById(project.voice.id).name,memoryActive:writingMemory.enabled&&(writingMemory.sources.length>0||!!writingMemory.notes.trim())}),[activeKb,project.voice.id,writingMemory]);
  const proposalDiff=useMemo(()=>suggestion?.done&&suggestion.original!==undefined?wordDiff(suggestion.original,suggestion.text):null,[suggestion]);
  const proposalVoice=useMemo(()=>{if(!suggestion?.done||fp.words<150||wordsOf(suggestion.text).length<25)return null;return styleSimilarity(fp,fingerprint(suggestion.text));},[suggestion,fp]);
  function applyWritingMemory(next:WritingMemory,manual=true){
    if(manual)clearSuggestion();writingRef.current=next;setWritingMemory(next);
    try{storeWritingMemory(next,ownerRef.current);setMemoryError('');return true;}catch(err){setMemoryError((err as Error).message);return false;}
  }
  function rememberWriting(id:string,name:string,text:string){if(!writingReady.current)return;const previous=writingRef.current,next=learnWriting(previous,id,name,text);if(next!==previous)applyWritingMemory(next,false);}
  function changeWritingMemory(next:WritingMemory){
    const e=editorRef.current;
    if(next.enabled&&e&&current.current.id)next=learnWriting(next,current.current.id,current.current.title,e.getText({blockSeparator:'\n'}));
    applyWritingMemory(next);
  }
  useEffect(()=>{
    writingReady.current=false;const restored=readWritingMemory(owner);writingRef.current=restored;setWritingMemory(restored);writingReady.current=true;
    const sync=(event:StorageEvent)=>{if(event.key!==writingMemoryKey(owner)&&event.key!==null)return;clearSuggestion();const next=readWritingMemory(owner);writingRef.current=next;setWritingMemory(next);};
    window.addEventListener('storage',sync);return()=>{writingReady.current=false;window.removeEventListener('storage',sync);};
  },[owner]);
  useEffect(()=>{let live=true;
    listKnowledgeBases(owner).then(list=>{if(!live)return;const wanted=readActiveKb(owner),found=list.some(k=>k.id===wanted);setKbs(list);setActiveKbId(found?wanted:'');if(wanted&&!found)storeActiveKb('',owner);}).catch(err=>{if(live)setKbError((err as Error).message);});
    return()=>{live=false;};},[owner]);
  function activateKb(id:string){clearSuggestion();setActiveKbId(id);storeActiveKb(id,ownerRef.current);const kb=kbs.find(k=>k.id===id);setNotice(kb?`Previsioni guidate da «${kb.name}»`:'Knowledge base disattivata');}
  // The list updates at once (typing in the profile stays smooth), then it is persisted.
  async function saveKb(changed:KnowledgeBase){const kb={...changed,updated:Date.now()};setKbs(old=>[kb,...old.filter(k=>k.id!==kb.id)].sort((a,b)=>b.updated-a.updated));if(kb.id===activeKbId)clearSuggestion();
    try{await saveKnowledgeBase(kb,ownerRef.current);setKbError('');}catch(err){setKbError((err as Error).message);throw err;}}
  async function removeKb(id:string){await deleteKnowledgeBase(id,ownerRef.current);setKbs(old=>old.filter(k=>k.id!==id));if(id===activeKbId)activateKb('');}
  async function distillKb(kb:KnowledgeBase,signal:AbortSignal){return parsePersona(await run('persona',{text:personaSample(kb)},signal));}
  // Fields sent with every request: the active knowledge base replaces the personal memory, so the voice is not sent twice.
  function voiceFields(mode:string,text:string){const {kb,index}=kbRef.current;
    if(kb&&index&&kb.chunks.length)return {knowledgeBase:KB_MODES.includes(mode)?kbInstruction(kb,index,text,mode):'',authorVoice:''};
    return {knowledgeBase:'',authorVoice:PERSONAL_VOICE_MODES.includes(mode)?authorVoiceInstruction(writingRef.current,text):''};}
  async function learnSavedWriting(signal:AbortSignal){
    if(!writingRef.current.enabled)throw new Error('Attiva prima «Impara e usa la mia voce».');
    if(!await save())throw new Error('Salva prima il documento aperto.');
    const list:Doc[]=await api('documents',undefined,'GET',signal),selected=list.filter(d=>!writingRef.current.excluded.includes(d.id)).sort((a,b)=>b.updated-a.updated).slice(0,40);
    const samples:{id:string;title:string;text:string;updated:number}[]=[];let at=0,failed=0;
    await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{
      while(at<selected.length){signal.throwIfAborted();const item=selected[at++];try{const d=await api('documents?id='+encodeURIComponent(item.id),undefined,'GET',signal);samples.push({id:d.id,title:d.title,text:writingTextFromDocument(typeof d.content==='string'?JSON.parse(d.content):d.content),updated:d.updated});}catch(err){if(signal.aborted)throw err;failed++;}}
    }));
    signal.throwIfAborted();let next=writingRef.current;
    if(!next.enabled)throw new Error('L’apprendimento è stato disattivato.');
    for(const sample of samples.sort((a,b)=>a.updated-b.updated))next=learnWriting(next,sample.id,sample.title,sample.text,sample.updated);
    if(!applyWritingMemory(next))throw new Error('Profilo aggiornato in memoria, ma non salvato sul dispositivo.');
    return `Memoria aggiornata da ${samples.length} documenti letti.${failed?' '+failed+' documenti non sono stati letti; puoi riprovare.':''}`;
  }
  const editor=useEditor({immediatelyRender:false,shouldRerenderOnTransaction:true,
    extensions:[StarterKit.configure({link:{openOnClick:false}}),TextStyleKit,TableKit.configure({table:{resizable:true}}),TextAlign.configure({types:['heading','paragraph']}),Image.configure({allowBase64:true}),Highlight.configure({multicolor:true}),Ghost],
    content:EMPTY,editorProps:{attributes:{class:'manuscript',role:'textbox','aria-label':'Contenuto del documento',spellcheck:'true'},handleKeyDown:(_view,event)=>{
      if(event.key==='Tab' && callbacks.current.accept()){event.preventDefault();return true;}
      if(event.key==='Escape'){callbacks.current.cancel();return false;}
      return false;
    }},onUpdate:()=>callbacks.current.update(),onSelectionUpdate:({transaction})=>callbacks.current.selection(transaction.docChanged),
  }); editorRef.current=editor;

  function clearSuggestion() { if(aiTimer.current)clearTimeout(aiTimer.current);pending.current?.abort();pending.current=null;selection.current=null;setSuggestion(null);setBusy(false);const e=editorRef.current;if(e&&!e.isDestroyed)e.view.dispatch(e.state.tr.setMeta(ghostKey,null)); }
  function showSuggestion(s:Suggestion|null) { selection.current=s;setSuggestion(s);const e=editorRef.current;if(e&&!e.isDestroyed)e.view.dispatch(e.state.tr.setMeta(ghostKey,s?{kind:s.original===undefined&&(s.mode==='complete'||s.mode==='continue')?'complete':'replace',from:s.from,to:s.to,text:s.text,done:s.done}:null)); }
  // Typing the first characters of a completion keeps the rest on screen instead of asking again.
  function continued():Suggestion|null { const s=selection.current,e=editorRef.current;if(!s||!e||s.mode!=='complete'||s.original!==undefined||!s.done||s.base===undefined||!e.state.selection.empty)return null;
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
        if(rev===revision.current){dirty.current=false;rememberWriting(result.id,payload.title,e.getText({blockSeparator:'\n'}));}setStatus(dirty.current?'Salvataggio…':'Tutte le modifiche salvate');setError('');
      }catch(err){setStatus('Non salvato');setError((err as Error).message);return false;}}
      return true;})();saving.current=job;try{return await job;}finally{saving.current=null;}
  },[]);
  function markDirty(){dirty.current=true;revision.current++;setStatus('Modifiche da salvare');if(saveTimer.current)clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>void save(),900);}

  // Streams an /api/assist answer. onText sees the growing answer and may return false to stop.
  // Returns null when stopped; rate limits and provider/network failures pause automatic requests.
  async function streamAssist(payload:Record<string,unknown>,signal:AbortSignal,onText?:(answer:string)=>boolean|void):Promise<string|null> {
    const penalize=(rateLimited:boolean)=>` Suggerimenti automatici in pausa per ${Math.round(governor.failed(rateLimited)/1000)} s.`;
    let res:Response;
    try{res=isDeviceProfile(payload.profile)?await deviceAssist(payload,signal):LOCAL?await localAssist(payload,signal):await fetch('/api/assist',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify(payload)});}
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
    governor.started();const answer=await streamAssist({profile:opts.profile,mode,tone:opts.tone,...fields,...voiceFields(mode,String(fields.text||''))},signal);if(answer===null)throw new DOMException('Richiesta annullata.','AbortError');return answer;};

  async function ask(mode:string,automatic=false,direction='') { const e=editorRef.current;if(!e)return;const opts=options.current;if(!opts.profile){if(!automatic)setSettings(true);return;}
    clearSuggestion();setAiError('');setAiWarning('');const {from,to,$from}=e.state.selection;
    if(automatic&&!e.state.selection.empty)return;
    // No proposal is drawn inside an IME composition (mobile keyboards): try again once it is over.
    if(automatic&&e.view.composing){aiTimer.current=setTimeout(()=>void ask(mode,true),opts.delay);return;}
    const inline=mode==='complete'||mode==='continue',para=$from.start();
    const completion=mode==='complete'?sentenceTarget(beforeCursor($from)):null;
    // Automatic improvements work on the sentence being written, never on text already accepted.
    const sentence=automatic&&mode==='rewrite'?sentenceTarget(beforeCursor($from),settled.current?.para===para?settled.current.text:''):null;
    const start=completion?para+completion.start:sentence?para+sentence.start:inline?from:(from===to?para:from);
    // A voice rewrite without selection takes the whole paragraph, so the voice applies to a full unit.
    const end=sentence?para+sentence.end:inline?from:mode==='voice'&&from===to?$from.end():to;
    const text=completion?beforeCursor($from).slice(completion.start):sentence?beforeCursor($from).slice(sentence.start,sentence.end):mode==='continue'?e.state.doc.textBetween(Math.max(0,from-2000),from,'\n'):e.state.doc.textBetween(start,end,'\n');
    if(text.trim().length<(mode==='continue'?20:3)){if(!automatic)setAiError(mode==='continue'?'Scrivi qualche frase: la scena continuerà dal cursore.':'Scrivi o seleziona almeno qualche parola.');return;}
    if(text.length>10000){setAiError('Seleziona un brano più breve (massimo 10.000 caratteri).');return;}
    const contextEnd=mode==='continue'?Math.max(0,from-2000):start,n=narrativeRef.current;
    const payload={profile:opts.profile,mode,...voiceFields(mode,text),text:text.slice(-10000),context:e.state.doc.textBetween(Math.max(0,contextEnd-6000),contextEnd,'\n'),after:e.state.doc.textBetween(to,Math.min(e.state.doc.content.size,to+1000),'\n'),tone:opts.tone,
      style:mode==='formal'?'':n.style,intent:mode==='formal'?'':n.intent,brief:n.brief,memory:mode==='complete'?n.memory.slice(0,1500):mode==='continue'||mode==='voice'?n.memory:'',direction};
    const rev=revision.current,scope=String(para),key=AiGovernor.key([payload]);
    const extra=mode==='complete'?{base:beforeCursor($from),para}:mode==='continue'?{}:{original:text,trail:sentence?from-end:0};
    // A generated scene starting right after a word needs a separating space.
    const spaced=(a:string)=>mode==='continue'&&/\S$/.test(text)&&/^[\p{L}\p{N}«"“(]/u.test(a)?' '+a:a;
    const proposal=(answer:string,done:boolean,cached=false):Suggestion|null=>{
      if(mode==='complete'){const p=completionProposal(text,answer,done);return p?{...extra,...p,text:p.text,from:start+p.offset,to:end,revision:rev,mode,done,cached}:null;}
      return {text:spaced(answer),from:start,to:end,revision:rev,mode,done,cached,...extra};
    };
    // A problem reported by the model is shown as a warning, never as text to accept;
    // an automatic improvement that changes nothing is not shown either.
    const finish=(answer:string,cached:boolean)=>{if(automatic)governor.asked(mode,scope,text);const p=splitWarning(answer);setAiWarning(p.warning);
      if(!p.text.trim()||(automatic&&mode==='rewrite'&&sameText(p.text,text))){showSuggestion(null);return;}showSuggestion(proposal(p.text,true,cached));};
    const hit=governor.cached(key);
    if(hit!==undefined){finish(hit,true);return;}
    if(automatic&&!governor.worthAsking(mode,scope,text))return;
    const wait=governor.wait(automatic);
    if(wait>0){if(automatic)aiTimer.current=setTimeout(()=>void ask(mode,true),wait);else setAiError(`Pausa per rispettare i limiti del provider: riprova tra ${Math.ceil(wait/1000)} s.`);return;}
    governor.started();const controller=new AbortController();pending.current=controller;setBusy(true);
    try{const answer=await streamAssist(payload,controller.signal,a=>{if(controller.signal.aborted||rev!==revision.current)return false;const p=splitWarning(a);if(p.warning)setAiWarning(p.warning);if(p.text)showSuggestion(proposal(p.text,false));});
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
    current.current={id:d.id,version:d.version,title:d.title};setActive(d.id);setTitle(d.title);dirty.current=false;revision.current++;setStatus('Tutte le modifiche salvate');setWords(editorRef.current?.getText().trim().split(/\s+/).filter(Boolean).length||0);setCharacters(editorRef.current?.getText().length||0);analyseLocally(true);await attachProject(d.id);rememberWriting(d.id,d.title,editorRef.current?.getText({blockSeparator:'\n'})||'');
  }catch(err){setError((err as Error).message);}}
  async function newDocument(){if(!await save())return;clearSuggestion();suppress.current=true;editorRef.current?.commands.setContent(EMPTY);suppress.current=false;current.current={id:'',version:0,title:'Senza titolo'};setActive('');setTitle('Senza titolo');setWords(0);setCharacters(0);markDirty();await save();await attachProject(current.current.id);analyseLocally(true);editorRef.current?.commands.focus();}
  async function reloadProfiles(){const data=await api('profiles');setProfiles(data.profiles);setVaultReady(data.vaultReady);setProfile(p=>data.profiles.some((x:Profile)=>x.id===p)?p:data.profiles[0]?.id||'');}
  useEffect(()=>{if(!editor)return;let cancelled=false;(async()=>{try{const list=await api('documents');if(cancelled)return;setDocs(list);await reloadProfiles();if(cancelled)return;if(list.length)await loadDocument(list[0].id);else{suppress.current=true;editor.commands.setContent(EMPTY);suppress.current=false;markDirty();await save();await attachProject(current.current.id);}setMode(readMode());setLoaded(true);}catch(err){setError((err as Error).message);setStatus('Connessione non riuscita');}})();return()=>{cancelled=true;};},[editor]);
  useEffect(()=>{const before=(e:BeforeUnloadEvent)=>{void saveProject();if(dirty.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',before);return()=>{window.removeEventListener('beforeunload',before);void saveProject();if(fpTimer.current)clearTimeout(fpTimer.current);pending.current?.abort();if(aiTimer.current)clearTimeout(aiTimer.current);if(saveTimer.current)clearTimeout(saveTimer.current);};},[saveProject]);
  useEffect(()=>{clearSuggestion();setAiWarning('');},[profile,aiOn,autoMode,tone,mode]);
  function changeMode(next:Mode){setMode(next);try{localStorage.setItem('scrivia:mode',next);}catch{}}
  useEffect(()=>{setTheme(readTheme());},[]);
  // The static build registers the service worker in site/main.tsx; the server build does it here.
  useEffect(()=>{if(!LOCAL)setupPwa('/sw.js',process.env.NODE_ENV==='production');return onInstallAvailable(setInstallable);},[]);
  useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const apply=()=>{document.documentElement.dataset.theme=theme==='system'?(media.matches?'dark':'light'):theme;};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);},[theme]);
  function cycleTheme(){const next=THEMES[(THEMES.indexOf(theme)+1)%THEMES.length];setTheme(next);try{localStorage.setItem('scrivia:theme',next);}catch{}}
  const themeLabel=theme==='light'?'Tema chiaro':theme==='dark'?'Tema scuro':'Tema di sistema';
  useEffect(()=>{editor?.setEditable(loaded&&!repoBusy,false);},[editor,loaded,repoBusy]);
  useEffect(()=>{if(!settings&&!history&&!projectOpen&&!repoOpen&&!memoryOpen)return;const previous=document.activeElement as HTMLElement|null;const modal=document.querySelector('[role="dialog"]') as HTMLElement|null;const controls=()=>Array.from(modal?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]')||[]);controls()[0]?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setSettings(false);setHistory(null);setProjectOpen(false);setMemoryOpen(false);}if(event.key==='Tab'){const list=controls();if(!list.length)return;const first=list[0],last=list[list.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[settings,history,projectOpen,repoOpen,memoryOpen]);
  // Full screen covers the whole browser window; the browser's own exit (Esc, F11) keeps the button in sync.
  useEffect(()=>{setCanFullscreen(!!document.fullscreenEnabled);const sync=()=>setFullscreen(!!document.fullscreenElement);sync();document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync);},[]);
  function toggleFullscreen(){(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(()=>setNotice('Il browser non consente lo schermo intero.'));}
  useEffect(()=>{setPages(readPages());setVersionLabel(buildLabel());},[]);
  // The static build checks version.json: a newer deploy is announced with a button to load it.
  // Desktop installer for this computer, from the latest GitHub release (hidden if there is none).
  useEffect(()=>{const c=new AbortController();findInstaller(c.signal).then(setInstaller,()=>{});return ()=>c.abort();},[]);
  useEffect(()=>LOCAL?watchForUpdates('./version.json',commit=>setUpdate(commit)):undefined,[]);
  async function loadUpdate(){if(!await save())return;await saveProject();await applyUpdate();}
  function changePages(n:number){setPages(n);try{localStorage.setItem('scrivia:pages',String(n));}catch{}}
  // Counts the pages the text fills and zooms out so the chosen number of pages fits the window.
  const layoutPages=useCallback(()=>{const paper=paperRef.current,canvas=canvasRef.current,dom=editorRef.current?.isDestroyed?null:editorRef.current?.view.dom as HTMLElement|undefined;if(!paper||!canvas||!dom)return;
    if(!pages){paper.style.removeProperty('--pages');paper.style.zoom='';return;}
    const box=dom.getBoundingClientRect(),scale=box.width/(dom.offsetWidth||1)||1,last=dom.lastElementChild?.getBoundingClientRect();
    const filled=last?Math.floor(((last.right-box.left)/scale-PAGE.margin)/(PAGE.width+PAGE.gap))+1:1;paper.style.setProperty('--pages',String(Math.max(1,filled)));
    const style=getComputedStyle(canvas),room=canvas.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),height=canvas.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    const fitWidth=room/(pages*(PAGE.width+PAGE.gap)-PAGE.gap),fit=pages>1?Math.min(fitWidth,height/PAGE.height):fitWidth;paper.style.zoom=String(Math.max(0.15,Math.min(1,fit)));},[pages]);
  useEffect(()=>{if(!editor)return;layoutPages();editor.on('update',layoutPages);const observer=new ResizeObserver(()=>layoutPages());if(canvasRef.current)observer.observe(canvasRef.current);return()=>{editor.off('update',layoutPages);observer.disconnect();};},[editor,layoutPages]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(timer);},[notice]);

  async function saveToRepository(copy=false){
    setRepoBusy(true);clearSuggestion();
    try{if(!await save())throw new Error('La copia nell’app non è ancora salvata. Riprova prima di inviare a GitHub.');await saveProject();if(projectDirty.current)throw new Error('Salva il progetto creativo prima di inviare a GitHub.');
      const e=editorRef.current;if(!e||!current.current.id)throw new Error('Apri un documento prima di salvarlo su GitHub.');
      await saveGitHubDocument(current.current.id,current.current.title,e.getJSON(),projectRef.current,copy);setNotice(copy?'Copia salvata su GitHub':'Documento salvato su GitHub');setError('');setRepoError('');
    }finally{setRepoBusy(false);}
  }
  async function requestRepositorySave(){if(!githubConnected()){setRepoOpen('save');return;}try{await saveToRepository();}catch(err){setRepoError((err as Error).message);}}
  async function loadFromRepository(remote:RepositoryDocument){
    setRepoBusy(true);clearSuggestion();
    try{if(!await save())throw new Error('Salva prima le modifiche nell’app.');await saveProject();if(projectDirty.current)throw new Error('Salva prima le modifiche del progetto creativo.');
      const list:Doc[]=await api('documents');let localId=githubLocalId(remote.document.id,list.map(d=>d.id)),old:any;
      if(localId){old=await api('documents?id='+encodeURIComponent(localId));const oldProject=await api('projects?document='+encodeURIComponent(localId));
        if(!await githubLocalUnchanged(localId,old.title,JSON.parse(old.content),oldProject)){localId=undefined;old=undefined;}
      }
      if(old)await api('revisions',{document:old.id,title:old.title,content:JSON.parse(old.content)});
      const result=await api('documents',{id:localId||'',version:old?.version||0,title:remote.document.title,content:remote.document.content});
      await api('projects',{document:result.id,data:remote.document.project});
      await loadDocument(result.id);if(current.current.id!==result.id||current.current.version!==result.version)throw new Error('Documento copiato nell’app, ma apertura non completata. Riprova dall’elenco documenti.');
      await bindGitHubDocument(result.id,remote);setDocs(await api('documents'));setNotice('Documento caricato da GitHub; eventuali modifiche locali precedenti sono conservate.');setError('');setRepoError('');
    }finally{setRepoBusy(false);}
  }
  async function saveProfile(){setFormBusy(true);setError('');try{const result=await api('profiles',form);await reloadProfiles();setProfile(result.id);setForm({id:'',name:'',provider:'openai',model:PROVIDERS.openai.model,key:'',baseUrl:'',dailyLimit:500});setNotice('Profilo API salvato');}catch(err){setError((err as Error).message);}finally{setFormBusy(false);}}
  async function removeProfile(p:Profile){if(!window.confirm(`Rimuovere il profilo “${p.name}”? Potrai aggiungerlo nuovamente con la tua chiave.`))return;try{await api('profiles',{id:p.id},'DELETE');await reloadProfiles();}catch(err){setError((err as Error).message);}}
  async function exportFile(type:string){if(!editor)return;setMenu(false);const safe=title.replace(/[<>:"/\\|?*]/g,'_')||'Documento';try{
    if(type==='txt')download(new Blob([editor.getText()],{type:'text/plain;charset=utf-8'}),safe+'.txt');
    if(type==='html')download(new Blob([`<!doctype html><html lang="it"><meta charset="utf-8"><style>body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style><body>${editor.getHTML()}</body></html>`],{type:'text/html;charset=utf-8'}),safe+'.html');
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
  const Tool=({label,tip,icon:Icon,action,on=false}:{label:string;tip?:string;icon:any;action:()=>void;on?:boolean})=><button className={'tool '+(on?'active':'')} data-tip={tip||label} aria-label={label} aria-pressed={on} onMouseDown={e=>e.preventDefault()} onClick={action}><Icon size={17}/></button>;

  function writeDictated(spoken:string){const e=editorRef.current;if(!e||e.isDestroyed||!e.isEditable)return;const text=dictationText(spoken,beforeCursor(e.state.selection.$from));if(!text)return;
    let chain=e.chain();text.split('\n').forEach((line,i)=>{if(i)chain=chain.splitBlock();if(line)chain=chain.insertContent({type:'text',text:line});});chain.scrollIntoView().run();}
  function toggleDictation(){if(dictation.current){dictation.current.stop();return;}setDictError('');setListening(true);
    dictation.current=startDictation({onText:writeDictated,onInterim:setHeard,onEnd:message=>{dictation.current=null;setListening(false);setHeard('');if(message)setDictError(message);}});}
  useEffect(()=>{setCanDictate(dictationSupported());return()=>dictation.current?.stop();},[]);
  const dictateTip=listening?'Ferma la dettatura':'Dettatura: parla e il testo viene scritto al cursore. Di’ «virgola», «punto», «punto interrogativo», «a capo» per la punteggiatura';
  async function openHistory(){try{setHistory(await api('documents?id='+active+'&history=1'));}catch(err){setError((err as Error).message);}}
  // Browser prompt where there is one (Chrome, Edge, Android); otherwise the steps (Safari on iPhone, Firefox…).
  function installApp(){setSheet(null);if(installable)void promptInstall();else setSheet('install');}
  const closeSheet=useCallback(()=>setSheet(null),[]);
  return <div className={'app '+(focus?'focus-mode':'')+(sidebar?'':' sidebar-hidden')+(mobileAI?' mobile-ai':'')+(pages?' paged':'')+(simple?' simple':'')+(simple&&sheet==='docs'?' m-docs':'')}>
    <Tooltips/>
    <aside className="library"><div className="brand"><span className="brand-icon"><WandSparkles size={21}/></span><span>scrivia<span className="brand-dot">.</span></span><small>AI</small></div>
      <button className="new-doc" data-tip="Crea un documento vuoto; quello aperto viene salvato prima" onClick={()=>{setSheet(null);void newDocument();}} disabled={!loaded}><Plus size={17}/>Nuovo documento<span>＋</span></button>
      <div className="library-label">IL TUO SPAZIO</div><div className="library-current"><FileText size={17}/>Tutti i documenti <small>{docs.length}</small></div>
      <label className="doc-search" data-tip="Filtra l’elenco dei documenti per titolo"><Search size={15}/><input placeholder="Cerca un documento" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <div className="library-label recent-label">RECENTI</div><div className="doc-list">{docs.filter(d=>d.title.toLowerCase().includes(search.toLowerCase())).map(d=><button key={d.id} className={'doc-item '+(active===d.id?'selected':'')} data-tip={'Apri «'+d.title+'» · modificato il '+date(d.updated)} onClick={()=>{setSheet(null);void loadDocument(d.id);}}><FileText size={18}/><span><strong>{d.title}</strong><small>{date(d.updated)}</small></span>{active===d.id&&<span className="selected-dot"/>}</button>)}{!docs.length&&loaded&&<p className="muted">Crea il tuo primo documento.</p>}</div>
      <div className="library-bottom"><div className="privacy-mini"><ShieldCheck size={18}/><div><strong>Il tuo spazio privato</strong><small>{LOCAL?'Documenti salvati in questo browser':'Documenti salvati nel cloud'}</small></div></div><button data-tip="Collega i tuoi account AI (OpenAI, Anthropic…) e gestisci chiavi e limiti" onClick={()=>setSettings(true)}><Settings2 size={18}/>Provider e chiavi API<ChevronRight size={15}/></button><div className="user"><span>F</span><div>Il mio spazio<small>Scrivia AI · personale</small></div></div></div>
    </aside>
    <main className="main"><header className="topbar"><div className="document-heading">{simple&&<button className="m-btn" aria-label="I tuoi documenti" onClick={()=>setSheet('docs')}><Menu size={24}/></button>}<button className="tool sidebar-toggle" aria-label="Mostra o nascondi documenti" data-tip="Mostra o nascondi l’elenco dei documenti a sinistra" onClick={()=>setSidebar(!sidebar)}><PanelLeftClose size={19}/></button><div><input aria-label="Titolo documento" disabled={repoBusy} maxLength={150} value={title} onChange={e=>{setTitle(e.target.value);current.current.title=e.target.value.trim()||'Senza titolo';markDirty();}}/><div className={'save-state '+(status==='Non salvato'?'bad':'')}><span className="save-dot"/>{status}</div></div></div><div className="header-actions">{simple&&<>{!standalone&&<button className="m-btn m-install m-keep" onClick={installApp}><Download size={18}/>Installa</button>}<button className="m-btn m-keep" aria-label="Altre azioni" onClick={()=>setSheet('more')}><Ellipsis size={24}/></button></>}{narrow&&!simple&&<button className="m-full" data-tip="Torna alla modalità semplice per telefono" onClick={()=>setSimple(true)}><Sparkles size={15}/>Semplice</button>}<button className="tool mobile-ai-toggle" aria-label="Mostra assistente AI" data-tip="Apri o chiudi il pannello dell’assistente AI" onClick={()=>setMobileAI(!mobileAI)}><Sparkles size={17}/></button>{installer&&<button className="quiet install-app" data-tip={`Scarica l’app desktop per ${installer.system} (v${installer.version}, ${Math.round(installer.size/1048576)} MB): si apre nella sua finestra, funziona offline e chiama i provider AI senza i limiti del browser. I documenti salvati qui nel browser non vengono copiati: esportali con «Backup Scrivia»`} onClick={()=>{location.href=installer.url;}}><MonitorDown size={17}/><span>App desktop</span></button>}{installable&&<button className="quiet install-app" data-tip="Installa Scrivia come app sul dispositivo: si apre nella sua finestra, anche offline" onClick={()=>void promptInstall()}><Download size={17}/><span>Installa</span></button>}<button className="tool" data-tip={themeLabel+': clic per passare a '+(theme==='light'?'scuro':theme==='dark'?'quello di sistema':'chiaro')} aria-label={themeLabel+': cambia tema'} onClick={cycleTheme}>{theme==='light'?<Sun size={17}/>:theme==='dark'?<Moon size={17}/>:<Monitor size={17}/>}</button><button className="tool" aria-label="Impostazioni provider" data-tip="Provider e chiavi API: collega o modifica gli account AI" onClick={()=>setSettings(true)}><Settings2 size={17}/></button><button className="quiet" data-tip="Versioni precedenti del documento: confrontale e ripristinane una" onClick={()=>void openHistory()}><Clock3 size={17}/><span>Cronologia</span></button><button className={'tool '+(focus?'active':'')} aria-label="Modalità concentrazione" aria-pressed={focus} data-tip={focus?'Esci dalla modalità concentrazione: tornano i pannelli laterali':'Modalità concentrazione: nasconde i pannelli laterali e lascia solo la pagina'} onClick={()=>setFocus(!focus)}><Maximize2 size={17}/></button>{canFullscreen&&<button className={'tool '+(fullscreen?'active':'')} aria-label={fullscreen?'Esci da schermo intero':'Schermo intero'} aria-pressed={fullscreen} data-tip={fullscreen?'Esci dallo schermo intero (anche con Esc)':'Schermo intero: l’app occupa tutto lo schermo, senza barre del browser'} onClick={toggleFullscreen}>{fullscreen?<Minimize size={17}/>:<Fullscreen size={17}/>}</button>}<div className="export-wrap"><button className="export" data-tip="Scarica il documento in un altro formato o stampalo" onClick={()=>setMenu(!menu)}><ArrowDownToLine size={16}/>Esporta<ChevronDown size={14}/></button>{menu&&<div className="dropdown">{[['docx','Word (.docx)','Documento modificabile con Word, LibreOffice o Google Docs'],['pdf','Stampa / PDF','Apre la stampa del browser: scegli «Salva come PDF» per ottenere il file'],['txt','Testo (.txt)','Solo il testo, senza formattazione'],['html','Pagina HTML','Pagina web apribile in qualsiasi browser'],['json','Backup Scrivia','Copia completa da reimportare in Scrivia con «Importa»']].map(([v,l,t])=><button key={v} data-tip={t} onClick={()=>void exportFile(v)}>{l}</button>)}</div>}</div></div></header>
      <nav className="menu-bar"><select className="mobile-docs" aria-label="Apri documento" value={active} onChange={e=>void loadDocument(e.target.value)}><option value="" disabled>Documenti</option>{docs.map(d=><option value={d.id} key={d.id}>{d.title}</option>)}</select><button className="mobile-newdoc" aria-label="Crea nuovo documento" data-tip="Crea un documento vuoto" disabled={!loaded} onClick={()=>void newDocument()}><Plus size={17}/></button><button className="chosen" data-tip="Torna alla scrittura e chiudi la ricerca" onClick={()=>setShowFind(false)}>Scrivi</button><button disabled={!loaded||repoBusy} onClick={()=>void requestRepositorySave()}>Salva su GitHub</button><button disabled={!loaded||repoBusy} onClick={()=>setRepoOpen('load')}>Carica da GitHub</button><button onClick={()=>setMemoryOpen(true)}>La mia voce</button><button data-tip="Carica PDF, Word e altri testi tuoi o di un autore: le previsioni ne seguono stile e mentalità" onClick={()=>setKbOpen(true)}>Knowledge base</button><label className="import-label" data-tip="Apri un file Word (.docx), di testo (.txt) o un backup Scrivia (.json) come nuovo documento">Importa<input type="file" accept=".docx,.txt,.json" onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.target.value='';}}/></label><button data-tip="Cerca una parola nel testo e, se vuoi, sostituiscila" onClick={()=>setShowFind(!showFind)}>Trova e sostituisci</button><label className="page-view" data-tip="Vista continua, oppure il testo diviso in pagine A4 con 1, 2, 3 o 4 pagine visibili insieme"><Columns2 size={14}/><select aria-label="Pagine visibili" value={pages} onChange={e=>changePages(+e.target.value)}>{PAGE_VIEWS.map(n=><option key={n} value={n}>{n?n===1?'1 pagina':n+' pagine':'Vista continua'}</option>)}</select></label><div className="menu-spacer"/><span><Sparkles size={13}/>Il tuo prossimo pensiero, un po’ più chiaro.</span></nav>
      <div className="formatbar" aria-label="Formattazione"><Tool label="Annulla" tip="Annulla l’ultima modifica (Ctrl+Z)" icon={Undo2} action={()=>{editor?.chain().focus().undo().run();}}/><Tool label="Ripeti" tip="Ripeti la modifica annullata (Ctrl+Y)" icon={Redo2} action={()=>{editor?.chain().focus().redo().run();}}/>{canDictate&&<Tool label={listening?'Ferma dettatura':'Dettatura vocale'} tip={dictateTip} icon={Mic} on={listening} action={toggleDictation}/>}<i/>
        <select aria-label="Stile paragrafo" data-tip="Trasforma il paragrafo in testo normale, titolo o sottotitolo" value={editor?.isActive('heading',{level:1})?'h1':editor?.isActive('heading',{level:2})?'h2':'p'} onChange={e=>{if(e.target.value==='p')editor?.chain().focus().setParagraph().run();else editor?.chain().focus().toggleHeading({level:e.target.value==='h1'?1:2}).run();}}><option value="p">Testo normale</option><option value="h1">Titolo</option><option value="h2">Sottotitolo</option></select>
        <select aria-label="Carattere" data-tip="Tipo di carattere del testo selezionato: Sistema usa il font pulito predefinito" value={editor?.getAttributes('textStyle').fontFamily||''} onChange={e=>{const chain=editor?.chain().focus();if(e.target.value)chain?.setFontFamily(e.target.value).run();else chain?.unsetFontFamily().run();}}><option value="">Sistema</option><option>Georgia</option><option>Arial</option><option>Times New Roman</option><option>Verdana</option></select>
        <select className="font-size" aria-label="Dimensione carattere" data-tip="Dimensione del testo selezionato" defaultValue="18px" onChange={e=>editor?.chain().focus().setFontSize(e.target.value).run()}>{['14px','16px','18px','20px','24px','32px'].map(s=><option key={s}>{s}</option>)}</select><i/>
        <Tool label="Grassetto" tip="Grassetto: testo più marcato (Ctrl+B)" icon={Bold} on={editor?.isActive('bold')} action={()=>{editor?.chain().focus().toggleBold().run();}}/><Tool label="Corsivo" tip="Corsivo: testo inclinato (Ctrl+I)" icon={Italic} on={editor?.isActive('italic')} action={()=>{editor?.chain().focus().toggleItalic().run();}}/><Tool label="Sottolineato" tip="Sottolinea il testo selezionato (Ctrl+U)" icon={Underline} on={editor?.isActive('underline')} action={()=>{editor?.chain().focus().toggleUnderline().run();}}/><Tool label="Evidenzia" tip="Evidenzia il testo selezionato con uno sfondo colorato" icon={Highlighter} on={editor?.isActive('highlight')} action={()=>{editor?.chain().focus().toggleHighlight({color:'#e0e8b9'}).run();}}/><label className="color-tool" data-tip="Scegli il colore del testo selezionato"><span>A</span><input type="color" aria-label="Colore testo" defaultValue="#272b29" onChange={e=>editor?.chain().focus().setColor(e.target.value).run()}/></label><i/>
        <Tool label="Allinea a sinistra" tip="Allinea il paragrafo al margine sinistro" icon={AlignLeft} action={()=>{editor?.chain().focus().setTextAlign('left').run();}}/><Tool label="Centra" tip="Centra il paragrafo nella pagina" icon={AlignCenter} action={()=>{editor?.chain().focus().setTextAlign('center').run();}}/><Tool label="Allinea a destra" tip="Allinea il paragrafo al margine destro" icon={AlignRight} action={()=>{editor?.chain().focus().setTextAlign('right').run();}}/><i/>
        <Tool label="Elenco puntato" tip="Trasforma i paragrafi in un elenco puntato" icon={List} action={()=>{editor?.chain().focus().toggleBulletList().run();}}/><Tool label="Elenco numerato" tip="Trasforma i paragrafi in un elenco numerato" icon={ListOrdered} action={()=>{editor?.chain().focus().toggleOrderedList().run();}}/><Tool label="Inserisci tabella" tip="Inserisce una tabella 3×3 nel punto del cursore" icon={Table2} action={()=>{editor?.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run();}}/><Tool label="Inserisci collegamento" tip="Trasforma il testo selezionato in un link a una pagina web" icon={Link2} action={()=>{const url=window.prompt('Indirizzo del collegamento (https://…)');if(url&&/^https?:\/\//i.test(url))editor?.chain().focus().setLink({href:url}).run();}}/>
        <label className="tool image-upload" data-tip="Inserisci un’immagine PNG, JPEG o WebP (fino a 800 KB)"><ImagePlus size={17}/><input type="file" aria-label="Inserisci immagine" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>800000){setError('Scegli un’immagine fino a 800 KB.');return;}const reader=new FileReader();reader.onload=()=>editor?.chain().focus().setImage({src:String(reader.result),alt:f.name}).run();reader.readAsDataURL(f);e.target.value='';}}/></label>
      </div>
      {editor?.isActive('table')&&<div className="table-actions"><button data-tip="Aggiunge una riga sotto quella del cursore" onClick={()=>editor.chain().focus().addRowAfter().run()}>+ Riga</button><button data-tip="Aggiunge una colonna a destra di quella del cursore" onClick={()=>editor.chain().focus().addColumnAfter().run()}>+ Colonna</button><button data-tip="Elimina la riga in cui si trova il cursore" onClick={()=>editor.chain().focus().deleteRow().run()}>Elimina riga</button><button data-tip="Elimina la colonna in cui si trova il cursore" onClick={()=>editor.chain().focus().deleteColumn().run()}>Elimina colonna</button><button data-tip="Elimina l’intera tabella" onClick={()=>editor.chain().focus().deleteTable().run()}>Rimuovi tabella</button></div>}
      {showFind&&<div className="findbar"><Search size={15}/><input aria-label="Cerca nel testo" placeholder="Trova nel testo" value={find} onChange={e=>setFind(e.target.value)}/><input aria-label="Sostituisci con" placeholder="Sostituisci con" value={replace} onChange={e=>setReplace(e.target.value)}/><button data-tip="Seleziona la prossima occorrenza nel testo (senza distinzione tra maiuscole e minuscole)" onClick={()=>findNext()}>Trova</button><button data-tip="Sostituisce l’occorrenza selezionata e passa alla successiva con «Trova»" onClick={()=>findNext(true)}>Sostituisci selezione</button><button aria-label="Chiudi ricerca" onClick={()=>setShowFind(false)}><X size={16}/></button></div>}
      {repoError&&<div role="alert" className="error-banner">{repoError}<button onClick={()=>setRepoOpen('load')}>Apri GitHub</button><button aria-label="Chiudi errore GitHub" onClick={()=>setRepoError('')}><X size={15}/></button></div>}
      {error&&<div role="alert" className="error-banner">{error}<button data-tip="Prova di nuovo a salvare le modifiche" onClick={()=>void save()}>Riprova salvataggio</button><button aria-label="Chiudi errore" onClick={()=>setError('')}><X size={15}/></button></div>}
      <div className="writing-area"><div className="canvas" ref={canvasRef}><div className="page-topline"><span>DOCUMENTO PERSONALE</span><SourceBadge source={source} busy={busy} onClick={()=>setKbOpen(true)}/></div>{simple&&<div className="m-source"><SourceBadge source={source} busy={busy} compact onClick={()=>setKbOpen(true)}/></div>}<div className="paper" ref={paperRef} style={pages?{'--page-width':PAGE.width+'px','--page-height':PAGE.height+'px','--page-margin':PAGE.margin+'px','--page-gap':PAGE.gap+'px'} as CSSProperties:undefined}><EditorContent editor={editor}/></div><div className="page-bottom">Le idee sono tue. Le possibilità, infinite.</div></div>
        <aside className="assistant"><div className="assistant-title"><span className="spark-icon"><Sparkles size={19}/></span><div><h2>Il tuo assistente</h2><p>Un passo avanti, insieme.</p></div><span className="live-dot"/><button className="m-close" aria-label="Chiudi assistente" onClick={()=>setMobileAI(false)}><X size={22}/></button></div>
          <ModeSwitch mode={mode} setMode={changeMode}/>
          {mode==='libera'?<FreeCard fp={fp}/>:<>
          <button className="writing-memory-button" aria-label="Gestisci la memoria della mia voce" onClick={()=>setMemoryOpen(true)}><span>La mia voce</span><small>{writingMemory.enabled?writingMemory.sources.length+' testi in memoria':'In pausa'}</small></button>
          <button className="writing-memory-button" aria-label="Gestisci le knowledge base di stile" onClick={()=>setKbOpen(true)}><span>Knowledge base</span><small>{activeKb?'In uso: '+activeKb.name:kbs.length?kbs.length+' disponibili · nessuna in uso':'Carica testi tuoi o di un autore'}</small></button>
          <ProjectChip project={project} onOpen={()=>setProjectOpen(true)}/>
          <label className="profile-select" data-tip="Account AI usato per suggerimenti e analisi: aggiungine altri da Provider e chiavi API">PROFILO AI<select value={profile} onChange={e=>setProfile(e.target.value)}><option value="">Collega un provider</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {PROVIDERS[p.provider].name}</option>)}</select></label>
          {mode==='assistita'&&<section className="ai-card"><div className="ai-card-heading"><span>Suggerimenti discreti</span><button role="switch" aria-checked={aiOn} aria-label="Suggerimenti automatici" data-tip={aiOn?'Metti in pausa i suggerimenti automatici':'Riattiva i suggerimenti automatici mentre scrivi'} className={'switch '+(aiOn?'on':'')} onClick={()=>setAiOn(!aiOn)}><span/></button></div><p>Le parole giuste, nella tua voce, mentre scrivi.</p><div className="segmented"><button className={autoMode==='complete'?'active':''} data-tip="Propone come continuare la frase, correggendo refusi e ripetizioni accidentali" onClick={()=>setAutoMode('complete')}>Completa</button><button className={autoMode==='rewrite'?'active':''} data-tip="Mentre scrivi propone una versione più chiara della frase corrente" onClick={()=>setAutoMode('rewrite')}>Migliora frase</button></div><IntentRow detected={detected} choice={intentChoice} setChoice={setIntentChoice}/><label className="delay-label" data-tip="Quanto aspettare dopo l’ultima battuta prima di chiedere un suggerimento: più lunga, meno richieste al provider">Pausa prima del suggerimento <strong>{delay} ms</strong><input aria-label="Pausa suggerimenti" type="range" min="400" max="1600" step="100" value={delay} onChange={e=>setDelay(+e.target.value)}/></label><div className="ai-card-footer"><span className={'tiny-dot '+(!aiOn?'off':'')}/>{!aiOn?'Suggerimenti in pausa':activeProfile?'Pronto a scrivere con te':'In attesa del tuo provider'}</div></section>}
          {mode==='coscrittura'&&<><IntentRow detected={detected} choice={intentChoice} setChoice={setIntentChoice}/>
            <div className="segmented cowrite-tabs" role="tablist"><button role="tab" aria-selected={coTab==='genera'} className={coTab==='genera'?'active':''} data-tip="Fai scrivere o riscrivere un brano all’AI" onClick={()=>setCoTab('genera')}><PenLine size={13}/>Genera</button><button role="tab" aria-selected={coTab==='direzioni'} className={coTab==='direzioni'?'active':''} data-tip="Esplora tre possibili sviluppi della trama dal punto del cursore" onClick={()=>setCoTab('direzioni')}><GitBranch size={13}/>Direzioni</button></div>
            {coTab==='genera'?<div className="rewrite-actions"><button data-tip="Scrive il paragrafo successivo partendo dal cursore, nella voce scelta nel progetto" onClick={()=>void ask('continue')}><PenLine size={17}/><span>Continua la scena<small>Un paragrafo dal cursore, nella voce scelta</small></span><ChevronRight size={15}/></button><button data-tip="Riscrive la selezione (o il paragrafo del cursore) nella voce d’autore scelta, senza cambiarne il contenuto" onClick={()=>void ask('voice')}><Drama size={17}/><span>Riscrivi nella voce scelta<small>Selezione o paragrafo, stesso contenuto</small></span><ChevronRight size={15}/></button><button data-tip="Propone una versione più chiara e scorrevole della selezione o del paragrafo" onClick={()=>void ask('rewrite')}><WandSparkles size={17}/><span>Migliora la scrittura<small>Più chiara, sempre tua</small></span><ChevronRight size={15}/></button><button data-tip="Accorcia la selezione o il paragrafo togliendo il superfluo" onClick={()=>void ask('shorten')}><AlignLeft size={17}/><span>Rendi più conciso<small>Vai dritto al punto</small></span><ChevronRight size={15}/></button><button data-tip="Riscrive la selezione o il paragrafo con un registro professionale" onClick={()=>void ask('formal')}><FileText size={17}/><span>Tono professionale<small>Il registro giusto</small></span><ChevronRight size={15}/></button></div>
            :editor&&<Directions editor={editor} run={run} ctx={narrative} ready={!!activeProfile} onWrite={direction=>void ask('continue',false,direction)}/>}</>}
          {mode==='revisione'&&editor&&<Review editor={editor} project={project} setProject={setProject} run={run} ctx={narrative} fp={fp} ready={!!activeProfile} jump={jump}/>}
          {mode!=='revisione'&&<div className={'suggestion-box'+(suggestion?' has-proposal':'')+(busy?' is-busy':'')} aria-live="polite"><div><Sparkles size={15}/><strong>{busy&&!suggestion?'Sto pensando…':suggestion?(SUGGESTION_TITLES[suggestion.mode]||'Correzione proposta'):'Il prossimo pensiero'}</strong>{(busy||suggestion)&&<SourceBadge source={source} busy={busy} compact onClick={()=>setKbOpen(true)}/>}{(busy||suggestion)&&<button aria-label="Scarta suggerimento" data-tip="Scarta il suggerimento" onClick={clearSuggestion}><X size={14}/></button>}</div>{[aiWarning,aiError].filter(Boolean).map(w=><p key={w} className="ai-warning" role="alert"><TriangleAlert size={14}/><span>{w}</span><button aria-label="Chiudi avviso" onClick={()=>{setAiWarning('');setAiError('');}}><X size={12}/></button></p>)}{suggestion?<><p className="proposal">{(suggestion.mode==='complete'||suggestion.mode==='continue')&&suggestion.original===undefined?<>{suggestion.base&&<span className="proposal-context">{suggestion.base.length>70?'…'+suggestion.base.slice(-70).trimStart():suggestion.base}</span>}<mark>{suggestion.text}</mark></>:proposalDiff?proposalDiff.map((part,i)=>part.type==='same'?<span key={i}>{part.text}</span>:part.type==='add'?<ins key={i}>{part.text}</ins>:<del key={i}>{part.text}</del>):suggestion.text}</p>{proposalDiff&&<small className="proposal-note">{proposalDiff.some(p=>p.type!=='same')?<><ins>in verde</ins> le parole nuove, <del>barrate</del> quelle rimosse</>:'Nessuna modifica necessaria: il testo va già bene.'}</small>}{proposalVoice!==null&&<small className="proposal-note voice-match"><Drama size={12}/>Vicinanza alla tua impronta stilistica: <strong>{proposalVoice}%</strong></small>}{suggestion.cached&&<small className="proposal-note">Dalla memoria: nessuna nuova chiamata al provider.</small>}<div className="proposal-actions"><button className="accept" data-tip="Inserisce la proposta nel testo (tasto Tab)" disabled={!suggestion.done} onClick={acceptSuggestion}><Check size={15}/>Accetta<kbd>Tab</kbd></button><button className="dismiss" data-tip="Ignora la proposta e continua a scrivere (tasto Esc)" onClick={clearSuggestion}>Scarta<kbd>Esc</kbd></button></div></>:!aiWarning&&!aiError&&<p>{!profiles.length?'Collega una chiave API per dare una marcia in più alle tue idee.':'Scrivi una frase. Il suggerimento apparirà qui, senza interrompere il tuo ritmo.'}</p>}{!profiles.length&&<button className="connect" data-tip="Aggiungi la chiave API di un provider per attivare l’AI" onClick={()=>setSettings(true)}><Plus size={14}/>Collega il tuo provider</button>}</div>}
          </>}
          <div className="assistant-footnote"><ShieldCheck size={15}/><p>Il testo viene inviato al provider selezionato; con Ollama e LM Studio va al modello sul dispositivo. <button data-tip="Apri Provider e chiavi API" onClick={()=>setSettings(true)}>Gestisci le API</button></p></div><div className="shortcuts"><span><kbd>Tab</kbd> accetta</span><span><kbd>Esc</kbd> ignora</span></div>
        </aside></div>
      {simple&&!mobileAI&&(suggestion||busy||aiError||aiWarning)&&<div className="m-proposal" aria-live="polite" onMouseDown={e=>e.preventDefault()}>
        <div className="m-proposal-head"><Sparkles size={16}/><strong>{busy&&!suggestion?'Sto pensando…':suggestion?(SUGGESTION_TITLES[suggestion.mode]||'Correzione proposta'):'Avviso'}</strong>{(busy||suggestion)&&<SourceBadge source={source} busy={busy} compact onClick={()=>setKbOpen(true)}/>}<button aria-label="Scarta" onClick={()=>{clearSuggestion();setAiWarning('');setAiError('');}}><X size={20}/></button></div>
        {[aiWarning,aiError].filter(Boolean).map(w=><p key={w} className="m-proposal-warning"><TriangleAlert size={15}/>{w}</p>)}
        {suggestion&&<><p className="m-proposal-text proposal">{proposalDiff?proposalDiff.map((part,i)=>part.type==='same'?<span key={i}>{part.text}</span>:part.type==='add'?<ins key={i}>{part.text}</ins>:<del key={i}>{part.text}</del>):suggestion.text}</p><div className="m-proposal-actions"><button className="m-accept" disabled={!suggestion.done} onClick={acceptSuggestion}><Check size={19}/>Accetta</button><button onClick={clearSuggestion}>Scarta</button></div></>}
      </div>}
      {(listening||dictError)&&<div className={'dictation-bar'+(dictError&&!listening?' bad':'')} role="status" onMouseDown={e=>e.preventDefault()}>{listening?<><span className="dictation-pulse" aria-hidden="true"/><span className="dictation-heard">{heard||'In ascolto… parla pure. Di’ «punto», «virgola», «a capo».'}</span><button onClick={toggleDictation}>Ferma</button></>:<><TriangleAlert size={15}/><span className="dictation-heard">{dictError}</span><button aria-label="Chiudi avviso" onClick={()=>setDictError('')}><X size={15}/></button></>}</div>}
      {simple&&<nav className="m-toolbar" aria-label="Strumenti di scrittura">
        {([['Annulla',Undo2,false,()=>editor?.chain().focus().undo().run()],['Ripeti',Redo2,false,()=>editor?.chain().focus().redo().run()],['Grassetto',Bold,editor?.isActive('bold'),()=>editor?.chain().focus().toggleBold().run()],['Corsivo',Italic,editor?.isActive('italic'),()=>editor?.chain().focus().toggleItalic().run()],['Titoletto',Heading2,editor?.isActive('heading',{level:2}),()=>editor?.chain().focus().toggleHeading({level:2}).run()],['Elenco puntato',List,editor?.isActive('bulletList'),()=>editor?.chain().focus().toggleBulletList().run()]] as const).map(([label,Icon,on,action])=><button key={label} className={'tool '+(on?'active':'')} aria-label={label} aria-pressed={!!on} onMouseDown={e=>e.preventDefault()} onClick={()=>{action();}}><Icon size={21}/></button>)}
        {canDictate&&<button className={'tool m-mic'+(listening?' active':'')} aria-label={listening?'Ferma dettatura':'Dettatura vocale'} aria-pressed={listening} onMouseDown={e=>e.preventDefault()} onClick={toggleDictation}><Mic size={21}/></button>}
        <button className={'m-ai'+(suggestion?' has-proposal':'')} aria-label="Assistente AI" onClick={()=>setMobileAI(true)}><Sparkles size={20}/><span>AI</span></button>
      </nav>}
      <footer className="statusbar"><span>{words} parole<span className="status-divider">|</span>{characters} caratteri</span><span data-tip="Le parole sottolineate in rosso sono segnalate dal correttore del browser: clic destro per i suggerimenti">Controllo ortografico del browser</span><span data-tip="Versione in uso: numero, commit e data di pubblicazione. Se ne esce una nuova, compare il pulsante «Aggiorna»"><span className="tiny-dot"/>Scrivia AI{versionLabel&&<span className="build-label"> · {versionLabel}</span>}</span></footer>
    </main>
    {update!==null&&<div className="update-banner" role="status"><RefreshCw size={16}/><span>È disponibile una nuova versione di Scrivia{update?' ('+update+')':''}.</span><button data-tip="Salva il documento e ricarica la pagina con la nuova versione" onClick={()=>void loadUpdate()}>Aggiorna ora</button><button aria-label="Più tardi" data-tip="Nascondi: l’aggiornamento verrà caricato alla prossima apertura" onClick={()=>setUpdate(null)}><X size={14}/></button></div>}
    {simple&&sheet==='docs'&&<div className="drawer-backdrop" onClick={closeSheet}/>}
    {simple&&mobileAI&&<div className="drawer-backdrop ai-backdrop" onClick={()=>setMobileAI(false)}/>}
    {sheet==='more'&&<Sheet title="Azioni" onClose={closeSheet}>
      <div className="sheet-list">
        <button onClick={()=>{setSheet(null);void newDocument();}}><Plus size={20}/>Nuovo documento</button><button disabled={!loaded||repoBusy} onClick={()=>{setSheet(null);void requestRepositorySave();}}>Salva su GitHub</button><button disabled={!loaded||repoBusy} onClick={()=>{setSheet(null);setRepoOpen('load');}}>Carica da GitHub</button>
        <label><FileText size={20}/>Importa un file (Word, testo, backup)<input type="file" accept=".docx,.txt,.json" onChange={e=>{const f=e.target.files?.[0];setSheet(null);if(f)void importFile(f);e.target.value='';}}/></label>
        <button onClick={()=>{setSheet(null);setShowFind(true);}}><Search size={20}/>Trova e sostituisci</button>
        <button onClick={()=>{setSheet(null);void openHistory();}}><Clock3 size={20}/>Cronologia delle versioni</button>
        <button onClick={()=>{setSheet(null);setMemoryOpen(true);}}>La mia voce</button><button onClick={()=>{setSheet(null);setKbOpen(true);}}>Knowledge base di stile</button><button onClick={()=>{setSheet(null);setSettings(true);}}><Settings2 size={20}/>Provider e chiavi API</button>
        <button onClick={cycleTheme}>{theme==='light'?<Sun size={20}/>:theme==='dark'?<Moon size={20}/>:<Monitor size={20}/>}{themeLabel} <small>tocca per cambiare</small></button>
        {!standalone&&<button onClick={installApp}><Download size={20}/>Installa l’app sul telefono</button>}
      </div>
      <h3>Esporta</h3>
      <div className="sheet-grid">{[['docx','Word'],['pdf','PDF'],['txt','Testo'],['json','Backup']].map(([v,l])=><button key={v} onClick={()=>{setSheet(null);void exportFile(v);}}><ArrowDownToLine size={18}/>{l}</button>)}</div>
      <button className="sheet-link" onClick={()=>{setSheet(null);setSimple(false);}}>Passa alla vista completa (tutti gli strumenti)</button>
    </Sheet>}
    {sheet==='install'&&<Sheet title="Installa Scrivia" onClose={closeSheet}><InstallSteps/></Sheet>}
    {notice&&<div className="toast" role="status"><Check size={16}/>{notice}</div>}
    {kbOpen&&<KnowledgeBaseModal bases={kbs} activeId={activeKbId} ready={!!activeProfile} error={kbError} onActivate={activateKb} onSave={saveKb} onDelete={removeKb} distill={distillKb} onClose={()=>setKbOpen(false)}/>}
    {memoryOpen&&<WritingMemoryModal memory={writingMemory} currentId={current.current.id} persistenceError={memoryError} onChange={changeWritingMemory} onLearn={learnSavedWriting} onClose={()=>setMemoryOpen(false)}/>}
    {repoOpen&&<GitHubDocuments intent={repoOpen} onSave={saveToRepository} onLoad={loadFromRepository} onClose={()=>setRepoOpen(null)}/>}
    {settings&&<div className="modal-backdrop" onClick={()=>setSettings(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="Provider e chiavi API" onClick={e=>e.stopPropagation()}><button className="modal-close tool" aria-label="Chiudi impostazioni" onClick={()=>setSettings(false)}><X size={20}/></button><span className="modal-icon"><KeyRound size={23}/></span><h2>La tua AI, alle tue condizioni.</h2><p className="modal-subtitle">Collega più account e scegli il modello adatto a ogni testo.</p><div className="security-note"><ShieldCheck size={18}/><span>{LOCAL?'Versione statica: le chiavi restano solo in questo browser (localStorage) e il testo va direttamente al provider. Usa un dispositivo personale e chiavi con limiti di spesa.':'Provider cloud: chiavi cifrate sul server. Ollama e LM Studio: profili e token restano su questo dispositivo, nel browser o nel portachiavi dell’app desktop.'}</span></div>{!vaultReady&&<p className="warning">Il server non ha ancora una chiave di cifratura configurata.</p>}{error&&<p role="alert" className="warning">{error}</p>}
      <div className="profile-list">{profiles.map(p=><div className="profile-row" key={p.id}><span className={'provider-badge '+p.provider}>{PROVIDERS[p.provider].name.slice(0,1)}</span><div><strong>{p.name}</strong><small>{PROVIDERS[p.provider].name} · {p.model} · {isDeviceProvider(p.provider)?'Su questo dispositivo':<>••••{p.hint}</>}</small><small>{p.used} / {p.daily_limit} richieste oggi (UTC)</small></div><button data-tip="Cambia nome, modello, limite o chiave di questo profilo" onClick={()=>setForm({id:p.id,name:p.name,provider:p.provider,model:p.model,key:'',baseUrl:p.baseUrl||'',dailyLimit:p.daily_limit})}>Modifica</button><button aria-label={'Rimuovi '+p.name} data-tip="Elimina questo profilo e la sua chiave" onClick={()=>void removeProfile(p)}><X size={16}/></button></div>)}</div>
      <form onSubmit={e=>{e.preventDefault();void saveProfile();}}><h3>{form.id?'Modifica profilo':'Aggiungi un profilo'}</h3><div className="form-grid"><label>Nome del profilo<input required maxLength={80} placeholder="Es. Account personale" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Provider<select value={form.provider} onChange={e=>{const p=e.target.value as Provider;setForm({...form,id:isDeviceProfile(form.id)!==isDeviceProvider(p)?'':form.id,provider:p,model:PROVIDERS[p].model,key:'',baseUrl:isDeviceProvider(p)?DEVICE_PROVIDERS[p].baseUrl:''});}}>{Object.entries(PROVIDERS).map(([id,p])=><option key={id} value={id}>{p.name}</option>)}</select></label>{isDeviceProvider(form.provider)&&<label>Indirizzo del server locale<input required type="url" value={form.baseUrl} placeholder={DEVICE_PROVIDERS[form.provider].baseUrl} onChange={e=>setForm({...form,baseUrl:e.target.value})}/></label>}<ModelPicker key={form.provider+':'+form.baseUrl+':'+form.id} provider={form.provider} model={form.model} baseUrl={form.baseUrl} token={form.key} profileId={form.id} onChange={model=>setForm(current=>({...current,model}))}/><label>Limite richieste al giorno<input type="number" min={1} max={10000} required value={form.dailyLimit} onChange={e=>setForm({...form,dailyLimit:+e.target.value})}/></label></div><label>{isDeviceProvider(form.provider)?'Token del server locale (facoltativo)':'Chiave API'} {form.id&&<small>(lascia vuoto per mantenerla)</small>}<input autoComplete="off" type="password" required={!form.id&&!isDeviceProvider(form.provider)} maxLength={4096} placeholder={isDeviceProvider(form.provider)?'Solo se il server richiede autenticazione':'Incolla la chiave del provider'} value={form.key} onChange={e=>setForm({...form,key:e.target.value})}/></label><p className="form-note">{isDeviceProvider(form.provider)?<>Il modello e il profilo restano su questo dispositivo. {DEVICE_CONNECTION_HELP}</>:<>Le richieste usano il credito del tuo account provider. Il limite conta i tentativi, anche quelli interrotti; non è un tetto di spesa in euro. Puoi modificare liberamente l’identificativo del modello; la disponibilità dipende dal tuo account provider.</>}</p><div className="form-footer"><button type="button" className="quiet" onClick={()=>setSettings(false)}>Chiudi</button><button className="primary" disabled={formBusy||(!vaultReady&&!isDeviceProvider(form.provider))} type="submit">{formBusy?'Salvataggio…':form.id?'Salva modifiche':'Collega provider'}<ChevronRight size={16}/></button></div></form>
    </section></div>}
    {projectOpen&&<ProjectModal project={project} setProject={setProject} onClose={()=>setProjectOpen(false)}/>}
    {history&&<div className="modal-backdrop" onClick={()=>setHistory(null)}><section className="modal history-modal" role="dialog" aria-modal="true" aria-label="Cronologia versioni" onClick={e=>e.stopPropagation()}><button className="modal-close tool" aria-label="Chiudi cronologia" onClick={()=>setHistory(null)}><X size={20}/></button><Clock3 size={26}/><h2>La storia delle tue idee.</h2><p className="modal-subtitle">Fino a 30 versioni precedenti, registrate al massimo una volta al minuto.</p>{!history.length&&<p className="empty-state">Le versioni appariranno qui dopo le prossime modifiche salvate.</p>}{history.map(r=><div className="revision-row" key={r.id}><div><strong>{r.title}</strong><small>{new Date(r.created).toLocaleString('it-IT')}</small></div><button data-tip="Riporta il documento a questa versione; quella attuale resta nella cronologia" onClick={async()=>{if(!window.confirm('Ripristinare questa versione? La versione attuale sarà conservata nella cronologia.'))return;if(!await save())return;try{await api('revisions',{document:active,title:current.current.title,content:editor?.getJSON()});clearSuggestion();editor?.commands.setContent(JSON.parse(r.content));current.current.title=r.title;setTitle(r.title);markDirty();if(await save())setHistory(null);}catch(err){setError((err as Error).message);}}}>Ripristina</button></div>)}</section></div>}
  </div>;
}

