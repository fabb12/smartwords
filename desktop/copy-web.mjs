// Copies the GitHub Pages build (../out-pages) into ./web, the files packaged in the app.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../out-pages', import.meta.url)), to = fileURLToPath(new URL('./web', import.meta.url));
if (!existsSync(from + '/index.html')) { console.error('Manca la build web: esegui prima «npm run build:pages» nella cartella principale.'); process.exit(1); }
rmSync(to, { recursive: true, force: true });
// The service worker is for the browser only: the desktop app already has every file.
cpSync(from, to, { recursive: true, filter: f => !f.endsWith('sw.js') });
