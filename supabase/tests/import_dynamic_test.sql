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
declare ent uuid; proj uuid; d_ent uuid; d_prj uuid; p1 uuid; p2 uuid; res jsonb; rep jsonb;
begin
  insert into enterprises (name, enterprise_code) values ('ZZ-E2E','ZZE2E') returning id into ent;
  insert into projects (enterprise_id, project_name, project_code)
  values (ent,'ZZ-E2E','ZZE2E-1') returning id into proj;
  insert into reporting_periods (project_id, kind, name, start_date, end_date, sort_order)
  values (proj,'cost','Jan 26','2026-01-01','2026-01-31',1) returning id into p1;
  insert into reporting_periods (project_id, kind, name, start_date, end_date, sort_order)
  values (proj,'cost','Feb 26','2026-02-01','2026-02-28',2) returning id into p2;
  insert into cost_codes (project_id, code, name) values (proj,'1100','Civil');

  -- An enterprise slot with a list of codes, and a project slot without one.
  update attribute_definitions set title = 'Discipline'
   where enterprise_id = ent and project_id is null
     and category = 'line_item' and attribute_number = '01' returning id into d_ent;
  insert into attribute_values (definition_id, code, description, sort_order)
  values (d_ent,'CIV','Civil',1), (d_ent,'MEC','Mech',2);

  update attribute_definitions set title = 'Area'
   where project_id = proj and category = 'line_item' and attribute_number = '03'
  returning id into d_prj;

  -- ------------------------------------------------------- resolution ----
  insert into results
  select 'a titled enterprise slot becomes a column','ent_attr_01',
         import_dynamic_columns('etc_details', proj) #>> '{E_Discipline,column}';
  insert into results
  select 'a titled project slot becomes its own column','prj_attr_03',
         import_dynamic_columns('etc_details', proj) #>> '{P_Area,column}';
  insert into results
  select 'an untitled slot produces nothing','false',
         (import_dynamic_columns('etc_details', proj) ? 'E_')::text;

  -- ---------------------------------------------------------- writing ----
  res := apply_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','Labour',
                       'E_Discipline','CIV','P_Area','Level 3',
                       'Numeric 1','42','Text 1','a note',
                       'Jan 26','1000','Feb 26','2,500')));
  insert into results values ('the row landed','1', res ->> 'inserted');
  insert into results values ('nothing was unrecognised','[]', res ->> 'ignored_columns');

  insert into results
  select 'the enterprise attribute is in its real column','CIV', ent_attr_01
    from etc_details where project_id = proj;
  insert into results
  select 'the project attribute is in its real column','Level 3', prj_attr_03
    from etc_details where project_id = proj;
  insert into results
  select 'a user-defined number is still jsonb, and a number','42', user_defined ->> 'num1'
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

  -- ------------------------------------------------------- validation ----
  rep := validate_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','x','E_Discipline','Plumbing'),
    jsonb_build_object('Cost Code ID','1100','Item','y','Numeric 2','lots'),
    jsonb_build_object('Cost Code ID','1100','Item','z','Jan 26','not a number')));
  insert into results
  select 'a code that is not defined is refused, and the codes are named',
         'must be one of: CIV (Civil), MEC (Mech)', e ->> 'message'
    from jsonb_array_elements(rep -> 'errors') e where e ->> 'column' = 'E_Discipline';
  insert into results
  select 'text in a user-defined number column is caught','must be a number',
         e ->> 'message' from jsonb_array_elements(rep -> 'errors') e
   where e ->> 'column' = 'Numeric 2';
  insert into results
  select 'text in a period column is caught','must be a number',
         e ->> 'message' from jsonb_array_elements(rep -> 'errors') e
   where e ->> 'column' = 'Jan 26';

  rep := validate_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','ok','E_Discipline','MEC','P_Area','anything')));
  insert into results values ('a defined code passes, and a slot with no values is free text',
                              '0', rep ->> 'error_count');

  -- ------------------------------------------------------- the guards ----
  begin
    update attribute_definitions set title = 'Discipline'
     where enterprise_id = ent and project_id is null
       and category = 'line_item' and attribute_number = '02';
    insert into results values ('two slots cannot share a title','refused','accepted');
  exception when unique_violation then
    insert into results values ('two slots cannot share a title','refused','refused');
  end;

  update attribute_values set code = 'CIVIL' where definition_id = d_ent and code = 'CIV';
  insert into results
  select 'renaming a code reaches the imported row','CIVIL', ent_attr_01
    from etc_details where project_id = proj and item = 'Labour';
end $$;

select case when expected = actual then 'PASS' else 'FAIL' end as status,
       label, expected, actual
  from results
 order by (expected = actual), label;

rollback;
