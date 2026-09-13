-- ============================================================================
-- The attribute columns lose an underscore, so a row survives a round trip.
--
-- Rows cross the boundary through toCamelKey and toSnakeKey, which map
-- cost_code_id to costCodeId and back. They are not symmetric over digits:
-- toCamelKey turns ent_attr_01 into entAttr01, and toSnakeKey turns that back
-- into ent_attr01 -- a column that does not exist. Reads would have worked
-- and writes would have failed, which is the worse way round to find out.
--
-- ent_attr01 maps to entAttr01 and back again, so the generic conversion is
-- left alone rather than taught a special case that every other column would
-- have to be checked against.
--
-- The columns are empty, so this is a rename rather than a migration.
-- ============================================================================

do $rename$
declare
  s attribute_scopes%rowtype;
  i integer;
  old_name text;
  new_name text;
  prefix   text;
begin
  for s in select * from attribute_scopes loop
    for i in 1 .. 10 loop
      foreach prefix in array array['ent_attr', 'prj_attr'] loop
        if prefix = 'prj_attr' and not s.has_project_level then
          continue;
        end if;
        old_name := prefix || '_' || lpad(i::text, 2, '0');
        new_name := prefix || lpad(i::text, 2, '0');
        if exists (select 1 from information_schema.columns
                    where table_schema = 'public'
                      and table_name = s.table_name
                      and column_name = old_name) then
          execute format('alter table %I rename column %I to %I',
                         s.table_name, old_name, new_name);
        end if;
      end loop;
    end loop;
  end loop;
end
$rename$;

-- The two functions that build a column name from a slot.
create or replace function attribute_usage_count(p_definition_id uuid, p_code text)
returns bigint
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  d attribute_definitions%rowtype;
  s attribute_scopes%rowtype;
  col text; total bigint := 0; n bigint;
begin
  select * into d from attribute_definitions where id = p_definition_id;
  if not found then return 0; end if;

  col := case d.level when 'enterprise' then 'ent_attr' else 'prj_attr' end
         || d.attribute_number;

  for s in select * from attribute_scopes where category = d.category loop
    if d.level = 'project' and not s.has_project_level then continue; end if;

    if d.project_id is not null then
      execute format('select count(*) from %I t where t.%I = $1 and t.%I = $2',
                     s.table_name, s.project_column, col)
        into n using d.project_id, p_code;
    elsif s.enterprise_column is not null then
      execute format('select count(*) from %I t where t.%I = $1 and t.%I = $2',
                     s.table_name, s.enterprise_column, col)
        into n using d.enterprise_id, p_code;
    else
      execute format(
        'select count(*) from %I t join projects p on p.id = t.%I
          where p.enterprise_id = $1 and t.%I = $2',
        s.table_name, s.project_column, col)
        into n using d.enterprise_id, p_code;
    end if;

    total := total + coalesce(n, 0);
  end loop;

  return total;
end;
$fn$;

create or replace function attribute_values_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d attribute_definitions%rowtype;
  s attribute_scopes%rowtype;
  col text; used bigint;
begin
  if tg_op = 'UPDATE' and new.code is not distinct from old.code then
    return new;
  end if;

  select * into d from attribute_definitions
   where id = coalesce(old.definition_id, new.definition_id);
  if not found then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  col := case d.level when 'enterprise' then 'ent_attr' else 'prj_attr' end
         || d.attribute_number;

  if tg_op = 'DELETE' then
    used := attribute_usage_count(old.definition_id, old.code);
    if used > 0 then
      raise exception
        'The value % is used by % row(s) and cannot be deleted. Change those rows first.',
        old.code, used
        using errcode = 'foreign_key_violation';
    end if;
    return old;
  end if;

  for s in select * from attribute_scopes where category = d.category loop
    if d.level = 'project' and not s.has_project_level then continue; end if;

    if d.project_id is not null then
      execute format('update %I t set %I = $1 where t.%I = $2 and t.%I = $3',
                     s.table_name, col, s.project_column, col)
        using new.code, d.project_id, old.code;
    elsif s.enterprise_column is not null then
      execute format('update %I t set %I = $1 where t.%I = $2 and t.%I = $3',
                     s.table_name, col, s.enterprise_column, col)
        using new.code, d.enterprise_id, old.code;
    else
      execute format(
        'update %I t set %I = $1
          where t.%I in (select id from projects where enterprise_id = $2)
            and t.%I = $3',
        s.table_name, col, s.project_column, col)
        using new.code, d.enterprise_id, old.code;
    end if;
  end loop;

  return new;
end;
$fn$;

revoke all on function attribute_values_guard() from public, anon, authenticated;
revoke all on function attribute_usage_count(uuid, text) from public, anon;
grant execute on function attribute_usage_count(uuid, text) to authenticated;
