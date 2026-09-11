-- ============================================================================
-- Project-level procurement defaults.
--
-- The Procurement Step Configuration screen saves a default calendar, a
-- default duration per step and default attribute values, which the app kept
-- on the project document as `procurementDefaults`. The column was never
-- carried over, so the screen had nowhere to save to.
--
-- A jsonb column is the right shape, the same as the attribute lists: it is a
-- small settings blob read as a whole, and nothing aggregates over it.
--
-- Shape: { "calendarId": uuid|"", "stepDurations": {stepId: days},
--          "attributeValues": {attributeId: value} }
-- ============================================================================

alter table projects
  add column if not exists procurement_defaults jsonb not null default '{}'::jsonb;

alter table projects drop constraint if exists projects_procurement_defaults_is_object;
alter table projects add constraint projects_procurement_defaults_is_object
  check (jsonb_typeof(procurement_defaults) = 'object');
