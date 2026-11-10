import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import '../lib/local-backend';
import { setupPwa } from '../lib/pwa';
import { cloudConfigured } from '../lib/cloud-state';

// Static build for GitHub Pages: no server of our own. With a Supabase project configured (VITE_SUPABASE_URL
// and VITE_SUPABASE_ANON_KEY) the user signs in and everything is stored in the account; without it the
// app keeps working as before, with everything in this browser.
window.__SCRIVIA_LOCAL__ = true;
// The desktop app (Electron) already ships every file: no service worker there.
setupPwa('./sw.js', import.meta.env.PROD && !window.scriviaDesktop);
const { default: Workspace } = await import('../app/workspace');
const root = createRoot(document.getElementById('root')!);
if (cloudConfigured()) {
  const { AuthGate } = await import('./auth');
  root.render(<StrictMode><AuthGate>{account => <Workspace key={account.userId} owner={account.userId} />}</AuthGate></StrictMode>);
} else root.render(<StrictMode><Workspace /></StrictMode>);
