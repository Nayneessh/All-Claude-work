// Database access layer. The rest of the app talks to `Db`, never to a driver.
// Two drivers: "postgres" (any PostgreSQL, including Supabase's pooler) and "pglite"
// (embedded real Postgres for local development and tests).
import postgres from 'postgres';

export interface Queryable {
  query<T = Record<string, any>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface StaffClaims {
  sub: string;
  email?: string;
  aal: string;
  [k: string]: unknown;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Run as the signed-in role with verified claims, so row-level security and role checks apply in the database. */
  asStaff<T>(claims: StaffClaims, fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly driver: 'postgres' | 'pglite';
}

const STAFF_SETUP = [`set local role authenticated`, `select set_config('request.jwt.claims', $1, true)`] as const;

export function postgresDb(url: string): Db {
  const sql = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 3),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // required by transaction-mode poolers such as Supabase's
    onnotice: () => {},
    types: { bigint: postgres.BigInt },
  });
  const wrap = (s: postgres.Sql | postgres.TransactionSql): Queryable => ({
    query: async <T>(text: string, params: unknown[] = []) => (await s.unsafe(text, params as never[])) as unknown as T[],
  });
  return {
    driver: 'postgres',
    ...wrap(sql),
    tx: (fn) => sql.begin((t) => fn(wrap(t))) as Promise<never>,
    asStaff: (claims, fn) =>
      sql.begin(async (t) => {
        await t.unsafe(STAFF_SETUP[0]);
        await t.unsafe(STAFF_SETUP[1], [JSON.stringify(claims)]);
        return fn(wrap(t));
      }) as Promise<never>,
    close: () => sql.end({ timeout: 5 }),
  };
}

export async function pgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  const has = await lite.query<{ n: number }>(`select count(*)::int as n from information_schema.schemata where schema_name = 'ss'`);
  if (has.rows[0]!.n === 0) {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await lite.exec(readFileSync(join(dir, f), 'utf8'));
  }
  const wrapTx = (t: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Queryable => ({
    query: async <T>(text: string, params: unknown[] = []) => (await t.query(text, params)).rows as T[],
  });
  return {
    driver: 'pglite',
    query: async <T>(text: string, params: unknown[] = []) => (await lite.query(text, params)).rows as T[],
    tx: (fn) => lite.transaction((t) => fn(wrapTx(t as never))),
    asStaff: (claims, fn) =>
      lite.transaction(async (t) => {
        await t.query(STAFF_SETUP[0]);
        await t.query(STAFF_SETUP[1], [JSON.stringify(claims)]);
        return fn(wrapTx(t as never));
      }),
    close: () => lite.close(),
  };
}
