/** Pinned TEST-only mailbox changes release. Never resubmits uncertain writes. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  QUEUE_CATALOG,
  readQueueCatalog,
  queueInstalledSnapshot,
} from "./learn-processing-queue-catalog.mjs";
import {
  emailMigrationAccessBegin,
  emailMigrationAccessEnd,
  emailMigrationAccessSnapshot,
} from "./learn-email-migration-access.mjs";
import {
  MAILBOX_CHANGES_CATALOG,
  readMailboxChangesCatalog,
  mailboxChangesSnapshot,
} from "./learn-email-mailbox-changes-catalog.mjs";
import { CHANGES_SHA } from "./learn-email-mailbox-changes-runtime-deploy.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
const prefix = "supabase/release/learn-test/071_email_mailbox_changes";
const prior = "a1131b60b5fc1c022c772147078365a3";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const probePath = "scripts/verify/learn-email-mailbox-changes-probe.sql";
const absent = `select to_regclass('public.learn_email_source_versions') is null and not exists(select 1 from tenants where id='ec400700-cccc-4000-8000-000000000001') as absent`;
const retainedNull = `select not exists(select 1 from email_ingestion_checkpoints where continuation->>'version'='4') as generations_empty, not exists(select 1 from tenants where id='ec400700-cccc-4000-8000-000000000001') as fixtures_absent`;
const guardDigest = `md5(pg_get_functiondef('public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure))`;
async function main() {
  const mode = process.argv[2];
  if (
    !["--prepare", "--rehearse", "--apply"].includes(mode) ||
    process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST scope required");
  const token = savedCliToken(),
    before = await readQueueCatalog(token);
  if (before.fingerprint !== prior)
    throw Error("Exact TEST 070 required; inspect existing state before any retry");
  if ((await communicationQuery(token, absent))[0]?.absent !== true)
    throw Error("Unexpected existing projection objects");
  const authorityBefore = await communicationQuery(token, emailMigrationAccessSnapshot);
  const snapshot = mailboxChangesSnapshot(before.catalog.phone),
    preserved = await communicationQuery(token, snapshot);
  if (preserved.length !== 123) throw Error("All 123 retained datasets required");
  const files = ["20261101400000_learn_email_mailbox_changes.sql"].map((file) => ({
    file,
    sql: readFileSync("supabase/migrations/" + file, "utf8"),
  }));
  const migrations = files.map((f) => ({ file: f.file, sha256: hash(f.sql) }));
  const probe = readFileSync(probePath, "utf8");
  if (mode === "--prepare") {
    const rehearsed = JSON.parse(
      readFileSync(".verification-results/email-mailbox-changes-rehearsal-v3-result.json"),
    );
    const journal = JSON.parse(
      readFileSync(".verification-results/email-mailbox-changes-rehearsal-v3-journal.json"),
    );
    if (
      rehearsed.state !== "full_schema_rehearsed_and_rolled_back" ||
      rehearsed.migrationSha256 !== migrations[0].sha256 ||
      journal.probeSha256 !== hash(probe)
    )
      throw Error("Matching full-schema rehearsal required");
    const body = files
      .map((f) => f.sql.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, ""))
      .join("\n");
    const sql = `-- TEST 071: mailbox-wide recent email capture. No capture activation.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$'
 or md5((${QUEUE_CATALOG})::text)<>'${prior}' or not (${absent}) then raise exception 'Exact TEST projection prerequisites required';end if;
end$$;
create temporary table projection_preserved on commit drop as ${snapshot};
${emailMigrationAccessBegin}
${body}
${emailMigrationAccessEnd}
savepoint projection_assertions;
${probe}
rollback to savepoint projection_assertions;
release savepoint projection_assertions;
do $$begin
 if (select jsonb_agg(to_jsonb(x) order by x.name) from projection_preserved x) is distinct from
 (select jsonb_agg(to_jsonb(x) order by x.name) from (${snapshot})x) then raise exception 'Retained source preservation failed';end if;
 if not (select bool_and(generations_empty and fixtures_absent) from (${retainedNull})s) then raise exception 'Unexpected capture generation created';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref)
 values(current_setting('serviceos.release_source_sha256'),'learn_email_mailbox_changes_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-email-mailbox-changes-installed/1' as marker,md5((${MAILBOX_CHANGES_CATALOG})::text) as fingerprint,${guardDigest} as guard_digest;
commit;
`.replace(/[ \t]+$/gm, "");
    const manifest = {
      projectRef: TEST_PROJECT,
      sha256: hash(sql),
      migrations,
      probeSha256: hash(probe),
      priorFingerprint: prior,
      preservedDatasets: 123,
    };
    writeFileSync(prefix + ".sql", sql, { flag: "wx" });
    writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(JSON.stringify({ state: "prepared", ...manifest }));
    return;
  }
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
  if (
    manifest.sha256 !== hash(sql) ||
    manifest.projectRef !== TEST_PROJECT ||
    manifest.priorFingerprint !== prior ||
    JSON.stringify(manifest.migrations) !== JSON.stringify(migrations) ||
    manifest.probeSha256 !== hash(probe)
  )
    throw Error("Pinned package differs");
  const rehearsal =
    mode === "--apply"
      ? JSON.parse(
          readFileSync(
            ".verification-results/email-mailbox-changes-package-rehearse-v1-result.json",
          ),
        )
      : null;
  if (
    rehearsal &&
    (rehearsal.state !== "rehearsed_rolled_back" ||
      rehearsal.packageSha256 !== manifest.sha256 ||
      !/^[a-f0-9]{32}$/.test(rehearsal.expectedFingerprint ?? "") ||
      Date.now() - Date.parse(rehearsal.completedAt) > 3600000)
  )
    throw Error("Fresh exact package rehearsal required");
  if (mode === "--apply") {
    const runtime = JSON.parse(
      readFileSync(".verification-results/email-mailbox-changes-runtime-readback-result.json"),
    );
    const inventory = await edgeInventory(token),
      worker = inventory.find((x) => x.slug === "platform-worker");
    if (
      runtime.state !== "downloaded_runtime_and_handler_tests_verified" ||
      runtime.sourceBundleSha256 !== CHANGES_SHA ||
      worker?.version !== 17 ||
      worker.status !== "ACTIVE" ||
      worker.verify_jwt !== false
    )
      throw Error("Compatible verified TEST worker v17 must be installed before schema activation");
  }
  const stem =
    ".verification-results/email-mailbox-changes-package-" +
    (mode === "--rehearse" ? "rehearse-v1" : "apply");
  const journal = {
    projectRef: TEST_PROJECT,
    packageSha256: manifest.sha256,
    mode,
    startedAt: new Date().toISOString(),
    before: prior,
    preserved,
  };
  const fd = openSync(stem + "-journal.json", "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(journal, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  let result = null;
  try {
    result = await communicationQuery(
      token,
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${manifest.sha256}';\n` +
        (mode === "--rehearse" ? sql.replace(/\ncommit;\n$/, "\nrollback;\n") : sql),
      { readOnly: false },
    );
  } catch {
    /* Read authoritative state; never retry submission. */
  }
  const after = await readMailboxChangesCatalog(token),
    afterRows = await communicationQuery(token, snapshot);
  const expected =
    mode === "--rehearse"
      ? result?.find((r) => r.marker === "learn-email-mailbox-changes-installed/1")?.fingerprint
      : rehearsal.expectedFingerprint;
  const preservedOk = stable(preserved) === stable(afterRows);
  const expectedTransition =
    mode === "--rehearse"
      ? result?.find((r) => r.marker === "learn-email-mailbox-changes-installed/1")?.guard_digest
      : rehearsal.expectedTransitionDigest;
  const actualTransition =
    mode === "--apply"
      ? (await communicationQuery(token, `select ${guardDigest} as digest`))[0]?.digest
      : null;
  let verified = false,
    installedRows = null;
  if (mode === "--rehearse")
    verified =
      preservedOk &&
      /^[a-f0-9]{32}$/.test(expected ?? "") &&
      (await readQueueCatalog(token)).fingerprint === prior &&
      (await communicationQuery(token, absent))[0]?.absent === true;
  else if (
    after.fingerprint === expected &&
    /^[a-f0-9]{32}$/.test(expectedTransition ?? "") &&
    actualTransition === expectedTransition
  ) {
    const flags = (await communicationQuery(token, retainedNull))[0];
    installedRows = await communicationQuery(
      token,
      mailboxChangesSnapshot(after.catalog.phone, { archive: true }),
    );
    verified =
      preservedOk &&
      Object.values(flags).length === 2 &&
      Object.values(flags).every((v) => v === true) &&
      installedRows.length === 124;
  }
  const authorityAfter = await communicationQuery(token, emailMigrationAccessSnapshot);
  const authorityRestored = JSON.stringify(authorityBefore) === JSON.stringify(authorityAfter);
  verified = verified && authorityRestored;
  const report = {
    projectRef: TEST_PROJECT,
    state: verified
      ? mode === "--rehearse"
        ? "rehearsed_rolled_back"
        : "installed_needs_hosted_acceptance"
      : "requires_inspection",
    completedAt: new Date().toISOString(),
    packageSha256: manifest.sha256,
    expectedFingerprint: expected ?? null,
    expectedTransitionDigest: expectedTransition ?? null,
    afterFingerprint: after.fingerprint,
    preservedDatasets: preservedOk ? 123 : null,
    installedPreservationDatasets: installedRows?.length ?? null,
    persistentFixtureUsers: 0,
    newSessions: 0,
    newPlatformGrants: 0,
    persistentRoleGrantsCreated: 0,
    temporaryMembershipsRevoked: 1,
    authorityRestored,
    providerRequests: 0,
    productionChanged: false,
  };
  writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  if (installedRows)
    writeFileSync(
      stem + "-installed-preservation.json",
      JSON.stringify(installedRows, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  console.log(JSON.stringify(report, null, 2));
  if (!verified) process.exitCode = 1;
}
main().catch((e) => {
  console.error("Email mailbox changes release unconfirmed: " + e.message);
  process.exitCode = 1;
});
