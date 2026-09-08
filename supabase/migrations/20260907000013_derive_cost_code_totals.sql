-- ============================================================================
-- cost_codes.baseline_budget is derived too, and the actual-cost grid needs
-- an item and attribute columns.
--
-- Both grids maintained their cost code total the same fragile way: after
-- every write the browser re-read the rows, summed them and wrote the total
-- back -- looking costCodeId up twice, once as a document id and once as the
-- code string, because either could have been stored. A failure between the
-- two left the total silently wrong, and the UI told the user to press
-- "Calculate" afterwards to repair it.
-- ============================================================================

alter table actual_costs
  add column item text not null default '',
  add column enterprise_attributes jsonb not null default '{}'::jsonb,
  add column project_attributes    jsonb not null default '{}'::jsonb;

alter table baseline_budgets
  add column item text not null default '',
  add column enterprise_attributes jsonb not null default '{}'::jsonb,
  add column project_attributes    jsonb not null default '{}'::jsonb,
  add column source text not null default 'EST';

create or replace function refresh_cost_code_baseline(p_cost_code_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update cost_codes c
     set baseline_budget = coalesce((
           select sum(b.amount) from baseline_budgets b where b.cost_code_id = c.id), 0)
   where c.id = p_cost_code_id;
$$;

create or replace function baseline_budgets_refresh_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform refresh_cost_code_baseline(old.cost_code_id);
    return old;
  end if;

  perform refresh_cost_code_baseline(new.cost_code_id);
  -- A row moved between cost codes leaves the old one needing a recount too.
  if tg_op = 'UPDATE' and old.cost_code_id is distinct from new.cost_code_id then
    perform refresh_cost_code_baseline(old.cost_code_id);
  end if;
  return new;
end;
$$;

create trigger baseline_budgets_maintain_totals
  after insert or update or delete on baseline_budgets
  for each row execute function baseline_budgets_refresh_totals();

revoke all on function refresh_cost_code_baseline(uuid)  from public, anon, authenticated;
revoke all on function baseline_budgets_refresh_totals() from public, anon, authenticated;
