-- ============================================================================
-- attribute_set / save_attribute_set
--
-- The editor screens work in sets: ten numbered slots for one category, each
-- with a title and a list of values. That is the shape the app has always
-- passed around, so the tables present it unchanged even though what sits
-- underneath is completely different.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/attribute_set_test.sql
-- Every line prints PASS or FAIL; nothing is left behind.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create temporary table results (label text, expected text, actual text) on commit drop;

do $$
declare ent uuid; proj uuid; s jsonb;
begin
  insert into enterprises (name, enterprise_code) values ('ZZ-SET','ZZSET') returning id into ent;
  insert into projects (enterprise_id, project_name, project_code)
  values (ent,'ZZ-SET','ZZSET-1') returning id into proj;

  -- ------------------------------------------------ the slots are there ----
  -- A screen never has to invent empty slots: they exist from the moment the
  -- enterprise does.
  s := attribute_set(ent, null, 'cost_code');
  insert into results values ('a fresh set has ten slots','10', jsonb_array_length(s)::text);
  insert into results values ('they start untitled','', s #>> '{0,title}');
  insert into results values ('and with no values','0',
                              jsonb_array_length(s #> '{0,values}')::text);

  -- ------------------------------------------------------- a round trip ----
  perform save_attribute_set(ent, null, 'cost_code', '[
    {"id":"01","title":"Discipline","values":[
      {"id":"CIV","description":"Civil","sortOrder":1},
      {"id":"MEC","description":"Mech","sortOrder":2}]},
    {"id":"02","title":"Sector","values":[]}]'::jsonb);

  s := attribute_set(ent, null, 'cost_code');
  insert into results values ('the title was kept','Discipline', s #>> '{0,title}');
  insert into results values ('both values were kept','2',
                              jsonb_array_length(s #> '{0,values}')::text);
  insert into results values ('a value round-trips as its code','CIV', s #>> '{0,values,0,id}');
  insert into results values ('with its description','Civil', s #>> '{0,values,0,description}');
  insert into results values ('the second slot was titled too','Sector', s #>> '{1,title}');
  insert into results values ('untouched slots are still there','10', jsonb_array_length(s)::text);

  -- --------------------------------------------------- saving is a diff ----
  -- Not a clear-and-reload: a value gone from the set is a real delete, and a
  -- slot the payload does not mention is left entirely alone.
  perform save_attribute_set(ent, null, 'cost_code', '[
    {"id":"01","title":"Discipline","values":[
      {"id":"CIV","description":"Civil Works","sortOrder":1}]}]'::jsonb);
  s := attribute_set(ent, null, 'cost_code');
  insert into results values ('a value dropped from the set is deleted','1',
                              jsonb_array_length(s #> '{0,values}')::text);
  insert into results values ('an edited description is saved','Civil Works',
                              s #>> '{0,values,0,description}');
  insert into results values ('a slot absent from the payload keeps its title','Sector',
                              s #>> '{1,title}');

  -- Which is what makes the guard work: a delete is visible as a delete.
  insert into cost_codes (project_id, code, name, ent_attr_01)
  values (proj,'1100','Civil','CIV');
  begin
    perform save_attribute_set(ent, null, 'cost_code',
      '[{"id":"01","title":"Discipline","values":[]}]'::jsonb);
    insert into results values ('dropping a value that rows hold is refused','refused','accepted');
  exception when foreign_key_violation then
    insert into results values ('dropping a value that rows hold is refused','refused','refused');
  end;

  -- --------------------------------------------- two levels, kept apart ----
  perform save_attribute_set(ent, proj, 'cost_code',
    '[{"id":"01","title":"Area","values":[{"id":"L3","description":"Level 3","sortOrder":1}]}]'::jsonb);
  insert into results values ('a project set is its own','Area',
                              attribute_set(ent, proj, 'cost_code') #>> '{0,title}');
  insert into results values ('and leaves the enterprise set alone','Discipline',
                              attribute_set(ent, null, 'cost_code') #>> '{0,title}');
end $$;

select case when expected = actual then 'PASS' else 'FAIL' end as status,
       label, expected, actual
  from results
 order by (expected = actual), label;

rollback;
