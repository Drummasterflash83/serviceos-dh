import { test } from "node:test";
import assert from "node:assert/strict";
import { runMicrosoftCaptureJob } from "./microsoft_capture_job.ts";
import { MicrosoftJournalError, type MicrosoftJournalDb } from "./microsoft_capture_engine.ts";
import { beginMicrosoftFolderDiscovery } from "./microsoft_mail_folders.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const claim = { tenantId: id(1), jobId: id(2), claimedBy: "worker", attemptCount: 1 };
const completion = () => ({
  contract: "microsoft-job-settlement/1",
  state: "completed",
  tenantId: id(1),
  jobId: id(2),
  sourceReceiptId: id(3),
  successorId: null,
  observationsStored: 0,
  mailboxCoverage: "unverified",
});
const error = (e: unknown) =>
  e instanceof MicrosoftJournalError &&
  e.code === "settlement_unconfirmed" &&
  !e.message.includes("PRIVATE");
function fixture() {
  let providerCalls = 0;
  const calls: string[] = [];
  let settled = false;
  let lose = false;
  const answer: any = completion();
  const db: MicrosoftJournalDb = {
    async rpc(name, args) {
      calls.push(name + (name.endsWith("_settle") ? `:${args.p_apply}` : ""));
      if (name.endsWith("_settle")) {
        if (args.p_apply) {
          settled = true;
          if (lose) return { data: null, error: { message: "PRIVATE" } };
        }
        return {
          error: null,
          data: settled
            ? answer
            : { contract: answer.contract, state: "pending", tenantId: id(1), jobId: id(2) },
        };
      }
      if (name.endsWith("_job"))
        return {
          error: null,
          data: {
            contract: "microsoft-journal-job/1",
            tenantId: id(1),
            jobId: id(2),
            jobType: "email.microsoft_discovery",
            payload: {
              email_account_id: id(4),
              mailbox_id: id(5),
              binding_id: id(6),
              kind: "folders",
              folder_id: "",
            },
            receipt: null,
          },
        };
      if (name.endsWith("_open"))
        return {
          error: null,
          data: {
            contract: "microsoft-journal-stream/1",
            tenantId: id(1),
            streamId: id(7),
            revision: "0",
            checkpoint: beginMicrosoftFolderDiscovery(
              { tenantId: id(1), accountId: id(4), mailboxId: id(5) },
              25,
            ),
          },
        };
      assert.equal(name, "learn_microsoft_journal_commit");
      return {
        error: null,
        data: {
          contract: "microsoft-journal-receipt/1",
          tenantId: id(1),
          streamId: id(7),
          requestId: id(3),
          revision: "1",
          recordedAt: "2026-10-11T06:00:00Z",
        },
      };
    },
  };
  const ports = {
    accessToken: async () => "PRIVATE",
    requestId: () => id(3),
    fetcher: (async () => {
      providerCalls++;
      return Response.json({ value: [] });
    }) as typeof fetch,
  };
  return {
    db,
    ports,
    calls,
    answer,
    set lose(v: boolean) {
      lose = v;
    },
    set settled(v: boolean) {
      settled = v;
    },
    get providerCalls() {
      return providerCalls;
    },
  };
}
test("source page commits before atomic queue completion; no generic continuation is returned", async () => {
  const f = fixture();
  const result = await runMicrosoftCaptureJob(f.db, claim, f.ports);
  assert.deepEqual(result, completion());
  assert.deepEqual(f.calls, [
    "learn_microsoft_job_settle:false",
    "learn_microsoft_journal_job",
    "learn_microsoft_journal_open",
    "learn_microsoft_journal_commit",
    "learn_microsoft_job_settle:true",
  ]);
  assert.equal(f.providerCalls, 1);
});
test("lost settlement reply is recovered before page/token work on retry", async () => {
  const f = fixture();
  f.lose = true;
  await assert.rejects(runMicrosoftCaptureJob(f.db, claim, f.ports), error);
  const count = f.calls.length;
  assert.deepEqual(await runMicrosoftCaptureJob(f.db, claim, f.ports), completion());
  assert.deepEqual(f.calls.slice(count), ["learn_microsoft_job_settle:false"]);
  assert.equal(f.providerCalls, 1);
});
test("foreign, malformed and self-referential completion receipts remain unconfirmed", async () => {
  for (const patch of [
    { tenantId: id(99) },
    { jobId: id(99) },
    { successorId: id(2) },
    { sourceReceiptId: null, observationsStored: 1 },
    { sourceReceiptId: null, successorId: id(99) },
    { mailboxCoverage: "complete" },
    { observationsStored: 1001 },
  ]) {
    const f = fixture();
    f.settled = true;
    Object.assign(f.answer, patch);
    await assert.rejects(runMicrosoftCaptureJob(f.db, claim, f.ports), error);
    assert.equal(f.providerCalls, 0);
  }
});
test("new completion must agree with the page receipt and observation count", async () => {
  for (const patch of [{ sourceReceiptId: id(99) }, { observationsStored: 1 }]) {
    const f = fixture();
    Object.assign(f.answer, patch);
    await assert.rejects(runMicrosoftCaptureJob(f.db, claim, f.ports), error);
    assert.equal(f.providerCalls, 1);
  }
});
test("failed source storage cannot trigger job completion", async () => {
  const f = fixture(),
    base = f.db.rpc;
  f.db.rpc = async (name, args) =>
    name.endsWith("_commit") ? { data: null, error: { message: "PRIVATE" } } : base(name, args);
  await assert.rejects(
    runMicrosoftCaptureJob(f.db, claim, f.ports),
    (e) => e instanceof MicrosoftJournalError && e.code === "commit_unconfirmed",
  );
  assert.equal(f.calls.includes("learn_microsoft_job_settle:true"), false);
});
test("pending after apply is not completion and private errors are sanitized", async () => {
  const f = fixture(),
    base = f.db.rpc;
  f.db.rpc = async (name, args) =>
    name.endsWith("_settle") && args.p_apply
      ? {
          data: {
            contract: "microsoft-job-settlement/1",
            tenantId: id(1),
            jobId: id(2),
            state: "pending",
          },
          error: null,
        }
      : base(name, args);
  await assert.rejects(runMicrosoftCaptureJob(f.db, claim, f.ports), error);
  const g = fixture();
  g.db.rpc = async () => {
    throw Error("PRIVATE result");
  };
  await assert.rejects(runMicrosoftCaptureJob(g.db, claim, g.ports), error);
  assert.equal(g.providerCalls, 0);
});
