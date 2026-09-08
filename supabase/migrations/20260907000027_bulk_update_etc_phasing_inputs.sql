-- ============================================================================
-- Bulk update can set the auto-phasing inputs too.
--
-- The dialog offered category, calendar, phasing method, phasing unit and the
-- attribute maps -- but not the Start Date, End Date or Phasing Qty, which are
-- the three fields auto-phasing actually runs on. Setting the same date range
-- across a section of the ETC list is the obvious reason to reach for bulk
-- update, and it was the one thing it could not do.
--
-- null means "leave this column alone", consistent with every other parameter
-- here. Clearing a date across a selection is deliberately NOT expressible:
-- with one null meaning both "unchanged" and "clear", a half-filled dialog
-- would silently wipe dates on every selected row.
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
  p_skip_library_resources boolean default true,
  p_phasing_start_date date default null,
  p_phasing_end_date date default null,
  p_phasing_qty numeric default null
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
         -- A row driven by a schedule activity takes its dates from that
         -- activity, so a bulk date must not overwrite them.
         phasing_start_date = case when p_phasing_start_date is not null and activity_id is null
                                   then p_phasing_start_date else phasing_start_date end,
         phasing_end_date   = case when p_phasing_end_date is not null and activity_id is null
                                   then p_phasing_end_date else phasing_end_date end,
         phasing_qty    = coalesce(p_phasing_qty, phasing_qty),
         enterprise_attributes = enterprise_attributes || coalesce(p_enterprise_attributes, '{}'::jsonb),
         project_attributes    = project_attributes    || coalesce(p_project_attributes, '{}'::jsonb),
         user_defined          = user_defined          || coalesce(p_user_defined, '{}'::jsonb),
         updated_at = now()
   where id = any (p_etc_detail_ids);

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function bulk_update_etc_details(uuid[], text, uuid, etc_phasing_method, etc_phasing_unit, jsonb, jsonb, jsonb, boolean, date, date, numeric) from public, anon;
grant execute on function bulk_update_etc_details(uuid[], text, uuid, etc_phasing_method, etc_phasing_unit, jsonb, jsonb, jsonb, boolean, date, date, numeric) to authenticated;

-- The 9-argument version is now shadowed by this one and would still be
-- resolvable by a stale client. Dropped so there is one definition.
drop function if exists bulk_update_etc_details(uuid[], text, uuid, etc_phasing_method, etc_phasing_unit, jsonb, jsonb, jsonb, boolean);
