-- The pipeline is made of deals (the `leads` table). The person is the
-- client: their name, phone, email, address and coordinates live on
-- `customers` and are copied onto each of their deals, never edited there.
-- The copy is kept so everything that reads a deal's name/address (cards,
-- map, search, activity feed, scripts) keeps working unchanged.
--
-- Also: the booking page creates one deal per service picked.

-- ── a deal takes its contact fields from its client ──────────────────────
create or replace function lead_copy_client_contact()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c customers;
begin
  if coalesce(new.customer_id, '') <> '' then
    select * into c from customers where id = new.customer_id;
    if found then
      new.name := c.name;
      new.phone := c.phone;
      new.email := c.email;
      new.address := c.address;
      new.city := c.city;
      new.state := c.state;
      new.zip := c.zip;
      new.lat := c.lat;
      new.lng := c.lng;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_copy_client_contact on leads;
create trigger leads_copy_client_contact
  before insert or update of customer_id, name, phone, email, address, city, state, zip, lat, lng on leads
  for each row execute function lead_copy_client_contact();

-- ── a client's change reaches all of their deals ─────────────────────────
-- SECURITY DEFINER so the copy isn't blocked by RLS when the editor can
-- update the client; it only ever touches deals of that same client.
create or replace function customer_push_contact_to_leads()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.name, new.phone, new.email, new.address, new.city, new.state, new.zip, new.lat, new.lng)
     is distinct from (old.name, old.phone, old.email, old.address, old.city, old.state, old.zip, old.lat, old.lng) then
    update leads set
      name = new.name, phone = new.phone, email = new.email,
      address = new.address, city = new.city, state = new.state, zip = new.zip,
      lat = new.lat, lng = new.lng
    where customer_id = new.id and company_id = new.company_id;
  end if;
  return null;
end;
$$;

drop trigger if exists customers_push_contact on customers;
create trigger customers_push_contact
  after update on customers
  for each row execute function customer_push_contact_to_leads();

-- Backfill: line every deal up with its client (checked 2026-10-14: the
-- only difference was a deal missing a phone its client has).
update leads l set
  name = c.name, phone = c.phone, email = c.email,
  address = c.address, city = c.city, state = c.state, zip = c.zip,
  lat = c.lat, lng = c.lng
from customers c
where c.id = l.customer_id
  and (l.name, l.phone, l.email, l.address, l.city, l.state, l.zip, l.lat, l.lng)
      is distinct from (c.name, c.phone, c.email, c.address, c.city, c.state, c.zip, c.lat, c.lng);

-- ── booking page: one deal per service ───────────────────────────────────
-- Same as 2026-10-14_12 except the deals: one per service picked (the
-- first keeps p.lead_id, the next ones get "<lead_id>_2", "_3"...), each
-- named by its service. booking_requests.lead_id points at the first.
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
  v_deal_services text[];
  v_lead_ids text[] := '{}';
  v_lead_id text;
  v_customer customers;
  v_customer_id text;
  v_stage text;
  v_matched boolean := false;
  c jsonb;
  i int;
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

  -- Contact fields are filled from the client by leads_copy_client_contact.
  v_deal_services := case when cardinality(v_services) > 0 then v_services else array[''] end;
  for i in 1 .. cardinality(v_deal_services) loop
    v_lead_id := case when i = 1 then p->>'lead_id' else (p->>'lead_id') || '_' || i end;
    insert into leads (id, company_id, customer_id, name, stage_id, service_type, value, source)
    values (v_lead_id, v_company, v_customer_id, p->>'name', coalesce(v_stage, 'new'), v_deal_services[i], 0, 'Booking page');
    v_lead_ids := v_lead_ids || v_lead_id;
  end loop;

  insert into booking_requests (id, company_id, customer_id, lead_id, services, details, preferred_date, preferred_period, notes, heard_from,
                                utm_source, utm_medium, utm_campaign, utm_term, utm_content, page_url, ip, user_agent)
  values (p->>'request_id', v_company, v_customer_id, v_lead_ids[1], v_services, coalesce(p->'details', '{}'::jsonb),
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
          jsonb_build_object('name', p->>'name', 'services', to_jsonb(v_services), 'lead_id', v_lead_ids[1],
                             'lead_ids', to_jsonb(v_lead_ids), 'existing_client', v_matched));

  return jsonb_build_object('customer_id', v_customer_id, 'lead_id', v_lead_ids[1], 'lead_ids', to_jsonb(v_lead_ids),
                            'request_id', p->>'request_id', 'existing_client', v_matched);
end;
$$;
revoke execute on function submit_booking(jsonb) from public;
grant execute on function submit_booking(jsonb) to service_role;
