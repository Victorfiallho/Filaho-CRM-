-- Everyone gets a `users` profile, and everyone can rename themselves.
--
-- Profiles were only created from the Users screen (owners), so a login
-- without one showed up as "System" in the activity feed and had no way to
-- fix its own name. `users` has no insert/update policy on purpose (role and
-- permissions must stay owner-only), so both writes go through these
-- functions, which only ever touch the caller's own row and never role or
-- permissions.

-- Called by the app after sign-in. Returns the caller's profile, creating
-- it when missing: a profile with the caller's email and no login yet is
-- claimed (an owner may have created it before the first sign-in);
-- otherwise a new one is named from the Google name or the email. Only for
-- company members, so a stray Google sign-up gets nothing.
create or replace function ensure_my_profile()
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_row users;
begin
  if v_uid is null then return null; end if;

  select * into v_row from users where auth_user_id = v_uid limit 1;
  if found then return v_row; end if;

  if not exists (select 1 from company_members where user_id = v_uid) then return null; end if;

  select au.email,
         coalesce(nullif(trim(au.raw_user_meta_data->>'full_name'), ''), nullif(trim(au.raw_user_meta_data->>'name'), ''), split_part(au.email, '@', 1))
    into v_email, v_name
  from auth.users au where au.id = v_uid;
  if v_email is null then return null; end if;

  update users set auth_user_id = v_uid
  where lower(email) = lower(v_email)
    and (auth_user_id is null or not exists (select 1 from auth.users au where au.id = users.auth_user_id))
  returning * into v_row;
  if found then return v_row; end if;

  -- Another live login already owns this email's profile: leave it alone.
  if exists (select 1 from users where lower(email) = lower(v_email)) then return null; end if;

  insert into users (id, auth_user_id, name, email, role, permissions)
  values (v_uid::text, v_uid, left(v_name, 80), v_email, 'member', '{}')
  returning * into v_row;
  return v_row;
end;
$$;

-- Renames the caller's own profile. Nothing else is writable here.
create or replace function update_my_profile(p_name text)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_row users;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'name must be 2 to 80 characters';
  end if;
  update users set name = v_name where auth_user_id = auth.uid() returning * into v_row;
  if not found then raise exception 'no profile for this login'; end if;
  return v_row;
end;
$$;

revoke execute on function ensure_my_profile() from public;
revoke execute on function update_my_profile(text) from public;
grant execute on function ensure_my_profile() to authenticated;
grant execute on function update_my_profile(text) to authenticated;
