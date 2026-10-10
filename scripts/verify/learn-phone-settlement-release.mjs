/** Additive TEST phone settlement release. Does not activate a channel or trigger. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  SETTLEMENT_CATALOG,
  SETTLEMENT_SNAPSHOT,
  SETTLEMENT_PRESERVED,
  readPhoneSettlementCatalog,
} from "./learn-phone-settlement-catalog.mjs";
export const PHONE_SETTLEMENT_SHA =
  "1cebbbe0f05f4cee9b026663dbc0dc8e2d9f70b2b309b623267156e9bb11fe85";
const prefix = "supabase/release/learn-test/041_phone_settlement";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const paths = [
  "supabase/migrations/20261101008000_learn_phone_import_completion.sql",
  "supabase/migrations/20261101009000_learn_phone_schedule_settlement.sql",
];
const assertionPath = "scripts/verify/learn-phone-settlement-hosted.assert.sql";
const sorted = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
function sources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== SETTLEMENT_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !SETTLEMENT_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete preservation evidence required");
  return sorted(rows);
}
export function preparePhoneSettlementPackage() {
  const prior = JSON.parse(readFileSync(".verification-results/phone-settlement-prior.json"));
  if (
    prior.catalog.phone.tables.length !== 8 ||
    prior.catalog.phone.functions.length !== 5 ||
    prior.catalog.base.base.delivery.health.runtime.ledger.length !== 41 ||
    prior.catalog.base.base.delivery.health.runtime.ledger.some(
      (r) => r.project_ref !== TEST_PROJECT,
    ) ||
    !/^[a-f0-9]{32}$/.test(prior.fingerprint)
  )
    throw Error("Exact pre-settlement TEST prerequisites required");
  sources(prior.preserved);
  const inputs = paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const assertion = readFileSync(assertionPath, "utf8");
  const bodies = inputs.map((s) =>
    s.source.replace("\nbegin;\n", "\n").replace("\ncommit;\n", "\n"),
  );
  const sql = `-- TEST-only shared phone settlement foundation; no activation, user-access grants or source imports.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if md5((${SETTLEMENT_CATALOG})::text) <> '${prior.fingerprint}' then raise exception 'Exact phone settlement prerequisites required';end if;
end $$;
create temporary table serviceos_phone_settlement_preserved on commit drop as ${SETTLEMENT_SNAPSHOT};
${bodies.join("\n")}
savepoint phone_settlement_probe;
${assertion}
rollback to savepoint phone_settlement_probe;
release savepoint phone_settlement_probe;
do $$begin
 if exists(select 1 from public.learn_phone_import_completions) or exists(select 1 from public.learn_phone_schedule_settlements) then raise exception 'Synthetic settlement receipts remained';end if;
 if (select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_phone_settlement_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (${SETTLEMENT_SNAPSHOT})x) then raise exception 'Retained sources changed during phone settlement release';end if;
end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_phone_settlement_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-phone-settlement/1' as marker,${SETTLEMENT_CATALOG} as catalog,md5((${SETTLEMENT_CATALOG})::text) as fingerprint,(select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_phone_settlement_preserved x) as preserved;
commit;
`;
  const manifest = {
    version: "learn-phone-settlement-package/1",
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
export function phoneSettlementPackage() {
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
  if (
    hash(sql) !== PHONE_SETTLEMENT_SHA ||
    manifest.sha256 !== PHONE_SETTLEMENT_SHA ||
    manifest.projectRef !== TEST_PROJECT ||
    manifest.sources.length !== paths.length ||
    manifest.assertion?.path !== assertionPath ||
    hash(readFileSync(assertionPath)) !== manifest.assertion.sha256 ||
    manifest.sources.some((s, i) => s.path !== paths[i] || hash(readFileSync(s.path)) !== s.sha256)
  )
    throw Error("Pinned phone settlement package changed");
  return { sql, manifest };
}
export async function releasePhoneSettlement({
  mode,
  allowProjectRef,
  token,
  persistJournal,
  query = communicationQuery,
  catalog = readPhoneSettlementCatalog,
  rehearsal,
}) {
  if (
    !["rehearse", "apply"].includes(mode) ||
    allowProjectRef !== TEST_PROJECT ||
    typeof persistJournal !== "function" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token ?? "")
  )
    throw Error("Explicit TEST operation and durable journal required");
  const { sql, manifest } = phoneSettlementPackage();
  if (
    mode === "apply" &&
    (rehearsal?.state !== "rehearsed_rolled_back" ||
      rehearsal.sourceSha256 !== PHONE_SETTLEMENT_SHA ||
      rehearsal.projectRef !== TEST_PROJECT ||
      !/^[a-f0-9]{32}$/.test(rehearsal.expectedFingerprint ?? ""))
  )
    throw Error("Exact successful rehearsal required");
  const [before, rows] = await Promise.all([catalog(token), query(token, SETTLEMENT_SNAPSHOT)]),
    preserved = sources(rows);
  if (before.fingerprint !== manifest.priorFingerprint) throw Error("TEST prerequisites changed");
  const journal = {
    version: "learn-phone-settlement/1",
    projectRef: TEST_PROJECT,
    mode,
    sourceSha256: PHONE_SETTLEMENT_SHA,
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
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${PHONE_SETTLEMENT_SHA}';\n` +
        (mode === "rehearse" ? sql.replace(/\ncommit;\n$/, "\nrollback;\n") : sql),
      { readOnly: false },
    );
    if (result.length === 1 && result[0].marker === "learn-phone-settlement/1") receipt = result[0];
  } catch {
    /* Never resubmit an uncertain transaction. */
  }
  const [after, afterRows] = await Promise.all([catalog(token), query(token, SETTLEMENT_SNAPSHOT)]);
  const unchanged = JSON.stringify(preserved) === JSON.stringify(sources(afterRows));
  const expected = mode === "rehearse" ? receipt?.fingerprint : rehearsal.expectedFingerprint;
  const validReceipt =
    receipt?.catalog?.phone?.tables?.length === 10 &&
    receipt?.catalog?.phone?.functions?.length === 7 &&
    receipt?.catalog?.base?.base?.delivery?.health?.runtime?.ledger?.length === 42 &&
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
    sourceSha256: PHONE_SETTLEMENT_SHA,
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
      console.log(JSON.stringify(preparePhoneSettlementPackage(), null, 2));
    else {
      const mode = process.argv[2]?.slice(2);
      if (
        process.argv.length !== 4 ||
        process.argv[3] !== "--existing-cli-login" ||
        process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
      )
        throw Error("Explicit TEST operation required");
      const stem = ".verification-results/phone-settlement-" + mode;
      const result = await releasePhoneSettlement({
        mode,
        allowProjectRef: TEST_PROJECT,
        token: savedCliToken(),
        rehearsal:
          mode === "apply"
            ? JSON.parse(
                readFileSync(".verification-results/phone-settlement-rehearse-result.json"),
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
      "Phone settlement release unconfirmed; inspect retained journal and schema before any further attempt.",
    );
    process.exitCode = 1;
  }
}
