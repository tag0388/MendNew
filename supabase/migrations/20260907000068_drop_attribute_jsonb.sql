-- ============================================================================
-- The jsonb attribute columns go.
--
-- Every read and write in the app now names a real column. The definitions
-- moved to attribute_definitions and attribute_values; the assignments moved
-- to ent_attr01..10 and prj_attr01..10; the carry-over migration moved
-- anything the jsonb still held.
--
-- ORDER MATTERS. This must run only after the code that reads these columns
-- has been replaced in production. Dropped before that, a deployed build
-- asking for enterprise_attributes gets an error on every write. The
-- carry-over is deliberately a separate, earlier migration for exactly this
-- reason: it is safe against both the old code and the new, and this is not.
--
-- Also dropped: the eight attribute-definition arrays on enterprises and
-- projects, which attribute_definitions replaced, and the five merge
-- functions that existed only to patch the jsonb.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

-- The assignments on data rows.
do $drop_rows$
declare s attribute_scopes%rowtype;
begin
  for s in select * from attribute_scopes loop
    execute format('alter table %I drop column if exists enterprise_attributes', s.table_name);
    execute format('alter table %I drop column if exists project_attributes', s.table_name);
  end loop;
end
$drop_rows$;

-- The definitions on enterprises and projects.
do $drop_defs$
declare
  cat text;
  col text;
begin
  foreach cat in array array['project','cost_code','line_item','change','risk',
                             'subcontract','procurement','progress'] loop
    col := cat || '_attributes';
    execute format('alter table enterprises drop column if exists %I', col);
    execute format('alter table projects    drop column if exists %I', col);
  end loop;
end
$drop_defs$;

-- The functions that existed only to merge a patch into a jsonb column.
-- bulk_set_attributes replaced all five.
drop function if exists merge_change_attributes(uuid[], jsonb, jsonb);
drop function if exists merge_risk_attributes(uuid[], jsonb, jsonb);
drop function if exists merge_risk_record_attributes(uuid[], jsonb, jsonb);

-- A last check: nothing in the schema should still be named for the old shape.
do $check$
declare leftover text;
begin
  select string_agg(table_name || '.' || column_name, ', ')
    into leftover
    from information_schema.columns
   where table_schema = 'public'
     and (column_name in ('enterprise_attributes', 'project_attributes')
          or column_name ~ '^(project|cost_code|line_item|change|risk|subcontract|procurement|progress)_attributes$');
  if leftover is not null then
    raise exception 'attribute jsonb columns remain: %', leftover;
  end if;
end
$check$;
