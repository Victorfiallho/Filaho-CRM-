-- Schema support for commit 2c06b6d (won lead -> job conversion) and the
-- lead-source bug it fixed.
--
-- 1. Audit leads too. audit_log only covered customers/jobs/pipeline_stages,
--    so when editing a lead silently overwrote its `source` there was no
--    record of the original value to restore it from. Same trigger function
--    as the other tables (record_audit_log, 2026-08-31_04_audit_log.sql).
-- 2. One job per lead. The app now looks up "the job for this lead" by
--    jobs.lead_id; a partial unique index makes a double conversion (two
--    tabs, a double click) fail instead of creating two jobs for one deal.
--    Skipped with a NOTICE if duplicates already exist, so the rest of the
--    migration still applies — resolve them, then re-run.
--
-- Safe to re-run.

drop trigger if exists leads_audit_log on leads;
create trigger leads_audit_log
  after insert or update or delete on leads
  for each row execute function record_audit_log('leads');

do $$
begin
  if exists (
    select 1 from jobs where lead_id is not null group by lead_id having count(*) > 1
  ) then
    raise notice 'jobs_lead_id_unique NOT created: some leads already have more than one job. Run: select lead_id, count(*) from jobs where lead_id is not null group by lead_id having count(*) > 1;';
  else
    create unique index if not exists jobs_lead_id_unique on jobs(lead_id) where lead_id is not null;
  end if;
end $$;
