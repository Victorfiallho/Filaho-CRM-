-- Booking page A/B test (web/api/_lib/abTest.js).
--
-- Variant "a" is the page as it was; "b" puts the form under the title and
-- asks for contact details in step 2. Each visitor keeps one variant; each
-- booking records it (booking_requests.ab_variant), and page views are
-- counted per day, page and variant (bots excluded in book.js). The view
-- booking_ab_results puts the two side by side. Server-only: the booking
-- page writes with the service_role key; nothing here is granted to app users.

alter table booking_requests add column if not exists ab_variant text not null default ''
  check (ab_variant in ('', 'a', 'b'));

create table if not exists booking_page_views (
  day date not null default current_date,
  slug text not null,
  variant text not null check (variant in ('a', 'b')),
  views integer not null default 0,
  primary key (day, slug, variant)
);
alter table booking_page_views enable row level security;
revoke all on booking_page_views from anon, authenticated;

create or replace function count_booking_view(p_slug text, p_variant text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into booking_page_views (day, slug, variant, views)
  values ((now() at time zone 'America/New_York')::date, p_slug, p_variant, 1)
  on conflict (day, slug, variant) do update set views = booking_page_views.views + 1;
$$;
revoke execute on function count_booking_view(text, text) from public, anon, authenticated;
grant execute on function count_booking_view(text, text) to service_role;

-- Visits, bookings and conversion per page and variant since the test began.
create or replace view booking_ab_results with (security_invoker = true) as
with v as (
  select slug, variant, sum(views)::int as views, min(day) as since
  from booking_page_views group by slug, variant
), b as (
  select bp.slug, br.ab_variant as variant, count(*)::int as bookings
  from booking_requests br join booking_pages bp on bp.company_id = br.company_id
  where br.ab_variant in ('a', 'b')
  group by bp.slug, br.ab_variant
)
select v.slug, v.variant, v.since, v.views, coalesce(b.bookings, 0) as bookings,
       round(100.0 * coalesce(b.bookings, 0) / nullif(v.views, 0), 2) as conversion_pct
from v left join b on b.slug = v.slug and b.variant = v.variant
order by v.slug, v.variant;
revoke all on booking_ab_results from anon, authenticated;

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

  -- Origin of THIS request, on this request and its new deals: a returning
  -- client keeps each earlier booking's origin on that booking.
  insert into booking_requests (id, company_id, customer_id, lead_id, lead_ids, services, details, preferred_date, preferred_period, notes, heard_from,
                                utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                                campaign_id, adset_id, ad_id, placement, ab_variant, page_url, ip, user_agent)
  values (p->>'request_id', v_company, v_customer_id, v_lead_ids[1], v_lead_ids, v_services, coalesce(p->'details', '{}'::jsonb),
          v_visit_date, v_period, coalesce(p->>'notes', ''), coalesce(p->>'heard_from', ''),
          coalesce(p->'utm'->>'utm_source', ''), coalesce(p->'utm'->>'utm_medium', ''), coalesce(p->'utm'->>'utm_campaign', ''),
          coalesce(p->'utm'->>'utm_term', ''), coalesce(p->'utm'->>'utm_content', ''),
          coalesce(p->'utm'->>'campaign_id', ''), coalesce(p->'utm'->>'adset_id', ''), coalesce(p->'utm'->>'ad_id', ''),
          coalesce(p->'utm'->>'placement', ''),
          coalesce(nullif(p->>'ab_variant', ''), ''),
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
