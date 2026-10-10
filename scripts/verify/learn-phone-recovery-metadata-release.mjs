/** Additive TEST phone recovery metadata release. Does not activate a channel or trigger. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  PHONE_CATALOG,
  PHONE_SNAPSHOT,
  PHONE_PRESERVED,
  readPhonePublicationCatalog,
} from "./learn-phone-publication-catalog.mjs";
export const RECOVERY_METADATA_SHA =
  "1d124044e33984ec4a1ab109fe29e0dc7b73ebaf236a29c8a96804900b0f21b4";
const prefix = "supabase/release/learn-test/040_phone_recovery_metadata";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const paths = ["supabase/migrations/20261101007000_learn_phone_recovery_metadata_access.sql"];
const sorted = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
function sources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== PHONE_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !PHONE_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete preservation evidence required");
  return sorted(rows);
}
export function prepareRecoveryMetadataPackage() {
  const prior = JSON.parse(
    readFileSync(".verification-results/phone-recovery-metadata-prior.json"),
  );
  if (
    prior.catalog.phone.tables.length !== 8 ||
    prior.catalog.phone.functions.length !== 5 ||
    prior.catalog.base.base.delivery.health.runtime.ledger.length !== 40 ||
    prior.catalog.base.base.delivery.health.runtime.ledger.some(
      (r) => r.project_ref !== TEST_PROJECT,
    ) ||
    !/^[a-f0-9]{32}$/.test(prior.fingerprint)
  )
    throw Error("Exact pre-publication TEST prerequisites required");
  sources(prior.preserved);
  const inputs = paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const bodies = inputs.map((s) =>
    s.source.replace("\nbegin;\n", "\n").replace("\ncommit;\n", "\n"),
  );
  const sql = `-- TEST-only shared phone recovery metadata foundation; no activation, access grants or source imports.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if md5((${PHONE_CATALOG})::text) <> '${prior.fingerprint}' then raise exception 'Exact phone recovery metadata prerequisites required';end if;
end $$;
create temporary table serviceos_phone_recovery_preserved on commit drop as ${PHONE_SNAPSHOT};
${bodies.join("\n")}
do $$begin
 if (select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_phone_recovery_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (${PHONE_SNAPSHOT})x) then raise exception 'Retained sources changed during phone recovery metadata release';end if;
end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_phone_recovery_metadata_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-phone-recovery-metadata/1' as marker,${PHONE_CATALOG} as catalog,md5((${PHONE_CATALOG})::text) as fingerprint,(select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_phone_recovery_preserved x) as preserved;
commit;
`;
  const manifest = {
    version: "learn-phone-recovery-metadata-package/1",
    projectRef: TEST_PROJECT,
    sha256: hash(sql),
    priorFingerprint: prior.fingerprint,
    sources: inputs.map((s) => ({ path: s.path, sha256: hash(s.source) })),
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
export function recoveryMetadataPackage() {
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
  if (
    hash(sql) !== RECOVERY_METADATA_SHA ||
    manifest.sha256 !== RECOVERY_METADATA_SHA ||
    manifest.projectRef !== TEST_PROJECT ||
    manifest.sources.length !== paths.length ||
    manifest.sources.some((s, i) => s.path !== paths[i] || hash(readFileSync(s.path)) !== s.sha256)
  )
    throw Error("Pinned phone recovery metadata package changed");
  return { sql, manifest };
}
export async function releaseRecoveryMetadata({
  mode,
  allowProjectRef,
  token,
  persistJournal,
  query = communicationQuery,
  catalog = readPhonePublicationCatalog,
  rehearsal,
}) {
  if (
    !["rehearse", "apply"].includes(mode) ||
    allowProjectRef !== TEST_PROJECT ||
    typeof persistJournal !== "function" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token ?? "")
  )
    throw Error("Explicit TEST operation and durable journal required");
  const { sql, manifest } = recoveryMetadataPackage();
  if (
    mode === "apply" &&
    (rehearsal?.state !== "rehearsed_rolled_back" ||
      rehearsal.sourceSha256 !== RECOVERY_METADATA_SHA ||
      rehearsal.projectRef !== TEST_PROJECT ||
      !/^[a-f0-9]{32}$/.test(rehearsal.expectedFingerprint ?? ""))
  )
    throw Error("Exact successful rehearsal required");
  const [before, rows] = await Promise.all([catalog(token), query(token, PHONE_SNAPSHOT)]),
    preserved = sources(rows);
  if (before.fingerprint !== manifest.priorFingerprint) throw Error("TEST prerequisites changed");
  const journal = {
    version: "learn-phone-recovery-metadata/1",
    projectRef: TEST_PROJECT,
    mode,
    sourceSha256: RECOVERY_METADATA_SHA,
    priorFingerprint: before.fingerprint,
    expectedFingerprint: rehearsal?.expectedFingerprint ?? null,
    preserved,
    observedAt: new Date().toISOString(),
  };
  await persistJournal(journal);
  let receipt = null;
  try {
    const result = await query(
      token,
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${RECOVERY_METADATA_SHA}';\n` +
        (mode === "rehearse" ? sql.replace(/\ncommit;\n$/, "\nrollback;\n") : sql),
      { readOnly: false },
    );
    if (result.length === 1 && result[0].marker === "learn-phone-recovery-metadata/1")
      receipt = result[0];
  } catch {
    /* Never resubmit an uncertain transaction. */
  }
  const [after, afterRows] = await Promise.all([catalog(token), query(token, PHONE_SNAPSHOT)]);
  const unchanged = JSON.stringify(preserved) === JSON.stringify(sources(afterRows));
  const expected = mode === "rehearse" ? receipt?.fingerprint : rehearsal.expectedFingerprint;
  const validReceipt =
    receipt?.catalog?.phone?.tables?.length === 8 &&
    receipt?.catalog?.phone?.functions?.length === 5 &&
    receipt?.catalog?.base?.base?.delivery?.health?.runtime?.ledger?.length === 41 &&
    JSON.stringify(preserved) === JSON.stringify(sources(receipt?.preserved ?? []));
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
    sourceSha256: RECOVERY_METADATA_SHA,
    mode,
    state,
    observedAt: new Date().toISOString(),
    priorFingerprint: before.fingerprint,
    expectedFingerprint: expected,
    afterFingerprint: after.fingerprint,
    preservedDataSets: unchanged ? preserved.length : null,
    receipt: receipt
      ? {
          fingerprint: receipt.fingerprint,
          tables: receipt.catalog?.phone?.tables?.length,
          functions: receipt.catalog?.phone?.functions?.length,
        }
      : null,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).join(" ") === "--prepare")
      console.log(JSON.stringify(prepareRecoveryMetadataPackage(), null, 2));
    else {
      const mode = process.argv[2]?.slice(2);
      if (
        process.argv.length !== 4 ||
        process.argv[3] !== "--existing-cli-login" ||
        process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
      )
        throw Error("Explicit TEST operation required");
      const stem = ".verification-results/phone-recovery-metadata-" + mode;
      const result = await releaseRecoveryMetadata({
        mode,
        allowProjectRef: TEST_PROJECT,
        token: savedCliToken(),
        rehearsal:
          mode === "apply"
            ? JSON.parse(
                readFileSync(".verification-results/phone-recovery-metadata-rehearse-result.json"),
              )
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
      "Phone recovery metadata release unconfirmed; inspect retained journal and schema before any further attempt.",
    );
    process.exitCode = 1;
  }
}
