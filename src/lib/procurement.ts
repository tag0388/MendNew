import { supabase, fromRows, raise, assertId } from './supabase';
import type { ProcurementStepDefinition } from '../types';

/**
 * Procurement step definitions.
 *
 * One table holds both the enterprise's standard steps and a project's own,
 * told apart by which of enterprise_id / project_id is set. A project step
 * derived from a standard keeps enterprise_step_id pointing at it.
 *
 * `order` in the app is `step_order` in the database -- "order" is a reserved
 * word in SQL -- so the mapping is explicit here rather than left to the
 * generic camelCase conversion.
 */

function fromStepRow(row: any): ProcurementStepDefinition {
  return {
    id: row.id,
    enterpriseId: row.enterprise_id ?? undefined,
    projectId: row.project_id ?? undefined,
    name: row.name,
    order: row.step_order ?? 0,
    isEnterpriseStandard: row.is_enterprise_standard ?? false,
    defaultDurationDays: row.default_duration_days ?? undefined,
    enterpriseStepId: row.enterprise_step_id ?? undefined,
  } as ProcurementStepDefinition;
}

function toStepRow(patch: Partial<ProcurementStepDefinition>): Record<string, any> {
  const out: Record<string, any> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.order !== undefined) out.step_order = Number(patch.order) || 0;
  if (patch.isEnterpriseStandard !== undefined) out.is_enterprise_standard = patch.isEnterpriseStandard;
  if (patch.defaultDurationDays !== undefined) {
    out.default_duration_days = Number(patch.defaultDurationDays) || 0;
  }
  // An empty string is not a uuid; a step derived from no standard is null.
  if (patch.enterpriseStepId !== undefined) out.enterprise_step_id = patch.enterpriseStepId || null;
  return out;
}

export async function fetchProjectSteps(projectId: string): Promise<ProcurementStepDefinition[]> {
  const { data, error } = await supabase
    .from('procurement_step_definitions')
    .select('*')
    .eq('project_id', projectId)
    .order('step_order');
  raise('load procurement steps', error);
  return (data ?? []).map(fromStepRow);
}

export async function fetchEnterpriseSteps(enterpriseId: string): Promise<ProcurementStepDefinition[]> {
  const { data, error } = await supabase
    .from('procurement_step_definitions')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .is('project_id', null)
    .order('step_order');
  raise('load procurement steps', error);
  return (data ?? []).map(fromStepRow);
}

export async function createProjectStep(
  projectId: string,
  step: Partial<ProcurementStepDefinition> & { name: string }
): Promise<void> {
  const { error } = await supabase
    .from('procurement_step_definitions')
    .insert({ ...toStepRow(step), project_id: projectId });
  raise('add procurement step', error);
}

export async function createEnterpriseStep(
  enterpriseId: string,
  step: Partial<ProcurementStepDefinition> & { name: string }
): Promise<void> {
  const { error } = await supabase
    .from('procurement_step_definitions')
    .insert({ ...toStepRow(step), enterprise_id: enterpriseId, is_enterprise_standard: true });
  raise('add procurement step', error);
}

export async function updateStep(
  id: string,
  patch: Partial<ProcurementStepDefinition>
): Promise<void> {
  const { error } = await supabase
    .from('procurement_step_definitions')
    .update(toStepRow(patch))
    .eq('id', assertId('updateStep', id));
  raise('update procurement step', error);
}

export async function deleteSteps(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('procurement_step_definitions').delete().in('id', ids);
  raise('delete procurement step', error);
}

/** The project's default calendar, step durations and attribute values. */
export async function saveProcurementDefaults(
  projectId: string,
  defaults: Record<string, any>
): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ procurement_defaults: defaults })
    .eq('id', projectId);
  raise('save procurement settings', error);
}
