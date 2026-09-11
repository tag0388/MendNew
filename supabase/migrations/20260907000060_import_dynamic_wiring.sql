-- ============================================================================
-- The bulk import engine, part four: the dynamic columns are now checked and
-- written like any other.
--
-- import_dynamic_columns resolved E_<title>, Numeric n and the period columns
-- into the jsonb keys they stand for. This teaches the validator and the
-- writer to use that resolution, so an attribute edited in Excel actually
-- lands -- until now those headers came back as "ignored".
--
-- Three things are true of the jsonb columns that are not true of the rest:
--
--   * they MERGE rather than replace. A sheet carrying one attribute column
--     must not wipe the other nine.
--   * an attribute cell may hold the value's description or its id, and the
--     id is what gets stored, so a round trip through Excel shows "Civil" and
--     keeps "d1".
--   * writing a period's total invalidates any week or day breakdown stored
--     beneath it, so those keys are dropped as it is written.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

-- The spec now also carries the descriptions as a person reads them, so a
-- rejected cell can be told what the choices are.
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
  def    import_definitions%rowtype;
  proj   uuid;
  ent    uuid;
  ent_at jsonb := '[]'::jsonb;
  prj_at jsonb := '[]'::jsonb;
  cols   jsonb := '{}'::jsonb;
  i      integer;
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

  if def.attribute_family is not null then
    if def.has_enterprise_attributes and ent is not null then
      execute format('select coalesce(%I, ''[]''::jsonb) from enterprises where id = $1',
                     def.attribute_family || '_attributes')
        into ent_at using ent;
    end if;
    if def.has_project_attributes and proj is not null then
      execute format('select coalesce(%I, ''[]''::jsonb) from projects where id = $1',
                     def.attribute_family || '_attributes')
        into prj_at using proj;
    end if;

    select coalesce(cols || jsonb_object_agg(
             prefix || (a ->> 'title'),
             jsonb_strip_nulls(jsonb_build_object(
               'target', target,
               'key',    a ->> 'id',
               'type',   'text',
               -- what a person may type, mapped to what is stored
               'values', (
                 select jsonb_object_agg(k, v.id)
                   from jsonb_array_elements(coalesce(a -> 'values', '[]'::jsonb)) av
                   cross join lateral (select av ->> 'id' as id, av ->> 'description' as descr) v
                   cross join lateral unnest(array[lower(btrim(v.descr)), lower(btrim(v.id))]) k
                  where k <> ''
               ),
               -- and the same choices as they are written, for the error
               'labels', (
                 select jsonb_agg(coalesce(nullif(btrim(av ->> 'description'), ''), av ->> 'id'))
                   from jsonb_array_elements(coalesce(a -> 'values', '[]'::jsonb)) av
               )))), cols)
      into cols
      from (
        select 'E_' as prefix, 'enterprise_attributes' as target, a from jsonb_array_elements(ent_at) a
        union all
        select 'P_', 'project_attributes', a from jsonb_array_elements(prj_at) a
      ) s
     where coalesce(btrim(s.a ->> 'title'), '') <> '';
  end if;

  if def.has_user_defined then
    for i in 1 .. 5 loop
      cols := cols
        || jsonb_build_object('Numeric ' || i,
             jsonb_build_object('target','user_defined','key','num' || i,'type','numeric'))
        || jsonb_build_object('Text ' || i,
             jsonb_build_object('target','user_defined','key','text' || i,'type','text'));
    end loop;
  end if;

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

-- --------------------------------------------------------- validation ----
-- Same as before, with the dynamic headers checked too: a number column that
-- holds text, and an attribute cell that is not one of the choices.
create or replace function validate_import(
  p_definition text,
  p_scope_id   uuid,
  p_rows       jsonb,
  p_max_errors integer default 500
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  def           import_definitions%rowtype;
  errors        jsonb := '[]'::jsonb;
  lookup_errors jsonb;
  dyn           jsonb;
  total         integer;
  existing      integer := 0;
  key_values    text[];
  lookup_key    text;
  lookup        jsonb;
begin
  select * into def from import_definitions where name = p_definition;
  if not found then
    raise exception 'There is no import called %', p_definition;
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The sheet must arrive as an array of rows';
  end if;

  total := jsonb_array_length(p_rows);
  dyn := import_dynamic_columns(p_definition, p_scope_id);

  -- The header is row 1, so the first data row is the row 2 a person sees.
  with sheet as (
    select r.value as obj, (r.ordinality + 1)::int as row_no
      from jsonb_array_elements(p_rows) with ordinality r(value, ordinality)
  ),
  spec as (
    -- the registry's own columns
    select c.label, c.type, coalesce(c.required, false) as required, null::jsonb as choices
      from jsonb_to_recordset(def.columns)
        as c(label text, "column" text, type text, required boolean)
    union all
    -- and the ones that depend on how this project is configured
    select d.key, d.value ->> 'type', false, d.value
      from jsonb_each(dyn) d
  ),
  checked as (
    select s.row_no, sp.label, btrim(coalesce(s.obj ->> sp.label, '')) as value,
           case
             when sp.required and btrim(coalesce(s.obj ->> sp.label, '')) = ''
               then 'is required'
             when btrim(coalesce(s.obj ->> sp.label, '')) = ''
               then null
             -- an attribute with a fixed list of choices
             when sp.choices ? 'values' then
               case when sp.choices -> 'values' ? lower(btrim(s.obj ->> sp.label))
                    then null
                    else 'must be one of: ' || (
                      select string_agg(l #>> '{}', ', ')
                        from jsonb_array_elements(sp.choices -> 'labels') l)
               end
             else import_check_value(s.obj ->> sp.label, sp.type)
           end as message
      from sheet s
      join spec sp on s.obj ? sp.label or sp.required
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'row', row_no, 'column', label, 'value', value, 'message', message
         ) order by row_no, label), '[]'::jsonb)
    into errors
    from (select * from checked where message is not null
           order by row_no, label limit p_max_errors) e;

  for lookup_key, lookup in select * from jsonb_each(def.lookups) loop
    execute format($q$
      with sheet as (
        select r.value as obj, (r.ordinality + 1)::int as row_no
          from jsonb_array_elements($1) with ordinality r(value, ordinality)
      ),
      missing as (
        select s.row_no, btrim(coalesce(s.obj ->> $2, '')) as value
          from sheet s
         where case when $5 then btrim(coalesce(s.obj ->> $2, '')) = '' else false end
            or (btrim(coalesce(s.obj ->> $2, '')) <> ''
                and not exists (
                  select 1 from %I t
                   where t.%I = $3
                     and t.%I::text = btrim(s.obj ->> $2)))
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'row', row_no, 'column', $2, 'value', value,
               'message', case when value = '' then 'is required' else $4 end)
              order by row_no), '[]'::jsonb)
        from missing
      $q$,
      lookup ->> 'table', lookup ->> 'scope', lookup ->> 'match')
    into lookup_errors
    using p_rows, lookup_key, p_scope_id,
          coalesce(lookup ->> 'message', 'is not in this project'),
          coalesce((lookup ->> 'required')::boolean, false);
    errors := errors || lookup_errors;
  end loop;

  if def.key_column is not null then
    with sheet as (
      select btrim(coalesce(r.value ->> def.key_label, '')) as key,
             (r.ordinality + 1)::int as row_no
        from jsonb_array_elements(p_rows) with ordinality r(value, ordinality)
    ),
    dupes as (
      select key, min(row_no) as first_row, count(*) as n
        from sheet where key <> '' group by key having count(*) > 1
    )
    select errors || coalesce(jsonb_agg(jsonb_build_object(
             'row', first_row, 'column', def.key_label, 'value', key,
             'message', format('appears %s times in this sheet; each one must be unique', n)
           ) order by first_row), '[]'::jsonb)
      into errors from dupes;

    select array_agg(distinct btrim(coalesce(r.value ->> def.key_label, '')))
      into key_values from jsonb_array_elements(p_rows) r;

    execute format(
      'select count(*) from %I t where t.%I = $1 and t.%I::text = any($2)',
      def.table_name, def.scope_column, def.key_column)
      into existing using p_scope_id, coalesce(key_values, '{}'::text[]);
  end if;

  return jsonb_build_object(
    'definition',  def.name,
    'label',       def.label,
    'total',       total,
    'to_update',   existing,
    'to_insert',   greatest(total - existing, 0),
    'appends',     def.key_column is null,
    'error_count', jsonb_array_length(errors),
    'truncated',   jsonb_array_length(errors) >= p_max_errors,
    'errors',      errors
  );
end;
$fn$;

revoke all on function validate_import(text, uuid, jsonb, integer) from public, anon;
grant execute on function validate_import(text, uuid, jsonb, integer) to authenticated;

-- ------------------------------------------------------------- writing ----
-- Same as before, plus the jsonb columns, which merge rather than replace.
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
  pairs       jsonb := '{}'::jsonb;   -- target column -> list of key/value pairs
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

  -- ------------------------------------------------- the jsonb columns ----
  -- Each dynamic header contributes one key/value pair to its column's
  -- object. The pairs are gathered per column so all of one column's
  -- headers are built in a single jsonb_build_object.
  dyn := import_dynamic_columns(p_definition, p_scope_id);
  for dyn_key, dyn_spec in select * from jsonb_each(dyn) loop
    known := known || dyn_key;
    if not (dyn_key = any (headers)) then continue; end if;

    target := dyn_spec ->> 'target';
    if dyn_spec ? 'values' then
      -- The cell may hold the description or the id; the id is stored.
      pair := format('%L, (%L::jsonb ->> lower(btrim(r.obj ->> %L)))',
                     dyn_spec ->> 'key', dyn_spec -> 'values', dyn_key);
    elsif dyn_spec ->> 'type' = 'numeric' then
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
    -- A cell left blank contributes nothing rather than a null key.
    val_list := val_list || format('jsonb_strip_nulls(jsonb_build_object(%s))',
      (select string_agg(p #>> '{}', ', ') from jsonb_array_elements(pairs -> target) p));

    if target = 'period_values' then
      -- Setting a period's total makes its week and day keys stale.
      set_list := set_list || format(
        '%1$I = import_merge_period_values(%2$I.%1$I, excluded.%1$I)', target, def.table_name);
    else
      -- Merge, so a sheet carrying one attribute does not wipe the others.
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
