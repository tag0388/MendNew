-- ============================================================================
-- Only the system owner creates enterprises.
--
-- The first pass let any signed-in user create one, which contradicts the
-- product model: the system owner creates an enterprise and appoints its
-- admins, and those admins then invite their own users. A user who belongs to
-- no enterprise should see nothing and wait to be invited -- there is no
-- "create your own" path for them at all.
--
-- platform_admins already existed for exactly this; enterprise creation just
-- was not gated on it.
-- ============================================================================

drop policy enterprises_insert on enterprises;

create policy enterprises_insert on enterprises
  for insert to authenticated
  with check (auth_is_platform_admin());

create or replace function create_enterprise(p_name text, p_code text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  code   text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create an enterprise';
  end if;

  -- SECURITY DEFINER bypasses the policy above, so the check is repeated here.
  if not auth_is_platform_admin() then
    raise exception 'Only the system owner can create an enterprise';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Please enter a name for your enterprise';
  end if;

  code := upper(btrim(coalesce(nullif(btrim(p_code), ''), p_name)));
  code := regexp_replace(code, '[^A-Z0-9]+', '-', 'g');
  code := btrim(left(regexp_replace(code, '^-+|-+$', '', 'g'), 40), '-');
  if code = '' then
    code := 'ENT';
  end if;

  if exists (select 1 from enterprises where enterprise_code = code) then
    raise exception 'An enterprise with the code "%" already exists. Try a different name.', code;
  end if;

  insert into enterprises (name, enterprise_code, created_by)
  values (btrim(p_name), code, auth.uid())
  returning id into new_id;

  -- The system owner becomes a member so they can administer what they
  -- created. Handing the enterprise to its own admins is a separate,
  -- deliberate act: an invitation carrying the Enterprise System Admin role.
  insert into enterprise_members (enterprise_id, user_id, role)
  values (new_id, auth.uid(), 'Enterprise System Admin')
  on conflict (enterprise_id, user_id) do update
    set role = 'Enterprise System Admin';

  return new_id;
end;
$$;

revoke all on function create_enterprise(text, text) from public, anon;
grant execute on function create_enterprise(text, text) to authenticated;

-- Seeding the first system owner is a deliberate server-side act, which is
-- why platform_admins has no INSERT policy. Add yours by hand:
--
--   insert into platform_admins (user_id)
--   select id from auth.users where lower(email) = 'you@example.com'
--   on conflict do nothing;
