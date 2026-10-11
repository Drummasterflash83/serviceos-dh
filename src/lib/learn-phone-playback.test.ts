import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readRetainedRecordings,
  openRetainedRecording,
  type PhonePlaybackClient,
} from "./learn-phone-playback.ts";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const row = { id: id(3), started_at: null, duration_seconds: 4, audio_stored: true };
const page = {
  version: "learn-phone-recordings/1",
  tenant_id: id(1),
  table: "phone_calls",
  id: id(2),
  source_available: true,
  rows: [row],
  next_cursor: null,
};
const db = (data: any): PhonePlaybackClient => ({
  rpc: async () => ({ data, error: null }),
  functions: { invoke: async () => ({ data, error: null }) },
});
test("listing checks exact source and redacted rows, forwards cursor", async () => {
  const calls: unknown[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: page, error: null };
    },
  };
  assert.equal(
    (await readRetainedRecordings(client, id(1), "phone_calls", id(2), id(4))).rows[0].id,
    id(3),
  );
  assert.deepEqual(calls, [
    {
      name: "learn_phone_recordings_read",
      args: { p_tenant: id(1), p_table: "phone_calls", p_id: id(2), p_after: id(4) },
    },
  ]);
  for (const data of [
    { ...page, tenant_id: id(9) },
    { ...page, id: id(9) },
    { ...page, rows: [row, row] },
    { ...page, rows: [{ ...row, storage_path: "private" }] },
    { ...page, source_available: false },
    { ...page, next_cursor: id(9) },
    { ...page, rows: [{ ...row, duration_seconds: -1 }] },
  ])
    await assert.rejects(() => readRetainedRecordings(db(data), id(1), "phone_calls", id(2)));
});
const now = () => Date.parse("2026-10-11T12:00:00Z");
const link = {
  version: "learn-phone-playback/1",
  tenant_id: id(1),
  recording_id: id(3),
  request_id: id(4),
  url:
    "https://test.example/storage/v1/object/sign/phone-recordings/" +
    id(1) +
    "/a.wav?token=synthetic",
  expires_at: "2026-10-11T12:00:55Z",
};
test("playback accepts only scoped short lived links from the configured backend", async () => {
  assert.equal(
    (await openRetainedRecording(db(link), id(1), id(3), "https://test.example", now)).url,
    link.url,
  );
  for (const data of [
    { ...link, tenant_id: id(9) },
    { ...link, recording_id: id(9) },
    { ...link, url: link.url.replace("test.example", "other.example") },
    { ...link, url: link.url.replace(id(1), id(9)) },
    { ...link, url: link.url + "&unsafe=1" },
    { ...link, expires_at: "2026-10-11T12:00:01Z" },
    { ...link, expires_at: "2026-10-11T13:00:00Z" },
  ])
    await assert.rejects(() =>
      openRetainedRecording(db(data), id(1), id(3), "https://test.example", now),
    );
});
