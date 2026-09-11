-- ============================================================================
-- What has been claimed and certified against each subcontract line item.
--
-- Each invoice states the cumulative position, so the answer is the value on
-- the LATEST invoice that mentions the item, not the sum across invoices --
-- summing would count the same work once per invoice. The browser worked this
-- out by loading every invoice in the project with all of its items, sorting
-- them by the digits in the invoice reference and walking them.
--
-- Plain PostgreSQL: distinct on, a view. security_invoker so the caller's RLS
-- on invoices and invoice_items still decides what is visible.
-- ============================================================================

create or replace view subcontract_line_item_claim_position
with (security_invoker = true) as
select distinct on (t.subcontract_line_item_id)
  t.subcontract_line_item_id as line_item_id,
  l.subcontract_id,
  l.project_id,
  v.id         as invoice_row_id,
  v.invoice_id as invoice_ref,
  t.claim_value     as claimed,
  t.certified_value as certified
from invoice_items t
join invoices v on v.id = t.invoice_id
join subcontract_line_items l on l.id = t.subcontract_line_item_id
where t.subcontract_line_item_id is not null
order by
  t.subcontract_line_item_id,
  coalesce(nullif(regexp_replace(v.invoice_id, '\D', '', 'g'), '')::bigint, 0) desc,
  v.created_at desc;

revoke all on subcontract_line_item_claim_position from public, anon;
grant select on subcontract_line_item_claim_position to authenticated;
