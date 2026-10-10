import test from "node:test";
import assert from "node:assert/strict";
import {
  validPhoneAccountEvidence,
  validPhoneProcessingEvidence,
  phoneCaptureSignal,
  phoneProcessingSignal,
  type PhoneAccountEvidence,
  type PhoneProcessingEvidence,
} from "./learn-phone-operator-evidence.ts";
import {
  readCaptureHealth,
  captureHealthSignal,
  type CaptureHealthRow,
} from "./learn-operator-capture-health.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1),
  account = id(2),
  now = Date.parse("2026-10-10T12:00:00Z");
const evidence: PhoneAccountEvidence = {
  version: "learn-phone-account-evidence/1",
  tenant_id: tenant,
  account_id: account,
  scope: "scheduled_capture",
  capture_allowed: true,
  latest_attempt: {
    id: id(3),
    status: "success",
    started_at: "2026-10-10T11:58:00Z",
    completed_at: "2026-10-10T11:59:30Z",
    confirmed: true,
    job: { id: id(4), status: "succeeded", lease_expires_at: null, ownership_current: false },
  },
  last_confirmed: {
    id: id(3),
    completed_at: "2026-10-10T11:59:30Z",
    from: "2026-10-10T11:30:00Z",
    to: "2026-10-10T11:59:00Z",
    calls_processed: 20,
    recordings_processed: 10,
  },
};
const phone: CaptureHealthRow = {
  key: `phone:${account}`,
  id: account,
  source: "phone",
  provider: "simwood",
  label: "Synthetic phone",
  enabled: true,
  account_state: "active",
  auth_state: "unknown",
  last_success_at: "2026-10-10T11:59:00Z",
  last_attempt_at: null,
  last_failure_at: null,
  latest_job: null,
  bounded_complete: null,
  phone_evidence: evidence,
};
const processing: PhoneProcessingEvidence = {
  version: "learn-phone-processing-evidence/1",
  tenant_id: tenant,
  scope: "company",
  total: 10,
  complete: 4,
  download_pending: 2,
  transcribe_pending: 3,
  analyse_pending: 1,
  needs_review: 1,
  cooling_down: 1,
  recent_processing: 1,
  ready: 2,
  waiting_provider: 1,
  unknown_retry: 0,
};
const page = {
  version: "learn-operator-capture-health/1",
  tenant_id: tenant,
  checked_at: "2026-10-10T12:00:00Z",
  rows: [phone],
  next_cursor: null,
  phone_processing: processing,
};
test("account timestamps alone cannot make scheduled Phone capture appear confirmed", () => {
  assert.equal(captureHealthSignal({ ...phone, phone_evidence: undefined }, now).tone, "attention");
  assert.equal(captureHealthSignal(phone, now).label, "Recent Phone window confirmed");
  assert.match(captureHealthSignal(phone, now).action, /Schedule configuration/);
  assert.equal(
    phoneCaptureSignal({ ...evidence, capture_allowed: false }, null, now).label,
    "Phone capture paused",
  );
  assert.equal(
    phoneCaptureSignal(
      {
        ...evidence,
        last_confirmed: {
          ...evidence.last_confirmed!,
          from: "2026-10-10T08:00:00Z",
          to: "2026-10-10T09:00:00Z",
        },
      },
      null,
      now,
    ).tone,
    "attention",
  );
  assert.equal(phoneCaptureSignal(evidence, "2026-10-10T11:59:45Z", now).tone, "attention");
  assert.equal(
    phoneCaptureSignal(
      { ...evidence, last_confirmed: { ...evidence.last_confirmed!, to: "2026-10-10T12:01:00Z" } },
      null,
      now,
    ).label,
    "Phone timestamps need review",
  );
});
test("running imports require a current owned lease; unknown completion cannot look healthy", () => {
  const running: PhoneAccountEvidence = {
    ...evidence,
    last_confirmed: null,
    latest_attempt: {
      ...evidence.latest_attempt!,
      status: "running",
      completed_at: null,
      confirmed: false,
      job: {
        ...evidence.latest_attempt!.job!,
        status: "running",
        ownership_current: true,
        lease_expires_at: "2026-10-10T12:01:00Z",
      },
    },
  };
  assert.equal(phoneCaptureSignal(running, null, now).label, "Phone import running");
  assert.equal(
    phoneCaptureSignal(running, null, now + 61000).label,
    "Phone import needs reconciliation",
  );
  assert.equal(
    phoneCaptureSignal(
      {
        ...running,
        latest_attempt: {
          ...running.latest_attempt!,
          job: { ...running.latest_attempt!.job!, ownership_current: false },
        },
      },
      null,
      now,
    ).tone,
    "attention",
  );
  assert.equal(
    phoneCaptureSignal(
      { ...evidence, latest_attempt: { ...evidence.latest_attempt!, confirmed: false } },
      null,
      now,
    ).tone,
    "attention",
  );
  assert.equal(
    phoneCaptureSignal(
      { ...evidence, latest_attempt: { ...evidence.latest_attempt!, status: "failed" } },
      null,
      now,
    ).label,
    "Latest Phone import needs attention",
  );
  assert.equal(
    phoneCaptureSignal(
      { ...evidence, latest_attempt: { ...evidence.latest_attempt!, status: "paused" } },
      null,
      now,
    ).label,
    "Latest Phone import paused",
  );
});
test("reader accepts verified scoped evidence and rejects contradictory identities, receipts and counts", async () => {
  assert.equal(validPhoneAccountEvidence(evidence, tenant, account), true);
  assert.equal(validPhoneProcessingEvidence(processing, tenant), true);
  assert.equal(
    (await readCaptureHealth({ rpc: async () => ({ data: page, error: null }) }, tenant))
      .phone_processing?.total,
    10,
  );
  for (const value of [
    { ...evidence, tenant_id: id(99) },
    { ...evidence, account_id: id(99) },
    { ...evidence, scope: "company" },
    { ...evidence, last_confirmed: null },
    { ...evidence, last_confirmed: { ...evidence.last_confirmed, id: id(99) } },
    { ...evidence, latest_attempt: { ...evidence.latest_attempt, job: null } },
    {
      ...evidence,
      latest_attempt: {
        ...evidence.latest_attempt,
        job: { ...evidence.latest_attempt!.job, status: "running" },
      },
    },
    { ...evidence, last_confirmed: { ...evidence.last_confirmed, calls_processed: -1 } },
    {
      ...evidence,
      last_confirmed: { ...evidence.last_confirmed, from: evidence.last_confirmed!.to },
    },
  ]) {
    assert.equal(validPhoneAccountEvidence(value, tenant, account), false);
    await assert.rejects(
      readCaptureHealth(
        {
          rpc: async () => ({
            data: { ...page, rows: [{ ...phone, phone_evidence: value }] },
            error: null,
          }),
        },
        tenant,
      ),
    );
  }
  for (const value of [
    { ...processing, tenant_id: id(99) },
    { ...processing, scope: "account" },
    { ...processing, total: 11 },
    { ...processing, needs_review: 0 },
    { ...processing, ready: -1 },
    { ...processing, ready: 1.5 },
    { ...processing, total: null },
  ]) {
    assert.equal(validPhoneProcessingEvidence(value, tenant), false);
    await assert.rejects(
      readCaptureHealth(
        { rpc: async () => ({ data: { ...page, phone_processing: value }, error: null }) },
        tenant,
      ),
    );
  }
});
test("processing copy distinguishes held work, pending work and retained completion from provider coverage", () => {
  assert.match(phoneProcessingSignal(processing).label, /need review/);
  assert.match(
    phoneProcessingSignal({ ...processing, needs_review: 0, ready: 3 }).label,
    /incomplete/,
  );
  assert.match(phoneProcessingSignal({ ...processing, total: 0 }).label, /No retained/);
  const complete = {
    ...processing,
    total: 4,
    complete: 4,
    download_pending: 0,
    transcribe_pending: 0,
    analyse_pending: 0,
    needs_review: 0,
    cooling_down: 0,
    recent_processing: 0,
    ready: 0,
    waiting_provider: 0,
  };
  assert.equal(validPhoneProcessingEvidence(complete, tenant), true);
  assert.match(phoneProcessingSignal(complete).action, /stored recordings only/);
  assert.match(phoneProcessingSignal(complete).action, /conversion into LEARN cards/);
});
