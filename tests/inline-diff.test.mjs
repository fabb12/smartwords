import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { applyInlineEdits, inlineEdits, textMap } from '../lib/inline-diff.ts';
import { wordDiff } from '../lib/ai-governor.ts';

const schema = new Schema({ nodes: { doc: { content: 'block+' }, text: { group: 'inline' }, paragraph: { group: 'block', content: 'inline*' }, hardBreak: { inline: true, group: 'inline' } }, marks: { bold: {} } });
const bold = schema.marks.bold.create();
const original = 'Era un’attesa concreta, fatta di freddo, di fango e di silenzio.';
const proposal = 'Era un’attesa concreta, fatta di freddo, di fango e di silenzio, e proprio lì nasceva ogni sua scoperta.';
const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Era un’attesa '), schema.text('concreta', [bold]), schema.text(', fatta di freddo, di fango e di silenzio.')])]);

test('punctuation is its own token and nearby changes form one replacement', () => {
  assert.deepEqual(wordDiff(original, proposal).filter(p => p.type !== 'same'), [{ type: 'add', text: ', e proprio lì nasceva ogni sua scoperta' }]);
  assert.deepEqual(wordDiff('un grande cane nero', 'un piccolo gatto nero').filter(p => p.type !== 'same'), [{ type: 'del', text: 'grande cane' }, { type: 'add', text: 'piccolo gatto' }]);
});

test('edits touch only what changes, at document positions', () => {
  const { text, pos } = textMap(doc, 1, doc.content.size - 1);
  assert.equal(text, original); assert.equal(pos.length, text.length + 1);
  const edits = inlineEdits(doc, 1, doc.content.size - 1, proposal);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].from, edits[0].to);
  assert.equal(doc.textBetween(1, edits[0].from), original.slice(0, -1));
  assert.equal(inlineEdits(doc, 1, doc.content.size - 1, 'Tutt’altra cosa, completamente diversa da prima.'), null);
});

test('accepting keeps unchanged words and their formatting in place', () => {
  const state = EditorState.create({ doc }), tr = state.tr;
  assert.ok(applyInlineEdits(tr, 1, doc.content.size - 1, proposal.replace('concreta', 'concreta').replace('freddo', 'gelo')));
  const p = tr.doc.child(0);
  assert.equal(p.textContent, proposal.replace('freddo', 'gelo'));
  let boldText = ''; p.forEach(n => { if (n.marks.some(m => m.type.name === 'bold')) boldText += n.text; });
  assert.equal(boldText, 'concreta');
});
