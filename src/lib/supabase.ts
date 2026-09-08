import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env and fill them in.'
  );
}

export const supabase: SupabaseClient = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ---------------------------------------------------------------- casing ----
// Postgres columns are snake_case; the components speak camelCase. Only the
// TOP-LEVEL keys of a row are mapped. Values are passed through untouched --
// JSONB columns (attribute maps, periodValues, stepData, grid state) are keyed
// by ids the app generates, and rewriting those keys would corrupt them.

const snakeCache = new Map<string, string>();
const camelCache = new Map<string, string>();

export function toSnakeKey(key: string): string {
  let out = snakeCache.get(key);
  if (out === undefined) {
    out = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    snakeCache.set(key, out);
  }
  return out;
}

export function toCamelKey(key: string): string {
  let out = camelCache.get(key);
  if (out === undefined) {
    out = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    camelCache.set(key, out);
  }
  return out;
}

/** Row from Postgres -> shape the components expect. */
export function fromRow<T = any>(row: Record<string, any> | null): T | null {
  if (row === null) return null;
  const out: Record<string, any> = {};
  for (const key in row) out[toCamelKey(key)] = row[key];
  return out as T;
}

export function fromRows<T = any>(rows: Record<string, any>[] | null): T[] {
  return (rows ?? []).map((r) => fromRow<T>(r) as T);
}

/** Component payload -> columns. Drops undefined so partial updates work. */
export function toRow(patch: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key in patch) {
    if (patch[key] !== undefined) out[toSnakeKey(key)] = patch[key];
  }
  return out;
}

// -------------------------------------------------------------- realtime ----
// Replaces Firestore's onSnapshot. Firestore pushed the full result set on
// every change; Postgres changefeeds deliver only the row that changed, so the
// caller re-runs its own fetch. That keeps RLS authoritative: a broadcast row
// the reader is not allowed to see is filtered by the same policies as a read.

export function subscribeToTable(
  table: string,
  filter: string | undefined,
  onChange: () => void
): () => void {
  const channel = supabase
    .channel(`${table}:${filter ?? 'all'}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
      () => onChange()
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Surfaces a PostgREST error with the context that makes it debuggable. */
export function raise(context: string, error: { message: string; code?: string } | null): void {
  if (!error) return;
  const code = error.code ? ` [${error.code}]` : '';
  console.error(`Supabase ${context}${code}: ${error.message}`);
  throw new Error(`${context}: ${error.message}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assert that a value really is a row id before sending it as one.
 *
 * Cost codes have two identifiers -- a uuid primary key and a user-facing
 * code like "C2" -- and both are strings, so passing the wrong one type-checks
 * cleanly and fails at the database as `invalid input syntax for type uuid`.
 * That happened twice. This turns it into an error naming the argument and the
 * value, raised at the call site before any request is made.
 */
export function assertId(label: string, value: string | null | undefined): string {
  if (!value || !UUID_RE.test(value)) {
    throw new Error(
      `${label} expects a row id but received ${JSON.stringify(value)}. ` +
      `This is a bug: a user-facing code was passed where an id belongs.`
    );
  }
  return value;
}
