-- Scrivia · schema cloud per Supabase.
--
-- Come applicarlo: Supabase Dashboard → SQL Editor → New query → incolla tutto il file → Run.
-- È idempotente: si può rieseguire dopo un aggiornamento di Scrivia senza perdere dati.
--
-- Tutte le tabelle hanno Row Level Security: ogni utente vede e modifica soltanto le proprie righe.
-- Le chiavi API dei provider AI non stanno in chiaro nelle tabelle: sono cifrate da Supabase Vault
-- e si leggono solo tramite le funzioni set_api_key / get_api_key, riservate al proprietario.

-- ---------------------------------------------------------------------------------------------
-- Documenti, con le informazioni di lavoro (creazione, tempo di scrittura, conteggi)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 150),
  content        jsonb not null check (content ->> 'type' = 'doc'),
  project        jsonb,                                   -- progetto creativo (brief, voce, memoria)
  version        integer not null default 1,              -- controllo di concorrenza fra dispositivi
  word_count     integer not null default 0 check (word_count >= 0),
  char_count     integer not null default 0 check (char_count >= 0),
  work_seconds   bigint  not null default 0 check (work_seconds >= 0),  -- tempo attivo di scrittura
  edit_count     integer not null default 0,              -- numero di salvataggi con modifiche
  open_count     integer not null default 0,              -- quante volte è stato aperto
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_opened_at timestamptz
);
create index if not exists documents_user_updated_idx on public.documents (user_id, updated_at desc);

-- Versioni precedenti (come nel salvataggio locale: al massimo una al minuto, le ultime 30).
create table if not exists public.document_revisions (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  content     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists document_revisions_doc_idx on public.document_revisions (document_id, created_at desc);

-- Attività di scrittura per giorno: alimenta le statistiche.
create table if not exists public.writing_activity (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  day         date not null,
  seconds     integer not null default 0 check (seconds >= 0),
  words_added integer not null default 0 check (words_added >= 0),
  primary key (document_id, day)
);
create index if not exists writing_activity_user_day_idx on public.writing_activity (user_id, day);

-- ---------------------------------------------------------------------------------------------
-- Impostazioni e preferenze dell'utente (tema, regole di scrittura, memoria, layout, ...)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key        text not null check (char_length(key) between 1 and 200),
  value      text not null check (char_length(value) <= 3000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------------------------
-- Profili dei provider AI. La chiave vera sta in Supabase Vault, qui solo gli ultimi 4 caratteri.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.api_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  provider      text not null check (char_length(provider) between 1 and 40),
  model         text not null check (char_length(btrim(model)) between 1 and 150),
  daily_limit   integer not null default 500 check (daily_limit between 1 and 10000),
  key_hint      text not null default '',
  key_secret_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists api_profiles_user_idx on public.api_profiles (user_id);

-- Altri segreti dell'utente (ad esempio la chiave ElevenLabs per la lettura ad alta voce).
create table if not exists public.user_secrets (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (name ~ '^[a-z0-9_-]{1,40}$'),
  key_secret_id uuid not null,
  primary key (user_id, name)
);

-- Amministratori: gestiscono gli account (vedi le funzioni admin_* più sotto). Nessun accesso diretto alla
-- tabella: si assegna dal SQL Editor, vedi in fondo al file.
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------------------------
create or replace function public.documents_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.content is distinct from old.content or new.title is distinct from old.title then
    new.updated_at := now();
    new.edit_count := old.edit_count + 1;
    if not exists (select 1 from public.document_revisions r
                   where r.document_id = old.id and r.created_at > now() - interval '60 seconds') then
      insert into public.document_revisions (document_id, user_id, title, content, created_at)
        values (old.id, old.user_id, old.title, old.content, old.updated_at);
      delete from public.document_revisions r
        where r.document_id = old.id
          and r.id not in (select x.id from public.document_revisions x
                           where x.document_id = old.id order by x.created_at desc limit 30);
    end if;
  else
    new.updated_at := old.updated_at;
    new.edit_count := old.edit_count;
  end if;
  return new;
end $$;
drop trigger if exists documents_before_update on public.documents;
create trigger documents_before_update before update on public.documents
  for each row execute function public.documents_before_update();

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists api_profiles_touch on public.api_profiles;
create trigger api_profiles_touch before update on public.api_profiles
  for each row execute function public.touch_updated_at();

-- Eliminando un profilo si elimina anche il segreto cifrato.
create or replace function public.api_profiles_after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.key_secret_id is not null then delete from vault.secrets where id = old.key_secret_id; end if;
  return old;
end $$;
drop trigger if exists api_profiles_after_delete on public.api_profiles;
create trigger api_profiles_after_delete after delete on public.api_profiles
  for each row execute function public.api_profiles_after_delete();

-- Eliminando un account (o un segreto) si elimina anche il valore cifrato in Vault.
create or replace function public.user_secrets_after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.key_secret_id;
  return old;
end $$;
drop trigger if exists user_secrets_after_delete on public.user_secrets;
create trigger user_secrets_after_delete after delete on public.user_secrets
  for each row execute function public.user_secrets_after_delete();

-- ---------------------------------------------------------------------------------------------
-- Funzioni richiamabili dall'app
-- ---------------------------------------------------------------------------------------------
-- Salva la chiave API di un profilo (cifrata in Vault).
create or replace function public.set_api_key(p_profile uuid, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_secret uuid;
begin
  if v_user is null then raise exception 'Accesso richiesto.'; end if;
  if p_key is null or char_length(p_key) not between 1 and 4096 then raise exception 'Chiave API non valida.'; end if;
  select key_secret_id into v_secret from public.api_profiles where id = p_profile and user_id = v_user for update;
  if not found then raise exception 'Profilo non trovato.'; end if;
  if v_secret is null then
    v_secret := vault.create_secret(p_key, 'scrivia-api-key-' || p_profile::text, 'Chiave API Scrivia');
  else
    perform vault.update_secret(v_secret, p_key);
  end if;
  update public.api_profiles set key_secret_id = v_secret, key_hint = right(p_key, 4) where id = p_profile;
end $$;

-- Restituisce la chiave API del profilo al suo proprietario.
create or replace function public.get_api_key(p_profile uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto.'; end if;
  select s.decrypted_secret into v_key
    from public.api_profiles p join vault.decrypted_secrets s on s.id = p.key_secret_id
    where p.id = p_profile and p.user_id = auth.uid();
  return v_key;
end $$;

-- Segreti generici (cifrati in Vault): salva, leggi, elimina.
create or replace function public.set_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_secret uuid;
begin
  if v_user is null then raise exception 'Accesso richiesto.'; end if;
  if p_name is null or p_name !~ '^[a-z0-9_-]{1,40}$' then raise exception 'Nome non valido.'; end if;
  if p_value is null or char_length(p_value) not between 1 and 4096 then raise exception 'Valore non valido.'; end if;
  select key_secret_id into v_secret from public.user_secrets where user_id = v_user and name = p_name for update;
  if found then
    perform vault.update_secret(v_secret, p_value);
  else
    v_secret := vault.create_secret(p_value, 'scrivia-secret-' || v_user::text || '-' || p_name, 'Segreto Scrivia');
    insert into public.user_secrets (user_id, name, key_secret_id) values (v_user, p_name, v_secret);
  end if;
end $$;

create or replace function public.get_secret(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_value text;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto.'; end if;
  select s.decrypted_secret into v_value
    from public.user_secrets u join vault.decrypted_secrets s on s.id = u.key_secret_id
    where u.user_id = auth.uid() and u.name = p_name;
  return v_value;
end $$;

create or replace function public.delete_secret(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret uuid;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto.'; end if;
  delete from public.user_secrets where user_id = auth.uid() and name = p_name returning key_secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
end $$;

-- Registra tempo di scrittura e parole aggiunte, sul documento e sul giorno indicato.
create or replace function public.log_activity(p_document uuid, p_seconds integer, p_words integer, p_day date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_seconds integer := least(greatest(coalesce(p_seconds, 0), 0), 3600);
        v_words integer := least(greatest(coalesce(p_words, 0), 0), 200000);
begin
  if v_user is null then raise exception 'Accesso richiesto.'; end if;
  if p_day is null or abs(p_day - (now() at time zone 'utc')::date) > 2 then raise exception 'Giorno non valido.'; end if;
  update public.documents set work_seconds = work_seconds + v_seconds where id = p_document and user_id = v_user;
  if not found then raise exception 'Documento non trovato.'; end if;
  insert into public.writing_activity (user_id, document_id, day, seconds, words_added)
    values (v_user, p_document, p_day, v_seconds, v_words)
    on conflict (document_id, day) do update
      set seconds = public.writing_activity.seconds + excluded.seconds,
          words_added = public.writing_activity.words_added + excluded.words_added;
end $$;

-- Segna un documento come aperto.
create or replace function public.mark_opened(p_document uuid) returns void
language sql security definer set search_path = '' as $$
  update public.documents set open_count = open_count + 1, last_opened_at = now()
   where id = p_document and user_id = auth.uid();
$$;

-- Statistiche complessive dell'utente.
create or replace function public.user_stats(p_days integer default 120) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'documents',   (select count(*) from public.documents where user_id = auth.uid()),
    'words',       (select coalesce(sum(word_count), 0) from public.documents where user_id = auth.uid()),
    'characters',  (select coalesce(sum(char_count), 0) from public.documents where user_id = auth.uid()),
    'workSeconds', (select coalesce(sum(work_seconds), 0) from public.documents where user_id = auth.uid()),
    'firstDocumentAt', (select min(created_at) from public.documents where user_id = auth.uid()),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'seconds', d.seconds, 'words', d.words) order by d.day)
      from (select a.day, sum(a.seconds)::bigint as seconds, sum(a.words_added)::bigint as words
              from public.writing_activity a
             where a.user_id = auth.uid() and a.day >= (now() at time zone 'utc')::date - least(greatest(p_days, 1), 730)
             group by a.day) d), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------
-- Amministrazione degli account. Gli amministratori vedono email, date e numeri d'uso degli utenti e
-- possono sospenderli, promuoverli o eliminarli; non vedono mai testi dei documenti né chiavi API.
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

create or replace function public.admin_require() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.app_admins where user_id = auth.uid()) then
    raise exception 'Operazione riservata agli amministratori.';
  end if;
end $$;

create or replace function public.admin_list_users()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, confirmed boolean,
               suspended boolean, is_admin boolean, documents bigint, words bigint, work_seconds bigint,
               last_activity date, ai_profiles bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require();
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null,
           coalesce(u.banned_until > now(), false),
           exists (select 1 from public.app_admins a where a.user_id = u.id),
           (select count(*) from public.documents d where d.user_id = u.id),
           (select coalesce(sum(d.word_count), 0)::bigint from public.documents d where d.user_id = u.id),
           (select coalesce(sum(d.work_seconds), 0)::bigint from public.documents d where d.user_id = u.id),
           (select max(w.day) from public.writing_activity w where w.user_id = u.id),
           (select count(*) from public.api_profiles p where p.user_id = u.id)
      from auth.users u order by u.created_at desc limit 1000;
end $$;

-- Sospende o riattiva un account: chi è sospeso non può più accedere e le sue sessioni vengono chiuse.
create or replace function public.admin_set_suspended(p_user uuid, p_suspended boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require();
  if p_user = auth.uid() then raise exception 'Non puoi sospendere il tuo stesso account.'; end if;
  update auth.users set banned_until = case when p_suspended then now() + interval '100 years' else null end where id = p_user;
  if not found then raise exception 'Utente non trovato.'; end if;
  if p_suspended then delete from auth.sessions where user_id = p_user; end if;
end $$;

create or replace function public.admin_set_admin(p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require();
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'Utente non trovato.'; end if;
  if p_admin then
    insert into public.app_admins (user_id) values (p_user) on conflict do nothing;
  else
    if (select count(*) from public.app_admins) <= 1 then raise exception 'Deve restare almeno un amministratore.'; end if;
    delete from public.app_admins where user_id = p_user;
  end if;
end $$;

-- Elimina l'account con tutti i suoi dati (documenti, profili, segreti cifrati).
create or replace function public.admin_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require();
  if p_user = auth.uid() then raise exception 'Non puoi eliminare il tuo stesso account.'; end if;
  delete from auth.users where id = p_user;
  if not found then raise exception 'Utente non trovato.'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Permessi: ogni utente accede solo ai propri dati.
-- ---------------------------------------------------------------------------------------------
alter table public.documents          enable row level security;
alter table public.document_revisions enable row level security;
alter table public.writing_activity   enable row level security;
alter table public.user_settings      enable row level security;
alter table public.api_profiles       enable row level security;
alter table public.user_secrets       enable row level security;
alter table public.app_admins         enable row level security;

drop policy if exists documents_owner on public.documents;
create policy documents_owner on public.documents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists revisions_owner on public.document_revisions;
create policy revisions_owner on public.document_revisions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.documents d where d.id = document_id and d.user_id = (select auth.uid())));

-- Il tempo di lavoro si scrive solo con log_activity: qui basta la lettura.
drop policy if exists activity_owner_read on public.writing_activity;
create policy activity_owner_read on public.writing_activity for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists settings_owner on public.user_settings;
create policy settings_owner on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists profiles_owner on public.api_profiles;
create policy profiles_owner on public.api_profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- user_secrets: nessun accesso diretto, solo le funzioni set_secret / get_secret / delete_secret.
revoke all on public.documents, public.document_revisions, public.writing_activity,
              public.user_settings, public.api_profiles, public.user_secrets, public.app_admins from anon, authenticated;
grant select, insert, update, delete on public.document_revisions, public.user_settings to authenticated;
grant select, delete on public.documents, public.api_profiles to authenticated;
grant select on public.writing_activity to authenticated;
-- Tempo di lavoro, aperture e date di modifica cambiano solo tramite le funzioni qui sotto e i trigger.
grant insert (id, title, content, project, word_count, char_count, work_seconds, created_at, updated_at)
  on public.documents to authenticated;
grant update (title, content, project, version, word_count, char_count) on public.documents to authenticated;
-- key_secret_id non deve uscire dal database: l'app legge solo le colonne pubbliche.
revoke select on public.api_profiles from authenticated;
grant select (id, user_id, name, provider, model, daily_limit, key_hint, created_at, updated_at)
  on public.api_profiles to authenticated;
grant insert (name, provider, model, daily_limit) on public.api_profiles to authenticated;
grant update (name, provider, model, daily_limit) on public.api_profiles to authenticated;

revoke all on function public.admin_require(), public.is_admin(), public.admin_list_users(),
  public.admin_set_suspended(uuid, boolean), public.admin_set_admin(uuid, boolean), public.admin_delete_user(uuid) from public, anon;
grant execute on function public.is_admin(), public.admin_list_users(), public.admin_set_suspended(uuid, boolean),
  public.admin_set_admin(uuid, boolean), public.admin_delete_user(uuid) to authenticated;

revoke all on function public.set_api_key(uuid, text), public.get_api_key(uuid),
  public.set_secret(text, text), public.get_secret(text), public.delete_secret(text),
  public.log_activity(uuid, integer, integer, date), public.mark_opened(uuid),
  public.user_stats(integer) from public, anon;
grant execute on function public.set_api_key(uuid, text), public.get_api_key(uuid),
  public.set_secret(text, text), public.get_secret(text), public.delete_secret(text),
  public.log_activity(uuid, integer, integer, date), public.mark_opened(uuid),
  public.user_stats(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Primo amministratore: dopo esserti registrato nell'app, esegui questa riga nel SQL Editor
-- con la tua email (togli i due trattini iniziali). Gli altri si promuovono poi dall'app.
-- ---------------------------------------------------------------------------------------------
-- insert into public.app_admins (user_id) select id from auth.users where email = 'tua@email.it' on conflict do nothing;
