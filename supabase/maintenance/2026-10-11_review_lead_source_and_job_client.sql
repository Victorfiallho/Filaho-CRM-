-- One-off review/repair for two bugs fixed in commit 2c06b6d. Not a
-- migration: run it by hand in the Supabase SQL Editor, ONE STEP AT A TIME,
-- reading each step's output before moving on. Steps 1-4 only read data.
--
--   B1  Editing a lead overwrote its source with "Manual", and the client
--       sync then overwrote the linked client's source too ("Manual"/"Lead").
--   B2  A job saved without picking a client was attached to the first
--       client in the list.

-- ── Step 1: how big is B1? ───────────────────────────────────────────────
select company_id,
       count(*) filter (where source = 'Manual')                              as leads_manual,
       count(*) filter (where source = 'Manual' and campaign_id is not null)  as manual_but_has_campaign,
       count(*)                                                               as leads_total
from leads
group by company_id
order by company_id;

-- ── Step 2: clients whose original source can be recovered ──────────────
-- customers has been audited since 2026-08-31, so every update that turned
-- a real source into "Manual"/"Lead" left the original in audit_log.diff.
-- The earliest such change per client holds the true original.
with lost as (
  select distinct on (a.entity_id)
         a.entity_id                      as customer_id,
         a.diff -> 'source' ->> 'old'     as original_source,
         a.created_at                     as overwritten_at
  from audit_log a
  where a.entity = 'customers'
    and a.action = 'update'
    and a.diff ? 'source'
    and a.diff -> 'source' ->> 'new' in ('Manual', 'Lead')
    and coalesce(a.diff -> 'source' ->> 'old', '') not in ('', 'Manual', 'Lead')
  order by a.entity_id, a.created_at
)
select c.company_id, c.id, c.name, c.source as current_source, l.original_source, l.overwritten_at
from lost l
join customers c on c.id = l.customer_id
where c.source in ('Manual', 'Lead')
order by c.company_id, c.name;

-- ── Step 3: leads that would take their client's recovered source ───────
-- Leads were never audited (the migration 2026-10-11_09 adds that), so a
-- lead's own original source is gone. Best available evidence: the linked
-- client's original source — a lead created by an import or sync also
-- created its client with that same source. This is a heuristic: review
-- the list and drop any row that looks wrong before running step 5.
with lost as (
  select distinct on (a.entity_id)
         a.entity_id as customer_id, a.diff -> 'source' ->> 'old' as original_source
  from audit_log a
  where a.entity = 'customers' and a.action = 'update' and a.diff ? 'source'
    and a.diff -> 'source' ->> 'new' in ('Manual', 'Lead')
    and coalesce(a.diff -> 'source' ->> 'old', '') not in ('', 'Manual', 'Lead')
  order by a.entity_id, a.created_at
)
select le.company_id, le.id, le.name, le.source as current_source, l.original_source as proposed_source
from leads le
join lost l on l.customer_id = le.customer_id
where le.source = 'Manual'
order by le.company_id, le.name;

-- ── Step 4: B2 suspects — jobs that may be on the wrong client ───────────
-- The bug always picked the SAME client (first in the list) per company, so
-- that client stands out with far more hand-made jobs than anyone else.
-- 4a: clients ranked by number of hand-made (not imported/synced) jobs.
select j.company_id, c.name as client, count(*) as jobs
from jobs j
join customers c on c.id = j.customer_id
where coalesce(j.source, '') in ('', 'Manual')
group by j.company_id, c.name
order by j.company_id, jobs desc;

-- 4b: the jobs on each company's top client from 4a, to check one by one.
-- There is no automatic fix: open each wrong job in the app and pick the
-- right client (the job form now requires one).
with ranked as (
  select j.company_id, j.customer_id, count(*) as jobs,
         rank() over (partition by j.company_id order by count(*) desc) as rnk
  from jobs j
  where coalesce(j.source, '') in ('', 'Manual') and j.customer_id is not null
  group by j.company_id, j.customer_id
)
select j.company_id, c.name as client, j.title as job, j.service_type, j.scheduled_date, j.created_at
from jobs j
join ranked r on r.customer_id = j.customer_id and r.company_id = j.company_id and r.rnk = 1
join customers c on c.id = j.customer_id
where coalesce(j.source, '') in ('', 'Manual')
order by j.company_id, j.created_at;

-- ── Step 5: restore sources (WRITES DATA) ────────────────────────────────
-- Only after reviewing steps 2 and 3. Runs inside a transaction: check the
-- two "updated" counts it prints, then run COMMIT; (or ROLLBACK; to undo).
--
-- begin;
--
-- with lost as (
--   select distinct on (a.entity_id)
--          a.entity_id as customer_id, a.diff -> 'source' ->> 'old' as original_source
--   from audit_log a
--   where a.entity = 'customers' and a.action = 'update' and a.diff ? 'source'
--     and a.diff -> 'source' ->> 'new' in ('Manual', 'Lead')
--     and coalesce(a.diff -> 'source' ->> 'old', '') not in ('', 'Manual', 'Lead')
--   order by a.entity_id, a.created_at
-- ),
-- fixed_leads as (
--   update leads le set source = l.original_source, updated_at = now()
--   from lost l
--   where l.customer_id = le.customer_id and le.source = 'Manual'
--   returning le.id
-- ),
-- fixed_customers as (
--   update customers c set source = l.original_source, updated_at = now()
--   from lost l
--   where l.customer_id = c.id and c.source in ('Manual', 'Lead')
--   returning c.id
-- )
-- select (select count(*) from fixed_leads) as leads_updated,
--        (select count(*) from fixed_customers) as customers_updated;
--
-- commit;
