import test from "node:test";
import assert from "node:assert/strict";
import { releaseExpiredLeases } from "../../supabase/functions/_shared/platform_queue.ts";

for (const mode of [
  "success",
  "recovery_error",
  "recovery_throw",
  "invalid_count",
  "generic_error",
]) {
  test(`voicemail recovery stays separate from generic reclaim: ${mode}`, async () => {
    const calls = [];
    const builder = new Proxy(
      {},
      {
        get(_, key) {
          return (...args) => {
            calls.push([key, ...args]);
            if (key === "select") {
              if (mode === "generic_error") throw Error("Synthetic transport failure");
              return Promise.resolve({ data: [{ id: "unrelated" }], error: null });
            }
            return builder;
          };
        },
      },
    );
    const client = {
      async rpc(name) {
        assert.equal(name, "voicemail_queue_recover");
        if (mode === "recovery_throw") throw Error("Synthetic recovery failure");
        return {
          data: mode === "invalid_count" ? "3" : 3,
          error: mode === "recovery_error" ? {} : null,
        };
      },
      from(table) {
        assert.equal(table, "platform_jobs");
        return builder;
      },
    };
    const count = await releaseExpiredLeases(client);
    assert.equal(count, mode === "success" ? 4 : mode === "generic_error" ? 3 : 1);
    assert.ok(
      calls.some(
        (c) => JSON.stringify(c) === JSON.stringify(["neq", "job_type", "phone.voicemail_import"]),
      ),
    );
    assert.ok(calls.some((c) => c[0] === "eq" && c[1] === "status" && c[2] === "running"));
    assert.ok(calls.some((c) => c[0] === "lt" && c[1] === "lease_expires_at"));
  });
}
