-- ============================================================================
-- The bulk invoices grid: a summary row, and setting a claim across invoices.
--
-- The grid showed each invoice's "this period" claimed and certified totals by
-- loading every invoice in the project with all of its items and summing the
-- periodic fields in the browser. Those are aggregates; they belong in SQL.
--
-- Its bulk update set a percentage on every item of every selected invoice,
-- working the quantities and values out in the browser from the copy it held,
-- then writing whole item arrays back. bulk_set_invoice_claim_percent applies
-- the same rule -- the one set_invoice_item_claim uses for a single cell -- to
-- every item of the selected invoices in one statement.
--
-- Plain PostgreSQL: a view, an update with a join. See ARCHITECTURE.md.
-- ============================================================================

create or replace view invoice_summary
with (security_invoker = true) as
select
  v.id,
  v.project_id,
  v.subcontract_id,
  v.invoice_id,
  v.description,
  v.status,
  v.submitted_date,
  v.certified_date,
  v.payment_date,
  v.initiator,
  v.vendor_id,
  v.total_amount,
  v.certified_amount,
  v.created_at,
  v.updated_at,

  s.order_id,
  s.order_name,
  ven.name as vendor_name,

  coalesce(agg.periodic_claimed, 0)   as periodic_claimed,
  coalesce(agg.periodic_certified, 0) as periodic_certified,
  coalesce(agg.item_count, 0)         as item_count
from invoices v
join subcontracts s on s.id = v.subcontract_id
left join vendors ven on ven.id = v.vendor_id
left join lateral (
  select sum(t.periodic_claim_value)     as periodic_claimed,
         sum(t.periodic_certified_value) as periodic_certified,
         count(*)                        as item_count
    from invoice_items t
   where t.invoice_id = v.id
) agg on true;

revoke all on invoice_summary from public, anon;
grant select on invoice_summary to authenticated;

-- ------------------------------------------ one percentage, many invoices ----

create or replace function bulk_set_invoice_claim_percent(
  p_invoice_ids uuid[],
  p_periodic_claim_percent numeric default null,
  p_periodic_certified_percent numeric default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  if p_periodic_claim_percent is null and p_periodic_certified_percent is null then
    return 0;
  end if;

  with detail as (
    select d.id,
           coalesce(d.qty, 0)  as qty,
           coalesce(d.rate, 0) as rate,
           -- Measured from what was CERTIFIED on the previous invoice: a claim
           -- that was not certified has to be re-claimed.
           coalesce(d.previous_certified_qty, 0)     as prev_qty,
           coalesce(d.previous_certified_percent, 0) as prev_pct,
           coalesce(d.previous_certified_value, 0)   as prev_val
      from invoice_item_detail d
     where d.invoice_id = any (p_invoice_ids)
  ),
  claim as (
    select x.*,
           round(coalesce(p_periodic_claim_percent, 0) / 100 * x.qty, 2) as pc_qty
      from detail x
  ),
  computed as (
    select c.id, c.qty, c.rate, c.prev_qty, c.prev_pct, c.prev_val, c.pc_qty,
           round(c.prev_qty + c.pc_qty, 2)                                  as c_qty,
           round(c.prev_pct + coalesce(p_periodic_claim_percent, 0), 2)     as c_pct,
           round(c.pc_qty * c.rate, 2)                                      as pc_val,
           round((c.prev_qty + c.pc_qty) * c.rate, 2)                       as c_val,
           round(coalesce(p_periodic_certified_percent, 0) / 100 * c.qty, 2) as pt_qty
      from claim c
  ),
  final as (
    select k.*,
           round(k.prev_qty + k.pt_qty, 2)                                  as t_qty,
           round(k.prev_pct + coalesce(p_periodic_certified_percent, 0), 2) as t_pct,
           round(k.pt_qty * k.rate, 2)                                      as pt_val,
           round((k.prev_qty + k.pt_qty) * k.rate, 2)                       as t_val
      from computed k
  )
  update invoice_items t
     set claim_qty     = case when p_periodic_claim_percent is null then t.claim_qty     else f.c_qty end,
         claim_percent = case when p_periodic_claim_percent is null then t.claim_percent else f.c_pct end,
         claim_value   = case when p_periodic_claim_percent is null then t.claim_value   else f.c_val end,
         periodic_claim_qty     = case when p_periodic_claim_percent is null then t.periodic_claim_qty     else f.pc_qty end,
         periodic_claim_percent = case when p_periodic_claim_percent is null then t.periodic_claim_percent else p_periodic_claim_percent end,
         periodic_claim_value   = case when p_periodic_claim_percent is null then t.periodic_claim_value   else f.pc_val end,

         -- Certifying follows claiming unless a certified percentage was given
         -- as well, which then wins -- the same rule as the single-cell edit.
         certified_qty = case
           when p_periodic_certified_percent is not null then f.t_qty
           when p_periodic_claim_percent is not null     then f.c_qty
           else t.certified_qty end,
         certified_percent = case
           when p_periodic_certified_percent is not null then f.t_pct
           when p_periodic_claim_percent is not null     then f.c_pct
           else t.certified_percent end,
         certified_value = case
           when p_periodic_certified_percent is not null then f.t_val
           when p_periodic_claim_percent is not null     then f.c_val
           else t.certified_value end,
         periodic_certified_qty = case
           when p_periodic_certified_percent is not null then f.pt_qty
           when p_periodic_claim_percent is not null     then f.pc_qty
           else t.periodic_certified_qty end,
         periodic_certified_percent = case
           when p_periodic_certified_percent is not null then p_periodic_certified_percent
           when p_periodic_claim_percent is not null     then p_periodic_claim_percent
           else t.periodic_certified_percent end,
         periodic_certified_value = case
           when p_periodic_certified_percent is not null then f.pt_val
           when p_periodic_claim_percent is not null     then f.pc_val
           else t.periodic_certified_value end,
         updated_at = now()
    from final f
   where t.id = f.id;

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function bulk_set_invoice_claim_percent(uuid[], numeric, numeric) from public, anon;
grant execute on function bulk_set_invoice_claim_percent(uuid[], numeric, numeric) to authenticated;
