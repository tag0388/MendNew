import { supabase, fromRows, toRow, raise } from './supabase';
import type { Calendar, ResourceRate } from '../types';

/**
 * Project-level standard settings: calendars and resource rates.
 *
 * These mirror the enterprise-level equivalents in enterpriseSettings.ts. A
 * project inherits the enterprise's library and can hold its own on top --
 * both appear in the ETC Details resource picker, which is why the two levels
 * are separate tables rather than one with a nullable owner.
 *
 * The project resource rates in particular used to live as an ARRAY on the
 * project row, rewritten in full on every add, delete and import. That is the
 * shape this codebase is moving away from: importing five thousand resources
 * meant writing one row containing five thousand entries, and two people
 * editing the library at once silently discarded one of them. They are rows
 * now, so an import inserts rows and a delete removes them.
 */

// -------------------------------------------------------- project calendars --

export async function fetchProjectCalendars(projectId: string): Promise<Calendar[]> {
  const { data, error } = await supabase
    .from('calendars')
    .select('*')
    .eq('project_id', projectId)
    .order('name');
  raise('load calendars', error);
  return fromRows<Calendar>(data);
}

export async function upsertProjectCalendar(
  projectId: string,
  calendar: Partial<Calendar> & { name: string }
): Promise<void> {
  const payload = {
    ...toRow({ name: calendar.name, weekends: calendar.weekends, holidays: calendar.holidays }),
    project_id: projectId,
  };
  const { error } = calendar.id
    ? await supabase.from('calendars').update(payload).eq('id', calendar.id)
    : await supabase.from('calendars').insert(payload);
  raise('save calendar', error);
}

export async function deleteProjectCalendar(id: string): Promise<void> {
  const { error } = await supabase.from('calendars').delete().eq('id', id);
  raise('delete calendar', error);
}

/**
 * Copy an enterprise calendar into a project.
 *
 * The project gets its own row rather than a reference: a project calendar is
 * a starting point people then adjust for site shutdowns and local holidays,
 * and a reference would make an enterprise-level edit silently reshape every
 * project's forecast.
 */
export async function copyEnterpriseCalendarToProject(
  projectId: string,
  calendar: Calendar
): Promise<void> {
  const { error } = await supabase.from('calendars').insert({
    project_id: projectId,
    name: calendar.name,
    weekends: calendar.weekends ?? [],
    holidays: calendar.holidays ?? [],
  });
  raise('copy calendar to project', error);
}

// --------------------------------------------------- project resource rates --

export async function fetchProjectResourceRates(projectId: string): Promise<ResourceRate[]> {
  const { data, error } = await supabase
    .from('project_resource_rates')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order')
    .order('name');
  raise('load project resource rates', error);
  return fromRows<ResourceRate>(data);
}

export async function upsertProjectResourceRate(
  projectId: string,
  rate: Partial<ResourceRate> & { name: string }
): Promise<void> {
  const payload = { ...toRow(rate), project_id: projectId };
  const { error } = rate.id
    ? await supabase.from('project_resource_rates').update(payload).eq('id', rate.id)
    : await supabase.from('project_resource_rates').insert(payload);
  raise('save project resource rate', error);
}

export async function deleteProjectResourceRates(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('project_resource_rates').delete().in('id', ids);
  raise('delete project resource rates', error);
}

/**
 * Bulk insert, for the Excel import.
 *
 * One statement for the whole sheet. See ARCHITECTURE.md: imports are expected
 * to run to thousands of rows, so this must never become a loop of inserts.
 */
export async function importProjectResourceRates(
  projectId: string,
  rates: Array<Partial<ResourceRate> & { name: string }>
): Promise<number> {
  if (rates.length === 0) return 0;
  const { data, error } = await supabase
    .from('project_resource_rates')
    .insert(rates.map((r) => ({ ...toRow(r), project_id: projectId })))
    .select('id');
  raise('import project resource rates', error);
  return data?.length ?? 0;
}
