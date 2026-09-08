-- The cost module subscribes to these as well, and a table that is not a
-- member of the publication delivers no change events at all -- the
-- subscription connects and then stays silent, which looks exactly like a
-- feature that does not work.
--
-- REPLICA IDENTITY stays at the default here too, so UPDATE and DELETE events
-- carry only the changed row's primary key. Every handler responds by
-- re-reading through RLS, which is what stops an event from surfacing a row
-- the recipient may not see.
do $$
declare
  t text;
begin
  foreach t in array array[
    'etc_details',
    'cost_phasing',
    'changes',
    'change_records',
    'risk_records',
    'subcontracts',
    'subcontract_line_items'
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
