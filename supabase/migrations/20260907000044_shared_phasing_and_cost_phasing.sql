-- ============================================================================
-- One phasing calculation, used by both grids.
--
-- apply_line_item_phasing (migration 39) carried the five distribution curves
-- and the exact-rounding rule. The project timephasing grid's Calculate needs
-- the same arithmetic against different rows, so rather than a second copy the
-- calculation is lifted into phase_across_periods and both callers use it.
--
--   phase_across_periods   total, dates and a curve in; period id -> value out
--   apply_cost_phasing     Calculate on the project timephasing grid
--   apply_line_item_phasing  rewritten to call the shared function
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

-- ------------------------------------------------- the calculation itself ----

create or replace function phase_across_periods(
  p_project_id uuid,
  p_total numeric,
  p_start date,
  p_end date,
  p_curve distribution_curve,
  p_existing jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with spans as (
    select p.id as period_id,
           row_number() over (order by p.sort_order) - 1 as i,
           count(*)  over () as n
      from reporting_periods p
     where p.project_id = p_project_id
       and p.kind = 'cost'
       and p.start_date <= p_end
       and p.end_date   >= p_start
  ),
  weighted as (
    select s.*,
           case p_curve
             when 'Even'       then 1::numeric
             when 'Front load' then (s.n - s.i)::numeric
             when 'Back load'  then (s.i + 1)::numeric
             when 'Bell Curve' then
               exp(-0.5 * power((s.i - (s.n - 1) / 2.0) / nullif(s.n / 4.0, 0), 2))::numeric
             when 'S-Curve' then
               (
                 1 / (1 + exp(-((s.i::numeric / nullif(s.n - 1, 0)) * 10 - 5)))
                 - case when s.i = 0 then 0
                        else 1 / (1 + exp(-(((s.i - 1)::numeric / nullif(s.n - 1, 0)) * 10 - 5)))
                   end
               )::numeric
             -- Profile keeps the shape already stored, rescaled to the new
             -- total; with nothing stored to copy it falls back to Even, as
             -- the browser did.
             when 'Profile' then
               coalesce((coalesce(p_existing, '{}'::jsonb) ->> s.period_id::text)::numeric, 0)
             else 1::numeric
           end as w
      from spans s
  ),
  normalised as (
    select w.period_id, w.i,
           case when coalesce(sum(w.w) over (), 0) = 0 then 1::numeric
                else coalesce(w.w, 0) end as w
      from weighted w
  ),
  running as (
    select n.period_id, n.i,
           sum(n.w) over (order by n.i rows between unbounded preceding and current row) as w_cum,
           sum(n.w) over () as w_total
      from normalised n
  ),
  -- Each share is the rounded running total less the previous rounded running
  -- total, so the shares sum to exactly p_total rather than a cent or two off.
  shares as (
    select r.period_id,
           round(coalesce(p_total, 0) * r.w_cum / nullif(r.w_total, 0), 2)
             - coalesce(lag(round(coalesce(p_total, 0) * r.w_cum / nullif(r.w_total, 0), 2))
                        over (order by r.i), 0) as value
      from running r
  )
  select coalesce(jsonb_object_agg(period_id::text, value), '{}'::jsonb) from shares;
$$;

revoke all on function phase_across_periods(uuid, numeric, date, date, distribution_curve, jsonb) from public, anon;
grant execute on function phase_across_periods(uuid, numeric, date, date, distribution_curve, jsonb) to authenticated;

-- --------------------------------------- Calculate on the timephasing grid ----

create or replace function apply_cost_phasing(
  p_project_id uuid,
  p_phasing_ids uuid[] default null   -- null = every Auto row in the project
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

revoke all on function apply_cost_phasing(uuid, uuid[]) from public, anon;
grant execute on function apply_cost_phasing(uuid, uuid[]) to authenticated;

-- ----------------------------------- line item phasing, on the shared code ----

create or replace function apply_line_item_phasing(
  p_subcontract_id uuid,
  p_item_ids uuid[] default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  proj uuid;
  next_start date;
  phased integer := 0;
begin
  select project_id into proj from subcontracts where id = p_subcontract_id;
  if proj is null then
    raise exception 'Subcontract % does not exist', p_subcontract_id;
  end if;

  select min(p.start_date) into next_start
    from reporting_periods p
   where p.project_id = proj
     and p.kind = 'cost'
     and p.sort_order > coalesce(
           (select c.sort_order from reporting_periods c
             where c.project_id = proj and c.kind = 'cost' and c.is_current),
           -1);

  with target as (
    select l.id, l.end_date, l.distribution, l.period_values,
           -- What is left to claim: the item's value less the latest claim
           -- against it.
           greatest(0, l.total - coalesce(pos.claimed, 0)) as to_phase,
           greatest(l.start_date, coalesce(next_start, l.start_date)) as window_start
      from subcontract_line_items l
      left join subcontract_line_item_claim_position pos on pos.line_item_id = l.id
     where l.subcontract_id = p_subcontract_id
       and l.phasing_source = 'Auto'
       and l.start_date is not null
       and l.end_date is not null
       and l.distribution is not null
       and (p_item_ids is null or l.id = any (p_item_ids))
  )
  update subcontract_line_items l
     set period_values = phase_across_periods(
           proj, t.to_phase, t.window_start, t.end_date,
           t.distribution, t.period_values),
         updated_at = now()
    from target t
   where l.id = t.id
     and t.window_start <= t.end_date;

  get diagnostics phased = row_count;
  return phased;
end;
$$;

revoke all on function apply_line_item_phasing(uuid, uuid[]) from public, anon;
grant execute on function apply_line_item_phasing(uuid, uuid[]) to authenticated;
