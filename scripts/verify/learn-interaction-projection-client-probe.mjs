/** Actual projection and identity handlers -> offline PostgreSQL; synthetic data only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { handleInteractionsSync } from "../../supabase/functions/_shared/worker_handlers/interactions_sync.ts";
import { handleIdentityResolve } from "../../supabase/functions/_shared/worker_handlers/identity_resolve.ts";
const container = process.argv[2];
if (!/^serviceos-interaction-projection-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Offline synthetic container only");
globalThis.Deno = { env: { get: () => undefined } };
const id = (n) => `ac68d905-cccc-4000-8000-${String(n).padStart(12, "0")}`;
const sql = (query) =>
  execFileSync(
    "/usr/local/bin/docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-h",
      "127.0.0.1",
      "-X",
      "-qAt",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", timeout: 30000 },
  ).trim();
const literal = (v) => "'" + String(v).replaceAll("'", "''") + "'";
sql(`insert into tenants(id) values('${id(3)}');
 insert into phone_calls(id,tenant_id,provider,provider_call_id,direction,from_number,to_number,started_at,duration_seconds) values('${id(300)}','${id(3)}','sipcentric','probe-call','IN','+441632960030','+441632960001','2026-10-11T13:00:00Z',12);
 insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,to_emails,cc_emails,snippet,direction,received_at) values('${id(301)}','${id(3)}','gmail','probe-email','customer@example.invalid','["office@example.invalid"]','[]','Synthetic actual-handler email preview','inbound','2026-10-11T13:01:00Z');`);
const phases = [];
const admin = {
  from() {
    throw Error("Direct handler writes forbidden");
  },
  async rpc(name, args) {
    assert.equal(args.p_tenant, id(3));
    let query;
    if (name === "learn_projection_pending")
      query = `select coalesce(json_agg(x),'[]') from learn_projection_pending(${literal(args.p_tenant)},${literal(args.p_source)},${Number(args.p_limit)}) x`;
    else if (name === "learn_projection_review_count")
      query = `select learn_projection_review_count(${literal(args.p_tenant)},${literal(args.p_source)})`;
    else if (name === "learn_identity_pending")
      query = `select coalesce(json_agg(x),'[]') from learn_identity_pending(${literal(args.p_tenant)},${Number(args.p_limit)}) x`;
    else if (name === "learn_project_interaction")
      query = `select learn_project_interaction(${[args.p_tenant, args.p_request, args.p_source, args.p_source_id, args.p_revision, args.p_phase].map(literal).join(",")})`;
    else if (name === "learn_identity_deliver")
      query = `select learn_identity_deliver(${[args.p_tenant, args.p_request, args.p_interaction, args.p_revision, args.p_phase].map(literal).join(",")})`;
    else throw Error("Unexpected RPC " + name);
    const data = JSON.parse(sql("set role service_role;" + query + ";"));
    if (args.p_phase) {
      phases.push({ name, phase: args.p_phase, request: args.p_request });
      if (args.p_phase === "publish") throw Error("Synthetic reply loss after database commit");
    }
    return { data, error: null };
  },
};
const ctx = { supabaseAdmin: admin, tenantId: id(3), jobId: null, payload: {} };
const projection = await handleInteractionsSync(ctx);
assert.equal(projection.success, true);
assert.equal(projection.recordsProcessed, 2);
const delivery = await handleIdentityResolve(ctx);
assert.equal(delivery.success, true);
assert.equal(delivery.result.cards_enriched, 2);
assert.equal(sql(`select count(*) from customer_cards where tenant_id='${id(3)}'`), "2");
assert.equal(
  sql(`select count(*) from platform_events where tenant_id='${id(3)}' and status='pending'`),
  "0",
);
assert.equal(
  sql(
    `select summary from customer_cards where tenant_id='${id(3)}' and summary like 'Synthetic%'`,
  ),
  "Synthetic actual-handler email preview",
);
for (let i = 0; i < phases.length; i += 2) {
  assert.equal(phases[i].phase, "publish");
  assert.equal(phases[i + 1].phase, "inspect");
  assert.equal(phases[i].request, phases[i + 1].request);
}
const originalLinks = sql(
  `select json_agg(json_build_array(id,related_person_id,metadata->'identity_delivery'->>'cardId') order by id) from interactions where tenant_id='${id(3)}'`,
);
assert.equal((await handleInteractionsSync(ctx)).recordsProcessed, 0);
sql(
  `update email_messages set snippet='Changed source reaches existing card' where id='${id(301)}';`,
);
assert.equal((await handleInteractionsSync(ctx)).recordsProcessed, 1);
assert.equal((await handleIdentityResolve(ctx)).result.cards_enriched, 1);
assert.equal(sql(`select count(*) from customer_cards where tenant_id='${id(3)}'`), "2");
assert.equal(
  sql(
    `select json_agg(json_build_array(id,related_person_id,metadata->'identity_delivery'->>'cardId') order by id) from interactions where tenant_id='${id(3)}'`,
  ),
  originalLinks,
);
assert.equal(
  sql(
    `select count(*) from customer_cards where tenant_id='${id(3)}' and summary='Changed source reaches existing card'`,
  ),
  "1",
);
assert.equal(
  sql(`select count(*) from platform_events where tenant_id='${id(3)}' and status='pending'`),
  "0",
);
console.log(
  "PASS: actual Phone/Email -> interaction -> customer-card handlers recover lost replies, refresh retained source changes and preserve identity/card links",
);
