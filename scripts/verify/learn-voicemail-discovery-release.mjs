/** Fixed TEST discovery release; no users, jobs, routes, credentials or activation. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readVoicemailQueueCatalog,
  VOICEMAIL_QUEUE_CATALOG,
  voicemailQueueSnapshot,
} from "./learn-voicemail-queue-catalog.mjs";
import {
  readVoicemailDiscoveryCatalog,
  VOICEMAIL_DISCOVERY_CATALOG,
  VOICEMAIL_DISCOVERY_METADATA,
  VOICEMAIL_DISCOVERY_TABLES,
  VOICEMAIL_DISCOVERY_FUNCTIONS,
} from "./learn-voicemail-discovery-catalog.mjs";
const prior = "ae32949d7a76097a899e92d36654293e";
const prefix = "supabase/release/learn-test/075_voicemail_discovery";
const migration = "supabase/migrations/20261101440000_learn_voicemail_discovery.sql";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const mode = process.argv[2];
if (
  !["--prepare", "--rehearse", "--apply"].includes(mode) ||
  process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit fixed TEST discovery release required");
const token = savedCliToken(),
  query = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
const before = await readVoicemailQueueCatalog(token),
  discoveryBefore = await readVoicemailDiscoveryCatalog(token);
if (
  before.fingerprint !== prior ||
  discoveryBefore.catalog.voicemailDiscovery.tables?.length ||
  discoveryBefore.catalog.voicemailDiscovery.functions?.length
)
  throw Error("Exact TEST 074 without discovery schema required; inspect before retry");
const snapshot = voicemailQueueSnapshot(before.catalog.phone),
  preserved = await query(snapshot);
if (preserved.length !== 136 || new Set(preserved.map((r) => r.name)).size !== 136)
  throw Error("Complete preservation evidence required");
const source = readFileSync(migration, "utf8"),
  sourceHash = sha(source);
if (mode === "--prepare") {
  const names = VOICEMAIL_DISCOVERY_TABLES.map((n) => `'${n}'`).join(","),
    functions = VOICEMAIL_DISCOVERY_FUNCTIONS.map((n) => `'${n}'`).join(",");
  const body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
  const sql = `-- TEST 075: retained voicemail discovery. No identities, jobs, routes, provider traffic or capture activation.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 or md5((${VOICEMAIL_QUEUE_CATALOG})::text)<>'${prior}'
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${names}))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${functions}))
 then raise exception 'Exact TEST 074 discovery prerequisites required';end if;
end$$;
create temporary table voicemail_discovery_preserved on commit drop as ${snapshot};
${body}
set local role authenticated;
do $$begin
 begin perform public.voicemail_discover_page(null,null,null);raise exception 'Client discovery unexpectedly allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from public.receptionist_voicemail_candidates;raise exception 'Private candidates readable';exception when insufficient_privilege then null;end;
end$$;
reset role;set local role anon;
do $$begin
 begin perform public.voicemail_discovery_status(null,null);raise exception 'Anonymous discovery status allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;set local role service_role;
do $$begin
 begin perform public.voicemail_discover_page('ce750000-aaaa-4000-8000-000000000001','ce750000-aaaa-4000-8000-000000000002','ce750000-aaaa-4000-8000-000000000003');raise exception 'Missing route admitted';exception when sqlstate '22023' then null;end;
end$$;
reset role;
do $$begin
 if exists(select 1 from public.receptionist_voicemail_scans) or exists(select 1 from public.receptionist_voicemail_candidates) or exists(select 1 from public.receptionist_voicemail_scan_receipts)
 then raise exception 'Discovery release must remain empty';end if;
 if (select jsonb_agg(to_jsonb(x) order by name) from voicemail_discovery_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by name) from (${snapshot})x)
 then raise exception 'Discovery source preservation failed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_voicemail_discovery_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'voicemail-discovery-installed/1' as marker,md5((${VOICEMAIL_DISCOVERY_CATALOG})::text) as fingerprint,md5((${VOICEMAIL_DISCOVERY_METADATA})::text) as discovery_fingerprint;
commit;
`;
  const manifest = {
    projectRef: TEST_PROJECT,
    sha256: sha(sql),
    priorFingerprint: prior,
    priorDiscoveryFingerprint: discoveryBefore.fingerprint,
    sources: [{ path: migration, sha256: sourceHash }],
    preservedDatasets: 136,
  };
  writeFileSync(prefix + ".sql", sql, { flag: "wx" });
  writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(JSON.stringify({ state: "prepared", ...manifest }, null, 2));
} else {
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
  if (
    manifest.projectRef !== TEST_PROJECT ||
    manifest.sha256 !== sha(sql) ||
    manifest.priorFingerprint !== prior ||
    manifest.priorDiscoveryFingerprint !== discoveryBefore.fingerprint ||
    JSON.stringify(manifest.sources) !== JSON.stringify([{ path: migration, sha256: sourceHash }])
  )
    throw Error("Pinned discovery release differs");
  const rehearsal =
    mode === "--apply"
      ? JSON.parse(
          readFileSync(".verification-results/voicemail-discovery-release-rehearse-result.json"),
        )
      : null;
  if (
    rehearsal &&
    (rehearsal.state !== "rehearsed_rolled_back" ||
      rehearsal.packageSha256 !== manifest.sha256 ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000)
  )
    throw Error("Fresh exact rehearsal required");
  const stem = ".verification-results/voicemail-discovery-release-" + mode.slice(2),
    journal = {
      mode,
      projectRef: TEST_PROJECT,
      packageSha256: manifest.sha256,
      startedAt: new Date().toISOString(),
      beforeFingerprint: discoveryBefore.fingerprint,
      preserved,
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
  } catch (e) {
    writeFileSync(stem + "-error-private.txt", String(e.message), { flag: "wx", mode: 0o600 });
  }
  // Unknown acknowledgement: inspect this operation rather than resubmit it.
  const after = await readVoicemailDiscoveryCatalog(token),
    afterRows = await query(snapshot);
  const expected =
    mode === "--rehearse"
      ? response?.find((r) => r.marker === "voicemail-discovery-installed/1")
      : rehearsal.expected;
  const ledger = await query(
    "select source_sha256 from of_test_deploy.migrations where migration_name='learn_voicemail_discovery_v1'",
  );
  const preservedOk = stable(preserved) === stable(afterRows);
  const ok =
    preservedOk &&
    /^[a-f0-9]{32}$/.test(expected?.fingerprint ?? "") &&
    (mode === "--rehearse"
      ? after.fingerprint === discoveryBefore.fingerprint && ledger.length === 0
      : after.fingerprint === expected.fingerprint &&
        ledger.length === 1 &&
        ledger[0].source_sha256 === manifest.sha256);
  const result = {
    state: ok
      ? mode === "--rehearse"
        ? "rehearsed_rolled_back"
        : "installed_empty_discovery_schema_verified"
      : "requires_inspection",
    observedAt: new Date().toISOString(),
    projectRef: TEST_PROJECT,
    packageSha256: manifest.sha256,
    expected: expected ?? null,
    afterFingerprint: after.fingerprint,
    preservedDatasets: preservedOk ? 136 : null,
    usersCreated: 0,
    jobsCreated: 0,
    routesCreated: 0,
    providerRequests: 0,
    productionChanged: false,
    limitations: [
      "Discovery DDL and denied/missing-route checks against full TEST schema; no positive hosted discovery, worker deployment, schedule or signed-in acceptance.",
    ],
  };
  writeFileSync(stem + "-result.json", JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exitCode = 1;
}
