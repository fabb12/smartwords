import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { formatRanges, formatReplacement } from '../lib/format-only.ts';
import { replaceAiFormatting } from '../lib/ai-formatting.ts';
import { currentPageRange, paginationKey } from '../lib/pagination.ts';
import { assistPrompts, ASSIST_MODES } from '../lib/providers.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' }, text: { group: 'inline' },
  heading: { group: 'block', content: 'inline*', attrs: { level: { default: 2 } } },
  hardBreak: { inline: true, group: 'inline' }, image: { group: 'block', atom: true, attrs: { src: {} } },
  codeBlock: { group: 'block', content: 'text*', code: true },
}, marks: { bold: {}, italic: {}, code: {}, textStyle: { attrs: { fontFamily: { default: null }, fontSize: { default: null }, color: { default: null } } }, link: { attrs: { href: {} } } } });
const p = text => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const words = text => text.match(/[\p{L}\p{M}\p{N}]+|[^\s]/gu);

test('format-only requests explicitly preserve spelling, punctuation and order, without requesting completion', () => {
  assert.ok(ASSIST_MODES.includes('format'));
  const prompt = assistPrompts({ mode: 'format', text: 'Un errore ortograffico.', formatting: true });
  assert.match(prompt.system, /Preserve every original word/); assert.match(prompt.system, /Never add a heading title/);
  assert.match(prompt.system, /Do not summarize, complete sentences, correct grammar/);
});

test('a complete long document is divided without truncation or overlapping ranges', () => {
  const text = 'Una storia da formattare senza cambiare le parole. '.repeat(420);
  const doc = schema.node('doc', null, [p(text)]), { ranges } = formatRanges(doc, 0, doc.content.size);
  assert.ok(ranges.length > 3); assert.equal(ranges.map(r => r.text).join(''), text);
  for (let i = 0; i < ranges.length; i++) { assert.ok(ranges[i].text.length <= 6000); if (i) assert.equal(ranges[i].from, ranges[i-1].to); }
  let tr = EditorState.create({ schema, doc }).tr;
  const parts = ranges.map(r => formatReplacement(doc, r, r.text));
  for (const part of parts.reverse()) tr = replaceAiFormatting(tr, part.from, part.to, part.content, false);
  assert.deepEqual(words(tr.doc.textContent), words(text)); tr.doc.check();
});

test('format-only rejects any rewritten word or punctuation, but permits paragraphs and emphasis', () => {
  const doc = schema.node('doc', null, [p('Titolo. Una frase con errore ortograffico.')]);
  const range = formatRanges(doc, 0, doc.content.size).ranges[0];
  const result = formatReplacement(doc, range, '## Titolo.\n\nUna **frase** con errore *ortograffico*.');
  assert.equal(result.content[0].type, 'heading');
  for (const answer of ['Titolo. Una frase con errore ortografico.', 'Titolo! Una frase con errore ortograffico.', 'Nuovo titolo. Una frase con errore ortograffico.'])
    assert.throws(() => formatReplacement(doc, range, answer), /cambiato parole o punteggiatura/);
});

test('typefaces and URLs survive semantic reformatting, and images and code are excluded from replacement', () => {
  const link = schema.mark('link', { href: 'https://example.com' }), font = schema.mark('textStyle', { fontFamily: 'Georgia' });
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Un '), schema.text('collegamento', [font, link]), schema.text(' importante.')]), schema.node('image', { src: 'foto.png' }), schema.node('codeBlock', null, schema.text('const codice = 1;')), p('Dopo.')]);
  const { ranges, skipped } = formatRanges(doc, 0, doc.content.size); assert.equal(ranges.length, 2); assert.equal(skipped, 1);
  const part = formatReplacement(doc, ranges[0], 'Un **collegamento** importante.');
  const result = EditorState.create({ schema, doc }).apply(replaceAiFormatting(EditorState.create({ schema, doc }).tr, part.from, part.to, part.content, false));
  const marked = result.doc.firstChild.content.content.find(n => n.text === 'collegamento');
  assert.equal(marked.marks.find(m => m.type.name === 'link').attrs.href, 'https://example.com');
  assert.equal(marked.marks.find(m => m.type.name === 'textStyle').attrs.fontFamily, 'Georgia');
  assert.equal(result.doc.child(1).attrs.src, 'foto.png'); assert.equal(result.doc.child(2).textContent, 'const codice = 1;');
  assert.equal(result.doc.lastChild.textContent, 'Dopo.');
});

test('formatting a partial selection keeps word separators and the surrounding prose', () => {
  const doc = schema.node('doc', null, [p('Prima. Un concetto importante. Dopo.')]);
  const from = 1 + 'Prima.'.length, to = 1 + 'Prima. Un concetto importante. '.length;
  const range = formatRanges(doc, from, to).ranges[0], part = formatReplacement(doc, range, 'Un **concetto** importante.');
  const tr = replaceAiFormatting(EditorState.create({ schema, doc }).tr, from, to, part.content, false);
  assert.equal(tr.doc.textContent, 'Prima. Un concetto importante. Dopo.');
});

test('the current A4 page scope follows page boundaries instead of selecting the whole document', () => {
  const doc = schema.node('doc', null, [p('Una frase. '.repeat(30))]);
  const view = { state: { doc, [paginationKey.key]: { enabled: true, breaks: [{ pos: 100 }, { pos: 200 }] } } };
  assert.deepEqual(currentPageRange(view, 50), { from: 0, to: 100 });
  assert.deepEqual(currentPageRange(view, 100), { from: 100, to: 200 });
  assert.deepEqual(currentPageRange(view, 250), { from: 200, to: doc.content.size });
});

test('format-only repairs small titles and oversized prose, applies chosen typeface/color and preserves links', () => {
  const bad = schema.mark('textStyle', { fontFamily: 'Georgia', fontSize: '14px', color: '#ff0000' });
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Il viaggio. Sottotitolo. Un concetto importante. Una nota.', [bad, schema.mark('link', { href: 'https://example.com' })])]), p('Fuori ambito.')]);
  const range = formatRanges(doc, 1, doc.firstChild.nodeSize - 1).ranges[0];
  const part = formatReplacement(doc, range, '# Il viaggio.\n\n## Sottotitolo.\n\nUn **concetto** importante.\n\n:::style font=sans size=16 color=blue\nUna *nota*.');
  const tr = replaceAiFormatting(EditorState.create({ schema, doc }).tr, part.from, part.to, part.content, false);
  const blocks = tr.doc.content.content;
  assert.deepEqual(blocks.map(n => n.type.name), ['heading','heading','paragraph','paragraph','paragraph']);
  assert.deepEqual(blocks.slice(0,4).map(n => n.firstChild.marks.find(m => m.type.name === 'textStyle').attrs.fontSize), ['38px','28px','18px','16px']);
  assert.equal(blocks[0].firstChild.marks.find(m => m.type.name === 'textStyle').attrs.color, null);
  const note = blocks[3].firstChild.marks.find(m => m.type.name === 'textStyle').attrs;
  assert.equal(note.fontFamily, 'Arial'); assert.equal(note.color, '#285c8e');
  blocks.slice(0,4).forEach(n => n.forEach(child => assert.equal(child.marks.find(m => m.type.name === 'link').attrs.href, 'https://example.com')));
  assert.equal(blocks[4].textContent, 'Fuori ambito.'); assert.deepEqual(words(tr.doc.textContent), words(doc.textContent)); tr.doc.check();
});

test('chosen hierarchy, typeface, size and color persist in Word output', async () => {
  const { exportDocx } = await import('../lib/docx.ts'); const { default: JSZip } = await import('jszip');
  const doc = schema.node('doc', null, [p('Il titolo. La frase.')]), range = formatRanges(doc, 0, doc.content.size).ranges[0];
  const part = formatReplacement(doc, range, ':::style font=serif color=blue\n# Il titolo.\n\nLa frase.');
  const tr = replaceAiFormatting(EditorState.create({ schema, doc }).tr, part.from, part.to, part.content, false);
  const blob = await exportDocx(tr.doc.toJSON()), zip = await JSZip.loadAsync(await blob.arrayBuffer()), xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /w:pStyle w:val="Heading1"/); assert.match(xml, /w:ascii="Georgia"/);
  assert.match(xml, /w:sz w:val="57"/); assert.match(xml, /w:sz w:val="27"/); assert.match(xml, /w:color w:val="285c8e"/);
});
