-- Booking pages are always on, one per company, with nothing to configure.
--
-- The admin screen and its activation step are gone: the public page at
-- /book/<slug> builds itself from the company (name, color, logo) and the
-- company's CRM services (company_services). booking_pages keeps only what
-- the system can't derive: the slug, plus optional contact details for the
-- footer and legal pages, filled in by a developer when the business sends
-- them. A marketing email sender must still refuse to send while the
-- company's postal address is empty (CAN-SPAM).
--
-- Consent capture is unchanged: every booking still writes one sms and one
-- email consent_record with the exact text shown.

alter table booking_pages drop constraint if exists booking_pages_activation;
alter table booking_pages alter column active set default true;
update booking_pages set active = true where not active;

-- company id "peach_state_flooring" -> slug "peach-state-flooring"
create or replace function booking_slug(p_company_id text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(p_company_id), '[^a-z0-9]+', '-', 'g'))
$$;

-- Creates the company's page row and version 1 of its consent texts if
-- they don't exist yet. Idempotent.
create or replace function ensure_booking_page(p_company_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select name into v_name from companies where id = p_company_id;
  if v_name is null then
    return;
  end if;

  insert into booking_pages (company_id, slug, business_name, active)
  values (p_company_id, booking_slug(p_company_id), v_name, true)
  on conflict (company_id) do nothing;

  insert into consent_text_versions (company_id, kind, version, template)
  select p_company_id, t.kind, 1, t.template
  from (values
    ('sms', 'Yes, I agree to receive marketing and promotional text messages from {Business} at the mobile number provided. Consent is not a condition of purchase. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. See our SMS Terms and Privacy Policy.'),
    ('email', 'Yes, send me offers and seasonal reminders by email. You can unsubscribe anytime.'),
    ('transactional', 'By booking, you agree to receive texts and emails about this appointment (confirmations, reminders, and updates).')
  ) as t(kind, template)
  where not exists (
    select 1 from consent_text_versions v where v.company_id = p_company_id and v.kind = t.kind
  );
end;
$$;
revoke execute on function ensure_booking_page(text) from public;

create or replace function companies_ensure_booking_page()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform ensure_booking_page(new.id);
  return new;
end;
$$;

drop trigger if exists companies_booking_page on companies;
create trigger companies_booking_page
  after insert on companies
  for each row execute function companies_ensure_booking_page();

-- Backfill: every existing company gets its page and texts.
select ensure_booking_page(id) from companies;

-- Logos the CRM already ships (web/public/logos), so the page shows them
-- without anyone setting a URL.
update booking_pages b set logo_url = v.logo
from (values
  ('peach_fresh', '/logos/peach_fresh.png'),
  ('wish_cabinets', '/logos/wish_cabinets.svg'),
  ('peach_state_flooring', '/logos/peach_state_flooring.png'),
  ('arca_cabinets', '/logos/arca_cabinets.svg')
) as v(company_id, logo)
where b.company_id = v.company_id and b.logo_url = '';

-- submit_booking: a page only has to exist now, not be "active". The rest
-- is the 2026-10-13_11 version unchanged.
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
  if not exists (select 1 from booking_pages where company_id = v_company) then
    raise exception 'no booking page for %', v_company;
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
