import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { ReadChunk } from './read-aloud.ts';
import { speakableText } from './formulas.ts';

// Highlight of the sentence being read; it follows edits made while reading.
export const readingKey = new PluginKey<DecorationSet>('scrivia-reading');
export const ReadingHighlight = Extension.create({
  name: 'readingHighlight',
  addProseMirrorPlugins() { return [new Plugin({
    key: readingKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(readingKey) as { from: number; to: number } | null | undefined;
        if (meta === null) return DecorationSet.empty;
        if (meta) return DecorationSet.create(tr.doc, [Decoration.inline(meta.from, meta.to, { class: 'reading-now' })]);
        return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
      },
    },
    props: { decorations(state) { return readingKey.getState(state); } },
  })]; },
});

export type Reader = { pause(): void; resume(): void; stop(): void; setRate(rate: number): void; skip(step: number): void };
type Events = { onChunk(index: number): void; onEnd(error?: string): void; onWaiting?(waiting: boolean): void; onPaused?(): void };

// 0.1 s of silence: playing it inside the click unlocks audio on iOS/Safari.
const SILENCE = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==';

// Neural voices: each chunk is fetched as audio while the previous one plays.
export function startNeuralReader(chunks: ReadChunk[], fetchAudio: (index: number, signal: AbortSignal) => Promise<Blob>, rate: number, events: Events): Reader {
  const controller = new AbortController(), cache = new Map<number, Promise<Blob>>(), audio = new Audio();
  let index = 0, stopped = false, paused = false, url = '', token = 0;
  audio.src = SILENCE; audio.play().catch(() => {});
  const get = (n: number) => {
    if (!cache.has(n)) { const p = fetchAudio(n, controller.signal); p.catch(() => {}); cache.set(n, p); }
    return cache.get(n)!;
  };
  const finish = (error?: string) => { if (stopped) return; stopped = true; controller.abort(); audio.pause(); if (url) URL.revokeObjectURL(url); events.onEnd(error); };
  async function play(n: number) {
    const mine = ++token;
    if (stopped) return;
    if (n >= chunks.length) { finish(); return; }
    index = n; events.onChunk(n);
    let blob: Blob;
    events.onWaiting?.(true);
    try { blob = await get(n); } catch (error) { if (mine === token) finish(controller.signal.aborted ? undefined : (error as Error).message || 'Lettura non riuscita.'); return; }
    finally { if (mine === token) events.onWaiting?.(false); }
    if (stopped || mine !== token) return;
    for (const k of cache.keys()) if (k < n) cache.delete(k);
    if (n + 1 < chunks.length) get(n + 1);
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob); audio.src = url; audio.playbackRate = rate;
    audio.onended = () => { if (mine === token) void play(n + 1); };
    audio.onerror = () => { if (mine === token) finish('Il browser non riesce a riprodurre l’audio ricevuto.'); };
    if (!paused) audio.play().catch(() => { if (mine === token) { paused = true; events.onPaused?.(); } });
  }
  void play(0);
  return {
    pause() { paused = true; audio.pause(); },
    resume() { if (stopped) return; paused = false; if (audio.src && audio.src !== SILENCE && !audio.ended) audio.play().catch(() => {}); },
    stop() { finish(); },
    setRate(value) { rate = value; audio.playbackRate = value; },
    skip(step) { if (!stopped) { audio.pause(); void play(Math.max(0, Math.min(chunks.length - 1, index + step))); } },
  };
}

// Device voices (Web Speech API): one utterance per sentence, which also avoids
// the Chrome bug that silences long utterances after about 15 seconds.
export function startDeviceReader(chunks: ReadChunk[], voice: SpeechSynthesisVoice | null, rate: number, events: Events): Reader {
  const synth = window.speechSynthesis;
  let index = 0, stopped = false, paused = false, current: SpeechSynthesisUtterance | null = null;
  synth.cancel();
  const finish = (error?: string) => { if (stopped) return; stopped = true; current = null; synth.cancel(); events.onEnd(error); };
  function speak(n: number) {
    if (stopped || paused) return;
    if (n >= chunks.length) { finish(); return; }
    index = n; events.onChunk(n);
    const u = new SpeechSynthesisUtterance(speakableText(chunks[n].text));
    u.lang = voice?.lang || 'it-IT'; if (voice) u.voice = voice; u.rate = rate;
    u.onend = () => { if (current === u) { current = null; speak(n + 1); } };
    u.onerror = event => { if (current !== u) return; if (event.error === 'interrupted' || event.error === 'canceled') return; finish(window.speechSynthesis.getVoices().length ? 'La voce del dispositivo non è disponibile: scegline un’altra (⚙).' : 'Questo dispositivo non ha voci di sintesi installate: in ⚙ scegli OpenAI o ElevenLabs per voci neurali realistiche.'); };
    current = u; synth.speak(u);
  }
  speak(0);
  // Pausing restarts the sentence on resume: speechSynthesis.pause() is unreliable on Android.
  const restart = (n: number) => { current = null; synth.cancel(); setTimeout(() => speak(n), 60); };
  return {
    pause() { paused = true; current = null; synth.cancel(); },
    resume() { if (stopped || !paused) return; paused = false; speak(index); },
    stop() { finish(); },
    setRate(value) { rate = value; if (!paused && !stopped) restart(index); },
    skip(step) { if (!stopped) { const n = Math.max(0, Math.min(chunks.length - 1, index + step)); if (paused) index = n; else restart(n); } },
  };
}
