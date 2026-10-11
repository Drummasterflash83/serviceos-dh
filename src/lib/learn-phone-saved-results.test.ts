import test from "node:test";
import assert from "node:assert/strict";
import { readSavedPhoneResults } from "./learn-phone-saved-results.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = () => ({
  version: "learn-phone-saved-results/1",
  tenant_id: id(1),
  recording_id: id(2),
  checked_at: "2026-10-11T12:00:00Z",
  source_available: true,
  transcript: {
    id: id(3),
    status: "completed",
    text: "Hello",
    offset: 0,
    next_offset: null,
    total_characters: 5,
    sha256: "a".repeat(64),
    freshness: "source_matched",
    updated_at: "2026-10-11T12:00:00Z",
  },
  analysis: {
    id: id(4),
    summary: "Retained summary",
    summary_truncated: false,
    source_transcript_id: id(3),
    freshness: "source_matched",
    updated_at: "2026-10-11T12:00:00Z",
  },
});
const db = (data: unknown) => ({ rpc: async () => ({ data, error: null }) });
test("saved results use only the explicit company/recording RPC and bounded hash cursor", async () => {
  let request: any;
  const p = envelope();
  p.transcript.text = "🙂".repeat(5);
  p.transcript.offset = 12000;
  p.transcript.total_characters = 12005;
  const result = await readSavedPhoneResults(
    {
      rpc: async (name, args) => {
        request = { name, args };
        return { data: p, error: null };
      },
    },
    id(1),
    id(2),
    { offset: 12000, sha256: "a".repeat(64) },
  );
  assert.equal(result.transcript?.text, "🙂".repeat(5));
  assert.deepEqual(request, {
    name: "learn_phone_saved_results_read",
    args: {
      p_tenant: id(1),
      p_recording: id(2),
      p_offset: 12000,
      p_transcript_sha256: "a".repeat(64),
    },
  });
});
test("cross-company, unexpected private fields, malformed pages and false freshness fail closed", async () => {
  for (const mutate of [
    (p: any) => (p.tenant_id = id(9)),
    (p: any) => (p.recording_id = id(9)),
    (p: any) => (p.storage_path = "private/path"),
    (p: any) => (p.transcript.source_storage_path = "private/path"),
    (p: any) => (p.transcript.text = "too long"),
    (p: any) => (p.transcript.next_offset = 12000),
    (p: any) => (p.transcript.total_characters = 1.2),
    (p: any) => (p.transcript.freshness = "complete"),
    (p: any) => (p.transcript.status = "failed"),
    (p: any) => (p.analysis.source_transcript_id = id(8)),
    (p: any) => (p.transcript.freshness = "stale"),
    (p: any) => (p.analysis.summary_truncated = true),
    (p: any) => (p.source_available = false),
  ]) {
    const p = envelope();
    mutate(p);
    await assert.rejects(readSavedPhoneResults(db(p), id(1), id(2)));
  }
});
test("historical and stale results stay visible with explicit status; unavailable is not empty success", async () => {
  const p = envelope();
  p.transcript.freshness = "unverified";
  p.analysis.freshness = "stale";
  assert.equal((await readSavedPhoneResults(db(p), id(1), id(2))).analysis?.freshness, "stale");
  const absent = { ...envelope(), source_available: false, transcript: null, analysis: null };
  assert.equal((await readSavedPhoneResults(db(absent), id(1), id(2))).source_available, false);
  await assert.rejects(
    readSavedPhoneResults(
      { rpc: async () => ({ data: null, error: { code: "42501" } }) },
      id(1),
      id(2),
    ),
  );
});
test("invalid cursors never dispatch; changed transcript hash cannot join pages", async () => {
  let calls = 0;
  const client = {
    rpc: async () => {
      calls++;
      return { data: envelope(), error: null };
    },
  };
  for (const offset of [-1, 0, 1, 12000.5, 1056000])
    await assert.rejects(
      readSavedPhoneResults(client, id(1), id(2), { offset, sha256: "a".repeat(64) }),
    );
  assert.equal(calls, 0);
  const p = envelope();
  p.transcript.offset = 12000;
  p.transcript.total_characters = 12005;
  await assert.rejects(
    readSavedPhoneResults(db(p), id(1), id(2), { offset: 12000, sha256: "b".repeat(64) }),
  );
});
