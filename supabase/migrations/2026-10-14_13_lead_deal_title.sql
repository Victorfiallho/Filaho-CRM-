-- One client can have several deals (leads) in the pipeline — a kitchen
-- now, a bathroom later. The deal's own title tells them apart on the
-- board; empty means "named by its service" (web/src/domain/deals.ts).
-- Additive only: existing leads get '' and nothing else changes.
alter table leads add column if not exists title text not null default '';
