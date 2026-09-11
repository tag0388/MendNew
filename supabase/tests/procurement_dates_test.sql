-- ============================================================================
-- recalculate_procurement_dates
--
-- The planned/forecast chain used to run in the browser, once per package,
-- in src/lib/procurementUtils.ts. It is SQL now, so its tests are here.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/procurement_dates_test.sql
-- Every line prints PASS or FAIL; nothing is left behind.
--
-- The calendar is Sat/Sun off. The cut-off is Monday 2 March 2026 and the
-- last step is pinned to Thursday 30 April 2026, so every expected date
-- below can be counted by hand.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create temporary table results (label text, expected text, actual text) on commit drop;

do $$
declare
  ent uuid; proj uuid; cal uuid; hol uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  a uuid; b uuid; c uuid; d uuid; e uuid;
  durs jsonb;
  n integer;
begin
  insert into enterprises (name, enterprise_code)
  values ('ZZ-PROC-TEST', 'ZZPROC') returning id into ent;

  insert into projects (enterprise_id, project_name, project_code, cutoff_date)
  values (ent, 'ZZ-PROC-TEST', 'ZZPROC-1', date '2026-03-02') returning id into proj;

  -- The project's FIRST calendar: packages with no calendar of their own
  -- must fall back to this one, the way the grid did.
  insert into calendars (project_id, name, weekends, holidays)
  values (proj, 'ZZ-Standard', '{0,6}', '{}') returning id into cal;

  insert into calendars (project_id, name, weekends, holidays)
  values (proj, 'ZZ-With-Holiday', '{0,6}', '{2026-04-27}') returning id into hol;

  insert into procurement_step_definitions (project_id, name, step_order)
  values (proj, 'Scope',  1) returning id into s1;
  insert into procurement_step_definitions (project_id, name, step_order)
  values (proj, 'Tender', 2) returning id into s2;
  insert into procurement_step_definitions (project_id, name, step_order)
  values (proj, 'Award',  3) returning id into s3;
  insert into procurement_step_definitions (project_id, name, step_order)
  values (proj, 'Deliver',4) returning id into s4;

  -- Five working days per step, last step pinned to Thu 30 Apr 2026.
  durs := jsonb_build_object(
    s1::text, jsonb_build_object('planDuration', 5, 'forecastDuration', 5),
    s2::text, jsonb_build_object('planDuration', 5, 'forecastDuration', 5),
    s3::text, jsonb_build_object('planDuration', 5, 'forecastDuration', 5),
    s4::text, jsonb_build_object('planDuration', 5, 'forecastDuration', 5,
                                 'plannedDate', '2026-04-30'));

  insert into procurement_items (project_id, package_id, calendar_id, step_data)
  values (proj, 'A', cal, durs) returning id into a;

  -- No step_data at all. The browser created the step objects; jsonb_set
  -- would not have, so this is the regression test for that.
  insert into procurement_items (project_id, package_id, calendar_id, step_data)
  values (proj, 'B', cal, '{}'::jsonb) returning id into b;

  -- An actual date on step 2 overrides its forecast and drives step 3.
  insert into procurement_items (project_id, package_id, calendar_id, step_data)
  values (proj, 'C', cal,
          jsonb_set(durs, array[s2::text, 'actualDate'], '"2026-03-20"'))
  returning id into c;

  -- Monday 27 April is a holiday on this package's calendar.
  insert into procurement_items (project_id, package_id, calendar_id, step_data)
  values (proj, 'D', hol, durs) returning id into d;

  -- No calendar of its own: must use the project's first one.
  insert into procurement_items (project_id, package_id, calendar_id, step_data)
  values (proj, 'E', null,
          jsonb_build_object(
            s1::text, jsonb_build_object('planDuration', 5, 'forecastDuration', 5),
            s2::text, jsonb_build_object('planDuration', 5, 'forecastDuration', 5),
            s3::text, jsonb_build_object('planDuration', 5, 'forecastDuration', 5),
            s4::text, jsonb_build_object('planDuration', 5, 'forecastDuration', 5)))
  returning id into e;

  n := recalculate_procurement_dates(proj);
  insert into results values ('every package is written on the first run', '5', n::text);

  -- ------------------------------------------------ planned, backward ----
  insert into results
  select 'planned walks back a week per step: step 3', '2026-04-23',
         step_data #>> array[s3::text, 'plannedDate'] from procurement_items where id = a;
  insert into results
  select 'planned walks back a week per step: step 2', '2026-04-16',
         step_data #>> array[s2::text, 'plannedDate'] from procurement_items where id = a;
  insert into results
  select 'planned walks back a week per step: step 1', '2026-04-09',
         step_data #>> array[s1::text, 'plannedDate'] from procurement_items where id = a;

  insert into results
  select 'a holiday pushes the planned date back a day', '2026-04-22',
         step_data #>> array[s3::text, 'plannedDate'] from procurement_items where id = d;

  -- ----------------------------------------------- forecast, forward ----
  insert into results
  select 'step 1 forecasts from its planned date when that is after the cut-off',
         '2026-04-09', step_data #>> array[s1::text, 'forecastDate']
    from procurement_items where id = a;
  insert into results
  select 'later steps follow the one before', '2026-04-30',
         step_data #>> array[s4::text, 'forecastDate'] from procurement_items where id = a;

  insert into results
  select 'an actual date wins over the forecast', '2026-03-20',
         step_data #>> array[s2::text, 'forecastDate'] from procurement_items where id = c;
  insert into results
  select 'the step after an actual date follows the actual', '2026-03-27',
         step_data #>> array[s3::text, 'forecastDate'] from procurement_items where id = c;

  -- ------------------------------------------------------- the gaps ----
  insert into results
  select 'a package with no dates at all gets the cut-off', '2026-03-02',
         step_data #>> array[s1::text, 'forecastDate'] from procurement_items where id = b;
  insert into results
  select 'a step that never existed is created', '2026-03-02',
         step_data #>> array[s4::text, 'forecastDate'] from procurement_items where id = b;

  insert into results
  select 'a package with no calendar uses the project calendar', '2026-03-09',
         step_data #>> array[s2::text, 'forecastDate'] from procurement_items where id = e;

  -- ----------------------------------------------------- idempotence ----
  n := recalculate_procurement_dates(proj);
  insert into results values ('a second run writes nothing', '0', n::text);

  -- ------------------------------------------------------ one package ----
  update procurement_items
     set step_data = jsonb_set(step_data, array[s4::text, 'plannedDate'], '"2026-05-07"')
   where id = a;
  n := recalculate_procurement_dates(proj, array[a]);
  insert into results values ('recalculating one package touches one package', '1', n::text);
  insert into results
  select 'moving the last planned date moves the chain', '2026-04-30',
         step_data #>> array[s3::text, 'plannedDate'] from procurement_items where id = a;
  insert into results
  select 'the other packages are left alone', '2026-04-23',
         step_data #>> array[s3::text, 'plannedDate'] from procurement_items where id = c;

  -- --------------------------------------------------- junk tolerance ----
  update procurement_items
     set step_data = jsonb_set(step_data, array[s4::text, 'plannedDate'], '"not a date"')
   where id = b;
  begin
    n := recalculate_procurement_dates(proj);
    insert into results values ('an unparseable date does not fail the run', 'ok', 'ok');
  exception when others then
    insert into results values ('an unparseable date does not fail the run', 'ok', sqlerrm);
  end;
end $$;

select case when expected = actual then 'PASS' else 'FAIL' end as status,
       label, expected, actual
  from results
 order by (expected = actual), label;

rollback;
