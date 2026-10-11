import test from "node:test";
import assert from "node:assert/strict";
import {
  readVoicemailStatus,
  validVoicemailPage,
  voicemailScanState,
} from "./learn-voicemail-status.ts";
const id = "ce440000-aaaa-4000-8000-000000000001";
function fixture() {
  return {
    version: "learn-voicemail-status/1",
    tenant_id: id,
    observed_at: "2026-10-12T00:30:00Z",
    next_after: null,
    routes: [
      {
        route_id: id,
        enabled: true,
        extension: "601",
        status: {
          scope: "retained_email_candidates",
          coverage_complete: false,
          capture_allowed: true,
          generation: 1,
          pass_started_at: "2026-10-12T00:00:00Z",
          pass_completed_at: null,
          rows_examined: 100,
          next_scan_at: null,
          observed_at: "2026-10-12T00:30:00Z",
          candidates: 3,
          needs_review: 1,
          excluded: 1,
          jobs: { queued: 1 },
          review_reasons: { voicemail_mailbox_binding_unverified: 1 },
          dispatch: {
            last_attempt_at: "2026-10-12T00:29:00Z",
            last_success_at: "2026-10-12T00:29:00Z",
            next_attempt_at: null,
            code: null,
          },
        },
      },
    ],
  };
}
test("operator reads remain tenant/cursor bound and distinguish metadata review from imported jobs", async () => {
  const data = fixture();
  const result = await readVoicemailStatus(
    {
      rpc: async (name, args) => {
        assert.equal(name, "learn_operator_voicemail_status");
        assert.deepEqual(args, { p_tenant: id, p_after: null });
        return { data, error: null };
      },
    },
    id,
  );
  assert.equal(result.routes[0].status.needs_review, 1);
  assert.equal(result.routes[0].status.jobs.succeeded, undefined);
  assert.equal(voicemailScanState(result.routes[0]), "Scanning retained emails");
});
test("foreign, malformed, duplicate and non-advancing status pages fail closed", () => {
  const bad: any[] = [];
  let v: any = fixture();
  v.tenant_id = "other";
  bad.push(v);
  v = fixture();
  v.routes[0].status.coverage_complete = true;
  bad.push(v);
  v = fixture();
  v.routes[0].status.needs_review = 4;
  bad.push(v);
  v = fixture();
  v.routes[0].status.jobs = { succeeded: 10 };
  bad.push(v);
  v = fixture();
  v.routes[0].status.review_reasons = { private_text: 1 };
  bad.push(v);
  v = fixture();
  v.routes[0].status.dispatch.code = "private diagnostic";
  bad.push(v);
  v = fixture();
  v.routes.push(v.routes[0]);
  bad.push(v);
  v = fixture();
  v.next_after = id;
  bad.push(v);
  for (const f of bad) assert.equal(validVoicemailPage(f, id, null), false);
  assert.equal(validVoicemailPage(fixture(), id, id), false);
});
test("paused, unobserved, overdue and finished states never claim full provider capture", () => {
  const v: any = fixture(),
    r = v.routes[0];
  r.status.dispatch.last_success_at = null;
  assert.equal(voicemailScanState(r), "Awaiting first worker scan");
  r.status.capture_allowed = false;
  assert.equal(voicemailScanState(r), "Capture paused");
  r.status.capture_allowed = true;
  r.status.dispatch.code = "voicemail_route_unverified";
  assert.equal(voicemailScanState(r), "Scan needs attention");
  r.status.dispatch.code = null;
  r.status.dispatch.last_success_at = "2026-10-12T00:00:00Z";
  assert.match(voicemailScanState(r), /overdue/);
  r.status.dispatch.last_success_at = "2026-10-12T00:29:00Z";
  r.status.pass_completed_at = "2026-10-12T00:29:00Z";
  assert.equal(voicemailScanState(r), "Retained-email pass finished");
});
test("operator read failures return no raw database errors", async () => {
  await assert.rejects(
    readVoicemailStatus(
      { rpc: async () => ({ data: null, error: { message: "private customer content" } }) },
      id,
    ),
    (e) => e instanceof Error && !e.message.includes("private customer"),
  );
});
