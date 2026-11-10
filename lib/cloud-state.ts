// The signed-in cloud account of this browser session, if any. The static build (site/main.tsx) sets it
// after Supabase sign-in; the workspace and the local backend only read it, so they never import Supabase.

// Request bodies mirror the JSON accepted by the /api routes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export type CloudAccount = {
  userId: string;
  email: string;
  // Same routes as localApi (documents, revisions, profiles, projects, activity, opened, stats), on Supabase.
  api(route: string, params: URLSearchParams, body: Body, method: string): Promise<Body>;
  // Provider, model, daily limit and API key of a profile (decrypted on demand, kept in memory only).
  resolveProfile(profileId: string): Promise<{ provider: string; model: string; limit: number; key: string } | null>;
  // Account tab actions.
  signOut(): Promise<void>;
  syncNow(): Promise<void>;
  localData(): { documents: number; profiles: number };
  importLocalData(): Promise<{ documents: number; profiles: number }>;
};

let active: CloudAccount | null = null;
export const activeCloud = (): CloudAccount | null => active;
export const setActiveCloud = (account: CloudAccount | null) => { active = account; };

// Set at build time (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). Kept here so that a build without a cloud
// project never loads the Supabase client.
export const CLOUD_URL = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
export const CLOUD_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined;
export const cloudConfigured = () => !!(CLOUD_URL && CLOUD_KEY);
