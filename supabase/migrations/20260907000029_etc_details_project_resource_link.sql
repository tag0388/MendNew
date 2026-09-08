-- ============================================================================
-- An ETC line can come from EITHER resource library, and only one was linkable.
--
-- etc_details.resource_id referenced resource_rates -- the enterprise library
-- -- so a line added from the PROJECT library had nowhere to record where it
-- came from. Inserting one failed outright on the foreign key. Both libraries
-- feed the ETC picker, so both need a link.
--
-- Two nullable columns rather than one loose id, because they point at
-- different tables and the database should still be able to say "this forecast
-- line came from that resource". ON DELETE SET NULL on both: deleting a
-- library entry must not delete a forecast line that used it -- the line keeps
-- its own item, rate and quantities and simply stops being linked.
--
-- The check enforces the two facts that must agree: a line links to at most
-- one library, and is_enterprise_resource says which. That flag already drives
-- behaviour elsewhere (bulk update will not overwrite a library resource's
-- category), so letting it drift from the actual link would be a quiet source
-- of wrong behaviour.
-- ============================================================================

alter table etc_details
  add column if not exists project_resource_id uuid
    references project_resource_rates (id) on delete set null;

create index if not exists etc_details_project_resource_idx
  on etc_details (project_resource_id);

alter table etc_details
  drop constraint if exists etc_details_one_resource_library;

alter table etc_details
  add constraint etc_details_one_resource_library check (
    (resource_id is null and project_resource_id is null)
    or (resource_id is not null and project_resource_id is null and is_enterprise_resource)
    or (resource_id is null and project_resource_id is not null and not is_enterprise_resource)
  );

-- ----------------------------------------------------------------------------
-- insert_etc_details_at only mapped resourceId, the ENTERPRISE link, so a row
-- added from the project library was inserted with no link at all -- silently,
-- because an unmapped key in the jsonb is simply ignored. The same silence hid
-- a second omission: userDefined was never mapped either, so the UDF columns
-- of an imported ETC sheet were dropped on the way in.
-- ----------------------------------------------------------------------------
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
    project_attributes, period_values, user_defined, is_enterprise_resource,
    resource_id, project_resource_id, sort_order
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
    coalesce(r.value -> 'userDefined', '{}'::jsonb),
    coalesce((r.value ->> 'isEnterpriseResource')::boolean, false),
    nullif(r.value ->> 'resourceId', '')::uuid,
    nullif(r.value ->> 'projectResourceId', '')::uuid,
    target_order + (r.ordinality::integer - 1)
  from jsonb_array_elements(p_rows) with ordinality as r(value, ordinality);

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function insert_etc_details_at(uuid, jsonb, integer) from public, anon;
grant execute on function insert_etc_details_at(uuid, jsonb, integer) to authenticated;
