import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { completionProposal } from '../lib/completion.ts';
import { sentenceTarget } from '../lib/ai-governor.ts';
import { assistPrompts, splitWarning } from '../lib/providers.ts';

// Apply the proposal with the same from/to replacement used by the editor.
// This also checks that text beyond the cursor and formatted prefixes survive.
const schema = new Schema({
  nodes: { doc: {content:'paragraph+'}, paragraph: {content:'text*'}, text: {} },
  marks: { strong: {} },
});
function accept(before, response, after = '') {
  const prefix = 'Una frase già scritta. ';
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [
    schema.text(prefix, [schema.mark('strong')]), schema.text(before + after),
  ])]);
  const state = EditorState.create({schema, doc});
  const part = completionProposal(before, response, true);
  assert.ok(part);
  const result = state.apply(state.tr.insertText(part.text, 1 + prefix.length + part.offset, 1 + prefix.length + before.length));
  assert.equal(result.doc.textContent, prefix + response + after);
  assert.equal(result.doc.firstChild.firstChild.marks[0].type.name, 'strong');
  assert.equal(state.doc.textContent, prefix + before + after, 'a proposal leaves the original untouched until acceptance');
  return part;
}

test('completion fixes a typo and removes an accidental repetition in the same accepted proposal', () => {
  const part = accept('Il gatto camina nel nel', 'Il gatto cammina nel giardino.');
  assert.equal(part.original, 'camina nel nel');
  assert.equal(part.text, 'cammina nel giardino.');
  assert.equal(part.offset, 'Il gatto '.length);
});

test('ordinary completion inserts only new text and preserves the text after the cursor', () => {
  const part = accept('La porta ', 'La porta si aprì', ', senza rumore.');
  assert.equal(part.original, undefined);
  assert.equal(part.text, 'si aprì');
  assert.equal(part.offset, 'La porta '.length);
});

test('correction at the cursor preserves subsequent text and supports accents and emoji', () => {
  accept('È già già', 'È già notte', ' quando arriva.');
  accept('🙂 Lui camina', '🙂 Lui cammina verso casa.');
  accept('Peché', 'Perché il vento era cambiato.');
});

test('streaming does not show the repeated prefix as a replacement or allow a partial correction to be accepted', () => {
  const before = 'Il gatto camina';
  assert.equal(completionProposal(before, 'Il gatto ', false), null);
  assert.equal(completionProposal(before, before, true), null);
  assert.equal(completionProposal(before, '', true), null);
  const part = completionProposal(before, 'Il gatto cammi', false);
  assert.equal(part.original, 'camina');
  assert.equal(part.text, 'cammi');
});

test('completion targets the current sentence and separates warnings from corrected text', () => {
  const paragraph = 'Prima frase. Il gatto camina nel nel ';
  const target = sentenceTarget(paragraph);
  const before = paragraph.slice(target.start);
  assert.equal(before, 'Il gatto camina nel nel ');
  const parsed = splitWarning('<<WARNING>> La destinazione è ambigua.\nIl gatto cammina nel giardino.');
  assert.equal(parsed.warning, 'La destinazione è ambigua.');
  accept(before, parsed.text);
});

test('completion request asks for minimal corrections and budgets for the existing sentence', () => {
  const request = assistPrompts({mode:'complete', text:'Il gatto camina nel nel', after:' e si fermò.'});
  assert.ok(request.system.includes('spelling errors, typos and accidentally repeated words'));
  assert.ok(request.system.includes('deliberate repetitions'));
  assert.ok(request.system.includes('entire current sentence'));
  assert.equal(JSON.parse(request.prompt).afterCursor, ' e si fermò.');
  assert.ok(assistPrompts({mode:'complete',text:'x'.repeat(10000)}).maxTokens >= 5500);
});
