// Applies supabase/migrations/*.sql in order to DATABASE_URL, recording each in ss_migrations.
// Works against any PostgreSQL. On Supabase you may instead apply the same files from the dashboard or CLI.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const dir = join(process.cwd(), 'supabase', 'migrations');

async function main() {
  await sql`create table if not exists public.ss_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from public.ss_migrations`).map((r) => r.name as string));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) {
      console.log(`skip   ${f}`);
      continue;
    }
    console.log(`apply  ${f}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, f), 'utf8'));
      await tx`insert into public.ss_migrations (name) values (${f})`;
    });
  }
  await sql.end();
  console.log('done');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
