/** Synthetic schema/transport fixtures for TEST release tools. */
import {
  importBatchesCatalog,
  importBatchesTransport,
} from "./learn-import-batches-test-fixture.mjs";
import { expectedImportPaginationEndpoint } from "./learn-test-import-pagination-endpoint-catalog.mjs";
import {
  COMMUSOFT_MANIFEST as manifest,
  COMMUSOFT_FUNCTION_QUERY,
  COMMUSOFT_GRANTS_QUERY,
} from "./learn-commusoft-catalog.mjs";
import {
  commusoftPriorContract,
  expectedCommusoft,
  COMMUSOFT_RELEASE,
  COMMUSOFT_SHA,
} from "./learn-test-commusoft-release.mjs";
import { compactImportTable } from "./learn-test-import-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export function catalog(installed = false) {
  const c = importBatchesCatalog(true),
    prior = commusoftPriorContract();
  c.base.functions = c.base.functions.map((f) =>
    f.slug === "learn-data-import" ? expectedImportPaginationEndpoint().endpoint : f,
  );
  c.commusoftFunctions = prior.functions;
  c.commusoftGrants = prior.grants;
  if (installed) {
    const e = expectedCommusoft();
    c.commusoftFunctions = c.commusoftFunctions
      .filter((f) => f.name !== "platform_jobs_claim")
      .concat(e.functions)
      .sort((a, b) => a.name.localeCompare(b.name));
    c.workerFunctions = c.workerFunctions.map((f) =>
      f.name === "platform_jobs_claim" ? e.functions.find((x) => x.name === f.name) : f,
    );
    c.threadFunctions = c.threadFunctions.map((f) =>
      f.name === "platform_jobs_claim" ? e.functions.find((x) => x.name === f.name) : f,
    );
    c.commusoftGrants.push(...e.grants);
    c.tables.push(...e.tables);
    c.base.inventory.tables.push(...e.tables.map(compactImportTable));
    c.base.inventory.functions.push(
      ...e.functions
        .filter((f) => manifest.functions.includes(f.name))
        .map(({ name, arguments: args, securityDefiner, authenticatedExecute, anonExecute }) => ({
          name,
          arguments: args,
          securityDefiner,
          authenticatedExecute,
          anonExecute,
        })),
    );
    const receipt = {
      migration_name: COMMUSOFT_RELEASE,
      source_sha256: COMMUSOFT_SHA,
      project_ref: TEST_PROJECT,
      applied_at: "2026-10-10T00:00:00Z",
    };
    c.readiness.customMigrationEntries.push(receipt);
    if (c.base.report.customMigrationEntries !== c.readiness.customMigrationEntries)
      c.base.report.customMigrationEntries.push(receipt);
  }
  c.readinessCatalogSha256 = catalogFingerprint(c.base);
  return c;
}
export function transport({
  rehearse = false,
  unknown = false,
  committed = false,
  already = false,
} = {}) {
  let writes = 0;
  const current = () => catalog(already || (writes > 0 && !rehearse && (!unknown || committed)));
  const base = importBatchesTransport({ beforeCatalog: current });
  return {
    get writes() {
      return writes;
    },
    fetcher: async (url, o) => {
      const query = o?.body ? JSON.parse(o.body).query : null;
      if (url.endsWith("/database/query")) {
        writes++;
        if (unknown) throw Error("Uncertain acknowledgement");
        return Response.json([
          { marker: "learn-test-commusoft-release/1", receipt_expected: true },
        ]);
      }
      if (query === COMMUSOFT_FUNCTION_QUERY)
        return Response.json([{ functions: current().commusoftFunctions }]);
      if (query === COMMUSOFT_GRANTS_QUERY)
        return Response.json([{ grants: current().commusoftGrants }]);
      return base.fetcher(url, o);
    },
  };
}
