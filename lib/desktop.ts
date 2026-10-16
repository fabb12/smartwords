// Desktop app (Electron, folder desktop/): detects it and finds the installer for this computer
// among the files of the latest GitHub release.
export const DESKTOP_REPO = 'fabb12/smartwords';
type Desktop = { platform: string; version: string; protect: (text: string) => string | null; reveal: (data: string) => string | null };
declare global { interface Window { scriviaDesktop?: Desktop } }

export const desktop = (): Desktop | undefined => typeof window === 'undefined' ? undefined : window.scriviaDesktop;

type System = 'Windows' | 'macOS' | 'Linux';
const INSTALLERS: Record<System, RegExp> = { Windows: /\.exe$/i, macOS: /\.dmg$/i, Linux: /\.AppImage$/i };
// Phones, tablets and Chromebooks install the web app (PWA) instead.
function system(): System | null {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|CrOS/i.test(ua)) return null;
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return navigator.maxTouchPoints > 1 ? null : 'macOS';
  return /Linux/i.test(ua) ? 'Linux' : null;
}

export type Installer = { url: string; system: System; version: string; size: number };
export async function findInstaller(signal?: AbortSignal): Promise<Installer | null> {
  const os = system(); if (!os || desktop()) return null;
  const res = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, signal });
  if (!res.ok) return null;
  const release = await res.json() as { tag_name?: string; assets?: { name: string; browser_download_url: string; size: number }[] };
  const asset = release.assets?.find(a => INSTALLERS[os].test(a.name));
  return asset ? { url: asset.browser_download_url, system: os, version: (release.tag_name || '').replace(/^v/, ''), size: asset.size } : null;
}
