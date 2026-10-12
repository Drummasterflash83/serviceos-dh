/** Bounded real Slack TEST acceptance driver. Credential and approvals are entered
 * through the existing signed-in operator UI. This never creates an account,
 * grants authority, enables capture, provisions credentials or sends Slack writes. */
import { readFileSync, openSync, writeSync, fsyncSync, closeSync, unlinkSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
const mode = process.argv[2],
  path = ".verification-results/slack-real-test-20261012.json";
if (
  !["prepare", "baseline", "inspect", "step"].includes(mode) ||
  process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit bounded TEST mode required");
// Fence all runner instances before reading the shared budget. A crashed process
// leaves the lock for inspection; never automatically remove an uncertain lock.
const lockPath = path + ".lock";
const lockFd = openSync(lockPath, "wx", 0o600);
writeSync(lockFd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), mode }));
fsyncSync(lockFd);
process.on("exit", () => {
  closeSync(lockFd);
  unlinkSync(lockPath);
});
const tenant = "f8c114fa-fee7-4983-8970-f6e7f5fd3129",
  team = "T0CC5V4D7";
const channels = ["C07V0V0UKHN", "CEJ0026TW"];
const start = "2026-10-12T00:00:00.000Z",
  end = "2026-10-12T19:00:00.000Z";
const token = savedCliToken(),
  q = (sql) => communicationQuery(token, sql);
const state = await q(`select jsonb_build_object(
 'cronCatalogPresent',to_regclass('cron.job') is not null,
 'slackJobs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'tenant',tenant_id,'status',status,'type',job_type,'attempt',attempt_count,'maxAttempts',max_attempts,'account',payload->>'connector_account_id','thread',payload->>'thread_import_id')),'[]') from platform_jobs where job_type in('slack.history_sync','slack.thread_sync') and status in('queued','running','retrying')),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'account',i.account_id,'definition',i.definition,'jobId',j.id,'jobStatus',j.status,'attempt',j.attempt_count,'claimedBy',j.claimed_by,'lease',j.lease_expires_at,'correctedRun',j.metadata->'scopeCorrection'->>'runId','pageCommitted',coalesce(j.metadata ? 'slack_page_v1',false))),'[]') from slack_history_imports i join platform_jobs j on j.id=i.job_id where i.tenant_id='${tenant}'),
 'threads',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'account',account_id,'definition',definition,'scope',scope)),'[]') from slack_thread_imports where tenant_id='${tenant}'),
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'scope',settings->'slack_history')),'[]') from connector_accounts where tenant_id='${tenant}' and settings ? 'slack_history'),
 'connection',(select jsonb_build_object('id',id,'team',non_secret_config->>'team_id','kind',non_secret_config->>'credential_kind','user',non_secret_config->>'authorized_user_id','status',status,'revoked',revoked_at,'field',configured_fields) from provider_connections where tenant_id='${tenant}' and provider='slack'),
 'messages',(select count(*) from slack_messages where tenant_id='${tenant}'),
 'recurring',(select count(*) from slack_recurring_channels where tenant_id='${tenant}' and enabled),
 'flags',(select jsonb_object_agg(flag,value) from feature_flags where tenant_id='${tenant}' and flag in('learn.enabled','learn.inputs.slack.enabled'))) state`);
const current = state[0]?.state;
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
check(
  current && !current.cronCatalogPresent && current.recurring === 0,
  "Unexpected automated scheduling state; inspect before capture",
);
const worker = (await edgeInventory(token)).find((e) => e.slug === "learn-slack-worker");
check(
  worker?.version === 11 && worker.status === "ACTIVE" && worker.verify_jwt === true,
  "Reviewed worker v11 required",
);
const safe = (s) => ({
  messageCount: s.messages,
  activeSlackJobs: s.slackJobs.length,
  historyApprovals: s.history.length,
  threadApprovals: s.threads.length,
  configured: !!s.connection,
  captureAllowed: s.flags?.["learn.inputs.slack.enabled"] === true,
});
function save(p, exclusive = false) {
  const fd = openSync(path, exclusive ? "wx" : "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(p, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
if (mode === "prepare") {
  check(
    !current.connection &&
      current.messages === 0 &&
      current.slackJobs.length === 0 &&
      current.history.length === 0 &&
      current.threads.length === 0 &&
      current.flags?.["learn.inputs.slack.enabled"] === false,
    "An empty paused Drummonds Slack target is required",
  );
  const p = {
    version: 1,
    projectRef: TEST_PROJECT,
    tenant,
    team,
    channels,
    start,
    end,
    runId: randomUUID(),
    createdAt: new Date().toISOString(),
    workerVersion: 11,
    maxWorkerInvocations: 12,
    maxProviderRequests: 201,
    maxHistoryApprovals: 3,
    maxThreadApprovals: 3,
    maxPages: 2,
    steps: [],
    state: "prepared",
    before: safe(current),
  };
  save(p, true);
  console.log(JSON.stringify({ ...p, steps: undefined }));
} else {
  const p = JSON.parse(readFileSync(path, "utf8"));
  check(
    p.version === 1 &&
      p.projectRef === TEST_PROJECT &&
      p.tenant === tenant &&
      p.team === team &&
      JSON.stringify(p.channels) === JSON.stringify(channels) &&
      p.start === start &&
      p.end === end &&
      p.workerVersion === 11 &&
      p.maxWorkerInvocations === 12 &&
      p.maxProviderRequests === 201 &&
      p.maxHistoryApprovals === 3 &&
      p.maxThreadApprovals === 3 &&
      p.maxPages === 2,
    "Prepared scope changed",
  );
  if (mode === "baseline") {
    check(
      !current.connection && current.messages === 0 && current.slackJobs.length === 0,
      "Baseline must precede credential provisioning and capture",
    );
    const names = (
      await q(
        "select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in('public','storage','vault') or (n.nspname='auth' and c.relname in('users','identities'))) and c.relkind in('r','p') and not c.relispartition order by 1",
      )
    ).map((r) => r.name);
    check(
      names.length >= 195 &&
        names.every((n) => /^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(n)),
      "Complete preservation inventory required",
    );
    // Per-row digests allow append-only tables to be reconciled without exporting
    // communications, identities or credentials. Mutable rows need explicit review.
    const inventory = await q(
      names
        .map(
          (n) =>
            `select '${n}' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from ${n} s`,
        )
        .join(" union all "),
    );
    const rows = inventory.map((entry) => ({ ...entry, row_hashes: [] }));
    // Batch bounded pages to respect both response-size and API request limits.
    // Validate each table against its initial digest before publishing a baseline.
    const pages = rows.flatMap((entry) =>
      Array.from({ length: Math.ceil(entry.count / 10000) }, (_, i) => ({
        name: entry.name,
        offset: i * 10000,
      })),
    );
    for (let i = 0; i < pages.length; i += 8) {
      const batch = await q(
        pages
          .slice(i, i + 8)
          .map(
            (page) =>
              `select '${page.name}' name,${page.offset} page_offset,coalesce(jsonb_agg(hash order by hash),'[]') hashes from (select md5(to_jsonb(s)::text) hash from ${page.name} s order by md5(to_jsonb(s)::text) offset ${page.offset} limit 10000) records`,
          )
          .join(" union all "),
      );
      for (const page of batch)
        rows.find((r) => r.name === page.name).row_hashes.push(...page.hashes);
    }
    for (const entry of rows) {
      entry.row_hashes.sort();
      check(
        entry.row_hashes.length === entry.count &&
          createHash("md5").update(entry.row_hashes.join("")).digest("hex") === entry.fingerprint,
        "Dataset changed during baseline; inspect before retry",
      );
    }
    const fd = openSync(path + ".baseline", "wx", 0o600);
    try {
      writeSync(fd, JSON.stringify({ runId: p.runId, at: new Date().toISOString(), rows }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    console.log(
      JSON.stringify({ runId: p.runId, baselineDatasets: rows.length, rawRecordsExported: false }),
    );
    process.exit(0);
  }
  if (mode === "inspect") {
    console.log(
      JSON.stringify({
        runId: p.runId,
        state: p.state,
        workerInvocations: p.steps.length,
        current: safe(current),
      }),
    );
    process.exit(0);
  }
  check(
    process.env.LEARN_REAL_SLACK_APPROVED_RUN === p.runId,
    "Explicit approval of the prepared credential/capture scope is required",
  );
  check(
    JSON.parse(readFileSync(path + ".baseline", "utf8")).runId === p.runId,
    "Retained-data baseline required before dispatch",
  );
  check(
    !p.steps.some((s) => s.state === "submitted" || s.state === "uncertain") && p.steps.length < 12,
    "Uncertain operation or run budget exhausted: inspect, do not replay",
  );
  check(
    current.flags?.["learn.enabled"] === true &&
      current.flags?.["learn.inputs.slack.enabled"] === true,
    "Capture must be explicitly enabled by the operator",
  );
  const c = current.connection;
  check(
    c?.team === team &&
      c.kind === "user" &&
      c.user === "UFF8Y6SSJ" &&
      c.status === "configured" &&
      c.revoked === null &&
      JSON.stringify(c.field) === JSON.stringify(["user_token"]),
    "Expected channel user connection required",
  );
  // Preserve one observed browser date-entry mistake as a cancelled audit record.
  // It was retired before any worker invocation, so it consumes no provider or
  // message budget. Never exclude an executed or ambiguous approval.
  const retired = current.history.find(r=>r.id==='36c9acfb-e111-48f4-ae38-5148b88bb0cd');
  if (retired) {
    check(retired.jobId==='54b6621a-359c-4b00-b7a8-de340b458ad8' &&
      retired.account==='563e1183-d1e0-4c62-bce1-302b26d8fe7a' &&
      retired.jobStatus==='cancelled' && retired.attempt===0 && retired.claimedBy===null &&
      retired.lease===null && retired.correctedRun===p.runId && retired.pageCommitted===false,
      "Retired date-entry approval changed or was executed");
    current.history=current.history.filter(r=>r.id!==retired.id);
  }
  check(
    current.history.length > 0 && current.history.length <= 3 && current.threads.length <= 3,
    "Approval count exceeds the bounded run",
  );
  const validWindow = (d) =>
    Date.parse(d.start) === Date.parse(start) &&
    Date.parse(d.end) === Date.parse(end) &&
    d.maxPages === 2 &&
    !d.recovery &&
    !d.resumesImportId;
  check(
    current.history.every(
      (r) =>
        validWindow(r.definition) &&
        channels.includes(r.definition.channelId) &&
        r.definition.connectionId === c.id,
    ),
    "History scope differs",
  );
  check(
    current.history.filter((r) => r.definition.channelId === channels[0]).length <= 2 &&
      current.history.filter((r) => r.definition.channelId === channels[1]).length <= 1,
    "History replay budget differs",
  );
  check(
    current.threads.every(
      (r) =>
        validWindow(r.definition) &&
        channels.includes(r.scope.channelId) &&
        r.scope.teamId === team &&
        r.scope.connectionId === c.id &&
        r.scope.maxPages === 2,
    ),
    "Thread scope differs",
  );
  const parents = current.threads.map((r) => r.scope.channelId + ":" + r.scope.parentTimestamp);
  check(
    new Set(parents).size <= 2 &&
      [...new Set(parents)].every((k) => parents.filter((x) => x === k).length <= 2),
    "Observed parent/replay budget differs",
  );
  check(
    current.slackJobs.length > 0 &&
      current.slackJobs.every(
        (j) =>
          j.tenant === tenant &&
          j.maxAttempts === 5 &&
          j.attempt <= 5 &&
          (j.type === "slack.history_sync"
            ? current.history.some((r) => r.account === j.account) &&
              current.accounts.some(
                (a) =>
                  a.id === j.account &&
                  a.scope?.approved === true &&
                  a.scope.teamId === team &&
                  a.scope.connectionId === c.id &&
                  channels.includes(a.scope.channelId) &&
                  a.scope.maxPages === 2 &&
                  Number(a.scope.oldest) === Date.parse(start) / 1000 &&
                  Number(a.scope.latest) === Date.parse(end) / 1000,
              )
            : current.threads.some((r) => r.id === j.thread && r.account === j.account)),
      ),
    "Only bounded Drummonds Slack jobs may be available",
  );
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  check(response.ok, "Existing worker key unavailable");
  const keys = await response.json(),
    matches = keys.filter((k) => k.name === "service_role");
  check(matches.length === 1, "Unique existing TEST service key required");
  const key = matches[0].api_key,
    claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
  check(
    claims.ref === TEST_PROJECT && claims.role === "service_role",
    "Worker credential target differs",
  );
  const step = {
    at: new Date().toISOString(),
    state: "submitted",
    queuedJobs: current.slackJobs.map((j) => j.id),
  };
  p.steps.push(step);
  p.state = "running";
  save(p);
  try {
    const r = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/learn-slack-worker`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "x-serviceos-worker-key": key },
      redirect: "error",
      signal: AbortSignal.timeout(110000),
    });
    const data = await r.json();
    check(
      r.ok && data.ok === true && data.result?.claimed <= 1 && Array.isArray(data.result?.outcomes),
      "Worker result requires inspection",
    );
    step.state = "acknowledged";
    step.claimed = data.result.claimed;
    step.finishedAt = new Date().toISOString();
    save(p);
    console.log(
      JSON.stringify({ runId: p.runId, workerInvocations: p.steps.length, claimed: step.claimed }),
    );
  } catch {
    step.state = "uncertain";
    p.state = "requires_inspection";
    save(p);
    throw Error(
      "Worker outcome uncertain: inspect retained job/page receipts before further invocation",
    );
  }
}
