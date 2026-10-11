import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runMicrosoftCapturePage,
  MicrosoftJournalError,
  type MicrosoftJournalDb,
} from "./microsoft_capture_engine.ts";
import { beginMicrosoftFolderDiscovery } from "./microsoft_mail_folders.ts";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const claim = { tenantId: uid(1), jobId: uid(2), claimedBy: "worker", attemptCount: 1 };
const scope = { tenantId: uid(1), accountId: uid(3), mailboxId: uid(4) };
function fixture() {
  const job: any = {
    contract: "microsoft-journal-job/1",
    tenantId: uid(1),
    jobId: uid(2),
    jobType: "email.microsoft_discovery",
    payload: {
      email_account_id: uid(3),
      mailbox_id: uid(4),
      binding_id: uid(5),
      kind: "folders",
      folder_id: "",
    },
    receipt: null,
  };
  const stream: any = {
    contract: "microsoft-journal-stream/1",
    tenantId: uid(1),
    streamId: uid(6),
    revision: "0",
    checkpoint: beginMicrosoftFolderDiscovery(scope, 25),
  };
  const saved: any = {
    contract: "microsoft-journal-receipt/1",
    tenantId: uid(1),
    streamId: uid(6),
    requestId: uid(7),
    revision: "1",
    recordedAt: "2026-10-11T06:00:00.123456+00:00",
  };
  let tokens = 0,
    fetches = 0;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: MicrosoftJournalDb = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: structuredClone(
          name.endsWith("_job") ? job : name.endsWith("_open") ? stream : saved,
        ),
        error: null,
      };
    },
  };
  const ports = {
    requestId: () => uid(7),
    accessToken: async () => {
      tokens++;
      return "PRIVATE";
    },
    fetcher: (async () => {
      fetches++;
      return Response.json({ value: [] });
    }) as typeof fetch,
  };
  return {
    job,
    stream,
    saved,
    calls,
    db,
    ports,
    get tokens() {
      return tokens;
    },
    get fetches() {
      return fetches;
    },
  };
}
const error = (code: string) => (e: unknown) => {
  assert.ok(e instanceof MicrosoftJournalError);
  assert.equal(e.code, code);
  assert.doesNotMatch(e.message, /PRIVATE/);
  return true;
};

test("one page is fetched, submitted once and reported only after matching journal receipt", async () => {
  const f = fixture();
  const result = await runMicrosoftCapturePage(f.db, claim, f.ports);
  assert.equal(result.state, "source_page_stored");
  if (result.state !== "source_page_stored") assert.fail();
  assert.equal(result.recovered, false);
  assert.equal(result.observationsStored, 0);
  assert.equal(result.needsContinuation, false);
  assert.equal(result.mailboxCoverage, "unverified");
  assert.deepEqual(
    f.calls.map((c) => c.name),
    [
      "learn_microsoft_journal_job",
      "learn_microsoft_journal_open",
      "learn_microsoft_journal_commit",
    ],
  );
  assert.equal(f.fetches, 1);
  assert.equal(f.tokens, 1);
  assert.equal((f.calls[2].args.p_before as any).pending.length, 1);
  assert.equal((f.calls[2].args.p_after as any).pending.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|requestUrl|checkpoint/);
});

test("saved job receipt returns without opening a stream, acquiring credentials or fetching mail", async () => {
  const f = fixture();
  f.job.receipt = { ...f.saved, checkpoint: f.stream.checkpoint, observationsStored: 1 };
  const result = await runMicrosoftCapturePage(f.db, claim, f.ports);
  assert.equal(result.state, "source_page_stored");
  if (result.state !== "source_page_stored") assert.fail();
  assert.equal(result.recovered, true);
  assert.equal(result.needsContinuation, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.tokens, 0);
  assert.equal(f.fetches, 0);
});

test("foreign or malformed job identity fails before token access", async () => {
  for (const change of [
    (j: any) => (j.tenantId = uid(99)),
    (j: any) => (j.jobId = uid(99)),
    (j: any) => (j.payload.kind = "messages"),
    (j: any) => (j.payload.extra = "PRIVATE"),
    (j: any) => (j.payload.mailbox_id = "PRIVATE"),
  ]) {
    const f = fixture();
    change(f.job);
    await assert.rejects(runMicrosoftCapturePage(f.db, claim, f.ports), error("invalid_job"));
    assert.equal(f.tokens, 0);
    assert.equal(f.fetches, 0);
  }
});

test("foreign, malformed and unsafe-range stream checkpoints cannot reach provider", async () => {
  for (const change of [
    (s: any) => (s.checkpoint.scope.tenantId = uid(99)),
    (s: any) => (s.revision = "9007199254740992"),
    (s: any) => (s.checkpoint.pending = []),
    (s: any) => (s.streamId = "PRIVATE"),
  ]) {
    const f = fixture();
    change(f.stream);
    await assert.rejects(
      runMicrosoftCapturePage(f.db, claim, f.ports),
      error("invalid_checkpoint"),
    );
    assert.equal(f.tokens, 0);
    assert.equal(f.fetches, 0);
  }
});

test("missing, foreign or inconsistent commit acknowledgements remain unconfirmed without retrying", async () => {
  for (const change of [
    (s: any) => (s.tenantId = uid(99)),
    (s: any) => (s.streamId = uid(99)),
    (s: any) => (s.requestId = uid(99)),
    (s: any) => (s.revision = "2"),
    (s: any) => (s.recordedAt = "PRIVATE"),
  ]) {
    const f = fixture();
    change(f.saved);
    await assert.rejects(
      runMicrosoftCapturePage(f.db, claim, f.ports),
      error("commit_unconfirmed"),
    );
    assert.equal(f.calls.length, 3);
    assert.equal(f.fetches, 1);
  }
});

test("RPC failures and credential-provider exceptions are sanitized and never report stored evidence", async () => {
  for (const failure of [
    "learn_microsoft_journal_job",
    "learn_microsoft_journal_open",
    "learn_microsoft_journal_commit",
  ]) {
    const f = fixture(),
      original = f.db.rpc;
    f.db.rpc = async (name, args) => {
      if (name === failure) throw Error("PRIVATE response");
      return original(name, args);
    };
    await assert.rejects(
      runMicrosoftCapturePage(f.db, claim, f.ports),
      error(
        failure.endsWith("_job")
          ? "job_unconfirmed"
          : failure.endsWith("_open")
            ? "stream_unconfirmed"
            : "commit_unconfirmed",
      ),
    );
  }
  const f = fixture();
  f.ports.accessToken = async () => {
    throw Error("PRIVATE credential");
  };
  await assert.rejects(
    runMicrosoftCapturePage(f.db, claim, f.ports),
    error("authorization_unconfirmed"),
  );
  assert.equal(f.fetches, 0);
});

test("exhausted discovery does not acquire a token or invent a page receipt", async () => {
  const f = fixture();
  f.stream.checkpoint.pending = [];
  f.stream.checkpoint.completedParents = [null];
  const result = await runMicrosoftCapturePage(f.db, claim, f.ports);
  assert.deepEqual(result, {
    state: "discovery_exhausted",
    jobId: claim.jobId,
    mailboxCoverage: "unverified",
  });
  assert.equal(f.tokens, 0);
  assert.equal(f.calls.length, 2);
});

test("caller and credential-port mutations cannot change the journal job or scope", async () => {
  const f = fixture(),
    input = structuredClone(claim),
    original = f.db.rpc;
  f.db.rpc = async (name, args) => {
    input.tenantId = uid(99);
    input.jobId = uid(99);
    return original(name, args);
  };
  f.ports.accessToken = async (...args: any[]) => {
    args[0].tenantId = uid(99);
    args[0].mailboxId = uid(99);
    args[1].jobId = uid(99);
    return "PRIVATE";
  };
  await runMicrosoftCapturePage(f.db, input, f.ports);
  assert.equal(f.calls[2].args.p_tenant, claim.tenantId);
  assert.equal(f.calls[2].args.p_job, claim.jobId);
  assert.equal((f.calls[2].args.p_page as any).scope.mailboxId, scope.mailboxId);
});

test("malformed recovered receipt and checkpoint refuse further work", async () => {
  for (const change of [
    (r: any) => (r.observationsStored = 1001),
    (r: any) => (r.checkpoint.scope.accountId = uid(99)),
    (r: any) => (r.revision = "0"),
  ]) {
    const f = fixture();
    f.job.receipt = { ...f.saved, checkpoint: f.stream.checkpoint, observationsStored: 1 };
    change(f.job.receipt);
    await assert.rejects(
      runMicrosoftCapturePage(f.db, claim, f.ports),
      (e) => e instanceof MicrosoftJournalError,
    );
    assert.equal(f.tokens, 0);
    assert.equal(f.calls.length, 1);
  }
});

test("request identity failures cannot leak private details or submit an unrepeatable write", async () => {
  const f = fixture();
  f.ports.requestId = () => {
    throw Error("PRIVATE identity error");
  };
  await assert.rejects(runMicrosoftCapturePage(f.db, claim, f.ports), error("invalid_request_id"));
  assert.equal(f.calls.length, 2);
});
