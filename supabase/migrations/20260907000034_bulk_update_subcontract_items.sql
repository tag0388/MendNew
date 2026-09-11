-- ============================================================================
-- Applying one set of changes to many subcontract line items or invoice items.
--
-- Same shape and the same reasons as bulk_update_cost_codes and
-- bulk_update_change_records: one statement instead of a loop of writes, and
-- the attribute maps merge into what is stored now rather than into the copy
-- the browser is holding, so two people editing different attributes of the
-- same item cannot revert each other.
--
-- The bulk dialogs offer "clear this attribute" as well as "set it". Setting
-- is jsonb ||; clearing is jsonb - text[], which is why each map takes a
-- companion array of keys to remove. A key appearing in both is removed.
--
-- The parent totals are re-derived by the triggers added in the previous
-- migration, so nothing here has to remember to update them.
-- ============================================================================

create or replace function bulk_update_subcontract_line_items(
  p_item_ids uuid[],
  p_cost_code_id uuid default null,
  p_item_date date default null,
  p_start_date date default null,
  p_end_date date default null,
  p_phasing_source phasing_source default null,
  p_distribution distribution_curve default null,
  p_type line_item_type default null,
  p_status line_item_status default null,
  p_enterprise_attributes jsonb default null,
  p_project_attributes jsonb default null,
  p_user_defined jsonb default null,
  p_clear_enterprise_attributes text[] default '{}',
  p_clear_project_attributes text[] default '{}',
  p_clear_user_defined text[] default '{}'
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  update subcontract_line_items
     set cost_code_id   = coalesce(p_cost_code_id, cost_code_id),
         item_date      = coalesce(p_item_date, item_date),
         start_date     = coalesce(p_start_date, start_date),
         end_date       = coalesce(p_end_date, end_date),
         phasing_source = coalesce(p_phasing_source, phasing_source),
         distribution   = coalesce(p_distribution, distribution),
         type           = coalesce(p_type, type),
         status         = coalesce(p_status, status),
         enterprise_attributes =
           (enterprise_attributes || coalesce(p_enterprise_attributes, '{}'::jsonb))
             - coalesce(p_clear_enterprise_attributes, '{}'::text[]),
         project_attributes =
           (project_attributes || coalesce(p_project_attributes, '{}'::jsonb))
             - coalesce(p_clear_project_attributes, '{}'::text[]),
         user_defined =
           (user_defined || coalesce(p_user_defined, '{}'::jsonb))
             - coalesce(p_clear_user_defined, '{}'::text[]),
         updated_at = now()
   where id = any (p_item_ids);

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function bulk_update_subcontract_line_items(
  uuid[], uuid, date, date, date, phasing_source, distribution_curve,
  line_item_type, line_item_status, jsonb, jsonb, jsonb,
  text[], text[], text[]) from public, anon;
grant execute on function bulk_update_subcontract_line_items(
  uuid[], uuid, date, date, date, phasing_source, distribution_curve,
  line_item_type, line_item_status, jsonb, jsonb, jsonb,
  text[], text[], text[]) to authenticated;

-- ---------------------------------------------------------- invoice items ----

create or replace function bulk_update_invoice_items(
  p_item_ids uuid[],
  p_claim_percent numeric default null,
  p_certified_percent numeric default null,
  p_commentary text default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  -- A claim is stated as a percentage of the line item; the quantity and the
  -- value follow from it. The browser used to work all three out and send them
  -- together, which let them disagree. Here they cannot.
  update invoice_items
     set claim_percent = coalesce(p_claim_percent, claim_percent),
         claim_qty     = case when p_claim_percent is null then claim_qty
                              else qty * p_claim_percent / 100 end,
         claim_value   = case when p_claim_percent is null then claim_value
                              else total * p_claim_percent / 100 end,
         certified_percent = coalesce(p_certified_percent, certified_percent),
         certified_qty     = case when p_certified_percent is null then certified_qty
                                  else qty * p_certified_percent / 100 end,
         certified_value   = case when p_certified_percent is null then certified_value
                                  else total * p_certified_percent / 100 end,
         commentary = coalesce(p_commentary, commentary),
         updated_at = now()
   where id = any (p_item_ids);

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function bulk_update_invoice_items(uuid[], numeric, numeric, text) from public, anon;
grant execute on function bulk_update_invoice_items(uuid[], numeric, numeric, text) to authenticated;
