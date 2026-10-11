/**
 * Tests for the generic Tenant Connections projection.
 * Run: node --test src/lib/openfolk-connections.test.ts
 *
 * Guards the truthfulness contract: no fabricated connections/capabilities; real provider
 * limitations preserved; tenant boundaries surfaced; placeholders for unimplemented adapters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONNECTION_STATES,
  PROVIDER_TEMPLATES,
  projectConnections,
} from "./openfolk-connections.ts";
import type { Connections } from "./openfolk.ts";

const CONNECTIONS: Connections = {
  google_workspace: {
    status: "connected",
    connections: [{ domain: "drummondheating.co.uk", status: "connected" }],
    approved_domains: ["drummondheating.co.uk"],
    imported: 32,
    excluded: 8,
    excluded_domains: { "allkin.co": 8 },
    read_only: true,
  },
  telephony: {
    commercial_provider: "Birchills",
    underlying_provider: "sipcentric",
    account_ref: "3950",
    status: "manual",
    credentials: "configured (never displayed)",
    capabilities: {
      ddi_discovery: "planned",
      extension_discovery: "manual",
      endpoint_discovery: "supported",
      call_direction: "supported",
      provisioning: "unavailable",
    },
    external_write: "disabled",
    evidence_count: 10,
  },
  slack: { status: "not_connected", note: "Identity model ready — ingestion not connected" },
};

test("projects exactly one view per provider template, none fabricated", () => {
  const views = projectConnections(CONNECTIONS, { endpoints: [], identities: [] });
  assert.equal(views.length, PROVIDER_TEMPLATES.length);
  const families = views.map((v) => v.family).sort();
  assert.deepEqual(families, [
    "commusoft",
    "google_workspace",
    "microsoft_365",
    "slack",
    "telephony",
  ]);
});

test("Google Workspace connected with tenant-boundary warning", () => {
  const v = projectConnections(CONNECTIONS)!.find((x) => x.family === "google_workspace")!;
  assert.equal(v.connected, true);
  assert.equal(v.lifecycle, "connected");
  assert.equal(v.externalRead, true);
  assert.equal(v.externalWrite, false); // read_only
  assert.equal(v.readiness, "inventory_ready");
  assert.equal(v.inventoryCount, 32);
  assert.ok(v.boundaries.some((b) => b.value.includes("drummondheating.co.uk")));
  assert.ok(v.warnings.some((w) => /outside the approved tenant boundary/i.test(w)));
  assert.equal(v.health, "degraded"); // excluded > 0
});

test("telephony carries the REAL backend capability keys/states verbatim", () => {
  const v = projectConnections(CONNECTIONS, { endpoints: [], identities: [] })!.find(
    (x) => x.family === "telephony",
  )!;
  assert.equal(v.commercialProvider, "Birchills");
  assert.equal(v.accountRef, "3950");
  assert.equal(v.evidenceCount, 10);
  const byKey = Object.fromEntries(v.capabilities.map((c) => [c.key, c.state]));
  assert.equal(byKey.ddi_discovery, "planned");
  assert.equal(byKey.extension_discovery, "manual");
  assert.equal(byKey.provisioning, "unavailable");
  assert.equal(byKey.endpoint_discovery, "supported");
  // Manual metadata is not a verified live connection.
  assert.equal(v.readiness, "not_ready");
  assert.equal(v.connected, false);
  assert.equal(v.verification, "never_verified");
});

test("connected telephony retains its own typed inventory readiness", () => {
  const v = projectConnections(
    { ...CONNECTIONS, telephony: { ...CONNECTIONS.telephony, status: "connected" } },
    {
      endpoints: [
        {
          id: "e1",
          channel: "phone",
          endpoint_kind: "ddi",
          normalized_value: "+441111",
          display_value: "Main",
          provider: "sipcentric",
          is_shared: false,
          status: "active",
          source: "manual",
          updated_at: "2026-07-24T00:00:00Z",
        },
      ],
      identities: [],
    },
  )!.find((x) => x.family === "telephony")!;
  assert.equal(v.readiness, "inventory_ready");
  assert.equal(v.inventoryCount, 1);
});

test("Slack shows truthful not-connected note, no fabricated capability", () => {
  const v = projectConnections(CONNECTIONS)!.find((x) => x.family === "slack")!;
  assert.equal(v.connected, false);
  assert.equal(v.adapterImplemented, false);
  assert.match(v.notConnectedReason ?? "", /ingestion not connected/i);
});

test("Commusoft + Microsoft 365 are truthful placeholders, never fabricated as working", () => {
  const views = projectConnections(CONNECTIONS)!;
  const commusoft = views.find((x) => x.family === "commusoft")!;
  const m365 = views.find((x) => x.family === "microsoft_365")!;
  assert.equal(commusoft.connected, false);
  assert.equal(commusoft.notConnectedReason, "Setup required");
  assert.equal(m365.connected, false);
  assert.equal(m365.adapterImplemented, false);
  assert.equal(m365.notConnectedReason, "Adapter not yet implemented");
});

test("with NO connections payload, nothing is reported as connected", () => {
  const views = projectConnections(undefined);
  assert.equal(views.length, PROVIDER_TEMPLATES.length);
  assert.ok(views.every((v) => v.connected === false));
  assert.ok(views.every((v) => v.health === "not_connected" || v.health === "unknown"));
});

test("connection state vocabulary is the explicit lifecycle, not collapsed", () => {
  assert.ok(CONNECTION_STATES.includes("awaiting_customer_admin"));
  assert.ok(CONNECTION_STATES.includes("revoked"));
  assert.ok(CONNECTION_STATES.length >= 10);
});

test("retained mailboxes never reactivate disabled, revoked or failed connections", () => {
  for (const status of ["not_connected", "disabled", "revoked", "error"]) {
    const v = projectConnections({
      ...CONNECTIONS,
      google_workspace: { ...CONNECTIONS.google_workspace, status },
    }).find((v) => v.family === "google_workspace")!;
    assert.equal(v.connected, false);
    assert.equal(v.externalRead, false);
    assert.equal(v.readiness, "not_ready");
    assert.equal(v.inventoryCount, 32);
  }
});
test("credential text and manual inventory do not prove connection, verification or healthy capture", () => {
  for (const status of ["not_configured", "manual", "configured", "revoked", "disabled", "error"]) {
    const v = projectConnections({
      ...CONNECTIONS,
      telephony: { ...CONNECTIONS.telephony, status, credentials: "configured enabled available" },
    }).find((v) => v.family === "telephony")!;
    assert.equal(v.connected, false);
    assert.equal(v.externalRead, false);
    assert.notEqual(v.health, "healthy");
  }
});
test("failed latest test and failed sync remain visible despite historical verification", () => {
  const lifecycle = {
    connection_id: "p1",
    provider: "sipcentric",
    status: "configured",
    auth_mode: "api",
    account_ref: "masked",
    configured_fields: ["api_key"],
    has_secrets: true,
    verified_at: "2026-01-01T00:00:00Z",
    last_test_status: "passed",
    last_test_at: "2026-01-01T00:00:00Z",
    revoked_at: null,
    latest_event: null,
    latest_event_at: null,
    last_successful_discovery: null,
    last_failed_discovery: null,
    discovery_counts: { last_run_processed: 4 },
    is_fallback: false,
    fallback_reason: null,
  };
  const project = (extra: object) =>
    projectConnections({
      ...CONNECTIONS,
      telephony: {
        ...CONNECTIONS.telephony,
        status: "configured",
        lifecycle: { ...lifecycle, ...extra },
      },
    }).find((v) => v.family === "telephony")!;
  assert.equal(project({}).connected, true);
  assert.equal(project({}).verification, "verified");
  assert.equal(project({}).health, "unknown");
  assert.equal(project({ last_test_status: "failed" }).connected, false);
  assert.equal(project({ last_test_status: "failed" }).verification, "failed");
  assert.equal(project({ last_sync_status: "failed" }).health, "degraded");
  assert.equal(project({ revoked_at: "2026-02-01" }).authorisation, "revoked");
  assert.equal(project({ has_secrets: false }).connected, false);
  assert.equal(project({ verified_at: "2099-01-01" }).verification, "never_verified");
});
test("multiple Phone providers produce separate views and scoped inventories", () => {
  const accounts = [
    { ...CONNECTIONS.telephony, status: "connected" },
    {
      ...CONNECTIONS.telephony,
      status: "revoked",
      underlying_provider: "simwood",
      commercial_provider: "Simwood",
      account_ref: "other",
    },
  ];
  const views = projectConnections(
    { ...CONNECTIONS, telephony_accounts: accounts },
    {
      endpoints: [
        {
          id: "e1",
          channel: "phone",
          endpoint_kind: "ddi",
          normalized_value: "+441111",
          display_value: null,
          provider: "sipcentric",
          is_shared: false,
          status: "active",
          source: "manual",
          updated_at: "2026-01-01",
        },
      ],
      identities: [],
    },
  ).filter((v) => v.family === "telephony");
  assert.equal(views.length, 2);
  assert.equal(new Set(views.map((v) => v.id)).size, 2);
  assert.equal(views[0].inventoryCount, 1);
  assert.equal(views[1].inventoryCount, 0);
  assert.equal(views[1].connected, false);
});
