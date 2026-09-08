-- ============================================================================
-- A project's periods must always have exactly one current period.
--
-- Creating a calendar never marked one, so a fresh project had twelve periods
-- and none current. Everything that asks "which periods are in the future?"
-- then falls back to "all of them", and auto-phasing spread forecast into the
-- FIRST period -- the one that is actually current, reported as actual cost
-- rather than forecast. A project generated Sep'26..Aug'27 and phased over
-- dates in Sep'26 got quantities in Sep'26.
--
-- There was already a unique index guaranteeing AT MOST one current period per
-- (project, kind). This adds the other half: at least one. Enforced by trigger
-- rather than in the client, because the rule has to hold no matter which
-- screen or function writes periods -- generating a calendar, extending it,
-- deleting a period, or closing one.
--
-- The earliest OPEN period is the one chosen. A closed period is finished
-- reporting and cannot be current; if every period is closed the project has
-- nothing current, which is correct and is what close_cost_period leaves
-- behind after the last period closes.
-- ============================================================================

create or replace function ensure_current_period(p_project_id uuid, p_kind period_kind)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from reporting_periods
     where project_id = p_project_id and kind = p_kind and is_current
  ) then
    return;
  end if;

  update reporting_periods
     set is_current = true
   where id = (
     select id from reporting_periods
      where project_id = p_project_id and kind = p_kind and status = 'open'
      order by sort_order
      limit 1
   );
end;
$$;

create or replace function reporting_periods_ensure_current()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform ensure_current_period(
    coalesce(new.project_id, old.project_id),
    coalesce(new.kind, old.kind)
  );
  return null;
end;
$$;

drop trigger if exists reporting_periods_maintain_current on reporting_periods;

-- pg_trigger_depth() = 0, not 1. A trigger's WHEN clause is evaluated BEFORE
-- the trigger function is entered, so it reports the depth of the statement
-- that fired it: 0 for a statement issued by the client. The updates this
-- trigger makes are themselves updates on reporting_periods and fire it again
-- at depth 1, so 0 is both the "fire me" condition and the recursion guard.
-- Written as 1 first, which meant the trigger never fired at all.
create trigger reporting_periods_maintain_current
after insert or update or delete on reporting_periods
for each row
when (pg_trigger_depth() = 0)
execute function reporting_periods_ensure_current();

-- Backfill every project that already has periods but none current.
do $$
declare r record;
begin
  for r in select distinct project_id, kind from reporting_periods loop
    perform ensure_current_period(r.project_id, r.kind);
  end loop;
end $$;

revoke all on function ensure_current_period(uuid, period_kind) from public, anon, authenticated;
