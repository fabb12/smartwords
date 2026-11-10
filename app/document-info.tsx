'use client';
import { useEffect, useState } from 'react';
import { BarChart3, FileClock, X } from 'lucide-react';
import { EMPTY_STATS, formatDuration, localDay, readingMinutes, recentDays, wordsPerHour, writingStreak, type DocStats, type UserStats } from '../lib/activity';

export type InfoTab = 'document' | 'stats';

const when = (n: number | null | undefined) => n ? new Date(n).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const number = (n: number) => n.toLocaleString('it-IT');

function Item({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="info-item" title={hint}><span>{label}</span><strong>{value}</strong></div>;
}

// Information on the open document (created, last change, working time, counts) and the writer's statistics.
export function DocumentInfo({ title, tab, setTab, words, characters, load, loadStats, cloud, onClose }: {
  title: string; tab: InfoTab; setTab: (t: InfoTab) => void; words: number; characters: number; cloud: boolean;
  load: () => Promise<DocStats | null>; loadStats: () => Promise<UserStats>; onClose: () => void;
}) {
  const [doc, setDoc] = useState<DocStats | null>(null), [stats, setStats] = useState<UserStats | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    load().then(d => { if (live) setDoc(d); }).catch(e => { if (live) setError((e as Error).message); });
    loadStats().then(s => { if (live) setStats(s); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [load, loadStats]);

  const today = localDay(), user = stats || EMPTY_STATS;
  const days = recentDays(user.days, today, 14), top = Math.max(1, ...days.map(d => d.seconds));
  const todayRow = days[days.length - 1], busiest = user.days.reduce((best, d) => d.seconds > best.seconds ? d : best, { day: '', seconds: 0, words: 0 });
  const activeDays = user.days.filter(d => d.seconds > 0 || d.words > 0).length;
  return <div className="modal-backdrop" onClick={onClose}><section className="modal info-modal" role="dialog" aria-modal="true" aria-label="Informazioni e statistiche" onClick={e => e.stopPropagation()}>
    <button className="modal-close tool" aria-label="Chiudi informazioni" onClick={onClose}><X size={20} /></button>
    <span className="modal-icon">{tab === 'document' ? <FileClock size={24} /> : <BarChart3 size={24} />}</span>
    <h2>{tab === 'document' ? 'Informazioni sul documento' : 'Le tue statistiche'}</h2>
    <p className="modal-subtitle">{tab === 'document' ? <>«{title || 'Senza titolo'}»{cloud ? ' · salvato nel tuo account cloud' : ' · salvato in questo browser'}</> : 'Il tempo conta solo quando scrivi: la pagina deve essere visibile e attiva (tastiera, mouse o schermo negli ultimi 60 secondi).'}</p>
    <div className="segmented settings-segmented" role="tablist" aria-label="Sezioni">
      <button type="button" role="tab" aria-selected={tab === 'document'} className={tab === 'document' ? 'active' : ''} onClick={() => setTab('document')}>Documento</button>
      <button type="button" role="tab" aria-selected={tab === 'stats'} className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>Statistiche</button>
    </div>
    {error && <p className="warning" role="alert">{error}</p>}
    {tab === 'document' && <div className="info-grid">
      <Item label="Creato" value={when(doc?.created)} />
      <Item label="Ultima modifica" value={when(doc?.updated)} />
      <Item label="Tempo di scrittura" value={doc ? formatDuration(doc.workSeconds) : '—'} hint="Tempo in cui hai scritto davvero in questo documento" />
      <Item label="Parole" value={number(words)} />
      <Item label="Caratteri" value={number(characters)} />
      <Item label="Tempo di lettura" value={words ? '≈ ' + readingMinutes(words) + ' min' : '—'} hint="A circa 230 parole al minuto" />
      <Item label="Ritmo medio" value={doc && wordsPerHour(words, doc.workSeconds) ? number(wordsPerHour(words, doc.workSeconds)) + ' parole/ora' : '—'} hint="Parole del documento divise per il tempo di scrittura" />
      <Item label="Salvataggi con modifiche" value={doc ? number(doc.edits) : '—'} />
      <Item label="Aperto" value={doc ? doc.opens + (doc.opens === 1 ? ' volta' : ' volte') : '—'} />
      <Item label="Ultima apertura" value={when(doc?.lastOpened)} />
    </div>}
    {tab === 'stats' && <>
      <div className="info-grid">
        <Item label="Documenti" value={number(user.documents)} />
        <Item label="Parole totali" value={number(user.words)} />
        <Item label="Tempo di scrittura totale" value={formatDuration(user.workSeconds)} />
        <Item label="Oggi" value={formatDuration(todayRow.seconds) + (todayRow.words ? ' · +' + number(todayRow.words) + ' parole' : '')} />
        <Item label="Giorni di fila" value={String(writingStreak(user.days, today))} hint="Giorni consecutivi con scrittura, fino a oggi" />
        <Item label="Giorni con scrittura" value={String(activeDays)} hint="Negli ultimi 120 giorni" />
        <Item label="Giorno più lungo" value={busiest.seconds ? new Date(busiest.day + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) + ' · ' + formatDuration(busiest.seconds) : '—'} />
        <Item label="Primo documento" value={user.firstDocumentAt ? new Date(user.firstDocumentAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'} />
      </div>
      <h3>Ultimi 14 giorni</h3>
      <div className="activity-chart" role="img" aria-label={'Tempo di scrittura degli ultimi 14 giorni: ' + days.map(d => d.day.slice(5) + ' ' + formatDuration(d.seconds)).join(', ')}>
        {days.map(d => <div key={d.day} className="activity-day" title={new Date(d.day + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) + ': ' + formatDuration(d.seconds) + (d.words ? ', +' + d.words + ' parole' : '')}>
          <span className={'activity-bar' + (d.day === today ? ' today' : '')} style={{ height: d.seconds ? Math.max(4, Math.round(d.seconds / top * 100)) + '%' : '2px' }} />
          <small>{new Date(d.day + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric' })}</small>
        </div>)}
      </div>
    </>}
    <div className="form-footer"><span className="form-note">{cloud ? 'Statistiche calcolate dal tuo account cloud, valide su tutti i dispositivi.' : 'Statistiche di questo browser: accedi con un account cloud per averle su ogni dispositivo.'}</span><button className="quiet" onClick={onClose}>Chiudi</button></div>
  </section></div>;
}
