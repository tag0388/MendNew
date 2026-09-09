-- ============================================================================
-- Cost elements.
--
-- The first schema pass modelled these as tables, and 20260907000007 dropped
-- them again on the grounds that the app carried them as an embedded array --
-- but never gave them a column to live in, so the Project Cost Elements screen
-- had nowhere to save to.
--
-- A jsonb array is the right shape here, and the same one the attribute lists
-- already use: a project has a few dozen cost elements, they are settings
-- rather than transactions, and they are always read as a whole list. Nothing
-- aggregates over them, so there is nothing for the database to compute.
--
-- Shape: [{ "id", "description", "sortCode", "enterpriseCostElementId"? }]
-- (enterpriseCostElementId only on the project's, naming the enterprise
-- element it maps to.)
-- ============================================================================

alter table enterprises add column if not exists cost_elements jsonb not null default '[]'::jsonb;
alter table projects    add column if not exists cost_elements jsonb not null default '[]'::jsonb;

-- The lists are read whole, so an array is enough; these guard against a
-- single malformed write turning the screen into an error.
alter table enterprises drop constraint if exists enterprises_cost_elements_is_array;
alter table enterprises add constraint enterprises_cost_elements_is_array
  check (jsonb_typeof(cost_elements) = 'array');

alter table projects drop constraint if exists projects_cost_elements_is_array;
alter table projects add constraint projects_cost_elements_is_array
  check (jsonb_typeof(cost_elements) = 'array');
