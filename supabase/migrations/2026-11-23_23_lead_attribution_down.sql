-- Undo 2026-11-23_23: re-run the submit_booking from 2026-10-15_20_audit_fixes.sql
-- FIRST (it doesn't write the new columns), then drop them.
drop index if exists booking_requests_lead_ids_idx;
alter table booking_requests drop column if exists lead_ids;
alter table booking_requests drop column if exists placement;
alter table booking_requests drop column if exists ad_id;
alter table booking_requests drop column if exists adset_id;
alter table booking_requests drop column if exists campaign_id;
