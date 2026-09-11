-- ============================================================================
-- The import engine reads the attribute tables.
--
-- import_dynamic_columns used to resolve E_<title> against the jsonb arrays on
-- the enterprise and project, and write into a jsonb column keyed by the
-- attribute number. Both ends have moved: the titles and codes are rows now,
-- and the assignment is a real column.
--
-- That makes attributes simpler than they were, not harder. An attribute
-- header is now an ordinary column like Description or Qty -- it just happens
-- to be named after something the user configured -- so the writer treats it
-- as one. Only the user-defined columns and the period figures are still
-- jsonb, because those really are maps.
--
-- A spec entry now carries EITHER:
--   column          a real column, written directly
--   target + key    a key inside a jsonb column
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

-- Two slots sharing a title would produce two identical column headers, and
-- a spreadsheet cannot tell them apart. Refuse it at the source.
create unique index if not exists attribute_definitions_enterprise_title
  on attribute_definitions (enterprise_id, category, level, lower(btrim(title)))
  where project_id is null and btrim(title) <> '';

create unique index if not exists attribute_definitions_project_title
  on attribute_definitions (project_id, category, lower(btrim(title)))
  where project_id is not null and btrim(title) <> '';

create or replace function import_dynamic_columns(
  p_definition text,
  p_scope_id   uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  def  import_definitions%rowtype;
  proj uuid;
  ent  uuid;
  cols jsonb := '{}'::jsonb;
  i    integer;
begin
  select * into def from import_definitions where name = p_definition;
  if not found then
    raise exception 'There is no import called %', p_definition;
  end if;

  if def.project_source is null then
    proj := p_scope_id;
  else
    execute format('select project_id from %I where id = $1', def.project_source)
      into proj using p_scope_id;
  end if;

  select enterprise_id into ent from projects where id = proj;

  -- ------------------------------------------------------- attributes ----
  -- A titled slot becomes one column; an untitled one is an unused slot and
  -- gets nothing. The codes it accepts come with it, so a cell can be checked
  -- without a second trip.
  if def.attribute_family is not null then
    select coalesce(cols || jsonb_object_agg(
             case d.level when 'enterprise' then 'E_' else 'P_' end || btrim(d.title),
             jsonb_strip_nulls(jsonb_build_object(
               'column', case d.level when 'enterprise' then 'ent_attr_' else 'prj_attr_' end
                         || d.attribute_number,
               'type',   'text',
               'ids', (select jsonb_agg(v.code order by v.sort_order, v.code)
                         from attribute_values v where v.definition_id = d.id),
               'labels', (select jsonb_agg(
                            case when coalesce(btrim(v.description), '') = ''
                                   or btrim(v.description) = v.code
                                 then v.code
                                 else v.code || ' (' || btrim(v.description) || ')'
                            end order by v.sort_order, v.code)
                         from attribute_values v where v.definition_id = d.id)
             ))), cols)
      into cols
      from attribute_definitions d
     where d.category = def.attribute_family::attribute_category
       and coalesce(btrim(d.title), '') <> ''
       and ((d.level = 'enterprise' and def.has_enterprise_attributes
             and d.enterprise_id = ent and d.project_id is null)
         or (d.level = 'project' and def.has_project_attributes
             and d.project_id = proj));
  end if;

  -- --------------------------------------------------- user-defined ----
  if def.has_user_defined then
    for i in 1 .. 5 loop
      cols := cols
        || jsonb_build_object('Numeric ' || i,
             jsonb_build_object('target','user_defined','key','num' || i,'type','numeric'))
        || jsonb_build_object('Text ' || i,
             jsonb_build_object('target','user_defined','key','text' || i,'type','text'));
    end loop;
  end if;

  -- ------------------------------------------------- period columns ----
  if def.has_period_values and proj is not null then
    select coalesce(cols || jsonb_object_agg(
             p.name,
             jsonb_build_object('target','period_values','key',p.id::text,'type','numeric')), cols)
      into cols
      from reporting_periods p
     where p.project_id = proj and p.kind = 'cost' and coalesce(btrim(p.name),'') <> '';
  end if;

  return cols;
end;
$fn$;

revoke all on function import_dynamic_columns(text, uuid) from public, anon;
grant execute on function import_dynamic_columns(text, uuid) to authenticated;

-- --------------------------------------------------------------- writing ----
-- An attribute column is written like any other now. Only the entries that
-- name a jsonb target still have to be gathered into an object.
create or replace function apply_import(
  p_definition text,
  p_scope_id   uuid,
  p_rows       jsonb,
  p_replace    boolean default false,
  p_headers    text[] default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  def         import_definitions%rowtype;
  headers     text[];
  known       text[] := '{}';
  col_list    text[] := '{}';
  val_list    text[] := '{}';
  set_list    text[] := '{}';
  joins       text := '';
  c           record;
  lookup_key  text;
  lookup      jsonb;
  alias       text;
  n           integer := 0;
  expr        text;
  col_default text;
  col_notnull boolean;
  sql         text;
  deleted     integer := 0;
  inserted    integer := 0;
  updated     integer := 0;
  dyn         jsonb;
  dyn_key     text;
  dyn_spec    jsonb;
  target      text;
  pairs       jsonb := '{}'::jsonb;
  pair        text;
begin
  select * into def from import_definitions where name = p_definition;
  if not found then raise exception 'There is no import called %', p_definition; end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The sheet must arrive as an array of rows';
  end if;

  -- The user ticked Delete Existing Data. This clears the whole scope, not
  -- only the rows the sheet mentions; the dialog says so before it gets here.
  if p_replace then
    execute format('delete from %I where %I = $1', def.table_name, def.scope_column)
      using p_scope_id;
    get diagnostics deleted = row_count;
  end if;

  if jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('submitted', 0, 'inserted', 0, 'updated', 0,
                              'deleted', deleted, 'ignored_columns', '[]'::jsonb);
  end if;

  headers := coalesce(p_headers, (select array_agg(k) from jsonb_object_keys(p_rows -> 0) k));
  if headers is null or array_length(headers, 1) is null then
    raise exception 'The sheet has no column headings';
  end if;

  col_list := col_list || quote_ident(def.scope_column);
  val_list := val_list || '$2'::text;

  for lookup_key, lookup in select * from jsonb_each(def.derived_columns) loop
    col_list := col_list || quote_ident(lookup_key);
    val_list := val_list || replace(lookup #>> '{}', '$1', '$2');
  end loop;

  for lookup_key, lookup in select * from jsonb_each(def.lookups) loop
    known := known || lookup_key;
    if not (lookup_key = any (headers)) then continue; end if;
    n := n + 1; alias := 'lk' || n::text;
    joins := joins || format(
      ' %s %I %I on %I.%I = $2 and %I.%I::text = btrim(r.obj ->> %L)',
      case when coalesce((lookup ->> 'required')::boolean, false) then 'join' else 'left join' end,
      lookup ->> 'table', alias, alias, lookup ->> 'scope',
      alias, lookup ->> 'match', lookup_key);
    col_list := col_list || quote_ident(lookup ->> 'column');
    val_list := val_list || format('%I.id', alias);
    set_list := set_list || format('%1$I = excluded.%1$I', lookup ->> 'column');
  end loop;

  for c in select * from jsonb_to_recordset(def.columns)
             as t(label text, "column" text, type text, required boolean)
  loop
    known := known || c.label;
    if not (c.label = any (headers)) then continue; end if;
    expr := import_value_expr(c.label, c.type);
    select a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
      into col_notnull, col_default
      from pg_attribute a
      join pg_class cl on cl.oid = a.attrelid and cl.relname = def.table_name
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attname = c."column" and a.attnum > 0 and not a.attisdropped;
    if col_notnull and col_default is not null then
      expr := format('coalesce(%s, %s)', expr, col_default);
    end if;
    col_list := col_list || quote_ident(c."column");
    val_list := val_list || expr;
    set_list := set_list || format('%1$I = excluded.%1$I', c."column");
  end loop;

  dyn := import_dynamic_columns(p_definition, p_scope_id);
  for dyn_key, dyn_spec in select * from jsonb_each(dyn) loop
    known := known || dyn_key;
    if not (dyn_key = any (headers)) then continue; end if;

    if dyn_spec ? 'column' then
      -- An attribute: a real column holding the code the sheet carries.
      col_list := col_list || quote_ident(dyn_spec ->> 'column');
      val_list := val_list || import_value_expr(dyn_key, 'text');
      set_list := set_list || format('%1$I = excluded.%1$I', dyn_spec ->> 'column');
      continue;
    end if;

    target := dyn_spec ->> 'target';
    if dyn_spec ->> 'type' = 'numeric' then
      pair := format('%L, nullif(replace(btrim(r.obj ->> %L), '','', ''''), '''')::numeric',
                     dyn_spec ->> 'key', dyn_key);
    else
      pair := format('%L, nullif(btrim(r.obj ->> %L), '''')', dyn_spec ->> 'key', dyn_key);
    end if;

    pairs := jsonb_set(pairs, array[target],
                       coalesce(pairs -> target, '[]'::jsonb) || to_jsonb(pair));
  end loop;

  for target in select jsonb_object_keys(pairs) loop
    col_list := col_list || quote_ident(target);
    val_list := val_list || format('jsonb_strip_nulls(jsonb_build_object(%s))',
      (select string_agg(p #>> '{}', ', ') from jsonb_array_elements(pairs -> target) p));

    if target = 'period_values' then
      -- Setting a period's total makes its week and day keys stale.
      set_list := set_list || format(
        '%1$I = import_merge_period_values(%2$I.%1$I, excluded.%1$I)', target, def.table_name);
    else
      set_list := set_list || format(
        '%1$I = coalesce(%2$I.%1$I, ''{}''::jsonb) || excluded.%1$I', target, def.table_name);
    end if;
  end loop;

  if def.key_column is not null and array_length(set_list, 1) is not null then
    sql := format(
      'with src as (select r.obj from jsonb_array_elements($1) r(obj)),
            done as (insert into %I (%s) select %s from src r%s
                     on conflict (%I, %I) do update set %s, updated_at = now()
                     returning (xmax = 0) as was_insert)
       select count(*) filter (where was_insert), count(*) filter (where not was_insert) from done',
      def.table_name, array_to_string(col_list, ', '), array_to_string(val_list, ', '), joins,
      def.scope_column, def.key_column, array_to_string(set_list, ', '));
  elsif def.key_column is not null then
    sql := format(
      'with src as (select r.obj from jsonb_array_elements($1) r(obj)),
            done as (insert into %I (%s) select %s from src r%s
                     on conflict (%I, %I) do nothing returning 1 as was_insert)
       select count(*), 0 from done',
      def.table_name, array_to_string(col_list, ', '), array_to_string(val_list, ', '), joins,
      def.scope_column, def.key_column);
  else
    sql := format(
      'with src as (select r.obj from jsonb_array_elements($1) r(obj)),
            done as (insert into %I (%s) select %s from src r%s returning 1 as was_insert)
       select count(*), 0 from done',
      def.table_name, array_to_string(col_list, ', '), array_to_string(val_list, ', '), joins);
  end if;

  execute sql into inserted, updated using p_rows, p_scope_id;

  return jsonb_build_object(
    'definition', def.name,
    'label',      def.label,
    'submitted',  jsonb_array_length(p_rows),
    'inserted',   inserted,
    'updated',    updated,
    'deleted',    deleted,
    'ignored_columns', coalesce(
      (select jsonb_agg(h order by h) from unnest(headers) h where not (h = any (known))),
      '[]'::jsonb));
end;
$fn$;

revoke all on function apply_import(text, uuid, jsonb, boolean, text[]) from public, anon;
grant execute on function apply_import(text, uuid, jsonb, boolean, text[]) to authenticated;
