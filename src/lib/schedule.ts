import { supabase, fromRows, raise, assertId } from './supabase';
import type { ScheduleItem } from '../types';

/**
 * The project's master schedule.
 *
 * Activities are referenced by their user-facing Activity ID from the cost,
 * ETC, subcontract and progress modules, so (project_id, activity_id) is
 * unique and imports upsert on it.
 */

export async function fetchScheduleItems(projectId: string): Promise<ScheduleItem[]> {
  const { data, error } = await supabase
    .from('schedule_items')
    .select('*')
    .eq('project_id', projectId)
    .order('activity_id');
  raise('load schedule', error);
  return fromRows<ScheduleItem>(data);
}

export async function createScheduleItem(
  projectId: string,
  input: Partial<ScheduleItem> & { activityId: string }
): Promise<ScheduleItem> {
  const { data, error } = await supabase
    .from('schedule_items')
    .insert({ ...toScheduleRow(input), project_id: projectId })
    .select()
    .single();
  // (project_id, activity_id) is unique, so a duplicate activity number is
  // refused here rather than creating a second activity with the same id.
  raise('add activity', error);
  return data as any;
}

export async function updateScheduleItem(id: string, patch: Partial<ScheduleItem>): Promise<void> {
  const { error } = await supabase
    .from('schedule_items')
    .update(toScheduleRow(patch))
    .eq('id', assertId('updateScheduleItem', id));
  raise('update activity', error);
}

export async function deleteScheduleItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('schedule_items').delete().in('id', ids);
  raise('delete activities', error);
}

/** One patch across many activities, in one statement. */
export async function bulkUpdateScheduleItems(
  ids: string[],
  patch: Partial<ScheduleItem>
): Promise<number> {
  if (ids.length === 0) return 0;
  const row = toScheduleRow(patch);
  if (Object.keys(row).length === 0) return 0;
  const { data, error } = await supabase
    .from('schedule_items')
    .update(row)
    .in('id', ids)
    .select('id');
  raise('bulk update activities', error);
  return data?.length ?? 0;
}

/**
 * Import activities from a sheet, in one statement.
 *
 * Upsert on (project_id, activity_id): a row whose Activity ID is already in
 * the project updates that activity rather than being skipped as a duplicate,
 * so re-importing a corrected schedule works.
 */
export async function importScheduleItems(
  projectId: string,
  rows: Array<Partial<ScheduleItem> & { activityId: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('schedule_items')
    .upsert(
      rows.map((r) => ({ ...toScheduleRow(r), project_id: projectId })),
      { onConflict: 'project_id,activity_id' }
    )
    .select('id');
  raise('import schedule', error);
  return data?.length ?? 0;
}

/**
 * Push the schedule's dates out to everything referencing an activity.
 *
 * Four UPDATE ... FROM statements in the database. This used to read every
 * progress item, ETC detail line, cost code and subcontract in the project
 * into the browser to compare dates one at a time.
 */
export async function syncScheduleDates(projectId: string): Promise<number> {
  const { data, error } = await supabase.rpc('sync_schedule_dates', {
    p_project_id: projectId,
  });
  raise('synchronise dates', error);
  return (data as number) ?? 0;
}

/**
 * A date column is a DATE, so an empty cell is NULL rather than ''. The grid
 * hands back '' when a date is cleared, which Postgres refuses for a date.
 */
const DATE_FIELDS = new Set([
  'baselineStartDate', 'baselineEndDate',
  'plannedStartDate', 'plannedEndDate',
  'currentStartDate', 'currentEndDate',
]);

function toScheduleRow(patch: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key in patch) {
    if (patch[key] === undefined) continue;
    if (key === 'id' || key === 'projectId' || key === 'createdAt' || key === 'updatedAt') continue;
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    out[snake] = DATE_FIELDS.has(key) ? (patch[key] || null) : patch[key];
  }
  return out;
}
