-- ============================================================================
-- Mend Cost Management -- Foundation
-- Extensions, enums, shared helpers, tenancy (enterprises / projects / members)
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums ----
-- Values mirror the string unions in src/types.ts verbatim so that the
-- generated TypeScript types line up with the existing frontend unions.

create type project_status      as enum ('Active','On Hold','Closed','Archived');
create type enterprise_role     as enum ('Enterprise System Admin','Enterprise User');
create type project_role        as enum ('Project Admin','Project User');
create type theme_choice        as enum ('light','dark');

create type forecast_method     as enum ('commitment','time-based');
create type distribution_method as enum ('manual','even','front','back','bell');

create type eac_method          as enum ('Manual','Change Management','ETC Details','Sub-Contract Management');

create type subcontract_status  as enum ('Active','Complete','On Hold');
create type payment_type        as enum ('LumpSum','Schedule of Rates','Re-measurable');
create type line_item_type      as enum ('Original','ChangeOrder');
create type line_item_status    as enum ('Approved','Pending','Forecast','Rejected');
create type invoice_status      as enum ('Draft','Submitted','Certified','Rejected','Paid');
create type phasing_source      as enum ('Manual','Auto');
create type distribution_curve  as enum ('Even','Bell Curve','Front load','Back load','S-Curve','Profile');

create type change_status       as enum ('Approved','Pending','Rejected','Withdrawn');
create type risk_status         as enum ('Open','Mitigated','Closed','Realized');
create type risk_strategy       as enum ('Avoid','Mitigate','Transfer','Accept');

create type etc_phasing_method  as enum ('Manual','Auto-Phase');
create type etc_phasing_unit    as enum ('Daily','Weekly','Monthly','Total','Profile');
create type progress_phasing_method as enum ('Auto','Manual');
create type progress_phasing_curve  as enum ('Scurve','Bell','front load','back load','even');

create type period_kind         as enum ('cost','progress');
create type period_status       as enum ('open','closed');
create type period_duration     as enum ('week','month');

create type invitation_status   as enum ('pending','accepted','revoked','expired');

-- -------------------------------------------------------------- helpers ----

-- Keeps updated_at honest without every caller having to remember it.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------- user profiles ----
-- Mirrors auth.users so the app can display names/avatars and join on them.
-- Replaces the Firebase UserProfile shape.

create table user_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  photo_url    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index user_profiles_email_idx on user_profiles (lower(email));

create trigger user_profiles_set_updated_at
  before update on user_profiles
  for each row execute function set_updated_at();

-- Auto-create a profile row whenever someone signs up.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, display_name, photo_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name',
             new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'photo_url',
             new.raw_user_meta_data->>'avatar_url')
  )
  on conflict (id) do update
    set email      = excluded.email,
        display_name = coalesce(user_profiles.display_name, excluded.display_name),
        photo_url    = coalesce(user_profiles.photo_url, excluded.photo_url);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------ platform admins ----
-- Replaces the hardcoded email check in App.tsx (isSystemOwner).
create table platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id)
);

-- ---------------------------------------------------------- enterprises ----

create table enterprises (
  id              uuid primary key default gen_random_uuid(),
  enterprise_code text not null unique,          -- was Enterprise.enterpriseId
  name            text not null,
  logo_url        text,
  theme           theme_choice,

  -- Open-ended admin-configured attribute definitions. Each is an array of
  -- { id, title, values: [{ id, description, sortOrder }] } -- edited wholesale
  -- in EnterpriseAdmin, so JSONB rather than child tables.
  project_attributes     jsonb not null default '[]'::jsonb,
  line_item_attributes   jsonb not null default '[]'::jsonb,
  cost_code_attributes   jsonb not null default '[]'::jsonb,
  subcontract_attributes jsonb not null default '[]'::jsonb,
  change_attributes      jsonb not null default '[]'::jsonb,
  risk_attributes        jsonb not null default '[]'::jsonb,
  procurement_attributes jsonb not null default '[]'::jsonb,
  progress_attributes    jsonb not null default '[]'::jsonb,

  change_types     text[] not null default '{}',
  risk_types       text[] not null default '{}',
  categories       text[] not null default '{}',
  control_accounts text[] not null default '{}',
  order_numbers    text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create trigger enterprises_set_updated_at
  before update on enterprises
  for each row execute function set_updated_at();

-- Enterprise.users map + adminUsers array, normalised. RLS depends on this
-- being a flat table rather than a nested map.
create table enterprise_members (
  enterprise_id uuid not null references enterprises(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          enterprise_role not null default 'Enterprise User',
  joined_at     timestamptz not null default now(),
  primary key (enterprise_id, user_id)
);

create index enterprise_members_user_idx on enterprise_members (user_id);

-- Enterprise-level reference data that was embedded on the enterprise doc.

create table resource_rates (
  id            uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null references enterprises(id) on delete cascade,
  name          text not null,
  unit          text not null,
  rate          numeric(18,4),
  category      text,
  udf1          text,
  udf2          text,
  udf3          text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index resource_rates_enterprise_idx on resource_rates (enterprise_id);

create trigger resource_rates_set_updated_at
  before update on resource_rates
  for each row execute function set_updated_at();

create table vendors (
  id            uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null references enterprises(id) on delete cascade,
  name          text not null,
  code          text,
  contact_name  text,
  contact_email text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index vendors_enterprise_idx on vendors (enterprise_id);

create trigger vendors_set_updated_at
  before update on vendors
  for each row execute function set_updated_at();

-- ------------------------------------------------------------- projects ----

create table projects (
  id            uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null references enterprises(id) on delete cascade,
  project_name  text not null,
  project_code  text not null,
  status        project_status not null default 'Active',

  project_budget numeric(18,2) not null default 0,
  start_date     date,
  end_date       date,
  cutoff_date    date,

  photo_url            text,
  scope_description    text,
  client_name          text,
  project_manager_name text,

  -- Values chosen against the enterprise attribute definitions: attrId -> valueId
  attributes jsonb not null default '{}'::jsonb,

  -- Project-level overrides of the enterprise attribute definitions.
  cost_code_attributes   jsonb not null default '[]'::jsonb,
  subcontract_attributes jsonb not null default '[]'::jsonb,
  change_attributes      jsonb not null default '[]'::jsonb,
  risk_attributes        jsonb not null default '[]'::jsonb,
  procurement_attributes jsonb not null default '[]'::jsonb,
  progress_attributes    jsonb not null default '[]'::jsonb,
  line_item_attributes   jsonb not null default '[]'::jsonb,

  change_types     text[] not null default '{}',
  risk_types       text[] not null default '{}',
  categories       text[] not null default '{}',
  control_accounts text[] not null default '{}',
  order_numbers    text[] not null default '{}',

  -- { calendarId, stepDurations: {stepId: days}, attributeValues: {attrId: valueId} }
  procurement_defaults jsonb not null default '{}'::jsonb,

  first_cost_reporting_month text,
  current_reporting_month    text,
  last_reporting_month       text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  created_by_email text,
  modified_by      uuid references auth.users(id),
  modified_by_email text,

  unique (enterprise_id, project_code)
);

create index projects_enterprise_idx on projects (enterprise_id);

create trigger projects_set_updated_at
  before update on projects
  for each row execute function set_updated_at();

-- Project.users map, normalised.
create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       project_role not null default 'Project User',
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on project_members (user_id);

create table project_resource_rates (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects(id) on delete cascade,
  name                 text not null,
  unit                 text not null,
  rate                 numeric(18,4),
  category             text,
  udf1                 text,
  udf2                 text,
  udf3                 text,
  sort_order           integer not null default 0,
  enterprise_rate_id   uuid references resource_rates(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index project_resource_rates_project_idx on project_resource_rates (project_id);

create trigger project_resource_rates_set_updated_at
  before update on project_resource_rates
  for each row execute function set_updated_at();

-- ----------------------------------------------------- reporting periods ----
-- Was Project.reportingPeriods / Project.progressPeriods (embedded objects)
-- plus the progressReportingPeriods collection. Unified into one table with a
-- kind discriminator, because period ids are referenced as JSONB map keys by
-- every time-phased record in the system and need stable identity.

create table reporting_periods (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  kind        period_kind not null,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  status      period_status not null default 'open',
  sort_order  integer not null default 0,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, kind, name)
);

create index reporting_periods_project_kind_idx
  on reporting_periods (project_id, kind, sort_order);

-- At most one current period per project per kind.
create unique index reporting_periods_one_current_idx
  on reporting_periods (project_id, kind)
  where is_current;

create trigger reporting_periods_set_updated_at
  before update on reporting_periods
  for each row execute function set_updated_at();

-- Period generation settings that lived alongside the embedded period arrays.
create table reporting_period_settings (
  project_id        uuid not null references projects(id) on delete cascade,
  kind              period_kind not null,
  base_date         date,
  duration          period_duration not null default 'month',
  number_of_periods integer not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (project_id, kind)
);

create trigger reporting_period_settings_set_updated_at
  before update on reporting_period_settings
  for each row execute function set_updated_at();

-- ------------------------------------------------------------ calendars ----
-- Belongs to either an enterprise or a project (the Firestore rule allowed
-- both), so exactly one owner is enforced here.

create table calendars (
  id            uuid primary key default gen_random_uuid(),
  enterprise_id uuid references enterprises(id) on delete cascade,
  project_id    uuid references projects(id) on delete cascade,
  name          text not null check (length(name) between 1 and 100),
  weekends      integer[] not null default '{}',   -- 0=Sun .. 6=Sat
  holidays      date[]    not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint calendars_single_owner check (
    (enterprise_id is not null and project_id is null) or
    (enterprise_id is null and project_id is not null)
  )
);

create index calendars_enterprise_idx on calendars (enterprise_id);
create index calendars_project_idx    on calendars (project_id);

create trigger calendars_set_updated_at
  before update on calendars
  for each row execute function set_updated_at();
