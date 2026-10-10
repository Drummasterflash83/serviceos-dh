/** Replace TEST phone sync v5 and install the disabled scheduler; no credentials or schedules. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import {
  SETTLEMENT_SNAPSHOT,
  SETTLEMENT_PRESERVED,
  readPhoneSettlementCatalog,
} from "./learn-phone-settlement-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { assertNoPhoneCredentials } from "./learn-test-phone-deploy.mjs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

export const PHONE_SETTLEMENT_RUNTIME_DATABASE = "f27bc878a6d07993fb40647b44d5a72d";
export const PHONE_SETTLEMENT_RUNTIME_ENDPOINTS = [
  { name: "simwood-sync-calls", verifyJwt: true },
  { name: "simwood-sync-recordings", verifyJwt: true },
  { name: "phone-scheduled-sync", verifyJwt: false },
];
export const PHONE_SETTLEMENT_RUNTIME_SHA =
  "2f1240af960444e7266ffc54ed880c32f6252b7c9ed658356e2786a402f7869e";
export const phoneSettlementRuntimeBundle = () =>
  edgeRuntimeBundle(PHONE_SETTLEMENT_RUNTIME_ENDPOINTS);
export const PHONE_SETTLEMENT_RUNTIME_SCHEMA = "dff384a353e7dfa581173586a0d7cbe5";
export async function deployPhoneSettlementRuntime(args) {
  if (Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Replacement versions are pinned to TEST phone sync v5");
  if (args.allowProjectRef !== TEST_PROJECT) throw Error("Explicit TEST project required");
  await assertNoPhoneCredentials(args.token, args.fetcher);
  const presence = await communicationQuery(
    args.token,
    "select to_regclass('cron.job') is not null as present",
    { fetcher: args.fetcher },
  );
  if (presence.length !== 1 || typeof presence[0].present !== "boolean")
    throw Error("Phone schedule inventory unavailable");
  if (presence[0].present) {
    const schedules = await communicationQuery(
      args.token,
      "select count(*)::int as count from cron.job where active and command ilike '%phone-scheduled-sync%'",
      { fetcher: args.fetcher },
    );
    if (schedules.length !== 1 || schedules[0].count !== 0)
      throw Error("Existing active phone schedule requires inspection");
  }
  const schema = await readPhoneSettlementCatalog(args.token, { fetcher: args.fetcher });
  const preserved = await communicationQuery(args.token, SETTLEMENT_SNAPSHOT, {
    fetcher: args.fetcher,
  });
  const snapshot = (rows) => {
    if (
      !Array.isArray(rows) ||
      rows.length !== SETTLEMENT_PRESERVED.length ||
      new Set(rows.map((r) => r.name)).size !== rows.length ||
      rows.some(
        (r) =>
          !SETTLEMENT_PRESERVED.includes(r.name) ||
          !Number.isSafeInteger(r.count) ||
          r.count < 0 ||
          !/^[a-f0-9]{32}$/.test(r.fingerprint),
      )
    )
      throw Error("Phone preservation evidence incomplete");
    return JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
  };
  const priorSnapshot = snapshot(preserved);
  if (schema.fingerprint !== PHONE_SETTLEMENT_RUNTIME_SCHEMA)
    throw Error("Exact phone settlement schema required");
  const result = await deployPinnedTestRuntime(
    { ...args, replaceVersions: { "simwood-sync-calls": 5, "simwood-sync-recordings": 5 } },
    {
      bundle: phoneSettlementRuntimeBundle,
      endpoints: PHONE_SETTLEMENT_RUNTIME_ENDPOINTS,
      bundleSha: PHONE_SETTLEMENT_RUNTIME_SHA,
      databaseFingerprint: PHONE_SETTLEMENT_RUNTIME_DATABASE,
      version: "learn-phone-settlement-runtime-deploy/1",
      stagePrefix: "learn-phone-settlement-runtime-",
    },
  );
  const after = await readPhoneSettlementCatalog(args.token, { fetcher: args.fetcher });
  const retained = await communicationQuery(args.token, SETTLEMENT_SNAPSHOT, {
    fetcher: args.fetcher,
  });
  return after.fingerprint === schema.fingerprint && snapshot(retained) === priorSnapshot
    ? { ...result, phonePreservedDataSets: preserved.length }
    : { ...result, state: "requires_inspection" };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST replacement required");
    const prefix = ".verification-results/phone-settlement-runtime-edge-deploy";
    const result = await deployPhoneSettlementRuntime({
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
      "Phone sync replacement unconfirmed; inspect retained journal and TEST inventory before any further attempt.",
    );
    process.exitCode = 1;
  }
}
