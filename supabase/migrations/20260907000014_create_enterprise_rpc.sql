-- ============================================================================
-- Founding an enterprise could not work through a plain insert.
--
-- The client inserted the row and read it back in one request. With RLS,
-- INSERT ... RETURNING applies the SELECT policy to the returned row, and
-- that policy is "you may read an enterprise you are a member of". The
-- creator's membership is written by an AFTER INSERT trigger, which has not
-- fired at the point RETURNING is evaluated -- so the creator was not yet a
-- member of the enterprise they had just created, and the whole statement
-- failed with "new row violates row-level security policy".
--
-- The insert alone succeeded; only the read-back failed, which is what made
-- it confusing: nothing appeared to be wrong with the write.
--
-- Relying on trigger timing for a read-back is the flaw, so founding an
-- enterprise becomes one explicit operation: create the row, grant the
-- creator the admin role, return the id.
--
-- Note this pattern is safe elsewhere. projects and cost_codes are also read
-- back after insert, but their SELECT policies pass through the enterprise
-- admin and project admin branches, which do not depend on any trigger.
-- ============================================================================

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

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Please enter a name for your enterprise';
  end if;

  -- Derive a code from the name when the caller does not supply one.
  code := upper(btrim(coalesce(nullif(btrim(p_code), ''), p_name)));
  code := regexp_replace(code, '[^A-Z0-9]+', '-', 'g');
  code := btrim(left(regexp_replace(code, '^-+|-+$', '', 'g'), 40), '-');
  if code = '' then
    code := 'ENT';
  end if;

  -- enterprise_code is unique, so a clash is reported plainly rather than
  -- surfacing as a raw constraint violation.
  if exists (select 1 from enterprises where enterprise_code = code) then
    raise exception 'An enterprise with the code "%" already exists. Try a different name.', code;
  end if;

  insert into enterprises (name, enterprise_code, created_by)
  values (btrim(p_name), code, auth.uid())
  returning id into new_id;

  insert into enterprise_members (enterprise_id, user_id, role)
  values (new_id, auth.uid(), 'Enterprise System Admin')
  on conflict (enterprise_id, user_id) do update
    set role = 'Enterprise System Admin';

  return new_id;
end;
$$;

revoke all on function create_enterprise(text, text) from public, anon;
grant execute on function create_enterprise(text, text) to authenticated;
