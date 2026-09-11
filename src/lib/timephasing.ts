import { supabase, fromRows, raise, assertId } from './supabase';

/**
 * The project timephasing grid.
 *
 * Three or four rows per cost code -- baseline, approved, EAC, and an EAC
 * Previous comparison line where one was stored -- each with a value per cost
 * period.
 *
 * Those values used to be assembled in the browser: it loaded every cost
 * phasing row, every actual cost transaction, every ETC detail line and every
 * subcontract in the project, then cross-aggregated them per cost code per
 * period in JavaScript. At this app's scale (see ARCHITECTURE.md) that is not
 * slow, it is impossible. project_timephasing does the same work in SQL and
 * returns the finished rows.
 */

export interface TimephasingRow {
  costCodeId: string;
  projectId: string;
  costCode: string;
  costCodeName: string;
  type: string;
  rowType: 'baseline' | 'approved' | 'eac' | 'eacPrevious';
  phasingId: string | null;
  phasingSource: string;
  startDate: string | null;
  endDate: string | null;
  distribution: string;
  activityId: string | null;
  totalFromCode: number;
  periodValues: Record<string, number>;
}

export async function fetchTimephasing(
  projectId: string,
  costCodeIds?: string[]
): Promise<TimephasingRow[]> {
  let q = supabase.from('project_timephasing').select('*').eq('project_id', projectId);
  // A project user sees only their assigned cost codes; RLS enforces that, but
  // narrowing here keeps the grid to the codes it means to show.
  if (costCodeIds && costCodeIds.length > 0) q = q.in('cost_code_id', costCodeIds);
  const { data, error } = await q.order('cost_code');
  raise('load timephasing', error);
  return fromRows<TimephasingRow>(data);
}

/**
 * Create or update one cost code's phasing row of a given type.
 *
 * (cost_code_id, type) is unique, so this is an upsert rather than the
 * browser having to know whether a row already exists.
 */
export async function saveCostPhasing(
  projectId: string,
  costCodeId: string,
  type: string,
  patch: {
    phasingSource?: string;
    startDate?: string | null;
    endDate?: string | null;
    distribution?: string | null;
    activityId?: string | null;
    periodValues?: Record<string, number>;
  }
): Promise<void> {
  const row: Record<string, any> = {
    project_id: projectId,
    cost_code_id: assertId('saveCostPhasing', costCodeId),
    type,
  };
  if (patch.phasingSource !== undefined) row.phasing_source = patch.phasingSource;
  if (patch.startDate !== undefined) row.start_date = patch.startDate || null;
  if (patch.endDate !== undefined) row.end_date = patch.endDate || null;
  if (patch.distribution !== undefined) row.distribution = patch.distribution || null;
  if (patch.activityId !== undefined) row.activity_id = patch.activityId || null;
  if (patch.periodValues !== undefined) row.period_values = patch.periodValues;

  const { error } = await supabase
    .from('cost_phasing')
    .upsert(row, { onConflict: 'cost_code_id,type' });
  raise('save phasing', error);
}

/** The same patch across many phasing rows, in one round trip. */
export async function bulkSaveCostPhasing(
  projectId: string,
  targets: Array<{ costCodeId: string; type: string }>,
  patch: {
    phasingSource?: string;
    startDate?: string | null;
    endDate?: string | null;
    distribution?: string | null;
  }
): Promise<number> {
  if (targets.length === 0) return 0;
  const rows = targets.map((t) => {
    const row: Record<string, any> = {
      project_id: projectId,
      cost_code_id: assertId('bulkSaveCostPhasing', t.costCodeId),
      type: t.type,
    };
    if (patch.phasingSource) row.phasing_source = patch.phasingSource;
    if (patch.startDate) row.start_date = patch.startDate;
    if (patch.endDate) row.end_date = patch.endDate;
    if (patch.distribution) row.distribution = patch.distribution;
    return row;
  });
  const { data, error } = await supabase
    .from('cost_phasing')
    .upsert(rows, { onConflict: 'cost_code_id,type' })
    .select('id');
  raise('bulk save phasing', error);
  return data?.length ?? 0;
}

/**
 * Upsert many phasing rows, each with its own period map.
 *
 * The bulk dialog applies one patch to many rows; an imported sheet gives each
 * row different numbers. Both are one statement -- (cost_code_id, type) is
 * unique, so the rows go in together whether or not they already exist.
 */
export async function upsertCostPhasingRows(
  projectId: string,
  rows: Array<{
    costCodeId: string;
    type: string;
    periodValues?: Record<string, number>;
    phasingSource?: string;
    startDate?: string | null;
    endDate?: string | null;
    distribution?: string | null;
  }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = rows.map((r) => {
    const row: Record<string, any> = {
      project_id: projectId,
      cost_code_id: assertId('upsertCostPhasingRows', r.costCodeId),
      type: r.type,
    };
    if (r.periodValues !== undefined) row.period_values = r.periodValues;
    if (r.phasingSource !== undefined) row.phasing_source = r.phasingSource;
    if (r.startDate !== undefined) row.start_date = r.startDate || null;
    if (r.endDate !== undefined) row.end_date = r.endDate || null;
    if (r.distribution !== undefined) row.distribution = r.distribution || null;
    return row;
  });
  const { data, error } = await supabase
    .from('cost_phasing')
    .upsert(payload, { onConflict: 'cost_code_id,type' })
    .select('id');
  raise('save phasing', error);
  return data?.length ?? 0;
}

/**
 * Recalculate auto-phasing for the project's cost phasing rows, in the
 * database. Narrow it by phasing row id, or by cost code (which is how the
 * cost code's own Timephasing tab uses it), or neither for every row set to
 * Auto in the project.
 */
export async function applyCostPhasing(
  projectId: string,
  phasingIds?: string[],
  costCodeIds?: string[]
): Promise<number> {
  const { data, error } = await supabase.rpc('apply_cost_phasing', {
    p_project_id: projectId,
    p_phasing_ids: phasingIds && phasingIds.length > 0 ? phasingIds : null,
    p_cost_code_ids: costCodeIds && costCodeIds.length > 0 ? costCodeIds : null,
  });
  raise('calculate phasing', error);
  return (data as number) ?? 0;
}
