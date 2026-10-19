'use client';
import { useEffect, useState } from 'react';
import { desktop } from '../lib/desktop';
import { ollamaBrowserCommand, type LocalPlatform } from '../lib/local-setup';
import type { DeviceProvider } from '../lib/device-models';

export function LocalConnection({ provider }: { provider: DeviceProvider }) {
  const [native, setNative] = useState(false), [origin, setOrigin] = useState(''), [platform, setPlatform] = useState<LocalPlatform>('windows'), [copied, setCopied] = useState(false);
  useEffect(() => {
    setNative(!!desktop()?.localRequest); setOrigin(location.origin);
    const system = desktop()?.platform || navigator.platform;
    setPlatform(/mac|darwin/i.test(system) ? 'mac' : /linux/i.test(system) ? 'linux' : 'windows');
  }, []);
  const command = ollamaBrowserCommand(origin, platform);
  return <details className="local-connection"><summary>Come collegare il server</summary>
    {native ? <p>Il collegamento passa direttamente dall’app desktop: non serve abilitare CORS. {provider === 'ollama' ? 'Apri Ollama.' : 'Apri LM Studio → Developer e premi Start Server. Abilita Just-In-Time per caricare automaticamente il modello selezionato, oppure caricalo prima di usarlo.'} Poi premi «Verifica connessione».</p> : <>
      <p><strong>Soluzione più semplice: l’app desktop.</strong> Usa la versione aggiornata di Scrivia sul computer dove sono installati i modelli: il collegamento nativo evita i blocchi CORS del browser. <a href="https://github.com/fabb12/smartwords/releases/latest" target="_blank" rel="noreferrer">Scarica Scrivia desktop</a>.</p>
      {provider === 'lmstudio' ? <ol><li>Apri LM Studio → Developer e avvia il server con <strong>Start Server</strong>.</li><li>Nelle impostazioni del server abilita <strong>Enable CORS</strong>. Abilita <strong>Just-In-Time</strong> per caricare i modelli scaricati quando li scegli, oppure carica il modello manualmente.</li><li>Se il server richiede autenticazione, inserisci il token qui in Scrivia.</li></ol> : <>
        <p>Per usare Ollama dal browser, autorizza questa origine: <code>{origin}</code>.</p>
        <label>Sistema operativo<select value={platform} onChange={e => { setPlatform(e.target.value as LocalPlatform); setCopied(false); }}><option value="windows">Windows (PowerShell)</option><option value="mac">macOS (Terminale)</option><option value="linux">Linux (Terminale)</option></select></label>
        <ol><li>Chiudi Ollama prima di cambiare la configurazione, anche dalla barra di sistema. {platform === 'linux' && <>Se è un servizio, fermalo con <code>sudo systemctl stop ollama</code>.</>}</li><li>Esegui il comando qui sotto. {platform === 'mac' ? 'Poi riapri Ollama: userà la nuova origine.' : 'Lascia aperto il terminale mentre usi Scrivia; questa impostazione vale per il server avviato dal comando.'}</li></ol>
        {!!command && <><pre>{command}</pre><button type="button" className="quiet" onClick={() => { void navigator.clipboard.writeText(command).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? 'Comando copiato' : 'Copia comando'}</button></>}
      </>}
      <p>Consenti l’accesso alla rete locale se il browser lo chiede; se l’hai negato, riattivalo nelle autorizzazioni del sito. Poi premi «Verifica connessione» e scegli il modello dall’elenco.</p>
      <p>Il server deve essere sullo stesso dispositivo di Scrivia: dal telefono, <code>127.0.0.1</code> indica il telefono, non il computer.</p>
    </>}
  </details>;
}
