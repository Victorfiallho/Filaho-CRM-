-- What each integration is really doing for a company, for the Integrations
-- screen's status badges (web/src/domain/integrationHealth.ts). The manual
-- "enabled" switches only said someone flipped them; this reads the facts:
-- the Google connection and the permissions it granted, jobs synced to the
-- calendar, job folders in Drive, records with map coordinates and the last
-- Meta Ads sync. Never returns a token. Members of the company only.

create or replace function get_integration_health(p_company_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t google_oauth_tokens;
  result jsonb;
begin
  if not exists (select 1 from company_members where user_id = auth.uid() and company_id = p_company_id) then
    raise exception 'not a member of this company';
  end if;

  select * into t from google_oauth_tokens where company_id = p_company_id;

  result := jsonb_build_object(
    'google', jsonb_build_object(
      'connected', t.company_id is not null,
      'account_email', coalesce(t.account_email, ''),
      'connected_at', t.connected_at,
      'calendar', coalesce(t.scope like '%auth/calendar%', false),
      'drive', coalesce(t.scope like '%auth/drive%', false),
      'sheets', coalesce(t.scope like '%auth/spreadsheets%', false),
      'gmail', coalesce(t.scope like '%gmail.send%', false),
      'gmail_synced_at', t.gmail_synced_at
    ),
    'calendar', jsonb_build_object(
      'scheduled', (select count(*) from jobs where company_id = p_company_id and scheduled_date is not null),
      'synced', (select count(*) from jobs where company_id = p_company_id and scheduled_date is not null and coalesce(google_event_id, '') <> '')
    ),
    'drive', jsonb_build_object(
      'jobs', (select count(*) from jobs where company_id = p_company_id),
      'with_folder', (select count(*) from jobs where company_id = p_company_id and coalesce(drive_folder_url, '') <> '')
    ),
    'maps', jsonb_build_object(
      'clients', (select count(*) from customers where company_id = p_company_id),
      'geocoded', (select count(*) from customers where company_id = p_company_id and lat is not null)
    ),
    'meta', jsonb_build_object(
      'last_sync', (select max(synced_at) from meta_ads_insights where company_id = p_company_id),
      'rows', (select count(*) from meta_ads_insights where company_id = p_company_id)
    )
  );
  return result;
end;
$$;
revoke execute on function get_integration_health(text) from public, anon;
grant execute on function get_integration_health(text) to authenticated;
