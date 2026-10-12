/** Supervised TEST worker only. Import approvals use the signed-in OpenFolk UI.
 * Creates no identities, grants, credentials, imports or schedules. Never resets a cursor.
 */
import { readFileSync, writeFileSync, statSync, openSync, closeSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";

export const SCOPE = Object.freeze({
  project: TEST_PROJECT,
  tenant: "f8c114fa-fee7-4983-8970-f6e7f5fd3129",
  account: "b0609b8b-8a12-4dc2-afdc-0e0f28a29079",
  connection: "59484382-d380-4362-b031-19db133e6d3a",
  actor: "08929d74-42e4-471a-982e-5b8ac812cbf1",
  maxRequests: 4000,
  maxInvocations: 4200,
});
const stem = ".verification-results/commusoft-operator-2026-10-12";
const file = stem + ".json";
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const uuid = (v) =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
export function assertDispatch(plan, state, now = Date.now()) {
  check(JSON.stringify(plan.scope) === JSON.stringify(SCOPE), "Scope changed");
  check(plan.state === "prepared" && !plan.pending, "Unconfirmed worker must be inspected first");
  check(plan.preserved !== false, "Preservation mismatch must be resolved first");
  check(
    Number.isSafeInteger(plan.invocations) &&
      plan.invocations >= 0 &&
      plan.invocations < SCOPE.maxInvocations,
    "Invocation budget exhausted",
  );
  check(
    Number.isSafeInteger(state.requests) &&
      state.requests >= 0 &&
      state.requests < SCOPE.maxRequests,
    "Provider request budget exhausted",
  );
  check(state.jobs.length === 1, "Exactly one TEST Commusoft job required");
  const j = state.jobs[0];
  check(
    uuid(j.id) &&
      j.tenant === SCOPE.tenant &&
      j.account === SCOPE.account &&
      ["queued", "retrying"].includes(j.status) &&
      !j.lease &&
      Date.parse(j.availableAt) <= now,
    "Selected job is not dispatchable",
  );
  check(
    state.account?.id === SCOPE.account &&
      state.account.connectionId === SCOPE.connection &&
      state.account.resource === "propertyContacts",
    "Contacts-only retained account required",
  );
  // The first dispatch only settles the old paused/expired queued job. No provider permit can be issued.
  const settle =
    plan.invocations === 0 &&
    j.id === plan.initialJob &&
    state.flags.every((f) => f.value === false) &&
    state.flags.length === 2 &&
    Date.parse(state.account.expiresAt) < now;
  if (!settle) {
    check(state.flags.length === 2 && state.flags.every((f) => f.value === true), "Capture paused");
    check(
      Date.parse(state.account.expiresAt) > now + 120000 && state.operatorApproval === true,
      "Fresh signed-in operator import approval required",
    );
  }
  return j;
}
export function acceptWorkerReply(reply, jobId) {
  check(
    reply?.ok === true &&
      [0, 1].includes(reply.result?.claimed) &&
      Array.isArray(reply.result.outcomes) &&
      reply.result.outcomes.length === reply.result.claimed &&
      reply.result.outcomes.every(
        (o) =>
          o.job_id === jobId &&
          ["succeeded", "retrying", "dead_letter"].includes(o.status) &&
          (o.successor_id === null || uuid(o.successor_id)),
      ),
    "Worker acknowledgement unconfirmed",
  );
  return reply.result;
}
export function unclaimedInvocationSettled(pending, job, now = Date.now()) {
  // After the endpoint deadline and lease window, an untouched queued job is
  // positive DB evidence that this invocation never claimed or contacted a provider.
  return (
    !!pending &&
    job?.id === pending.job &&
    job.status === "queued" &&
    job.attempt_count === 0 &&
    job.lease_expires_at === null &&
    job.permits === 0 &&
    job.pages === 0 &&
    Number.isFinite(Date.parse(pending.startedAt)) &&
    now - Date.parse(pending.startedAt) > 180000
  );
}
export function preservationQuery(p) {
  const tenant = quote(SCOPE.tenant),
    cutoff = quote(p.cutoff);
  const append = {
    "public.learn_business_input_pages": "committed_at",
    "public.learn_business_input_versions": "first_seen_at",
    "public.learn_business_input_request_permits": "requested_at",
    "public.learn_operator_input_requests": "created_at",
    "public.platform_jobs": "created_at",
    "public.controlplane_change_log": "created_at",
    "public.learn_capture_control_requests": "created_at",
  };
  return p.tables
    .map((t) => {
      check(/^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(t), "Unexpected table");
      let predicate = "true";
      if (append[t])
        predicate = `(s.tenant_id<>${tenant} or s.${append[t]}<=${cutoff}::timestamptz)`;
      if (t === "public.platform_jobs") predicate += ` and s.id<>${quote(p.initialJob)}`;
      if (t === "public.connector_accounts") predicate = `s.id<>${quote(SCOPE.account)}`;
      if (t === "public.feature_flags")
        predicate = `s.tenant_id is distinct from ${tenant}::uuid or s.flag not in ('learn.enabled','learn.inputs.commusoft.enabled','learn.inputs.email.enabled','learn.inputs.phone.enabled','learn.inputs.slack.enabled')`;
      if (t === "public.learn_business_input_request_gates")
        predicate = `s.credential_fingerprint<>${quote(p.fingerprint)}`;
      if (t === "public.learn_business_input_observations")
        predicate = `exists(select 1 from public.learn_business_input_pages r where r.id=s.page_id and (r.tenant_id<>${tenant} or r.committed_at<=${cutoff}::timestamptz))`;
      if (t === "public.learn_commusoft_contact_targets")
        predicate = `s.tenant_id<>${tenant} or exists(select 1 from public.learn_operator_input_requests r where r.id=s.approval_id and r.created_at<=${cutoff}::timestamptz)`;
      // An existing browser session refresh updates the operator's timestamp.
      // Only a separately inspected reconciliation can establish this projection;
      // every other auth field and every other user's full row remain protected.
      const row =
        t === "auth.users" && p.authSessionReconciliation?.actor === SCOPE.actor
          ? `case when s.id=${quote(SCOPE.actor)}::uuid then to_jsonb(s)-'updated_at' else to_jsonb(s) end`
          : "to_jsonb(s)";
      return `select '${t}' name,count(*)::int count,md5(coalesce(string_agg(md5((${row})::text),'' order by md5((${row})::text)),'')) fingerprint from ${t} s where ${predicate}`;
    })
    .join(" union all ");
}
/** Metadata reads may retry transient gateway failures; worker POSTs never use this. */
export async function readSupervisorMetadata(
  token,
  sql,
  {
    query = communicationQuery,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await query(token, sql, { readOnly: true });
    } catch (error) {
      if (
        attempt >= 2 ||
        !/^TEST communication metadata\/operation failed HTTP (502|503|504)$/.test(
          error?.message ?? "",
        )
      )
        throw error;
      await wait([1000, 4000][attempt]);
    }
  }
}
export async function run(mode) {
  check(process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT, "Explicit TEST target required");
  const lock = openSync(stem + ".lock", "wx", 0o600);
  try {
    const token = savedCliToken(),
      sql = (s) => readSupervisorMetadata(token, s);
    const save = (p, exclusive = false) =>
      writeFileSync(file, JSON.stringify(p, null, 2) + "\n", {
        mode: 0o600,
        flag: exclusive ? "wx" : "w",
      });
    let p;
    if (mode === "prepare") {
      const r = await sql(
        `select clock_timestamp() cutoff,(select id from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying') limit 1) job,(select credential_fingerprint from public.learn_business_input_request_permits where tenant_id=${quote(SCOPE.tenant)} order by requested_at desc limit 1) fingerprint`,
      );
      const tables = JSON.parse(
        readFileSync(".verification-results/operator-information-install-v1-journal.json"),
      ).before.map((r) => r.name);
      check(
        tables.length === 194 && uuid(r[0]?.job) && /^[a-f0-9]{64}$/.test(r[0]?.fingerprint),
        "Preservation metadata missing",
      );
      p = {
        version: 1,
        runId: randomUUID(),
        scope: SCOPE,
        state: "prepared",
        cutoff: r[0].cutoff,
        initialJob: r[0].job,
        fingerprint: r[0].fingerprint,
        tables,
        invocations: 0,
        history: [],
      };
      p.before = await sql(preservationQuery(p));
      check(p.before.length === 194, "Incomplete preservation inventory");
      save(p, true);
    } else {
      check(!(statSync(file).mode & 0o077), "Private journal required");
      p = JSON.parse(readFileSync(file));
      check(JSON.stringify(p.scope) === JSON.stringify(SCOPE), "Scope changed");
    }
    const state = async () => {
      const rows = await sql(`select jsonb_build_object('at',clock_timestamp(),
        'requests',(select count(*)::int from public.learn_business_input_request_permits where tenant_id=${quote(SCOPE.tenant)} and requested_at>${quote(p.cutoff)}::timestamptz),
        'flags',(select jsonb_agg(jsonb_build_object('flag',flag,'value',value)) from public.feature_flags where tenant_id=${quote(SCOPE.tenant)} and flag in('learn.enabled','learn.inputs.commusoft.enabled')),
        'jobs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'tenant',tenant_id,'account',payload->>'connector_account_id','status',status,'lease',lease_expires_at,'availableAt',available_at)),'[]') from public.platform_jobs where job_type='commusoft.source_sync' and status in('queued','running','retrying')),
        'account',(select jsonb_build_object('id',id,'connectionId',settings->'commusoft_import'->>'connectionId','resource',settings->'commusoft_import'->>'resource','contactType',settings->'commusoft_import'->>'contactType','expiresAt',settings->'commusoft_import'->>'expiresAt','checkpoint',sync_cursor) from public.connector_accounts where id=${quote(SCOPE.account)}),
        'operatorApproval',exists(select 1 from public.learn_operator_input_requests r join public.connector_accounts a on a.id=${quote(SCOPE.account)} where r.tenant_id=${quote(SCOPE.tenant)} and r.actor_id=${quote(SCOPE.actor)} and r.created_at>${quote(p.cutoff)}::timestamptz and r.definition->>'kind' in('resume_commusoft','start_commusoft') and r.receipt->>'state'='recorded' and r.receipt->>'approval_id'=a.settings->'commusoft_import'->>'approvalId'),
        'sources',(select jsonb_agg(x) from(select collection,count(*)::int versions,count(distinct external_id)::int records from public.learn_business_input_versions where tenant_id=${quote(SCOPE.tenant)} group by collection)x)) state`);
      check(rows.length === 1, "State missing");
      return rows[0].state;
    };
    if (mode === "inspect") {
      if (p.pending) {
        const r = await sql(
          `select j.id,j.status,j.attempt_count,j.error_code,j.lease_expires_at,
            (select count(*)::int from public.learn_business_input_request_permits p where p.job_id=j.id) permits,
            (select count(*)::int from public.learn_business_input_pages p where p.job_id=j.id) pages
           from public.platform_jobs j where j.id=${quote(p.pending.job)} and j.tenant_id=${quote(SCOPE.tenant)}`,
        );
        p.pendingObservation = r;
        // Keep the uncertain invocation bound to its exact job until a terminal DB result exists.
        if (
          r.length === 1 &&
          ["succeeded", "dead_letter", "failed", "cancelled"].includes(r[0].status)
        ) {
          p.history.push({ ...p.pending, recovered: r[0] });
          delete p.pending;
        } else if (r.length === 1 && unclaimedInvocationSettled(p.pending, r[0])) {
          p.history.push({
            ...p.pending,
            recoveredUnclaimed: r[0],
            observedAt: new Date().toISOString(),
          });
          delete p.pending;
        }
      }
    }
    if (["step", "batch"].includes(mode)) {
      check(!p.pending, "Inspect the existing uncertain invocation before dispatch");
      const endpoints = await fetch(
        `https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`,
        {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      );
      check(endpoints.ok, "Runtime read failed");
      const matches = (await endpoints.json()).filter((e) => e.slug === "learn-commusoft-worker");
      check(
        matches.length === 1 &&
          matches[0].id === "c37a06f6-3939-4e68-bdbf-2bd78f6869c2" &&
          matches[0].ezbr_sha256 ===
            "c07750cef88ffb84ee5107592c42fe920eb011daef1f8a5286c7fe22b7803961" &&
          matches[0].status === "ACTIVE" &&
          matches[0].verify_jwt === true,
        "Worker runtime changed",
      );
      const response = await fetch(
        `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
        {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      );
      check(response.ok, "Existing TEST worker credential unavailable");
      const keys = (await response.json()).filter((k) => k.name === "service_role");
      check(keys.length === 1, "Unique TEST service credential required");
      const key = keys[0].api_key,
        claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
      check(
        claims.ref === TEST_PROJECT && claims.role === "service_role",
        "Wrong worker credential",
      );
      for (let i = 0; i < (mode === "step" ? 1 : 1500); i++) {
        let current = await state();
        if (current.jobs.length === 0) break;
        const next = current.jobs[0];
        const wait = Date.parse(next.availableAt) - Date.now();
        if (wait > 0 && wait <= 60000 && next.status !== "running") {
          await new Promise((r) => setTimeout(r, wait + 100));
          current = await state();
        }
        const job = assertDispatch(p, current);
        p.invocations++;
        p.pending = { job: job.id, invocation: p.invocations, startedAt: new Date().toISOString() };
        save(p);
        const r = await fetch(
          `https://${TEST_PROJECT}.supabase.co/functions/v1/learn-commusoft-worker`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "x-serviceos-worker-key": key },
            redirect: "error",
            signal: AbortSignal.timeout(105000),
          },
        );
        check(r.ok, `Worker response HTTP ${r.status}; inspect exact job before retry`);
        const result = acceptWorkerReply(await r.json(), job.id);
        p.history.push({ ...p.pending, result });
        delete p.pending;
        save(p);
        if (i % 10 === 0)
          console.log(
            JSON.stringify({
              at: new Date().toISOString(),
              invocations: p.invocations,
              checkpoint: current.account.checkpoint,
              requests: current.requests,
            }),
          );
        if (result.outcomes.some((o) => o.status !== "succeeded")) break;
      }
    }
    p.latest = await state();
    const after = await sql(preservationQuery(p));
    const sort = (r) => JSON.stringify(r.sort((a, b) => a.name.localeCompare(b.name)));
    p.preserved = sort(after) === sort(p.before);
    p.changedDatasets = after
      .filter((a) => JSON.stringify(a) !== JSON.stringify(p.before.find((b) => a.name === b.name)))
      .map((r) => r.name);
    save(p);
    console.log(
      JSON.stringify(
        {
          run: p.runId,
          mode,
          invocations: p.invocations,
          pending: p.pending ?? null,
          preserved: p.preserved,
          changedDatasets: p.changedDatasets,
          latest: p.latest,
        },
        null,
        2,
      ),
    );
    check(p.preserved, "Preservation changed; inspect affected dataset");
  } finally {
    closeSync(lock);
    unlinkSync(stem + ".lock");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  check(
    ["prepare", "inspect", "step", "batch"].includes(mode) && process.argv.length === 3,
    "Explicit mode required",
  );
  run(mode).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
