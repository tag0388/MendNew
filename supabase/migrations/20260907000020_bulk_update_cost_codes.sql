-- ============================================================================
-- Applying one set of changes to many cost codes.
--
-- The attribute maps MERGE rather than replace: setting one attribute across a
-- selection must not wipe the attributes those cost codes already carry. The
-- browser did this by reading each row's current attributes out of the rows it
-- had in memory, spreading the patch over them and writing the whole map back
-- -- so a stale grid silently reverted whatever someone else had changed since
-- it loaded. jsonb's || operator merges against the CURRENT stored value.
--
-- SECURITY INVOKER, so the cost_codes UPDATE policy still decides which of the
-- named cost codes the caller may actually write.
-- ============================================================================

create or replace function bulk_update_cost_codes(
  p_cost_code_ids uuid[],
  p_eac_method eac_method default null,
  p_enterprise_attributes jsonb default null,
  p_project_attributes jsonb default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  update cost_codes
     set eac_method = coalesce(p_eac_method, eac_method),
         enterprise_attributes = enterprise_attributes || coalesce(p_enterprise_attributes, '{}'::jsonb),
         project_attributes    = project_attributes    || coalesce(p_project_attributes, '{}'::jsonb),
         updated_at = now()
   where id = any (p_cost_code_ids);

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function bulk_update_cost_codes(uuid[], eac_method, jsonb, jsonb) from public, anon;
grant execute on function bulk_update_cost_codes(uuid[], eac_method, jsonb, jsonb) to authenticated;
