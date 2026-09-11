-- ============================================================================
-- The bulk import engine, part two: writing the sheet.
--
-- apply_import turns a validated sheet into one INSERT. Not one per row --
-- one statement for the whole batch, built from the registry, with the
-- parent lookups resolved by joining rather than by asking the database once
-- per row. A 5,000-row batch is a single round trip.
--
-- For a table with a business key the statement ends in ON CONFLICT DO
-- UPDATE, so the same sheet imported twice is an edit the second time rather
-- than a duplicate. For the line-item and transaction tables there is no key
-- to conflict on, so rows are added -- unless the caller asks for a
-- replacement, in which case the project's existing rows go first.
--
-- Only the columns actually present in the sheet are written. A header the
-- registry does not know is reported back rather than silently dropped, so
-- the dialog can tell the user which of their columns had no effect.
--
-- The SQL is assembled from the registry, never from the sheet: table and
-- column names come from rows a migration wrote, and every value from the
-- sheet arrives as a bound parameter.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

-- Some tables need a column the sheet does not carry and the scope does not
-- supply -- a subcontract's line items are scoped by subcontract but the table
-- also records the project. The expression is registry-controlled and sees the
-- scope id as $1.
alter table import_definitions
  add column if not exists derived_columns jsonb not null default '{}'::jsonb;

update import_definitions
   set derived_columns = '{"project_id":"(select s.project_id from subcontracts s where s.id = $1)"}'::jsonb
 where name = 'subcontract_line_items';

-- How one cell becomes a value of the right type. Text arrives from Excel
-- however the user's machine formatted it, so numbers tolerate thousands
-- separators and blanks always become null rather than zero.
create or replace function import_value_expr(p_label text, p_type text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select case
    when p_type = 'numeric' then
      format('nullif(replace(btrim(r.obj ->> %L), '','', ''''), '''')::numeric', p_label)
    when p_type = 'integer' then
      format('nullif(replace(btrim(r.obj ->> %L), '','', ''''), '''')::integer', p_label)
    when p_type = 'date' then
      format('try_date(r.obj ->> %L)', p_label)
    when p_type = 'boolean' then
      format($x$case lower(nullif(btrim(r.obj ->> %L), ''))
                  when 'true' then true when 'yes' then true
                  when 'y' then true when '1' then true
                  when 'false' then false when 'no' then false
                  when 'n' then false when '0' then false end$x$, p_label)
    when p_type like 'enum:%' then
      format('nullif(btrim(r.obj ->> %L), '''')::%I', p_label, substring(p_type from 6))
    else
      format('nullif(btrim(r.obj ->> %L), '''')', p_label)
  end;
$fn$;

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
  def          import_definitions%rowtype;
  headers      text[];
  known        text[] := '{}';
  col_list     text[] := '{}';
  val_list     text[] := '{}';
  set_list     text[] := '{}';
  joins        text := '';
  c            record;
  lookup_key   text;
  lookup       jsonb;
  alias        text;
  n            integer := 0;
  expr         text;
  col_default  text;
  col_notnull  boolean;
  sql          text;
  deleted      integer := 0;
  inserted     integer := 0;
  updated      integer := 0;
begin
  select * into def from import_definitions where name = p_definition;
  if not found then
    raise exception 'There is no import called %', p_definition;
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The sheet must arrive as an array of rows';
  end if;

  -- ----------------------------------------- replace what is there first ----
  -- The user ticked Delete Existing Data. This clears the whole scope, not
  -- only the rows the sheet happens to mention -- the dialog says so before
  -- it gets here.
  if p_replace then
    execute format('delete from %I where %I = $1', def.table_name, def.scope_column)
      using p_scope_id;
    get diagnostics deleted = row_count;
  end if;

  if jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('inserted', 0, 'updated', 0, 'deleted', deleted,
                              'ignored_columns', '[]'::jsonb);
  end if;

  headers := coalesce(p_headers,
                      (select array_agg(k) from jsonb_object_keys(p_rows -> 0) k));

  if headers is null or array_length(headers, 1) is null then
    raise exception 'The sheet has no column headings';
  end if;

  -- ------------------------------------------------------- the scope ----
  col_list := col_list || quote_ident(def.scope_column);
  val_list := val_list || '$2'::text;

  -- --------------------------------------- columns the table needs but ----
  -- the sheet cannot carry.
  for lookup_key, lookup in select * from jsonb_each(def.derived_columns) loop
    col_list := col_list || quote_ident(lookup_key);
    val_list := val_list || replace(lookup #>> '{}', '$1', '$2');
  end loop;

  -- ------------------------------------------- the IDs the user typed ----
  -- Resolved by joining once, not looked up per row. A required parent is an
  -- inner join, so a row naming something that does not exist simply does not
  -- land -- validation has already told the user about it.
  for lookup_key, lookup in select * from jsonb_each(def.lookups) loop
    known := known || lookup_key;
    if not (lookup_key = any (headers)) then
      continue;
    end if;
    n := n + 1;
    alias := 'lk' || n::text;
    joins := joins || format(
      ' %s %I %I on %I.%I = $2 and %I.%I::text = btrim(r.obj ->> %L)',
      case when coalesce((lookup ->> 'required')::boolean, false) then 'join' else 'left join' end,
      lookup ->> 'table', alias,
      alias, lookup ->> 'scope',
      alias, lookup ->> 'match',
      lookup_key);
    col_list := col_list || quote_ident(lookup ->> 'column');
    val_list := val_list || format('%I.id', alias);
    set_list := set_list || format('%1$I = excluded.%1$I', lookup ->> 'column');
  end loop;

  -- ---------------------------------------------- the ordinary columns ----
  for c in
    select * from jsonb_to_recordset(def.columns)
      as t(label text, "column" text, type text, required boolean)
  loop
    known := known || c.label;
    if not (c.label = any (headers)) then
      continue;   -- a column the sheet left out keeps whatever it holds
    end if;

    expr := import_value_expr(c.label, c.type);

    -- A blank cell must not write null into a NOT NULL column; the table's
    -- own default is what an empty cell means.
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

  -- ------------------------------------------------------- the write ----
  -- xmax is zero on a row that was inserted and non-zero on one the conflict
  -- clause updated, which is how the two are counted apart.
  if def.key_column is not null and array_length(set_list, 1) is not null then
    sql := format(
      'with src as (select r.obj from jsonb_array_elements($1) r(obj)),
            done as (
              insert into %I (%s)
              select %s from src r%s
              on conflict (%I, %I) do update set %s, updated_at = now()
              returning (xmax = 0) as was_insert
            )
       select count(*) filter (where was_insert),
              count(*) filter (where not was_insert) from done',
      def.table_name,
      array_to_string(col_list, ', '),
      array_to_string(val_list, ', '),
      joins,
      def.scope_column, def.key_column,
      array_to_string(set_list, ', '));
  elsif def.key_column is not null then
    sql := format(
      'with src as (select r.obj from jsonb_array_elements($1) r(obj)),
            done as (
              insert into %I (%s)
              select %s from src r%s
              on conflict (%I, %I) do nothing
              returning 1 as was_insert
            )
       select count(*), 0 from done',
      def.table_name,
      array_to_string(col_list, ', '),
      array_to_string(val_list, ', '),
      joins,
      def.scope_column, def.key_column);
  else
    sql := format(
      'with src as (select r.obj from jsonb_array_elements($1) r(obj)),
            done as (
              insert into %I (%s)
              select %s from src r%s
              returning 1 as was_insert
            )
       select count(*), 0 from done',
      def.table_name,
      array_to_string(col_list, ', '),
      array_to_string(val_list, ', '),
      joins);
  end if;

  execute sql into inserted, updated using p_rows, p_scope_id;

  return jsonb_build_object(
    'definition', def.name,
    'label',      def.label,
    'submitted',  jsonb_array_length(p_rows),
    'inserted',   inserted,
    'updated',    updated,
    'deleted',    deleted,
    -- Headers the registry does not know. They were not written, and the
    -- dialog tells the user rather than letting an edit vanish.
    'ignored_columns', coalesce(
      (select jsonb_agg(h order by h) from unnest(headers) h where not (h = any (known))),
      '[]'::jsonb)
  );
end;
$fn$;

revoke all on function import_value_expr(text, text) from public, anon;
revoke all on function apply_import(text, uuid, jsonb, boolean, text[]) from public, anon;

grant execute on function import_value_expr(text, text) to authenticated;
grant execute on function apply_import(text, uuid, jsonb, boolean, text[]) to authenticated;
