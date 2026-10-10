/** Execute actual Edge handlers and local imports in a VM with synthetic DB/provider ports. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  tenant = id(1);
const account = () => ({
  id: id(2),
  tenant_id: tenant,
  tenant_connector_id: id(3),
  account_key: "3950",
  customer: "3950",
  status: "active",
  connector: {
    id: id(3),
    tenant_id: tenant,
    connector_id: "simwood",
    provider: "simwood",
    status: "active",
    enabled: true,
  },
});
async function harness(
  name,
  {
    accounts = [account()],
    stored = "https://pbx.sipcentric.com/api/v1/customers/3950/recordings/recording_1",
    alreadyStored = false,
    providerAccount = "3950",
    credentials = true,
    captureAllowed = true,
    captureError = false,
    childResponses = {},
    pauseWriteError = false,
    pauseWriteMissing = false,
    pauseWriteThrow = false,
    pauseWriteTarget = "phone_sync_runs",
  } = {},
) {
  const requests = [],
    writes = [],
    uploads = [];
  let handler;
  const db = {
    async rpc(name, args) {
      assert.equal(name, "learn_capture_admission");
      return {
        data: captureError
          ? null
          : {
              version: "learn-capture-admission/1",
              tenant_id: args.p_tenant,
              source: args.p_source,
              allowed: captureAllowed,
              checked_at: new Date().toISOString(),
            },
        error: captureError ? { message: "PRIVATE_DIAGNOSTIC" } : null,
      };
    },
    from(table) {
      let op = "read";
      const filters = [];
      let patch;
      const result = () => {
        const pauseWrite = patch?.status === "paused" || patch?.result?.capture_waiting;
        const faultApplies = table === pauseWriteTarget;
        if (pauseWrite && faultApplies && pauseWriteThrow) throw Error("PRIVATE_TRANSPORT_DETAIL");
        return patch?.status === "paused" || patch?.result?.capture_waiting
          ? {
              data:
                faultApplies && (pauseWriteError || pauseWriteMissing)
                  ? null
                  : { id: table === "platform_jobs" ? id(7) : id(4) },
              error: faultApplies && pauseWriteError ? { message: "PRIVATE_DB_DETAIL" } : null,
            }
          : table === "tenant_connectors" && op === "read"
            ? { data: [{ id: id(3), tenant_id: tenant }], error: null }
            : table === "platform_jobs" && op === "insert"
              ? { data: { id: id(7) }, error: null }
              : table === "connector_accounts"
                ? { data: accounts, error: null, count: accounts.length }
                : table === "phone_sync_runs" && op === "insert"
                  ? { data: { id: id(4) }, error: null }
                  : table === "phone_recordings" && op === "read"
                    ? {
                        data: {
                          id: id(5),
                          provider: "simwood",
                          provider_recording_id: "recording_1",
                          recording_uri: stored,
                          storage_path: alreadyStored ? "retained.wav" : null,
                          started_at: "2026-01-01T00:00:00Z",
                        },
                        error: null,
                      }
                    : { data: [], error: null };
      };
      const q = {
        select: () => q,
        eq: (name, value) => {
          filters.push([name, value]);
          return q;
        },
        limit: () => q,
        in: () => q,
        insert(v) {
          op = "insert";
          writes.push({ table, op, v, filters });
          return q;
        },
        update(v) {
          op = "update";
          patch = v;
          writes.push({ table, op, v, filters });
          return q;
        },
        upsert(v) {
          op = "upsert";
          writes.push({ table, op, v });
          return q;
        },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (yes, no) => Promise.resolve(result()).then(yes, no),
      };
      return q;
    },
    storage: {
      from: () => ({
        upload: async (...args) => {
          uploads.push(args);
          return { error: null };
        },
      }),
    },
  };
  const env = {
    SUPABASE_URL: "https://synthetic.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    PHONE_SCHEDULE_SECRET: "synthetic-schedule",
    SIMWOOD_USERNAME: credentials ? "synthetic-user" : undefined,
    SIMWOOD_PASSWORD: credentials ? "synthetic-password" : undefined,
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    AbortSignal,
    Blob,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    Date,
    console,
    btoa,
    atob,
    setTimeout,
    clearTimeout,
    Deno: {
      env: { get: (k) => env[k] },
      serve: (f) => {
        handler = f;
      },
    },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).startsWith("https://synthetic.invalid/functions/v1/")) {
        const response = childResponses[String(url).split("/").at(-1)];
        if (!response) throw Error("Unexpected child request");
        return Response.json(response.body, { status: response.status ?? 200 });
      }
      if (name === "simwood-test-connection")
        return Response.json({ id: providerAccount, name: "Synthetic company" });
      if (name === "simwood-download-recording")
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "audio/wav" },
        });
      return Response.json({ items: [] });
    },
  });
  const cache = new Map();
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const mod = new vm.SourceTextModule(source, { context, identifier: file });
    cache.set(file, mod);
    await mod.link(async (spec, parent) => {
      if (spec === "https://esm.sh/@supabase/supabase-js@2.45.4") {
        const key = "supabase";
        if (!cache.has(key)) {
          const synthetic = new vm.SyntheticModule(
            ["createClient"],
            function () {
              this.setExport("createClient", () => db);
            },
            { context },
          );
          cache.set(key, synthetic);
        }
        return cache.get(key);
      }
      if (!spec.startsWith(".")) throw Error("Unexpected external dependency");
      return load(resolve(dirname(parent.identifier), spec));
    });
    return mod;
  }
  const mod = await load(resolve(`supabase/functions/${name}/index.ts`));
  await mod.evaluate();
  return {
    requests,
    writes,
    uploads,
    run: (body) =>
      handler(
        new Request("https://synthetic.invalid/function", {
          method: "POST",
          headers: {
            Authorization: "Bearer synthetic-service",
            "x-internal-tenant-id": tenant,
            "content-type": "application/json",
            "x-schedule-secret": "synthetic-schedule",
          },
          body: JSON.stringify({ tenant_id: tenant, recording_id: id(5), ...body }),
        }),
      ),
  };
}
for (const name of ["simwood-sync-calls", "simwood-sync-recordings", "simwood-test-connection"]) {
  test(`${name} rejects unregistered account before provider access`, async () => {
    const h = await harness(name),
      r = await h.run({ provider_customer_id: "8000" });
    assert.equal(r.status, 409);
    assert.equal(h.requests.length, 0);
    assert.ok(!h.writes.some((w) => ["phone_calls", "phone_recordings"].includes(w.table)));
  });
  test(`${name} uses only the registered account with redirects disabled`, async () => {
    const h = await harness(name),
      r = await h.run({});
    assert.equal(r.status, 200);
    assert.equal(h.requests.length, 1);
    assert.ok(h.requests[0].url.startsWith("https://pbx.sipcentric.com/api/v1/customers/3950"));
    assert.equal(h.requests[0].options.redirect, "error");
    assert.ok(h.requests[0].options.signal);
  });
}
test("connection test refuses foreign provider response rather than disclose it", async () => {
  const h = await harness("simwood-test-connection", { providerAccount: "8000" }),
    r = await h.run({});
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes("Synthetic company"));
});
test("download refuses foreign recording account and leaves retained audio alone", async () => {
  const h = await harness("simwood-download-recording", {
      stored: "https://pbx.sipcentric.com/api/v1/customers/8000/recordings/recording_1",
    }),
    r = await h.run({});
  assert.equal(r.status, 409);
  assert.equal(h.requests.length, 0);
  assert.equal(h.uploads.length, 0);
  const retained = await harness("simwood-download-recording", {
    accounts: [],
    alreadyStored: true,
  });
  assert.equal((await retained.run({})).status, 200);
  assert.equal(retained.requests.length, 0);
  assert.equal(retained.uploads.length, 0);
});
test("download keeps exact registered endpoint and missing-URI fallback is company bound", async () => {
  for (const stored of [
    null,
    "https://pbx.sipcentric.com/api/v1/customers/3950/recordings/recording_1",
  ]) {
    const h = await harness("simwood-download-recording", { stored }),
      r = await h.run({});
    assert.equal(r.status, 200);
    assert.equal(
      h.requests[0].url,
      "https://pbx.sipcentric.com/api/v1/customers/3950/recordings/recording_1",
    );
    assert.equal(h.requests[0].options.redirect, "error");
    assert.equal(h.uploads.length, 1);
  }
});

test("stored audio requires no live provider credential and denied bindings are checked first", async () => {
  const retained = await harness("simwood-download-recording", {
    credentials: false,
    alreadyStored: true,
    accounts: [],
  });
  assert.equal((await retained.run({})).status, 200);
  assert.equal(retained.requests.length, 0);
  assert.equal(retained.uploads.length, 0);
  for (const name of ["simwood-sync-calls", "simwood-sync-recordings", "simwood-test-connection"]) {
    const h = await harness(name, { credentials: false });
    assert.equal((await h.run({ provider_customer_id: "8000" })).status, 409);
    assert.equal(h.requests.length, 0);
  }
});

for (const name of [
  "simwood-sync-calls",
  "simwood-sync-recordings",
  "simwood-download-recording",
  "phone-process-pipeline",
  "gmail-sync-messages",
  "gmail-workspace-sync-messages",
  "gmail-workspace-backfill-messages",
  "google-workspace-discover-mailboxes",
]) {
  test(`${name} pauses before credentials, provider access or a failed run`, async () => {
    for (const captureError of [false, true]) {
      const h = await harness(name, { captureAllowed: false, captureError });
      const r = await h.run({ email_account_id: id(6) });
      assert.equal(r.status, captureError ? 503 : 409);
      assert.equal(
        (await r.json()).error.code,
        captureError ? "learn_capture_unavailable" : "learn_capture_paused",
      );
      assert.equal(h.requests.length, 0);
      assert.equal(h.writes.length, 0);
      assert.equal(h.uploads.length, 0);
    }
  });
}
test("pause retains cached audio access but prevents a forced replacement", async () => {
  const h = await harness("simwood-download-recording", {
    captureAllowed: false,
    alreadyStored: true,
  });
  assert.equal((await h.run({})).status, 200);
  assert.equal(h.requests.length, 0);
  const forced = await harness("simwood-download-recording", {
    captureAllowed: false,
    alreadyStored: true,
  });
  assert.equal((await forced.run({ force: true })).status, 409);
  assert.equal(forced.requests.length, 0);
  assert.equal(forced.writes.length, 0);
});

const childPause = (code = "learn_capture_paused") => ({
  status: code === "learn_capture_paused" ? 409 : 503,
  body: { success: false, error: { code, message: "Capture is waiting." } },
});
const childSuccess = { body: { success: true, records_processed: 3, sync_run_id: id(8) } };
test("phone scheduler advances its cursor only when both children complete", async () => {
  const h = await harness("phone-scheduled-sync", {
    childResponses: { "simwood-sync-calls": childSuccess, "simwood-sync-recordings": childSuccess },
  });
  const body = await (await h.run({})).json();
  assert.equal(body.success, true);
  assert.equal(body.results[0].ok, true);
  assert.equal(body.results[0].waiting, undefined);
  const accountWrite = h.writes.find((w) => w.table === "connector_accounts" && w.v.sync_cursor);
  assert.equal(accountWrite.v.sync_cursor.last_synced_until, body.results[0].to);
  assert.equal(accountWrite.v.last_successful_sync_at, body.results[0].to);
  assert.ok(
    h.writes.some(
      (w) =>
        w.table === "phone_sync_runs" && w.v.status === "success" && w.v.records_processed === 6,
    ),
  );
  assert.ok(h.writes.some((w) => w.table === "platform_jobs" && w.v.status === "succeeded"));
  assert.ok(!h.writes.some((w) => w.v.status === "paused" || w.v.status === "cancelled"));
});
test("phone scheduler pauses at entry without opening runs or advancing saved progress", async () => {
  for (const captureError of [false, true]) {
    const h = await harness("phone-scheduled-sync", { captureAllowed: false, captureError });
    const body = await (await h.run({})).json();
    assert.equal(body.success, true);
    assert.equal(body.results[0].ok, false);
    assert.equal(body.results[0].waiting, captureError ? "unavailable" : "paused");
    assert.equal(h.writes.length, 0);
    assert.equal(h.requests.length, 0);
  }
});
test("phone scheduler retains the cursor and partial counts when a child pauses", async () => {
  for (const code of ["learn_capture_paused", "learn_capture_unavailable"]) {
    const h = await harness("phone-scheduled-sync", {
      childResponses: {
        "simwood-sync-calls": childSuccess,
        "simwood-sync-recordings": childPause(code),
      },
    });
    const body = await (await h.run({})).json();
    assert.equal(body.success, true);
    assert.equal(body.results[0].ok, false);
    assert.equal(body.results[0].waiting, "capture_control");
    const run = h.writes.find((w) => w.table === "phone_sync_runs" && w.op === "update");
    assert.equal(run.v.status, "paused");
    assert.equal(run.v.records_processed, 3);
    assert.equal(run.v.error_message, null);
    assert.ok(run.filters.some(([k, v]) => k === "tenant_id" && v === tenant));
    assert.ok(run.filters.some(([k, v]) => k === "status" && v === "running"));
    assert.equal(run.v.metadata.errors.recordings, code);
    assert.ok(!h.writes.some((w) => ["connector_accounts", "tenant_connectors"].includes(w.table)));
    const job = h.writes.find((w) => w.table === "platform_jobs" && w.v.status === "cancelled");
    assert.equal(job.v.result.capture_waiting, true);
    assert.ok(!h.writes.some((w) => w.v.status === "failed" || w.v.status === "succeeded"));
  }
});
test("phone scheduler keeps a real provider failure visible alongside a capture pause", async () => {
  const h = await harness("phone-scheduled-sync", {
    childResponses: {
      "simwood-sync-calls": {
        status: 502,
        body: { success: false, error: { code: "provider_unavailable" } },
      },
      "simwood-sync-recordings": childPause(),
    },
  });
  const body = await (await h.run({})).json();
  assert.equal(body.success, false);
  assert.equal(body.results[0].waiting, undefined);
  assert.ok(h.writes.some((w) => w.table === "phone_sync_runs" && w.v.status === "failed"));
  assert.ok(h.writes.some((w) => w.table === "connector_accounts" && w.v.last_failed_sync_at));
  assert.ok(!h.writes.some((w) => w.v.sync_cursor));
});
test("pipeline pause between admission and download preserves retry history without downstream work", async () => {
  for (const code of ["learn_capture_paused", "learn_capture_unavailable"]) {
    const h = await harness("phone-process-pipeline", {
      childResponses: { "simwood-download-recording": childPause(code) },
    });
    const r = await h.run({}),
      body = await r.json();
    assert.equal(body.capture_waiting, true);
    assert.equal(body.error.code, code);
    assert.equal(h.requests.length, 1);
    const run = h.writes.find((w) => w.table === "phone_sync_runs" && w.op === "update");
    assert.equal(run.v.sync_type, "pipeline_waiting");
    assert.equal(run.v.status, "paused");
    assert.equal(run.v.error_message, null);
    assert.ok(!h.writes.some((w) => w.table === "audit_logs"));
  }
});
test("unconfirmed phone pause writes stay unresolved and never report settled waiting", async () => {
  for (const name of ["phone-process-pipeline", "phone-scheduled-sync"])
    for (const fault of ["pauseWriteError", "pauseWriteMissing", "pauseWriteThrow"])
      for (const pauseWriteTarget of name === "phone-scheduled-sync"
        ? ["phone_sync_runs", "platform_jobs"]
        : ["phone_sync_runs"]) {
        const h = await harness(name, {
          [fault]: true,
          pauseWriteTarget,
          childResponses: {
            "simwood-download-recording": childPause(),
            "simwood-sync-calls": childSuccess,
            "simwood-sync-recordings": childPause(),
          },
        });
        const r = await h.run({}),
          body = await r.json();
        assert.equal(body.success, false);
        if (name === "phone-process-pipeline") {
          assert.equal(r.status, 503);
          assert.equal(body.error.code, "learn_capture_wait_unconfirmed");
          assert.notEqual(body.capture_waiting, true);
        } else {
          assert.equal(body.results[0].error, "learn_capture_wait_unconfirmed");
          assert.equal(body.results[0].waiting, undefined);
        }
        assert.ok(!JSON.stringify(body).includes("PRIVATE_"));
        assert.ok(
          !h.writes.some((w) => ["connector_accounts", "tenant_connectors"].includes(w.table)),
        );
      }
});
