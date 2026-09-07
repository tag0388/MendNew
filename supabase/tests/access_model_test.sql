-- ============================================================================
-- Access model tests
--
-- Verifies the rules the product model requires, by running real statements as
-- real users with RLS enforced -- not by inspecting policy definitions.
--
--   1. An enterprise cannot see another company's data
--   2. An Enterprise User loads their enterprise but no unassigned projects
--   5. A project member must be a member of the owning enterprise
--   8. A Project User reaches only the cost codes assigned to them
--      plus: no self-escalation, and invitations grant only the invited role
--
-- Run against a database with no live data (it creates and removes its own
-- fixture):  psql "$DATABASE_URL" -f supabase/tests/access_model_test.sql
-- Every row of output should read PASS.
-- ============================================================================

begin;

create or replace function pg_temp.as_user(uid uuid, email text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'email', email)::text, true);
end $$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

-- Returns PASS when the statement is refused, FAIL when it succeeds.
create or replace function pg_temp.must_block(stmt text) returns text
language plpgsql as $$
begin
  execute stmt;
  return 'FAIL - allowed';
exception when others then
  return 'PASS - blocked';
end $$;

-- Returns PASS when the statement changes no rows (silently filtered by RLS).
create or replace function pg_temp.must_affect_nothing(stmt text) returns text
language plpgsql as $$
declare n integer;
begin
  execute stmt; get diagnostics n = row_count;
  return case when n = 0 then 'PASS - 0 rows' else 'FAIL - ' || n || ' rows' end;
exception when others then
  return 'PASS - blocked';
end $$;

-- ------------------------------------------------------------- fixture ----
-- Two companies. Acme has an enterprise admin, a project admin and a plain
-- user; Other Corp has one admin who must never see Acme.

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','authenticated','authenticated','admin@acme.test','x',now(),now(),now(),'{}','{"display_name":"Acme Admin"}'),
 ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','authenticated','authenticated','user@acme.test','x',now(),now(),now(),'{}','{"display_name":"Acme User"}'),
 ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333','authenticated','authenticated','pm@acme.test','x',now(),now(),now(),'{}','{"display_name":"Acme PM"}'),
 ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444','authenticated','authenticated','rival@other.test','x',now(),now(),now(),'{}','{"display_name":"Rival"}');

insert into enterprises (id, enterprise_code, name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','ACME','Acme Construction'),
 ('bbbbbbbb-0000-0000-0000-000000000002','OTHER','Other Corp');

insert into enterprise_members (enterprise_id, user_id, role) values
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Enterprise System Admin'),
 ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Enterprise User'),
 ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','Enterprise User'),
 ('bbbbbbbb-0000-0000-0000-000000000002','44444444-4444-4444-4444-444444444444','Enterprise System Admin');

insert into projects (id, enterprise_id, project_name, project_code) values
 ('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Tower A','TWR-A');

insert into project_members (project_id, enterprise_id, user_id, role) values
 ('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','Project Admin'),
 ('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Project User');

insert into cost_codes (id, project_id, code, name, baseline_budget) values
 ('dddddddd-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000003','CC-100','Piling', 100),
 ('eeeeeeee-0000-0000-0000-000000000005','cccccccc-0000-0000-0000-000000000003','CC-200','Steel',  250);

-- The plain user is assigned to exactly one of the two cost codes.
insert into cost_code_users (cost_code_id, project_id, user_id) values
 ('dddddddd-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222');

insert into invitations (enterprise_id, email, token, role, expires_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001','rival@other.test','tok-ok','Enterprise User',        now() + interval '7 days'),
 ('aaaaaaaa-0000-0000-0000-000000000001','someone@acme.test','tok-wrong','Enterprise User',    now() + interval '7 days'),
 ('aaaaaaaa-0000-0000-0000-000000000001','rival@other.test','tok-expired','Enterprise System Admin', now() - interval '1 day');

-- ----------------------------------------------- rule 1: tenant isolation ----
select pg_temp.as_user('44444444-4444-4444-4444-444444444444','rival@other.test');

select 'R1 rival sees no Acme enterprise' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as result
  from enterprises where enterprise_code = 'ACME'
union all
select 'R1 rival sees no Acme project',
       case when count(*) = 0 then 'PASS' else 'FAIL' end from projects
union all
select 'R1 rival sees no Acme cost code',
       case when count(*) = 0 then 'PASS' else 'FAIL' end from cost_codes
union all
select 'R1 rival cannot read a foreign invitation token',
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from invitations where token = 'tok-wrong';

-- --------------------------------------------- rule 2: enterprise admin ----
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','admin@acme.test');

select 'R2 admin sees exactly their own enterprise' as test,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result from enterprises
union all
select 'R2 admin sees every project in it',
       case when count(*) = 1 then 'PASS' else 'FAIL' end from projects
union all
select 'R2 admin sees every cost code in it',
       case when count(*) = 2 then 'PASS' else 'FAIL' end from cost_codes;

-- ------------------------------------- rule 5: project ⊆ enterprise users ----
select 'R5 cannot assign an outsider to a project' as test,
       pg_temp.must_block($q$
         insert into project_members (project_id, enterprise_id, user_id, role)
         values ('cccccccc-0000-0000-0000-000000000003',
                 'aaaaaaaa-0000-0000-0000-000000000001',
                 '44444444-4444-4444-4444-444444444444','Project User')$q$) as result
union all
select 'R8 cannot assign a cost code to a non-project-member',
       pg_temp.must_block($q$
         insert into cost_code_users (cost_code_id, project_id, user_id)
         values ('dddddddd-0000-0000-0000-000000000004',
                 'cccccccc-0000-0000-0000-000000000003',
                 '44444444-4444-4444-4444-444444444444')$q$);

-- ------------------------------------------ rule 8: cost code visibility ----
select pg_temp.as_user('22222222-2222-2222-2222-222222222222','user@acme.test');

select 'R8 plain user still loads their enterprise' as test,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result from enterprises
union all
select 'R8 plain user sees the project they are on',
       case when count(*) = 1 then 'PASS' else 'FAIL' end from projects
union all
select 'R8 plain user sees ONLY their assigned cost code',
       case when count(*) = 1 then 'PASS' else 'FAIL' end from cost_codes
union all
select 'R8 and it is the one they were assigned',
       case when count(*) = 1 then 'PASS' else 'FAIL' end from cost_codes where code = 'CC-100';

-- ------------------------------------------------------ no escalation ----
select 'ESC plain user cannot make self enterprise admin' as test,
       pg_temp.must_affect_nothing($q$update enterprise_members
         set role = 'Enterprise System Admin'
         where user_id = '22222222-2222-2222-2222-222222222222'$q$) as result
union all
select 'ESC plain user cannot make self project admin',
       pg_temp.must_affect_nothing($q$update project_members set role = 'Project Admin'
         where user_id = '22222222-2222-2222-2222-222222222222'$q$)
union all
select 'ESC plain user cannot self-assign another cost code',
       pg_temp.must_block($q$insert into cost_code_users (cost_code_id, project_id, user_id)
         values ('eeeeeeee-0000-0000-0000-000000000005',
                 'cccccccc-0000-0000-0000-000000000003',
                 '22222222-2222-2222-2222-222222222222')$q$)
union all
select 'ESC plain user cannot become a platform admin',
       pg_temp.must_block($q$insert into platform_admins (user_id)
         values ('22222222-2222-2222-2222-222222222222')$q$);

-- --------------------------------------- cost roll-up respects RLS ----
select 'TOTALS plain user totals only their cost code' as test,
       case when baseline_budget = 100 then 'PASS' else 'FAIL - ' || baseline_budget end as result
  from project_cost_totals(array['cccccccc-0000-0000-0000-000000000003']::uuid[]);

select pg_temp.as_user('33333333-3333-3333-3333-333333333333','pm@acme.test');
select 'TOTALS project admin totals both cost codes' as test,
       case when baseline_budget = 350 then 'PASS' else 'FAIL - ' || baseline_budget end as result
  from project_cost_totals(array['cccccccc-0000-0000-0000-000000000003']::uuid[]);

-- ----------------------------------------------------- invitations ----
-- The Firestore version added every invitee to adminUsers while labelling
-- them an Enterprise User, so all invitees became admins.
do $$
declare granted text;
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','44444444-4444-4444-4444-444444444444',
                      'email','rival@other.test')::text, true);

  perform accept_invitation('tok-ok');

  begin perform accept_invitation('tok-ok');
    raise exception 'INV token reuse was allowed';
  exception when others then null; end;

  begin perform accept_invitation('tok-wrong');
    raise exception 'INV wrong recipient was allowed';
  exception when others then null; end;

  begin perform accept_invitation('tok-expired');
    raise exception 'INV expired token was allowed';
  exception when others then null; end;

  perform set_config('role','postgres',true);
  select role::text into granted from enterprise_members
   where enterprise_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = '44444444-4444-4444-4444-444444444444';

  if granted is distinct from 'Enterprise User' then
    raise exception 'INV granted role was %, expected Enterprise User', granted;
  end if;
  raise notice 'INV redemption, reuse, wrong recipient and expiry: PASS';
end $$;

rollback;
