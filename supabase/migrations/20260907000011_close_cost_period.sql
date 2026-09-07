-- ============================================================================
-- Closing a cost reporting period.
--
-- The client did this as a sequence of Firestore batches committed in chunks
-- of 450, because one batch takes at most 500 writes. Those chunks were not
-- atomic with each other: a failure part-way left cost codes rolled forward
-- but ETC details not, accruals reversed but the period still open -- broken
-- financial state with no way back, on the one operation in the app that most
-- needs to be all-or-nothing. Here it is one function, so one transaction.
--
-- SECURITY INVOKER, so RLS still applies to every statement inside and the
-- function cannot be used to write past a policy. The explicit project-admin
-- check gives a clear error rather than a silent no-op.
--
-- Note: the Firestore version also wrote a periodSnapshots document archiving
-- the whole cost picture at close. That table was dropped as unused, so
-- closing no longer archives; the previous-period columns and eacPrevious
-- phasing carry what the next period compares against.
-- ============================================================================

create or replace function close_cost_period(p_project_id uuid)
returns table (closed_period_id uuid, closed_period_name text, next_period_id uuid, next_period_name text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  closing   reporting_periods%rowtype;
  next_open reporting_periods%rowtype;
begin
  if not auth_is_project_admin(p_project_id) then
    raise exception 'Only a project admin may close a reporting period';
  end if;

  select * into closing from reporting_periods
   where project_id = p_project_id and kind = 'cost' and status = 'open'
   order by sort_order limit 1;

  if not found then
    raise exception 'There is no open cost period to close';
  end if;

  select * into next_open from reporting_periods
   where project_id = p_project_id and kind = 'cost' and status = 'open'
     and sort_order > closing.sort_order
   order by sort_order limit 1;

  -- 1. Carry this period's figures into the "previous" columns, zero the
  --    movements, and net off any accruals raised in the closing period.
  --    The accrual is matched per cost code by correlated subquery: an
  --    earlier draft joined the accrual set with `on true`, which paired
  --    every cost code with every accrual.
  update cost_codes c
     set approved_budget_previous        = c.approved_budget,
         approved_budget_movement        = 0,
         estimate_at_completion_previous = c.estimate_at_completion,
         estimate_at_completion_movement = 0,
         actual_cost_to_date = c.actual_cost_to_date + coalesce((
           select sum(ac.cost) * -1 from actual_costs ac
            where ac.cost_code_id = c.id
              and ac.reporting_period_id = closing.id
              and ac.source = 'ACC'), 0),
         actual_cost_this_period = case when next_open.id is not null then coalesce((
           select sum(ac.cost) * -1 from actual_costs ac
            where ac.cost_code_id = c.id
              and ac.reporting_period_id = closing.id
              and ac.source = 'ACC'), 0) else 0 end
   where c.project_id = p_project_id;

  -- 2. Freeze each ETC detail's total against the periods still ahead.
  update etc_details e
     set total_etc_previous = coalesce((
           select sum((e.period_values ->> rp.id::text)::numeric)
             from reporting_periods rp
            where rp.project_id = p_project_id and rp.kind = 'cost'
              and rp.sort_order > closing.sort_order
              and e.period_values ? rp.id::text
         ), 0) * e.rate,
         etc_mvmt = 0
   where e.project_id = p_project_id;

  -- 3. Keep the closing EAC curve as what the next period moves from.
  insert into cost_phasing (project_id, cost_code_id, type, period_values, phasing_source)
  select p_project_id, cp.cost_code_id, 'eacPrevious', cp.period_values, cp.phasing_source
    from cost_phasing cp
   where cp.project_id = p_project_id and cp.type = 'eac'
  on conflict (cost_code_id, type) do update
    set period_values  = excluded.period_values,
        phasing_source = excluded.phasing_source;

  -- 4. Reverse the closing period's accruals into the next, so they do not
  --    double-count when the real invoice arrives.
  if next_open.id is not null then
    insert into actual_costs (project_id, cost_code_id, reporting_period_id, cost, description, source)
    select project_id, cost_code_id, next_open.id, cost * -1,
           'Reversal of accrual from ' || closing.name, 'REV'
      from actual_costs
     where project_id = p_project_id
       and reporting_period_id = closing.id
       and source = 'ACC';
  end if;

  -- 5. Close it and move the current marker on.
  update reporting_periods set status = 'closed', is_current = false where id = closing.id;
  if next_open.id is not null then
    update reporting_periods set is_current = true where id = next_open.id;
  end if;

  return query select closing.id, closing.name, next_open.id, next_open.name;
end;
$$;

revoke all on function close_cost_period(uuid) from public, anon;
grant execute on function close_cost_period(uuid) to authenticated;
