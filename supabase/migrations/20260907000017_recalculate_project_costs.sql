-- ============================================================================
-- Recalculating a project's derived cost figures.
--
-- The browser did this by downloading every actual cost, baseline budget, ETC
-- row, change, change record and subcontract in the project, aggregating them
-- into Maps, and writing eleven columns back onto every cost code in batches
-- of 450. That is one transaction per chunk, so a project with 900 cost codes
-- could half-succeed and leave budgets recalculated against stale actuals.
--
-- Three things the old code needed and this does not:
--
--   * getVal(map, id, code) looked every total up twice, once under the cost
--     code's document id and once under its code string, because either could
--     have been stored. cost_code_id is a uuid foreign key here, so there is
--     one answer.
--   * "this period" matched a period id OR the period's 1-based position,
--     stringified. reporting_period_id is a foreign key, so is_current decides.
--   * every value went through isFinite() before being written, because
--     Firestore rejects NaN. numeric has no NaN to produce here.
--
-- SECURITY INVOKER: RLS applies to every statement, so this cannot recalculate
-- a project the caller cannot see, and a project user only rewrites the cost
-- codes they are assigned to. The explicit membership check turns what would
-- otherwise be a silent zero-row update into a clear error.
-- ============================================================================

create or replace function recalculate_project_costs(
  p_project_id uuid,
  p_cost_code_ids uuid[] default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  if not auth_can_access_project(p_project_id) then
    raise exception 'You do not have access to this project';
  end if;

  with
  -- Periods after the current one. ETC is what remains to be spent, so it
  -- counts only future phasing -- the current period's spend is an actual.
  future_periods as (
    select rp.id
      from reporting_periods rp
     where rp.project_id = p_project_id
       and rp.kind = 'cost'
       and rp.sort_order > coalesce(
             (select c.sort_order from reporting_periods c
               where c.project_id = p_project_id and c.kind = 'cost' and c.is_current
               limit 1),
             -1)
  ),
  -- A change counts once it is Approved or Pending. Rejected and Withdrawn
  -- changes never reach the cost codes.
  counted_changes as (
    select ch.id from changes ch
     where ch.project_id = p_project_id
       and ch.status in ('Approved', 'Pending')
  ),
  targets as (
    select cc.* from cost_codes cc
     where cc.project_id = p_project_id
       and (p_cost_code_ids is null or cc.id = any (p_cost_code_ids))
  ),
  computed as (
    select
      t.id,
      t.eac_method,
      t.approved_budget_previous,
      t.estimate_at_completion_previous,
      t.cost_variance_previous,
      t.estimate_at_completion as manual_eac,
      coalesce((select sum(b.amount) from baseline_budgets b
                 where b.cost_code_id = t.id), 0) as baseline_budget,
      coalesce((select sum(a.cost) from actual_costs a
                 where a.cost_code_id = t.id), 0) as actual_cost_to_date,
      coalesce((select sum(a.cost) from actual_costs a
                 join reporting_periods rp on rp.id = a.reporting_period_id
                where a.cost_code_id = t.id and rp.is_current), 0) as actual_cost_this_period,
      coalesce((select sum(cr.budget_amount) from change_records cr
                where cr.cost_code_id = t.id
                  and cr.change_id in (select id from counted_changes)), 0) as budget_changes,
      coalesce((select sum(cr.eac_amount) from change_records cr
                where cr.cost_code_id = t.id
                  and cr.change_id in (select id from counted_changes)), 0) as eac_changes,
      -- period_values is {period_id: qty}. Only future periods count, and the
      -- money is qty * rate.
      coalesce((select sum((pv.value)::numeric * coalesce(e.rate, 0))
                  from etc_details e
                  cross join lateral jsonb_each_text(coalesce(e.period_values, '{}'::jsonb))
                       as pv(key, value)
                 where e.cost_code_id = t.id
                   -- Compared as text, not cast to uuid: a key that is not a
                   -- uuid would make the cast raise rather than simply not
                   -- match, and WHERE clauses have no guaranteed evaluation
                   -- order to protect it. The regex guard on the value is safe
                   -- because WHERE is applied before the aggregate reads it.
                   and pv.key in (select fp.id::text from future_periods fp)
                   and pv.value ~ '^-?[0-9]+(\.[0-9]+)?$'), 0) as etc_from_details,
      -- A line item falls to its own cost code, or to the subcontract's
      -- default when it has none. Rejected items are not committed spend.
      coalesce((select sum(li.total)
                  from subcontract_line_items li
                  join subcontracts s on s.id = li.subcontract_id
                 where li.status is distinct from 'Rejected'
                   and coalesce(li.cost_code_id, s.default_cost_code_id) = t.id), 0) as subcontract_total
    from targets t
  ),
  resolved as (
    select
      c.*,
      c.baseline_budget + c.budget_changes as approved_budget,
      case c.eac_method
        when 'ETC Details'             then c.actual_cost_to_date + c.etc_from_details
        when 'Change Management'       then c.baseline_budget + c.eac_changes
        when 'Sub-Contract Management' then c.subcontract_total
        else coalesce(c.manual_eac, 0)
      end as eac
    from computed c
  )
  update cost_codes cc
     set baseline_budget                  = r.baseline_budget,
         budget_changes                   = r.budget_changes,
         approved_budget                  = r.approved_budget,
         approved_budget_movement         = r.approved_budget - coalesce(r.approved_budget_previous, 0),
         actual_cost_to_date              = r.actual_cost_to_date,
         actual_cost_this_period          = r.actual_cost_this_period,
         estimate_at_completion           = r.eac,
         -- ETC Details owns its own ETC; every other method derives it as
         -- what is left of the estimate after what has already been spent.
         estimate_to_complete             = case when r.eac_method = 'ETC Details'
                                                 then r.etc_from_details
                                                 else r.eac - r.actual_cost_to_date end,
         estimate_at_completion_movement  = r.eac - coalesce(r.estimate_at_completion_previous, 0),
         cost_variance                    = r.approved_budget - r.eac,
         cost_variance_movement           = (r.approved_budget - r.eac) - coalesce(r.cost_variance_previous, 0),
         updated_at                       = now()
    from resolved r
   where cc.id = r.id;

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function recalculate_project_costs(uuid, uuid[]) from public, anon;
grant execute on function recalculate_project_costs(uuid, uuid[]) to authenticated;
