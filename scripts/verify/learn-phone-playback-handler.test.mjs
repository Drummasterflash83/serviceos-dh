import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { webcrypto } from "node:crypto";
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
async function harness({ role = "owner", authError = false, auditError = false } = {}) {
  let handler;
  const calls = [];
  const target = {
    version: "learn-phone-playback-target/1",
    tenant_id: id(1),
    recording_id: id(3),
    request_id: null,
    storage_path: id(1) + "/a.wav",
    source_digest: "a".repeat(64),
  };
  const db = {
    auth: {
      getUser: async (token) => {
        calls.push("auth");
        return {
          data: { user: { id: id(2) } },
          error: authError || token !== "user-token" ? {} : null,
        };
      },
    },
    from: (name) => {
      assert.equal(name, "profiles");
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { tenant_id: id(1), role }, error: null }),
      };
      return q;
    },
    rpc: async (name, args) => {
      calls.push(args.p_request ? "audit" : "inspect");
      assert.equal(args.p_actor, id(2));
      return {
        data: { ...target, request_id: args.p_request ?? null },
        error: args.p_request && auditError ? {} : null,
      };
    },
    storage: {
      getBucket: async () => ({ data: { id: "phone-recordings", public: false }, error: null }),
      from: () => ({
        createSignedUrl: async (path, seconds) => {
          calls.push("sign");
          return {
            data: {
              signedUrl:
                "https://test.example/storage/v1/object/sign/phone-recordings/" +
                path +
                "?token=synthetic",
            },
            error: null,
          };
        },
      }),
    },
  };
  const context = vm.createContext({
    Request,
    Response,
    TextDecoder,
    Uint8Array,
    URL,
    Date,
    crypto: webcrypto,
    Deno: {
      serve: (fn) => {
        handler = fn;
      },
      env: {
        get: (k) =>
          ({ SUPABASE_URL: "https://test.example", SUPABASE_SERVICE_ROLE_KEY: "service-token" })[k],
      },
    },
  });
  const cache = new Map();
  const readback = process.env.PHONE_PLAYBACK_READBACK_ROOT;
  const entry = resolve(
    readback ? readback + "/index.ts" : "supabase/functions/learn-phone-playback/index.ts",
  );
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = new vm.SourceTextModule(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
      { context, identifier: file },
    );
    cache.set(file, mod);
    await mod.link((spec, parent) =>
      spec.startsWith("https://")
        ? new vm.SyntheticModule(
            ["createClient"],
            function () {
              this.setExport("createClient", () => db);
            },
            { context },
          )
        : load(
            resolve(
              dirname(parent.identifier),
              readback && parent.identifier === entry && spec.startsWith("../_shared/")
                ? "functions/" + spec.slice(3)
                : spec,
            ),
          ),
    );
    return mod;
  }
  await (await load(entry)).evaluate();
  return {
    calls,
    run: (body = { tenant_id: id(1), recording_id: id(3) }, headers = {}) =>
      handler(
        new Request("https://test.example/functions/v1/learn-phone-playback", {
          method: "POST",
          headers: { Authorization: "Bearer user-token", ...headers },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      ),
  };
}
test("actual handler authenticates user, signs retained audio, audits and returns no-store", async () => {
  const h = await harness(),
    r = await h.run();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(h.calls, ["auth", "inspect", "sign", "audit"]);
  assert.equal((await r.json()).recording_id, id(3));
});
test("actual handler denies service impersonation, foreign tenants, viewers and invalid auth", async () => {
  for (const [options, body, headers] of [
    [{}, undefined, { "x-internal-tenant-id": id(1) }],
    [{}, undefined, { "x-serviceos-internal-key": "service-token" }],
    [{}, undefined, { Authorization: "Bearer service-token" }],
    [{ role: "viewer" }, undefined, {}],
    [{ authError: true }, undefined, {}],
    [{}, { tenant_id: id(9), recording_id: id(3) }, {}],
  ]) {
    const h = await harness(options),
      r = await h.run(body, headers);
    assert.ok([401, 403].includes(r.status));
    assert.ok(!h.calls.includes("sign"));
  }
});
test("bounded body and failed audit cannot expose a signed URL", async () => {
  const large = await harness(),
    r = await large.run("x".repeat(3000));
  assert.equal(r.status, 400);
  assert.ok(!large.calls.includes("sign"));
  const failed = await harness({ auditError: true }),
    failure = await failed.run();
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /token|\.wav|storage_path/);
});
