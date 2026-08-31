-- Audit log for customers/jobs/pipeline_stages. Written exclusively by a
-- SECURITY DEFINER trigger (never by app code directly) so it covers every
-- write path automatically — including ones added later — instead of
-- depending on every data/*.ts function remembering to log itself.
--
-- Safe to re-run.

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  entity text not null,
  entity_id text not null,
  action text not null,
  diff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_company_created_idx on audit_log(company_id, created_at desc);
create index if not exists audit_log_entity_idx on audit_log(entity, entity_id);

-- tg_argv[0] is the entity label passed at CREATE TRIGGER time below (e.g.
-- 'customers'). For UPDATE, diff only records changed columns (old/new pairs
-- per key) rather than the full row, to keep entries readable; INSERT/DELETE
-- record the whole new/old row.
create or replace function record_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed jsonb;
  k text;
  row_company_id text;
begin
  if tg_op = 'DELETE' then
    row_company_id := old.company_id;
  else
    row_company_id := new.company_id;
  end if;

  if tg_op = 'INSERT' then
    changed := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    changed := to_jsonb(old);
  else
    changed := '{}'::jsonb;
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
        changed := changed || jsonb_build_object(k, jsonb_build_object('old', to_jsonb(old) -> k, 'new', to_jsonb(new) -> k));
      end if;
    end loop;
  end if;

  insert into audit_log (company_id, user_id, entity, entity_id, action, diff)
  values (row_company_id, auth.uid(), tg_argv[0], coalesce(new.id, old.id), lower(tg_op), changed);

  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['customers','jobs','pipeline_stages'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit_log', t);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function record_audit_log(%L)',
      t || '_audit_log', t, t);
  end loop;
end $$;

alter table audit_log enable row level security;
drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log for select using (
  company_id in (select company_id from company_members where user_id = auth.uid())
);
-- No insert/update/delete policy for `authenticated` — only the SECURITY
-- DEFINER trigger above writes here, same shape as lead_stage_history.
