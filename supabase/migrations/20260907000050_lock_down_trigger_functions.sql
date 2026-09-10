-- ============================================================================
-- Trigger functions are not API endpoints.
--
-- PostgREST exposes every function in the `public` schema as an RPC, and a
-- function inherits EXECUTE from PUBLIC unless it is revoked. The roll-up
-- triggers added during the migration are SECURITY DEFINER -- they have to be,
-- because they update a parent row the editing user may not be able to write
-- directly -- which meant anyone, signed in or not, could call them at
-- /rest/v1/rpc/<name> with the definer's rights.
--
-- Calling one would fail today (a trigger function has no NEW or OLD outside a
-- trigger, so it raises), but a function that runs as its owner should not be
-- reachable from the internet on the strength of that. Revoked here.
--
-- The auth_* helpers stay callable by `authenticated` on purpose: they are the
-- RLS helpers, they take the caller's own identity from auth.uid(), and they
-- only ever report on that caller's own access.
-- ============================================================================

revoke all on function refresh_subcontract_totals()      from public, anon, authenticated;
revoke all on function refresh_invoice_totals()          from public, anon, authenticated;
revoke all on function refresh_risk_totals()             from public, anon, authenticated;
revoke all on function change_records_refresh_totals()   from public, anon, authenticated;
revoke all on function reporting_periods_ensure_current() from public, anon, authenticated;

-- set_updated_at is SECURITY INVOKER, but it is still a trigger function and
-- has no business being an endpoint either.
revoke all on function set_updated_at() from public, anon, authenticated;
