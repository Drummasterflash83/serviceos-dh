import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadSlackThreadRecovery,
  resumeSlackThread,
  SlackThreadRecoveryError,
  type SlackThreadRecoveryRequest,
} from "./learn-slack-thread-recovery.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = {
  version: "learn-slack-thread-recovery/1",
  tenantId: id(1),
  accountId: id(2),
  teamId: "TTEST",
  channelId: "CTEST",
  importId: id(3),
  approvedAt: "2026-01-01T00:00:00Z",
  previousImportId: null,
  recoveryMode: null,
  parentTimestamp: "1767225700.000001",
  supersededBy: null,
  stateVersion: "a".repeat(64),
  stateValid: true,
  active: false,
  canContinue: true,
  canRestart: true,
  window: {
    start: "2026-01-01T00:00:00Z",
    end: "2026-01-02T00:00:00Z",
    pageLimit: 1,
    expiresAt: "2026-01-03T00:00:00Z",
  },
  progress: { pagesThisApproval: 1, complete: false, hasCursor: true },
  latestJob: {
    id: id(4),
    status: "succeeded",
    availableAt: null,
    errorCode: null,
    stopReason: "page_budget_exhausted",
  },
  coverage: "observed_thread_window",
};
const request: SlackThreadRecoveryRequest = {
  tenantId: id(1),
  accountId: id(2),
  requestId: id(5),
  importId: id(3),
  stateVersion: state.stateVersion,
  mode: "continue",
  maxPages: 2,
  reason: "Reviewed next pages",
};
const receipt = { requestId: id(5), accountId: id(2), previousImportId: id(3), jobId: id(6), reused: false };
const db = (data: unknown) => ({ rpc: async () => ({ data, error: null }) });
const kind = (expected: SlackThreadRecoveryError["kind"]) => (e: unknown) =>
  e instanceof SlackThreadRecoveryError && e.kind === expected;

test("thread recovery is company/account/import bound and removes unexpected private fields", async () => {
  const value = await loadSlackThreadRecovery(
    {
      rpc: async (name, args) => {
        assert.equal(name, "learn_slack_thread_recovery_read");
        assert.deepEqual(args, { p_tenant_id: id(1), p_import_id: id(3) });
        return {
          data: {
            ...state,
            checkpoint: { cursor: "private-provider-cursor" },
            secret_refs: {},
            progress: { ...state.progress, cursor: "private-provider-cursor" },
            latestJob: { ...state.latestJob, payload: {} },
          },
          error: null,
        };
      },
    },
    id(1),
    id(2),
    id(3),
  );
  assert.deepEqual(value, state);
  for (const change of [
    { tenantId: id(9) },
    { accountId: id(9) },
    { importId: id(9) },
    { parentTimestamp: "invalid" },
    { recoveryMode: "continue" },
    { previousImportId: id(3), recoveryMode: "continue" },
    { supersededBy: id(3), canContinue: false, canRestart: false },
    { version: "other" },
    { coverage: "all_history" },
    { stateVersion: "bad" },
  ])
    await assert.rejects(
      loadSlackThreadRecovery(db({ ...state, ...change }), id(1), id(2), id(3)),
      kind("unavailable"),
    );
});

test("invalid progress and contradictory recovery flags cannot become an actionable review", async () => {
  for (const change of [
    { active: true },
    { supersededBy: id(8) },
    { stateValid: false },
    { canRestart: false },
    { progress: { ...state.progress, pagesThisApproval: 2 } },
    { progress: { ...state.progress, pagesThisApproval: -1 } },
    { progress: { ...state.progress, complete: true } },
    { progress: { ...state.progress, hasCursor: false } },
    { window: { ...state.window, end: "2026-01-04T00:00:00Z" } },
    { latestJob: { ...state.latestJob, errorCode: "raw provider credentials" } },
  ])
    await assert.rejects(
      loadSlackThreadRecovery(db({ ...state, ...change }), id(1), id(2), id(3)),
      kind("unavailable"),
    );
  const restartOnly = {
    ...state,
    canContinue: false,
    progress: { ...state.progress, hasCursor: false },
  };
  assert.deepEqual(await loadSlackThreadRecovery(db(restartOnly), id(1), id(2), id(3)), restartOnly);
  const invalid = {
    ...state,
    stateValid: false,
    canContinue: false,
    canRestart: false,
    window: null,
    progress: null,
  };
  assert.deepEqual(await loadSlackThreadRecovery(db(invalid), id(1), id(2), id(3)), invalid);
});

test("a new approval reports its own page count and retains the previous approval identity", async () => {
  const recovered = {
    ...state,
    previousImportId: id(7),
    recoveryMode: "continue",
    active: true,
    canContinue: false,
    canRestart: false,
    progress: { pagesThisApproval: 0, complete: false, hasCursor: true },
    latestJob: { ...state.latestJob, status: "queued", stopReason: null },
  };
  assert.deepEqual(await loadSlackThreadRecovery(db(recovered), id(1), id(2), id(3)), recovered);
});

test("lost approval response retries the same reviewed identity and resolves the retained receipt", async () => {
  const calls: unknown[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "learn_slack_resume_thread");
      calls.push(args);
      if (calls.length === 1) throw Error("Network lost after commit");
      return { data: { ...receipt, reused: true }, error: null };
    },
  };
  await assert.rejects(resumeSlackThread(client, request), kind("uncertain"));
  assert.deepEqual(await resumeSlackThread(client, request), { ...receipt, reused: true });
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], {
    p_tenant_id: id(1),
    p_import_id: id(3),
    p_request_id: id(5),
    p_expected_state_version: state.stateVersion,
    p_mode: "continue",
    p_max_pages: 2,
    p_reason: request.reason,
  });
});

test("approval rejects invalid input before sending and binds its returned receipt", async () => {
  const never = {
    rpc: async () => {
      throw Error("Must not send");
    },
  };
  for (const change of [
    { requestId: "bad" },
    { accountId: "bad" },
    { importId: "bad" },
    { stateVersion: "bad" },
    { maxPages: 0 },
    { maxPages: 11 },
    { maxPages: 1.5 },
    { reason: " " },
    { reason: "a".repeat(1001) },
    { mode: "other" },
  ])
    await assert.rejects(
      resumeSlackThread(never, { ...request, ...change } as SlackThreadRecoveryRequest),
      kind("invalid"),
    );
  for (const change of [
    { requestId: id(8) },
    { accountId: id(8) },
    { previousImportId: id(8) },
    { jobId: "bad" },
    { reused: null },
  ])
    await assert.rejects(
      resumeSlackThread(db({ ...receipt, ...change }), request),
      kind("uncertain"),
    );
  assert.deepEqual(await resumeSlackThread(db(receipt), { ...request, mode: "restart" }), receipt);
});

test("rejected reviews and uncertain transport outcomes have different recovery actions", async () => {
  for (const [code, expected] of [
    ["42501", "forbidden"],
    ["PT409", "conflict"],
    ["55000", "unavailable"],
    ["22023", "invalid"],
    ["XX000", "uncertain"],
  ] as const)
    await assert.rejects(
      resumeSlackThread({ rpc: async () => ({ data: null, error: { code } }) }, request),
      kind(expected),
    );
});
