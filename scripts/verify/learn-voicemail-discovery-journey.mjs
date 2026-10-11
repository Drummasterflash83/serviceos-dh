/** Offline retained email -> actual discovery queue -> Workspace bridge -> signed
 * audio -> actual SQL publication. Gmail/DNS/Storage transports are synthetic. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { runVoicemailQueueJob } from "../../supabase/functions/_shared/voicemail/queue.ts";
import { importWorkspaceVoicemail } from "../../supabase/functions/_shared/voicemail/workspace-import.ts";
import { importPrivateVoicemail } from "./voicemail-auth/private-import.mjs";
const container = process.argv[2];
const id = (n) => "ce440000-aaaa-4000-8000-" + String(n).padStart(12, "0");
const q = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const sql = (s) =>
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
    { input: s, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const fixture = JSON.parse(
  execFileSync(process.execPath, ["scripts/verify/voicemail-auth/edge-fixture.mjs"], {
    encoding: "utf8",
  }),
);
const job = sql(
  `select job_id from receptionist_voicemail_candidates where route_id='${id(2)}' and email_message_id='${id(11)}';`,
);
assert.match(job, /^[a-f0-9-]{36}$/);
// Only the chosen previously discovered fixture is due during this local journey.
sql(`update platform_jobs set available_at=clock_timestamp()+interval '1 day' where status in('queued','retrying');
 update platform_jobs set available_at=clock_timestamp()-interval '1 second' where id='${job}';
 update receptionist_voicemail_email_routes set enabled=(id='${id(2)}') where tenant_id='${id(1)}';`);
const worker = "synthetic-discovery-journey";
const claim = JSON.parse(
  sql(
    `set role service_role;select to_jsonb(j) from platform_jobs_claim('${worker}',1,300,array['phone.voicemail_import']) j;`,
  ),
);
assert.equal(claim.id, job);
const objects = new Map();
let providerReads = 0;
let loseReply = true;
const db = {
  async rpc(name, args) {
    assert.equal(name, "voicemail_queue_step");
    try {
      const data = JSON.parse(
        sql(
          "set role service_role;select voicemail_queue_step(" +
            ["p_tenant", "p_job", "p_worker", "p_attempt", "p_operation", "p_args"]
              .map((k) => q(typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]))
              .join(",") +
            ");",
        ),
      );
      if (loseReply && args.p_operation === "publish") {
        loseReply = false;
        return { error: { message: "synthetic lost acknowledgement" } };
      }
      return { data };
    } catch (e) {
      return { error: { message: String(e.stderr ?? e.message) } };
    }
  },
  storage: {
    from: (bucket) => ({
      async upload(path, bytes, options) {
        assert.equal(options.upsert, false);
        assert.equal(objects.has(bucket + path), false);
        objects.set(bucket + path, new Blob([bytes]));
        sql(
          `insert into storage.objects(bucket_id,name,metadata) values(${q(bucket)},${q(path)},${q(JSON.stringify({ size: bytes.length, mimetype: options.contentType }))});`,
        );
        return {};
      },
      async download(path) {
        return { data: objects.get(bucket + path) };
      },
    }),
  },
};
const ctx = {
  supabaseAdmin: db,
  tenantId: id(1),
  jobId: job,
  jobType: "phone.voicemail_import",
  claim: { claimedBy: worker, attemptCount: claim.attempt_count },
};
const run = (bound, request) =>
  importWorkspaceVoicemail(bound, request, {
    importer: importPrivateVoicemail,
    ports: () => ({
      mailbox: async () => ({
        tenantId: id(1),
        accountId: id(3),
        mailbox: "synthetic@example.invalid",
        profileMailbox: "synthetic@example.invalid",
      }),
      accessToken: async () => "synthetic-only",
    }),
    resolver: async (name, type) => {
      assert.equal(name, fixture.dnsName);
      assert.equal(type, "TXT");
      return [[fixture.keyRecord]];
    },
    fetcher: async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer synthetic-only");
      assert.equal(options.redirect, "error");
      providerReads++;
      if (url.endsWith("/profile"))
        return Response.json({ emailAddress: "synthetic@example.invalid" });
      assert.equal(
        url,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${claim.payload.messageId}?format=raw`,
      );
      return Response.json({
        id: claim.payload.messageId,
        internalDate: claim.payload.internalDate,
        labelIds: ["INBOX"],
        raw: Buffer.from(fixture.raw).toString("base64url"),
      });
    },
  });
const result = await runVoicemailQueueJob(ctx, run);
assert.equal(result.state, "succeeded", JSON.stringify(result));
assert.equal(result.recordsProcessed, 1);
assert.equal(providerReads, 2);
assert.equal(objects.size, 2);
const replay = await runVoicemailQueueJob(ctx, () => {
  throw Error("Replay must not load a provider");
});
assert.equal(replay.state, "succeeded");
assert.equal(replay.historicalReceipt, true);
const status = JSON.parse(
  sql(`set role service_role;select voicemail_discovery_status('${id(1)}','${id(2)}');`),
);
assert.equal(status.jobs.succeeded, 1);
assert.equal(status.coverage_complete, false);
assert.equal(sql(`select count(*) from receptionist_voicemails where tenant_id='${id(1)}'`), "1");
console.log(
  JSON.stringify({
    state: "passed",
    journey:
      "retained-email discovery through Workspace bridge and queue to private published voicemail",
    provider: "synthetic transport; real signature verification and MP3 decode",
    database: "actual offline PostgreSQL",
    storage: "controlled transport with actual SQL metadata",
    lostPublicationReplyRecovered: true,
    replayProviderReads: 0,
    coverageComplete: false,
  }),
);
