-- ============================================================================
-- Mend Cost Management -- Row Level Security
--
-- Ports firestore.rules to Postgres policies. The role model is unchanged:
--
--   platform admin    was isSystemAdmin()      -- now a table, not hardcoded emails
--   enterprise admin  was isAdminOfEnterprise()
--   project member    was canAccessProject()
--   project admin     was isProjectAdmin()
--   vendor            was `email in subcontract.vendorUsers`
--
-- Deliberate departures from the Firestore rules, each fixing a hole:
--
--  1. enterprises read was `uid in adminUsers`, so ordinary enterprise users
--     could not read their own enterprise. Any member can now read it.
--  2. procurementStepDefinitions allowed read AND write to *any* signed-in
--     user, across every enterprise. Now scoped to its owner.
--  3. invitations read was `isAuthenticated()`, exposing every pending invite
--     token in the system. Now the invited address or an admin of the
--     inviting enterprise.
--  4. auditLogs create was `isAuthenticated()` with no constraint on the row,
--     so anyone could forge entries against any enterprise. The writer must
--     now be the acting user.
--  5. subcontracts delete tested request.resource.data.projectId, which is
--     null on delete, so deletes could never succeed. Now tests the row.
--
-- Helpers are SECURITY DEFINER so that evaluating a policy does not re-enter
-- RLS on the membership tables (which would recurse), and STABLE so the
-- planner can cache them within a statement.
-- ============================================================================

-- ------------------------------------------------------------- helpers ----

create or replace function auth_is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function auth_is_enterprise_member(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth_is_platform_admin()
      or exists (select 1 from enterprise_members
                  where enterprise_id = eid and user_id = auth.uid());
$$;

create or replace function auth_is_enterprise_admin(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth_is_platform_admin()
      or exists (select 1 from enterprise_members
                  where enterprise_id = eid
                    and user_id = auth.uid()
                    and role = 'Enterprise System Admin');
$$;

create or replace function auth_can_access_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth_is_platform_admin()
      or exists (select 1 from project_members
                  where project_id = pid and user_id = auth.uid())
      or exists (select 1 from projects p
                  where p.id = pid and auth_is_enterprise_admin(p.enterprise_id));
$$;

create or replace function auth_is_project_admin(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth_is_platform_admin()
      or exists (select 1 from project_members
                  where project_id = pid
                    and user_id = auth.uid()
                    and role = 'Project Admin')
      or exists (select 1 from projects p
                  where p.id = pid and auth_is_enterprise_admin(p.enterprise_id));
$$;

-- Vendor contacts are matched by email, since they may have no account yet.
create or replace function auth_is_subcontract_vendor(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subcontracts s
     where s.id = sid
       and lower(coalesce(auth.jwt() ->> 'email', '')) <> ''
       and lower(coalesce(auth.jwt() ->> 'email', '')) in (
             select lower(e) from unnest(s.vendor_users) as e)
  );
$$;

grant execute on function
  auth_is_platform_admin(), auth_is_enterprise_member(uuid),
  auth_is_enterprise_admin(uuid), auth_can_access_project(uuid),
  auth_is_project_admin(uuid), auth_is_subcontract_vendor(uuid)
to authenticated;

-- ------------------------------------------- uniform project-scoped tables ----
-- Any project member may read and write; mirrors canAccessProject() for all
-- four operations, which is what the Firestore rules granted these.

do $$
declare t text;
begin
  foreach t in array array[
    'cost_codes','etc_details','cost_phasing','changes','change_records',
    'risks','risk_records','procurement_items','progress_packages',
    'progress_items','rules_of_credit','schedule_items','reporting_periods',
    'reporting_period_settings','project_resource_rates'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (auth_can_access_project(project_id))',
      t || '_select', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (auth_can_access_project(project_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on %I for update to authenticated using (auth_can_access_project(project_id)) with check (auth_can_access_project(project_id))',
      t || '_update', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (auth_can_access_project(project_id))',
      t || '_delete', t);
  end loop;
end $$;

-- ------------------------------------------ project-admin-write tables ----
-- Members read; only project admins write. Mirrors actualCosts and
-- baselineBudgets.

do $$
declare t text;
begin
  foreach t in array array['actual_costs','baseline_budgets']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (auth_can_access_project(project_id))',
      t || '_select', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (auth_is_project_admin(project_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on %I for update to authenticated using (auth_is_project_admin(project_id)) with check (auth_is_project_admin(project_id))',
      t || '_update', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (auth_is_project_admin(project_id))',
      t || '_delete', t);
  end loop;
end $$;

-- --------------------------------------------------------- user_profiles ----
-- Readable by any signed-in user so that names and avatars render on
-- assignment lists; writable only by the owner.

alter table user_profiles enable row level security;

create policy user_profiles_select on user_profiles
  for select to authenticated using (true);
create policy user_profiles_update on user_profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ------------------------------------------------------- platform_admins ----
-- Visible to platform admins only, and not writable through the API at all --
-- granting this role is a deliberate server-side act (SQL or service role).

alter table platform_admins enable row level security;

create policy platform_admins_select on platform_admins
  for select to authenticated using (auth_is_platform_admin());

-- ----------------------------------------------------------- enterprises ----

alter table enterprises enable row level security;

create policy enterprises_select on enterprises
  for select to authenticated using (auth_is_enterprise_member(id));
-- Any signed-in user may found an enterprise (as the Firestore rules allowed).
create policy enterprises_insert on enterprises
  for insert to authenticated with check (true);
create policy enterprises_update on enterprises
  for update to authenticated
  using (auth_is_enterprise_admin(id)) with check (auth_is_enterprise_admin(id));
create policy enterprises_delete on enterprises
  for delete to authenticated using (auth_is_platform_admin());

alter table enterprise_members enable row level security;

create policy enterprise_members_select on enterprise_members
  for select to authenticated using (auth_is_enterprise_member(enterprise_id));
create policy enterprise_members_insert on enterprise_members
  for insert to authenticated with check (auth_is_enterprise_admin(enterprise_id));
create policy enterprise_members_update on enterprise_members
  for update to authenticated
  using (auth_is_enterprise_admin(enterprise_id))
  with check (auth_is_enterprise_admin(enterprise_id));
create policy enterprise_members_delete on enterprise_members
  for delete to authenticated using (auth_is_enterprise_admin(enterprise_id));

-- Enterprise reference data: members read, admins write.
do $$
declare t text;
begin
  foreach t in array array['resource_rates','vendors'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (auth_is_enterprise_member(enterprise_id))',
      t || '_select', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (auth_is_enterprise_admin(enterprise_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on %I for update to authenticated using (auth_is_enterprise_admin(enterprise_id)) with check (auth_is_enterprise_admin(enterprise_id))',
      t || '_update', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (auth_is_enterprise_admin(enterprise_id))',
      t || '_delete', t);
  end loop;
end $$;

-- -------------------------------------------------------------- projects ----

alter table projects enable row level security;

create policy projects_select on projects
  for select to authenticated using (auth_can_access_project(id));
create policy projects_insert on projects
  for insert to authenticated with check (auth_is_enterprise_admin(enterprise_id));
create policy projects_update on projects
  for update to authenticated
  using (auth_can_access_project(id)) with check (auth_can_access_project(id));
create policy projects_delete on projects
  for delete to authenticated using (auth_is_enterprise_admin(enterprise_id));

alter table project_members enable row level security;

create policy project_members_select on project_members
  for select to authenticated using (auth_can_access_project(project_id));
create policy project_members_insert on project_members
  for insert to authenticated with check (auth_is_project_admin(project_id));
create policy project_members_update on project_members
  for update to authenticated
  using (auth_is_project_admin(project_id)) with check (auth_is_project_admin(project_id));
create policy project_members_delete on project_members
  for delete to authenticated using (auth_is_project_admin(project_id));

-- ------------------------------------------------------- cost_code_users ----
-- Per-cost-code assignment list; reachable through the parent cost code.

alter table cost_code_users enable row level security;

create policy cost_code_users_select on cost_code_users
  for select to authenticated using (exists (
    select 1 from cost_codes c
     where c.id = cost_code_id and auth_can_access_project(c.project_id)));
create policy cost_code_users_write on cost_code_users
  for all to authenticated
  using (exists (select 1 from cost_codes c
                  where c.id = cost_code_id and auth_is_project_admin(c.project_id)))
  with check (exists (select 1 from cost_codes c
                  where c.id = cost_code_id and auth_is_project_admin(c.project_id)));

-- ------------------------------------------------- rule_of_credit_steps ----

alter table rule_of_credit_steps enable row level security;

create policy rule_of_credit_steps_select on rule_of_credit_steps
  for select to authenticated using (exists (
    select 1 from rules_of_credit r
     where r.id = rule_of_credit_id and auth_can_access_project(r.project_id)));
create policy rule_of_credit_steps_write on rule_of_credit_steps
  for all to authenticated
  using (exists (select 1 from rules_of_credit r
                  where r.id = rule_of_credit_id and auth_can_access_project(r.project_id)))
  with check (exists (select 1 from rules_of_credit r
                  where r.id = rule_of_credit_id and auth_can_access_project(r.project_id)));

-- ------------------------------------------------------------- calendars ----
-- Owned by exactly one of an enterprise or a project.

alter table calendars enable row level security;

create policy calendars_select on calendars
  for select to authenticated using (
    (project_id    is not null and auth_can_access_project(project_id)) or
    (enterprise_id is not null and auth_is_enterprise_member(enterprise_id)));
create policy calendars_insert on calendars
  for insert to authenticated with check (
    (project_id    is not null and auth_can_access_project(project_id)) or
    (enterprise_id is not null and auth_is_enterprise_admin(enterprise_id)));
create policy calendars_update on calendars
  for update to authenticated
  using (
    (project_id    is not null and auth_can_access_project(project_id)) or
    (enterprise_id is not null and auth_is_enterprise_admin(enterprise_id)))
  with check (
    (project_id    is not null and auth_can_access_project(project_id)) or
    (enterprise_id is not null and auth_is_enterprise_admin(enterprise_id)));
create policy calendars_delete on calendars
  for delete to authenticated using (
    (project_id    is not null and auth_can_access_project(project_id)) or
    (enterprise_id is not null and auth_is_enterprise_admin(enterprise_id)));

-- ------------------------------------ procurement_step_definitions ----
-- Was readable and writable by every signed-in user across all enterprises.

alter table procurement_step_definitions enable row level security;

create policy procurement_step_definitions_select on procurement_step_definitions
  for select to authenticated using (
    (project_id    is not null and auth_can_access_project(project_id)) or
    (enterprise_id is not null and auth_is_enterprise_member(enterprise_id)));
create policy procurement_step_definitions_insert on procurement_step_definitions
  for insert to authenticated with check (
    (project_id    is not null and auth_is_project_admin(project_id)) or
    (enterprise_id is not null and auth_is_enterprise_admin(enterprise_id)));
create policy procurement_step_definitions_update on procurement_step_definitions
  for update to authenticated
  using (
    (project_id    is not null and auth_is_project_admin(project_id)) or
    (enterprise_id is not null and auth_is_enterprise_admin(enterprise_id)))
  with check (
    (project_id    is not null and auth_is_project_admin(project_id)) or
    (enterprise_id is not null and auth_is_enterprise_admin(enterprise_id)));
create policy procurement_step_definitions_delete on procurement_step_definitions
  for delete to authenticated using (
    (project_id    is not null and auth_is_project_admin(project_id)) or
    (enterprise_id is not null and auth_is_enterprise_admin(enterprise_id)));

-- ---------------------------------------------------------- subcontracts ----
-- Project members read; vendors read their own; project admins write.

alter table subcontracts enable row level security;

create policy subcontracts_select on subcontracts
  for select to authenticated using (
    auth_can_access_project(project_id) or auth_is_subcontract_vendor(id));
create policy subcontracts_insert on subcontracts
  for insert to authenticated with check (auth_is_project_admin(project_id));
create policy subcontracts_update on subcontracts
  for update to authenticated
  using (auth_is_project_admin(project_id)) with check (auth_is_project_admin(project_id));
create policy subcontracts_delete on subcontracts
  for delete to authenticated using (auth_is_project_admin(project_id));

alter table subcontract_line_items enable row level security;

create policy subcontract_line_items_select on subcontract_line_items
  for select to authenticated using (
    auth_can_access_project(project_id) or auth_is_subcontract_vendor(subcontract_id));
create policy subcontract_line_items_insert on subcontract_line_items
  for insert to authenticated with check (auth_is_project_admin(project_id));
create policy subcontract_line_items_update on subcontract_line_items
  for update to authenticated
  using (auth_is_project_admin(project_id)) with check (auth_is_project_admin(project_id));
create policy subcontract_line_items_delete on subcontract_line_items
  for delete to authenticated using (auth_is_project_admin(project_id));

-- -------------------------------------------------------------- invoices ----
-- Vendors may raise an invoice, and may edit or withdraw it only while it is
-- still Draft (or was Rejected back to them). Project admins are unrestricted.

alter table invoices enable row level security;

create policy invoices_select on invoices
  for select to authenticated using (
    auth_can_access_project(project_id) or auth_is_subcontract_vendor(subcontract_id));
create policy invoices_insert on invoices
  for insert to authenticated with check (
    auth_is_project_admin(project_id) or auth_is_subcontract_vendor(subcontract_id));
create policy invoices_update on invoices
  for update to authenticated
  using (
    auth_is_project_admin(project_id) or
    (auth_is_subcontract_vendor(subcontract_id) and status in ('Draft','Rejected')))
  with check (
    auth_is_project_admin(project_id) or
    (auth_is_subcontract_vendor(subcontract_id) and status in ('Draft','Submitted')));
create policy invoices_delete on invoices
  for delete to authenticated using (
    auth_is_project_admin(project_id) or
    (auth_is_subcontract_vendor(subcontract_id) and status = 'Draft'));

alter table invoice_items enable row level security;

-- invoice_items.invoice_id must be qualified below: `invoices` has its own
-- text column named invoice_id (the user-facing number) which would otherwise
-- shadow the outer column inside these subqueries, yielding uuid = text.

create policy invoice_items_select on invoice_items
  for select to authenticated using (exists (
    select 1 from invoices i
     where i.id = invoice_items.invoice_id
       and (auth_can_access_project(i.project_id)
            or auth_is_subcontract_vendor(i.subcontract_id))));
create policy invoice_items_write on invoice_items
  for all to authenticated
  using (exists (
    select 1 from invoices i
     where i.id = invoice_items.invoice_id
       and (auth_is_project_admin(i.project_id)
            or (auth_is_subcontract_vendor(i.subcontract_id)
                and i.status in ('Draft','Rejected')))))
  with check (exists (
    select 1 from invoices i
     where i.id = invoice_items.invoice_id
       and (auth_is_project_admin(i.project_id)
            or (auth_is_subcontract_vendor(i.subcontract_id)
                and i.status in ('Draft','Submitted')))));

-- ----------------------------------------------------------- saved_views ----
-- Strictly per-user.

alter table saved_views enable row level security;

create policy saved_views_select on saved_views
  for select to authenticated using (user_id = auth.uid());
create policy saved_views_insert on saved_views
  for insert to authenticated with check (user_id = auth.uid());
create policy saved_views_update on saved_views
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy saved_views_delete on saved_views
  for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------ audit_logs ----
-- Append-only: no update or delete policy exists, so neither is permitted.
-- The writer must be the acting user, which the original rule did not check.

alter table audit_logs enable row level security;

create policy audit_logs_select on audit_logs
  for select to authenticated using (
    auth_is_platform_admin()
    or (enterprise_id is not null and auth_is_enterprise_admin(enterprise_id)));
create policy audit_logs_insert on audit_logs
  for insert to authenticated with check (user_id = auth.uid());

-- ----------------------------------------------------------- invitations ----
-- Reads are limited to the invited address or an admin of the inviting
-- enterprise. Accepting an invitation is done through a SECURITY DEFINER
-- function rather than a direct update, so that a recipient cannot rewrite
-- the enterprise or role they are being granted.

alter table invitations enable row level security;

create policy invitations_select on invitations
  for select to authenticated using (
    auth_is_enterprise_admin(enterprise_id)
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy invitations_insert on invitations
  for insert to authenticated with check (auth_is_enterprise_admin(enterprise_id));
create policy invitations_update on invitations
  for update to authenticated
  using (auth_is_enterprise_admin(enterprise_id))
  with check (auth_is_enterprise_admin(enterprise_id));
create policy invitations_delete on invitations
  for delete to authenticated using (auth_is_enterprise_admin(enterprise_id));

-- Redeem an invitation token: validates it, adds the caller to the enterprise
-- with the role the inviter chose, and marks the invitation accepted.
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
    update invitations set status = 'expired' where id = inv.id;
    raise exception 'Invitation has expired';
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

grant execute on function accept_invitation(text) to authenticated;

-- --------------------------------------------------- creator bootstrapping ----
-- Founding an enterprise is open to any signed-in user, but adding a member
-- requires already being an admin of it -- so a creator could never grant
-- themselves access. These triggers close that gap, and also replace the
-- client-side `users: { uid: 'Project Admin' }` seeding the app used to do,
-- which a client could otherwise omit or forge.

create or replace function grant_enterprise_creator_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    insert into enterprise_members (enterprise_id, user_id, role)
    values (new.id, auth.uid(), 'Enterprise System Admin')
    on conflict (enterprise_id, user_id) do update
      set role = 'Enterprise System Admin';
  end if;
  return new;
end;
$$;

create trigger enterprises_grant_creator_admin
  after insert on enterprises
  for each row execute function grant_enterprise_creator_admin();

create or replace function grant_project_creator_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    insert into project_members (project_id, user_id, role)
    values (new.id, auth.uid(), 'Project Admin')
    on conflict (project_id, user_id) do update
      set role = 'Project Admin';
  end if;
  return new;
end;
$$;

create trigger projects_grant_creator_admin
  after insert on projects
  for each row execute function grant_project_creator_admin();

-- ------------------------------------------------- function exposure ----
-- Postgres grants EXECUTE to PUBLIC by default, which publishes every
-- function in `public` as a PostgREST RPC endpoint under /rest/v1/rpc/.

alter function set_updated_at() set search_path = public;

-- Trigger functions must never be callable as RPC.
revoke all on function handle_new_user()                 from public, anon, authenticated;
revoke all on function set_updated_at()                  from public, anon, authenticated;
revoke all on function grant_enterprise_creator_admin()  from public, anon, authenticated;
revoke all on function grant_project_creator_admin()     from public, anon, authenticated;

-- Policy expressions are evaluated as the querying role, so `authenticated`
-- must keep EXECUTE on the helpers. `anon` never needs them: every policy is
-- scoped `to authenticated`.
revoke all on function auth_is_platform_admin()         from public, anon;
revoke all on function auth_is_enterprise_member(uuid)  from public, anon;
revoke all on function auth_is_enterprise_admin(uuid)   from public, anon;
revoke all on function auth_can_access_project(uuid)    from public, anon;
revoke all on function auth_is_project_admin(uuid)      from public, anon;
revoke all on function auth_is_subcontract_vendor(uuid) from public, anon;

grant execute on function
  auth_is_platform_admin(), auth_is_enterprise_member(uuid),
  auth_is_enterprise_admin(uuid), auth_can_access_project(uuid),
  auth_is_project_admin(uuid), auth_is_subcontract_vendor(uuid)
to authenticated;

revoke all on function accept_invitation(text) from public, anon;
grant execute on function accept_invitation(text) to authenticated;
