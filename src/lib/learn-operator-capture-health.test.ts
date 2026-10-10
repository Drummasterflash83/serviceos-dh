import test from "node:test";
import assert from "node:assert/strict";
import {
  captureHealthSignal,
  readCaptureHealth,
  type CaptureHealthRow,
} from "./learn-operator-capture-health.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-10T12:00:00Z");
const row: CaptureHealthRow = {
  key: `email:${id(1)}`,
  id: id(1),
  source: "email",
  provider: "gmail",
  label: "Synthetic mailbox",
  enabled: null,
  account_state: "active",
  auth_state: "ok",
  last_success_at: "2026-10-10T11:59:00Z",
  last_attempt_at: "2026-10-10T11:59:00Z",
  last_failure_at: null,
  latest_job: null,
  bounded_complete: null,
};
test("recent capture requires evidence; newer failure, revoked access and future timestamps cannot look current", () => {
  assert.equal(captureHealthSignal(row, now).tone, "current");
  for (const change of [
    { last_success_at: null },
    { last_success_at: "2026-10-10T10:00:00Z" },
    { last_failure_at: "2026-10-10T11:59:30Z" },
    { auth_state: "revoked" },
    { last_success_at: "2026-10-10T13:00:00Z" },
    { provider: "other_email" },
  ])
    assert.equal(captureHealthSignal({ ...row, ...change }, now).tone, "attention");
  assert.equal(
    captureHealthSignal({ ...row, last_failure_at: "2026-10-10T11:00:00Z" }, now).tone,
    "current",
  );
  assert.equal(captureHealthSignal({ ...row, enabled: false }, now).label, "Capture paused");
});
test("completed Slack windows and waiting jobs never imply continuous capture", () => {
  const slack: CaptureHealthRow = {
    ...row,
    source: "slack",
    provider: "slack",
    enabled: true,
    bounded_complete: true,
    latest_job: {
      id: id(2),
      status: "succeeded",
      available_at: null,
      lease_expires_at: null,
      completed_at: row.last_success_at,
    },
  };
  const s = captureHealthSignal(slack, now);
  assert.equal(s.tone, "quiet");
  assert.match(s.action, /does not establish continuous/);
  assert.equal(
    captureHealthSignal(
      { ...slack, latest_job: { ...slack.latest_job!, status: "dead_letter" } },
      now,
    ).tone,
    "attention",
  );
  assert.match(
    captureHealthSignal(
      {
        ...slack,
        latest_job: {
          ...slack.latest_job!,
          status: "running",
          lease_expires_at: "2026-10-10T11:59:00Z",
        },
      },
      now,
    ).label,
    /recovery/,
  );
  assert.match(
    captureHealthSignal(
      {
        ...slack,
        latest_job: {
          ...slack.latest_job!,
          status: "queued",
          available_at: "2026-10-10T12:01:00Z",
        },
      },
      now,
    ).action,
    /scheduled for later/,
  );
});
test("reader rejects foreign tenants, mixed provider identities, duplicate rows and invented continuations", async () => {
  const page = {
    version: "learn-operator-capture-health/1",
    tenant_id: id(9),
    checked_at: "2026-10-10T12:00:00Z",
    rows: [row],
    next_cursor: null,
  };
  assert.equal(
    (
      await readCaptureHealth(
        {
          rpc: async (name, args) => {
            assert.equal(name, "learn_operator_capture_health");
            assert.deepEqual(args, { p_tenant: id(9), p_after: null });
            return { data: page, error: null };
          },
        },
        id(9),
      )
    ).rows.length,
    1,
  );
  for (const change of [
    { tenant_id: id(8) },
    { rows: [row, row] },
    { rows: [{ ...row, source: "phone" }] },
    { rows: [{ ...row, provider: "slack" }] },
    { rows: [{ ...row, last_success_at: "bad" }] },
    { next_cursor: row.key },
  ])
    await assert.rejects(
      readCaptureHealth(
        { rpc: async () => ({ data: { ...page, ...change }, error: null }) },
        id(9),
      ),
    );
  await assert.rejects(
    readCaptureHealth({ rpc: async () => ({ data: page, error: null }) }, id(9), row.key),
  );
  await assert.rejects(
    readCaptureHealth({ rpc: async () => ({ data: page, error: { code: "denied" } }) }, id(9)),
  );
});
