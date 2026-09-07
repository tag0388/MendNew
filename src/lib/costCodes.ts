import { supabase, fromRows, toRow, raise } from './supabase';
import type { CostCode, EtcDetail } from '../types';

/**
 * Cost codes and the records that hang off them.
 *
 * RLS narrows every read here to the cost codes the caller may reach: a
 * project admin gets all of the project's, everyone else only those they are
 * assigned to. The components do not filter -- and must not, since a client
 * deciding its own visibility is what the Firestore version did.
 *
 * Note on identity: in Firestore `costCodeId` held either a cost code
 * document id OR the user-facing code string depending on which screen wrote
 * it, and readers queried both. Here it is always the uuid primary key.
 */

export async function fetchCostCodes(projectId: string): Promise<CostCode[]> {
  const { data, error } = await supabase
    .from('cost_codes')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order');
  raise('load cost codes', error);
  return fromRows<CostCode>(data);
}

export async function createCostCode(
  projectId: string,
  input: Partial<CostCode> & { code: string }
): Promise<CostCode> {
  const { data, error } = await supabase
    .from('cost_codes')
    .insert({ ...toRow(input), project_id: projectId })
    .select()
    .single();
  // (project_id, code) is unique, so a duplicate code is refused here rather
  // than creating a second cost code that reports under the same identity.
  raise('create cost code', error);
  return fromRows<CostCode>([data])[0];
}

export async function updateCostCode(id: string, patch: Partial<CostCode>): Promise<void> {
  const { error } = await supabase.from('cost_codes').update(toRow(patch)).eq('id', id);
  raise('update cost code', error);
}

/** Bulk field update across a selection, in one round trip per distinct patch. */
export async function updateCostCodes(ids: string[], patch: Partial<CostCode>): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('cost_codes').update(toRow(patch)).in('id', ids);
  raise('bulk update cost codes', error);
}

export async function deleteCostCodes(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // ETC details and cost phasing cascade. Change and risk records reference
  // cost codes with ON DELETE RESTRICT, so a cost code carrying approved
  // change is refused rather than silently dropping the change history.
  const { error } = await supabase.from('cost_codes').delete().in('id', ids);
  raise('delete cost codes', error);
}

export async function upsertCostCodes(
  projectId: string,
  rows: Array<Partial<CostCode> & { code: string }>
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('cost_codes')
    .upsert(rows.map((r) => ({ ...toRow(r), project_id: projectId })), { onConflict: 'project_id,code' });
  raise('import cost codes', error);
}

// ----------------------------------------------------------- ETC details ----

export async function fetchEtcDetails(projectId: string): Promise<EtcDetail[]> {
  const { data, error } = await supabase
    .from('etc_details')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order');
  raise('load ETC details', error);
  return fromRows<EtcDetail>(data);
}

export async function upsertEtcDetail(
  projectId: string,
  detail: Partial<EtcDetail> & { costCodeId: string; item: string }
): Promise<void> {
  const payload = { ...toRow(detail), project_id: projectId };
  const { error } = detail.id
    ? await supabase.from('etc_details').update(payload).eq('id', detail.id)
    : await supabase.from('etc_details').insert(payload);
  raise('save ETC detail', error);
}

export async function upsertEtcDetails(
  projectId: string,
  details: Array<Partial<EtcDetail> & { costCodeId: string }>
): Promise<void> {
  if (details.length === 0) return;
  const { error } = await supabase
    .from('etc_details')
    .upsert(details.map((d) => ({ ...toRow(d), project_id: projectId })));
  raise('save ETC details', error);
}

export async function deleteEtcDetails(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('etc_details').delete().in('id', ids);
  raise('delete ETC details', error);
}

// ---------------------------------------------------------- cost phasing ----

export type CostPhasingType = 'budget' | 'baseline' | 'approved' | 'eac' | 'eacPrevious';

export interface CostPhasingRow {
  id: string;
  costCodeId: string;
  type: CostPhasingType;
  periodValues: Record<string, number>;
}

export async function fetchCostPhasing(
  projectId: string,
  type?: CostPhasingType
): Promise<CostPhasingRow[]> {
  let q = supabase.from('cost_phasing').select('*').eq('project_id', projectId);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  raise('load cost phasing', error);
  return fromRows<CostPhasingRow>(data);
}

/**
 * One row per (cost code, type), enforced by a unique constraint -- so a cost
 * code cannot end up with two competing EAC curves, which the document model
 * allowed and which readers then resolved arbitrarily.
 */
export async function upsertCostPhasing(
  projectId: string,
  costCodeId: string,
  type: CostPhasingType,
  periodValues: Record<string, number>
): Promise<void> {
  const { error } = await supabase.from('cost_phasing').upsert(
    { project_id: projectId, cost_code_id: costCodeId, type, period_values: periodValues },
    { onConflict: 'cost_code_id,type' }
  );
  raise('save cost phasing', error);
}

export async function upsertCostPhasingMany(
  projectId: string,
  rows: Array<{ costCodeId: string; type: CostPhasingType; periodValues: Record<string, number> }>
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('cost_phasing').upsert(
    rows.map((r) => ({
      project_id: projectId,
      cost_code_id: r.costCodeId,
      type: r.type,
      period_values: r.periodValues,
    })),
    { onConflict: 'cost_code_id,type' }
  );
  raise('save cost phasing', error);
}

// -------------------------------------------- actual costs & baselines ----

export interface ActualCostRow {
  id: string;
  projectId: string;
  costCodeId: string;
  reportingPeriodId: string;
  cost: number;
  description?: string;
}

export async function fetchActualCosts(projectId: string): Promise<ActualCostRow[]> {
  const { data, error } = await supabase.from('actual_costs').select('*').eq('project_id', projectId);
  raise('load actual costs', error);
  return fromRows<ActualCostRow>(data);
}

export async function upsertActualCost(
  projectId: string,
  row: Partial<ActualCostRow> & { costCodeId: string; reportingPeriodId: string; cost: number }
): Promise<void> {
  const payload = { ...toRow(row), project_id: projectId };
  const { error } = row.id
    ? await supabase.from('actual_costs').update(payload).eq('id', row.id)
    : await supabase.from('actual_costs').insert(payload);
  raise('save actual cost', error);
}

export async function deleteActualCosts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('actual_costs').delete().in('id', ids);
  raise('delete actual costs', error);
}

export interface BaselineBudgetRow {
  id: string;
  projectId: string;
  costCodeId: string;
  reportingPeriodId: string;
  amount: number;
  description?: string;
}

export async function fetchBaselineBudgets(projectId: string): Promise<BaselineBudgetRow[]> {
  const { data, error } = await supabase.from('baseline_budgets').select('*').eq('project_id', projectId);
  raise('load baseline budgets', error);
  return fromRows<BaselineBudgetRow>(data);
}

export async function upsertBaselineBudget(
  projectId: string,
  row: Partial<BaselineBudgetRow> & { costCodeId: string; reportingPeriodId: string; amount: number }
): Promise<void> {
  const payload = { ...toRow(row), project_id: projectId };
  const { error } = row.id
    ? await supabase.from('baseline_budgets').update(payload).eq('id', row.id)
    : await supabase.from('baseline_budgets').insert(payload);
  raise('save baseline budget', error);
}

export async function deleteBaselineBudgets(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('baseline_budgets').delete().in('id', ids);
  raise('delete baseline budgets', error);
}

// -------------------------------------------------------- cost code users ----

export interface CostCodeAssignee {
  userId: string;
  email: string;
  displayName: string | null;
}

export async function fetchCostCodeAssignees(costCodeId: string): Promise<CostCodeAssignee[]> {
  const { data, error } = await supabase
    .from('cost_code_users')
    .select('user_id, user_profiles(email, display_name)')
    .eq('cost_code_id', costCodeId);
  raise('load cost code assignees', error);
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    email: r.user_profiles?.email ?? '',
    displayName: r.user_profiles?.display_name ?? null,
  }));
}
