/** Actual queue/intake SQL and coordinator with controlled parser/decoder/storage.
 * Synthetic only, network disabled by parent. Signature/runtime acceptance lives
 * in the separate Edge probe; this covers queue ownership and interruption. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runVoicemailQueueJob } from "../../supabase/functions/_shared/voicemail/queue.ts";
import { createPrivateVoicemailImporter } from "../../supabase/functions/_shared/voicemail/private-import.js";
import { signingDomain } from "../../supabase/functions/_shared/voicemail/signed-source.js";
const container = process.argv[2];
assert.match(container ?? "", /^serviceos-voicemail-intake-[a-f0-9]{8}$/);
const id = (n) => "ce420000-aaaa-4000-8000-" + String(n).padStart(12, "0");
const q = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const hash = (b) => createHash("sha256").update(b).digest("hex");
function sql(s) {
  return execFileSync(
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
    { input: s, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const check = (s, marker) => {
  assert.throws(
    () => sql(s),
    (e) => String(e.stderr).includes(marker),
  );
};
sql(`insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,binding_evidence,verified_by,enabled)
values('${id(8)}','${id(1)}','${id(5)}','${id(3)}','synthetic@example.invalid','${signingDomain}','${id(10)}','owner','2026-10-01','Queue fixture only','${id(12)}',true);`);
let providerReads = 0,
  uploads = 0,
  mode = "",
  currentJob,
  n = 2000;
const objects = new Map();
const argsOrder = ["p_tenant", "p_job", "p_worker", "p_attempt", "p_operation", "p_args"];
const db = {
  async rpc(name, args) {
    assert.equal(name, "voicemail_queue_step");
    const vals = argsOrder.map((k) =>
      q(typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]),
    );
    try {
      const data = JSON.parse(
        sql(`set role service_role;select public.voicemail_queue_step(${vals.join(",")});`),
      );
      if (
        (mode === "lost_publish_ack" && args.p_operation === "publish") ||
        (mode === "lost_fail_ack" && args.p_operation === "fail")
      ) {
        mode = "";
        throw Error("Synthetic lost response");
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: String(e.stderr ?? e.message) } };
    }
  },
  storage: {
    from(bucket) {
      return {
        async upload(path, bytes, options) {
          uploads++;
          assert.equal(options.upsert, false);
          const key = bucket + ":" + path;
          if (objects.has(key)) return { error: { status: 409 } };
          if (mode === "partial_audio" && bucket === "receptionist-voicemails")
            return { error: { status: 503 } };
          objects.set(key, Buffer.from(bytes));
          sql(
            `insert into storage.objects(bucket_id,name,metadata) values(${q(bucket)},${q(path)},${q(JSON.stringify({ size: bytes.length, mimetype: options.contentType }))}::jsonb);`,
          );
          if (mode === "expire_after_upload" && bucket === "receptionist-voicemails")
            sql(
              `update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${currentJob}';`,
            );
          if (mode === "pause_after_upload" && bucket === "receptionist-voicemails")
            sql(
              `insert into feature_flags values('${id(1)}','learn.inputs.phone.enabled','false');`,
            );
          return { data: { path }, error: null };
        },
        async download(path) {
          const bytes = objects.get(bucket + ":" + path);
          return bytes
            ? { data: new Blob([bytes]), error: null }
            : { data: null, error: { status: 404 } };
        },
      };
    },
  },
};
function create(maxAttempts = 3) {
  const number = ++n,
    job = id(number),
    payload = {
      routeId: id(8),
      accountId: id(3),
      messageId: number.toString(16),
      internalDate: "1791705600000",
    };
  sql(
    `insert into platform_jobs(id,tenant_id,job_type,payload,max_attempts) values('${job}','${id(1)}','phone.voicemail_import',${q(JSON.stringify(payload))},${maxAttempts});`,
  );
  return { job, number, payload };
}
function claim(f) {
  const worker = "synthetic-" + f.number + "-" + Math.random().toString(16).slice(2);
  const row = JSON.parse(
    sql(
      `set role service_role;select to_jsonb(j) from platform_jobs_claim('${worker}',1,300,array['phone.voicemail_import']) j;`,
    ),
  );
  assert.equal(row.id, f.job);
  currentJob = f.job;
  return {
    supabaseAdmin: db,
    tenantId: id(1),
    jobId: f.job,
    jobType: "phone.voicemail_import",
    payload: { deliberately: "ignored" },
    claim: { claimedBy: worker, attemptCount: row.attempt_count },
  };
}
const raw = Buffer.from("Synthetic original message");
const audio = Buffer.from([1, 2, 3, 4]);
function runner(f, extra = {}) {
  const importer = createPrivateVoicemailImporter({
    async extractSignedVoicemail(bytes) {
      return {
        audio: Buffer.from(audio),
        audioSha256: hash(audio),
        rawSha256: hash(bytes),
        contentFingerprint: hash(Buffer.from(String(f.number))),
        candidate: {
          version: "birchills-voicemail-email/1",
          systemReference: id(f.number + 100000),
          extension: "601",
          callerNumber: "01234567890",
          callerName: null,
          reportedDurationSeconds: 28,
          providerTranscript: "Synthetic queue source",
          emailReceivedAt: new Date(Number(f.payload.internalDate)).toISOString(),
        },
      };
    },
    async decodeVoicemailAudio() {
      return { state: "decoded", frames: 224000, durationSeconds: 28 };
    },
  });
  return (guarded, request) => {
    assert.deepEqual(request, { ...f.payload, tenantId: id(1) });
    return importer({
      client: guarded,
      tenantId: request.tenantId,
      routeId: request.routeId,
      source: {
        accountId: request.accountId,
        id: request.messageId,
        internalDate: request.internalDate,
      },
      loadRaw: async () => {
        providerReads++;
        return { id: request.messageId, internalDate: request.internalDate, raw: Buffer.from(raw) };
      },
      resolver: async () => [],
      ...extra,
    });
  };
}
const state = (f) =>
  JSON.parse(
    sql(
      `select jsonb_build_object('status',status,'errors',error_count,'attempt',attempt_count,'records',records_processed) from platform_jobs where id='${f.job}';`,
    ),
  );
function due(f) {
  sql(
    `update platform_jobs set available_at=clock_timestamp()-interval '1 second' where id='${f.job}';`,
  );
}
function step(ctx, op, args = {}) {
  return `set role service_role;select voicemail_queue_step('${ctx.tenantId}','${ctx.jobId}',${q(ctx.claim.claimedBy)},${ctx.claim.attemptCount},'${op}',${q(JSON.stringify(args))});`;
}
const scenarios = [];
let f = create(),
  ctx = claim(f),
  before = providerReads;
assert.equal(
  (await runVoicemailQueueJob({ ...ctx, tenantId: id(2) }, runner(f))).state,
  "unconfirmed",
);
assert.equal(
  (await runVoicemailQueueJob({ ...ctx, claim: { ...ctx.claim, claimedBy: "wrong" } }, runner(f)))
    .state,
  "unconfirmed",
);
assert.equal(providerReads, before);
check(
  step(ctx, "bind").replace("set role service_role;", "set role authenticated;"),
  "permission denied",
);
check("set role anon;select * from receptionist_voicemail_jobs;", "permission denied");
scenarios.push("tenant, role and worker isolation before provider");
mode = "lost_publish_ack";
let r = await runVoicemailQueueJob(ctx, runner(f));
assert.equal(r.state, "succeeded");
assert.equal(r.historicalReceipt, true);
assert.equal(state(f).records, 1);
before = providerReads;
r = await runVoicemailQueueJob(ctx, runner(f));
assert.equal(r.state, "succeeded");
assert.equal(providerReads, before);
check(
  `update receptionist_voicemail_job_receipts set receipt='{}' where job_id='${f.job}';`,
  "voicemail_job_evidence_immutable",
);
scenarios.push("lost publication acknowledgement and provider-free receipt recovery");
f = create();
ctx = claim(f);
mode = "partial_audio";
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "retrying");
assert.equal(state(f).errors, 1);
assert.equal(
  sql(
    `select count(*) from receptionist_voicemails where provider_message_id='${id(f.number + 100000)}'`,
  ),
  "0",
);
mode = "";
due(f);
ctx = claim(f);
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "succeeded");
assert.equal(
  sql(
    `select count(*) from receptionist_voicemail_sources where provider_email_id='${f.payload.messageId}'`,
  ),
  "1",
);
scenarios.push("partial storage retry preserves one source and one message");
f = create(1);
ctx = claim(f);
sql(`insert into feature_flags values('${id(1)}','learn.inputs.email.enabled','false');`);
before = providerReads;
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "waiting");
assert.equal(providerReads, before);
assert.equal(state(f).errors, 0);
sql("delete from feature_flags;");
due(f);
ctx = claim(f);
assert.equal(ctx.claim.attemptCount, 2);
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "succeeded");
scenarios.push("pause before provider preserves retry budget and monotonic claim attempts");
f = create();
ctx = claim(f);
mode = "pause_after_upload";
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "waiting");
assert.equal(
  sql(
    `select count(*) from receptionist_voicemails where provider_message_id='${id(f.number + 100000)}'`,
  ),
  "0",
);
sql("delete from feature_flags;");
mode = "";
due(f);
ctx = claim(f);
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "succeeded");
scenarios.push("pause between storage and publication prevents publication");
f = create();
ctx = claim(f);
const old = ctx;
mode = "expire_after_upload";
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "unconfirmed");
assert.equal(
  sql(
    `select count(*) from receptionist_voicemails where provider_message_id='${id(f.number + 100000)}'`,
  ),
  "0",
);
assert.equal(sql("set role service_role;select voicemail_queue_recover();"), "1");
mode = "";
due(f);
ctx = claim(f);
before = providerReads;
assert.equal((await runVoicemailQueueJob(old, runner(f))).state, "unconfirmed");
assert.equal(providerReads, before);
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "succeeded");
scenarios.push("expired worker fenced before publication and after reclaim");
f = create();
ctx = claim(f);
sql(step(ctx, "bind"));
sql(
  `update platform_jobs set payload=jsonb_set(payload,'{messageId}','"bad"') where id='${f.job}';`,
);
before = providerReads;
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "unconfirmed");
assert.equal(providerReads, before);
sql(`update platform_jobs set payload=${q(JSON.stringify(f.payload))} where id='${f.job}';`);
check(
  step(ctx, "prepare", {
    p_tenant: id(1),
    p_route: id(8),
    p_source: { email_id: "bad", received_at: "2026-10-11T12:00:00Z" },
    p_candidate: {},
  }),
  "voicemail_queue_source_mismatch",
);
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "succeeded");
scenarios.push("frozen payload and exact prepare source binding");
f = create();
ctx = claim(f);
sql(
  "create function voicemail_atomic_probe() returns trigger language plpgsql as $$begin if new.job_type='phone.voicemail_import' and new.status='succeeded' then raise exception 'synthetic_queue_commit_failure';end if;return new;end$$;create trigger voicemail_atomic_probe before update on platform_jobs for each row execute function voicemail_atomic_probe();",
);
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "retrying");
assert.equal(
  sql(
    `select count(*) from receptionist_voicemails where provider_message_id='${id(f.number + 100000)}'`,
  ),
  "0",
);
sql("drop trigger voicemail_atomic_probe on platform_jobs;drop function voicemail_atomic_probe();");
due(f);
ctx = claim(f);
assert.equal((await runVoicemailQueueJob(ctx, runner(f))).state, "succeeded");
scenarios.push("job settlement failure rolls back voicemail publication");
f = create(2);
ctx = claim(f);
mode = "lost_fail_ack";
r = await runVoicemailQueueJob(ctx, async () => {
  throw Error("private response must not be saved");
});
assert.equal(r.state, "retrying");
assert.equal(r.historicalReceipt, true);
assert.equal(
  sql(`select error_code from platform_jobs where id='${f.job}';`),
  "voicemail_import_unconfirmed",
);
due(f);
ctx = claim(f);
assert.equal(
  (
    await runVoicemailQueueJob(ctx, async () => {
      throw Error("voicemail_provider_temporary");
    })
  ).state,
  "dead_letter",
);
scenarios.push("lost failure acknowledgement, safe diagnostics and bounded retries");
f = create(1);
ctx = claim(f);
sql(
  `update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${f.job}';`,
);
assert.equal(sql("set role service_role;select voicemail_queue_recover();"), "1");
assert.equal(state(f).status, "dead_letter");
assert.equal(sql("set role service_role;select voicemail_queue_recover();"), "0");
scenarios.push("bounded dead-worker recovery before binding");
f = create();
ctx = claim(f);
r = await runVoicemailQueueJob(ctx, async () => ({ state: "published" }));
assert.equal(r.state, "unconfirmed");
assert.equal(state(f).status, "running");
sql(`update platform_jobs set status='cancelled' where id='${f.job}';`);
scenarios.push("handler success without publication is unconfirmed");
f = create();
ctx = claim(f);
r = await runVoicemailQueueJob(ctx, async () => {
  throw Error("voicemail_provider_access_denied");
});
assert.equal(r.state, "dead_letter");
scenarios.push("permanent provider denial needs operator review");
f = create();
ctx = claim(f);
const concurrent = await Promise.all([
  runVoicemailQueueJob(ctx, runner(f)),
  runVoicemailQueueJob(ctx, runner(f)),
]);
assert.ok(concurrent.every((r) => r.state === "succeeded"));
assert.equal(
  sql(
    `select count(*) from receptionist_voicemails where provider_message_id='${id(f.number + 100000)}'`,
  ),
  "1",
);
assert.equal(
  sql(`select count(*) from receptionist_voicemail_job_receipts where job_id='${f.job}'`),
  "1",
);
scenarios.push("concurrent delivery of one claim publishes one message and one settlement");
console.log(
  JSON.stringify({
    state: "passed",
    scope:
      "offline PostgreSQL plus real coordinator; controlled parser, decoder and Storage; no provider or hosted changes",
    scenarios,
    providerReads,
    uploads,
  }),
);
