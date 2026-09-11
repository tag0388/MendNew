-- ============================================================================
-- Progress Tracking's Calculate, in the database.
--
-- The button did three things per item, all in the browser, over every item
-- in the project:
--
--   1. earned to date, from the item's rule of credit -- the weighted steps
--      and how far each has progressed -- and from that, what was earned in
--      the current period (earned to date less what earlier periods hold)
--   2. the planned phasing, spreading the total quantity over the progress
--      periods its planned dates touch, on the item's curve
--   3. the forecast phasing, spreading what is LEFT to earn over the periods
--      its current dates touch, clamped to start no earlier than the current
--      period
--
-- Same shape as the ETC and cost phasing functions: one statement, and only
-- the items whose numbers actually moved are written.
--
-- The progress curves are their own set -- even, front load, back load, Bell
-- and Scurve -- and are not the distribution_curve used by cost and
-- subcontract phasing, so this does not call phase_across_periods. Bell and
-- Scurve share one shape here, as they did in the browser: sin(pi x) across
-- the range. Worth a look when you next review the maths -- a Bell and an
-- S-curve are usually different things, one being the derivative of the
-- other.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

-- The progress curves, as one function so the shape is stated once.
-- i is the zero-based period index, n the number of periods covered. The
-- weights are relative; the caller normalises them.
create or replace function progress_curve_weight(
  p_curve text,
  p_i integer,
  p_n integer
)
returns numeric
language sql
immutable
as $$
  select case p_curve
    when 'front load' then (p_n - p_i)::numeric
    when 'back load'  then (p_i + 1)::numeric
    -- Bell and Scurve share one shape, as they did in the browser.
    when 'Bell'       then sin(pi() * (p_i + 0.5) / nullif(p_n, 0))::numeric
    when 'Scurve'     then sin(pi() * (p_i + 0.5) / nullif(p_n, 0))::numeric
    else 1::numeric   -- even
  end;
$$;

revoke all on function progress_curve_weight(text, integer, integer) from public, anon;
grant execute on function progress_curve_weight(text, integer, integer) to authenticated;

create or replace function calculate_progress(
  p_project_id uuid,
  p_item_ids uuid[] default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  changed integer := 0;
  current_period_id uuid;
  current_period_start date;
  current_period_sort integer;
begin
  select p.id, p.start_date, p.sort_order
    into current_period_id, current_period_start, current_period_sort
    from reporting_periods p
   where p.project_id = p_project_id
     and p.kind = 'progress'
     and p.status = 'open'
   order by p.sort_order
   limit 1;

  with
  -- The periods a forecast may use: everything not yet closed.
  open_periods as (
    select p.id, p.start_date, p.end_date, p.sort_order
      from reporting_periods p
     where p.project_id = p_project_id
       and p.kind = 'progress'
       and p.status <> 'closed'
  ),
  target as (
    select i.*,
           coalesce(i.rule_of_credit_id, pk.rule_of_credit_id) as effective_roc
      from progress_items i
      left join progress_packages pk on pk.id = i.package_id
     where i.project_id = p_project_id
       and (p_item_ids is null or i.id = any (p_item_ids))
  ),
  -- 1. Earned to date, from the rule of credit's weighted steps.
  earned as (
    select t.*,
           coalesce(t.total_qty, 0) * coalesce((
             select sum(coalesce((t.rule_of_credit_progress ->> s.id::text)::numeric, 0)
                        * s.weight / 100)
               from rule_of_credit_steps s
              where s.rule_of_credit_id = t.effective_roc
           ), 0) / 100 as earned_to_date
      from target t
  ),
  -- What the periods before the current one already hold.
  prior as (
    select e.*,
           coalesce((
             select sum(coalesce(v.value::numeric, 0))
               from jsonb_each_text(coalesce(e.actual_period_values, '{}'::jsonb)) v
               join reporting_periods rp on rp.id::text = v.key
              where rp.project_id = p_project_id
                and rp.kind = 'progress'
                and rp.sort_order < coalesce(current_period_sort, 2147483647)
           ), 0) as prior_earned
      from earned e
  ),
  -- 2 and 3. The periods each item's planned and current ranges touch.
  planned_spans as (
    select p.id as item_id, op.id as period_id,
           row_number() over (partition by p.id order by op.sort_order) - 1 as i,
           count(*)      over (partition by p.id) as n,
           coalesce(p.total_qty, 0) as amount,
           coalesce(p.phasing_curve::text, 'even') as curve
      from prior p
      join open_periods op
        on op.start_date <= p.planned_end_date
       and op.end_date   >= p.planned_start_date
     where coalesce(p.phasing_method::text, 'Auto') = 'Auto'
       and p.planned_start_date is not null
       and p.planned_end_date is not null
  ),
  current_spans as (
    select p.id as item_id, op.id as period_id,
           row_number() over (partition by p.id order by op.sort_order) - 1 as i,
           count(*)      over (partition by p.id) as n,
           -- The forecast covers what is left to earn, not the whole quantity.
           greatest(0, coalesce(p.total_qty, 0) - p.earned_to_date) as amount,
           coalesce(p.current_phasing_curve::text, 'even') as curve
      from prior p
      join open_periods op
        on op.start_date <= p.current_end_date
       -- The forecast cannot start before the current period.
       and op.end_date   >= greatest(p.current_start_date,
                                     coalesce(current_period_start, p.current_start_date))
     where coalesce(p.current_phasing_method::text, 'Auto') = 'Auto'
       and p.current_start_date is not null
       and p.current_end_date is not null
  ),
  weighted as (
    select item_id, period_id, amount, i, n, 'planned' as which,
           progress_curve_weight(curve, i, n) as w
      from planned_spans
    union all
    select item_id, period_id, amount, i, n, 'current',
           progress_curve_weight(curve, i, n)
      from current_spans
  ),
  shares as (
    select w.item_id, w.which, w.period_id,
           round(w.amount * w.w / nullif(sum(w.w) over (partition by w.item_id, w.which), 0), 2) as value
      from weighted w
  ),
  built as (
    select item_id, which, jsonb_object_agg(period_id::text, value) as values
      from shares
     group by item_id, which
  ),
  final as (
    select p.id,
           -- Earned in the current period is what is earned to date less what
           -- the earlier periods already hold, never negative.
           case when current_period_id is null then p.actual_period_values
                else jsonb_set(coalesce(p.actual_period_values, '{}'::jsonb),
                               array[current_period_id::text],
                               to_jsonb(round(greatest(0, p.earned_to_date - p.prior_earned), 4)))
           end as new_actuals,
           coalesce(bp.values, p.period_values)         as new_planned,
           coalesce(bc.values, p.current_period_values) as new_current
      from prior p
      left join built bp on bp.item_id = p.id and bp.which = 'planned'
      left join built bc on bc.item_id = p.id and bc.which = 'current'
  )
  update progress_items i
     set actual_period_values  = f.new_actuals,
         period_values         = f.new_planned,
         current_period_values = f.new_current,
         updated_at = now()
    from final f
   where i.id = f.id
     -- Only the items whose numbers actually moved.
     and (i.actual_period_values  is distinct from f.new_actuals
       or i.period_values         is distinct from f.new_planned
       or i.current_period_values is distinct from f.new_current);

  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function calculate_progress(uuid, uuid[]) from public, anon;
grant execute on function calculate_progress(uuid, uuid[]) to authenticated;
