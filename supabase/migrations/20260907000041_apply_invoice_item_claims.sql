-- ============================================================================
-- Applying many claim edits at once -- a pasted sheet, or a bulk edit.
--
-- set_invoice_item_claim handles one cell. An import supplies a different
-- figure for each item, so it needs the same rule applied row by row, which
-- the browser did by rebuilding whole invoice item arrays and writing them
-- back in chunks of 450 (Firestore capped a batch at 500 writes).
--
-- The loop is still a loop, but it runs here: one round trip, one transaction,
-- and every derivation reads the position stored in the database rather than
-- whatever the browser was holding. That last part is the correctness fix --
-- the browser could not work out cumulative figures at all from a bulk grid,
-- and its own comments said so.
--
-- p_edits is [{"id": uuid, "field": text, "value": numeric}, ...].
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

create or replace function apply_invoice_item_claims(p_edits jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  e jsonb;
  applied integer := 0;
begin
  if p_edits is null or jsonb_typeof(p_edits) <> 'array' then
    return 0;
  end if;

  for e in select * from jsonb_array_elements(p_edits)
  loop
    perform set_invoice_item_claim(
      (e ->> 'id')::uuid,
      e ->> 'field',
      (e ->> 'value')::numeric
    );
    applied := applied + 1;
  end loop;

  return applied;
end;
$$;

revoke all on function apply_invoice_item_claims(jsonb) from public, anon;
grant execute on function apply_invoice_item_claims(jsonb) to authenticated;
