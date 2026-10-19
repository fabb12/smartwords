import test from 'node:test';
import assert from 'node:assert/strict';
import {AiGovernor,sameText,sentenceTarget,wordDiff} from '../lib/ai-governor.ts';
test('word diff marks only changed words and rebuilds both texts',()=>{
 const parts=wordDiff('Io sono andato al mare ieri.','Ieri sono andato al mare.');
 assert.equal(parts.filter(p=>p.type!=='add').map(p=>p.text).join(''),'Io sono andato al mare ieri.');
 assert.equal(parts.filter(p=>p.type!=='del').map(p=>p.text).join(''),'Ieri sono andato al mare.');
 assert.ok(parts.some(p=>p.type==='same'&&p.text.includes('sono andato al')));
 assert.deepEqual(wordDiff('uguale','uguale'),[{type:'same',text:'uguale'}]);
});
test('cache returns answers, expires and evicts the oldest entry',()=>{
 let now=0;const g=new AiGovernor({cacheSize:2,cacheTtl:1000,now:()=>now});
 g.remember('a','A');g.remember('b','B');assert.equal(g.cached('a'),'A');g.remember('c','C');
 assert.equal(g.cached('b'),undefined);assert.equal(g.cached('a'),'A');now=2000;assert.equal(g.cached('c'),undefined);
});
test('automatic requests are spaced and capped per minute; manual ones are not',()=>{
 let now=0;const g=new AiGovernor({minGap:2000,perMinute:3,now:()=>now});
 assert.equal(g.wait(true),0);g.started();assert.equal(g.wait(true),2000);assert.equal(g.wait(false),0);
 now=2000;g.started();now=4000;g.started();now=6000;assert.equal(g.wait(true),54000);now=60000;assert.equal(g.wait(true),0);
});
test('failures pause requests with exponential backoff, success resets it',()=>{
 let now=0;const g=new AiGovernor({now:()=>now});
 assert.equal(g.failed(false),5000);assert.equal(g.wait(false),5000);now=5000;assert.equal(g.failed(true),40000);
 for(let i=0;i<10;i++)g.failed(true);assert.ok(g.wait(false)<=120000);g.succeeded();now=1e9;assert.equal(g.failed(false),5000);
});
test('automatic rewrites wait for a finished sentence or new words and never repeat',()=>{
 const g=new AiGovernor();
 assert.equal(g.worthAsking('rewrite','p','Oggi è'),false);
 assert.equal(g.worthAsking('rewrite','p','Oggi è una bella giornata'),true);g.asked('rewrite','p','Oggi è una bella giornata');
 assert.equal(g.worthAsking('rewrite','p','Oggi è una bella giornata di'),false);
 assert.equal(g.worthAsking('rewrite','p','Oggi è una bella giornata di sole.'),true);
 assert.equal(g.worthAsking('rewrite','p','Oggi è una bella giornata di sole e di vento caldo forte'),true);
 g.asked('complete','p','Ciao a tutti');assert.equal(g.worthAsking('complete','p','Ciao a tutti '),false);assert.equal(g.worthAsking('complete','p','Ciao a tutti v'),true);
});
test('automatic improvements target the last sentence and skip accepted text',()=>{
 const t=(text,settled)=>{const r=sentenceTarget(text,settled);return text.slice(r.start,r.end);};
 assert.equal(t('Oggi è una bella giornata'),'Oggi è una bella giornata');
 assert.equal(t('Prima frase. Seconda frase lunga. '),'Seconda frase lunga.');
 assert.equal(t('Disse: «Vieni qui!» Poi andò via'),'Poi andò via');
 assert.equal(t('Frase già migliorata.','Frase già migliorata.'),'');
 assert.equal(t('Frase già migliorata. ','Frase già migliorata.'),'');
 assert.equal(t('Frase già migliorata. E poi una nuova','Frase già migliorata.'),'E poi una nuova');
 assert.equal(t('Testo cambiato. Altro','Frase già migliorata.'),'Altro');
 const r=sentenceTarget('Uno. Due tre. ');assert.deepEqual(r,{start:5,end:13});
 assert.equal(sameText('Va  bene così.','Va bene così. '),true);assert.equal(sameText('Va bene.','Va benissimo.'),false);
});

test('reconfiguring a profile clears error backoff without disabling automatic request spacing',()=>{
 let now=1000;const g=new AiGovernor({now:()=>now,minGap:2500});
 g.started();g.failed(false);assert.ok(g.wait(false)>0);
 g.resetBackoff();assert.equal(g.wait(false),0);assert.equal(g.wait(true),2500);
});
