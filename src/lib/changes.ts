import { supabase, fromRow, fromRows, toRow, raise, assertId } from './supabase';
import type { Change, ChangeRecord } from '../types';

/**
 * Changes and their per-cost-code records.
 *
 * A change is the commercial event ("VO-014, client-instructed"); its records
 * are the amounts it puts against individual cost codes. Only changes that are
 * Approved or Pending reach a cost code's figures -- recalculate_project_costs
 * applies that rule, not this file.
 *
 * Every write here is one statement. See ARCHITECTURE.md: a project may carry
 * thousands of cost codes and changes are imported from spreadsheets, so
 * nothing may become a loop of round trips.
 */

export async function fetchChanges(projectId: string): Promise<Change[]> {
  const { data, error } = await supabase
    .from('changes')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at');
  raise('load changes', error);
  return fromRows<Change>(data);
}

export async function createChange(
  projectId: string,
  input: Partial<Change> & { changeId: string }
): Promise<Change> {
  const { data, error } = await supabase
    .from('changes')
    .insert({ ...toRow(input), project_id: projectId })
    .select()
    .single();
  // (project_id, change_id) is unique, so a duplicate reference is refused
  // here rather than creating a second change with the same number.
  raise('create change', error);
  return fromRow<Change>(data)!;
}

export async function updateChange(id: string, patch: Partial<Change>): Promise<void> {
  const { error } = await supabase.from('changes').update(toRow(patch)).eq('id', id);
  raise('update change', error);
}

/**
 * Deleting a change removes its records too, by cascade.
 *
 * The browser used to delete the records itself in a batch and then the
 * change; if that batch half-committed the records were orphaned against a
 * change that no longer existed.
 */
export async function deleteChanges(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('changes').delete().in('id', ids);
  raise('delete changes', error);
}

export async function importChanges(
  projectId: string,
  rows: Array<Partial<Change> & { changeId: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('changes')
    .upsert(rows.map((r) => ({ ...toRow(r), project_id: projectId })), {
      onConflict: 'project_id,change_id',
    })
    .select('id');
  raise('import changes', error);
  return data?.length ?? 0;
}

// ------------------------------------------------------- change records ----

export async function fetchChangeRecords(
  projectId: string,
  opts?: { changeId?: string; costCodeId?: string }
): Promise<ChangeRecord[]> {
  let q = supabase.from('change_records').select('*').eq('project_id', projectId);
  if (opts?.changeId) q = q.eq('change_id', assertId('fetchChangeRecords(changeId)', opts.changeId));
  if (opts?.costCodeId) q = q.eq('cost_code_id', assertId('fetchChangeRecords(costCodeId)', opts.costCodeId));
  const { data, error } = await q.order('created_at');
  raise('load change records', error);
  return fromRows<ChangeRecord>(data);
}

/** Records with their change's reference and status, for the bulk grid. */
export async function fetchChangeRecordsWithChange(projectId: string): Promise<ChangeRecord[]> {
  const { data, error } = await supabase
    .from('change_records')
    .select('*, changes(change_id, description, status)')
    .eq('project_id', projectId);
  raise('load change records', error);
  return (data ?? []).map((row: any) => {
    const { changes, ...rest } = row;
    return {
      ...fromRow<ChangeRecord>(rest)!,
      changeIdStr: changes?.change_id ?? '',
      changeDescription: changes?.description ?? '',
      changeStatus: changes?.status ?? '',
    } as ChangeRecord;
  });
}

export async function upsertChangeRecords(
  projectId: string,
  rows: Array<Partial<ChangeRecord> & { changeId: string; costCodeId: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('change_records')
    .upsert(rows.map((r) => ({ ...toRow(r), project_id: projectId })))
    .select('id');
  raise('save change records', error);
  return data?.length ?? 0;
}

export async function updateChangeRecord(id: string, patch: Partial<ChangeRecord>): Promise<void> {
  const { error } = await supabase.from('change_records').update(toRow(patch)).eq('id', id);
  raise('update change record', error);
}

export async function deleteChangeRecords(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('change_records').delete().in('id', ids);
  raise('delete change records', error);
}

/**
 * Apply one patch across many change records.
 *
 * The attribute maps merge into the stored value rather than replacing it.
 * The affected changes' totals are re-derived by trigger.
 */
export async function bulkUpdateChangeRecords(
  ids: string[],
  patch: {
    costCodeId?: string;
    scope?: string;
    budgetAmount?: number;
    eacAmount?: number;
    enterpriseAttributes?: Record<string, string>;
    projectAttributes?: Record<string, string>;
  }
): Promise<number> {
  if (ids.length === 0) return 0;
  const nonEmpty = (m?: Record<string, unknown>) =>
    m && Object.keys(m).length > 0 ? m : null;
  const { data, error } = await supabase.rpc('bulk_update_change_records', {
    p_record_ids: ids,
    p_cost_code_id: patch.costCodeId || null,
    p_scope: patch.scope || null,
    p_budget_amount: patch.budgetAmount ?? null,
    p_eac_amount: patch.eacAmount ?? null,
    p_enterprise_attributes: nonEmpty(patch.enterpriseAttributes),
    p_project_attributes: nonEmpty(patch.projectAttributes),
  });
  raise('bulk update change records', error);
  return (data as number) ?? 0;
}
