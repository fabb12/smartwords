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

test('Word export accepts rgb(), short and translucent colors instead of failing', async () => {
  const { wordColor } = await import('../lib/docx.ts');
  assert.equal(wordColor('rgb(15, 138, 77)'), '0F8A4D'); assert.equal(wordColor('#285c8e'), '285C8E'); assert.equal(wordColor('#abc'), 'AABBCC');
  assert.equal(wordColor('rgba(0, 0, 0, 0.5)'), '808080'); assert.equal(wordColor('#ffc8004d'), 'FFEEB2'); assert.equal(wordColor('red'), 'FF0000');
  assert.equal(wordColor('var(--x)'), undefined); assert.equal(wordColor(null), undefined);
  const text = (t, marks) => ({ type: 'text', text: t, marks });
  const blob = await exportDocx({ type: 'doc', content: [{ type: 'paragraph', content: [
    text('Verde', [{ type: 'textStyle', attrs: { color: 'rgb(15, 138, 77)' } }]), text(' strano', [{ type: 'textStyle', attrs: { color: 'hsl(1 2% 3%)' } }]), text(' evidenziato', [{ type: 'highlight', attrs: { color: '#ffc8004d' } }]),
  ] }] });
  const { default: JSZip } = await import('jszip'), xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml').async('string');
  assert.match(xml, /w:color w:val="0F8A4D"/); assert.match(xml, /w:fill="FFEEB2"/);
});
