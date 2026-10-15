-- Supabase Security Advisor (2026-10-15): SECURITY DEFINER functions were
-- executable by `anon` (anyone with the public API key, no login).
--
-- Earlier migrations ran `revoke execute ... from public`, but Supabase also
-- grants EXECUTE on new public-schema functions to anon and authenticated
-- explicitly (default privileges), and revoking PUBLIC doesn't touch those.
--
-- Real exposure, now closed:
--   submit_booking: anyone could write bookings and consent records (legal
--     evidence) straight through /rest/v1/rpc, skipping the booking page's
--     rate limit, honeypot and consent-text checks.
--   revoke_marketing_consent: anyone could opt any phone/email out.
--   ensure_booking_page: anyone could create booking page rows.
-- These are only called server-side with the service_role key.
--
-- Trigger functions can't be called over the API anyway, and a trigger still
-- fires after EXECUTE is revoked (it's checked when the trigger is created).

revoke execute on function submit_booking(jsonb) from anon, authenticated;
revoke execute on function revoke_marketing_consent(text, text, text, text, text, text) from anon, authenticated;
revoke execute on function ensure_booking_page(text) from anon, authenticated;

revoke execute on function companies_ensure_booking_page() from anon, authenticated;
revoke execute on function customer_push_contact_to_leads() from anon, authenticated;
revoke execute on function lift_suppression_on_opt_in() from anon, authenticated;
revoke execute on function lock_confirmed_transaction() from anon, authenticated;
revoke execute on function pin_company_id() from anon, authenticated;

-- Signed-in only: each checks the caller's company membership itself.
revoke execute on function ensure_my_profile() from anon;
revoke execute on function update_my_profile(text) from anon;
revoke execute on function save_my_integration_settings(jsonb) from anon;
revoke execute on function publish_consent_text(text, text, text) from anon;
revoke execute on function get_contact_consent_status(text) from anon;

alter function booking_slug(text) set search_path = public;

-- New functions stop being callable without a login by default; one meant
-- to be public needs an explicit `grant execute ... to anon`.
alter default privileges in schema public revoke execute on functions from anon;
