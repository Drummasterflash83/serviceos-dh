import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MicrosoftMailError,
  MICROSOFT_MAIL_FIELDS,
  microsoftMailRequestUrl,
  readMicrosoftMailPage,
  validateMicrosoftMailContinuation,
  type MicrosoftMailRequest,
} from "./microsoft_mail_page.ts";

const request: MicrosoftMailRequest = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  mailboxId: "00000000-0000-4000-8000-000000000003",
  folderId: "AQMk/Case+Sensitive==",
  pageSize: 25,
  continuation: null,
};
const instant = Date.parse("2026-10-11T06:00:00.000Z");
const base = `https://graph.microsoft.com/v1.0/users/${request.mailboxId}/mailFolders/${encodeURIComponent(request.folderId)}/messages/delta`;
const link = (kind: "next" | "delta", token = "PRIVATE_CURSOR") =>
  `${base}?${kind === "next" ? "$skiptoken" : "$deltatoken"}=${token}`;
const page = (value: unknown[] = [], kind: "next" | "delta" = "delta", url = link(kind)) => ({
  value,
  [kind === "next" ? "@odata.nextLink" : "@odata.deltaLink"]: url,
});
function provider(body: unknown, status = 200, headers: HeadersInit = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls,
    fetcher: (async (url: any, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json(body, { status, headers });
    }) as typeof fetch,
  };
}
const error = (code: string) => (e: unknown) => {
  assert.ok(e instanceof MicrosoftMailError);
  assert.equal(e.code, code);
  assert.doesNotMatch(JSON.stringify(e) + e.message + e.stack, /PRIVATE/);
  return true;
};
const read = (p: ReturnType<typeof provider>, r = request) =>
  readMicrosoftMailPage("PRIVATE_ACCESS_TOKEN", r, p.fetcher, () => instant);

test("initial mail capture is one read-only, unfiltered request with immutable IDs and full body fields", async () => {
  const p = provider(
    page([
      {
        id: "Message1",
        subject: "Synthetic",
        body: { contentType: "text", content: "Full synthetic body" },
      },
    ]),
  );
  const result = await read(p);
  assert.equal(p.calls.length, 1);
  const { url, init } = p.calls[0];
  const parsed = new URL(url);
  assert.equal(parsed.pathname, new URL(base).pathname);
  assert.deepEqual([...parsed.searchParams.keys()], ["$select"]);
  assert.equal(parsed.searchParams.get("$select"), MICROSOFT_MAIL_FIELDS.join(","));
  assert.equal(init?.method, "GET");
  assert.equal(init?.body, undefined);
  assert.equal(init?.redirect, "error");
  assert.ok(init?.signal instanceof AbortSignal);
  const h = new Headers(init?.headers);
  assert.equal(h.get("authorization"), "Bearer PRIVATE_ACCESS_TOKEN");
  assert.equal(h.get("prefer"), 'IdType="ImmutableId", odata.maxpagesize=25');
  assert.equal(h.get("content-type"), "application/json");
  assert.equal(result.persistence, "not_attempted");
  assert.equal(result.attachmentsCaptured, false);
  assert.equal(result.folderRoundComplete, true);
  assert.equal(result.fetchedAt, new Date(instant).toISOString());
  assert.deepEqual(result.scope, {
    tenantId: request.tenantId,
    accountId: request.accountId,
    mailboxId: request.mailboxId,
    folderId: request.folderId,
  });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ACCESS_TOKEN/);
});

test("empty intermediate pages retain the exact opaque URL and final delta can remain unchanged", async () => {
  const opaque = link("next", "a%2Bb%2F%3D") + "&$select=id%2Cbody";
  const first = await read(provider(page([], "next", opaque)));
  assert.equal(first.folderRoundComplete, false);
  const secondProvider = provider(page([{ id: "M1" }]));
  const second = await read(secondProvider, { ...request, continuation: first.continuation });
  assert.equal(secondProvider.calls[0].url, opaque);
  assert.equal(second.folderRoundComplete, true);
  const lastProvider = provider(page());
  const last = await read(lastProvider, { ...request, continuation: second.continuation });
  assert.equal(lastProvider.calls[0].url, second.continuation.url);
  assert.equal(last.folderRoundComplete, true);
});

test("slash, parenthesized and mixed documented resource addressing preserve case-sensitive IDs", () => {
  for (const users of [`users/${request.mailboxId}`, `users('${request.mailboxId}')`]) {
    for (const folder of [
      `MAILFOLDERS/${encodeURIComponent(request.folderId)}`,
      `mailFolders('${encodeURIComponent(request.folderId)}')`,
    ]) {
      const url = `https://graph.microsoft.com/v1.0/${users}/${folder}/messages/delta?$skiptoken=a%2Fb`;
      assert.equal(validateMicrosoftMailContinuation(request, { kind: "next", url }), url);
    }
  }
});

test("foreign hosts, mailboxes, folders, resources and ambiguous tokens fail before credentials are sent", async () => {
  const safe = link("next");
  const unsafe = [
    safe.replace("graph.microsoft.com", "graph.microsoft.com.example.invalid"),
    safe.replace("https:", "http:"),
    safe.replace("graph.microsoft.com", "graph.microsoft.com:444"),
    safe.replace("graph.microsoft.com", "user:PRIVATE@graph.microsoft.com"),
    safe.replace(request.mailboxId, request.accountId),
    safe.replace(
      encodeURIComponent(request.folderId),
      encodeURIComponent(request.folderId.toLowerCase()),
    ),
    safe.replace("/messages/delta", "/messages"),
    safe.replace("/v1.0/", "/beta/"),
    safe.replace("/users/", "/groups/"),
    safe.replace("$skiptoken", "$deltatoken"),
    safe + "&$deltatoken=PRIVATE",
    safe + "&$skiptoken=other",
    safe + "#PRIVATE",
    safe + "\n",
    safe.replace("/v1.0/", "/v1.0\\"),
    base + "?$skiptoken=",
    safe.replace("AQMk", "%zz"),
    safe.replace("AQMk", "%2541QMk"),
  ];
  for (const url of unsafe) {
    const p = provider(page());
    await assert.rejects(
      read(p, { ...request, continuation: { kind: "next", url } }),
      error("invalid_continuation"),
    );
    assert.equal(p.calls.length, 0);
  }
});

test("foreign response continuations invalidate the whole page", async () => {
  const p = provider(
    page([{ id: "M1" }], "next", link("next").replace(request.mailboxId, request.accountId)),
  );
  await assert.rejects(read(p), error("invalid_continuation"));
  assert.equal(p.calls.length, 1);
});

test("invalid scope, page size, access token and clock fail without a network request", async () => {
  const p = provider(page());
  for (const patch of [
    { tenantId: "wrong" },
    { accountId: "wrong" },
    { mailboxId: "person@example.invalid" },
    { folderId: "../../x" },
    { pageSize: 0 },
    { pageSize: 101 },
    { pageSize: 1.5 },
  ]) {
    await assert.rejects(read(p, { ...request, ...patch }), error("invalid_scope"));
  }
  for (const token of ["", "PRIVATE\nTOKEN", "a".repeat(32769)]) {
    await assert.rejects(readMicrosoftMailPage(token, request, p.fetcher), error("auth_required"));
  }
  for (const clock of [NaN, Infinity, 1e20]) {
    await assert.rejects(
      readMicrosoftMailPage("PRIVATE", request, p.fetcher, () => clock),
      error("invalid_scope"),
    );
  }
  assert.equal(p.calls.length, 0);
});

test("sparse updates, explicit nulls, duplicates, full precision and removals retain source evidence", async () => {
  const records = [
    {
      id: "Same",
      subject: "Original",
      body: { contentType: "html", content: "<b>Synthetic</b>" },
      receivedDateTime: "2026-10-11T05:00:00.1234567Z",
      from: { emailAddress: { address: "owner@example.invalid" } },
      sender: { emailAddress: { address: "delegate@example.invalid" } },
      toRecipients: [
        { emailAddress: { name: null, address: "/o=Example/ou=Exchange/cn=Synthetic" } },
      ],
      internetMessageHeaders: [{ name: "Message-ID", value: "<synthetic@example.invalid>" }],
      isDraft: true,
      hasAttachments: false,
    },
    { id: "Same", isRead: true },
    { id: "Same", subject: null, body: { contentType: "text", content: "" } },
    { id: "Same", "@removed": { reason: "deleted" } },
  ];
  const result = await read(provider(page(records)));
  assert.equal(result.events.length, 4);
  assert.deepEqual(
    result.events.map((e) => e.raw),
    records,
  );
  assert.equal(result.events[0].kind, "observed");
  if (result.events[0].kind !== "observed") assert.fail();
  assert.equal(result.events[0].fields.receivedDateTime, records[0].receivedDateTime);
  assert.deepEqual(result.events[0].fields.from, records[0].from);
  assert.deepEqual(result.events[0].fields.sender, records[0].sender);
  assert.deepEqual(result.events[1], {
    kind: "observed",
    id: "Same",
    fields: { isRead: true },
    raw: records[1],
  });
  assert.deepEqual(result.events[2], {
    kind: "observed",
    id: "Same",
    fields: { subject: null, body: records[2].body },
    raw: records[2],
  });
  assert.deepEqual(result.events[3], {
    kind: "removed_from_folder",
    id: "Same",
    reason: "deleted",
    raw: records[3],
  });
});

test("malformed events reject the whole page including earlier valid observations", async () => {
  for (const record of [
    null,
    { id: "" },
    { id: "bad id" },
    { id: "M", "@removed": null },
    { id: "M", "@removed": { reason: "changed" } },
    { id: "M", isRead: "true" },
    { id: "M", body: { contentType: "markdown", content: "x" } },
    { id: "M", body: { contentType: "text", content: null } },
    { id: "M", from: {} },
    { id: "M", toRecipients: [{ emailAddress: {} }] },
    { id: "M", categories: [12] },
    { id: "M", internetMessageHeaders: [{ name: "x", value: 12 }] },
    { id: "M", importance: "urgent" },
    { id: "M", receivedDateTime: "2026-02-30T00:00:00Z" },
    { id: "M", sentDateTime: "2026-10-11T05:00:00+01:00" },
    { id: "M", changeKey: {} },
    { id: "M", toRecipients: Array(2001).fill(null) },
  ])
    await assert.rejects(read(provider(page([{ id: "Good" }, record]))), error("invalid_response"));
});

test("malformed page envelopes cannot prove coverage", async () => {
  for (const body of [
    null,
    [],
    {},
    { ...page(), value: {} },
    { ...page(), value: Array(1001).fill({ id: "M" }) },
    { value: [] },
    { ...page(), "@odata.nextLink": link("next") },
  ]) {
    await assert.rejects(read(provider(body)), error("invalid_response"));
  }
  await assert.rejects(
    read(provider({ ...page(), "@odata.deltaLink": null })),
    error("invalid_continuation"),
  );
});

test("same next cursor cannot progress; same delta cursor is allowed", async () => {
  await assert.rejects(
    read(provider(page([], "next")), {
      ...request,
      continuation: { kind: "next", url: link("next") },
    }),
    error("pagination_no_progress"),
  );
  const result = await read(provider(page()), {
    ...request,
    continuation: { kind: "delta", url: link("delta") },
  });
  assert.equal(result.folderRoundComplete, true);
});

test("invalid JSON and UTF-8 produce sanitised errors", async () => {
  for (const body of ['{"PRIVATE":', new Uint8Array([255]), "PRIVATE HTML response"]) {
    await assert.rejects(
      readMicrosoftMailPage("PRIVATE", request, (async () => new Response(body)) as typeof fetch),
      error("invalid_response"),
    );
  }
});

test("declared and streamed byte overflow cancels bodies and cannot return a partial page", async () => {
  for (const declared of [true, false]) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(declared ? 1 : 16 * 1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, {
      headers: declared ? { "content-length": String(16 * 1024 * 1024 + 1) } : {},
    });
    await assert.rejects(
      readMicrosoftMailPage("PRIVATE", request, (async () => response) as typeof fetch),
      error("response_too_large"),
    );
    assert.equal(cancelled, true);
  }
});

test("auth, permission, folder, expiry and service failures are classified without reading private error bodies", async () => {
  for (const [status, code] of [
    [401, "auth_required"],
    [403, "access_denied"],
    [404, "folder_unavailable"],
    [410, "delta_expired"],
    [429, "throttled"],
    [503, "provider_unavailable"],
  ] as const) {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { status },
    );
    await assert.rejects(
      readMicrosoftMailPage("PRIVATE", request, (async () => response) as typeof fetch),
      error(code),
    );
    assert.equal(cancelled, true);
  }
});

test("throttling preserves numeric and HTTP-date retry delays without automatic retries", async () => {
  for (const [header, seconds] of [
    ["120", 120],
    ["Sun, 11 Oct 2026 06:01:00 GMT", 60],
    ["Sun, 11 Oct 2026 05:59:00 GMT", 0],
    ["invalid", null],
  ] as const) {
    const p = provider({ error: { message: "PRIVATE" } }, 429, { "Retry-After": header });
    await assert.rejects(read(p), (e: unknown) => {
      error("throttled")(e);
      assert.equal((e as MicrosoftMailError).retryAfterSeconds, seconds);
      return true;
    });
    assert.equal(p.calls.length, 1);
  }
});

test("provider sync-state expiry is surfaced without resetting or replacing the saved cursor", async () => {
  for (const code of ["syncStateNotFound", "ErrorSyncStateNotFound", "resyncRequired"]) {
    const r = { ...request, continuation: { kind: "delta" as const, url: link("delta") } };
    const before = structuredClone(r);
    await assert.rejects(
      read(provider({ error: { code, message: "PRIVATE" } }, 400), r),
      error("delta_expired"),
    );
    assert.deepEqual(r, before);
  }
  await assert.rejects(
    read(provider({ error: { code: "Other", message: "PRIVATE" } }, 400)),
    error("fetch_failed"),
  );
});

test("network and redirect errors do not leak tokens or endpoints", async () => {
  await assert.rejects(
    readMicrosoftMailPage("PRIVATE", request, (async () => {
      throw new Error("PRIVATE bearer and cursor");
    }) as typeof fetch),
    error("fetch_failed"),
  );
});

test("an in-flight caller mutation cannot change the returned scope or request URL", async () => {
  const r = structuredClone(request);
  const expected = microsoftMailRequestUrl(r);
  const result = await readMicrosoftMailPage("PRIVATE", r, (async () => {
    r.tenantId = request.accountId;
    r.folderId = "Other";
    return Response.json(page());
  }) as typeof fetch);
  assert.equal(result.scope.tenantId, request.tenantId);
  assert.equal(result.scope.folderId, request.folderId);
  assert.equal(result.requestUrl, expected);
});

test("qualified delta function is accepted while literal path separators inside a folder ID are rejected", () => {
  const url = link("delta").replace("/messages/delta?", "/messages/microsoft.graph.delta?");
  assert.equal(validateMicrosoftMailContinuation(request, { kind: "delta", url }), url);
  assert.throws(
    () =>
      validateMicrosoftMailContinuation(request, {
        kind: "delta",
        url: link("delta").replace("%2F", "/"),
      }),
    error("invalid_continuation"),
  );
});

test("completion timestamp reflects receipt and invalid completion clock cannot prove a page", async () => {
  let ticks = 0;
  const p = provider(page());
  const result = await readMicrosoftMailPage(
    "PRIVATE",
    request,
    p.fetcher,
    () => instant + 1000 * ticks++,
  );
  assert.equal(result.fetchedAt, new Date(instant + 1000).toISOString());
  ticks = 0;
  await assert.rejects(
    readMicrosoftMailPage("PRIVATE", request, p.fetcher, () => (ticks++ ? NaN : instant)),
    error("invalid_response"),
  );
});
