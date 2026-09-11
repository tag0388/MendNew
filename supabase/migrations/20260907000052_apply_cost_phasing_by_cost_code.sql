-- ============================================================================
-- Scope apply_cost_phasing to a set of cost codes.
--
-- The cost code's own Timephasing tab carried a third copy of the five
-- distribution curves -- after the subcontract and project-wide copies were
-- consolidated into phase_across_periods, this one was still computing them
-- in the browser. It phases one cost code at a time, so the function needs to
-- be able to say "these cost codes" as well as "these phasing rows".
--
-- The old two-argument signature is dropped rather than left alongside the
-- new one: two functions differing only by a defaulted argument make every
-- two-argument call ambiguous.
-- ============================================================================

drop function if exists apply_cost_phasing(uuid, uuid[]);

create or replace function apply_cost_phasing(
  p_project_id uuid,
  p_phasing_ids uuid[] default null,   -- null = not filtered by phasing row
  p_cost_code_ids uuid[] default null  -- null = not filtered by cost code
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_start date;
  phased integer := 0;
begin
  -- A forecast starts in the period AFTER the current one: the closed and
  -- current periods are stated by their actual costs, not by a forecast.
  select min(p.start_date) into next_start
    from reporting_periods p
   where p.project_id = p_project_id
     and p.kind = 'cost'
     and p.sort_order > coalesce(
           (select c.sort_order from reporting_periods c
             where c.project_id = p_project_id and c.kind = 'cost' and c.is_current),
           -1);

  with target as (
    select ph.id, ph.type, ph.start_date, ph.end_date, ph.distribution,
           ph.period_values,
           case ph.type
             when 'baseline' then c.baseline_budget
             when 'approved' then c.approved_budget
             -- EAC phases what is left to spend, not the whole estimate.
             when 'eac'      then c.estimate_to_complete
           end as total,
           -- The EAC forecast cannot start before the next open period,
           -- however the row's own start date is set.
           case when ph.type = 'eac'
                then greatest(ph.start_date, coalesce(next_start, ph.start_date))
                else ph.start_date
           end as effective_start
      from cost_phasing ph
      join cost_codes c on c.id = ph.cost_code_id
     where ph.project_id = p_project_id
       and ph.phasing_source = 'Auto'
       and ph.type <> 'eacPrevious'
       and ph.start_date is not null
       and ph.end_date is not null
       and ph.distribution is not null
       and (p_phasing_ids is null or ph.id = any (p_phasing_ids))
       and (p_cost_code_ids is null or ph.cost_code_id = any (p_cost_code_ids))
  )
  update cost_phasing ph
     set period_values = phase_across_periods(
           p_project_id, t.total, t.effective_start, t.end_date,
           t.distribution, t.period_values),
         updated_at = now()
    from target t
   where ph.id = t.id
     and t.effective_start <= t.end_date;

  get diagnostics phased = row_count;
  return phased;
end;
$$;

revoke all on function apply_cost_phasing(uuid, uuid[], uuid[]) from public, anon;
grant execute on function apply_cost_phasing(uuid, uuid[], uuid[]) to authenticated;
