-- ============================================================================
-- Merging attribute maps into risks and risk records.
--
-- Same reason as merge_change_attributes: the grids name their attribute
-- columns with Firestore's dotted path ("enterpriseAttributes.<id>"), which is
-- a merge instruction in Firestore and not a column name anywhere in SQL.
-- Sending the whole map instead would be a read-modify-write of whatever the
-- browser is holding, so two people editing different attributes of the same
-- risk would overwrite each other. Merging server-side cannot.
--
-- Plain PostgreSQL: jsonb ||. See ARCHITECTURE.md.
-- ============================================================================

create or replace function merge_risk_attributes(
  p_risk_ids uuid[],
  p_enterprise_attributes jsonb default null,
  p_project_attributes jsonb default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  update risks
     set enterprise_attributes = enterprise_attributes || coalesce(p_enterprise_attributes, '{}'::jsonb),
         project_attributes    = project_attributes    || coalesce(p_project_attributes, '{}'::jsonb),
         updated_at = now()
   where id = any (p_risk_ids);

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function merge_risk_attributes(uuid[], jsonb, jsonb) from public, anon;
grant execute on function merge_risk_attributes(uuid[], jsonb, jsonb) to authenticated;

create or replace function merge_risk_record_attributes(
  p_record_ids uuid[],
  p_enterprise_attributes jsonb default null,
  p_project_attributes jsonb default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  update risk_records
     set enterprise_attributes = enterprise_attributes || coalesce(p_enterprise_attributes, '{}'::jsonb),
         project_attributes    = project_attributes    || coalesce(p_project_attributes, '{}'::jsonb),
         updated_at = now()
   where id = any (p_record_ids);

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function merge_risk_record_attributes(uuid[], jsonb, jsonb) from public, anon;
grant execute on function merge_risk_record_attributes(uuid[], jsonb, jsonb) to authenticated;
