-- Reverts 2026-10-13_11_booking_consent.sql.
--
-- WARNING: this drops consent_records — the legal proof of every opt-in and
-- opt-out collected so far — and the suppression list. Export both first
-- (e.g. `copy consent_records to stdout csv header`) unless this is a dev
-- database. DROP TABLE doesn't fire the append-only row triggers, so this
-- works even though no row can be deleted one by one.

drop function if exists revoke_marketing_consent(text, text, text, text, text, text);
drop function if exists submit_booking(jsonb);
drop function if exists get_contact_consent_status(text);
drop function if exists publish_consent_text(text, text, text);

drop table if exists consent_records;
drop table if exists suppression_list;
drop table if exists booking_requests;
drop table if exists consent_text_versions;
drop table if exists booking_pages;

drop function if exists lift_suppression_on_opt_in();
drop function if exists guard_suppression_delete();
drop function if exists stamp_server_time();
drop function if exists forbid_row_change();

drop index if exists customers_email_lower_idx;
drop index if exists customers_phone_e164_idx;
alter table customers drop column if exists phone_e164;
