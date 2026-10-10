/** Concrete synthetic recipient/scope for review before hosted account creation. */
import { randomUUID } from "node:crypto";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const keys = ["runId", "tenant", "actor", "grant", "connection"];
const uuid = (v) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const scope = {
  projectRef: TEST_PROJECT,
  accounts: 1,
  tenantRole: "owner",
  operatorPermission: "platform.controlplane.admin",
  operatorGrantMinutes: 30,
  providerCredential: "synthetic_never_provider_valid",
  providerNetworkRequests: 0,
  productionChanges: false,
  retireLogin: true,
  retainSyntheticEvidence: true,
};
export function createContactFixturePlan() {
  const ids = Object.fromEntries(keys.map((k) => [k, randomUUID()]));
  return {
    version: "learn-commusoft-contact-fixture-plan/1",
    ...ids,
    email: `learn-contacts-${ids.runId.slice(0, 8)}@example.invalid`,
    scope: { ...scope },
  };
}
export function contactFixtureIdentities(plan) {
  if (
    !plan ||
    plan.version !== "learn-commusoft-contact-fixture-plan/1" ||
    Object.keys(plan).sort().join() !== ["version", ...keys, "email", "scope"].sort().join() ||
    keys.some((k) => !uuid(plan[k])) ||
    new Set(keys.map((k) => plan[k])).size !== keys.length ||
    plan.email !== `learn-contacts-${plan.runId.slice(0, 8)}@example.invalid` ||
    !plan.scope ||
    Object.keys(plan.scope).sort().join() !== Object.keys(scope).sort().join() ||
    Object.entries(scope).some(([k, v]) => plan.scope[k] !== v)
  )
    throw Error("Exact reviewed TEST contact fixture recipient and scope required");
  return Object.fromEntries([...keys, "email"].map((k) => [k, plan[k]]));
}

/** Never replay an account-creation attempt or overwrite its recovery evidence. */
export function assertUncreatedContactRetry(plan, previous, absence) {
  const ids = contactFixtureIdentities(plan);
  if (
    !previous ||
    Object.entries(ids).some(([k, v]) => previous[k] !== v) ||
    previous.projectRef !== TEST_PROJECT ||
    previous.includeContacts !== true ||
    previous.created !== false ||
    previous.secret !== null ||
    previous.sourceBefore !== null ||
    previous.stage !== "setup" ||
    previous.providerReads !== 0 ||
    !Array.isArray(previous.requests) ||
    previous.requests.length !== 0 ||
    previous.failure !== "Synthetic ingestion SQL failed (HTTP 400)" ||
    previous.priorAttempts ||
    !absence ||
    Object.keys(absence).sort().join() !==
      ["auth", "tenant", "profile", "grants", "connections", "bindings"].sort().join() ||
    Object.values(absence).some((v) => v !== 0)
  )
    throw Error("Uncreated fixture retry requires exact prior evidence and authoritative absence");
}
