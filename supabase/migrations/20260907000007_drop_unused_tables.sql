-- ============================================================================
-- Drop tables created in the first schema pass that the app does not need.
--
-- cost_elements / project_cost_elements were modelled as tables, but in the
-- original app cost elements lived as an embedded array on the enterprise and
-- project documents rather than as a collection of their own.
--
-- Guarded with IF EXISTS so this is a no-op against a database built from the
-- current migrations, which no longer create them.
-- ============================================================================

drop table if exists project_cost_elements;
drop table if exists cost_elements;
drop table if exists period_snapshots;
