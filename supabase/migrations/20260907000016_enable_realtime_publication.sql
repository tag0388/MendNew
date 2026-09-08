-- Realtime broadcast for the tables the UI subscribes to.
--
-- subscribeToTable() in src/lib/supabase.ts listens on 'postgres_changes',
-- which only fires for tables that are members of the supabase_realtime
-- publication. Without this the subscriptions connect successfully and then
-- silently never fire -- one screen would show a project another screen had
-- just created only after a manual page reload.
--
-- Only the tables a screen actually watches are added. A publication carries
-- rows out of the database into the replication stream, so this is not a
-- free "add everything" switch.
--
-- REPLICA IDENTITY is deliberately left at the default (primary key). That
-- means UPDATE and DELETE events carry the changed row's id but not the old
-- values of its other columns, so budget and actual-cost figures never enter
-- the replication stream. The client only needs the id: every handler
-- responds by re-reading through RLS, which is also what stops a change
-- event from leaking a row the recipient is not allowed to see.

do $$
declare
  t text;
begin
  foreach t in array array[
    'enterprises',
    'enterprise_members',
    'projects',
    'cost_codes',
    'actual_costs',
    'baseline_budgets'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
