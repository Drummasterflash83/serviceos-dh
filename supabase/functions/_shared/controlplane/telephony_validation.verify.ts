// Run: node supabase/functions/_shared/controlplane/telephony_validation.verify.ts
// Pure unit tests for manual telephony inventory validation. No DB, no network.
import assert from "node:assert/strict";
import {
  validateManualEndpoint,
  normalizeDdi,
  looksLikeUrl,
  findDuplicate,
  type ManualEndpointValid,
} from "./telephony_validation.ts";

let failed = 0;
function ok(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${(e as Error).message}`);
  }
}
const valid = (r: ReturnType<typeof validateManualEndpoint>) => {
  assert.equal(r.ok, true, "ok" in r && !r.ok ? r.errors.join("; ") : "");
  return r as ManualEndpointValid;
};
const invalid = (r: ReturnType<typeof validateManualEndpoint>) => {
  assert.equal(r.ok, false);
};

// ── DDI ─────────────────────────────────────────────────────────────────────
ok("DDI: UK national normalises to E.164", () => {
  const r = valid(validateManualEndpoint({ kind: "ddi", value: "020 7946 0018" }));
  assert.equal(r.canonical, "+442079460018");
  assert.equal(r.display, "020 7946 0018");
});
ok("DDI: UK mobile normalises", () => {
  assert.equal(valid(validateManualEndpoint({ kind: "ddi", value: "07911 123456" })).canonical, "+447911123456");
});
ok("DDI: international +1 kept", () => {
  assert.equal(valid(validateManualEndpoint({ kind: "ddi", value: "+1 (415) 555-2671" })).canonical, "+14155552671");
});
ok("DDI: 00-international prefix", () => {
  assert.equal(valid(validateManualEndpoint({ kind: "ddi", value: "0044 20 7946 0018" })).canonical, "+442079460018");
});
ok("DDI: REJECTS an API URL", () => {
  invalid(validateManualEndpoint({ kind: "ddi", value: "https://pbx.sipcentric.com/api/v1/customers/3950/endpoints/9418" }));
});
ok("DDI: REJECTS an extension-length value", () => {
  invalid(validateManualEndpoint({ kind: "ddi", value: "201" }));
});
ok("DDI: REJECTS letters/malformed", () => {
  invalid(validateManualEndpoint({ kind: "ddi", value: "not-a-number" }));
  invalid(validateManualEndpoint({ kind: "ddi", value: "" }));
});

// ── extension ─────────────────────────────────────────────────────────────
ok("extension: short numeric accepted, NOT turned into a public number", () => {
  const r = valid(validateManualEndpoint({ kind: "extension", value: "201", providerContext: "sipcentric:3950" }));
  assert.equal(r.canonical, "201");
  assert.equal(r.canonical.startsWith("+"), false);
});
ok("extension: REJECTS URL", () => {
  invalid(validateManualEndpoint({ kind: "extension", value: "http://x/201", providerContext: "sipcentric:3950" }));
});
ok("extension: REJECTS whitespace-only", () => {
  invalid(validateManualEndpoint({ kind: "extension", value: "   ", providerContext: "sipcentric:3950" }));
});
ok("extension: requires provider/account context", () => {
  invalid(validateManualEndpoint({ kind: "extension", value: "201" }));
});
ok("extension: REJECTS a full phone number as an extension", () => {
  invalid(validateManualEndpoint({ kind: "extension", value: "02079460018", providerContext: "sipcentric:3950" }));
});

// ── queue / ring group ──────────────────────────────────────────────────────
ok("queue: requires a display name + provider context; canonical ≠ label", () => {
  invalid(validateManualEndpoint({ kind: "queue", display: "", providerContext: "sipcentric:3950" }));
  const r = valid(validateManualEndpoint({ kind: "queue", display: "Sales Queue", providerContext: "sipcentric:3950" }));
  assert.notEqual(r.canonical, r.display);
  assert.equal(r.is_shared, true);
});
ok("ring_group: canonical uses provider id when given", () => {
  const r = valid(validateManualEndpoint({ kind: "ring_group", display: "Engineers", providerContext: "sipcentric:3950", providerId: "rg-88" }));
  assert.ok(r.canonical.includes("rg-88"));
});

// ── voicemail / sip / device ────────────────────────────────────────────────
ok("voicemail/sip/device require an id + provider context", () => {
  for (const kind of ["voicemail", "sip", "device"]) {
    invalid(validateManualEndpoint({ kind, value: "", providerContext: "sipcentric:3950" }));
    invalid(validateManualEndpoint({ kind, value: "x", providerContext: "" }));
    valid(validateManualEndpoint({ kind, value: "id-123", providerContext: "sipcentric:3950" }));
  }
});
ok("device: REJECTS URL identifier", () => {
  invalid(validateManualEndpoint({ kind: "device", value: "https://pbx/endpoints/9418", providerContext: "sipcentric:3950" }));
});

// ── universal ───────────────────────────────────────────────────────────────
ok("unknown kind rejected", () => invalid(validateManualEndpoint({ kind: "trunk", value: "x" })));
ok("looksLikeUrl catches api urls and www", () => {
  assert.equal(looksLikeUrl("https://x"), true);
  assert.equal(looksLikeUrl("pbx.sipcentric.com/api"), false); // no scheme/www → not flagged here
  assert.equal(looksLikeUrl("www.example.com"), true);
  assert.equal(looksLikeUrl("+442079460018"), false);
});
ok("normalizeDdi returns null for the raw Sipcentric evidence URL", () => {
  assert.equal(normalizeDdi("https://pbx.sipcentric.com/api/v1/customers/3950/endpoints/9418"), null);
});

// ── duplicate detection (manual AND discovered) ─────────────────────────────
ok("findDuplicate matches an existing canonical endpoint of the same kind", () => {
  const cand = valid(validateManualEndpoint({ kind: "ddi", value: "020 7946 0018" }));
  const dup = findDuplicate(cand, [
    { endpoint_kind: "email", normalized_value: "+442079460018" }, // wrong kind → not a dup
    { endpoint_kind: "ddi", normalized_value: "+442079460018", source: "discovery" }, // dup
  ]);
  assert.ok(dup && dup.source === "discovery");
});
ok("findDuplicate returns null when nothing matches", () => {
  const cand = valid(validateManualEndpoint({ kind: "ddi", value: "020 7946 0018" }));
  assert.equal(findDuplicate(cand, [{ endpoint_kind: "ddi", normalized_value: "+442079999999" }]), null);
});

console.log(
  failed === 0
    ? "\ntelephony_validation.verify: ALL PASSED"
    : `\ntelephony_validation.verify: ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
