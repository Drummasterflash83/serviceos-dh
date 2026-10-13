import { test } from "node:test";
import assert from "node:assert/strict";
import { readQuickBooksPage, quickBooksReadUrl, QuickBooksReadError } from "./read_page.ts";
import type { QuickBooksRead, QuickBooksCredential, QuickBooksReadPorts } from "./read_page.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-13T14:00:00Z");
const request: QuickBooksRead = { tenantId: id(1), connectionId: id(2), realmId: "12345678901234567890", environment: "sandbox", entity: "Invoice", startPosition: 1, pageSize: 2, minorVersion: 75 };
const credential: QuickBooksCredential = { ...request, accessToken: "synthetic-only-token", expiresAt: new Date(now + 3600000).toISOString() };
const body = (records: unknown[] = [{ Id: "1", SyncToken: "0" }, { Id: "2", SyncToken: "1" }]) => ({ QueryResponse: { Invoice: records, startPosition: 1, maxResults: records.length }, time: "2026-10-13T07:00:00-07:00" });
function fixture(response: Response = Response.json(body())) {
  const calls: { url: string; init: RequestInit }[] = [];
  let checks = 0, reservations = 0;
  const ports: QuickBooksReadPorts = {
    clock: () => now,
    stillAuthorized: async () => { checks++; return true; },
    reserveRequest: async () => { reservations++; return { permitId: id(3), expiresAt: new Date(now + 60000).toISOString() }; },
    fetcher: (async (url, init) => { calls.push({ url: String(url), init: init! }); return response; }) as typeof fetch,
  };
  return { ports, calls, checks: () => checks, reservations: () => reservations, run: (r = request, c = credential) => readQuickBooksPage(r, c, ports) };
}
const failure = (code: string) => (e: unknown) => {
  assert.ok(e instanceof QuickBooksReadError);
  assert.equal(e.code, code);
  assert.equal(JSON.stringify(e).includes(credential.accessToken), false);
  return true;
};

test("tenant-bound GET preserves string realm, source envelope and offset without claiming snapshot completeness", async () => {
  const f = fixture(), page = await f.run();
  assert.equal(f.calls.length, 1); assert.equal(f.reservations(), 1); assert.equal(f.checks(), 3);
  const call = f.calls[0], url = new URL(call.url);
  assert.equal(url.origin, "https://sandbox-quickbooks.api.intuit.com");
  assert.equal(url.pathname, `/v3/company/${request.realmId}/query`);
  assert.equal(url.searchParams.get("query"), "SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 2");
  assert.equal(call.init.method, "GET"); assert.equal(call.init.redirect, "error"); assert.equal(call.init.body, undefined);
  assert.equal(page.nextPosition, 3); assert.equal(page.coverage, "non_atomic_query_traversal");
  assert.deepEqual(page.rawEnvelope, body()); assert.deepEqual(page.binding.realmId, request.realmId);
});
test("inactive list entities remain in scope and production uses a separate fixed host", () => {
  for (const entity of ["Customer", "Vendor", "Account", "Item"] as const) {
    const url = new URL(quickBooksReadUrl({ ...request, entity, environment: "production" }));
    assert.equal(url.origin, "https://quickbooks.api.intuit.com");
    assert.match(url.searchParams.get("query")!, /WHERE Active IN \(true, false\)/);
  }
});
test("empty provider envelope ends traversal; exactly full page requires a following page", async () => {
  const empty = await fixture(Response.json({ QueryResponse: {}, time: body().time })).run();
  assert.equal(empty.traversalExhausted, true); assert.equal(empty.nextPosition, null);
  const short = await fixture(Response.json(body([{ Id: "1", SyncToken: "0" }]))).run();
  assert.equal(short.traversalExhausted, true);
  assert.equal((await fixture().run()).traversalExhausted, false);
});
test("foreign tenant, connection, environment and company credentials cannot reach provider", async () => {
  for (const change of [{ tenantId: id(9) }, { connectionId: id(9) }, { realmId: "99" }, { environment: "production" as const }]) {
    const f = fixture(); await assert.rejects(f.run(request, { ...credential, ...change }), failure("credential_binding_mismatch"));
    assert.equal(f.calls.length, 0); assert.equal(f.reservations(), 0);
  }
});
test("query injection, arbitrary hosts, invalid bounds and numeric realm precision are rejected before I/O", async () => {
  for (const change of [{ entity: "Invoice DELETE" }, { realmId: "1/../../escape" }, { realmId: 123 }, { environment: "https://invalid.example" }, { startPosition: 0 }, { pageSize: 1001 }, { pageSize: 1.5 }, { minorVersion: 0 }]) {
    const f = fixture(); await assert.rejects(f.run({ ...request, ...change } as QuickBooksRead), failure("invalid_request")); assert.equal(f.calls.length, 0);
  }
});
test("expired access and failed reservations cannot silently issue a request", async () => {
  const f = fixture(); await assert.rejects(f.run(request, { ...credential, expiresAt: new Date(now).toISOString() }), failure("authentication_required"));
  assert.equal(f.calls.length, 0);
  f.ports.reserveRequest = async () => ({ permitId: id(3), expiresAt: new Date(now).toISOString() });
  await assert.rejects(f.run(), failure("reservation_unavailable")); assert.equal(f.calls.length, 0);
});
test("authority loss before reservation, before HTTP or after reading prevents publication", async () => {
  for (const deniedCheck of [1, 2, 3]) {
    const f = fixture(); let n = 0;
    f.ports.stillAuthorized = async () => ++n !== deniedCheck;
    await assert.rejects(f.run(), failure("authority_unavailable")); assert.equal(f.calls.length, deniedCheck === 3 ? 1 : 0);
  }
});
test("HTTP failures are classified without leaking provider bodies or automatically retrying", async () => {
  for (const [status, code] of [[401, "authentication_required"], [403, "access_denied"], [429, "rate_limited"], [503, "provider_unavailable"], [400, "provider_rejected"]] as const) {
    const f = fixture(new Response('private source or credential detail', { status, headers: { "retry-after": "90" } }));
    await assert.rejects(f.run(), e => { failure(code)(e); if (status === 429) assert.equal((e as QuickBooksReadError).retryAt, now + 90000); return true; });
    assert.equal(f.calls.length, 1);
  }
});
test("malformed, duplicate, wrong-collection or mispositioned rows cannot advance the checkpoint", async () => {
  for (const value of [
    { ...body(), Fault: { Error: [{ Message: "private" }] } },
    { QueryResponse: { Customer: [] }, time: body().time },
    { ...body(), QueryResponse: { ...body().QueryResponse, startPosition: 2 } },
    body([{ Id: "1", SyncToken: "0" }, { Id: "1", SyncToken: "1" }]),
    body([{ Id: 1, SyncToken: "0" }]), body([{ Id: "1" }]), { ...body(), time: "invalid" },
  ]) await assert.rejects(fixture(Response.json(value)).run(), failure("invalid_response"));
});
test("response size and non-JSON bodies are bounded; thrown transport details stay private", async () => {
  await assert.rejects(fixture(new Response("<html>private</html>", { headers: { "content-type": "text/html" } })).run(), failure("invalid_response"));
  await assert.rejects(fixture(new Response('"' + "a".repeat(8 * 1024 * 1024) + '"', { headers: { "content-type": "application/json" } })).run(), failure("response_too_large"));
  const f = fixture(); f.ports.fetcher = async () => { throw Error(credential.accessToken); };
  await assert.rejects(f.run(), failure("transport_unavailable"));
});
test("mutating caller input during reservation cannot switch company or entity", async () => {
  const r = { ...request }, f = fixture(), reserve = f.ports.reserveRequest;
  f.ports.reserveRequest = async q => { r.realmId = "999"; r.entity = "Bill"; return reserve(q); };
  const page = await f.run(r);
  assert.equal(page.binding.realmId, request.realmId); assert.equal(page.entity, "Invoice");
});
