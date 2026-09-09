-- ============================================================================
-- Raising an invoice against a subcontract.
--
-- A new invoice starts with one item per line item on the order, opening at
-- the position already certified, so the vendor claims from where the last
-- invoice left off. The browser did this by loading every invoice on the
-- subcontract with all of its items and building the array itself -- and it
-- SUMMED the certified figures across those invoices. Each invoice states the
-- cumulative position, so summing them counts the same work once per invoice:
-- a third invoice opened at roughly three times what had been certified. The
-- rest of the module reads the latest invoice, which is the correct reading,
-- and so does this.
--
-- Everything is one statement: the invoice, then its items from the line
-- items joined to that position.
--
-- Plain PostgreSQL. The invoice's total_amount and certified_amount are left
-- to the trigger on invoice_items.
-- ============================================================================

create or replace function create_invoice_from_subcontract(
  p_subcontract_id uuid,
  p_invoice_id text,
  p_description text default null,
  p_initiator text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_invoice uuid;
  sub subcontracts%rowtype;
begin
  select * into sub from subcontracts where id = p_subcontract_id;
  if not found then
    raise exception 'Subcontract % does not exist', p_subcontract_id;
  end if;

  insert into invoices (
    subcontract_id, project_id, invoice_id, description,
    status, initiator, vendor_id, created_by
  )
  values (
    sub.id, sub.project_id, p_invoice_id,
    coalesce(p_description, 'Invoice ' || p_invoice_id),
    'Draft', p_initiator, sub.vendor_id, auth.uid()
  )
  returning id into new_invoice;

  insert into invoice_items (
    invoice_id, subcontract_line_item_id, item_no, description,
    qty, unit, rate, type,
    claim_qty, claim_percent, claim_value,
    certified_qty, certified_percent, certified_value,
    sort_order
  )
  select
    new_invoice,
    l.id,
    l.item_no,
    l.description,
    l.qty,
    l.unit,
    l.rate,
    l.type,
    -- Opening claim = what has been certified so far, so the periodic figures
    -- on the new invoice start at zero.
    coalesce(pos.certified_qty, 0),
    coalesce(pos.certified_percent, 0),
    coalesce(pos.certified_value, 0),
    coalesce(pos.certified_qty, 0),
    coalesce(pos.certified_percent, 0),
    coalesce(pos.certified_value, 0),
    l.sort_order
  from subcontract_line_items l
  left join lateral (
    select t.certified_qty, t.certified_percent, t.certified_value
      from invoice_items t
      join invoices v on v.id = t.invoice_id
     where t.subcontract_line_item_id = l.id
       and v.subcontract_id = sub.id
     order by coalesce(nullif(regexp_replace(v.invoice_id, '\D', '', 'g'), '')::bigint, 0) desc,
              v.created_at desc
     limit 1
  ) pos on true
  where l.subcontract_id = sub.id
  order by l.sort_order, l.item_no;

  return new_invoice;
end;
$$;

revoke all on function create_invoice_from_subcontract(uuid, text, text, text) from public, anon;
grant execute on function create_invoice_from_subcontract(uuid, text, text, text) to authenticated;
