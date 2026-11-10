import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpenText, Loader2, ShieldCheck } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { currentSession, onAuthChange, sendPasswordReset, setNewPassword, signIn, signUp, startCloud, stopCloud } from '../lib/cloud';
import type { CloudAccount } from '../lib/cloud-state';

type Mode = 'signin' | 'signup' | 'reset';
type Phase = 'loading' | 'out' | 'recovery' | 'starting' | 'in' | 'failed';

const TITLES: Record<Mode, string> = { signin: 'Accedi a Scrivia', signup: 'Crea il tuo account', reset: 'Recupera la password' };

// Access control: nothing of the app is shown until the user has signed in. The account then provides the
// cloud storage for documents, settings, AI profiles and API keys.
export function AuthGate({ children }: { children: (account: CloudAccount) => ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading'), [account, setAccount] = useState<CloudAccount | null>(null), [problem, setProblem] = useState('');
  const started = useRef<string>(''), recovery = useRef(false);

  const begin = useCallback(async (session: Session) => {
    if (recovery.current || started.current === session.user.id) return;
    started.current = session.user.id; setPhase('starting'); setProblem('');
    try { setAccount(await startCloud(session)); setPhase('in'); }
    catch (error) { started.current = ''; stopCloud(); setProblem((error as Error).message); setPhase('failed'); }
  }, []);

  useEffect(() => {
    let live = true;
    currentSession().then(session => { if (!live) return; if (session) void begin(session); else setPhase(p => p === 'loading' ? 'out' : p); })
      .catch(error => { if (live) { setProblem((error as Error).message); setPhase('failed'); } });
    const off = onAuthChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { recovery.current = true; setPhase('recovery'); }
      else if (event === 'SIGNED_IN' && session) void begin(session);
      else if (event === 'SIGNED_OUT') { stopCloud(started.current); started.current = ''; setAccount(null); setPhase('out'); }
    });
    return () => { live = false; off(); };
  }, [begin]);

  if (phase === 'in' && account) return <>{children(account)}</>;
  return <main className="auth-screen"><section className="auth-card" aria-live="polite">
    <div className="auth-brand"><span className="brand-icon"><BookOpenText size={22} /></span><strong>Scrivia</strong></div>
    {(phase === 'loading' || phase === 'starting') && <p className="auth-wait"><Loader2 size={18} className="spin" /> {phase === 'loading' ? 'Controllo l’accesso…' : 'Sincronizzo il tuo spazio…'}</p>}
    {phase === 'out' && <SignInForm />}
    {phase === 'recovery' && <NewPassword onDone={async () => { recovery.current = false; const session = await currentSession(); if (session) await begin(session); else setPhase('out'); }} />}
    {phase === 'failed' && <>
      <h1>Non riesco ad aprire il tuo spazio</h1>
      <p className="warning" role="alert">{problem}</p>
      <div className="auth-actions"><button className="primary" onClick={() => { started.current = ''; setPhase('loading'); currentSession().then(s => s ? begin(s) : setPhase('out')).catch(e => { setProblem((e as Error).message); setPhase('failed'); }); }}>Riprova</button>
        <button className="quiet" onClick={() => { stopCloud(); void import('../lib/cloud').then(m => m.cloudClient().auth.signOut()).finally(() => { started.current = ''; setPhase('out'); }); }}>Esci</button></div>
    </>}
  </section></main>;
}

function SignInForm() {
  const [mode, setMode] = useState<Mode>('signin'), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [info, setInfo] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setInfo('');
    try {
      if (mode === 'signin') await signIn(email, password);
      else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Scegli una password di almeno 8 caratteri.');
        if (!await signUp(email, password)) { setInfo('Account creato. Ti abbiamo inviato un’email: apri il link per confermarlo, poi accedi.'); setMode('signin'); setPassword(''); }
      } else { await sendPasswordReset(email); setInfo('Se esiste un account con questa email, riceverai un link per scegliere una nuova password.'); setMode('signin'); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit}>
    <h1>{TITLES[mode]}</h1>
    <p className="auth-sub">{mode === 'reset' ? 'Inserisci l’email del tuo account.' : 'I tuoi documenti, le impostazioni, i profili AI e le chiavi API restano nel tuo account e ti seguono su ogni dispositivo.'}</p>
    <label>Email<input type="email" autoComplete="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} /></label>
    {mode !== 'reset' && <label>Password<input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} /></label>}
    {error && <p className="warning" role="alert">{error}</p>}{info && <p className="security-note" role="status"><ShieldCheck size={18} /><span>{info}</span></p>}
    <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? 'Attendi…' : mode === 'signin' ? 'Accedi' : mode === 'signup' ? 'Crea account' : 'Invia il link'}</button>
    <div className="auth-links">
      {mode !== 'signin' && <button type="button" className="quiet" onClick={() => { setMode('signin'); setError(''); }}>Ho già un account</button>}
      {mode === 'signin' && <button type="button" className="quiet" onClick={() => { setMode('signup'); setError(''); setInfo(''); }}>Crea un account</button>}
      {mode === 'signin' && <button type="button" className="quiet" onClick={() => { setMode('reset'); setError(''); setInfo(''); }}>Password dimenticata?</button>}
    </div>
  </form>;
}

function NewPassword({ onDone }: { onDone: () => Promise<void> }) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { if (password.length < 8) throw new Error('Scegli una password di almeno 8 caratteri.'); await setNewPassword(password); await onDone(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <form onSubmit={submit}>
    <h1>Scegli una nuova password</h1>
    <label>Nuova password<input type="password" autoComplete="new-password" required minLength={8} autoFocus value={password} onChange={e => setPassword(e.target.value)} /></label>
    {error && <p className="warning" role="alert">{error}</p>}
    <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? 'Attendi…' : 'Salva e continua'}</button>
  </form>;
}
