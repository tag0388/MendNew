-- ============================================================================
-- validate_import
--
-- A sheet is checked before anything is written, so the user sees every
-- problem at once and can fix the spreadsheet rather than discovering a bad
-- cell half way through a load.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/import_validation_test.sql
-- Every line prints PASS or FAIL; nothing is left behind.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create temporary table results (label text, expected text, actual text) on commit drop;

do $$
declare
  ent uuid; proj uuid; cc text := 'ZZ-CC-1';
  report jsonb;
begin
  insert into enterprises (name, enterprise_code)
  values ('ZZ-IMPORT-TEST', 'ZZIMP') returning id into ent;
  insert into projects (enterprise_id, project_name, project_code)
  values (ent, 'ZZ-IMPORT-TEST', 'ZZIMP-1') returning id into proj;
  insert into cost_codes (project_id, code, name) values (proj, cc, 'Existing');

  -- ------------------------------------------------------- a clean sheet ----
  report := validate_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID', cc, 'Item', 'Labour',
                       'Qty', '100', 'Rate', '12.5', 'Phasing Unit', 'Monthly')));
  insert into results values ('a valid row raises nothing', '0', report ->> 'error_count');
  insert into results values ('a table with no business key appends', 'true', report ->> 'appends');

  -- --------------------------------------------------- one fault per kind ----
  report := validate_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID', 'NOPE-999', 'Item', 'Steel', 'Qty', 'about ten',
                       'Phasing Unit', 'Fortnightly', 'Phasing Start Date', '12/03/2026'),
    jsonb_build_object('Cost Code ID', '', 'Item', '')));

  insert into results
  select 'text in a number column is caught', 'must be a number',
         e ->> 'message' from jsonb_array_elements(report -> 'errors') e
   where e ->> 'column' = 'Qty';

  insert into results
  select 'a value outside the list is caught, and the list is named',
         'must be one of: Daily, Weekly, Monthly, Total, Profile',
         e ->> 'message' from jsonb_array_elements(report -> 'errors') e
   where e ->> 'column' = 'Phasing Unit';

  insert into results
  select 'a date in the wrong shape is caught', 'must be a date, written as YYYY-MM-DD',
         e ->> 'message' from jsonb_array_elements(report -> 'errors') e
   where e ->> 'column' = 'Phasing Start Date';

  insert into results
  select 'a cost code from another project is caught', 'is not a cost code in this project',
         e ->> 'message' from jsonb_array_elements(report -> 'errors') e
   where e ->> 'column' = 'Cost Code ID' and e ->> 'value' = 'NOPE-999';

  insert into results
  select 'a missing required cell is caught', 'is required',
         e ->> 'message' from jsonb_array_elements(report -> 'errors') e
   where e ->> 'column' = 'Item';

  -- The header is row 1, so the first data row the user sees is row 2.
  insert into results
  select 'the row number is the one shown in Excel', '2',
         e ->> 'row' from jsonb_array_elements(report -> 'errors') e
   where e ->> 'column' = 'Qty';

  -- ------------------------------------------- edits against new rows ----
  report := validate_import('cost_codes', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID', cc, 'Cost Code Name', 'Renamed'),
    jsonb_build_object('Cost Code ID', 'ZZ-CC-2', 'Cost Code Name', 'New'),
    jsonb_build_object('Cost Code ID', 'ZZ-CC-2', 'Cost Code Name', 'New again'),
    jsonb_build_object('Cost Code ID', 'ZZ-CC-3', 'EAC Method', 'Guesswork')));

  insert into results values ('an ID already in the project counts as an edit', '1',
                              report ->> 'to_update');
  insert into results values ('the rest count as new rows', '3', report ->> 'to_insert');

  insert into results
  select 'the same ID twice in one sheet is caught',
         'appears 2 times in this sheet; each one must be unique',
         e ->> 'message' from jsonb_array_elements(report -> 'errors') e
   where e ->> 'value' = 'ZZ-CC-2';

  -- ------------------------------------------------ the allow-list holds ----
  -- Approved budget is maintained by the change-order triggers. A column for
  -- it in the sheet is ignored rather than written.
  insert into results
  select 'a derived column cannot be imported', 'ignored',
         case when exists (
           select 1 from import_definitions d
           cross join lateral jsonb_to_recordset(d.columns)
             as c(label text, "column" text, type text, required boolean)
            where d.name = 'cost_codes' and c."column" = 'approved_budget')
         then 'importable' else 'ignored' end;

  -- ------------------------------------------------------ a bad request ----
  begin
    report := validate_import('no_such_import', proj, '[]'::jsonb);
    insert into results values ('an unknown import is refused', 'refused', 'accepted');
  exception when others then
    insert into results values ('an unknown import is refused', 'refused', 'refused');
  end;
end $$;

select case when expected = actual then 'PASS' else 'FAIL' end as status,
       label, expected, actual
  from results
 order by (expected = actual), label;

rollback;
