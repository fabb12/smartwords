// Progressive Web App: registers the service worker (production only) and exposes the
// browser's install prompt, so the app can be installed and opened offline.
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
  const register = () => navigator.serviceWorker.register(swUrl).catch(() => {});
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
