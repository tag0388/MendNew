-- ============================================================================
-- The dynamic import columns
--
-- E_<title>, P_<title>, Numeric n, Text n and the period columns are not in
-- the registry -- they depend on how the enterprise and project have been
-- configured. These assertions cover the round trip a user actually makes:
-- export, edit an attribute in Excel, import back.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/import_dynamic_test.sql
-- Every line prints PASS or FAIL; nothing is left behind.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create temporary table results (label text, expected text, actual text) on commit drop;

do $$
declare
  ent uuid; proj uuid; p1 uuid; p2 uuid; res jsonb; rep jsonb;
begin
  insert into enterprises (name, enterprise_code, line_item_attributes)
  values ('ZZ-DYN','ZZDYN',
    '[{"id":"01","title":"Discipline","values":[{"id":"d1","description":"Civil"},
                                                {"id":"d2","description":"Mech"}]},
      {"id":"02","title":"Phase","values":[]},
      {"id":"03","title":"","values":[]}]'::jsonb)
  returning id into ent;
  insert into projects (enterprise_id, project_name, project_code, line_item_attributes)
  values (ent,'ZZ-DYN','ZZDYN-1','[{"id":"01","title":"Area","values":[]}]'::jsonb)
  returning id into proj;
  insert into reporting_periods (project_id, kind, name, start_date, end_date, sort_order)
  values (proj,'cost','Jan 26','2026-01-01','2026-01-31',1) returning id into p1;
  insert into reporting_periods (project_id, kind, name, start_date, end_date, sort_order)
  values (proj,'cost','Feb 26','2026-02-01','2026-02-28',2) returning id into p2;
  insert into cost_codes (project_id, code, name) values (proj,'1100','Civil');

  -- ------------------------------------------------------- resolution ----
  insert into results
  select 'an attribute with no title gets no column','false',
         (import_dynamic_columns('etc_details', proj) ? 'E_')::text;

  -- ---------------------------------------------------------- writing ----
  res := apply_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','Labour',
                       'E_Discipline','Civil', 'E_Phase','Fit-out', 'P_Area','Level 3',
                       'Numeric 1','42', 'Text 1','a note',
                       'Jan 26','1000', 'Feb 26','2,500')));
  insert into results values ('the row landed','1', res ->> 'inserted');
  insert into results values ('nothing was left unrecognised','[]', res ->> 'ignored_columns');

  -- The sheet shows what a person reads; the database keeps the id.
  insert into results
  select 'a description is stored as its id','d1', enterprise_attributes ->> '01'
    from etc_details where project_id = proj;
  insert into results
  select 'a free-text attribute is stored as typed','Fit-out', enterprise_attributes ->> '02'
    from etc_details where project_id = proj;
  insert into results
  select 'a project attribute lands in its own column','Level 3', project_attributes ->> '01'
    from etc_details where project_id = proj;
  insert into results
  select 'a user-defined number is a number','42', user_defined ->> 'num1'
    from etc_details where project_id = proj;
  insert into results
  select 'a user-defined text column lands','a note', user_defined ->> 'text1'
    from etc_details where project_id = proj;
  insert into results
  select 'a period column lands under its period id','1000', period_values ->> p1::text
    from etc_details where project_id = proj;
  insert into results
  select 'a period figure with a comma is a number','2500', period_values ->> p2::text
    from etc_details where project_id = proj;

  -- A table whose attribute family has no such column is not confused by it.
  res := apply_import('cost_codes', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','E_Discipline','d2')));
  insert into results values ('an attribute of another family is reported, not written',
                              '["E_Discipline"]', res ->> 'ignored_columns');

  -- ------------------------------------------------------- validation ----
  rep := validate_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','x','E_Discipline','Plumbing'),
    jsonb_build_object('Cost Code ID','1100','Item','y','Numeric 2','lots'),
    jsonb_build_object('Cost Code ID','1100','Item','z','Jan 26','not a number')));
  insert into results
  select 'an attribute value off the list is caught, and the list is named',
         'must be one of: Civil, Mech', e ->> 'message'
    from jsonb_array_elements(rep -> 'errors') e where e ->> 'column' = 'E_Discipline';
  insert into results
  select 'text in a user-defined number column is caught','must be a number',
         e ->> 'message' from jsonb_array_elements(rep -> 'errors') e
   where e ->> 'column' = 'Numeric 2';
  insert into results
  select 'text in a period column is caught','must be a number',
         e ->> 'message' from jsonb_array_elements(rep -> 'errors') e
   where e ->> 'column' = 'Jan 26';
end $$;

-- ----------------------------------------------------------- merging ----
-- The riskiest part: a narrower sheet must change what it names and leave
-- everything else alone.
do $$
declare ent uuid; proj uuid; sub uuid; p1 uuid; res jsonb;
begin
  insert into enterprises (name, enterprise_code, subcontract_attributes)
  values ('ZZ-M','ZZM','[{"id":"01","title":"Trade","values":[]},
                         {"id":"02","title":"Zone","values":[]}]'::jsonb)
  returning id into ent;
  insert into projects (enterprise_id, project_name, project_code)
  values (ent,'ZZ-M','ZZM-1') returning id into proj;
  insert into reporting_periods (project_id, kind, name, start_date, end_date, sort_order)
  values (proj,'cost','Jan 26','2026-01-01','2026-01-31',1) returning id into p1;
  insert into subcontracts (project_id, order_id, order_name, order_scope)
  values (proj,'SC-1','Test','Scope') returning id into sub;

  res := apply_import('subcontract_line_items', sub, jsonb_build_array(
    jsonb_build_object('Item No','1','Description','First','Qty','2','Rate','5',
                       'E_Trade','Civil','E_Zone','North','Jan 26','100')));
  -- Pretend the phasing engine had broken that period into weeks.
  update subcontract_line_items
     set period_values = period_values
       || jsonb_build_object(p1::text || '_w1', 40, p1::text || '_w2', 60)
   where subcontract_id = sub;

  -- This table is scoped by subcontract, but the row also records the project.
  insert into results
  select 'the line item landed and project_id was derived','1',
         count(*)::text from subcontract_line_items where project_id = proj;

  res := apply_import('subcontract_line_items', sub, jsonb_build_array(
    jsonb_build_object('Item No','1','E_Trade','Mech','Jan 26','250')));
  insert into results values ('the second sheet updated rather than added','1', res ->> 'updated');

  insert into results
  select 'the attribute in the sheet changed','Mech', enterprise_attributes ->> '01'
    from subcontract_line_items where subcontract_id = sub;
  insert into results
  select 'the attribute NOT in the sheet survived','North', enterprise_attributes ->> '02'
    from subcontract_line_items where subcontract_id = sub;
  insert into results
  select 'a column not in the sheet kept its value','First', description
    from subcontract_line_items where subcontract_id = sub;
  insert into results
  select 'the period total was replaced','250', period_values ->> p1::text
    from subcontract_line_items where subcontract_id = sub;
  insert into results
  select 'the stale week breakdown under it was dropped','0',
         (select count(*)::text from jsonb_object_keys(period_values) k where k like '%\_w%')
    from subcontract_line_items where subcontract_id = sub;
  insert into results
  select 'the generated total followed qty x rate','10.00', total::text
    from subcontract_line_items where subcontract_id = sub;
end $$;

select case when expected = actual then 'PASS' else 'FAIL' end as status,
       label, expected, actual
  from results
 order by (expected = actual), label;

rollback;
