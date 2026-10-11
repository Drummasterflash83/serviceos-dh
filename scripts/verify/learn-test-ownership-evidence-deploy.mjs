/** Replace only the existing TEST operator endpoint v4 with checked historical ownership. */
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
export const OWNERSHIP_RUNTIME_SHA =
  "55530404e70a3eaf74a12587155d02ebf93f7fce05b3c3ee31283b38db8b3304";
export const OWNERSHIP_RUNTIME_DATABASE = "b17378ba1c6cc511f6a35b63bb22e9be";
export const OWNERSHIP_SCHEMA = "3edc2be235c00489aa86aa396fd88878";
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
export async function deployOwnershipEvidence(args) {
  if (
    args.allowProjectRef !== TEST_PROJECT ||
    typeof args.persistJournal !== "function" ||
    Object.keys(args.replaceVersions ?? {}).length
  )
    throw Error("Explicit TEST replacement of operator v4 required");
  if (controlPlaneBundle().sha256 !== OWNERSHIP_RUNTIME_SHA)
    throw Error("Reviewed ownership evidence runtime changed");
  const [schema, rows] = await Promise.all([
    readCardSearchCatalog(args.token, { fetcher: args.fetcher }),
    communicationQuery(args.token, CARD_SEARCH_SNAPSHOT, { fetcher: args.fetcher }),
  ]);
  if (schema.fingerprint !== OWNERSHIP_SCHEMA) throw Error("Exact installed TEST schema required");
  const before = sources(rows);
  const result = await deployPinnedTestRuntime(
    {
      ...args,
      replaceVersions: { "openfolk-control-plane": 4 },
      persistJournal: (journal) =>
        args.persistJournal({
          ...journal,
          ownershipCatalogFingerprint: schema.fingerprint,
          ownershipPreserved: before,
        }),
    },
    {
      bundle: controlPlaneBundle,
      endpoints: CONTROLPLANE_ENDPOINTS,
      bundleSha: OWNERSHIP_RUNTIME_SHA,
      databaseFingerprint: OWNERSHIP_RUNTIME_DATABASE,
      version: "learn-ownership-evidence-runtime/1",
      stagePrefix: "learn-ownership-evidence-",
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
      ownershipInventoryPreserved: unchanged,
      preservedDataSets: before.length,
      state: unchanged ? result.state : "requires_inspection",
    };
  } catch {
    return { ...result, state: "requires_inspection", ownershipInventoryPreserved: null };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST replacement required");
    const prefix = ".verification-results/ownership-evidence-edge-deploy";
    const result = await deployOwnershipEvidence({
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
      "Roster replacement unconfirmed; inspect the durable journal and TEST endpoint before retrying.",
    );
    process.exitCode = 1;
  }
}
