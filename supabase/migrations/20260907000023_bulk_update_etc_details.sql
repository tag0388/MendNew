-- ============================================================================
-- Applying one set of changes to many ETC detail rows.
--
-- Same shape as bulk_update_cost_codes, and for the same reason: the three
-- attribute maps MERGE into whatever is stored now, not into the copy the
-- browser loaded, so a bulk update cannot silently revert someone else's edit.
--
-- Category is special. A row seeded from the enterprise or project resource
-- library takes its category from that library entry, so a bulk category
-- change must skip those rows -- p_skip_library_resources carries that rule,
-- which the browser previously applied by inspecting each row it had loaded.
-- ============================================================================

create or replace function bulk_update_etc_details(
  p_etc_detail_ids uuid[],
  p_category text default null,
  p_calendar_id uuid default null,
  p_phasing_method etc_phasing_method default null,
  p_phasing_unit etc_phasing_unit default null,
  p_enterprise_attributes jsonb default null,
  p_project_attributes jsonb default null,
  p_user_defined jsonb default null,
  p_skip_library_resources boolean default true
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  update etc_details
     set category = case
                      when p_category is null then category
                      when p_skip_library_resources and is_enterprise_resource then category
                      else p_category
                    end,
         calendar_id    = coalesce(p_calendar_id, calendar_id),
         phasing_method = coalesce(p_phasing_method, phasing_method),
         phasing_unit   = coalesce(p_phasing_unit, phasing_unit),
         enterprise_attributes = enterprise_attributes || coalesce(p_enterprise_attributes, '{}'::jsonb),
         project_attributes    = project_attributes    || coalesce(p_project_attributes, '{}'::jsonb),
         user_defined          = user_defined          || coalesce(p_user_defined, '{}'::jsonb),
         updated_at = now()
   where id = any (p_etc_detail_ids);

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function bulk_update_etc_details(uuid[], text, uuid, etc_phasing_method, etc_phasing_unit, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function bulk_update_etc_details(uuid[], text, uuid, etc_phasing_method, etc_phasing_unit, jsonb, jsonb, jsonb, boolean) to authenticated;
