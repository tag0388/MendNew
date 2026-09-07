-- ============================================================================
-- accept_invitation: the expiry branch marked the row 'expired' and then
-- raised. Both ran in the same transaction, so the RAISE rolled the UPDATE
-- back and the status never changed -- the write was unreachable by
-- construction. expires_at is the real guard, so the token is simply refused
-- and the status is left alone.
--
-- invitation_status_view exposes the derived expiry to the admin screen
-- without needing a background job to sweep statuses.
-- ============================================================================

create or replace function accept_invitation(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv        invitations%rowtype;
  user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into inv from invitations
   where token = invite_token and status = 'pending'
   for update;

  if not found then
    raise exception 'Invitation not found or already used';
  end if;

  if inv.expires_at < now() then
    raise exception 'This invitation has expired. Please ask for a new one.';
  end if;

  if lower(inv.email) <> user_email then
    raise exception 'This invitation was sent to %', inv.email;
  end if;

  insert into enterprise_members (enterprise_id, user_id, role)
  values (inv.enterprise_id, auth.uid(), inv.role)
  on conflict (enterprise_id, user_id) do nothing;

  update invitations
     set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
   where id = inv.id;

  return inv.enterprise_id;
end;
$$;

revoke all on function accept_invitation(text) from public, anon;
grant execute on function accept_invitation(text) to authenticated;

create or replace view invitation_status_view
with (security_invoker = true) as
  select i.*,
         (i.status = 'pending' and i.expires_at < now()) as is_expired
    from invitations i;

grant select on invitation_status_view to authenticated;
