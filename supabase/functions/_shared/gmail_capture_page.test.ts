import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readGmailCaptureBoundary,
  readGmailCapturePage,
  persistGmailCapturePage,
  GmailCaptureError,
  type GmailPageRequest,
  type GmailPageStore,
} from "./gmail_capture_page.ts";
const tenantId = "00000000-0000-4000-8000-000000000001",
  mailbox = "person@example.invalid";
const request: GmailPageRequest = {
  mode: "reconcile",
  label: "INBOX",
  pageSize: 25,
  pageToken: null,
  originHistoryId: null,
};
const raw = (id: string) => ({
  id,
  threadId: "thread1",
  internalDate: "1700000000000",
  historyId: "18446744073709551614",
  labelIds: ["INBOX"],
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Sender <sender@example.invalid>" },
      { name: "To", value: mailbox },
      { name: "Subject", value: "Synthetic" },
    ],
    body: { data: btoa("Synthetic body") },
  },
});
function provider(body: unknown, status = 200) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  return {
    calls,
    fetcher: (async (url: any, init?: RequestInit) => {
      calls.push({ url: new URL(String(url)), init });
      return Response.json(body, { status });
    }) as typeof fetch,
  };
}
const isError =
  (code: string, unknown = false) =>
  (e: unknown) =>
    e instanceof GmailCaptureError &&
    e.code === code &&
    e.persistenceUnknown === unknown &&
    !e.message.includes("PRIVATE");
function store(existing: string[] = []) {
  const writes: { kind: string; rows: Record<string, unknown>[] }[] = [];
  return {
    writes,
    port: {
      existingMessageIds: async () => existing,
      savePage: async (threads, messages) => {
        writes.push({ kind: "threads", rows: threads }, { kind: "messages", rows: messages });
        return { thread_upsert_count: threads.length, message_upsert_count: messages.length };
      },
    },
  } satisfies { writes: typeof writes; port: GmailPageStore };
}
const page = { ids: ["m1", "m2"], nextPageToken: "page2", exhausted: false };
test("historical listing remains unlabelled and incomplete while a token exists", async () => {
  const p = provider({ nextPageToken: "next" });
  assert.deepEqual(
    await readGmailCapturePage(
      "synthetic",
      {
        ...request,
        mode: "historical",
        label: null,
      },
      p.fetcher,
    ),
    { ids: [], nextPageToken: "next", exhausted: false },
  );
  assert.equal(p.calls[0].url.searchParams.has("labelIds"), false);
  assert.equal(p.calls[0].url.searchParams.has("startHistoryId"), false);
});

test("invalid JSON, invalid UTF-8 and oversized responses cannot confirm a page", async () => {
  for (const body of [
    '{"messages":[',
    new Uint8Array([255]),
    new Uint8Array(8 * 1024 * 1024 + 1),
  ]) {
    const fetcher = (async () => new Response(body)) as typeof fetch;
    await assert.rejects(
      readGmailCapturePage("synthetic", request, fetcher),
      isError("parse_failed"),
    );
  }
});

test("message fetching limits concurrency and rejects aggregate page overflow before writes", async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `m${i}`);
  let active = 0,
    peak = 0,
    calls = 0;
  const s = store();
  const fetcher = (async (url: any) => {
    active++;
    peak = Math.max(peak, active);
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    const id = new URL(String(url)).pathname.split("/").at(-1)!;
    return Response.json(raw(id));
  }) as typeof fetch;
  const evidence = await persistGmailCapturePage({
    tenantId,
    mailbox,
    accessToken: "synthetic",
    page: { ...page, ids },
    fetchPolicy: "refetch_all",
    store: s.port,
    fetcher,
  });
  assert.equal(peak, 4);
  assert.equal(calls, 8);
  assert.equal(evidence.message_upsert_count, 8);
  const overflow = store();
  const largeFetcher = (async (url: any) => {
    const id = new URL(String(url)).pathname.split("/").at(-1)!;
    return Response.json({ ...raw(id), snippet: "x".repeat(5 * 1024 * 1024) });
  }) as typeof fetch;
  await assert.rejects(
    persistGmailCapturePage({
      tenantId,
      mailbox,
      accessToken: "synthetic",
      page: { ...page, ids },
      fetchPolicy: "refetch_all",
      store: overflow.port,
      fetcher: largeFetcher,
    }),
    isError("parse_failed"),
  );
  assert.equal(overflow.writes.length, 0);
});
test("profile identity and uint64 boundaries are checked without losing precision", async () => {
  const p = provider({ emailAddress: mailbox.toUpperCase(), historyId: "18446744073709551614" });
  assert.equal(
    await readGmailCaptureBoundary("synthetic", mailbox, p.fetcher),
    "18446744073709551614",
  );
  for (const body of [
    { emailAddress: "foreign@example.invalid", historyId: "1" },
    { emailAddress: mailbox, historyId: 18446744073709551614 },
    { emailAddress: mailbox, historyId: "18446744073709551616" },
  ])
    await assert.rejects(
      readGmailCaptureBoundary("synthetic", mailbox, provider(body).fetcher),
      GmailCaptureError,
    );
  assert.equal(p.calls[0].init?.redirect, "error");
  assert.ok(p.calls[0].init?.signal);
  assert.equal(p.calls[0].url.host, "gmail.googleapis.com");
});
test("list pages retain continuation tokens, separate labels and deduplicate IDs", async () => {
  const p = provider({
    messages: [{ id: "m1" }, { id: "m1" }, { id: "m2" }],
    nextPageToken: "opaque/+=",
  });
  const result = await readGmailCapturePage(
    "synthetic",
    { ...request, label: "SENT", pageToken: "prior/+=" },
    p.fetcher,
  );
  assert.deepEqual(result, { ids: ["m1", "m2"], nextPageToken: "opaque/+=", exhausted: false });
  assert.equal(p.calls[0].url.searchParams.get("pageToken"), "prior/+=");
  assert.equal(p.calls[0].url.searchParams.get("labelIds"), "SENT");
  assert.deepEqual(await readGmailCapturePage("synthetic", request, provider({}).fetcher), {
    ids: [],
    nextPageToken: null,
    exhausted: true,
  });
});
test("history pages are explicit, precise, and do not silently restart expired history", async () => {
  const r: GmailPageRequest = { ...request, mode: "history", originHistoryId: "9007199254740993" };
  const p = provider({
    historyId: "9007199254740999",
    history: [
      {
        id: "9007199254740994",
        messages: [{ id: "ignored" }],
        messagesAdded: [{ message: { id: "m1" } }, { message: { id: "m1" } }],
      },
    ],
    nextPageToken: "next",
  });
  assert.deepEqual(await readGmailCapturePage("synthetic", r, p.fetcher), {
    ids: ["m1"],
    nextPageToken: "next",
    exhausted: false,
  });
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].url.searchParams.get("startHistoryId"), "9007199254740993");
  assert.equal(p.calls[0].url.searchParams.get("labelId"), "INBOX");
  const expired = provider({ error: "PRIVATE_PROVIDER_DETAIL" }, 404);
  await assert.rejects(
    readGmailCapturePage("synthetic", r, expired.fetcher),
    isError("history_expired"),
  );
  assert.equal(expired.calls.length, 1);
});
test("malformed pages and non-progressing pagination never become successful empty pages", async () => {
  for (const body of [
    { messages: null },
    { messages: [{}] },
    { messages: [{ id: 1 }] },
    { nextPageToken: null },
    { nextPageToken: "" },
    { nextPageToken: 2 },
    [],
  ])
    await assert.rejects(
      readGmailCapturePage("synthetic", request, provider(body).fetcher),
      GmailCaptureError,
    );
  await assert.rejects(
    readGmailCapturePage(
      "synthetic",
      { ...request, pageToken: "same" },
      provider({ nextPageToken: "same" }).fetcher,
    ),
    isError("pagination_no_progress"),
  );
  await assert.rejects(
    readGmailCapturePage(
      "synthetic",
      { ...request, mode: "history", originHistoryId: "9007199254740993" },
      provider({ historyId: "9007199254740992" }).fetcher,
    ),
    isError("parse_failed"),
  );
});
test("missing-only capture preserves retained messages, persists before evidence and counts known gone IDs", async () => {
  const s = store(["m1"]),
    p = provider(raw("m2"));
  const evidence = await persistGmailCapturePage({
    tenantId,
    mailbox,
    accessToken: "synthetic",
    page,
    fetchPolicy: "missing_only",
    store: s.port,
    fetcher: p.fetcher,
  });
  assert.equal(p.calls.length, 1);
  assert.ok(p.calls[0].url.pathname.endsWith("/m2"));
  assert.deepEqual(
    s.writes.map((w) => w.kind),
    ["threads", "messages"],
  );
  assert.equal(s.writes[1].rows[0].body_text, "Synthetic body");
  assert.equal(s.writes[1].rows[0].tenant_id, tenantId);
  assert.deepEqual(evidence, {
    persistence: "confirmed",
    message_upsert_count: 1,
    thread_upsert_count: 1,
    ids_seen: 2,
    gone_count: 0,
    unresolved_count: 0,
  });
  const goneStore = store(),
    gone = await persistGmailCapturePage({
      tenantId,
      mailbox,
      accessToken: "synthetic",
      page,
      fetchPolicy: "missing_only",
      store: goneStore.port,
      fetcher: provider({}, 410).fetcher,
    });
  assert.equal(gone.gone_count, 2);
  assert.equal(gone.message_upsert_count, 0);
  assert.equal(goneStore.writes.length, 0);
});
test("a single unresolved fetch or malformed message prevents all page writes and evidence", async () => {
  for (const malformed of [true, false]) {
    const s = store();
    const fetcher = (async (url: any) =>
      String(url).includes("/m1?")
        ? Response.json(raw("m1"))
        : malformed
          ? Response.json({ ...raw("m2"), id: "different" })
          : Response.json({ error: "PRIVATE" }, { status: 503 })) as typeof fetch;
    await assert.rejects(
      persistGmailCapturePage({
        tenantId,
        mailbox,
        accessToken: "synthetic",
        page,
        fetchPolicy: "missing_only",
        store: s.port,
        fetcher,
      }),
      isError(malformed ? "parse_failed" : "fetch_failed"),
    );
    assert.equal(s.writes.length, 0);
  }
  const invalid = raw("m1");
  invalid.payload.body.data = "bad%base64";
  await assert.rejects(
    persistGmailCapturePage({
      tenantId,
      mailbox,
      accessToken: "synthetic",
      page: { ...page, ids: ["m1"] },
      fetchPolicy: "refetch_all",
      store: store().port,
      fetcher: provider(invalid).fetcher,
    }),
    isError("parse_failed"),
  );
});
test("storage failure stays uncertain and cannot produce checkpoint evidence", async () => {
  const s = store();
  s.port.savePage = async () => {
    throw Error("PRIVATE_DB_DETAIL");
  };
  await assert.rejects(
    persistGmailCapturePage({
      tenantId,
      mailbox,
      accessToken: "synthetic",
      page: { ...page, ids: ["m1"] },
      fetchPolicy: "missing_only",
      store: s.port,
      fetcher: provider(raw("m1")).fetcher,
    }),
    isError("persistence_failed", true),
  );
  assert.equal(s.writes.length, 0);
  const bad = store(["unrequested"]);
  const p = provider(raw("m1"));
  await assert.rejects(
    persistGmailCapturePage({
      tenantId,
      mailbox,
      accessToken: "synthetic",
      page,
      fetchPolicy: "missing_only",
      store: bad.port,
      fetcher: p.fetcher,
    }),
    isError("persistence_failed"),
  );
  assert.equal(p.calls.length, 0);
});
test("explicit refetch honours policy and expired page budgets do not start provider work", async () => {
  const s = store(["m1"]),
    p = provider(raw("m1"));
  await persistGmailCapturePage({
    tenantId,
    mailbox,
    accessToken: "synthetic",
    page: { ...page, ids: ["m1"] },
    fetchPolicy: "refetch_all",
    store: s.port,
    fetcher: p.fetcher,
  });
  assert.equal(p.calls.length, 1);
  await assert.rejects(
    persistGmailCapturePage({
      tenantId,
      mailbox,
      accessToken: "synthetic",
      page,
      fetchPolicy: "missing_only",
      store: s.port,
      fetcher: p.fetcher,
      deadlineMs: 0,
    }),
    isError("fetch_failed"),
  );
  assert.equal(p.calls.length, 1);
});
