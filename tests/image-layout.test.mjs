import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { applyImageLayout, captionStrength, describeImageLayout, planImageLayout } from '../lib/image-layout.ts';
import { formatRanges } from '../lib/format-only.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*', attrs: { textAlign: { default: null } } },
  image: { group: 'block', atom: true, attrs: { src: {}, alt: { default: null }, width: { default: null }, height: { default: null } } },
}, marks: { bold: {}, italic: {}, textStyle: { attrs: { fontFamily: { default: null }, fontSize: { default: null }, color: { default: null } } }, link: { attrs: { href: {} } } } });
const p = (text, marks = []) => schema.node('paragraph', null, text ? schema.text(text, marks) : undefined);
const img = (width = 600, height = 400) => schema.node('image', { src: 'data:image/png;base64,AA==', width, height });
const doc = (...blocks) => schema.node('doc', null, blocks);
const long = 'Questo è un paragrafo normale del testo, abbastanza lungo da non sembrare una didascalia, con molte parole e una conclusione.';
const apply = (d, plan) => { const state = EditorState.create({ doc: d }); return applyImageLayout(state.tr, plan.ops).doc; };

test('caption strength recognizes labels, caption look and short lines', () => {
  assert.equal(captionStrength(p('Figura 2: il porto di Genova all’alba')), 'label');
  assert.equal(captionStrength(p('Fig. 3 – Schema del motore')), 'label');
  assert.equal(captionStrength(p('© Archivio storico')), 'label');
  assert.equal(captionStrength(p('Il porto al tramonto', [schema.marks.italic.create()])), 'styled');
  assert.equal(captionStrength(p('Il porto al tramonto')), 'short');
  assert.equal(captionStrength(p(long + ' ' + long)), null);
});

test('a caption below an image is styled centered, small and italic, words unchanged', () => {
  const d = doc(p(long), img(), p('Figura 1: la piazza'), p(long));
  const plan = planImageLayout(d);
  assert.equal(plan.captions.length, 1);
  const out = apply(d, plan), caption = out.child(2);
  assert.equal(caption.textContent, 'Figura 1: la piazza');
  assert.equal(caption.attrs.textAlign, 'center');
  const [label, rest] = [caption.child(0), caption.child(1)];
  assert.equal(label.text, 'Figura 1:');
  assert.ok(label.marks.some(m => m.type.name === 'bold'));
  assert.ok(rest.marks.some(m => m.type.name === 'italic'));
  assert.equal(rest.marks.find(m => m.type.name === 'textStyle').attrs.fontSize, '14px');
  assert.match(describeImageLayout(plan), /1 didascalia/);
});

test('a labelled caption above the image moves below it and empty lines between are removed', () => {
  const d = doc(p(long), p('Foto: il molo'), p(''), img(), p(long));
  const out = apply(d, planImageLayout(d));
  assert.deepEqual(Array.from({ length: out.childCount }, (_, i) => out.child(i).type.name === 'image' ? '[img]' : out.child(i).textContent), [long, '[img]', 'Foto: il molo', long]);
});

test('a short plain line followed by prose is not taken as a caption', () => {
  const d = doc(img(), p('Capitolo due'), p(long));
  assert.equal(planImageLayout(d).captions.length, 0);
  assert.equal(planImageLayout(doc(img(), p('Il molo di sera'))).captions.length, 1);
});

test('images of one sequence share the median width and keep their proportions', () => {
  const d = doc(img(600, 300), p('Figura 1: a'), img(300, 300), p('Figura 2: b'), img(1200, 600), p(long));
  const out = apply(d, planImageLayout(d)), images = [];
  out.forEach(node => { if (node.type.name === 'image') images.push(node.attrs); });
  assert.deepEqual(images.map(a => a.width), [600, 300, 600]);
  assert.equal(images[2].height, 300);
});

test('captions are excluded from the text sent for formatting', () => {
  const d = doc(p(long), img(), p('Figura 1: la piazza'), p(long));
  const plan = planImageLayout(d), { ranges } = formatRanges(d, 0, d.content.size, 6000, new Set(plan.captions));
  assert.ok(ranges.every(r => !r.text.includes('Figura 1')));
  assert.equal(ranges.length, 2);
});

test('the layout survives position shifts from earlier replacements', () => {
  const d = doc(p('Breve'), img(), p('Figura 1: x'));
  const plan = planImageLayout(d), state = EditorState.create({ doc: d }), tr = state.tr;
  tr.insertText(' testo aggiunto', 6); const map = tr.mapping.slice(0);
  applyImageLayout(tr, plan.ops, pos => map.map(pos, 1));
  assert.equal(tr.doc.child(2).attrs.textAlign, 'center');
  assert.equal(tr.doc.child(2).textContent, 'Figura 1: x');
});

test('a standalone formula is centered in a math typeface and kept away from the model, with its label below', () => {
  const d = doc(p('La relazione fra massa ed energia, nella sua forma più nota, si scrive così:'), p('E = mc²   (1)'), p('Equazione 1: equivalenza massa-energia'), p('dove c è la velocità della luce nel vuoto, una costante universale molto grande.'));
  const plan = planImageLayout(d);
  assert.equal(plan.formulas.length, 1); assert.equal(plan.captions.length, 1);
  const { ranges } = formatRanges(d, 0, d.content.size, 6000, new Set([...plan.captions, ...plan.formulas]));
  assert.ok(ranges.every(r => !r.text.includes('mc²') && !r.text.includes('Equazione')));
  const out = apply(d, plan), formula = out.child(1);
  assert.equal(formula.textContent, 'E = mc²   (1)'); assert.equal(formula.attrs.textAlign, 'center');
  assert.match(formula.child(0).marks.find(m => m.type.name === 'textStyle').attrs.fontFamily, /Math/);
  assert.equal(out.child(2).attrs.textAlign, 'center');
  assert.equal(out.child(3).attrs.textAlign, null);
  assert.match(describeImageLayout(plan), /1 formula/);
});

test('an explanation after a formula is not taken as its caption', () => {
  const d = doc(p('F = m · a'), p('dove m è la massa'));
  assert.equal(planImageLayout(d).captions.length, 0);
});
