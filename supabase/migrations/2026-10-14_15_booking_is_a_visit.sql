-- The booking page schedules a free visit, not the work itself. The
-- business process is: the client books a visit, the company sends the
-- quote, then they agree on the date for the work.
--
-- 1. Every company gets a "Visit Scheduled" stage right after "Contacted".
-- 2. A booking creates its deals in that stage, with the next step "Visit"
--    on the date (and period) the client picked, so the visit shows up in
--    My day and in the overdue follow-ups.
-- 3. Deals already booked online and still in "New" move there too.

-- ── 1. the stage ─────────────────────────────────────────────────────────
update pipeline_stages s set "order" = s."order" + 1
where s."order" > (select c."order" from pipeline_stages c where c.company_id = s.company_id and c.id = 'contacted')
  and not exists (select 1 from pipeline_stages v where v.company_id = s.company_id and v.id = 'visit');

insert into pipeline_stages (id, company_id, name, "order", color, type, win_probability)
select 'visit', c.company_id, 'Visit Scheduled', c."order" + 1, '#7a5af8', 'open', 0.5
from pipeline_stages c
where c.id = 'contacted'
on conflict (company_id, id) do nothing;

-- ── 2. bookings create visit deals ───────────────────────────────────────
-- Same as 2026-10-14_14 except the stage and the next step.
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
  v_visit_date date := nullif(p->>'preferred_date', '')::date;
  v_period text := nullif(p->>'preferred_period', '');
  v_next_action text;
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

  -- "Visit Scheduled", else "new", else the first stage.
  select id into v_stage from pipeline_stages where company_id = v_company and id = 'visit';
  if v_stage is null then
    select id into v_stage from pipeline_stages where company_id = v_company and id = 'new';
  end if;
  if v_stage is null then
    select id into v_stage from pipeline_stages where company_id = v_company order by "order" limit 1;
  end if;

  v_next_action := case
    when v_visit_date is null then 'Schedule the visit'
    when v_period = 'morning' then 'Visit (morning)'
    when v_period = 'afternoon' then 'Visit (afternoon)'
    else 'Visit'
  end;

  -- Contact fields are filled from the client by leads_copy_client_contact.
  v_deal_services := case when cardinality(v_services) > 0 then v_services else array[''] end;
  for i in 1 .. cardinality(v_deal_services) loop
    v_lead_id := case when i = 1 then p->>'lead_id' else (p->>'lead_id') || '_' || i end;
    insert into leads (id, company_id, customer_id, name, stage_id, service_type, value, source, next_action, next_action_date)
    values (v_lead_id, v_company, v_customer_id, p->>'name', coalesce(v_stage, 'new'), v_deal_services[i], 0, 'Booking page',
            v_next_action, v_visit_date);
    v_lead_ids := v_lead_ids || v_lead_id;
  end loop;

  insert into booking_requests (id, company_id, customer_id, lead_id, services, details, preferred_date, preferred_period, notes, heard_from,
                                utm_source, utm_medium, utm_campaign, utm_term, utm_content, page_url, ip, user_agent)
  values (p->>'request_id', v_company, v_customer_id, v_lead_ids[1], v_services, coalesce(p->'details', '{}'::jsonb),
          v_visit_date, v_period, coalesce(p->>'notes', ''), coalesce(p->>'heard_from', ''),
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
                             'lead_ids', to_jsonb(v_lead_ids), 'existing_client', v_matched,
                             'visit_date', v_visit_date, 'visit_period', v_period));

  return jsonb_build_object('customer_id', v_customer_id, 'lead_id', v_lead_ids[1], 'lead_ids', to_jsonb(v_lead_ids),
                            'request_id', p->>'request_id', 'existing_client', v_matched);
end;
$$;
revoke execute on function submit_booking(jsonb) from public;
grant execute on function submit_booking(jsonb) to service_role;

-- ── 3. deals already booked online ───────────────────────────────────────
update leads l set
  stage_id = 'visit',
  next_action = case
    when b.preferred_date is null then 'Schedule the visit'
    when b.preferred_period = 'morning' then 'Visit (morning)'
    when b.preferred_period = 'afternoon' then 'Visit (afternoon)'
    else 'Visit'
  end,
  next_action_date = b.preferred_date
from booking_requests b
where b.lead_id = l.id
  and l.stage_id = 'new'
  and coalesce(l.next_action, '') = ''
  and exists (select 1 from pipeline_stages s where s.company_id = l.company_id and s.id = 'visit');
