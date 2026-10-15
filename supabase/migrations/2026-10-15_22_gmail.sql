-- Email through each company's own Gmail (Messages).
--
-- The company's Google connection (google_oauth_tokens, server only) now
-- also grants gmail.send and gmail.readonly. Sent emails keep Gmail's thread
-- so replies stay in one conversation, and a sync copies emails exchanged
-- with clients into `messages`.

alter table messages add column if not exists provider_thread_id text;
-- A Gmail message is stored once per company, however many syncs see it.
create unique index if not exists messages_provider_unique on messages (company_id, provider_id) where provider_id is not null;

alter table google_oauth_tokens add column if not exists account_email text;
alter table google_oauth_tokens add column if not exists gmail_synced_at timestamptz;

-- What the app may know about the connection (never the token itself).
create or replace function get_google_connection(p_company_id text)
returns table (connected boolean, account_email text, gmail boolean)
language sql
stable
security definer
set search_path = public
as $$
  select true, t.account_email, coalesce(t.scope like '%gmail.send%', false)
  from google_oauth_tokens t
  where t.company_id = p_company_id
    and exists (select 1 from company_members where user_id = auth.uid() and company_id = p_company_id);
$$;
revoke execute on function get_google_connection(text) from public, anon;
grant execute on function get_google_connection(text) to authenticated;
