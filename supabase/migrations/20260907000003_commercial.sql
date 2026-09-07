-- ============================================================================
-- Mend Cost Management -- Commercial domain
-- Subcontracts, subcontract line items, invoices, invoice items
--
-- Subcontract.lineItems and Invoice.items were embedded arrays in Firestore.
-- They become tables here: they are entities with their own identity, status
-- and money, and cross-package reporting on them is the reason for moving to
-- SQL at all.
--
-- Denormalised copies (enterpriseId alongside projectId, vendorName alongside
-- vendorId) are dropped -- they are reachable by join and cannot then drift.
-- ============================================================================

create table subcontracts (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,

  order_id    text not null check (length(order_id) <= 50),
  order_name  text not null default '',
  order_scope text not null default '',

  status       subcontract_status not null default 'Active',
  payment_type payment_type not null default 'LumpSum',
  award_date   date,

  vendor_id    uuid references vendors(id) on delete restrict,
  vendor_users text[] not null default '{}',   -- vendor contact emails

  total_amount     numeric(18,2) not null default 0,
  forecast_changes numeric(18,2) not null default 0,

  -- Defaults applied to newly added line items
  default_cost_code_id   uuid references cost_codes(id) on delete set null,
  default_phasing_source phasing_source,
  default_start_date     date,
  default_end_date       date,
  default_distribution   distribution_curve,

  enterprise_attributes jsonb not null default '{}'::jsonb,
  project_attributes    jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  unique (project_id, order_id)
);

create index subcontracts_project_idx on subcontracts (project_id);
create index subcontracts_vendor_idx  on subcontracts (vendor_id);

create trigger subcontracts_set_updated_at
  before update on subcontracts
  for each row execute function set_updated_at();

-- ------------------------------------------------ subcontract line items ----

create table subcontract_line_items (
  id             uuid primary key default gen_random_uuid(),
  subcontract_id uuid not null references subcontracts(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  cost_code_id   uuid references cost_codes(id) on delete set null,

  item_no     text not null,
  description text not null default '',
  activity_id text,
  item_date   date,

  qty   numeric(18,4) not null default 0,
  unit  text,
  rate  numeric(18,4) not null default 0,
  total numeric(18,2) not null default 0,

  type   line_item_type   not null default 'Original',
  status line_item_status not null default 'Pending',

  start_date     date,
  end_date       date,
  phasing_source phasing_source,
  distribution   distribution_curve,

  -- periodId -> value
  period_values jsonb not null default '{}'::jsonb,

  enterprise_attributes jsonb not null default '{}'::jsonb,
  project_attributes    jsonb not null default '{}'::jsonb,
  user_defined          jsonb not null default '{}'::jsonb,

  note       text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (subcontract_id, item_no)
);

create index subcontract_line_items_subcontract_idx on subcontract_line_items (subcontract_id, sort_order);
create index subcontract_line_items_project_idx     on subcontract_line_items (project_id);
create index subcontract_line_items_cost_code_idx   on subcontract_line_items (cost_code_id);

create trigger subcontract_line_items_set_updated_at
  before update on subcontract_line_items
  for each row execute function set_updated_at();

-- --------------------------------------------------------------- invoices ----

create table invoices (
  id             uuid primary key default gen_random_uuid(),
  subcontract_id uuid not null references subcontracts(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,

  invoice_id  text not null,
  description text not null default '',

  status invoice_status not null default 'Draft',

  submitted_date date,
  certified_date date,
  payment_date   date,

  initiator text,
  vendor_id uuid references vendors(id) on delete restrict,

  total_amount     numeric(18,2) not null default 0,
  certified_amount numeric(18,2) not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  unique (subcontract_id, invoice_id)
);

create index invoices_project_idx     on invoices (project_id);
create index invoices_subcontract_idx on invoices (subcontract_id);
create index invoices_status_idx      on invoices (project_id, status);

create trigger invoices_set_updated_at
  before update on invoices
  for each row execute function set_updated_at();

-- ---------------------------------------------------------- invoice items ----

create table invoice_items (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  subcontract_line_item_id uuid references subcontract_line_items(id) on delete set null,

  item_no     text not null,
  description text not null default '',

  qty   numeric(18,4) not null default 0,
  unit  text,
  rate  numeric(18,4) not null default 0,
  total numeric(18,2) not null default 0,
  type  line_item_type,

  -- Cumulative claim
  claim_qty     numeric(18,4) not null default 0,
  claim_percent numeric(9,4)  not null default 0,
  claim_value   numeric(18,2) not null default 0,

  -- This-period claim
  periodic_claim_qty     numeric(18,4) not null default 0,
  periodic_claim_percent numeric(9,4)  not null default 0,
  periodic_claim_value   numeric(18,2) not null default 0,

  -- Cumulative certified
  certified_qty     numeric(18,4) not null default 0,
  certified_percent numeric(9,4)  not null default 0,
  certified_value   numeric(18,2) not null default 0,

  -- This-period certified
  periodic_certified_qty     numeric(18,4) not null default 0,
  periodic_certified_percent numeric(9,4)  not null default 0,
  periodic_certified_value   numeric(18,2) not null default 0,

  commentary text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoice_items_invoice_idx   on invoice_items (invoice_id, sort_order);
create index invoice_items_line_item_idx on invoice_items (subcontract_line_item_id);

create trigger invoice_items_set_updated_at
  before update on invoice_items
  for each row execute function set_updated_at();
