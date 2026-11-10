import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { contextAround, ideaFields, insertFigure, locateBlock, parsePromptAnswer } from '../lib/image-ideas.ts';
import { chartSvg, niceTicks, parseChartAnswer, wrapText, CHART_COLORS } from '../lib/idea-chart.ts';
import { AUTOSAVE_MS, DEFAULT_AUTOSAVE, sanitizeAutoSave, shouldAutoSaveToGithub } from '../lib/autosave.ts';
import { ASSIST_MODES, JSON_MODES, assistPrompts } from '../lib/providers.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  heading: { group: 'block', content: 'inline*', attrs: { level: { default: 2 } } },
  paragraph: { group: 'block', content: 'inline*', attrs: { textAlign: { default: null } } },
  image: { group: 'block', atom: true, attrs: { src: {}, alt: { default: null }, width: { default: null }, height: { default: null } } },
}, marks: { bold: {}, italic: {}, textStyle: { attrs: { fontFamily: { default: null }, fontSize: { default: null }, color: { default: null } } } } });
const p = text => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const h = text => schema.node('heading', { level: 2 }, schema.text(text));
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const img = () => schema.node('image', { src: PNG, width: 600, height: 400 });
const doc = (...blocks) => schema.node('doc', null, blocks);
const long = 'Il porto di Genova movimenta ogni anno milioni di tonnellate di merci, con una crescita costante negli ultimi dieci anni.';

test('il contesto del punto comprende titolo, testo prima, testo dopo e la selezione', () => {
  const d = doc(h('Il porto'), p('Prima parte. ' + long), p('Paragrafo al cursore sulle banchine.'), p('Dopo il punto. ' + long), h('Altro capitolo'), p('Non deve comparire.'));
  const at = d.child(0).nodeSize + d.child(1).nodeSize + 1;
  const ctx = contextAround(d, at);
  assert.match(ctx.text, /Heading above: Il porto/);
  assert.match(ctx.text, /Passage before the point: Prima parte/);
  assert.match(ctx.text, /Paragraph at the point: Paragrafo al cursore/);
  assert.match(ctx.text, /Passage after the point: Dopo il punto/);
  assert.doesNotMatch(ctx.text, /Non deve comparire/);
  assert.equal(ctx.block, d.child(2));
  const selected = contextAround(d, at, at + 9);
  assert.match(selected.text, /Selected text, the concept to illustrate: Paragrafo/);
  assert.doesNotMatch(selected.text, /Paragraph at the point/);
});

test('senza testo attorno non c’è nulla da illustrare', () => {
  assert.equal(contextAround(doc(p('')), 1).hasText, false);
  assert.equal(contextAround(doc(img(), p('')), 1).hasText, false);
});

test('la risposta con il prompt viene letta e validata', () => {
  const ok = parsePromptAnswer('```json\n{"prompt":"A wide aerial photograph of a busy container port at dawn, warm light, cranes and ships","caption":"Il porto all’alba.","alt":"Gru e navi"}\n```');
  assert.equal(ok.caption, 'Il porto all’alba.'); assert.match(ok.prompt, /container port/);
  assert.equal(parsePromptAnswer('{"prompt":"","caption":"","alt":""}'), null);
  assert.equal(parsePromptAnswer('niente json'), null);
});

test('lo stile scelto viaggia come direzione; «Automatico» non aggiunge nulla', () => {
  assert.equal(ideaFields('x', 'auto').direction, undefined);
  assert.match(ideaFields('x', 'watercolor').direction, /watercolor/);
});

test('i modi nuovi sono accettati dal server e rispondono in JSON', () => {
  for (const mode of ['imageprompt', 'chart']) {
    assert.ok(ASSIST_MODES.includes(mode)); assert.ok(JSON_MODES.includes(mode));
    const { system, prompt, images } = assistPrompts({ mode, text: 'Heading above: Il porto', direction: 'watercolor painting' });
    assert.match(system, /only JSON/i); assert.deepEqual(images, []); assert.match(prompt, /watercolor/);
  }
});

const barAnswer = '{"type":"bar","title":"Merci per anno","unit":"Mt","labels":["2021","2022","2023"],"series":[{"name":"Tonnellate","values":[50,55,61.5]}],"caption":"Le merci crescono ogni anno.","alt":"Barre in crescita"}';
test('il grafico a barre viene letto e disegnato con i dati del testo', () => {
  const spec = parseChartAnswer('Ecco: ' + barAnswer);
  assert.equal(spec.type, 'bar'); assert.deepEqual(spec.series[0].values, [50, 55, 61.5]);
  const { svg, width, height } = chartSvg(spec);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/); assert.equal(width, 800); assert.equal(height, 500);
  assert.equal((svg.match(/<path d="M/g) || []).length, 3, 'una barra per etichetta');
  assert.match(svg, /61,5 Mt/); assert.match(svg, new RegExp(CHART_COLORS[0]));
});

test('un grafico con valori non coerenti o inventati male viene scartato', () => {
  assert.equal(parseChartAnswer('{"type":"none"}'), null);
  assert.equal(parseChartAnswer(barAnswer.replace('[50,55,61.5]', '[50,55]')), null, 'un valore per etichetta');
  assert.equal(parseChartAnswer(barAnswer.replace('[50,55,61.5]', '[50,-5,61]')), null, 'barre negative');
  assert.equal(parseChartAnswer(barAnswer.replace('[50,55,61.5]', '[50,"55",61]')), null);
  assert.equal(parseChartAnswer(barAnswer.replace('"caption":"Le merci crescono ogni anno."', '"caption":""')), null);
  assert.equal(parseChartAnswer('{"type":"pie","labels":["a","b"],"series":[{"name":"x","values":[0,0]}],"caption":"Una torta."}'), null);
});

test('linea, torta, processo e mappa concettuale producono SVG validi con il testo protetto', () => {
  const line = parseChartAnswer('{"type":"line","title":"T","unit":"%","labels":["a","b","c"],"series":[{"name":"S1","values":[-2,1,3]},{"name":"S2","values":[1,2,2]}],"caption":"Andamento.","alt":""}');
  assert.equal(line.series.length, 2); assert.match(chartSvg(line).svg, /<polyline/g);
  const pie = parseChartAnswer('{"type":"pie","unit":"%","labels":["Uno","Due","Tre"],"series":[{"name":"q","values":[50,30,20]}],"caption":"Le quote."}');
  assert.match(chartSvg(pie).svg, /50 · 50%|50\s?%\s·\s50%/);
  const single = parseChartAnswer('{"type":"pie","labels":["Solo","Nulla"],"series":[{"name":"q","values":[10,0]}],"caption":"Tutto."}');
  assert.match(chartSvg(single).svg, /<circle/);
  const flow = parseChartAnswer('{"type":"flow","title":"Il processo <script>","steps":["Raccolta dati","Analisi","Bozza","Revisione","Pubblicazione"],"caption":"Cinque fasi."}');
  const svg = chartSvg(flow).svg;
  assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;/); assert.equal((svg.match(/<polygon/g) || []).length, 4, 'una freccia tra i passi');
  const map = parseChartAnswer('{"type":"map","center":"Sostenibilità","branches":["Ambiente","Economia","Società"],"caption":"Tre dimensioni."}');
  assert.equal((chartSvg(map).svg.match(/<line/g) || []).length, 3);
  assert.equal(parseChartAnswer('{"type":"map","center":"X","branches":["solo uno"],"caption":"No."}'), null);
});

test('assi, ritorno a capo e numeri', () => {
  const t = niceTicks(0, 61.5); assert.equal(t.min, 0); assert.ok(t.max >= 61.5); assert.ok(t.ticks.length >= 4 && t.ticks.length <= 8);
  assert.deepEqual(niceTicks(5, 5).ticks.length > 1, true);
  assert.deepEqual(wrapText('uno due tre', 9, 3), ['uno due', 'tre']);
  assert.ok(wrapText('una frase molto lunga che non entra mai in due righe corte', 12, 2).at(-1).endsWith('…'));
  assert.ok(niceTicks(-2, 3).min <= -2);
});

test('il grafico e la didascalia vengono inseriti dopo il blocco, in stile didascalia', () => {
  const d = doc(p(long), p('Il punto scelto.'), p(long)), state = EditorState.create({ doc: d }), block = d.child(1);
  const tr = state.tr; const end = insertFigure(tr, block, { src: PNG, width: 640, height: 400, alt: 'Barre' }, 'Le merci crescono.');
  const out = tr.doc;
  assert.equal(out.child(2).type.name, 'image'); assert.equal(out.child(2).attrs.alt, 'Barre');
  assert.equal(out.child(3).textContent, 'Le merci crescono.'); assert.equal(out.child(3).attrs.textAlign, 'center');
  assert.equal(out.child(4).textContent, long); assert.equal(end, out.child(0).nodeSize + out.child(1).nodeSize + out.child(2).nodeSize + out.child(3).nodeSize);
});

test('su una riga vuota il grafico prende il suo posto; il punto sopravvive alle modifiche altrove', () => {
  const d = doc(p(long), p(''), p(long)), state = EditorState.create({ doc: d }), block = d.child(1);
  const typed = state.apply(state.tr.insertText('Una frase in più. ', 1)).doc;
  assert.ok(locateBlock(typed, block) > 0, 'lo stesso blocco viene ritrovato');
  const tr = EditorState.create({ doc: typed }).tr; insertFigure(tr, block, { src: PNG, width: 640, height: 400 }, 'Didascalia.');
  assert.deepEqual(tr.doc.content.content.map(n => n.type.name), ['paragraph', 'image', 'paragraph', 'paragraph']);
  assert.equal(insertFigure(EditorState.create({ doc: doc(p('altro')) }).tr, block, { src: PNG, width: 1, height: 1 }, 'x'), null, 'blocco scomparso');
});

test('dopo un’immagine già con didascalia la nuova figura va sotto entrambe', () => {
  const d = doc(p(long), img(), p('Figura 1: la banchina'), p(long)), tr = EditorState.create({ doc: d }).tr;
  insertFigure(tr, d.child(1), { src: PNG, width: 640, height: 400 }, 'Nuova.');
  assert.deepEqual(tr.doc.content.content.map(n => n.type.name + ':' + n.textContent.slice(0, 8)), ['paragraph:Il porto', 'image:', 'paragraph:Figura 1', 'image:', 'paragraph:Nuova.', 'paragraph:Il porto']);
});

test('salvataggio automatico: ogni 5 minuti, GitHub solo se richiesto e se qualcosa è cambiato', () => {
  assert.equal(AUTOSAVE_MS, 300000);
  assert.deepEqual(sanitizeAutoSave(null), DEFAULT_AUTOSAVE); assert.deepEqual(sanitizeAutoSave({ enabled: false, github: 'sì' }), { enabled: false, github: false });
  const base = { prefs: { enabled: true, github: true }, connected: true, cloud: false, busy: false, hasText: true, version: 'a:3', committed: 'a:2' };
  assert.equal(shouldAutoSaveToGithub(base), true);
  for (const change of [{ prefs: { enabled: true, github: false } }, { prefs: { enabled: false, github: true } }, { connected: false }, { cloud: true }, { busy: true }, { hasText: false }, { committed: 'a:3' }])
    assert.equal(shouldAutoSaveToGithub({ ...base, ...change }), false, JSON.stringify(change));
});
