import { test } from "node:test";
import assert from "node:assert/strict";
import { createGmailPageStore } from "./gmail_page_store.ts";
import type { EmailCheckpoint, EmailScope } from "./email_ingestion_protocol.ts";
const scope: EmailScope = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  attemptId: "00000000-0000-4000-8000-000000000003",
  stream: "recent",
};
const checkpoint: EmailCheckpoint = {
  tenant_id: scope.tenantId,
  email_account_id: scope.accountId,
  stream: "recent",
  contract_version: 2,
  generation: "00000000-0000-4000-8000-000000000004",
  revision: "9007199254740993",
  owner_attempt_id: scope.attemptId,
  state: "claimed",
  continuation: { phase: "initialized", fetch_policy: "missing_only" },
  block_code: null,
};
const lease = { claimedBy: "synthetic-worker", attemptCount: 2 };
test("storage rejects wrong-scope acknowledgements and never retries an unknown result", async () => {
  let calls = 0;
  for (const kind of ["wrong_scope", "failure"]) {
    const store = createGmailPageStore(
      {
        rpc: async (_name, args) => {
          calls++;
          if (kind === "failure") throw Error("PRIVATE");
          return {
            data: {
              version: "learn-email-store/1",
              context: { ...(args.p_context as object), tenant_id: scope.accountId },
              existing_ids: [],
            },
            error: null,
          };
        },
      },
      scope,
      checkpoint,
      "mailbox@example.invalid",
      "missing_only",
      lease,
    );
    await assert.rejects(
      store.existingMessageIds(["m1"]),
      (e) =>
        e instanceof Error &&
        e.message.includes("could not be confirmed") &&
        !e.message.includes("PRIVATE"),
    );
  }
  assert.equal(calls, 2);
});
test("storage rejects duplicate or unrequested IDs and impossible write counts", async () => {
  for (const result of [
    { existing_ids: ["m1", "m1"] },
    { existing_ids: ["foreign"] },
    { thread_upsert_count: 1, message_upsert_count: 2 },
    { thread_upsert_count: 0, message_upsert_count: null },
  ]) {
    const store = createGmailPageStore(
      {
        rpc: async (_name, args) => ({
          data: { version: "learn-email-store/1", context: args.p_context, ...result },
          error: null,
        }),
      },
      scope,
      checkpoint,
      "mailbox@example.invalid",
      "missing_only",
      lease,
    );
    if ("existing_ids" in result)
      await assert.rejects(store.existingMessageIds(["m1"]), /could not be confirmed/);
    else await assert.rejects(store.savePage([{}], [{}]), /could not be confirmed/);
  }
});
test("storage captures exact revision and lease and refuses an unowned checkpoint before dispatch", async () => {
  const mutableScope = { ...scope },
    mutableCheckpoint = { ...checkpoint },
    mutableLease = { ...lease };
  let received: any;
  const store = createGmailPageStore(
    {
      rpc: async (_name, args) => {
        received = args;
        return {
          data: { version: "learn-email-store/1", context: args.p_context, existing_ids: [] },
          error: null,
        };
      },
    },
    mutableScope,
    mutableCheckpoint,
    "mailbox@example.invalid",
    "missing_only",
    mutableLease,
  );
  mutableScope.tenantId = scope.accountId;
  mutableCheckpoint.revision = "2";
  mutableLease.attemptCount = 3;
  await store.existingMessageIds(["m1"]);
  assert.equal(received.p_context.tenant_id, scope.tenantId);
  assert.equal(received.p_context.revision, "9007199254740993");
  assert.equal(received.p_claim, 2);
  assert.throws(
    () =>
      createGmailPageStore(
        {
          rpc: async () => {
            throw Error("unexpected");
          },
        },
        scope,
        { ...checkpoint, owner_attempt_id: null },
        "mailbox@example.invalid",
        "missing_only",
        lease,
      ),
    /current owned mailbox/,
  );
});
