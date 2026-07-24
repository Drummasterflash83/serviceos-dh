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
  // Connected (credentials configured) but 0 typed phone endpoints -> "connected", the
  // state BEFORE inventory_ready (never collapsed to a single generic status).
  assert.equal(v.readiness, "connected");
});

test("telephony readiness advances to inventory_ready once typed endpoints exist", () => {
  const v = projectConnections(CONNECTIONS, {
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
  })!.find((x) => x.family === "telephony")!;
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
