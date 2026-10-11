import { test } from "node:test";
import assert from "node:assert/strict";
import { retainedPhonePlayback } from "../../supabase/functions/_shared/learn-phone-playback.ts";
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const scope = { tenant: id(1), actor: id(2), recording: id(3), backend: "https://test.example" };
const now = () => Date.parse("2026-10-11T12:00:00Z");
function fixture(change = {}) {
  const calls = [];
  const target = {
    version: "learn-phone-playback-target/1",
    tenant_id: id(1),
    recording_id: id(3),
    request_id: null,
    storage_path: id(1) + "/call one.wav",
    source_digest: "a".repeat(64),
    ...change.target,
  };
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return args.p_request
        ? {
            data: { ...target, request_id: args.p_request, ...change.audited },
            error: change.auditError ?? null,
          }
        : { data: target, error: change.inspectError ?? null };
    },
    storage: {
      getBucket: async (name) => {
        calls.push({ bucket: name });
        return { data: { id: name, public: false, ...change.bucket }, error: null };
      },
      from: (name) => ({
        createSignedUrl: async (path, seconds) => {
          calls.push({ sign: name, path, seconds });
          return {
            data: {
              signedUrl:
                change.url ??
                scope.backend +
                  "/storage/v1/object/sign/phone-recordings/" +
                  path.split("/").map(encodeURIComponent).join("/") +
                  "?token=synthetic",
            },
            error: change.signError ?? null,
          };
        },
      }),
    },
  };
  return { db, calls };
}
test("signs only private retained audio and releases URL only after audit recheck", async () => {
  const f = fixture(),
    r = await retainedPhonePlayback(f.db, scope, now);
  assert.equal(r.expires_at, "2026-10-11T12:00:55.000Z");
  assert.equal(r.tenant_id, id(1));
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[2].seconds, 60);
  assert.equal(f.calls[3].args.p_source_digest, "a".repeat(64));
  assert.equal(f.calls[3].args.p_request, r.request_id);
});
test("invalid actor, foreign pointer, traversal, control characters and failed initial authority never sign", async () => {
  for (const change of [
    { inspectError: {} },
    { target: { tenant_id: id(9) } },
    { target: { storage_path: id(9) + "/a.wav" } },
    { target: { storage_path: id(1) + "/../a.wav" } },
    { target: { storage_path: id(1) + "//a.wav" } },
    { target: { storage_path: id(1) + "/a\n.wav" } },
    { bucket: { public: true } },
  ]) {
    const f = fixture(change);
    await assert.rejects(() => retainedPhonePlayback(f.db, scope, now));
    assert.ok(!f.calls.some((c) => c.sign));
  }
  const f = fixture();
  await assert.rejects(() => retainedPhonePlayback(f.db, { ...scope, actor: "service" }, now));
  assert.equal(f.calls.length, 0);
});
test("foreign signer, wrong path and extra query parameters never release a link or audit it", async () => {
  for (const url of [
    "https://other.example/a?token=x",
    scope.backend + "/storage/v1/object/sign/phone-recordings/" + id(9) + "/a?token=x",
    scope.backend +
      "/storage/v1/object/sign/phone-recordings/" +
      id(1) +
      "/call%20one.wav?token=x&redirect=bad",
  ]) {
    const f = fixture({ url });
    await assert.rejects(() => retainedPhonePlayback(f.db, scope, now));
    assert.equal(f.calls.filter((c) => c.name).length, 1);
  }
});
test("revocation, changed pointer, failed audit and expired recheck withhold signed URLs", async () => {
  for (const change of [
    { auditError: {} },
    { audited: { source_digest: "b".repeat(64) } },
    { audited: { storage_path: id(1) + "/changed.wav" } },
    { audited: { tenant_id: id(9) } },
    { audited: { version: "unexpected" } },
  ]) {
    const f = fixture(change);
    await assert.rejects(() => retainedPhonePlayback(f.db, scope, now));
    assert.ok(f.calls.some((c) => c.sign));
  }
  let tick = 0;
  const f = fixture();
  await assert.rejects(() =>
    retainedPhonePlayback(f.db, scope, () => now() + (tick++ ? 16000 : 0)),
  );
});
