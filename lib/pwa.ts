// Progressive Web App: registers the service worker (production only) and exposes the
// browser's install prompt, so the app can be installed and opened offline.
import { BUILD_ID } from './version';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
declare global { interface Window { __scriviaInstall?: Event } }
let deferred: InstallPrompt | null = null, started = false;
const listeners = new Set<(available: boolean) => void>();
const notify = () => { for (const l of listeners) l(!!deferred); };

export function setupPwa(swUrl: string, enabled: boolean) {
  if (typeof window === 'undefined' || started) return; started = true;
  // The page head stores a prompt fired before this code loaded.
  if (window.__scriviaInstall) { deferred = window.__scriviaInstall as InstallPrompt; delete window.__scriviaInstall; }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as InstallPrompt; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
  if (!enabled || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  // updateViaCache 'none': the browser always asks the server for a new sw.js.
  const register = () => navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' }).catch(() => {});
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
}

export function onInstallAvailable(listener: (available: boolean) => void): () => void {
  listeners.add(listener); listener(!!deferred);
  return () => { listeners.delete(listener); };
}

export async function promptInstall(): Promise<boolean> {
  const e = deferred; if (!e) return false;
  deferred = null; notify();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

// Compares the running build with the published version.json: when a newer version is
// online, onUpdate is called (at start, every 5 minutes and whenever the tab comes back).
export function watchForUpdates(url: string, onUpdate: (label: string) => void): () => void {
  if (typeof window === 'undefined' || BUILD_ID === '@') return () => {};
  let stopped = false;
  const check = async () => {
    if (stopped || !navigator.onLine) return;
    try {
      const res = await fetch(url, { cache: 'no-store' }); if (!res.ok) return;
      const v = await res.json() as { id?: string; commit?: string };
      if (!stopped && v.id && v.id !== BUILD_ID) onUpdate((v.commit || '').slice(0, 7));
    } catch { /* offline or not published: try again later */ }
  };
  const visible = () => { if (document.visibilityState === 'visible') void check(); };
  void check(); const timer = setInterval(() => void check(), 5 * 60_000);
  document.addEventListener('visibilitychange', visible); window.addEventListener('online', visible);
  return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible); };
}

// Loads the new version: refreshes the service worker, then reloads the page from the network.
export async function applyUpdate() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch { /* reload anyway */ }
  location.reload();
}
