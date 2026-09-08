-- ============================================================================
-- Inserting a cost code at a position in the list.
--
-- Inserting "above" an existing row means shifting every row at or below it
-- down by one, then writing the new row into the gap. The browser did this as
-- a Firestore batch; done as two separate statements from the client it can
-- half-apply, leaving a gap in the ordering with nothing in it.
--
-- SECURITY INVOKER, so the cost_codes INSERT policy (project admin only) and
-- the UPDATE policy still decide whether this is allowed.
-- ============================================================================

create or replace function insert_cost_code_at(
  p_project_id uuid,
  p_code text,
  p_name text,
  p_eac_method eac_method default 'Manual',
  p_enterprise_attributes jsonb default '{}'::jsonb,
  p_project_attributes jsonb default '{}'::jsonb,
  p_insert_index integer default null
)
returns cost_codes
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_order integer;
  created cost_codes;
begin
  if p_insert_index is null then
    -- Append. coalesce covers the first cost code in a project, where max()
    -- over no rows is null rather than 0.
    select coalesce(max(sort_order) + 1, 0) into target_order
      from cost_codes where project_id = p_project_id;
  else
    target_order := p_insert_index;
    update cost_codes
       set sort_order = sort_order + 1
     where project_id = p_project_id
       and sort_order >= p_insert_index;
  end if;

  insert into cost_codes (project_id, code, name, eac_method,
                          enterprise_attributes, project_attributes, sort_order)
  values (p_project_id, p_code, p_name, p_eac_method,
          coalesce(p_enterprise_attributes, '{}'::jsonb),
          coalesce(p_project_attributes, '{}'::jsonb),
          target_order)
  returning * into created;

  return created;
end;
$$;

revoke all on function insert_cost_code_at(uuid, text, text, eac_method, jsonb, jsonb, integer) from public, anon;
grant execute on function insert_cost_code_at(uuid, text, text, eac_method, jsonb, jsonb, integer) to authenticated;
