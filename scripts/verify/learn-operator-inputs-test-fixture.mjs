import { catalog as commusoftCatalog } from "./learn-commusoft-test-fixture.mjs";
import {
  expectedCommusoftRuntime,
  expectedCommusoftEndpoint,
} from "./learn-test-commusoft-runtime.mjs";
import {
  operatorInputPrior,
  expectedOperatorInputs,
  OPERATOR_INPUT_RELEASE,
  OPERATOR_INPUT_SHA,
} from "./learn-test-operator-inputs-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { compactImportTable } from "./learn-test-import-release.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export function catalog(installed = false) {
  const c = commusoftCatalog(true),
    p = operatorInputPrior();
  c.base.functions = [
    ...expectedCommusoftRuntime().afterEndpoints,
    expectedCommusoftEndpoint().endpoint,
  ];
  c.operatorInputFunctions = p.functions;
  c.operatorInputGrants = p.grants;
  c.operatorInputAuthority = p.authority;
  if (installed) {
    const e = expectedOperatorInputs();
    c.operatorInputFunctions.push(...e.functions);
    c.operatorInputGrants.push(...e.grants);
    c.operatorInputAuthority.permissions = e.permissions;
    c.actionRegistries.permissions.push(...structuredClone(e.permissions));
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
      migration_name: OPERATOR_INPUT_RELEASE,
      source_sha256: OPERATOR_INPUT_SHA,
      project_ref: TEST_PROJECT,
      applied_at: "2026-10-10T10:00:00Z",
    };
    c.readiness.customMigrationEntries.push(receipt);
    if (c.base.report.customMigrationEntries !== c.readiness.customMigrationEntries)
      c.base.report.customMigrationEntries.push(receipt);
  }
  c.readinessCatalogSha256 = catalogFingerprint(c.base);
  return c;
}
