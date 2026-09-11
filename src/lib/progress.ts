import { supabase, fromRows, raise, assertId } from './supabase';

/**
 * Progress packages and the items measured against them.
 *
 * A package's items reference it by id, so deleting a package cascades to
 * them -- the browser used to read every child back first to delete them
 * alongside it, and its bulk delete could only look up ten packages' children
 * at a time because Firestore's `in` operator capped there.
 */

export async function fetchProgressPackages(projectId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('progress_packages')
    .select('*')
    .eq('project_id', projectId)
    .order('package_id');
  raise('load progress packages', error);
  return fromRows<any>(data);
}

export async function fetchProgressItems(projectId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('progress_items')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order');
  raise('load progress items', error);
  return fromRows<any>(data);
}

const PACKAGE_FIELDS: Record<string, string> = {
  packageId: 'package_id',
  description: 'description',
  unit: 'unit',
  ruleOfCreditId: 'rule_of_credit_id',
  attributes: 'attributes',
  defaultStartDate: 'default_start_date',
  defaultEndDate: 'default_end_date',
  defaultPhasingMethod: 'default_phasing_method',
  defaultPhasingCurve: 'default_phasing_curve',
};

const ITEM_FIELDS: Record<string, string> = {
  packageId: 'package_id',
  costCodeId: 'cost_code_id',
  itemId: 'item_id',
  activityId: 'activity_id',
  description: 'description',
  totalQty: 'total_qty',
  totalQtyPrevious: 'total_qty_previous',
  earnedQtyPrevious: 'earned_qty_previous',
  plannedStartDate: 'planned_start_date',
  plannedEndDate: 'planned_end_date',
  phasingMethod: 'phasing_method',
  phasingCurve: 'phasing_curve',
  currentStartDate: 'current_start_date',
  currentEndDate: 'current_end_date',
  currentPhasingMethod: 'current_phasing_method',
  currentPhasingCurve: 'current_phasing_curve',
  ruleOfCreditId: 'rule_of_credit_id',
  ruleOfCreditProgress: 'rule_of_credit_progress',
  periodValues: 'period_values',
  currentPeriodValues: 'current_period_values',
  actualPeriodValues: 'actual_period_values',
  enterpriseAttributes: 'enterprise_attributes',
  projectAttributes: 'project_attributes',
  sortOrder: 'sort_order',
};

// A DATE column takes yyyy-mm-dd or null; the grid hands back '' when a date
// is cleared, and a uuid column cannot hold '' either.
const NULLABLE = new Set([
  'default_start_date', 'default_end_date',
  'planned_start_date', 'planned_end_date',
  'current_start_date', 'current_end_date',
  'rule_of_credit_id', 'cost_code_id', 'package_id',
  'default_phasing_method', 'default_phasing_curve',
  'phasing_method', 'phasing_curve',
  'current_phasing_method', 'current_phasing_curve',
]);

function toRowWith(map: Record<string, string>, patch: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key in patch) {
    const column = map[key];
    if (!column || patch[key] === undefined) continue;
    out[column] = NULLABLE.has(column) ? (patch[key] || null) : patch[key];
  }
  return out;
}

// --------------------------------------------------------------- packages ----

export async function createProgressPackage(projectId: string, pkg: Record<string, any>): Promise<string> {
  const { data, error } = await supabase
    .from('progress_packages')
    .insert({ ...toRowWith(PACKAGE_FIELDS, pkg), project_id: projectId })
    .select('id')
    .single();
  // (project_id, package_id) is unique, so a duplicate reference is refused.
  raise('add progress package', error);
  return data!.id;
}

export async function updateProgressPackage(id: string, patch: Record<string, any>): Promise<void> {
  const row = toRowWith(PACKAGE_FIELDS, patch);
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from('progress_packages')
    .update(row)
    .eq('id', assertId('updateProgressPackage', id));
  raise('update progress package', error);
}

/** Deleting a package cascades to its items. */
export async function deleteProgressPackages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('progress_packages').delete().in('id', ids);
  raise('delete progress packages', error);
}

export async function bulkUpdateProgressPackages(ids: string[], patch: Record<string, any>): Promise<number> {
  if (ids.length === 0) return 0;
  const row = toRowWith(PACKAGE_FIELDS, patch);
  if (Object.keys(row).length === 0) return 0;
  const { data, error } = await supabase
    .from('progress_packages')
    .update(row)
    .in('id', ids)
    .select('id');
  raise('bulk update progress packages', error);
  return data?.length ?? 0;
}

export async function importProgressPackages(
  projectId: string,
  rows: Array<Record<string, any> & { packageId: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('progress_packages')
    .upsert(
      rows.map((r) => ({ ...toRowWith(PACKAGE_FIELDS, r), project_id: projectId })),
      { onConflict: 'project_id,package_id' }
    )
    .select('id');
  raise('import progress packages', error);
  return data?.length ?? 0;
}

// ------------------------------------------------------------------ items ----

export async function upsertProgressItems(
  projectId: string,
  rows: Array<Record<string, any>>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('progress_items')
    .upsert(rows.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      ...toRowWith(ITEM_FIELDS, r),
      project_id: projectId,
    })))
    .select('id');
  raise('save progress items', error);
  return data?.length ?? 0;
}

export async function updateProgressItem(id: string, patch: Record<string, any>): Promise<void> {
  const row = toRowWith(ITEM_FIELDS, patch);
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from('progress_items')
    .update(row)
    .eq('id', assertId('updateProgressItem', id));
  raise('update progress item', error);
}

export async function deleteProgressItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('progress_items').delete().in('id', ids);
  raise('delete progress items', error);
}

export async function bulkUpdateProgressItems(ids: string[], patch: Record<string, any>): Promise<number> {
  if (ids.length === 0) return 0;
  const row = toRowWith(ITEM_FIELDS, patch);
  if (Object.keys(row).length === 0) return 0;
  const { data, error } = await supabase
    .from('progress_items')
    .update(row)
    .in('id', ids)
    .select('id');
  raise('bulk update progress items', error);
  return data?.length ?? 0;
}

/**
 * Progress Tracking's Calculate, in the database.
 *
 * Works out each item's earned quantity from its rule of credit, the actual
 * for the current period, and the planned and forecast phasing across the
 * progress periods. Returns how many items actually moved.
 */
export async function calculateProgress(
  projectId: string,
  itemIds?: string[]
): Promise<number> {
  const { data, error } = await supabase.rpc('calculate_progress', {
    p_project_id: projectId,
    p_item_ids: itemIds && itemIds.length > 0 ? itemIds : null,
  });
  raise('calculate progress', error);
  return (data as number) ?? 0;
}
