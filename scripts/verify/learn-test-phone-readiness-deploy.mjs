/** Replace only the existing TEST operator endpoint v5 with checked Phone readiness. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { controlPlaneBundle, CONTROLPLANE_ENDPOINTS } from "./learn-test-controlplane-deploy.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import {
  readCardSearchCatalog,
  CARD_SEARCH_SNAPSHOT,
  CARD_SEARCH_PRESERVED,
} from "./learn-card-search-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const PHONE_READINESS_RUNTIME_SHA =
  "0b8ff421a99248d8954b135f6e0f5f55ba878408010cef789c5a724df1d1e285";
export const PHONE_READINESS_RUNTIME_DATABASE = "b17378ba1c6cc511f6a35b63bb22e9be";
export const PHONE_READINESS_SCHEMA = "3edc2be235c00489aa86aa396fd88878";
function sources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== CARD_SEARCH_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !CARD_SEARCH_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete retained source fingerprints required");
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}
export async function deployPhoneReadiness(args) {
  if (
    args.allowProjectRef !== TEST_PROJECT ||
    typeof args.persistJournal !== "function" ||
    Object.keys(args.replaceVersions ?? {}).length
  )
    throw Error("Explicit TEST replacement of operator v5 required");
  if (controlPlaneBundle().sha256 !== PHONE_READINESS_RUNTIME_SHA)
    throw Error("Reviewed Phone readiness runtime changed");
  const [schema, rows] = await Promise.all([
    readCardSearchCatalog(args.token, { fetcher: args.fetcher }),
    communicationQuery(args.token, CARD_SEARCH_SNAPSHOT, { fetcher: args.fetcher }),
  ]);
  if (schema.fingerprint !== PHONE_READINESS_SCHEMA)
    throw Error("Exact installed TEST schema required");
  const before = sources(rows);
  const result = await deployPinnedTestRuntime(
    {
      ...args,
      replaceVersions: { "openfolk-control-plane": 5 },
      persistJournal: (journal) =>
        args.persistJournal({
          ...journal,
          phoneReadinessCatalogFingerprint: schema.fingerprint,
          phoneReadinessPreserved: before,
        }),
    },
    {
      bundle: controlPlaneBundle,
      endpoints: CONTROLPLANE_ENDPOINTS,
      bundleSha: PHONE_READINESS_RUNTIME_SHA,
      databaseFingerprint: PHONE_READINESS_RUNTIME_DATABASE,
      version: "learn-phone-readiness-runtime/1",
      stagePrefix: "learn-phone-readiness-",
    },
  );
  try {
    const [after, retained] = await Promise.all([
      readCardSearchCatalog(args.token, { fetcher: args.fetcher }),
      communicationQuery(args.token, CARD_SEARCH_SNAPSHOT, { fetcher: args.fetcher }),
    ]);
    const unchanged =
      after.fingerprint === schema.fingerprint &&
      JSON.stringify(sources(retained)) === JSON.stringify(before);
    return {
      ...result,
      phoneReadinessInventoryPreserved: unchanged,
      preservedDataSets: before.length,
      state: unchanged ? result.state : "requires_inspection",
    };
  } catch {
    return { ...result, state: "requires_inspection", phoneReadinessInventoryPreserved: null };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST replacement required");
    const prefix = ".verification-results/phone-readiness-edge-deploy";
    const result = await deployPhoneReadiness({
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
    writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
  } catch {
    console.error(
      "Phone readiness replacement unconfirmed; inspect the durable journal and TEST endpoint before retrying.",
    );
    process.exitCode = 1;
  }
}
