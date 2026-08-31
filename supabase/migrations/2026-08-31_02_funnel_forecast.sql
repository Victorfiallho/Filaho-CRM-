-- Funnel dashboard: conversion rate, velocity (avg. days in stage), value,
-- and a probability-weighted forecast, per pipeline stage. Everything is
-- returned pre-aggregated by a single RPC — the frontend never pulls raw
-- lead rows for this report, only these per-stage numbers.
--
-- Depends on lead_stage_history from 2026-08-31_01_stagnant_leads.sql (must
-- run first). Safe to re-run.

alter table pipeline_stages add column if not exists win_probability numeric not null default 0.5;

-- SECURITY INVOKER (the plpgsql default), same reasoning as
-- get_stagnant_leads: runs as the calling `authenticated` role, so every
-- query inside inherits RLS on leads/lead_stage_history/pipeline_stages.
create or replace function get_funnel_summary(
  p_company_id text,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns table (
  stage_id text,
  stage_name text,
  stage_order int,
  stage_type text,
  lead_count bigint,
  total_value numeric,
  weighted_forecast numeric,
  avg_days_in_stage numeric,
  conversion_rate numeric
)
language plpgsql
stable
as $$
declare
  total_entered bigint;
begin
  -- Distinct leads that entered ANY stage within the period — the funnel's
  -- denominator for each stage's conversion_rate below.
  select count(distinct h.lead_id) into total_entered
  from lead_stage_history h
  join leads l on l.id = h.lead_id
  where l.company_id = p_company_id
    and (p_date_from is null or h.entered_at >= p_date_from)
    and (p_date_to is null or h.entered_at <= p_date_to);

  return query
  select
    ps.id,
    ps.name,
    ps."order",
    ps.type,
    count(distinct l.id) filter (where l.stage_id = ps.id) as lead_count,
    coalesce(sum(l.value) filter (where l.stage_id = ps.id), 0) as total_value,
    coalesce(sum(l.value * ps.win_probability) filter (where l.stage_id = ps.id), 0) as weighted_forecast,
    (
      select avg(extract(epoch from (coalesce(h2.exited_at, now()) - h2.entered_at)) / 86400.0)
      from lead_stage_history h2
      join leads l2 on l2.id = h2.lead_id
      where l2.company_id = p_company_id and h2.stage_id = ps.id
        and (p_date_from is null or h2.entered_at >= p_date_from)
        and (p_date_to is null or h2.entered_at <= p_date_to)
    ) as avg_days_in_stage,
    case when coalesce(total_entered, 0) = 0 then 0 else
      (
        select count(distinct h3.lead_id)::numeric
        from lead_stage_history h3
        join leads l3 on l3.id = h3.lead_id
        where l3.company_id = p_company_id and h3.stage_id = ps.id
          and (p_date_from is null or h3.entered_at >= p_date_from)
          and (p_date_to is null or h3.entered_at <= p_date_to)
      ) / total_entered
    end as conversion_rate
  from pipeline_stages ps
  left join leads l on l.company_id = ps.company_id and l.stage_id = ps.id
  where ps.company_id = p_company_id
  group by ps.id, ps.name, ps."order", ps.type, ps.win_probability
  order by ps."order";
end;
$$;
grant execute on function get_funnel_summary(text, timestamptz, timestamptz) to authenticated;
