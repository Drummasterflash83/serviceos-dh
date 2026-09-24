import test from "node:test";
import assert from "node:assert/strict";
import { recordingLink } from "../../supabase/functions/_shared/receptionist-recording.ts";
const id = "00000000-0000-4000-8000-000000000001";
test("recording retrieval checks assistant before requesting a fresh signed link", async () => {
  const calls: string[] = [];
  const request = (async (url: string, opts: RequestInit) => {
    calls.push(url);
    assert.equal(opts.redirect, "manual");
    assert.equal((opts.headers as Record<string, string>).Authorization, "Bearer server-only");
    return calls.length === 1
      ? new Response(JSON.stringify({ assistantId: "approved" }))
      : new Response(null, {
          status: 302,
          headers: { location: "https://storage.example/short-lived" },
        });
  }) as typeof fetch;
  assert.equal(
    await recordingLink(id, "approved", "server-only", request),
    "https://storage.example/short-lived",
  );
  assert.deepEqual(calls, [
    `https://api.vapi.ai/call/${id}`,
    `https://api.vapi.ai/call/${id}/mono-recording`,
  ]);
});
test("foreign assistant never reaches recording endpoint", async () => {
  let count = 0;
  const request = (async () => {
    count++;
    return new Response(JSON.stringify({ assistantId: "other" }));
  }) as typeof fetch;
  await assert.rejects(recordingLink(id, "approved", "secret", request));
  assert.equal(count, 1);
});
test("caller cannot supply a URL or path as call ID", async () => {
  let count = 0;
  const request = (async () => {
    count++;
    throw Error("network");
  }) as typeof fetch;
  for (const value of ["https://example.com", "../other", null, ""])
    await assert.rejects(recordingLink(value, "a", "secret", request));
  assert.equal(count, 0);
});
test("invalid and authenticated redirect targets are refused", async () => {
  for (const location of [
    "http://storage.example/a",
    "https://u:p@storage.example/a",
    "https://api.vapi.ai/call/a/mono-recording",
    "javascript:alert(1)",
  ]) {
    let count = 0;
    const request = (async () =>
      ++count === 1
        ? new Response(JSON.stringify({ assistantId: "a" }))
        : new Response(null, { status: 302, headers: { location } })) as typeof fetch;
    await assert.rejects(recordingLink(id, "a", "secret", request));
  }
});
test("missing recording refuses rather than returning an unusable audio URL", async () => {
  let count = 0;
  const request = (async () =>
    ++count === 1
      ? new Response(JSON.stringify({ assistantId: "a" }))
      : new Response(null, { status: 404 })) as typeof fetch;
  await assert.rejects(recordingLink(id, "a", "secret", request));
});
