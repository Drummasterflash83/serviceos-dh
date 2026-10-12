import test from "node:test";
import assert from "node:assert/strict";
import { voicemailPlaybackHandler } from "./playback-http.ts";
const tenant = "11111111-1111-4111-8111-111111111111",
  mailbox = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333",
  actor = "44444444-4444-4444-8444-444444444444";
const path = `${tenant}/${mailbox}/${id}`,
  origin = "https://synthetic.supabase.co",
  signed = `${origin}/storage/v1/object/sign/receptionist-voicemails/${path}?token=synthetic-only`;
function fixture(options: any = {}) {
  const calls: any[] = [];
  const handler = voicemailPlaybackHandler({
    storageOrigin: origin,
    user: (authorization) => {
      calls.push(["user", authorization]);
      const query: any = {
        select: (v: string) => {
          calls.push(["select", v]);
          return query;
        },
        eq: (k: string, v: string) => {
          calls.push(["eq", k, v]);
          return query;
        },
        maybeSingle: async () => ({
          data: options.absent
            ? null
            : {
                id,
                tenant_id: tenant,
                mailbox_id: mailbox,
                recording_path: path,
                ...options.message,
              },
          error: options.readError ?? null,
        }),
      };
      return {
        auth: {
          getUser: async () => {
            calls.push(["auth"]);
            return { data: { user: { id: actor } }, error: options.authError ?? null };
          },
        },
        from: (table) => {
          calls.push(["read", table]);
          return query;
        },
      };
    },
    admin: () => {
      calls.push(["admin"]);
      return {
        from: (table) => ({
          insert: async (row: any) => {
            calls.push(["audit", table, row]);
            return { error: options.auditError ?? null };
          },
        }),
        storage: {
          from: (bucket) => ({
            createSignedUrl: async (p: string, seconds: number) => {
              calls.push(["sign", bucket, p, seconds]);
              if (options.throwSign) throw Error("private downstream error");
              return {
                data: { signedUrl: options.url ?? signed },
                error: options.signError ?? null,
              };
            },
          }),
        },
      };
    },
  });
  return { handler, calls };
}
const request = (
  body: any = { tenantId: tenant, messageId: id },
  headers: Record<string, string> = { Authorization: "Bearer synthetic-session" },
) =>
  new Request("https://local.invalid/playback", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
test("authorized user RLS read precedes audit and sixty-second signing", async () => {
  const { handler, calls } = fixture();
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), { url: signed, expiresIn: 60 });
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["user", "auth", "read", "select", "eq", "eq", "admin", "audit", "sign"],
  );
  assert.deepEqual(
    calls.filter((c) => c[0] === "eq"),
    [
      ["eq", "tenant_id", tenant],
      ["eq", "id", id],
    ],
  );
  assert.deepEqual(calls.at(-1), ["sign", "receptionist-voicemails", path, 60]);
  assert.deepEqual(calls.at(-2), [
    "audit",
    "receptionist_voicemail_access_log",
    { tenant_id: tenant, message_id: id, actor_id: actor, action: "playback_link_requested" },
  ]);
});
test("missing or invalid session never reaches a private read or privileged client", async () => {
  const missing = fixture();
  assert.equal((await missing.handler(request({}, {}))).status, 401);
  assert.equal(missing.calls.length, 0);
  const bad = fixture({ authError: { message: "private details" } });
  assert.equal((await bad.handler(request())).status, 401);
  assert.deepEqual(
    bad.calls.map((c) => c[0]),
    ["user", "auth"],
  );
});
test("malformed, oversized, path-bearing and URL-bearing bodies cannot select messages", async () => {
  for (const body of [
    "{",
    "x".repeat(4097),
    {},
    [],
    { tenantId: tenant, messageId: id, path },
    { tenantId: tenant, messageId: id, url: signed },
    { tenantId: "wrong", messageId: id },
  ]) {
    const f = fixture();
    assert.equal((await f.handler(request(body))).status, 400);
    assert.ok(!f.calls.some((c) => c[0] === "read" || c[0] === "admin"));
  }
});
test("streamed body size is enforced even without content-length", async () => {
  const f = fixture();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(3000));
      c.enqueue(new Uint8Array(2000));
      c.close();
    },
  });
  const req = new Request("https://local.invalid", {
    method: "POST",
    headers: { Authorization: "Bearer synthetic" },
    body: stream,
    duplex: "half",
  } as any);
  assert.equal((await f.handler(req)).status, 400);
  assert.ok(!f.calls.some((c) => c[0] === "read"));
});
test("absent, foreign, failed and inconsistent message reads never reach admin", async () => {
  for (const options of [
    { absent: true },
    { readError: {} },
    { message: { tenant_id: mailbox } },
    { message: { id: mailbox } },
    { message: { mailbox_id: "bad" } },
    { message: { recording_path: "elsewhere" } },
    { message: { recording_path: null } },
  ]) {
    const f = fixture(options);
    assert.equal((await f.handler(request())).status, 404);
    assert.ok(!f.calls.some((c) => c[0] === "admin"));
  }
});
test("failed audit never signs; storage failures return no link or private error", async () => {
  const audit = fixture({ auditError: {} });
  assert.equal((await audit.handler(request())).status, 503);
  assert.ok(!audit.calls.some((c) => c[0] === "sign"));
  for (const options of [{ signError: {} }, { throwSign: true }]) {
    const f = fixture(options);
    const r = await f.handler(request());
    assert.ok([404, 503].includes(r.status));
    const b = await r.text();
    assert.ok(!b.includes("private downstream") && !b.includes("token="));
  }
});
test("signed output must refer to this exact private object and trusted storage origin", async () => {
  for (const url of [
    signed.replace("synthetic.supabase.co", "elsewhere.invalid"),
    signed.replace(id, actor),
    signed.replace("https:", "http:"),
    signed + "#fragment",
    signed.split("?")[0],
  ]) {
    const f = fixture({ url });
    assert.equal((await f.handler(request())).status, 404);
  }
});
test("CORS and wrong methods perform no authentication or storage work", async () => {
  const f = fixture();
  assert.equal(
    (await f.handler(new Request("https://local.invalid", { method: "OPTIONS" }))).status,
    200,
  );
  assert.equal((await f.handler(new Request("https://local.invalid"))).status, 405);
  assert.equal(f.calls.length, 0);
});
