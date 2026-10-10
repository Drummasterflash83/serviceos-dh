import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { handleEmailEnqueue } from "./email_enqueue.ts";
import { isEmailCaptureQueued } from "../../../src/lib/email-queue-result.ts";
const tenant = "00000000-0000-4000-8000-000000000001",
  account = "aaaaaaaa-0000-4000-8000-000000000002",
  job = "00000000-0000-4000-8000-000000000003";
Object.assign(globalThis, { Deno: { env: { get: () => "synthetic-service" } } });
const reply = {
  version: "learn-email-enqueue/1",
  success: true,
  state: "queued",
  provider: "gmail",
  email_account_id: account,
  job_id: job,
  duplicate: false,
};
function fixture(role = "admin", rpcResult: unknown = { data: reply, error: null }) {
  const calls: unknown[] = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) },
    from: (table: string) => {
      assert.equal(table, "profiles");
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: { tenant_id: tenant, role }, error: null }),
      };
      return query;
    },
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      if (rpcResult instanceof Error) throw rpcResult;
      return rpcResult;
    },
  };
  return { db, calls };
}
function request(
  body: unknown = { email_account_id: account },
  headers: Record<string, string> = { Authorization: "Bearer user" },
) {
  return new Request("https://example.invalid/sync", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
test("authorized roles queue all mailbox paths with the profile tenant and canonical account", async () => {
  for (const role of ["owner", "admin", "ops"])
    for (const type of [
      "email.gmail_sync",
      "email.workspace_sync",
      "email.workspace_backfill",
    ] as const) {
      const f = fixture(role),
        result = await handleEmailEnqueue(
          request({ email_account_id: account.toUpperCase(), max_results: 25 }),
          f.db as never,
          type,
        );
      assert.equal(result.status, 202);
      const body = await result.json();
      assert.equal(isEmailCaptureQueued(body, account), true);
      assert.equal("records_processed" in body, false);
      assert.deepEqual(f.calls, [
        {
          fn: "learn_email_enqueue",
          args: {
            p_tenant: tenant,
            p_account: account,
            p_type: type,
            p_options: { max_results: 25 },
          },
        },
      ]);
    }
});
test("missing auth, viewer and foreign-tenant requests cannot enqueue", async () => {
  for (const [role, req, status] of [
    ["admin", request(undefined, {}), 401],
    ["viewer", request(), 403],
    ["admin", request({ email_account_id: account, tenant_id: job }), 403],
  ] as const) {
    const f = fixture(role);
    assert.equal((await handleEmailEnqueue(req, f.db as never, "email.gmail_sync")).status, status);
    assert.equal(f.calls.length, 0);
  }
});
test("internal credentials require an explicit tenant and mismatch headers never become user authority", async () => {
  for (const [headers, status] of [
    [{ Authorization: "Bearer synthetic-service" }, 403],
    [{ Authorization: "Bearer wrong", "x-internal-tenant-id": tenant }, 401],
    [{ Authorization: "Bearer synthetic-service", "x-internal-tenant-id": tenant }, 202],
  ] as const) {
    const f = fixture();
    assert.equal(
      (await handleEmailEnqueue(request(undefined, headers), f.db as never, "email.gmail_sync"))
        .status,
      status,
    );
    assert.equal(f.calls.length, status === 202 ? 1 : 0);
  }
});
test("invalid options and unexpected fields are rejected before queue access", async () => {
  for (const body of [
    [],
    null,
    { email_account_id: account, max_results: 501 },
    { email_account_id: account, max_results: 1.5 },
    { email_account_id: account, force: "true" },
    { email_account_id: account, restart: true },
    { email_account_id: account, token: "PRIVATE" },
  ]) {
    const f = fixture();
    assert.equal(
      (await handleEmailEnqueue(request(body), f.db as never, "email.gmail_sync")).status,
      400,
    );
    assert.equal(f.calls.length, 0);
  }
});
test("gateway-translated internal requests require the exact dedicated key and tenant", async () => {
  for (const [headers, status] of [
    [
      {
        Authorization: "Bearer translated",
        "x-serviceos-internal-key": "synthetic-service",
        "x-internal-tenant-id": tenant,
      },
      202,
    ],
    [{ Authorization: "Bearer translated", "x-serviceos-internal-key": "synthetic-service" }, 403],
    [
      {
        Authorization: "Bearer user",
        "x-serviceos-internal-key": "wrong",
        "x-internal-tenant-id": tenant,
      },
      401,
    ],
  ] as const) {
    const f = fixture();
    const response = await handleEmailEnqueue(
      request(undefined, headers),
      f.db as never,
      "email.gmail_sync",
    );
    assert.equal(response.status, status);
    assert.equal(f.calls.length, status === 202 ? 1 : 0);
  }
});
test("explicit internal binding remains distinct from the runtime service key", async () => {
  const previous = globalThis.Deno.env.get;
  globalThis.Deno.env.get = (name: string) =>
    name === "SERVICEOS_INTERNAL_KEY" ? "synthetic-stable-key" : "synthetic-service";
  try {
    const f = fixture();
    const result = await handleEmailEnqueue(
      request(undefined, {
        Authorization: "Bearer translated",
        "x-internal-tenant-id": tenant,
        "x-serviceos-internal-key": "synthetic-stable-key",
      }),
      f.db as never,
      "email.gmail_sync",
    );
    assert.equal(result.status, 202);
    assert.equal(f.calls.length, 1);
  } finally {
    globalThis.Deno.env.get = previous;
  }
});
test("known policy conflicts are actionable while unknown replies remain uncertain without retries or private details", async () => {
  for (const message of [
    "learn_capture_paused",
    "learn_email_explicit_recovery_required",
    "learn_email_active_request_conflict",
    "PRIVATE_DATABASE_SECRET",
  ]) {
    const f = fixture("admin", { data: null, error: { message } });
    const r = await handleEmailEnqueue(request(), f.db as never, "email.gmail_sync");
    assert.equal(r.status, message.startsWith("PRIVATE") ? 503 : 409);
    assert.doesNotMatch(await r.text(), /PRIVATE_DATABASE_SECRET/);
    assert.equal(f.calls.length, 1);
  }
  for (const response of [
    new Error("PRIVATE_TOKEN"),
    { data: { ...reply, email_account_id: job }, error: null },
    { data: { success: true, records_processed: 0 }, error: null },
  ]) {
    const f = fixture("admin", response);
    const r = await handleEmailEnqueue(request(), f.db as never, "email.gmail_sync");
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /PRIVATE_TOKEN/);
    assert.equal(f.calls.length, 1);
  }
});
test("frontend refuses old synchronous success, foreign accounts and malformed queue receipts", () => {
  for (const body of [
    { success: true, records_processed: 12 },
    { ...reply, state: "completed" },
    { ...reply, email_account_id: job },
    { ...reply, job_id: null },
    { ...reply, duplicate: "false" },
  ])
    assert.equal(isEmailCaptureQueued(body, account), false);
  assert.equal(isEmailCaptureQueued({ ...reply, duplicate: true }, account.toUpperCase()), true);
});
test("actual status panel distinguishes queued submission from completed success and uncertain requests", async () => {
  const source = readFileSync(
    new URL("../../../src/components/app/admin/StatusPanel.tsx", import.meta.url),
    "utf8",
  );
  let compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const module of ["lucide-react", "react/jsx-runtime"])
    compiled = compiled.replaceAll('"' + module + '"', JSON.stringify(import.meta.resolve(module)));
  const { StatusPanel } = await import(
    "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
  );
  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(StatusPanel, { running: false, renderOk: () => [], ...props }),
    );
  const queued = render({ result: { ok: true, data: reply }, successLabel: "Queued" });
  assert.match(queued, />Queued</);
  assert.doesNotMatch(queued, />Success<|messages imported/);
  assert.match(
    render({
      result: { ok: false, error: { code: "queue_unconfirmed", message: "Check email jobs" } },
      errorLabel: "Needs attention",
    }),
    />Needs attention</,
  );
  assert.match(render({ result: { ok: true, data: {} } }), />Success</);
});
