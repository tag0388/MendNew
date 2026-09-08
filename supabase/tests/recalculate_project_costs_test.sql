-- ============================================================================
-- recalculate_project_costs tests
--
-- These figures are what the whole cost module reports, so each of the four
-- EAC methods is checked against a fixture with known arithmetic rather than
-- by reading the function.
--
--   psql "$DATABASE_URL" -f supabase/tests/recalculate_project_costs_test.sql
-- Every row of output should read PASS.
-- ============================================================================

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','77777777-7777-7777-7777-777777777777','authenticated','authenticated','pm@recalc.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','66666666-6666-6666-6666-666666666666','authenticated','authenticated','outsider@recalc.test','x',now(),now(),now(),'{}','{}');

insert into enterprises (id, enterprise_code, name)
values ('77aaaaaa-0000-0000-0000-000000000001','RECALC','Recalc Test');

insert into enterprise_members (enterprise_id, user_id, role) values
 ('77aaaaaa-0000-0000-0000-000000000001','77777777-7777-7777-7777-777777777777','Enterprise System Admin');

insert into projects (id, enterprise_id, project_name, project_code)
values ('77bbbbbb-0000-0000-0000-000000000002','77aaaaaa-0000-0000-0000-000000000001','Recalc Test','RCL');

-- P2 is current, so P3 is the only future period: only P3's ETC phasing counts
-- towards estimate to complete, and only P2's actuals count as "this period".
insert into reporting_periods (id, project_id, kind, name, start_date, end_date, sort_order, is_current) values
 ('77c00000-0000-0000-0000-000000000001','77bbbbbb-0000-0000-0000-000000000002','cost','P1','2026-01-01','2026-01-31',0,false),
 ('77c00000-0000-0000-0000-000000000002','77bbbbbb-0000-0000-0000-000000000002','cost','P2','2026-02-01','2026-02-28',1,true),
 ('77c00000-0000-0000-0000-000000000003','77bbbbbb-0000-0000-0000-000000000002','cost','P3','2026-03-01','2026-03-31',2,false);

-- One cost code per EAC method. The *_previous columns are what the movement
-- columns subtract; CC-MAN carries a hand-entered EAC the function must leave
-- alone.
insert into cost_codes (id, project_id, code, name, eac_method,
                        approved_budget_previous, estimate_at_completion_previous,
                        cost_variance_previous, estimate_at_completion) values
 ('77d00000-0000-0000-0000-000000000001','77bbbbbb-0000-0000-0000-000000000002','CC-ETC','Etc method','ETC Details',              1000, 900, 100, 0),
 ('77d00000-0000-0000-0000-000000000002','77bbbbbb-0000-0000-0000-000000000002','CC-CHG','Change method','Change Management',        0,   0,   0, 0),
 ('77d00000-0000-0000-0000-000000000003','77bbbbbb-0000-0000-0000-000000000002','CC-SUB','Sub method','Sub-Contract Management',    0,   0,   0, 0),
 ('77d00000-0000-0000-0000-000000000004','77bbbbbb-0000-0000-0000-000000000002','CC-MAN','Manual method','Manual',                  0,   0,   0, 750);

-- CC-ETC: baseline 1000, actuals 200 (P1) + 300 (P2, current) = 500 to date.
insert into baseline_budgets (project_id, cost_code_id, reporting_period_id, amount) values
 ('77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000001','77c00000-0000-0000-0000-000000000001',1000),
 ('77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000002','77c00000-0000-0000-0000-000000000001', 500);

insert into actual_costs (project_id, cost_code_id, reporting_period_id, cost) values
 ('77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000001','77c00000-0000-0000-0000-000000000001',200),
 ('77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000001','77c00000-0000-0000-0000-000000000002',300),
 ('77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000002','77c00000-0000-0000-0000-000000000002',100),
 ('77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000004','77c00000-0000-0000-0000-000000000001',250);

-- Changes. Approved and Pending both count; Rejected must not, and its 999s
-- are large enough that any leak is obvious in the assertions below.
insert into changes (id, project_id, change_id, status) values
 ('77e00000-0000-0000-0000-000000000001','77bbbbbb-0000-0000-0000-000000000002','CH-APPROVED','Approved'),
 ('77e00000-0000-0000-0000-000000000002','77bbbbbb-0000-0000-0000-000000000002','CH-PENDING','Pending'),
 ('77e00000-0000-0000-0000-000000000003','77bbbbbb-0000-0000-0000-000000000002','CH-REJECTED','Rejected');

insert into change_records (change_id, project_id, cost_code_id, budget_amount, eac_amount) values
 ('77e00000-0000-0000-0000-000000000001','77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000001',100,   0),
 ('77e00000-0000-0000-0000-000000000001','77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000002', 50, 250),
 ('77e00000-0000-0000-0000-000000000002','77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000002', 25,  25),
 ('77e00000-0000-0000-0000-000000000003','77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000002',999, 999);

-- ETC rows for CC-ETC. The P2 phasing is the CURRENT period and must be
-- excluded -- money in the current period is an actual, not an estimate to
-- complete. Only P3 counts: 20 * 10 = 200.
insert into etc_details (project_id, cost_code_id, item, rate, period_values) values
 ('77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000001','Labour', 10,
  '{"77c00000-0000-0000-0000-000000000002": 5, "77c00000-0000-0000-0000-000000000003": 20}'::jsonb),
 -- A phasing key that is not a period id at all. Real data should not carry
 -- one, but it must be ignored rather than abort the whole recalculation.
 ('77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000001','Junk key', 10,
  '{"not-a-uuid": 999}'::jsonb);

-- CC-SUB: 400 on its own line, 100 inherited from the subcontract default,
-- and a Rejected 999 that is not committed spend. Total 500.
insert into subcontracts (id, project_id, order_id, order_name, default_cost_code_id) values
 ('77f00000-0000-0000-0000-000000000001','77bbbbbb-0000-0000-0000-000000000002','SC-1','Sub One','77d00000-0000-0000-0000-000000000003');

insert into subcontract_line_items (subcontract_id, project_id, cost_code_id, item_no, total, status) values
 ('77f00000-0000-0000-0000-000000000001','77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000003','1',400,'Approved'),
 ('77f00000-0000-0000-0000-000000000001','77bbbbbb-0000-0000-0000-000000000002',NULL,                                  '2',100,'Approved'),
 ('77f00000-0000-0000-0000-000000000001','77bbbbbb-0000-0000-0000-000000000002','77d00000-0000-0000-0000-000000000003','3',999,'Rejected');

-- Deliberately corrupt every derived column first. Some are trigger-maintained
-- and would already be right, which would let a function that did nothing at
-- all still pass.
update cost_codes set baseline_budget = -1, budget_changes = -1, approved_budget = -1,
       actual_cost_to_date = -1, actual_cost_this_period = -1,
       estimate_to_complete = -1, cost_variance = -1
 where project_id = '77bbbbbb-0000-0000-0000-000000000002';

-- ------------------------------------------------------- run as the admin ---
do $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','77777777-7777-7777-7777-777777777777',
                      'email','pm@recalc.test')::text, true);
  perform recalculate_project_costs('77bbbbbb-0000-0000-0000-000000000002');
  perform set_config('role','postgres',true);
end $$;

-- ---------------------------------------------------------------- results ---
-- CC-ETC  baseline 1000, changes 100 -> approved 1100
--         actuals 500 to date / 300 this period, ETC 200 -> EAC 700
--         movements: 1100-1000=100, 700-900=-200, cv 1100-700=400, 400-100=300
select 'CC-ETC figures' as test, case when
       baseline_budget = 1000 and budget_changes = 100 and approved_budget = 1100
   and actual_cost_to_date = 500 and actual_cost_this_period = 300
   and estimate_to_complete = 200 and estimate_at_completion = 700
   and approved_budget_movement = 100 and estimate_at_completion_movement = -200
   and cost_variance = 400 and cost_variance_movement = 300
       then 'PASS' else 'FAIL' end as result
  from cost_codes where code = 'CC-ETC'
union all
-- CC-CHG  baseline 500, changes 50+25=75 (999 rejected) -> approved 575
--         EAC = baseline + eac changes 250+25 = 775, ETC = 775-100 = 675
select 'CC-CHG figures', case when
       baseline_budget = 500 and budget_changes = 75 and approved_budget = 575
   and actual_cost_to_date = 100 and estimate_at_completion = 775
   and estimate_to_complete = 675 and cost_variance = -200
       then 'PASS' else 'FAIL' end
  from cost_codes where code = 'CC-CHG'
union all
-- CC-SUB  400 + 100 inherited, Rejected 999 excluded
select 'CC-SUB figures', case when
       estimate_at_completion = 500 and estimate_to_complete = 500
   and approved_budget = 0 and cost_variance = -500
       then 'PASS' else 'FAIL' end
  from cost_codes where code = 'CC-SUB'
union all
-- CC-MAN  hand-entered EAC survives; ETC derives from it
select 'CC-MAN keeps manual EAC', case when
       estimate_at_completion = 750 and actual_cost_to_date = 250
   and estimate_to_complete = 500
       then 'PASS' else 'FAIL' end
  from cost_codes where code = 'CC-MAN'
union all
-- The Rejected change's 999s must not appear anywhere.
select 'rejected change excluded', case when count(*) = 0 then 'PASS' else 'FAIL' end
  from cost_codes
 where project_id = '77bbbbbb-0000-0000-0000-000000000002'
   and (budget_changes >= 999 or estimate_at_completion >= 999);

-- ------------------------------------ a non-member cannot recalculate it ----
do $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','66666666-6666-6666-6666-666666666666',
                      'email','outsider@recalc.test')::text, true);
  begin
    perform recalculate_project_costs('77bbbbbb-0000-0000-0000-000000000002');
    raise exception 'GUARD: a non-member was allowed to recalculate';
  exception
    when sqlstate 'P0001' and sqlerrm like 'GUARD:%' then raise;
    when others then null;
  end;
  perform set_config('role','postgres',true);
end $$;

select 'non-member refused' as test, 'PASS' as result;

rollback;
