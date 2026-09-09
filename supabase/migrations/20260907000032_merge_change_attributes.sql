-- ============================================================================
-- Merging attribute maps into changes.
--
-- The change grid edits one attribute at a time. Firestore expressed that as a
-- dotted field path ("enterpriseAttributes.<id>"), which merged into the stored
-- map. SQL has no such path, and PostgREST cannot express jsonb's || operator
-- in an update, so an attribute edit has to come through a function.
--
-- Sending the whole map instead would be a read-modify-write of what the
-- browser happens to be holding: two people editing different attributes of the
-- same change would overwrite each other. Merging server-side cannot.
--
-- Standard PostgreSQL: jsonb || jsonb, no Supabase-specific feature. See
-- ARCHITECTURE.md.
-- ============================================================================

create or replace function merge_change_attributes(
  p_change_ids uuid[],
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
  update changes
     set enterprise_attributes = enterprise_attributes || coalesce(p_enterprise_attributes, '{}'::jsonb),
         project_attributes    = project_attributes    || coalesce(p_project_attributes, '{}'::jsonb),
         updated_at = now()
   where id = any (p_change_ids);

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function merge_change_attributes(uuid[], jsonb, jsonb) from public, anon;
grant execute on function merge_change_attributes(uuid[], jsonb, jsonb) to authenticated;
