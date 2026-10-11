import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVoicemailMailboxes,
  parseVoicemailMessages,
  parseVoicemailMailboxPage,
} from "./voicemail-reader.ts";
import { voicemailConnectionNotice } from "./voicemails.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const mailbox = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const summary = () => ({
  id: mailbox,
  display_name: "Synthetic mailbox",
  extension: "100",
  notification_email: null,
  email_enabled: null,
  sync_state: "awaiting_connection",
  last_synced_at: null,
  message_count: 1,
});
const message = (id = other) => ({
  id,
  tenant_id: tenant,
  mailbox_id: mailbox,
  caller_number: null,
  caller_name: null,
  received_at: "2026-10-11T10:00:00Z",
  duration_seconds: 28,
  transcript: null,
  email_status: "unknown",
  email_evidence_at: null,
  email_recipient: null,
  recording_available: true,
});
const historic = () => ({
  ...summary(),
  access_scope: "retained_messages",
  display_name: "Earlier private messages",
  extension: "",
});
const envelope = () => ({
  version: "learn-voicemail-mailboxes/1",
  tenant_id: tenant,
  after: null,
  observed_at: "2026-10-12T00:00:00Z",
  next_after: null,
  rows: [historic()],
});
test("historic message groups reveal no current mailbox settings or connection warning", () => {
  const page = parseVoicemailMailboxPage(envelope(), tenant, null);
  assert.equal(page.rows[0].access_scope, "retained_messages");
  assert.equal(voicemailConnectionNotice(page.rows), null);
  for (const change of [
    { notification_email: "new-owner@example.invalid" },
    { email_enabled: true },
    { extension: "601" },
    { display_name: "New owners name" },
    { last_synced_at: "2026-10-12T00:00:00Z" },
    { message_count: 0 },
  ])
    assert.throws(() =>
      parseVoicemailMailboxPage(
        { ...envelope(), rows: [{ ...historic(), ...change }] },
        tenant,
        null,
      ),
    );
});
test("mailbox cursors, version and tenant must match the requested page", () => {
  for (const change of [
    { version: "unknown" },
    { tenant_id: other },
    { after: other },
    { observed_at: "bad" },
    { next_after: other },
    { rows: [summary()] },
    { rows: [historic(), historic()] },
  ])
    assert.throws(() => parseVoicemailMailboxPage({ ...envelope(), ...change }, tenant, null));
  assert.throws(() => parseVoicemailMailboxPage({ ...envelope(), after: other }, tenant, other));
  assert.equal(parseVoicemailMailboxPage({ ...envelope(), rows: [] }, tenant, null).rows.length, 0);
});
test("twenty-row page advances to exactly its last identity", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    ...summary(),
    id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`,
    access_scope: "current",
  }));
  const page = { ...envelope(), rows, next_after: rows.at(-1)!.id };
  assert.equal(parseVoicemailMailboxPage(page, tenant, null).nextAfter, page.next_after);
  assert.throws(() => parseVoicemailMailboxPage({ ...page, next_after: rows[0].id }, tenant, null));
  assert.throws(() =>
    parseVoicemailMailboxPage({ ...page, rows: [...rows].reverse() }, tenant, null),
  );
});
test("private reader preserves saved messages while source connection is unverified", () => {
  assert.equal(parseVoicemailMailboxes([summary()])[0].message_count, 1);
  const parsed = parseVoicemailMessages([message()], 1, tenant, mailbox, 0);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.rows[0].recording_available, true);
  assert.equal(parsed.rows[0].transcript, null);
});
test("unavailable summary is not an empty inbox; duplicates and invalid counts fail", () => {
  for (const value of [
    null,
    {},
    [summary(), summary()],
    [{ ...summary(), message_count: null }],
    [{ ...summary(), message_count: -1 }],
    [{ ...summary(), sync_state: "current" }],
    [{ ...summary(), last_synced_at: "invalid" }],
  ])
    assert.throws(() => parseVoicemailMailboxes(value));
  assert.deepEqual(parseVoicemailMailboxes([]), []);
});
test("messages must match both requested company and private mailbox", () => {
  for (const row of [
    { ...message(), tenant_id: other },
    { ...message(), mailbox_id: other },
    { ...message(), id: "invalid" },
  ])
    assert.throws(() => parseVoicemailMessages([row], 1, tenant, mailbox, 0));
});
test("unknown counts and silently truncated pages never report no messages", () => {
  for (const total of [null, undefined, -1, "1", 0.5])
    assert.throws(() => parseVoicemailMessages([], total, tenant, mailbox, 0));
  assert.throws(() => parseVoicemailMessages([], 1, tenant, mailbox, 0));
  assert.throws(() => parseVoicemailMessages([message()], 21, tenant, mailbox, 0));
  assert.throws(() => parseVoicemailMessages([message(), message()], 2, tenant, mailbox, 0));
});
test("exact last page and an empty page after records shrink are distinguishable", () => {
  assert.equal(parseVoicemailMessages([message()], 21, tenant, mailbox, 1).rows.length, 1);
  assert.deepEqual(parseVoicemailMessages([], 1, tenant, mailbox, 1), { rows: [], count: 1 });
  assert.deepEqual(parseVoicemailMessages([], 0, tenant, mailbox, 0), { rows: [], count: 0 });
  for (const page of [-1, 0.5, Number.MAX_SAFE_INTEGER])
    assert.throws(() => parseVoicemailMessages([], 0, tenant, mailbox, page));
});
test("email delivery, durations and saved timestamps require valid evidence fields", () => {
  for (const change of [
    { received_at: null },
    { received_at: "invalid" },
    { duration_seconds: -1 },
    { email_status: "delivered" },
    { email_status: "unknown", email_evidence_at: "invalid" },
    { recording_available: "true" },
  ])
    assert.throws(() =>
      parseVoicemailMessages([{ ...message(), ...change }], 1, tenant, mailbox, 0),
    );
  assert.equal(
    parseVoicemailMessages([{ ...message(), duration_seconds: null }], 1, tenant, mailbox, 0)
      .rows[0].duration_seconds,
    null,
  );
  assert.equal(
    parseVoicemailMessages(
      [{ ...message(), email_status: "sent", email_evidence_at: "2026-10-11T10:01:00Z" }],
      1,
      tenant,
      mailbox,
      0,
    ).rows[0].email_status,
    "sent",
  );
});
