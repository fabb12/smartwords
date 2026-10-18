import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WRITING_RULES, applyWritingRules, sanitizeWritingRules, writingRulesInstruction } from '../lib/writing-rules.ts';
import { assistPrompts } from '../lib/providers.ts';

const all = { ...DEFAULT_WRITING_RULES, noEnDash: true, noEllipsisChar: true };

test('the em dash never reaches the proposal', () => {
  assert.equal(applyWritingRules('Lui — disse — non venne.', all), 'Lui, disse, non venne.');
  assert.equal(applyWritingRules('— Dove vai?\n— A casa — rispose.', all), 'Dove vai?\nA casa, rispose.');
  assert.equal(applyWritingRules('fine—', all), 'fine');
  assert.ok(!applyWritingRules('a—b — c', all).includes('—'));
});

test('en dash, ellipsis, emoji and banned characters', () => {
  assert.equal(applyWritingRules('pagine 10–20 e poi – forse – no', all), 'pagine 10-20 e poi, forse, no');
  assert.equal(applyWritingRules('Aspetta…', all), 'Aspetta...');
  assert.equal(applyWritingRules('Ciao 😀 amico 👍🏽. © 2020', all), 'Ciao amico. © 2020');
  assert.equal(applyWritingRules('Era tardi; molto.', { ...all, avoid: ';\nmolto' }), 'Era tardi molto.');
  assert.equal(applyWritingRules('Lui — disse', { ...all, noEmDash: false }), 'Lui — disse');
});

test('rules are sanitized and turned into one instruction', () => {
  const rules = sanitizeWritingRules({ noEmDash: true, quotes: 'caporali', custom: 'Frasi brevi.', avoid: 'inoltre', noEmoji: 'yes' });
  assert.equal(rules.noEmoji, DEFAULT_WRITING_RULES.noEmoji);
  const text = writingRulesInstruction(rules);
  for (const part of ['—', '« »', 'Frasi brevi.', '"inoltre"']) assert.ok(text.includes(part), part);
  assert.equal(writingRulesInstruction({ ...DEFAULT_WRITING_RULES, noEmDash: false, noEmoji: false }), '');
  assert.equal(sanitizeWritingRules({ custom: 'x'.repeat(5000) }).custom.length, 2000);
});

test('the rules go in the system prompt, not in the document data', () => {
  const p = assistPrompts({ mode: 'complete', text: 'Il mare', rules: 'Never use the em dash (—).' });
  assert.ok(p.system.includes('General rules set by the author'));
  assert.ok(p.system.includes('Never use the em dash'));
  assert.equal(JSON.parse(p.prompt).rules, undefined);
  assert.ok(!assistPrompts({ mode: 'complete', text: 'Il mare' }).system.includes('General rules'));
});
