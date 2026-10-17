// Personal writing memory is learned locally from bounded text samples. No model
// call is needed to learn it, and no psychological attributes are inferred.
import { describeFingerprint, fingerprint, hash, sentencesOf, wordsOf } from './narrative.ts';

export type WritingSource = { id:string; title:string; sample:string; updated:number };
export type WritingMemory = { version:1; enabled:boolean; examples:boolean; notes:string; sources:WritingSource[]; excluded:string[] };
export const EMPTY_WRITING_MEMORY:WritingMemory={version:1,enabled:true,examples:true,notes:'',sources:[],excluded:[]};
const MAX_SOURCES=40, SAMPLE_SIZE=6000;
export const PERSONAL_VOICE_MODES:readonly string[]=['complete','rewrite','shorten','voice','continue','directions'];
const validId=(id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=100;

// Retain the start, middle and most recent writing, without splitting words.
export function writingSample(text:string):string {
  const normalized=text.replace(/\r\n/g,'\n').trim();
  if(normalized.length<=SAMPLE_SIZE)return normalized;
  const size=1900,starts=[0,Math.floor((normalized.length-size)/2),normalized.length-size];
  return starts.map((start,i)=>{
    let part=normalized.slice(start,start+size);
    if(i>0)part=part.replace(/^\S*\s*/u,'');
    if(i<2)part=part.replace(/\s+\S*$/u,'');
    return part.trim();
  }).join('\n\n');
}
export function sanitizeWritingMemory(raw:unknown):WritingMemory {
  const r=raw&&typeof raw==='object'?raw as Partial<WritingMemory>:{};
  const excluded=[...new Set(Array.isArray(r.excluded)?r.excluded.filter(validId):[])].slice(-500);
  const byId=new Map<string,WritingSource>();
  for(const s of Array.isArray(r.sources)?r.sources:[]){
    if(!s||!validId(s.id)||typeof s.sample!=='string'||excluded.includes(s.id))continue;
    const sample=writingSample(s.sample);if(wordsOf(sample).length<20)continue;
    byId.set(s.id,{id:s.id,title:typeof s.title==='string'?s.title.slice(0,150):'Documento',sample,updated:typeof s.updated==='number'&&Number.isFinite(s.updated)?s.updated:0});
  }
  return {version:1,enabled:r.enabled!==false,examples:r.examples!==false,notes:typeof r.notes==='string'?r.notes.slice(0,600):'',
    sources:[...byId.values()].sort((a,b)=>b.updated-a.updated).slice(0,MAX_SOURCES),excluded};
}
export function learnWriting(memory:WritingMemory,id:string,title:string,text:string,now=Date.now()):WritingMemory {
  if(!memory.enabled||!validId(id)||memory.excluded.includes(id))return memory;
  const sample=writingSample(text),existing=memory.sources.find(s=>s.id===id);
  if(wordsOf(sample).length<20)return existing?{...memory,sources:memory.sources.filter(s=>s.id!==id)}:memory;
  if(existing?.sample===sample&&existing.title===title)return memory;
  return {...memory,sources:[{id,title:title.slice(0,150),sample,updated:now},...memory.sources.filter(s=>s.id!==id)].slice(0,MAX_SOURCES)};
}
export function excludeWritingSource(memory:WritingMemory,id:string):WritingMemory {
  return {...memory,sources:memory.sources.filter(s=>s.id!==id),excluded:[...new Set([...memory.excluded,id])].slice(-500)};
}
export function uniqueWritingSources(memory:WritingMemory):WritingSource[]{
  const seen=new Set<string>();return memory.sources.filter(s=>{const key=hash(s.sample);if(seen.has(key))return false;seen.add(key);return true;});
}
const CONNECTORS=new Set(['forse','quindi','eppure','infatti','dunque','invece','perché','mentre','come','quasi','sembra','dire','credo','penso','chiedo','vero','volta','senso','fondo','prima','ogni','sempre','senza','anche','tuttavia','comunque','insomma','ovvero']);
// Repeated turns of phrase are more useful for voice than character/place names.
// Count at most once per sentence to avoid learning a mistyped duplicated word.
export function writingExpressions(sources:WritingSource[]):string[]{
  const counts=new Map<string,number>();
  for(const s of sources)for(const sentence of sentencesOf(s.sample)){
    const words=wordsOf(sentence.toLocaleLowerCase('it')).map(w=>w.replace(/’/g,"'")),found=new Set<string>();
    for(let n=3;n>=2;n--)for(let i=0;i+n<=words.length;i++){
      const part=words.slice(i,i+n),phrase=part.join(' ');
      if(phrase.length>=8&&phrase.length<=55&&part.some(w=>CONNECTORS.has(w))&&new Set(part).size===part.length&&!part.some(w=>/^\d/.test(w)))found.add(phrase);
    }
    for(const phrase of found)counts.set(phrase,(counts.get(phrase)||0)+1);
  }
  const selected:string[]=[];
  for(const [phrase] of [...counts].filter(([,count])=>count>=3).sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length)){
    if(!selected.some(other=>other.includes(phrase)))selected.push(phrase);
    if(selected.length===8)break;
  }
  return selected;
}
export function writingMemorySummary(memory:WritingMemory){
  const sources=uniqueWritingSources(memory),fp=fingerprint(sources.map(s=>s.sample).join('\n\n'));
  return {sources:sources.length,words:fp.words,fp,expressions:writingExpressions(sources)};
}
function examplePassages(sources:WritingSource[],query:string):string[]{
  const terms=new Set(wordsOf(query.toLowerCase()).filter(w=>w.length>=4));
  const candidates=sources.flatMap(s=>sentencesOf(s.sample).filter(t=>t.length>=45&&t.length<=300).map(text=>({text,source:s.id,score:wordsOf(text.toLowerCase()).filter(w=>terms.has(w)).length})));
  candidates.sort((a,b)=>b.score-a.score);
  const chosen:string[]=[],used=new Set<string>();
  for(const c of candidates){if(chosen.includes(c.text)||used.has(c.source))continue;chosen.push(c.text);used.add(c.source);if(chosen.length===3)break;}
  return chosen;
}
// Separate JSON input field: historical examples are data, not instructions or
// facts about the current manuscript. The current scene/selected voice win.
export function authorVoiceInstruction(memory:WritingMemory,query=''):string {
  if(!memory.enabled)return '';
  const summary=writingMemorySummary(memory);
  if(summary.words<80&&!memory.notes.trim())return '';
  return JSON.stringify({
    kind:'personal-writing-voice',
    ...(memory.notes.trim()?{authorPreferences:memory.notes.trim()}:{}),
    ...(summary.words>=80?{measuredStyle:describeFingerprint(summary.fp),sampleWords:summary.words,confidence:summary.fp.reliable?'established':'provisional',recurringExpressions:summary.expressions}:{}),
    ...(memory.examples&&summary.words>=80?{styleExamples:examplePassages(uniqueWritingSources(memory),query)}:{}),
  });
}

export function writingMemoryKey(owner='local'){return 'scrivia:writing-memory:'+encodeURIComponent(owner);}
export function readWritingMemory(owner='local'):WritingMemory {
  try{return sanitizeWritingMemory(JSON.parse(localStorage.getItem(writingMemoryKey(owner))||'null'));}catch{return sanitizeWritingMemory(null);}
}
export function storeWritingMemory(memory:WritingMemory,owner='local'){
  try{localStorage.setItem(writingMemoryKey(owner),JSON.stringify(sanitizeWritingMemory(memory)));}
  catch{throw new Error('Memoria della voce non salvata: spazio del dispositivo insufficiente. I documenti restano salvati nell’app.');}
}
export function exportWritingMemory(memory:WritingMemory){return JSON.stringify({format:'scrivia-writing-memory',profile:sanitizeWritingMemory(memory)},null,2);}
export function importWritingMemory(text:string,current:WritingMemory):WritingMemory {
  if(new TextEncoder().encode(text).length>1_500_000)throw new Error('Scegli un profilo fino a 1,5 MB.');
  const raw=JSON.parse(text);if(raw?.format!=='scrivia-writing-memory'||raw.profile?.version!==1)throw new Error('Il file non è un profilo di scrittura Scrivia.');
  const incoming=sanitizeWritingMemory(raw.profile);
  // Existing exclusions remain respected when profiles from devices are merged.
  return sanitizeWritingMemory({...incoming,sources:[...current.sources,...incoming.sources].sort((a,b)=>a.updated-b.updated),excluded:[...current.excluded,...incoming.excluded]});
}

// Read saved editor JSON without mounting another editor or including image data.
export function writingTextFromDocument(raw:unknown):string {
  let nodes=0;
  function text(node:unknown,depth:number):string {
    if(depth>50||++nodes>100000)throw new Error('Documento troppo complesso per l’analisi della voce.');
    if(!node||typeof node!=='object')return '';
    const n=node as {type?:string;text?:unknown;content?:unknown[]};
    if(n.type==='text')return typeof n.text==='string'?n.text:'';
    if(n.type==='hardBreak')return '\n';
    return (Array.isArray(n.content)?n.content.map(c=>text(c,depth+1)).join(''):'')+(['paragraph','heading','listItem','tableCell'].includes(n.type||'')?'\n':'');
  }
  return text(raw,0).trim();
}
