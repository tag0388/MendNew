-- ============================================================================
-- attribute_definitions / attribute_values
--
-- Attributes used to be slots in a jsonb array with their assignments in
-- another jsonb column, which meant the database could not tell a live code
-- from a stale one. These assertions cover what the tables now guarantee.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/attribute_tables_test.sql
-- Every line prints PASS or FAIL; nothing is left behind.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create temporary table results (label text, expected text, actual text) on commit drop;

do $$
declare ent uuid; proj uuid; def uuid; val uuid; n int;
begin
  insert into enterprises (name, enterprise_code) values ('ZZ-ATTR','ZZATTR') returning id into ent;
  insert into projects (enterprise_id, project_name, project_code)
  values (ent,'ZZ-ATTR','ZZATTR-1') returning id into proj;

  -- ---------------------------------------------- the slots always exist ----
  -- Nine categories, ten numbered slots each. A user never makes one.
  select count(*) into n from attribute_definitions where enterprise_id = ent and project_id is null;
  insert into results values ('a new enterprise gets ten slots per category','90', n::text);
  select count(*) into n from attribute_definitions where project_id = proj;
  insert into results values ('a new project gets them too, minus its own category','80', n::text);
  select count(*) into n from attribute_definitions
   where project_id = proj and category = 'project';
  insert into results values ('there is no project-level project category','0', n::text);

  -- --------------------------------------------------- codes are scoped ----
  update attribute_definitions set title = 'Discipline'
   where enterprise_id = ent and project_id is null
     and category = 'cost_code' and attribute_number = '01'
  returning id into def;

  insert into attribute_values (definition_id, code, description, sort_order)
  values (def,'CIV','Civil',1) returning id into val;
  insert into attribute_values (definition_id, code, description, sort_order)
  values (def,'MEC','Mech',2);

  begin
    insert into attribute_values (definition_id, code) values (def,'CIV');
    insert into results values ('a duplicate code in one slot is refused','refused','accepted');
  exception when unique_violation then
    insert into results values ('a duplicate code in one slot is refused','refused','refused');
  end;

  -- "unique per attribute", not globally: another slot may reuse the code.
  begin
    insert into attribute_values (definition_id, code)
    select id, 'CIV' from attribute_definitions
     where enterprise_id = ent and project_id is null
       and category = 'cost_code' and attribute_number = '02';
    insert into results values ('the same code in another slot is allowed','allowed','allowed');
  exception when others then
    insert into results values ('the same code in another slot is allowed','allowed', sqlerrm);
  end;

  -- ------------------------------------------------ assignment is a column --
  insert into cost_codes (project_id, code, name, ent_attr_01)
  values (proj,'1100','Civil works','CIV');
  insert into results
  select 'the code lands in a real column','CIV', ent_attr_01
    from cost_codes where project_id = proj;
  insert into results values ('the value knows it is in use','1',
                              attribute_usage_count(def,'CIV')::text);

  -- ------------------------------------------------------------ guards ----
  -- No foreign key can stand behind a text code, so these two rules do the
  -- same work from the attribute_values side, where the volume is small.
  begin
    delete from attribute_values where id = val;
    insert into results values ('deleting a code in use is refused','refused','deleted');
  exception when foreign_key_violation then
    insert into results values ('deleting a code in use is refused','refused','refused');
  end;

  update attribute_values set code = 'CIVIL' where id = val;
  insert into results
  select 'renaming a code carries into the rows that hold it','CIVIL', ent_attr_01
    from cost_codes where project_id = proj;

  delete from attribute_values where definition_id = def and code = 'MEC';
  insert into results values ('an unused code deletes cleanly','0',
    (select count(*)::text from attribute_values where definition_id = def and code = 'MEC'));

  -- A description is a label; changing it must not rewrite any data.
  update attribute_values set description = 'Civil Engineering' where id = val;
  insert into results
  select 'changing only the description leaves the rows alone','CIVIL', ent_attr_01
    from cost_codes where project_id = proj;
end $$;

select case when expected = actual then 'PASS' else 'FAIL' end as status,
       label, expected, actual
  from results
 order by (expected = actual), label;

rollback;
