/** Preserve existing TEST records across the separately pinned release runner. */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  releaseOperatorInputs,
  installedOperatorInputs,
  operatorInputFingerprint,
  withoutOperatorInputs,
  OPERATOR_INPUT_SHA,
} from "./learn-test-operator-inputs-release.mjs";
import { readOperatorInputsCatalog } from "./learn-operator-inputs-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const OPERATOR_PRESERVED_TABLES = [
  "email_messages",
  "phone_calls",
  "phone_recordings",
  "phone_transcripts",
  "slack_messages",
  "slack_message_versions",
  "interactions",
  "people",
  "companies",
  "customer_cards",
  "sites",
  "jobs",
  "provider_connections",
  "tenant_connectors",
  "connector_accounts",
  "platform_jobs",
  "feature_flags",
  "learn_business_input_pages",
  "learn_business_input_versions",
  "learn_business_input_observations",
];
// Observation tables have composite keys; sort hashes instead of assuming an id.
export const OPERATOR_SOURCE_SNAPSHOT = OPERATOR_PRESERVED_TABLES.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.${n} s`,
).join(" union all ");
/** Read-only confirmation after an acknowledged install; never resubmits SQL. */
export async function confirmOperatorRelease({
  allowProjectRef,
  token,
  beforeCatalog,
  install,
  fetcher = fetch,
}) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    install?.projectRef !== TEST_PROJECT ||
    install.sourceSha256 !== OPERATOR_INPUT_SHA ||
    install.acknowledged !== true
  )
    throw Error("Acknowledged matching TEST installation required");
  const catalog = await readOperatorInputsCatalog({ allowProjectRef, token, fetcher });
  const sources = await communicationQuery(token, OPERATOR_SOURCE_SNAPSHOT, { fetcher });
  const counts = await communicationQuery(
    token,
    "select (select count(*)::int from public.platform_authority_grants) as operator_grants,(select count(*)::int from public.learn_operator_input_requests) as operator_requests",
    { fetcher },
  );
  const schemaVerified = installedOperatorInputs(catalog);
  const priorCatalogPreserved =
    operatorInputFingerprint(withoutOperatorInputs(catalog)) ===
    operatorInputFingerprint(beforeCatalog);
  const preExistingSourcesPreserved =
    JSON.stringify(sources.sort((a, b) => a.name.localeCompare(b.name))) ===
    JSON.stringify(install.sourceBefore);
  const newState = counts?.[0] ?? null;
  const passed =
    schemaVerified &&
    priorCatalogPreserved &&
    preExistingSourcesPreserved &&
    newState?.operator_grants === 0 &&
    newState?.operator_requests === 0;
  return {
    catalog,
    report: {
      version: "learn-operator-inputs-confirmation/1",
      projectRef: TEST_PROJECT,
      sourceSha256: OPERATOR_INPUT_SHA,
      observedAt: new Date().toISOString(),
      writeAttempted: false,
      state: passed ? "installed_needs_authenticated_acceptance" : "requires_inspection",
      schemaVerified,
      priorCatalogPreserved,
      preExistingSourcesPreserved,
      newState,
    },
  };
}
export async function preserveOperatorRelease({
  allowProjectRef,
  token,
  rehearse,
  rehearsal,
  fetcher = fetch,
}) {
  if (allowProjectRef !== TEST_PROJECT) throw Error("Explicit TEST project required");
  const snapshot = async () => {
    const r = await communicationQuery(token, OPERATOR_SOURCE_SNAPSHOT, { fetcher });
    if (
      !Array.isArray(r) ||
      r.length !== OPERATOR_PRESERVED_TABLES.length ||
      r.some(
        (x) =>
          !OPERATOR_PRESERVED_TABLES.includes(x.name) ||
          !Number.isSafeInteger(x.count) ||
          x.count < 0 ||
          !/^[a-f0-9]{32}$/.test(x.fingerprint),
      )
    )
      throw Error("Source fingerprint incomplete");
    return r.sort((a, b) => a.name.localeCompare(b.name));
  };
  const before = await snapshot(),
    r = await releaseOperatorInputs({ allowProjectRef, token, rehearse, rehearsal, fetcher }),
    after = await snapshot();
  let newState = null;
  if (!rehearse && r.state === "installed_needs_authenticated_acceptance") {
    const rows = await communicationQuery(
      token,
      "select (select count(*)::int from public.platform_authority_grants) as operator_grants,(select count(*)::int from public.learn_operator_input_requests) as operator_requests",
      { fetcher },
    );
    newState = rows?.[0] ?? null;
  }
  return {
    ...r,
    preExistingSourcesPreserved: JSON.stringify(before) === JSON.stringify(after),
    sourceBefore: before,
    sourceAfter: after,
    newState,
  };
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
      throw Error("Explicit hosted TEST release required");
    if (a[0] === "--confirm") {
      const { catalog, report } = await confirmOperatorRelease({
        allowProjectRef: TEST_PROJECT,
        token: savedCliToken(),
        beforeCatalog: JSON.parse(
          readFileSync(".verification-results/operator-inputs-catalog-before.json"),
        ),
        install: JSON.parse(
          readFileSync(".verification-results/operator-inputs-hosted-install.json"),
        ),
      });
      writeFileSync(
        ".verification-results/operator-inputs-catalog-confirmed.json",
        JSON.stringify(catalog, null, 2) + "\n",
      );
      writeFileSync(
        ".verification-results/operator-inputs-hosted-confirmation.json",
        JSON.stringify(report, null, 2) + "\n",
      );
      console.log(JSON.stringify(report));
      process.exitCode = report.state === "installed_needs_authenticated_acceptance" ? 0 : 1;
    } else {
      const rehearse = a[0] === "--rehearse",
        r = await preserveOperatorRelease({
          allowProjectRef: TEST_PROJECT,
          token: savedCliToken(),
          rehearse,
          rehearsal: rehearse
            ? null
            : JSON.parse(
                readFileSync(".verification-results/operator-inputs-hosted-rehearsal.json"),
              ),
        });
      const path =
        ".verification-results/operator-inputs-hosted-" +
        (rehearse ? "rehearsal" : "install") +
        ".json";
      writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
      console.log(
        JSON.stringify({
          state: r.state,
          preExistingSourcesPreserved: r.preExistingSourcesPreserved,
          newState: r.newState,
        }),
      );
      if (
        !r.preExistingSourcesPreserved ||
        r.state !==
          (rehearse ? "rehearsed_and_rolled_back" : "installed_needs_authenticated_acceptance") ||
        (!rehearse && (r.newState?.operator_grants !== 0 || r.newState?.operator_requests !== 0))
      )
        process.exitCode = 1;
    }
  } catch {
    console.error(
      "Operator release did not complete; inspect recorded state before any resubmission.",
    );
    process.exitCode = 1;
  }
}
