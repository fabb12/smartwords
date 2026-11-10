import test from 'node:test';
import assert from 'node:assert/strict';
import { assistPrompts } from '../lib/providers.ts';

const base = { mode: 'rewrite', text: 'Marco aprì la porta.', context: 'Marco era arrivato a casa.', after: 'Poi si sedette.', memory: 'Marco: occhi azzurri' };

test('«Migliora frase» controlla ripetizioni e coerenza con il testo circostante', () => {
  for (const intervention of [1, 2, 3, 4]) {
    const { system, prompt } = assistPrompts({ ...base, intervention });
    assert.match(system, /Repetition: do not repeat concepts/);
    assert.match(system, /Coherence: keep names, terms, facts, tense/);
    const input = JSON.parse(prompt);
    assert.equal(input.precedingContext, base.context);
    assert.equal(input.afterCursor, base.after);
    assert.equal(input.storyMemory, base.memory);
  }
});

test('ai livelli bassi le ripetizioni non vengono riscritte ma segnalate', () => {
  assert.match(assistPrompts({ ...base, intervention: 1 }).system, /Do not remove repetitions or change anything for coherence yourself/);
  assert.match(assistPrompts({ ...base, intervention: 2 }).system, /leave the text as it is and say so with the warning line/);
  assert.match(assistPrompts({ ...base, intervention: 3 }).system, /Remove or merge sentences that restate a concept/);
  assert.match(assistPrompts({ ...base, intervention: 4 }).system, /Eliminate every repetition of concepts/);
});

test('la sola formattazione e gli altri modi non ricevono il controllo di ripetizione', () => {
  assert.doesNotMatch(assistPrompts({ ...base, mode: 'shorten' }).system, /Repetition: do not repeat concepts/);
});
