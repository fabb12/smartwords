import test from 'node:test';
import assert from 'node:assert/strict';
import {Schema} from '@tiptap/pm/model';
import {blocksFromDoc,chapters,locate,fingerprint,styleSimilarity,describeFingerprint,detectIntent,parseJson,cleanFacts,findConflicts,passages,retrieve,citeParts,canonicalAttribute} from '../lib/narrative.ts';
import {voiceInstruction,VOICES} from '../lib/author-styles.ts';

const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{group:'block',content:'inline*'},heading:{group:'block',content:'inline*',attrs:{level:{default:1}}},text:{group:'inline'},hardBreak:{group:'inline',inline:true}}});
const p=t=>({type:'paragraph',content:t?[{type:'text',text:t}]:[]}),h=(t,level=1)=>({type:'heading',attrs:{level},content:[{type:'text',text:t}]});
const book=schema.nodeFromJSON({type:'doc',content:[h('Capitolo 1'),p('Laura aveva gli occhi verdi, come sua madre.'),p('Il treno partì alle sei.'),h('Capitolo 2'),p('Laura sorrise: i suoi occhi blu brillavano nel buio.'),p('Marco aprì la lettera segreta e trovò un indizio.')]});
const chs=chapters(blocksFromDoc(book));

test('chapters follow headings and evidence maps to exact document positions',()=>{
 assert.deepEqual(chs.map(c=>c.title),['Capitolo 1','Capitolo 2']);
 const ev=locate(chs,'«i suoi occhi blu brillavano»');
 assert.equal(ev.chapter,'Capitolo 2');assert.equal(book.textBetween(ev.from,ev.to),'i suoi occhi blu brillavano');
 assert.equal(locate(chs,'Laura aveva gli occhi castani'),null,'an invented quote is never accepted as evidence');
 const typographic=locate(chs,'IL  TRENO partì … alle sei');assert.equal(typographic.chapter,'Capitolo 1');
});

test('chapters without headings are split into parts',()=>{
 const doc=schema.nodeFromJSON({type:'doc',content:Array.from({length:6},(_,i)=>p(('Frase numero '+i+'. ').repeat(60)))});
 const parts=chapters(blocksFromDoc(doc),3000);assert.ok(parts.length>1);assert.equal(parts[0].title,'Parte 1');
});

test('style fingerprint measures sentences, rhythm, dialogue and person',()=>{
 const text='Io camminavo piano. La città dormiva sotto una luce grigia e io pensavo a mia madre, alle sue mani, ai pomeriggi lunghi d’estate.\n«Dove vai?» mi chiese.\nNon risposi. Avevo paura; ma il mare, laggiù, mi chiamava.';
 const fp=fingerprint(text);
 assert.equal(fp.person,'prima');assert.ok(fp.dialogue>0.3&&fp.dialogue<0.4);assert.ok(fp.sentences>=5);assert.ok(fp.spread>0);
 assert.equal(fp.reliable,false);assert.ok(fp.punctuation.semicolon>0);
 const same=styleSimilarity(fingerprint(text.repeat(3)),fingerprint(text));
 const other=styleSimilarity(fingerprint(text.repeat(3)),fingerprint('La sostanziale indeterminazione epistemologica caratterizzante qualsivoglia rappresentazione concettualmente strutturata implica necessariamente considerazioni metodologicamente approfondite, interdisciplinari e comparativamente sistematiche riguardo alle conseguenze ontologiche fondamentali.'));
 assert.ok(same>other,`similar text should score higher (${same} vs ${other})`);
 assert.equal(describeFingerprint(fingerprint('troppo corto')),'');
});

test('intent detection recognises the kind of scene and explains why',()=>{
 const romance=detectIntent('Lei si avvicinò. Sentì il suo sguardo, poi le labbra sfiorarono le sue in un bacio lento; il cuore batteva.');
 assert.equal(romance.id,'romantica');assert.ok(romance.cues.length>0);
 assert.equal(detectIntent('Nel buio sentì dei passi. La porta cigolò, il respiro si fermò per la paura.').id,'suspense');
 assert.equal(detectIntent('Andò al mercato.').id,'auto');
});

test('JSON is extracted from chatty answers and facts without real evidence are dropped',()=>{
 assert.deepEqual(parseJson('Ecco: ```json\n{"a":[1,{"b":"}"}]}\n``` fine'),{a:[1,{b:'}'}]});
 assert.equal(parseJson('nessun json'),null);
 const facts=cleanFacts({facts:[{entity:'Laura',kind:'personaggio',attribute:'colore degli occhi',value:'verdi',quote:'Laura aveva gli occhi verdi'},{entity:'Laura',attribute:'occhi',value:'neri',quote:'aveva occhi neri come la notte'}]},chs[0],chs);
 assert.equal(facts.length,1);assert.equal(facts[0].chapter,'Capitolo 1');
});

test('conflicts compare the same attribute across chapters and can be dismissed',()=>{
 const a=cleanFacts({facts:[{entity:'Laura',attribute:'colore degli occhi',value:'verdi',quote:'Laura aveva gli occhi verdi'}]},chs[0],chs);
 const b=cleanFacts({facts:[{entity:'Laura',attribute:'occhi',value:'blu',quote:'i suoi occhi blu brillavano'},{entity:'Laura',attribute:'occhi',value:'verde',quote:'Laura sorrise'}]},chs[1],chs);
 const conflicts=findConflicts([...a,...b]);
 const pair=c=>[c.a.value,c.b.value].join('/');
 assert.deepEqual(conflicts.map(pair).sort(),['verde/blu','verdi/blu'],'verdi and verde are the same value, blu contradicts both');
 const first=conflicts.find(c=>pair(c)==='verdi/blu');assert.equal(first.a.chapter,'Capitolo 1');assert.equal(first.b.chapter,'Capitolo 2');assert.equal(first.attribute,'occhi');
 assert.equal(findConflicts([...a,...b],[first.id]).length,1);
 assert.equal(canonicalAttribute('Età'),'età');
 const age=(v,q)=>({id:v,entity:'Marco',kind:'personaggio',attribute:'età',value:v,quote:q,chapter:'x',from:q.length});
 assert.equal(findConflicts([age('32 anni','a'),age('40 anni','bb')]).length,1);
 assert.equal(findConflicts([age('32 anni','a'),age('32','bb')]).length,0);
});

test('retrieval keeps relevant passages in reading order and citations must exist',()=>{
 const list=passages(chs,10);
 assert.equal(list.length,4);
 const found=retrieve(list,'Quali indizi ha trovato Marco nella lettera?',60);
 assert.deepEqual(found.map(x=>x.id),['P4']);
 assert.equal(retrieve(list,'qualsiasi cosa',100000).length,4);
 const parts=citeParts('Nella lettera [P4] e anche [P9].',found);
 assert.equal(parts.filter(x=>x.cite).length,1);assert.equal(parts.map(x=>x.text).join(''),'Nella lettera P4 e anche .');
});

test('voice instructions evoke style without copying and default to the author',()=>{
 assert.ok(voiceInstruction('mine','medium','','frasi: brevi').includes("author's own voice"));
 const calvino=voiceInstruction('calvino','light','','');assert.ok(calvino.includes('never copy'));assert.ok(calvino.includes('subtle'));
 assert.ok(voiceInstruction('custom','strong','Frasi secche, molto dialogo','').includes('Frasi secche'));
 for(const id of ['calvino','rovelli','boncinelli','carrere'])assert.ok(VOICES.some(v=>v.id===id));
});
