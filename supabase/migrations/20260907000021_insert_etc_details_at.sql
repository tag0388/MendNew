-- ============================================================================
-- Inserting ETC detail rows at a position in a cost code's list.
--
-- "Add 5 rows below the selected one" means shifting everything at or below
-- that position down by 5, then writing the 5 new rows into the gap. The
-- browser did this as a Firestore batch capped at 500 writes, which is where
-- the 500-row limit on the Add control came from. As two statements from the
-- client it can half-apply and leave a gap with nothing in it.
--
-- Rows arrive as a jsonb array so the caller can send blank rows or rows
-- seeded from a resource in the same shape. Anything the array omits falls
-- back to the column default, which is why the browser no longer has to spell
-- out every empty string and zero on a blank row. Empty strings are treated as
-- absent for dates, enums and ids, because that is what the old client sent.
--
-- SECURITY INVOKER, so the etc_details policies still decide whether the
-- caller may write to this cost code.
-- ============================================================================

create or replace function insert_etc_details_at(
  p_cost_code_id uuid,
  p_rows jsonb,
  p_insert_index integer default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  target_order integer;
  n_rows integer;
  inserted integer;
begin
  select project_id into v_project_id from cost_codes where id = p_cost_code_id;
  if v_project_id is null then
    raise exception 'Cost code not found, or you do not have access to it';
  end if;

  n_rows := jsonb_array_length(p_rows);
  if n_rows = 0 then return 0; end if;

  if p_insert_index is null then
    select coalesce(max(sort_order) + 1, 0) into target_order
      from etc_details where cost_code_id = p_cost_code_id;
  else
    target_order := p_insert_index;
    update etc_details
       set sort_order = sort_order + n_rows
     where cost_code_id = p_cost_code_id
       and sort_order >= p_insert_index;
  end if;

  insert into etc_details (
    project_id, cost_code_id, item, description, category, order_number,
    activity_id, qty, unit, rate, phasing_method, phasing_start_date,
    phasing_end_date, phasing_unit, phasing_qty, enterprise_attributes,
    project_attributes, period_values, is_enterprise_resource, resource_id,
    sort_order
  )
  select
    v_project_id,
    p_cost_code_id,
    coalesce(r.value ->> 'item', ''),
    coalesce(r.value ->> 'description', ''),
    r.value ->> 'category',
    r.value ->> 'orderNumber',
    r.value ->> 'activityId',
    coalesce((r.value ->> 'qty')::numeric, 0),
    r.value ->> 'unit',
    coalesce((r.value ->> 'rate')::numeric, 0),
    coalesce((r.value ->> 'phasingMethod')::etc_phasing_method, 'Manual'),
    nullif(r.value ->> 'phasingStartDate', '')::date,
    nullif(r.value ->> 'phasingEndDate', '')::date,
    coalesce(nullif(r.value ->> 'phasingUnit', '')::etc_phasing_unit, 'Total'),
    coalesce((r.value ->> 'phasingQty')::numeric, 0),
    coalesce(r.value -> 'enterpriseAttributes', '{}'::jsonb),
    coalesce(r.value -> 'projectAttributes', '{}'::jsonb),
    coalesce(r.value -> 'periodValues', '{}'::jsonb),
    coalesce((r.value ->> 'isEnterpriseResource')::boolean, false),
    nullif(r.value ->> 'resourceId', '')::uuid,
    target_order + (r.ordinality::integer - 1)
  from jsonb_array_elements(p_rows) with ordinality as r(value, ordinality);

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function insert_etc_details_at(uuid, jsonb, integer) from public, anon;
grant execute on function insert_etc_details_at(uuid, jsonb, integer) to authenticated;
