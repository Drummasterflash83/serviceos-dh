// Invoked only by the disposable PostgreSQL runner. No network access; the actual
// production verification executor uses a synthetic fetch and real SQL RPCs.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyCommusoftConnection } from "../../supabase/functions/_shared/commusoft/verify_connection.ts";
import { parseVerificationReceipt } from "../../supabase/functions/_shared/commusoft/verification_contract.ts";

const [docker, container] = process.argv.slice(2);
if (!docker || !/^serviceos-commusoft-verification-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Disposable fixture required");
const exec = promisify(execFile);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const literal = (value) => (value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`);
async function sql(query) {
  try {
    const { stdout } = await exec(
      docker,
      [
        "exec",
        container,
        "psql",
        "-X",
        "-qAt",
        "-U",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        query,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    // Never forward SQL/transport errors that may contain a transient credential.
    throw Error("Synthetic database operation failed");
  }
}
const user =
  "set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;";
const service = "set request.jwt.claim.role='service_role';set role service_role;";
const requests = new Map();
async function receipt(n, mode = "check") {
  return parseVerificationReceipt(
    JSON.parse(await sql(`${user}select fixture_v_request(${n},${literal(mode)});`)),
    requests.get(n),
  );
}
async function approve(n) {
  await sql(`select fixture_v_prepare(${n});`);
  requests.set(n, {
    tenantId: id(300),
    actorId: id(180),
    requestId: id(n),
    definition: JSON.parse(await sql(`select fixture_definition('verify-${n}');`)),
  });
  assert.equal((await receipt(n, "apply")).state, "approved");
}
const calls = [];
async function rpc(name, args) {
  const parameters = {
    learn_commusoft_verify_acquire: ["p_tenant", "p_request"],
    learn_commusoft_verify_authorized: ["p_tenant", "p_request", "p_permit"],
    learn_commusoft_verify_finish: ["p_tenant", "p_request", "p_permit", "p_code", "p_retry_at"],
  }[name];
  if (!parameters || Object.keys(args).length !== parameters.length)
    throw Error("Unexpected fixture RPC");
  calls.push(name);
  const text = await sql(
    `${service}select ${name}(${parameters.map((k) => literal(args[k])).join(",")});`,
  );
  return {
    data: text === "t" ? true : text === "f" ? false : text ? JSON.parse(text) : null,
    error: null,
  };
}
let reads = 0;
const fetcher = async (url, init) => {
  assert.equal(String(url), "https://app.commusoft.co.uk/api/v2/properties?limit=1");
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "error");
  assert.equal(init.headers.Authorization, "Bearer SYNTHETIC_ROTATED_KEY");
  reads++;
  return Response.json({
    data: [{ id: 123, privateCustomer: "fixture-payload-must-not-be-retained" }],
    pagination: { hasMore: true, nextCursor: 123 },
  });
};
await approve(480);
assert.deepEqual(await verifyCommusoftConnection(id(300), id(480), { rpc, fetcher }), {
  state: "finished",
});
assert.equal((await receipt(480)).code, "access_verified");
assert.deepEqual(await verifyCommusoftConnection(id(300), id(480), { rpc, fetcher }), {
  state: "unconfirmed",
});
assert.equal(reads, 1);

await approve(481);
assert.deepEqual(
  await verifyCommusoftConnection(id(300), id(481), {
    fetcher,
    rpc: async (name, args) => {
      const result = await rpc(name, args);
      return name === "learn_commusoft_verify_finish"
        ? { data: null, error: { message: "Synthetic lost reply" } }
        : result;
    },
  }),
  { state: "unconfirmed" },
);
assert.equal((await receipt(481)).code, "access_verified");
assert.equal(reads, 2);

await approve(482);
assert.deepEqual(
  await verifyCommusoftConnection(id(300), id(482), {
    rpc,
    fetcher: async (url, init) => {
      const response = await fetcher(url, init);
      assert.equal((await receipt(482, "cancel")).state, "cancelled");
      return response;
    },
  }),
  { state: "finished" },
);
assert.equal((await receipt(482)).state, "cancelled");
assert.equal(reads, 3);
assert.equal(
  await sql(
    "select count(*) from provider_connection_events where detail->>'request_id'='00000000-0000-4000-8000-000000000482'",
  ),
  "0",
);
assert.equal(
  await sql(
    "select count(*) from learn_commusoft_verification_results where receipt::text like '%fixture-payload-must-not-be-retained%'",
  ),
  "0",
);
assert.equal(await sql("select count(*) from platform_jobs where tenant_id=fixture_id(300)"), "0");
assert.equal(calls.filter((name) => name === "learn_commusoft_verify_finish").length, 3);
console.log(
  "Real SQL plus production executor passed one-read success, lost-reply recovery, duplicate refusal and in-flight cancellation. No payload retained or import started.",
);
