import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readQuickBooksOverview,
  verifiedQuickBooksAuthorizationUrl,
  readQuickBooksDisconnections,
} from "./learn-quickbooks.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("disconnect status rejects foreign scope and unsafe resume metadata", () => {
  const entry = {
    id: id(4),
    connectionId: id(2),
    actorId: id(3),
    state: "queued",
    requestRevision: 1,
    reason: "Saved request",
    code: null,
    createdAt: "2026-10-13T12:00:00Z",
    finishedAt: null,
  };
  const envelope = (e: unknown) => ({ tenantId: id(1), requests: [e] });
  assert.equal(readQuickBooksDisconnections(envelope(entry), id(1))[0].state, "queued");
  assert.throws(() => readQuickBooksDisconnections(envelope(entry), id(2)));
  for (const patch of [
    { state: "success" },
    { requestRevision: 0 },
    { requestRevision: 1.5 },
    { actorId: null },
    { reason: "" },
    { code: "provider secret payload" },
  ])
    assert.throws(() => readQuickBooksDisconnections(envelope({ ...entry, ...patch }), id(1)));
  assert.throws(() =>
    readQuickBooksDisconnections({ tenantId: id(1), requests: [entry, entry] }, id(1)),
  );
});
const data = () => ({
  tenantId: id(1),
  checkedAt: "2026-10-13T12:00:00Z",
  apps: [{ id: id(4), environment: "sandbox" }],
  connections: [
    {
      id: id(2),
      appId: id(4),
      environment: "sandbox",
      realmId: "9130357990011111",
      companyName: "Synthetic",
      status: "awaiting_confirmation",
      revision: 1,
      verifiedAt: "2026-10-13T12:00:00Z",
      confirmedAt: null,
      accessExpiresAt: null,
      refreshExpiresAt: null,
      refreshInProgress: false,
    },
  ],
});
test("operator status rejects foreign tenant, unknown status, numeric realm and incomplete records", () => {
  assert.equal(readQuickBooksOverview(data(), id(1)).connections[0].companyName, "Synthetic");
  assert.throws(() => readQuickBooksOverview(data(), id(3)));
  for (const change of [
    { status: "success" },
    { realmId: 9130357990011111 },
    { revision: 0 },
    { refreshInProgress: null },
    { confirmedAt: undefined },
  ]) {
    const v = data();
    Object.assign(v.connections[0], change);
    assert.throws(() => readQuickBooksOverview(v, id(1)));
  }
  const duplicate = data();
  duplicate.connections.push(duplicate.connections[0]);
  assert.throws(() => readQuickBooksOverview(duplicate, id(1)));
});
test("browser redirect accepts only exact Intuit accounting authorization and its own backend callback", () => {
  const backend = "https://test.example.invalid";
  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.search = new URLSearchParams({
    client_id: "synthetic",
    redirect_uri: backend + "/functions/v1/quickbooks-oauth-callback",
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    state: "a".repeat(43),
  }).toString();
  const envelope = (authorizationUrl: string) => ({ connectionId: id(2), authorizationUrl });
  assert.equal(verifiedQuickBooksAuthorizationUrl(envelope(url.href), id(2), backend), url.href);
  for (const bad of [
    url.href.replace("appcenter.intuit.com", "evil.invalid"),
    url.href + "&state=duplicate",
    url.href + "&client_secret=secret",
    url.href.replace("accounting", "payment"),
  ])
    assert.throws(() => verifiedQuickBooksAuthorizationUrl(envelope(bad), id(2), backend));
  assert.throws(() => verifiedQuickBooksAuthorizationUrl(envelope(url.href), id(3), backend));
  assert.throws(() =>
    verifiedQuickBooksAuthorizationUrl(
      envelope(url.href),
      id(2),
      "https://production.example.invalid",
    ),
  );
});
