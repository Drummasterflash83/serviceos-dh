import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bindingFromCurrentRoster,
  recordScopedSlackHint,
  type SlackEventConfig,
} from "./slack_event_adapter.ts";

const digest = async (value: string) => {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
};
async function config(): Promise<SlackEventConfig> {
  return { tenantId: "00000000-0000-0000-0000-000000000001",
    teamId: "T12345", appId: "A12345",
    signingSecret: "synthetic-signing-secret-long-enough-123456789",
    minTs: "1791883800.000000", expectedChannels: 2,
    rosterSha256: await digest("C12345\nC67890") };
}
const roster = [
  { team_id: "T12345", channel_id: "C67890", next_start: "2026-10-13T09:30:00.000Z" },
  { team_id: "T12345", channel_id: "C12345", next_start: "2026-10-13T09:30:00.000Z" },
];

test("current exact roster builds a signed boundary without source content", async () => {
  const binding = await bindingFromCurrentRoster(await config(), async () => roster);
  assert.ok(binding);
  assert.deepEqual([...binding.allowedChannels].sort(), ["C12345", "C67890"]);
  assert.equal(binding.teamId, "T12345");
});

test("roster drift, scope expansion and stale approval fail closed", async () => {
  const c = await config();
  assert.equal(await bindingFromCurrentRoster(c, async () => roster.slice(0, 1)), null);
  assert.equal(await bindingFromCurrentRoster(c, async () =>
    [roster[0], { ...roster[1], team_id: "TOTHER" }]), null);
  assert.equal(await bindingFromCurrentRoster(c, async () =>
    [roster[0], { ...roster[1], channel_id: "COTHER" }]), null);
  assert.equal(await bindingFromCurrentRoster(c, async () =>
    [roster[0], { ...roster[1], channel_id: "C67890" }]), null);
  assert.equal(await bindingFromCurrentRoster(c, async () =>
    [roster[0], { ...roster[1], next_start: "2026-10-13T09:29:59.000Z" }]), null);
  assert.equal(await bindingFromCurrentRoster({ ...c, signingSecret: "short" },
    async () => roster), null);
});

test("bounded hint is mapped to the durable recorder and checked by exact receipt", async () => {
  const c = await config();
  const hint = { kind: "message_hint" as const, eventId: "EvABC123456",
    channelId: "C12345", ts: "1792105200.123456", threadTs: null };
  let seen: Record<string, unknown> | null = null;
  const outcome = await recordScopedSlackHint(c, hint, async (args) => {
    seen = args;
    return { version: "learn-slack-event-hint/1", eventId: hint.eventId, state: "recorded" };
  });
  assert.equal(outcome, "recorded");
  assert.deepEqual(seen, { p_tenant: c.tenantId, p_team: c.teamId,
    p_event_id: "EvABC123456", p_channel: "C12345", p_kind: "message_hint",
    p_event_ts: hint.ts, p_source_ts: hint.ts, p_thread_ts: null, p_correction: null });
  await assert.rejects(recordScopedSlackHint(c, hint, async () =>
    ({ version: "learn-slack-event-hint/1", eventId: "EvOTHER", state: "recorded" })),
  /receipt_unconfirmed/);
});

test("correction keeps original time and visibility requirement with no message body", async () => {
  const hint = { kind: "correction_hint" as const, eventId: "EvABC123456",
    channelId: "C12345", eventTs: "1792105200.123456",
    sourceTs: "1792090000.000001", threadTs: null,
    correction: "changed" as const, requiresVisibilityCheck: true as const };
  let seen: Record<string, unknown> | null = null;
  const result = await recordScopedSlackHint(await config(), hint, async (args) => {
    seen = args;
    return { version: "learn-slack-event-hint/1", eventId: hint.eventId, state: "duplicate" };
  });
  assert.equal(result, "duplicate");
  assert.equal(seen?.p_source_ts, hint.sourceTs);
  assert.equal(seen?.p_correction, "changed");
  assert.equal(JSON.stringify(seen).includes("text"), false);
});
