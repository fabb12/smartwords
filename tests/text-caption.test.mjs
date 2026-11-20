import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { applyTextCaption, planTextCaption } from '../lib/text-caption.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  heading: { group: 'block', content: 'inline*', attrs: { level: { default: 2 } } },
  paragraph: { group: 'block', content: 'inline*', attrs: { textAlign: { default: null } } },
  image: { group: 'block', atom: true, attrs: { src: {}, alt: { default: null }, width: { default: null }, height: { default: null } } },
}, marks: { bold: {}, italic: {}, textStyle: { attrs: { fontFamily: { default: null }, fontSize: { default: null }, color: { default: null } } } } });
const p = text => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const h = text => schema.node('heading', { level: 2 }, schema.text(text));
const img = () => schema.node('image', { src: 'data:image/png;base64,iVBORw0KGgo=', width: 600, height: 400 });
const doc = (...blocks) => schema.node('doc', null, blocks);
const start = (d, i) => { let pos = 0; for (let k = 0; k < i; k++) pos += d.child(k).nodeSize; return pos + 1; };
const run = (d, from, to = from) => {
  const found = planTextCaption(d, from, to); if (found.error) return found;
  const tr = applyTextCaption(EditorState.create({ doc: d }).tr, found.plan);
  return { plan: found.plan, doc: tr.doc, texts: [], blocks: (() => { const out = []; tr.doc.forEach(n => out.push(n.type.name === 'image' ? '[img]' : n.textContent)); return out; })() };
};

test('la frase sotto il cursore diventa la didascalia dell’immagine sopra', () => {
  const d = doc(img(), p('Prima frase lunga del paragrafo. Il porto al tramonto. Ultima frase qui.'));
  const at = start(d, 1) + 'Prima frase lunga del paragrafo. Il p'.length;
  const r = run(d, at);
  assert.equal(r.plan.text, 'Il porto al tramonto.');
  assert.equal(r.plan.side, 'above');
  assert.deepEqual(r.blocks, ['[img]', 'Il porto al tramonto.', 'Prima frase lunga del paragrafo. Ultima frase qui.']);
  const caption = r.doc.child(1);
  assert.equal(caption.attrs.textAlign, 'center');
  assert.ok(caption.firstChild.marks.some(m => m.type.name === 'italic'));
});

test('una riga breve diventa didascalia per intero e il paragrafo sparisce', () => {
  const d = doc(p('Il castello visto dal fiume'), p(''), img(), p('Testo che segue.'));
  const r = run(d, start(d, 0) + 3);
  assert.equal(r.plan.side, 'below');
  assert.deepEqual(r.blocks, ['', '[img]', 'Il castello visto dal fiume', 'Testo che segue.']);
});

test('la selezione viene usata così com’è', () => {
  const d = doc(img(), p('Nella foto: la piazza del mercato, con le bancarelle del sabato.'));
  const s = start(d, 1) + 'Nella foto: '.length;
  const r = run(d, s, s + 'la piazza del mercato'.length);
  assert.deepEqual(r.blocks, ['[img]', 'la piazza del mercato', 'Nella foto: , con le bancarelle del sabato.']);
});

test('una didascalia già presente viene sostituita', () => {
  const d = doc(img(), p('Figura 1: vecchia didascalia'), p('Il molo nuovo, inaugurato nel 2020.'));
  const r = run(d, start(d, 2) + 2);
  assert.equal(r.plan.replaces, 'Figura 1: vecchia didascalia');
  assert.deepEqual(r.blocks, ['[img]', 'Il molo nuovo, inaugurato nel 2020.']);
});

test('nessuna immagine vicina, o un titolo in mezzo: nessuna modifica', () => {
  assert.match(planTextCaption(doc(p('Solo testo.')), 2, 2).error, /Nessuna immagine/);
  const d = doc(img(), h('Capitolo'), p('Frase lontana.'));
  assert.match(planTextCaption(d, start(d, 2) + 1, start(d, 2) + 1).error, /Nessuna immagine/);
  const far = doc(img(), p('Uno.'), p('Due.'), p('Tre.'), p('Quattro.'));
  assert.match(planTextCaption(far, start(far, 4) + 1, start(far, 4) + 1).error, /Nessuna immagine/);
});

test('a parità di distanza vince l’immagine sopra', () => {
  const d = doc(img(), p('Fra due immagini'), img());
  const r = run(d, start(d, 1) + 1);
  assert.equal(r.plan.side, 'above');
  assert.equal(r.plan.image, 0);
  assert.deepEqual(r.blocks, ['[img]', 'Fra due immagini', '[img]']);
});

test('i titoli non possono diventare didascalie', () => {
  const d = doc(img(), h('Titolo'));
  assert.match(planTextCaption(d, start(d, 1) + 1, start(d, 1) + 1).error, /paragrafo normale/);
});
