/** TEST-only rollback rehearsal of the exact default-OFF users-trial restore RPC. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = join(ROOT, "supabase/migrations/20261108130000_new_dawn_commusoft_users_trial_restore.sql");
const FENCE_SOURCE = join(ROOT, "supabase/migrations/20261108131000_new_dawn_commusoft_users_trial_resume_fence.sql");
const SIGNATURE = "public.learn_commusoft_users_trial_restore(uuid,uuid,uuid,uuid,text,text)";
const CONTROL = "public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text)";
const INPUT = "public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)";
const RESUME = "public.learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text)";

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
const before = await query(`select to_regprocedure('${SIGNATURE}') is null as absent,
 md5(pg_get_functiondef('${CONTROL}'::regprocedure)) as control_hash,
 md5(pg_get_functiondef('${INPUT}'::regprocedure)) as input_hash,
 md5(pg_get_functiondef('${RESUME}'::regprocedure)) as resume_hash`, true);
if (before.length !== 1 || before[0]?.absent !== true ||
    [before[0]?.control_hash, before[0]?.input_hash, before[0]?.resume_hash]
      .some(value => !/^[a-f0-9]{32}$/.test(value)))
  throw Error("users_trial_restore_already_installed_on_test");
const source = readFileSync(SOURCE, "utf8");
const fence = readFileSync(FENCE_SOURCE, "utf8");
if (!source.endsWith("commit;\n") || !fence.endsWith("commit;\n"))
  throw Error("users_trial_source_changed");
const rehearsal = source.replace(/commit;\s*$/, "") + "\n" +
  fence.replace(/^([\s\S]*?)\bbegin;\s*/, "$1").replace(/commit;\s*$/,
    `select to_regprocedure('${SIGNATURE}') is not null as compiled,
      to_regprocedure('public.learn_commusoft_users_trial_control_allowed(uuid,uuid)') is not null as fence_compiled,
      md5(pg_get_functiondef('${CONTROL}'::regprocedure)) as control_hash,
      md5(pg_get_functiondef('${INPUT}'::regprocedure)) as input_hash,
      md5(pg_get_functiondef('${RESUME}'::regprocedure)) as resume_hash;\nrollback;`);
const result = await query(rehearsal, false);
if (result.length !== 1 || result[0]?.compiled !== true || result[0]?.fence_compiled !== true ||
    ["control_hash", "input_hash", "resume_hash"].some(key => result[0]?.[key] === before[0]?.[key]))
  throw Error("users_trial_test_compile_unverified");
const after = await query(`select to_regprocedure('${SIGNATURE}') is null as absent,
 to_regprocedure('public.learn_commusoft_users_trial_control_allowed(uuid,uuid)') is null as fence_absent,
 md5(pg_get_functiondef('${CONTROL}'::regprocedure)) as control_hash,
 md5(pg_get_functiondef('${INPUT}'::regprocedure)) as input_hash,
 md5(pg_get_functiondef('${RESUME}'::regprocedure)) as resume_hash`, true);
if (after.length !== 1 || after[0]?.absent !== true || after[0]?.fence_absent !== true ||
    ["control_hash", "input_hash", "resume_hash"].some(key => after[0]?.[key] !== before[0]?.[key]))
  throw Error("users_trial_test_rollback_unverified");
console.log(JSON.stringify({ state: "test_rollback_verified", project: TEST_PROJECT, providerRequests: 0 }));
