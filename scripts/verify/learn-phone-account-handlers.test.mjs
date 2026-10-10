/** Execute actual Edge handlers and local imports in a VM with synthetic DB/provider ports. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  tenant = id(1);
const account = () => ({
  id: id(2),
  tenant_id: tenant,
  tenant_connector_id: id(3),
  account_key: "3950",
  customer: "3950",
  updated_at: "2026-10-10T00:00:00.000Z",
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
const completionReceipt = (a) => ({
  version: "learn-phone-import/1",
  tenantId: a.p_tenant,
  runId: a.p_run,
  accountId: a.p_account,
  connectorId: a.p_connector,
  customerId: a.p_customer,
  kind: a.p_kind,
  pages: a.p_pages,
  recordsProcessed: a.p_records,
  from: a.p_metadata.from,
  to: a.p_metadata.to,
  windowComplete: true,
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
    providerPage,
    onSourceWrite,
    publicationResponse,
    completionResponse,
    scheduleResponse,
    scheduleRunMissing = false,
    scheduleHeartbeatMissing = false,
    recoveryJobCreate,
    recoveryClaimMissing = false,
    recoverySettleMissing = false,
    pendingRows = [],
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
  let scheduleHeartbeatCount = 0;
  const db = {
    async rpc(name, args) {
      if (name === "learn_phone_settle_schedule") {
        writes.push({ table: name, op: "rpc", v: args });
        const metadata = writes.find((w) => w.table === "phone_sync_runs" && w.op === "insert").v
          .metadata;
        const receipt = {
          version: "learn-phone-schedule/1",
          tenantId: args.p_tenant,
          runId: args.p_run,
          accountId: metadata.connector_account_id,
          connectorId: metadata.tenant_connector_id,
          customerId: metadata.provider_customer_id,
          jobId: metadata.job_id,
          outcome: args.p_outcome,
          callsRunId: args.p_calls,
          recordingsRunId: args.p_recordings,
          callsProcessed: args.p_calls === id(8) ? 3 : 0,
          recordingsProcessed: args.p_recordings === id(9) ? 3 : 0,
          from: metadata.from,
          to: metadata.to,
          cursorAdvanced: args.p_outcome === "success",
        };
        if (scheduleResponse) return scheduleResponse(args, receipt);
        if (args.p_outcome === "paused") {
          if (pauseWriteThrow) throw Error("PRIVATE_DETAIL");
          if (pauseWriteError || pauseWriteMissing)
            return { data: null, error: pauseWriteError ? { message: "PRIVATE_DETAIL" } : null };
        }
        return { data: receipt, error: null };
      }
      if (name === "learn_phone_complete_import") {
        writes.push({ table: name, op: "rpc", v: args });
        if (completionResponse) return completionResponse(args);
        return { data: completionReceipt(args), error: null };
      }
      if (name === "phone_select_pending") return { data: pendingRows, error: null };
      if (name === "learn_phone_publish_page") {
        writes.push({ table: name, op: "rpc", v: args });
        if (publicationResponse) return publicationResponse(args);
        const table = args.p_kind === "calls" ? "phone_calls" : "phone_recordings";
        onSourceWrite?.(table, args.p_records);
        return {
          data: {
            version: "learn-phone-page/1",
            tenantId: args.p_tenant,
            runId: args.p_run,
            page: args.p_page,
            kind: args.p_kind,
            recordsProcessed: args.p_records.length,
            newRecordingIds: [],
          },
          error: null,
        };
      }
      if (name === "learn_email_enqueue") {
        assert.equal(captureAllowed, false);
        return {
          data: null,
          error: { message: captureError ? "PRIVATE_DIAGNOSTIC" : "learn_capture_paused" },
        };
      }
      assert.equal(name, "learn_capture_admission");
      return {
        data: captureError
          ? null
          : {
              version: "learn-capture-admission/1",
              tenant_id: args.p_tenant,
              source: args.p_source,
              allowed: typeof captureAllowed === "function" ? captureAllowed() : captureAllowed,
              checked_at: new Date().toISOString(),
            },
        error: captureError ? { message: "PRIVATE_DIAGNOSTIC" } : null,
      };
    },
    from(table) {
      let op = "read";
      const filters = [];
      let patch;
      let many = false;
      const result = () => {
        if (table === "phone_recording_pipeline_state")
          return { data: [], count: pendingRows.length, error: null };
        if (table === "platform_jobs" && op === "insert" && recoveryJobCreate)
          return {
            data: null,
            error: {
              code: recoveryJobCreate === "duplicate" ? "23505" : "XX000",
              message: "PRIVATE",
            },
          };
        if (table === "platform_jobs" && op === "read") return { data: { id: id(7) }, error: null };
        if (table === "platform_jobs" && op === "update" && !patch?.result?.capture_waiting) {
          const missing =
            (patch.status === "running" && recoveryClaimMissing) ||
            (patch.status === undefined &&
              scheduleHeartbeatMissing &&
              ++scheduleHeartbeatCount ===
                (scheduleHeartbeatMissing === true ? 1 : scheduleHeartbeatMissing)) ||
            (["succeeded", "failed"].includes(patch.status) && recoverySettleMissing);
          return { data: missing ? null : { id: id(7) }, error: null };
        }
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
                  ? { data: scheduleRunMissing ? null : { id: id(4) }, error: null }
                  : table === "phone_recordings" && op === "read"
                    ? {
                        data: many
                          ? []
                          : {
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
        gt: () => q,
        limit: () => q,
        in: () => {
          many = true;
          return q;
        },
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
          onSourceWrite?.(table, v);
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
    crypto: webcrypto,
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
        const name = String(url).split("/").at(-1);
        const configured = childResponses[name];
        const response =
          typeof configured === "function"
            ? configured(JSON.parse(options.body), name)
            : configured;
        if (!response) throw Error("Unexpected child request");
        return Response.json(response.body, { status: response.status ?? 200 });
      }
      if (name === "simwood-test-connection")
        return Response.json({ id: providerAccount, name: "Synthetic company" });
      if (name === "simwood-download-recording")
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "audio/wav" },
        });
      return Response.json(providerPage ? await providerPage(String(url)) : { items: [] });
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
      // CLI download places each endpoint's shared files under functions/ while
      // its entrypoint retains original ../_shared imports. Resolve this layout
      // without changing any downloaded runtime source.
      const downloadedEntry = useReadback && parent.identifier === entry;
      return load(
        downloadedEntry && spec.startsWith("../_shared/")
          ? resolve(dirname(parent.identifier), "functions", spec.slice(3))
          : resolve(dirname(parent.identifier), spec),
      );
    });
    return mod;
  }
  const readback = process.env.PHONE_HANDLER_READBACK_ROOT;
  const useReadback = Boolean(
    readback &&
    [
      "simwood-sync-calls",
      "simwood-sync-recordings",
      "phone-process-pending",
      "phone-scheduled-sync",
    ].includes(name),
  );
  const entry = useReadback
    ? resolve(readback, name, "index.ts")
    : resolve(`supabase/functions/${name}/index.ts`);
  const mod = await load(entry);
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
          body: JSON.stringify({
            tenant_id: tenant,
            ...(name.startsWith("gmail-") ? {} : { recording_id: id(5) }),
            ...body,
          }),
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
        captureError
          ? name.startsWith("gmail-")
            ? "queue_unconfirmed"
            : "learn_capture_unavailable"
          : "learn_capture_paused",
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
const childSuccess = (input, name) => ({
  body: {
    success: true,
    records_processed: 3,
    sync_run_id: id(name === "simwood-sync-recordings" ? 9 : 8),
    window_complete: true,
    from: input.from,
    to: input.to,
    customer_id: input.provider_customer_id,
  },
});
test("phone scheduler advances its cursor only when both children complete", async () => {
  const h = await harness("phone-scheduled-sync", {
    childResponses: { "simwood-sync-calls": childSuccess, "simwood-sync-recordings": childSuccess },
  });
  const body = await (await h.run({})).json();
  assert.equal(body.success, true);
  assert.equal(body.results[0].ok, true);
  assert.equal(body.results[0].waiting, undefined);
  const settlement = h.writes.find((w) => w.table === "learn_phone_settle_schedule");
  assert.equal(settlement.v.p_outcome, "success");
  assert.equal(settlement.v.p_calls, id(8));
  assert.equal(settlement.v.p_recordings, id(9));
  assert.equal(body.results[0].calls_processed, 3);
  assert.equal(body.results[0].recordings_processed, 3);
  assert.ok(!h.writes.some((w) => ["connector_accounts", "tenant_connectors"].includes(w.table)));
  assert.ok(!h.writes.some((w) => w.table === "phone_sync_runs" && w.op === "update"));
  assert.ok(!h.writes.some((w) => w.v.status === "succeeded"));
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
    const settlement = h.writes.find((w) => w.table === "learn_phone_settle_schedule");
    assert.equal(settlement.v.p_outcome, "paused");
    assert.equal(settlement.v.p_errors.recordings, code);
    assert.equal(body.results[0].calls_processed, 3);
    assert.ok(!h.writes.some((w) => ["connector_accounts", "tenant_connectors"].includes(w.table)));
    assert.ok(!h.writes.some((w) => w.table === "phone_sync_runs" && w.op === "update"));
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
  const settlement = h.writes.find((w) => w.table === "learn_phone_settle_schedule");
  assert.equal(settlement.v.p_outcome, "failed");
  assert.equal(settlement.v.p_errors.calls, "provider_unavailable");
  assert.equal(settlement.v.p_errors.recordings, "learn_capture_paused");
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
          assert.equal(body.results[0].error, "phone_schedule_unconfirmed");
          assert.equal(body.results[0].waiting, undefined);
        }
        assert.ok(!JSON.stringify(body).includes("PRIVATE_"));
        assert.ok(
          !h.writes.some((w) => ["connector_accounts", "tenant_connectors"].includes(w.table)),
        );
      }
});

for (const name of ["simwood-sync-calls", "simwood-sync-recordings"]) {
  const source = name === "simwood-sync-calls" ? "phone_calls" : "phone_recordings";
  const items = (n) =>
    Array.from({ length: n }, (_, i) => ({ callId: `call_${i}`, id: `recording_${i}` }));
  test(`${name} discards a fetched page when capture is paused while provider responds`, async () => {
    let allowed = true;
    const h = await harness(name, {
      captureAllowed: () => allowed,
      providerPage: () => {
        allowed = false;
        return { items: items(1) };
      },
    });
    const r = await h.run({});
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "learn_capture_paused");
    assert.equal(h.requests.length, 1);
    assert.ok(!h.writes.some((w) => w.table === source));
    assert.ok(!h.writes.some((w) => w.table === "phone_sync_runs" && w.v.status === "success"));
  });
  test(`${name} retains a completed page but stops before fetching the next after a pause`, async () => {
    let allowed = true;
    const h = await harness(name, {
      captureAllowed: () => allowed,
      providerPage: () => ({ items: items(200) }),
      onSourceWrite: () => {
        allowed = false;
      },
    });
    const r = await h.run({});
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "learn_capture_paused");
    assert.equal(h.requests.length, 1);
    assert.equal(
      h.writes.filter((w) => w.table === "learn_phone_publish_page" && w.v.p_records.length > 0)
        .length,
      1,
    );
    const final = h.writes.find((w) => w.table === "phone_sync_runs" && w.op === "update");
    assert.equal(final.v.records_processed, 200);
    assert.equal(final.v.metadata.window_complete, false);
    assert.ok(!h.writes.some((w) => w.op === "delete" || w.table === "connector_accounts"));
  });
  test(`${name} withholds completion and follow-on processing if paused after the final page`, async () => {
    let allowed = true;
    const h = await harness(name, {
      captureAllowed: () => allowed,
      providerPage: () => ({ items: items(1) }),
      onSourceWrite: () => {
        allowed = false;
      },
    });
    const r = await h.run({});
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "learn_capture_paused");
    assert.equal(h.requests.length, 1);
    assert.equal(
      h.writes.filter((w) => w.table === "learn_phone_publish_page" && w.v.p_records.length > 0)
        .length,
      1,
    );
    assert.ok(!h.writes.some((w) => w.table === "phone_sync_runs" && w.v.status === "success"));
    assert.ok(!h.requests.some((r) => r.url.includes("phone-process-pipeline")));
  });
  test(`${name} refuses disabled, rebound or replaced provider accounts before publishing`, async () => {
    for (const change of [
      (a) => (a.connector.enabled = false),
      (a) => (a.customer = "8000"),
      (a) => (a.id = id(20)),
      (a) => {
        a.tenant_connector_id = id(30);
        a.connector.id = id(30);
      },
    ]) {
      const a = account();
      const h = await harness(name, {
        accounts: [a],
        providerPage: () => {
          change(a);
          return { items: items(1) };
        },
      });
      const r = await h.run({});
      assert.equal(r.status, 409);
      assert.ok(
        ["phone_account_unavailable", "phone_account_changed"].includes(
          (await r.json()).error.code,
        ),
      );
      assert.equal(h.requests.length, 1);
      assert.ok(!h.writes.some((w) => w.table === source));
    }
  });
  test(`${name} does not report a completed empty window when the operator pauses`, async () => {
    let allowed = true;
    const h = await harness(name, {
      captureAllowed: () => allowed,
      providerPage: () => {
        allowed = false;
        return { items: [] };
      },
    });
    const r = await h.run({});
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "learn_capture_paused");
    assert.ok(!h.writes.some((w) => w.v.status === "success"));
  });
}

for (const name of ["simwood-sync-calls", "simwood-sync-recordings"]) {
  const kind = name === "simwood-sync-calls" ? "calls" : "recordings";
  const receipt = (a) => ({
    version: "learn-phone-page/1",
    tenantId: a.p_tenant,
    runId: a.p_run,
    page: a.p_page,
    kind: a.p_kind,
    recordsProcessed: a.p_records.length,
    newRecordingIds: [],
  });
  test(`${name} binds every publication including empty exhaustion to its run and account`, async () => {
    const h = await harness(name, {
      providerPage: (url) => ({
        items:
          new URL(url).searchParams.get("page") === "1"
            ? Array.from({ length: 200 }, (_, i) => ({ callId: `c${i}`, id: `r${i}` }))
            : [],
      }),
    });
    const r = await h.run({});
    assert.equal(r.status, 200);
    const pages = h.writes.filter((w) => w.table === "learn_phone_publish_page");
    assert.equal(pages.length, 2);
    for (const [i, p] of pages.entries()) {
      assert.equal(p.v.p_tenant, tenant);
      assert.equal(p.v.p_run, id(4));
      assert.equal(p.v.p_account, id(2));
      assert.equal(p.v.p_connector, id(3));
      assert.equal(p.v.p_customer, "3950");
      assert.equal(p.v.p_kind, kind);
      assert.equal(p.v.p_page, i + 1);
    }
    assert.equal(pages[1].v.p_records.length, 0);
    assert.ok(!h.writes.some((w) => ["phone_calls", "phone_recordings"].includes(w.table)));
  });
  test(`${name} stops safely on lost, rejected or malformed publication without direct-write fallback`, async () => {
    for (const fault of [
      () => {
        throw Error("PRIVATE_TRANSPORT_DETAIL");
      },
      () => ({ data: null, error: { code: "XX000", message: "PRIVATE_DB_DETAIL" } }),
      () => ({ data: null, error: null }),
      (a) => ({ data: { ...receipt(a), tenantId: id(50) }, error: null }),
      (a) => ({ data: { ...receipt(a), runId: id(50) }, error: null }),
      (a) => ({ data: { ...receipt(a), page: 2 }, error: null }),
      (a) => ({ data: { ...receipt(a), recordsProcessed: 0 }, error: null }),
      (a) => ({ data: { ...receipt(a), newRecordingIds: ["PRIVATE_BAD_ID"] }, error: null }),
      (a) => ({ data: { ...receipt(a), newRecordingIds: [id(7), id(7)] }, error: null }),
    ]) {
      const h = await harness(name, {
        providerPage: () => ({ items: [{ callId: "c1", id: "r1" }] }),
        publicationResponse: fault,
      });
      const r = await h.run({});
      const body = await r.json();
      assert.equal(r.status, 503);
      assert.equal(body.error.code, "phone_page_unconfirmed");
      assert.ok(!JSON.stringify(body).includes("PRIVATE_"));
      assert.equal(h.writes.filter((w) => w.table === "learn_phone_publish_page").length, 1);
      assert.ok(!h.writes.some((w) => ["phone_calls", "phone_recordings"].includes(w.table)));
      assert.ok(!h.writes.some((w) => w.table === "phone_sync_runs" && w.v.status === "success"));
      assert.ok(!h.requests.some((r) => r.url.includes("phone-process-pipeline")));
      const final = h.writes.find((w) => w.table === "phone_sync_runs" && w.op === "update");
      assert.equal(final.v.metadata.window_complete, false);
      assert.equal(final.v.metadata.publication_unconfirmed, true);
    }
  });
  test(`${name} respects a database pause or account change after its last application check`, async () => {
    for (const code of ["learn_capture_paused", "phone_account_unavailable"]) {
      const h = await harness(name, {
        providerPage: () => ({ items: [{ callId: "c1", id: "r1" }] }),
        publicationResponse: () => ({ data: null, error: { code: "PT409", message: code } }),
      });
      const r = await h.run({});
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error.code, code);
      assert.ok(!h.writes.some((w) => w.v.status === "success"));
      assert.equal(h.requests.length, 1);
    }
  });
}

test("recording follow-on processing uses only database-confirmed new recording IDs", async () => {
  const h = await harness("simwood-sync-recordings", {
    providerPage: () => ({ items: [{ id: "old-provider-id" }, { id: "new-provider-id" }] }),
    publicationResponse: (a) => ({
      data: {
        version: "learn-phone-page/1",
        tenantId: a.p_tenant,
        runId: a.p_run,
        page: a.p_page,
        kind: a.p_kind,
        recordsProcessed: 2,
        newRecordingIds: [id(8)],
      },
      error: null,
    }),
    childResponses: { "phone-process-pipeline": { body: { success: true } } },
  });
  assert.equal((await h.run({})).status, 200);
  const children = h.requests.filter((r) => r.url.includes("phone-process-pipeline"));
  assert.equal(children.length, 1);
  const input = JSON.parse(children[0].options.body);
  assert.equal(input.recording_id, id(8));
  assert.equal(input.tenant_id, tenant);
  assert.equal(input.force, false);
});

test("manual recovery refuses duplicate, failed creation and lost claim before any pipeline request", async () => {
  for (const opts of [
    { recoveryJobCreate: "duplicate" },
    { recoveryJobCreate: "error" },
    { recoveryClaimMissing: true },
  ]) {
    const h = await harness("phone-process-pending", opts);
    const r = await h.run({});
    assert.equal(r.status, opts.recoveryJobCreate === "duplicate" ? 409 : 503);
    assert.equal(h.requests.length, 0);
    assert.ok(!h.writes.some((w) => w.v.status === "succeeded"));
  }
});
test("manual recovery persists partial failure as failed and missing settlement as unconfirmed", async () => {
  const opts = {
    pendingRows: [{ id: id(5), tenant_id: tenant, stage: "transcribe" }],
    childResponses: {
      "phone-process-pipeline": {
        status: 503,
        body: {
          success: false,
          error: { code: "provider_timeout", message: "Unavailable" },
          failed_step: "transcribe",
        },
      },
    },
  };
  const h = await harness("phone-process-pending", opts);
  const r = await h.run({});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).success, false);
  assert.ok(
    h.writes.some(
      (w) => w.table === "platform_jobs" && w.v.status === "failed" && w.v.result.failed === 1,
    ),
  );
  assert.ok(!h.writes.some((w) => w.v.status === "succeeded"));
  const lost = await harness("phone-process-pending", { recoverySettleMissing: true });
  const response = await lost.run({});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "phone_job_unconfirmed");
});

for (const name of ["simwood-sync-calls", "simwood-sync-recordings"]) {
  test(`${name} rejects an empty time range before opening a run or contacting the provider`, async () => {
    const h = await harness(name);
    const r = await h.run({ from: "2026-10-10T00:00:00Z", to: "2026-10-10T00:00:00Z" });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "invalid_range");
    assert.equal(h.requests.length, 0);
    assert.equal(h.writes.length, 0);
  });
  test(`${name} confirms final page counts, scope and window without a direct success write`, async () => {
    const h = await harness(name, { providerPage: () => ({ items: [] }) });
    const r = await h.run({});
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.success, true);
    const writes = h.writes.filter((w) => w.table === "learn_phone_complete_import");
    assert.equal(writes.length, 1);
    const a = writes[0].v;
    assert.equal(a.p_tenant, tenant);
    assert.equal(a.p_run, id(4));
    assert.equal(a.p_account, id(2));
    assert.equal(a.p_connector, id(3));
    assert.equal(a.p_customer, "3950");
    assert.equal(a.p_pages, 1);
    assert.equal(a.p_records, 0);
    assert.equal(a.p_metadata.from, body.from);
    assert.equal(a.p_metadata.to, body.to);
    assert.equal(a.p_metadata.window_complete, true);
    assert.ok(!h.writes.some((w) => w.table === "phone_sync_runs" && w.op === "update"));
  });
  test(`${name} leaves unknown completion intact and starts no processing`, async () => {
    const faults = [
      () => {
        throw Error("PRIVATE_TRANSPORT_DETAIL");
      },
      () => ({ data: null, error: { code: "XX000", message: "PRIVATE_DB_DETAIL" } }),
      () => ({ data: null, error: null }),
      ...Object.entries({
        version: "other",
        tenantId: id(50),
        runId: id(50),
        accountId: id(50),
        connectorId: id(50),
        customerId: "9999",
        kind: "other",
        pages: 99,
        recordsProcessed: 99,
        from: "wrong",
        to: "wrong",
        windowComplete: false,
      }).map(([k, v]) => (a) => ({ data: { ...completionReceipt(a), [k]: v }, error: null })),
    ];
    for (const fault of faults) {
      const h = await harness(name, {
        providerPage: () => ({ items: [{ callId: "c1", id: "r1" }] }),
        publicationResponse: (a) => ({
          data: {
            version: "learn-phone-page/1",
            tenantId: a.p_tenant,
            runId: a.p_run,
            page: a.p_page,
            kind: a.p_kind,
            recordsProcessed: 1,
            newRecordingIds: a.p_kind === "recordings" ? [id(8)] : [],
          },
          error: null,
        }),
        completionResponse: fault,
      });
      const r = await h.run({});
      const body = await r.json();
      assert.equal(r.status, 503);
      assert.equal(body.error.code, "phone_completion_unconfirmed");
      assert.ok(!JSON.stringify(body).includes("PRIVATE_"));
      assert.equal(h.writes.filter((w) => w.table === "learn_phone_complete_import").length, 1);
      assert.ok(!h.writes.some((w) => w.table === "phone_sync_runs" && w.op === "update"));
      assert.ok(!h.writes.some((w) => w.table === "audit_logs" && w.v.status === "success"));
      assert.ok(!h.requests.some((r) => r.url.includes("phone-process-pipeline")));
    }
  });
  test(`${name} stops when final database admission detects pause or rebind`, async () => {
    for (const code of ["learn_capture_paused", "phone_account_unavailable"]) {
      const h = await harness(name, {
        completionResponse: () => ({ data: null, error: { code: "PT409", message: code } }),
      });
      const r = await h.run({});
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error.code, code);
      const failed = h.writes.find((w) => w.table === "phone_sync_runs" && w.op === "update");
      assert.ok(failed.filters.some(([k, v]) => k === "status" && v === "running"));
      assert.ok(failed.filters.some(([k, v]) => k === "tenant_id" && v === tenant));
      assert.ok(!h.requests.some((r) => r.url.includes("phone-process-pipeline")));
    }
  });
}

test("phone scheduler stops before untracked work and on a lost job claim", async () => {
  for (const opts of [
    { recoveryJobCreate: "duplicate" },
    { recoveryJobCreate: "error" },
    { recoveryClaimMissing: true },
    { scheduleRunMissing: true },
  ]) {
    const h = await harness("phone-scheduled-sync", opts);
    const body = await (await h.run({})).json();
    assert.equal(body.results[0].ok, false);
    assert.equal(h.requests.length, 0);
    assert.ok(!h.writes.some((w) => w.table === "learn_phone_settle_schedule"));
  }
  const h = await harness("phone-scheduled-sync", {
    scheduleHeartbeatMissing: 2,
    childResponses: { "simwood-sync-calls": childSuccess },
  });
  assert.equal((await (await h.run({})).json()).results[0].error, "phone_schedule_job_unconfirmed");
  assert.equal(h.requests.length, 1);
  assert.ok(!h.writes.some((w) => w.table === "learn_phone_settle_schedule"));
});
test("phone scheduler rejects invalid/future cursor and missing account revision before work", async () => {
  for (const fields of [
    { sync_cursor: { last_synced_until: "not-a-date" } },
    { sync_cursor: { last_synced_until: 12 } },
    { sync_cursor: [] },
    { sync_cursor: "bad" },
    { sync_cursor: { last_synced_until: "2999-01-01T00:00:00Z" } },
    { updated_at: null },
  ]) {
    const h = await harness("phone-scheduled-sync", { accounts: [{ ...account(), ...fields }] });
    assert.equal((await (await h.run({})).json()).results[0].ok, false);
    assert.equal(h.requests.length, 0);
    assert.equal(h.writes.length, 0);
  }
});
test("phone scheduler never trusts a truthy success, wrong HTTP/window/customer, or missing completion", async () => {
  for (const patch of [
    { success: "true" },
    { window_complete: false },
    { from: "wrong" },
    { to: "wrong" },
    { customer_id: "wrong" },
    { sync_run_id: "bad" },
    { records_processed: -1 },
    { records_processed: 1.5 },
  ]) {
    const h = await harness("phone-scheduled-sync", {
      childResponses: {
        "simwood-sync-calls": (input, name) => ({
          body: { ...childSuccess(input, name).body, ...patch },
        }),
        "simwood-sync-recordings": childSuccess,
      },
    });
    const body = await (await h.run({})).json();
    assert.equal(body.success, false);
    const settlement = h.writes.find((w) => w.table === "learn_phone_settle_schedule");
    assert.equal(settlement.v.p_outcome, "failed");
    assert.equal(settlement.v.p_errors.calls, "phone_child_unconfirmed");
  }
  const h = await harness("phone-scheduled-sync", {
    childResponses: {
      "simwood-sync-calls": (input, name) => ({ status: 503, ...childSuccess(input, name) }),
      "simwood-sync-recordings": childSuccess,
    },
  });
  assert.equal((await (await h.run({})).json()).success, false);
});
test("phone scheduler never overwrites an unknown or mismatched atomic settlement", async () => {
  const faults = [
    () => {
      throw Error("PRIVATE");
    },
    () => ({ data: null, error: { message: "PRIVATE" } }),
    () => ({ data: null, error: null }),
    ...Object.entries({
      version: "wrong",
      tenantId: id(99),
      runId: id(99),
      accountId: id(99),
      connectorId: id(99),
      customerId: "other",
      jobId: id(99),
      outcome: "failed",
      callsRunId: id(99),
      recordingsRunId: id(99),
      from: "wrong",
      to: "wrong",
      cursorAdvanced: false,
      callsProcessed: -1,
      recordingsProcessed: 1.5,
    }).map(([k, v]) => (a, r) => ({ data: { ...r, [k]: v }, error: null })),
  ];
  for (const scheduleResponse of faults) {
    const h = await harness("phone-scheduled-sync", {
      scheduleResponse,
      childResponses: {
        "simwood-sync-calls": childSuccess,
        "simwood-sync-recordings": childSuccess,
      },
    });
    const body = await (await h.run({})).json();
    assert.equal(body.success, false);
    assert.equal(body.results[0].error, "phone_schedule_unconfirmed");
    assert.ok(!JSON.stringify(body).includes("PRIVATE"));
    assert.equal(h.writes.filter((w) => w.table === "learn_phone_settle_schedule").length, 1);
    assert.ok(!h.writes.some((w) => ["connector_accounts", "tenant_connectors"].includes(w.table)));
    assert.ok(
      !h.writes.some(
        (w) => w.v.status === "succeeded" || w.v.status === "failed" || w.v.status === "cancelled",
      ),
    );
  }
});
