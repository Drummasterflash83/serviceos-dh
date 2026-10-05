// Reference proof of endpoint discovery suggestions + provider capabilities. Run:
//   node supabase/functions/_shared/telephony/discovery.verify.ts

import assert from "node:assert/strict";
import { suggestEndpointMapping } from "./discovery.ts";
import { providerCapabilities } from "./capabilities.ts";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const EP = "https://pbx.sipcentric.com/api/v1/customers/1/endpoints/8f31";

// 1) Strong single introduction → suggested (never auto-confirmed).
ok("dominant matched name → suggested with confidence", () => {
  const s = suggestEndpointMapping({
    endpointRef: EP,
    inboundCount: 6,
    outboundCount: 18,
    lastSeen: "2026-07-20T00:00:00Z",
    nameTally: [{ name: "Liz", personId: "person-liz", count: 11 }],
  });
  assert.equal(s.status, "suggested");
  assert.equal(s.suggestedPersonId, "person-liz");
  assert.ok(s.confidence >= 0.8, `confidence ${s.confidence}`);
  assert.ok(s.evidence.some((e) => e.includes("outbound")));
});

// 2) Two significant names → conflicted, NO suggestion.
ok("two significant names → conflicted, no suggestion", () => {
  const s = suggestEndpointMapping({
    endpointRef: EP,
    inboundCount: 10,
    outboundCount: 10,
    lastSeen: null,
    nameTally: [
      { name: "Liz", personId: "person-liz", count: 6 },
      { name: "Mary", personId: "person-mary", count: 5 },
    ],
  });
  assert.equal(s.status, "conflicted");
  assert.equal(s.suggestedPersonId, null);
  assert.ok(s.conflicts.includes("Mary"));
});

// 3) Three names → shared handset.
ok("three names → shared, high shared-likelihood", () => {
  const s = suggestEndpointMapping({
    endpointRef: EP,
    inboundCount: 20,
    outboundCount: 5,
    lastSeen: null,
    nameTally: [
      { name: "Liz", personId: "p1", count: 5 },
      { name: "Mary", personId: "p2", count: 5 },
      { name: "Tony", personId: "p3", count: 5 },
    ],
  });
  assert.equal(s.status, "shared");
  assert.ok(s.sharedLikelihood >= 0.7);
});

// 4) No matched names → unknown.
ok("no matched introductions → unknown", () => {
  const s = suggestEndpointMapping({
    endpointRef: EP,
    inboundCount: 3,
    outboundCount: 0,
    lastSeen: null,
    nameTally: [{ name: "someone", personId: null, count: 2 }],
  });
  assert.equal(s.status, "unknown");
  assert.equal(s.confidence, 0);
});

// 5) Provider capabilities are honest and provider-specific.
ok("capabilities: sipcentric endpoints supported, pickup unavailable", () => {
  const c = providerCapabilities("sipcentric");
  assert.equal(c.capabilities.endpoint_discovery, "supported");
  assert.equal(c.capabilities.call_direction, "supported");
  assert.equal(c.capabilities.pickup_metadata, "unavailable");
  assert.equal(c.capabilities.extension_discovery, "manual");
  const u = providerCapabilities("nope");
  assert.equal(u.capabilities.trunks_discovery, "unavailable");
});

console.log(`\n${passed} telephony discovery/capability assertions passed ✓`);
