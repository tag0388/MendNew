import { supabase, fromRows, toRow, raise } from './supabase';
import type { ProjectAttribute, ResourceRate, Vendor, Calendar } from '../types';

/**
 * Enterprise-level settings that apply across every project and module.
 *
 * The eight attribute sets stay as JSONB on the enterprise row: they are
 * admin-authored definitions edited as a whole in one screen, and the values
 * chosen against them are referenced by attribute id from JSONB maps on cost
 * codes, line items and so on.
 *
 * Vendors, resource rates and calendars are real tables -- they are entities
 * that other rows point at by id, and Firestore's whole-array rewrites made
 * concurrent edits lose data (see updateAttributeSet below).
 */
export type AttributeSet =
  | 'projectAttributes'
  | 'lineItemAttributes'
  | 'costCodeAttributes'
  | 'subcontractAttributes'
  | 'changeAttributes'
  | 'riskAttributes'
  | 'procurementAttributes'
  | 'progressAttributes';

const ATTRIBUTE_COLUMNS: Record<AttributeSet, string> = {
  projectAttributes: 'project_attributes',
  lineItemAttributes: 'line_item_attributes',
  costCodeAttributes: 'cost_code_attributes',
  subcontractAttributes: 'subcontract_attributes',
  changeAttributes: 'change_attributes',
  riskAttributes: 'risk_attributes',
  procurementAttributes: 'procurement_attributes',
  progressAttributes: 'progress_attributes',
};

/**
 * Replaces one attribute set.
 *
 * NOTE: this is still read-modify-write, as it was in Firestore -- the caller
 * hands over the whole array. Two admins editing the same attribute set at
 * once will have one edit silently overwritten. Acceptable while enterprise
 * settings are edited by one admin at a time; if that stops being true these
 * become a child table with per-row writes.
 */
export async function updateAttributeSet(
  enterpriseId: string,
  set: AttributeSet,
  attributes: ProjectAttribute[]
): Promise<void> {
  const { error } = await supabase
    .from('enterprises')
    .update({ [ATTRIBUTE_COLUMNS[set]]: attributes })
    .eq('id', enterpriseId);
  raise(`update ${set}`, error);
}

export async function updateEnterpriseProfile(
  enterpriseId: string,
  patch: { name?: string; logoUrl?: string | null; theme?: 'light' | 'dark' }
): Promise<void> {
  const { error } = await supabase.from('enterprises').update(toRow(patch)).eq('id', enterpriseId);
  raise('update enterprise', error);
}

/** Simple string lists: change types, risk types, categories, control accounts. */
export type EnterpriseList = 'changeTypes' | 'riskTypes' | 'categories' | 'controlAccounts' | 'orderNumbers';

export async function updateEnterpriseList(
  enterpriseId: string,
  list: EnterpriseList,
  values: string[]
): Promise<void> {
  const { error } = await supabase
    .from('enterprises')
    .update({ [list.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]: values })
    .eq('id', enterpriseId);
  raise(`update ${list}`, error);
}

// ---------------------------------------------------------------- vendors ----

export async function fetchVendors(enterpriseId: string): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .order('name');
  raise('load vendors', error);
  return fromRows<Vendor>(data);
}

export async function upsertVendor(
  enterpriseId: string,
  vendor: Partial<Vendor> & { name: string }
): Promise<void> {
  const payload = { ...toRow(vendor), enterprise_id: enterpriseId };
  const { error } = vendor.id
    ? await supabase.from('vendors').update(payload).eq('id', vendor.id)
    : await supabase.from('vendors').insert(payload);
  raise('save vendor', error);
}

export async function deleteVendors(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // Subcontracts and invoices reference vendors with ON DELETE RESTRICT, so a
  // vendor still in use is refused rather than silently orphaning its history.
  const { error } = await supabase.from('vendors').delete().in('id', ids);
  raise('delete vendors', error);
}

// --------------------------------------------------------- resource rates ----

export async function fetchResourceRates(enterpriseId: string): Promise<ResourceRate[]> {
  const { data, error } = await supabase
    .from('resource_rates')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .order('sort_order');
  raise('load resource rates', error);
  return fromRows<ResourceRate>(data);
}

export async function upsertResourceRate(
  enterpriseId: string,
  rate: Partial<ResourceRate> & { name: string; unit: string }
): Promise<void> {
  const payload = { ...toRow(rate), enterprise_id: enterpriseId };
  const { error } = rate.id
    ? await supabase.from('resource_rates').update(payload).eq('id', rate.id)
    : await supabase.from('resource_rates').insert(payload);
  raise('save resource rate', error);
}

export async function deleteResourceRates(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('resource_rates').delete().in('id', ids);
  raise('delete resource rates', error);
}

/** Bulk import from a spreadsheet: one round trip instead of N. */
export async function importResourceRates(
  enterpriseId: string,
  rates: Array<Partial<ResourceRate> & { name: string; unit: string }>
): Promise<void> {
  if (rates.length === 0) return;
  const { error } = await supabase
    .from('resource_rates')
    .insert(rates.map((r) => ({ ...toRow(r), enterprise_id: enterpriseId })));
  raise('import resource rates', error);
}

// -------------------------------------------------------------- calendars ----

export async function fetchEnterpriseCalendars(enterpriseId: string): Promise<Calendar[]> {
  const { data, error } = await supabase
    .from('calendars')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .order('name');
  raise('load calendars', error);
  return fromRows<Calendar>(data);
}

export async function upsertEnterpriseCalendar(
  enterpriseId: string,
  calendar: Partial<Calendar> & { name: string }
): Promise<void> {
  const payload = {
    ...toRow({ name: calendar.name, weekends: calendar.weekends, holidays: calendar.holidays }),
    enterprise_id: enterpriseId,
  };
  const { error } = calendar.id
    ? await supabase.from('calendars').update(payload).eq('id', calendar.id)
    : await supabase.from('calendars').insert(payload);
  raise('save calendar', error);
}

export async function deleteCalendar(id: string): Promise<void> {
  const { error } = await supabase.from('calendars').delete().eq('id', id);
  raise('delete calendar', error);
}

// ------------------------------------------- standard procurement steps ----

export interface EnterpriseProcurementStep {
  id: string;
  name: string;
  stepOrder: number;
  defaultDurationDays: number | null;
}

export async function fetchEnterpriseProcurementSteps(
  enterpriseId: string
): Promise<EnterpriseProcurementStep[]> {
  const { data, error } = await supabase
    .from('procurement_step_definitions')
    .select('id, name, step_order, default_duration_days')
    .eq('enterprise_id', enterpriseId)
    .order('step_order');
  raise('load procurement steps', error);
  return fromRows<EnterpriseProcurementStep>(data);
}

export async function upsertEnterpriseProcurementStep(
  enterpriseId: string,
  step: Partial<EnterpriseProcurementStep> & { name: string }
): Promise<void> {
  const payload = {
    ...toRow({
      name: step.name,
      stepOrder: step.stepOrder ?? 0,
      defaultDurationDays: step.defaultDurationDays ?? null,
    }),
    enterprise_id: enterpriseId,
    is_enterprise_standard: true,
  };
  const { error } = step.id
    ? await supabase.from('procurement_step_definitions').update(payload).eq('id', step.id)
    : await supabase.from('procurement_step_definitions').insert(payload);
  raise('save procurement step', error);
}

export async function deleteEnterpriseProcurementStep(id: string): Promise<void> {
  const { error } = await supabase.from('procurement_step_definitions').delete().eq('id', id);
  raise('delete procurement step', error);
}
