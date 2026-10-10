/** Additive TEST release with durable pre-write evidence and read-only recovery. */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import {
  releaseConnectionSetup,
  installedConnectionSetup,
  connectionPrerequisites,
  connectionFingerprint,
  withoutConnectionSetup,
  CONNECTION_SHA,
} from "./learn-test-commusoft-setup-release.mjs";
import { readConnectionSetupCatalog, CONNECTION_TABLES } from "./learn-commusoft-setup-catalog.mjs";
import { OPERATOR_PRESERVED_TABLES } from "./learn-test-operator-inputs-hosted.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const CONNECTION_PRESERVED_TABLES = [
  ...OPERATOR_PRESERVED_TABLES.map((n) => "public." + n),
  "public.provider_connection_events",
  "public.platform_authority_grants",
  "public.learn_operator_input_requests",
  "public.profiles",
  "public.authority_permissions",
  "public.learn_business_input_request_gates",
  "public.learn_business_input_request_permits",
  "vault.secrets",
];
// Ciphertext rows are hashed on the server. No decrypted secret or payload is returned.
export const CONNECTION_SOURCE_SNAPSHOT = CONNECTION_PRESERVED_TABLES.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export const CONNECTION_NEW_COUNTS = CONNECTION_TABLES.map(
  (n) => `select '${n}' as name,count(*)::int as count from public.${n}`,
).join(" union all ");
export function normalizedSources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== CONNECTION_PRESERVED_TABLES.length ||
    new Set(rows.map((r) => r.name)).size !== CONNECTION_PRESERVED_TABLES.length ||
    rows.some(
      (r) =>
        !CONNECTION_PRESERVED_TABLES.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete unique source fingerprints required");
  return rows
    .map(({ name, count, fingerprint }) => ({ name, count, fingerprint }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
const equalSources = (a, b) =>
  JSON.stringify(normalizedSources(a)) === JSON.stringify(normalizedSources(b));
const emptyNewState = (rows) =>
  Array.isArray(rows) &&
  rows.length === CONNECTION_TABLES.length &&
  new Set(rows.map((r) => r.name)).size === CONNECTION_TABLES.length &&
  rows.every((r) => CONNECTION_TABLES.includes(r.name) && r.count === 0);
export async function confirmConnectionRelease({
  allowProjectRef,
  token,
  journal,
  fetcher = fetch,
}) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    journal?.projectRef !== TEST_PROJECT ||
    journal.sourceSha256 !== CONNECTION_SHA ||
    journal.version !== "learn-connection-release-journal/1" ||
    !connectionPrerequisites(journal.beforeCatalog)
  )
    throw Error("Matching TEST pre-write journal required");
  const catalog = await readConnectionSetupCatalog({ allowProjectRef, token, fetcher });
  const sourceAfter = normalizedSources(
    await communicationQuery(token, CONNECTION_SOURCE_SNAPSHOT, { fetcher }),
  );
  const installed = installedConnectionSetup(catalog);
  const priorCatalogPreserved =
    connectionFingerprint(installed ? withoutConnectionSetup(catalog) : catalog) ===
    connectionFingerprint(journal.beforeCatalog);
  const preExistingSourcesPreserved = equalSources(journal.sourceBefore, sourceAfter);
  const newState = installed
    ? await communicationQuery(token, CONNECTION_NEW_COUNTS, { fetcher })
    : null;
  const state =
    priorCatalogPreserved && preExistingSourcesPreserved
      ? installed && emptyNewState(newState)
        ? "installed_needs_authenticated_acceptance"
        : !installed && connectionPrerequisites(catalog)
          ? "prior_state_confirmed"
          : "requires_inspection"
      : "requires_inspection";
  return {
    catalog,
    report: {
      version: "learn-connection-release-confirmation/1",
      projectRef: TEST_PROJECT,
      sourceSha256: CONNECTION_SHA,
      observedAt: new Date().toISOString(),
      writeAttempted: false,
      state,
      schemaVerified: installed,
      priorCatalogPreserved,
      preExistingSourcesPreserved,
      sourceAfter,
      newState,
    },
  };
}
export async function preserveConnectionRelease({
  allowProjectRef,
  token,
  rehearse,
  rehearsal,
  persistJournal,
  fetcher = fetch,
}) {
  if (allowProjectRef !== TEST_PROJECT || typeof persistJournal !== "function")
    throw Error("TEST target and durable journal required");
  if (!rehearse && rehearsal?.preExistingSourcesPreserved !== true)
    throw Error("Source-preserving rehearsal required");
  let journal = null;
  const result = await releaseConnectionSetup({
    allowProjectRef,
    token,
    rehearse,
    rehearsal,
    fetcher,
    beforeWrite: async (beforeCatalog) => {
      const sourceBefore = normalizedSources(
        await communicationQuery(token, CONNECTION_SOURCE_SNAPSHOT, { fetcher }),
      );
      journal = {
        version: "learn-connection-release-journal/1",
        projectRef: TEST_PROJECT,
        sourceSha256: CONNECTION_SHA,
        observedAt: new Date().toISOString(),
        mode: rehearse ? "rehearse" : "apply",
        beforeCatalog,
        sourceBefore,
      };
      await persistJournal(journal);
    },
  });
  if (!journal) return result;
  let sourceAfter = null,
    newState = null;
  try {
    sourceAfter = normalizedSources(
      await communicationQuery(token, CONNECTION_SOURCE_SNAPSHOT, { fetcher }),
    );
    if (!rehearse && result.state === "installed_needs_authenticated_acceptance")
      newState = await communicationQuery(token, CONNECTION_NEW_COUNTS, { fetcher });
  } catch {
    /* journal survives; confirmation is read-only */
  }
  const preExistingSourcesPreserved =
    sourceAfter !== null && equalSources(journal.sourceBefore, sourceAfter);
  return {
    ...result,
    state:
      preExistingSourcesPreserved && (rehearse || emptyNewState(newState))
        ? result.state
        : "requires_inspection",
    preExistingSourcesPreserved,
    sourceBefore: journal.sourceBefore,
    sourceAfter,
    newState,
  };
}
function durableJournal(path, journal) {
  // Exclusive creation prevents accidental resubmission after a crash or uncertain reply.
  const fd = openSync(path, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(journal, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const a = process.argv.slice(2);
    if (
      a.length !== 2 ||
      !["--rehearse", "--apply", "--confirm"].includes(a[0]) ||
      a[1] !== "--existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit hosted TEST operation required");
    mkdirSync(".verification-results", { recursive: true });
    const prefix = ".verification-results/commusoft-setup-hosted-",
      read = (n) => JSON.parse(readFileSync(prefix + n + ".json"));
    const args = { allowProjectRef: TEST_PROJECT, token: savedCliToken() };
    let report;
    if (a[0] === "--confirm") {
      const r = await confirmConnectionRelease({ ...args, journal: read("apply-journal") });
      report = r.report;
      writeFileSync(prefix + "catalog-confirmed.json", JSON.stringify(r.catalog, null, 2) + "\n", {
        mode: 0o600,
      });
      writeFileSync(prefix + "confirmation.json", JSON.stringify(report, null, 2) + "\n", {
        mode: 0o600,
      });
    } else {
      const rehearse = a[0] === "--rehearse",
        mode = rehearse ? "rehearse" : "apply";
      report = await preserveConnectionRelease({
        ...args,
        rehearse,
        rehearsal: rehearse ? null : read("rehearsal"),
        persistJournal: (j) => durableJournal(prefix + mode + "-journal.json", j),
      });
      writeFileSync(
        prefix + (rehearse ? "rehearsal" : "install") + ".json",
        JSON.stringify(report, null, 2) + "\n",
        { mode: 0o600 },
      );
    }
    console.log(
      JSON.stringify({
        state: report.state,
        writeAttempted: report.writeAttempted,
        preExistingSourcesPreserved: report.preExistingSourcesPreserved,
        newState: report.newState,
      }),
    );
    if (
      ![
        "rehearsed_and_rolled_back",
        "installed_needs_authenticated_acceptance",
        "already_installed",
      ].includes(report.state)
    )
      process.exitCode = 1;
  } catch {
    console.error(
      "Connection release stopped; inspect the saved journal and use read-only confirmation before any further write.",
    );
    process.exitCode = 1;
  }
}
