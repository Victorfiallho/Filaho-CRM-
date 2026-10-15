-- Security audit run-3 (2026-10-15) fixes.

-- 1. integration_settings: rebuild every per-company dict from the stored
-- row (other companies' entries) plus the payload (only the caller's own
-- companies), whatever the payload contains. The previous guard only looked
-- at keys already stored, and its jsonb_set did nothing when a parent object
-- was missing, so one member could add or wipe other companies' entries.
create or replace function enforce_integration_settings_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  my_companies text[];
  scoped_paths text[][] := array[
    array['google_calendar', 'calendar_ids'],
    array['google_sheets', 'spreadsheet_ids'],
    array['google_sheets', 'source_urls'],
    array['google_drive', 'folder_ids'],
    array['google_drive', 'folder_urls'],
    array['meta_ads', 'ad_account_ids']
  ];
  path text[];
  old_dict jsonb;
  new_dict jsonb;
  merged jsonb;
  k text;
begin
  -- service_role (background scripts) has no end-user JWT and isn't limited.
  if auth.uid() is null then
    return new;
  end if;
  if jsonb_typeof(new.settings) is distinct from 'object' then
    raise exception 'settings must be a JSON object';
  end if;

  select coalesce(array_agg(company_id), array[]::text[]) into my_companies
  from company_members where user_id = auth.uid();

  foreach path slice 1 in array scoped_paths loop
    old_dict := case when jsonb_typeof(old.settings #> path) = 'object' then old.settings #> path else '{}'::jsonb end;
    new_dict := case when jsonb_typeof(new.settings #> path) = 'object' then new.settings #> path else '{}'::jsonb end;
    merged := '{}'::jsonb;
    for k in select jsonb_object_keys(old_dict) loop
      if not (k = any(my_companies)) then merged := merged || jsonb_build_object(k, old_dict -> k); end if;
    end loop;
    for k in select jsonb_object_keys(new_dict) loop
      if k = any(my_companies) then merged := merged || jsonb_build_object(k, new_dict -> k); end if;
    end loop;
    if jsonb_typeof(new.settings -> path[1]) is distinct from 'object' then
      new.settings := jsonb_set(new.settings, array[path[1]], '{}'::jsonb, true);
    end if;
    new.settings := jsonb_set(new.settings, path, merged, true);
  end loop;
  return new;
end;
$$;
revoke execute on function enforce_integration_settings_scope() from public, anon, authenticated;

-- 2. quotes were the only tenant tables without the company_id pin.
drop trigger if exists quotes_pin_company_id on quotes;
create trigger quotes_pin_company_id before update on quotes for each row execute function pin_company_id();
drop trigger if exists quote_items_pin_company_id on quote_items;
create trigger quote_items_pin_company_id before update on quote_items for each row execute function pin_company_id();

-- 3. submit_booking no longer fills an existing client's empty fields.
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
    -- An anonymous form must not write onto an existing client: matching on
    -- one channel and filling the other would let a stranger attach their
    -- own phone/email to someone else's record. What they typed goes to the
    -- activity entry below for staff to review.
    update customers set updated_at = now() where id = v_customer_id;
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
                             'visit_date', v_visit_date, 'visit_period', v_period)
          || case when v_matched then jsonb_build_object('submitted_phone', p->>'phone', 'submitted_email', p->>'email',
                                                         'submitted_address', concat_ws(', ', p->>'address', p->>'city', p->>'state', p->>'zip'))
                  else '{}'::jsonb end);

  return jsonb_build_object('customer_id', v_customer_id, 'lead_id', v_lead_ids[1], 'lead_ids', to_jsonb(v_lead_ids),
                            'request_id', p->>'request_id', 'existing_client', v_matched);
end;
$$;
revoke execute on function submit_booking(jsonb) from public;
grant execute on function submit_booking(jsonb) to service_role;

-- 4. Consent badge: only count consent given for the client's CURRENT phone
-- and email. A booking matched to an existing client records consent for
-- whatever number the visitor typed, which may not be the client's.
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
    select distinct on (cr.contact_id, cr.channel, lower(cr.value)) cr.contact_id, cr.channel, lower(cr.value) as value, cr.granted, cr.created_at
    from consent_records cr
    where cr.company_id = p_company_id and cr.contact_id is not null
    order by cr.contact_id, cr.channel, lower(cr.value), cr.created_at desc
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
  left join latest ls on ls.contact_id = c.id and ls.channel = 'sms' and ls.value = lower(c.phone_e164)
  left join latest le on le.contact_id = c.id and le.channel = 'email' and le.value = lower(c.email)
  where c.company_id = p_company_id and exists (select 1 from me);
$$;
revoke execute on function get_contact_consent_status(text) from public;
grant execute on function get_contact_consent_status(text) to authenticated;
