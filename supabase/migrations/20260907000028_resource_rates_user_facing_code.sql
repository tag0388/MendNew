-- ============================================================================
-- Resources need a code people type, separate from the row's uuid.
--
-- In the document model a resource's identifier WAS its user-facing code --
-- "LAB-01", "EXC-360" -- typed by the user and used as the document key. The
-- grids show it as "Resource ID", the Excel import reads it from an "ID"
-- column, and picking a resource in ETC Details copies it into the line's Item
-- so a forecast line reads "LAB-01 / Senior Engineer".
--
-- Moving to rows made the primary key a uuid, which left that code with
-- nowhere to live: the ETC Item column would have been filled with
-- "a3f1c2e8-...". This adds it back as its own column, which is what it always
-- was semantically -- a business identifier, not a row identity.
--
-- Unique per owner, so two enterprise resources cannot share a code and a
-- project cannot define the same code twice. Projects and the enterprise are
-- separate namespaces on purpose: a project may deliberately redefine
-- "LAB-01" with its own rate, and the ETC picker shows which library a row
-- came from.
--
-- Both tables are empty, so the column goes in NOT NULL with no backfill.
-- ============================================================================

alter table resource_rates
  add column if not exists code text not null default '';

alter table project_resource_rates
  add column if not exists code text not null default '';

-- The default exists only to satisfy the NOT NULL on any pre-existing row;
-- a blank code is not a valid resource, so it must not stay available as one.
alter table resource_rates alter column code drop default;
alter table project_resource_rates alter column code drop default;

alter table resource_rates
  add constraint resource_rates_code_not_blank check (length(btrim(code)) > 0);
alter table project_resource_rates
  add constraint project_resource_rates_code_not_blank check (length(btrim(code)) > 0);

create unique index if not exists resource_rates_enterprise_code_key
  on resource_rates (enterprise_id, code);
create unique index if not exists project_resource_rates_project_code_key
  on project_resource_rates (project_id, code);
