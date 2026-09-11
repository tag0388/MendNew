-- ============================================================================
-- apply_import
--
-- The sheet becomes one INSERT built from the registry. These assertions
-- cover the two behaviours a user relies on -- that re-importing an edited
-- export updates rather than duplicates, and that nothing outside the
-- allow-list can be written -- plus the shapes Excel actually produces.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/import_apply_test.sql
-- Every line prints PASS or FAIL; nothing is left behind.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create temporary table results (label text, expected text, actual text) on commit drop;

do $$
declare
  ent uuid; proj uuid; per uuid; res jsonb; n int;
begin
  insert into enterprises (name, enterprise_code) values ('ZZ-APPLY','ZZAP') returning id into ent;
  insert into projects (enterprise_id, project_name, project_code)
  values (ent,'ZZ-APPLY','ZZAP-1') returning id into proj;
  insert into reporting_periods (project_id, kind, name, start_date, end_date, sort_order, is_current)
  values (proj,'cost','Jan 26','2026-01-01','2026-01-31',1,true) returning id into per;

  -- ------------------------------------- a table keyed by what the user ----
  -- types: the cost code. First import, everything is new.
  res := apply_import('cost_codes', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Cost Code Name','Civil','EAC Method','ETC Details'),
    jsonb_build_object('Cost Code ID','1200','Cost Code Name','Mech')));
  insert into results values ('new IDs are inserted','2', res ->> 'inserted');
  insert into results values ('nothing is counted as an update','0', res ->> 'updated');

  -- The user exported, edited 1100, added 1300, and imported it back.
  res := apply_import('cost_codes', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Cost Code Name','Civil Works'),
    jsonb_build_object('Cost Code ID','1300','Cost Code Name','Elec')));
  insert into results values ('an ID that exists is updated, not duplicated','1', res ->> 'updated');
  insert into results values ('an ID that does not exist is inserted','1', res ->> 'inserted');
  insert into results
  select 'the edit reached the row','Civil Works', name from cost_codes
   where project_id = proj and code = '1100';
  select count(*) into n from cost_codes where project_id = proj;
  insert into results values ('re-importing did not duplicate','3', n::text);

  -- A narrower sheet must not wipe the columns it leaves out.
  res := apply_import('cost_codes', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Activity ID','A-10')));
  insert into results
  select 'a column absent from the sheet keeps its value','Civil Works', name
    from cost_codes where project_id = proj and code = '1100';
  insert into results
  select 'a column present in the sheet is written','A-10', activity_id
    from cost_codes where project_id = proj and code = '1100';

  -- ----------------------------------------- a table with no such key ----
  -- Two identical ETC lines are two lines, so these append.
  res := apply_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','Labour','Qty','10','Rate','5'),
    jsonb_build_object('Cost Code ID','1200','Item','Steel','Qty','2','Rate','100')));
  insert into results values ('line items are inserted','2', res ->> 'inserted');
  res := apply_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','Labour','Qty','10','Rate','5')));
  select count(*) into n from etc_details where project_id = proj;
  insert into results values ('an identical line item appends rather than merging','3', n::text);

  -- The sheet carried '1100', not a uuid.
  insert into results
  select 'the cost code text resolved to the right row','1100', c.code
    from etc_details e join cost_codes c on c.id = e.cost_code_id
   where e.project_id = proj and e.item = 'Labour' limit 1;

  -- -------------------------------------------- Delete Existing Data ----
  -- This clears the whole project's ETC, not only the rows in the sheet.
  res := apply_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1200','Item','Only one','Qty','1','Rate','1')), true);
  insert into results values ('replacing reports what it removed','3', res ->> 'deleted');
  select count(*) into n from etc_details where project_id = proj;
  insert into results values ('replacing leaves only the sheet','1', n::text);

  -- ------------------------------------------------- the allow-list ----
  -- Approved budget is maintained by the change-order triggers. A column for
  -- it in the sheet has no effect, and the user is told which columns those
  -- were rather than left to wonder why an edit did nothing.
  res := apply_import('cost_codes', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1400','Approved Budget','999999','Invented','x')));
  insert into results values ('unknown headers are reported, not written',
                              '["Approved Budget", "Invented"]', res ->> 'ignored_columns');
  insert into results
  select 'a derived figure is untouched by the sheet','0.00', approved_budget::text
    from cost_codes where project_id = proj and code = '1400';

  -- ------------------------------------------------- what Excel writes ----
  res := apply_import('cost_codes', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1500','EAC Method','')));
  insert into results
  select 'a blank cell falls back to the column default','Manual', eac_method::text
    from cost_codes where project_id = proj and code = '1500';

  res := apply_import('actual_costs', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Reporting Period','Jan 26',
                       'Cost','1,234.56','Item','Invoice 7','Source','ACC')));
  insert into results
  select 'a thousands separator is read as a number','1234.56', cost::text
    from actual_costs where project_id = proj limit 1;

  -- A parent that does not exist cannot be written against. Validation warns
  -- the user first; the writer simply does not land the row, and says so by
  -- reporting fewer written than submitted.
  res := apply_import('actual_costs', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','NOPE','Reporting Period','Jan 26','Cost','5')));
  insert into results values ('a row naming a parent that does not exist does not land',
                              '1|0', (res ->> 'submitted') || '|' || (res ->> 'inserted'));
end $$;

select case when expected = actual then 'PASS' else 'FAIL' end as status,
       label, expected, actual
  from results
 order by (expected = actual), label;

rollback;
