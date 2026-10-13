-- Public booking page + US marketing-consent model (TCPA / CTIA / CAN-SPAM).
--
-- Five pieces:
--   booking_pages          one public /book/<slug> page per company (config only)
--   consent_text_versions  every consent/notice wording ever shown, insert-only
--   booking_requests       what a visitor asked for on the form (one per submit)
--   consent_records        legal proof: one row per channel per submit, insert-only
--   suppression_list       global do-not-contact list (all companies, all campaigns)
--
-- The public page is served by web/api/book.js with the service_role key, so
-- anon gets no policy on any of these tables. App users (company members) can
-- read their company's rows; they can edit booking_pages directly, publish a
-- new consent text only through publish_consent_text(), and can never write
-- consent_records or suppression_list from the client at all.
--
-- consent_records and consent_text_versions refuse UPDATE/DELETE/TRUNCATE
-- even for service_role (trigger, not RLS — RLS doesn't bind service_role).
-- That's what makes them usable as proof. To undo this migration use the
-- matching _down.sql, which drops the tables outright (DROP doesn't fire row
-- triggers).
--
-- Safe to re-run.

-- ── customers: E.164 phone for consent/suppression matching ─────────────
-- `phone` stays whatever was typed/imported (display); phone_e164 is the
-- normalized key consent_records.value and suppression_list.value use.
alter table customers add column if not exists phone_e164 text;
create index if not exists customers_phone_e164_idx on customers(company_id, phone_e164) where phone_e164 is not null;
create index if not exists customers_email_lower_idx on customers(company_id, lower(email)) where email <> '';

-- ── booking_pages ─────────────────────────────────────────────────────────
create table if not exists booking_pages (
  company_id text primary key references companies(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  active boolean not null default false,
  business_name text not null,
  hero_title text not null default '',
  hero_subtitle text not null default '',
  primary_color text not null default '#f97316' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url text not null default '',
  phone text not null default '',
  email text not null default '',
  -- Physical postal address: CAN-SPAM requires it in every marketing email,
  -- and it's printed in the page footer.
  address_line text not null default '',
  address_city text not null default '',
  address_state text not null default '',
  address_zip text not null default '',
  service_cities text[] not null default '{}',
  -- Accepted ZIP prefixes ("300", "3006", "30062"); a visitor's ZIP must
  -- start with one of them.
  zip_prefixes text[] not null default '{}',
  -- [{id, name, description, from_price, detail_label, position, active}]
  -- detail_label (optional) adds a number field to the form, e.g. "Number of rooms".
  services jsonb not null default '[]'::jsonb,
  -- [{question, answer}]
  faq jsonb not null default '[]'::jsonb,
  -- [{author, text, source, date}] — real reviews pasted in by an admin.
  -- Empty by default; the page hides the section when there are none.
  reviews jsonb not null default '[]'::jsonb,
  seo_title text not null default '',
  seo_description text not null default '',
  updated_at timestamptz not null default now(),
  -- A page can only go live with what the footer, the legal pages and the
  -- ZIP check need.
  constraint booking_pages_activation check (
    not active or (
      address_line <> '' and address_city <> '' and address_state <> '' and address_zip <> ''
      and phone <> '' and email <> '' and cardinality(zip_prefixes) > 0
    )
  )
);

-- ── consent_text_versions ─────────────────────────────────────────────────
-- `template` may contain {Business}; the page renders it and the rendered
-- string is what consent_records.text_shown stores.
create table if not exists consent_text_versions (
  company_id text not null references companies(id) on delete restrict,
  kind text not null check (kind in ('sms', 'email', 'transactional')),
  version int not null check (version > 0),
  template text not null check (length(trim(template)) > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (company_id, kind, version)
);

-- ── booking_requests ─────────────────────────────────────────────────────
create table if not exists booking_requests (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  customer_id text references customers(id) on delete set null,
  lead_id text references leads(id) on delete set null,
  services text[] not null default '{}',
  -- {rooms, sofas, rugs, mattresses, ...} — free-form counts per page.
  details jsonb not null default '{}'::jsonb,
  preferred_date date,
  preferred_period text check (preferred_period in ('morning', 'afternoon')),
  notes text not null default '',
  heard_from text not null default '',
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  utm_term text not null default '',
  utm_content text not null default '',
  page_url text not null default '',
  ip text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists booking_requests_company_idx on booking_requests(company_id, created_at desc);
create index if not exists booking_requests_customer_idx on booking_requests(customer_id);
create index if not exists booking_requests_lead_idx on booking_requests(lead_id);
-- Rate limit lookup (web/api/book.js counts recent rows per IP).
create index if not exists booking_requests_ip_idx on booking_requests(ip, created_at desc);

-- ── consent_records ──────────────────────────────────────────────────────
-- contact_id is deliberately NOT a foreign key: deleting a client must not
-- delete (cascade) or rewrite (set null) the proof of what they agreed to.
-- `value` snapshots the phone (E.164) or email the consent was given for,
-- so the row stands on its own even after the contact is gone.
--
-- Current state of a contact per channel = its most recent row.
create table if not exists consent_records (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies(id) on delete restrict,
  contact_id text,
  channel text not null check (channel in ('sms', 'email')),
  purpose text not null default 'marketing' check (purpose in ('marketing')),
  value text not null,
  granted boolean not null,
  text_shown text not null,
  text_version int,
  source text not null check (source in ('booking_page', 'import', 'manual', 'inbound_stop', 'unsubscribe')),
  page_url text not null default '',
  ip text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists consent_records_contact_idx on consent_records(contact_id, channel, created_at desc);
create index if not exists consent_records_value_idx on consent_records(channel, value, created_at desc);
create index if not exists consent_records_company_idx on consent_records(company_id, created_at desc);

-- ── suppression_list ─────────────────────────────────────────────────────
create table if not exists suppression_list (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('sms', 'email')),
  value text not null,
  reason text not null check (reason in ('stop_reply', 'unsubscribe', 'bounce', 'complaint', 'manual')),
  company_id text references companies(id) on delete set null, -- where it came from, informational only
  created_at timestamptz not null default now(),
  unique (channel, value)
);

-- ── append-only guards ───────────────────────────────────────────────────
create or replace function forbid_row_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- created_at is the server's clock, never the caller's.
create or replace function stamp_server_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['consent_records', 'consent_text_versions'] loop
    execute format('drop trigger if exists %I on %I', t || '_no_update_delete', t);
    execute format('create trigger %I before update or delete on %I for each row execute function forbid_row_change()', t || '_no_update_delete', t);
    execute format('drop trigger if exists %I on %I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on %I for each statement execute function forbid_row_change()', t || '_no_truncate', t);
    execute format('drop trigger if exists %I on %I', t || '_server_time', t);
    execute format('create trigger %I before insert on %I for each row execute function stamp_server_time()', t || '_server_time', t);
  end loop;
end $$;

drop trigger if exists suppression_list_server_time on suppression_list;
create trigger suppression_list_server_time before insert on suppression_list
  for each row execute function stamp_server_time();
drop trigger if exists suppression_list_no_update on suppression_list;
create trigger suppression_list_no_update before update on suppression_list
  for each row execute function forbid_row_change();

-- A suppression entry can only be removed by a recorded new opt-in: the
-- delete is refused unless consent_records has a granted=true marketing row
-- for the same channel+value created after the suppression.
create or replace function guard_suppression_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from consent_records c
    where c.channel = old.channel and c.value = old.value
      and c.granted and c.purpose = 'marketing' and c.created_at > old.created_at
  ) then
    raise exception 'suppression for % % can only be lifted by a new recorded opt-in', old.channel, old.value
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;
drop trigger if exists suppression_list_guard_delete on suppression_list;
create trigger suppression_list_guard_delete before delete on suppression_list
  for each row execute function guard_suppression_delete();

-- ...and a new opt-in lifts it automatically, so callers never have to
-- remember to.
create or replace function lift_suppression_on_opt_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.granted and new.purpose = 'marketing' then
    delete from suppression_list s
    where s.channel = new.channel and s.value = new.value and s.created_at < new.created_at;
  end if;
  return new;
end;
$$;
drop trigger if exists consent_records_lift_suppression on consent_records;
create trigger consent_records_lift_suppression after insert on consent_records
  for each row execute function lift_suppression_on_opt_in();

-- ── company_id pinning (same guard as the other operational tables) ──────
drop trigger if exists booking_pages_pin_company_id on booking_pages;
create trigger booking_pages_pin_company_id before update on booking_pages
  for each row execute function pin_company_id();
drop trigger if exists booking_requests_pin_company_id on booking_requests;
create trigger booking_requests_pin_company_id before update on booking_requests
  for each row execute function pin_company_id();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table booking_pages enable row level security;
alter table consent_text_versions enable row level security;
alter table booking_requests enable row level security;
alter table consent_records enable row level security;
alter table suppression_list enable row level security;

drop policy if exists booking_pages_select on booking_pages;
create policy booking_pages_select on booking_pages for select using (
  company_id in (select company_id from company_members where user_id = auth.uid())
);
drop policy if exists booking_pages_insert on booking_pages;
create policy booking_pages_insert on booking_pages for insert with check (
  company_id in (select company_id from company_members where user_id = auth.uid())
);
drop policy if exists booking_pages_update on booking_pages;
create policy booking_pages_update on booking_pages for update using (
  company_id in (select company_id from company_members where user_id = auth.uid())
) with check (
  company_id in (select company_id from company_members where user_id = auth.uid())
);
-- No delete policy: deactivate instead.

drop policy if exists consent_text_versions_select on consent_text_versions;
create policy consent_text_versions_select on consent_text_versions for select using (
  company_id in (select company_id from company_members where user_id = auth.uid())
);
drop policy if exists booking_requests_select on booking_requests;
create policy booking_requests_select on booking_requests for select using (
  company_id in (select company_id from company_members where user_id = auth.uid())
);
drop policy if exists consent_records_select on consent_records;
create policy consent_records_select on consent_records for select using (
  company_id in (select company_id from company_members where user_id = auth.uid())
);
-- suppression_list: no policy for authenticated at all. It's global and holds
-- other tenants' phones/emails; the app sees a contact's suppression only as
-- the "suppressed" state from get_contact_consent_status() below.

-- ── publish_consent_text: the only way the app writes a consent text ─────
-- Computes the next version number under a lock, and is a no-op (returns the
-- current version) when the wording didn't actually change.
create or replace function publish_consent_text(p_company_id text, p_kind text, p_template text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row consent_text_versions;
  next_version int;
begin
  if not exists (select 1 from company_members where user_id = auth.uid() and company_id = p_company_id) then
    raise exception 'not a member of this company' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('sms', 'email', 'transactional') then
    raise exception 'unknown consent text kind %', p_kind;
  end if;
  if p_template is null or length(trim(p_template)) = 0 then
    raise exception 'consent text cannot be empty';
  end if;

  perform pg_advisory_xact_lock(hashtext('consent_text:' || p_company_id || ':' || p_kind));

  select * into current_row from consent_text_versions
  where company_id = p_company_id and kind = p_kind
  order by version desc limit 1;

  if found and current_row.template = trim(p_template) then
    return current_row.version;
  end if;

  next_version := coalesce(current_row.version, 0) + 1;
  insert into consent_text_versions (company_id, kind, version, template, created_by)
  values (p_company_id, p_kind, next_version, trim(p_template), auth.uid());
  return next_version;
end;
$$;
revoke execute on function publish_consent_text(text, text, text) from public;
grant execute on function publish_consent_text(text, text, text) to authenticated;

-- ── get_contact_consent_status: badges + Pipeline filters ────────────────
-- One row per client of the company: latest consent row per channel plus
-- whether the phone/email is on the global suppression list. SECURITY
-- DEFINER only so it can read suppression_list; it checks membership itself
-- and only ever returns the caller's own company's contacts.
create or replace function get_contact_consent_status(p_company_id text)
returns table (
  contact_id text,
  sms_state text,
  sms_at timestamptz,
  email_state text,
  email_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select 1 from company_members where user_id = auth.uid() and company_id = p_company_id
  ),
  latest as (
    select distinct on (cr.contact_id, cr.channel) cr.contact_id, cr.channel, cr.granted, cr.created_at
    from consent_records cr
    where cr.company_id = p_company_id and cr.contact_id is not null
    order by cr.contact_id, cr.channel, cr.created_at desc
  )
  select
    c.id,
    case
      when c.phone_e164 is not null and exists (select 1 from suppression_list s where s.channel = 'sms' and s.value = c.phone_e164) then 'suppressed'
      when ls.granted then 'opted_in'
      else 'not_opted_in'
    end,
    ls.created_at,
    case
      when c.email <> '' and exists (select 1 from suppression_list s where s.channel = 'email' and s.value = lower(c.email)) then 'suppressed'
      when le.granted then 'opted_in'
      else 'not_opted_in'
    end,
    le.created_at
  from customers c
  left join latest ls on ls.contact_id = c.id and ls.channel = 'sms'
  left join latest le on le.contact_id = c.id and le.channel = 'email'
  where c.company_id = p_company_id and exists (select 1 from me);
$$;
revoke execute on function get_contact_consent_status(text) from public;
grant execute on function get_contact_consent_status(text) to authenticated;

revoke execute on function forbid_row_change() from public;
revoke execute on function stamp_server_time() from public;
revoke execute on function guard_suppression_delete() from public;
revoke execute on function lift_suppression_on_opt_in() from public;

-- ── submit_booking: one public booking, atomically ───────────────────────
-- Called only by web/api/book.js (service_role) after it has validated the
-- form. Doing it in one function means a booking can never land without its
-- two consent_records (or vice versa) if a request dies halfway.
--
-- Duplicate rule: a client of the same company with the same phone (E.164,
-- or the last 10 digits of a legacy free-text phone) or the same email gets
-- the new request attached instead of a second client. Phone match wins
-- over email match. Blank fields on the existing client are filled in;
-- nothing already on file is overwritten (name/source stay as they were).
create or replace function submit_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text := p->>'company_id';
  v_e164 text := p->>'phone_e164';
  v_digits text := right(regexp_replace(coalesce(p->>'phone_e164', ''), '\D', '', 'g'), 10);
  v_email text := lower(coalesce(p->>'email', ''));
  v_services text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'services', '[]'::jsonb))), '{}');
  v_customer customers;
  v_customer_id text;
  v_stage text;
  v_matched boolean := false;
  c jsonb;
begin
  if not exists (select 1 from booking_pages where company_id = v_company and active) then
    raise exception 'booking page is not active for %', v_company;
  end if;
  if jsonb_array_length(coalesce(p->'consents', '[]'::jsonb)) <> 2 then
    raise exception 'a booking must carry exactly one sms and one email consent record';
  end if;

  select * into v_customer from customers cu
  where cu.company_id = v_company and (
    cu.phone_e164 = v_e164
    or (coalesce(cu.phone, '') <> '' and right(regexp_replace(cu.phone, '\D', '', 'g'), 10) = v_digits)
    or (coalesce(cu.email, '') <> '' and lower(cu.email) = v_email)
  )
  order by
    (coalesce(cu.phone_e164 = v_e164, false) or right(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g'), 10) = v_digits) desc,
    cu.created_at
  limit 1
  for update;

  if found then
    v_matched := true;
    v_customer_id := v_customer.id;
    update customers set
      phone_e164 = coalesce(phone_e164, v_e164),
      phone = case when coalesce(phone, '') = '' then p->>'phone' else phone end,
      email = case when coalesce(email, '') = '' then p->>'email' else email end,
      address = case when coalesce(address, '') = '' then p->>'address' else address end,
      city = case when coalesce(city, '') = '' then p->>'city' else city end,
      state = case when coalesce(state, '') = '' then p->>'state' else state end,
      zip = case when coalesce(zip, '') = '' then p->>'zip' else zip end,
      updated_at = now()
    where id = v_customer_id;
  else
    v_customer_id := p->>'customer_id';
    insert into customers (id, company_id, name, phone, phone_e164, email, address, city, state, zip, status, service_type, source)
    values (v_customer_id, v_company, p->>'name', p->>'phone', v_e164, p->>'email', p->>'address', p->>'city', p->>'state', p->>'zip',
            'active', coalesce(v_services[1], ''), 'Booking page');
  end if;

  select id into v_stage from pipeline_stages where company_id = v_company and id = 'new';
  if v_stage is null then
    select id into v_stage from pipeline_stages where company_id = v_company order by "order" limit 1;
  end if;

  insert into leads (id, company_id, customer_id, name, phone, email, address, city, state, zip, stage_id, service_type, value, source)
  values (p->>'lead_id', v_company, v_customer_id, p->>'name', p->>'phone', p->>'email', p->>'address', p->>'city', p->>'state', p->>'zip',
          coalesce(v_stage, 'new'), coalesce(v_services[1], ''), 0, 'Booking page');

  insert into booking_requests (id, company_id, customer_id, lead_id, services, details, preferred_date, preferred_period, notes, heard_from,
                                utm_source, utm_medium, utm_campaign, utm_term, utm_content, page_url, ip, user_agent)
  values (p->>'request_id', v_company, v_customer_id, p->>'lead_id', v_services, coalesce(p->'details', '{}'::jsonb),
          nullif(p->>'preferred_date', '')::date, nullif(p->>'preferred_period', ''), coalesce(p->>'notes', ''), coalesce(p->>'heard_from', ''),
          coalesce(p->'utm'->>'utm_source', ''), coalesce(p->'utm'->>'utm_medium', ''), coalesce(p->'utm'->>'utm_campaign', ''),
          coalesce(p->'utm'->>'utm_term', ''), coalesce(p->'utm'->>'utm_content', ''),
          coalesce(p->>'page_url', ''), coalesce(p->>'ip', ''), coalesce(p->>'user_agent', ''));

  for c in select * from jsonb_array_elements(p->'consents') loop
    insert into consent_records (company_id, contact_id, channel, purpose, value, granted, text_shown, text_version, source, page_url, ip, user_agent)
    values (v_company, v_customer_id, c->>'channel', 'marketing', c->>'value', (c->>'granted')::boolean, c->>'text_shown',
            (c->>'text_version')::int, 'booking_page', coalesce(p->>'page_url', ''), coalesce(p->>'ip', ''), coalesce(p->>'user_agent', ''));
  end loop;

  -- Dashboard activity feed entry (the CRM's internal notification).
  insert into audit_log (company_id, user_id, entity, entity_id, action, diff)
  values (v_company, null, 'booking_requests', p->>'request_id', 'insert',
          jsonb_build_object('name', p->>'name', 'services', to_jsonb(v_services), 'lead_id', p->>'lead_id', 'existing_client', v_matched));

  return jsonb_build_object('customer_id', v_customer_id, 'lead_id', p->>'lead_id', 'request_id', p->>'request_id', 'existing_client', v_matched);
end;
$$;
revoke execute on function submit_booking(jsonb) from public;
grant execute on function submit_booking(jsonb) to service_role;

-- ── revoke_marketing_consent: STOP replies and email unsubscribes ────────
-- Suppresses the value globally and appends a granted=false record for
-- every client (any company) with that phone/email. Called only by
-- web/api/sms-inbound.js and web/api/unsubscribe.js (service_role).
create or replace function revoke_marketing_consent(
  p_channel text, p_value text, p_reason text, p_source text, p_text text, p_company_id text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text := right(regexp_replace(p_value, '\D', '', 'g'), 10);
  v_count int := 0;
begin
  if p_channel not in ('sms', 'email') then raise exception 'unknown channel %', p_channel; end if;

  insert into suppression_list (channel, value, reason, company_id)
  values (p_channel, p_value, p_reason, p_company_id)
  on conflict (channel, value) do nothing;

  insert into consent_records (company_id, contact_id, channel, purpose, value, granted, text_shown, text_version, source)
  select cu.company_id, cu.id, p_channel, 'marketing', p_value, false, p_text, null, p_source
  from customers cu
  where case p_channel
    when 'sms' then cu.phone_e164 = p_value or (coalesce(cu.phone, '') <> '' and right(regexp_replace(cu.phone, '\D', '', 'g'), 10) = v_digits)
    else coalesce(cu.email, '') <> '' and lower(cu.email) = lower(p_value)
  end;
  get diagnostics v_count = row_count;

  -- Nobody on file with that value (e.g. a forwarded email): still keep the
  -- proof, against the company the request came from when we know it.
  if v_count = 0 and p_company_id is not null then
    insert into consent_records (company_id, contact_id, channel, purpose, value, granted, text_shown, text_version, source)
    values (p_company_id, null, p_channel, 'marketing', p_value, false, p_text, null, p_source);
  end if;
  return v_count;
end;
$$;
revoke execute on function revoke_marketing_consent(text, text, text, text, text, text) from public;
grant execute on function revoke_marketing_consent(text, text, text, text, text, text) to service_role;

-- ── backfill phone_e164 on existing clients ─────────────────────────────
-- So suppression/consent matching works on the clients already in the CRM.
-- The audit trigger is paused for this one statement: otherwise every
-- client gets an "updated phone e164" row in the activity feed.
alter table customers disable trigger customers_audit_log;
update customers set phone_e164 = '+1' || right(regexp_replace(phone, '\D', '', 'g'), 10)
where phone_e164 is null
  and length(regexp_replace(phone, '\D', '', 'g')) in (10, 11)
  and right(regexp_replace(phone, '\D', '', 'g'), 10) ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$';
alter table customers enable trigger customers_audit_log;

-- ── seed: the two pages, inactive until address/phone/ZIPs are filled in ─
insert into booking_pages (company_id, slug, business_name, hero_title, hero_subtitle, primary_color, logo_url, services, faq, seo_title, seo_description)
select v.* from (values
  ('peach_fresh', 'peach-fresh', 'Peach Fresh',
   'Carpet, upholstery, rug and mattress cleaning',
   'Book your cleaning online in about a minute. We''ll confirm your appointment by text and email.',
   '#f36f45', '/logos/peach_fresh.png',
   '[{"id":"carpet","detail_label":"Number of rooms","name":"Carpet cleaning","description":"","from_price":null,"position":0,"active":true},
     {"id":"upholstery","detail_label":"Number of sofas or chairs","name":"Upholstery cleaning","description":"","from_price":null,"position":1,"active":true},
     {"id":"rug","detail_label":"Number of rugs","name":"Rug cleaning","description":"","from_price":null,"position":2,"active":true},
     {"id":"mattress","detail_label":"Number of mattresses","name":"Mattress cleaning","description":"","from_price":null,"position":3,"active":true}]'::jsonb,
   '[]'::jsonb,
   'Peach Fresh | Carpet & Upholstery Cleaning in Atlanta, GA',
   'Book carpet, upholstery, rug and mattress cleaning in the Atlanta area online.'),
  ('wish_cabinets', 'wish-cabinets', 'Wish Cabinets',
   'Kitchen cabinets, closets and pantries',
   'Tell us about your project and pick a time for a free consultation.',
   '#315c7c', '/logos/wish_cabinets.svg',
   '[{"id":"kitchen","name":"Kitchen cabinets","description":"","from_price":null,"position":0,"active":true},
     {"id":"closet","name":"Closets","description":"","from_price":null,"position":1,"active":true},
     {"id":"pantry","name":"Pantry","description":"","from_price":null,"position":2,"active":true}]'::jsonb,
   '[]'::jsonb,
   'Wish Cabinets | Cabinets, Closets & Pantries in Atlanta, GA',
   'Book a consultation for kitchen cabinets, closets and pantries in the Atlanta area.')
) as v(company_id, slug, business_name, hero_title, hero_subtitle, primary_color, logo_url, services, faq, seo_title, seo_description)
where exists (select 1 from companies where id = v.company_id)
on conflict (company_id) do nothing;

-- Version 1 of each text, for both companies.
insert into consent_text_versions (company_id, kind, version, template)
select c.company_id, t.kind, 1, t.template
from (values ('peach_fresh'), ('wish_cabinets')) as c(company_id)
cross join (values
  ('sms', 'Yes, I agree to receive marketing and promotional text messages from {Business} at the mobile number provided. Consent is not a condition of purchase. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. See our SMS Terms and Privacy Policy.'),
  ('email', 'Yes, send me offers and seasonal reminders by email. You can unsubscribe anytime.'),
  ('transactional', 'By booking, you agree to receive texts and emails about this appointment (confirmations, reminders, and updates).')
) as t(kind, template)
where exists (select 1 from companies where id = c.company_id)
on conflict do nothing;
