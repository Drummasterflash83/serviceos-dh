/** Reviewed contact runtime: existing TEST v3 endpoints to v4; no data/config writes. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { SETTLEMENT_PRESERVED } from "./learn-phone-settlement-catalog.mjs";
import { readTraversalCatalog } from "./learn-commusoft-contact-traversal-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const CONTACT_RUNTIME_ENDPOINTS = [
  { name: "learn-commusoft-worker", verifyJwt: true },
  { name: "learn-commusoft-verify", verifyJwt: true },
];
export const CONTACT_RUNTIME_SHA =
  "471041b23928aa5cce77d4288f3378c3d945e851bb601bbf9edb3f995fc1e77e";
export const CONTACT_RUNTIME_DATABASE = "cb78a673db41abaf508b76b91309c044";
export const contactRuntimeBundle = () => edgeRuntimeBundle(CONTACT_RUNTIME_ENDPOINTS);
export const CONTACT_RUNTIME_PRESERVED = [
  ...SETTLEMENT_PRESERVED,
  "public.learn_phone_import_completions",
  "public.learn_phone_schedule_settlements",
  "public.learn_commusoft_contact_targets",
];
export const CONTACT_RUNTIME_SNAPSHOT = CONTACT_RUNTIME_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export const CONTACT_RUNTIME_IDLE = `select
 (select count(*)::int from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')) as active_jobs,
 (select count(*)::int from public.provider_connections where provider='commusoft' and status<>'revoked') as unrevoked_connections,
 (select count(*)::int from public.learn_commusoft_verification_requests r where r.expires_at>now() and not exists(select 1 from public.learn_commusoft_verification_results s where s.request_id=r.id)) as unfinished_checks`;
export function contactRuntimeSnapshot(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== CONTACT_RUNTIME_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !CONTACT_RUNTIME_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete preservation evidence required");
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}
export async function deployContactRuntime(args) {
  if (args.allowProjectRef !== TEST_PROJECT || Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Exact TEST replacement scope required");
  if (contactRuntimeBundle().sha256 !== CONTACT_RUNTIME_SHA)
    throw Error("Reviewed contact runtime bundle changed");
  if (
    (await readTraversalCatalog(args.token, { fetcher: args.fetcher })).fingerprint !==
    "195ca207f0d8a7a95b0fb30580e093fd"
  )
    throw Error("Exact contact traversal schema required");
  const idle = await communicationQuery(args.token, CONTACT_RUNTIME_IDLE, {
    fetcher: args.fetcher,
  });
  if (
    idle.length !== 1 ||
    idle[0].active_jobs !== 0 ||
    idle[0].unrevoked_connections !== 0 ||
    idle[0].unfinished_checks !== 0
  )
    throw Error("Idle unconfigured TEST Commusoft required");
  const before = contactRuntimeSnapshot(
    await communicationQuery(args.token, CONTACT_RUNTIME_SNAPSHOT, { fetcher: args.fetcher }),
  );
  const result = await deployPinnedTestRuntime(
    {
      ...args,
      replaceVersions: { "learn-commusoft-worker": 3, "learn-commusoft-verify": 3 },
      persistJournal: (journal) => args.persistJournal({ ...journal, extendedPreserved: before }),
    },
    {
      bundle: contactRuntimeBundle,
      endpoints: CONTACT_RUNTIME_ENDPOINTS,
      bundleSha: CONTACT_RUNTIME_SHA,
      databaseFingerprint: CONTACT_RUNTIME_DATABASE,
      version: "learn-test-commusoft-contact-runtime-deploy/1",
      stagePrefix: "learn-commusoft-contact-runtime-",
    },
  );
  const after = contactRuntimeSnapshot(
    await communicationQuery(args.token, CONTACT_RUNTIME_SNAPSHOT, { fetcher: args.fetcher }),
  );
  const fullSchemaPreserved =
    (await readTraversalCatalog(args.token, { fetcher: args.fetcher })).fingerprint ===
    "195ca207f0d8a7a95b0fb30580e093fd";
  return {
    ...result,
    state:
      fullSchemaPreserved && JSON.stringify(before) === JSON.stringify(after)
        ? result.state
        : "requires_inspection",
    fullSchemaPreserved,
    extendedPreservedDataSets: before.length,
    extendedPreservationVerified: JSON.stringify(before) === JSON.stringify(after),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST deployment required");
    const prefix = ".verification-results/commusoft-contact-runtime";
    const result = await deployContactRuntime({
      allowProjectRef: TEST_PROJECT,
      token: savedCliToken(),
      persistJournal: async (journal) => {
        const fd = openSync(prefix + "-journal.json", "wx", 0o600);
        try {
          writeSync(fd, JSON.stringify(journal, null, 2));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      onProgress: (p) => console.log(JSON.stringify(p)),
    });
    writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
  } catch {
    console.error(
      "TEST Commusoft patch unconfirmed; inspect retained journal and inventory before any further submission.",
    );
    process.exitCode = 1;
  }
}
