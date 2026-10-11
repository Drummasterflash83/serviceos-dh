/** Coordinated TEST Phone processing schema. No capture or identity activation. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { PHONE_PROCESSING_CATALOG, PHONE_PROCESSING_FILES, phoneProcessingSourceQuery,
 readPhoneProcessingCatalog } from './learn-phone-processing-catalog.mjs';
import { EMAIL_DIAGNOSTIC_PRESERVED as PHONE_PROCESSING_PRESERVED } from './learn-email-diagnostic-catalog.mjs';
import { phoneProcessingHostedProbe } from './learn-phone-processing-hosted-probe.mjs';
export const PHONE_PROCESSING_SHA = "2a5b63da46ede92ec2e5c73dd3928e060e1955ae996765696e4dce540310b35c";
const prefix = 'supabase/release/learn-test/055_phone_processing';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const paths = PHONE_PROCESSING_FILES;
const snapshotQuery = () => phoneProcessingSourceQuery(JSON.parse(readFileSync(prefix+'.prerequisites.json')).catalog.phone);
const sorted = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
function sources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== PHONE_PROCESSING_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !PHONE_PROCESSING_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete preservation evidence required");
  return sorted(rows);
}
export function preparePhoneProcessingPackage() {
  const prior = JSON.parse(readFileSync(".verification-results/phone-processing-prior.json"));
  if (
    prior.catalog.phone.tables.length !== 3 ||
    prior.catalog.base.ledger.length !== 55 || prior.catalog.base.ledger.some(r=>r.project!==TEST_PROJECT) ||
    prior.fingerprint !== "f2810cccae666cc898f82ac40687657d"
  )
    throw Error("Exact Phone processing prerequisites required");
  sources(prior.preserved);
  const inputs = paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const assertion = phoneProcessingHostedProbe();
  const snapshot = phoneProcessingSourceQuery(prior.catalog.phone);
  const bodies = inputs.map((s) =>
    s.source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, ""),
  );
  const sql =
    `-- TEST-only Phone processing: retained history, exclusive attempts and atomic attribution.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if md5((${PHONE_PROCESSING_CATALOG})::text) <> '${prior.fingerprint}' then raise exception 'Exact Phone prerequisites required';end if;
 if exists(select 1 from public.platform_jobs where job_type like 'phone.%' and status in ('queued','running','retrying')) then raise exception 'Idle TEST Phone required';end if;
end $$;
create temporary table serviceos_phone_processing_preserved on commit drop as ${snapshot};
${bodies.join("\n")}
savepoint phone_processing_probe;
${assertion}
rollback to savepoint phone_processing_probe;
release savepoint phone_processing_probe;
do $$begin
 if has_table_privilege('authenticated','public.learn_phone_result_versions','select')
 or has_table_privilege('authenticated','public.learn_phone_processing_attempts','select')
 or has_function_privilege('authenticated','public.learn_phone_derived_attempt(uuid,uuid,uuid,text,text,jsonb)','execute')
 or has_function_privilege('service_role','public.learn_phone_apply_intelligence(uuid,uuid,uuid,uuid,uuid,jsonb)','execute') then raise exception 'Private processing authority leaked';end if;
 if exists(select 1 from public.learn_phone_processing_attempts) or exists(select 1 from public.learn_phone_result_versions)
 or exists(select 1 from public.call_directions) or exists(select 1 from public.call_participants)
 or exists(select 1 from public.call_transcript_normalisations) or exists(select 1 from public.telephony_directory)
 or exists(select 1 from public.tenant_vocabulary) then raise exception 'Unexpected retained fixture';end if;
 if (select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_phone_processing_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (${snapshot})x) then raise exception 'Retained sources changed during Phone release';end if;
end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_phone_processing_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-phone-processing/1' as marker,${PHONE_PROCESSING_CATALOG} as catalog,md5((${PHONE_PROCESSING_CATALOG})::text) as fingerprint,(select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_phone_processing_preserved x) as preserved;
commit;
`.replace(/[ \t]+$/gm, "");
  const manifest = {
    version: "learn-phone-processing-package/1",
    projectRef: TEST_PROJECT,
    sha256: hash(sql),
    priorFingerprint: prior.fingerprint,
    sources: inputs.map((s) => ({ path: s.path, sha256: hash(s.source) })),
    assertionSha256: hash(assertion),
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
export function phoneProcessingPackage() {
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
  if (
    hash(sql) !== PHONE_PROCESSING_SHA ||
    manifest.sha256 !== PHONE_PROCESSING_SHA ||
    manifest.projectRef !== TEST_PROJECT ||
    manifest.sources.length !== paths.length ||
    hash(phoneProcessingHostedProbe()) !== manifest.assertionSha256 ||
    manifest.sources.some((s, i) => s.path !== paths[i] || hash(readFileSync(s.path)) !== s.sha256)
  )
    throw Error("Pinned phone processing package changed");
  return { sql, manifest };
}
export async function releasePhoneProcessing({
  mode,
  allowProjectRef,
  token,
  persistJournal,
  query = communicationQuery,
  catalog = readPhoneProcessingCatalog,
  rehearsal,
}) {
  if (
    !["rehearse", "apply"].includes(mode) ||
    allowProjectRef !== TEST_PROJECT ||
    typeof persistJournal !== "function" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token ?? "")
  )
    throw Error("Explicit TEST operation and durable journal required");
  const { sql, manifest } = phoneProcessingPackage();
  if (
    mode === "apply" &&
    (rehearsal?.state !== "rehearsed_rolled_back" ||
      rehearsal.sourceSha256 !== PHONE_PROCESSING_SHA ||
      rehearsal.projectRef !== TEST_PROJECT ||
      rehearsal.priorFingerprint !== manifest.priorFingerprint ||
      !Number.isFinite(Date.parse(rehearsal.observedAt)) ||
      Date.now() - Date.parse(rehearsal.observedAt) < 0 ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000 ||
      !/^[a-f0-9]{32}$/.test(rehearsal.expectedFingerprint ?? ""))
  )
    throw Error("Exact successful rehearsal required");
  const [before, rows] = await Promise.all([catalog(token), query(token, snapshotQuery())]),
    preserved = sources(rows);
  if (before.fingerprint !== manifest.priorFingerprint) throw Error("TEST prerequisites changed");
  const journal = {
    version: "learn-phone-processing/1",
    projectRef: TEST_PROJECT,
    mode,
    sourceSha256: PHONE_PROCESSING_SHA,
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
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${PHONE_PROCESSING_SHA}';\n` +
        (mode === "rehearse" ? sql.replace(/\ncommit;\n$/, "\nrollback;\n") : sql),
      { readOnly: false },
    );
    if (result.length === 1 && result[0].marker === "learn-phone-processing/1") receipt = result[0];
  } catch (error) {
    submissionFailure =
      error?.name === "TimeoutError" ? "request_timeout" : "submission_unconfirmed";
    /* Never resubmit an uncertain transaction. */
  }
  const [after, afterRows] = await Promise.all([
    catalog(token),
    query(token, snapshotQuery()),
  ]);
  const unchanged = JSON.stringify(preserved) === JSON.stringify(sources(afterRows));
  const expected = mode === "rehearse" ? receipt?.fingerprint : rehearsal.expectedFingerprint;
  const ledger = receipt?.catalog?.base?.ledger;
  const validReceipt =
    /^[a-f0-9]{32}$/.test(receipt?.fingerprint ?? "") &&
    receipt?.catalog?.phone?.tables?.length === 10 && receipt?.catalog?.phone?.functions?.length === 4 &&
    ledger?.length === 56 &&
    ledger.every((r) => r.project === TEST_PROJECT) &&
    ledger.filter((r) => r.name === "learn_phone_processing_v1" && r.sha256 === PHONE_PROCESSING_SHA)
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
    sourceSha256: PHONE_PROCESSING_SHA,
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
          functions: receipt.catalog?.phone?.functions?.length,
        }
      : null,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).join(" ") === "--prepare")
      console.log(JSON.stringify(preparePhoneProcessingPackage(), null, 2));
    else {
      const mode = process.argv[2]?.slice(2);
      if (
        process.argv.length !== 4 ||
        process.argv[3] !== "--existing-cli-login" ||
        process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
      )
        throw Error("Explicit TEST operation required");
      const stem = ".verification-results/phone-processing-" + mode;
      const result = await releasePhoneProcessing({
        mode,
        allowProjectRef: TEST_PROJECT,
        token: savedCliToken(),
        rehearsal:
          mode === "apply"
            ? JSON.parse(readFileSync(".verification-results/phone-processing-rehearse-result.json"))
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
      "Phone processing release unconfirmed; inspect retained journal and schema before any further attempt.",
    );
    process.exitCode = 1;
  }
}
