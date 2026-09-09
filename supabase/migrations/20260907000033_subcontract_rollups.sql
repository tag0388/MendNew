-- ============================================================================
-- Subcontract and invoice roll-ups, computed by the database.
--
-- Firestore kept a subcontract's line items as an array inside the subcontract
-- document, so every figure on the subcontracts grid -- original amount,
-- approved/pending/forecast changes, total, claimed and certified to date --
-- was produced by loading every line item of every subcontract into the
-- browser and summing them there. On a project with thousands of line items
-- that is the whole commitment ledger crossing the network to draw one row.
--
-- Line items are rows now, and these aggregates are SQL. Two pieces:
--
--   subcontract_summary  a view the grid selects from, one row per
--                        subcontract, no line items sent to the browser
--
--   triggers             keep subcontracts.total_amount / forecast_changes and
--                        invoices.total_amount / certified_amount in step with
--                        their children, so a reader that wants the number
--                        without the view still gets a correct one
--
-- Plain PostgreSQL: views, triggers and aggregates. See ARCHITECTURE.md.
-- ============================================================================

-- ------------------------------------------------------- summary for a grid --
-- security_invoker makes the view apply the caller's RLS to the tables under
-- it, rather than the view owner's. Without it the view would be a way around
-- the policies on subcontracts and subcontract_line_items.

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

-- ------------------------------------------------ keep the stored columns ----

create or replace function refresh_subcontract_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.subcontract_id, old.subcontract_id);
begin
  update subcontracts s
     set total_amount = coalesce((
           select sum(l.total) from subcontract_line_items l
            where l.subcontract_id = target and l.status <> 'Rejected'), 0),
         forecast_changes = coalesce((
           select sum(l.total) from subcontract_line_items l
            where l.subcontract_id = target
              and l.type = 'ChangeOrder' and l.status = 'Forecast'), 0)
   where s.id = target;
  return null;
end;
$$;

-- AFTER ... FOR EACH STATEMENT would not know which subcontract changed, and
-- FOR EACH ROW on a 5,000-row import would re-sum 5,000 times. The trigger is
-- per row but the update it runs is one indexed aggregate, and an import
-- writes one subcontract's items at a time.
create trigger subcontract_line_items_refresh_totals
  after insert or update or delete on subcontract_line_items
  for each row execute function refresh_subcontract_totals();

create or replace function refresh_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update invoices v
     set total_amount = coalesce((
           select sum(t.claim_value) from invoice_items t where t.invoice_id = target), 0),
         certified_amount = coalesce((
           select sum(t.certified_value) from invoice_items t where t.invoice_id = target), 0)
   where v.id = target;
  return null;
end;
$$;

create trigger invoice_items_refresh_totals
  after insert or update or delete on invoice_items
  for each row execute function refresh_invoice_totals();

-- Bring existing rows in line with what the triggers will now maintain.
update subcontracts s
   set total_amount = coalesce((
         select sum(l.total) from subcontract_line_items l
          where l.subcontract_id = s.id and l.status <> 'Rejected'), 0),
       forecast_changes = coalesce((
         select sum(l.total) from subcontract_line_items l
          where l.subcontract_id = s.id
            and l.type = 'ChangeOrder' and l.status = 'Forecast'), 0);

update invoices v
   set total_amount = coalesce((
         select sum(t.claim_value) from invoice_items t where t.invoice_id = v.id), 0),
       certified_amount = coalesce((
         select sum(t.certified_value) from invoice_items t where t.invoice_id = v.id), 0);
