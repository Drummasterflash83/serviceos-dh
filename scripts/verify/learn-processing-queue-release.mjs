/** Pinned TEST-only atomic identity review release. Never resubmits uncertain writes. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readIdentityReviewCatalog,
  IDENTITY_REVIEW_CATALOG,
  identityReviewInstalledSnapshot,
} from "./learn-identity-review-catalog.mjs";
import {
  QUEUE_CATALOG,
  readQueueCatalog,
  queueInstalledSnapshot,
} from "./learn-processing-queue-catalog.mjs";
const prefix = "supabase/release/learn-test/066_processing_queue";
const prior = "d6a28f8f2e3cf36b9660ba0386077eb6";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const probePath = "scripts/verify/learn-processing-queue.assert.sql";
const absent = `select to_regclass('public.learn_processing_publications') is null
 and to_regclass('public.learn_processing_settlements') is null
 and to_regprocedure('public.learn_identity_review_count(uuid)') is null
 and to_regprocedure('public.learn_processing_publish(uuid,uuid,text,integer,uuid,text,uuid,text,text)') is null
 and to_regprocedure('public.learn_processing_settle(uuid,uuid,text,integer,uuid,jsonb,text)') is null
 and not exists(select 1 from public.tenants where id in('dd780923-ffff-4000-8000-000000000001','dd780923-ffff-4000-8000-000000000002')) as absent`;
const retainedNull = `select not exists(select 1 from public.learn_processing_publications) and not exists(select 1 from public.learn_processing_settlements) as receipts_empty, not exists(select 1 from public.tenants where id in('dd780923-ffff-4000-8000-000000000001','dd780923-ffff-4000-8000-000000000002')) as fixtures_absent`;
async function main() {
  const mode = process.argv[2];
  if (
    !["--prepare", "--rehearse", "--apply"].includes(mode) ||
    process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST scope required");
  const token = savedCliToken(),
    before = await readIdentityReviewCatalog(token);
  if (before.fingerprint !== prior)
    throw Error("Exact TEST 065 required; inspect existing state before any retry");
  if ((await communicationQuery(token, absent))[0]?.absent !== true)
    throw Error("Unexpected existing projection objects");
  const snapshot = identityReviewInstalledSnapshot(before.catalog.phone),
    preserved = await communicationQuery(token, snapshot);
  if (preserved.length !== 119) throw Error("All 119 retained datasets required");
  const files = ["20261101340000_learn_processing_queue.sql"].map((file) => ({
    file,
    sql: readFileSync("supabase/migrations/" + file, "utf8"),
  }));
  const migrations = files.map((f) => ({ file: f.file, sha256: hash(f.sql) }));
  const probe = readFileSync(probePath, "utf8");
  if (mode === "--prepare") {
    const rehearsed = JSON.parse(
      readFileSync(".verification-results/processing-queue-full-schema-v2-result.json"),
    );
    const journal = JSON.parse(
      readFileSync(".verification-results/processing-queue-full-schema-v2-journal.json"),
    );
    if (
      rehearsed.state !== "full_schema_rehearsed_and_rolled_back" ||
      rehearsed.sourceSha256 !== migrations[0].sha256 ||
      journal.probeSha256 !== hash(probe)
    )
      throw Error("Matching full-schema rehearsal required");
    const body = files
      .map((f) => f.sql.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, ""))
      .join("\n");
    const sql = `-- TEST 066: audited retained-input queue completion. No capture activation.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$'
 or md5((${IDENTITY_REVIEW_CATALOG})::text)<>'${prior}' or not (${absent}) then raise exception 'Exact TEST projection prerequisites required';end if;
end$$;
create temporary table projection_preserved on commit drop as ${snapshot};
${body}
savepoint projection_assertions;
${probe}
rollback to savepoint projection_assertions;
release savepoint projection_assertions;
do $$begin
 if (select jsonb_agg(to_jsonb(x) order by x.name) from projection_preserved x) is distinct from
 (select jsonb_agg(to_jsonb(x) order by x.name) from (${snapshot})x) then raise exception 'Retained source preservation failed';end if;
 if exists(select 1 from public.learn_processing_publications) or exists(select 1 from public.learn_processing_settlements) or exists(select 1 from public.tenants where id in('dd780923-ffff-4000-8000-000000000001','dd780923-ffff-4000-8000-000000000002')) then raise exception 'Unexpected retained projection data';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref)
 values(current_setting('serviceos.release_source_sha256'),'learn_processing_queue_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-processing-queue-installed/1' as marker,md5((${QUEUE_CATALOG})::text) as fingerprint;
commit;
`.replace(/[ \t]+$/gm, "");
    const manifest = {
      projectRef: TEST_PROJECT,
      sha256: hash(sql),
      migrations,
      probeSha256: hash(probe),
      priorFingerprint: prior,
      preservedDatasets: 119,
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
          readFileSync(".verification-results/processing-queue-package-rehearse-v1-result.json"),
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
  const stem =
    ".verification-results/processing-queue-package-" +
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
  const after = await readQueueCatalog(token),
    afterRows = await communicationQuery(token, snapshot);
  const expected =
    mode === "--rehearse"
      ? result?.find((r) => r.marker === "learn-processing-queue-installed/1")?.fingerprint
      : rehearsal.expectedFingerprint;
  const preservedOk = stable(preserved) === stable(afterRows);
  let verified = false,
    installedRows = null;
  if (mode === "--rehearse")
    verified =
      preservedOk &&
      /^[a-f0-9]{32}$/.test(expected ?? "") &&
      (await readIdentityReviewCatalog(token)).fingerprint === prior &&
      (await communicationQuery(token, absent))[0]?.absent === true;
  else if (after.fingerprint === expected) {
    const flags = (await communicationQuery(token, retainedNull))[0];
    installedRows = await communicationQuery(token, queueInstalledSnapshot(after.catalog.phone));
    verified =
      preservedOk &&
      Object.values(flags).length === 2 &&
      Object.values(flags).every((v) => v === true) &&
      installedRows.length === 121;
  }
  const report = {
    projectRef: TEST_PROJECT,
    state: verified
      ? mode === "--rehearse"
        ? "rehearsed_rolled_back"
        : "installed_needs_worker_and_hosted_acceptance"
      : "requires_inspection",
    completedAt: new Date().toISOString(),
    packageSha256: manifest.sha256,
    expectedFingerprint: expected ?? null,
    afterFingerprint: after.fingerprint,
    preservedDatasets: preservedOk ? 119 : null,
    installedPreservationDatasets: installedRows?.length ?? null,
    persistentFixtureUsers: 0,
    newSessions: 0,
    newPlatformGrants: 0,
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
  console.error("Processing queue release unconfirmed: " + e.message);
  process.exitCode = 1;
});
