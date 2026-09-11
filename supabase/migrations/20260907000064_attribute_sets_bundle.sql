-- ============================================================================
-- Every attribute set for one enterprise, or one project, in a single call.
--
-- fetchEnterprise already hangs vendors and resource rates off the enterprise
-- object, because that is the shape the screens read. Attributes now arrive
-- the same way: one round trip returns all nine categories keyed by the names
-- the app has always used, so nothing downstream has to know that an
-- attribute stopped being a jsonb array.
--
-- Nine calls to attribute_set would have done the same thing nine times over,
-- on every page load.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

create or replace function attribute_sets(
  p_enterprise_id uuid,
  p_project_id    uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $fn$
  select coalesce(jsonb_object_agg(k.app_key, k.slots), '{}'::jsonb)
    from (
      select case d.category
               when 'project'     then 'projectAttributes'
               when 'cost_code'   then 'costCodeAttributes'
               when 'line_item'   then 'lineItemAttributes'
               when 'change'      then 'changeAttributes'
               when 'risk'        then 'riskAttributes'
               when 'subcontract' then 'subcontractAttributes'
               when 'procurement' then 'procurementAttributes'
               when 'progress'    then 'progressAttributes'
               when 'schedule'    then 'scheduleAttributes'
             end as app_key,
             jsonb_agg(
               jsonb_build_object(
                 'id',     d.attribute_number,
                 'title',  d.title,
                 'values', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id',          v.code,
                            'description', v.description,
                            'sortOrder',   v.sort_order)
                          order by v.sort_order, v.code)
                     from attribute_values v where v.definition_id = d.id), '[]'::jsonb))
               order by d.attribute_number) as slots
        from attribute_definitions d
       where (p_project_id is null
                and d.project_id is null and d.enterprise_id = p_enterprise_id)
          or (p_project_id is not null and d.project_id = p_project_id)
       group by d.category
    ) k;
$fn$;

revoke all on function attribute_sets(uuid, uuid) from public, anon;
grant execute on function attribute_sets(uuid, uuid) to authenticated;
