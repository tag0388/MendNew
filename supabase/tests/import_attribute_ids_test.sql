-- ============================================================================
-- Attribute cells carry the ID, not the description
--
-- The ID is a code the user chose when defining the attribute value, and it
-- is what the row stores. The description belongs to the attribute
-- definition, not to the data.
--
-- The case that matters here is the one that used to break: an earlier
-- version accepted the description as well as the ID and resolved one to the
-- other through a single lookup, so a value whose ID matched a DIFFERENT
-- value's description silently resolved to the wrong code.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/import_attribute_ids_test.sql
-- Every line prints PASS or FAIL; nothing is left behind.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create temporary table results (label text, expected text, actual text) on commit drop;

do $$
declare ent uuid; proj uuid; res jsonb; rep jsonb;
begin
  -- "Civil" is the description of CIV and also the ID of another value.
  insert into enterprises (name, enterprise_code, line_item_attributes)
  values ('ZZ-ID','ZZID',
    '[{"id":"01","title":"Discipline","values":[
        {"id":"CIV","description":"Civil"},
        {"id":"Civil","description":"Not the same thing at all"},
        {"id":"MEC","description":"Mech"}]},
      {"id":"02","title":"Phase","values":[]}]'::jsonb)
  returning id into ent;
  insert into projects (enterprise_id, project_name, project_code)
  values (ent,'ZZ-ID','ZZID-1') returning id into proj;
  insert into cost_codes (project_id, code, name) values (proj,'1100','Civil');

  res := apply_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','A','E_Discipline','CIV'),
    jsonb_build_object('Cost Code ID','1100','Item','B','E_Discipline','Civil')));
  insert into results values ('both rows landed','2', res ->> 'inserted');

  insert into results
  select 'the ID is stored exactly as typed','CIV', enterprise_attributes ->> '01'
    from etc_details where project_id = proj and item = 'A';
  insert into results
  select 'an ID that matches another value''s description is not confused','Civil',
         enterprise_attributes ->> '01' from etc_details where project_id = proj and item = 'B';

  -- A description is not an ID, even a correct one.
  rep := validate_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','C','E_Discipline','Mech')));
  insert into results
  select 'a description is refused, and the message names the codes',
         'must be one of: CIV (Civil), Civil (Not the same thing at all), MEC (Mech)',
         e ->> 'message' from jsonb_array_elements(rep -> 'errors') e
   where e ->> 'column' = 'E_Discipline';

  rep := validate_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','D','E_Discipline','MEC')));
  insert into results values ('a defined ID passes','0', rep ->> 'error_count');

  -- An attribute with no defined values is free text and takes anything.
  rep := validate_import('etc_details', proj, jsonb_build_array(
    jsonb_build_object('Cost Code ID','1100','Item','E','E_Phase','anything at all')));
  insert into results values ('an attribute with no list stays free text','0', rep ->> 'error_count');
end $$;

select case when expected = actual then 'PASS' else 'FAIL' end as status,
       label, expected, actual
  from results
 order by (expected = actual), label;

rollback;
