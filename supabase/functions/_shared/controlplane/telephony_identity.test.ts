// Run: node --test supabase/functions/_shared/controlplane/telephony_identity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  suggestTelephonyIdentity,
  labelNamePart,
  isSharedTelephonyLabel,
} from "./telephony_identity.ts";

// Real Drummonds team (from team_members, display names only).
const MEMBERS = [
  { id: "owner", display_name: "Owner / MD" },
  { id: "rudi", display_name: "Rudi" },
  { id: "julie", display_name: "Julie" },
  { id: "mary", display_name: "Mary" },
  { id: "liz", display_name: "Liz" },
  { id: "larne", display_name: "Larne" },
  { id: "tony", display_name: "Tony" },
  { id: "heidi", display_name: "Heidi" },
];
const NO_CONFIRMED = [];

test("labelNamePart strips the <ext> marker", () => {
  assert.equal(labelNamePart("Mary - Clients <103>"), "Mary - Clients");
  assert.equal(labelNamePart("Larne <207>"), "Larne");
  assert.equal(labelNamePart("Business Hours IVR <501>"), "Business Hours IVR");
});

test("isSharedTelephonyLabel flags IVR/queue infrastructure", () => {
  assert.equal(isSharedTelephonyLabel("Business Hours IVR <501>"), true);
  assert.equal(isSharedTelephonyLabel("Out Of Hours IVR <502>"), true);
  assert.equal(isSharedTelephonyLabel("Mary - Clients <103>"), false);
});

test("Mary / ext 103 — consistent single-name label → high confidence", () => {
  const s = suggestTelephonyIdentity(
    {
      extension: "103",
      observed_labels: ["Mary - Clients <103>", "Clients - Mary <103>"],
      call_count: 103,
    },
    MEMBERS,
    NO_CONFIRMED,
  );
  assert.equal(s.suggested_member_id, "mary");
  assert.equal(s.suggested_kind, "person");
  assert.equal(s.confidence, "high");
  assert.deepEqual(s.named_members, ["mary"]);
  assert.deepEqual(s.ambiguity, []);
});

test("ext 101 — reassigned across Julie and Heidi → unresolved + ambiguity", () => {
  const s = suggestTelephonyIdentity(
    { extension: "101", observed_labels: ["Julie - Sandy <101>", "Heidi <101>"] },
    MEMBERS,
    NO_CONFIRMED,
  );
  assert.equal(s.confidence, "unresolved");
  assert.equal(s.suggested_member_id, null);
  assert.equal(s.ambiguity.length, 2);
  assert.ok(s.ambiguity.includes("julie") && s.ambiguity.includes("heidi"));
});

test("ext 102 — Liz plus a stray unrecognised name (Anna) → medium, current owner unconfirmed", () => {
  const s = suggestTelephonyIdentity(
    { extension: "102", observed_labels: ["Liz - Accounts <102>", "Accounts - Anna <102>"] },
    MEMBERS,
    NO_CONFIRMED,
  );
  assert.equal(s.suggested_member_id, "liz");
  assert.equal(s.confidence, "medium");
  assert.ok(s.unknown_label_names.includes("anna"));
});

test("IVR extension → shared, never an individual", () => {
  const s = suggestTelephonyIdentity(
    { extension: "501", observed_labels: ["Business Hours IVR <501>"] },
    MEMBERS,
    NO_CONFIRMED,
  );
  assert.equal(s.suggested_kind, "shared");
  assert.equal(s.suggested_member_id, null);
});

test("unknown label naming nobody → unresolved", () => {
  const s = suggestTelephonyIdentity(
    { extension: "999", observed_labels: ["Spare Desk <999>"] },
    MEMBERS,
    NO_CONFIRMED,
  );
  assert.equal(s.confidence, "unresolved");
  assert.equal(s.suggested_member_id, null);
});

test("existing confirmed link on the extension → high (known)", () => {
  const s = suggestTelephonyIdentity(
    { extension: "103", observed_labels: ["Mary - Clients <103>"] },
    MEMBERS,
    [{ team_member_id: "mary", external_ref: "103", primary_login: null }],
  );
  assert.equal(s.suggested_member_id, "mary");
  assert.equal(s.confidence, "high");
  assert.equal(s.provenance, "member_integration_identities");
});

test("single-token member 'Larne - Quotes' still resolves", () => {
  const s = suggestTelephonyIdentity(
    { extension: "207", observed_labels: ["Larne <207>", "Larne - Quotes <107>"] },
    MEMBERS,
    NO_CONFIRMED,
  );
  assert.equal(s.suggested_member_id, "larne");
  assert.equal(s.confidence, "high");
});
