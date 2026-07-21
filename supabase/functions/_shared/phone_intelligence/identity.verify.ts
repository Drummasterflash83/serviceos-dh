// Reference proof of PHONE INTELLIGENCE V1 participant identity resolution. Run:
//   node supabase/functions/_shared/phone_intelligence/identity.verify.ts
//
// Pure, deterministic fixtures — the Drummond identity scenarios. No DB/network.

import assert from "node:assert/strict";
import { detectSpokenNames } from "./spoken_name.ts";
import {
  resolveInternalParticipant,
  resolveExternalParticipant,
  resolveCallIdentity,
  type ExtensionMapping,
} from "./participants.ts";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};

const LIZ: ExtensionMapping = {
  extension: "103",
  personId: "person-liz",
  displayName: "Liz",
  role: "Finance",
  isSharedDevice: false,
  confidence: 0.95,
  source: "configured",
};

// 1) Outbound internal identity — ext 103 → Liz, confirmed by spoken name.
ok("outbound: ext 103 → Liz, spoken-name confirms, high confidence", () => {
  const spoken = detectSpokenNames({
    transcript: "hi it's Liz from Drummond Heating",
    transcriptQuality: 0.85,
    knownPeople: [{ id: "person-liz", name: "Liz" }],
  });
  const internal = resolveInternalParticipant({ extensionMapping: LIZ, spokenNames: spoken });
  assert.equal(internal.resolvedEntityId, "person-liz");
  assert.equal(internal.displayName, "Liz");
  assert.ok(internal.confidence >= 0.95, `confidence ${internal.confidence}`);
  assert.equal(internal.conflicts.length, 0);
  assert.ok(internal.evidence.some((e) => e.type === "spoken_name_confirms"));
});

// 2) Identity conflict — ext maps Liz but "Mary speaking"; recorded, not overridden.
ok("conflict: ext=Liz vs spoken 'Mary' → recorded, not silently overridden", () => {
  const spoken = detectSpokenNames({
    transcript: "hello, Mary speaking",
    transcriptQuality: 0.8,
    knownPeople: [
      { id: "person-liz", name: "Liz" },
      { id: "person-mary", name: "Mary" },
    ],
  });
  const internal = resolveInternalParticipant({ extensionMapping: LIZ, spokenNames: spoken });
  assert.equal(internal.resolvedEntityId, "person-liz", "mapping is not silently overridden");
  assert.equal(internal.conflicts.length, 1, "conflict recorded");
  assert.ok(internal.conflicts[0].note.includes("pickup/transfer"));
  assert.ok(internal.confidence < LIZ.confidence, "confidence lowered by conflict");
});

// 3) Shared device — remains probable, never definitive.
ok("shared device → probable (confidence capped)", () => {
  const shared: ExtensionMapping = {
    ...LIZ,
    extension: "100",
    isSharedDevice: true,
    displayName: "Reception",
    personId: "person-recep",
  };
  const internal = resolveInternalParticipant({ extensionMapping: shared, spokenNames: [] });
  assert.ok(internal.confidence <= 0.75, `confidence ${internal.confidence}`);
  assert.ok(internal.evidence.some((e) => e.type === "shared_device"));
});

// 4) External resolution via number match; never fabricated from transcript alone.
ok("external: number match resolves customer; no match → unresolved", () => {
  const matched = resolveExternalParticipant({
    externalNumber: "+447700900123",
    numberMatch: {
      entityId: "person-helen",
      displayName: "Helen",
      kind: "person",
      confidence: 0.9,
      source: "interaction_linkage",
    },
  });
  assert.equal(matched.resolvedEntityId, "person-helen");
  assert.ok(matched.confidence >= 0.9);

  const unresolved = resolveExternalParticipant({
    externalNumber: "+447700900999",
    numberMatch: null,
    spokenNames: detectSpokenNames({ transcript: "this is Bob", knownPeople: [] }),
  });
  assert.equal(unresolved.resolvedEntityId, null, "no identity fabricated from transcript alone");
  assert.equal(unresolved.sourceFields.unresolvedReason, "no canonical match for external number");
});

// 5) Unknown — no mapping + poor transcript → unknown.
ok("unknown: no mapping + poor transcript → unknown", () => {
  const spoken = detectSpokenNames({
    transcript: "err ... hello?",
    transcriptQuality: 0.2,
    knownPeople: [],
  });
  const internal = resolveInternalParticipant({ extensionMapping: null, spokenNames: spoken });
  assert.equal(internal.role, "unknown");
  assert.equal(internal.resolvedEntityId, null);
});

// 6) Orchestration — combined identity surfaces confidence, conflict, unresolved.
ok("orchestration surfaces confidence, conflict and unresolved", () => {
  const internal = resolveInternalParticipant({ extensionMapping: LIZ, spokenNames: [] });
  const external = resolveExternalParticipant({
    externalNumber: "+447700900123",
    numberMatch: null,
  });
  const id = resolveCallIdentity({
    direction: "outbound",
    directionConfidence: 0.95,
    internal,
    external,
  });
  assert.equal(id.direction, "outbound");
  assert.equal(id.internal.resolvedEntityId, "person-liz");
  assert.ok(id.unresolved.includes("external_participant"));
  assert.equal(id.hasConflict, false);
});

console.log(`\n${passed} identity-resolver assertions passed ✓`);
