-- ============================================================================
-- Membership integrity and cost-code scoping
--
-- Two rules from the product model that the schema did not yet enforce:
--
--   5. "Each Project will have 1 or more users assigned to the project FROM THE
--      LIST OF ENTERPRISE USERS" -- nothing stopped a project_members row
--      naming someone who was not a member of the owning enterprise.
--
--   8. "Each cost code will have 1 or more users assigned to it to update it"
--      -- but auth_can_access_project() let any project member read and write
--      every cost code, so a Project User saw the whole project.
--
-- Both are enforced declaratively with composite foreign keys rather than
-- triggers, so the database rejects an inconsistent row outright and removing
-- someone from an enterprise cascades through their project and cost code
-- assignments automatically.
-- ============================================================================

-- ------------------------------------------- project members ⊆ enterprise ----

alter table projects
  add constraint projects_id_enterprise_key unique (id, enterprise_id);

alter table project_members
  add column enterprise_id uuid not null;

-- The project must really belong to this enterprise ...
alter table project_members
  add constraint project_members_project_enterprise_fkey
  foreign key (project_id, enterprise_id)
  references projects (id, enterprise_id) on delete cascade;

-- ... and the user must really be a member of it.
alter table project_members
  add constraint project_members_enterprise_member_fkey
  foreign key (enterprise_id, user_id)
  references enterprise_members (enterprise_id, user_id) on delete cascade;

-- ------------------------------------------- cost code users ⊆ project ----

alter table cost_codes
  add constraint cost_codes_id_project_key unique (id, project_id);

alter table cost_code_users
  add column project_id uuid not null;

alter table cost_code_users
  add constraint cost_code_users_cost_code_project_fkey
  foreign key (cost_code_id, project_id)
  references cost_codes (id, project_id) on delete cascade;

alter table cost_code_users
  add constraint cost_code_users_project_member_fkey
  foreign key (project_id, user_id)
  references project_members (project_id, user_id) on delete cascade;

-- ---------------------------------------------- creator bootstrapping ----
-- The seeding triggers must now supply the enterprise, and a project creator
-- must be an enterprise member before they can be a project member.

create or replace function grant_project_creator_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    -- Platform admins can create a project in an enterprise they do not
    -- belong to; give them the membership the FK requires.
    insert into enterprise_members (enterprise_id, user_id, role)
    values (new.enterprise_id, auth.uid(), 'Enterprise System Admin')
    on conflict (enterprise_id, user_id) do nothing;

    insert into project_members (project_id, enterprise_id, user_id, role)
    values (new.id, new.enterprise_id, auth.uid(), 'Project Admin')
    on conflict (project_id, user_id) do update
      set role = 'Project Admin';
  end if;
  return new;
end;
$$;

revoke all on function grant_project_creator_admin() from public, anon, authenticated;

-- --------------------------------------------------- cost code access ----
-- A project admin reaches every cost code in the project; everyone else
-- reaches only the cost codes they are explicitly assigned to.

create or replace function auth_can_access_cost_code(cc_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from cost_codes c
                  where c.id = cc_id and auth_is_project_admin(c.project_id))
      or exists (select 1 from cost_code_users cu
                  where cu.cost_code_id = cc_id and cu.user_id = auth.uid());
$$;

revoke all on function auth_can_access_cost_code(uuid) from public, anon;
grant execute on function auth_can_access_cost_code(uuid) to authenticated;

-- Cost codes themselves: assigned users may read and update their own; only
-- project admins may create or delete.
drop policy cost_codes_select on cost_codes;
drop policy cost_codes_insert on cost_codes;
drop policy cost_codes_update on cost_codes;
drop policy cost_codes_delete on cost_codes;

create policy cost_codes_select on cost_codes
  for select to authenticated
  using (auth_is_project_admin(project_id) or auth_can_access_cost_code(id));
create policy cost_codes_insert on cost_codes
  for insert to authenticated with check (auth_is_project_admin(project_id));
create policy cost_codes_update on cost_codes
  for update to authenticated
  using (auth_is_project_admin(project_id) or auth_can_access_cost_code(id))
  with check (auth_is_project_admin(project_id) or auth_can_access_cost_code(id));
create policy cost_codes_delete on cost_codes
  for delete to authenticated using (auth_is_project_admin(project_id));

-- Everything hanging off a cost code inherits that reach.
do $$
declare t text;
begin
  foreach t in array array[
    'etc_details','cost_phasing','change_records','risk_records'
  ] loop
    execute format('drop policy %I on %I', t || '_select', t);
    execute format('drop policy %I on %I', t || '_insert', t);
    execute format('drop policy %I on %I', t || '_update', t);
    execute format('drop policy %I on %I', t || '_delete', t);
    execute format(
      'create policy %I on %I for select to authenticated using (auth_can_access_cost_code(cost_code_id))',
      t || '_select', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (auth_can_access_cost_code(cost_code_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on %I for update to authenticated using (auth_can_access_cost_code(cost_code_id)) with check (auth_can_access_cost_code(cost_code_id))',
      t || '_update', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (auth_can_access_cost_code(cost_code_id))',
      t || '_delete', t);
  end loop;
end $$;

-- Actuals and baselines stay project-admin-write, but reads narrow to the
-- reader's cost codes.
do $$
declare t text;
begin
  foreach t in array array['actual_costs','baseline_budgets'] loop
    execute format('drop policy %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select to authenticated using (auth_can_access_cost_code(cost_code_id))',
      t || '_select', t);
  end loop;
end $$;
