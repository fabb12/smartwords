// Cloud account (Supabase) for the static build: sign-in, per-user settings sync, documents, AI profiles
// and their API keys. The project URL and the public "anon" key are set at build time
// (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY); they are meant to be public: access is protected by
// the Row Level Security rules in supabase/schema.sql.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createSettingsSync, clearSyncedSettings, type SettingsSync, type SyncBackend } from './cloud-sync.ts';
import { cloudError, createCloudApi } from './cloud-store.ts';
import { importLocalData, planImport } from './cloud-import.ts';
import { CLOUD_KEY as KEY_, CLOUD_URL as URL_, setActiveCloud, type AdminApi, type AdminUser, type CloudAccount } from './cloud-state.ts';
import { usageToday } from './local-backend.ts';
import { desktop } from './desktop.ts';


let client: SupabaseClient | undefined;
export function cloudClient(): SupabaseClient {
  if (!URL_ || !KEY_) throw new Error('Il cloud non è configurato.');
  return client ??= createClient(URL_, KEY_, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'scrivia-auth' } });
}

const fail = (e: { message?: string; status?: number; code?: string } | null): never => { throw authError(e); };
// Supabase auth messages are English: show clear Italian ones for the cases people actually meet.
export function authError(e: { message?: string; status?: number; code?: string } | null): Error {
  const m = e?.message || '', code = e?.code || '';
  if (code === 'invalid_credentials' || /Invalid login credentials/i.test(m)) return new Error('Email o password non corrette.');
  if (code === 'email_not_confirmed' || /Email not confirmed/i.test(m)) return new Error('Conferma prima l’email: controlla la posta e apri il link che ti abbiamo inviato.');
  if (code === 'user_already_exists' || /already registered/i.test(m)) return new Error('Esiste già un account con questa email: accedi oppure recupera la password.');
  if (code === 'weak_password' || /Password should be/i.test(m)) return new Error('Password troppo debole: usa almeno 8 caratteri, meglio con lettere e numeri.');
  if (code === 'user_banned' || /banned/i.test(m)) return new Error('Questo account è stato sospeso. Contatta l’amministratore.');
  if (code === 'over_email_send_rate_limit' || e?.status === 429 || /rate limit/i.test(m)) return new Error('Troppi tentativi: attendi qualche minuto e riprova.');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return new Error('Connessione non riuscita: controlla la rete e riprova.');
  return new Error(m || 'Accesso non riuscito. Riprova.');
}

export async function currentSession(): Promise<Session | null> {
  const { data, error } = await cloudClient().auth.getSession();
  if (error) throw authError(error);
  return data.session;
}
export function onAuthChange(callback: (event: string, session: Session | null) => void): () => void {
  const { data } = cloudClient().auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}
export async function signIn(email: string, password: string) {
  const { error } = await cloudClient().auth.signInWithPassword({ email: email.trim(), password }); if (error) fail(error);
}
// Returns true when the account is ready, false when the email must be confirmed first.
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await cloudClient().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) fail(error);
  // With "Confirm email" on, an address that is already registered comes back as a user without identities.
  if (data.user && data.user.identities?.length === 0) throw authError({ code: 'user_already_exists' });
  return !!data.session;
}
export async function sendPasswordReset(email: string) {
  const { error } = await cloudClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname }); if (error) fail(error);
}
export async function setNewPassword(password: string) { const { error } = await cloudClient().auth.updateUser({ password }); if (error) fail(error); }

const reveal = (data: string) => desktop()?.reveal(data) || '';

const when = (v: unknown) => typeof v === 'string' ? Date.parse(v) : null;
function adminApi(c: SupabaseClient): AdminApi {
  const run = async (fn: string, args: Record<string, unknown>) => { const r = await c.rpc(fn, args); if (r.error) throw cloudError(r.error); };
  return {
    async users() {
      const r = await c.rpc('admin_list_users'); if (r.error) throw cloudError(r.error);
      return ((r.data || []) as Record<string, unknown>[]).map((u): AdminUser => ({ id: String(u.id), email: String(u.email || ''), created: when(u.created_at), lastSignIn: when(u.last_sign_in_at),
        confirmed: u.confirmed === true, suspended: u.suspended === true, isAdmin: u.is_admin === true, documents: Number(u.documents) || 0, words: Number(u.words) || 0,
        workSeconds: Number(u.work_seconds) || 0, lastActivity: typeof u.last_activity === 'string' ? u.last_activity : null, aiProfiles: Number(u.ai_profiles) || 0 }));
    },
    setSuspended: (id, suspended) => run('admin_set_suspended', { p_user: id, p_suspended: suspended }),
    setAdmin: (id, admin) => run('admin_set_admin', { p_user: id, p_admin: admin }),
    remove: id => run('admin_delete_user', { p_user: id }),
    async sendPasswordReset(email) { const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw authError(error); },
  };
}

let running: SettingsSync | undefined;

// Starts the cloud session of a signed-in user: applies the cloud settings to this device, then keeps them in sync.
export async function startCloud(session: Session): Promise<CloudAccount> {
  const c = cloudClient(), userId = session.user.id, email = session.user.email || '';
  const store = createCloudApi(c, usageToday);
  const backend: SyncBackend = {
    async list() { const r = await c.from('user_settings').select('key,value'); if (r.error) throw cloudError(r.error); return (r.data || []) as { key: string; value: string }[]; },
    async put(rows) { const r = await c.from('user_settings').upsert(rows.map(x => ({ ...x, updated_at: new Date().toISOString() })), { onConflict: 'user_id,key' }); if (r.error) throw cloudError(r.error); },
    async remove(keys) { const r = await c.from('user_settings').delete().in('key', keys); if (r.error) throw cloudError(r.error); },
    async getSecret(name) { const r = await c.rpc('get_secret', { p_name: name }); if (r.error) throw cloudError(r.error); return (r.data as string | null) || null; },
    async setSecret(name, value) { const r = await c.rpc('set_secret', { p_name: name, p_value: value }); if (r.error) throw cloudError(r.error); },
    async deleteSecret(name) { const r = await c.rpc('delete_secret', { p_name: name }); if (r.error) throw cloudError(r.error); },
  };
  let lastSyncError = '';
  const sync = createSettingsSync({ owner: userId, storage: localStorage, backend, onError: e => { lastSyncError = e.message; console.warn('Sincronizzazione impostazioni:', e.message); } });
  running?.stop(); running = sync;
  await sync.pull();
  if (lastSyncError) throw new Error(lastSyncError);

  // Administrators get the account management tools; for everyone else (or before the schema update) there are none.
  const flag = await c.rpc('is_admin');
  const admin: AdminApi | null = flag.data === true ? adminApi(c) : null;

  const account: CloudAccount = {
    userId, email, admin,
    api: store.api,
    resolveProfile: store.resolveProfile,
    async signOut() {
      sync.stop();
      await sync.push();                                   // nothing typed in the last seconds is lost
      clearSyncedSettings(localStorage, userId);           // a shared computer keeps nothing of this account
      store.forget();
      setActiveCloud(null);
      const { error } = await c.auth.signOut(); if (error) throw authError(error);
    },
    async syncNow() { await sync.push(); await sync.pull(); },
    localData() { const plan = planImport(localStorage, userId); return { documents: plan.documents.length, profiles: plan.profiles.length }; },
    async importLocalData() {
      const result = await importLocalData(c, localStorage, userId, reveal);
      await sync.push();
      return { documents: result.documents, profiles: result.profiles };
    },
  };
  setActiveCloud(account);
  return account;
}

// The session ended (sign-out elsewhere or an expired refresh): forget everything held in memory.
export function stopCloud(userId?: string) {
  running?.stop(); running = undefined;
  setActiveCloud(null);
  if (userId) clearSyncedSettings(localStorage, userId);
}
