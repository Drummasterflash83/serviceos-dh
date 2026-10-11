/** TEST 077 only. Add a caller-RLS reader; all synthetic access fixtures roll back. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readVoicemailDispatchCatalog,
  VOICEMAIL_DISPATCH_CATALOG,
  voicemailDispatchSnapshot,
} from "./learn-voicemail-dispatch-catalog.mjs";
import {
  readVoicemailInboxCatalog,
  VOICEMAIL_INBOX_CATALOG,
} from "./learn-voicemail-inbox-catalog.mjs";
const prior = "e98a51ad59594757305433a7257c5e6f",
  prefix = "supabase/release/learn-test/077_voicemail_inbox_history";
const migration = "supabase/migrations/20261101460000_learn_voicemail_inbox_history.sql",
  probe = "scripts/verify/learn-voicemail-inbox-hosted.assert.sql";
const sha = (s) => createHash("sha256").update(s).digest("hex"),
  stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const mode = process.argv[2];
if (
  !["--prepare", "--rehearse", "--apply"].includes(mode) ||
  process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit fixed TEST inbox release required");
const token = savedCliToken(),
  query = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
const before = await readVoicemailDispatchCatalog(token),
  inboxBefore = await readVoicemailInboxCatalog(token);
if (before.fingerprint !== prior || inboxBefore.catalog.voicemailInbox.functions?.length)
  throw Error("Exact TEST 076 without inbox reader required; inspect before retry");
const snapshot = voicemailDispatchSnapshot(before.catalog.phone),
  preserved = await query(snapshot);
if (preserved.length !== 140 || new Set(preserved.map((r) => r.name)).size !== 140)
  throw Error("Complete preservation evidence required");
const sources = [migration, probe].map((path) => ({
  path,
  sha256: sha(readFileSync(path, "utf8")),
}));
if (mode === "--prepare") {
  const body = readFileSync(migration, "utf8")
    .replace(/^begin;\s*$/gm, "")
    .replace(/^commit;\s*$/gm, "");
  const sql = `-- TEST 077: discover already-visible private messages. All probes rolled back; no new human access.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 or md5((${VOICEMAIL_DISPATCH_CATALOG})::text)<>'${prior}' or to_regprocedure('public.learn_voicemail_mailboxes(uuid,uuid)') is not null then raise exception 'Exact TEST 076 required';end if;
end$$;
create temporary table voicemail_inbox_preserved on commit drop as ${snapshot};
${body}
savepoint inbox_probe;
${readFileSync(probe, "utf8")}
rollback to savepoint inbox_probe;
set local request.jwt.claim.sub='';set local role authenticated;
do $$begin begin perform public.learn_voicemail_mailboxes(null);raise exception 'Unsigned read allowed';exception when insufficient_privilege then null;end;end$$;
reset role;set local role anon;
do $$begin begin perform public.learn_voicemail_mailboxes(null);raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;end$$;
reset role;set local role service_role;
do $$begin begin perform public.learn_voicemail_mailboxes(null);raise exception 'Service impersonation allowed';exception when insufficient_privilege then null;end;end$$;
reset role;
do $$begin
 if (select jsonb_agg(to_jsonb(x) order by name) from voicemail_inbox_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by name) from (${snapshot})x) then raise exception 'Inbox source preservation failed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_voicemail_inbox_history_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'voicemail-inbox-installed/1' as marker,md5((${VOICEMAIL_INBOX_CATALOG})::text) as fingerprint;
commit;
`;
  const manifest = {
    projectRef: TEST_PROJECT,
    sha256: sha(sql),
    priorFingerprint: prior,
    priorInboxFingerprint: inboxBefore.fingerprint,
    sources,
    preservedDatasets: 140,
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
    manifest.priorInboxFingerprint !== inboxBefore.fingerprint ||
    JSON.stringify(manifest.sources) !== JSON.stringify(sources)
  )
    throw Error("Pinned inbox package differs");
  const rehearsal =
    mode === "--apply"
      ? JSON.parse(
          readFileSync(".verification-results/voicemail-inbox-release-rehearse-result.json"),
        )
      : null;
  if (
    rehearsal &&
    (rehearsal.state !== "rehearsed_rolled_back" ||
      rehearsal.packageSha256 !== manifest.sha256 ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000)
  )
    throw Error("Fresh exact rehearsal required");
  const stem = ".verification-results/voicemail-inbox-release-" + mode.slice(2),
    journal = {
      mode,
      projectRef: TEST_PROJECT,
      packageSha256: manifest.sha256,
      startedAt: new Date().toISOString(),
      beforeFingerprint: inboxBefore.fingerprint,
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
  const after = await readVoicemailInboxCatalog(token),
    afterRows = await query(snapshot),
    expected =
      mode === "--rehearse"
        ? response?.find((r) => r.marker === "voicemail-inbox-installed/1")
        : rehearsal.expected;
  const ledger = await query(
    "select source_sha256 from of_test_deploy.migrations where migration_name='learn_voicemail_inbox_history_v1'",
  );
  const preservedOk = stable(preserved) === stable(afterRows),
    ok =
      preservedOk &&
      /^[a-f0-9]{32}$/.test(expected?.fingerprint ?? "") &&
      (mode === "--rehearse"
        ? after.fingerprint === inboxBefore.fingerprint && ledger.length === 0
        : after.fingerprint === expected.fingerprint &&
          ledger.length === 1 &&
          ledger[0].source_sha256 === manifest.sha256);
  const result = {
    state: ok
      ? mode === "--rehearse"
        ? "rehearsed_rolled_back"
        : "installed_private_inbox_verified"
      : "requires_inspection",
    observedAt: new Date().toISOString(),
    projectRef: TEST_PROJECT,
    packageSha256: manifest.sha256,
    expected: expected ?? null,
    afterFingerprint: after.fingerprint,
    preservedDatasets: preservedOk ? 140 : null,
    usersRetained: 0,
    grantsRetained: 0,
    providerRequests: 0,
    productionChanged: false,
    limitations: [
      "Real SQL roles and complete TEST schema; no actual signed-in browser session or successful playback. Transaction-local banned/passwordless fixtures rolled back.",
    ],
  };
  writeFileSync(stem + "-result.json", JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exitCode = 1;
}
