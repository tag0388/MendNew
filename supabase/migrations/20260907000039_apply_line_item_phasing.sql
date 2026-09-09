-- ============================================================================
-- Spreading a subcontract line item's remaining value across cost periods.
--
-- "Calculate" on the line items grid used to run in the browser: for every
-- item set to Auto it worked out the periods the item's dates overlap, built a
-- weight per period from the distribution curve, and wrote the whole line item
-- array back onto the subcontract. On an order with thousands of items that is
-- the entire order re-serialised for one button press.
--
-- The curves are the ones the browser used, unchanged:
--
--   Even        every period the same
--   Front load  n, n-1, ... 1
--   Back load   1, 2, ... n
--   Bell Curve  exp(-x^2/2), x measured in quarter-spans from the middle
--   S-Curve     the increment of a logistic between period boundaries
--   Profile     keep the shape already stored, rescaled to the new total
--
-- What is spread is what is left to claim -- the item's total less what has
-- already been claimed against it -- and it starts no earlier than the period
-- after the current one, because phasing is a forecast and a closed period's
-- position is already stated by its invoices.
--
-- Plain PostgreSQL: generate_series, window functions, jsonb_object_agg. See
-- ARCHITECTURE.md.
-- ============================================================================

create or replace function apply_line_item_phasing(
  p_subcontract_id uuid,
  p_item_ids uuid[] default null   -- null = every Auto item on the order
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

  -- Forecasting starts in the period AFTER the current one. With no current
  -- period marked, nothing is held back.
  select min(p.start_date) into next_start
    from reporting_periods p
   where p.project_id = proj
     and p.kind = 'cost'
     and p.sort_order > coalesce(
           (select c.sort_order from reporting_periods c
             where c.project_id = proj and c.kind = 'cost' and c.is_current),
           -1);

  with target as (
    select l.id, l.start_date, l.end_date, l.distribution, l.total, l.period_values
      from subcontract_line_items l
     where l.subcontract_id = p_subcontract_id
       and l.phasing_source = 'Auto'
       and l.start_date is not null
       and l.end_date is not null
       and l.distribution is not null
       and (p_item_ids is null or l.id = any (p_item_ids))
  ),
  -- What is left to claim: the item's value less the latest claim against it.
  remaining as (
    select t.*,
           greatest(0, t.total - coalesce(pos.claimed, 0)) as to_phase,
           -- The window opens at the later of the item's own start and the
           -- first forecastable period.
           greatest(t.start_date, coalesce(next_start, t.start_date)) as window_start
      from target t
      left join subcontract_line_item_claim_position pos on pos.line_item_id = t.id
  ),
  -- The periods each item's window actually touches, numbered from zero.
  spans as (
    select r.id,
           r.distribution,
           r.to_phase,
           r.period_values,
           p.id as period_id,
           row_number() over (partition by r.id order by p.sort_order) - 1 as i,
           count(*)  over (partition by r.id) as n
      from remaining r
      join reporting_periods p
        on p.project_id = proj
       and p.kind = 'cost'
       and p.start_date <= r.end_date
       and p.end_date   >= r.window_start
     where r.window_start <= r.end_date
  ),
  weighted as (
    select s.*,
           case s.distribution
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
             when 'Profile' then
               coalesce((s.period_values ->> s.period_id::text)::numeric, 0)
             else 1::numeric
           end as w
      from spans s
  ),
  -- A Profile with nothing stored to copy falls back to Even, as it did in the
  -- browser; so does a single-period S-Curve, whose divisor would be zero.
  normalised as (
    select w.id, w.period_id, w.i, w.to_phase,
           case when coalesce(sum(w.w) over (partition by w.id), 0) = 0
                then 1::numeric else coalesce(w.w, 0) end as w
      from weighted w
  ),
  -- Rounding each share independently leaves the phasing a cent or two off
  -- the value being spread, which shows up as a forecast that does not add up
  -- to the commitment. The last period absorbs the difference instead: each
  -- share is the running total rounded, less the running total rounded up to
  -- the period before, so the shares sum to exactly to_phase.
  running as (
    select n.id, n.period_id, n.i, n.to_phase, n.w,
           sum(n.w) over (partition by n.id order by n.i
                          rows between unbounded preceding and current row) as w_cum,
           sum(n.w) over (partition by n.id) as w_total
      from normalised n
  ),
  shares as (
    select r.id, r.period_id,
           round(r.to_phase * r.w_cum / nullif(r.w_total, 0), 2)
             - coalesce(lag(round(r.to_phase * r.w_cum / nullif(r.w_total, 0), 2))
                        over (partition by r.id order by r.i), 0) as value
      from running r
  ),
  built as (
    select id, jsonb_object_agg(period_id::text, value) as pv
      from shares
     group by id
  )
  update subcontract_line_items l
     set period_values = b.pv,
         updated_at = now()
    from built b
   where l.id = b.id;

  get diagnostics phased = row_count;
  return phased;
end;
$$;

revoke all on function apply_line_item_phasing(uuid, uuid[]) from public, anon;
grant execute on function apply_line_item_phasing(uuid, uuid[]) to authenticated;
