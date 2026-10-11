import { test } from "node:test";
import assert from "node:assert/strict";
import { MicrosoftMailError, readMicrosoftMailPage } from "./microsoft_mail_page.ts";
import {
  beginMicrosoftFolderDiscovery,
  stepMicrosoftFolderDiscovery,
  readMicrosoftFolderPage,
  microsoftFolderRequestUrl,
  validateMicrosoftFolderContinuation,
  type MicrosoftFolderDiscovery,
  type MicrosoftFolderRequest,
} from "./microsoft_mail_folders.ts";
const scope = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  mailboxId: "00000000-0000-4000-8000-000000000003",
};
const request: MicrosoftFolderRequest = {
  ...scope,
  parentFolderId: null,
  nextUrl: null,
  pageSize: 50,
};
const folder = (id: string, parentFolderId = "Root", overrides: Record<string, unknown> = {}) => ({
  id,
  parentFolderId,
  displayName: `Synthetic ${id}`,
  childFolderCount: 0,
  totalItemCount: 0,
  unreadItemCount: 0,
  isHidden: false,
  ...overrides,
});
const base = `https://graph.microsoft.com/v1.0/users/${scope.mailboxId}/mailFolders`;
const next = (token: string, parent: string | null = null) =>
  `${base}${parent === null ? "" : `/${encodeURIComponent(parent)}/childFolders`}?$skiptoken=${token}`;
const page = (value: unknown[] = [], nextUrl?: string) => ({
  value,
  ...(nextUrl === undefined ? {} : { "@odata.nextLink": nextUrl }),
});
const error = (code: string) => (e: unknown) => {
  assert.ok(e instanceof MicrosoftMailError);
  assert.equal(e.code, code);
  assert.doesNotMatch(JSON.stringify(e) + e.message, /PRIVATE/);
  return true;
};
function provider(...responses: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls,
    fetcher: (async (url: any, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      assert.ok(responses.length, "unexpected provider request");
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (response instanceof Response) return response;
      return Response.json(response);
    }) as typeof fetch,
  };
}
const read = (p: ReturnType<typeof provider>, r = request) =>
  readMicrosoftFolderPage("PRIVATE_TOKEN", r, p.fetcher);
const step = (p: ReturnType<typeof provider>, s: MicrosoftFolderDiscovery) =>
  stepMicrosoftFolderDiscovery("PRIVATE_TOKEN", scope, s, p.fetcher);

test("root discovery explicitly includes hidden folders and requests bounded metadata without mail bodies", async () => {
  const p = provider(page([folder("Inbox", "Root", { isHidden: true })]));
  const result = await read(p);
  const url = new URL(p.calls[0].url);
  assert.equal(url.pathname, `/v1.0/users/${scope.mailboxId}/mailFolders`);
  assert.equal(url.searchParams.get("includeHiddenFolders"), "true");
  assert.equal(url.searchParams.get("$top"), "50");
  assert.equal(
    url.searchParams.get("$select"),
    "id,parentFolderId,displayName,childFolderCount,totalItemCount,unreadItemCount,isHidden",
  );
  assert.equal(p.calls[0].init?.method, "GET");
  assert.equal(p.calls[0].init?.redirect, "error");
  assert.equal(result.persistence, "not_attempted");
  assert.equal(result.collectionComplete, true);
  assert.equal(result.folders[0].isHidden, true);
  assert.deepEqual(result.folders[0].raw, folder("Inbox", "Root", { isHidden: true }));
});

test("nested listing uses actual folder ID and opaque continuation exactly", async () => {
  const parent = "Folder/+Case==";
  const r = { ...request, parentFolderId: parent };
  const opaque = next("PRIVATE%2B%2F%3D", parent);
  const p = provider(page([], opaque), page([folder("Child", parent)]));
  const first = await read(p, r);
  assert.equal(first.collectionComplete, false);
  assert.equal(
    new URL(p.calls[0].url).pathname.endsWith(`/Folder%2F%2BCase%3D%3D/childFolders`),
    true,
  );
  const second = await read(p, { ...r, nextUrl: first.nextUrl });
  assert.equal(p.calls[1].url, opaque);
  assert.equal(second.collectionComplete, true);
});

test("list continuation supports slash and parenthesized addressing and numeric skip", () => {
  for (const parentFolderId of [null, "Case/+ID=="]) {
    const r = { ...request, parentFolderId };
    for (const user of [`users/${scope.mailboxId}`, `users('${scope.mailboxId}')`]) {
      const suffix =
        parentFolderId === null
          ? "mailFolders/"
          : `mailFolders('${encodeURIComponent(parentFolderId)}')/childFolders`;
      const url = `https://graph.microsoft.com/v1.0/${user}/${suffix}?$skip=20&includeHiddenFolders=true`;
      assert.equal(validateMicrosoftFolderContinuation(r, url), url);
    }
  }
});

test("foreign and ambiguous folder continuations are rejected before sending credentials", async () => {
  const safe = next("PRIVATE");
  for (const url of [
    safe.replace("graph.microsoft.com", "example.invalid"),
    safe.replace(scope.mailboxId, scope.accountId),
    next("PRIVATE", "Different"),
    safe.replace("/v1.0/", "/beta/"),
    safe + "&$skip=20",
    safe + "&$skiptoken=duplicate",
    safe + "&$deltatoken=x",
    safe + "#secret",
    safe + "&includeHiddenFolders=false",
    base + "?$skip=-1",
    base + "?$skiptoken=",
    safe.replace("https://", "https://user:PRIVATE@"),
    safe.replace("https:", "http:"),
    base + "?$filter=PRIVATE",
  ]) {
    const p = provider(page());
    await assert.rejects(read(p, { ...request, nextUrl: url }), error("invalid_continuation"));
    assert.equal(p.calls.length, 0);
  }
});

test("invalid response entries, parent conflicts and malformed continuation prevent returning partial discovery", async () => {
  for (const bad of [
    null,
    folder("A", "A"),
    folder("A", "Root", { isHidden: null }),
    folder("A", "Root", { childFolderCount: -1 }),
    folder("A", "Root", { totalItemCount: 1.5 }),
    folder("A", "Root", { "@odata.type": "#microsoft.graph.unknownFolder" }),
    folder("A", "Root", { displayName: 123 }),
  ])
    await assert.rejects(read(provider(page([folder("Valid"), bad]))), error("invalid_response"));
  await assert.rejects(
    read(provider(page([folder("A", "Wrong")])), { ...request, parentFolderId: "Parent" }),
    error("hierarchy_conflict"),
  );
  for (const response of [
    { value: {} },
    { ...page(), "@odata.deltaLink": next("D") },
    { value: Array(1001).fill(folder("A")) },
  ]) {
    await assert.rejects(read(provider(response)), error("invalid_response"));
  }
  await assert.rejects(
    read(provider({ ...page(), "@odata.nextLink": null })),
    error("invalid_continuation"),
  );
});

test("discovery walks hidden descendants and zero-count folders and survives serialisation after every page", async () => {
  const p = provider(
    page([folder("Inbox")], next("ROOT2")),
    page([folder("Archive", "Root", { isHidden: true })]),
    page([folder("Nested", "Inbox", { isHidden: true })]),
    page(),
    page(),
  );
  let state = beginMicrosoftFolderDiscovery(scope, 50);
  const pages = [];
  for (let i = 0; i < 5; i++) {
    const before = structuredClone(state);
    const result = await step(p, state);
    assert.deepEqual(state, before, "input checkpoint remains retryable until committed");
    assert.equal(result.traversalExhausted, i === 4);
    assert.equal(result.persistence, "not_attempted");
    pages.push(result.page);
    state = JSON.parse(JSON.stringify(result.checkpoint));
  }
  assert.deepEqual(
    state.folders.map((f) => f.id),
    ["Inbox", "Archive", "Nested"],
  );
  assert.deepEqual(state.completedParents, [null, "Inbox", "Archive", "Nested"]);
  assert.equal(pages.length, 5);
  assert.equal(p.calls.length, 5);
  for (const call of p.calls.filter((c) => !c.url.includes("$skiptoken"))) {
    assert.equal(new URL(call.url).searchParams.get("includeHiddenFolders"), "true");
  }
  const finished = await step(p, state);
  assert.equal(finished.page, null);
  assert.equal(finished.traversalExhausted, true);
  assert.equal(p.calls.length, 5);
});

test("virtual search folders are identified but still traversed for physical children", async () => {
  const search = folder("Search", "Root", { "@odata.type": "#microsoft.graph.mailSearchFolder" });
  const p = provider(page([search]), page([folder("Nested", "Search")]), page());
  let state = beginMicrosoftFolderDiscovery(scope);
  for (let i = 0; i < 3; i++) state = (await step(p, state)).checkpoint;
  assert.deepEqual(
    state.folders.map((f) => [f.id, f.kind]),
    [
      ["Search", "search"],
      ["Nested", "physical"],
    ],
  );
  assert.equal(state.pending.length, 0);
  assert.equal(p.calls.length, 3);
});

test("overlapping pages retain every raw observation but only schedule a folder once", async () => {
  const p = provider(
    page([folder("A")], next("P2")),
    page([folder("A", "Root", { displayName: "Renamed" })]),
    page(),
  );
  let state = (await step(p, beginMicrosoftFolderDiscovery(scope))).checkpoint;
  const duplicate = await step(p, state);
  assert.equal(duplicate.page?.folders[0].displayName, "Renamed");
  assert.equal(duplicate.checkpoint.folders.length, 1);
  assert.equal(duplicate.checkpoint.folders[0].displayName, "Synthetic A");
  assert.equal(duplicate.checkpoint.pending.length, 1);
  state = (await step(p, duplicate.checkpoint)).checkpoint;
  assert.equal(state.pending.length, 0);
  assert.equal(p.calls.length, 3);
});

test("folder moves and type changes invalidate this pass without mutating the last checkpoint", async () => {
  for (const changed of [
    folder("A", "NewParent"),
    folder("A", "Root", { "@odata.type": "#microsoft.graph.mailSearchFolder" }),
  ]) {
    const p = provider(page([folder("A")], next("P2")), page([changed]));
    const state = (await step(p, beginMicrosoftFolderDiscovery(scope))).checkpoint;
    const before = structuredClone(state);
    await assert.rejects(step(p, state), error("hierarchy_conflict"));
    assert.deepEqual(state, before);
  }
});

test("a hierarchy cycle spanning separate provider pages is rejected", async () => {
  const p = provider(page([folder("A", "B")]), page([folder("B", "A")]));
  const state = (await step(p, beginMicrosoftFolderDiscovery(scope))).checkpoint;
  await assert.rejects(step(p, state), error("hierarchy_conflict"));
  assert.deepEqual(
    state.folders.map((f) => f.id),
    ["A"],
  );
});

test("multi-page cursor loops cannot mark traversal exhausted", async () => {
  const p = provider(page([], next("P2")), page([], next("P3")), page([], next("P2")));
  let state = (await step(p, beginMicrosoftFolderDiscovery(scope))).checkpoint;
  state = (await step(p, state)).checkpoint;
  await assert.rejects(step(p, state), error("pagination_no_progress"));
  assert.equal(state.visitedRequests.length, 2);
  assert.equal(state.pending.length, 1);
});

test("scope changes, missing queue entries and invalid state refuse provider calls", async () => {
  const clean = beginMicrosoftFolderDiscovery(scope);
  const bad = [
    { ...clean, scope: { ...scope, tenantId: scope.accountId } },
    { ...clean, pageSize: 0 },
    { ...clean, pending: [] },
    { ...clean, completedParents: [null] },
    { ...clean, pending: [{ parentFolderId: "Unseen", nextUrl: null }] },
    { ...clean, visitedRequests: ["same", "same"] },
  ];
  for (const state of bad) {
    const p = provider(page());
    await assert.rejects(step(p, state), (e) => e instanceof MicrosoftMailError);
    assert.equal(p.calls.length, 0);
  }
});

test("extra checkpoint keys cannot override mailbox or company binding", async () => {
  const state = beginMicrosoftFolderDiscovery(scope);
  Object.assign(state.pending[0], { mailboxId: scope.accountId, tenantId: scope.mailboxId });
  const p = provider(page());
  const result = await step(p, state);
  assert.equal(new URL(p.calls[0].url).pathname, `/v1.0/users/${scope.mailboxId}/mailFolders`);
  assert.deepEqual(result.page?.scope, scope);
});

test("provider failure leaves the original page available for exact retry", async () => {
  const p = provider(
    new Response("PRIVATE", { status: 429, headers: { "Retry-After": "60" } }),
    page([folder("A")]),
  );
  const state = beginMicrosoftFolderDiscovery(scope),
    before = structuredClone(state);
  await assert.rejects(step(p, state), error("throttled"));
  assert.deepEqual(state, before);
  const result = await step(p, state);
  assert.equal(p.calls[0].url, p.calls[1].url);
  assert.equal(result.checkpoint.folders.length, 1);
});

test("page bound stops before a provider call rather than claiming an incomplete walk is finished", async () => {
  const state = beginMicrosoftFolderDiscovery(scope);
  state.visitedRequests = Array.from({ length: 10000 }, (_, i) => next(String(i)));
  const p = provider(page());
  await assert.rejects(step(p, state), error("discovery_limit"));
  assert.equal(p.calls.length, 0);
  assert.equal(state.pending.length, 1);
});

test("an actual discovered folder ID feeds the message reader without changing its mailbox scope", async () => {
  const actual = "AQMk/Folder+Case==";
  const p = provider(page([folder(actual)]), page());
  let result = await step(p, beginMicrosoftFolderDiscovery(scope));
  result = await step(p, result.checkpoint);
  const discovered = result.checkpoint.folders[0];
  const mailBase = `${base}/${encodeURIComponent(actual)}/messages/delta`;
  const mailProvider = provider({
    value: [{ id: "M1", subject: "Synthetic message" }],
    "@odata.deltaLink": `${mailBase}?$deltatoken=PRIVATE`,
  });
  const mail = await readMicrosoftMailPage(
    "PRIVATE",
    { ...scope, folderId: discovered.id, continuation: null, pageSize: 50 },
    mailProvider.fetcher,
  );
  assert.equal(new URL(mailProvider.calls[0].url).pathname, new URL(mailBase).pathname);
  assert.equal(mail.scope.folderId, actual);
  assert.equal(mail.events.length, 1);
  assert.equal(mail.persistence, "not_attempted");
});

test("numeric pagination cannot silently drop hidden folders or introduce a filter", async () => {
  for (const url of [
    `${base}?$skip=20`,
    next("PRIVATE") + "&$filter=isHidden%20eq%20false",
    next("PRIVATE") + "&$search=PRIVATE",
  ]) {
    await assert.rejects(read(provider(page([], url))), error("invalid_continuation"));
  }
});

test("in-flight request mutation cannot retarget the page or invalidate its original page size", async () => {
  const r = structuredClone(request);
  const result = await readMicrosoftFolderPage("PRIVATE", r, (async () => {
    r.mailboxId = scope.accountId;
    r.parentFolderId = "Foreign";
    r.pageSize = 999;
    return Response.json(page([], next("P2")));
  }) as typeof fetch);
  assert.deepEqual(result.scope, scope);
  assert.equal(result.parentFolderId, null);
  assert.equal(result.nextUrl, next("P2"));
});

test("folder count limit preserves the previous checkpoint without truncating the new page", async () => {
  const state = beginMicrosoftFolderDiscovery(scope);
  state.completedParents = [null];
  state.visitedRequests = [microsoftFolderRequestUrl({ ...request, pageSize: 100 })];
  state.folders = Array.from({ length: 10000 }, (_, i) => ({
    ...folder(`F${i}`),
    kind: "physical" as const,
  }));
  state.pending = state.folders.map((f) => ({ parentFolderId: f.id, nextUrl: null }));
  const p = provider(page([folder("Extra", "F0")]));
  await assert.rejects(step(p, state), error("discovery_limit"));
  assert.equal(state.folders.length, 10000);
  assert.equal(state.visitedRequests.length, 1);
  assert.equal(state.pending[0].parentFolderId, "F0");
});
