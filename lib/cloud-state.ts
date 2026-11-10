// The signed-in cloud account of this browser session, if any. The static build (site/main.tsx) sets it
// after Supabase sign-in; the workspace and the local backend only read it, so they never import Supabase.

// Request bodies mirror the JSON accepted by the /api routes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

// An account as the administrator sees it: dates and usage numbers only, never texts or keys.
export type AdminUser = { id: string; email: string; created: number | null; lastSignIn: number | null; confirmed: boolean; suspended: boolean; isAdmin: boolean;
  documents: number; words: number; workSeconds: number; lastActivity: string | null; aiProfiles: number };
export type AdminApi = {
  users(): Promise<AdminUser[]>;
  setSuspended(userId: string, suspended: boolean): Promise<void>;
  setAdmin(userId: string, admin: boolean): Promise<void>;
  remove(userId: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
};

export type CloudAccount = {
  admin: AdminApi | null; // only for administrators
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
