'use client';
import { useEffect, useState } from 'react';
import { ALL_PROVIDERS, type AiProvider } from '../lib/device-models';
import { readTokenHistory, summarizeTokenUsage, TOKEN_USAGE_EVENT, tokenUsageKey, type UsageBucket } from '../lib/token-usage';

const fmt = (n: number) => n.toLocaleString('it-IT');
export function TokenStats({ owner }: { owner: string }) {
  const [history, setHistory] = useState<UsageBucket[]>([]), [days, setDays] = useState(30);
  useEffect(() => {
    const refresh = () => setHistory(readTokenHistory(owner));
    const sync = (event: StorageEvent) => { if (event.key === tokenUsageKey(owner) || event.key === null) refresh(); };
    refresh(); window.addEventListener(TOKEN_USAGE_EVENT, refresh); window.addEventListener('storage', sync);
    return () => { window.removeEventListener(TOKEN_USAGE_EVENT, refresh); window.removeEventListener('storage', sync); };
  }, [owner]);
  const stats = summarizeTokenUsage(history, days);
  return <section className="token-stats" aria-label="Statistiche dei token">
    <div className="token-stats-heading"><h3>Consumo token</h3><label>Periodo<select value={days} onChange={e => setDays(Number(e.target.value))}>
      <option value={1}>Oggi (UTC)</option><option value={7}>Ultimi 7 giorni</option><option value={30}>Ultimi 30 giorni</option><option value={90}>Ultimi 90 giorni</option>
    </select></label></div>
    <dl className="token-totals">
      <div><dt>Token totali</dt><dd>{fmt(stats.totalTokens)}</dd></div>
      <div><dt>In ingresso</dt><dd>{fmt(stats.inputTokens)}</dd></div>
      <div><dt>In uscita</dt><dd>{fmt(stats.outputTokens)}</dd></div>
      <div><dt>Richieste</dt><dd>{fmt(stats.requests)}</dd></div>
    </dl>
    {!!stats.requests && <p className="form-note">{fmt(stats.requests - stats.estimatedRequests)} richieste con conteggio del provider · {fmt(stats.estimatedRequests)} con stima · {fmt(stats.interruptedRequests)} interrotte.
      {!!stats.cachedInputTokens && <> {fmt(stats.cachedInputTokens)} token letti dalla cache del provider, già inclusi nell’ingresso.</>}</p>}
    {stats.models.length ? <div className="token-table-wrap"><table className="token-table"><caption>Consumi per provider e modello</caption><thead><tr><th scope="col">Provider / modello</th><th scope="col">Richieste</th><th scope="col">Ingresso</th><th scope="col">Uscita</th><th scope="col">Totale</th></tr></thead>
      <tbody>{stats.models.map(row => <tr key={row.provider + ':' + row.model}><th scope="row">{ALL_PROVIDERS[row.provider as AiProvider]?.name || row.provider}<small>{row.model}</small>{!!row.estimatedRequests && <small>Include {fmt(row.estimatedRequests)} {row.estimatedRequests === 1 ? 'stima' : 'stime'}</small>}</th><td>{fmt(row.requests)}</td><td>{fmt(row.inputTokens)}</td><td>{fmt(row.outputTokens)}</td><td>{fmt(row.inputTokens + row.outputTokens)}</td></tr>)}</tbody>
    </table></div> : <p className="form-note">Le statistiche compariranno dopo la prima richiesta AI.</p>}
    <p className="form-note">Storico degli ultimi 90 giorni su questo dispositivo, separato per utente, a partire dall’attivazione di questa funzione. Sono incluse le richieste di tutti i modelli, anche locali. Le risposte riutilizzate da Scrivia non consumano nuovi token.</p>
    <p className="form-note">I conteggi provengono dal provider quando disponibili. Altrimenti, anche per richieste interrotte, la stima usa circa 1 token ogni 4 caratteri del prompt completo e della risposta ricevuta. Le richieste interrotte prima di ricevere una risposta possono mancare. I valori non sono una fattura: per gli addebiti consulta il provider.</p>
  </section>;
}
