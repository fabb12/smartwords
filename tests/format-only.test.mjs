import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { formatRanges, formatReplacement, promoteHeadings, summarizeFormatting, withProposedTitles } from '../lib/format-only.ts';
import { parseAiFormatting } from '../lib/ai-formatting.ts';
import { replaceAiFormatting } from '../lib/ai-formatting.ts';
import { currentPageRange, paginationKey } from '../lib/pagination.ts';
import { assistPrompts, ASSIST_MODES } from '../lib/providers.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' }, text: { group: 'inline' },
  heading: { group: 'block', content: 'inline*', attrs: { level: { default: 2 } } },
  hardBreak: { inline: true, group: 'inline' }, image: { group: 'block', atom: true, attrs: { src: {} } },
  codeBlock: { group: 'block', content: 'text*', code: true },
}, marks: { bold: {}, italic: {}, code: {}, highlight: { attrs: { color: { default: null } } }, textStyle: { attrs: { fontFamily: { default: null }, fontSize: { default: null }, color: { default: null } } }, link: { attrs: { href: {} } } } });
const p = text => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const words = text => text.match(/[\p{L}\p{M}\p{N}]+|[^\s]/gu);
// Headings change letter case by importance; the words themselves stay the same.
const lower = text => words(text.toLocaleLowerCase('it'));

test('format-only requests explicitly preserve spelling, punctuation and order, without requesting completion', () => {
  assert.ok(ASSIST_MODES.includes('format'));
  const prompt = assistPrompts({ mode: 'format', text: 'Un errore ortograffico.', formatting: true });
  assert.match(prompt.system, /Preserve every original word/); assert.match(prompt.system, /Never add a heading title/); assert.match(prompt.system, /proposed titles/);
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
  assert.equal(blocks[4].textContent, 'Fuori ambito.'); assert.deepEqual(lower(tr.doc.textContent), lower(doc.textContent));
  assert.equal(blocks[0].textContent, 'IL VIAGGIO.'); assert.equal(blocks[1].textContent, 'Sottotitolo.'); tr.doc.check();
});

test('chosen hierarchy, typeface, size and color persist in Word output', async () => {
  const { exportDocx } = await import('../lib/docx.ts'); const { default: JSZip } = await import('jszip');
  const doc = schema.node('doc', null, [p('Il titolo. La frase.')]), range = formatRanges(doc, 0, doc.content.size).ranges[0];
  const part = formatReplacement(doc, range, ':::style font=serif color=blue\n# Il titolo.\n\nLa frase.');
  const tr = replaceAiFormatting(EditorState.create({ schema, doc }).tr, part.from, part.to, part.content, false);
  const blob = await exportDocx(tr.doc.toJSON()), zip = await JSZip.loadAsync(await blob.arrayBuffer()), xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /w:pStyle w:val="Heading1"/); assert.match(xml, /w:ascii="Georgia"/);
  assert.match(xml, /w:sz w:val="57"/); assert.match(xml, /w:sz w:val="27"/); assert.match(xml, /w:color w:val="285C8E"/i);
});

const body = 'Questo paragrafo sviluppa il tema con abbastanza parole da essere chiaramente un blocco di prosa.';

test('obvious title lines left plain by the model become headings, prose and dialogue stay paragraphs', () => {
  const doc = schema.node('doc', null, [p('Il mio viaggio'), p(body), p('Capitolo secondo'), p(body), p('Disse piano'), p('Va bene.')]);
  const range = formatRanges(doc, 0, doc.content.size).ranges[0];
  const part = formatReplacement(doc, range, range.text);
  assert.deepEqual(part.content.map(n => n.type + (n.attrs?.level ?? '')), ['heading1', 'paragraph', 'heading2', 'paragraph', 'paragraph', 'paragraph']);
  const tr = replaceAiFormatting(EditorState.create({ schema, doc }).tr, part.from, part.to, part.content, false);
  assert.equal(tr.doc.firstChild.type.name, 'heading'); assert.equal(tr.doc.firstChild.firstChild.marks.find(m => m.type.name === 'textStyle').attrs.fontSize, '38px');
  assert.deepEqual(lower(tr.doc.textContent), lower(doc.textContent)); tr.doc.check();
});

test('fully bold standalone lines are promoted without bold, sentences ending with a period are not', () => {
  const promoted = promoteHeadings(parseAiFormatting('**Metodo di lavoro**\n\n' + body + '\n\nUna frase breve.\n\n' + body).content);
  assert.equal(promoted[0].type, 'heading'); assert.equal(promoted[0].attrs.level, 2);
  assert.ok(!promoted[0].content.some(n => n.marks?.some(m => m.type === 'bold')));
  assert.equal(promoted[2].type, 'paragraph');
});

test('==highlight== marks the key idea, and the summary lists structure and emphasized concepts compactly', () => {
  const parsed = parseAiFormatting('# Guida\n\nIntro con **memoria**.\n\n## Primo passo\n\nLa ==regola decisiva== e il **ritmo**.\n\nAltro paragrafo.\n\n- punto');
  assert.deepEqual(parsed.content[3].content[1].marks, [{ type: 'highlight', attrs: { color: '#ffc8004d' } }]);
  assert.equal(parseAiFormatting('a == b e c == d').text, 'a == b e c == d');
  const summary = summarizeFormatting([{ content: parsed.content.slice(0, 3) }, { content: parsed.content.slice(3) }]);
  assert.deepEqual(summary.outline, [{ level: 1, text: 'Guida', paragraphs: 1 }, { level: 2, text: 'Primo passo', paragraphs: 2 }]);
  assert.equal(summary.headings, 2); assert.equal(summary.paragraphs, 3); assert.equal(summary.lists, 1);
  assert.deepEqual(summary.concepts, ['memoria', 'ritmo']); assert.deepEqual(summary.highlights, ['regola decisiva']);
});

test('format prompts ask for a semantic outline, content-based paragraphs and graded importance', () => {
  const { system } = assistPrompts({ mode: 'format', text: 'Testo.', formatting: true });
  assert.match(system, /build its outline/); assert.match(system, /new paragraph at each change of topic/); assert.match(system, /==double equals==/);
});

test('heading case follows importance: main title in capitals, other headings with a capital initial', () => {
  const doc = schema.node('doc', null, [p('guida al metodo'), p(body), p('il primo passo'), p(body)]);
  const range = formatRanges(doc, 0, doc.content.size).ranges[0];
  const part = formatReplacement(doc, range, '# guida al metodo\n\n' + body + '\n\n## il primo passo\n\n' + body);
  assert.deepEqual(part.content.filter(n => n.type === 'heading').map(n => n.content.map(c => c.text).join('')), ['GUIDA AL METODO', 'Il primo passo']);
  assert.equal(part.content[1].content.map(c => c.text).join(''), body);
});

test('proposed titles are the only words the model may add, and can be left out on accept', () => {
  const doc = schema.node('doc', null, [p(body), p(body)]);
  const range = formatRanges(doc, 0, doc.content.size).ranges[0];
  const part = formatReplacement(doc, range, '##? il metodo\n\n' + body + '\n\n' + body);
  assert.equal(part.content[0].type, 'heading'); assert.equal(part.content[0].proposed, true);
  assert.equal(part.content[0].content.map(c => c.text).join(''), 'Il metodo');
  assert.equal(summarizeFormatting([part]).proposed, 1); assert.equal(summarizeFormatting([part]).headings, 0);
  const apply = include => replaceAiFormatting(EditorState.create({ schema, doc }).tr, part.from, part.to, withProposedTitles(part.content, include), false).doc;
  const withTitle = apply(true), without = apply(false);
  assert.equal(withTitle.firstChild.type.name, 'heading'); assert.equal(withTitle.firstChild.textContent, 'Il metodo'); withTitle.check();
  assert.ok(!('proposed' in withProposedTitles(part.content, true)[0]));
  assert.equal(without.firstChild.type.name, 'paragraph'); assert.deepEqual(words(without.textContent), words(doc.textContent));
  // Unmarked new words are still rejected.
  assert.throws(() => formatReplacement(doc, range, '## Il metodo\n\n' + body + '\n\n' + body), /cambiato parole/);
});
