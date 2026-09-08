# Architecture constraints

Two constraints shape decisions in this codebase. Both were stated by the
product owner and both are easy to violate accidentally, so they are written
down rather than left in a conversation.

## 1. The database must stay portable off Supabase

If the product scales, the database moves to managed PostgreSQL elsewhere (RDS,
Cloud SQL, Azure Database for PostgreSQL, or self-hosted). **Nothing may depend
on a Supabase-only feature that has no plain-PostgreSQL equivalent.**

### What is already portable

Everything in `supabase/migrations/` is standard PostgreSQL: tables, foreign
keys, enums, `jsonb`, `plpgsql` functions, triggers, partial and composite
indexes, CHECK constraints. That includes all the business logic --
`recalculate_project_costs`, `close_cost_period`, `apply_etc_phasing`,
`insert_cost_code_at`, the bulk-update functions and the current-period
trigger. These run unchanged on any PostgreSQL 15+.

### What is coupled, and how tightly

| Coupling | Where | Cost to move |
|---|---|---|
| `auth.uid()` in RLS | inside 7 helper functions | rewrite those 7 to read a session variable |
| `auth.users` foreign keys | `user_profiles`, `*_by` columns | point at your own users table |
| `supabase_realtime` publication | 13 tables | it IS a plain Postgres publication; the consumer changes, not the schema |
| PostgREST (`supabase.rpc`, `.from()`) | `src/lib/*.ts` | this is the real work: an API layer |

The important discipline: **RLS policies must never call `auth.uid()`
directly.** They call `auth_is_project_admin()`, `auth_can_access_cost_code()`
and the other helpers, which are the only places that know where identity comes
from. Porting authentication then means rewriting seven small functions instead
of auditing 131 policies. Keep it that way.

### Rules

- No `pgsodium`, `vault`, `pg_graphql`, `pg_net`, `pg_cron`, Supabase Storage or
  Edge Functions unless there is no alternative and the trade is written down.
- No Supabase-specific SQL syntax. If it would not run on stock PostgreSQL,
  it does not go in a migration.
- Business logic lives in SQL functions, not in Edge Functions.

## 2. It has to hold mega-project volumes

Real figures from the product owner, for ONE project, at the halfway point:

- **500,000+** actual cost transactions
- **5,000** cost codes
- **thousands** of ETC detail lines per cost code -- so **millions** of ETC rows
- Companies run **many** such projects in one enterprise

And bulk import/export from Excel is a required feature, so those volumes
arrive in single operations, not gradually.

### What this forbids

**Never fetch a whole project's rows to display or aggregate a subset.** The
document-model code did this everywhere and it has been removed as each screen
was converted; do not reintroduce it. Filter in the database.

**Never aggregate in the browser.** Sums, roll-ups and period totals belong in
SQL. `recalculate_project_costs` replaced six full-table downloads for exactly
this reason.

**Never write rows one at a time in a loop.** Bulk paths take an array or
`jsonb` and do one statement -- see `insert_etc_details_at`,
`apply_etc_phasing`, `bulk_update_etc_details`.

**Watch the client-side grid.** AG Grid's default row model holds every row in
memory. A 500,000-row actual-cost grid needs the server-side row model or
server-side pagination. This is NOT yet done and is the largest outstanding
scale item.

### Known scale work still outstanding

1. Actual Cost and ETC grids load all rows for their scope. Fine for a cost
   code, not for a project-wide view at these volumes -- needs paging.
2. `fetchProjectEtcDetails` (bulk ETC screen) loads every ETC row in a project
   and sorts in JS. Needs server-side paging and ordering before real data.
3. Bulk import has no batching strategy yet. A 500,000-row Excel import must
   stream in chunks inside one transaction, not arrive as one request.
4. RLS helpers are called per row. They are indexed (`cost_code_users` PK is
   `(cost_code_id, user_id)`) but should be measured against real volumes.

None of these are urgent for testing with small data. All of them are blocking
before a real project is loaded.
