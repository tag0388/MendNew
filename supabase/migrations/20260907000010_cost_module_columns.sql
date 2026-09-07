-- ============================================================================
-- Columns the cost module uses that the first schema pass missed.
-- ============================================================================

-- How an actual cost arrived: MAN entered by hand, ACC an accrual raised in a
-- period, REV the automatic reversal of that accrual in the next period.
-- Closing a period depends on telling them apart.
create type actual_cost_source as enum ('MAN','ACC','REV');

alter table actual_costs
  add column source actual_cost_source not null default 'MAN';

create index actual_costs_source_idx on actual_costs (project_id, source);

-- Movement of ETC against the previous period's frozen figure.
alter table etc_details
  add column etc_mvmt numeric(18,2) not null default 0;

-- Where a phasing curve is driven from. 'Manual' means the stored
-- period_values are authoritative; the others mean it is derived.
alter table cost_phasing
  add column phasing_source text not null default 'ETC Details'
  check (phasing_source in ('Manual','ETC Details','Change Management','Sub-Contract Management'));
