-- ============================================================================
-- Reading and writing a whole attribute set.
--
-- The editor screens work in sets: ten numbered slots for one category, each
-- with a title and a list of values. That shape is what the app has always
-- handed around, and keeping it means the screens change very little even
-- though what is underneath changed completely.
--
-- attribute_set returns a set in that shape. save_attribute_set takes one
-- back and works out the difference -- a title that moved, a value added, a
-- value gone -- rather than clearing and reloading, so the guards on
-- attribute_values still see a delete as a delete and can refuse one that
-- rows still depend on.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

create or replace function attribute_set(
  p_enterprise_id uuid,
  p_project_id    uuid,          -- null for the enterprise's own set
  p_category      attribute_category
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $fn$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',     d.attribute_number,
             'title',  d.title,
             'values', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id',          v.code,
                        'description', v.description,
                        'sortOrder',   v.sort_order)
                      order by v.sort_order, v.code)
                 from attribute_values v where v.definition_id = d.id), '[]'::jsonb))
           order by d.attribute_number), '[]'::jsonb)
    from attribute_definitions d
   where d.category = p_category
     and ((p_project_id is null and d.project_id is null and d.enterprise_id = p_enterprise_id)
       or (p_project_id is not null and d.project_id = p_project_id));
$fn$;

create or replace function save_attribute_set(
  p_enterprise_id uuid,
  p_project_id    uuid,
  p_category      attribute_category,
  p_attributes    jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  touched integer := 0;
begin
  if jsonb_typeof(p_attributes) <> 'array' then
    raise exception 'An attribute set must be an array of slots';
  end if;

  -- The slots are always there; only their titles move.
  update attribute_definitions d
     set title = coalesce(btrim(a.title), ''), updated_at = now()
    from jsonb_to_recordset(p_attributes) as a(id text, title text, "values" jsonb)
   where d.category = p_category
     and d.attribute_number = a.id
     and ((p_project_id is null and d.project_id is null and d.enterprise_id = p_enterprise_id)
       or (p_project_id is not null and d.project_id = p_project_id))
     and d.title is distinct from coalesce(btrim(a.title), '');
  get diagnostics touched = row_count;

  -- The values the set now carries, against the ones it had.
  with slot as (
    select d.id as definition_id, a."values" as vals
      from jsonb_to_recordset(p_attributes) as a(id text, title text, "values" jsonb)
      join attribute_definitions d
        on d.category = p_category
       and d.attribute_number = a.id
       and ((p_project_id is null and d.project_id is null and d.enterprise_id = p_enterprise_id)
         or (p_project_id is not null and d.project_id = p_project_id))
  ),
  wanted as (
    select s.definition_id,
           btrim(v ->> 'id') as code,
           coalesce(btrim(v ->> 'description'), '') as description,
           coalesce((v ->> 'sortOrder')::int, 0) as sort_order
      from slot s
      cross join lateral jsonb_array_elements(coalesce(s.vals, '[]'::jsonb)) v
     where coalesce(btrim(v ->> 'id'), '') <> ''
  ),
  -- Gone from the set. The guard refuses this if rows still hold the code.
  removed as (
    delete from attribute_values av
     using slot s
     where av.definition_id = s.definition_id
       and not exists (select 1 from wanted w
                        where w.definition_id = av.definition_id and w.code = av.code)
    returning 1
  ),
  written as (
    insert into attribute_values (definition_id, code, description, sort_order)
    select definition_id, code, description, sort_order from wanted
    on conflict (definition_id, code) do update
       set description = excluded.description,
           sort_order  = excluded.sort_order,
           updated_at  = now()
    returning 1
  )
  select touched + (select count(*) from removed) + (select count(*) from written)
    into touched;

  return touched;
end;
$fn$;

revoke all on function attribute_set(uuid, uuid, attribute_category) from public, anon;
revoke all on function save_attribute_set(uuid, uuid, attribute_category, jsonb) from public, anon;
grant execute on function attribute_set(uuid, uuid, attribute_category) to authenticated;
grant execute on function save_attribute_set(uuid, uuid, attribute_category, jsonb) to authenticated;
