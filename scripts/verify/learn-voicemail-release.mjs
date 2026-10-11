/** Install empty private voicemail schema in pinned TEST; no users/routes/capture. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readMailboxChangesCatalog,
  MAILBOX_CHANGES_CATALOG,
} from "./learn-email-mailbox-changes-catalog.mjs";
import {
  readVoicemailCatalog,
  VOICEMAIL_CATALOG,
  VOICEMAIL_METADATA,
  VOICEMAIL_TABLES,
  VOICEMAIL_FUNCTIONS,
  voicemailPreservedSnapshot,
} from "./learn-voicemail-catalog.mjs";
const prefix = "supabase/release/learn-test/073_voicemail_private_intake";
const prior = "deb440d53e7a0a47cc4273214b2ce777";
const paths = [
  "supabase/migrations/20261023210000_receptionist_voicemails.sql",
  "supabase/migrations/20261101420000_learn_voicemail_private_intake.sql",
];
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
const mode = process.argv[2];
if (
  !["--prepare", "--rehearse", "--apply"].includes(mode) ||
  process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit fixed TEST release scope required");
const token = savedCliToken(),
  query = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
const before = await readMailboxChangesCatalog(token),
  beforePrivate = await readVoicemailCatalog(token);
if (before.fingerprint !== prior) throw Error("Exact TEST 072 required; inspect before retry");
const privateCatalog = beforePrivate.catalog.voicemail;
if (
  privateCatalog.tables?.length ||
  privateCatalog.functions?.length ||
  privateCatalog.storagePolicies.length ||
  privateCatalog.buckets.some((b) => b.id === "learn-voicemail-sources")
)
  throw Error("Unexpected existing/partial voicemail schema");
const snapshot = voicemailPreservedSnapshot(before.catalog.phone),
  preserved = await query(snapshot);
if (preserved.length !== 127) throw Error("Complete 127-dataset inventory required");
const audioSnapshot =
  "select to_jsonb(b) as bucket from storage.buckets b where id='receptionist-voicemails'";
const audioBefore = await query(audioSnapshot);
const sources = paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
if (mode === "--prepare") {
  const body = sources
    .map((s) => s.source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, ""))
    .join("\n");
  const tableNames = VOICEMAIL_TABLES.map((n) => `'${n}'`).join(","),
    functionNames = VOICEMAIL_FUNCTIONS.map((n) => `'${n}'`).join(",");
  const sql = `-- TEST 073: empty private voicemail foundation/intake. No routes, users, grants to people or capture activation.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$'
 or md5((${MAILBOX_CHANGES_CATALOG})::text)<>'${prior}'
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${tableNames}))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${functionNames}))
 or exists(select 1 from storage.buckets where id='learn-voicemail-sources')
 or exists(select 1 from pg_policies where schemaname='storage' and policyname in ('voicemail_no_direct_storage_access','voicemail_source_no_direct_storage_access'))
 then raise exception 'Exact TEST voicemail prerequisites required';end if;
end$$;
create temporary table voicemail_preserved on commit drop as ${snapshot};
create temporary table voicemail_audio_before on commit drop as ${audioSnapshot};
${body}
-- Exercise existing roles only. No auth identity, mailbox, source or access row is seeded.
set local request.jwt.claim.sub='';set local request.jwt.claim.role='authenticated';set local role authenticated;
do $$begin
 begin perform public.voicemail_intake_prepare(null,null,'{}','{}');raise exception 'Client intake unexpectedly allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from public.receptionist_voicemail_sources;raise exception 'Private source unexpectedly readable';exception when insufficient_privilege then null;end;
 assert (select count(*) from public.receptionist_voicemails)=0,'Unsigned client saw voicemail';
 assert not public.can_manage_voicemail('ce420000-aaaa-4000-8000-000000000099','ce420000-aaaa-4000-8000-000000000098'),'Unsigned manager accepted';
end$$;
reset role;
set local role anon;
do $$begin
 begin perform 1 from public.receptionist_voicemails;raise exception 'Anonymous voicemail unexpectedly readable';exception when insufficient_privilege then null;end;
 begin perform public.voicemail_intake_route(null,null,null);raise exception 'Anonymous intake unexpectedly allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;
set local role service_role;
do $$begin
 begin perform public.voicemail_intake_route('ce420000-aaaa-4000-8000-000000000099','ce420000-aaaa-4000-8000-000000000098',now());raise exception 'Missing route admitted';exception when sqlstate '22023' then null;end;
end$$;
reset role;
do $$declare checked_table text;num bigint;begin
 foreach checked_table in array array[${tableNames}] loop
  execute format('select count(*) from public.%I',checked_table) into num;
  if num<>0 then raise exception 'New voicemail tables must remain empty';end if;
 end loop;
 if exists(select 1 from storage.buckets where id in ('receptionist-voicemails','learn-voicemail-sources') and public)
 or (select count(*) from storage.buckets where id in ('receptionist-voicemails','learn-voicemail-sources'))<>2 then raise exception 'Private buckets required';end if;
 if (select count(*) from voicemail_audio_before)>0 and (select bucket from voicemail_audio_before) is distinct from (select bucket from (${audioSnapshot})b) then raise exception 'Existing audio bucket changed';end if;
 if (select jsonb_agg(to_jsonb(x) order by name) from voicemail_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by name) from (${snapshot})x) then raise exception 'Voicemail source preservation failed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_voicemail_private_intake_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'voicemail-installed/1' as marker,md5((${VOICEMAIL_CATALOG})::text) as fingerprint,md5((${VOICEMAIL_METADATA})::text) as private_fingerprint;
commit;
`;
  const manifest = {
    projectRef: TEST_PROJECT,
    sha256: hash(sql),
    priorFingerprint: prior,
    priorPrivateFingerprint: beforePrivate.fingerprint,
    sources: sources.map((s) => ({ path: s.path, sha256: hash(s.source) })),
    preservedDatasets: 127,
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
    manifest.projectRef !== TEST_PROJECT ||
    manifest.priorPrivateFingerprint !== beforePrivate.fingerprint ||
    JSON.stringify(manifest.sources) !==
      JSON.stringify(sources.map((s) => ({ path: s.path, sha256: hash(s.source) })))
  )
    throw Error("Pinned release differs");
  const rehearsal =
    mode === "--apply"
      ? JSON.parse(readFileSync(".verification-results/voicemail-release-rehearse-result.json"))
      : null;
  if (
    rehearsal &&
    (rehearsal.state !== "rehearsed_rolled_back" ||
      rehearsal.packageSha256 !== manifest.sha256 ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000)
  )
    throw Error("Fresh exact rehearsal required");
  const stem = ".verification-results/voicemail-release-" + mode.slice(2);
  const journal = {
    mode,
    projectRef: TEST_PROJECT,
    packageSha256: manifest.sha256,
    startedAt: new Date().toISOString(),
    beforeFingerprint: beforePrivate.fingerprint,
    preserved,
    audioBefore,
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
  // An unknown response is inspected, never blindly repeated.
  const after = await readVoicemailCatalog(token),
    afterData = await query(snapshot),
    audioAfter = await query(audioSnapshot);
  const receipt = response?.find((r) => r.marker === "voicemail-installed/1");
  const expected = mode === "--rehearse" ? receipt : rehearsal.expected;
  const preservedOk = stable(preserved) === stable(afterData);
  const audioOk =
    audioBefore.length === 0 || JSON.stringify(audioBefore) === JSON.stringify(audioAfter);
  const ledger = await query(
    `select source_sha256 from of_test_deploy.migrations where migration_name='learn_voicemail_private_intake_v1'`,
  );
  const ok =
    preservedOk &&
    audioOk &&
    expected &&
    /^[a-f0-9]{32}$/.test(expected.fingerprint ?? "") &&
    (mode === "--rehearse"
      ? after.fingerprint === beforePrivate.fingerprint && ledger.length === 0
      : after.fingerprint === expected.fingerprint &&
        ledger.length === 1 &&
        ledger[0].source_sha256 === manifest.sha256);
  const result = {
    state: ok
      ? mode === "--rehearse"
        ? "rehearsed_rolled_back"
        : "installed_empty_private_schema_verified"
      : "requires_inspection",
    observedAt: new Date().toISOString(),
    projectRef: TEST_PROJECT,
    packageSha256: manifest.sha256,
    expected: expected ?? null,
    afterFingerprint: after.fingerprint,
    preservedDatasets: preservedOk ? 127 : null,
    existingAudioBucketPreserved: audioOk,
    usersCreated: 0,
    mailboxesCreated: 0,
    routesCreated: 0,
    providerRequests: 0,
    productionChanged: false,
    limitations: [
      "No hosted voicemail import, Storage byte verification, queue scheduling or signed-in acceptance. No credentials uploaded.",
    ],
  };
  writeFileSync(stem + "-result.json", JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exitCode = 1;
}
