import test from 'node:test';
import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import {exportDocx} from '../lib/docx.ts';
test('Word export preserves paragraphs, headings, lists and table text',async()=>{
 const text=t=>({type:'text',text:t});
 const blob=await exportDocx({type:'doc',content:[{type:'heading',attrs:{level:1},content:[text('Titolo di prova')]},{type:'paragraph',content:[{...text('Testo in grassetto'),marks:[{type:'bold'}]}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[text('Elemento lista')]}]}]},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[text('Cella di prova')]}]}]}]}]});
 const result=await mammoth.extractRawText({buffer:Buffer.from(await blob.arrayBuffer())});
 for(const expected of ['Titolo di prova','Testo in grassetto','Elemento lista','Cella di prova'])assert.ok(result.value.includes(expected));
 const html=await mammoth.convertToHtml({buffer:Buffer.from(await blob.arrayBuffer())});assert.ok(html.value.includes('<strong>Testo in grassetto</strong>'));
});
