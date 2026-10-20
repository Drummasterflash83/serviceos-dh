/** TEST-only rollback rehearsal of the exact default-OFF users-trial restore RPC. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = join(ROOT, "supabase/migrations/20261108130000_new_dawn_commusoft_users_trial_restore.sql");
const SIGNATURE = "public.learn_commusoft_users_trial_restore(uuid,uuid,uuid,uuid,text,text)";

async function query(sql, readOnly) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
    { method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: readOnly }) },
  );
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw Error(`users_trial_test_rollback_http_${response.status}:${String(problem?.code ?? "unknown")}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 65536) throw Error("users_trial_test_reply_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

if (process.argv.slice(2).join(" ") !== "--test-rollback-only")
  throw Error("Explicit TEST rollback-only mode required");
const before = await query(`select to_regprocedure('${SIGNATURE}') is null as absent`, true);
if (before.length !== 1 || before[0]?.absent !== true)
  throw Error("users_trial_restore_already_installed_on_test");
const source = readFileSync(SOURCE, "utf8");
if (!source.endsWith("commit;\n")) throw Error("users_trial_source_changed");
const rehearsal = source.replace(/commit;\s*$/, `select to_regprocedure('${SIGNATURE}') is not null as compiled;\nrollback;`);
const result = await query(rehearsal, false);
if (result.length !== 1 || result[0]?.compiled !== true)
  throw Error("users_trial_test_compile_unverified");
const after = await query(`select to_regprocedure('${SIGNATURE}') is null as absent`, true);
if (after.length !== 1 || after[0]?.absent !== true)
  throw Error("users_trial_test_rollback_unverified");
console.log(JSON.stringify({ state: "test_rollback_verified", project: TEST_PROJECT, providerRequests: 0 }));
