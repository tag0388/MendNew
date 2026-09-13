-- ============================================================================
-- Whatever the jsonb columns still hold, moved into the real ones.
--
-- At the time of writing no row in any of the twelve tables holds an attribute
-- value -- the feature was configured but never used -- so this is expected to
-- move nothing. It is written anyway, because "expected to" is not the same as
-- "will", and because rows may be written between this running and the code
-- that supersedes it being deployed.
--
-- It is additive and repeatable: a column already holding a value is left
-- alone, so running it twice changes nothing the second time, and it is safe
-- against both the old code and the new.
--
-- The jsonb columns are NOT dropped here. Deployed code still reads them, and
-- dropping them before that code is replaced would break the running app. That
-- is a separate migration, applied after the deploy.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

do $carry$
declare
  s      attribute_scopes%rowtype;
  i      integer;
  slot   text;
  sets   text[];
  moved  bigint;
  total  bigint := 0;
begin
  for s in select * from attribute_scopes loop
    -- projects never had the pair; its attributes live on the enterprise.
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = s.table_name
                      and column_name = 'enterprise_attributes') then
      continue;
    end if;

    sets := '{}';
    for i in 1 .. 10 loop
      slot := lpad(i::text, 2, '0');
      sets := sets || format(
        '%1$I = coalesce(%1$I, nullif(btrim(enterprise_attributes ->> %2$L), ''''))',
        'ent_attr' || slot, slot);
      if s.has_project_level then
        sets := sets || format(
          '%1$I = coalesce(%1$I, nullif(btrim(project_attributes ->> %2$L), ''''))',
          'prj_attr' || slot, slot);
      end if;
    end loop;

    execute format(
      'update %I set %s
        where coalesce(enterprise_attributes, ''{}''::jsonb) <> ''{}''::jsonb
           or coalesce(project_attributes, ''{}''::jsonb) <> ''{}''::jsonb',
      s.table_name, array_to_string(sets, ', '));
    get diagnostics moved = row_count;

    if moved > 0 then
      raise notice 'carried attributes on % row(s) of %', moved, s.table_name;
    end if;
    total := total + moved;
  end loop;

  raise notice 'attribute carry-over finished: % row(s) touched', total;
end
$carry$;
