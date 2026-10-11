/** Pinned TEST-only draft eligibility release. Never resubmits uncertain writes. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  QUEUE_CATALOG,
  readQueueCatalog,
  queueInstalledSnapshot,
} from "./learn-processing-queue-catalog.mjs";
const prefix = "supabase/release/learn-test/070_card_projection_eligibility";
const prior = "db53a9b09d1cf3b70dea70278c1b7338";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const probePath = "scripts/verify/learn-card-draft-probe.sql";
const fixtureAbsent =
  "not exists(select 1 from tenants where id in('ed390000-aaaa-4000-8000-000000000001','ed390000-aaaa-4000-8000-000000000009'))";
const existingGuard =
  "md5(pg_get_functiondef('public.learn_email_is_draft(public.email_messages)'::regprocedure)||pg_get_functiondef('public.learn_interaction_is_draft(uuid,text,uuid)'::regprocedure))='b8c89f1b2c8c5bb6f396366e7b2ba537'";
const absent = `select to_regprocedure('public.learn_card_projection_inputs(uuid,uuid)') is null and ${fixtureAbsent} and ${existingGuard} as absent`;
const retainedNull = `select not has_function_privilege('anon','public.learn_card_projection_inputs(uuid,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.learn_card_projection_inputs(uuid,uuid)','EXECUTE') and has_function_privilege('service_role','public.learn_card_projection_inputs(uuid,uuid)','EXECUTE') and ${existingGuard} as guard_scoped, ${fixtureAbsent} as fixtures_absent`;
const guardDigest = `md5(pg_get_functiondef('public.learn_card_projection_inputs(uuid,uuid)'::regprocedure))`;
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
    throw Error("Exact TEST 069 required; inspect existing state before any retry");
  if ((await communicationQuery(token, absent))[0]?.absent !== true)
    throw Error("Unexpected existing projection objects");

  const snapshot = queueInstalledSnapshot(before.catalog.phone),
    preserved = await communicationQuery(token, snapshot);
  if (preserved.length !== 121) throw Error("All 121 retained datasets required");
  const files = ["20261101390000_learn_card_projection_eligibility.sql"].map((file) => ({
    file,
    sql: readFileSync("supabase/migrations/" + file, "utf8"),
  }));
  const migrations = files.map((f) => ({ file: f.file, sha256: hash(f.sql) }));
  const probe = readFileSync(probePath, "utf8");
  if (mode === "--prepare") {
    const rehearsed = JSON.parse(
      readFileSync(".verification-results/card-draft-rehearsal-v1-result.json"),
    );
    const journal = JSON.parse(
      readFileSync(".verification-results/card-draft-rehearsal-v1-journal.json"),
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
    const sql =
      `-- TEST 070: exclude retained drafts from card refresh evidence. No capture activation.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$'
 or md5((${QUEUE_CATALOG})::text)<>'${prior}' or not (${absent}) then raise exception 'Exact TEST projection prerequisites required';end if;
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
 if not (select bool_and(guard_scoped and fixtures_absent) from (${retainedNull})s) then raise exception 'Draft guard access or fixture preservation failed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref)
 values(current_setting('serviceos.release_source_sha256'),'learn_card_projection_eligibility_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-card-draft-installed/1' as marker,md5((${QUEUE_CATALOG})::text) as fingerprint,${guardDigest} as guard_digest;
commit;
`.replace(/[ \t]+$/gm, "");
    const manifest = {
      projectRef: TEST_PROJECT,
      sha256: hash(sql),
      migrations,
      probeSha256: hash(probe),
      priorFingerprint: prior,
      preservedDatasets: 121,
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
      ? JSON.parse(readFileSync(".verification-results/card-draft-package-rehearse-v1-result.json"))
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
    ".verification-results/card-draft-package-" + (mode === "--rehearse" ? "rehearse-v1" : "apply");
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
      ? result?.find((r) => r.marker === "learn-card-draft-installed/1")?.fingerprint
      : rehearsal.expectedFingerprint;
  const preservedOk = stable(preserved) === stable(afterRows);
  const expectedGuard =
    mode === "--rehearse"
      ? result?.find((r) => r.marker === "learn-card-draft-installed/1")?.guard_digest
      : rehearsal.expectedGuardDigest;
  const actualGuard =
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
    /^[a-f0-9]{32}$/.test(expectedGuard ?? "") &&
    actualGuard === expectedGuard
  ) {
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
        : "installed_needs_runtime_and_hosted_acceptance"
      : "requires_inspection",
    completedAt: new Date().toISOString(),
    packageSha256: manifest.sha256,
    expectedFingerprint: expected ?? null,
    expectedGuardDigest: expectedGuard ?? null,
    afterFingerprint: after.fingerprint,
    preservedDatasets: preservedOk ? 121 : null,
    installedPreservationDatasets: installedRows?.length ?? null,
    persistentFixtureUsers: 0,
    newSessions: 0,
    newPlatformGrants: 0,
    persistentRoleGrantsCreated: 0,
    temporaryMembershipsRevoked: 0,
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
  console.error("Card projection eligibility release unconfirmed: " + e.message);
  process.exitCode = 1;
});
