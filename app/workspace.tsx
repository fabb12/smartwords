'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import { Ghost, ghostKey } from '../lib/ghost';
import { A4, Pagination, paginationKey, currentPageRange } from '../lib/pagination';
import { completionProposal } from '../lib/completion';
import { aiPreferencesKey, aiTabAction, DEFAULT_AI_PREFERENCES, readAiPreferences, storeAiPreferences, type AiPreferences } from '../lib/ai-preferences';
import { parseAiFormatting, replaceAiFormatting } from '../lib/ai-formatting';
import { AiFormatPreview } from './ai-format-preview';
import { AiBatchFormatPreview } from './ai-batch-format-preview';
import { formatRanges, formatReplacement, type FormatReplacement } from '../lib/format-only';
import { AiGovernor, sameText, sentenceTarget, wordDiff } from '../lib/ai-governor';
import { assistPrompts, splitWarning } from '../lib/providers';
import { finalizeUsage, parseUsageEvent, recordTokenUsage, type UsageEvent } from '../lib/token-usage';
import { ALL_PROVIDERS as PROVIDERS, deviceAssist, deviceModels, deviceProfileApi, isDeviceProfile, isDeviceProvider } from '../lib/device-models';
import { EMPTY_PROFILE_FORM, SettingsModal, type Profile, type ProfileForm, type SettingsTab, type Theme } from './settings';
import { applyWritingRules, readWritingRules, storeWritingRules, writingRulesInstruction, writingRulesKey, type WritingRules } from '../lib/writing-rules';
import { WritingMemoryModal } from './writing-memory';
import { EMPTY_WRITING_MEMORY, PERSONAL_VOICE_MODES, authorVoiceInstruction, learnWriting, readWritingMemory, storeWritingMemory, writingMemoryKey, writingTextFromDocument, type WritingMemory } from '../lib/writing-memory';
import { GitHubDocuments } from './github-documents';
import { bindGitHubDocument, githubConnected, githubLocalId, githubLocalUnchanged, saveGitHubDocument, type RepositoryDocument } from '../lib/github-documents';
import { localApi, localAssist } from '../lib/local-backend';
import { blocksFromDoc, chapters, describeFingerprint, detectIntent, locate, fingerprint, memorySummary, wordsOf, styleSimilarity, INTENTS, type DetectedIntent, type Fingerprint } from '../lib/narrative';
import { sanitizeBlend, voiceName, voiceInstruction } from '../lib/author-styles';
import { KB_MODES, buildKbIndex, kbInstruction, parsePersona, personaSample, styleSource, type KnowledgeBase } from '../lib/knowledge-base';
import { deleteKnowledgeBase, listKnowledgeBases, readActiveKb, saveKnowledgeBase, storeActiveKb } from '../lib/kb-store';
import { KnowledgeBaseModal, SourceBadge } from './knowledge-base';
import { applyUpdate, onInstallAvailable, promptInstall, setupPwa, watchForUpdates } from '../lib/pwa';
import { buildLabel } from '../lib/version';
import { dictationSupported, dictationText, startDictation, type Dictation } from '../lib/dictation';
import { findInstaller, type Installer } from '../lib/desktop';
import { EMPTY_PROJECT, briefText, type Project } from '../lib/project';
import { Tooltips } from './tooltips';
import { CommandMenu } from './command-menu';
import { EditorToolbars } from './editor-toolbars';
import { clipboardImage, prepareEditorImage } from '../lib/editor-images';
import { ZoomControls } from './editor-zoom';
import { readEditorZoom, sanitizeZoom, storeEditorZoom, type EditorZoom } from '../lib/editor-zoom';
import { InstallSteps, Sheet, useSimpleMode, useStandalone, useVisibleHeight } from './mobile';
import { Directions, FreeCard, IntentRow, isMode, ModeSwitch, ProjectChip, ProjectModal, Review, type Ctx, type Mode, type Run } from './companion';
import { ArrowDownToLine, ClipboardPaste, Paintbrush, BookOpen, Eye, FileUp, FolderOpen, Save, AlignCenter, AlignLeft, AlignRight, Bold, Check, ChevronDown, ChevronRight, Clock3, Columns2, Download, Ellipsis, FileText, Heading2, Menu, Fullscreen, GitBranch, Drama, PenLine, Highlighter, ImagePlus, Italic,  Link2, List, ListOrdered, Maximize2, Mic, Monitor, MonitorDown, Moon, PanelLeftClose, Plus, RefreshCw, Redo2, Search, Settings2, ShieldCheck, Minimize, Sparkles, Sun, Table2, TriangleAlert, Underline, Undo2, WandSparkles, X } from 'lucide-react';

type Doc = {id:string; title:string; updated:number; version:number};
// base/para: paragraph text and start for completions; original: the text a rewrite would replace;
// trail: whitespace between the rewritten sentence and the cursor, kept after accepting.
type Suggestion = {text:string;from:number;to:number;revision:number;mode:string;done:boolean;base?:string;para?:number;original?:string;cached?:boolean;trail?:number;content?:JSONContent[];replacements?:FormatReplacement[]};
type Revision = {id:string;title:string;content:string;created:number};
const EMPTY = {type:'doc',content:[{type:'paragraph'}]};
// The static GitHub Pages build sets this flag: storage and AI calls then stay in the browser.
const LOCAL=typeof window!=='undefined'&&window.__SCRIVIA_LOCAL__===true;
const THEMES:Theme[]=['light','dark','system'];
function readMode():Mode{try{const m=localStorage.getItem('scrivia:mode');return isMode(m)?m:'assistita';}catch{return 'assistita';}}
const EMPTY_FP=fingerprint('');
// One A4 page per row by default; optional continuous and side-by-side views.
const PAGE=A4,PAGE_VIEWS=[0,1,2,3,4];
type ToolbarGroup='document'|'text'|'paragraph'|'insert';
const ALL_TOOLS_VISIBLE={document:true,text:true,paragraph:true,insert:true};
const ESSENTIAL_TOOLS={document:false,text:false,paragraph:false,insert:false};
function readPages(){try{const raw=localStorage.getItem('scrivia:pages'),n=raw===null?1:Number(raw);return PAGE_VIEWS.includes(n)?n:1;}catch{return 1;}}
const SUGGESTION_TITLES:Record<string,string>={format:'Formattazione proposta',complete:'Continuazione proposta',continue:'Scena proposta',voice:'Riscrittura nella voce scelta'};
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

const Tool=({label,tip,icon:Icon,action,on=false,disabled=false}:{label:string;tip?:string;icon:any;action:()=>void;on?:boolean;disabled?:boolean})=><button className={'tool '+(on?'active':'')} data-tip={tip||label} aria-label={label} aria-pressed={on} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={action}><Icon size={17}/></button>;

export default function Workspace({owner='local'}:{owner?:string}={}) {
  const [writingMemory,setWritingMemory]=useState<WritingMemory>(EMPTY_WRITING_MEMORY),[memoryOpen,setMemoryOpen]=useState(false),[memoryError,setMemoryError]=useState('');
  // General writing rules from Settings: sent with every request and enforced on the answers.
  const [rules,setRulesState]=useState<WritingRules>(()=>readWritingRules(owner)),rulesRef=useRef(rules);
  const [aiPreferences,setAiPreferencesState]=useState<AiPreferences>(DEFAULT_AI_PREFERENCES);
  useEffect(()=>{const restore=setTimeout(()=>setAiPreferencesState(readAiPreferences(owner)),0);const sync=(event:StorageEvent)=>{if(event.key===aiPreferencesKey(owner)||event.key===null){clearSuggestion();setAiPreferencesState(readAiPreferences(owner));}};window.addEventListener('storage',sync);return()=>{clearTimeout(restore);window.removeEventListener('storage',sync);};},[owner]);
  function changeAiPreferences(next:AiPreferences){clearSuggestion();setAiPreferencesState(next);if(!storeAiPreferences(next,ownerRef.current))setNotice('Preferenze AI in uso, ma non salvate sul dispositivo.');}
  useEffect(()=>{rulesRef.current=rules;},[rules]);
  const writingRef=useRef(writingMemory),writingReady=useRef(false),ownerRef=useRef(owner);ownerRef.current=owner;
  // Knowledge bases (style + mindset of an author) and the one guiding the predictions.
  const [kbs,setKbs]=useState<KnowledgeBase[]>([]),[activeKbId,setActiveKbId]=useState(''),[kbOpen,setKbOpen]=useState(false),[kbError,setKbError]=useState('');
  const activeKb=useMemo(()=>kbs.find(k=>k.id===activeKbId)||null,[kbs,activeKbId]);
  const kbIndex=useMemo(()=>activeKb?buildKbIndex(activeKb):null,[activeKb]);
  const kbRef=useRef<{kb:KnowledgeBase|null;index:ReturnType<typeof buildKbIndex>|null}>({kb:null,index:null});kbRef.current={kb:activeKb,index:kbIndex};
  const [docs,setDocs]=useState<Doc[]>([]),[active,setActive]=useState(''),[title,setTitle]=useState('Senza titolo'),[loaded,setLoaded]=useState(false);
  const [profiles,setProfiles]=useState<Profile[]>([]),[profile,setProfile]=useState(''),[vaultReady,setVaultReady]=useState(false);
  const [repoOpen,setRepoOpen]=useState<null|'save'|'load'>(null),[repoBusy,setRepoBusy]=useState(false),[repoError,setRepoError]=useState('');
  const [settings,setSettings]=useState<SettingsTab|null>(null),[history,setHistory]=useState<Revision[]|null>(null),[menu,setMenu]=useState(false),[focus,setFocus]=useState(false),[sidebar,setSidebar]=useState(true),[mobileAI,setMobileAI]=useState(false);
  const [toolbarReset,setToolbarReset]=useState(0);
  const [toolGroups,setToolGroups]=useState(ALL_TOOLS_VISIBLE),[fullToolGroups,setFullToolGroups]=useState(ESSENTIAL_TOOLS);
  const [assistantVisible,setAssistantVisible]=useState(true),[fullSidebar,setFullSidebar]=useState(false),[fullAssistant,setFullAssistant]=useState(false),[viewInfo,setViewInfo]=useState(true),[fullInfo,setFullInfo]=useState(false);
  const [search,setSearch]=useState(''),[find,setFind]=useState(''),[replace,setReplace]=useState(''),[showFind,setShowFind]=useState(false);
  const [status,setStatus]=useState('Caricamento…'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[words,setWords]=useState(0),[characters,setCharacters]=useState(0);
  const [aiOn,setAiOn]=useState(true),[autoMode,setAutoMode]=useState('complete'),[tone]=useState('Naturale'),[delay,setDelay]=useState(700);
  const [mode,setMode]=useState<Mode>('assistita'),[intentChoice,setIntentChoice]=useState('auto'),[detected,setDetected]=useState<DetectedIntent>(()=>detectIntent('')),[fp,setFp]=useState<Fingerprint>(EMPTY_FP),[coTab,setCoTab]=useState<'genera'|'direzioni'>('genera');
  const [project,setProjectState]=useState<Project>(EMPTY_PROJECT),[projectOpen,setProjectOpen]=useState(false);
  const [formatProgress,setFormatProgress]=useState(''),[imageBusy,setImageBusy]=useState(false);const imagePending=useRef(false);
  const [suggestion,setSuggestion]=useState<Suggestion|null>(null),[busy,setBusy]=useState(false),[aiError,setAiError]=useState(''),[aiWarning,setAiWarning]=useState('');
  const [theme,setTheme]=useState<Theme>('system'),[installable,setInstallable]=useState(false),[fullscreen,setFullscreen]=useState(false),[canFullscreen,setCanFullscreen]=useState(false),[pagePref,setPages]=useState(0),[update,setUpdate]=useState<string|null>(null),[versionLabel,setVersionLabel]=useState(''),[installer,setInstaller]=useState<Installer|null>(null);
  // Phones: simplified mode (bottom toolbar, panels as sheets); the A4 page view is desktop-only.
  const [narrow,simple,setSimple]=useSimpleMode(),standalone=useStandalone(),[sheet,setSheet]=useState<null|'docs'|'more'|'install'>(null);
  const pages=simple?0:pagePref;
  const [pageCount,setPageCount]=useState(1);
  const [zoom,setZoom]=useState<EditorZoom>('page'),[zoomPercent,setZoomPercent]=useState(100);
  const visibleTools=fullscreen?fullToolGroups:toolGroups,visibleSidebar=(fullscreen?fullSidebar:sidebar)&&!focus,visibleAssistant=(fullscreen?fullAssistant:assistantVisible)&&!focus;
  function changeToolGroup(group:ToolbarGroup,on:boolean){(fullscreen?setFullToolGroups:setToolGroups)(previous=>({...previous,[group]:on}));}
  function showLibrary(on:boolean){(fullscreen?setFullSidebar:setSidebar)(on);if(on)setFocus(false);}
  function showAssistant(on:boolean){(fullscreen?setFullAssistant:setAssistantVisible)(on);if(on)setFocus(false);}
  function showTools(all:boolean){(fullscreen?setFullToolGroups:setToolGroups)(all?ALL_TOOLS_VISIBLE:ESSENTIAL_TOOLS);showLibrary(all);showAssistant(all);(fullscreen?setFullInfo:setViewInfo)(all);}
  // Voice input: phrases are written at the cursor while the microphone listens.
  const [canDictate,setCanDictate]=useState(false),[listening,setListening]=useState(false),[heard,setHeard]=useState(''),[dictError,setDictError]=useState(''),dictation=useRef<Dictation|null>(null);
  useVisibleHeight(simple);
  const canvasRef=useRef<HTMLDivElement|null>(null),paperRef=useRef<HTMLDivElement|null>(null);
  const [form,setForm]=useState<ProfileForm>(EMPTY_PROFILE_FORM),[formBusy,setFormBusy]=useState(false);
  const editorRef=useRef<Editor|null>(null),revision=useRef(0),pending=useRef<AbortController|null>(null),aiTimer=useRef<ReturnType<typeof setTimeout>|null>(null),saveTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const current=useRef<{id:string;version:number;title:string}>({id:'',version:0,title:'Senza titolo'}),dirty=useRef(false),saving=useRef<Promise<boolean>|null>(null),selection=useRef<Suggestion|null>(null),suppress=useRef(false),settled=useRef<{para:number;text:string}|null>(null);
  const options=useRef({profile,aiOn,autoMode,tone,delay,mode,...aiPreferences});options.current={profile,aiOn,autoMode,tone,delay,mode,...aiPreferences};
  const projectRef=useRef(project),projectDoc=useRef(''),projectDirty=useRef(false),projectTimer=useRef<ReturnType<typeof setTimeout>|null>(null),fpTimer=useRef<ReturnType<typeof setTimeout>|null>(null);projectRef.current=project;
  // What the model needs to know about the work: voice, scene intent, project and story memory.
  const narrative=useMemo<Ctx>(()=>{const chosen=INTENTS.find(i=>i.id===intentChoice);
    const intent=intentChoice!=='auto'&&chosen?`${chosen.name}: ${chosen.tone} (chosen by the author)`:detected.confidence>0?`probably ${detected.name.toLowerCase()} (${detected.tone}); cues: ${detected.cues.join(', ')}. Verify against the context.`:'';
    return {style:voiceInstruction(project.voice.id,project.voice.intensity,project.voice.custom,describeFingerprint(fp),project.voice.blend),intent,brief:briefText(project.brief),memory:memorySummary(project.facts)};},[project,fp,detected,intentChoice]);
  const narrativeRef=useRef(narrative);narrativeRef.current=narrative;
  const [governor]=useState(()=>new AiGovernor());
  const localOffline=useRef(new Set<string>());
  useEffect(()=>{governor.resetBackoff();localOffline.current.delete(profile);},[profile,governor]);
  const callbacks=useRef({update:()=>{},selection:(()=>{}) as (typing:boolean)=>void,accept:():boolean=>false,tab:(()=>false) as (event:KeyboardEvent)=>boolean,cancel:()=>{},paste:((()=>false) as (event:ClipboardEvent)=>boolean)});
  const source=useMemo(()=>{const voiceId=project.voice.id==='mix'&&sanitizeBlend(project.voice.blend).length<2?'mine':project.voice.id;
    return styleSource({kb:activeKb?.chunks.length?activeKb:null,voiceId,voiceName:voiceName(voiceId,project.voice.blend),memoryActive:writingMemory.enabled&&(writingMemory.sources.length>0||!!writingMemory.notes.trim())});},[activeKb,project.voice,writingMemory]);
  const proposalDiff=useMemo(()=>suggestion?.done&&!suggestion.content&&suggestion.original!==undefined?wordDiff(suggestion.original,suggestion.text):null,[suggestion]);
  const proposalVoice=useMemo(()=>{if(!suggestion?.done||suggestion.mode==='format'||fp.words<150||wordsOf(suggestion.text).length<25)return null;return styleSimilarity(fp,fingerprint(suggestion.text));},[suggestion,fp]);
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
  const [rulesOwner,setRulesOwner]=useState(owner);
  if(rulesOwner!==owner){setRulesOwner(owner);setRulesState(readWritingRules(owner));}
  useEffect(()=>{const sync=(event:StorageEvent)=>{if(event.key!==writingRulesKey(owner)&&event.key!==null)return;clearSuggestion();setRulesState(readWritingRules(owner));};
    window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[owner]);
  function changeRules(next:WritingRules){clearSuggestion();rulesRef.current=next;setRulesState(next);if(!storeWritingRules(next,ownerRef.current))setNotice('Regole in uso, ma non salvate sul dispositivo.');}
  // Rules travel with every request; banned characters are also removed from what is shown.
  const rulesField=()=>{const text=writingRulesInstruction(rulesRef.current);return text?{rules:text}:{};};
  const clean=(text:string)=>applyWritingRules(text,rulesRef.current);
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
    extensions:[StarterKit.configure({link:{openOnClick:false}}),TextStyleKit,TableKit.configure({table:{resizable:true}}),TextAlign.configure({types:['heading','paragraph']}),Image.configure({allowBase64:true}),Highlight.configure({multicolor:true}),Ghost,Pagination.configure({onPages:setPageCount})],
    content:EMPTY,editorProps:{attributes:{class:'manuscript',role:'textbox','aria-label':'Contenuto del documento',spellcheck:'true'},handleKeyDown:(_view,event)=>{
      if(event.key==='Tab' && callbacks.current.tab(event)){event.preventDefault();return true;}
      if(event.key==='Escape'){callbacks.current.cancel();return false;}
      return false;
    },handlePaste:(_view,event)=>callbacks.current.paste(event)},onUpdate:()=>callbacks.current.update(),onSelectionUpdate:({transaction})=>callbacks.current.selection(transaction.docChanged),
  }); editorRef.current=editor;

  function clearSuggestion() { if(aiTimer.current)clearTimeout(aiTimer.current);pending.current?.abort();pending.current=null;selection.current=null;setSuggestion(null);setBusy(false);setFormatProgress('');const e=editorRef.current;if(e&&!e.isDestroyed)e.view.dispatch(e.state.tr.setMeta(ghostKey,null)); }
  function showSuggestion(s:Suggestion|null) {
    selection.current=s;setSuggestion(s);const e=editorRef.current;
    const preview=s?.mode==='complete'&&s.original!==undefined&&s.text.startsWith(s.original)?{...s,text:s.text.slice(s.original.length),from:s.to,to:s.to,original:undefined}:s;
    if(e&&!e.isDestroyed)e.view.dispatch(e.state.tr.setMeta(ghostKey,preview&&preview.mode!=='format'&&preview.text.length<=1600&&preview.to-preview.from<=2000?{kind:preview.original===undefined&&(preview.mode==='complete'||preview.mode==='continue')?'complete':'replace',from:preview.from,to:preview.to,text:preview.text,done:preview.done}:null));
  }
  // Typing the first characters of a completion keeps the rest on screen instead of asking again.
  function continued():Suggestion|null { const s=selection.current,e=editorRef.current;if(!s||!e||s.content||s.mode!=='complete'||s.original!==undefined||!s.done||s.base===undefined||!e.state.selection.empty)return null;
    const {$from}=e.state.selection;if($from.start()!==s.para)return null;const now=beforeCursor($from);if(!now.startsWith(s.base))return null;
    // A space typed before a proposal that starts with a word keeps it: the space was implied.
    const typed=now.slice(s.base.length),text=/^\s/.test(typed)&&!/^\s/.test(s.text)?' '+s.text:s.text;if(!typed||!text.startsWith(typed)||text.length<=typed.length)return null;
    return {...s,text:text.slice(typed.length),from:$from.pos,to:$from.pos,base:now}; }
  function acceptSuggestion() { const s=selection.current,e=editorRef.current;if(!s||!s.done||!e||s.revision!==revision.current)return false;
    clearSuggestion();
    if(s.replacements)e.chain().focus().command(({tr})=>{for(const part of [...s.replacements!].reverse())replaceAiFormatting(tr,part.from,part.to,part.content,false);return true;}).run();
    else if(s.content)e.chain().focus().command(({tr})=>{replaceAiFormatting(tr,s.from,s.to,s.content!);return true;}).run();
    else e.chain().focus().insertContentAt({from:s.from,to:s.to},s.text.split('\n').flatMap((line,i)=>[...(i?[{type:'hardBreak'}]:[]),...(line?[{type:'text',text:line}]:[])])).run();
    // An improved sentence is settled: automatic rewrites move on to the next one instead of improving it again.
    if(s.mode==='rewrite'){const {$from}=e.state.selection;settled.current={para:$from.start(),text:beforeCursor($from)};}
    if(s.trail)e.commands.setTextSelection(Math.min(e.state.selection.to+s.trail,e.state.selection.$to.end()));return true; }
  function handleAiTab(event:KeyboardEvent):boolean {
    const e=editorRef.current;if(!e?.isEditable||!loaded||e.isActive('table')||e.isActive('codeBlock'))return false;
    const s=selection.current,opts=options.current;
    const action=aiTabAction({trigger:opts.trigger,mode:opts.mode,modified:event.shiftKey||event.ctrlKey||event.altKey||event.metaKey,composing:event.isComposing||e.view.composing,repeat:event.repeat,busy:!!pending.current,proposal:s?s.done?'ready':'pending':'none'});
    if(action==='accept')return acceptSuggestion();
    if(action==='request'){void ask(e.state.selection.empty?opts.autoMode:'rewrite');return true;}
    return action==='wait';
  }

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
    const accountingOwner=ownerRef.current,accountingProfile=profiles.find(p=>p.id===payload.profile);
    const localFailure=(message:string)=>{localOffline.current.add(String(payload.profile));return new Error(message+' Suggerimenti automatici sospesi per questo profilo. Correggi il collegamento nelle impostazioni; puoi riprovare subito.');};
    let res:Response;
    try{res=isDeviceProfile(payload.profile)?await deviceAssist(payload,signal):LOCAL?await localAssist(payload,signal):await fetch('/api/assist',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify(payload)});}
    catch(err){if(signal.aborted)throw err;if(isDeviceProfile(payload.profile))throw localFailure('Collegamento locale non riuscito.');throw new Error('Connessione non riuscita.'+penalize(false));}
    if(!res.ok){const b:any=await res.json().catch(()=>({}));const msg=b.error||'Provider non disponibile.';if(isDeviceProfile(payload.profile)&&res.status!==429)throw localFailure(msg);throw new Error(res.status===429||res.status>=500?msg+penalize(res.status===429):msg);}
    if(!res.body)throw new Error('Risposta vuota.');const reader=res.body.getReader();const decoder=new TextDecoder();let buffer='',answer='',complete=false,success=false,usage:UsageEvent|null=null;
    try {
      while(true){const {value,done}=await reader.read();if(signal.aborted)throw new DOMException('Richiesta annullata.','AbortError');if(done)break;buffer+=decoder.decode(value,{stream:true});let i:number;
        while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;const data=JSON.parse(line);
          if(data.usage)usage=parseUsageEvent(data.usage)||usage;
          if(data.error){throw new Error(data.error+penalize(false));}if(data.done)complete=true;
          if(typeof data.text==='string'&&data.text){answer+=data.text;if(onText&&onText(answer)===false)return null;}}
      }
      if(!complete||!answer.trim())throw new Error('Nessuna risposta ricevuta. Riprova.');
      success=true;localOffline.current.delete(String(payload.profile));governor.succeeded();setProfiles(old=>old.map(p=>p.id===payload.profile?{...p,used:p.used+1}:p));return answer;
    } finally {
      await reader.cancel().catch(()=>{});reader.releaseLock();
      const {system,prompt}=assistPrompts(payload);
      recordTokenUsage(accountingOwner,usage||{...finalizeUsage({},system,prompt,answer),provider:accountingProfile?.provider||'unknown',model:accountingProfile?.model||'unknown'},!success);
    }
  }
  // Analyses requested from the companion panel: always manual, never shown as ghost text.
  const run:Run=async(mode,fields,signal)=>{const opts=options.current;if(!opts.profile){setSettings('ai');throw new Error('Collega un provider AI per usare questa funzione.');}
    const wait=governor.wait(false);if(wait>0)throw new Error(`Pausa per rispettare i limiti del provider: riprova tra ${Math.ceil(wait/1000)} s.`);
    governor.started();const answer=await streamAssist({profile:opts.profile,mode,tone:opts.tone,...fields,...voiceFields(mode,String(fields.text||'')),...rulesField()},signal);if(answer===null)throw new DOMException('Richiesta annullata.','AbortError');
    // Analyses quoting the manuscript verbatim (memory, check, persona) are left untouched so quotes still match.
    return mode==='directions'||mode==='ask'?clean(answer):answer;};

  async function formatOnly(scope:'selection'|'page'|'document') {
    const e=editorRef.current,opts=options.current;if(!e?.isEditable||!loaded)return;
    if(!opts.profile){setSettings('ai');return;}
    clearSuggestion();setAiError('');setAiWarning('');
    if(scope==='selection'&&e.state.selection.empty){setAiError('Seleziona il testo da formattare.');return;}
    if(scope==='page'&&!pages){setAiError('Scegli una vista A4 da «Visualizza» per formattare la pagina corrente.');return;}
    const bounds=scope==='document'?{from:0,to:e.state.doc.content.size}:scope==='page'?currentPageRange(e.view,e.state.selection.from):e.state.selection;
    const original=e.state.doc,rev=revision.current,{ranges,skipped}=formatRanges(original,bounds.from,bounds.to);
    if(!ranges.length){setAiError('Non ci sono paragrafi di testo da formattare in questo ambito.');return;}
    const controller=new AbortController();pending.current=controller;setBusy(true);
    const parts:FormatReplacement[]=[];
    try {
      for(let i=0;i<ranges.length;i++) {
        if(controller.signal.aborted||rev!==revision.current)return;
        setFormatProgress(`Sistema formattazione: passaggio ${i+1} di ${ranges.length}. Il testo originale resta invariato fino ad Accetta.`);
        const range=ranges[i],payload={profile:opts.profile,mode:'format',text:range.text,formatting:true,formatContext:'Preserve wording, links and embedded elements. Infer titles, subtitles, paragraphs, emphasis and coherent typography from meaning. Repair inappropriate font sizes and colors. Choose a consistent typeface; use color only when useful.'};
        const key=AiGovernor.key([payload]);let answer=governor.cached(key);
        if(answer===undefined){const wait=governor.wait(false);if(wait>0)throw new Error(`Il provider richiede una pausa: riprova tra ${Math.ceil(wait/1000)} secondi.`);governor.started();
          const result=await streamAssist(payload,controller.signal);if(result===null)return;answer=result;}
        if(controller.signal.aborted||rev!==revision.current)return;
        const response=splitWarning(answer);if(!response.text.trim())throw new Error(response.warning||'Il modello non ha restituito una formattazione. Riprova.');
        parts.push(formatReplacement(original,range,response.text));governor.remember(key,answer);
      }
      if(controller.signal.aborted||rev!==revision.current)return;
      showSuggestion({from:bounds.from,to:bounds.to,text:parts[0].text,content:parts[0].content,replacements:parts,revision:rev,mode:'format',done:true});
      if(skipped)setAiWarning('Immagini, blocchi di codice e paragrafi con elementi incorporati sono stati conservati senza modifiche.');
    } catch(err) {if(!controller.signal.aborted){showSuggestion(null);setAiError((err as Error).message);}}
    finally {if(pending.current===controller){pending.current=null;setBusy(false);setFormatProgress('');}}
  }

  async function ask(mode:string,automatic=false,direction='') { const e=editorRef.current;if(!e)return;const opts=options.current;if(!opts.profile){if(!automatic)setSettings('ai');return;}
    if(automatic&&localOffline.current.has(opts.profile))return;
    clearSuggestion();setAiError('');setAiWarning('');const {from,to,$from}=e.state.selection;
    if(automatic&&!e.state.selection.empty)return;
    // No proposal is drawn inside an IME composition (mobile keyboards): try again once it is over.
    if(automatic&&e.view.composing){aiTimer.current=setTimeout(()=>void ask(mode,true),opts.delay);return;}
    const inline=mode==='complete'||mode==='continue',para=$from.start();
    const formatting=opts.formatting&&(mode==='complete'||mode==='rewrite');
    if(mode==='complete'&&!e.state.selection.empty){if(!automatic)setAiError('Posiziona il cursore per completare il testo, oppure scegli «Migliora frase» per elaborare una selezione.');return;}
    const cursorText=beforeCursor($from);
    const completion=mode==='complete'?(formatting&&cursorText.length<=4000?{start:0,end:$from.parentOffset}:sentenceTarget(cursorText)):null;
    // Automatic improvements work on the sentence being written, never on text already accepted.
    const sentence=automatic&&mode==='rewrite'?sentenceTarget(beforeCursor($from),settled.current?.para===para?settled.current.text:''):null;
    const start=completion?para+completion.start:sentence?para+sentence.start:inline?from:(from===to?para:from);
    // A voice rewrite without selection takes the whole paragraph, so the voice applies to a full unit.
    const end=sentence?para+sentence.end:inline?from:mode==='voice'&&from===to?$from.end():to;
    const text=completion?beforeCursor($from).slice(completion.start):sentence?beforeCursor($from).slice(sentence.start,sentence.end):mode==='continue'?e.state.doc.textBetween(Math.max(0,from-2000),from,'\n'):e.state.doc.textBetween(start,end,formatting?'\n\n':'\n');
    if(text.trim().length<(mode==='continue'?20:3)){if(!automatic)setAiError(mode==='continue'?'Scrivi qualche frase: la scena continuerà dal cursore.':'Scrivi o seleziona almeno qualche parola.');return;}
    if(text.length>10000){setAiError(`Il brano contiene ${text.length.toLocaleString('it-IT')} caratteri: seleziona al massimo 10.000 caratteri alla volta, per esempio uno o più paragrafi. Il testo è rimasto invariato.`);return;}
    const contextEnd=mode==='continue'?Math.max(0,from-2000):start,n=narrativeRef.current;
    let existingFormatting=$from.parent.type.name!=='paragraph';const emphasis:{text:string;marks:string[]}[]=[];
    if(formatting)e.state.doc.nodesBetween(start,end,(node,pos)=>{const marks=node.marks.map(m=>m.type.name).filter(m=>['bold','italic','underline','strike','highlight'].includes(m));if(marks.length){existingFormatting=true;if(emphasis.length<5)emphasis.push({text:(node.text||'').slice(Math.max(0,start-pos),Math.min((node.text||'').length,end-pos)).slice(0,80),marks});}});
    const payload={profile:opts.profile,mode,...voiceFields(mode,text),text:text.slice(-10000),context:e.state.doc.textBetween(Math.max(0,contextEnd-6000),contextEnd,'\n'),after:e.state.doc.textBetween(to,Math.min(e.state.doc.content.size,to+1000),'\n'),tone:opts.tone,
      style:mode==='formal'?'':n.style,intent:mode==='formal'?'':n.intent,brief:n.brief,memory:mode==='complete'?n.memory.slice(0,1500):mode==='continue'||mode==='voice'?n.memory:'',direction,formatting,formatContext:formatting?JSON.stringify({block:$from.parent.type.name,level:$from.parent.attrs.level,emphasis}):'',...rulesField()};
    const rev=revision.current,scope=String(para),key=AiGovernor.key([payload]);let lastPreview=0;
    const extra=mode==='complete'?{base:beforeCursor($from),para}:mode==='continue'?{}:{original:text,trail:sentence?from-end:0};
    // A generated scene starting right after a word needs a separating space.
    const spaced=(a:string)=>mode==='continue'&&/\S$/.test(text)&&/^[\p{L}\p{N}«"“(]/u.test(a)?' '+a:a;
    const proposal=(answer:string,done:boolean,cached=false):Suggestion|null=>{
      if(formatting&&!done&&answer.includes(':::style'))return null;
      if(formatting&&done){
        const formatted=parseAiFormatting(clean(answer));
        if(formatted.content.length){
          const keepPrefix=mode==='complete'&&clean(answer).startsWith(text)&&!parseAiFormatting(text).rich;
          const part=keepPrefix?parseAiFormatting(clean(answer).slice(text.length),true):formatted;
          if(!part.text.trim())return null;
          return {...extra,text:part.text,content:part.content,from:keepPrefix?end:start,to:end,original:keepPrefix?undefined:text,revision:rev,mode,done,cached};
        }
      }
      if(mode==='complete'){const p=completionProposal(text,answer,done);return p?{...extra,...p,text:clean(p.text),from:start+p.offset,to:end,revision:rev,mode,done,cached}:null;}
      return {text:spaced(clean(answer)),from:start,to:end,revision:rev,mode,done,cached,...extra};
    };
    // A problem reported by the model is shown as a warning, never as text to accept;
    // an automatic improvement that changes nothing is not shown either.
    const finish=(answer:string,cached:boolean)=>{if(automatic)governor.asked(mode,scope,text);const p=splitWarning(answer);setAiWarning(p.warning);
      if(!p.text.trim()||(automatic&&mode==='rewrite'&&(formatting?p.text===text&&!parseAiFormatting(p.text).rich&&!existingFormatting:sameText(p.text,text)))){showSuggestion(null);return;}showSuggestion(proposal(p.text,true,cached));};
    const hit=governor.cached(key);
    if(hit!==undefined){finish(hit,true);return;}
    if(automatic&&!governor.worthAsking(mode,scope,text))return;
    const wait=governor.wait(automatic);
    if(wait>0){if(automatic)aiTimer.current=setTimeout(()=>void ask(mode,true),wait);else setAiError(`Pausa per rispettare i limiti del provider: riprova tra ${Math.ceil(wait/1000)} s.`);return;}
    governor.started();const controller=new AbortController();pending.current=controller;setBusy(true);
    try{const answer=await streamAssist(payload,controller.signal,a=>{if(controller.signal.aborted||rev!==revision.current)return false;const p=splitWarning(a);if(p.warning)setAiWarning(p.warning);if(p.text&&performance.now()-lastPreview>120){lastPreview=performance.now();showSuggestion(proposal(p.text,false));}});
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
    if(opts.mode==='assistita'&&opts.trigger==='pause'&&opts.aiOn&&opts.profile)aiTimer.current=setTimeout(()=>void ask(opts.autoMode,true),opts.delay);
  },selection:(typing)=>{if(!typing)clearSuggestion();},accept:acceptSuggestion,tab:handleAiTab,cancel:clearSuggestion,paste:(event)=>{const file=Array.from(event.clipboardData?.files||[]).find(f=>f.type.startsWith('image/'));if(!file)return false;event.preventDefault();void insertEditorImage(file);return true;}};

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
  useEffect(()=>{clearSuggestion();setAiWarning('');},[profile,aiOn,autoMode,tone,mode,aiPreferences]);
  useEffect(()=>{if(!loaded)return;const timer=setInterval(()=>{void (async()=>{if(await save())await saveProject();})();},5*60*1000);return()=>clearInterval(timer);},[loaded,save,saveProject]);
  function changeMode(next:Mode){setMode(next);try{localStorage.setItem('scrivia:mode',next);}catch{}}
  useEffect(()=>{setTheme(readTheme());},[]);
  // The static build registers the service worker in site/main.tsx; the server build does it here.
  useEffect(()=>{if(!LOCAL)setupPwa('/sw.js',process.env.NODE_ENV==='production');return onInstallAvailable(setInstallable);},[]);
  useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const apply=()=>{document.documentElement.dataset.theme=theme==='system'?(media.matches?'dark':'light'):theme;};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);},[theme]);
  function changeTheme(next:Theme){setTheme(next);try{localStorage.setItem('scrivia:theme',next);}catch{}}
  function cycleTheme(){changeTheme(THEMES[(THEMES.indexOf(theme)+1)%THEMES.length]);}
  const themeLabel=theme==='light'?'Tema chiaro':theme==='dark'?'Tema scuro':'Tema di sistema';
  useEffect(()=>{editor?.setEditable(loaded&&!repoBusy,false);},[editor,loaded,repoBusy]);
  useEffect(()=>{if(!settings&&!history&&!projectOpen&&!repoOpen&&!memoryOpen)return;const previous=document.activeElement as HTMLElement|null;const modal=document.querySelector('[role="dialog"]') as HTMLElement|null;const controls=()=>Array.from(modal?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]')||[]);controls()[0]?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setSettings(null);setHistory(null);setProjectOpen(false);setMemoryOpen(false);}if(event.key==='Tab'){const list=controls();if(!list.length)return;const first=list[0],last=list[list.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[settings,history,projectOpen,repoOpen,memoryOpen]);
  // Full screen covers the whole browser window; the browser's own exit (Esc, F11) keeps the button in sync.
  useEffect(()=>{setCanFullscreen(!!document.fullscreenEnabled);const sync=()=>{const active=!!document.fullscreenElement;setFullscreen(active);if(active){setFullToolGroups(ESSENTIAL_TOOLS);setFullSidebar(false);setFullAssistant(false);setFullInfo(false);}};sync();document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync);},[]);
  function toggleFullscreen(){(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(()=>setNotice('Il browser non consente lo schermo intero.'));}
  useEffect(()=>{setPages(readPages());setZoom(readEditorZoom());setVersionLabel(buildLabel());},[]);
  // The static build checks version.json: a newer deploy is announced with a button to load it.
  // Desktop installer for this computer, from the latest GitHub release (hidden if there is none).
  useEffect(()=>{const c=new AbortController();findInstaller(c.signal).then(setInstaller,()=>{});return ()=>c.abort();},[]);
  useEffect(()=>LOCAL?watchForUpdates('./version.json',commit=>setUpdate(commit)):undefined,[]);
  async function loadUpdate(){if(!await save())return;await saveProject();await applyUpdate();}
  function changePages(n:number){setPages(n);try{localStorage.setItem('scrivia:pages',String(n));}catch{}}
  function changeZoom(value:EditorZoom){const next=sanitizeZoom(value);setZoom(next);storeEditorZoom(next);}
  // Counts the pages the text fills and zooms out so the chosen number of pages fits the window.
  const layoutPages=useCallback(()=>{const paper=paperRef.current,canvas=canvasRef.current,dom=editorRef.current?.isDestroyed?null:editorRef.current?.view.dom as HTMLElement|undefined;if(!paper||!canvas||!dom)return;
    if(!pages){paper.style.removeProperty('--pages');paper.style.zoom='';return;}
    const box=dom.getBoundingClientRect(),scale=box.width/(dom.offsetWidth||1)||1,last=dom.lastElementChild?.getBoundingClientRect();
    const filled=pages===1?1:last?Math.floor(((last.right-box.left)/scale-PAGE.margin)/(PAGE.width+PAGE.gap))+1:1;paper.style.setProperty('--pages',String(Math.max(1,filled)));
    const style=getComputedStyle(canvas),room=canvas.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),height=canvas.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    const caption=canvas.querySelector<HTMLElement>('.page-topline'),captionStyle=caption?getComputedStyle(caption):null;
    const heading=caption&&caption.getClientRects().length?caption.offsetHeight+parseFloat(captionStyle!.marginTop)+parseFloat(captionStyle!.marginBottom):0;
    const fitWidth=room/(pages*(PAGE.width+PAGE.gap)-PAGE.gap),fit=zoom==='page'?Math.min(fitWidth,Math.max(1,height-heading-4)/PAGE.height):zoom==='width'?fitWidth:zoom/100;
    const appliedZoom=Math.max(0.15,Math.min(zoom==='page'?1:2.5,fit));paper.style.zoom=String(appliedZoom);setZoomPercent(Math.round(appliedZoom*100));},[pages,zoom]);
  useEffect(()=>{if(!editor)return;editor.view.dispatch(editor.state.tr.setMeta(paginationKey,{enabled:pages===1,breaks:[],pages:1}).setMeta('addToHistory',false));},[editor,pages]);
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
  async function saveProfile(){setFormBusy(true);setError('');try{if(isDeviceProvider(form.provider)){const models=await deviceModels(form.baseUrl,form.key,undefined,form.id,form.provider);if(!models.includes(form.model))throw new Error('Scegli un modello installato dall’elenco dopo aver verificato la connessione.');}const result=await api('profiles',form);localOffline.current.delete(result.id);governor.resetBackoff();setAiError('');await reloadProfiles();setProfile(result.id);setForm(EMPTY_PROFILE_FORM);setNotice('Profilo API salvato');}catch(err){setError((err as Error).message);}finally{setFormBusy(false);}}
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


  async function insertEditorImage(file?:Blob) {
    const e=editorRef.current;if(!e?.isEditable||imagePending.current)return;
    const original=e.state.doc,target={from:e.state.selection.from,to:e.state.selection.to};imagePending.current=true;setImageBusy(true);setError('');
    try {const source=file||await clipboardImage();const image=await prepareEditorImage(source);
      if(e.isDestroyed||editorRef.current!==e||e.state.doc!==original){setNotice('Il documento è cambiato: riprova a inserire l’immagine nel punto desiderato.');return;}
      clearSuggestion();e.chain().focus().setTextSelection(target).setImage({...image,alt:source instanceof File?source.name:'Immagine dagli appunti'}).run();setNotice('Immagine inserita e adattata alla pagina.');
    }catch(err){setError((err as Error).message);}finally{imagePending.current=false;setImageBusy(false);}
  }

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
  return <div className={'app '+(focus?'focus-mode':'')+(visibleSidebar?'':' sidebar-hidden')+(!visibleAssistant&&!simple?' assistant-hidden':'')+(fullscreen?' editor-fullscreen':'')+((fullscreen?fullInfo:viewInfo)?'':' info-hidden')+(mobileAI?' mobile-ai':'')+(pages?' paged':'')+(pages===1?' a4-stack':'')+(simple?' simple':'')+(simple&&sheet==='docs'?' m-docs':'')}>
    <Tooltips/>
    <aside className="library"><div className="brand"><span className="brand-icon"><WandSparkles size={21}/></span><span>scrivia<span className="brand-dot">.</span></span><small>AI</small></div>
      <button className="new-doc" data-tip="Crea un documento vuoto; quello aperto viene salvato prima" onClick={()=>{setSheet(null);void newDocument();}} disabled={!loaded}><Plus size={17}/>Nuovo documento<span>＋</span></button>
      <div className="library-label">IL TUO SPAZIO</div><div className="library-current"><FileText size={17}/>Tutti i documenti <small>{docs.length}</small></div>
      <label className="doc-search" data-tip="Filtra l’elenco dei documenti per titolo"><Search size={15}/><input placeholder="Cerca un documento" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <div className="library-label recent-label">RECENTI</div><div className="doc-list">{docs.filter(d=>d.title.toLowerCase().includes(search.toLowerCase())).map(d=><button key={d.id} className={'doc-item '+(active===d.id?'selected':'')} data-tip={'Apri «'+d.title+'» · modificato il '+date(d.updated)} onClick={()=>{setSheet(null);void loadDocument(d.id);}}><FileText size={18}/><span><strong>{d.title}</strong><small>{date(d.updated)}</small></span>{active===d.id&&<span className="selected-dot"/>}</button>)}{!docs.length&&loaded&&<p className="muted">Crea il tuo primo documento.</p>}</div>
      <div className="library-bottom"><div className="privacy-mini"><ShieldCheck size={18}/><div><strong>Il tuo spazio privato</strong><small>{LOCAL?'Documenti salvati in questo browser':'Documenti salvati nel cloud'}</small></div></div><button data-tip="Provider AI e chiavi API, salvataggio GitHub, regole di scrittura e aspetto in un unico posto" onClick={()=>setSettings('ai')}><Settings2 size={18}/>Impostazioni<ChevronRight size={15}/></button><div className="user"><span>F</span><div>Il mio spazio<small>Scrivia AI · personale</small></div></div></div>
    </aside>
    <main className="main"><header className="topbar"><div className="document-heading">{simple&&<button className="m-btn" aria-label="I tuoi documenti" onClick={()=>setSheet('docs')}><Menu size={24}/></button>}<button className="tool sidebar-toggle" aria-label="Mostra o nascondi documenti" data-tip="Mostra o nascondi l’elenco dei documenti a sinistra" onClick={()=>showLibrary(!visibleSidebar)}><PanelLeftClose size={19}/></button><div><input aria-label="Titolo documento" disabled={repoBusy} maxLength={150} value={title} onChange={e=>{setTitle(e.target.value);current.current.title=e.target.value.trim()||'Senza titolo';markDirty();}}/><div className={'save-state '+(status==='Non salvato'?'bad':'')}><span className="save-dot"/>{status}</div></div></div><div className="header-actions">{simple&&<>{!standalone&&<button className="m-btn m-install m-keep" onClick={installApp}><Download size={18}/>Installa</button>}<button className="m-btn m-keep" aria-label="Altre azioni" onClick={()=>setSheet('more')}><Ellipsis size={24}/></button></>}{narrow&&!simple&&<button className="m-full" data-tip="Torna alla modalità semplice per telefono" onClick={()=>setSimple(true)}><Sparkles size={15}/>Semplice</button>}<button className="tool mobile-ai-toggle" aria-label="Mostra assistente AI" data-tip="Apri o chiudi il pannello dell’assistente AI" onClick={()=>setMobileAI(!mobileAI)}><Sparkles size={17}/></button><button className="tool" aria-label="Impostazioni" data-tip="Impostazioni: provider AI, GitHub, regole di scrittura e aspetto" onClick={()=>setSettings('ai')}><Settings2 size={17}/></button><div className="export-wrap"><button className="export icon-export" aria-label="Esporta" data-tip="Scarica il documento in un altro formato o stampalo" onClick={()=>setMenu(!menu)}><ArrowDownToLine size={16}/><ChevronDown size={14}/></button>{menu&&<div className="dropdown">{[['docx','Word (.docx)','Documento modificabile con Word, LibreOffice o Google Docs'],['pdf','Stampa / PDF','Apre la stampa del browser: scegli «Salva come PDF» per ottenere il file'],['txt','Testo (.txt)','Solo il testo, senza formattazione'],['html','Pagina HTML','Pagina web apribile in qualsiasi browser'],['json','Backup Scrivia','Copia completa da reimportare in Scrivia con «Importa»']].map(([v,l,t])=><button key={v} data-tip={t} onClick={()=>void exportFile(v)}>{l}</button>)}</div>}</div></div></header>
      <EditorToolbars owner={owner} fullscreen={fullscreen} disabled={simple} resetToken={toolbarReset} groups={[
        {id:'primary',label:'Comandi principali',content:<>        <Tool label="Salva su GitHub" icon={Save} disabled={!loaded||repoBusy} action={()=>void requestRepositorySave()}/>
        <Tool label="Chiedi all’AI" icon={WandSparkles} disabled={busy||!loaded||repoBusy} action={()=>void ask(editor?.state.selection.empty?autoMode:'rewrite')}/>
</>},
        ...(visibleTools.document?[{id:'document' as const,label:'Documento',content:<><div className="toolbar-section" role="group" aria-label="Comandi documento"><Tool label="Carica da GitHub" icon={FolderOpen} disabled={!loaded||repoBusy} action={()=>setRepoOpen('load')}/><label className="tool icon-import" role="button" tabIndex={0} aria-label="Importa documento" onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.currentTarget.querySelector<HTMLInputElement>('input')?.click();}}} data-tip="Apri un file Word (.docx), di testo (.txt) o un backup Scrivia (.json) come nuovo documento"><FileUp size={17}/><input type="file" aria-label="File da importare" accept=".docx,.txt,.json" onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.target.value='';}}/></label><Tool label="Cronologia" icon={Clock3} action={()=>void openHistory()}/><Tool label="Trova e sostituisci" icon={Search} action={()=>setShowFind(!showFind)}/><Tool label="La mia voce" icon={Drama} action={()=>setMemoryOpen(true)}/><Tool label="Knowledge base" icon={BookOpen} action={()=>setKbOpen(true)}/><Tool label="Progetto creativo" icon={PenLine} action={()=>setProjectOpen(true)}/><Tool label={themeLabel+': cambia tema'} icon={theme==='light'?Sun:theme==='dark'?Moon:Monitor} action={cycleTheme}/><Tool label="Modalità concentrazione" icon={Maximize2} on={focus} action={()=>setFocus(!focus)}/></div></>}]:[]),
        {id:'view',label:'Visualizza',content:<>        <CommandMenu label="Visualizza" icon={Eye}><p className="view-menu-heading">Strumenti visibili</p>{([['document','Comandi documento'],['text','Carattere e formattazione'],['paragraph','Paragrafo e allineamento'],['insert','Strumenti di inserimento']] as [ToolbarGroup,string][]).map(([key,label])=><label className="view-toggle" key={key}><input type="checkbox" checked={visibleTools[key]} onChange={e=>changeToolGroup(key,e.target.checked)}/><span>{label}</span></label>)}<label className="view-toggle"><input type="checkbox" checked={visibleSidebar} onChange={e=>showLibrary(e.target.checked)}/><span>Elenco documenti</span></label><label className="view-toggle"><input type="checkbox" checked={visibleAssistant} onChange={e=>showAssistant(e.target.checked)}/><span>Assistente AI</span></label><label className="view-toggle"><input type="checkbox" checked={fullscreen?fullInfo:viewInfo} onChange={e=>(fullscreen?setFullInfo:setViewInfo)(e.target.checked)}/><span>Informazioni documento</span></label><button onClick={()=>showTools(true)}>Mostra tutti gli strumenti</button><button onClick={()=>showTools(false)}>Solo strumenti essenziali</button><button onClick={()=>setToolbarReset(n=>n+1)}>Ripristina posizione strumenti</button><label className="page-view" data-tip="Vista continua, oppure il testo diviso in pagine A4 con 1, 2, 3 o 4 pagine visibili insieme"><Columns2 size={14}/><select aria-label="Pagine visibili" value={pages} onChange={e=>changePages(+e.target.value)}>{PAGE_VIEWS.map(n=><option key={n} value={n}>{n?n===1?'1 pagina':n+' pagine':'Vista continua'}</option>)}</select></label>{installer&&<button onClick={()=>{location.href=installer.url;}}><MonitorDown size={17}/>Scarica app desktop</button>}{installable&&<button onClick={()=>void promptInstall()}><Download size={17}/>Installa Scrivia</button>}</CommandMenu>
        {canFullscreen&&<Tool label={fullscreen?'Esci da schermo intero':'Schermo intero'} icon={fullscreen?Minimize:Fullscreen} on={fullscreen} action={toggleFullscreen}/>}
</>},
        {id:'edit',label:'Modifica',content:<><Tool label="Annulla" tip="Annulla l’ultima modifica (Ctrl+Z)" icon={Undo2} action={()=>{editor?.chain().focus().undo().run();}}/><Tool label="Ripeti" tip="Ripeti la modifica annullata (Ctrl+Y)" icon={Redo2} action={()=>{editor?.chain().focus().redo().run();}}/>{canDictate&&<Tool label={listening?'Ferma dettatura':'Dettatura vocale'} tip={dictateTip} icon={Mic} on={listening} action={toggleDictation}/>}</>},
        {id:'emphasis',label:'Enfasi',content:<><Tool label="Grassetto" tip="Grassetto: testo più marcato (Ctrl+B)" icon={Bold} on={editor?.isActive('bold')} action={()=>{editor?.chain().focus().toggleBold().run();}}/><Tool label="Corsivo" tip="Corsivo: testo inclinato (Ctrl+I)" icon={Italic} on={editor?.isActive('italic')} action={()=>{editor?.chain().focus().toggleItalic().run();}}/>
</>},
        ...(visibleTools.text?[{id:'text' as const,label:'Testo',content:<><div className="toolbar-section" role="group" aria-label="Testo"><select aria-label="Carattere" data-tip="Tipo di carattere del testo selezionato: Sistema usa il font pulito predefinito" value={editor?.getAttributes('textStyle').fontFamily||''} onChange={e=>{const chain=editor?.chain().focus();if(e.target.value)chain?.setFontFamily(e.target.value).run();else chain?.unsetFontFamily().run();}}><option value="">Sistema</option><option>Georgia</option><option>Arial</option><option>Times New Roman</option><option>Verdana</option><option>Courier New</option></select><select className="font-size" aria-label="Dimensione carattere" data-tip="Dimensione del testo selezionato" value={editor?.getAttributes('textStyle').fontSize||'18px'} onChange={e=>editor?.chain().focus().setFontSize(e.target.value).run()}>{['14px','16px','18px','20px','22px','24px','28px','32px','38px'].map(s=><option key={s}>{s}</option>)}</select><Tool label="Sottolineato" tip="Sottolinea il testo selezionato (Ctrl+U)" icon={Underline} on={editor?.isActive('underline')} action={()=>{editor?.chain().focus().toggleUnderline().run();}}/><Tool label="Evidenzia" tip="Evidenzia il testo selezionato con uno sfondo colorato" icon={Highlighter} on={editor?.isActive('highlight')} action={()=>{editor?.chain().focus().toggleHighlight({color:'#e0e8b9'}).run();}}/><label className="color-tool" data-tip="Scegli il colore del testo selezionato"><span>A</span><input type="color" aria-label="Colore testo" defaultValue="#272b29" onChange={e=>editor?.chain().focus().setColor(e.target.value).run()}/></label><CommandMenu label="Sistema formattazione" icon={Paintbrush}><button disabled={busy||!loaded||!editor||editor.state.selection.empty} onClick={()=>void formatOnly('selection')}>Testo selezionato</button><button disabled={busy||!loaded||!pages} onClick={()=>void formatOnly('page')}>Pagina corrente</button><button disabled={busy||!loaded} onClick={()=>void formatOnly('document')}>Documento intero</button></CommandMenu></div></>}]:[]),
        ...(visibleTools.paragraph?[{id:'paragraph' as const,label:'Paragrafo',content:<><div className="toolbar-section" role="group" aria-label="Paragrafo"><select aria-label="Stile paragrafo" data-tip="Trasforma il paragrafo in testo normale, titolo o sottotitolo" value={editor?.isActive('heading',{level:1})?'h1':editor?.isActive('heading',{level:2})?'h2':editor?.isActive('heading',{level:3})?'h3':'p'} onChange={e=>{if(e.target.value==='p')editor?.chain().focus().setParagraph().run();else editor?.chain().focus().toggleHeading({level:e.target.value==='h1'?1:e.target.value==='h2'?2:3}).run();}}><option value="p">Testo normale</option><option value="h1">Titolo</option><option value="h2">Sottotitolo</option><option value="h3">Titolo minore</option></select><Tool label="Allinea a sinistra" tip="Allinea il paragrafo al margine sinistro" icon={AlignLeft} action={()=>{editor?.chain().focus().setTextAlign('left').run();}}/><Tool label="Centra" tip="Centra il paragrafo nella pagina" icon={AlignCenter} action={()=>{editor?.chain().focus().setTextAlign('center').run();}}/><Tool label="Allinea a destra" tip="Allinea il paragrafo al margine destro" icon={AlignRight} action={()=>{editor?.chain().focus().setTextAlign('right').run();}}/><Tool label="Elenco puntato" tip="Trasforma i paragrafi in un elenco puntato" icon={List} action={()=>{editor?.chain().focus().toggleBulletList().run();}}/><Tool label="Elenco numerato" tip="Trasforma i paragrafi in un elenco numerato" icon={ListOrdered} action={()=>{editor?.chain().focus().toggleOrderedList().run();}}/></div></>}]:[]),
        ...(visibleTools.insert?[{id:'insert' as const,label:'Inserisci',content:<><div className="toolbar-section" role="group" aria-label="Inserisci"><Tool label="Inserisci tabella" tip="Inserisce una tabella 3×3 nel punto del cursore" icon={Table2} action={()=>{editor?.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run();}}/><Tool label="Inserisci collegamento" tip="Trasforma il testo selezionato in un link a una pagina web" icon={Link2} action={()=>{const url=window.prompt('Indirizzo del collegamento (https://…)');if(url&&/^https?:\/\//i.test(url))editor?.chain().focus().setLink({href:url}).run();}}/>
        <label className="tool image-upload" role="button" tabIndex={0} aria-label="Inserisci immagine da file" data-tip="Inserisci immagine da file: proporzioni e dimensioni adattate alla pagina" onMouseDown={e=>e.preventDefault()} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.currentTarget.querySelector<HTMLInputElement>('input')?.click();}}}><ImagePlus size={17}/><input type="file" aria-label="File immagine" accept="image/png,image/jpeg,image/webp,image/avif" disabled={imageBusy||!loaded||repoBusy} onChange={e=>{const f=e.target.files?.[0];if(f)void insertEditorImage(f);e.target.value='';}}/></label><Tool label="Incolla immagine dagli appunti" icon={ClipboardPaste} disabled={imageBusy||!loaded||repoBusy} action={()=>void insertEditorImage()}/></div></>}]:[]),
        ...(pages>0?[{id:'zoom' as const,label:'Zoom',content:<ZoomControls value={zoom} percent={zoomPercent} onChange={changeZoom}/>}]:[])
      ]}>
      {editor&&!editor.state.selection.empty&&<div className="ai-selection-actions"><button disabled={busy||!loaded} onMouseDown={e=>e.preventDefault()} onClick={()=>void ask('rewrite')}><WandSparkles size={16}/>Migliora selezione con AI</button><span>Modifica solo il testo selezionato, con anteprima prima di accettare.</span></div>}
      {editor?.isActive('table')&&<div className="table-actions"><button data-tip="Aggiunge una riga sotto quella del cursore" onClick={()=>editor.chain().focus().addRowAfter().run()}>+ Riga</button><button data-tip="Aggiunge una colonna a destra di quella del cursore" onClick={()=>editor.chain().focus().addColumnAfter().run()}>+ Colonna</button><button data-tip="Elimina la riga in cui si trova il cursore" onClick={()=>editor.chain().focus().deleteRow().run()}>Elimina riga</button><button data-tip="Elimina la colonna in cui si trova il cursore" onClick={()=>editor.chain().focus().deleteColumn().run()}>Elimina colonna</button><button data-tip="Elimina l’intera tabella" onClick={()=>editor.chain().focus().deleteTable().run()}>Rimuovi tabella</button></div>}
      {showFind&&<div className="findbar"><Search size={15}/><input aria-label="Cerca nel testo" placeholder="Trova nel testo" value={find} onChange={e=>setFind(e.target.value)}/><input aria-label="Sostituisci con" placeholder="Sostituisci con" value={replace} onChange={e=>setReplace(e.target.value)}/><button data-tip="Seleziona la prossima occorrenza nel testo (senza distinzione tra maiuscole e minuscole)" onClick={()=>findNext()}>Trova</button><button data-tip="Sostituisce l’occorrenza selezionata e passa alla successiva con «Trova»" onClick={()=>findNext(true)}>Sostituisci selezione</button><button aria-label="Chiudi ricerca" onClick={()=>setShowFind(false)}><X size={16}/></button></div>}
      {(busy||aiError)&&<div className={'ai-feedback'+(aiError?' bad':'')} role={aiError?'alert':'status'}><span>{aiError||formatProgress||'L’AI sta elaborando il brano… Puoi annullare l’attesa.'}</span><button onClick={()=>{clearSuggestion();setAiError('');}}>{busy?'Annulla':'Chiudi'}</button></div>}
      {repoError&&<div role="alert" className="error-banner">{repoError}<button onClick={()=>setRepoOpen('load')}>Apri GitHub</button><button aria-label="Chiudi errore GitHub" onClick={()=>setRepoError('')}><X size={15}/></button></div>}
      {error&&<div role="alert" className="error-banner">{error}<button data-tip="Prova di nuovo a salvare le modifiche" onClick={()=>void save()}>Riprova salvataggio</button><button aria-label="Chiudi errore" onClick={()=>setError('')}><X size={15}/></button></div>}
      <div className="writing-area"><div className="canvas" ref={canvasRef}><div className="page-topline"><span>DOCUMENTO PERSONALE</span><SourceBadge source={source} busy={busy} onClick={()=>setKbOpen(true)}/></div>{simple&&<div className="m-source"><SourceBadge source={source} busy={busy} compact onClick={()=>setKbOpen(true)}/></div>}<div className="paper" ref={paperRef} style={pages?{'--page-width':PAGE.width+'px','--page-height':PAGE.height+'px','--page-margin':PAGE.margin+'px','--page-gap':PAGE.gap+'px'} as CSSProperties:undefined}>{pages===1&&<div className="a4-sheets" aria-hidden="true">{Array.from({length:pageCount},(_,i)=><div className="a4-sheet" key={i}><span>Pagina {i+1} di {pageCount}</span></div>)}</div>}<EditorContent editor={editor}/></div><div className="page-bottom">Le idee sono tue. Le possibilità, infinite.</div></div>
        <aside className="assistant"><div className="assistant-title"><span className="spark-icon"><Sparkles size={19}/></span><div><h2>Il tuo assistente</h2><p>Un passo avanti, insieme.</p></div><span className="live-dot"/><button className="m-close" aria-label="Chiudi assistente" onClick={()=>setMobileAI(false)}><X size={22}/></button></div>
          <ModeSwitch mode={mode} setMode={changeMode}/>
          {mode==='libera'&&<FreeCard fp={fp}/>}
          {mode!=='libera'&&<>
          <button className="writing-memory-button" aria-label="Gestisci la memoria della mia voce" onClick={()=>setMemoryOpen(true)}><span>La mia voce</span><small>{writingMemory.enabled?writingMemory.sources.length+' testi in memoria':'In pausa'}</small></button>
          <button className="writing-memory-button" aria-label="Gestisci le knowledge base di stile" onClick={()=>setKbOpen(true)}><span>Knowledge base</span><small>{activeKb?'In uso: '+activeKb.name:kbs.length?kbs.length+' disponibili · nessuna in uso':'Carica testi tuoi o di un autore'}</small></button>
          <ProjectChip project={project} onOpen={()=>setProjectOpen(true)}/>
          <label className="profile-select" data-tip="Account AI usato per suggerimenti e analisi: aggiungine altri da Impostazioni › Provider AI">PROFILO AI<select value={profile} onChange={e=>setProfile(e.target.value)}><option value="">Collega un provider</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {PROVIDERS[p.provider].name}</option>)}</select></label>
          {mode==='assistita'&&<section className="ai-card"><div className="ai-card-heading"><span>{aiPreferences.trigger==='tab'?'Suggerimenti su richiesta':'Suggerimenti discreti'}</span>{aiPreferences.trigger==='pause'&&<button role="switch" aria-checked={aiOn} aria-label="Suggerimenti automatici" data-tip={aiOn?'Metti in pausa i suggerimenti automatici':'Riattiva i suggerimenti automatici mentre scrivi'} className={'switch '+(aiOn?'on':'')} onClick={()=>setAiOn(!aiOn)}><span/></button>}</div><p>Le parole giuste, nella tua voce, mentre scrivi.</p><label>Avvio AI<select aria-label="Avvio AI" value={aiPreferences.trigger} onChange={e=>changeAiPreferences({...aiPreferences,trigger:e.target.value as AiPreferences['trigger']})}><option value="pause">Automatico dopo una pausa</option><option value="tab">Quando premo Tab</option></select></label>{aiPreferences.trigger==='tab'&&<button className="ai-request-button" disabled={busy} onMouseDown={e=>e.preventDefault()} onClick={()=>void ask(editor?.state.selection.empty?autoMode:'rewrite')}>Chiedi ora <kbd>Tab</kbd></button>}<div className="segmented"><button className={autoMode==='complete'?'active':''} data-tip="Propone come continuare la frase, correggendo refusi e ripetizioni accidentali" onClick={()=>setAutoMode('complete')}>Completa</button><button className={autoMode==='rewrite'?'active':''} data-tip="Mentre scrivi propone una versione più chiara della frase corrente" onClick={()=>setAutoMode('rewrite')}>Migliora frase</button></div><IntentRow detected={detected} choice={intentChoice} setChoice={setIntentChoice}/>{aiPreferences.trigger==='pause'&&<label className="delay-label" data-tip="Quanto aspettare dopo l’ultima battuta prima di chiedere un suggerimento: più lunga, meno richieste al provider">Pausa prima del suggerimento <strong>{delay} ms</strong><input aria-label="Pausa suggerimenti" type="range" min="400" max="1600" step="100" value={delay} onChange={e=>setDelay(+e.target.value)}/></label>}<div className="ai-card-footer"><span className={'tiny-dot '+(!aiOn?'off':'')}/>{aiPreferences.trigger==='tab'?'Premi Tab per chiedere, poi Tab per accettare':!aiOn?'Suggerimenti in pausa':activeProfile?'Pronto a scrivere con te':'In attesa del tuo provider'}</div></section>}
          {mode==='coscrittura'&&<><IntentRow detected={detected} choice={intentChoice} setChoice={setIntentChoice}/>
            <div className="segmented cowrite-tabs" role="tablist"><button role="tab" aria-selected={coTab==='genera'} className={coTab==='genera'?'active':''} data-tip="Fai scrivere o riscrivere un brano all’AI" onClick={()=>setCoTab('genera')}><PenLine size={13}/>Genera</button><button role="tab" aria-selected={coTab==='direzioni'} className={coTab==='direzioni'?'active':''} data-tip="Esplora tre possibili sviluppi della trama dal punto del cursore" onClick={()=>setCoTab('direzioni')}><GitBranch size={13}/>Direzioni</button></div>
            {coTab==='genera'?<div className="rewrite-actions"><button data-tip="Scrive il paragrafo successivo partendo dal cursore, nella voce scelta nel progetto" onClick={()=>void ask('continue')}><PenLine size={17}/><span>Continua la scena<small>Un paragrafo dal cursore, nella voce scelta</small></span><ChevronRight size={15}/></button><button data-tip="Riscrive la selezione (o il paragrafo del cursore) nella voce d’autore scelta, senza cambiarne il contenuto" onClick={()=>void ask('voice')}><Drama size={17}/><span>Riscrivi nella voce scelta<small>Selezione o paragrafo, stesso contenuto</small></span><ChevronRight size={15}/></button><button data-tip="Propone una versione più chiara e scorrevole della selezione o del paragrafo" onClick={()=>void ask('rewrite')}><WandSparkles size={17}/><span>Migliora la scrittura<small>Più chiara, sempre tua</small></span><ChevronRight size={15}/></button><button data-tip="Accorcia la selezione o il paragrafo togliendo il superfluo" onClick={()=>void ask('shorten')}><AlignLeft size={17}/><span>Rendi più conciso<small>Vai dritto al punto</small></span><ChevronRight size={15}/></button><button data-tip="Riscrive la selezione o il paragrafo con un registro professionale" onClick={()=>void ask('formal')}><FileText size={17}/><span>Tono professionale<small>Il registro giusto</small></span><ChevronRight size={15}/></button></div>
            :editor&&<Directions editor={editor} run={run} ctx={narrative} ready={!!activeProfile} onWrite={direction=>void ask('continue',false,direction)}/>}</>}
          {mode==='revisione'&&editor&&<Review editor={editor} project={project} setProject={setProject} run={run} ctx={narrative} fp={fp} ready={!!activeProfile} jump={jump}/>}
          </>}
          {((mode!=='revisione'&&mode!=='libera')||suggestion||busy||aiError||aiWarning)&&<div className={'suggestion-box'+(suggestion?' has-proposal':'')+(busy?' is-busy':'')} aria-live="polite"><div><Sparkles size={15}/><strong>{busy&&!suggestion?'Sto pensando…':suggestion?(SUGGESTION_TITLES[suggestion.mode]||'Correzione proposta'):'Il prossimo pensiero'}</strong>{(busy||suggestion)&&<SourceBadge source={source} busy={busy} compact onClick={()=>setKbOpen(true)}/>}{(busy||suggestion)&&<button aria-label="Scarta suggerimento" data-tip="Scarta il suggerimento" onClick={clearSuggestion}><X size={14}/></button>}</div>{[aiWarning,aiError].filter(Boolean).map(w=><p key={w} className="ai-warning" role="alert"><TriangleAlert size={14}/><span>{w}</span><button aria-label="Chiudi avviso" onClick={()=>{setAiWarning('');setAiError('');}}><X size={12}/></button>{isDeviceProfile(profile)&&aiError===w&&<button onClick={()=>{const p=profiles.find(p=>p.id===profile);if(p)setForm({id:p.id,name:p.name,provider:p.provider,model:p.model,key:'',baseUrl:p.baseUrl||'',dailyLimit:p.daily_limit});setSettings('ai');}}>Configura modello locale</button>}</p>)}{suggestion?<>{suggestion.replacements?<AiBatchFormatPreview parts={suggestion.replacements}/>:suggestion.content?<AiFormatPreview content={suggestion.content}/>:<p className="proposal">{(suggestion.mode==='complete'||suggestion.mode==='continue')&&suggestion.original===undefined?<>{suggestion.base&&<span className="proposal-context">{suggestion.base.length>70?'…'+suggestion.base.slice(-70).trimStart():suggestion.base}</span>}<mark>{suggestion.text}</mark></>:proposalDiff?proposalDiff.map((part,i)=>part.type==='same'?<span key={i}>{part.text}</span>:part.type==='add'?<ins key={i}>{part.text}</ins>:<del key={i}>{part.text}</del>):suggestion.text}</p>}{suggestion.content&&<small className="proposal-note">Titoli, paragrafi, caratteri, colori ed enfasi si applicano con Accetta o Tab.</small>}{proposalDiff&&<small className="proposal-note">{proposalDiff.some(p=>p.type!=='same')?<><ins>in verde</ins> le parole nuove, <del>barrate</del> quelle rimosse</>:'Nessuna modifica necessaria: il testo va già bene.'}</small>}{proposalVoice!==null&&<small className="proposal-note voice-match"><Drama size={12}/>Vicinanza alla tua impronta stilistica: <strong>{proposalVoice}%</strong></small>}{suggestion.cached&&<small className="proposal-note">Dalla memoria: nessuna nuova chiamata al provider.</small>}<div className="proposal-actions"><button className="accept" data-tip="Inserisce la proposta nel testo (tasto Tab)" disabled={!suggestion.done} onClick={acceptSuggestion}><Check size={15}/>Accetta<kbd>Tab</kbd></button><button className="dismiss" data-tip="Ignora la proposta e continua a scrivere (tasto Esc)" onClick={clearSuggestion}>Scarta<kbd>Esc</kbd></button></div></>:!aiWarning&&!aiError&&<p>{!profiles.length?'Collega una chiave API per dare una marcia in più alle tue idee.':'Scrivi una frase. Il suggerimento apparirà qui, senza interrompere il tuo ritmo.'}</p>}{!profiles.length&&<button className="connect" data-tip="Aggiungi la chiave API di un provider per attivare l’AI" onClick={()=>setSettings('ai')}><Plus size={14}/>Collega il tuo provider</button>}</div>}
          <div className="assistant-footnote"><ShieldCheck size={15}/><p>Il testo viene inviato al provider selezionato; con Ollama e LM Studio va al modello sul dispositivo. <button data-tip="Apri Impostazioni › Provider AI" onClick={()=>setSettings('ai')}>Gestisci le API</button> · <button data-tip="Apri Impostazioni › Regole di scrittura" onClick={()=>setSettings('rules')}>Regole di scrittura</button></p></div><div className="shortcuts"><span><kbd>Tab</kbd> {aiPreferences.trigger==='tab'?'chiedi / accetta':'accetta'}</span><span><kbd>Esc</kbd> ignora</span></div>
        </aside></div>
      </EditorToolbars>
      {((simple&&!mobileAI)||(!simple&&!visibleAssistant))&&(suggestion||busy||aiError||aiWarning)&&<div className="m-proposal" aria-live="polite" onMouseDown={e=>e.preventDefault()}>
        <div className="m-proposal-head"><Sparkles size={16}/><strong>{busy&&!suggestion?'Sto pensando…':suggestion?(SUGGESTION_TITLES[suggestion.mode]||'Correzione proposta'):'Avviso'}</strong>{(busy||suggestion)&&<SourceBadge source={source} busy={busy} compact onClick={()=>setKbOpen(true)}/>}<button aria-label="Scarta" onClick={()=>{clearSuggestion();setAiWarning('');setAiError('');}}><X size={20}/></button></div>
        {[aiWarning,aiError].filter(Boolean).map(w=><p key={w} className="m-proposal-warning"><TriangleAlert size={15}/>{w}</p>)}
        {suggestion&&<>{suggestion.replacements?<AiBatchFormatPreview parts={suggestion.replacements}/>:suggestion.content?<AiFormatPreview content={suggestion.content}/>:<p className="m-proposal-text proposal">{proposalDiff?proposalDiff.map((part,i)=>part.type==='same'?<span key={i}>{part.text}</span>:part.type==='add'?<ins key={i}>{part.text}</ins>:<del key={i}>{part.text}</del>):suggestion.text}</p>}<div className="m-proposal-actions"><button className="m-accept" disabled={!suggestion.done} onClick={acceptSuggestion}><Check size={19}/>Accetta</button><button onClick={clearSuggestion}>Scarta</button></div></>}
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
        <label><ImagePlus size={20}/>Inserisci immagine da file<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" disabled={imageBusy} onChange={e=>{const f=e.target.files?.[0];setSheet(null);if(f)void insertEditorImage(f);e.target.value='';}}/></label>
        <button disabled={imageBusy} onClick={()=>{setSheet(null);void insertEditorImage();}}><ClipboardPaste size={20}/>Incolla immagine dagli appunti</button>
        <button disabled={busy||!editor||editor.state.selection.empty} onClick={()=>{setSheet(null);void formatOnly('selection');}}><Paintbrush size={20}/>Formatta testo selezionato</button>
        <button disabled={busy} onClick={()=>{setSheet(null);void formatOnly('document');}}><Paintbrush size={20}/>Formatta documento intero</button>
        <button onClick={()=>{setSheet(null);setShowFind(true);}}><Search size={20}/>Trova e sostituisci</button>
        <button onClick={()=>{setSheet(null);void openHistory();}}><Clock3 size={20}/>Cronologia delle versioni</button>
        <button onClick={()=>{setSheet(null);setMemoryOpen(true);}}>La mia voce</button><button onClick={()=>{setSheet(null);setKbOpen(true);}}>Knowledge base di stile</button><button onClick={()=>{setSheet(null);setSettings('ai');}}><Settings2 size={20}/>Impostazioni</button>
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
    {settings&&<SettingsModal tab={settings} setTab={setSettings} onClose={()=>setSettings(null)}
      provider={{local:LOCAL,owner,profiles,vaultReady,error,form,setForm,formBusy,onSave:()=>void saveProfile(),onRemove:p=>void removeProfile(p)}}
      github={{busy:repoBusy,loaded,onSaveNow:()=>{setSettings(null);void requestRepositorySave();},onOpenDocuments:()=>{setSettings(null);setRepoOpen('load');}}}
      rules={{rules,onChange:changeRules}}
      general={{theme,setTheme:changeTheme,pages:pagePref,pageViews:PAGE_VIEWS,setPages:changePages,pagesAvailable:!simple,delay,setDelay,aiOn,setAiOn,narrow,simple,setSimple,aiPreferences,setAiPreferences:changeAiPreferences}}/>}
    {projectOpen&&<ProjectModal project={project} setProject={setProject} onClose={()=>setProjectOpen(false)}/>}
    {history&&<div className="modal-backdrop" onClick={()=>setHistory(null)}><section className="modal history-modal" role="dialog" aria-modal="true" aria-label="Cronologia versioni" onClick={e=>e.stopPropagation()}><button className="modal-close tool" aria-label="Chiudi cronologia" onClick={()=>setHistory(null)}><X size={20}/></button><Clock3 size={26}/><h2>La storia delle tue idee.</h2><p className="modal-subtitle">Fino a 30 versioni precedenti, registrate al massimo una volta al minuto.</p>{!history.length&&<p className="empty-state">Le versioni appariranno qui dopo le prossime modifiche salvate.</p>}{history.map(r=><div className="revision-row" key={r.id}><div><strong>{r.title}</strong><small>{new Date(r.created).toLocaleString('it-IT')}</small></div><button data-tip="Riporta il documento a questa versione; quella attuale resta nella cronologia" onClick={async()=>{if(!window.confirm('Ripristinare questa versione? La versione attuale sarà conservata nella cronologia.'))return;if(!await save())return;try{await api('revisions',{document:active,title:current.current.title,content:editor?.getJSON()});clearSuggestion();editor?.commands.setContent(JSON.parse(r.content));current.current.title=r.title;setTitle(r.title);markDirty();if(await save())setHistory(null);}catch(err){setError((err as Error).message);}}}>Ripristina</button></div>)}</section></div>}
  </div>;
}

