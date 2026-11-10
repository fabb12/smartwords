import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { applyImageLayout, planImageLayout, describeImageLayout, CONTENT_WIDTH } from '../lib/image-layout.ts';
import { captionJobs, imageContext, parseCaptionAnswer, sizeFor, withCaptions, captionPayload } from '../lib/image-caption.ts';
import { assistPrompts, providerRequest } from '../lib/providers.ts';
import { imageSizeAt, imageSizeForWidth, pageShare } from '../lib/editor-images.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  heading: { group: 'block', content: 'inline*', attrs: { level: { default: 2 } } },
  paragraph: { group: 'block', content: 'inline*', attrs: { textAlign: { default: null } } },
  image: { group: 'block', atom: true, attrs: { src: {}, alt: { default: null }, width: { default: null }, height: { default: null } } },
}, marks: { bold: {}, italic: {}, textStyle: { attrs: { fontFamily: { default: null }, fontSize: { default: null }, color: { default: null } } } } });
const p = text => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const h = text => schema.node('heading', { level: 2 }, schema.text(text));
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const img = (src = PNG, width = 600, height = 400) => schema.node('image', { src, width, height });
const doc = (...blocks) => schema.node('doc', null, blocks);
const long = 'Questo è un paragrafo normale del testo, abbastanza lungo da non sembrare una didascalia, con molte parole e una conclusione.';

test('le immagini senza didascalia sono riconosciute, con il testo attorno', () => {
  const d = doc(h('Il porto'), p('Il porto di Genova è il più grande d’Italia. ' + long), img(), p('Nel Novecento i traffici crebbero e il porto si ampliò verso ponente. ' + long), img(PNG, 300, 300), p('Figura 2: la darsena'), p(long));
  const plan = planImageLayout(d);
  assert.equal(plan.uncaptioned.length, 1, 'la seconda immagine ha già la sua didascalia');
  const { jobs } = captionJobs(d, plan);
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].text, /Heading above: Il porto/);
  assert.match(jobs[0].text, /Passage before the image: Il porto di Genova/);
  assert.match(jobs[0].text, /Passage after the image: Nel Novecento/);
});

test('solo PNG, JPEG e WebP incorporati vengono letti; gli altri sono contati', () => {
  const d = doc(p(long), img('https://example.com/a.png'), p(long), img('data:image/gif;base64,R0lG'), p(long), img(), p(long));
  const found = captionJobs(d, planImageLayout(d));
  assert.equal(found.jobs.length, 1); assert.equal(found.unreadable, 2);
  assert.equal(captionJobs(d, planImageLayout(d), 0).over, 1);
});

test('la risposta del modello viene letta anche con recinti e testo attorno, e validata', () => {
  assert.deepEqual(parseCaptionAnswer('```json\n{"caption":"«Il porto all’alba»","alt":"Navi al molo","size":"large"}\n```'), { caption: 'Il porto all’alba', alt: 'Navi al molo', size: 'large' });
  assert.equal(parseCaptionAnswer('Ecco: {"caption":"Una piazza.","size":"enorme"}').size, 'medium');
  assert.equal(parseCaptionAnswer('{"caption":"","alt":"","size":"medium"}'), null);
  assert.equal(parseCaptionAnswer('non è json'), null);
  assert.equal(parseCaptionAnswer('{"caption":"' + 'x'.repeat(400) + '"}'), null);
});

test('la dimensione segue la classe scelta e resta nella pagina', () => {
  assert.deepEqual(sizeFor('full', 600, 400), { width: CONTENT_WIDTH, height: Math.round(400 * CONTENT_WIDTH / 600) });
  const small = sizeFor('small', 600, 400), large = sizeFor('large', 600, 400);
  assert.ok(small.width < large.width && large.width < CONTENT_WIDTH);
  assert.equal(Math.round(small.width / small.height * 100), Math.round(600 / 400 * 100));
  assert.ok(sizeFor('full', 100, 5000).height <= 1000, 'un’immagine molto alta non supera la pagina');
  assert.equal(sizeFor('full', 0, 0), null);
});

test('la didascalia scritta dall’AI viene inserita sotto l’immagine, in stile didascalia, con alt e dimensione', () => {
  const d = doc(p(long), img(), p(long));
  const plan = planImageLayout(d), { jobs } = captionJobs(d, plan);
  const ops = withCaptions(plan.ops, jobs, new Map([[jobs[0].pos, { caption: 'Il porto all’alba.', alt: 'Navi al molo', size: 'small' }]]));
  const state = EditorState.create({ doc: d }), out = applyImageLayout(state.tr, ops).doc;
  const image = out.child(1), caption = out.child(2);
  assert.equal(image.type.name, 'image'); assert.equal(image.attrs.alt, 'Navi al molo');
  assert.ok(image.attrs.width < 300, 'ridotta');
  assert.equal(caption.textContent, 'Il porto all’alba.');
  assert.equal(caption.attrs.textAlign, 'center');
  assert.ok(caption.firstChild.marks.some(m => m.type.name === 'italic'));
  assert.equal(out.child(3).textContent, long, 'il testo originale è intatto');
  assert.match(describeImageLayout({ ops, captions: [], formulas: [] }), /1 didascalia scritta leggendo l’immagine/);
});

test('le immagini di una sequenza mantengono la larghezza comune', () => {
  const d = doc(p(long), img(PNG, 600, 400), img(PNG, 300, 200), p(long));
  const plan = planImageLayout(d), { jobs } = captionJobs(d, plan);
  assert.ok(jobs.every(j => j.grouped));
  const ops = withCaptions(plan.ops, jobs, new Map(jobs.map(j => [j.pos, { caption: 'Una vista.', alt: '', size: 'full' }])));
  const state = EditorState.create({ doc: d }), out = applyImageLayout(state.tr, ops).doc;
  const widths = []; out.forEach(n => { if (n.type.name === 'image') widths.push(n.attrs.width); });
  assert.equal(new Set(widths).size, 1);
});

test('la richiesta «caption» porta l’immagine al provider nel formato giusto', () => {
  const job = { pos: 3, grouped: false, src: PNG, width: 600, height: 400, text: 'Passage before the image: ciao' };
  const payload = captionPayload('p1', job);
  const { system, prompt, images, maxTokens } = assistPrompts(payload);
  assert.deepEqual(images, [PNG]); assert.match(system, /Look at the image carefully/); assert.ok(maxTokens >= 400);
  assert.equal(JSON.parse(prompt).text, job.text);
  const openai = providerRequest('openai', 'm', 'k', system, prompt, 400, images).body.messages[1].content;
  assert.equal(openai[1].type, 'image_url'); assert.equal(openai[1].image_url.url, PNG);
  const anthropic = providerRequest('anthropic', 'm', 'k', system, prompt, 400, images).body.messages[0].content;
  assert.equal(anthropic[0].type, 'image'); assert.deepEqual(anthropic[0].source, { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' });
  // Gli altri modi non inviano mai immagini, e i valori non validi vengono scartati.
  assert.deepEqual(assistPrompts({ mode: 'rewrite', text: 'ciao', images: [PNG] }).images, []);
  assert.deepEqual(assistPrompts({ mode: 'caption', text: 'x', images: ['https://evil.test/x.png', 'data:text/html;base64,AA==', 5] }).images, []);
  assert.equal(providerRequest('openai', 'm', 'k', 's', 'testo').body.messages[1].content, 'testo');
});

test('ridimensionamento manuale: percentuali e larghezza esatta mantengono le proporzioni', () => {
  assert.deepEqual(imageSizeAt(600, 400, 1), { width: CONTENT_WIDTH, height: Math.round(400 * CONTENT_WIDTH / 600) });
  const half = imageSizeAt(600, 400, .5); assert.equal(pageShare(half.width), 50);
  assert.equal(Math.round(half.width / half.height * 100), 150);
  assert.equal(imageSizeForWidth(600, 400, 10).width, 40);
  assert.equal(imageSizeForWidth(600, 400, 99999).width, CONTENT_WIDTH);
  assert.throws(() => imageSizeAt(0, 10, .5));
});

test('imageContext senza testo attorno lo dichiara', () => {
  const d = doc(img()); assert.match(imageContext(d, 0), /no text around/);
});
