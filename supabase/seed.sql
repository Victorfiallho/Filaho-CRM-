-- Fialho Home Improvement — seed data
--
-- Mirrors the hardcoded COMPANIES / seedDb() stage defaults / serviceDefaults()
-- that used to live in app.js, so a fresh Supabase database starts in the same
-- state the original localStorage app assumed. Run once, after schema.sql.

insert into companies (id, name, slug, logo, color, accent, industry) values
  ('peach_fresh', 'Peach Fresh Cleaning', 'peach-fresh-cleaning', 'PF', '#f36f45', '#0f766e', 'Cleaning'),
  ('wish_cabinets', 'Wish Cabinets', 'wish-cabinets', 'WC', '#315c7c', '#d39d48', 'Cabinets'),
  ('peach_state_flooring', 'Peach State Flooring', 'peach-state-flooring', 'PS', '#b95f2f', '#2f6fed', 'Flooring'),
  ('arca_cabinets', 'Arca Cabinets', 'arca-cabinets', 'AC', '#334155', '#14a38b', 'Cabinets')
on conflict (id) do nothing;

-- Every company starts with the same 5-stage lead pipeline (app.js seedDb()).
-- `type` is open/won/lost, not the original app.js "lead" tag — it's what
-- Dashboard/Reports use to compute won deals and open pipeline value, so
-- renaming a stage's display name later doesn't change what it counts as.
insert into pipeline_stages (company_id, id, name, "order", color, type)
select c.id, s.id, s.name, s."order", s.color, s.type
from companies c
cross join (values
  ('new', 'New', 1, '#667085', 'open'),
  ('contacted', 'Contacted', 2, '#2f6fed', 'open'),
  ('estimate', 'Estimate Sent', 3, '#d89416', 'open'),
  ('scheduled', 'Scheduled', 4, '#14a38b', 'open'),
  ('won', 'Won', 5, '#1f9d64', 'won')
) as s(id, name, "order", color, type)
on conflict (company_id, id) do nothing;

-- Service type lists match serviceDefaults() in app.js, keyed by industry.
insert into company_services (company_id, service, position) values
  ('peach_fresh', 'Deep Cleaning', 0),
  ('peach_fresh', 'Recurring Cleaning', 1),
  ('peach_fresh', 'Move-in/Move-out', 2),
  ('peach_fresh', 'Commercial Cleaning', 3),
  ('wish_cabinets', 'Kitchen Cabinets', 0),
  ('wish_cabinets', 'Bathroom Vanities', 1),
  ('wish_cabinets', 'Refacing', 2),
  ('wish_cabinets', 'Custom Build', 3),
  ('peach_state_flooring', 'Floor Installation', 0),
  ('peach_state_flooring', 'Floor Refinishing', 1),
  ('peach_state_flooring', 'Carpet', 2),
  ('peach_state_flooring', 'Tile', 3),
  ('arca_cabinets', 'Kitchen Cabinets', 0),
  ('arca_cabinets', 'Bathroom Vanities', 1),
  ('arca_cabinets', 'Refacing', 2),
  ('arca_cabinets', 'Custom Build', 3)
on conflict (company_id, service) do nothing;

-- integration_settings is a single shared row (not per company — see schema.sql).
-- Starts with the same defaults seedDb() used to write into localStorage; the app
-- fills in real values (api keys, OAuth client, etc.) later.
insert into integration_settings (id, settings) values (
  'default',
  '{
    "google_oauth": { "enabled": false, "client_id": "", "project_id": "", "javascript_origins": [], "scopes": "", "connected_at": "", "granted_scopes": "", "notes": "Import a Google OAuth web client JSON. The client_secret is never stored." },
    "google_maps": { "enabled": false, "api_key": "", "notes": "Ready for API key, geocoding, routes, and map embeds." },
    "google_calendar": { "enabled": false, "calendar_ids": {}, "notes": "Ready for OAuth and per-company calendar sync." },
    "google_sheets": { "enabled": false, "spreadsheet_ids": {}, "notes": "Ready for import/export sync.", "source_urls": {} },
    "google_drive": { "enabled": false, "folder_ids": {}, "folder_urls": {}, "notes": "Ready for project folders and file linking." }
  }'::jsonb
)
on conflict (id) do nothing;

-- The app profile row for the current single user (Pedro Fialho). auth_user_id
-- stays NULL until the matching Supabase Auth user is created in the dashboard
-- (Phase 2) and linked here + in company_members.
insert into users (id, name, email, role, permissions) values
  ('u_owner', 'Pedro Fialho', 'admin@fialho.local', 'owner', array['view','create','edit','import','export'])
on conflict (id) do nothing;

-- Phase 2 (after creating the real auth user in the Supabase dashboard):
--   insert into company_members (user_id, company_id, role)
--   select '<auth-user-uuid>'::uuid, id, 'owner' from companies;
