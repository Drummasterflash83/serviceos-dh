/** TEST-only read-model release. No source/user/grant writes or provider calls. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  MAILBOX_CHANGES_CATALOG,
  readMailboxChangesCatalog,
  mailboxChangesSnapshot,
} from "./learn-email-mailbox-changes-catalog.mjs";
const prefix = "supabase/release/learn-test/072_email_retention_health";
const prior = "6feb54fea0efbe744d0775cf01f90e22";
const migrationPath = "supabase/migrations/20261101410000_learn_email_retention_health.sql";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
const signature = "public.learn_operator_capture_health(uuid,text)";
const meta = `select jsonb_build_object('owner',proowner,'acl',proacl,'securityDefiner',prosecdef,'config',proconfig) as permissions,md5(pg_get_functiondef(oid)) as digest from pg_proc where oid='${signature}'::regprocedure`;
const mode = process.argv[2];
if (
  !["--prepare", "--rehearse", "--apply"].includes(mode) ||
  process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST scope required");
const token = savedCliToken(),
  query = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
const before = await readMailboxChangesCatalog(token);
if (before.fingerprint !== prior) throw Error("Exact TEST 071 required; inspect before retry");
const authority = (await query(meta))[0];
const snapshot = mailboxChangesSnapshot(before.catalog.phone, { archive: true });
const preserved = await query(snapshot);
if (preserved.length !== 124) throw Error("Complete preservation inventory required");
const migration = readFileSync(migrationPath, "utf8");
if (mode === "--prepare") {
  const body = migration.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
  const aggregate = migration.slice(
    migration.indexOf(" with source as ("),
    migration.indexOf(" return jsonb_build_object('version','learn-operator-capture-health/1'"),
  );
  const sql = `-- TEST 072: read-only operator email-retention counts, existing authority unchanged.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$'
 or md5((${MAILBOX_CHANGES_CATALOG})::text)<>'${prior}'
 or (select digest from (${meta})m)<>'${authority.digest}' then raise exception 'Exact TEST retention prerequisites required';end if;
end$$;
create temporary table retention_preserved on commit drop as ${snapshot};
create temporary table retention_authority on commit drop as ${meta};
${body}
-- Run the exact aggregate against the retained, archived synthetic HTTP fixture.
-- It creates no source records, accounts, sessions or authority grants.
do $$declare p_tenant uuid:='ec400710-aaaa-4000-8000-000000000001';email_retention jsonb;begin
${aggregate}
 assert email_retention=jsonb_build_object('version','learn-email-retention/1','tenant_id',p_tenant,'scope','company','total',1,'available',1,'unavailable',0,'unverified',0,'unbound',0,'archived_versions',2),'Retained synthetic history differs';
 p_tenant:='ec400720-aaaa-4000-8000-000000000001';
 assert not exists(select 1 from public.tenants where id=p_tenant),'Empty-scope fixture unexpectedly exists';
${aggregate}
 assert email_retention->>'total'='0' and email_retention->>'archived_versions'='0','Cross-tenant retention leak';
end$$;
set local request.jwt.claim.sub='';set local request.jwt.claim.role='authenticated';set local role authenticated;
do $$begin
 begin perform public.learn_operator_capture_health('ec400710-aaaa-4000-8000-000000000001');raise exception 'Unsigned operator read accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 if (select permissions from retention_authority) is distinct from (select permissions from (${meta})m) then raise exception 'Operator authority changed';end if;
 if (select jsonb_agg(to_jsonb(x) order by name) from retention_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by name) from (${snapshot})x) then raise exception 'Source preservation failed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_email_retention_health_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'email-retention-installed/1' as marker,md5((${MAILBOX_CHANGES_CATALOG})::text) as fingerprint,(select digest from (${meta})m) as digest;
commit;
`;
  const manifest = {
    projectRef: TEST_PROJECT,
    sha256: hash(sql),
    migrationPath,
    migrationSha256: hash(migration),
    priorFingerprint: prior,
    priorFunctionDigest: authority.digest,
    preservedDatasets: 124,
  };
  writeFileSync(prefix + ".sql", sql, { flag: "wx" });
  writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(JSON.stringify({ state: "prepared", ...manifest }));
} else {
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
  if (
    manifest.sha256 !== hash(sql) ||
    manifest.migrationSha256 !== hash(migration) ||
    manifest.projectRef !== TEST_PROJECT ||
    manifest.priorFunctionDigest !== authority.digest
  )
    throw Error("Pinned release differs");
  const rehearsal =
    mode === "--apply"
      ? JSON.parse(readFileSync(".verification-results/email-retention-rehearse-result.json"))
      : null;
  if (
    rehearsal &&
    (rehearsal.state !== "rehearsed_rolled_back" ||
      rehearsal.packageSha256 !== manifest.sha256 ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000)
  )
    throw Error("Fresh exact rehearsal required");
  const stem = ".verification-results/email-retention-" + mode.slice(2);
  const journal = {
    projectRef: TEST_PROJECT,
    mode,
    packageSha256: manifest.sha256,
    startedAt: new Date().toISOString(),
    preserved,
    authority,
  };
  const fd = openSync(stem + "-journal.json", "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(journal, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  let response = null;
  try {
    response = await query(
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${manifest.sha256}';\n` +
        (mode === "--rehearse" ? sql.replace(/\ncommit;\n$/, "\nrollback;\n") : sql),
      false,
    );
  } catch {
    /* Never repeat an uncertain submission. */
  }
  const after = await readMailboxChangesCatalog(token),
    afterMeta = (await query(meta))[0],
    afterData = await query(snapshot);
  const receipt = response?.find((r) => r.marker === "email-retention-installed/1");
  const expected = mode === "--rehearse" ? receipt : rehearsal.expected;
  const ok =
    stable(afterData) === stable(preserved) &&
    JSON.stringify(afterMeta.permissions) === JSON.stringify(authority.permissions) &&
    expected &&
    /^[a-f0-9]{32}$/.test(expected.digest) &&
    (mode === "--rehearse"
      ? after.fingerprint === prior && afterMeta.digest === authority.digest
      : after.fingerprint === expected.fingerprint && afterMeta.digest === expected.digest);
  const result = {
    state: ok
      ? mode === "--rehearse"
        ? "rehearsed_rolled_back"
        : "installed_read_model_verified"
      : "requires_inspection",
    observedAt: new Date().toISOString(),
    projectRef: TEST_PROJECT,
    packageSha256: manifest.sha256,
    expected: expected ?? null,
    preservedDatasets: stable(afterData) === stable(preserved) ? 124 : null,
    authorityUnchanged:
      JSON.stringify(afterMeta.permissions) === JSON.stringify(authority.permissions),
    newAuthUsers: 0,
    newGrants: 0,
    providerRequests: 0,
    productionChanged: false,
    limitations: [
      "Actual aggregate verified against retained synthetic TEST records; positive operator HTTP and signed-in UI acceptance remain pending.",
    ],
  };
  writeFileSync(stem + "-result.json", JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exitCode = 1;
}
