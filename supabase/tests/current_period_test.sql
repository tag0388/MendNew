-- ============================================================================
-- "A project always has exactly one current period" tests.
--
-- The rule matters because everything that phases forecast asks "which periods
-- come after the current one?". With no current period that question has no
-- safe answer, and the app answered "all of them" -- putting forecast into the
-- period being reported as actual.
--
--   psql "$DATABASE_URL" -f supabase/tests/current_period_test.sql
-- Every row of output should read PASS.
-- ============================================================================

begin;

insert into enterprises (id, enterprise_code, name)
values ('33aaaaaa-0000-0000-0000-000000000001','CUR','Current Test');
insert into projects (id, enterprise_id, project_name, project_code)
values ('33bbbbbb-0000-0000-0000-000000000002','33aaaaaa-0000-0000-0000-000000000001','Current Test','CUR');

insert into reporting_periods (id, project_id, kind, name, start_date, end_date, sort_order) values
 ('33c00000-0000-0000-0000-000000000001','33bbbbbb-0000-0000-0000-000000000002','cost','Sep26','2026-09-01','2026-09-30',0),
 ('33c00000-0000-0000-0000-000000000002','33bbbbbb-0000-0000-0000-000000000002','cost','Oct26','2026-10-01','2026-10-31',1),
 ('33c00000-0000-0000-0000-000000000003','33bbbbbb-0000-0000-0000-000000000002','cost','Nov26','2026-11-01','2026-11-30',2);

create temp table results (step text, got text, want text);
insert into results values ('on create, the first period is current',
  coalesce((select name from reporting_periods where project_id='33bbbbbb-0000-0000-0000-000000000002' and is_current),'none'), 'Sep26');

update reporting_periods set status='closed', is_current=false where id='33c00000-0000-0000-0000-000000000001';
insert into results values ('closing the current period hands over to the next open one',
  coalesce((select name from reporting_periods where project_id='33bbbbbb-0000-0000-0000-000000000002' and is_current),'none'), 'Oct26');

delete from reporting_periods where id='33c00000-0000-0000-0000-000000000002';
insert into results values ('deleting the current period hands over to the next open one',
  coalesce((select name from reporting_periods where project_id='33bbbbbb-0000-0000-0000-000000000002' and is_current),'none'), 'Nov26');

update reporting_periods set status='closed', is_current=false where project_id='33bbbbbb-0000-0000-0000-000000000002';
insert into results values ('all periods closed leaves nothing current',
  (select count(*)::text from reporting_periods where project_id='33bbbbbb-0000-0000-0000-000000000002' and is_current), '0');

insert into reporting_periods (project_id, kind, name, start_date, end_date, sort_order)
values ('33bbbbbb-0000-0000-0000-000000000002','cost','Dec26','2026-12-01','2026-12-31',3);
insert into results values ('adding an open period to an all-closed project makes it current',
  coalesce((select name from reporting_periods where project_id='33bbbbbb-0000-0000-0000-000000000002' and is_current),'none'), 'Dec26');

insert into results values ('never more than one current',
  (select count(*)::text from reporting_periods where project_id='33bbbbbb-0000-0000-0000-000000000002' and is_current), '1');

select step as test, case when got = want then 'PASS' else 'FAIL: got '||got||', want '||want end as result
  from results;

rollback;
