import type { Node } from '@tiptap/pm/model';

// Read aloud: the text is split into sentences with their document positions,
// so the sentence being read can be highlighted and followed on the page.

export type ReadChunk = { text: string; from: number; to: number };
export type SpeechEngine = 'device' | 'openai' | 'elevenlabs';
export type ReadAloudSettings = {
  engine: SpeechEngine | 'auto'; rate: number;
  deviceVoice: string; openaiVoice: string; openaiModel: string; openaiProfile: string;
  elevenKey: string; elevenVoice: string; elevenModel: string;
};

export const DEFAULT_READ_ALOUD: ReadAloudSettings = {
  engine: 'auto', rate: 1, deviceVoice: '', openaiVoice: 'marin', openaiModel: 'gpt-4o-mini-tts', openaiProfile: '',
  elevenKey: '', elevenVoice: '', elevenModel: 'eleven_multilingual_v2',
};
export const OPENAI_VOICES = ['marin', 'cedar', 'coral', 'sage', 'nova', 'shimmer', 'ballad', 'verse', 'ash', 'alloy', 'echo', 'fable', 'onyx'] as const;
export const READ_RATES = [0.75, 0.9, 1, 1.15, 1.3, 1.5] as const;
// Narration direction for models that accept it: Italian, natural, audiobook pace.
export const NARRATION = 'Leggi in italiano con voce naturale, calda e umana, come un narratore di audiolibri: ritmo pacato, pause naturali a virgole e punti, intonazione espressiva ma misurata. Pronuncia correttamente nomi e accenti. Non aggiungere né omettere parole.';

const KEY = 'scrivia:read-aloud';
export function readReadAloudSettings(): ReadAloudSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...DEFAULT_READ_ALOUD };
    for (const k of Object.keys(out) as (keyof ReadAloudSettings)[]) if (typeof raw[k] === typeof out[k]) (out as Record<string, unknown>)[k] = raw[k];
    if (!['auto', 'device', 'openai', 'elevenlabs'].includes(out.engine)) out.engine = 'auto';
    out.rate = Math.min(2, Math.max(0.5, Number(out.rate) || 1));
    return out;
  } catch { return { ...DEFAULT_READ_ALOUD }; }
}
export function storeReadAloudSettings(settings: ReadAloudSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); return true; } catch { return false; }
}

function sentences(text: string): [number, number][] {
  const out: [number, number][] = [];
  const Segmenter = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(t: string): Iterable<{ segment: string; index: number }> } }).Segmenter;
  if (Segmenter) for (const { segment, index } of new Segmenter('it', { granularity: 'sentence' }).segment(text)) out.push([index, index + segment.length]);
  else { const re = /[^.!?…]+(?:[.!?…]+["»”’')\]]*)?\s*/gu; let m; while ((m = re.exec(text))) { if (!m[0]) break; out.push([m.index, m.index + m[0].length]); } }
  return out;
}

// Sentences of every text block between from and to. A sentence longer than
// max is cut at a comma or space. Positions are document positions.
export function readChunks(doc: Node, from = 0, to = doc.content.size, max = 260): ReadChunk[] {
  const chunks: ReadChunk[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return;
    // Character offsets of the block text mapped to document positions.
    let text = ''; const at: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) for (let i = 0; i < child.text!.length; i++) { text += child.text![i]; at.push(start + i); }
      else { text += ' '; at.push(start); }
    });
    at.push(pos + node.nodeSize - 1);
    for (const [a, b] of sentences(text)) {
      let start = a;
      while (start < b) {
        let end = b;
        if (end - start > max) {
          const piece = text.slice(start, start + max), cut = Math.max(piece.lastIndexOf(', '), piece.lastIndexOf('; '), piece.lastIndexOf(': '));
          end = start + (cut > max / 3 ? cut + 2 : Math.max(piece.lastIndexOf(' ') + 1, 1));
        }
        const s = Math.max(start, 0), e = end;
        const docFrom = at[s], docTo = at[e - 1] + 1;
        const value = text.slice(s, e).replace(/\s+/g, ' ').trim();
        if (/[\p{L}\p{N}]/u.test(value) && docTo > from && docFrom < to) chunks.push({ text: value, from: Math.max(docFrom, from), to: Math.min(docTo, to) });
        start = end;
      }
    }
    return false;
  });
  return chunks;
}

// Neural engines read better (and cost fewer requests) with a few sentences together.
export function groupChunks(chunks: ReadChunk[], max = 600): ReadChunk[] {
  const out: ReadChunk[] = [];
  for (const chunk of chunks) {
    const last = out.at(-1);
    if (last && last.text.length + chunk.text.length + 1 <= max && /[.!?…»”"]$/.test(last.text)) { last.text += ' ' + chunk.text; last.to = chunk.to; }
    else out.push({ ...chunk });
  }
  return out;
}

// Device voices differ a lot: neural/online voices (Edge "Natural", Google,
// Apple "Premium/Enhanced", Siri) sound far more human than the classic ones.
export function voiceScore(voice: { name: string; lang: string; localService?: boolean }, lang = 'it') {
  const name = voice.name.toLowerCase(), code = voice.lang.toLowerCase().replace('_', '-');
  let score = code.startsWith(lang) ? 100 : code.startsWith('en') ? 5 : 0;
  if (code === lang + '-' + lang) score += 5;
  if (/natural|neural|online/.test(name)) score += 60;
  if (/premium|enhanced|siri|wavenet|studio/.test(name)) score += 50;
  if (/google/.test(name)) score += 35;
  if (/microsoft/.test(name) && !/natural|online/.test(name)) score -= 5;
  if (/espeak|compact|eloquence|novelty|bad news|bells|bubbles|cellos|whisper|zarvox|trinoids|robot/.test(name)) score -= 80;
  return score;
}
export const naturalVoice = (voice: { name: string }) => /natural|neural|online|premium|enhanced|siri|wavenet|studio|google/i.test(voice.name);
export function rankVoices<T extends { name: string; lang: string }>(voices: T[], lang = 'it'): T[] {
  return voices.filter(v => voiceScore(v, lang) >= 100).sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang) || a.name.localeCompare(b.name));
}

export type SpeechInput = { text: string; previous?: string; next?: string };
export function openaiSpeechRequest(key: string, model: string, voice: string, input: SpeechInput) {
  return {
    url: 'https://api.openai.com/v1/audio/speech',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: { model, voice, input: input.text.slice(0, 4000), response_format: 'mp3', ...(/tts-1/.test(model) ? {} : { instructions: NARRATION }) },
  };
}
export function elevenSpeechRequest(key: string, model: string, voice: string, input: SpeechInput) {
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
    headers: { 'Content-Type': 'application/json', 'xi-api-key': key, Accept: 'audio/mpeg' },
    // previous/next text keep the intonation continuous across separate requests.
    body: { text: input.text.slice(0, 4000), model_id: model, ...(input.previous ? { previous_text: input.previous.slice(-500) } : {}), ...(input.next ? { next_text: input.next.slice(0, 500) } : {}),
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } },
  };
}
export function speechError(status: number) {
  return status === 401 || status === 403 ? 'Chiave non valida o voce non autorizzata.' : status === 429 ? 'Quota del servizio vocale esaurita o troppe richieste.' : status === 404 ? 'Voce o modello non trovati: controlla le impostazioni di lettura.' : `Il servizio vocale ha rifiutato la richiesta (${status}).`;
}
