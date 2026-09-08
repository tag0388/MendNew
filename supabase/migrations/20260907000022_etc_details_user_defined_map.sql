-- ============================================================================
-- etc_details carried udf1..udf4, which was a mistake on this table.
--
-- Those four fixed text columns belong to resource rates, where the grid shows
-- exactly "UDF 1..3" and nothing else. The ETC grid does something different:
-- it offers five NUMERIC and five TEXT user-defined columns, addressed as
-- userDefined.num1..num5 and userDefined.text1..text5 -- an open map, and one
-- that mixes types. Four text columns cannot hold it, and nothing in the app
-- ever read etc_details.udf1..udf4.
--
-- So this is the same call already made for enterprise_attributes,
-- project_attributes and period_values: a map is jsonb.
--
-- The columns are dropped rather than left in place because a column nothing
-- writes and nothing reads is a trap for the next person: it looks like the
-- place UDFs live. Checked empty (0 rows in the table) before dropping.
-- ============================================================================

alter table etc_details
  add column if not exists user_defined jsonb not null default '{}'::jsonb;

alter table etc_details
  drop column if exists udf1,
  drop column if exists udf2,
  drop column if exists udf3,
  drop column if exists udf4;
