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
const id = (n) => `ed380923-ffff-4000-8000-${String(n).padStart(12, "0")}`;
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
// Retain drafts from the actual Gmail parser alongside the ordinary messages.
const { parseGmailMessages } = await import("../../supabase/functions/_shared/gmail_message.ts");
for (const n of [303, 304]) {
  const raw = {
    id: "draft-" + n,
    threadId: "draft-thread-" + n,
    internalDate: "1791738000000",
    labelIds: ["DRAFT"],
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "office@example.invalid" },
        { name: "To", value: "draft-only@example.invalid" },
        { name: "Date", value: "Sun, 11 Oct 2026 17:00:00 +0000" },
        { name: "Subject", value: "Unsent synthetic draft" },
      ],
      body: { data: btoa("Retained draft body") },
    },
  };
  const parsed = parseGmailMessages([raw], {
    tenantId: id(3),
    provider: "gmail",
    mailbox: "office@example.invalid",
  }).messageRows[0];
  assert.equal(parsed.direction, "unknown");
  assert.equal(parsed.sent_at, null);
  sql(
    `insert into email_messages select (jsonb_populate_record(null::email_messages,${lit(JSON.stringify({ ...parsed, id: id(n), created_at: "2026-10-11T17:00:00Z", updated_at: "2026-10-11T17:00:00Z" }))}::jsonb)).*;`,
  );
}
const retainedDrafts = sql(
  `select jsonb_agg(to_jsonb(m) order by id) from email_messages m where tenant_id='${id(3)}' and provider_message_id like 'draft-%'`,
);
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

assert.equal(sql(`select count(*) from email_messages where tenant_id='${id(3)}'`), "4");
assert.equal(sql(`select count(*) from interactions where tenant_id='${id(3)}'`), "2");
assert.equal(
  sql(
    `select count(*) from interactions where tenant_id='${id(3)}' and source_id in ('${id(303)}','${id(304)}')`,
  ),
  "0",
);
// Direct publication is guarded as well as automatic selection.
const draftRevision = sql(
  `select learn_projection_revision(learn_email_source_fields(m),'') from email_messages m where id='${id(303)}'`,
);
const direct = JSON.parse(
  sql(
    `set role service_role;select learn_project_interaction('${id(3)}','${id(400)}','email','${id(303)}',${lit(draftRevision)},'publish')`,
  ),
);
assert.equal(direct.state, "review_required");
assert.equal(direct.reason, "email_draft");
assert.equal(direct.interactionId, null);
assert.equal(direct.eventId, null);
assert.equal(sql(`select count(*) from customer_cards where tenant_id='${id(3)}'`), "2");
// Existing legacy draft interactions remain retained but cannot feed a card or its communication excerpts.
sql(`insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,from_address,to_addresses,processing_status)
values('${id(401)}','${id(3)}','email','email','email_messages','${id(304)}','email_message','outbound','2026-10-11T17:00:00Z','office@example.invalid',array['draft-only@example.invalid'],'ready');`);
assert.equal(
  sql(
    `select count(*) from learn_identity_pending('${id(3)}',50) where interaction_id='${id(401)}'`,
  ),
  "0",
);
const identityRevision = sql(
  `select learn_identity_revision(i) from interactions i where id='${id(401)}'`,
);
const held = JSON.parse(
  sql(
    `set role service_role;select learn_identity_deliver('${id(3)}','${id(402)}','${id(401)}',${lit(identityRevision)},'publish')`,
  ),
);
assert.equal(held.state, "review_required");
assert.equal(held.reason, "email_draft");
assert.equal(held.cardEnriched, false);
const person = sql(
  `select person_id from customer_cards where tenant_id='${id(3)}' order by id limit 1`,
);
const reviewed = JSON.parse(
  sql(`select learn_identity_review_state('${id(3)}','${id(401)}',${lit(person)})`),
);
assert.equal(reviewed.can_apply, false);
assert.equal(reviewed.blocked_reason, "email_draft");
const refreshedRevision = sql(
  `select learn_identity_revision(i) from interactions i where id='${id(401)}'`,
);
const force = JSON.parse(
  sql(
    `select learn_identity_deliver_internal('${id(3)}','${id(403)}','${id(401)}',${lit(refreshedRevision)},'publish',${lit(person)})`,
  ),
);
assert.equal(force.state, "review_required");
assert.equal(force.reason, "email_draft");
sql(`insert into profiles(id,tenant_id,role) values('${id(404)}','${id(3)}','owner');`);
const actual = sql(
  `select id from interactions where tenant_id='${id(3)}' and source_id='${id(301)}'`,
);
const excerpt = JSON.parse(
  sql(
    `set role authenticated;set request.jwt.claim.sub='${id(404)}';select learn_card_communications_read('${id(3)}',p_ids=>array['${id(401)}',${lit(actual)}]::uuid[])`,
  ),
);
assert.deepEqual(
  excerpt.rows.map((r) => r.id),
  [actual],
);
for (const role of ["anon", "authenticated", "service_role"])
  assert.equal(
    sql(
      `select has_function_privilege('${role}','learn_interaction_is_draft(uuid,text,uuid)','EXECUTE')`,
    ),
    "f",
  );
assert.equal(
  sql(
    `select jsonb_agg(to_jsonb(m) order by id) from email_messages m where tenant_id='${id(3)}' and provider_message_id like 'draft-%'`,
  ),
  retainedDrafts,
);
assert.equal(sql(`select count(*) from interactions where id='${id(401)}'`), "1");
assert.equal(sql(`select count(*) from customer_cards where tenant_id='${id(3)}'`), "2");
console.log(
  "PASS: actual Gmail parser retains drafts; fenced projection/identity jobs publish only communications; direct/operator paths and bounded card excerpts exclude legacy drafts without deleting source history",
);

assert.equal(sql(`select learn_projection_review_count('${id(3)}','email')`), "0");
assert.equal(sql(`select learn_identity_review_count('${id(3)}')`), "0");
console.log("PASS: retained drafts do not become actionable processing failures");

// A later authorised source correction must invalidate a previous draft hold.
sql(
  `update email_messages set raw_payload='{"label_ids":["SENT"]}',direction='outbound',sent_at='2026-10-11T17:00:00Z' where id='${id(303)}'`,
);
const correctedRevision = sql(
  `select learn_projection_revision(learn_email_source_fields(m),'') from email_messages m where id='${id(303)}'`,
);
assert.notEqual(correctedRevision, draftRevision);
assert.equal(
  sql(
    `select count(*) from learn_projection_pending('${id(3)}','email',50) where source_id='${id(303)}'`,
  ),
  "1",
);
const historical = JSON.parse(
  sql(
    `set role service_role;select learn_project_interaction('${id(3)}','${id(400)}','email','${id(303)}',${lit(draftRevision)},'publish')`,
  ),
);
assert.deepEqual(historical, direct);
console.log(
  "PASS: a source correction invalidates the old draft classification while historical receipts remain exact",
);
