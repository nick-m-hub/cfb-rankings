import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Db = SupabaseClient;

/** Service-role client. Server and scripts only; bypasses RLS. */
export function createAdminDb(): Db {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

const CHUNK = 1000;

/** Idempotent upsert in chunks. Throws on any error. */
export async function upsertRows(
  db: Db,
  table: string,
  rows: readonly object[],
  onConflict: string,
  opts: { ignoreDuplicates?: boolean } = {},
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from(table)
      .upsert(rows.slice(i, i + CHUNK), { onConflict, ignoreDuplicates: opts.ignoreDuplicates ?? false });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
}

/** Page through a whole table (PostgREST caps responses at 1,000 rows). */
export async function fetchAll<T>(db: Db, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await db.from(table).select(columns).range(from, from + CHUNK - 1);
    if (error) throw new Error(`select ${table}: ${error.message}`);
    out.push(...(data as unknown as T[]));
    if (data.length < CHUNK) return out;
  }
}
