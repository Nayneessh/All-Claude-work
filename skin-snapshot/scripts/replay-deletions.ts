// After restoring a database backup, re-apply deletions made since the backup so deleted cases stay deleted.
// Usage:
//   1. Before restoring, save the ledger from the live database:  \copy (select case_id from ss.deletion_ledger) to 'ledger.csv' csv
//   2. Restore the backup.
//   3. DATABASE_URL=... npx tsx scripts/replay-deletions.ts ledger.csv
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  const file = process.argv[2];
  if (!url || !file) throw new Error('Usage: DATABASE_URL=... tsx scripts/replay-deletions.ts ledger.csv');
  const ids = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim().split(',')[0]!).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const sql = postgres(url, { max: 1 });
  let n = 0;
  for (const id of ids) {
    const r = await sql`delete from ss.cases where id = ${id}::uuid returning code`;
    if (r.length) {
      n++;
      await sql`insert into ss.deletion_ledger (case_id, case_code, reason) values (${id}::uuid, ${r[0]!.code as string}, 'retention_expired') on conflict do nothing`;
    }
  }
  console.log(`replayed ${ids.length} ledger entries, removed ${n} restored cases. Run the purge job to remove their stored photos.`);
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
