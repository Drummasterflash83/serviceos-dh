import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTO_REVIEW_LIMIT,
  liveCallOwned,
  queuedCallOwned,
  reviewPage,
  reviewCallType,
  safeAutoReviewError,
  feedbackEvidence,
} from "./receptionist-auto-review.ts";
const tenant = "00000000-0000-0000-0000-000000000001";
const callId = "00000000-0000-0000-0000-000000000002";
const session = "00000000-0000-0000-0000-000000000003";
const assistant = "00000000-0000-0000-0000-000000000004";
test("live ownership rejects other assistants, web calls and missing IDs", () => {
  const call = { id: callId, assistantId: assistant, type: "inboundPhoneCall" };
  assert.equal(liveCallOwned(call, assistant), true);
  assert.equal(liveCallOwned({ ...call, type: "outboundPhoneCall" }, assistant), true);
  assert.equal(liveCallOwned(call, "another"), false);
  assert.equal(liveCallOwned({ ...call, type: "webCall" }, assistant), false);
  assert.equal(liveCallOwned({ ...call, id: null }, assistant), false);
});
test("practice uses matching server session and tenant, never assistant name", () => {
  const row = {
    call_id: callId,
    call_kind: "practice",
    tenant_id: tenant,
    practice_session_id: session,
  };
  const call = {
    id: callId,
    type: "webCall",
    assistant: { metadata: { openfolkPracticeSession: session, openfolkTenant: tenant } },
  };
  assert.equal(queuedCallOwned(call, row, assistant), true);
  assert.equal(queuedCallOwned(call, { ...row, tenant_id: "another" }, assistant), false);
  assert.equal(queuedCallOwned(call, { ...row, call_id: session }, assistant), false);
  assert.equal(queuedCallOwned(call, { ...row, practice_session_id: null }, assistant), false);
});
test("scan rejects malformed, future and unordered provider pages", () => {
  const before = "2026-10-02T07:00:00.000Z";
  assert.throws(() => reviewPage({ items: [] }, before));
  assert.throws(() => reviewPage([{ id: callId, createdAt: before }], before));
  assert.throws(() =>
    reviewPage(
      [
        { id: callId, createdAt: "2026-10-02T05:00:00Z" },
        { id: session, createdAt: "2026-10-02T06:00:00Z" },
      ],
      before,
    ),
  );
  assert.equal(reviewPage([], before).exhausted, true);
});
test("full provider pages remain incomplete and overlap the boundary timestamp", () => {
  const before = "2026-10-02T07:00:00.000Z";
  const rows = Array.from({ length: 100 }, (_, i) => ({
    id: callId,
    createdAt: new Date(Date.parse(before) - 1000 * (i + 1)).toISOString(),
  }));
  const page = reviewPage(rows, before);
  assert.equal(page.exhausted, false);
  assert.equal(Date.parse(page.nextBefore!), Date.parse(rows[99].createdAt) + 1);
  assert.throws(
    () =>
      reviewPage(
        Array.from({ length: 100 }, () => ({ id: callId, createdAt: "2026-10-02T06:59:59.999Z" })),
        before,
      ),
    /ambiguous/,
  );
});
test("claims never imply audio/handover proof; provider messages remain private", () => {
  assert.match(reviewCallType("practice"), /simulated/);
  assert.match(reviewCallType("live"), /cannot prove/);
  assert.equal(
    safeAutoReviewError(Error("sensitive provider body")),
    "automatic_review_incomplete",
  );
  assert.equal(AUTO_REVIEW_LIMIT, 2);
});
test("feedback evidence includes meaning-changing fields and rejects missing content", () => {
  const note = { title: "Closed twice", body: "Please remove the repetition", priority: "normal", category: "improvement" };
  assert.match(feedbackEvidence(note), /Closed twice\nPlease remove the repetition/);
  assert.notEqual(feedbackEvidence(note), feedbackEvidence({ ...note, priority: "urgent" }));
  assert.notEqual(feedbackEvidence(note), feedbackEvidence({ ...note, category: "routing" }));
  assert.equal(feedbackEvidence(note), feedbackEvidence({ ...note, status: "Reviewing", response: "Working on it" }));
  assert.throws(() => feedbackEvidence({ title: "Missing" }), /feedback_snapshot_invalid/);
  assert.throws(() => feedbackEvidence({ body: "  " }), /feedback_snapshot_invalid/);
});
test("database reservations are service-only, idempotent and cost bounded", () => {
  const sql = readFileSync(
    new URL("../../migrations/20261028143000_emma_automatic_call_reviews.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /unique\(tenant_id,call_id,reviewer_version\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /created_at>now\(\)-interval '24 hours'\)>=100/);
  assert.match(sql, /unique\(queue_id,lease_id\)/);
  assert.match(sql, /for update of q skip locked/);
  assert.match(sql, /revoke all on function[\s\S]*from public,anon,authenticated/);
  assert.doesNotMatch(sql, /cron.schedule|enabled\s*=\s*true/);
});
test("scheduled collector cannot apply fixes or review foreign calls", () => {
  const source = readFileSync(
    new URL("../receptionist-review-collector/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /timingSafeEqualStr\(secret, req.headers.get\("x-schedule-secret"\)/);
  assert.match(source, /queuedCallOwned\(rawCall, q, workspace.data.assistant_id\)/);
  assert.match(source, /care_auto_review_reserve_evidence/);
  assert.match(source, /care_auto_store_review/);
  assert.match(source, /audioAssessed: false/);
  assert.match(source, /verifySlackChannel/);
  assert.doesNotMatch(source, /method:\s*["'](?:PATCH|PUT|DELETE)["']/);
  assert.doesNotMatch(source, /OPENAI_API_KEY/);
});

test("feedback changes produce immutable, scoped revisions, not status-update loops", () => {
  const sql = readFileSync(
    new URL("../../migrations/20261028170000_emma_feedback_revision_reviews.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /new\.body is not distinct from old\.body/);
  assert.match(sql, /new\.priority is not distinct from old\.priority/);
  assert.match(sql, /extensions\.digest/);
  assert.match(sql, /on conflict\(tenant_id,call_id,reviewer_version\) do nothing/);
  assert.match(sql, /id=f\.practice_session_id and tenant_id=f\.tenant_id/);
  assert.match(sql, /care_auto_practice_linked/);
  assert.match(sql, /count\(distinct call_id\)/);
});
test("revision storage is atomic, lease-bound, actor-honest and deduplicates issue alerts", () => {
  const sql = readFileSync(
    new URL("../../migrations/20261028170000_emma_feedback_revision_reviews.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /q\.lease_id is distinct from p_lease/);
  assert.match(sql, /perform public\.care_store_review\(q\.tenant_id,q\.call_id/);
  assert.match(sql, /not\(id=any\(old_ids\)\)/);
  assert.match(sql, /'alertCategories',categories/);
  assert.match(sql, /current_hash=q\.feedback_revision_hash/);
  assert.match(sql, /values\(q\.tenant_id,issue,null,'completed'/);
  assert.match(sql, /automation_queue_id is not null/);
  assert.match(sql, /where tenant_id=q\.tenant_id and call_id=q\.call_id and evidence_hash=p_hash/);
  assert.match(sql, /if not public\.care_auto_review_reserve_ai\(p_id,p_lease\)/);
  assert.match(sql, /from public,anon,authenticated/);
  assert.match(sql, /automation_queue_id is null and created_at>now\(\)-interval '1 day'\)>=30/);
});
