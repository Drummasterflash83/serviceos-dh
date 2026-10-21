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
        let updating = false;
        const builder = new Proxy({}, {
          get(_, key) {
            return (...args) => {
              calls.push([key, ...args]);
              if (key === "update") updating = true;
              if (key === "limit") {
                if (mode === "generic_error") throw Error("Synthetic transport failure");
                return Promise.resolve({ data: [{ id: "unrelated", attempt_count: 1, max_attempts: 5 }], error: null });
              }
              if (key === "select" && updating)
                return Promise.resolve({ data: [{ id: "unrelated" }], error: null });
              return builder;
            };
          },
        });
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

test("expired leases dead-letter at the configured limit and reclaim earlier attempts", async () => {
  const changes = [];
  const client = {
    async rpc() { return { data: 0, error: null }; },
    from(table) {
      assert.equal(table, "platform_jobs");
      let change;
      const guards = [];
      const builder = new Proxy({}, {
        get(_, key) {
          return (...args) => {
            if (key === "update") change = args[0];
            if (["eq", "lt"].includes(key)) guards.push([key, ...args]);
            if (key === "limit") return Promise.resolve({ data: [
              { id: "exhausted", attempt_count: 8, max_attempts: 5 },
              { id: "retryable", attempt_count: 2, max_attempts: 5 },
            ], error: null });
            if (key === "select" && change) {
              changes.push({ change, guards });
              return Promise.resolve({ data: [{ id: "updated" }], error: null });
            }
            return builder;
          };
        },
      });
      return builder;
    },
  };
  assert.equal(await releaseExpiredLeases(client), 2);
  assert.deepEqual(changes.map(x => x.change.status), ["dead_letter", "retrying"]);
  assert.ok(changes[0].guards.some(x => x[0] === "eq" && x[1] === "attempt_count" && x[2] === 8));
  assert.ok(changes[1].guards.some(x => x[0] === "eq" && x[1] === "attempt_count" && x[2] === 2));
  assert.equal(changes[0].change.error_code, "lease_expired");
});
