-- ============================================================================
-- Risk exposure, computed by the database.
--
-- A risk record's Beta PERT impact is ((min + 4 x most likely + max) / 6)
-- multiplied by the probability, and a risk's exposure is the sum of its
-- records'. The schema said "maintained by the application", and it was: the
-- browser recomputed the PERT on every edit and, after each one, read every
-- record of the risk back to re-sum the four totals and write them onto the
-- risk. Three separate write paths did the arithmetic, so any that forgot left
-- a risk showing a number that did not match its own records.
--
--   beta_pert_impact_amount   a generated column -- it cannot disagree with
--                             the inputs it is computed from
--   the risk's four totals    re-derived by trigger from its records
--
-- Same shape as derive_change_totals and the subcontract roll-ups. Plain
-- PostgreSQL: a generated column and a trigger. See ARCHITECTURE.md.
-- ============================================================================

alter table risk_records drop column beta_pert_impact_amount;
alter table risk_records
  add column beta_pert_impact_amount numeric(18,2)
  generated always as (
    round(((min_impact_amount + 4 * most_likely_impact_amount + max_impact_amount) / 6)
          * probability, 2)
  ) stored;

create or replace function refresh_risk_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.risk_id, old.risk_id);
begin
  update risks r
     set exposure = coalesce((
           select sum(t.beta_pert_impact_amount) from risk_records t where t.risk_id = target), 0),
         min_impact_total = coalesce((
           select sum(t.min_impact_amount) from risk_records t where t.risk_id = target), 0),
         most_likely_impact_total = coalesce((
           select sum(t.most_likely_impact_amount) from risk_records t where t.risk_id = target), 0),
         max_impact_total = coalesce((
           select sum(t.max_impact_amount) from risk_records t where t.risk_id = target), 0)
   where r.id = target;
  return null;
end;
$$;

drop trigger if exists risk_records_refresh_totals on risk_records;
create trigger risk_records_refresh_totals
  after insert or update or delete on risk_records
  for each row execute function refresh_risk_totals();

-- Bring existing risks in line with what the trigger will now maintain.
update risks r
   set exposure = coalesce((
         select sum(t.beta_pert_impact_amount) from risk_records t where t.risk_id = r.id), 0),
       min_impact_total = coalesce((
         select sum(t.min_impact_amount) from risk_records t where t.risk_id = r.id), 0),
       most_likely_impact_total = coalesce((
         select sum(t.most_likely_impact_amount) from risk_records t where t.risk_id = r.id), 0),
       max_impact_total = coalesce((
         select sum(t.max_impact_amount) from risk_records t where t.risk_id = r.id), 0);
