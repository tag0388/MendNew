import { supabase, fromRow, fromRows, toRow, raise } from './supabase';
import type { Project } from '../types';
import type { ProjectRole } from './session';

export async function fetchProject(projectId: string): Promise<Project | null> {
  const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();
  raise('load project', error);
  return fromRow<Project>(data);
}

export async function createProject(
  enterpriseId: string,
  input: { projectName: string; projectCode: string; attributes?: Record<string, string> }
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      enterprise_id: enterpriseId,
      project_name: input.projectName,
      project_code: input.projectCode,
      attributes: input.attributes ?? {},
      status: 'Active',
    })
    .select()
    .single();
  // (project_code) is unique per enterprise, so a duplicate is refused here
  // rather than creating a second project with the same code.
  raise('create project', error);

  // The creator is made Project Admin by a database trigger, so the client
  // cannot forget to do it (or claim a role it should not have).
  return fromRow<Project>(data) as Project;
}

export async function updateProject(projectId: string, patch: Partial<Project>): Promise<void> {
  const { error } = await supabase.from('projects').update(toRow(patch)).eq('id', projectId);
  raise('update project', error);
}

export async function deleteProjects(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) return;
  // Cost codes, ETC details, subcontracts, changes, risks and progress all
  // cascade from the project, so this is one statement rather than the manual
  // multi-collection sweep Firestore needed.
  const { error } = await supabase.from('projects').delete().in('id', projectIds);
  raise('delete projects', error);
}

// -------------------------------------------------------- project members ----

export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string | null;
  role: ProjectRole;
}

export async function fetchProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase
    .from('project_members')
    .select('user_id, role, user_profiles(email, display_name)')
    .eq('project_id', projectId);
  raise('load project members', error);

  return (data ?? []).map((row: any) => ({
    userId: row.user_id,
    email: row.user_profiles?.email ?? '',
    displayName: row.user_profiles?.display_name ?? null,
    role: row.role as ProjectRole,
  }));
}

/**
 * Assigns an enterprise user to a project.
 *
 * enterpriseId is required because project_members carries it as part of the
 * composite foreign keys that enforce "assigned from the list of Enterprise
 * users": the pair must match an existing enterprise_members row, so assigning
 * someone who is not in the enterprise is rejected by the database.
 */
export async function assignProjectMember(
  projectId: string,
  enterpriseId: string,
  userId: string,
  role: ProjectRole
): Promise<void> {
  const { error } = await supabase
    .from('project_members')
    .upsert(
      { project_id: projectId, enterprise_id: enterpriseId, user_id: userId, role },
      { onConflict: 'project_id,user_id' }
    );
  raise('assign project member', error);
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  // cost_code_users cascades from project_members, so unassigning someone from
  // the project also drops their cost code assignments.
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  raise('remove project member', error);
}

// ------------------------------------------------------ cost code access ----

export async function fetchCostCodeUsers(costCodeId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('cost_code_users')
    .select('user_id')
    .eq('cost_code_id', costCodeId);
  raise('load cost code users', error);
  return (data ?? []).map((r: any) => r.user_id);
}

/** The user must already be a project member; the FK enforces it. */
export async function assignCostCodeUser(
  costCodeId: string,
  projectId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('cost_code_users')
    .upsert(
      { cost_code_id: costCodeId, project_id: projectId, user_id: userId },
      { onConflict: 'cost_code_id,user_id' }
    );
  raise('assign cost code user', error);
}

export async function removeCostCodeUser(costCodeId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('cost_code_users')
    .delete()
    .eq('cost_code_id', costCodeId)
    .eq('user_id', userId);
  raise('remove cost code user', error);
}

// ------------------------------------------------------ project settings ----

export type ProjectAttributeSet =
  | 'costCodeAttributes'
  | 'subcontractAttributes'
  | 'changeAttributes'
  | 'riskAttributes'
  | 'procurementAttributes'
  | 'progressAttributes'
  | 'lineItemAttributes';

export async function updateProjectAttributeSet(
  projectId: string,
  set: ProjectAttributeSet,
  attributes: unknown[]
): Promise<void> {
  const column = set.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const { error } = await supabase.from('projects').update({ [column]: attributes }).eq('id', projectId);
  raise(`update project ${set}`, error);
}

export async function fetchProjectCalendars(projectId: string) {
  const { data, error } = await supabase
    .from('calendars')
    .select('*')
    .eq('project_id', projectId)
    .order('name');
  raise('load project calendars', error);
  return fromRows(data);
}
