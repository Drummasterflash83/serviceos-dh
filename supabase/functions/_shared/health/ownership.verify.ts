// Run: node supabase/functions/_shared/health/ownership.verify.ts
import assert from "node:assert/strict";
import { resolveOwnership } from "./ownership.ts";
import type { OwnershipHint, OwnershipMaps } from "./types.ts";

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

// Tenant maps (as would be loaded from operating_profile_entries). NO hardcoded values
// live in the resolver — they are all supplied here.
const maps: Partial<OwnershipMaps> = {
  ddi: { "+441111110000": { responsibility: "team:finance", label: "Finance line" } },
  extension: { "204": { responsibility: "team:accounts", label: "Accounts ext" } },
  queue: { scheduling: { responsibility: "team:scheduling", label: "Scheduling queue" } },
  named_recipient: { synthia: { responsibility: "member:synthia-ref", label: "Synthia" } },
  shared_responsibility: {},
  fallback_role: { responsibility: "role:coordinator", label: "Coordinator" },
};
const empty = (): OwnershipHint => ({
  ddi: null,
  extension: null,
  queue: null,
  requestedName: null,
});

ok("DDI mapping wins first", () => {
  const r = resolveOwnership({ ...empty(), ddi: "+441111110000", queue: "scheduling" }, maps);
  assert.equal(r.source, "ddi");
  assert.equal(r.responsibility, "team:finance");
  assert.match(r.explanation, /DDI/);
});

ok("extension mapping", () => {
  const r = resolveOwnership({ ...empty(), extension: "204" }, maps);
  assert.equal(r.source, "extension");
  assert.equal(r.responsibility, "team:accounts");
});

ok("queue mapping", () => {
  const r = resolveOwnership({ ...empty(), queue: "scheduling" }, maps);
  assert.equal(r.source, "queue");
  assert.match(r.explanation, /queue/);
});

ok("named recipient (case-insensitive)", () => {
  const r = resolveOwnership({ ...empty(), requestedName: "Synthia" }, maps);
  assert.equal(r.source, "named_recipient");
  assert.equal(r.responsibility, "member:synthia-ref");
  assert.match(r.explanation, /Synthia/);
});

ok("fallback role when nothing else matches", () => {
  const r = resolveOwnership({ ...empty(), queue: "unknown-queue" }, maps);
  assert.equal(r.source, "fallback_role");
  assert.equal(r.responsibility, "role:coordinator");
});

ok("needs_context when no maps at all", () => {
  const r = resolveOwnership(
    { ...empty(), ddi: "+449999999999" },
    { ddi: {}, fallback_role: null },
  );
  assert.equal(r.source, "needs_context");
  assert.equal(r.responsibility, null);
  assert.match(r.explanation, /No specific owner/);
});

ok("no hardcoded tenant logic: empty maps → needs_context even with signals", () => {
  const r = resolveOwnership(
    { ddi: "+441111110000", extension: "204", queue: "scheduling", requestedName: "synthia" },
    {},
  );
  assert.equal(r.source, "needs_context");
});

ok("deterministic", () => {
  const h = { ...empty(), queue: "scheduling" };
  assert.deepEqual(resolveOwnership(h, maps), resolveOwnership(h, maps));
});

console.log(
  failed === 0 ? "\nownership.verify: ALL PASSED" : `\nownership.verify: ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
