-- ============================================================================
-- Two corrections to cost_phasing, both found by converting the timephasing
-- grid rather than by reading the schema.
--
-- 1. The settings that PRODUCE the phasing had nowhere to live.
--
--    Each row of the grid carries a start date, an end date and a distribution
--    curve, and auto-phasing spreads the total over the periods between those
--    dates using that curve. Only the RESULT (period_values) had a column, so
--    reopening the screen would show phased numbers with the inputs that
--    produced them blank, and re-running auto-phase would have nothing to
--    re-run from.
--
-- 2. The phasing_source CHECK constraint listed the wrong values.
--
--    It allowed 'Manual', 'ETC Details', 'Change Management' and
--    'Sub-Contract Management' -- the EAC METHOD vocabulary, borrowed by
--    mistake. What the grid actually offers is 'Manual', 'Auto', 'ETC Details'
--    and 'SubContract', and auto-phasing writes 'Auto' on every row it
--    calculates. So every auto-phasing save would have been rejected by the
--    database. The default was 'ETC Details', which is a source only for a
--    cost code whose EAC method is ETC Details; 'Manual' is the right neutral
--    default and is what the grid falls back to when the stored value is
--    absent.
--
--    Note this column is NOT the phasing_source enum used by
--    subcontract_line_items. Same name, different set: that one is the
--    Manual/Auto distinction alone. Left as text with a check rather than
--    forced into that enum, because they are not the same concept.
-- ============================================================================

alter table cost_phasing
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists distribution distribution_curve;

alter table cost_phasing
  drop constraint if exists cost_phasing_phasing_source_check;

alter table cost_phasing
  alter column phasing_source set default 'Manual';

alter table cost_phasing
  add constraint cost_phasing_phasing_source_check
  check (phasing_source in ('Manual', 'Auto', 'ETC Details', 'SubContract'));

-- Each timephasing row (baseline, approved, EAC) can also be tied to its own
-- schedule activity -- the column is editable and picks from the project's
-- schedule items. Without somewhere to store it the edit would appear to take
-- and be gone on reload.
alter table cost_phasing
  add column if not exists activity_id text;
