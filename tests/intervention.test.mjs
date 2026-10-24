import test from 'node:test';
import assert from 'node:assert/strict';
import { assistPrompts } from '../lib/providers.ts';
import { exceedsIntervention, interventionInstruction, keptShare } from '../lib/intervention.ts';
import { sanitizeAiPreferences } from '../lib/ai-preferences.ts';

test('the intervention level reaches the prompt of suggestion modes only', () => {
  assert.match(assistPrompts({ mode: 'rewrite', text: 'Una frase.', intervention: 1 }).system, /level 1 of 4 \(minimal\).*proofreader/);
  assert.match(assistPrompts({ mode: 'rewrite', text: 'Una frase.', intervention: 4 }).system, /level 4 of 4 \(extensive\)/);
  assert.match(assistPrompts({ mode: 'complete', text: 'Una frase', intervention: 1 }).system, /at most about eight/);
  assert.doesNotMatch(assistPrompts({ mode: 'check', text: 'Una frase.', intervention: 1 }).system, /Intervention level/);
  assert.doesNotMatch(assistPrompts({ mode: 'format', text: 'Una frase.', formatPlan: true, intervention: 4 }).system, /Intervention level/);
  assert.equal(interventionInstruction(7, 'rewrite'), '');
});

test('preferences default to a light intervention and reject invalid levels', () => {
  assert.equal(sanitizeAiPreferences({}).intervention, 2);
  assert.equal(sanitizeAiPreferences({ intervention: 1 }).intervention, 1);
  assert.equal(sanitizeAiPreferences({ intervention: '4' }).intervention, 2);
});

test('a proposal that rewrites too much exceeds the minimal level but not the extensive one', () => {
  const original = 'Il gatto dormiva tranquillo sul divano di casa mentre fuori pioveva';
  assert.equal(keptShare(original, original), 1);
  const fix = 'Il gatto dormiva tranquillo sul divano di casa, mentre fuori pioveva.';
  assert.ok(!exceedsIntervention(1, original, fix));
  const rewrite = 'Sul sofà, il felino riposava sereno; oltre i vetri scrosciava la pioggia.';
  assert.ok(exceedsIntervention(1, original, rewrite));
  assert.ok(!exceedsIntervention(4, original, rewrite));
});
