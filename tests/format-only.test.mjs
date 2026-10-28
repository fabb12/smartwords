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

test('format-only handles inline marks inside a word and hard breaks without inventing separators', () => {
  const doc = schema.node('doc', null, [p('Riformattare\nil testo.')]);
  const range = formatRanges(doc, 0, doc.content.size).ranges[0];
  const result = formatReplacement(doc, range, 'Ri**formatta**re\nil testo.');
  assert.ok(result.content.length);
});

test('indexed AI plans format even a two-word title using original text and linked marks', async () => {
  const { formatPlanReplacement } = await import('../lib/format-only.ts');
  const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('Il viaggio', [schema.mark('link', {href:'https://example.com'})]))]);
  const range = formatRanges(doc, 0, doc.content.size).ranges[0];
  const part = formatPlanReplacement(doc, range, JSON.stringify({blocks:[{end:2,role:'title',text:'Parole inventate!'}]}));
  const tr = replaceAiFormatting(EditorState.create({schema,doc}).tr, part.from, part.to, part.content, false);
  assert.equal(tr.doc.firstChild.type.name,'heading');assert.equal(tr.doc.textContent,'IL VIAGGIO');
  tr.doc.firstChild.forEach(n=>{assert.equal(n.marks.find(m=>m.type.name==='link').attrs.href,'https://example.com');assert.equal(n.marks.find(m=>m.type.name==='textStyle').attrs.fontSize,'38px');});
});

test('indexed AI formatting preserves punctuation, misspellings and literal Markdown while assigning hierarchy', async () => {
  const { formatPlanReplacement } = await import('../lib/format-only.ts');
  const text='Titolo breve\nUna sotto-sezione\nÈ “ortograffico”, non **corretto**: 3,14!';
  const doc=schema.node('doc',null,[p(text)]),range=formatRanges(doc,0,doc.content.size).ranges[0];
  const part=formatPlanReplacement(doc,range,JSON.stringify({blocks:[{end:2,role:'title'},{end:4,role:'subtitle'},{end:9,role:'paragraph',bold:[[5,6]],italic:[[7,8]],style:'font=serif color=blue'}]}));
  const tr=replaceAiFormatting(EditorState.create({schema,doc}).tr,part.from,part.to,part.content,false);
  assert.deepEqual(lower(tr.doc.textBetween(0,tr.doc.content.size,"\n\n")),lower(text));
  assert.deepEqual(tr.doc.content.content.map(n=>n.type.name),['heading','heading','paragraph']);
  assert.equal(tr.doc.child(1).attrs.level,2);
  assert.equal(tr.doc.lastChild.textContent,'È “ortograffico”, non **corretto**: 3,14!');
  assert.ok(tr.doc.lastChild.content.content.some(n=>n.marks.some(m=>m.type.name==='bold')));
});

const planText = nodes => nodes.filter(n => !n.proposed).map(function walk(n) { return n.type === 'text' ? n.text : (n.content || []).map(walk).join(' '); }).join(' ').split(/\s+/).filter(Boolean);

test('imperfect indexed plans are repaired without deleting, reordering or repeating source tokens', async () => {
  const { parseFormatPlan } = await import('../lib/format-plan.ts');
  const text = 'Titolo breve\nPrima frase del testo. Seconda frase del testo.\nTerza riga finale.';
  const tokens = text.split(/\s+/);
  const plans = [
    [{end:1,role:'title'}],                                   // stops early
    [{end:99,role:'title'}],                                  // overshoots
    [{end:5,role:'paragraph'},{end:2,role:'title'}],          // out of order
    [{end:2,role:'title'},{end:2,role:'paragraph'},{end:13,role:'paragraph'}], // empty block
    [{end:'2',role:'H1'},{end:13,role:'body text'}],          // strings and unknown roles
    [{end:2,role:'title'},{end:13,role:'paragraph',bold:[[-1,4],[20,30],[5,5]],italic:[3,6],highlight:[{start:7,end:9}]}], // bad spans
    [{start:0,role:'title'},{start:2,role:'paragraph'}],      // start instead of end
  ];
  for (const blocks of plans) assert.deepEqual(planText(parseFormatPlan(text, JSON.stringify({blocks}))), tokens, JSON.stringify(blocks));
  for (const blocks of [[], [{role:'title'}], [{end:0,role:'title'}]]) assert.throws(() => parseFormatPlan(text, JSON.stringify({blocks})), /struttura.*incompleta/);
  assert.throws(() => parseFormatPlan(text, 'Non posso aiutarti.'), /incompleta/);
});

test('plans wrapped in prose, fences, reasoning or cut short are still read', async () => {
  const { parseFormatPlan } = await import('../lib/format-plan.ts');
  const text = 'Titolo breve\nPrima frase del testo.\nSeconda frase.';
  const plan = '{"blocks":[{"end":2,"role":"title"},{"end":6,"role":"paragraph","bold":[[3,4]],},{"end":8,"role":"paragraph"}]}';
  for (const answer of [plan, 'Ecco il piano:\n```json\n' + plan + '\n```\nFatto.', '<think>conto i token</think>' + plan, '[{"end":2,"role":"title"},{"end":8,"role":"paragraph"}]', '{"plan":{"blocks":[{"end":2,"role":"title"},{"end":8}]}}']) {
    const content = parseFormatPlan(text, answer);
    assert.equal(content[0].type, 'heading', answer);
    assert.deepEqual(planText(content), text.split(/\s+/));
  }
  // Truncated by the output limit: complete blocks are used, the rest keeps its original lines.
  const cut = parseFormatPlan(text, '{"blocks":[{"end":2,"role":"title"},{"end":6,"role":"paragraph","bold":[[3,');
  assert.deepEqual(cut.map(n => n.type), ['heading', 'paragraph', 'paragraph']);
  assert.deepEqual(planText(cut), text.split(/\s+/));
});

test('heading boundaries off by one token are aligned with the source line', async () => {
  const { parseFormatPlan } = await import('../lib/format-plan.ts');
  const text = 'Il grande viaggio\nEra una mattina di sole.';
  for (const end of [2, 4]) {
    const content = parseFormatPlan(text, JSON.stringify({blocks:[{end,role:'title'},{end:8,role:'paragraph'}]}));
    assert.equal(planText([content[0]]).join(' '), 'Il grande viaggio');
    assert.equal(planText([content[1]]).join(' '), 'Era una mattina di sole.');
  }
});

test('a Markdown answer to a plan request is accepted only when the words are unchanged', async () => {
  const { formatPlanReplacement } = await import('../lib/format-only.ts');
  const doc = schema.node('doc', null, [p('Il viaggio\nEra una mattina di sole e il treno partiva presto.')]);
  const range = formatRanges(doc, 0, doc.content.size).ranges[0];
  const part = formatPlanReplacement(doc, range, '# Il viaggio\n\nEra una mattina di sole e il treno partiva **presto**.');
  assert.equal(part.content[0].type, 'heading');
  assert.throws(() => formatPlanReplacement(doc, range, '# Il viaggio\n\nEra una bella mattina.'), /incompleta|cambiato parole/);
});

test('format plans request semantic structure for short text instead of rewriting source prose', () => {
  const {system,prompt}=assistPrompts({mode:'format',formatPlan:true,text:'Breve titolo',formatContext:'Existing chapter'});
  assert.match(system,/including very short input/);assert.match(system,/never rewritten text/);
  assert.deepEqual(JSON.parse(prompt).tokens,[[0,'Breve'],[1,'titolo']]);assert.equal(JSON.parse(prompt).context,'Existing chapter');
});

test('an explicit paragraph plan remains prose and optional new titles stay removable', async () => {
  const { formatPlanReplacement } = await import('../lib/format-only.ts');
  const doc=schema.node('doc',null,[p('Un concetto')]),range=formatRanges(doc,0,doc.content.size).ranges[0];
  const part=formatPlanReplacement(doc,range,JSON.stringify({blocks:[{end:2,role:'paragraph',bold:[[0,2]],proposedTitle:'Una nuova sezione',proposedLevel:2}]}));
  assert.equal(part.content[1].type,'paragraph');assert.equal(part.content[0].proposed,true);
  assert.deepEqual(withProposedTitles(part.content,false).map(n=>n.type),['paragraph']);
});

test('indexed plans keep genuine lists as semantic list nodes', async()=>{
 const {parseFormatPlan}=await import('../lib/format-plan.ts');
 const content=parseFormatPlan('Prima voce Seconda voce',JSON.stringify({blocks:[{end:2,role:'bullet'},{end:4,role:'bullet'}]}));
 assert.equal(content[0].type,'bulletList');assert.equal(content[0].content.length,2);
});
