-- ============================================================================
-- Pushing the schedule's dates out to everything that references an activity.
--
-- "Sync Dates" on the Time Schedule grid used to read every progress item,
-- every ETC detail line, every cost code and every subcontract in the project
-- into the browser, compare each one's dates against the schedule in
-- JavaScript, and write back the ones that differed. On a project with
-- millions of ETC detail lines that is not a button, it is an outage.
--
-- It is four UPDATE ... FROM statements joined on activity_id. The mappings
-- are the ones the browser used:
--
--   progress_items          planned and current start/end  <- the same fields
--   etc_details             phasing start/end              <- current start/end
--   cost_codes              planned start/end              <- planned start/end
--   subcontract_line_items  start/end                      <- current start/end
--
-- Each statement touches only rows whose dates actually differ, so the count
-- returned means the same thing it did before, and a second run is a no-op.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

create or replace function sync_schedule_dates(p_project_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
  total integer := 0;
begin
  update progress_items t
     set planned_start_date = s.planned_start_date,
         planned_end_date   = s.planned_end_date,
         current_start_date = s.current_start_date,
         current_end_date   = s.current_end_date,
         updated_at = now()
    from schedule_items s
   where s.project_id = p_project_id
     and t.project_id = p_project_id
     and t.activity_id = s.activity_id
     and (t.planned_start_date is distinct from s.planned_start_date
       or t.planned_end_date   is distinct from s.planned_end_date
       or t.current_start_date is distinct from s.current_start_date
       or t.current_end_date   is distinct from s.current_end_date);
  get diagnostics n = row_count; total := total + n;

  update etc_details t
     set phasing_start_date = s.current_start_date,
         phasing_end_date   = s.current_end_date,
         updated_at = now()
    from schedule_items s
   where s.project_id = p_project_id
     and t.project_id = p_project_id
     and t.activity_id = s.activity_id
     and (t.phasing_start_date is distinct from s.current_start_date
       or t.phasing_end_date   is distinct from s.current_end_date);
  get diagnostics n = row_count; total := total + n;

  update cost_codes t
     set planned_start_date = s.planned_start_date,
         planned_end_date   = s.planned_end_date,
         updated_at = now()
    from schedule_items s
   where s.project_id = p_project_id
     and t.project_id = p_project_id
     and t.activity_id = s.activity_id
     and (t.planned_start_date is distinct from s.planned_start_date
       or t.planned_end_date   is distinct from s.planned_end_date);
  get diagnostics n = row_count; total := total + n;

  update subcontract_line_items t
     set start_date = s.current_start_date,
         end_date   = s.current_end_date,
         updated_at = now()
    from schedule_items s
   where s.project_id = p_project_id
     and t.project_id = p_project_id
     and t.activity_id = s.activity_id
     and (t.start_date is distinct from s.current_start_date
       or t.end_date   is distinct from s.current_end_date);
  get diagnostics n = row_count; total := total + n;

  return total;
end;
$$;

revoke all on function sync_schedule_dates(uuid) from public, anon;
grant execute on function sync_schedule_dates(uuid) to authenticated;
