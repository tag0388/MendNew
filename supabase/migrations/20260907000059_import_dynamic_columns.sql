-- ============================================================================
-- The bulk import engine, part three: the columns that are not fixed.
--
-- Three families of column exist in the exports that no registry row can name
-- in advance, because they depend on how the enterprise and the project have
-- been configured:
--
--   E_<title> / P_<title>   the enterprise's and project's own attributes
--   Numeric 1..5, Text 1..5 the user-defined columns on a line item
--   <period name>           one column per reporting period
--
-- All three live in jsonb columns keyed by id, while the sheet is keyed by
-- the titles and period names a person reads. import_dynamic_columns resolves
-- one into the other for a given project, and both the validator and the
-- writer work from that resolution -- so a header means the same thing when
-- it is checked and when it is stored.
--
-- Attribute cells accept either the value's description or its id, and store
-- the id. That is what makes a round trip work: the sheet shows "Civil" and
-- the database keeps "03".
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

-- Which family of attributes a table's rows carry, and where its project is
-- if the scope is not the project itself.
alter table import_definitions
  add column if not exists attribute_family text,
  add column if not exists project_source   text;

update import_definitions set attribute_family = 'cost_code'   where name = 'cost_codes';
update import_definitions set attribute_family = 'line_item'   where name in ('etc_details','actual_costs','baseline_budgets');
update import_definitions set attribute_family = 'change'      where name in ('changes','change_records');
update import_definitions set attribute_family = 'risk'        where name in ('risks','risk_records');
update import_definitions set attribute_family = 'procurement' where name = 'procurement_items';
update import_definitions set attribute_family = 'subcontract', project_source = 'subcontracts'
 where name = 'subcontract_line_items';

-- What the dynamic headers mean for this project.
--
-- Returns {header: {target, key, type, values}} where target is the jsonb
-- column, key is the id to store under, and values (when present) is the
-- lookup from what a person may type to the id that is stored.
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
  cols    jsonb := '{}'::jsonb;
  i      integer;
begin
  select * into def from import_definitions where name = p_definition;
  if not found then
    raise exception 'There is no import called %', p_definition;
  end if;

  -- The project the scope belongs to. For most tables the scope IS the
  -- project; a subcontract's line items reach it through the subcontract.
  if def.project_source is null then
    proj := p_scope_id;
  else
    execute format('select project_id from %I where id = $1', def.project_source)
      into proj using p_scope_id;
  end if;

  select enterprise_id into ent from projects where id = proj;

  -- ------------------------------------------------------- attributes ----
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

    -- An attribute with no title is an unused slot, so it gets no column.
    select coalesce(cols || jsonb_object_agg(
             prefix || (a ->> 'title'),
             jsonb_strip_nulls(jsonb_build_object(
               'target', target,
               'key',    a ->> 'id',
               'type',   'text',
               'values', (
                 select jsonb_object_agg(k, v.id)
                   from jsonb_array_elements(coalesce(a -> 'values', '[]'::jsonb)) av
                   cross join lateral (select av ->> 'id' as id, av ->> 'description' as descr) v
                   cross join lateral unnest(array[lower(btrim(v.descr)), lower(btrim(v.id))]) k
                  where k <> ''
               )))), cols)
      into cols
      from (
        select 'E_' as prefix, 'enterprise_attributes' as target, a from jsonb_array_elements(ent_at) a
        union all
        select 'P_', 'project_attributes', a from jsonb_array_elements(prj_at) a
      ) s
     where coalesce(btrim(s.a ->> 'title'), '') <> '';
  end if;

  -- --------------------------------------------------- user-defined ----
  -- Five numbers and five free-text columns, always in the same places.
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
  -- One per cost reporting period, named the way the grid names it.
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

-- Setting a period's total makes any week or day breakdown stored under it
-- stale, so those keys go when the period is written.
create or replace function import_merge_period_values(p_existing jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $fn$
  select coalesce(
    (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
       from jsonb_each(coalesce(p_existing, '{}'::jsonb)) e(k, v)
      where not exists (
        select 1 from jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) n
         where e.k = n or e.k like n || '\_%')),
    '{}'::jsonb) || coalesce(p_new, '{}'::jsonb);
$fn$;

revoke all on function import_dynamic_columns(text, uuid) from public, anon;
revoke all on function import_merge_period_values(jsonb, jsonb) from public, anon;
grant execute on function import_dynamic_columns(text, uuid) to authenticated;
grant execute on function import_merge_period_values(jsonb, jsonb) to authenticated;
