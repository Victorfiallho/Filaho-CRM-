-- Phase 1 of the improvements roadmap: who owns a lead/job (M3), what the
-- next step on a lead is and when (M2), and why a lead was lost (M5).
--
-- All new columns are nullable with no default, so existing rows and the
-- current app keep working unchanged until the new fields are filled in.
-- RLS needs no change: these are plain columns on leads/jobs, already
-- covered by those tables' company-scoped policies.
--
-- Safe to re-run.

-- M3: owner. Points at the app-profile `users` table (same id the notes
-- feature stamps as author). A deleted user just leaves the record unowned.
alter table leads add column if not exists owner_user_id text references users(id) on delete set null;
alter table jobs  add column if not exists owner_user_id text references users(id) on delete set null;
create index if not exists leads_owner_idx on leads(company_id, owner_user_id);
create index if not exists jobs_owner_idx  on jobs(company_id, owner_user_id);

-- M2: next action. A short free-text step ("Send revised quote") and the
-- date it's due; the Dashboard and Pipeline flag it once that date passes.
alter table leads add column if not exists next_action text;
alter table leads add column if not exists next_action_date date;
create index if not exists leads_next_action_date_idx on leads(company_id, next_action_date)
  where next_action_date is not null;

-- M5: lost reason. Text, not an enum, so the option list can change in the
-- app without a migration; Reports groups by it.
alter table leads add column if not exists lost_reason text;
