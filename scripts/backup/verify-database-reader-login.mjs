/** Non-content login proof for the dedicated LIVE backup source. */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { loadDatabaseSourceReader } from "./serviceos-database-source-access.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE reader verification mode required");
const PROJECT = "tgbnakbxwcqjeimygroz";
const ROLE = "serviceos_backup_reader";
const IMAGE = "sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518";
const ca = readFileSync(new URL("../../infrastructure/database-recovery/supabase-root-2021.crt", import.meta.url));
if (createHash("sha256").update(ca).digest("hex") !==
  "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7")
  throw Error("Database TLS trust changed");
const source = await loadDatabaseSourceReader();
const sql = `select json_build_object('currentUser',current_user,'sessionUser',session_user,
 'readOnly',current_setting('default_transaction_read_only'),
 'member',pg_has_role(current_user,'pg_read_all_data','member'),
 'authSelect',has_table_privilege(current_user,'auth.users','SELECT'),
 'vaultSelect',has_table_privilege(current_user,'vault.secrets','SELECT'))`;
const name = "serviceos-reader-check-" + randomUUID().replaceAll("-", "");
const args = ["run", "--rm", "-i", "--pull=never", "--name", name,
  "--log-driver", "none", "--security-opt", "no-new-privileges",
  "--memory", "256m", "--cpus", "1", "--pids-limit", "32",
  "-e", "PGHOST=aws-1-eu-west-2.pooler.supabase.com", "-e", "PGPORT=5432",
  "-e", `PGUSER=${ROLE}.${PROJECT}`, "-e", "PGDATABASE=postgres",
  "-e", "PGSSLMODE=verify-full", "-e", "PGSSLROOTCERT=/tmp/supabase-root.crt",
  "-e", "PGCONNECT_TIMEOUT=20", "--entrypoint", "bash", IMAGE, "-c",
  'set -e; IFS= read -r ca; printf %s "$ca" | base64 -d > /tmp/supabase-root.crt; '
  + 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -w -Atq -v ON_ERROR_STOP=1 -c "$1"',
  "--", sql];
const child = spawn("/usr/local/bin/docker", args, { stdio: ["pipe", "pipe", "pipe"] });
let output = "", errors = 0;
child.stdout.on("data", chunk => { output += chunk; if (output.length > 4096) child.kill("SIGTERM"); });
child.stderr.on("data", chunk => { errors += chunk.length; if (errors > 4096) child.kill("SIGTERM"); });
const completed = new Promise((resolve, reject) => {
  child.once("error", () => reject(Error("Reader login client unavailable")));
  child.once("close", code => code === 0 ? resolve() : reject(Error("Reader login unconfirmed")));
});
child.stdin.end(ca.toString("base64") + "\n" + source.password + "\n");
source.password = "";
await completed;
const result = JSON.parse(output.trim());
if (result.currentUser !== ROLE || result.sessionUser !== ROLE || result.readOnly !== "on"
  || result.member !== true || result.authSelect !== true || result.vaultSelect !== true)
  throw Error("Reader login or source permissions unconfirmed");
console.log(JSON.stringify({ state: "dedicated_reader_login_verified", observedAt: new Date().toISOString(),
  project: PROJECT, role: ROLE, defaultTransactionReadOnly: true,
  authAndEncryptedVaultSelectable: true, customerRowsRead: 0, secretsPrinted: false }));
