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
  } = {},
) {
  const requests = [],
    writes = [],
    uploads = [];
  let handler;
  const db = {
    from(table) {
      let op = "read";
      const result = () =>
        table === "connector_accounts"
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
      const q = {
        select: () => q,
        eq: () => q,
        limit: () => q,
        in: () => q,
        insert(v) {
          op = "insert";
          writes.push({ table, op, v });
          return q;
        },
        update(v) {
          op = "update";
          writes.push({ table, op, v });
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
