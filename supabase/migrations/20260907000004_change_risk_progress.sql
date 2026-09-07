-- ============================================================================
-- Mend Cost Management -- Change, risk, procurement, progress, schedule
-- ============================================================================

-- ---------------------------------------------------------------- changes ----

create table changes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,

  change_id   text not null check (length(change_id) between 1 and 20),
  description text not null default '',
  type        text,                       -- one of projects/enterprises.change_types
  status      change_status not null default 'Pending',

  initiator text check (length(initiator) <= 50),
  reference text check (length(reference) <= 50),

  -- Roll-ups of the child change_records
  budget numeric(18,2) not null default 0,
  eac    numeric(18,2) not null default 0,

  period_id uuid references reporting_periods(id) on delete set null,

  enterprise_attributes jsonb not null default '{}'::jsonb,
  project_attributes    jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, change_id)
);

create index changes_project_idx on changes (project_id, status);

create trigger changes_set_updated_at
  before update on changes
  for each row execute function set_updated_at();

create table change_records (
  id           uuid primary key default gen_random_uuid(),
  change_id    uuid not null references changes(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  cost_code_id uuid not null references cost_codes(id) on delete restrict,

  scope text not null default '' check (length(scope) <= 100),

  budget_amount numeric(18,2) not null default 0,
  eac_amount    numeric(18,2) not null default 0,

  enterprise_attributes jsonb not null default '{}'::jsonb,
  project_attributes    jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index change_records_change_idx    on change_records (change_id);
create index change_records_cost_code_idx on change_records (cost_code_id);
create index change_records_project_idx   on change_records (project_id);

create trigger change_records_set_updated_at
  before update on change_records
  for each row execute function set_updated_at();

-- ------------------------------------------------------------------ risks ----

create table risks (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,

  risk_id     text not null check (length(risk_id) between 1 and 20),
  description text not null default '',
  type        text,                       -- one of projects/enterprises.risk_types
  status      risk_status   not null default 'Open',
  strategy    risk_strategy not null default 'Mitigate',

  initiator text check (length(initiator) <= 50),
  reference text check (length(reference) <= 50),

  -- Roll-ups of the child risk_records
  exposure                  numeric(18,2) not null default 0,  -- Beta PERT
  min_impact_total          numeric(18,2) not null default 0,
  most_likely_impact_total  numeric(18,2) not null default 0,
  max_impact_total          numeric(18,2) not null default 0,

  -- Retained from the original model
  mitigation         numeric(18,2) not null default 0,
  residual_exposure  numeric(18,2) not null default 0,

  period_id uuid references reporting_periods(id) on delete set null,

  enterprise_attributes jsonb not null default '{}'::jsonb,
  project_attributes    jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, risk_id)
);

create index risks_project_idx on risks (project_id, status);

create trigger risks_set_updated_at
  before update on risks
  for each row execute function set_updated_at();

create table risk_records (
  id           uuid primary key default gen_random_uuid(),
  risk_id      uuid not null references risks(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  cost_code_id uuid not null references cost_codes(id) on delete restrict,

  scope text not null default '' check (length(scope) <= 100),

  probability numeric(5,4) not null default 0 check (probability between 0 and 1),

  min_impact_amount         numeric(18,2) not null default 0,
  most_likely_impact_amount numeric(18,2) not null default 0,
  max_impact_amount         numeric(18,2) not null default 0,

  -- (min + 4*mostLikely + max) / 6, maintained by the application
  beta_pert_impact_amount numeric(18,2) not null default 0,

  enterprise_attributes jsonb not null default '{}'::jsonb,
  project_attributes    jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index risk_records_risk_idx      on risk_records (risk_id);
create index risk_records_cost_code_idx on risk_records (cost_code_id);
create index risk_records_project_idx   on risk_records (project_id);

create trigger risk_records_set_updated_at
  before update on risk_records
  for each row execute function set_updated_at();

-- ------------------------------------------------------------ procurement ----
-- A step definition belongs to either an enterprise (a standard) or a project.

create table procurement_step_definitions (
  id            uuid primary key default gen_random_uuid(),
  enterprise_id uuid references enterprises(id) on delete cascade,
  project_id    uuid references projects(id) on delete cascade,

  name       text not null,
  step_order integer not null default 0,

  is_enterprise_standard boolean not null default false,
  default_duration_days  integer,

  -- When a project step is derived from an enterprise standard
  enterprise_step_id uuid references procurement_step_definitions(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint procurement_step_single_owner check (
    (enterprise_id is not null and project_id is null) or
    (enterprise_id is null and project_id is not null)
  )
);

create index procurement_steps_enterprise_idx on procurement_step_definitions (enterprise_id, step_order);
create index procurement_steps_project_idx    on procurement_step_definitions (project_id, step_order);

create trigger procurement_step_definitions_set_updated_at
  before update on procurement_step_definitions
  for each row execute function set_updated_at();

create table procurement_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  calendar_id uuid references calendars(id) on delete set null,

  -- Free-text package identifier, unique per project. There is no separate
  -- procurement package entity; packages exist only as this grouping key.
  package_id  text not null,
  description text not null default '',
  category    text,

  enterprise_attributes jsonb not null default '{}'::jsonb,
  project_attributes    jsonb not null default '{}'::jsonb,

  -- stepDefinitionId -> { plannedDate, actualDate, forecastDate,
  --                       planDuration, forecastDuration }
  step_data jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, package_id)
);

create index procurement_items_project_idx on procurement_items (project_id);

create trigger procurement_items_set_updated_at
  before update on procurement_items
  for each row execute function set_updated_at();

-- --------------------------------------------------------- rules of credit ----

create table rules_of_credit (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,

  rule_id     text not null check (length(rule_id) between 1 and 20),
  description text not null default '',

  user_field1 text,
  user_field2 text,
  user_field3 text,
  user_field4 text,
  user_field5 text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, rule_id)
);

create index rules_of_credit_project_idx on rules_of_credit (project_id);

create trigger rules_of_credit_set_updated_at
  before update on rules_of_credit
  for each row execute function set_updated_at();

-- RuleOfCredit.steps -- weighted steps are entities, so a child table.
create table rule_of_credit_steps (
  id                uuid primary key default gen_random_uuid(),
  rule_of_credit_id uuid not null references rules_of_credit(id) on delete cascade,
  order_no          numeric(10,2) not null default 0,
  description       text not null default '' check (length(description) <= 100),
  weight            numeric(9,4) not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index rule_of_credit_steps_rule_idx on rule_of_credit_steps (rule_of_credit_id, order_no);

create trigger rule_of_credit_steps_set_updated_at
  before update on rule_of_credit_steps
  for each row execute function set_updated_at();

-- ------------------------------------------------------------- progress ----

create table progress_packages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,

  package_id  text not null check (length(package_id) between 1 and 20),
  description text not null default '',
  unit        text,

  rule_of_credit_id uuid references rules_of_credit(id) on delete set null,

  attributes jsonb not null default '{}'::jsonb,

  default_start_date    date,
  default_end_date      date,
  default_phasing_method progress_phasing_method,
  default_phasing_curve  progress_phasing_curve,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, package_id)
);

create index progress_packages_project_idx on progress_packages (project_id);

create trigger progress_packages_set_updated_at
  before update on progress_packages
  for each row execute function set_updated_at();

-- ProgressItem carried both packageId (string) and packageDocId (reference).
-- One FK replaces both; the user-facing code is reachable by join.
create table progress_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  package_id   uuid not null references progress_packages(id) on delete cascade,
  cost_code_id uuid references cost_codes(id) on delete set null,

  item_id     text not null,
  activity_id text,
  description text not null default '',

  total_qty           numeric(18,4) not null default 0,
  total_qty_previous  numeric(18,4) not null default 0,
  earned_qty_previous numeric(18,4) not null default 0,

  planned_start_date date,
  planned_end_date   date,
  phasing_method     progress_phasing_method not null default 'Auto',
  phasing_curve      progress_phasing_curve  not null default 'even',

  -- Current (re-forecast) plan, overriding the baseline plan above
  current_start_date     date,
  current_end_date       date,
  current_phasing_method progress_phasing_method,
  current_phasing_curve  progress_phasing_curve,

  rule_of_credit_id uuid references rules_of_credit(id) on delete set null,
  -- stepId -> percent complete (0-100)
  rule_of_credit_progress jsonb not null default '{}'::jsonb,

  -- periodId -> qty
  period_values         jsonb not null default '{}'::jsonb,
  current_period_values jsonb not null default '{}'::jsonb,
  actual_period_values  jsonb not null default '{}'::jsonb,

  enterprise_attributes jsonb not null default '{}'::jsonb,
  project_attributes    jsonb not null default '{}'::jsonb,

  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (package_id, item_id)
);

create index progress_items_project_idx   on progress_items (project_id);
create index progress_items_package_idx   on progress_items (package_id, sort_order);
create index progress_items_cost_code_idx on progress_items (cost_code_id);

create trigger progress_items_set_updated_at
  before update on progress_items
  for each row execute function set_updated_at();

-- ------------------------------------------------------- schedule items ----

create table schedule_items (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,

  activity_id text not null,
  description text not null default '',

  activity_percent_complete numeric(9,4) not null default 0,

  baseline_start_date date,
  baseline_end_date   date,
  planned_start_date  date,
  planned_end_date    date,
  current_start_date  date,
  current_end_date    date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, activity_id)
);

create index schedule_items_project_idx on schedule_items (project_id);

create trigger schedule_items_set_updated_at
  before update on schedule_items
  for each row execute function set_updated_at();
