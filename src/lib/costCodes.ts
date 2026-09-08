import { supabase, fromRow, fromRows, toRow, raise, assertId } from './supabase';
import type {
  CostCode, EtcDetail, ScheduleItem, Change, ChangeRecord, Subcontract,
  Calendar as ProjectCalendar,
} from '../types';

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

export async function fetchEtcDetails(
  projectId: string,
  costCodeId?: string
): Promise<EtcDetail[]> {
  let q = supabase.from('etc_details').select('*').eq('project_id', projectId);
  if (costCodeId) q = q.eq('cost_code_id', assertId('fetchEtcDetails(costCodeId)', costCodeId));
  // sort_order first, created_at to break ties. The old code sorted in memory
  // with `sortOrder ?? -1` because rows written before the column existed had
  // none; the column is NOT NULL with a default here.
  const { data, error } = await q
    .order('sort_order')
    .order('created_at');
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
  /** Where this curve comes from: Manual, Auto, ETC Details or SubContract.
   *  Not the same set as subcontract_line_items.phasing_source. */
  phasingSource?: 'Manual' | 'Auto' | 'ETC Details' | 'SubContract';
  /** The schedule activity this row is tied to, chosen per row. */
  activityId?: string | null;
  /** The inputs auto-phasing spreads the total across. */
  startDate?: string | null;
  endDate?: string | null;
  distribution?: string | null;
}

export async function fetchCostPhasing(
  projectId: string,
  type?: CostPhasingType,
  costCodeId?: string
): Promise<CostPhasingRow[]> {
  let q = supabase.from('cost_phasing').select('*').eq('project_id', projectId);
  if (type) q = q.eq('type', type);
  if (costCodeId) q = q.eq('cost_code_id', assertId('fetchCostPhasing(costCodeId)', costCodeId));
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
  periodValues: Record<string, number>,
  settings?: Pick<CostPhasingRow, 'phasingSource' | 'activityId' | 'startDate' | 'endDate' | 'distribution'>
): Promise<void> {
  const { error } = await supabase.from('cost_phasing').upsert(
    {
      project_id: projectId,
      cost_code_id: assertId('upsertCostPhasing(costCodeId)', costCodeId),
      type,
      period_values: periodValues,
      ...(settings ? toRow(settings) : {}),
    },
    { onConflict: 'cost_code_id,type' }
  );
  raise('save cost phasing', error);
}

export async function upsertCostPhasingMany(
  projectId: string,
  rows: Array<
    { costCodeId: string; type: CostPhasingType; periodValues: Record<string, number> } &
    Partial<Pick<CostPhasingRow, 'phasingSource' | 'activityId' | 'startDate' | 'endDate' | 'distribution'>>
  >
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('cost_phasing').upsert(
    rows.map(({ costCodeId, type, periodValues, ...settings }) => ({
      project_id: projectId,
      cost_code_id: costCodeId,
      type,
      period_values: periodValues,
      ...toRow(settings),
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

/**
 * Pass costCodeId to get one cost code's rows. The cost module used to fetch
 * every actual cost in the project and filter in the browser, which meant
 * downloading a whole project's ledger to show one code's -- and matching
 * costCodeId against both the id and the code string, because either could
 * have been stored.
 */
export async function fetchActualCosts(
  projectId: string,
  costCodeId?: string
): Promise<ActualCostRow[]> {
  let q = supabase.from('actual_costs').select('*').eq('project_id', projectId);
  if (costCodeId) q = q.eq('cost_code_id', assertId('fetchActualCosts(costCodeId)', costCodeId));
  const { data, error } = await q.order('created_at', { ascending: false });
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

export async function fetchBaselineBudgets(
  projectId: string,
  costCodeId?: string
): Promise<BaselineBudgetRow[]> {
  let q = supabase.from('baseline_budgets').select('*').eq('project_id', projectId);
  if (costCodeId) q = q.eq('cost_code_id', assertId('fetchBaselineBudgets(costCodeId)', costCodeId));
  const { data, error } = await q;
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

/** Bulk import of actual costs, in one insert rather than 400-row batches. */
export async function importActualCosts(
  projectId: string,
  rows: Array<Partial<ActualCostRow> & { costCodeId: string; reportingPeriodId: string }>
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('actual_costs')
    .insert(rows.map((r) => ({ ...toRow(r), project_id: projectId })));
  raise('import actual costs', error);
}

/** Bulk import of baseline budgets, in one insert. */
export async function importBaselineBudgets(
  projectId: string,
  rows: Array<Partial<BaselineBudgetRow> & { costCodeId: string; reportingPeriodId: string }>
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('baseline_budgets')
    .insert(rows.map((r) => ({ ...toRow(r), project_id: projectId })));
  raise('import baseline budgets', error);
}

/**
 * Recalculate a project's derived cost figures.
 *
 * The browser used to do this itself: download every actual cost, baseline
 * budget, ETC row, change, change record and subcontract in the project,
 * aggregate them in memory, then write eleven columns back onto every cost
 * code in batches of 450 -- one transaction per batch, so a large project
 * could half-succeed. It is one statement now, and returns how many cost
 * codes it actually wrote.
 *
 * Passing costCodeIds limits it to a selection; omit for the whole project.
 */
export async function recalculateProjectCosts(
  projectId: string,
  costCodeIds?: string[]
): Promise<number> {
  const { data, error } = await supabase.rpc('recalculate_project_costs', {
    p_project_id: projectId,
    p_cost_code_ids: costCodeIds && costCodeIds.length > 0 ? costCodeIds : null,
  });
  raise('recalculate costs', error);
  return (data as number) ?? 0;
}

/**
 * Schedule items for a project.
 *
 * Read-only from the cost module's point of view: cost codes carry an
 * activityId and the grid shows the matching activity's dates alongside.
 */
export async function fetchScheduleItems(projectId: string): Promise<ScheduleItem[]> {
  const { data, error } = await supabase
    .from('schedule_items')
    .select('*')
    .eq('project_id', projectId)
    .order('activity_id');
  raise('load schedule items', error);
  return fromRows<ScheduleItem>(data);
}

// ------------------------------------------------- project-wide lookups ----
// The cost module reads these to work out what a cost code's EAC should be.
// It does not write any of them -- each has its own module that owns it.

export async function fetchChanges(projectId: string): Promise<Change[]> {
  const { data, error } = await supabase
    .from('changes').select('*').eq('project_id', projectId);
  raise('load changes', error);
  return fromRows<Change>(data);
}

/** Pass costCodeId for one cost code's records; omit for the project's. */
export async function fetchChangeRecords(
  projectId: string,
  costCodeId?: string
): Promise<ChangeRecord[]> {
  let q = supabase.from('change_records').select('*').eq('project_id', projectId);
  if (costCodeId) q = q.eq('cost_code_id', assertId('fetchChangeRecords(costCodeId)', costCodeId));
  const { data, error } = await q;
  raise('load change records', error);
  return fromRows<ChangeRecord>(data);
}

/**
 * Subcontracts with their line items nested, in one round trip.
 *
 * The document model stored lineItems inside the subcontract, so readers got
 * them for free; they are a table here, and this join restores the shape the
 * grids expect rather than making every caller fetch twice.
 */
export async function fetchSubcontractsWithItems(projectId: string): Promise<Subcontract[]> {
  const { data, error } = await supabase
    .from('subcontracts')
    .select('*, subcontract_line_items(*)')
    .eq('project_id', projectId);
  raise('load subcontracts', error);
  return (data ?? []).map((row: any) => {
    const { subcontract_line_items, ...rest } = row;
    return {
      ...fromRow<Subcontract>(rest)!,
      lineItems: fromRows<any>(subcontract_line_items ?? []),
    } as Subcontract;
  });
}

export async function fetchRiskRecords(projectId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('risk_records').select('*').eq('project_id', projectId);
  raise('load risk records', error);
  return fromRows<any>(data);
}

export async function fetchCalendars(projectId: string): Promise<ProjectCalendar[]> {
  const { data, error } = await supabase
    .from('calendars').select('*').eq('project_id', projectId);
  raise('load calendars', error);
  return fromRows<ProjectCalendar>(data);
}

/**
 * Create a cost code, optionally at a position in the list.
 *
 * insertIndex shifts every cost code at or below that position down by one
 * and drops the new row into the gap; omit it to append. Both happen in one
 * database function so the list cannot end up with a gap and nothing in it.
 *
 * A duplicate code raises rather than returning: (project_id, code) is unique,
 * so the database refuses it even if two people submit the same code at once,
 * which a client-side "does this code already exist" check cannot.
 */
export async function insertCostCodeAt(
  projectId: string,
  input: {
    code: string;
    name: string;
    eacMethod?: CostCode['eacMethod'];
    enterpriseAttributes?: Record<string, string>;
    projectAttributes?: Record<string, string>;
  },
  insertIndex?: number
): Promise<CostCode> {
  const { data, error } = await supabase.rpc('insert_cost_code_at', {
    p_project_id: projectId,
    p_code: input.code,
    p_name: input.name ?? '',
    p_eac_method: input.eacMethod ?? 'Manual',
    p_enterprise_attributes: input.enterpriseAttributes ?? {},
    p_project_attributes: input.projectAttributes ?? {},
    p_insert_index: typeof insertIndex === 'number' ? insertIndex : null,
  });
  raise('create cost code', error);
  return fromRow<CostCode>(data)!;
}

/**
 * Apply one patch across many cost codes.
 *
 * The attribute maps merge into whatever is stored, rather than replacing it,
 * so setting one attribute across a selection does not wipe the others -- and
 * merges against the current row, not against a copy the browser loaded
 * earlier. Returns how many rows were actually written, which can be fewer
 * than asked for if RLS refuses some of them.
 */
export async function bulkUpdateCostCodes(
  ids: string[],
  patch: {
    eacMethod?: CostCode['eacMethod'];
    enterpriseAttributes?: Record<string, string>;
    projectAttributes?: Record<string, string>;
  }
): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc('bulk_update_cost_codes', {
    p_cost_code_ids: ids,
    p_eac_method: patch.eacMethod ?? null,
    p_enterprise_attributes: patch.enterpriseAttributes ?? null,
    p_project_attributes: patch.projectAttributes ?? null,
  });
  raise('bulk update cost codes', error);
  return (data as number) ?? 0;
}

/**
 * Add ETC detail rows to a cost code, optionally at a position.
 *
 * insertIndex shifts the rows at or below that position down to make room;
 * omit it to append. Both happen in one database function, so a partial
 * failure cannot leave a gap in the ordering with nothing in it.
 *
 * Fields left out of a row fall back to the column default, so a blank row is
 * `{}` rather than a dozen empty strings and zeros.
 */
export async function insertEtcDetailsAt(
  costCodeId: string,
  rows: Array<Record<string, unknown>>,
  insertIndex?: number
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase.rpc('insert_etc_details_at', {
    p_cost_code_id: assertId('insertEtcDetailsAt(costCodeId)', costCodeId),
    p_rows: rows,
    p_insert_index: typeof insertIndex === 'number' ? insertIndex : null,
  });
  raise('add ETC rows', error);
  return (data as number) ?? 0;
}

/**
 * Apply one patch across many ETC detail rows.
 *
 * The three attribute maps merge into the stored value rather than replacing
 * it. Category is skipped on rows seeded from a resource library, which take
 * their category from the library entry.
 */
export async function bulkUpdateEtcDetails(
  ids: string[],
  patch: {
    category?: string;
    calendarId?: string;
    phasingMethod?: string;
    phasingUnit?: string;
    enterpriseAttributes?: Record<string, string>;
    projectAttributes?: Record<string, string>;
    userDefined?: Record<string, string | number>;
  }
): Promise<number> {
  if (ids.length === 0) return 0;
  const nonEmpty = (m?: Record<string, unknown>) =>
    m && Object.keys(m).length > 0 ? m : null;
  const { data, error } = await supabase.rpc('bulk_update_etc_details', {
    p_etc_detail_ids: ids,
    p_category: patch.category || null,
    p_calendar_id: patch.calendarId || null,
    p_phasing_method: patch.phasingMethod || null,
    p_phasing_unit: patch.phasingUnit || null,
    p_enterprise_attributes: nonEmpty(patch.enterpriseAttributes),
    p_project_attributes: nonEmpty(patch.projectAttributes),
    p_user_defined: nonEmpty(patch.userDefined),
    p_skip_library_resources: true,
  });
  raise('bulk update ETC rows', error);
  return (data as number) ?? 0;
}

/** An ETC row with its cost code's user-facing code alongside. */
export type EtcDetailWithCode = EtcDetail & { costCode: string };

/**
 * Every ETC row in a project, each carrying its cost code's code string.
 *
 * The bulk grid shows and edits the code rather than the id, so the join
 * comes back with the row instead of the grid resolving ids against a
 * separately loaded list.
 *
 * Sorted here rather than in the query: the sort key is a column on the
 * JOINED table, and ordering a parent by an embedded column is exactly the
 * case PostgREST handles least predictably. One project's ETC rows is a small
 * enough set that sorting them locally is not the cost the old whole-project
 * downloads were.
 */
export async function fetchProjectEtcDetails(projectId: string): Promise<EtcDetailWithCode[]> {
  const { data, error } = await supabase
    .from('etc_details')
    .select('*, cost_codes(code)')
    .eq('project_id', projectId)
    .order('sort_order')
    .order('created_at');
  raise('load ETC details', error);

  const rows = (data ?? []).map((row: any) => {
    const { cost_codes, ...rest } = row;
    return { ...fromRow<EtcDetail>(rest)!, costCode: cost_codes?.code ?? '' } as EtcDetailWithCode;
  });

  return rows.sort((a, b) =>
    a.costCode !== b.costCode
      ? a.costCode.localeCompare(b.costCode)
      : (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
}
