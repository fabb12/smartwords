import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, blendShares, sanitizeBlend, voiceInstruction, voiceName } from '../lib/author-styles.ts';
import { EMPTY_PROJECT, sanitizeProject } from '../lib/project.ts';
import { parseGitHubDocument } from '../lib/github-documents.ts';
import { assistPrompts } from '../lib/providers.ts';
import { styleSource } from '../lib/knowledge-base.ts';

const blend = [{ id: 'calvino', weight: 75 }, { id: 'hemingway', weight: 25 }];
test('author mix applies relative weights as one coherent voice in provider prompts', () => {
  const shares = blendShares(blend);
  assert.deepEqual(shares.map(v => v.percent), [75, 25]);
  const style = voiceInstruction('mix', 'strong', '', 'frasi brevi', blend);
  for (const mode of ['complete', 'rewrite', 'voice', 'continue', 'directions']) {
    const input = JSON.parse(assistPrompts({ mode, text: 'La porta si aprì.', style }).prompt);
    assert.match(input.styleGuidance, /Italo Calvino \(75%\)/);
    assert.match(input.styleGuidance, /Ernest Hemingway \(25%\)/);
    assert.match(input.styleGuidance, /one coherent narrative voice/);
    assert.match(input.styleGuidance, /never copy/);
    assert.match(input.styleGuidance, /clearly evident/);
  }
  const max = VOICES.filter(v => v.family !== 'mia').slice(0, 4).map(v => ({ id: v.id, weight: 50 }));
  const longest = voiceInstruction('mix', 'strong', '', 'x'.repeat(10000), max);
  assert.ok(longest.length < 2500, 'all authors and safeguards fit the provider style budget');
  assert.match(longest, /never copy/);
  assert.match(voiceInstruction('mix', 'light', '', '', blend), /subtle nuance/);
});

test('mix sanitization rejects untrusted authors, duplicates and weights and bounds the selection', () => {
  assert.deepEqual(sanitizeBlend([null, {}, { id: 'mine', weight: 1 }, { id: 'custom', weight: 50 }, { id: 'mix', weight: 50 },
    { id: 'unknown', weight: 50 }, { id: 'calvino', weight: NaN }, { id: 'calvino', weight: -1 }, { id: 'calvino', weight: '50' }]), []);
  const clean = sanitizeBlend([...blend, { id: 'calvino', weight: 30 }, { id: 'woolf', weight: 10000 }, { id: 'levi', weight: 0.1 }, { id: 'eco', weight: 20 }]);
  assert.deepEqual(clean, [...blend, { id: 'woolf', weight: 100 }, { id: 'levi', weight: 1 }]);
  for (const incomplete of [undefined, [], [blend[0]]]) assert.match(voiceInstruction('mix', 'medium', '', '', incomplete), /author's own voice/);
});

test('mixed authors and weights survive project and repository serialization and name the active source', () => {
  const project = sanitizeProject({ ...EMPTY_PROJECT, voice: { id: 'mix', intensity: 'light', custom: '', blend } });
  const raw = { format: 'scrivia-document', version: 1, id: 'mixed-document', title: 'Due voci', updated: 1,
    content: { type: 'doc', content: [{ type: 'paragraph' }] }, project };
  assert.deepEqual(parseGitHubDocument(JSON.stringify(raw)).project.voice, project.voice);
  assert.equal(sanitizeProject(EMPTY_PROJECT).voice.id, 'mine', 'older projects keep their own voice');
  const name = voiceName('mix', blend);
  assert.match(name, /Calvino.*Hemingway/);
  assert.equal(styleSource({ voiceId: 'mix', voiceName: name, memoryActive: true }).label, name);
  assert.equal(styleSource({ kb: { kind: 'author', name: 'Autore KB' }, voiceId: 'mix', voiceName: name, memoryActive: true }).extra, name);
});
