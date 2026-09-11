-- ============================================================================
-- Indexes that match the orderings the grids actually ask for.
--
-- Every grid fetch filters on a parent and asks the database to order the
-- result. Where the existing index covered only the filter, Postgres had to
-- sort what it found -- fine at three rows, a sort of hundreds of thousands
-- at the scale this app is built for. These make the ordering part of the
-- index so the rows come back already in order, which also lets a future
-- keyset page start mid-list without counting from the top.
--
-- Nothing here changes behaviour; they are pure read paths.
-- ============================================================================

-- The ETC grid: one cost code's detail lines, in sort order. Thousands of
-- lines per cost code is the expected case.
create index if not exists etc_details_cost_code_order_idx
  on etc_details (cost_code_id, sort_order, created_at);

-- The whole project's ETC, same ordering, for the Bulk ETC Details grid.
create index if not exists etc_details_project_order_idx
  on etc_details (project_id, sort_order, created_at);

-- Actual cost is the biggest table in the system -- hundreds of thousands of
-- transactions in one project -- and is read newest-first, per project and
-- per cost code.
create index if not exists actual_costs_project_recent_idx
  on actual_costs (project_id, created_at desc);
create index if not exists actual_costs_cost_code_recent_idx
  on actual_costs (cost_code_id, created_at desc);

-- Both of these are read per period when a period is closed or rolled.
create index if not exists actual_costs_period_idx
  on actual_costs (reporting_period_id);
create index if not exists baseline_budgets_period_idx
  on baseline_budgets (reporting_period_id);

-- Cost phasing is read per cost code across every period of a project.
create index if not exists cost_phasing_cost_code_idx
  on cost_phasing (cost_code_id);

-- The change and risk registers are read by their parent record, oldest
-- first. Neither table carries a sort_order column, so created_at is the
-- ordering the grids actually get.
create index if not exists change_records_change_order_idx
  on change_records (change_id, created_at);
create index if not exists change_records_project_order_idx
  on change_records (project_id, created_at);
create index if not exists risk_records_risk_order_idx
  on risk_records (risk_id, created_at);
create index if not exists risk_records_project_order_idx
  on risk_records (project_id, created_at);
