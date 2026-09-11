-- ============================================================================
-- The bulk import engine, part one: what may be imported, and whether a sheet
-- is valid.
--
-- Every Bulk screen works the same way: the user exports a sheet, edits it in
-- Excel, and imports it back. The sheet carries the IDs the user already
-- knows -- a cost code, a change order number, a package ID -- never a
-- database uuid. The screen knows which project it is on, so the import
-- resolves those IDs within that project.
--
-- One registry row describes each importable table. The registry is the
-- allow-list: a column that is not in it cannot be written by an import, so
-- derived figures (approved budget, actual cost to date, EAC) stay derived
-- no matter what someone types into the spreadsheet.
--
-- Tables split into two kinds:
--
--   * Those with a business key the user owns -- cost code, change order,
--     package. `key_column` is set, and an import is update-or-insert: the
--     key exists, it is an edit; it does not, it is a new row.
--
--   * Line items and transactions -- ETC details, actual costs, baseline
--     budgets, change and risk records. Two identical rows are legitimately
--     two rows, so there is no "does this already exist" question to ask.
--     `key_column` is null and an import appends, unless the user ticks
--     Delete Existing Data.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

create table if not exists import_definitions (
  name          text primary key,            -- what the UI asks for
  label         text not null,               -- 'ETC Details'
  table_name    text not null,               -- the table written
  scope_column  text not null,               -- 'project_id', 'subcontract_id', ...
  key_column    text,                        -- null = append-only (see above)
  key_label     text,                        -- that key's column header in the sheet
  columns       jsonb not null,              -- [{label, column, type, required}]
  lookups       jsonb not null default '{}', -- header -> another table's row
  has_enterprise_attributes boolean not null default false,
  has_project_attributes    boolean not null default false,
  has_user_defined          boolean not null default false,
  has_period_values         boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table import_definitions enable row level security;

-- The registry is written by migrations, never by the app.
drop policy if exists import_definitions_select on import_definitions;
create policy import_definitions_select on import_definitions
  for select to authenticated using (true);

-- ---------------------------------------------------------------- helpers --

-- The values an enum accepts, for validating a typed-in cell.
create or replace function import_enum_values(p_type text)
returns text[]
language sql
stable
set search_path = public
as $$
  select array_agg(e.enumlabel::text order by e.enumsortorder)
    from pg_type t join pg_enum e on e.enumtypid = t.oid
   where t.typname = p_type;
$$;

-- Why a cell cannot be stored, or null if it can. The message is shown to
-- the person who typed it, so it says what to do rather than naming a type.
create or replace function import_check_value(p_value text, p_type text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v text := btrim(coalesce(p_value, ''));
  allowed text[];
begin
  if v = '' then return null; end if;   -- emptiness is the caller's business

  if p_type = 'text' then
    return null;

  elsif p_type = 'numeric' then
    if v ~ '^-?[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$' or v ~ '^-?[0-9]*\.?[0-9]+$' then
      return null;
    end if;
    return 'must be a number';

  elsif p_type = 'integer' then
    if v ~ '^-?[0-9]+$' then return null; end if;
    return 'must be a whole number';

  elsif p_type = 'date' then
    -- Excel writes several shapes depending on the machine's locale.
    if v ~ '^\d{4}-\d{2}-\d{2}' then
      begin perform v::date; return null; exception when others then return 'is not a date'; end;
    end if;
    return 'must be a date, written as YYYY-MM-DD';

  elsif p_type = 'boolean' then
    if lower(v) in ('true','false','yes','no','y','n','1','0') then return null; end if;
    return 'must be Yes or No';

  elsif p_type like 'enum:%' then
    allowed := import_enum_values(substring(p_type from 6));
    if allowed is null then return 'has no list of allowed values'; end if;
    if v = any (allowed) then return null; end if;
    return 'must be one of: ' || array_to_string(allowed, ', ');

  end if;
  return null;
end;
$$;

-- ------------------------------------------------------------- validation --

-- Check a sheet without writing anything.
--
-- Returns {total, to_insert, to_update, error_count, errors:[{row, column,
-- value, message}]}. The row numbers are the ones the user sees in Excel --
-- the header is row 1, so the first data row is row 2.
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
as $$
declare
  def        import_definitions%rowtype;
  errors     jsonb := '[]'::jsonb;
  lookup_errors jsonb;
  total      integer;
  existing   integer := 0;
  key_values text[];
  lookup_key text;
  lookup     jsonb;
begin
  select * into def from import_definitions where name = p_definition;
  if not found then
    raise exception 'There is no import called %', p_definition;
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The sheet must arrive as an array of rows';
  end if;

  total := jsonb_array_length(p_rows);

  -- ------------------------------------------------- one cell at a time ----
  with sheet as (
    select r.value as obj, (r.ordinality + 1)::int as row_no
      from jsonb_array_elements(p_rows) with ordinality r(value, ordinality)
  ),
  cols as (
    select * from jsonb_to_recordset(def.columns)
      as c(label text, "column" text, type text, required boolean)
  ),
  checked as (
    select s.row_no, c.label, btrim(coalesce(s.obj ->> c.label, '')) as value,
           case
             when coalesce(c.required, false)
              and btrim(coalesce(s.obj ->> c.label, '')) = ''
               then 'is required'
             else import_check_value(s.obj ->> c.label, c.type)
           end as message
      from sheet s cross join cols c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'row', row_no, 'column', label, 'value', value, 'message', message
         ) order by row_no, label), '[]'::jsonb)
    into errors
    from (select * from checked where message is not null
           order by row_no, label limit p_max_errors) e;

  -- --------------------------------------- IDs that must already exist ----
  -- A cost code typed into an ETC sheet has to be a cost code of this
  -- project. Resolving it here means the import itself never guesses.
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
               'message', case when value = '' then 'is required'
                               else $4 end)
              order by row_no), '[]'::jsonb)
        from missing
      $q$,
      lookup ->> 'table', lookup ->> 'scope', lookup ->> 'match')
    into lookup_errors
    using p_rows,
          lookup_key,
          p_scope_id,
          coalesce(lookup ->> 'message', 'is not in this project'),
          coalesce((lookup ->> 'required')::boolean, false);

    errors := errors || lookup_errors;
  end loop;

  -- --------------------------------------- the same ID used twice over ----
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

    -- How many of these are edits rather than new rows.
    select array_agg(distinct btrim(coalesce(r.value ->> def.key_label, '')))
      into key_values
      from jsonb_array_elements(p_rows) r;

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
$$;

revoke all on function import_enum_values(text) from public, anon;
revoke all on function import_check_value(text, text) from public, anon;
revoke all on function validate_import(text, uuid, jsonb, integer) from public, anon;

grant execute on function import_enum_values(text) to authenticated;
grant execute on function import_check_value(text, text) to authenticated;
grant execute on function validate_import(text, uuid, jsonb, integer) to authenticated;
