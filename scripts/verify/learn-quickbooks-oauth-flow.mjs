/** Called only by the disposable PostgreSQL verifier; uses synthetic credentials. */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  startQuickBooksAuthorization,
  completeQuickBooksAuthorization,
  refreshQuickBooksConnection,
} from "../../supabase/functions/_shared/quickbooks/oauth_flow.ts";
const container = process.env.SERVICEOS_QB_TEST_CONTAINER;
if (!/^serviceos-quickbooks-oauth-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("isolated fixture required");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const quote = (value) =>
  value === null
    ? "null"
    : "'" +
      String(typeof value === "object" ? JSON.stringify(value) : value).replaceAll("'", "''") +
      "'";
const sql = (text) =>
  execFileSync(
    process.env.SERVICEOS_QB_TEST_DOCKER ?? "docker",
    ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const rpc = (role) => async (name, args) => {
  if (
    !/^learn_quickbooks_[a-z_]+$/.test(name) ||
    Object.keys(args).some((k) => !/^p_[a-z_]+$/.test(k))
  )
    throw Error("invalid fixture RPC");
  try {
    const out = sql(
      `set request.jwt.claim.role=${quote(role)};set request.jwt.claim.sub=${quote(id(10))};set role ${role};select to_jsonb(${name}(${Object.entries(
        args,
      )
        .map(([k, v]) => `${k}=>${quote(v)}`)
        .join(",")}));`,
    );
    return { data: out ? JSON.parse(out) : null, error: null };
  } catch {
    return { data: null, error: "synthetic RPC rejected" };
  }
};
const start = await startQuickBooksAuthorization(
  {
    tenantId: id(1),
    connectionId: id(70),
    appId: id(20),
    requestId: id(71),
    reason: "Whole flow fixture",
  },
  rpc("authenticated"),
);
const url = new URL(start.authorizationUrl);
const callback = new URL(url.searchParams.get("redirect_uri"));
callback.search = new URLSearchParams({
  state: url.searchParams.get("state"),
  code: "synthetic-code",
  realmId: "9130357990022222",
}).toString();
let requests = 0;
const fetcher = async (request, options) => {
  requests++;
  if (String(request) === "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer") {
    assert.equal(options.method, "POST");
    return Response.json({
      token_type: "bearer",
      access_token: "synthetic-access-" + requests,
      refresh_token: "synthetic-refresh-" + requests,
      expires_in: 3600,
      x_refresh_token_expires_in: 8640000,
    });
  }
  assert.equal(
    String(request),
    "https://sandbox-quickbooks.api.intuit.com/v3/company/9130357990022222/companyinfo/9130357990022222?minorversion=75",
  );
  assert.equal(options.method, "GET");
  return Response.json({ CompanyInfo: { Id: "1", CompanyName: "Whole Flow Synthetic" } });
};
assert.deepEqual(
  await completeQuickBooksAuthorization(callback.href, {
    rpc: rpc("service_role"),
    minorVersion: 75,
    fetcher,
  }),
  { state: "saved" },
);
assert.equal(requests, 2);
assert.deepEqual(
  await completeQuickBooksAuthorization(callback.href, {
    rpc: rpc("service_role"),
    minorVersion: 75,
    fetcher,
  }),
  { state: "unconfirmed" },
);
assert.equal(requests, 2);
const status = await rpc("authenticated")("learn_quickbooks_status", { p_tenant: id(1) });
const connection = status.data.connections.find((c) => c.id === id(70));
assert.equal(connection.status, "awaiting_confirmation");
assert.equal(connection.companyName, "Whole Flow Synthetic");
assert.equal(JSON.stringify(status).includes("synthetic-access"), false);
const confirm = await rpc("authenticated")("learn_quickbooks_control", {
  p_tenant: id(1),
  p_connection: id(70),
  p_revision: connection.revision,
  p_action: "confirm",
  p_realm: connection.realmId,
  p_reason: "Confirm synthetic realm",
});
assert.equal(confirm.error, null);
assert.equal(confirm.data.status, "paused");
sql(
  `update learn_quickbooks_connections set access_expires_at=clock_timestamp() where id=${quote(id(70))};`,
);
assert.equal(
  await refreshQuickBooksConnection(id(1), id(70), { rpc: rpc("service_role"), fetcher }),
  "refreshed",
);
assert.equal(requests, 3);
assert.equal(
  sql(
    `select token_generation=2 and status='paused' from learn_quickbooks_connections where id=${quote(id(70))}`,
  ),
  "t",
);
// Pausing during a refresh must not clear its uncertainty fence and allow the
// possibly rotated token to be sent by another worker.
sql(`update learn_quickbooks_connections set access_expires_at=clock_timestamp() where id=${quote(id(70))};`);
const lease = await rpc("service_role")("learn_quickbooks_refresh_acquire", {p_tenant:id(1),p_connection:id(70)});
assert.equal(lease.data.state,"ready");
const paused = await rpc("authenticated")("learn_quickbooks_control", {p_tenant:id(1),p_connection:id(70),p_revision:2,p_action:"pause",p_realm:null,p_reason:"Pause during synthetic refresh"});
assert.equal(paused.error,null);
const stillLeased = await rpc("service_role")("learn_quickbooks_refresh_acquire", {p_tenant:id(1),p_connection:id(70)});
assert.equal(stillLeased.data.state,"busy");
console.log(
  "PASS: actual TypeScript start/callback/confirmation/refresh against SQL RPCs, with synthetic provider responses; replay sent no second exchange.",
);
