-- ============================================================================
-- What each Bulk sheet may contain.
--
-- These rows ARE the allow-list. A column that is not named here cannot be
-- written by an import, which is how derived figures stay derived: someone
-- can type anything into an "Approved Budget" column in Excel and the import
-- will ignore it, because approved budget is maintained by the change-order
-- triggers and does not appear below. The same goes for a change order's
-- budget and EAC, a risk's exposure and impact totals, and a line item's
-- total -- all rolled up from their children or generated.
--
-- `type` is checked before anything is written: 'numeric' rejects text in a
-- number column, 'date' insists on YYYY-MM-DD, and 'enum:<name>' rejects a
-- value outside the list the database accepts, naming the allowed values in
-- the error so the user can fix the cell.
--
-- Labels match the headers the existing exports already write.
-- ============================================================================

insert into import_definitions
  (name, label, table_name, scope_column, key_column, key_label, columns, lookups,
   has_enterprise_attributes, has_project_attributes, has_user_defined, has_period_values)
values

-- ------------------------------------------------------------ cost codes --
-- The code is the key the user owns. Everything from Baseline Budget
-- rightwards on this table is derived, and so is absent here.
('cost_codes', 'Cost Codes', 'cost_codes', 'project_id', 'code', 'Cost Code ID',
 '[{"label":"Cost Code ID","column":"code","type":"text","required":true},
   {"label":"Cost Code Name","column":"name","type":"text"},
   {"label":"EAC Method","column":"eac_method","type":"enum:eac_method"},
   {"label":"Activity ID","column":"activity_id","type":"text"},
   {"label":"Planned Start Date","column":"planned_start_date","type":"date"},
   {"label":"Planned End Date","column":"planned_end_date","type":"date"}]'::jsonb,
 '{}'::jsonb, true, true, false, false),

-- ----------------------------------------------------------- ETC details --
-- Thousands of lines per cost code and no business key of their own, so an
-- import appends unless the user asks for a replacement.
('etc_details', 'ETC Details', 'etc_details', 'project_id', null, null,
 '[{"label":"Item","column":"item","type":"text","required":true},
   {"label":"Description","column":"description","type":"text"},
   {"label":"Category","column":"category","type":"text"},
   {"label":"Order Number","column":"order_number","type":"text"},
   {"label":"Activity ID","column":"activity_id","type":"text"},
   {"label":"Qty","column":"qty","type":"numeric"},
   {"label":"Unit","column":"unit","type":"text"},
   {"label":"Rate","column":"rate","type":"numeric"},
   {"label":"Phasing Method","column":"phasing_method","type":"enum:etc_phasing_method"},
   {"label":"Phasing Unit","column":"phasing_unit","type":"enum:etc_phasing_unit"},
   {"label":"Phasing Qty","column":"phasing_qty","type":"numeric"},
   {"label":"Phasing Start Date","column":"phasing_start_date","type":"date"},
   {"label":"Phasing End Date","column":"phasing_end_date","type":"date"}]'::jsonb,
 '{"Cost Code ID":{"column":"cost_code_id","table":"cost_codes","match":"code",
                   "scope":"project_id","required":true,
                   "message":"is not a cost code in this project"}}'::jsonb,
 true, true, true, true),

-- ---------------------------------------------------------- actual costs --
-- Transactions. Two identical rows are two transactions, so this appends.
('actual_costs', 'Actual Cost', 'actual_costs', 'project_id', null, null,
 '[{"label":"Item","column":"item","type":"text"},
   {"label":"Description","column":"description","type":"text"},
   {"label":"Cost","column":"cost","type":"numeric","required":true},
   {"label":"Source","column":"source","type":"enum:actual_cost_source"}]'::jsonb,
 '{"Cost Code ID":{"column":"cost_code_id","table":"cost_codes","match":"code",
                   "scope":"project_id","required":true,
                   "message":"is not a cost code in this project"},
   "Reporting Period":{"column":"reporting_period_id","table":"reporting_periods",
                       "match":"name","scope":"project_id","required":true,
                       "message":"is not a reporting period of this project"}}'::jsonb,
 true, true, false, false),

-- ------------------------------------------------------- baseline budget --
('baseline_budgets', 'Baseline Budget', 'baseline_budgets', 'project_id', null, null,
 '[{"label":"Item","column":"item","type":"text"},
   {"label":"Description","column":"description","type":"text"},
   {"label":"Amount","column":"amount","type":"numeric","required":true},
   {"label":"Source","column":"source","type":"text"}]'::jsonb,
 '{"Cost Code ID":{"column":"cost_code_id","table":"cost_codes","match":"code",
                   "scope":"project_id","required":true,
                   "message":"is not a cost code in this project"},
   "Reporting Period":{"column":"reporting_period_id","table":"reporting_periods",
                       "match":"name","scope":"project_id","required":true,
                       "message":"is not a reporting period of this project"}}'::jsonb,
 true, true, false, false),

-- --------------------------------------------------------- change orders --
-- budget and eac are rolled up from the change records, so they are not here.
('changes', 'Change Orders', 'changes', 'project_id', 'change_id', 'Change ID',
 '[{"label":"Change ID","column":"change_id","type":"text","required":true},
   {"label":"Description","column":"description","type":"text"},
   {"label":"Type","column":"type","type":"text"},
   {"label":"Status","column":"status","type":"enum:change_status"},
   {"label":"Initiator","column":"initiator","type":"text"},
   {"label":"Reference","column":"reference","type":"text"}]'::jsonb,
 '{}'::jsonb, true, true, false, false),

-- -------------------------------------------------------- change records --
-- One change order may carry several lines against the same cost code, so
-- these append rather than matching on anything.
('change_records', 'Change Records', 'change_records', 'project_id', null, null,
 '[{"label":"Scope","column":"scope","type":"text"},
   {"label":"Budget Amount","column":"budget_amount","type":"numeric"},
   {"label":"EAC Amount","column":"eac_amount","type":"numeric"}]'::jsonb,
 '{"Change ID":{"column":"change_id","table":"changes","match":"change_id",
                "scope":"project_id","required":true,
                "message":"is not a change order in this project"},
   "Cost Code ID":{"column":"cost_code_id","table":"cost_codes","match":"code",
                   "scope":"project_id","required":true,
                   "message":"is not a cost code in this project"}}'::jsonb,
 true, true, false, false),

-- ----------------------------------------------------------------- risks --
-- The impact totals and exposure are rolled up from the risk records.
('risks', 'Risks', 'risks', 'project_id', 'risk_id', 'Risk ID',
 '[{"label":"Risk ID","column":"risk_id","type":"text","required":true},
   {"label":"Description","column":"description","type":"text"},
   {"label":"Type","column":"type","type":"text"},
   {"label":"Status","column":"status","type":"enum:risk_status"},
   {"label":"Strategy","column":"strategy","type":"enum:risk_strategy"},
   {"label":"Initiator","column":"initiator","type":"text"},
   {"label":"Reference","column":"reference","type":"text"},
   {"label":"Mitigation","column":"mitigation","type":"text"}]'::jsonb,
 '{}'::jsonb, true, true, false, false),

-- ---------------------------------------------------------- risk records --
-- beta_pert_impact_amount is generated from the three impacts, so it is not
-- importable; type the three and the database works it out.
('risk_records', 'Risk Records', 'risk_records', 'project_id', null, null,
 '[{"label":"Scope","column":"scope","type":"text"},
   {"label":"Probability","column":"probability","type":"numeric"},
   {"label":"Min Impact","column":"min_impact_amount","type":"numeric"},
   {"label":"Most Likely Impact","column":"most_likely_impact_amount","type":"numeric"},
   {"label":"Max Impact","column":"max_impact_amount","type":"numeric"}]'::jsonb,
 '{"Risk ID":{"column":"risk_id","table":"risks","match":"risk_id",
              "scope":"project_id","required":true,
              "message":"is not a risk in this project"},
   "Cost Code ID":{"column":"cost_code_id","table":"cost_codes","match":"code",
                   "scope":"project_id","required":true,
                   "message":"is not a cost code in this project"}}'::jsonb,
 true, true, false, false),

-- ------------------------------------------------ subcontract line items --
-- Scoped to one subcontract and keyed by the item number within it, so a
-- re-import of an edited sheet updates rather than duplicating. `total` is a
-- generated column and cannot be imported.
('subcontract_line_items', 'Subcontract Line Items', 'subcontract_line_items',
 'subcontract_id', 'item_no', 'Item No',
 '[{"label":"Item No","column":"item_no","type":"text","required":true},
   {"label":"Description","column":"description","type":"text"},
   {"label":"Activity ID","column":"activity_id","type":"text"},
   {"label":"Qty","column":"qty","type":"numeric"},
   {"label":"Unit","column":"unit","type":"text"},
   {"label":"Rate","column":"rate","type":"numeric"},
   {"label":"Type","column":"type","type":"enum:line_item_type"},
   {"label":"Status","column":"status","type":"enum:line_item_status"},
   {"label":"Phasing Source","column":"phasing_source","type":"enum:phasing_source"},
   {"label":"Distribution","column":"distribution","type":"enum:distribution_curve"},
   {"label":"Item Date","column":"item_date","type":"date"},
   {"label":"Start Date","column":"start_date","type":"date"},
   {"label":"End Date","column":"end_date","type":"date"},
   {"label":"Note","column":"note","type":"text"}]'::jsonb,
 '{}'::jsonb, true, true, true, true),

-- -------------------------------------------------------- schedule items --
('schedule_items', 'Time Schedule', 'schedule_items', 'project_id',
 'activity_id', 'Activity ID',
 '[{"label":"Activity ID","column":"activity_id","type":"text","required":true},
   {"label":"Description","column":"description","type":"text"},
   {"label":"Activity % Complete","column":"activity_percent_complete","type":"numeric"},
   {"label":"Baseline Start Date","column":"baseline_start_date","type":"date"},
   {"label":"Baseline End Date","column":"baseline_end_date","type":"date"},
   {"label":"Planned Start Date","column":"planned_start_date","type":"date"},
   {"label":"Planned End Date","column":"planned_end_date","type":"date"},
   {"label":"Current Start Date","column":"current_start_date","type":"date"},
   {"label":"Current End Date","column":"current_end_date","type":"date"}]'::jsonb,
 '{}'::jsonb, false, false, false, false),

-- -------------------------------------------------- procurement packages --
-- step_data holds the dates, which recalculate_procurement_dates owns, so
-- the sheet carries the package itself and the schedule is worked out after.
('procurement_items', 'Procurement Packages', 'procurement_items', 'project_id',
 'package_id', 'Package ID',
 '[{"label":"Package ID","column":"package_id","type":"text","required":true},
   {"label":"Description","column":"description","type":"text"},
   {"label":"Category","column":"category","type":"text"}]'::jsonb,
 '{"Calendar":{"column":"calendar_id","table":"calendars","match":"name",
               "scope":"project_id","required":false,
               "message":"is not a calendar of this project"}}'::jsonb,
 true, true, false, false)

on conflict (name) do update set
  label        = excluded.label,
  table_name   = excluded.table_name,
  scope_column = excluded.scope_column,
  key_column   = excluded.key_column,
  key_label    = excluded.key_label,
  columns      = excluded.columns,
  lookups      = excluded.lookups,
  has_enterprise_attributes = excluded.has_enterprise_attributes,
  has_project_attributes    = excluded.has_project_attributes,
  has_user_defined          = excluded.has_user_defined,
  has_period_values         = excluded.has_period_values,
  updated_at   = now();

-- A safety net for the allow-list: every column named above must actually
-- exist on its table, with the type claimed. A typo here would otherwise
-- surface as a failed import in front of a user.
do $check$
declare
  bad text;
begin
  select string_agg(format('%s.%s (%s)', d.table_name, c."column", c.type), ', ')
    into bad
    from import_definitions d
    cross join lateral jsonb_to_recordset(d.columns)
      as c(label text, "column" text, type text, required boolean)
   where not exists (
     select 1 from information_schema.columns ic
      where ic.table_schema = 'public'
        and ic.table_name = d.table_name
        and ic.column_name = c."column");
  if bad is not null then
    raise exception 'Import definitions name columns that do not exist: %', bad;
  end if;

  select string_agg(format('%s -> %s.%s', d.name, l.value ->> 'table', l.value ->> 'match'), ', ')
    into bad
    from import_definitions d
    cross join lateral jsonb_each(d.lookups) l
   where not exists (
     select 1 from information_schema.columns ic
      where ic.table_schema = 'public'
        and ic.table_name = l.value ->> 'table'
        and ic.column_name = l.value ->> 'match');
  if bad is not null then
    raise exception 'Import lookups point at columns that do not exist: %', bad;
  end if;
end
$check$;
