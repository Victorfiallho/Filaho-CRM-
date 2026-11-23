-- Undo 2026-11-23_24: re-run the submit_booking from 2026-11-23_23 FIRST.
drop view if exists booking_ab_results;
drop function if exists count_booking_view(text, text);
drop table if exists booking_page_views;
alter table booking_requests drop column if exists ab_variant;
