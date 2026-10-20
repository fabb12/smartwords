import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { parseAiFormatting, replaceAiFormatting } from '../lib/ai-formatting.ts';
import { assistPrompts } from '../lib/providers.ts';
import { aiTabAction, readAiPreferences, storeAiPreferences } from '../lib/ai-preferences.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' }, text: { group: 'inline' },
  hardBreak: { inline: true, group: 'inline' }, heading: { group: 'block', content: 'inline*', attrs: { level: { default: 2 } } },
  bulletList: { group: 'block', content: 'listItem+' }, orderedList: { group: 'block', content: 'listItem+', attrs: { start: { default: 1 } } },
  listItem: { content: 'paragraph block*' },
}, marks: { bold: {}, italic: {}, textStyle: { attrs: { fontFamily: { default: null } } } } });
const p = (text, marks = []) => schema.node('paragraph', null, text ? schema.text(text, marks) : undefined);

test('semantic formatting parses headings, paragraphs, lists and emphasis into editor nodes', () => {
  const parsed = parseAiFormatting('## Un viaggio\n\nIl **tema centrale** e una *sfumatura*.\n\n- Primo punto\n- Secondo punto\n\n3. Terzo\n4. Quarto');
  assert.deepEqual(parsed.content.map(n => n.type), ['heading', 'paragraph', 'bulletList', 'orderedList']);
  assert.equal(parsed.content[0].attrs.level, 2);
  assert.equal(parsed.content[1].content[1].marks[0].type, 'bold');
  assert.equal(parsed.content[1].content[3].marks[0].type, 'italic');
  assert.equal(parsed.content[3].attrs.start, 3);
  assert.equal(parsed.rich, true);
  assert.ok(!parsed.text.includes('**'));
  schema.nodeFromJSON({ type: 'doc', content: parsed.content }).check();
  const literal = parseAiFormatting('<script>alert(1)</script> [link](javascript:bad) ![x](bad)');
  assert.equal(literal.content[0].content[0].type, 'text');
  assert.equal(literal.text, '<script>alert(1)</script> [link](javascript:bad) ![x](bad)');
  assert.deepEqual(parseAiFormatting('***Importante***').content[0].content[0].marks.map(m => m.type), ['bold', 'italic']);
});

test('formatted insertion preserves prefix, tail, their marks and document blocks outside the edited range', () => {
  const prefix = 'Introduzione. ', before = 'Il tema', tail = ' e poi tornò a casa.';
  const state = EditorState.create({ schema, doc: schema.node('doc', null, [p('Prima', [schema.mark('bold')]),
    schema.node('paragraph', null, [schema.text(prefix, [schema.mark('italic')]), schema.text(before), schema.text(tail, [schema.mark('bold')])]), p('Dopo')]) });
  const from = state.doc.child(0).nodeSize + 1 + prefix.length, to = from + before.length;
  const formatted = parseAiFormatting('Il **tema centrale**.\n\nUn nuovo paragrafo.');
  const result = state.apply(replaceAiFormatting(state.tr, from, to, formatted.content));
  result.doc.check();
  assert.equal(result.doc.firstChild.textContent, 'Prima'); assert.equal(result.doc.lastChild.textContent, 'Dopo');
  assert.equal(result.doc.child(1).textContent, prefix + 'Il tema centrale.');
  assert.equal(result.doc.child(1).firstChild.marks[0].type.name, 'italic');
  assert.equal(result.doc.child(2).textContent, 'Un nuovo paragrafo.' + tail);
  assert.equal(result.doc.child(2).lastChild.marks[0].type.name, 'bold');
  assert.equal(state.doc.child(1).textContent, prefix + before + tail, 'preview never mutates the original');
});

test('improving selected earlier text preserves surrounding passages and font choices', () => {
  const font = schema.mark('textStyle', { fontFamily: 'Georgia' });
  const state = EditorState.create({ schema, doc: schema.node('doc', null, [p('Capitolo precedente'), p('Prima. Frase da migliorare. Dopo.', [font]), p('Capitolo successivo')]) });
  const from = state.doc.firstChild.nodeSize + 1 + 'Prima. '.length;
  const result = state.apply(replaceAiFormatting(state.tr, from, from + 'Frase da migliorare.'.length, parseAiFormatting('Frase **migliorata** con *attenzione*.').content));
  assert.equal(result.doc.firstChild.textContent, 'Capitolo precedente');
  assert.equal(result.doc.lastChild.textContent, 'Capitolo successivo');
  assert.equal(result.doc.child(1).textContent, 'Prima. Frase migliorata con attenzione. Dopo.');
  result.doc.child(1).forEach(n => assert.equal(n.marks.find(m => m.type.name === 'textStyle')?.attrs.fontFamily, 'Georgia'));
  result.doc.check();
});

test('a full paragraph becomes a semantic heading and list without leaving empty paragraphs', () => {
  const state = EditorState.create({ schema, doc: schema.node('doc', null, [p('Una lista da organizzare'), p('Da conservare')]) });
  const parsed = parseAiFormatting('## Cose importanti\n\n- Una **priorità**\n- Una *nota*');
  const result = state.apply(replaceAiFormatting(state.tr, 1, state.doc.firstChild.nodeSize - 1, parsed.content));
  assert.deepEqual(result.doc.content.content.map(n => n.type.name), ['heading', 'bulletList', 'paragraph']);
  assert.equal(result.doc.lastChild.textContent, 'Da conservare'); result.doc.check();
});

test('completion suffix paragraphs join the existing text and keep an explicit initial paragraph break', () => {
  const state = EditorState.create({ schema, doc: schema.node('doc', null, [p('Una frase.')]) });
  const pos = state.doc.content.size - 1;
  const parsed = parseAiFormatting('\n\nUna **nuova scena**.', true);
  const result = state.apply(replaceAiFormatting(state.tr, pos, pos, parsed.content));
  assert.equal(result.doc.childCount, 2); assert.equal(result.doc.firstChild.textContent, 'Una frase.');
  assert.equal(result.doc.lastChild.textContent, 'Una nuova scena.');
});

test('formatting prompts are restricted to completions and rewrites and follow semantic importance', () => {
  for (const mode of ['complete', 'rewrite']) {
    const request = assistPrompts({ mode, formatting: true, text: 'Un titolo e un concetto importante', formatContext: 'paragraph' });
    assert.match(request.system, /meaning, hierarchy and importance/);
    assert.match(request.system, /\*\*bold\*\* and \*italic\*/);
    assert.match(request.system, /No HTML/);
    assert.ok(!request.system.includes('no quotation marks, explanation or markdown'));
    assert.equal(JSON.parse(request.prompt).currentFormatting, 'paragraph');
  }
  for (const mode of ['ask', 'memory', 'check', 'persona']) assert.ok(!assistPrompts({ mode, formatting: true, text: 'x' }).system.includes('minimal Markdown'));
  assert.ok(assistPrompts({ mode: 'complete', formatting: false }).system.includes('no quotation marks, explanation or markdown'));
});

test('Tab requests once, waits for streaming, accepts ready proposals and preserves modified/IME navigation', () => {
  const base = { trigger: 'tab', mode: 'assistita', modified: false, composing: false, repeat: false, busy: false, proposal: 'none' };
  assert.equal(aiTabAction(base), 'request');
  assert.equal(aiTabAction({ ...base, proposal: 'ready' }), 'accept');
  assert.equal(aiTabAction({ ...base, busy: true }), 'wait');
  assert.equal(aiTabAction({ ...base, repeat: true }), 'wait');
  assert.equal(aiTabAction({ ...base, proposal: 'pending' }), 'wait');
  for (const patch of [{ modified: true }, { composing: true }, { mode: 'libera' }, { mode: 'revisione' }, { trigger: 'pause' }]) assert.equal(aiTabAction({ ...base, ...patch }), 'native');
});

test('activation and formatting preferences persist per user and reject malformed stored values', t => {
  const values = new Map(); globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  t.after(() => delete globalThis.localStorage);
  assert.deepEqual(readAiPreferences('alice'), { trigger: 'pause', formatting: true });
  assert.equal(storeAiPreferences({ trigger: 'tab', formatting: false }, 'alice'), true);
  assert.deepEqual(readAiPreferences('alice'), { trigger: 'tab', formatting: false });
  assert.equal(readAiPreferences('bob').trigger, 'pause');
  values.set('scrivia:ai-preferences:alice', '{bad'); assert.equal(readAiPreferences('alice').trigger, 'pause');
});
