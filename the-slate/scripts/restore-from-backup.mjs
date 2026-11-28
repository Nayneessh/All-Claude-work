#!/usr/bin/env node
// Turns a THE SLATE backup (the nightly *.json.gz, or an unzipped .json) into ONE self-contained SQL script that restores the data into any
// Postgres that already has the schema (run the migrations first). Parents are loaded before children; triggers are paused during the load
// so history is not re-logged; generated columns are skipped; everything runs in a single transaction (all-or-nothing).
//   node scripts/restore-from-backup.mjs backup.json.gz [--map-user OLD_UUID=NEW_UUID] > restore.sql
//   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f restore.sql
// Auth users are NOT part of the backup: create the user first (same email) and pass --map-user if the new user id differs.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export function buildRestoreSql(raw, mapUsers = []) {
  let text = raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  for (const [from, to] of mapUsers) { if (!/^[0-9a-f-]{36}$/i.test(from) || !/^[0-9a-f-]{36}$/i.test(to)) throw new Error('--map-user needs two UUIDs'); text = text.replaceAll(from, to); }
  const b = JSON.parse(text);
  if (b.format !== 'the-slate-backup' || !b.tables) throw new Error('not a THE SLATE backup file');
  const tables = Object.keys(b.tables).filter((t) => /^[a-z_]+$/.test(t));
  const data = JSON.stringify(Object.fromEntries(tables.map((t) => [t, b.tables[t]]))).replaceAll('$slate_json$', '');
  return `-- THE SLATE restore · backup taken ${b.taken_at} · ${tables.map((t) => `${t}=${b.counts?.[t] ?? b.tables[t].length}`).join(' ')}
begin;
${tables.map((t) => `alter table public.${t} disable trigger user;`).join('\n')}
do $slate_restore$
declare j constant jsonb := $slate_json$${data}$slate_json$::jsonb;
  tables constant text[] := array[${tables.map((t) => `'${t}'`).join(', ')}]; -- explicit order (parents first): JSON objects do not preserve key order
  t text; cols text; n bigint; total bigint := 0;
begin
  foreach t in array tables loop
    if jsonb_array_length(j -> t) = 0 then continue; end if;
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = t and c.is_generated = 'NEVER' and (j -> t -> 0) ? c.column_name;
    -- ON CONFLICT DO NOTHING makes the script safe to re-run and tolerant of rows that already exist (e.g. the sign-up whitelist)
    execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing', t, cols, cols, t) using j -> t;
    get diagnostics n = row_count; total := total + n;
    raise notice 'restored % of % rows into % %', n, jsonb_array_length(j -> t), t, case when n < jsonb_array_length(j -> t) then '(rest already present)' else '' end;
  end loop;
  if exists (select 1 from pg_class where relname = 'audit_log_id_seq') then perform setval('public.audit_log_id_seq', coalesce((select max(id) from public.audit_log), 1)); end if;
  raise notice 'TOTAL % rows restored', total;
end $slate_restore$;
${tables.map((t) => `alter table public.${t} enable trigger user;`).join('\n')}
commit;
`;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2]; if (!file) { console.error('usage: restore-from-backup.mjs <backup.json.gz> [--map-user OLD=NEW]'); process.exit(2); }
  const maps = []; for (let i = 3; i < process.argv.length; i++) if (process.argv[i] === '--map-user') maps.push(process.argv[++i].split('='));
  process.stdout.write(buildRestoreSql(readFileSync(file), maps));
}
