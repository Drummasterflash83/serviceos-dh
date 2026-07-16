import { resolveWebhookTenant } from "./webhook_tenant.ts";

let failed = 0;
function check(name: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"}: ${name}`);
  if (!condition) failed += 1;
}

const connectors = [
  { id: "connector-a", tenantId: "tenant-a" },
  { id: "connector-b", tenantId: "tenant-b" },
];
const accounts = [
  { connectorId: "connector-a", accountKey: "customer-a", providerCustomerId: "customer-a" },
  { connectorId: "connector-b", accountKey: "customer-b", providerCustomerId: "customer-b" },
];

check(
  "an exact provider customer mapping resolves one tenant",
  resolveWebhookTenant({ customerId: "customer-a", connectors, accounts }).tenantId === "tenant-a",
);
check(
  "an unknown provider customer is quarantined instead of guessed",
  resolveWebhookTenant({ customerId: "unknown", connectors, accounts }).kind === "quarantine",
);
check(
  "a missing provider customer is quarantined when more than one tenant is enabled",
  resolveWebhookTenant({ customerId: null, connectors, accounts }).kind === "quarantine",
);
check(
  "a missing provider customer is quarantined even when only one tenant is enabled",
  resolveWebhookTenant({ customerId: null, connectors: [connectors[0]], accounts }).kind ===
    "quarantine",
);
check(
  "no enabled connector is quarantined",
  resolveWebhookTenant({ customerId: "customer-a", connectors: [], accounts: [] }).kind ===
    "quarantine",
);

if (failed) throw new Error(`${failed} webhook tenant-boundary assertion(s) failed`);
