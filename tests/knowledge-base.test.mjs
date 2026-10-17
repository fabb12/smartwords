import test from 'node:test';
import assert from 'node:assert/strict';
import { KB_LIMITS, addKbDocument, buildKbIndex, cleanExtractedText, createKnowledgeBase, exportKnowledgeBase, importKnowledgeBase, kbInstruction, kbStats, mentalTraits, parsePersona, personaSample, removeKbFile, retrieveKb, sanitizeKnowledgeBase, splitText, styleSource, PERSONA_SAMPLE } from '../lib/knowledge-base.ts';
import { fingerprint } from '../lib/narrative.ts';
import { assistPrompts } from '../lib/providers.ts';

const essay = Array.from({ length: 40 }, (_, i) => `Forse il tempo non scorre affatto, eppure noi lo sentiamo passare. Mi chiedo perché la fisica ci sembri così lontana? Perché, in fondo, la meraviglia nasce dalle domande semplici ${i}.`).join('\n');
const sea = Array.from({ length: 30 }, (_, i) => `Il mare di Liguria batteva contro gli scogli e il pescatore guardava le reti asciugare al sole ${i}. La barca era vecchia ma teneva il mare.`).join('\n\n');
const base = () => addKbDocument(addKbDocument(createKnowledgeBase('Saggi', 'Autore', 'author', 1), 'saggio.pdf', 'pdf', essay, 2), 'mare.docx', 'docx', sea, 3);

test('splitter keeps chunks within size, along paragraphs and without breaking words', () => {
  const chunks = splitText(essay + '\n\n' + 'parola '.repeat(400), 300);
  assert.ok(chunks.length > 5);
  for (const c of chunks) { assert.ok(c.length <= 300, c.length); assert.ok(!/\s$/.test(c)); }
  assert.equal(chunks.join(' ').split(/\s+/).filter(w => w === 'parola').length, 400);
});

test('PDF text is rejoined across hyphenated and wrapped lines', () => {
  assert.equal(cleanExtractedText('una frase spez-\nzata che conti-\nnua\nsulla riga dopo.\n\n\n\nNuovo paragrafo.'), 'una frase spezzata che continua sulla riga dopo.\n\nNuovo paragrafo.');
});

test('documents are added once, measured locally and removable', () => {
  const kb = base();
  assert.equal(kb.files.length, 2); assert.ok(kb.chunks.length >= 4);
  assert.throws(() => addKbDocument(kb, 'copia.txt', 'txt', essay), /già nella knowledge base/);
  assert.throws(() => addKbDocument(kb, 'vuoto.txt', 'txt', 'poche parole'), /testo insufficiente/);
  assert.ok(kb.local.words > 1000); assert.ok(kb.local.style.includes('frasi:'));
  assert.ok(kb.local.themes.length > 0);
  const stats = kbStats(kb); assert.equal(stats.files, 2); assert.ok(stats.corpusTokens > 500);
  const smaller = removeKbFile(kb, kb.files[1].id);
  assert.equal(smaller.files.length, 1); assert.ok(smaller.chunks.every(c => c.f === kb.files[0].id));
});

test('a full knowledge base refuses more text', () => {
  const kb = { ...createKnowledgeBase('Piena', '', 'personal'), chunks: Array.from({ length: KB_LIMITS.chunks }, () => ({ f: 'x', t: 'testo' })) };
  assert.throws(() => addKbDocument(kb, 'altro.txt', 'txt', essay), /piena/);
});

test('mindset signals are inferred from the prose', () => {
  const traits = mentalTraits(essay, fingerprint(essay));
  assert.ok(traits.some(t => t.startsWith('dubitativa')), traits.join('|'));
  assert.ok(traits.some(t => t.startsWith('interrogativa')));
});

test('retrieval sends only the passages relevant to the current text, within budget', () => {
  const kb = base(), index = buildKbIndex(kb);
  const hits = retrieveKb(kb, index, 'Il pescatore tira le reti sulla barca', 2);
  assert.equal(hits.length, 2); assert.ok(hits[0].t.includes('pescatore'));
  assert.equal(retrieveKb(kb, index, 'zzzz qqqq', 3).length, 3, 'fallback to representative passages');
  const auto = kbInstruction(kb, index, 'il pescatore e il mare', 'complete'), full = kbInstruction(kb, index, 'il pescatore e il mare', 'continue');
  const data = JSON.parse(auto);
  assert.equal(data.kind, 'knowledge-base'); assert.match(data.relation, /another author/);
  assert.equal(data.relevantPassages.length, 2); assert.ok(auto.length < full.length);
  assert.ok(auto.length < 4500 && auto.length < kb.chunks.reduce((a, c) => a + c.t.length, 0) / 2, 'far less than the corpus');
});

test('persona is distilled from a bounded sample and parsed defensively', () => {
  const kb = base(); assert.ok(personaSample(kb).length <= PERSONA_SAMPLE);
  const persona = parsePersona('Ecco: {"summary":"Un divulgatore curioso","mindset":"guarda il mondo con stupore","values":["chiarezza","onestà"],"bad":1}', 5);
  assert.equal(persona.summary, 'Un divulgatore curioso'); assert.equal(persona.values, 'chiarezza, onestà'); assert.equal(persona.distilled, 5);
  assert.throws(() => parsePersona('nessun json'), /non leggibile/);
  assert.throws(() => parsePersona('{"summary":"x"}'), /utilizzabile/);
});

test('prompts carry the knowledge base and its mindset only in writing modes', () => {
  const kb = { ...base(), persona: { summary: 'curioso', mindset: 'stupore', distilled: 1 } }, index = buildKbIndex(kb);
  const knowledgeBase = kbInstruction(kb, index, 'il mare', 'complete');
  const complete = assistPrompts({ mode: 'complete', text: 'Il mare', knowledgeBase });
  assert.ok(JSON.parse(complete.prompt).knowledgeBase.includes('stupore'));
  assert.match(complete.system, /mentality/);
  const memory = assistPrompts({ mode: 'memory', text: 'Il mare', knowledgeBase });
  assert.equal(JSON.parse(memory.prompt).knowledgeBase, undefined);
  const persona = assistPrompts({ mode: 'persona', text: 'campione' });
  assert.match(persona.system, /"mindset"/); assert.equal(persona.maxTokens, 1500);
});

test('the interface names the source guiding the AI', () => {
  const kb = base();
  assert.deepEqual(styleSource({ kb, voiceId: 'calvino', voiceName: 'Italo Calvino', memoryActive: true }).kind, 'kb-author');
  assert.equal(styleSource({ kb, voiceId: 'calvino', voiceName: 'Italo Calvino', memoryActive: true }).extra, 'Italo Calvino');
  assert.equal(styleSource({ kb: { ...kb, kind: 'personal' }, voiceId: 'mine', voiceName: 'La mia voce', memoryActive: false }).kind, 'kb-personal');
  assert.equal(styleSource({ kb: null, voiceId: 'calvino', voiceName: 'Italo Calvino', memoryActive: true }).label, 'Italo Calvino');
  assert.equal(styleSource({ kb: null, voiceId: 'mine', voiceName: 'La mia voce', memoryActive: true }).kind, 'memory');
  assert.equal(styleSource({ kb: null, voiceId: 'mine', voiceName: 'La mia voce', memoryActive: false }).kind, 'document');
});

test('knowledge bases survive export, import and untrusted stored data', () => {
  const kb = base(), copy = importKnowledgeBase(exportKnowledgeBase(kb));
  assert.notEqual(copy.id, kb.id); assert.equal(copy.chunks.length, kb.chunks.length); assert.deepEqual(copy.local, kb.local);
  assert.throws(() => importKnowledgeBase('{"format":"altro"}'), /non è una knowledge base/);
  assert.equal(sanitizeKnowledgeBase({ name: 'senza id' }), null);
  const dirty = sanitizeKnowledgeBase({ id: 'k', files: [{ id: 'f', name: 'a' }], chunks: [{ f: 'f', t: 'ok' }, { f: 'ignoto', t: 'via' }, { f: 'f', t: 5 }], persona: { summary: 'x', evil: 'y' }, kind: 'strano' });
  assert.equal(dirty.chunks.length, 1); assert.equal(dirty.kind, 'personal'); assert.equal(dirty.persona.evil, undefined);
});
