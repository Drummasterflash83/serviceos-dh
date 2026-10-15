/** Approved, exact production backup-reader role. No source rows are read. */
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { savedCliToken, TEST_PROJECT } from "../verify/learn-test-readiness.mjs";

const LIVE = "tgbnakbxwcqjeimygroz";
const PROJECT = process.argv[2] === "--test" ? TEST_PROJECT
  : process.argv[2] === "--live" ? LIVE : null;
const MODE = process.argv[3];
if (!PROJECT || !["--rehearse", "--apply"].includes(MODE) || process.argv.length !== 4
  || (MODE === "--apply" && PROJECT !== LIVE))
  throw Error("Exact backup-reader release target and mode required");

const ROLE = "serviceos_backup_reader";
const KEYCHAIN = fileURLToPath(new URL("./database-source-keychain.py", import.meta.url));
const sourceSha256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
const token = savedCliToken();
const receiptPath = `.verification-results/database-reader-${PROJECT}-rehearsal.json`;
const queryPath = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`;
async function query(sql, readOnly = true) {
  const response = await fetch(queryPath + (readOnly ? "/read-only" : ""), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
    redirect: "error", signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Error(`Backup-reader SQL failed (HTTP ${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Backup-reader SQL response changed");
  return rows;
}
const stateSql = `select exists(select 1 from pg_roles where rolname='${ROLE}') role_present,
 (select jsonb_build_object('login',rolcanlogin,'bypassRls',rolbypassrls,
  'readOnlyDefault',exists(select 1 from pg_db_role_setting s
    where s.setrole=r.oid and s.setdatabase=0 and 'default_transaction_read_only=on'=any(s.setconfig)),
  'superuser',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,
  'replication',rolreplication,'inherit',rolinherit,
  'expiresAt',rolvaliduntil,
  'memberships',(select coalesce(jsonb_agg(p.rolname order by p.rolname),'[]'::jsonb)
    from pg_auth_members m join pg_roles p on p.oid=m.roleid where m.member=r.oid))
  from pg_roles r where r.rolname='${ROLE}') role`;
async function state() {
  const rows = await query(stateSql);
  if (rows.length !== 1 || typeof rows[0]?.role_present !== "boolean")
    throw Error("Backup-reader role readback changed");
  return rows[0];
}
const before = await state();
if (before.role_present) throw Error("Backup-reader role already exists; inspect before changing");
if (MODE === "--apply") {
  const rehearsal = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (rehearsal.state !== "rehearsed_rolled_back" || rehearsal.project !== LIVE
    || rehearsal.sourceSha256 !== sourceSha256
    || !Number.isFinite(Date.parse(rehearsal.observedAt))
    || Date.now() - Date.parse(rehearsal.observedAt) > 3600000)
    throw Error("Fresh exact LIVE reader-role rehearsal required");
}
const password = MODE === "--apply" ? randomBytes(48).toString("base64url") : "synthetic-only-" + "a".repeat(48);
const expiresAt = new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString();
const sql = `begin;
set local lock_timeout='5s';set local statement_timeout='50s';
do $$begin if exists(select 1 from pg_roles where rolname='${ROLE}')
 then raise exception 'database_reader_role_changed';end if;end$$;
create role ${ROLE} login inherit bypassrls nosuperuser nocreatedb nocreaterole noreplication
 password '${password}' valid until '${expiresAt}';
grant pg_read_all_data to ${ROLE};
grant connect on database postgres to ${ROLE};
alter role ${ROLE} set default_transaction_read_only=on;
do $$declare r record;begin
 select rolcanlogin,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolinherit,rolvaliduntil
 into strict r from pg_roles where rolname='${ROLE}';
 if not r.rolcanlogin or not r.rolbypassrls or r.rolsuper or r.rolcreatedb or r.rolcreaterole
  or r.rolreplication or not r.rolinherit or r.rolvaliduntil is null
  or not pg_has_role('${ROLE}','pg_read_all_data','member')
  or exists(select 1 from pg_auth_members m join pg_roles p on p.oid=m.roleid
    where m.member='${ROLE}'::regrole and p.rolname<>'pg_read_all_data')
  or not exists(select 1 from pg_db_role_setting s where s.setrole='${ROLE}'::regrole
    and s.setdatabase=0 and 'default_transaction_read_only=on'=any(s.setconfig))
 then raise exception 'database_reader_role_scope_invalid';end if;
end$$;
select 'database_reader_role_valid' marker;
${MODE === "--apply" ? "commit;" : "rollback;"}`;

let stored = false;
if (MODE === "--apply") {
  const value = { project: LIVE, role: ROLE, host: "aws-1-eu-west-2.pooler.supabase.com", password };
  const output = execFileSync("python3", ["-B", KEYCHAIN, "--put"], {
    input: JSON.stringify(value), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000 });
  if (JSON.parse(output).state !== "database_reader_keychain_stored")
    throw Error("Backup-reader Keychain store unconfirmed");
  stored = true;
  const checked = JSON.parse(execFileSync("python3", ["-B", KEYCHAIN, "--get"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 }));
  if (JSON.stringify(checked) !== JSON.stringify(value))
    throw Error("Backup-reader Keychain readback changed");
}
let response = null, failure = null;
try { response = await query(sql, false); }
catch (error) { failure = error instanceof Error ? error.message : "Backup-reader SQL uncertain"; }
const after = await state();
const valid = after.role && after.role.login === true && after.role.bypassRls === true
  && after.role.readOnlyDefault === true && after.role.superuser === false
  && after.role.createDb === false && after.role.createRole === false
  && after.role.replication === false && after.role.inherit === true
  && JSON.stringify(after.role.memberships) === '["pg_read_all_data"]';
const ok = !failure && response?.some(r => r.marker === "database_reader_role_valid")
  && (MODE === "--rehearse" ? !after.role_present : after.role_present && valid && stored);
if (!ok && stored && after.role_present === false) {
  try { execFileSync("python3", ["-B", KEYCHAIN, "--delete"], { stdio: "ignore", timeout: 15000 }); }
  catch { /* A retained local item requires inspection; no automatic database retry. */ }
}
const result = { state: ok ? MODE === "--rehearse" ? "rehearsed_rolled_back" : "reader_role_installed_verified"
  : "requires_inspection", observedAt: new Date().toISOString(), project: PROJECT,
  sourceSha256, role: ROLE, beforeRolePresent: before.role_present,
  afterRolePresent: after.role_present, roleScopeVerified: MODE === "--apply" ? !!valid : null,
  keychainStoredAndReadBack: MODE === "--apply" ? ok && stored : false,
  ...(failure ? { failure } : {}), secretPrinted: false, sourceRowsRead: 0 };
if (MODE === "--rehearse" && ok)
  writeFileSync(receiptPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(result));
if (!ok) process.exitCode = 1;
