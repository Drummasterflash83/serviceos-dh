/** Actual TEST Auth/RPC/Edge recovery acceptance. Retain evidence; retire fixture access. */
import { randomUUID, randomBytes } from "node:crypto";
import {
  loadSlackThreadRecovery,
  resumeSlackThread,
} from "../../src/lib/learn-slack-thread-recovery.ts";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readThreadRecoveryCatalog } from "./learn-slack-thread-recovery-catalog.mjs";
import {
  installedThreadRecovery,
  THREAD_RECOVERY_SHA as SOURCE_SHA256,
} from "./learn-test-thread-recovery-release.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { AUTH_CONTRACT_QUERY } from "./learn-test-auth-contract.mjs";
import { actionAuthContractMatches } from "./learn-test-actions-acceptance.mjs";
import { readAcceptanceResponse } from "./learn-test-launch-acceptance.mjs";
const check = (v, s) => {
    if (!v) throw Error(s);
  },
  q = (s) => `'${String(s).replaceAll("'", "''")}'`,
  base = `https://${TEST_PROJECT}.supabase.co`;
export async function acceptThreadRecovery({ allowProjectRef, token, fetcher = fetch }) {
  const pre = await readThreadRecoveryCatalog({ allowProjectRef, token, fetcher });
  check(installedThreadRecovery(pre), "Exact installed TEST recovery release required");
  async function request(url, headers, method = "GET", body) {
    const r = await fetcher(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    return readAcceptanceResponse(r);
  }
  const mgmt = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  async function sql(query, readOnly = false) {
    const r = await request(
      `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
      mgmt,
      "POST",
      { query, ...(readOnly ? {} : { read_only: false }) },
    );
    check(r.ok, `Synthetic recovery SQL failed (HTTP ${r.status})`);
    return r.data;
  }
  const active = await sql(
    "select count(*)::int as n from platform_jobs where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying')",
    true,
  );
  check(active[0].n === 0, "Existing Slack work requires inspection before acceptance");
  const grants = await sql(
    "select not has_table_privilege('authenticated','slack_workspace_pacing','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('anon','slack_workspace_pacing','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('service_role','slack_workspace_pacing','DELETE,TRUNCATE') as restricted",
    true,
  );
  check(grants[0].restricted, "Recovery grants differ");
  const auth = await sql(AUTH_CONTRACT_QUERY, true);
  check(
    auth?.length === 1 && actionAuthContractMatches(auth[0].contract),
    "Auth fixture contract differs",
  );
  const keys = await request(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    mgmt,
  );
  check(keys.ok && Array.isArray(keys.data), "Existing TEST keys unavailable");
  function keyFor(role) {
    const rows = keys.data.filter((k) => k.name === role);
    check(rows.length === 1, "Unique existing TEST key required");
    const key = rows[0].api_key,
      c = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    check(c.ref === TEST_PROJECT && c.role === role, "Credential target differs");
    return key;
  }
  const anon = keyFor("anon"),
    service = keyFor("service_role"),
    userHeaders = (jwt) => ({
      apikey: anon,
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    }),
    admin = {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    };
  const rpc = (headers, name, args) =>
    request(`${base}/rest/v1/rpc/${name}`, headers, "POST", args);
  const edge = () =>
    request(
      `${base}/functions/v1/learn-slack-worker`,
      { ...admin, "x-serviceos-worker-key": service },
      "POST",
    );
  const idle = await edge();
  check(idle.ok && idle.data?.result?.claimed === 0, "Empty-queue worker preflight failed");
  const plan = {
    version: "learn-test-thread-recovery-fixtures/1",
    projectRef: TEST_PROJECT,
    runId: randomUUID(),
    tenants: [randomUUID(), randomUUID()],
    team: "T" + randomUUID().replaceAll("-", "").toUpperCase(),
    connection: randomUUID(),
    secretRef: randomUUID(),
    users: [],
    approvals: [],
    requests: [],
    accessShutdown: false,
  };
  plan.users = plan.tenants.map((tenant, i) => ({
    id: randomUUID(),
    tenant,
    email: `learn-thread-recovery-${plan.runId}-${i}@example.invalid`,
  }));
  const path = `/private/tmp/serviceos-learn-thread-recovery-${plan.runId}.json`,
    save = () => writeFileSync(path, JSON.stringify(plan, null, 2) + "\n", { mode: 0o600 }),
    sessions = [],
    checks = [],
    cleanupErrors = [];
  save();
  const tenant = plan.tenants[0],
    tenantList = plan.tenants.map(q).join(",");
  let failure = null,
    retained = null,
    sourceBefore = null,
    sourceAfter = null,
    completionRefusal = null,
    lastOperation = "setup";
  async function sourceSnapshot() {
    const tables = [
      "email_messages",
      "phone_calls",
      "phone_recordings",
      "phone_transcripts",
      "slack_messages",
      "slack_message_versions",
      "interactions",
      "slack_thread_imports",
      "slack_history_imports",
    ];
    return (
      await sql(
        tables
          .map(
            (t) =>
              `select ${q(t)} as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from ${t} s where tenant_id not in (${tenantList})`,
          )
          .join(" union all "),
        true,
      )
    ).sort((a, b) => a.name.localeCompare(b.name));
  }
  const client = (i) => ({
    rpc: async (name, args) => {
      const r = await rpc(userHeaders(sessions[i]), name, args);
      return { data: r.ok ? r.data : null, error: r.ok ? null : { code: r.data?.code } };
    },
  });
  async function state(id = plan.currentImport) {
    return loadSlackThreadRecovery(client(0), tenant, plan.account, id);
  }
  function approval(review, mode = "continue", maxPages = 1) {
    const r = {
      tenantId: tenant,
      accountId: plan.account,
      importId: review.importId,
      requestId: randomUUID(),
      stateVersion: review.stateVersion,
      mode,
      maxPages,
      reason: "Synthetic reviewed thread recovery",
    };
    plan.requests.push(r);
    save();
    return r;
  }
  const args = (r) => ({
    p_tenant_id: r.tenantId,
    p_import_id: r.importId,
    p_request_id: r.requestId,
    p_expected_state_version: r.stateVersion,
    p_mode: r.mode,
    p_max_pages: r.maxPages,
    p_reason: r.reason,
  });
  async function advance(jobId) {
    await sql(
      `begin;update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity' where team_id=${q(plan.team)};update platform_jobs set available_at='-infinity' where id=${q(jobId)} and tenant_id=${q(tenant)};commit;`,
    );
  }
  async function checkpoint() {
    return (
      await sql(
        `select sync_cursor,settings->'slack_history' as scope from connector_accounts where id=${q(plan.account)} and tenant_id=${q(tenant)}`,
        true,
      )
    )[0];
  }
  async function publishHistory(jobId, records, cursor, complete = false) {
    await advance(jobId);
    const claim = await rpc(admin, "learn_slack_claim_jobs", {
      p_worker: randomUUID(),
      p_batch: 1,
    });
    check(
      claim.ok && claim.data?.length === 1 && claim.data[0].id === jobId,
      "Fixture recovery claim differs",
    );
    const j = claim.data[0],
      a = await checkpoint(),
      s = a.scope;
    const cp = Object.keys(a.sync_cursor).length
      ? a.sync_cursor
      : {
          scopeKey: JSON.stringify([
            tenant,
            s.teamId,
            s.channelId,
            s.oldest,
            s.latest,
            s.consentReference,
          ]),
          cursor: null,
          pages: 0,
          complete: false,
        };
    const page = await rpc(admin, "slack_history_commit_page", {
      p_tenant_id: tenant,
      p_job_id: j.id,
      p_account_id: plan.account,
      p_claimed_by: j.claimed_by,
      p_attempt_count: j.attempt_count,
      p_expected: cp,
      p_next: { ...cp, pages: cp.pages + 1, cursor, complete },
      p_records: records,
    });
    check(page.ok && page.data === true, "Recovered page publication failed");
    const finish = await rpc(admin, "learn_slack_finish_job", {
      p_tenant_id: tenant,
      p_job_id: j.id,
      p_claimed_by: j.claimed_by,
      p_attempt_count: j.attempt_count,
      p_outcome: { success: true },
    });
    check(finish.ok && finish.data?.status === "succeeded", "Recovered page settlement failed");
  }
  const record = (ts, text) => ({
    tenant_id: tenant,
    channel_id: "CRECOVERY",
    source_external_id: `${plan.team}:CRECOVERY:${ts}`,
    provider_timestamp: ts,
    thread_timestamp: null,
    text,
    provider_payload: { ts, text },
  });
  try {
    sourceBefore = await sourceSnapshot();
    for (const u of plan.users) {
      const password = randomBytes(36).toString("base64url");
      const made = await request(`${base}/auth/v1/admin/users`, admin, "POST", {
        id: u.id,
        email: u.email,
        password,
        email_confirm: true,
        app_metadata: { learn_thread_recovery_run: plan.runId },
      });
      check(made.ok && made.data?.id === u.id, "Synthetic Auth creation failed");
      const login = await request(
        `${base}/auth/v1/token?grant_type=password`,
        userHeaders(),
        "POST",
        { email: u.email, password },
      );
      check(login.ok && login.data?.user?.id === u.id, "Synthetic sign-in failed");
      sessions.push(login.data.access_token);
    }
    let seed = "begin;";
    for (const [i, t] of plan.tenants.entries())
      seed += `insert into tenants(id,slug,display_name,metadata) values(${q(t)},${q("learn-recovery-" + plan.runId + "-" + i)},'SYNTHETIC recovery acceptance',jsonb_build_object('learn_thread_recovery_run',${q(plan.runId)},'synthetic',true));`;
    for (const u of plan.users)
      seed += `update profiles set tenant_id=${q(u.tenant)},role='owner' where id=${q(u.id)} and email=${q(u.email)};`;
    seed += `insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs) values(${q(plan.connection)},${q(tenant)},'slack','configured',jsonb_build_object('team_id',${q(plan.team)},'team_name','SYNTHETIC NO CREDENTIAL'),array['bot_token'],jsonb_build_object('bot_token',${q(plan.secretRef)}));commit;`;
    await sql(seed);
    const revision = (
      await sql(`select updated_at from provider_connections where id=${q(plan.connection)}`, true)
    )[0].updated_at;
    const initial = await rpc(userHeaders(sessions[0]), "learn_slack_start_import", {
      p_tenant_id: tenant,
      p_request_id: randomUUID(),
      p_connection_id: plan.connection,
      p_expected_revision: revision,
      p_channel_id: "CRECOVERY",
      p_start: "2026-01-01T00:00:00Z",
      p_end: "2026-01-02T00:00:00Z",
      p_max_pages: 1,
      p_reason: "Synthetic bounded channel recovery",
    });
    check(initial.ok && initial.data?.jobId, "Initial owner approval failed");
    plan.account = initial.data.accountId;
    plan.approvals.push(initial.data);
    save();
    const parent = "1767225700.000001";
    const rootRecord = record(parent, "SYNTHETIC retained root for thread recovery");
    rootRecord.thread_timestamp = parent;
    rootRecord.provider_payload = {
      ...rootRecord.provider_payload,
      thread_ts: parent,
      reply_count: 2,
    };
    await publishHistory(initial.data.jobId, [rootRecord], null, true);
    const root = (
      await sql(
        `select id,source_version from slack_messages where tenant_id=${q(tenant)} and provider_timestamp=${q(parent)}`,
        true,
      )
    )[0];
    check(root?.id, "Retained parent unavailable");
    const thread = await rpc(userHeaders(sessions[0]), "learn_slack_start_thread_import", {
      p_tenant_id: tenant,
      p_request_id: randomUUID(),
      p_account_id: plan.account,
      p_source_message_id: root.id,
      p_source_version: root.source_version,
      p_connection_revision: revision,
      p_start: "2026-01-01T00:00:00Z",
      p_end: "2026-01-02T00:00:00Z",
      p_max_pages: 1,
      p_reason: "Synthetic thread page-limit review",
    });
    check(thread.ok && thread.data?.jobId, "Initial thread approval failed");
    plan.currentImport = thread.data.requestId;
    plan.approvals.push(thread.data);
    save();
    function reply(ts, text) {
      const r = record(ts, text);
      r.thread_timestamp = parent;
      r.provider_payload = { ...r.provider_payload, thread_ts: parent };
      return r;
    }
    const first = reply("1767225800.000001", "SYNTHETIC retained first reply"),
      second = reply("1767225900.000001", "SYNTHETIC retained second reply");
    async function stored(id) {
      return (
        await sql(
          `select * from slack_thread_imports where id=${q(id)} and tenant_id=${q(tenant)}`,
          true,
        )
      )[0];
    }
    async function publishThread(approval, records, cursor, complete = false) {
      await advance(approval.jobId);
      const claim = await rpc(admin, "learn_slack_claim_jobs", {
        p_worker: randomUUID(),
        p_batch: 1,
      });
      check(
        claim.ok && claim.data?.length === 1 && claim.data[0].id === approval.jobId,
        "Thread claim differs",
      );
      const j = claim.data[0],
        t = await stored(approval.requestId),
        s = t.scope;
      const cp = Object.keys(t.checkpoint).length
        ? t.checkpoint
        : {
            scopeKey: JSON.stringify([
              tenant,
              s.teamId,
              s.channelId,
              s.oldest,
              s.latest,
              s.consentReference,
              s.parentTimestamp,
            ]),
            cursor: null,
            pages: 0,
            complete: false,
          };
      const payload = {
        p_tenant_id: tenant,
        p_job_id: j.id,
        p_import_id: approval.requestId,
        p_claimed_by: j.claimed_by,
        p_attempt_count: j.attempt_count,
        p_expected: cp,
        p_next: { ...cp, pages: cp.pages + 1, cursor, complete },
        p_records: records,
      };
      for (let i = 0; i < 2; i++) {
        const page = await rpc(admin, "slack_thread_commit_page", payload);
        check(page.ok && page.data === true, "Thread publication/exact page retry failed");
      }
      const finish = await rpc(admin, "learn_slack_finish_thread_job", {
        p_tenant_id: tenant,
        p_job_id: j.id,
        p_claimed_by: j.claimed_by,
        p_attempt_count: j.attempt_count,
        p_outcome: { success: true },
      });
      check(finish.ok && finish.data?.status === "succeeded", "Thread settlement failed");
    }
    await publishThread(thread.data, [first], "synthetic-thread-saved-cursor");
    const original = await stored(thread.data.requestId),
      channelBefore = await checkpoint();
    lastOperation = "viewer and tenant boundaries";
    await sql(`update profiles set role='viewer' where id=${q(plan.users[0].id)}`);
    let s = await state();
    check(
      s.progress.pagesThisApproval === 1 &&
        s.progress.hasCursor &&
        s.canContinue &&
        s.latestJob.stopReason === "page_budget_exhausted",
      "Viewer thread progress differs",
    );
    const privateRead = await rpc(userHeaders(sessions[0]), "learn_slack_thread_recovery_state", {
      p_tenant_id: tenant,
      p_import_id: s.importId,
    });
    check([401, 403, 404].includes(privateRead.status), "Private thread helper exposed");
    const rawRead = await rpc(userHeaders(sessions[0]), "learn_slack_thread_recovery_read", {
      p_tenant_id: tenant,
      p_import_id: s.importId,
    });
    check(
      rawRead.ok &&
        !JSON.stringify(rawRead.data).includes("synthetic-thread-saved-cursor") &&
        !("checkpoint" in rawRead.data) &&
        !("scope" in rawRead.data),
      "Thread reader exposed private checkpoint",
    );
    const denied = await rpc(
      userHeaders(sessions[0]),
      "learn_slack_resume_thread",
      args(approval(s)),
    );
    check(denied.status === 403, "Viewer approved recovery");
    for (const headers of [userHeaders(), userHeaders(sessions[1]), admin]) {
      const read = await rpc(headers, "learn_slack_thread_recovery_read", {
        p_tenant_id: tenant,
        p_import_id: s.importId,
      });
      check(
        [401, 403, 404].includes(read.status),
        "Anonymous/foreign/service thread read exposed data",
      );
      const write = await rpc(headers, "learn_slack_resume_thread", args(approval(s)));
      check(
        [401, 403, 404].includes(write.status),
        "Anonymous/foreign/service approved thread recovery",
      );
    }
    await sql(`update profiles set role='owner' where id=${q(plan.users[0].id)}`);
    lastOperation = "competing recovery approvals";
    s = await state();
    const competing = [approval(s), approval(s)];
    const attempts = await Promise.all(
      competing.map((r) => rpc(userHeaders(sessions[0]), "learn_slack_resume_thread", args(r))),
    );
    check(
      attempts.filter((r) => r.ok).length === 1 &&
        attempts.filter((r) => r.status === 409).length === 1,
      "Competing reviews queued more than one thread recovery",
    );
    const win = attempts.findIndex((r) => r.ok),
      continued = attempts[win].data,
      continuedRequest = competing[win];
    plan.approvals.push(continued);
    plan.currentImport = continued.requestId;
    save();
    const replay = await resumeSlackThread(client(0), continuedRequest);
    check(replay.reused && replay.jobId === continued.jobId, "Exact thread retry differs");
    const changed = await rpc(userHeaders(sessions[0]), "learn_slack_resume_thread", {
      ...args(continuedRequest),
      p_mode: "restart",
    });
    check(changed.status === 409, "Changed request ID reused");
    const c = await stored(continued.requestId);
    check(
      c.checkpoint.cursor === "synthetic-thread-saved-cursor" &&
        c.checkpoint.pages === 0 &&
        Date.parse(c.scope.expiresAt) > Date.now() + 23 * 3600000,
      "Fresh thread budget or consent differs",
    );
    check(
      JSON.stringify(await stored(original.id)) === JSON.stringify(original),
      "Original thread approval changed",
    );
    check(
      JSON.stringify(c.definition.previousState.scope) === JSON.stringify(original.scope) &&
        JSON.stringify(c.definition.previousState.checkpoint) ===
          JSON.stringify(original.checkpoint),
      "Previous thread scope/checkpoint not retained",
    );
    s = await state();
    check(
      s.previousImportId === original.id &&
        s.recoveryMode === "continue" &&
        s.progress.pagesThisApproval === 0 &&
        s.active &&
        !s.canContinue,
      "Recovery lineage/progress differs",
    );
    const oldState = await state(original.id);
    check(
      oldState.supersededBy === continued.requestId && !oldState.canRestart,
      "Earlier approval not superseded",
    );
    const activeDenied = await rpc(
      userHeaders(sessions[0]),
      "learn_slack_resume_thread",
      args(approval(s)),
    );
    check(
      !activeDenied.ok && activeDenied.data?.code === "55000",
      "Active thread accepted recovery",
    );
    checks.push(
      "Actual Auth owner/viewer/company/anonymous/service boundaries and safe reader; independent competing requests queue once; exact replay, fresh consent and retained predecessor checked.",
    );
    lastOperation = "continue and deduplicate";
    await publishThread(continued, [first, second], "synthetic-thread-next-cursor");
    const sources = (
      await sql(
        `select (select count(*)::int from slack_messages where tenant_id=${q(tenant)}) as messages,(select count(*)::int from slack_message_versions where tenant_id=${q(tenant)}) as versions`,
        true,
      )
    )[0];
    check(
      sources.messages === 3 && sources.versions === 3,
      "Thread continuation duplicated source/version",
    );
    check(
      JSON.stringify(await checkpoint()) === JSON.stringify(channelBefore),
      "Thread changed channel checkpoint",
    );
    lastOperation = "reviewed restart";
    const beforeRestart = await stored(continued.requestId),
      restartRequest = approval(await state(), "restart", 2),
      restart = await resumeSlackThread(client(0), restartRequest);
    plan.approvals.push(restart);
    plan.currentImport = restart.requestId;
    save();
    const reset = await stored(restart.requestId);
    check(
      reset.checkpoint.pages === 0 &&
        reset.checkpoint.cursor === null &&
        reset.definition.previousState.checkpoint.cursor === "synthetic-thread-next-cursor",
      "Restart did not retain previous checkpoint separately",
    );
    check(
      JSON.stringify(await stored(continued.requestId)) === JSON.stringify(beforeRestart),
      "Restart changed predecessor",
    );
    lastOperation = "deployed worker missing credential";
    await advance(restart.jobId);
    const worker = await edge(),
      outcome = worker.data?.result?.outcomes?.[0];
    check(
      worker.ok &&
        worker.data?.result?.claimed === 1 &&
        outcome?.job_id === restart.jobId &&
        outcome.status === "dead_letter",
      "Worker recovery binding differs",
    );
    const stopped = (
      await sql(`select error_code from platform_jobs where id=${q(restart.jobId)}`, true)
    )[0];
    check(
      stopped.error_code === "slack_history_binding_unavailable",
      "Worker missing-credential refusal differs",
    );
    lastOperation = "complete bounded thread window";
    const finalRequest = approval(await state()),
      final = await resumeSlackThread(client(0), finalRequest);
    plan.approvals.push(final);
    plan.currentImport = final.requestId;
    save();
    await publishThread(final, [], null, true);
    s = await state();
    check(
      s.progress.complete &&
        !s.canContinue &&
        !s.canRestart &&
        s.coverage === "observed_thread_window",
      "Completed thread still recoverable",
    );
    const completeDenied = await rpc(
      userHeaders(sessions[0]),
      "learn_slack_resume_thread",
      args(approval(s)),
    );
    completionRefusal = {
      httpStatus: completeDenied.status,
      code: completeDenied.data?.code ?? null,
    };
    check(
      !completeDenied.ok && completeDenied.data?.code === "55000",
      "Completed-thread refusal differs",
    );
    check(
      (
        await sql(
          `select count(*)::int as n from slack_thread_imports where id=${q(plan.requests.at(-1).requestId)}`,
          true,
        )
      )[0].n === 0,
      "Complete thread queued recovery",
    );
    check(
      (await resumeSlackThread(client(0), continuedRequest)).reused,
      "Earlier retry failed after later completion",
    );
    check(
      JSON.stringify(await stored(original.id)) === JSON.stringify(original),
      "Original approval changed after chain completion",
    );
    checks.push(
      "Actual thread continuation and page replay deduplicate replies; restart retains prior approvals and checkpoint; deployed worker v4 refuses nonexistent credentials; subsequent recovery completes only the approved thread window.",
    );
    lastOperation = "pre-existing evidence preservation";
    sourceAfter = await sourceSnapshot();
    check(
      JSON.stringify(sourceAfter) === JSON.stringify(sourceBefore),
      "Pre-existing communication evidence changed",
    );
    checks.push(
      "Pre-existing TEST email/call/recording/transcript/Slack/version/interaction and both approval-ledger counts/fingerprints unchanged.",
    );
  } catch (e) {
    failure = e.message;
  } finally {
    try {
      await sql(
        `begin;update platform_jobs set status='cancelled',cancelled_at=clock_timestamp() where tenant_id in (${tenantList}) and status in ('queued','running','retrying');update connector_accounts set status='disabled' where tenant_id in (${tenantList});update tenant_connectors set enabled=false,status='disabled' where tenant_id in (${tenantList});update provider_connections set status='revoked',revoked_at=clock_timestamp() where id=${q(plan.connection)} and tenant_id=${q(tenant)};update slack_workspace_pacing set active_job_id=null where team_id=${q(plan.team)} and active_job_id in (select id from platform_jobs where tenant_id in (${tenantList}));commit;`,
      );
    } catch {
      cleanupErrors.push("Fixture queue/connection shutdown requires inspection");
    }
    for (const u of plan.users) {
      try {
        const found = await request(`${base}/auth/v1/admin/users/${u.id}`, admin);
        if (found.status === 404) continue;
        check(
          found.ok &&
            found.data?.email === u.email &&
            found.data.app_metadata?.learn_thread_recovery_run === plan.runId,
          "Fixture actor marker differs",
        );
        await sql(`update profiles set role='viewer' where id=${q(u.id)} and email=${q(u.email)};`);
        const ban = await request(`${base}/auth/v1/admin/users/${u.id}`, admin, "PUT", {
          ban_duration: "876000h",
          password: randomBytes(48).toString("base64url"),
        });
        check(
          ban.ok && Date.parse(ban.data?.banned_until) > Date.now() + 86400000,
          "Fixture login ban unverified",
        );
      } catch {
        cleanupErrors.push(`Actor shutdown requires inspection: ${u.id}`);
      }
    }
    try {
      retained = (
        await sql(
          `select (select count(*)::int from slack_messages where tenant_id=${q(tenant)}) as messages,(select count(*)::int from slack_message_versions where tenant_id=${q(tenant)}) as versions,(select count(*)::int from interactions where tenant_id=${q(tenant)} and source_table='slack_messages') as interactions,(select count(*)::int from slack_history_imports where tenant_id=${q(tenant)}) as approvals,(select count(*)::int from slack_thread_imports where tenant_id=${q(tenant)}) as thread_approvals,(select count(*)::int from platform_jobs where tenant_id in (${tenantList}) and status in ('queued','running','retrying')) as active_jobs,(select count(*)::int from provider_connections where id=${q(plan.connection)} and (status<>'revoked' or revoked_at is null)) as active_connections,(select count(*)::int from slack_workspace_pacing where team_id=${q(plan.team)} and active_job_id is not null) as active_reservations`,
          true,
        )
      )[0];
      check(
        retained.active_jobs === 0 &&
          retained.active_connections === 0 &&
          retained.active_reservations === 0,
        "Fixture remains active",
      );
      if (!failure)
        check(
          retained.messages === 3 &&
            retained.versions === 3 &&
            retained.interactions === 3 &&
            retained.approvals === 1 &&
            retained.thread_approvals === 4,
          "Retained evidence differs",
        );
      if (sessions[0] && plan.requests.length) {
        const denied = await rpc(
          userHeaders(sessions[0]),
          "learn_slack_resume_thread",
          args(plan.requests.at(-1)),
        );
        check([401, 403].includes(denied.status), "Old JWT retained approval access");
      }
    } catch {
      cleanupErrors.push("Final retained evidence/revocation requires inspection");
    }
    plan.retained = retained;
    plan.accessShutdown = cleanupErrors.length === 0;
    save();
  }
  return {
    version: "learn-test-thread-recovery-acceptance/1",
    projectRef: TEST_PROJECT,
    sourceSha256: SOURCE_SHA256,
    observedAt: new Date().toISOString(),
    runId: plan.runId,
    state:
      !failure && !cleanupErrors.length
        ? "passed_retained_synthetic_acceptance"
        : "requires_inspection",
    checks,
    completionRefusal,
    lastOperation,
    sourceBefore,
    sourceAfter,
    failure,
    cleanupErrors,
    loginsAndApprovalRevoked: plan.accessShutdown,
    retained,
    fixtureManifest: path,
    limitations: [
      "Random synthetic TEST companies/workspace, nonexistent credential reference; no real Slack fetch or production change.",
      "Fixture pacing deadlines explicitly advanced; renewed expiry verified without modifying an immutable approval. Hosted concurrency uses independent HTTP requests; controlled blocking was verified separately in isolated SQL.",
      "Worker v4 exercised recovery binding and missing-credential refusal, not live ingestion. Sources and approvals retained; fixture logins banned/passwords rotated, roles revoked and active jobs/connections stopped.",
      "Actual signed-in recovery browser acceptance, continuous/multi-window capture and full LEARN V1 remain incomplete.",
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(
      process.argv.slice(2).join(" ") === "--retained-synthetic-test --existing-cli-login" &&
        process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
      "Explicit retained TEST recovery acceptance required",
    );
    const r = await acceptThreadRecovery({ allowProjectRef: TEST_PROJECT, token: savedCliToken() });
    console.log(JSON.stringify(r, null, 2));
    if (r.state !== "passed_retained_synthetic_acceptance") process.exitCode = 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
