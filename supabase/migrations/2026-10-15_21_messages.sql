-- Messages: one conversation per client, over SMS (Twilio) or email (Resend).
--
-- Rows are written only by the server (web/api/messages.js sends,
-- web/api/sms-inbound.js receives), never by the app directly, so nobody can
-- fake a client's reply or a "sent" message. Members of the company can read
-- them and mark replies as read through mark_messages_read().

create table if not exists messages (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  customer_id text references customers(id) on delete set null,
  channel text not null check (channel in ('sms', 'email')),
  direction text not null check (direction in ('out', 'in')),
  to_addr text not null default '',
  from_addr text not null default '',
  subject text not null default '',
  body text not null,
  status text not null default 'sent' check (status in ('sent', 'failed', 'received')),
  error text,
  provider_id text,
  sent_by uuid references auth.users(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_thread_idx on messages (company_id, customer_id, created_at desc);
create index if not exists messages_recent_idx on messages (company_id, created_at desc);
-- Inbound routing: which company last texted this number.
create index if not exists messages_out_sms_idx on messages (to_addr, created_at desc) where channel = 'sms' and direction = 'out';

alter table messages enable row level security;
drop policy if exists messages_select on messages;
create policy messages_select on messages for select using (
  company_id in (select company_id from company_members where user_id = auth.uid())
);
revoke insert, update, delete on messages from anon, authenticated;

create or replace function mark_messages_read(p_company_id text, p_customer_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update messages set read_at = now()
  where company_id = p_company_id and customer_id = p_customer_id and direction = 'in' and read_at is null
    and exists (select 1 from company_members where user_id = auth.uid() and company_id = p_company_id);
$$;
revoke execute on function mark_messages_read(text, text) from public, anon;
grant execute on function mark_messages_read(text, text) to authenticated;

-- Each company's own sending identity. Set by an operator in SQL (like the
-- booking page contact details); empty values fall back to the server env
-- (TWILIO_FROM_NUMBER, RESEND_FROM_EMAIL).
create table if not exists company_messaging (
  company_id text primary key references companies(id) on delete cascade,
  sms_from text not null default '' check (sms_from = '' or sms_from ~ '^\+[1-9][0-9]{7,14}$'),
  email_from text not null default '',
  email_reply_to text not null default ''
);
alter table company_messaging enable row level security;
drop policy if exists company_messaging_select on company_messaging;
create policy company_messaging_select on company_messaging for select using (
  company_id in (select company_id from company_members where user_id = auth.uid())
);
revoke insert, update, delete on company_messaging from anon, authenticated;
insert into company_messaging (company_id) select id from companies on conflict (company_id) do nothing;
