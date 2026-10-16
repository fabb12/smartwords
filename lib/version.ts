// The version of the running app: package version, commit and build time, set by the
// GitHub Pages build (vite.pages.config.ts). Other builds show "sviluppo".
declare const __SCRIVIA_BUILD__: { version: string; commit: string; time: string } | undefined;
export const BUILD = typeof __SCRIVIA_BUILD__ !== 'undefined' ? __SCRIVIA_BUILD__ : { version: '', commit: '', time: '' };
export const BUILD_ID = BUILD.commit + '@' + BUILD.time;

export function buildLabel(): string {
  if (!BUILD.commit) return 'Versione di sviluppo';
  const when = BUILD.time ? new Date(BUILD.time).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return `v${BUILD.version} · ${BUILD.commit.slice(0, 7)}${when ? ' · ' + when : ''}`;
}
