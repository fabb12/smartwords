import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_WRITING_MEMORY, authorVoiceInstruction, excludeWritingSource, exportWritingMemory, importWritingMemory, learnWriting, readWritingMemory, sanitizeWritingMemory, storeWritingMemory, writingExpressions, writingMemoryKey, writingMemorySummary, writingSample, writingTextFromDocument } from '../lib/writing-memory.ts';
import { assistPrompts } from '../lib/providers.ts';

const prose=Array.from({length:12},(_,i)=>`Mi chiedo se la luce del mattino cambi davvero le cose. Forse il vento porta una risposta diversa ${i}. Eppure resto qui, davanti alla finestra, a cercare parole semplici.`).join('\n');
const second=Array.from({length:10},(_,i)=>`A dire il vero, il mare mi sembrava una pagina aperta. Camminavo piano sulla spiaggia e pensavo alla strada che avrei scelto ${i}.`).join('\n');
const learned=()=>learnWriting({...EMPTY_WRITING_MEMORY},'a','Primo testo',prose,10);

test('writing memory survives a new document and repeated saves do not inflate the learned corpus',()=>{
  const a=learned(),words=writingMemorySummary(a).words;
  assert.equal(learnWriting(a,'a','Primo testo',prose,20),a);
  const duplicate=learnWriting(a,'duplicate','Copia',prose,20);
  assert.equal(writingMemorySummary(duplicate).sources,1);assert.equal(writingMemorySummary(duplicate).words,words);
  const b=learnWriting(duplicate,'b','Secondo testo',second,30);
  assert.equal(writingMemorySummary(b).sources,2);
  const prompt=JSON.parse(authorVoiceInstruction(b,'Una nuova storia'));
  assert.ok(prompt.sampleWords>words);assert.ok(prompt.measuredStyle.includes('frasi:'));
  assert.equal(prompt.styleExamples.length,2);
  const edited=learnWriting(b,'a','Primo testo',second,40);
  assert.equal(edited.sources.filter(s=>s.id==='a').length,1);assert.equal(edited.sources.find(s=>s.id==='a').sample,second);
});

test('turning memory off, excluding a document and erasing it prevent reuse and relearning',()=>{
  const a=learned(),off={...a,enabled:false};
  assert.equal(authorVoiceInstruction(off,'nuovo testo'),'');assert.equal(learnWriting(off,'new','Nuovo',second),off);
  const excluded=excludeWritingSource(a,'a');assert.equal(excluded.sources.length,0);assert.equal(learnWriting(excluded,'a','Primo',prose),excluded);
  const erased={...EMPTY_WRITING_MEMORY,enabled:false};assert.equal(authorVoiceInstruction(erased),'');assert.equal(learnWriting(erased,'a','Primo',prose),erased);
});

test('style examples are optional, notes work without a corpus and profiles remain bounded in the prompt',()=>{
  const a={...learned(),notes:'Diretto e curioso, con ironia leggera.',examples:false};
  const prompt=JSON.parse(authorVoiceInstruction(a,'luce'));
  assert.equal(prompt.authorPreferences,a.notes);assert.equal(prompt.styleExamples,undefined);
  assert.equal(JSON.parse(authorVoiceInstruction({...EMPTY_WRITING_MEMORY,notes:'Frasi asciutte.'})).authorPreferences,'Frasi asciutte.');
  assert.equal(authorVoiceInstruction(EMPTY_WRITING_MEMORY),'');
  const large=sanitizeWritingMemory({...a,notes:'x'.repeat(600),sources:Array.from({length:40},(_,i)=>({id:String(i),title:'Testo',sample:prose+' '+i,updated:i}))});
  assert.ok(authorVoiceInstruction({...large,examples:true},'luce').length<=4500);
});

test('only writing modes receive historical voice; scene constraints and explicit narrative voice keep priority',()=>{
  const authorVoice=authorVoiceInstruction(learned(),'nuova scena');
  for(const mode of ['complete','rewrite','shorten','continue','voice','directions']){
    const p=assistPrompts({mode,text:'La porta',authorVoice});
    assert.equal(JSON.parse(p.prompt).authorVoice,authorVoice);
    assert.ok(p.system.includes('styleGuidance take precedence'));assert.ok(p.system.includes('never copy a whole example'));
  }
  for(const mode of ['formal','memory','check','ask'])assert.equal(JSON.parse(assistPrompts({mode,text:'Testo',authorVoice}).prompt).authorVoice,undefined);
});

test('memory persists with account isolation and malformed storage or quota failures do not erase documents',t=>{
  const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};t.after(()=>delete globalThis.localStorage);
  storeWritingMemory(learned(),'alice');assert.equal(readWritingMemory('alice').sources[0].title,'Primo testo');assert.equal(readWritingMemory('bob').sources.length,0);
  assert.notEqual(writingMemoryKey('alice'),writingMemoryKey('local'));
  data.set(writingMemoryKey('bob'),'{broken');assert.equal(readWritingMemory('bob').sources.length,0);
  data.set('scrivia:documents','documenti intatti');localStorage.setItem=()=>{throw new Error('quota');};
  assert.throws(()=>storeWritingMemory(learned(),'alice'),/documenti restano salvati/);assert.equal(data.get('scrivia:documents'),'documenti intatti');
});

test('export/import transfers voice, merges newer samples and preserves existing exclusions',()=>{
  const original={...learned(),notes:'Voce curiosa.'},file=exportWritingMemory(original);
  const restored=importWritingMemory(file,learnWriting(EMPTY_WRITING_MEMORY,'b','Altro',second,5));
  assert.equal(restored.sources.length,2);assert.equal(restored.notes,'Voce curiosa.');
  const excluded=excludeWritingSource(EMPTY_WRITING_MEMORY,'a');assert.equal(importWritingMemory(file,excluded).sources.length,0);
  assert.throws(()=>importWritingMemory('{"version":1}',EMPTY_WRITING_MEMORY),/non è un profilo/);
  assert.throws(()=>importWritingMemory('x'.repeat(1_500_001),EMPTY_WRITING_MEMORY),/1,5 MB/);
});

test('sampling, sanitization and shortened documents replace stale remembered text within storage limits',()=>{
  const text=(prose+'\n').repeat(12)+' Ultime parole nel testo più recente.';
  const sample=writingSample(text);assert.ok(sample.length<=6000);assert.ok(sample.endsWith('Ultime parole nel testo più recente.'));
  const memory=sanitizeWritingMemory({notes:'x'.repeat(1000),sources:Array.from({length:50},(_,i)=>({id:String(i),title:'Titolo',sample:text,updated:i})),excluded:['49']});
  assert.equal(memory.notes.length,600);assert.equal(memory.sources.length,40);assert.ok(!memory.sources.some(s=>s.id==='49'));
  assert.equal(learnWriting(learned(),'a','Primo','Testo cancellato.').sources.length,0);
});

test('recurring expressions need several sentences and do not learn accidental adjacent duplicate words',()=>{
  const phrases=writingExpressions(learned().sources);assert.ok(phrases.some(p=>p.includes('mi chiedo se')));
  assert.deepEqual(writingExpressions([{id:'x',title:'x',updated:1,sample:'Forse forse forse forse.'}]),[]);
});

test('saved document text extraction keeps paragraphs and excludes image payloads and formatting attributes',()=>{
  const doc={type:'doc',content:[{type:'heading',content:[{type:'text',text:'Titolo'}]},{type:'paragraph',content:[{type:'text',text:'Una frase.'},{type:'hardBreak'},{type:'text',text:'Seconda riga.'}]},{type:'image',attrs:{src:'data:image/png;base64,segreto'}}]};
  assert.equal(writingTextFromDocument(doc),'Titolo\nUna frase.\nSeconda riga.');
});
