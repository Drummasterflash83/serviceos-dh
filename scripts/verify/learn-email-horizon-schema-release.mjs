/** Narrow, journalled schema release. The account policy is activated separately. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import {
  emailMigrationAccessBegin,
  emailMigrationAccessEnd,
} from "./learn-email-migration-access.mjs";

const file = "supabase/migrations/20261104090000_learn_email_full_import_horizon.sql";
const source = readFileSync(file, "utf8");
const sha256 = createHash("sha256").update(source).digest("hex");
const body = source.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");
const beforeDigest = "da6714f06b6287a80950329c7f4c43d1";
const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const stateQuery = `select
 (select count(*) from information_schema.columns where table_schema='public'
   and table_name='email_accounts' and column_name='full_import_after_at') as column_count,
 md5(pg_get_functiondef('public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure)) as transition_digest`;

async function query(token, project, sql, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
      redirect: "error", signal: AbortSignal.timeout(45000) },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw Error(String(payload.message ?? "schema_release_failed").split("\n")[0].slice(0, 240));
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("schema_release_response_invalid");
  return rows;
}

async function main() {
  const mode = process.argv[2];
  if (!["--rehearse-test", "--apply-test", "--rehearse-live", "--apply-live"].includes(mode))
    throw Error("explicit_release_mode_required");
  const live = mode.endsWith("-live");
  const project = live ? LIVE_PROJECT : TEST_PROJECT;
  const scope = live ? process.env.LEARN_LIVE_ALLOW_PROJECT_REF : process.env.LEARN_TEST_ALLOW_PROJECT_REF;
  if (scope !== project) throw Error("explicit_release_scope_required");
  const rehearsalMode = mode.startsWith("--rehearse-");
  const resultFile = `.verification-results/learn-email-horizon-${live ? "live" : "test"}-schema-rehearsal.json`;
  const token = savedCliToken();
  const before = (await query(token, project, stateQuery))[0];
  if (before?.column_count !== 0 || before.transition_digest !== beforeDigest)
    throw Error("email_protocol_state_changed");
  if (!rehearsalMode) {
    const rehearsal = JSON.parse(readFileSync(resultFile, "utf8"));
    if (rehearsal.state !== "rehearsed_rolled_back" || rehearsal.sha256 !== sha256 ||
        rehearsal.beforeDigest !== beforeDigest ||
        Date.now() - Date.parse(rehearsal.completedAt) > 3600000)
      throw Error("fresh_exact_test_rehearsal_required");
  }
  const statement = `begin;\n${emailMigrationAccessBegin}\n${body}\n${emailMigrationAccessEnd}\n` +
    `${stateQuery};\n${rehearsalMode ? "rollback" : "commit"};`;
  let rows;
  try {
    rows = await query(token, project, statement, false);
  } catch (error) {
    const afterUnknown = (await query(token, project, stateQuery))[0];
    if (afterUnknown?.column_count !== 0 || afterUnknown.transition_digest !== beforeDigest)
      throw Error("schema_outcome_uncertain_inspect_before_retry");
    throw error;
  }
  const after = (await query(token, project, stateQuery))[0];
  const staged = rows.find((row) => row.transition_digest && row.column_count === 1);
  if (!staged ||
      (rehearsalMode
        ? after?.column_count !== 0 || after.transition_digest !== beforeDigest
        : after?.column_count !== 1 || after.transition_digest !== staged.transition_digest))
    throw Error("schema_readback_mismatch");
  const receipt = { state: rehearsalMode ? "rehearsed_rolled_back" : "installed",
    projectRef: project, sha256, beforeDigest, afterDigest: staged.transition_digest,
    completedAt: new Date().toISOString(), policyActivated: false };
  if (rehearsalMode)
    writeFileSync(resultFile, JSON.stringify(receipt, null, 2) + "\n", { flag: "w", mode: 0o600 });
  console.log(JSON.stringify(receipt));
}

main().catch((error) => {
  console.error(JSON.stringify({ state: "schema_release_unconfirmed",
    code: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
});
