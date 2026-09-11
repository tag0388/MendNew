import { supabase, fromRows, raise, assertId } from './supabase';

/**
 * Rules of credit and their weighted steps.
 *
 * Firestore kept the steps as an array inside the rule document, so adding one
 * step meant rewriting every step of that rule. They are rows here
 * (rule_of_credit_steps), and each write touches only the steps it means to.
 * The rules are still returned with their steps attached, because that is the
 * shape both grids draw.
 */

export interface RuleOfCreditStep {
  id: string;
  ruleOfCreditId?: string;
  orderNo: number;
  description: string;
  weight: number;
}

export interface RuleOfCredit {
  id: string;
  projectId: string;
  ruleId: string;
  description: string;
  userField1?: string;
  userField2?: string;
  userField3?: string;
  userField4?: string;
  userField5?: string;
  steps: RuleOfCreditStep[];
}

function fromStep(row: any): RuleOfCreditStep {
  return {
    id: row.id,
    ruleOfCreditId: row.rule_of_credit_id,
    orderNo: Number(row.order_no) || 0,
    description: row.description ?? '',
    weight: Number(row.weight) || 0,
  };
}

export async function fetchRulesOfCredit(projectId: string): Promise<RuleOfCredit[]> {
  const { data, error } = await supabase
    .from('rules_of_credit')
    .select('*, rule_of_credit_steps(*)')
    .eq('project_id', projectId)
    .order('rule_id');
  raise('load rules of credit', error);
  return (data ?? []).map((row: any) => ({
    id: row.id,
    projectId: row.project_id,
    ruleId: row.rule_id,
    description: row.description ?? '',
    userField1: row.user_field1 ?? '',
    userField2: row.user_field2 ?? '',
    userField3: row.user_field3 ?? '',
    userField4: row.user_field4 ?? '',
    userField5: row.user_field5 ?? '',
    steps: (row.rule_of_credit_steps ?? [])
      .map(fromStep)
      .sort((a: RuleOfCreditStep, b: RuleOfCreditStep) => a.orderNo - b.orderNo),
  }));
}

function toRuleRow(patch: Partial<RuleOfCredit>): Record<string, any> {
  const out: Record<string, any> = {};
  if (patch.ruleId !== undefined) out.rule_id = patch.ruleId;
  if (patch.description !== undefined) out.description = patch.description;
  for (let i = 1; i <= 5; i++) {
    const key = `userField${i}` as keyof RuleOfCredit;
    if (patch[key] !== undefined) out[`user_field${i}`] = patch[key];
  }
  return out;
}

export async function createRuleOfCredit(
  projectId: string,
  rule: Partial<RuleOfCredit> & { ruleId: string }
): Promise<string> {
  const { data, error } = await supabase
    .from('rules_of_credit')
    .insert({ ...toRuleRow(rule), project_id: projectId })
    .select('id')
    .single();
  // (project_id, rule_id) is unique, so a duplicate reference is refused here.
  raise('add rule of credit', error);
  return data!.id;
}

export async function updateRuleOfCredit(id: string, patch: Partial<RuleOfCredit>): Promise<void> {
  const row = toRuleRow(patch);
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from('rules_of_credit')
    .update(row)
    .eq('id', assertId('updateRuleOfCredit', id));
  raise('update rule of credit', error);
}

export async function deleteRulesOfCredit(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // Steps cascade with their rule.
  const { error } = await supabase.from('rules_of_credit').delete().in('id', ids);
  raise('delete rules of credit', error);
}

/** One patch across many rules, in one statement. */
export async function bulkUpdateRulesOfCredit(
  ids: string[],
  patch: Partial<RuleOfCredit>
): Promise<number> {
  if (ids.length === 0) return 0;
  const row = toRuleRow(patch);
  if (Object.keys(row).length === 0) return 0;
  const { data, error } = await supabase
    .from('rules_of_credit')
    .update(row)
    .in('id', ids)
    .select('id');
  raise('bulk update rules of credit', error);
  return data?.length ?? 0;
}

/**
 * Import rules from a sheet. Upsert on (project_id, rule_id), so re-importing
 * a corrected sheet updates the rules rather than duplicating them.
 */
export async function importRulesOfCredit(
  projectId: string,
  rules: Array<Partial<RuleOfCredit> & { ruleId: string }>
): Promise<number> {
  if (rules.length === 0) return 0;
  const { data, error } = await supabase
    .from('rules_of_credit')
    .upsert(
      rules.map((r) => ({ ...toRuleRow(r), project_id: projectId })),
      { onConflict: 'project_id,rule_id' }
    )
    .select('id');
  raise('import rules of credit', error);
  return data?.length ?? 0;
}

// ------------------------------------------------------------------ steps ----

function toStepRow(patch: Partial<RuleOfCreditStep>): Record<string, any> {
  const out: Record<string, any> = {};
  if (patch.orderNo !== undefined) out.order_no = Number(patch.orderNo) || 0;
  if (patch.description !== undefined) out.description = String(patch.description).slice(0, 100);
  if (patch.weight !== undefined) out.weight = Number(patch.weight) || 0;
  return out;
}

/** Insert or update steps for one rule. */
export async function upsertSteps(
  ruleOfCreditId: string,
  steps: Array<Partial<RuleOfCreditStep>>
): Promise<number> {
  if (steps.length === 0) return 0;
  const { data, error } = await supabase
    .from('rule_of_credit_steps')
    .upsert(
      steps.map((s) => ({
        ...(s.id ? { id: s.id } : {}),
        ...toStepRow(s),
        rule_of_credit_id: assertId('upsertSteps', ruleOfCreditId),
      }))
    )
    .select('id');
  raise('save steps', error);
  return data?.length ?? 0;
}

/**
 * Insert or update steps that may belong to different rules.
 *
 * Still one statement: each row carries its own rule_of_credit_id, so a bulk
 * grid spanning every rule in the project goes in together.
 */
export async function upsertStepsAcrossRules(
  steps: Array<Partial<RuleOfCreditStep> & { ruleOfCreditId: string }>
): Promise<number> {
  if (steps.length === 0) return 0;
  const { data, error } = await supabase
    .from('rule_of_credit_steps')
    .upsert(
      steps.map((s) => ({
        ...(s.id ? { id: s.id } : {}),
        ...toStepRow(s),
        rule_of_credit_id: assertId('upsertStepsAcrossRules', s.ruleOfCreditId),
      }))
    )
    .select('id');
  raise('save steps', error);
  return data?.length ?? 0;
}

export async function updateStep(id: string, patch: Partial<RuleOfCreditStep>): Promise<void> {
  const row = toStepRow(patch);
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from('rule_of_credit_steps')
    .update(row)
    .eq('id', assertId('updateStep', id));
  raise('update step', error);
}

export async function deleteSteps(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('rule_of_credit_steps').delete().in('id', ids);
  raise('delete steps', error);
}

/** One patch across many steps, whichever rules they belong to. */
export async function bulkUpdateSteps(
  ids: string[],
  patch: Partial<RuleOfCreditStep>
): Promise<number> {
  if (ids.length === 0) return 0;
  const row = toStepRow(patch);
  if (Object.keys(row).length === 0) return 0;
  const { data, error } = await supabase
    .from('rule_of_credit_steps')
    .update(row)
    .in('id', ids)
    .select('id');
  raise('bulk update steps', error);
  return data?.length ?? 0;
}

/**
 * Replace the steps of the given rules with the ones supplied.
 *
 * An imported sheet states a rule's steps in full, so the rules it names have
 * their existing steps removed and the sheet's inserted. Rules the sheet does
 * not mention are untouched.
 */
export async function replaceStepsForRules(
  stepsByRuleId: Record<string, Array<Partial<RuleOfCreditStep>>>
): Promise<number> {
  const ruleIds = Object.keys(stepsByRuleId);
  if (ruleIds.length === 0) return 0;

  const { error: delError } = await supabase
    .from('rule_of_credit_steps')
    .delete()
    .in('rule_of_credit_id', ruleIds);
  raise('replace steps', delError);

  const rows = ruleIds.flatMap((ruleId) =>
    stepsByRuleId[ruleId].map((s) => ({ ...toStepRow(s), rule_of_credit_id: ruleId }))
  );
  if (rows.length === 0) return 0;

  const { data, error } = await supabase
    .from('rule_of_credit_steps')
    .insert(rows)
    .select('id');
  raise('replace steps', error);
  return data?.length ?? 0;
}
