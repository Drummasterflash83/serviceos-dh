// Run: node --test supabase/functions/_shared/evidence/model.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toEvidence,
  canonicalize,
  verifyLossless,
  reconstructSource,
  adapterForTable,
  SOURCE_ADAPTERS,
} from "./model.ts";

const emailRow = {
  id: "em-1",
  tenant_id: "t1",
  provider: "gmail",
  provider_message_id: "MSG-1",
  provider_thread_id: "TH-1",
  from_email: "a@x.co",
  to_emails: ["b@y.co"],
  subject: "Re: works",
  body_text: "hello",
  raw_payload: { label_ids: ["INBOX"], size_estimate: 10 },
  received_at: "2026-07-24T10:00:00Z",
  sent_at: null,
  created_at: "2026-07-24T10:05:00Z",
};

test("email row → Evidence: kind, provenance and derived timestamps", () => {
  const e = toEvidence("email_messages", emailRow);
  assert.equal(e.evidenceKind, "email");
  assert.equal(e.sourceSystem, "gmail"); // derived from row.provider
  assert.equal(e.sourceTable, "email_messages");
  assert.equal(e.sourceId, "em-1");
  assert.equal(e.sourceExternalId, "MSG-1");
  assert.equal(e.occurredAt, "2026-07-24T10:00:00Z"); // received_at wins over null sent_at
  assert.equal(e.capturedAt, "2026-07-24T10:05:00Z");
});

test("LOSSLESS by construction: raw holds every source field, verifyLossless passes", () => {
  const e = toEvidence("email_messages", emailRow);
  const v = verifyLossless(emailRow, e);
  assert.equal(v.lossless, true);
  assert.deepEqual(v.missing, []);
});

test("verifyLossless DETECTS a dropped field (guards against a lossy adapter)", () => {
  const e = toEvidence("email_messages", emailRow);
  delete (e.raw as Record<string, unknown>).body_text; // simulate loss
  const v = verifyLossless(emailRow, e);
  assert.equal(v.lossless, false);
  assert.ok(v.missing.includes("body_text"));
});

test("REVERSIBLE: reconstructSource yields the original row exactly", () => {
  const e = toEvidence("email_messages", emailRow);
  assert.deepEqual(reconstructSource(e), emailRow);
});

test("canonical hash-preimage is deterministic and key-order independent", () => {
  const a = canonicalize({ b: 1, a: [3, { y: 2, x: 1 }] });
  const b = canonicalize({ a: [3, { x: 1, y: 2 }], b: 1 });
  assert.equal(a, b);
  // distinct content → distinct canonical
  assert.notEqual(canonicalize({ a: 1 }), canonicalize({ a: 2 }));
});

test("provenance chain: transcript ← recording ← call is captured in derivedFrom", () => {
  const rec = toEvidence("phone_recordings", {
    id: "r1",
    tenant_id: "t1",
    provider: "sipcentric",
    provider_recording_id: "REC-1",
    provider_call_id: "CALL-1",
    started_at: "2026-07-24T09:00:00Z",
    created_at: "2026-07-24T09:01:00Z",
  });
  assert.equal(rec.evidenceKind, "phone_recording");
  assert.deepEqual(rec.derivedFrom, [{ kind: "phone_call", ref: "CALL-1" }]);

  const tr = toEvidence("phone_transcripts", {
    id: "tr1",
    tenant_id: "t1",
    recording_id: "r1",
    transcript_text: "…",
    model: "whisper-1",
    created_at: "2026-07-24T09:02:00Z",
  });
  assert.equal(tr.parserVersion, "whisper-1"); // model is the extractor version
  assert.deepEqual(tr.derivedFrom, [{ kind: "phone_recording", ref: "r1" }]);
});

test("provider-neutral: every current signal source has an adapter; unknown table is surfaced", () => {
  for (const t of [
    "email_messages",
    "phone_calls",
    "phone_recordings",
    "phone_transcripts",
    "phone_ai_insights",
    "data_imports",
  ])
    assert.ok(adapterForTable(t), `adapter for ${t}`);
  assert.equal(adapterForTable("nonexistent_table"), null);
  assert.throws(() => toEvidence("nonexistent_table", { id: "x" }), /no Evidence adapter/);
  // future kinds are modelled even if no adapter/data yet
  assert.ok(!("slack_messages" in SOURCE_ADAPTERS)); // adapter added when the source lands
});
