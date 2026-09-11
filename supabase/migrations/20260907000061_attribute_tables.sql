-- ============================================================================
-- Attributes become real tables and real columns.
--
-- Until now an attribute was a slot in a jsonb array on the enterprise or
-- project record -- {"id":"01","title":"Discipline","values":[...]} -- and a
-- row's assignment was a key in another jsonb column. That worked, but it
-- meant the database could not tell a valid code from a stale one, could not
-- index a filter on an attribute, and could not stop someone deleting a value
-- that thousands of rows still pointed at.
--
-- Two tables now hold the definitions:
--
--   attribute_definitions   the ten numbered slots per category, per level,
--                           with the title the user gives them
--   attribute_values        the codes a slot accepts, unique within it
--
-- and every table that carries attributes gets twenty real columns --
-- ent_attr_01..10 and prj_attr_01..10 -- each holding a value's code.
--
-- The numbers are fixed at ten per category and are never created or deleted
-- by a user; they are made for every enterprise and project automatically.
-- Only the title and the list of values are the user's to change.
--
-- Codes are text rather than keys into attribute_values, so a filter is a
-- plain btree lookup and an import writes what the sheet says without a
-- join. What that gives up -- a foreign key -- is bought back on the
-- attribute_values side, where the volume is small: a code still in use
-- cannot be deleted, and renaming one carries the change into every row that
-- holds it.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

do $$ begin
  create type attribute_level as enum ('enterprise', 'project');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attribute_category as enum (
    'project', 'cost_code', 'line_item', 'change', 'risk',
    'subcontract', 'procurement', 'progress', 'schedule');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ the slots ----
create table if not exists attribute_definitions (
  id               uuid primary key default gen_random_uuid(),
  enterprise_id    uuid not null references enterprises(id) on delete cascade,
  -- null for an enterprise-wide slot; set for one a project defines itself
  project_id       uuid references projects(id) on delete cascade,
  level            attribute_level not null,
  category         attribute_category not null,
  attribute_number text not null check (attribute_number ~ '^(0[1-9]|10)$'),
  title            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint attribute_definitions_level_matches check (
    (level = 'enterprise' and project_id is null) or
    (level = 'project'    and project_id is not null))
);

create unique index if not exists attribute_definitions_enterprise_slot
  on attribute_definitions (enterprise_id, category, attribute_number)
  where project_id is null;

create unique index if not exists attribute_definitions_project_slot
  on attribute_definitions (project_id, category, attribute_number)
  where project_id is not null;

create index if not exists attribute_definitions_project_idx
  on attribute_definitions (project_id, category);

-- ----------------------------------------------------------- the values ----
create table if not exists attribute_values (
  id            uuid primary key default gen_random_uuid(),
  definition_id uuid not null references attribute_definitions(id) on delete cascade,
  code          text not null check (btrim(code) <> ''),
  description   text not null default '',
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- the code a user types is unique within its own slot, and nowhere else
  unique (definition_id, code)
);

create index if not exists attribute_values_definition_idx
  on attribute_values (definition_id, sort_order);

drop trigger if exists attribute_definitions_set_updated_at on attribute_definitions;
create trigger attribute_definitions_set_updated_at
  before update on attribute_definitions
  for each row execute function set_updated_at();

drop trigger if exists attribute_values_set_updated_at on attribute_values;
create trigger attribute_values_set_updated_at
  before update on attribute_values
  for each row execute function set_updated_at();

-- ------------------------------------------- which table means which slot --
-- The link between a data table and the category of attributes it carries,
-- and how a row of it reaches the project and enterprise it belongs to.
create table if not exists attribute_scopes (
  table_name        text primary key,
  category          attribute_category not null,
  project_column    text not null default 'project_id',
  enterprise_column text,                    -- set when the row has no project
  has_project_level boolean not null default true
);

insert into attribute_scopes (table_name, category, project_column, enterprise_column, has_project_level)
values
  ('cost_codes',             'cost_code',   'project_id', null, true),
  ('etc_details',            'line_item',   'project_id', null, true),
  ('actual_costs',           'line_item',   'project_id', null, true),
  ('baseline_budgets',       'line_item',   'project_id', null, true),
  ('subcontract_line_items', 'line_item',   'project_id', null, true),
  ('changes',                'change',      'project_id', null, true),
  ('change_records',         'change',      'project_id', null, true),
  ('risks',                  'risk',        'project_id', null, true),
  ('risk_records',           'risk',        'project_id', null, true),
  ('subcontracts',           'subcontract', 'project_id', null, true),
  ('procurement_items',      'procurement', 'project_id', null, true),
  ('progress_items',         'progress',    'project_id', null, true),
  ('schedule_items',         'schedule',    'project_id', null, true),
  -- A project's own attributes are defined by its enterprise. There is no
  -- project level here: a project cannot define attributes about itself.
  ('projects',               'project',     'id',         'enterprise_id', false)
on conflict (table_name) do update set
  category          = excluded.category,
  project_column    = excluded.project_column,
  enterprise_column = excluded.enterprise_column,
  has_project_level = excluded.has_project_level;

-- ------------------------------------------------- twenty real columns ----
do $cols$
declare
  s attribute_scopes%rowtype;
  i integer;
begin
  for s in select * from attribute_scopes loop
    for i in 1 .. 10 loop
      execute format('alter table %I add column if not exists %I text',
                     s.table_name, 'ent_attr_' || lpad(i::text, 2, '0'));
      if s.has_project_level then
        execute format('alter table %I add column if not exists %I text',
                       s.table_name, 'prj_attr_' || lpad(i::text, 2, '0'));
      end if;
    end loop;
  end loop;
end
$cols$;

-- ------------------------------------------------- the slots always exist --
-- Ten numbered slots per category, for every enterprise and every project.
-- A user never creates or deletes one; they only give it a title and a list
-- of values. Making them up front means a title is an UPDATE, never an
-- insert-or-update against a row that might not be there.
create or replace function ensure_attribute_slots(
  p_enterprise_id uuid,
  p_project_id    uuid default null
)
returns integer
language sql
security invoker
set search_path = public
as $fn$
  with made as (
    insert into attribute_definitions (enterprise_id, project_id, level, category, attribute_number)
    select p_enterprise_id,
           p_project_id,
           case when p_project_id is null then 'enterprise' else 'project' end::attribute_level,
           c.category,
           lpad(n::text, 2, '0')
      from (select distinct category from attribute_scopes
             where has_project_level or p_project_id is null) c
      cross join generate_series(1, 10) n
    on conflict do nothing
    returning 1
  )
  select count(*)::integer from made;
$fn$;

create or replace function attribute_slots_for_new_enterprise()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform ensure_attribute_slots(new.id, null);
  return new;
end;
$fn$;

create or replace function attribute_slots_for_new_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform ensure_attribute_slots(new.enterprise_id, new.id);
  return new;
end;
$fn$;

drop trigger if exists enterprises_attribute_slots on enterprises;
create trigger enterprises_attribute_slots
  after insert on enterprises
  for each row execute function attribute_slots_for_new_enterprise();

drop trigger if exists projects_attribute_slots on projects;
create trigger projects_attribute_slots
  after insert on projects
  for each row execute function attribute_slots_for_new_project();

-- Everything that already exists.
do $seed$
declare e record; p record;
begin
  for e in select id from enterprises loop
    perform ensure_attribute_slots(e.id, null);
  end loop;
  for p in select id, enterprise_id from projects loop
    perform ensure_attribute_slots(p.enterprise_id, p.id);
  end loop;
end
$seed$;

-- ------------------------------------------------------ carry the titles ---
-- The titles people have already given their attributes, out of the jsonb
-- they lived in. The jsonb columns stay for now: the screens still read them,
-- and they come out once those are moved over.
do $titles$
declare
  cat text;
  col text;
begin
  foreach cat in array array['project','cost_code','line_item','change','risk',
                             'subcontract','procurement','progress'] loop
    col := cat || '_attributes';

    -- enterprise level
    execute format($q$
      update attribute_definitions d
         set title = coalesce(btrim(a ->> 'title'), '')
        from enterprises e
        cross join lateral jsonb_array_elements(coalesce(e.%I, '[]'::jsonb)) a
       where d.enterprise_id = e.id
         and d.project_id is null
         and d.category = %L
         and d.attribute_number = a ->> 'id'
         and coalesce(btrim(a ->> 'title'), '') <> ''
    $q$, col, cat);

    -- project level. A project has no 'project' attributes of its own -- it
    -- cannot describe itself -- so that category is enterprise-only.
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'projects'
                  and column_name = col) then
      execute format($q$
        update attribute_definitions d
           set title = coalesce(btrim(a ->> 'title'), '')
          from projects p
          cross join lateral jsonb_array_elements(coalesce(p.%I, '[]'::jsonb)) a
         where d.project_id = p.id
           and d.category = %L
           and d.attribute_number = a ->> 'id'
           and coalesce(btrim(a ->> 'title'), '') <> ''
      $q$, col, cat);
    end if;
  end loop;
end
$titles$;

-- And the values, where any were defined.
insert into attribute_values (definition_id, code, description, sort_order)
select d.id,
       btrim(v ->> 'id'),
       coalesce(btrim(v ->> 'description'), ''),
       coalesce((v ->> 'sortOrder')::int, 0)
  from attribute_definitions d
  join enterprises e on e.id = d.enterprise_id and d.project_id is null
  cross join lateral jsonb_array_elements(
    coalesce(case d.category
      when 'project'     then e.project_attributes
      when 'cost_code'   then e.cost_code_attributes
      when 'line_item'   then e.line_item_attributes
      when 'change'      then e.change_attributes
      when 'risk'        then e.risk_attributes
      when 'subcontract' then e.subcontract_attributes
      when 'procurement' then e.procurement_attributes
      when 'progress'    then e.progress_attributes
    end, '[]'::jsonb)) a
  cross join lateral jsonb_array_elements(coalesce(a -> 'values', '[]'::jsonb)) v
 where a ->> 'id' = d.attribute_number
   and coalesce(btrim(v ->> 'id'), '') <> ''
on conflict (definition_id, code) do nothing;

-- ===========================================================================
-- Integrity, bought back on the cheap side.
--
-- The data columns hold codes as text, so no foreign key can stand behind
-- them -- a code is unique only within its own slot. Enforcing that on every
-- write would mean a trigger on tables that take 500,000 rows in one import,
-- which is exactly the cost this design exists to avoid.
--
-- So the rules live where the volume is small instead. attribute_values has
-- perhaps a few dozen rows per project, and is written when someone edits an
-- attribute -- never in a bulk load. A code in use cannot be deleted, and
-- renaming one carries the change into every row that holds it.
-- ===========================================================================

-- Which columns of which tables hold a given slot's codes, and how to scope
-- the search to the enterprise or project that slot belongs to.
create or replace function attribute_usage_count(p_definition_id uuid, p_code text)
returns bigint
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  d     attribute_definitions%rowtype;
  s     attribute_scopes%rowtype;
  col   text;
  total bigint := 0;
  n     bigint;
begin
  select * into d from attribute_definitions where id = p_definition_id;
  if not found then return 0; end if;

  col := case d.level when 'enterprise' then 'ent_attr_' else 'prj_attr_' end
         || d.attribute_number;

  for s in select * from attribute_scopes where category = d.category loop
    if d.level = 'project' and not s.has_project_level then
      continue;
    end if;

    if d.project_id is not null then
      -- a project's own slot: only that project's rows can hold it
      execute format('select count(*) from %I t where t.%I = $1 and t.%I = $2',
                     s.table_name, s.project_column, col)
        into n using d.project_id, p_code;
    elsif s.enterprise_column is not null then
      execute format('select count(*) from %I t where t.%I = $1 and t.%I = $2',
                     s.table_name, s.enterprise_column, col)
        into n using d.enterprise_id, p_code;
    else
      -- an enterprise slot reaches its rows through their projects
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

-- Renaming a code moves it everywhere it is held; deleting one that is still
-- held is refused, naming how many rows would have been orphaned.
create or replace function attribute_values_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d     attribute_definitions%rowtype;
  s     attribute_scopes%rowtype;
  col   text;
  used  bigint;
begin
  if tg_op = 'UPDATE' and new.code is not distinct from old.code then
    return new;   -- a description or sort order change touches no data
  end if;

  select * into d from attribute_definitions
   where id = coalesce(old.definition_id, new.definition_id);
  if not found then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  col := case d.level when 'enterprise' then 'ent_attr_' else 'prj_attr_' end
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

  -- UPDATE with a new code: carry it into the rows that hold the old one.
  for s in select * from attribute_scopes where category = d.category loop
    if d.level = 'project' and not s.has_project_level then
      continue;
    end if;

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

drop trigger if exists attribute_values_guard_delete on attribute_values;
create trigger attribute_values_guard_delete
  before delete on attribute_values
  for each row execute function attribute_values_guard();

drop trigger if exists attribute_values_guard_update on attribute_values;
create trigger attribute_values_guard_update
  before update on attribute_values
  for each row execute function attribute_values_guard();

-- The guards run as the table's owner so they can reach every data table, so
-- they must not be reachable as API endpoints in their own right.
revoke all on function attribute_values_guard() from public, anon, authenticated;
revoke all on function attribute_slots_for_new_enterprise() from public, anon, authenticated;
revoke all on function attribute_slots_for_new_project() from public, anon, authenticated;

revoke all on function ensure_attribute_slots(uuid, uuid) from public, anon;
revoke all on function attribute_usage_count(uuid, text) from public, anon;
grant execute on function ensure_attribute_slots(uuid, uuid) to authenticated;
grant execute on function attribute_usage_count(uuid, text) to authenticated;

-- RLS is deliberately not configured here; it is the next conversation.
alter table attribute_definitions enable row level security;
alter table attribute_values      enable row level security;
alter table attribute_scopes      enable row level security;

drop policy if exists attribute_definitions_all on attribute_definitions;
create policy attribute_definitions_all on attribute_definitions
  for all to authenticated using (true) with check (true);

drop policy if exists attribute_values_all on attribute_values;
create policy attribute_values_all on attribute_values
  for all to authenticated using (true) with check (true);

drop policy if exists attribute_scopes_select on attribute_scopes;
create policy attribute_scopes_select on attribute_scopes
  for select to authenticated using (true);
