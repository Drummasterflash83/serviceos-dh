/** Called only by the disposable PostgreSQL verifier; uses synthetic credentials. */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { runQuickBooksImport } from "../../supabase/functions/_shared/quickbooks/import_worker.ts";
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

// Own synthetic company; unrelated fixture queues are parked by this harness.
sql(`update learn_quickbooks_imports set state='paused';
insert into learn_quickbooks_connections(id,tenant_id,environment,app_id,realm_id,company_name,status,token_generation,created_by,confirmed_at,confirmed_by,access_expires_at,refresh_expires_at,verified_at)
values(fixture_id(90),fixture_id(1),'sandbox',fixture_id(20),'9130357990044444','Worker Synthetic','paused',1,fixture_id(10),clock_timestamp(),fixture_id(10),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '100 days',clock_timestamp());
update learn_quickbooks_connections set token_secret_id=provider_secret_store(fixture_id(1),'quickbooks',fixture_id(90)::text||':tokens',fixture_pair()::text) where id=fixture_id(90);`);
const user = rpc("authenticated"),
  service = rpc("service_role");
assert.equal(
  (
    await user("learn_quickbooks_set_enabled", {
      p_tenant: id(1),
      p_connection: id(90),
      p_enabled: true,
      p_reason: "Synthetic worker",
    })
  ).error,
  null,
);
const definition = {
  entities: ["Customer", "Invoice"],
  pageSize: 2,
  minorVersion: 75,
  maxRequests: 2,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  reason: "Synthetic worker",
  resumeFrom: null,
};
async function start(n, def = definition) {
  const result = await user("learn_quickbooks_import_start", {
    p_tenant: id(1),
    p_connection: id(90),
    p_request: id(n),
    p_definition: def,
  });
  assert.equal(result.error, null);
  assert.equal(result.data.state, "queued");
}
const pace = () =>
  sql(
    `update learn_quickbooks_request_gates set next_at=clock_timestamp();update learn_quickbooks_imports set next_at=clock_timestamp();`,
  );
let requests = 0,
  token = "1",
  balance = "0.10";
const fetcher = async (url, options) => {
  requests++;
  assert.equal(options.method, "GET");
  const u = new URL(url);
  assert.equal(u.origin, "https://sandbox-quickbooks.api.intuit.com");
  assert.equal(u.pathname, "/v3/company/9130357990044444/query");
  const entity = u.searchParams.get("query").includes("FROM Customer") ? "Customer" : "Invoice";
  const record =
    entity === "Customer"
      ? `{"Id":"1","SyncToken":"0","DisplayName":"Worker Customer"}`
      : `{"Id":"9","SyncToken":"${token}","CustomerRef":{"value":"1"},"CurrencyRef":{"value":"GBP"},"TotalAmt":9007199254740993.01,"Balance":${balance}}`;
  return new Response(
    `{"QueryResponse":{"${entity}":[${record}],"startPosition":1,"maxResults":1},"time":"2026-10-13T15:00:00Z"}`,
    { headers: { "Content-Type": "application/json" } },
  );
};
await start(91);
let lost = false;
const lostReply = async (name, args) => {
  const result = await service(name, args);
  if (name === "learn_quickbooks_import_commit" && !result.error && !lost) {
    lost = true;
    return { data: null, error: "synthetic lost reply" };
  }
  return result;
};
assert.equal((await runQuickBooksImport({ rpc: lostReply, fetcher })).state, "saved");
assert.equal(requests, 1);
pace();
assert.equal((await runQuickBooksImport({ rpc: service, fetcher })).state, "saved");
assert.equal(requests, 2);
assert.equal(
  sql(
    `select state='traversed' and pages_saved=2 and requests_used=2 from learn_quickbooks_imports where id=fixture_id(91)`,
  ),
  "t",
);
assert.equal(
  sql(
    `select payload->>'TotalAmt' from learn_quickbooks_source_versions where realm_id='9130357990044444' and entity='Invoice'`,
  ),
  "9007199254740993.01",
);
const invoiceDef = { ...definition, entities: ["Invoice"], maxRequests: 1 };
// Same source version with a different payload is visible as a conflict; a
// later version clears it, while an older response cannot replace it.
for (const [n, t, b, expected, conflict] of [
  [92, "1", "0.20", "0.10", true],
  [93, "2", "0.30", "0.30", false],
  [94, "1", "0.40", "0.30", false],
]) {
  token = t;
  balance = b;
  await start(n, invoiceDef);
  pace();
  assert.equal((await runQuickBooksImport({ rpc: service, fetcher })).state, "saved");
  const saved = JSON.parse(
    sql(
      `select jsonb_build_object('balance',v.payload->>'Balance','conflicted',l.conflicted) from learn_quickbooks_latest l join learn_quickbooks_source_versions v on v.id=l.version_id where l.realm_id='9130357990044444' and l.entity='Invoice'`,
    ),
  );
  assert.deepEqual(saved, { balance: expected, conflicted: conflict });
}
// Budget stops after a full page. Explicit continuation resumes the position.
await start(95, { ...invoiceDef, pageSize: 1 });
pace();
assert.equal((await runQuickBooksImport({ rpc: service, fetcher })).state, "saved");
assert.equal(
  sql(
    `select state='limit_reached' and start_position=2 from learn_quickbooks_imports where id=fixture_id(95)`,
  ),
  "t",
);
await start(96, { ...invoiceDef, pageSize: 1, resumeFrom: id(95) });
pace();
let emptyRequests = 0;
assert.equal(
  (
    await runQuickBooksImport({
      rpc: service,
      fetcher: async (url) => {
        emptyRequests++;
        assert.match(new URL(url).searchParams.get("query"), /STARTPOSITION 2/);
        return Response.json({ QueryResponse: {}, time: "2026-10-13T15:00:00Z" });
      },
    })
  ).state,
  "saved",
);
assert.equal(emptyRequests, 1);
assert.equal(
  sql(
    `select state='traversed' and requests_used=1 from learn_quickbooks_imports where id=fixture_id(96)`,
  ),
  "t",
);
// A replaced/expired lease cannot save. The attempt remains charged.
await start(97, invoiceDef);
pace();
const lease = await service("learn_quickbooks_import_acquire", { p_run: id(97) });
assert.equal(lease.data.state, "ready");
sql(
  `update learn_quickbooks_imports set lease_until=clock_timestamp()-interval '1 second' where id=fixture_id(97)`,
);
assert.equal(
  (
    await service("learn_quickbooks_import_current", {
      p_run: id(97),
      p_permit: lease.data.permitId,
    })
  ).data,
  false,
);
const denied = await service("learn_quickbooks_import_commit", {
  p_run: id(97),
  p_permit: lease.data.permitId,
  p_raw: '{"QueryResponse":{},"time":"2026-10-13T15:00:00Z"}',
});
assert.notEqual(denied.error, null);
assert.equal((await runQuickBooksImport({ rpc: service, fetcher })).state, "held");
assert.equal(
  sql(
    `select pages_saved=0 and requests_used=1 and state='limit_reached' from learn_quickbooks_imports where id=fixture_id(97)`,
  ),
  "t",
);
console.log(
  "PASS: actual import worker → SQL → synthetic provider; exact amounts, lost replies, conflicts, stale versions, budget, continuation and expired leases.",
);
