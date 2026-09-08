-- ============================================================================
-- Writing calculated phasing back onto existing ETC rows.
--
-- Auto-phasing recalculates two columns on rows that already exist. The client
-- was doing that with an upsert, which is INSERT ... ON CONFLICT -- and
-- Postgres checks NOT NULL on the proposed insert row BEFORE it looks for a
-- conflict. So sending only {id, period_values, qty} failed with
--
--   null value in column "item" violates not-null constraint
--
-- even though the row existed and only needed updating. That is the error the
-- Calculate button reported.
--
-- An UPDATE ... FROM over the supplied rows is what was actually meant: it
-- touches only these two columns, leaves every other column alone, and does
-- the whole batch in one statement so a partial failure cannot leave some
-- rows phased and others not.
--
-- SECURITY INVOKER, so the etc_details UPDATE policy still decides which rows
-- the caller may write. Rows they may not write are simply not updated, and
-- the returned count says how many actually were.
-- ============================================================================

create or replace function apply_etc_phasing(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated integer;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  update etc_details e
     set period_values = coalesce(r.period_values, '{}'::jsonb),
         qty           = coalesce(r.qty, 0),
         updated_at    = now()
    from (
      select (value ->> 'id')::uuid          as id,
             value -> 'periodValues'         as period_values,
             (value ->> 'qty')::numeric      as qty
        from jsonb_array_elements(p_rows)
    ) r
   where e.id = r.id;

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function apply_etc_phasing(jsonb) from public, anon;
grant execute on function apply_etc_phasing(jsonb) to authenticated;
