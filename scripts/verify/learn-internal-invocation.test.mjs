import { test } from "node:test";
import assert from "node:assert/strict";
import { invokeFunction } from "../../supabase/functions/_shared/phone_pipeline.ts";

test("internal calls require runtime service authority before attaching the stable binding", async () => {
  const previousDeno = globalThis.Deno;
  const previousFetch = globalThis.fetch;
  const calls = [];
  const env = {
    SUPABASE_URL: "https://synthetic.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "runtime-service",
    SERVICEOS_INTERNAL_KEY: "stable-internal",
  };
  globalThis.Deno = { env: { get: (name) => env[name] } };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true });
  };
  try {
    for (const token of ["", "user-session", "stable-internal"])
      assert.deepEqual(await invokeFunction("synthetic-target", { tenant_id: "tenant" }, token), {
        status: 0,
        json: null,
      });
    assert.equal(calls.length, 0);
    assert.equal(
      (await invokeFunction("synthetic-target", { tenant_id: "tenant" }, "runtime-service")).status,
      200,
    );
    assert.deepEqual(calls[0].options.headers, {
      "content-type": "application/json",
      Authorization: "Bearer runtime-service",
      apikey: "runtime-service",
      "x-serviceos-internal-key": "stable-internal",
      "x-internal-tenant-id": "tenant",
    });
    delete env.SERVICEOS_INTERNAL_KEY;
    await invokeFunction("synthetic-target", { tenant_id: "tenant" }, "runtime-service");
    assert.equal(calls[1].options.headers["x-serviceos-internal-key"], "runtime-service");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = previousDeno;
  }
});
