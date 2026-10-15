/** Aggregate-only production preflight for an unattended independent export. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact read-only mode required");
const token = savedCliToken();
const project = "tgbnakbxwcqjeimygroz";
const query = `select jsonb_build_object(
  'backupRolePresent',exists(select 1 from pg_roles where rolname='serviceos_backup_reader'),
  'physicalUserTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in('r','p') and n.nspname not like 'pg_%' and n.nspname<>'information_schema'),
  'rlsTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in('r','p') and c.relrowsecurity and n.nspname not like 'pg_%'
      and n.nspname<>'information_schema'),
  'largeObjects',(select count(*) from pg_largeobject_metadata),
  'databaseBytes',pg_database_size(current_database()),
  'observedAt',clock_timestamp()) as status`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
  redirect: "error",
  signal: AbortSignal.timeout(45000),
});
if (!response.ok) throw Error(`Read-only database preflight failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.status)
  throw Error("Database preflight shape changed");
const value = rows[0].status;
if (typeof value.backupRolePresent !== "boolean" ||
  !["physicalUserTables", "rlsTables", "largeObjects", "databaseBytes"].every(
    (k) => Number.isSafeInteger(Number(value[k])) && Number(value[k]) >= 0))
  throw Error("Database preflight values unconfirmed");
console.log(JSON.stringify({ project, ...value, productionDataWrites: false,
  customerRowsRead: false, credentialsPrinted: false }));
