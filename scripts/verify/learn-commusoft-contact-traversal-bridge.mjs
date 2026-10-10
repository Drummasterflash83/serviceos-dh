// Actual worker + transport + SQL; synthetic provider, disposable database only.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  runCommusoftWorker,
  createCommusoftPageHandler,
} from "../../supabase/functions/_shared/commusoft/worker.ts";
import { readApprovedCommusoftPage } from "../../supabase/functions/_shared/commusoft/bound_page.ts";
import { createCommusoftPermitPorts } from "../../supabase/functions/_shared/commusoft/permit_server.ts";
import {
  committedCommusoftPage,
  persistCommusoftPage,
} from "../../supabase/functions/_shared/commusoft/page_store.ts";
const [docker, container] = process.argv.slice(2);
if (!docker || !/^serviceos-contact-traversal-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Disposable fixture required");
const exec = promisify(execFile);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const literal = (v) =>
  v == null
    ? "null"
    : `'${(typeof v === "object" ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`;
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
      { timeout: 15000, maxBuffer: 1048576 },
    );
    return stdout.trim();
  } catch {
    throw Error("Synthetic database operation failed");
  }
}
const service = "set request.jwt.claim.role='service_role';set role service_role;";
const user =
  "set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;";
await sql(
  `grant select on tenants,feature_flags,platform_jobs,connector_accounts,tenant_connectors,provider_connections to service_role;${user}select learn_operator_input_request(fixture_id(100),fixture_id(210),fixture_id(180),fixture_definition('start')||'{"resource":"propertyContacts","contact_type":"customer"}');`,
);
const parameters = {
  learn_commusoft_claim_jobs: ["p_worker"],
  learn_commusoft_acquire_page: [
    "p_tenant_id",
    "p_job_id",
    "p_claimed_by",
    "p_attempt_count",
    "p_expected",
  ],
  learn_commusoft_defer_page: [
    "p_tenant_id",
    "p_job_id",
    "p_claimed_by",
    "p_attempt_count",
    "p_permit_id",
    "p_retry_at",
  ],
  learn_commusoft_commit_page: [
    "p_tenant_id",
    "p_job_id",
    "p_claimed_by",
    "p_attempt_count",
    "p_permit_id",
    "p_envelope",
  ],
  learn_commusoft_committed_page: ["p_tenant_id", "p_job_id", "p_claimed_by", "p_attempt_count"],
  learn_commusoft_finish_job: [
    "p_tenant_id",
    "p_job_id",
    "p_claimed_by",
    "p_attempt_count",
    "p_outcome",
  ],
};
let lost = false;
const db = {
  async rpc(name, args) {
    const keys = parameters[name];
    assert.ok(keys);
    assert.deepEqual(Object.keys(args).sort(), [...keys].sort());
    const call = `${name}(${keys.map((k) => literal(args[k])).join(",")})`;
    const query =
      name === "learn_commusoft_claim_jobs"
        ? `select coalesce(jsonb_agg(to_jsonb(j)),'[]') from ${call} j`
        : `select ${call}`;
    const value = await sql(service + query);
    if (name === "learn_commusoft_commit_page" && !lost) {
      lost = true;
      return { data: null, error: { message: "Synthetic lost acknowledgement" } };
    }
    return {
      data: value === "t" ? true : value === "f" ? false : value ? JSON.parse(value) : null,
      error: null,
    };
  },
  from(table) {
    assert.ok(
      [
        "tenants",
        "feature_flags",
        "platform_jobs",
        "connector_accounts",
        "tenant_connectors",
        "provider_connections",
        "learn_commusoft_contact_targets",
      ].includes(table),
    );
    let columns;
    const conditions = [];
    const q = {
      select(c) {
        assert.match(c, /^[a-z_,]+$/);
        columns = c;
        return q;
      },
      eq(k, v) {
        assert.match(k, /^[a-z_]+$/);
        conditions.push(`${k}=${literal(v)}`);
        return q;
      },
      async maybeSingle() {
        const value = await sql(
          `${service}select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select ${columns} from ${table} where ${conditions.join(" and ")}) r`,
        );
        const rows = JSON.parse(value);
        return { data: rows.length === 1 ? rows[0] : null, error: rows.length > 1 ? {} : null };
      },
    };
    return q;
  },
};
const requests = [];
const fetcher = async (url, options) => {
  const u = new URL(url);
  assert.equal(u.origin, "https://app.commusoft.co.uk");
  assert.equal(u.pathname, "/api/v2/propertyContacts");
  assert.equal(options.headers.Authorization, "Bearer SYNTHETIC_NO_NETWORK");
  assert.equal(options.method, "GET");
  assert.equal(options.redirect, "error");
  const parent = Number(u.searchParams.get("propertyID")),
    after = u.searchParams.get("after");
  requests.push([parent, after]);
  assert.ok(parent === 101 || parent === 202);
  const more = parent === 101 && after === null;
  const data =
    parent === 101 && after !== null
      ? []
      : [{ id: parent === 101 ? 11 : 1, propertyID: parent, firstName: "Synthetic only" }];
  return Response.json({ data, pagination: { hasMore: more, nextCursor: more ? 11 : null } });
};
const handler = createCommusoftPageHandler({
  recover: committedCommusoftPage,
  read: (ctx) => readApprovedCommusoftPage(ctx, createCommusoftPermitPorts(ctx, fetcher)),
  persist: persistCommusoftPage,
  clock: Date.now,
});
for (let i = 0; i < 3; i++) {
  await sql(
    "update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';update platform_jobs set available_at=clock_timestamp()-interval '1 second' where status='queued' and tenant_id=fixture_id(100);",
  );
  const result = await runCommusoftWorker(db, id(171), handler);
  assert.equal(result.claimed, 1);
  assert.equal(result.outcomes[0].status, "succeeded");
  assert.equal(result.outcomes[0].successor_id === null, i === 2);
}
assert.deepEqual(requests, [
  [101, null],
  [101, "11"],
  [202, null],
]);
assert.ok(lost);
const cp = JSON.parse(
  await sql("select sync_cursor from connector_accounts where tenant_id=fixture_id(100)"),
);
assert.deepEqual(cp, {
  approvalId: id(210),
  after: null,
  pages: 3,
  complete: true,
  propertyId: null,
  propertiesCompleted: 2,
});
assert.equal(
  await sql(
    "select count(*) from learn_business_input_pages where checkpoint_after->>'approvalId'='00000000-0000-4000-8000-000000000210'",
  ),
  "3",
);
console.log(
  "Actual worker, bound transport and SQL passed contact cursor reset, property transitions and lost-acknowledgement settlement with exactly three provider fixture calls.",
);
