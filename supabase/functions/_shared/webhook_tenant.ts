export interface WebhookConnectorRef {
  id: string;
  tenantId: string;
}

export interface WebhookAccountRef {
  connectorId: string;
  accountKey: string | null;
  providerCustomerId: string | null;
}

export type WebhookTenantResolution =
  | { kind: "resolved"; tenantId: string; basis: "provider_customer_id" }
  | { kind: "quarantine"; tenantId: null; reason: string };

/** Pure fail-closed tenant resolver. It never invents or defaults a tenant. */
export function resolveWebhookTenant(input: {
  customerId: string | null;
  connectors: WebhookConnectorRef[];
  accounts: WebhookAccountRef[];
}): WebhookTenantResolution {
  const tenantByConnector = new Map(input.connectors.map((c) => [c.id, c.tenantId]));
  if (input.customerId) {
    const matches = new Set<string>();
    for (const account of input.accounts) {
      if (
        account.accountKey === input.customerId ||
        account.providerCustomerId === input.customerId
      ) {
        const tenantId = tenantByConnector.get(account.connectorId);
        if (tenantId) matches.add(tenantId);
      }
    }
    if (matches.size === 1) {
      return {
        kind: "resolved",
        tenantId: Array.from(matches)[0],
        basis: "provider_customer_id",
      };
    }
    if (matches.size > 1) {
      return { kind: "quarantine", tenantId: null, reason: "ambiguous_provider_customer" };
    }
    return { kind: "quarantine", tenantId: null, reason: "unknown_provider_customer" };
  }

  const tenants = new Set(input.connectors.map((c) => c.tenantId));
  return {
    kind: "quarantine",
    tenantId: null,
    reason: tenants.size === 0 ? "no_enabled_connector" : "missing_provider_customer",
  };
}
