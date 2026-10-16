import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CommusoftWebhookBoundaryError,
  verifyCommusoftJobWebhook,
} from "./webhook_boundary.ts";

const binding = {
  signingSecret: "synthetic-whsec-secret-with-no-production-access-12345",
  applicationId: "app_12345",
  clientId: "16198",
  apiOrigin: "https://app.commusoft.co.uk/api/v2" as const,
};
const nowMs = 1792120000000;
const sent = String(nowMs / 1000);
const payload = {
  timestamp: "2026-10-16T05:00:00Z", applicationID: binding.applicationId,
  clientID: binding.clientId, eventID: "event_12345", version: "2",
  object: "jobs", eventType: "job.updated", id: 101,
  links: { self: "https://app.commusoft.co.uk/api/v2/jobs/101" },
  privateBody: "must never appear in a hint",
};

async function signed(body: unknown, timestamp = sent) {
  const raw = new TextEncoder().encode(JSON.stringify(body));
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signing = new Uint8Array(prefix.length + raw.length);
  signing.set(prefix);
  signing.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw",
    new TextEncoder().encode(binding.signingSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, signing));
  return { raw, headers: new Headers({
    "x-commusoft-signature": `t=${timestamp},v1=${[...mac].map((n) =>
      n.toString(16).padStart(2, "0")).join("")}`,
  }) };
}

async function rejected(body: unknown, code: CommusoftWebhookBoundaryError["code"]) {
  const { raw, headers } = await signed(body);
  await assert.rejects(verifyCommusoftJobWebhook(raw, headers, binding, nowMs),
    (caught: unknown) => caught instanceof CommusoftWebhookBoundaryError &&
      caught.code === code);
}

test("signed, exact-bound job event yields only a source hint", async () => {
  const { raw, headers } = await signed(payload);
  const hint = await verifyCommusoftJobWebhook(raw, headers, binding, nowMs);
  assert.deepEqual(hint, { kind: "job_hint", eventId: "event_12345",
    action: "updated", jobId: "101", sourceTimestamp: payload.timestamp });
  assert.equal(JSON.stringify(hint).includes(payload.privateBody), false);
  const created = await signed({ ...payload, eventType: "job.created" });
  assert.equal((await verifyCommusoftJobWebhook(created.raw, created.headers,
    binding, nowMs)).action, "created");
});

test("raw HMAC and delivery time fail closed", async () => {
  const { headers } = await signed(payload);
  const tampered = new TextEncoder().encode(JSON.stringify({ ...payload, id: 102 }));
  await assert.rejects(verifyCommusoftJobWebhook(tampered, headers, binding, nowMs),
    (caught: unknown) => caught instanceof CommusoftWebhookBoundaryError &&
      caught.code === "invalid_signature");
  const stale = await signed(payload, String(Number(sent) - 301));
  await assert.rejects(verifyCommusoftJobWebhook(stale.raw, stale.headers,
    binding, nowMs), (caught: unknown) =>
      caught instanceof CommusoftWebhookBoundaryError &&
      caught.code === "invalid_signature");
});

test("other tenants, external URLs, deletes and malformed ids are excluded", async () => {
  await rejected({ ...payload, clientID: "other" }, "invalid_payload");
  await rejected({ ...payload, applicationID: "other" }, "invalid_payload");
  await rejected({ ...payload, object: "properties" }, "out_of_scope");
  await rejected({ ...payload, eventType: "job.deleted" }, "out_of_scope");
  await rejected({ ...payload, id: -1 }, "out_of_scope");
  await rejected({ ...payload, links: { self: "https://example.com/jobs/101" } },
    "out_of_scope");
  await rejected({ ...payload, links: { self:
    "https://app.commusoft.co.uk/api/v2/jobs/101?other=true" } }, "out_of_scope");
});
