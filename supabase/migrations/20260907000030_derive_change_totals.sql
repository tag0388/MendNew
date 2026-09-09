-- ============================================================================
-- A change's budget and EAC are the sum of its records.
--
-- The browser did this the fragile way: after every record write it queried
-- that change's records back, summed them and wrote the totals onto the
-- change. Three round trips per edit, and a failure between the write and the
-- recount left the change showing a total that did not match its own records.
-- The same shape as the cost-code totals already moved into triggers.
--
-- Derived here instead, so the totals cannot disagree with the records
-- whatever writes them -- the grid, an Excel import, or a bulk update.
-- ============================================================================

create or replace function refresh_change_totals(p_change_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update changes c
     set budget = coalesce((select sum(r.budget_amount) from change_records r
                             where r.change_id = c.id), 0),
         eac    = coalesce((select sum(r.eac_amount) from change_records r
                             where r.change_id = c.id), 0),
         updated_at = now()
   where c.id = p_change_id;
$$;

create or replace function change_records_refresh_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform refresh_change_totals(coalesce(new.change_id, old.change_id));
  -- A record moved between changes leaves the old one needing a recount too.
  if tg_op = 'UPDATE' and new.change_id is distinct from old.change_id then
    perform refresh_change_totals(old.change_id);
  end if;
  return null;
end;
$$;

drop trigger if exists change_records_maintain_totals on change_records;

create trigger change_records_maintain_totals
after insert or update or delete on change_records
for each row execute function change_records_refresh_totals();

update changes c
   set budget = coalesce((select sum(r.budget_amount) from change_records r where r.change_id = c.id), 0),
       eac    = coalesce((select sum(r.eac_amount) from change_records r where r.change_id = c.id), 0);

revoke all on function refresh_change_totals(uuid) from public, anon, authenticated;
