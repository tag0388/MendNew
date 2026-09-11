-- ============================================================================
-- Closing a progress period and capturing its actuals.
--
-- Rolling over a period stamps each progress item with the quantity earned in
-- the period just closed. The browser did it by reading every progress item
-- and every rule of credit in the project, working out each item's earned
-- quantity from its rule's weighted steps in JavaScript, and writing the
-- results back in batches of 400 (Firestore capped a batch at 500 writes). On
-- a project with hundreds of thousands of progress items that is not a button
-- press, it is an outage -- and a batch failing halfway left some items
-- stamped and others not.
--
-- It is one statement here, so it either happens or it does not:
--
--   earned    = (sum over the rule's steps of progress% x weight / 100) / 100
--               x the item's total quantity
--   actual    = earned - what was already earned, never negative
--
-- Plain PostgreSQL: a join, jsonb_set. See ARCHITECTURE.md.
-- ============================================================================

create or replace function close_progress_period(
  p_project_id uuid,
  p_period_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  stamped integer;
begin
  with earned as (
    select i.id,
           coalesce(i.total_qty, 0) * coalesce(w.percent, 0) / 100 as earned_qty
      from progress_items i
      left join lateral (
        select sum(
                 coalesce((i.rule_of_credit_progress ->> s.id::text)::numeric, 0)
                 * s.weight / 100
               ) as percent
          from rule_of_credit_steps s
         where s.rule_of_credit_id = i.rule_of_credit_id
      ) w on true
     where i.project_id = p_project_id
  )
  update progress_items i
     set actual_period_values = jsonb_set(
           coalesce(i.actual_period_values, '{}'::jsonb),
           array[p_period_id::text],
           to_jsonb(round(greatest(0, e.earned_qty - coalesce(i.earned_qty_previous, 0)), 4))
         ),
         earned_qty_previous = round(e.earned_qty, 4),
         updated_at = now()
    from earned e
   where i.id = e.id;

  get diagnostics stamped = row_count;
  return stamped;
end;
$$;

revoke all on function close_progress_period(uuid, uuid) from public, anon;
grant execute on function close_progress_period(uuid, uuid) to authenticated;
