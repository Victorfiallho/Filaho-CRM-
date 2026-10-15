-- Integrations page saves failed with "permission denied for table
-- integration_settings". The app saved with a PostgREST upsert, which runs
-- INSERT ... ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, and
-- Postgres requires SELECT on every target column whose EXCLUDED value is
-- read. SELECT on `settings` was revoked on purpose (it would expose every
-- company's nested config), so the column grant on `id` alone wasn't enough.
--
-- Writes now go through this function instead. It keeps the same rules as
-- the table policies: the caller must belong to a company, and the
-- integration_settings_scope_guard trigger still stops changes to another
-- company's per-company keys (auth.uid() is the caller inside a SECURITY
-- DEFINER function too).

create or replace function save_my_integration_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from company_members where user_id = auth.uid()) then
    raise exception 'not authorized to change integration settings';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'settings must be a JSON object';
  end if;

  update integration_settings set settings = p_settings where id = 'default';
  if not found then
    insert into integration_settings (id, settings) values ('default', p_settings);
  end if;
end;
$$;

revoke execute on function save_my_integration_settings(jsonb) from public;
grant execute on function save_my_integration_settings(jsonb) to authenticated;
