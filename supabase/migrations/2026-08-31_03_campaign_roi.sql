-- Campaign ROI: cost (meta_ads_insights) crossed with attributed revenue
-- (jobs closed via a lead tagged with a campaign), by campaign and period.
--
-- IMPORTANT LIMITATION (flagged to Victor before building this): nothing in
-- the schema linked a lead/job to the Meta campaign it came from until now.
-- leads.campaign_id/campaign_name below are new, optional, nullable columns —
-- only leads tagged going forward (via the new "Campaign" field on the lead
-- form) show up broken out by campaign. Revenue from untagged leads/jobs is
-- real revenue, just not attributable to a specific campaign, and is
-- returned as a single "unattributed" row rather than guessed at.
--
-- Safe to re-run.

alter table leads add column if not exists campaign_id text;
alter table leads add column if not exists campaign_name text;
alter table jobs add column if not exists closed_at timestamptz;

-- Stamps/clears jobs.closed_at when status transitions into/out of
-- 'complete', so "revenue closed in period" has a real event timestamp to
-- filter on instead of updated_at (which changes on any edit).
create or replace function set_job_closed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.closed_at := coalesce(new.closed_at, now());
  elsif new.status is distinct from 'complete' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_set_closed_at on jobs;
create trigger jobs_set_closed_at
  before insert or update on jobs
  for each row execute function set_job_closed_at();

-- SECURITY INVOKER (the plpgsql default) — inherits RLS on
-- meta_ads_insights/leads/jobs for the calling `authenticated` role.
create or replace function get_campaign_roi(
  p_company_id text,
  p_date_from timestamptz,
  p_date_to timestamptz
)
returns table (
  campaign_id text,
  campaign_name text,
  spend numeric,
  revenue numeric,
  leads_count bigint,
  roas numeric,
  cpl numeric
)
language sql
stable
as $$
  with spend_agg as (
    select m.campaign_id, max(m.campaign_name) as campaign_name, sum(m.spend) as spend
    from meta_ads_insights m
    where m.company_id = p_company_id
      and m.date >= p_date_from::date and m.date <= p_date_to::date
    group by m.campaign_id
  ),
  lead_agg as (
    select l.campaign_id, count(distinct l.id) as leads_count
    from leads l
    where l.company_id = p_company_id and l.campaign_id is not null
      and l.created_at >= p_date_from and l.created_at <= p_date_to
    group by l.campaign_id
  ),
  revenue_agg as (
    select l.campaign_id, sum(j.estimated_value) as revenue
    from jobs j
    join leads l on l.id = j.lead_id
    where j.company_id = p_company_id and j.status = 'complete'
      and l.campaign_id is not null
      and j.closed_at >= p_date_from and j.closed_at <= p_date_to
    group by l.campaign_id
  )
  select
    s.campaign_id,
    coalesce(s.campaign_name, s.campaign_id) as campaign_name,
    coalesce(s.spend, 0) as spend,
    coalesce(r.revenue, 0) as revenue,
    coalesce(la.leads_count, 0) as leads_count,
    case when coalesce(s.spend, 0) = 0 then 0 else coalesce(r.revenue, 0) / s.spend end as roas,
    case when coalesce(la.leads_count, 0) = 0 then 0 else coalesce(s.spend, 0) / la.leads_count end as cpl
  from spend_agg s
  left join revenue_agg r on r.campaign_id = s.campaign_id
  left join lead_agg la on la.campaign_id = s.campaign_id

  union all

  -- Campaigns with tagged leads/revenue but no ad spend synced for this
  -- period (e.g. organic-tagged campaign_id, or spend not synced yet).
  select
    coalesce(r.campaign_id, la.campaign_id),
    coalesce(r.campaign_id, la.campaign_id),
    0,
    coalesce(r.revenue, 0),
    coalesce(la.leads_count, 0),
    0,
    0
  from lead_agg la
  full outer join revenue_agg r on r.campaign_id = la.campaign_id
  where coalesce(la.campaign_id, r.campaign_id) not in (select campaign_id from spend_agg)

  union all

  -- Revenue from jobs whose lead has no campaign_id at all (or no linked
  -- lead) — real revenue, not attributable to any single campaign.
  select
    null,
    'Não atribuído',
    0,
    coalesce((
      select sum(j.estimated_value)
      from jobs j
      left join leads l on l.id = j.lead_id
      where j.company_id = p_company_id and j.status = 'complete'
        and (j.lead_id is null or l.campaign_id is null)
        and j.closed_at >= p_date_from and j.closed_at <= p_date_to
    ), 0),
    0,
    0,
    0
$$;
grant execute on function get_campaign_roi(text, timestamptz, timestamptz) to authenticated;
