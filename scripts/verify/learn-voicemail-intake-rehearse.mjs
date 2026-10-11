/** Hosted TEST DDL rehearsal only. No users, routes, source records or grants persist. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readMailboxChangesCatalog,
  mailboxChangesSnapshot,
} from "./learn-email-mailbox-changes-catalog.mjs";
const retry = process.argv.includes("--diagnostic-retry");
const foundationRequired = process.argv.includes("--include-private-foundation");
if (retry && foundationRequired) throw Error("Separate prerequisite rehearsal required");
if (
  process.argv.slice(2).join(" ") !==
    "--rehearse --existing-cli-login" +
      (retry ? " --diagnostic-retry" : "") +
      (foundationRequired ? " --include-private-foundation" : "") ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST rehearsal required");
const attemptDigest = createHash("sha256")
  .update(readFileSync("supabase/migrations/20261101420000_learn_voicemail_private_intake.sql"))
  .digest("hex")
  .slice(0, 12);
const stem =
  ".verification-results/voicemail-intake-full-schema-" +
  (foundationRequired ? "foundation" : retry ? "diagnostic" : "candidate") +
  "-" +
  attemptDigest;
const token = savedCliToken(),
  query = (sql, readOnly = true) =>
    communicationQuery(token, sql, {
      readOnly,
      fetcher: async (url, options) => {
        const response = await fetch(url, options);
        if (!response.ok)
          writeFileSync(
            stem + "-response-private.txt",
            (await response.clone().text()).slice(0, 20000),
            { mode: 0o600 },
          );
        return response;
      },
    });
const before = await readMailboxChangesCatalog(token);
if (before.fingerprint !== "deb440d53e7a0a47cc4273214b2ce777")
  throw Error("Exact TEST 072 prerequisite differs");
const snapshot = mailboxChangesSnapshot(before.catalog.phone, { archive: true });
const preserved = await query(snapshot);
if (preserved.length !== 124) throw Error("Full preservation inventory required");
const absent = `select to_regclass('public.receptionist_voicemail_email_routes') is null as routes_absent,
to_regclass('public.receptionist_voicemail_intakes') is null as intakes_absent,
to_regclass('public.receptionist_voicemail_sources') is null as sources_absent,
not exists(select 1 from storage.buckets where id='learn-voicemail-sources') as bucket_absent,
not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('voicemail_intake_immutable','voicemail_intake_route','voicemail_intake_prepare','voicemail_intake_publish')) as functions_absent`;
const assertAbsent = async () => {
  const r = await query(absent);
  if (r.length !== 1 || !Object.values(r[0]).every((v) => v === true))
    throw Error("Candidate objects already present");
};
await assertAbsent();
const foundationSnapshot = `select jsonb_build_object('tables',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('receptionist_mailboxes','receptionist_mailbox_managers','receptionist_voicemails','receptionist_voicemail_access_log')),'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'owner',p.proowner,'acl',p.proacl) order by p.proname),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('can_manage_voicemail','voicemail_mailbox_summary')),'bucket',(select to_jsonb(b) from storage.buckets b where id='receptionist-voicemails'),'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by policyname),'[]') from pg_policies p where policyname in ('voicemail_no_direct_storage_access','voicemail_source_no_direct_storage_access'))) as metadata`;
const foundationBefore = await query(foundationSnapshot);
if (
  foundationRequired &&
  (foundationBefore[0]?.metadata?.tables?.length !== 0 ||
    foundationBefore[0]?.metadata?.functions?.length !== 0 ||
    foundationBefore[0]?.metadata?.policies?.length !== 0)
)
  throw Error("Unexpected partial foundation; inspect before retry");
const migration = readFileSync(
  "supabase/migrations/20261101420000_learn_voicemail_private_intake.sql",
  "utf8",
);
const foundation = foundationRequired
  ? readFileSync("supabase/migrations/20261023210000_receptionist_voicemails.sql", "utf8")
  : "";
const digest = createHash("sha256").update(migration).digest("hex");
const foundationDigest = foundationRequired
  ? createHash("sha256").update(foundation).digest("hex")
  : null;
writeFileSync(
  stem + "-journal.json",
  JSON.stringify(
    {
      state: "prepared",
      projectRef: TEST_PROJECT,
      startedAt: new Date().toISOString(),
      migrationSha256: digest,
      foundationSha256: foundationDigest,
      foundationBefore,
      beforeFingerprint: before.fingerprint,
      preserved,
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
);
const body = (foundation + "\n" + migration)
  .replace(/^begin;\s*$/gm, "")
  .replace(/^commit;\s*$/gm, "");
const sql = `begin;set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
${body}
set local role authenticated;
do $$begin
 begin perform public.voicemail_intake_prepare(null,null,'{}','{}');raise exception 'Client intake unexpectedly allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from public.receptionist_voicemail_sources;raise exception 'Private evidence unexpectedly readable';exception when insufficient_privilege then null;end;
end$$;
reset role;
set local role service_role;
do $$begin
 begin perform public.voicemail_intake_route('ce420000-aaaa-4000-8000-000000000099','ce420000-aaaa-4000-8000-000000000098',now());raise exception 'Missing route admitted';exception when sqlstate '22023' then null;end;
end$$;
reset role;
select 'voicemail-intake-full-schema/1' as marker;rollback;`;
let result;
try {
  result = await query(sql, false);
} catch (e) {
  writeFileSync(stem + "-failure-private.txt", String(e.message), { flag: "wx", mode: 0o600 });
  throw Error("TEST rehearsal unconfirmed; private diagnostic saved");
}
if (!result.some((r) => r.marker === "voicemail-intake-full-schema/1"))
  throw Error("Rehearsal marker absent");
await assertAbsent();
const after = await query(snapshot),
  afterCatalog = await readMailboxChangesCatalog(token);
if (JSON.stringify(foundationBefore) !== JSON.stringify(await query(foundationSnapshot)))
  throw Error("Private foundation metadata not restored");
const stable = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
if (stable(after) !== stable(preserved) || afterCatalog.fingerprint !== before.fingerprint)
  throw Error("Preservation changed");
const report = {
  version: "learn-voicemail-intake-rehearsal/1",
  state: "ddl_and_permission_checks_rehearsed_and_rolled_back",
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  migrationSha256: digest,
  foundationSha256: foundationDigest,
  preservedDatasets: 124,
  schemaRestored: true,
  foundationMetadataRestored: true,
  candidateObjectsAbsent: true,
  usersCreated: 0,
  routesCreated: 0,
  providerRequests: 0,
  productionChanged: false,
  limitations: [
    "No hosted source/audio ingestion or signed-in journey; synthetic publication and concurrency verified separately in offline PostgreSQL.",
    "No migration installed, no credentials or source content uploaded.",
  ],
};
writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
