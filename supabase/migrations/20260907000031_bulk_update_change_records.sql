-- ============================================================================
-- Applying one set of changes to many change records.
--
-- Same shape as bulk_update_cost_codes and bulk_update_etc_details, and for
-- the same reason: the attribute maps MERGE into what is stored now, not into
-- the copy the browser loaded, so a bulk update cannot silently revert someone
-- else's edit.
--
-- The browser built dotted keys -- "enterpriseAttributes.<id>" -- which is a
-- Firestore idiom for merging into a nested map. Nothing in SQL reads that, so
-- those updates would have been dropped. jsonb's || operator merges properly.
--
-- The affected changes' budget and EAC totals are re-derived by the trigger on
-- change_records, so nothing here has to remember to update them.
-- ============================================================================

create or replace function bulk_update_change_records(
  p_record_ids uuid[],
  p_cost_code_id uuid default null,
  p_scope text default null,
  p_budget_amount numeric default null,
  p_eac_amount numeric default null,
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
  update change_records
     set cost_code_id = coalesce(p_cost_code_id, cost_code_id),
         scope        = coalesce(p_scope, scope),
         budget_amount = coalesce(p_budget_amount, budget_amount),
         eac_amount    = coalesce(p_eac_amount, eac_amount),
         enterprise_attributes = enterprise_attributes || coalesce(p_enterprise_attributes, '{}'::jsonb),
         project_attributes    = project_attributes    || coalesce(p_project_attributes, '{}'::jsonb),
         updated_at = now()
   where id = any (p_record_ids);

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function bulk_update_change_records(uuid[], uuid, text, numeric, numeric, jsonb, jsonb) from public, anon;
grant execute on function bulk_update_change_records(uuid[], uuid, text, numeric, numeric, jsonb, jsonb) to authenticated;
