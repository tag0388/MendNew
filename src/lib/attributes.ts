import { supabase, raise, assertId } from './supabase';
import type { ProjectAttribute } from '../types';

/**
 * Enterprise and project attributes.
 *
 * An attribute is one of ten numbered slots in a category. The numbers are
 * fixed and always exist -- the database makes them for every enterprise and
 * project -- so naming one is an edit, never a creation. What belongs to the
 * user is the title and the list of values a cell may hold.
 *
 * A value has a `code` the user types, unique within its own slot and nowhere
 * else, and a `description` that explains it. Rows store the code. The code
 * cannot be changed once a value exists (the editor locks that field), and a
 * code still held by any row cannot be deleted -- the database refuses it and
 * says how many rows depend on it.
 *
 * The shape crossing this boundary is the same `ProjectAttribute[]` the
 * screens have always used: `{ id, title, values: [{ id, description,
 * sortOrder }] }`, where a value's `id` is its code.
 */

/** The attribute families. One per module that carries attributes. */
export type AttributeCategory =
  | 'project'
  | 'cost_code'
  | 'line_item'
  | 'change'
  | 'risk'
  | 'subcontract'
  | 'procurement'
  | 'progress'
  | 'schedule';

/** What the screens call each family, mapped to what the database calls it. */
export const ATTRIBUTE_CATEGORY: Record<string, AttributeCategory> = {
  projectAttributes: 'project',
  costCodeAttributes: 'cost_code',
  lineItemAttributes: 'line_item',
  changeAttributes: 'change',
  riskAttributes: 'risk',
  subcontractAttributes: 'subcontract',
  procurementAttributes: 'procurement',
  progressAttributes: 'progress',
  scheduleAttributes: 'schedule',
};

/**
 * One category's ten slots.
 *
 * Pass a project to read that project's own attributes; pass null to read the
 * enterprise's. Both always return ten slots, most of them untitled.
 */
export async function fetchAttributeSet(
  enterpriseId: string,
  projectId: string | null,
  category: AttributeCategory
): Promise<ProjectAttribute[]> {
  assertId('enterprise', enterpriseId);
  const { data, error } = await supabase.rpc('attribute_set', {
    p_enterprise_id: enterpriseId,
    p_project_id: projectId || null,
    p_category: category,
  });
  raise('load attributes', error);
  return (data ?? []) as ProjectAttribute[];
}

/**
 * Write a whole set back.
 *
 * The database works out what moved rather than clearing and reloading, so a
 * value that has gone from the set is a real delete -- and is refused if rows
 * still hold its code. That refusal arrives as an error naming the count, and
 * is meant to be shown to the user rather than swallowed.
 */
export async function saveAttributeSet(
  enterpriseId: string,
  projectId: string | null,
  category: AttributeCategory,
  attributes: ProjectAttribute[]
): Promise<void> {
  assertId('enterprise', enterpriseId);
  const { error } = await supabase.rpc('save_attribute_set', {
    p_enterprise_id: enterpriseId,
    p_project_id: projectId || null,
    p_category: category,
    p_attributes: attributes,
  });
  raise('save attributes', error);
}

/**
 * How many rows hold a given code.
 *
 * The editor asks before offering to delete a value, so the user is told
 * beforehand rather than being refused afterwards.
 */
export async function attributeValueUsage(
  definitionId: string,
  code: string
): Promise<number> {
  const { data, error } = await supabase.rpc('attribute_usage_count', {
    p_definition_id: definitionId,
    p_code: code,
  });
  raise('count attribute usage', error);
  return Number(data ?? 0);
}

/**
 * The columns a row carries its attribute codes in.
 *
 * Slot '03' at enterprise level is `ent_attr_03`; at project level
 * `prj_attr_03`. Grids and imports use this to bind a column to a slot.
 */
export function attributeColumn(
  level: 'enterprise' | 'project',
  attributeNumber: string
): string {
  return `${level === 'enterprise' ? 'ent' : 'prj'}_attr_${attributeNumber}`;
}

/** The same, in the camelCase the rows arrive as. */
export function attributeField(
  level: 'enterprise' | 'project',
  attributeNumber: string
): string {
  return `${level === 'enterprise' ? 'ent' : 'prj'}Attr${attributeNumber}`;
}
