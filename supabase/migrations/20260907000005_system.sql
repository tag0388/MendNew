-- ============================================================================
-- Mend Cost Management -- System tables
-- Saved views, audit log, invitations
--
-- The Firestore `sheets` collection and its `rows` subcollection are
-- deliberately not carried over: the forecast-sheet feature is not in use.
-- ============================================================================

-- ------------------------------------------------------------ saved views ----
-- Per-user grid layouts. gridState is AG Grid's own opaque state blob.

create table saved_views (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,

  name     text not null check (length(name) between 1 and 100),
  table_id text not null,
  columns  text[] not null default '{}',
  grid_state jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, table_id, name)
);

create index saved_views_user_table_idx on saved_views (user_id, table_id);

create trigger saved_views_set_updated_at
  before update on saved_views
  for each row execute function set_updated_at();

-- -------------------------------------------------------------- audit log ----
-- Append-only. No updated_at trigger and no update/delete policy later.

create table audit_logs (
  id            bigint generated always as identity primary key,
  enterprise_id uuid references enterprises(id) on delete set null,
  project_id    uuid references projects(id) on delete set null,
  user_id       uuid references auth.users(id) on delete set null,
  user_email    text,
  action        text not null,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index audit_logs_enterprise_idx on audit_logs (enterprise_id, created_at desc);
create index audit_logs_project_idx    on audit_logs (project_id, created_at desc);

-- ------------------------------------------------------------ invitations ----
-- NOTE: the Firestore rule was `allow read: if isAuthenticated()`, which let any
-- signed-in user read every pending invitation token in the system. Here the
-- token is unique and indexed, and the RLS policies (next migration) restrict
-- reads to the invited address or an admin of the inviting enterprise.

create table invitations (
  id            uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null references enterprises(id) on delete cascade,
  email         text not null,
  token         text not null unique,
  status        invitation_status not null default 'pending',
  role          enterprise_role not null default 'Enterprise User',
  invited_by    uuid references auth.users(id) on delete set null,
  accepted_by   uuid references auth.users(id) on delete set null,
  accepted_at   timestamptz,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index invitations_email_idx      on invitations (lower(email), status);
create index invitations_enterprise_idx on invitations (enterprise_id, status);

create trigger invitations_set_updated_at
  before update on invitations
  for each row execute function set_updated_at();
