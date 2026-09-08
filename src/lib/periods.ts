import { supabase, raise } from './supabase';
import type { Project } from '../types';

/**
 * Reporting periods.
 *
 * In Firestore these lived inside the project document as
 *   reportingPeriods: { baseDate, duration, numberOfPeriods, periods[], currentPeriodId }
 * and every time-phased record keyed its periodValues map by an id from that
 * array. Nothing stopped two periods sharing an id, and closing a period
 * rewrote the whole array.
 *
 * They are now rows in reporting_periods, with one `kind` discriminator for
 * cost and progress. The shape the components read is rebuilt here so their
 * contract is unchanged -- `project.reportingPeriods.periods` still works.
 */
export type PeriodKind = 'cost' | 'progress';

export interface PeriodRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed';
  sortOrder: number;
  isCurrent: boolean;
}

export interface PeriodBlock {
  baseDate: string;
  duration: 'week' | 'month';
  numberOfPeriods: number;
  periods: Array<{ id: string; startDate: string; endDate: string; name: string; status: 'open' | 'closed' }>;
  currentPeriodId?: string;
}

/** Attaches reportingPeriods / progressPeriods to projects loaded from SQL. */
export async function hydratePeriods(projects: Project[]): Promise<Project[]> {
  if (projects.length === 0) return projects;
  const ids = projects.map((p) => p.id);

  const [periodsRes, settingsRes] = await Promise.all([
    supabase
      .from('reporting_periods')
      .select('id, project_id, kind, name, start_date, end_date, status, sort_order, is_current')
      .in('project_id', ids)
      .order('sort_order'),
    supabase
      .from('reporting_period_settings')
      .select('project_id, kind, base_date, duration, number_of_periods')
      .in('project_id', ids),
  ]);
  raise('load reporting periods', periodsRes.error);
  raise('load period settings', settingsRes.error);

  const byProjectKind = new Map<string, PeriodBlock>();
  const keyOf = (projectId: string, kind: string) => `${projectId}:${kind}`;

  for (const s of (settingsRes.data ?? []) as any[]) {
    byProjectKind.set(keyOf(s.project_id, s.kind), {
      baseDate: s.base_date ?? '',
      duration: s.duration,
      numberOfPeriods: s.number_of_periods ?? 0,
      periods: [],
    });
  }

  for (const r of (periodsRes.data ?? []) as any[]) {
    const key = keyOf(r.project_id, r.kind);
    let block = byProjectKind.get(key);
    if (!block) {
      block = { baseDate: '', duration: r.kind === 'progress' ? 'week' : 'month', numberOfPeriods: 0, periods: [] };
      byProjectKind.set(key, block);
    }
    block.periods.push({
      id: r.id,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
    });
    if (r.is_current) block.currentPeriodId = r.id;
  }

  return projects.map((p) => ({
    ...p,
    reportingPeriods: byProjectKind.get(keyOf(p.id, 'cost')) as Project['reportingPeriods'],
    progressPeriods: byProjectKind.get(keyOf(p.id, 'progress')) as Project['progressPeriods'],
  }));
}

export async function fetchPeriods(projectId: string, kind: PeriodKind): Promise<PeriodRow[]> {
  const { data, error } = await supabase
    .from('reporting_periods')
    .select('id, name, start_date, end_date, status, sort_order, is_current')
    .eq('project_id', projectId)
    .eq('kind', kind)
    .order('sort_order');
  raise('load periods', error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    sortOrder: r.sort_order,
    isCurrent: r.is_current,
  }));
}

/**
 * Replaces the period calendar for a project.
 *
 * Existing period ids are preserved by name so that periodValues maps keyed by
 * those ids keep pointing at the right period -- regenerating the calendar
 * must not silently detach every time-phased figure in the project.
 */
export async function generatePeriods(
  projectId: string,
  kind: PeriodKind,
  settings: { baseDate: string; duration: 'week' | 'month'; numberOfPeriods: number },
  periods: Array<{ name: string; startDate: string; endDate: string }>
): Promise<void> {
  const existing = await fetchPeriods(projectId, kind);
  const idByName = new Map(existing.map((p) => [p.name, p.id]));

  const settingsRes = await supabase.from('reporting_period_settings').upsert(
    {
      project_id: projectId,
      kind,
      base_date: settings.baseDate || null,
      duration: settings.duration,
      number_of_periods: settings.numberOfPeriods,
    },
    { onConflict: 'project_id,kind' }
  );
  raise('save period settings', settingsRes.error);

  const rows = periods.map((p, i) => ({
    ...(idByName.has(p.name) ? { id: idByName.get(p.name) } : {}),
    project_id: projectId,
    kind,
    name: p.name,
    start_date: p.startDate,
    end_date: p.endDate,
    sort_order: i,
  }));

  const { error } = await supabase
    .from('reporting_periods')
    .upsert(rows, { onConflict: 'project_id,kind,name' });
  raise('save periods', error);

  // Periods dropped from the new calendar. Deleting one that actuals or
  // baselines still reference is refused (ON DELETE RESTRICT) rather than
  // orphaning those rows.
  const keptNames = new Set(periods.map((p) => p.name));
  const removed = existing.filter((p) => !keptNames.has(p.name));
  if (removed.length > 0) {
    const del = await supabase.from('reporting_periods').delete().in('id', removed.map((p) => p.id));
    raise('remove obsolete periods', del.error);
  }
}

/** Exactly one period per project and kind may be current; a partial unique index enforces it. */
export async function setCurrentPeriod(
  projectId: string,
  kind: PeriodKind,
  periodId: string
): Promise<void> {
  const clear = await supabase
    .from('reporting_periods')
    .update({ is_current: false })
    .eq('project_id', projectId)
    .eq('kind', kind)
    .eq('is_current', true);
  raise('clear current period', clear.error);

  const { error } = await supabase
    .from('reporting_periods')
    .update({ is_current: true })
    .eq('id', periodId);
  raise('set current period', error);
}

export async function closePeriod(periodId: string): Promise<void> {
  const { error } = await supabase
    .from('reporting_periods')
    .update({ status: 'closed', is_current: false })
    .eq('id', periodId);
  raise('close period', error);
}

export async function reopenPeriod(periodId: string): Promise<void> {
  const { error } = await supabase
    .from('reporting_periods')
    .update({ status: 'open' })
    .eq('id', periodId);
  raise('reopen period', error);
}

export interface ClosePeriodResult {
  closedPeriodId: string;
  closedPeriodName: string;
  nextPeriodId: string | null;
  nextPeriodName: string | null;
}

/**
 * Closes the earliest open cost period and rolls the project into the next.
 *
 * The client used to do this itself in Firestore batches committed in chunks
 * of 450, which were not atomic with each other -- a failure part-way left
 * cost codes rolled forward but ETC details not. It is one database function
 * now, so one transaction: it all lands or none of it does.
 */
export async function closeCostPeriod(projectId: string): Promise<ClosePeriodResult> {
  const { data, error } = await supabase.rpc('close_cost_period', { p_project_id: projectId });
  raise('close cost period', error);
  const row = (data as any[])?.[0];
  return {
    closedPeriodId: row?.closed_period_id,
    closedPeriodName: row?.closed_period_name,
    nextPeriodId: row?.next_period_id ?? null,
    nextPeriodName: row?.next_period_name ?? null,
  };
}

export async function deletePeriod(periodId: string): Promise<void> {
  // Refused if actuals or baselines still reference it (ON DELETE RESTRICT),
  // rather than orphaning those rows.
  const { error } = await supabase.from('reporting_periods').delete().eq('id', periodId);
  raise('delete period', error);
}

/**
 * Index of the current reporting period, or 0 when none is marked.
 *
 * Every "which periods are in the future?" calculation is `slice(index + 1)`.
 * Array.findIndex returns -1 when it finds nothing, and slice(-1 + 1) is
 * slice(0) -- the WHOLE list, first period included. So a project with no
 * current period silently treated every period as future, and auto-phasing
 * put forecast into the period that is actually being reported as actual
 * cost. That is what happened to a project generated Sep'26..Aug'27: phasing
 * over dates in Sep'26 landed in Sep'26.
 *
 * The database now guarantees a current period exists, so this should not
 * arise. It falls back to 0 rather than -1 anyway, because the two failures
 * are not equally bad: treating the first period as current at worst forecasts
 * one period later than intended, while -1 puts forecast money into a period
 * that is already being reported.
 */
export function resolveCurrentPeriodIndex(
  periods: Array<{ id: string }>,
  currentPeriodId: string | undefined | null
): number {
  const i = periods.findIndex((p) => p.id === currentPeriodId);
  return i === -1 ? 0 : i;
}
