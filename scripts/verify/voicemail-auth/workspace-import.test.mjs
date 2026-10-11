import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { importPrivateVoicemail } from "./private-import.mjs";
import { importWorkspaceVoicemail } from "../../../supabase/functions/_shared/voicemail/workspace-import.ts";
import { createVoicemailImportHttpHandler } from "../../../supabase/functions/_shared/voicemail/import-http.ts";
import { providerKeyResolver } from "../../../supabase/functions/_shared/voicemail/provider-keys.js";
import { readBoundedJson } from "../../../supabase/functions/_shared/voicemail/bounded-json.ts";
import { GmailCaptureError } from "../../../supabase/functions/_shared/gmail_capture_page.ts";
const fixture = JSON.parse(
  execFileSync(process.execPath, [fileURLToPath(new URL("./edge-fixture.mjs", import.meta.url))], {
    encoding: "utf8",
  }),
);
const ids = Array.from(
  { length: 6 },
  (_, i) => `${String(i + 1).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
);
const [tenantId, routeId, accountId, mailboxId, intakeId, sourceId] = ids;
const input = {
  tenantId,
  routeId,
  accountId,
  messageId: "abcdef1234",
  internalDate: "1791705600000",
};
function setup(overrides = {}) {
  const calls = [];
  const objects = new Map();
  let routeReads = 0;
  const route = {
    id: routeId,
    tenant_id: tenantId,
    email_account_id: accountId,
    enabled: true,
    signing_domain: "birchills-net.20251104.gappssmtp.com",
    mailbox_id: mailboxId,
    recipient_email: "synthetic@example.invalid",
  };
  const db = {
    rpc: async (name, args) => {
      calls.push(name);
      assert.equal(args.p_tenant, tenantId);
      if (name === "voicemail_intake_route") {
        routeReads++;
        if (overrides.pauseAt === routeReads)
          return { error: { message: "private database detail" } };
        return { data: route };
      }
      if (name === "voicemail_intake_prepare")
        return {
          data: {
            state: "prepared",
            intake_id: intakeId,
            source_id: sourceId,
            audio_path: `${tenantId}/${mailboxId}/${intakeId}`,
            source_path: `${tenantId}/${intakeId}/${sourceId}.eml`,
          },
        };
      if (name === "voicemail_intake_publish")
        return { data: { state: "published", message_id: intakeId } };
      throw Error("unexpected RPC");
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, bytes, options) => {
          calls.push("upload");
          assert.equal(options.upsert, false);
          objects.set(bucket + path, new Blob([bytes]));
          return {};
        },
        download: async (path) => {
          calls.push("readback");
          return { data: objects.get(bucket + path) };
        },
      }),
    },
  };
  const deps = {
    importer: importPrivateVoicemail,
    ports: () => ({
      mailbox: async (scope) => {
        calls.push("mailbox");
        assert.deepEqual(scope, { tenantId, accountId, syncType: "workspace_messages" });
        return {
          tenantId,
          accountId,
          mailbox: route.recipient_email,
          profileMailbox: route.recipient_email,
        };
      },
      accessToken: async () => {
        calls.push("token");
        return "synthetic-provider-token";
      },
    }),
    resolver: async (name, type) => {
      assert.equal(name, fixture.dnsName);
      assert.equal(type, "TXT");
      return [[fixture.keyRecord]];
    },
    fetcher: async (url, options) => {
      assert.equal(options.redirect, "error");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer synthetic-provider-token");
      if (url.endsWith("/profile")) {
        calls.push("profile");
        return Response.json({ emailAddress: overrides.profile ?? route.recipient_email });
      }
      calls.push("raw");
      assert.equal(
        url,
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/abcdef1234?format=raw",
      );
      if (overrides.status)
        return new Response("private provider failure", { status: overrides.status });
      return Response.json({
        id: input.messageId,
        internalDate: input.internalDate,
        raw: Buffer.from(fixture.raw).toString("base64url"),
        ...overrides.raw,
      });
    },
  };
  return { db, deps, calls, objects };
}
test("real signed audio crosses credential/profile/raw bridge and immutable import", async () => {
  const f = setup();
  const result = await importWorkspaceVoicemail(f.db, input, f.deps);
  assert.equal(result.state, "published");
  assert.equal(result.audioSha256, fixture.audioSha256);
  assert.equal(result.decodedDurationSeconds, fixture.decoded.durationSeconds);
  assert.deepEqual(f.calls.slice(0, 6), [
    "voicemail_intake_route",
    "mailbox",
    "token",
    "profile",
    "voicemail_intake_route",
    "raw",
  ]);
  assert.equal(f.objects.size, 2);
});
test("paused route prevents credentials; changed profile/route prevents raw download", async () => {
  for (const overrides of [{ pauseAt: 1 }, { pauseAt: 2 }, { profile: "other@example.invalid" }]) {
    const f = setup(overrides);
    await assert.rejects(importWorkspaceVoicemail(f.db, input, f.deps));
    assert.equal(f.calls.includes("raw"), false);
    assert.equal(f.objects.size, 0);
    if (overrides.pauseAt === 1) assert.deepEqual(f.calls, ["voicemail_intake_route"]);
  }
});
test("provider expiry, rate limiting, missing source and changed identity are explicit", async () => {
  for (const [status, code, retryable] of [
    [401, "voicemail_provider_access_denied", false],
    [403, "voicemail_provider_access_denied", false],
    [404, "voicemail_provider_source_unavailable", false],
    [429, "voicemail_provider_temporary", true],
    [500, "voicemail_provider_temporary", true],
  ]) {
    const f = setup({ status });
    await assert.rejects(
      importWorkspaceVoicemail(f.db, input, f.deps),
      (e) => e.code === code && e.retryable === retryable && !e.message.includes("private"),
    );
    assert.equal(f.objects.size, 0);
  }
  for (const raw of [
    { id: "different" },
    { internalDate: "1791705600001" },
    { raw: "%%%" },
    { raw: "YR" },
  ]) {
    const f = setup({ raw });
    await assert.rejects(importWorkspaceVoicemail(f.db, input, f.deps));
    assert.equal(f.objects.size, 0);
  }
});
test("credential failures preserve actionable safe codes and never read Gmail", async () => {
  for (const [code, retryable] of [
    ["admin_delegation_missing", false],
    ["sa_config_missing", false],
    ["fetch_failed", true],
  ]) {
    const f = setup();
    const original = f.deps.ports;
    f.deps.ports = () => ({
      ...original(),
      accessToken: async () => {
        throw new GmailCaptureError(code);
      },
    });
    await assert.rejects(
      importWorkspaceVoicemail(f.db, input, f.deps),
      (e) => e.code === "voicemail_" + code && e.retryable === retryable,
    );
    assert.equal(f.calls.includes("profile"), false);
    assert.equal(f.calls.includes("raw"), false);
  }
});
test("HTTP entry rejects user/forged credentials and invalid scope before work", async () => {
  let count = 0;
  const handler = createVoicemailImportHttpHandler({
    serviceKey: "synthetic-server-secret",
    run: async () => {
      count++;
    },
  });
  const body = { ...input };
  delete body.tenantId;
  for (const token of ["", "anon", "eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0."]) {
    const response = await handler(
      new Request("http://localhost", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 403);
  }
  for (const [tenant, payload] of [
    ["", body],
    [tenantId, { ...body, tenantId }],
    [tenantId, { ...body, routeId: "bad" }],
    [tenantId, { ...body, messageId: "../profile" }],
    [tenantId, { ...body, extra: "x".repeat(3000) }],
  ]) {
    const response = await handler(
      new Request("http://localhost", {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic-server-secret",
          "x-internal-tenant-id": tenant,
        },
        body: JSON.stringify(payload),
      }),
    );
    assert.equal(response.status, 400);
  }
  assert.equal(count, 0);
});
test("HTTP success returns only a receipt; uncertain publication never claims success", async () => {
  const f = setup();
  const { tenantId: tenant, ...body } = input;
  const request = () =>
    new Request("http://localhost", {
      method: "POST",
      headers: {
        "x-serviceos-internal-key": "synthetic-server-secret",
        "x-internal-tenant-id": tenant,
      },
      body: JSON.stringify(body),
    });
  const handler = createVoicemailImportHttpHandler({
    serviceKey: "synthetic-server-secret",
    run: (i) => importWorkspaceVoicemail(f.db, i, f.deps),
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    messageId: intakeId,
    recordsProcessed: 1,
    coverageComplete: false,
  });
  const broken = createVoicemailImportHttpHandler({
    serviceKey: "synthetic-server-secret",
    run: async () => {
      throw Error("private transcript and credentials");
    },
  });
  const failure = await broken(request());
  assert.equal(failure.status, 503);
  assert.equal((await failure.text()).includes("private transcript"), false);
});
test("bounded JSON stops streamed oversized responses and DNS allows three pinned selectors", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(200));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(readBoundedJson(response, 100), /too_large/);
  assert.equal(cancelled, true);
  const names = [];
  const keys = providerKeyResolver(async (name) => {
    names.push(name);
    return [["synthetic-public-key"]];
  });
  await assert.rejects(keys.resolve("example.com", "TXT"));
  await assert.rejects(
    keys.resolve("a._domainkey.nested._domainkey.birchills-net.20251104.gappssmtp.com", "TXT"),
  );
  const domain = "._domainkey.birchills-net.20251104.gappssmtp.com";
  for (const name of ["a", "a", "b", "c"]) await keys.resolve(name + domain, "TXT");
  await assert.rejects(keys.resolve("d" + domain, "TXT"), /budget/);
  assert.equal(names.length, 3);
  assert.deepEqual(keys.stats, { dnsQueries: 3, refusedQueries: 2 });
});
