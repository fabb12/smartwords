// Voice input: the browser's speech recognition (Web Speech API) turns speech into text,
// with spoken punctuation in Italian («virgola», «punto», «a capo»…).
// Chrome, Edge and Safari send the audio to their own recognition service; Firefox has none,
// and the desktop app (Electron) lacks the service keys, so there the button is hidden.
type Alternative = { transcript: string };
type Result = { isFinal: boolean; length: number; [index: number]: Alternative };
type ResultEvent = { resultIndex: number; results: { length: number; [index: number]: Result } };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: ResultEvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognition(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor; scriviaDesktop?: unknown };
  if (w.scriviaDesktop) return undefined;
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}
export const dictationSupported = () => !!recognition();

// Spoken punctuation; «a capo» and «nuovo paragrafo» start a new paragraph ("\n").
const COMMANDS: [RegExp, string][] = [
  [/\s*\b(?:nuovo paragrafo|a capo)\b[\s,.]*/gi, '\n'],
  [/\s*\bpunto e virgola\b/gi, ';'],
  [/\s*\bpunto (?:interrogativo|di domanda)\b/gi, '?'],
  [/\s*\bpunto esclamativo\b/gi, '!'],
  [/\s*\bpuntini(?: di sospensione)?\b/gi, '…'],
  [/\s*\bdue punti\b/gi, ':'],
  [/\s*\bvirgola\b/gi, ','],
  [/\s*\bpunto\b/gi, '.'],
  [/\bapri virgolette\s*/gi, '«'],
  [/\s*\bchiudi virgolette\b/gi, '»'],
  [/\bapri parentesi\s*/gi, '('],
  [/\s*\bchiudi parentesi\b/gi, ')'],
];

// Text to insert for a recognized phrase, given the paragraph text before the cursor:
// spoken punctuation becomes symbols, a space separates it from the previous word,
// and sentences start with a capital letter. "\n" in the result means a new paragraph.
export function dictationText(spoken: string, before: string): string {
  let text = spoken.replace(/\s+/g, ' ');
  for (const [pattern, symbol] of COMMANDS) text = text.replace(pattern, symbol);
  text = text.replace(/ *\n */g, '\n').replace(/([,;:.!?…»)])(?=[\p{L}«(])/gu, '$1 ').replace(/[ \t]+$/g, '').replace(/^[ \t]+/, '');
  if (!text) return '';
  // Capital letter at the start of a paragraph and after . ! ? (also across the cursor).
  let start = /(^|[.!?…]["»)]?)\s*$/u.test(before);
  text = text.replace(/[\p{L}\n.!?…]/gu, ch => {
    if (ch === '\n' || /[.!?…]/u.test(ch)) { start = true; return ch; }
    if (start) { start = false; return ch.toLocaleUpperCase('it-IT'); }
    return ch;
  });
  const glued = /^[,;:.!?…»)\n]/u.test(text) || !before || /[\s«(]$/u.test(before);
  return glued ? text : ' ' + text;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microfono non autorizzato: consenti l’accesso al microfono nelle impostazioni del browser.',
  'service-not-allowed': 'Il browser non consente la dettatura su questa pagina.',
  'audio-capture': 'Nessun microfono disponibile.',
  network: 'Dettatura non disponibile: il riconoscimento vocale del browser richiede la connessione.',
  'language-not-supported': 'Il riconoscimento vocale del browser non supporta l’italiano.',
};

export type Dictation = { stop: () => void };
// Listens until stopped: recognized phrases go to onText, the phrase still being spoken to onInterim.
// Browsers end a session after a pause, so it restarts; after a long silence it stops by itself.
export function startDictation(events: { onText: (text: string) => void; onInterim: (text: string) => void; onEnd: (error?: string) => void }, lang = 'it-IT'): Dictation {
  const Ctor = recognition();
  if (!Ctor) { events.onEnd('Questo browser non offre la dettatura: usa Chrome, Edge o Safari.'); return { stop: () => {} }; }
  // Chrome on Android repeats earlier words in continuous mode: there each phrase is its own session.
  const continuous = !/Android/i.test(navigator.userAgent);
  let rec: Recognition, stopped = false, silent = 0, error: string | undefined;
  const begin = () => {
    rec = new Ctor(); rec.lang = lang; rec.continuous = continuous; rec.interimResults = true;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], said = r[0]?.transcript || '';
        if (r.isFinal) { if (said.trim()) events.onText(said); } else interim += said;
      }
      silent = 0; events.onInterim(interim);
    };
    rec.onerror = e => {
      if (e.error === 'aborted') return;
      if (e.error === 'no-speech') { if (++silent >= 3) stopped = true; return; }
      stopped = true; error = ERRORS[e.error] || 'Dettatura interrotta: riprova.';
    };
    rec.onend = () => {
      events.onInterim('');
      if (!stopped) { try { begin(); return; } catch { /* could not restart */ } }
      stopped = true; events.onEnd(error);
    };
    rec.start();
  };
  try { begin(); } catch { stopped = true; events.onEnd('Impossibile avviare la dettatura.'); }
  return { stop: () => { if (stopped) return; stopped = true; try { rec.stop(); } catch { events.onEnd(); } } };
}
