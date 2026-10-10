import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveOperatorInput,
  validateInputRequest,
  type OperatorInputRequest,
} from "./learn-operator-inputs.ts";
import { readSavedInput, resolveSavedInput } from "./learn-operator-input-outbox.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const definition = {
  kind: "resume_commusoft" as const,
  reason: "Review saved progress",
  account_id: id(4),
  approval_id: id(5),
  job_id: id(6),
  connection_id: id(7),
  revision: "2026-10-10T10:00:00Z",
  checkpoint: { approvalId: id(5), pages: 3, after: 150, complete: false },
  max_pages: 20,
  expires_at: "2026-10-10T12:00:00Z",
};
const request: OperatorInputRequest = {
  tenantId: id(1),
  actorId: id(2),
  requestId: id(3),
  definition,
};
const receipt = {
  tenant_id: id(1),
  request_id: id(3),
  state: "recorded",
  kind: "resume_commusoft",
  account_id: id(4),
  job_id: id(8),
  approval_id: id(5),
  checkpoint: definition.checkpoint,
};
test("continuation cannot inject a cursor shape, collection, secret, completed checkpoint or exhausted limit", () => {
  validateInputRequest(request);
  for (const changes of [
    { resource: "jobs" },
    { secret: "unexpected" },
    { max_pages: 3 },
    { max_pages: 10001 },
    { account_id: "invalid" },
    { checkpoint: { ...definition.checkpoint, after: "150" } },
    { checkpoint: { ...definition.checkpoint, complete: true } },
    { checkpoint: { ...definition.checkpoint, approvalId: id(9) } },
    { checkpoint: { ...definition.checkpoint, arbitrary: true } },
  ])
    assert.throws(() =>
      validateInputRequest({ ...request, definition: { ...definition, ...changes } }),
    );
});
test("continuation receipts bind the original account, approval and checkpoint, and require a new job", async () => {
  const result = await resolveOperatorInput(
    {
      rpc: async (name, args) => {
        assert.equal(name, "learn_operator_resume_commusoft");
        assert.deepEqual(args.p_definition, definition);
        return { data: receipt, error: null };
      },
    },
    request,
    "apply",
  );
  assert.equal(result.job_id, id(8));
  for (const changes of [
    { account_id: id(9) },
    { approval_id: id(9) },
    { job_id: id(6) },
    { checkpoint: { ...definition.checkpoint, after: 151 } },
    { kind: "start_commusoft" },
  ])
    await assert.rejects(
      resolveOperatorInput(
        { rpc: async () => ({ data: { ...receipt, ...changes }, error: null }) },
        request,
        "check",
      ),
    );
});
test("a lost continuation reply survives reload and recovers exactly once even after its expiry", async () => {
  const scope = { tenantId: id(1), actorId: id(2), backend: "https://synthetic.invalid" },
    memory = new Map<string, string>();
  const store = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v);
    },
    removeItem: (k: string) => {
      memory.delete(k);
    },
  };
  const lock = async <T>(_key: string, work: () => Promise<T>) => work();
  let committed = false,
    applies = 0;
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "learn_operator_resume_commusoft");
      if (committed) return { data: receipt, error: null };
      if (args.p_mode === "check")
        return { data: { tenant_id: id(1), request_id: id(3), state: "pending" }, error: null };
      applies++;
      committed = true;
      throw Error("Acknowledgement lost");
    },
  };
  const saved = {
    version: 1 as const,
    backend: scope.backend,
    request: { ...request, definition: { ...definition, expires_at: "2000-01-01T00:00:00Z" } },
  };
  await assert.rejects(resolveSavedInput(db, store, lock, scope, saved, "apply", () => true));
  const reloaded = readSavedInput(store, scope)!;
  assert.equal(reloaded.request.requestId, id(3));
  assert.equal(
    (await resolveSavedInput(db, store, lock, scope, reloaded, "check", () => true)).state,
    "recorded",
  );
  assert.equal(applies, 1);
  assert.equal(readSavedInput(store, scope), null);
});
