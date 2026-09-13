-- ============================================================================
-- Setting attributes across a selection, now that they are columns.
--
-- Five bulk functions each took p_enterprise_attributes and
-- p_project_attributes and merged them into a jsonb column. The patch shape
-- was right -- a form naturally produces {"01": "CIV", "03": "L3"}, keyed by
-- the slot the user was editing -- so it stays. What changes is where it
-- lands.
--
-- One function does it for every table rather than five doing it once each.
-- The table is checked against attribute_scopes, so it is a name a migration
-- wrote rather than anything a caller invented, and the patches arrive as
-- bound parameters.
--
-- A slot present in the patch is written; present but blank clears it; absent
-- is left alone. That is what lets one bulk edit set Discipline without
-- disturbing the other nine.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

create or replace function bulk_set_attributes(
  p_table      text,
  p_ids        uuid[],
  p_enterprise jsonb default null,
  p_project    jsonb default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  scope   attribute_scopes%rowtype;
  sets    text[] := '{}';
  i       integer;
  col     text;
  slot    text;
  touched integer := 0;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  select * into scope from attribute_scopes where table_name = p_table;
  if not found then
    raise exception '% does not carry attributes', p_table;
  end if;

  for i in 1 .. 10 loop
    slot := lpad(i::text, 2, '0');

    if p_enterprise is not null then
      col := 'ent_attr' || slot;
      sets := sets || format(
        '%1$I = case when $1 ? %2$L then nullif(btrim($1 ->> %2$L), '''') else %1$I end',
        col, slot);
    end if;

    if p_project is not null and scope.has_project_level then
      col := 'prj_attr' || slot;
      sets := sets || format(
        '%1$I = case when $2 ? %2$L then nullif(btrim($2 ->> %2$L), '''') else %1$I end',
        col, slot);
    end if;
  end loop;

  if array_length(sets, 1) is null then
    return 0;
  end if;

  execute format('update %I set %s, updated_at = now() where id = any($3)',
                 p_table, array_to_string(sets, ', '))
    using coalesce(p_enterprise, '{}'::jsonb),
          coalesce(p_project, '{}'::jsonb),
          p_ids;
  get diagnostics touched = row_count;

  return touched;
end;
$fn$;

revoke all on function bulk_set_attributes(text, uuid[], jsonb, jsonb) from public, anon;
grant execute on function bulk_set_attributes(text, uuid[], jsonb, jsonb) to authenticated;
