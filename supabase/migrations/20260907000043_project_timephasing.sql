-- ============================================================================
-- The project timephasing grid, computed in the database.
--
-- This screen is the app's largest browser-side aggregation. To draw three or
-- four rows per cost code it loaded, for the whole project:
--
--   every cost phasing row, every actual cost transaction, every ETC detail
--   line, and every subcontract with its embedded line item array
--
-- and then cross-aggregated them per cost code per period in JavaScript. At
-- the scale this app is built for -- 5,000 cost codes, hundreds of thousands
-- of actual cost transactions, ETC detail lines in the millions (see
-- ARCHITECTURE.md) -- that does not degrade, it stops working.
--
-- The rules are unchanged, only their location:
--
--   Baseline / Approved   the stored phasing, unless the source is
--                         SubContract, in which case the subcontract line
--                         items assigned to the cost code
--   EAC                   actuals up to and including the current period,
--                         then the forecast: ETC details, subcontract line
--                         items, or the stored phasing, per the row's source
--   EAC Previous          the stored phasing, untouched
--
-- A subcontract line item falls to its own cost code, or to the subcontract's
-- default -- the same rule recalculate_project_costs applies. Rejected items
-- are excluded. The browser matched these by comparing user-facing code text
-- with several fallbacks and upper-casing; they are foreign keys here, so the
-- join is exact and the fallbacks are gone.
--
-- Plain PostgreSQL: views, lateral joins, jsonb_each. See ARCHITECTURE.md.
-- ============================================================================

-- ------------------------------------------- per cost code, per period ------

-- Actual cost by cost code and period.
create or replace view cost_code_actuals_by_period
with (security_invoker = true) as
select a.project_id, a.cost_code_id, a.reporting_period_id as period_id,
       sum(a.cost) as amount
  from actual_costs a
 group by a.project_id, a.cost_code_id, a.reporting_period_id;

revoke all on cost_code_actuals_by_period from public, anon;
grant select on cost_code_actuals_by_period to authenticated;

-- Forecast from ETC details: quantity per period x the line's rate.
create or replace view cost_code_etc_by_period
with (security_invoker = true) as
select e.project_id, e.cost_code_id, pv.key::uuid as period_id,
       sum(coalesce(pv.value::numeric, 0) * coalesce(e.rate, 0)) as amount
  from etc_details e
  cross join lateral jsonb_each_text(e.period_values) as pv(key, value)
 where pv.value is not null
   and pv.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 group by e.project_id, e.cost_code_id, pv.key;

revoke all on cost_code_etc_by_period from public, anon;
grant select on cost_code_etc_by_period to authenticated;

-- Forecast from subcontract line items, at their own cost code or the order's
-- default. Rejected items do not commit anything.
create or replace view cost_code_subcontract_by_period
with (security_invoker = true) as
select l.project_id,
       coalesce(l.cost_code_id, s.default_cost_code_id) as cost_code_id,
       pv.key::uuid as period_id,
       sum(coalesce(pv.value::numeric, 0)) as amount
  from subcontract_line_items l
  join subcontracts s on s.id = l.subcontract_id
  cross join lateral jsonb_each_text(l.period_values) as pv(key, value)
 where l.status <> 'Rejected'
   and coalesce(l.cost_code_id, s.default_cost_code_id) is not null
   and pv.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 group by l.project_id, coalesce(l.cost_code_id, s.default_cost_code_id), pv.key;

revoke all on cost_code_subcontract_by_period from public, anon;
grant select on cost_code_subcontract_by_period to authenticated;

-- ------------------------------------------------------ the grid itself ----

create or replace view project_timephasing
with (security_invoker = true) as
with periods as (
  select p.id, p.project_id, p.sort_order, p.is_current,
         -- Everything up to and including the current period is history:
         -- actuals stand, and a forecast does not apply there.
         p.sort_order <= coalesce(
           (select c.sort_order from reporting_periods c
             where c.project_id = p.project_id and c.kind = 'cost' and c.is_current),
           -1) as is_past_or_current
    from reporting_periods p
   where p.kind = 'cost'
),
kinds as (
  select * from (values
    ('baseline'::cost_phasing_type,    'Baseline Budget',        'baseline'),
    ('approved'::cost_phasing_type,    'Approved Budget',        'approved'),
    ('eac'::cost_phasing_type,         'Estimate At Completion', 'eac'),
    ('eacPrevious'::cost_phasing_type, 'EAC Previous',           'eacPrevious')
  ) as k(kind, label, row_type)
),
rows_wanted as (
  select c.id as cost_code_id, c.project_id, c.code, c.name,
         c.baseline_budget, c.approved_budget,
         c.estimate_at_completion, c.estimate_at_completion_previous,
         k.kind, k.label, k.row_type,
         ph.id as phasing_id, ph.phasing_source, ph.start_date, ph.end_date,
         ph.distribution, ph.activity_id, ph.period_values
    from cost_codes c
    cross join kinds k
    left join cost_phasing ph on ph.cost_code_id = c.id and ph.type = k.kind
   -- EAC Previous is a comparison line: it is shown only where one was stored.
   where k.kind <> 'eacPrevious' or ph.id is not null
)
select
  r.cost_code_id,
  r.project_id,
  r.code as cost_code,
  r.name as cost_code_name,
  r.label as type,
  r.row_type,
  r.phasing_id,
  coalesce(r.phasing_source, case when r.row_type = 'eac' then 'ETC Details' else 'Manual' end) as phasing_source,
  r.start_date,
  r.end_date,
  coalesce(r.distribution, 'Even') as distribution,
  r.activity_id,
  case r.row_type
    when 'baseline'    then r.baseline_budget
    when 'approved'    then r.approved_budget
    when 'eac'         then r.estimate_at_completion
    when 'eacPrevious' then r.estimate_at_completion_previous
  end as total_from_code,
  coalesce(vals.period_values, '{}'::jsonb) as period_values
from rows_wanted r
left join lateral (
  select jsonb_object_agg(p.id::text, round(
    case
      -- EAC Previous is stored as it stands; nothing is substituted into it.
      when r.row_type = 'eacPrevious' then
        coalesce((r.period_values ->> p.id::text)::numeric, 0)

      -- A closed or current period is actual cost, whatever the source says.
      when r.row_type = 'eac' and p.is_past_or_current then
        coalesce(act.amount, 0)

      when r.row_type = 'eac' then
        case coalesce(r.phasing_source, 'ETC Details')
          when 'ETC Details' then coalesce(etc.amount, 0)
          when 'SubContract' then coalesce(sc.amount, 0)
          else coalesce((r.period_values ->> p.id::text)::numeric, 0)
        end

      -- Budgets follow the subcontracts when told to, otherwise the phasing
      -- entered against them.
      when coalesce(r.phasing_source, 'Manual') = 'SubContract' then
        coalesce(sc.amount, 0)

      else coalesce((r.period_values ->> p.id::text)::numeric, 0)
    end, 2)) as period_values
    from periods p
    left join cost_code_actuals_by_period     act on act.cost_code_id = r.cost_code_id and act.period_id = p.id
    left join cost_code_etc_by_period         etc on etc.cost_code_id = r.cost_code_id and etc.period_id = p.id
    left join cost_code_subcontract_by_period sc  on sc.cost_code_id  = r.cost_code_id and sc.period_id  = p.id
   where p.project_id = r.project_id
) vals on true;

revoke all on project_timephasing from public, anon;
grant select on project_timephasing to authenticated;
