import test from "node:test";
import assert from "node:assert/strict";
import {
  captureHealthSignal,
  readCaptureHealth,
  readCaptureTotals,
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
test("separate company totals require tenant-bound, internally consistent evidence", async () => {
  const totals = {
    version: "learn-operator-capture-totals/1",
    tenant_id: id(9),
    checked_at: "2026-10-10T12:00:00Z",
    email_retention: {
      version: "learn-email-retention/1",
      tenant_id: id(9),
      scope: "company",
      total: 2,
      available: 1,
      unavailable: 0,
      unverified: 1,
      unbound: 1,
      archived_versions: 0,
    },
    phone_processing: {
      version: "learn-phone-processing-evidence/1",
      tenant_id: id(9),
      scope: "company",
      total: 2,
      complete: 1,
      download_pending: 0,
      transcribe_pending: 1,
      analyse_pending: 0,
      needs_review: 1,
      cooling_down: 0,
      recent_processing: 0,
      ready: 0,
      waiting_provider: 0,
      unknown_retry: 0,
    },
  };
  const client = (data: unknown, error: unknown = null) => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "learn_operator_capture_totals");
      assert.deepEqual(args, { p_tenant: id(9) });
      return { data, error };
    },
  });
  assert.equal((await readCaptureTotals(client(totals), id(9))).email_retention.total, 2);
  for (const invalid of [
    { ...totals, tenant_id: id(8) },
    { ...totals, email_retention: { ...totals.email_retention, available: 2 } },
    { ...totals, phone_processing: { ...totals.phone_processing, needs_review: 0 } },
    { ...totals, extra: "unbounded" },
  ])
    await assert.rejects(readCaptureTotals(client(invalid), id(9)));
  await assert.rejects(readCaptureTotals(client(totals, { code: "denied" }), id(9)));
});

test("Workspace diagnostic explains grant uncertainty without overriding newer, paused or future evidence", async () => {
  const failure = {
    attempt_id: id(70),
    occurred_at: "2026-10-10T11:59:30Z",
    code: "delegation_grant_invalid",
  };
  const workspace = {
    ...row,
    provider: "google_workspace",
    account_state: "active_dwd",
    auth_state: "unknown",
    last_failure_at: failure.occurred_at,
    email_failure: failure,
  };
  const signal = captureHealthSignal(workspace, now);
  assert.equal(signal.label, "Workspace access needs review");
  assert.match(signal.action, /code alone does not identify/);
  assert.equal(captureHealthSignal({ ...workspace, enabled: false }, now).label, "Capture paused");
  assert.equal(
    captureHealthSignal({ ...workspace, last_success_at: "2026-10-10T11:59:50Z" }, now).tone,
    "current",
  );
  assert.equal(
    captureHealthSignal({ ...workspace, last_failure_at: "2026-10-10T11:59:40Z" }, now).label,
    "Latest capture needs attention",
  );
  assert.equal(
    captureHealthSignal(
      { ...workspace, email_failure: { ...failure, occurred_at: "2026-10-10T12:01:00Z" } },
      now,
    ).label,
    "Status timestamps need review",
  );
  const page = {
    version: "learn-operator-capture-health/1",
    tenant_id: id(9),
    checked_at: new Date(now).toISOString(),
    rows: [workspace],
    next_cursor: null,
  };
  await readCaptureHealth({ rpc: async () => ({ data: page, error: null }) }, id(9));
  for (const change of [
    { code: "PRIVATE-token" },
    { attempt_id: "invalid" },
    { occurred_at: null },
    { raw_body: "PRIVATE-token" },
  ]) {
    await assert.rejects(
      readCaptureHealth(
        {
          rpc: async () => ({
            data: { ...page, rows: [{ ...workspace, email_failure: { ...failure, ...change } }] },
            error: null,
          }),
        },
        id(9),
      ),
    );
  }
});
