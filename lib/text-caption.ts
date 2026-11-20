import type { Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { captionStrength, planImageLayout, styleCaption } from './image-layout.ts';

// Tasto destro «Rendi questa frase la didascalia dell'immagine vicina»: la frase (la selezione, oppure la frase
// sotto il cursore, oppure l'intera riga se è breve) viene tolta dal testo e messa sotto l'immagine più vicina,
// in stile didascalia. Se l'immagine ha già una didascalia, questa viene sostituita. Tutto in un solo passo annullabile.

export const MAX_CAPTION_CHARS = 320;
const MAX_STEPS = 3; // blocchi pieni fra la frase e l'immagine

export type TextCaptionPlan = {
  from: number; to: number;           // testo da spostare
  text: string;                       // la didascalia
  block: number;                      // paragrafo che contiene la frase
  wholeBlock: boolean;                // la frase è tutto il paragrafo: il paragrafo sparisce
  image: number;                      // immagine che riceve la didascalia
  side: 'above' | 'below';            // dove si trova l'immagine rispetto alla frase
  replaces: string | null;            // testo della didascalia precedente, se c'era
  oldCaption: number | null;          // posizione della didascalia precedente
};
export type TextCaptionResult = { plan: TextCaptionPlan } | { error: string };

const SENTENCE_END = /[.!?…]+["»”’)\]]*\s+/gu;
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

// Offsets of the sentence that contains `at` inside the paragraph text.
function sentenceBounds(text: string, at: number): [number, number] {
  let start = 0, end = text.length;
  for (const match of text.matchAll(SENTENCE_END)) {
    const stop = match.index! + match[0].length;
    if (stop <= at) start = stop; else { end = match.index! + match[0].trimEnd().length; break; }
  }
  return [start, end];
}

export function planTextCaption(doc: Node, from: number, to: number): TextCaptionResult {
  const $from = doc.resolve(from), $to = doc.resolve(to);
  if ($from.depth !== 1 || $from.parent.type.name !== 'paragraph' || !$from.sameParent($to))
    return { error: 'Scegli una frase in un paragrafo normale (non in un titolo, un elenco o una tabella).' };
  const block = $from.before(1), node = $from.parent, start = block + 1;
  const full = doc.textBetween(start, start + node.content.size, '\n', '￼');
  let a: number, b: number;
  if (from !== to) { a = from - start; b = to - start; }
  else if (clean(full).length <= MAX_CAPTION_CHARS && !/[.!?…]\s+\S/u.test(full.trim())) { a = 0; b = full.length; }
  else [a, b] = sentenceBounds(full, from - start);
  // Spazi ai bordi restano nel testo; la frase non può contenere oggetti (immagini in linea, formule).
  while (a < b && /\s/.test(full[a])) a++;
  while (b > a && /\s/.test(full[b - 1])) b--;
  const raw = full.slice(a, b);
  const text = clean(raw);
  if (!text) return { error: 'Non c’è testo da usare come didascalia: seleziona la frase o mettici il cursore.' };
  if (raw.includes('￼')) return { error: 'La frase contiene un oggetto (immagine o formula): seleziona solo il testo.' };
  if (text.length > MAX_CAPTION_CHARS) return { error: `La frase è troppo lunga per una didascalia (massimo ${MAX_CAPTION_CHARS} caratteri): selezionane una parte.` };
  const wholeBlock = !clean(full.slice(0, a)) && !clean(full.slice(b));

  // L'immagine più vicina, sopra o sotto, senza oltrepassare un titolo; a parità di distanza vince quella sopra.
  const children: { node: Node; pos: number }[] = []; let index = -1;
  doc.forEach((child, pos) => { if (pos === block) index = children.length; children.push({ node: child, pos }); });
  const look = (step: 1 | -1) => {
    let steps = 0;
    for (let i = index + step; i >= 0 && i < children.length; i += step) {
      const child = children[i].node;
      if (child.type.name === 'image') return { pos: children[i].pos, steps };
      if (child.type.name === 'heading') return null;
      if (child.type.name === 'paragraph' && !child.textContent.trim()) continue;
      if (++steps >= MAX_STEPS) return null;
    }
    return null;
  };
  const above = look(-1), below = look(1);
  const pick = above && (!below || above.steps <= below.steps) ? { ...above, side: 'above' as const } : below ? { ...below, side: 'below' as const } : null;
  if (!pick) return { error: 'Nessuna immagine vicina: la frase deve stare subito sopra o sotto un’immagine (al massimo un paio di paragrafi di distanza).' };

  const op = planImageLayout(doc).ops.find(o => o.kind === 'image' && o.image === pick.pos);
  // Solo una didascalia riconoscibile (etichetta «Figura 1:», corsivo, centrata…) viene sostituita: una riga breve qualsiasi resta testo.
  const existing = op?.caption && op.caption.pos !== block ? op.caption.pos : null;
  const oldCaption = existing !== null && captionStrength(doc.nodeAt(existing)!) !== 'short' ? existing : null;
  return { plan: { from: start + a, to: start + b, text, block, wholeBlock, image: pick.pos, side: pick.side,
    replaces: oldCaption !== null ? clean(doc.nodeAt(oldCaption)!.textContent) : null, oldCaption } };
}

// Toglie la frase dal testo e la mette, in stile didascalia, subito sotto l'immagine.
export function applyTextCaption(tr: Transaction, plan: TextCaptionPlan): Transaction {
  const schema = tr.doc.type.schema;
  const caption = styleCaption(schema.nodes.paragraph.create(null, schema.text(plan.text)), false);
  const steps = tr.mapping.maps.length;
  const map = (pos: number) => tr.mapping.slice(steps).map(pos);
  // Prima si toglie il testo, poi la vecchia didascalia (se è un altro paragrafo), infine si inserisce la nuova.
  if (plan.wholeBlock) { const node = tr.doc.nodeAt(plan.block)!; tr.delete(plan.block, plan.block + node.nodeSize); }
  else {
    tr.delete(plan.from, plan.to);
    // Niente doppi spazi dove c'era la frase.
    const at = map(plan.from), $at = tr.doc.resolve(at), before = $at.nodeBefore?.text, after = $at.nodeAfter?.text;
    if (before?.endsWith(' ') && (after?.startsWith(' ') || !after)) tr.delete(at - 1, at);
    else if (!before && after?.startsWith(' ')) tr.delete(at, at + 1);
  }
  if (plan.oldCaption !== null) {
    const pos = map(plan.oldCaption), node = tr.doc.nodeAt(pos);
    if (node && node.type.name === 'paragraph') tr.delete(pos, pos + node.nodeSize);
  }
  const image = map(plan.image), node = tr.doc.nodeAt(image);
  if (!node || node.type.name !== 'image') return tr;
  tr.insert(image + node.nodeSize, caption);
  return tr;
}
