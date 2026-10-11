/** TEST retained correction recovery. No capture, processing or identity activation. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  CORRECTION_RECOVERY_CATALOG,
  CORRECTION_RECOVERY_SNAPSHOT,
  CORRECTION_RECOVERY_PRESERVED,
  readCorrectionRecoveryCatalog,
} from "./learn-correction-recovery-catalog.mjs";
export const CORRECTION_RECOVERY_SHA = "584948b52e0a2ca6b0c81c05f73bdc3c59b60375070903aa467d7747b47f3343";
const prefix = "supabase/release/learn-test/053_correction_recovery";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const paths = ["supabase/migrations/20261101170000_learn_correction_recovery.sql"];
const assertionPath = "scripts/verify/learn-correction-recovery-hosted.assert.sql";
const sorted = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
function sources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== CORRECTION_RECOVERY_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !CORRECTION_RECOVERY_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete preservation evidence required");
  return sorted(rows);
}
export function prepareCorrectionRecoveryPackage() {
  const prior = JSON.parse(readFileSync(".verification-results/correction-recovery-prior.json"));
  if (
    prior.catalog.functions.length !== 1 || prior.catalog.tables.length !== 1 || prior.catalog.tables[0] !== null ||
    prior.catalog.ledger.length !== 53 || prior.catalog.ledger.some(r=>r.project!==TEST_PROJECT) ||
    prior.baseFingerprint !== "cbbe6690e680ebf211b49bf25275c9d5" ||
    prior.fingerprint !== "b0fb35158b23263826fe6ebe70d0d041"
  )
    throw Error("Exact Correction recovery prerequisites required");
  sources(prior.preserved);
  const inputs = paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const assertion = readFileSync(assertionPath, "utf8");
  const bodies = inputs.map((s) =>
    s.source.replace("\nbegin;\n", "\n").replace("\ncommit;\n", "\n"),
  );
  const sql =
    `-- TEST-only retained correction recovery; no activation, user-access grants or source imports.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if md5((${CORRECTION_RECOVERY_CATALOG})::text) <> '${prior.fingerprint}' then raise exception 'Exact Correction recovery prerequisites required';end if;
 if exists(select 1 from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then raise exception 'Idle TEST Commusoft required';end if;
end $$;
create temporary table serviceos_correction_recovery_preserved on commit drop as ${CORRECTION_RECOVERY_SNAPSHOT};
create temporary table serviceos_correction_recovery_permissions on commit drop as select ((${CORRECTION_RECOVERY_CATALOG})-'functions'-'tables') as previous_catalog;
${bodies.join("\n")}
savepoint correction_recovery_probe;
${assertion}
rollback to savepoint correction_recovery_probe;
release savepoint correction_recovery_probe;
do $$begin
 if (select previous_catalog from serviceos_correction_recovery_permissions) is distinct from ((${CORRECTION_RECOVERY_CATALOG})-'functions'-'tables') then raise exception 'Existing catalog or authority changed';end if;
 if (select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_correction_recovery_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (${CORRECTION_RECOVERY_SNAPSHOT})x) then raise exception 'Retained sources changed during correction recovery release';end if;
end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_correction_recovery_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-correction-recovery/1' as marker,${CORRECTION_RECOVERY_CATALOG} as catalog,md5((${CORRECTION_RECOVERY_CATALOG})::text) as fingerprint,(select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_correction_recovery_preserved x) as preserved;
commit;
`.replace(/[ \t]+$/gm, "");
  const manifest = {
    version: "learn-correction-recovery-package/1",
    projectRef: TEST_PROJECT,
    sha256: hash(sql),
    priorFingerprint: prior.fingerprint,
    sources: inputs.map((s) => ({ path: s.path, sha256: hash(s.source) })),
    assertion: { path: assertionPath, sha256: hash(assertion) },
    preservedDataSets: prior.preserved.length,
  };
  writeFileSync(prefix + ".sql", sql);
  writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(prefix + ".prerequisites.json", JSON.stringify(prior, null, 2) + "\n");
  return {
    sha256: manifest.sha256,
    priorFingerprint: prior.fingerprint,
    preservedDataSets: prior.preserved.length,
  };
}
export function correctionRecoveryPackage() {
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
  if (
    hash(sql) !== CORRECTION_RECOVERY_SHA ||
    manifest.sha256 !== CORRECTION_RECOVERY_SHA ||
    manifest.projectRef !== TEST_PROJECT ||
    manifest.sources.length !== paths.length ||
    manifest.assertion?.path !== assertionPath ||
    hash(readFileSync(assertionPath)) !== manifest.assertion.sha256 ||
    manifest.sources.some((s, i) => s.path !== paths[i] || hash(readFileSync(s.path)) !== s.sha256)
  )
    throw Error("Pinned correction recovery package changed");
  return { sql, manifest };
}
export async function releaseCorrectionRecovery({
  mode,
  allowProjectRef,
  token,
  persistJournal,
  query = communicationQuery,
  catalog = readCorrectionRecoveryCatalog,
  rehearsal,
}) {
  if (
    !["rehearse", "apply"].includes(mode) ||
    allowProjectRef !== TEST_PROJECT ||
    typeof persistJournal !== "function" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token ?? "")
  )
    throw Error("Explicit TEST operation and durable journal required");
  const { sql, manifest } = correctionRecoveryPackage();
  if (
    mode === "apply" &&
    (rehearsal?.state !== "rehearsed_rolled_back" ||
      rehearsal.sourceSha256 !== CORRECTION_RECOVERY_SHA ||
      rehearsal.projectRef !== TEST_PROJECT ||
      rehearsal.priorFingerprint !== manifest.priorFingerprint ||
      !Number.isFinite(Date.parse(rehearsal.observedAt)) ||
      Date.now() - Date.parse(rehearsal.observedAt) < 0 ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000 ||
      !/^[a-f0-9]{32}$/.test(rehearsal.expectedFingerprint ?? ""))
  )
    throw Error("Exact successful rehearsal required");
  const [before, rows] = await Promise.all([catalog(token), query(token, CORRECTION_RECOVERY_SNAPSHOT)]),
    preserved = sources(rows);
  if (before.fingerprint !== manifest.priorFingerprint) throw Error("TEST prerequisites changed");
  const journal = {
    version: "learn-correction-recovery/1",
    projectRef: TEST_PROJECT,
    mode,
    sourceSha256: CORRECTION_RECOVERY_SHA,
    priorFingerprint: before.fingerprint,
    expectedFingerprint: rehearsal?.expectedFingerprint ?? null,
    preserved,
    observedAt: new Date().toISOString(),
  };
  await persistJournal(journal);
  let receipt = null,
    submissionFailure = null;
  try {
    const result = await query(
      token,
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${CORRECTION_RECOVERY_SHA}';\n` +
        (mode === "rehearse" ? sql.replace(/\ncommit;\n$/, "\nrollback;\n") : sql),
      { readOnly: false },
    );
    if (result.length === 1 && result[0].marker === "learn-correction-recovery/1") receipt = result[0];
  } catch (error) {
    submissionFailure =
      error?.name === "TimeoutError" ? "request_timeout" : "submission_unconfirmed";
    /* Never resubmit an uncertain transaction. */
  }
  const [after, afterRows] = await Promise.all([
    catalog(token),
    query(token, CORRECTION_RECOVERY_SNAPSHOT),
  ]);
  const unchanged = JSON.stringify(preserved) === JSON.stringify(sources(afterRows));
  const expected = mode === "rehearse" ? receipt?.fingerprint : rehearsal.expectedFingerprint;
  const ledger = receipt?.catalog?.ledger;
  const validReceipt =
    /^[a-f0-9]{32}$/.test(receipt?.fingerprint ?? "") &&
    receipt?.catalog?.functions?.length === 2 && receipt?.catalog?.tables?.length === 1 && receipt.catalog.tables[0]?.name === "learn_correction_cancellations" && receipt.catalog.tables[0]?.rls === true &&
    ledger?.length === 54 &&
    ledger.every((r) => r.project === TEST_PROJECT) &&
    ledger.filter((r) => r.name === "learn_correction_recovery_v1" && r.sha256 === CORRECTION_RECOVERY_SHA)
      .length === 1 &&
    Array.isArray(receipt?.preserved) &&
    JSON.stringify(preserved) === JSON.stringify(sorted(receipt.preserved));
  const state =
    unchanged &&
    (mode === "rehearse"
      ? validReceipt && after.fingerprint === before.fingerprint
      : after.fingerprint === expected)
      ? mode === "rehearse"
        ? "rehearsed_rolled_back"
        : "installed_needs_hosted_acceptance"
      : "requires_inspection";
  return {
    version: journal.version,
    projectRef: TEST_PROJECT,
    sourceSha256: CORRECTION_RECOVERY_SHA,
    mode,
    state,
    observedAt: new Date().toISOString(),
    priorFingerprint: before.fingerprint,
    expectedFingerprint: expected,
    afterFingerprint: after.fingerprint,
    preservedDataSets: unchanged ? preserved.length : null,
    submissionFailure,
    receipt: receipt
      ? {
          fingerprint: receipt.fingerprint,
          functions: receipt.catalog?.functions?.length,
        }
      : null,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).join(" ") === "--prepare")
      console.log(JSON.stringify(prepareCorrectionRecoveryPackage(), null, 2));
    else {
      const mode = process.argv[2]?.slice(2);
      if (
        process.argv.length !== 4 ||
        process.argv[3] !== "--existing-cli-login" ||
        process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
      )
        throw Error("Explicit TEST operation required");
      const stem = ".verification-results/correction-recovery-" + mode;
      const result = await releaseCorrectionRecovery({
        mode,
        allowProjectRef: TEST_PROJECT,
        token: savedCliToken(),
        rehearsal:
          mode === "apply"
            ? JSON.parse(readFileSync(".verification-results/correction-recovery-rehearse-result.json"))
            : undefined,
        persistJournal: async (journal) => {
          const fd = openSync(stem + "-journal.json", "wx", 0o600);
          try {
            writeSync(fd, JSON.stringify(journal, null, 2));
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        },
      });
      writeFileSync(stem + "-result.json", JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
      console.log(JSON.stringify(result, null, 2));
      if (result.state === "requires_inspection") process.exitCode = 1;
    }
  } catch {
    console.error(
      "Correction recovery release unconfirmed; inspect retained journal and schema before any further attempt.",
    );
    process.exitCode = 1;
  }
}
