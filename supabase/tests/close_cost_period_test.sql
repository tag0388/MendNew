-- ============================================================================
-- close_cost_period tests
--
-- Closing a period is the one operation in the app that most needs to be
-- all-or-nothing, so it is checked end to end against a real fixture rather
-- than by reading the function.
--
--   psql "$DATABASE_URL" -f supabase/tests/close_cost_period_test.sql
-- Every row of output should read PASS.
-- ============================================================================

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','99999999-9999-9999-9999-999999999999','authenticated','authenticated','pm@close.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','88888888-8888-8888-8888-888888888888','authenticated','authenticated','plain@close.test','x',now(),now(),now(),'{}','{}');

insert into enterprises (id, enterprise_code, name)
values ('99aaaaaa-0000-0000-0000-000000000001','CLOSE','Close Test');

insert into enterprise_members (enterprise_id, user_id, role) values
 ('99aaaaaa-0000-0000-0000-000000000001','99999999-9999-9999-9999-999999999999','Enterprise System Admin'),
 ('99aaaaaa-0000-0000-0000-000000000001','88888888-8888-8888-8888-888888888888','Enterprise User');

insert into projects (id, enterprise_id, project_name, project_code)
values ('99bbbbbb-0000-0000-0000-000000000002','99aaaaaa-0000-0000-0000-000000000001','Close Test','CLS');

insert into project_members (project_id, enterprise_id, user_id, role)
values ('99bbbbbb-0000-0000-0000-000000000002','99aaaaaa-0000-0000-0000-000000000001','88888888-8888-8888-8888-888888888888','Project User');

insert into reporting_periods (id, project_id, kind, name, start_date, end_date, sort_order, is_current) values
 ('99cccccc-0000-0000-0000-000000000003','99bbbbbb-0000-0000-0000-000000000002','cost','Jan','2026-01-01','2026-01-31',0,true),
 ('99dddddd-0000-0000-0000-000000000004','99bbbbbb-0000-0000-0000-000000000002','cost','Feb','2026-02-01','2026-02-28',1,false);

-- The actual-cost totals are derived by trigger, so they are never set here:
-- the rows below are what they are computed from.
insert into cost_codes (id, project_id, code, name, approved_budget, estimate_at_completion) values
 ('99eeeeee-0000-0000-0000-000000000005','99bbbbbb-0000-0000-0000-000000000002','CC-1','One', 1000, 900),
 ('99ffffff-0000-0000-0000-000000000006','99bbbbbb-0000-0000-0000-000000000002','CC-2','Two', 2000, 1800);

-- CC-1 carries 300 real plus a 200 accrual in January. CC-2 carries none, and
-- must not be touched by CC-1's accrual -- an earlier draft of the close
-- joined the accrual set to every cost code.
insert into actual_costs (project_id, cost_code_id, reporting_period_id, cost, source) values
 ('99bbbbbb-0000-0000-0000-000000000002','99eeeeee-0000-0000-0000-000000000005','99cccccc-0000-0000-0000-000000000003', 300, 'MAN'),
 ('99bbbbbb-0000-0000-0000-000000000002','99eeeeee-0000-0000-0000-000000000005','99cccccc-0000-0000-0000-000000000003', 200, 'ACC'),
 ('99bbbbbb-0000-0000-0000-000000000002','99ffffff-0000-0000-0000-000000000006','99cccccc-0000-0000-0000-000000000003', 700, 'MAN');

select 'TRIGGER CC-1 totals derived from its rows before any close' as test,
       case when actual_cost_to_date = 500 and actual_cost_this_period = 500
            then 'PASS' else 'FAIL - ' || actual_cost_to_date || '/' || actual_cost_this_period end as result
  from cost_codes where code = 'CC-1';

insert into cost_phasing (project_id, cost_code_id, type, period_values) values
 ('99bbbbbb-0000-0000-0000-000000000002','99eeeeee-0000-0000-0000-000000000005','eac',
  '{"99cccccc-0000-0000-0000-000000000003": 400}');

-- 4 units in January (behind), 6 ahead. Only the 6 should be frozen: 6 x 50.
insert into etc_details (project_id, cost_code_id, item, qty, rate, period_values) values
 ('99bbbbbb-0000-0000-0000-000000000002','99eeeeee-0000-0000-0000-000000000005','Labour', 10, 50,
  '{"99cccccc-0000-0000-0000-000000000003": 4, "99dddddd-0000-0000-0000-000000000004": 6}');

-- ------------------------------------------- a Project User may not close ----
do $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','88888888-8888-8888-8888-888888888888',
                      'email','plain@close.test')::text, true);
  begin
    perform close_cost_period('99bbbbbb-0000-0000-0000-000000000002');
    raise exception 'AUTH: a Project User was allowed to close a period';
  exception
    when sqlstate 'P0001' and sqlerrm like 'AUTH:%' then raise;
    when others then null;  -- refused, as it should be
  end;
  perform set_config('role','postgres',true);
end $$;

select 'AUTH period still open after a Project User tried to close it' as test,
       case when status::text = 'open' then 'PASS' else 'FAIL' end as result
  from reporting_periods where name = 'Jan';

-- ------------------------------------------------ the project admin closes ----
do $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','99999999-9999-9999-9999-999999999999',
                      'email','pm@close.test')::text, true);
  perform close_cost_period('99bbbbbb-0000-0000-0000-000000000002');
  perform set_config('role','postgres',true);
end $$;

select 'CC-1 actuals net off its accrual (300 + 200 - 200)' as test,
       case when actual_cost_to_date = 300 then 'PASS' else 'FAIL - ' || actual_cost_to_date end as result
  from cost_codes where code = 'CC-1'
union all
select 'CC-1 this period is the reversal only, in February',
       case when actual_cost_this_period = -200 then 'PASS' else 'FAIL - ' || actual_cost_this_period end
  from cost_codes where code = 'CC-1'
union all
select 'CC-2 this period is zero (nothing in February)',
       case when actual_cost_this_period = 0 then 'PASS' else 'FAIL - ' || actual_cost_this_period end
  from cost_codes where code = 'CC-2'
union all
select 'CC-1 approved budget carried to previous',
       case when approved_budget_previous = 1000 then 'PASS' else 'FAIL - ' || approved_budget_previous end
  from cost_codes where code = 'CC-1'
union all
select 'CC-1 movements zeroed',
       case when approved_budget_movement = 0 and estimate_at_completion_movement = 0
            then 'PASS' else 'FAIL' end from cost_codes where code = 'CC-1'
union all
select 'CC-2 untouched by another cost code''s accrual',
       case when actual_cost_to_date = 700 then 'PASS' else 'FAIL - ' || actual_cost_to_date end
  from cost_codes where code = 'CC-2'
union all
select 'January closed',
       case when status::text = 'closed' then 'PASS' else 'FAIL - ' || status end
  from reporting_periods where name = 'Jan'
union all
select 'February became current',
       case when is_current then 'PASS' else 'FAIL' end from reporting_periods where name = 'Feb'
union all
select 'accrual reversed into February',
       case when (select sum(cost) from actual_costs where source = 'REV') = -200
            then 'PASS' else 'FAIL' end
union all
select 'the reversal lands in February, not January',
       case when (select count(*) from actual_costs
                   where source='REV' and reporting_period_id='99dddddd-0000-0000-0000-000000000004') = 1
            then 'PASS' else 'FAIL' end
union all
select 'closing EAC kept as eacPrevious',
       case when (select count(*) from cost_phasing where type = 'eacPrevious') = 1
            then 'PASS' else 'FAIL' end
union all
select 'ETC frozen against future periods only (6 x 50)',
       case when total_etc_previous = 300 then 'PASS' else 'FAIL - ' || total_etc_previous end
  from etc_details;

-- ------------------------------------ closing the last period is allowed ----
do $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','99999999-9999-9999-9999-999999999999',
                      'email','pm@close.test')::text, true);
  perform close_cost_period('99bbbbbb-0000-0000-0000-000000000002');

  -- ... and closing again with nothing open must fail rather than corrupt.
  begin
    perform close_cost_period('99bbbbbb-0000-0000-0000-000000000002');
    raise exception 'GUARD: closing with no open period was allowed';
  exception
    when sqlstate 'P0001' and sqlerrm like 'GUARD:%' then raise;
    when others then null;
  end;
  perform set_config('role','postgres',true);
end $$;

select 'both periods closed' as test,
       case when count(*) = 2 then 'PASS' else 'FAIL' end as result
  from reporting_periods where status = 'closed'
union all
select 'no period left current',
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from reporting_periods where is_current;

rollback;
