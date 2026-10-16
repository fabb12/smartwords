import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import '../lib/local-backend';
import { setupPwa } from '../lib/pwa';

// Static build for GitHub Pages: no server, everything stays in the browser.
window.__SCRIVIA_LOCAL__ = true;
setupPwa('./sw.js', import.meta.env.PROD);
const { default: Workspace } = await import('../app/workspace');
createRoot(document.getElementById('root')!).render(<StrictMode><Workspace /></StrictMode>);
