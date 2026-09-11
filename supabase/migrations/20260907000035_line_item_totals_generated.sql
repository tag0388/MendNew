-- ============================================================================
-- A line item's total is qty x rate, and the database says so.
--
-- Every write path in the browser computed `total` itself and sent it along
-- with qty and rate. Three places did it for subcontract line items and three
-- more for invoice items, so a path that forgot -- or that wrote qty without
-- re-deriving -- left a row whose total disagreed with its own quantity and
-- rate, and the subcontract's roll-up inherited the disagreement.
--
-- A generated column removes the possibility rather than the mistake. It is
-- standard PostgreSQL (12+), not a Supabase feature.
--
-- The columns have to be dropped and re-added: a plain column cannot be
-- altered into a generated one. The stored values are exactly qty x rate
-- wherever the browser did its job, so nothing is lost by recomputing them,
-- and where they disagreed the generated value is the correct one.
-- ============================================================================

drop view if exists subcontract_summary;

alter table subcontract_line_items drop column total;
alter table subcontract_line_items
  add column total numeric(18,2)
  generated always as (round(qty * rate, 2)) stored;

alter table invoice_items drop column total;
alter table invoice_items
  add column total numeric(18,2)
  generated always as (round(qty * rate, 2)) stored;

-- The view selects the column, so it is rebuilt on the new definition.
create or replace view subcontract_summary
with (security_invoker = true) as
select
  s.id,
  s.project_id,
  s.order_id,
  s.order_name,
  s.order_scope,
  s.status,
  s.payment_type,
  s.award_date,
  s.vendor_id,
  s.vendor_users,
  s.default_cost_code_id,
  s.default_phasing_source,
  s.default_start_date,
  s.default_end_date,
  s.default_distribution,
  s.enterprise_attributes,
  s.project_attributes,
  s.created_at,
  s.updated_at,

  coalesce(li.original_amount, 0)  as original_amount,
  coalesce(li.approved_changes, 0) as approved_changes,
  coalesce(li.pending_changes, 0)  as pending_changes,
  coalesce(li.forecast_changes, 0) as forecast_changes,
  coalesce(li.total_amount, 0)     as total_amount,
  coalesce(li.line_item_count, 0)  as line_item_count,

  -- Cumulative claim and certification are carried by the latest invoice, not
  -- by a sum: each invoice states the position to date, so summing them would
  -- count the same work once per invoice.
  coalesce(inv.claimed_amount_to_date, 0)   as claimed_amount_to_date,
  coalesce(inv.certified_amount_to_date, 0) as certified_amount_to_date,
  coalesce(inv.certified_amount_to_date, 0)
    - coalesce(inv.claimed_amount_to_date, 0)                as variance_amount,
  coalesce(inv.invoice_count, 0) as invoice_count
from subcontracts s
left join lateral (
  select
    sum(l.total) filter (where l.type = 'Original')                             as original_amount,
    sum(l.total) filter (where l.type = 'ChangeOrder' and l.status = 'Approved') as approved_changes,
    sum(l.total) filter (where l.type = 'ChangeOrder' and l.status = 'Pending')  as pending_changes,
    sum(l.total) filter (where l.type = 'ChangeOrder' and l.status = 'Forecast') as forecast_changes,
    sum(l.total) filter (where l.status <> 'Rejected')                          as total_amount,
    count(*)                                                                    as line_item_count
  from subcontract_line_items l
  where l.subcontract_id = s.id
) li on true
left join lateral (
  select
    (array_agg(i.total_amount     order by i.ordinal desc, i.created_at desc))[1] as claimed_amount_to_date,
    (array_agg(i.certified_amount order by i.ordinal desc, i.created_at desc))[1] as certified_amount_to_date,
    count(*) as invoice_count
  from (
    select
      v.total_amount,
      v.certified_amount,
      v.created_at,
      -- Invoices are numbered "IV-003", "Invoice 12". The browser ranked them
      -- by the digits in the reference; nullif keeps a reference with no
      -- digits at all from becoming ''::bigint.
      coalesce(nullif(regexp_replace(v.invoice_id, '\D', '', 'g'), '')::bigint, 0) as ordinal
    from invoices v
    where v.subcontract_id = s.id
  ) i
) inv on true;

revoke all on subcontract_summary from public, anon;
grant select on subcontract_summary to authenticated;
