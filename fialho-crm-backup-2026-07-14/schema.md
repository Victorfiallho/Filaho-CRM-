# Fialho CRM Sprint 1 Schema

This MVP uses `localStorage` through a small `FialhoDB` wrapper. The shape is intentionally close to a future SQL/API backend so records can later move to Supabase, Firebase, Postgres, or a custom API.

## Tables

### companies
- `id`
- `name`
- `slug`
- `logo`
- `color`
- `accent`
- `industry`
- `settings`

### users
- `id`
- `name`
- `email`
- `role`
- `company_ids`
- `permissions`

### clients (`customers` storage key)

The UI calls these records **Clients**. The localStorage key remains `customers` for backwards compatibility with records already created in the MVP.

- `id`
- `company_id`
- `name`
- `phone`
- `email`
- `address`
- `city`
- `state`
- `zip`
- `status`
- `service_type`
- `source`
- `notes`
- `created_at`
- `updated_at`

### leads

Leads are pipeline opportunities linked to a Client by `customer_id`. Creating or editing a lead should create/update the matching Client automatically so the same person is not typed twice.

- `id`
- `company_id`
- `customer_id`
- `name`
- `phone`
- `email`
- `address`
- `city`
- `state`
- `zip`
- `stage_id`
- `service_type`
- `value`
- `source`
- `created_at`
- `updated_at`

### jobs
- `id`
- `company_id`
- `customer_id`
- `lead_id`
- `title`
- `status`
- `service_type`
- `scheduled_date`
- `address`
- `city`
- `state`
- `zip`
- `estimated_value`
- `drive_folder_url`
- `created_at`
- `updated_at`

### pipeline_stages
- `id`
- `company_id`
- `name`
- `order`
- `color`
- `type`

### imports
- `id`
- `company_id`
- `file_name`
- `source_type`
- `imported_at`
- `created_count`
- `updated_count`
- `skipped_count`
- `row_count`

### notes
- `id`
- `company_id`
- `entity_type`
- `entity_id`
- `body`
- `created_at`
- `user_id`

### files
- `id`
- `company_id`
- `entity_type`
- `entity_id`
- `name`
- `url`
- `provider`
- `created_at`

### integration_settings
- `google_oauth.enabled`
- `google_oauth.client_id`
- `google_oauth.project_id`
- `google_oauth.javascript_origins`
- `google_oauth.granted_scopes`
- `google_oauth.connected_at`
- `google_maps.enabled`
- `google_maps.api_key`
- `google_calendar.enabled`
- `google_calendar.calendar_ids`
- `google_sheets.enabled`
- `google_sheets.spreadsheet_ids`
- `google_sheets.source_urls`
- `google_drive.enabled`
- `google_drive.folder_ids`
- `google_drive.folder_urls`

## Sprint 2 Additions

- Internal calendar view for company jobs/projects.
- Internal visual map and route-planning view filtered by ZIP, city, service type, lead status, job status, and date.
- Integration settings screen prepared for Google Maps, Google Calendar, Google Sheets, and Google Drive credentials/config.
- Google OAuth Web Client JSON can be imported locally. The CRM stores only Client ID/project metadata and ignores `client_secret`.

## Google Integration Layer

- Google Maps can load real map tiles and markers when a Maps JavaScript API key is saved.
- Google Maps geocoding can populate `lat` and `lng` for visible records when the API key allows Geocoding API calls.
- Google Sheets can import from a published/shared Sheet CSV URL or a standard Google Sheet URL converted to CSV export.
- Google Calendar supports `.ics` import/export for company jobs and one-click Google Calendar event creation links.
- Google Calendar `.ics` imports can be reviewed as a historical calendar inbox: each event can be assigned to the correct company before saving.
- Google Drive supports company root folder URLs and per-customer/per-job Drive folder URLs.
- Google OAuth can connect Calendar, Drive, and Sheets for the current browser session. Full private two-way sync still needs a backend token storage/sync worker in a later sprint.

## Sprint 1 Rules

- Every operational record carries `company_id`.
- The UI always filters by the selected company.
- Import duplicate checks only compare records inside the selected company.
- Calendar and map records are also scoped by selected `company_id`.
- Google, SMS, Meta Ads, invoices, and advanced automation are represented as integration-ready fields only.
