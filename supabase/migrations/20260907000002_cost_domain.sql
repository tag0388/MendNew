-- ============================================================================
-- Mend Cost Management -- Cost domain
-- Cost codes, ETC details, actuals, baselines, time-phasing, period snapshots
-- ============================================================================

create type cost_phasing_type as enum ('budget','baseline','approved','eac','eacPrevious');

-- ------------------------------------------------------------ cost codes ----

create table cost_codes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  code       text not null,                       -- user-facing cost code
  name       text check (length(name) <= 600),

  eac_method eac_method not null default 'Manual',
  sort_order integer not null default 0,

  activity_id         text,
  planned_start_date  date,
  planned_end_date    date,

  -- attrId -> valueId, against the enterprise/project attribute definitions
  enterprise_attributes jsonb not null default '{}'::jsonb,
  project_attributes    jsonb not null default '{}'::jsonb,

  -- Budget
  baseline_budget            numeric(18,2) not null default 0,
  budget_changes             numeric(18,2) not null default 0,
  approved_budget            numeric(18,2) not null default 0,
  approved_budget_previous   numeric(18,2) not null default 0,
  approved_budget_movement   numeric(18,2) not null default 0,

  -- Actual cost
  actual_cost_this_period numeric(18,2) not null default 0,
  actual_cost_to_date     numeric(18,2) not null default 0,

  -- EAC / ETC
  estimate_to_complete             numeric(18,2) not null default 0,
  estimate_at_completion           numeric(18,2) not null default 0,
  estimate_at_completion_previous  numeric(18,2) not null default 0,
  estimate_at_completion_movement  numeric(18,2) not null default 0,

  -- Variance
  cost_variance          numeric(18,2) not null default 0,
  cost_variance_previous numeric(18,2) not null default 0,
  cost_variance_movement numeric(18,2) not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Firestore allowed duplicate codes within a project; SQL will not.
  unique (project_id, code)
);

create index cost_codes_project_idx on cost_codes (project_id, sort_order);

create trigger cost_codes_set_updated_at
  before update on cost_codes
  for each row execute function set_updated_at();

-- CostCode.assignedUsers -- a table rather than a uuid[] so RLS can index it.
create table cost_code_users (
  cost_code_id uuid not null references cost_codes(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  primary key (cost_code_id, user_id)
);

create index cost_code_users_user_idx on cost_code_users (user_id);

-- ---------------------------------------------------------- etc details ----

create table etc_details (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  cost_code_id uuid not null references cost_codes(id) on delete cascade,
  calendar_id  uuid references calendars(id) on delete set null,

  item        text not null check (length(item) <= 200),
  description text not null default '' check (length(description) <= 1000),
  category     text,
  order_number text,
  activity_id  text,

  udf1 text,
  udf2 text,
  udf3 text,
  udf4 text,

  qty  numeric(18,4) not null default 0,
  unit text,
  rate numeric(18,4) not null default 0,

  phasing_method     etc_phasing_method not null default 'Manual',
  phasing_start_date date,
  phasing_end_date   date,
  phasing_unit       etc_phasing_unit not null default 'Total',
  phasing_qty        numeric(18,4) not null default 0,

  enterprise_attributes jsonb not null default '{}'::jsonb,
  project_attributes    jsonb not null default '{}'::jsonb,

  -- periodId (reporting_periods.id) -> value
  period_values jsonb not null default '{}'::jsonb,

  total_etc_previous numeric(18,2) not null default 0,

  is_enterprise_resource boolean not null default false,
  resource_id            uuid references resource_rates(id) on delete set null,

  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index etc_details_project_idx   on etc_details (project_id);
create index etc_details_cost_code_idx on etc_details (cost_code_id);

create trigger etc_details_set_updated_at
  before update on etc_details
  for each row execute function set_updated_at();

-- --------------------------------------------------------- actual costs ----
-- NOTE: in Firestore actualCosts.costCodeId held either the cost code document
-- id OR the user-facing code string depending on the write path, and readers
-- had to query both. Here it is one uuid FK with one meaning.

create table actual_costs (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  cost_code_id        uuid not null references cost_codes(id) on delete cascade,
  reporting_period_id uuid not null references reporting_periods(id) on delete restrict,
  cost                numeric(18,2) not null default 0,
  description         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

create index actual_costs_project_idx on actual_costs (project_id);
create index actual_costs_lookup_idx  on actual_costs (cost_code_id, reporting_period_id);

create trigger actual_costs_set_updated_at
  before update on actual_costs
  for each row execute function set_updated_at();

-- ------------------------------------------------------ baseline budgets ----

create table baseline_budgets (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  cost_code_id        uuid not null references cost_codes(id) on delete cascade,
  reporting_period_id uuid not null references reporting_periods(id) on delete restrict,
  amount              numeric(18,2) not null default 0,
  description         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

create index baseline_budgets_project_idx on baseline_budgets (project_id);
create index baseline_budgets_lookup_idx  on baseline_budgets (cost_code_id, reporting_period_id);

create trigger baseline_budgets_set_updated_at
  before update on baseline_budgets
  for each row execute function set_updated_at();

-- --------------------------------------------------------- cost phasing ----
-- One row per (cost code, phasing type); period_values is periodId -> amount.

create table cost_phasing (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  cost_code_id  uuid not null references cost_codes(id) on delete cascade,
  type          cost_phasing_type not null,
  period_values jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (cost_code_id, type)
);

create index cost_phasing_project_idx on cost_phasing (project_id, type);

create trigger cost_phasing_set_updated_at
  before update on cost_phasing
  for each row execute function set_updated_at();

-- ------------------------------------------------------ period snapshots ----
-- Immutable archive written at period close. Deliberately JSONB: it is a frozen
-- copy of the whole cost picture, never queried field-by-field.

create table period_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  reporting_period_id uuid not null references reporting_periods(id) on delete restrict,
  period_name         text not null,
  snapshot_date       timestamptz not null default now(),
  cost_codes    jsonb not null default '[]'::jsonb,
  etc_details   jsonb not null default '[]'::jsonb,
  cost_phasing  jsonb not null default '[]'::jsonb,
  actual_costs  jsonb not null default '[]'::jsonb,
  created_by    uuid references auth.users(id)
);

create index period_snapshots_project_idx on period_snapshots (project_id, snapshot_date desc);
