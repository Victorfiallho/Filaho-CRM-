-- Project Costing & Financial Control — Phase 3 (Google Drive folders +
-- document registry). Additive only, same safe-to-re-run convention as
-- every prior migration in this folder.
--
-- `customers.drive_folder_url` and `jobs.drive_folder_url` already existed
-- (Sprint 2) and are reused as-is — this migration doesn't touch them, it
-- only adds the structured Folder ID registry the spec asks for (item 10:
-- "Fazer o vínculo usando os IDs do Google Drive, e não apenas os nomes das
-- pastas") underneath what was previously just a free-text URL field.

-- ── drive_folders (Folder ID registry: root/company/client/job + the 8
--    project subfolders) ────────────────────────────────────────────────
create table if not exists drive_folders (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('root', 'company', 'client', 'job')),
  -- For entity_type 'root' and 'company', entity_id is the company_id itself
  -- (the "Fialho CRM" root and the company folder are per-company because
  -- each company may connect a different Google account — see Phase 3's
  -- diagnostic). For 'client' it's the customer id, for 'job' the job id.
  entity_id text not null,
  -- '' for the entity's own root folder; one of the 8 project subfolder
  -- names (e.g. "01 - Proposal & Contract") when entity_type = 'job'.
  subfolder_key text not null default '',
  drive_folder_id text not null,
  drive_folder_url text not null,
  created_at timestamptz not null default now(),
  unique (company_id, entity_type, entity_id, subfolder_key)
);
create index if not exists drive_folders_lookup_idx on drive_folders(company_id, entity_type, entity_id);

-- ── drive_files (registry of every file the CRM uploaded to Drive) ──────
create table if not exists drive_files (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('client', 'job')),
  entity_id text not null,
  drive_folder_id text not null,
  drive_file_id text not null,
  file_name text not null,
  mime_type text default '',
  category text default '',
  related_transaction_id text,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  upload_date timestamptz not null default now(),
  sync_status text not null default 'synced' check (sync_status in ('synced', 'error')),
  last_sync_date timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists drive_files_lookup_idx on drive_files(company_id, entity_type, entity_id);

-- ═══════════════════════════════════════════════════════════════════════
-- RLS — same company-membership pattern as every other table.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['drive_folders', 'drive_files'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select using (
         company_id in (select company_id from company_members where user_id = auth.uid())
       )', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format(
      'create policy %I on %I for insert with check (
         company_id in (select company_id from company_members where user_id = auth.uid())
       )', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format(
      'create policy %I on %I for update using (
         company_id in (select company_id from company_members where user_id = auth.uid())
       ) with check (
         company_id in (select company_id from company_members where user_id = auth.uid())
       )', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format(
      'create policy %I on %I for delete using (
         company_id in (select company_id from company_members where user_id = auth.uid())
       )', t || '_delete', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['drive_folders', 'drive_files'] loop
    execute format('drop trigger if exists %I on %I', t || '_pin_company', t);
    execute format(
      'create trigger %I before update on %I for each row execute function pin_company_id()',
      t || '_pin_company', t);
  end loop;
end $$;

-- Audit trail for the file registry (not for drive_folders — a structural
-- cache of Folder IDs, same low-audit-value tier as vendors/company_finance_settings).
drop trigger if exists drive_files_audit_log on drive_files;
create trigger drive_files_audit_log after insert or update or delete on drive_files for each row execute function record_audit_log('drive_files');
