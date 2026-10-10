/** Reviewed runtime-only fix: existing TEST v2 endpoints to v3; no data/config writes. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { SETTLEMENT_PRESERVED } from "./learn-phone-settlement-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const COMMUSOFT_AUTH_ENDPOINTS = [
  { name: "learn-commusoft-worker", verifyJwt: true },
  { name: "learn-commusoft-verify", verifyJwt: true },
];
export const COMMUSOFT_AUTH_SHA =
  "2115886e435c39b42e179a29ce42fce5f721ca5406fa922f5917edb7efb0c190";
export const COMMUSOFT_AUTH_DATABASE = "f27bc878a6d07993fb40647b44d5a72d";
export const commusoftAuthBundle = () => edgeRuntimeBundle(COMMUSOFT_AUTH_ENDPOINTS);
export const COMMUSOFT_AUTH_PRESERVED = [
  ...SETTLEMENT_PRESERVED,
  "public.learn_phone_import_completions",
  "public.learn_phone_schedule_settlements",
];
export const COMMUSOFT_AUTH_SNAPSHOT = COMMUSOFT_AUTH_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export const COMMUSOFT_AUTH_IDLE = `select
 (select count(*)::int from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')) as active_jobs,
 (select count(*)::int from public.provider_connections where provider='commusoft' and status<>'revoked') as unrevoked_connections,
 (select count(*)::int from public.learn_commusoft_verification_requests r where r.expires_at>now() and not exists(select 1 from public.learn_commusoft_verification_results s where s.request_id=r.id)) as unfinished_checks`;
export function commusoftAuthSnapshot(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== COMMUSOFT_AUTH_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !COMMUSOFT_AUTH_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete preservation evidence required");
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}
export async function deployCommusoftAuth(args) {
  if (args.allowProjectRef !== TEST_PROJECT || Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Exact TEST replacement scope required");
  if (commusoftAuthBundle().sha256 !== COMMUSOFT_AUTH_SHA)
    throw Error("Reviewed Commusoft authentication bundle changed");
  const idle = await communicationQuery(args.token, COMMUSOFT_AUTH_IDLE, { fetcher: args.fetcher });
  if (
    idle.length !== 1 ||
    idle[0].active_jobs !== 0 ||
    idle[0].unrevoked_connections !== 0 ||
    idle[0].unfinished_checks !== 0
  )
    throw Error("Idle unconfigured TEST Commusoft required");
  const before = commusoftAuthSnapshot(
    await communicationQuery(args.token, COMMUSOFT_AUTH_SNAPSHOT, { fetcher: args.fetcher }),
  );
  const result = await deployPinnedTestRuntime(
    {
      ...args,
      replaceVersions: { "learn-commusoft-worker": 2, "learn-commusoft-verify": 2 },
      persistJournal: (journal) => args.persistJournal({ ...journal, extendedPreserved: before }),
    },
    {
      bundle: commusoftAuthBundle,
      endpoints: COMMUSOFT_AUTH_ENDPOINTS,
      bundleSha: COMMUSOFT_AUTH_SHA,
      databaseFingerprint: COMMUSOFT_AUTH_DATABASE,
      version: "learn-test-commusoft-auth-deploy/1",
      stagePrefix: "learn-commusoft-auth-",
    },
  );
  const after = commusoftAuthSnapshot(
    await communicationQuery(args.token, COMMUSOFT_AUTH_SNAPSHOT, { fetcher: args.fetcher }),
  );
  return {
    ...result,
    state: JSON.stringify(before) === JSON.stringify(after) ? result.state : "requires_inspection",
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
    const prefix = ".verification-results/commusoft-auth-runtime";
    const result = await deployCommusoftAuth({
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
