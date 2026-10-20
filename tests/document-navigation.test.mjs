import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { documentOutline, searchDocument, setParagraphRole } from '../lib/document-navigation.ts';
import { pageRangeAt, paginationKey } from '../lib/pagination.ts';
const schema = new Schema({
  nodes: {doc:{content:'block+'},paragraph:{group:'block',content:'inline*'},heading:{group:'block',content:'inline*',attrs:{level:{default:1}}},text:{group:'inline'},hardBreak:{inline:true,group:'inline'},bulletList:{group:'block',content:'listItem+'},listItem:{content:'paragraph block*'}},
  marks: {bold:{},italic:{},link:{attrs:{href:{}}},textStyle:{attrs:{fontSize:{default:null},fontFamily:{default:null}}}}
});
const p=text=>schema.node('paragraph',null,text?schema.text(text):undefined),h=(level,text)=>schema.node('heading',{level},schema.text(text));
test('outline follows actual chapter/section hierarchy and optionally includes body paragraphs',()=>{
  const doc=schema.node('doc',null,[h(1,'Primo capitolo'),p('Introduzione.'),h(2,'Una sezione'),h(3,'Un dettaglio'),p('Il corpo.'),h(1,'Secondo capitolo')]);
  const outline=documentOutline(doc);assert.deepEqual(outline.map(e=>e.level),[1,2,3,1]);assert.deepEqual(outline[2].parents,[outline[0].pos,outline[1].pos]);assert.deepEqual(outline[3].parents,[]);assert.equal(outline[0].children,true);
  for(const item of outline)assert.equal(doc.textBetween(item.from,item.to),item.text);
  const paragraphs=documentOutline(doc,true);assert.equal(paragraphs.length,6);assert.equal(paragraphs[1].level,7);assert.deepEqual(paragraphs[4].parents,[outline[0].pos,outline[1].pos,outline[2].pos]);
});
test('document search crosses font/mark boundaries and returns valid offsets after emoji and line breaks',()=>{
  const doc=schema.node('doc',null,[schema.node('paragraph',null,[schema.text('😀 Un con'),schema.text('cetto',[schema.mark('bold')]),schema.text(' importante.'),schema.node('hardBreak'),schema.text('UN CONCETTO.')]),p('Un altro concetto.')]);
  const result=searchDocument(doc,'un concetto');assert.equal(result.matches.length,2);
  for(const match of result.matches)assert.equal(doc.textBetween(match.from,match.to).toLocaleLowerCase(),'un concetto');
  assert.equal(searchDocument(doc,'[a+b]').matches.length,0);assert.equal(searchDocument(doc,'  ').matches.length,0);
  assert.equal(searchDocument(doc,'concetto',2).truncated,true);assert.equal(searchDocument(doc,'concetto',2).matches.length,2);
});
test('manual chapter roles change hierarchy and font size while preserving words, links and other paragraphs',()=>{
  const original=schema.mark('textStyle',{fontSize:'18px',fontFamily:'Georgia'}),link=schema.mark('link',{href:'https://example.com'});
  const doc=schema.node('doc',null,[schema.node('paragraph',null,schema.text('Il capitolo',[original,link])),p('Resto del testo.')]);
  const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,3)}),tr=setParagraphRole(state.tr,1),result=state.apply(tr);
  assert.equal(result.doc.firstChild.type.name,'heading');assert.equal(result.doc.firstChild.attrs.level,1);assert.equal(result.doc.firstChild.firstChild.marks.find(m=>m.type.name==='textStyle').attrs.fontSize,'38px');
  assert.equal(result.doc.firstChild.firstChild.marks.find(m=>m.type.name==='link').attrs.href,'https://example.com');assert.deepEqual(result.doc.lastChild.toJSON(),doc.lastChild.toJSON());assert.equal(result.doc.textContent,doc.textContent);
  const body=result.apply(setParagraphRole(result.tr,0));assert.equal(body.doc.firstChild.type.name,'paragraph');assert.equal(body.doc.firstChild.firstChild.marks.find(m=>m.type.name==='textStyle').attrs.fontSize,'18px');body.doc.check();
});
test('an empty paragraph can become a chapter and future text inherits its role size',()=>{
  const doc=schema.node('doc',null,[p('')]),state=EditorState.create({schema,doc});
  const next=state.apply(setParagraphRole(state.tr,2));assert.equal(next.doc.firstChild.type.name,'heading');assert.equal(next.storedMarks.find(m=>m.type.name==='textStyle').attrs.fontSize,'28px');
});
test('chapter assignment leaves list content valid instead of inserting an invalid heading',()=>{
  const doc=schema.node('doc',null,[schema.node('bulletList',null,[schema.node('listItem',null,[p('Un punto')])])]);
  const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,3)}),tr=setParagraphRole(state.tr,1);
  assert.deepEqual(tr.doc.toJSON(),doc.toJSON());tr.doc.check();
});
test('page navigation uses the same A4 boundaries as formatting and clamps unavailable page indices',()=>{
  const doc=schema.node('doc',null,[p('Una frase. '.repeat(50))]),view={state:{doc,[paginationKey.key]:{enabled:true,breaks:[{pos:100},{pos:200}]}}};
  assert.deepEqual(pageRangeAt(view,0),{from:0,to:100});assert.deepEqual(pageRangeAt(view,1),{from:100,to:200});assert.deepEqual(pageRangeAt(view,999),{from:200,to:doc.content.size});
});
test('Word export retains chapter, section and subsection heading levels',async()=>{
  const {exportDocx}=await import('../lib/docx.ts'),{default:JSZip}=await import('jszip');
  const blob=await exportDocx(schema.node('doc',null,[h(1,'Capitolo'),h(2,'Sezione'),h(3,'Sottosezione')]).toJSON());
  const zip=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await zip.file('word/document.xml').async('string');
  for(const level of [1,2,3])assert.ok(xml.includes('w:pStyle w:val="Heading'+level+'"'));
});
