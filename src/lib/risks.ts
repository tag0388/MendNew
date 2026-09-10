import { supabase, fromRow, fromRows, toRow, raise, assertId } from './supabase';
import type { Risk, RiskRecord } from '../types';

/**
 * Risks and the records that put an exposure against a cost code.
 *
 * A record's Beta PERT impact is a generated column and a risk's four totals
 * are re-derived by trigger, so neither this file nor the browser computes
 * them -- see migration 20260907000047. Every write here is one statement.
 */

export async function fetchRisks(projectId: string): Promise<Risk[]> {
  const { data, error } = await supabase
    .from('risks')
    .select('*')
    .eq('project_id', projectId)
    .order('risk_id');
  raise('load risks', error);
  return fromRows<Risk>(data);
}

export async function createRisk(
  projectId: string,
  input: Partial<Risk> & { riskId: string }
): Promise<Risk> {
  const { data, error } = await supabase
    .from('risks')
    .insert({ ...toRiskRow(input), project_id: projectId })
    .select()
    .single();
  // (project_id, risk_id) is unique, so a duplicate reference is refused here.
  raise('create risk', error);
  return fromRow<Risk>(data)!;
}

export async function updateRisk(id: string, patch: Partial<Risk>): Promise<void> {
  const row = toRiskRow(patch);
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('risks').update(row).eq('id', assertId('updateRisk', id));
  raise('update risk', error);
}

export async function deleteRisks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // Records cascade with their risk.
  const { error } = await supabase.from('risks').delete().in('id', ids);
  raise('delete risks', error);
}

/** One patch across many risks, in one statement. */
export async function bulkUpdateRisks(ids: string[], patch: Partial<Risk>): Promise<number> {
  if (ids.length === 0) return 0;
  const row = toRiskRow(patch);
  if (Object.keys(row).length === 0) return 0;
  const { data, error } = await supabase.from('risks').update(row).in('id', ids).select('id');
  raise('bulk update risks', error);
  return data?.length ?? 0;
}

export async function importRisks(
  projectId: string,
  rows: Array<Partial<Risk> & { riskId: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('risks')
    .upsert(
      rows.map((r) => ({ ...toRiskRow(r), project_id: projectId })),
      { onConflict: 'project_id,risk_id' }
    )
    .select('id');
  raise('import risks', error);
  return data?.length ?? 0;
}

// ---------------------------------------------------------------- records ----

export async function fetchRiskRecords(
  projectId: string,
  opts?: { riskId?: string }
): Promise<RiskRecord[]> {
  let q = supabase.from('risk_records').select('*').eq('project_id', projectId);
  if (opts?.riskId) q = q.eq('risk_id', assertId('fetchRiskRecords(riskId)', opts.riskId));
  const { data, error } = await q.order('created_at');
  raise('load risk records', error);
  return fromRows<RiskRecord>(data);
}

/** Records with their risk's reference, for the bulk grid. */
export async function fetchRiskRecordsWithRisk(projectId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('risk_records')
    .select('*, risks(risk_id, description, status)')
    .eq('project_id', projectId);
  raise('load risk records', error);
  return (data ?? []).map((row: any) => {
    const { risks, ...rest } = row;
    return {
      ...fromRow<RiskRecord>(rest)!,
      riskIdStr: risks?.risk_id ?? '',
      riskDescription: risks?.description ?? '',
      riskStatus: risks?.status ?? '',
    };
  });
}

export async function upsertRiskRecords(
  projectId: string,
  rows: Array<Partial<RiskRecord> & { riskId: string; costCodeId: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('risk_records')
    .upsert(rows.map((r) => ({ ...toRecordRow(r), project_id: projectId })))
    .select('id');
  raise('save risk records', error);
  return data?.length ?? 0;
}

export async function updateRiskRecord(id: string, patch: Partial<RiskRecord>): Promise<void> {
  const row = toRecordRow(patch);
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from('risk_records')
    .update(row)
    .eq('id', assertId('updateRiskRecord', id));
  raise('update risk record', error);
}

export async function deleteRiskRecords(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('risk_records').delete().in('id', ids);
  raise('delete risk records', error);
}

/** One patch across many records, in one statement. */
export async function bulkUpdateRiskRecords(
  ids: string[],
  patch: Partial<RiskRecord>
): Promise<number> {
  if (ids.length === 0) return 0;
  const row = toRecordRow(patch);
  if (Object.keys(row).length === 0) return 0;
  const { data, error } = await supabase
    .from('risk_records')
    .update(row)
    .in('id', ids)
    .select('id');
  raise('bulk update risk records', error);
  return data?.length ?? 0;
}

// ------------------------------------------------------------------------ --
// betaPertImpactAmount is generated by the database and refused on write, and
// the risk's four totals are derived by trigger, so all five are stripped here
// rather than every caller having to remember.

function toRiskRow(patch: Record<string, any>): Record<string, any> {
  const {
    exposure, minImpactTotal, mostLikelyImpactTotal, maxImpactTotal,
    riskIdStr, riskDescription, riskStatus, ...rest
  } = patch;
  return toRow(rest);
}

function toRecordRow(patch: Record<string, any>): Record<string, any> {
  const { betaPertImpactAmount, riskIdStr, riskDescription, riskStatus, ...rest } = patch;
  return toRow(rest);
}

/**
 * Split an AG Grid field name into a column patch or an attribute merge.
 *
 * The grids name their attribute columns with Firestore's dotted path --
 * "enterpriseAttributes.<id>". A jsonb column has no such path, so an edit to
 * one is routed to a merge function rather than sent as a column that does not
 * exist.
 */
function splitCellEdit(field: string, value: any) {
  const dot = field.indexOf('.');
  if (dot === -1) return { column: { [field]: value } as Record<string, any> };
  const map = field.slice(0, dot);
  const key = field.slice(dot + 1);
  const entry = { [key]: value ?? '' };
  if (map === 'enterpriseAttributes') return { attributes: { enterpriseAttributes: entry } };
  if (map === 'projectAttributes') return { attributes: { projectAttributes: entry } };
  return { column: { [field]: value } as Record<string, any> };
}

async function mergeAttributes(
  fn: 'merge_risk_attributes' | 'merge_risk_record_attributes',
  idsParam: 'p_risk_ids' | 'p_record_ids',
  ids: string[],
  patch: { enterpriseAttributes?: Record<string, any>; projectAttributes?: Record<string, any> }
): Promise<void> {
  const nonEmpty = (m?: Record<string, unknown>) => (m && Object.keys(m).length > 0 ? m : null);
  const { error } = await supabase.rpc(fn, {
    [idsParam]: ids,
    p_enterprise_attributes: nonEmpty(patch.enterpriseAttributes),
    p_project_attributes: nonEmpty(patch.projectAttributes),
  } as any);
  raise('update attributes', error);
}

/** Merge attribute maps into many risk records at once. */
export async function mergeRiskRecordAttributes(
  ids: string[],
  patch: { enterpriseAttributes?: Record<string, any>; projectAttributes?: Record<string, any> }
): Promise<void> {
  if (ids.length === 0) return;
  await mergeAttributes('merge_risk_record_attributes', 'p_record_ids', ids, patch);
}

/** One cell edit on the risks grid. */
export async function applyRiskCellEdit(id: string, field: string, value: any): Promise<void> {
  const { column, attributes } = splitCellEdit(field, value);
  if (attributes) await mergeAttributes('merge_risk_attributes', 'p_risk_ids', [id], attributes);
  if (column) await updateRisk(id, column as Partial<Risk>);
}

/** One cell edit on either risk-records grid. */
export async function applyRiskRecordCellEdit(id: string, field: string, value: any): Promise<void> {
  const { column, attributes } = splitCellEdit(field, value);
  if (attributes) {
    await mergeAttributes('merge_risk_record_attributes', 'p_record_ids', [id], attributes);
  }
  if (column) await updateRiskRecord(id, column as Partial<RiskRecord>);
}
