/** Actual handlers and fenced worker coordinator -> offline PostgreSQL only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { handleInteractionsSync } from "../../supabase/functions/_shared/worker_handlers/interactions_sync.ts";
import { handleIdentityResolve } from "../../supabase/functions/_shared/worker_handlers/identity_resolve.ts";
import { runLearnProcessingJob } from "../../supabase/functions/_shared/learn-processing-job.ts";
const container = process.argv[2];
if (!/^serviceos-processing-queue-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Offline synthetic container required");
globalThis.Deno = { env: { get: () => undefined } };
const id = (n) => `dd780923-ffff-4000-8000-${String(n).padStart(12, "0")}`;
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
const lit = (v) => (v === null ? "null" : "'" + String(v).replaceAll("'", "''") + "'");
sql(`insert into tenants(id) values('${id(3)}');
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,to_emails,cc_emails,snippet,direction,received_at) values
('${id(301)}','${id(3)}','gmail','queue-probe-a','a@example.invalid','[]','[]','First synthetic input','inbound','2026-10-11T17:00:00Z'),
('${id(302)}','${id(3)}','gmail','queue-probe-b','b@example.invalid','[]','[]','Second synthetic input','inbound','2026-10-11T17:01:00Z');`);
const phases = [];
const db = {
  from() {
    throw Error("Direct handler mutation forbidden");
  },
  async rpc(name, a) {
    assert.equal(a.p_tenant, id(3));
    let q;
    if (name === "learn_projection_pending")
      q = `select coalesce(json_agg(x),'[]') from learn_projection_pending(${lit(a.p_tenant)},${lit(a.p_source)},${Number(a.p_limit)})x`;
    else if (name === "learn_projection_review_count")
      q = `select learn_projection_review_count(${lit(a.p_tenant)},${lit(a.p_source)})`;
    else if (name === "learn_identity_pending")
      q = `select coalesce(json_agg(x),'[]') from learn_identity_pending(${lit(a.p_tenant)},${Number(a.p_limit)})x`;
    else if (name === "learn_identity_review_count")
      q = `select learn_identity_review_count(${lit(a.p_tenant)})`;
    else if (name === "learn_processing_publish")
      q = `select learn_processing_publish(${[a.p_tenant, a.p_job, a.p_worker, a.p_attempt, a.p_request, a.p_source, a.p_source_id, a.p_revision, a.p_phase].map(lit).join(",")})`;
    else if (name === "learn_processing_settle")
      q = `select learn_processing_settle(${[a.p_tenant, a.p_job, a.p_worker, a.p_attempt, a.p_request, JSON.stringify(a.p_definition), a.p_phase].map(lit).join(",")})`;
    else throw Error("Unexpected RPC " + name);
    const data = JSON.parse(sql("set role service_role;" + q + ";"));
    if (a.p_phase) {
      phases.push({ name, phase: a.p_phase, request: a.p_request });
      if (["publish", "settle"].includes(a.p_phase)) throw Error("Synthetic lost committed reply");
    }
    return { data, error: null };
  },
};
for (const [type, handler, n] of [
  ["interactions.sync", handleInteractionsSync, 330],
  ["identity.resolve", handleIdentityResolve, 331],
]) {
  sql(
    `insert into platform_jobs(id,tenant_id,job_type,job_key,status,payload) values('${id(n)}','${id(3)}','${type}','${type}:${id(3)}${type === "interactions.sync" ? ":email" : ""}','queued','{"source":"email","limit":1}');`,
  );
  let completed = 0;
  for (let i = 0; i < 5; i++) {
    const jobs = JSON.parse(
      sql(
        `select coalesce(json_agg(x),'[]') from platform_jobs_claim('synthetic-probe',1,300,array['${type}'])x;`,
      ),
    );
    if (!jobs.length) break;
    assert.equal(jobs.length, 1);
    const j = jobs[0];
    assert.equal(j.tenant_id, id(3));
    const result = await runLearnProcessingJob(
      {
        supabaseAdmin: db,
        tenantId: j.tenant_id,
        jobId: j.id,
        jobType: j.job_type,
        payload: j.payload,
        claim: { claimedBy: j.claimed_by, attemptCount: j.attempt_count },
      },
      handler,
    );
    assert.equal(result.state, "succeeded");
    assert.equal(result.historicalReceipt, true);
    completed++;
  }
  assert.equal(completed, 3, "two one-record batches and one terminal empty check");
}
assert.equal(sql(`select count(*) from customer_cards where tenant_id='${id(3)}'`), "2");
assert.equal(
  sql(`select count(*) from platform_events where tenant_id='${id(3)}' and status='pending'`),
  "0",
);
assert.equal(
  sql(`select count(*) from platform_jobs where tenant_id='${id(3)}' and status<>'succeeded'`),
  "0",
);
assert.equal(
  sql(`select count(*) from learn_processing_settlements where tenant_id='${id(3)}'`),
  "6",
);
assert.equal(
  sql(`select count(*) from learn_processing_publications where tenant_id='${id(3)}'`),
  "4",
);
for (let i = 0; i < phases.length; i += 2) {
  assert.ok(["publish", "settle"].includes(phases[i].phase));
  assert.equal(phases[i + 1].phase, "inspect");
  assert.equal(phases[i].request, phases[i + 1].request);
}
console.log(
  "PASS: real handlers drain two retained emails through six durable jobs into two cards; all publication and settlement reply losses recover without duplicate mutations",
);
