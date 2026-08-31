-- Hardening pass based on Supabase's security advisor after the four
-- migrations above were applied (2026-08-31). Two findings, both closed here:
--
-- 1. function_search_path_mutable on get_stagnant_leads/get_funnel_summary/
--    get_campaign_roi/set_job_closed_at — none of them pinned search_path,
--    unlike the SECURITY DEFINER functions elsewhere in this schema
--    (pin_company_id, get_my_integration_settings, ...). A mutable
--    search_path lets a role that can create objects earlier in its search
--    path shadow an unqualified table/function reference inside the
--    function body. Every table these four touch is unqualified (leads,
--    companies, pipeline_stages, jobs, meta_ads_insights), so this closes
--    that off the same way the rest of the schema already does.
--
-- 2. record_audit_log()/track_lead_stage_change() are SECURITY DEFINER
--    trigger functions, callable directly via PostgREST
--    (/rest/v1/rpc/record_audit_log etc.) by anon/authenticated by default —
--    same class of finding schema.sql already has one accepted instance of
--    (pin_company_id), but there's no reason to carry it forward on new
--    functions when revoking is one line. Calling either standalone would
--    already fail (trigger functions require TG_OP/NEW/OLD/TG_ARGV, which
--    only exist when Postgres invokes them as an actual trigger), so this
--    isn't independently exploitable — revoked anyway to close the advisor
--    warning cleanly instead of relying on that being fragile
--    defense-in-depth. set_job_closed_at gets the same revoke for
--    consistency even though it's SECURITY INVOKER (not flagged by the
--    advisor, but equally pointless to leave publicly callable).
--
-- Revoking EXECUTE from anon/authenticated does not affect the triggers
-- themselves — Postgres fires a trigger as part of the table's own
-- definition, not through the triggering session's EXECUTE grant on the
-- trigger function.
--
-- Safe to re-run.

alter function get_stagnant_leads(text) set search_path = public;
alter function get_funnel_summary(text, timestamptz, timestamptz) set search_path = public;
alter function get_campaign_roi(text, timestamptz, timestamptz) set search_path = public;
alter function set_job_closed_at() set search_path = public;

-- PostgreSQL grants EXECUTE to PUBLIC by default on function creation.
-- Revoking from anon/authenticated alone doesn't remove that blanket PUBLIC
-- grant (every role is implicitly a member of PUBLIC) — revoke from PUBLIC
-- directly, which covers anon/authenticated and any future role too.
revoke execute on function record_audit_log() from public;
revoke execute on function track_lead_stage_change() from public;
revoke execute on function set_job_closed_at() from public;
