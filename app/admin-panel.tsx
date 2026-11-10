'use client';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatDuration } from '../lib/activity';
import type { AdminApi, AdminUser } from '../lib/cloud-state';

const day = (n: number | null) => n ? new Date(n).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

// Account management for administrators: usage numbers and actions, never documents or keys.
export function AdminPanel({ admin, selfId }: { admin: AdminApi; selfId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null), [search, setSearch] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const load = useCallback(async () => { try { setUsers(await admin.users()); setError(''); } catch (e) { setError((e as Error).message); } }, [admin]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, label: string, work: () => Promise<void>) {
    setBusy(id); setError(''); setMessage('');
    try { await work(); setMessage(label); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  function remove(u: AdminUser) {
    if (!window.confirm(`Eliminare l’account ${u.email}?\nVengono cancellati per sempre i suoi ${u.documents} documenti, i profili AI, le chiavi e le statistiche.`)) return;
    const typed = window.prompt(`Per confermare scrivi l’email dell’account:\n${u.email}`);
    if (typed?.trim().toLowerCase() !== u.email.toLowerCase()) { setMessage('Eliminazione annullata: l’email non corrisponde.'); return; }
    void act(u.id, `Account ${u.email} eliminato.`, () => admin.remove(u.id));
  }
  const q = search.trim().toLowerCase(), shown = (users || []).filter(u => u.email.toLowerCase().includes(q));
  const active = (users || []).filter(u => !u.suspended).length;
  return <>
    <h3>Amministrazione degli account</h3>
    <p className="form-note">Vedi chi ha un account e come lo usa. Non puoi leggere i testi dei documenti né le chiavi API degli altri. Le registrazioni si aprono o si chiudono da Supabase (Authentication → Sign In / Providers → «Allow new users to sign up»).</p>
    <div className="admin-bar"><label>Cerca per email<input value={search} onChange={e => setSearch(e.target.value)} /></label>
      <button type="button" className="quiet" disabled={!!busy} onClick={() => void load()}><RefreshCw size={14} />Aggiorna</button>
      {users && <span className="form-note">{users.length} account, {active} attivi</span>}</div>
    {error && <p className="warning" role="alert">{error}</p>}{message && <p className="form-note" role="status">{message}</p>}
    {!users && !error && <p className="form-note">Caricamento…</p>}
    <div className="admin-list">{shown.map(u => <div className={'admin-row' + (u.suspended ? ' suspended' : '')} key={u.id}>
      <div className="admin-main"><strong>{u.email}</strong>
        <span className="admin-badges">{u.id === selfId && <em>tu</em>}{u.isAdmin && <em className="admin">amministratore</em>}{u.suspended && <em className="off">sospeso</em>}{!u.confirmed && <em>email da confermare</em>}</span>
        <small>Registrato {day(u.created)} · ultimo accesso {day(u.lastSignIn)} · ultima scrittura {u.lastActivity ? day(Date.parse(u.lastActivity + 'T12:00:00')) : '—'}</small>
        <small>{u.documents} documenti · {u.words.toLocaleString('it-IT')} parole · {formatDuration(u.workSeconds)} di scrittura · {u.aiProfiles} profili AI</small></div>
      <div className="admin-actions">
        {u.id !== selfId && <button type="button" disabled={busy === u.id} onClick={() => void act(u.id, u.suspended ? `${u.email} riattivato.` : `${u.email} sospeso e disconnesso.`, () => admin.setSuspended(u.id, !u.suspended))}>{u.suspended ? 'Riattiva' : 'Sospendi'}</button>}
        <button type="button" disabled={busy === u.id} onClick={() => void act(u.id, u.isAdmin ? `${u.email} non è più amministratore.` : `${u.email} è ora amministratore.`, () => admin.setAdmin(u.id, !u.isAdmin))}>{u.isAdmin ? 'Togli admin' : 'Rendi admin'}</button>
        <button type="button" disabled={busy === u.id} onClick={() => void act(u.id, `Email di recupero password inviata a ${u.email}.`, () => admin.sendPasswordReset(u.email))}>Reimposta password</button>
        {u.id !== selfId && <button type="button" className="danger" disabled={busy === u.id} onClick={() => remove(u)}>Elimina</button>}
      </div></div>)}
      {users && !shown.length && <p className="empty-state">Nessun account trovato.</p>}</div>
  </>;
}
