-- ============================================================================
-- Invoice items: the previous position, and editing a claim.
--
-- An invoice line carries twelve numbers -- claimed and certified, cumulative
-- and this-period, each as a quantity, a percentage and a value. Editing any
-- one of them determines the other eleven. The browser held all twelve
-- derivations, worked them out from a copy of the invoice it had loaded, then
-- wrote the whole item array back. Two things followed: the arithmetic ran on
-- whatever the browser happened to be holding, and the "previous cumulative"
-- it worked from came from loading every invoice on the order.
--
-- Both move here.
--
--   invoice_item_detail  one row per invoice item, carrying the parent line
--                        item's reference fields and the position on the
--                        PREVIOUS invoice of the same subcontract
--
--   set_invoice_item_claim  edit one of the twelve; the rest are derived in
--                        the same statement, so they cannot disagree
--
-- Plain PostgreSQL: a view, a function, window functions. See ARCHITECTURE.md.
-- ============================================================================

create or replace view invoice_item_detail
with (security_invoker = true) as
with ordered as (
  select
    v.id as invoice_row_id,
    v.subcontract_id,
    v.project_id,
    row_number() over (
      partition by v.subcontract_id
      order by coalesce(nullif(regexp_replace(v.invoice_id, '\D', '', 'g'), '')::bigint, 0),
               v.created_at
    ) as seq
  from invoices v
)
select
  t.id,
  t.invoice_id,
  o.subcontract_id,
  o.project_id,
  t.subcontract_line_item_id,

  -- The parent line item is the reference: its quantity, rate and description
  -- are what the invoice is claimed against, and they may have been revised
  -- since the invoice was raised.
  coalesce(l.item_no, t.item_no)         as item_no,
  coalesce(l.description, t.description) as description,
  coalesce(l.qty, t.qty)                 as qty,
  coalesce(l.unit, t.unit)               as unit,
  coalesce(l.rate, t.rate)               as rate,
  coalesce(l.type, t.type)               as type,
  t.total,

  t.claim_qty, t.claim_percent, t.claim_value,
  t.periodic_claim_qty, t.periodic_claim_percent, t.periodic_claim_value,
  t.certified_qty, t.certified_percent, t.certified_value,
  t.periodic_certified_qty, t.periodic_certified_percent, t.periodic_certified_value,
  t.commentary,
  t.sort_order,

  coalesce(p.claim_qty, 0)         as previous_claim_qty,
  coalesce(p.claim_percent, 0)     as previous_claim_percent,
  coalesce(p.claim_value, 0)       as previous_claim_value,
  coalesce(p.certified_qty, 0)     as previous_certified_qty,
  coalesce(p.certified_percent, 0) as previous_certified_percent,
  coalesce(p.certified_value, 0)   as previous_certified_value
from invoice_items t
join ordered o on o.invoice_row_id = t.invoice_id
left join subcontract_line_items l on l.id = t.subcontract_line_item_id
left join lateral (
  select pt.claim_qty, pt.claim_percent, pt.claim_value,
         pt.certified_qty, pt.certified_percent, pt.certified_value
    from invoice_items pt
    join ordered po on po.invoice_row_id = pt.invoice_id
   where pt.subcontract_line_item_id = t.subcontract_line_item_id
     and po.subcontract_id = o.subcontract_id
     and po.seq = o.seq - 1
   limit 1
) p on true;

revoke all on invoice_item_detail from public, anon;
grant select on invoice_item_detail to authenticated;

-- ------------------------------------------------------- editing a claim ----

create or replace function set_invoice_item_claim(
  p_item_id uuid,
  p_field text,
  p_value numeric
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  d           invoice_item_detail%rowtype;
  v_qty       numeric;
  v_rate      numeric;
  prev_qty    numeric;
  prev_pct    numeric;
  prev_val    numeric;
  c_qty  numeric; c_pct  numeric; c_val  numeric;   -- cumulative claim
  pc_qty numeric; pc_pct numeric; pc_val numeric;   -- periodic claim
  t_qty  numeric; t_pct  numeric; t_val  numeric;   -- cumulative certified
  pt_qty numeric; pt_pct numeric; pt_val numeric;   -- periodic certified
  is_claim boolean := false;
  v numeric := round(coalesce(p_value, 0), 2);
begin
  select * into d from invoice_item_detail where id = p_item_id;
  if not found then
    raise exception 'Invoice item % does not exist', p_item_id;
  end if;

  v_qty  := coalesce(d.qty, 0);
  v_rate := coalesce(d.rate, 0);

  -- Every "this period" figure is measured from what was CERTIFIED on the
  -- previous invoice, not from what was claimed: a claim that was not
  -- certified has to be re-claimed.
  prev_qty := coalesce(d.previous_certified_qty, 0);
  prev_pct := coalesce(d.previous_certified_percent, 0);
  prev_val := coalesce(d.previous_certified_value, 0);

  -- Start from what is stored, then overwrite whatever the edit determines.
  c_qty  := d.claim_qty;      c_pct  := d.claim_percent;      c_val  := d.claim_value;
  pc_qty := d.periodic_claim_qty; pc_pct := d.periodic_claim_percent; pc_val := d.periodic_claim_value;
  t_qty  := d.certified_qty;  t_pct  := d.certified_percent;  t_val  := d.certified_value;
  pt_qty := d.periodic_certified_qty; pt_pct := d.periodic_certified_percent; pt_val := d.periodic_certified_value;

  case p_field
    -- ---------------------------------------------------------- claimed ----
    when 'claimQty' then
      is_claim := true;
      c_qty  := v;
      pc_qty := round(c_qty - prev_qty, 2);
      c_val  := round(c_qty * v_rate, 2);
      c_pct  := case when v_qty > 0 then round(c_qty / v_qty * 100, 2) else 0 end;
      pc_val := round(c_val - prev_val, 2);
      pc_pct := round(c_pct - prev_pct, 2);

    when 'periodicClaimQty' then
      is_claim := true;
      pc_qty := v;
      c_qty  := round(prev_qty + pc_qty, 2);
      c_val  := round(c_qty * v_rate, 2);
      c_pct  := case when v_qty > 0 then round(c_qty / v_qty * 100, 2) else 0 end;
      pc_val := round(pc_qty * v_rate, 2);
      pc_pct := case when v_qty > 0 then round(pc_qty / v_qty * 100, 2) else 0 end;

    when 'claimPercent' then
      is_claim := true;
      c_pct  := v;
      c_qty  := round(v / 100 * v_qty, 2);
      pc_qty := round(c_qty - prev_qty, 2);
      c_val  := round(c_qty * v_rate, 2);
      pc_val := round(c_val - prev_val, 2);
      pc_pct := round(v - prev_pct, 2);

    when 'periodicClaimPercent' then
      is_claim := true;
      pc_pct := v;
      pc_qty := round(v / 100 * v_qty, 2);
      c_qty  := round(prev_qty + pc_qty, 2);
      c_pct  := round(prev_pct + v, 2);
      pc_val := round(pc_qty * v_rate, 2);
      c_val  := round(c_qty * v_rate, 2);

    when 'claimValue' then
      is_claim := true;
      c_val  := v;
      pc_val := round(v - prev_val, 2);
      c_qty  := case when v_rate > 0 then round(v / v_rate, 2) else 0 end;
      pc_qty := round(c_qty - prev_qty, 2);
      c_pct  := case when v_qty > 0 then round(c_qty / v_qty * 100, 2) else 0 end;
      pc_pct := round(c_pct - prev_pct, 2);

    when 'periodicClaimValue' then
      is_claim := true;
      pc_val := v;
      c_val  := round(prev_val + v, 2);
      pc_qty := case when v_rate > 0 then round(v / v_rate, 2) else 0 end;
      c_qty  := round(prev_qty + pc_qty, 2);
      pc_pct := case when v_qty > 0 then round(pc_qty / v_qty * 100, 2) else 0 end;
      c_pct  := round(prev_pct + pc_pct, 2);

    -- -------------------------------------------------------- certified ----
    when 'certifiedQty' then
      t_qty  := v;
      pt_qty := round(v - prev_qty, 2);
      t_val  := round(v * v_rate, 2);
      t_pct  := case when v_qty > 0 then round(v / v_qty * 100, 2) else 0 end;
      pt_val := round(t_val - prev_val, 2);
      pt_pct := round(t_pct - prev_pct, 2);

    when 'periodicCertifiedQty' then
      pt_qty := v;
      t_qty  := round(prev_qty + v, 2);
      t_val  := round(t_qty * v_rate, 2);
      t_pct  := case when v_qty > 0 then round(t_qty / v_qty * 100, 2) else 0 end;
      pt_val := round(v * v_rate, 2);
      pt_pct := case when v_qty > 0 then round(v / v_qty * 100, 2) else 0 end;

    when 'certifiedPercent' then
      t_pct  := v;
      t_qty  := round(v / 100 * v_qty, 2);
      pt_qty := round(t_qty - prev_qty, 2);
      t_val  := round(t_qty * v_rate, 2);
      pt_val := round(t_val - prev_val, 2);
      pt_pct := round(v - prev_pct, 2);

    when 'periodicCertifiedPercent' then
      pt_pct := v;
      pt_qty := round(v / 100 * v_qty, 2);
      t_qty  := round(prev_qty + pt_qty, 2);
      t_pct  := round(prev_pct + v, 2);
      pt_val := round(pt_qty * v_rate, 2);
      t_val  := round(t_qty * v_rate, 2);

    when 'certifiedValue' then
      t_val  := v;
      pt_val := round(v - prev_val, 2);
      t_qty  := case when v_rate > 0 then round(v / v_rate, 2) else 0 end;
      pt_qty := round(t_qty - prev_qty, 2);
      t_pct  := case when v_qty > 0 then round(t_qty / v_qty * 100, 2) else 0 end;
      pt_pct := round(t_pct - prev_pct, 2);

    when 'periodicCertifiedValue' then
      pt_val := v;
      t_val  := round(prev_val + v, 2);
      pt_qty := case when v_rate > 0 then round(v / v_rate, 2) else 0 end;
      t_qty  := round(prev_qty + pt_qty, 2);
      pt_pct := case when v_qty > 0 then round(pt_qty / v_qty * 100, 2) else 0 end;
      t_pct  := round(prev_pct + pt_pct, 2);

    else
      raise exception 'set_invoice_item_claim does not handle the field %', p_field;
  end case;

  -- Certifying follows claiming until somebody certifies a different figure.
  if is_claim then
    t_qty  := c_qty;  t_pct  := c_pct;  t_val  := c_val;
    pt_qty := pc_qty; pt_pct := pc_pct; pt_val := pc_val;
  end if;

  update invoice_items
     set claim_qty = c_qty, claim_percent = c_pct, claim_value = c_val,
         periodic_claim_qty = pc_qty, periodic_claim_percent = pc_pct, periodic_claim_value = pc_val,
         certified_qty = t_qty, certified_percent = t_pct, certified_value = t_val,
         periodic_certified_qty = pt_qty, periodic_certified_percent = pt_pct, periodic_certified_value = pt_val,
         updated_at = now()
   where id = p_item_id;
end;
$$;

revoke all on function set_invoice_item_claim(uuid, text, numeric) from public, anon;
grant execute on function set_invoice_item_claim(uuid, text, numeric) to authenticated;
