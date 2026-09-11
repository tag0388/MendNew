import { supabase, fromRow, fromRows, toRow, raise, assertId } from './supabase';
import type { Subcontract, SubcontractLineItem, Invoice, InvoiceItem } from '../types';

/**
 * Subcontracts, their line items, and the invoices claimed against them.
 *
 * Firestore held a subcontract's line items as an array inside the subcontract
 * document and an invoice's items inside the invoice, so drawing the
 * subcontracts grid meant loading every line item of every subcontract into
 * the browser and summing them there. A single order can carry thousands of
 * items (see ARCHITECTURE.md), so nothing here does that:
 *
 *   - the grid reads subcontract_summary, one row per subcontract with the
 *     roll-ups already computed in SQL
 *   - line items and invoice items are fetched only for the subcontract or
 *     invoice actually open
 *   - every write is one statement, and the parents' totals are re-derived by
 *     trigger rather than recomputed and written back by the browser
 */

// ------------------------------------------------------------ subcontracts ----

/** One row per subcontract, roll-ups included, no line items. */
export async function fetchSubcontractSummaries(projectId: string): Promise<Subcontract[]> {
  const { data, error } = await supabase
    .from('subcontract_summary')
    .select('*, vendors(name)')
    .eq('project_id', projectId)
    .order('order_id');
  raise('load subcontracts', error);
  return (data ?? []).map((row: any) => {
    const { vendors, ...rest } = row;
    return {
      ...fromRow<Subcontract>(rest)!,
      vendorName: vendors?.name ?? '',
      // The grid reads this; it is filled in only for the open subcontract.
      lineItems: [],
    } as Subcontract;
  });
}

export async function createSubcontract(
  projectId: string,
  input: Partial<Subcontract> & { orderId: string }
): Promise<Subcontract> {
  const { lineItems, vendorName, ...rest } = input as any;
  const { data, error } = await supabase
    .from('subcontracts')
    .insert({ ...toRow(rest), project_id: projectId })
    .select()
    .single();
  // (project_id, order_id) is unique, so a duplicate order number is refused
  // here rather than creating a second subcontract with the same reference.
  raise('create subcontract', error);
  return { ...fromRow<Subcontract>(data)!, lineItems: [] };
}

export async function updateSubcontract(id: string, patch: Partial<Subcontract>): Promise<void> {
  const { lineItems, vendorName, totalAmount, forecastChanges, ...rest } = patch as any;
  // totalAmount and forecastChanges are derived from the line items by
  // trigger; accepting them here would let a stale browser copy overwrite the
  // database's own sum.
  const { error } = await supabase.from('subcontracts').update(toRow(rest)).eq('id', assertId('updateSubcontract', id));
  raise('update subcontract', error);
}

/**
 * Apply one patch to many subcontracts.
 *
 * The dialog offers the same values for every selected row, so this is one
 * UPDATE ... WHERE id = any(...) rather than a write per row.
 */
export async function bulkUpdateSubcontracts(
  ids: string[],
  patch: Partial<Subcontract>
): Promise<number> {
  if (ids.length === 0) return 0;
  const { lineItems, vendorName, totalAmount, forecastChanges, ...rest } = patch as any;
  const row = toRow(rest);
  if (Object.keys(row).length === 0) return 0;
  const { data, error } = await supabase
    .from('subcontracts')
    .update(row)
    .in('id', ids)
    .select('id');
  raise('bulk update subcontracts', error);
  return data?.length ?? 0;
}

export async function deleteSubcontracts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // Line items and invoices cascade.
  const { error } = await supabase.from('subcontracts').delete().in('id', ids);
  raise('delete subcontracts', error);
}

/**
 * Import subcontracts from a sheet.
 *
 * Upsert on (project_id, order_id): a row whose order number is already in the
 * project updates that subcontract rather than creating a duplicate.
 */
export async function importSubcontracts(
  projectId: string,
  rows: Array<Partial<Subcontract> & { orderId: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('subcontracts')
    .upsert(
      rows.map((r) => {
        const { lineItems, vendorName, totalAmount, forecastChanges, ...rest } = r as any;
        return { ...toRow(rest), project_id: projectId };
      }),
      { onConflict: 'project_id,order_id' }
    )
    .select('id');
  raise('import subcontracts', error);
  return data?.length ?? 0;
}

// -------------------------------------------------------------- line items ----

export async function fetchLineItems(subcontractId: string): Promise<SubcontractLineItem[]> {
  const { data, error } = await supabase
    .from('subcontract_line_items')
    .select('*')
    .eq('subcontract_id', assertId('fetchLineItems', subcontractId))
    .order('sort_order')
    .order('item_no');
  raise('load line items', error);
  return fromRows<SubcontractLineItem>(data);
}

/** Every line item in the project, for the bulk grid. */
export async function fetchProjectLineItems(projectId: string): Promise<SubcontractLineItem[]> {
  const { data, error } = await supabase
    .from('subcontract_line_items')
    .select('*, subcontracts(order_id, order_name, status, vendors(name))')
    .eq('project_id', projectId)
    .order('sort_order');
  raise('load line items', error);
  return (data ?? []).map((row: any) => {
    const { subcontracts, ...rest } = row;
    return {
      ...fromRow<SubcontractLineItem>(rest)!,
      // The bulk grid shows which order each item belongs to.
      parentSubcontractId: rest.subcontract_id,
      orderId: subcontracts?.order_id ?? '',
      orderName: subcontracts?.order_name ?? '',
      subStatus: subcontracts?.status ?? '',
      vendorName: subcontracts?.vendors?.name ?? '',
    } as any;
  });
}

/**
 * Insert or update line items that may belong to different subcontracts.
 *
 * Still one statement: the conflict target is (subcontract_id, item_no), so
 * each row carries its own subcontract and the whole sheet goes in together.
 */
export async function upsertLineItemsAcrossSubcontracts(
  projectId: string,
  rows: Array<Partial<SubcontractLineItem> & { subcontractId: string; itemNo: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('subcontract_line_items')
    .upsert(
      rows.map((r) => {
        const { total, orderId, orderName, subStatus, vendorName, parentSubcontractId, ...rest } = r as any;
        return { ...toRow(rest), project_id: projectId };
      }),
      { onConflict: 'subcontract_id,item_no' }
    )
    .select('id');
  raise('save line items', error);
  return data?.length ?? 0;
}

/**
 * Insert or update line items in one statement.
 *
 * `total` is a generated column (qty x rate) and is refused on write, so it is
 * stripped here rather than each caller having to remember.
 */
export async function upsertLineItems(
  projectId: string,
  subcontractId: string,
  rows: Array<Partial<SubcontractLineItem> & { itemNo: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('subcontract_line_items')
    .upsert(
      rows.map((r) => {
        const { total, orderId, orderName, subStatus, vendorName, parentSubcontractId, ...rest } = r as any;
        return { ...toRow(rest), project_id: projectId, subcontract_id: subcontractId };
      }),
      { onConflict: 'subcontract_id,item_no' }
    )
    .select('id');
  raise('save line items', error);
  return data?.length ?? 0;
}

export async function updateLineItem(id: string, patch: Partial<SubcontractLineItem>): Promise<void> {
  const { total, orderId, orderName, subStatus, vendorName, parentSubcontractId, ...rest } = patch as any;
  const { error } = await supabase
    .from('subcontract_line_items')
    .update(toRow(rest))
    .eq('id', assertId('updateLineItem', id));
  raise('update line item', error);
}

export async function deleteLineItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('subcontract_line_items').delete().in('id', ids);
  raise('delete line items', error);
}

export interface LineItemBulkPatch {
  costCodeId?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  phasingSource?: string;
  distribution?: string;
  type?: string;
  status?: string;
  enterpriseAttributes?: Record<string, string>;
  projectAttributes?: Record<string, string>;
  userDefined?: Record<string, string>;
  clearEnterpriseAttributes?: string[];
  clearProjectAttributes?: string[];
  clearUserDefined?: string[];
}

/** One patch across many line items, in one statement. */
export async function bulkUpdateLineItems(ids: string[], patch: LineItemBulkPatch): Promise<number> {
  if (ids.length === 0) return 0;
  const nonEmpty = (m?: Record<string, unknown>) => (m && Object.keys(m).length > 0 ? m : null);
  const { data, error } = await supabase.rpc('bulk_update_subcontract_line_items', {
    p_item_ids: ids,
    p_cost_code_id: patch.costCodeId || null,
    p_item_date: patch.date || null,
    p_start_date: patch.startDate || null,
    p_end_date: patch.endDate || null,
    p_phasing_source: patch.phasingSource || null,
    p_distribution: patch.distribution || null,
    p_type: patch.type || null,
    p_status: patch.status || null,
    p_enterprise_attributes: nonEmpty(patch.enterpriseAttributes),
    p_project_attributes: nonEmpty(patch.projectAttributes),
    p_user_defined: nonEmpty(patch.userDefined),
    p_clear_enterprise_attributes: patch.clearEnterpriseAttributes ?? [],
    p_clear_project_attributes: patch.clearProjectAttributes ?? [],
    p_clear_user_defined: patch.clearUserDefined ?? [],
  });
  raise('bulk update line items', error);
  return (data as number) ?? 0;
}

// ---------------------------------------------------------------- invoices ----

export async function fetchInvoices(projectId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, vendors(name), subcontracts(order_id, order_name)')
    .eq('project_id', projectId)
    .order('created_at');
  raise('load invoices', error);
  return (data ?? []).map((row: any) => {
    const { vendors, subcontracts, ...rest } = row;
    return {
      ...fromRow<Invoice>(rest)!,
      vendorName: vendors?.name ?? '',
      orderId: subcontracts?.order_id ?? '',
      orderName: subcontracts?.order_name ?? '',
      items: [],
    } as Invoice;
  });
}

export async function createInvoice(
  projectId: string,
  subcontractId: string,
  input: Partial<Invoice> & { invoiceId: string }
): Promise<Invoice> {
  const { items, vendorName, totalAmount, certifiedAmount, ...rest } = input as any;
  const { data, error } = await supabase
    .from('invoices')
    .insert({ ...toRow(rest), project_id: projectId, subcontract_id: subcontractId })
    .select()
    .single();
  raise('create invoice', error);
  return { ...fromRow<Invoice>(data)!, items: [] };
}

/**
 * Raise a new invoice, pre-filled with one item per line item on the order,
 * opening at what has already been certified. Done in the database so the
 * items are not built by loading every prior invoice into the browser.
 */
export async function createInvoiceFromSubcontract(
  subcontractId: string,
  invoiceRef: string,
  description?: string,
  initiator?: string | null
): Promise<string> {
  const { data, error } = await supabase.rpc('create_invoice_from_subcontract', {
    p_subcontract_id: assertId('createInvoiceFromSubcontract', subcontractId),
    p_invoice_id: invoiceRef,
    p_description: description ?? null,
    p_initiator: initiator ?? null,
  });
  raise('create invoice', error);
  return data as string;
}

export async function updateInvoice(id: string, patch: Partial<Invoice>): Promise<void> {
  // The two money columns are summed from the invoice's items by trigger.
  const { items, vendorName, totalAmount, certifiedAmount, orderId, orderName, ...rest } = patch as any;
  const { error } = await supabase.from('invoices').update(toRow(rest)).eq('id', assertId('updateInvoice', id));
  raise('update invoice', error);
}

export async function deleteInvoices(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('invoices').delete().in('id', ids);
  raise('delete invoices', error);
}

// ----------------------------------------------------------- invoice items ----

export async function fetchInvoiceItems(invoiceId: string): Promise<InvoiceItem[]> {
  const { data, error } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', assertId('fetchInvoiceItems', invoiceId))
    .order('sort_order')
    .order('item_no');
  raise('load invoice items', error);
  return fromRows<InvoiceItem>(data);
}

/** Every invoice item in the project, for the bulk grid. */
export async function fetchProjectInvoiceItems(projectId: string): Promise<InvoiceItem[]> {
  const { data, error } = await supabase
    .from('invoice_items')
    .select('*, invoices!inner(invoice_id, project_id, subcontract_id, status)')
    .eq('invoices.project_id', projectId)
    .order('sort_order');
  raise('load invoice items', error);
  return (data ?? []).map((row: any) => {
    const { invoices, ...rest } = row;
    return {
      ...fromRow<InvoiceItem>(rest)!,
      invoiceId: invoices?.invoice_id ?? '',
      invoiceStatus: invoices?.status ?? '',
      subcontractId: invoices?.subcontract_id ?? '',
    } as InvoiceItem;
  });
}

export async function upsertInvoiceItems(
  invoiceId: string,
  rows: Array<Partial<InvoiceItem>>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('invoice_items')
    .upsert(
      rows.map((r) => {
        const { total, invoiceStatus, subcontractId, ...rest } = r as any;
        return { ...toRow(rest), invoice_id: invoiceId };
      })
    )
    .select('id');
  raise('save invoice items', error);
  return data?.length ?? 0;
}

export async function updateInvoiceItem(id: string, patch: Partial<InvoiceItem>): Promise<void> {
  const { total, invoiceStatus, subcontractId, ...rest } = patch as any;
  const { error } = await supabase
    .from('invoice_items')
    .update(toRow(rest))
    .eq('id', assertId('updateInvoiceItem', id));
  raise('update invoice item', error);
}

export async function deleteInvoiceItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('invoice_items').delete().in('id', ids);
  raise('delete invoice items', error);
}

/**
 * One patch across many invoice items.
 *
 * A percentage is the input; the quantity and the value follow from it inside
 * the function, so the three can never disagree.
 */
export async function bulkUpdateInvoiceItems(
  ids: string[],
  patch: { claimPercent?: number; certifiedPercent?: number; commentary?: string }
): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc('bulk_update_invoice_items', {
    p_item_ids: ids,
    p_claim_percent: patch.claimPercent ?? null,
    p_certified_percent: patch.certifiedPercent ?? null,
    p_commentary: patch.commentary || null,
  });
  raise('bulk update invoice items', error);
  return (data as number) ?? 0;
}

// ----------------------------------------------------------------- vendors ----

export interface Vendor {
  id: string;
  enterpriseId: string;
  name: string;
  code?: string;
  contactName?: string;
  contactEmail?: string;
}

export async function fetchVendors(enterpriseId: string): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .order('name');
  raise('load vendors', error);
  return fromRows<Vendor>(data);
}

/** Find a vendor by name, creating it if the enterprise has no such vendor. */
export async function resolveVendorByName(enterpriseId: string, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data: found, error: findError } = await supabase
    .from('vendors')
    .select('id')
    .eq('enterprise_id', enterpriseId)
    .ilike('name', trimmed)
    .limit(1);
  raise('look up vendor', findError);
  if (found && found.length > 0) return found[0].id;

  const { data, error } = await supabase
    .from('vendors')
    .insert({ enterprise_id: enterpriseId, name: trimmed })
    .select('id')
    .single();
  raise('create vendor', error);
  return data?.id ?? null;
}

// -------------------------------------------------------- claim positions ----

export interface ClaimPosition {
  claimed: number;
  certified: number;
}

/**
 * Claimed and certified to date per line item, keyed by line item id.
 *
 * Read from a view: each invoice states the cumulative position, so the answer
 * is the value on the latest invoice mentioning the item. The browser used to
 * derive this by loading every invoice in the project with all of its items.
 */
export async function fetchClaimPositions(
  projectId: string,
  subcontractId?: string
): Promise<Record<string, ClaimPosition>> {
  let q = supabase
    .from('subcontract_line_item_claim_position')
    .select('line_item_id, claimed, certified')
    .eq('project_id', projectId);
  if (subcontractId) {
    q = q.eq('subcontract_id', assertId('fetchClaimPositions', subcontractId));
  }
  const { data, error } = await q;
  raise('load claim positions', error);
  const out: Record<string, ClaimPosition> = {};
  for (const row of data ?? []) {
    out[(row as any).line_item_id] = {
      claimed: Number((row as any).claimed) || 0,
      certified: Number((row as any).certified) || 0,
    };
  }
  return out;
}

/**
 * One AG Grid cell edit on a subcontract line item.
 *
 * The grid names its attribute columns with Firestore's dotted path --
 * "enterpriseAttributes.<id>", "userDefined.<key>". A jsonb column has no such
 * path, so those edits go through the merge function instead of being sent as
 * a column name that does not exist; everything else is a plain update.
 */
export async function applyLineItemCellEdit(id: string, field: string, value: any): Promise<void> {
  const dot = field.indexOf('.');
  if (dot === -1) {
    await updateLineItem(id, { [field]: value } as any);
    return;
  }
  const map = field.slice(0, dot);
  const key = field.slice(dot + 1);
  const entry = { [key]: value ?? '' };
  if (map === 'enterpriseAttributes') await bulkUpdateLineItems([id], { enterpriseAttributes: entry });
  else if (map === 'projectAttributes') await bulkUpdateLineItems([id], { projectAttributes: entry });
  else if (map === 'userDefined') await bulkUpdateLineItems([id], { userDefined: entry });
  else await updateLineItem(id, { [field]: value } as any);
}

/**
 * Invoice items for one invoice, with the parent line item's reference fields
 * and the position on the PREVIOUS invoice of the same order.
 *
 * Read from a view. The browser used to derive the previous position by
 * loading every invoice on the order with all of its items and walking them.
 */
export async function fetchInvoiceItemDetail(invoiceId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('invoice_item_detail')
    .select('*')
    .eq('invoice_id', assertId('fetchInvoiceItemDetail', invoiceId))
    .order('sort_order')
    .order('item_no');
  raise('load invoice items', error);
  return fromRows<any>(data);
}

/**
 * Edit one of an invoice item's twelve claim/certification figures.
 *
 * The other eleven are derived in the same statement, from what is stored
 * rather than from the copy the browser is holding, so they cannot disagree.
 */
export async function setInvoiceItemClaim(id: string, field: string, value: number): Promise<void> {
  const { error } = await supabase.rpc('set_invoice_item_claim', {
    p_item_id: assertId('setInvoiceItemClaim', id),
    p_field: field,
    p_value: Number(value) || 0,
  });
  raise('update invoice item', error);
}

/**
 * Recalculate auto-phasing for a subcontract's line items, in the database.
 *
 * Pass the ids to phase, or nothing to phase every item on the order set to
 * Auto. Returns how many were phased.
 */
export async function applyLineItemPhasing(
  subcontractId: string,
  itemIds?: string[]
): Promise<number> {
  const { data, error } = await supabase.rpc('apply_line_item_phasing', {
    p_subcontract_id: assertId('applyLineItemPhasing', subcontractId),
    p_item_ids: itemIds && itemIds.length > 0 ? itemIds : null,
  });
  raise('calculate phasing', error);
  return (data as number) ?? 0;
}

// ------------------------------------------------------- invoice summary ----

/**
 * One row per invoice with its order, vendor, and this-period claimed and
 * certified totals, for the bulk invoices grid. Those totals are aggregates of
 * the invoice's items; the browser used to load every invoice in the project
 * with all of its items to produce them.
 */
export async function fetchInvoiceSummaries(projectId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('invoice_summary')
    .select('*')
    .eq('project_id', projectId)
    .order('order_id')
    .order('invoice_id');
  raise('load invoices', error);
  return fromRows<any>(data);
}

/**
 * Set a this-period percentage across every item of the given invoices.
 *
 * The quantities and values follow from the percentage inside the function,
 * measured from what the previous invoice certified -- the same rule the
 * single-cell edit uses.
 */
export async function bulkSetInvoiceClaimPercent(
  invoiceIds: string[],
  patch: { periodicClaimPercent?: number; periodicCertifiedPercent?: number }
): Promise<number> {
  if (invoiceIds.length === 0) return 0;
  const { data, error } = await supabase.rpc('bulk_set_invoice_claim_percent', {
    p_invoice_ids: invoiceIds,
    p_periodic_claim_percent: patch.periodicClaimPercent ?? null,
    p_periodic_certified_percent: patch.periodicCertifiedPercent ?? null,
  });
  raise('apply claim percentage', error);
  return (data as number) ?? 0;
}

/**
 * Import invoice headers from a sheet.
 *
 * Upsert on (subcontract_id, invoice_id): a row whose invoice number already
 * exists on that order updates it rather than raising a second invoice with
 * the same reference. One statement, whatever the size of the sheet -- the
 * browser used to chunk this into batches of 400.
 */
export async function importInvoices(
  projectId: string,
  rows: Array<Partial<Invoice> & { subcontractId: string; invoiceId: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('invoices')
    .upsert(
      rows.map((r) => {
        const { items, vendorName, totalAmount, certifiedAmount, orderId, orderName, ...rest } = r as any;
        return { ...toRow(rest), project_id: projectId };
      }),
      { onConflict: 'subcontract_id,invoice_id' }
    )
    .select('id');
  raise('import invoices', error);
  return data?.length ?? 0;
}

/** Bulk header edits across invoices, in one statement. */
export async function bulkUpdateInvoices(ids: string[], patch: Partial<Invoice>): Promise<number> {
  if (ids.length === 0) return 0;
  const { items, vendorName, totalAmount, certifiedAmount, orderId, orderName, ...rest } = patch as any;
  const row = toRow(rest);
  if (Object.keys(row).length === 0) return 0;
  const { data, error } = await supabase.from('invoices').update(row).in('id', ids).select('id');
  raise('bulk update invoices', error);
  return data?.length ?? 0;
}

/**
 * Every invoice item in the project, with its order, invoice and the parent
 * line item's reference fields, for the bulk invoice items grid.
 */
export async function fetchProjectInvoiceItemDetail(projectId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('invoice_item_detail')
    .select('*, invoices!inner(invoice_id), subcontracts:subcontract_id(order_id, order_name, status, vendors(name))')
    .eq('project_id', projectId)
    .order('sort_order');
  raise('load invoice items', error);
  return (data ?? []).map((row: any) => {
    const { invoices, subcontracts, ...rest } = row;
    return {
      ...fromRow<any>(rest)!,
      // invoice_id on the row is the invoice's id; the grid also shows its
      // user-facing number.
      parentInvoiceId: invoices?.invoice_id ?? '',
      orderId: subcontracts?.order_id ?? '',
      orderName: subcontracts?.order_name ?? '',
      subcontractStatus: subcontracts?.status ?? '',
      vendorName: subcontracts?.vendors?.name ?? '',
    };
  });
}

/**
 * Apply many claim edits in one call -- an imported sheet, or a bulk edit that
 * sets a different figure per item.
 *
 * Each edit names the field the user supplied; the other eleven figures are
 * derived in the database from the position stored there.
 */
export async function applyInvoiceItemClaims(
  edits: Array<{ id: string; field: string; value: number }>
): Promise<number> {
  if (edits.length === 0) return 0;
  const { data, error } = await supabase.rpc('apply_invoice_item_claims', { p_edits: edits });
  raise('apply claim edits', error);
  return (data as number) ?? 0;
}
