-- ============================================================================
-- cost_codes.actual_cost_to_date / .actual_cost_this_period are derived.
--
-- The client maintained them: after every insert, update or delete of an
-- actual cost it re-read the rows, summed them and wrote the totals back. If
-- the browser failed between the two, the totals were silently wrong -- and
-- the read had to query costCodeId twice, once as a document id and once as
-- the code string, because either could have been stored.
--
-- The database maintains them now, so they cannot drift from the rows they
-- summarise, and "this period" follows whichever period is current.
-- ============================================================================

alter type actual_cost_source add value if not exists 'FIN' after 'ACC';

create or replace function refresh_cost_code_actuals(p_cost_code_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update cost_codes c
     set actual_cost_to_date = coalesce((
           select sum(a.cost) from actual_costs a where a.cost_code_id = c.id), 0),
         actual_cost_this_period = coalesce((
           select sum(a.cost) from actual_costs a
             join reporting_periods rp on rp.id = a.reporting_period_id
            where a.cost_code_id = c.id and rp.is_current), 0)
   where c.id = p_cost_code_id;
$$;

create or replace function actual_costs_refresh_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform refresh_cost_code_actuals(old.cost_code_id);
    return old;
  end if;

  perform refresh_cost_code_actuals(new.cost_code_id);
  -- A row moved between cost codes leaves the old one needing a recount too.
  if tg_op = 'UPDATE' and old.cost_code_id is distinct from new.cost_code_id then
    perform refresh_cost_code_actuals(old.cost_code_id);
  end if;
  return new;
end;
$$;

create trigger actual_costs_maintain_totals
  after insert or update or delete on actual_costs
  for each row execute function actual_costs_refresh_totals();

revoke all on function refresh_cost_code_actuals(uuid) from public, anon, authenticated;
revoke all on function actual_costs_refresh_totals()   from public, anon, authenticated;
