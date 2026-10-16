import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import '../lib/local-backend';

// Static build for GitHub Pages: no server, everything stays in the browser.
window.__SCRIVIA_LOCAL__ = true;
const { default: Workspace } = await import('../app/workspace');
createRoot(document.getElementById('root')!).render(<StrictMode><Workspace /></StrictMode>);
