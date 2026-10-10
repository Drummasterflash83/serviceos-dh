import { catalog as operatorCatalog } from "./learn-operator-inputs-test-fixture.mjs";
import { importBatchesTransport } from "./learn-import-batches-test-fixture.mjs";
import { COMMUSOFT_FUNCTION_QUERY, COMMUSOFT_GRANTS_QUERY } from "./learn-commusoft-catalog.mjs";
import {
  OPERATOR_INPUT_FUNCTION_QUERY,
  OPERATOR_INPUT_GRANTS_QUERY,
  OPERATOR_INPUT_AUTHORITY_QUERY,
} from "./learn-operator-inputs-catalog.mjs";
import {
  CONNECTION_FUNCTION_QUERY,
  CONNECTION_GRANTS_QUERY,
  CONNECTION_VAULT_QUERY,
} from "./learn-commusoft-setup-catalog.mjs";
import {
  connectionPrior,
  connectionExpected,
  CONNECTION_RELEASE,
  CONNECTION_SHA,
} from "./learn-test-commusoft-setup-release.mjs";
import { compactImportTable } from "./learn-test-import-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export function catalog(installed = false) {
  const c = operatorCatalog(true),
    p = connectionPrior();
  c.connectionFunctions = p.functions;
  c.connectionGrants = p.grants;
  c.connectionVault = p.vault;
  if (installed) {
    const e = connectionExpected();
    c.connectionFunctions.push(...e.functions);
    c.connectionFunctions.sort((a, b) => a.name.localeCompare(b.name));
    c.connectionGrants.push(...e.grants);
    c.tables.push(...e.tables);
    c.base.inventory.tables.push(...e.tables.map(compactImportTable));
    c.base.inventory.functions.push(
      ...e.functions.map(
        ({ name, arguments: args, securityDefiner, authenticatedExecute, anonExecute }) => ({
          name,
          arguments: args,
          securityDefiner,
          authenticatedExecute,
          anonExecute,
        }),
      ),
    );
    const receipt = {
      migration_name: CONNECTION_RELEASE,
      source_sha256: CONNECTION_SHA,
      project_ref: TEST_PROJECT,
      applied_at: "2026-10-10T12:00:00Z",
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
  afterUnavailable = false,
} = {}) {
  let writes = 0;
  const cached = new Map();
  const current = () => {
    const installed = already || (writes > 0 && !rehearse && (!unknown || committed));
    if (!cached.has(installed)) cached.set(installed, catalog(installed));
    return cached.get(installed);
  };
  const base = importBatchesTransport({ beforeCatalog: current });
  return {
    get writes() {
      return writes;
    },
    fetcher: async (url, o) => {
      const query = o?.body ? JSON.parse(o.body).query : null,
        c = current();
      if (url.endsWith("/database/query")) {
        writes++;
        if (unknown) throw Error("Lost reply");
        return Response.json([
          { marker: "learn-test-commusoft-connection/1", receipt_expected: true },
        ]);
      }
      if (writes && afterUnavailable) throw Error("Inspection unavailable");
      for (const [q, key, field] of [
        [COMMUSOFT_FUNCTION_QUERY, "functions", "commusoftFunctions"],
        [COMMUSOFT_GRANTS_QUERY, "grants", "commusoftGrants"],
        [OPERATOR_INPUT_FUNCTION_QUERY, "functions", "operatorInputFunctions"],
        [OPERATOR_INPUT_GRANTS_QUERY, "grants", "operatorInputGrants"],
        [OPERATOR_INPUT_AUTHORITY_QUERY, "authority", "operatorInputAuthority"],
        [CONNECTION_FUNCTION_QUERY, "functions", "connectionFunctions"],
        [CONNECTION_GRANTS_QUERY, "grants", "connectionGrants"],
        [CONNECTION_VAULT_QUERY, "vault", "connectionVault"],
      ])
        if (query === q) return Response.json([{ [key]: c[field] }]);
      return base.fetcher(url, o);
    },
  };
}
