import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { elevenSpeechRequest, groupChunks, openaiSpeechRequest, rankVoices, readChunks } from '../lib/read-aloud.ts';
import { isFormulaText, speakableText } from '../lib/formulas.ts';

const schema = new Schema({ nodes: { doc: { content: 'block+' }, text: { group: 'inline' }, paragraph: { group: 'block', content: 'inline*' }, hardBreak: { inline: true, group: 'inline' } }, marks: { bold: {} } });
const p = (...parts) => schema.node('paragraph', null, parts);
const t = (text, marks) => schema.text(text, marks);

test('text is split into sentences that map back to document positions', () => {
  const d = schema.node('doc', null, [p(t('Prima frase. Seconda '), t('frase', [schema.marks.bold.create()]), t('! ')), p(t('Terza riga'))]);
  const chunks = readChunks(d);
  assert.deepEqual(chunks.map(c => c.text), ['Prima frase.', 'Seconda frase!', 'Terza riga']);
  for (const c of chunks) assert.equal(d.textBetween(c.from, c.to).trim(), c.text);
  const part = readChunks(d, chunks[1].from, d.content.size);
  assert.equal(part[0].text, 'Seconda frase!');
});

test('very long sentences are cut at a comma and neural chunks group sentences', () => {
  const long = 'Parola '.repeat(30) + ', ' + 'altra '.repeat(30) + 'fine.';
  const chunks = readChunks(schema.node('doc', null, [p(t(long))]), 0, undefined, 260);
  assert.ok(chunks.length >= 2 && chunks.every(c => c.text.length <= 260));
  const grouped = groupChunks([{ text: 'Uno.', from: 1, to: 5 }, { text: 'Due.', from: 6, to: 10 }], 600);
  assert.deepEqual(grouped, [{ text: 'Uno. Due.', from: 1, to: 10 }]);
});

test('the most natural Italian device voices come first', () => {
  const voices = [{ name: 'Microsoft Cosimo', lang: 'it-IT' }, { name: 'Microsoft Elsa Online (Natural) - Italian (Italy)', lang: 'it-IT' }, { name: 'Google italiano', lang: 'it-IT' }, { name: 'Samantha', lang: 'en-US' }, { name: 'Alice (Enhanced)', lang: 'it-IT' }];
  const ranked = rankVoices(voices).map(v => v.name);
  assert.equal(ranked[0], 'Microsoft Elsa Online (Natural) - Italian (Italy)');
  assert.ok(!ranked.includes('Samantha'));
  assert.equal(ranked.at(-1), 'Microsoft Cosimo');
});

test('neural requests carry narration and continuity hints', () => {
  const o = openaiSpeechRequest('k', 'gpt-4o-mini-tts', 'marin', { text: 'Ciao.' });
  assert.equal(o.body.voice, 'marin'); assert.match(o.body.instructions, /italiano/);
  assert.equal(openaiSpeechRequest('k', 'tts-1-hd', 'nova', { text: 'Ciao.' }).body.instructions, undefined);
  const e = elevenSpeechRequest('k', 'eleven_multilingual_v2', 'abc', { text: 'Ciao.', previous: 'Prima.', next: 'Dopo.' });
  assert.match(e.url, /text-to-speech\/abc/); assert.equal(e.headers['xi-api-key'], 'k'); assert.equal(e.body.previous_text, 'Prima.');
});

test('formulas are recognized and read in Italian words', () => {
  assert.ok(isFormulaText('E = mc²')); assert.ok(isFormulaText('$a^2 + b^2 = c^2$')); assert.ok(isFormulaText('v = d / t   (2)'));
  assert.ok(!isFormulaText('La legge di Ohm è semplice.')); assert.ok(!isFormulaText('Capitolo 2'));
  assert.equal(speakableText('E = mc²'), 'E uguale a m c al quadrato');
  assert.equal(speakableText('$a^2 + b^2 = c^2$'), 'a al quadrato più b al quadrato uguale a c al quadrato');
  assert.equal(speakableText('\\frac{1}{2} m v^2'), '1 fratto 2 m v al quadrato');
  assert.match(speakableText('La relazione E = mc² lega massa ed energia.'), /E uguale a m c al quadrato lega/);
  assert.equal(speakableText('Era il 12/3/2024, e/o altro.'), 'Era il 12/3/2024, e/o altro.');
});
