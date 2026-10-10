/** Bounded continuation of the retained Drummonds TEST import. No provider writes.
 * A separate approval creates fresh temporary access; the retired run is never reopened.
 */
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readPhoneHealthCatalog, PHONE_HEALTH_PRESERVED } from "./learn-phone-health-catalog.mjs";
import { AUTH_CONTRACT_QUERY } from "./learn-test-auth-contract.mjs";
import { actionAuthContractMatches } from "./learn-test-actions-acceptance.mjs";
import { readOperatorInputs, resolveOperatorInput } from "../../src/lib/learn-operator-inputs.ts";
const base = `https://${TEST_PROJECT}.supabase.co`;
const file = ".verification-results/commusoft-continuation-session.json";
const priorFile = ".verification-results/commusoft-real-test-session.json";
const schema = "8ccaa108faa30d2dbfb41e1363011d7c";
const origin = "ef5a92ff-b2de-4dbf-ba21-1c2e0a3f7c6d";
const tenant = "f8c114fa-fee7-4983-8970-f6e7f5fd3129";
const connection = "59484382-d380-4362-b031-19db133e6d3a";
const account = "b0609b8b-8a12-4dc2-afdc-0e0f28a29079";
const version = "commusoft-continuation-session/1";
const writes = [
  "activate",
  "enable",
  "resume-jobs",
  "start-customer-contacts",
  "start-workaddress-contacts",
  "worker-step",
];
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const sameCheckpoint = (a, b) =>
  !!a &&
  !!b &&
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((k) => a[k] === b[k]);
const uuid = (v) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export function newContinuationPlan() {
  const runId = randomUUID();
  return {
    version,
    projectRef: TEST_PROJECT,
    runId,
    tenant,
    connection,
    account,
    origin,
    user: randomUUID(),
    grant: randomUUID(),
    email: `learn-continuation-${runId.slice(0, 8)}@example.invalid`,
    durationMinutes: 60,
    maxProviderRequests: 4000,
    limits: { additionalJobPages: 500, customerContactPages: 2000, workaddressContactPages: 1500 },
    state: "prepared",
    workerInvocations: 0,
  };
}
export function validateContinuationPlan(p) {
  check(
    p?.version === version &&
      p.projectRef === TEST_PROJECT &&
      p.tenant === tenant &&
      p.connection === connection &&
      p.account === account &&
      p.origin === origin &&
      p.durationMinutes === 60 &&
      p.maxProviderRequests === 4000 &&
      JSON.stringify(p.limits) ===
        JSON.stringify({
          additionalJobPages: 500,
          customerContactPages: 2000,
          workaddressContactPages: 1500,
        }) &&
      [p.runId, p.user, p.grant].every(uuid) &&
      new Set([p.runId, p.user, p.grant, tenant, connection, account]).size === 6 &&
      p.email === `learn-continuation-${p.runId.slice(0, 8)}@example.invalid`,
    "Continuation scope differs",
  );
}
export function continuationPreservationQuery(p) {
  validateContinuationPlan(p);
  check(
    Number.isFinite(Date.parse(p.cutoff)) && /^[a-f0-9]{64}$/.test(p.keyFingerprint),
    "Preservation baseline required",
  );
  const append = {
    "public.learn_business_input_pages": "committed_at",
    "public.learn_business_input_versions": "first_seen_at",
    "public.learn_business_input_request_permits": "requested_at",
    "public.learn_operator_input_requests": "created_at",
    "public.platform_jobs": "created_at",
  };
  return PHONE_HEALTH_PRESERVED.map((name) => {
    let predicate = "true";
    if (append[name])
      predicate = `(s.tenant_id<>${q(tenant)} or s.${append[name]}<=${q(p.cutoff)}::timestamptz)`;
    if (name === "public.learn_business_input_observations")
      predicate = `exists(select 1 from public.learn_business_input_pages r where r.id=s.page_id and (r.tenant_id<>${q(tenant)} or r.committed_at<=${q(p.cutoff)}::timestamptz))`;
    if (name === "public.learn_commusoft_contact_targets")
      predicate = `s.tenant_id<>${q(tenant)} or exists(select 1 from public.learn_operator_input_requests r where r.id=s.approval_id and r.created_at<=${q(p.cutoff)}::timestamptz)`;
    if (name === "public.connector_accounts") predicate = `id<>${q(account)}`;
    if (name === "public.tenant_connectors")
      predicate = `id<>(select tenant_connector_id from public.connector_accounts where id=${q(account)} and tenant_id=${q(tenant)})`;
    if (name === "public.feature_flags")
      predicate = `tenant_id<>${q(tenant)} or flag not in ('learn.enabled','learn.inputs.commusoft.enabled')`;
    if (name === "public.profiles") predicate = `id<>${q(p.user)}`;
    if (name === "public.platform_authority_grants") predicate = `id<>${q(p.grant)}`;
    if (name === "public.learn_business_input_request_gates")
      predicate = `credential_fingerprint<>${q(p.keyFingerprint)}`;
    return `select '${name}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${name} s where ${predicate}`;
  }).join(" union all ");
}
export function continuationDefinition(mode, p, overview) {
  validateContinuationPlan(p);
  const c = overview.connections.find((c) => c.id === connection),
    a = overview.accounts.find((a) => a.id === account);
  check(
    c &&
      c.status === "configured" &&
      !c.revoked &&
      c.credential_bound &&
      c.verified_at &&
      c.account_key === "19136" &&
      c.region === "uk" &&
      a?.connection_id === connection,
    "Existing verified Drummonds connection required",
  );
  const common = {
    reason: "Approved bounded Drummonds TEST continuation",
    connection_id: connection,
    revision: c.revision,
  };
  if (mode === "enable")
    return {
      kind: "set_modules",
      reason: common.reason,
      expected: overview.flags,
      values: { "learn.enabled": true, "learn.inputs.commusoft.enabled": true },
    };
  check(
    overview.flags["learn.enabled"] === true &&
      overview.flags["learn.inputs.commusoft.enabled"] === true,
    "Capture must be enabled",
  );
  if (mode === "resume-jobs") {
    check(
      a.resource === "jobs" &&
        a.checkpoint.complete === false &&
        a.checkpoint.pages === p.startPages &&
        a.approval_id === p.approvalId &&
        a.latest_job?.id === p.lastJob &&
        a.latest_job.status === "succeeded" &&
        sameCheckpoint(a.checkpoint, p.checkpoint),
      "Retained job checkpoint changed",
    );
    return {
      ...common,
      kind: "resume_commusoft",
      account_id: account,
      approval_id: a.approval_id,
      job_id: a.latest_job.id,
      checkpoint: a.checkpoint,
      max_pages: p.startPages + p.limits.additionalJobPages,
      expires_at: p.expiresAt,
    };
  }
  const customer = mode === "start-customer-contacts";
  check(customer || mode === "start-workaddress-contacts", "Unknown input phase");
  check(
    a.checkpoint.complete === true &&
      a.latest_job?.status === "succeeded" &&
      (customer
        ? a.resource === "jobs" && p.inputRequests?.["resume-jobs"]?.state === "recorded"
        : a.resource === "propertyContacts" &&
          a.approval_id === p.inputRequests?.["start-customer-contacts"]?.receipt?.request_id),
    "Previous collection must finish before contacts",
  );
  return {
    ...common,
    kind: "start_commusoft",
    resource: "propertyContacts",
    contact_type: customer ? "customer" : "workaddress",
    max_pages: customer ? p.limits.customerContactPages : p.limits.workaddressContactPages,
    page_size: 100,
    expires_at: p.expiresAt,
  };
}
export function publicContinuationSummary(p) {
  validateContinuationPlan(p);
  return {
    version,
    projectRef: TEST_PROJECT,
    runId: p.runId,
    state: p.state,
    tenant,
    connection,
    account,
    email: p.email,
    durationMinutes: p.durationMinutes,
    maxProviderRequests: p.maxProviderRequests,
    limits: p.limits,
    expiresAt: p.expiresAt ?? null,
    workerInvocations: p.workerInvocations,
    preserved: p.preserved ?? null,
    startingJobPages: p.startPages ?? null,
    boundary: p.boundary ?? null,
    inputs: Object.fromEntries(
      Object.entries(p.inputRequests ?? {}).map(([k, v]) => [
        k,
        { state: v.state, receipt: v.receipt ?? null },
      ]),
    ),
  };
}
function privateRead(path) {
  const s = statSync(path);
  check(s.isFile() && !(s.mode & 0o077), "Private session journal required");
  return JSON.parse(readFileSync(path, "utf8"));
}
export async function runContinuation(
  mode,
  {
    token,
    approvedRun,
    fetcher = fetch,
    read = () => privateRead(file),
    save = (p, exclusive = false) =>
      writeFileSync(file, JSON.stringify(p, null, 2) + "\n", {
        mode: 0o600,
        flag: exclusive ? "wx" : "w",
      }),
    sql = (query, readOnly = true) => communicationQuery(token, query, { readOnly, fetcher }),
    catalog = () => readPhoneHealthCatalog(token, { fetcher }),
    prior = () => privateRead(priorFile),
    clientFactory = createClient,
  } = {},
) {
  check(
    ["prepare", ...writes, "check-input", "check-worker", "status", "retire"].includes(mode),
    "Explicit phase required",
  );
  const p = mode === "prepare" ? newContinuationPlan() : await read();
  validateContinuationPlan(p);
  if (writes.includes(mode)) {
    check(approvedRun === p.runId, "Explicit approval of this continuation required");
    check(!["retired", "grant_retired"].includes(p.state), "Continuation is retired");
    check(p.preserved !== false, "Preservation mismatch needs inspection");
  }
  const persist = () => save(p);
  const snapshot = async () => {
    const rows = await sql(continuationPreservationQuery(p));
    check(
      rows.length === 78 &&
        new Set(rows.map((r) => r.name)).size === 78 &&
        rows.every(
          (r) =>
            Number.isSafeInteger(r.count) && r.count >= 0 && /^[a-f0-9]{32}$/.test(r.fingerprint),
        ),
      "Complete preservation evidence required",
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  };
  async function req(url, headers, method = "GET", body) {
    const r = await fetcher(url, {
      method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(45000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    check(r.ok, `TEST request failed (HTTP ${r.status})`);
    return r.json();
  }
  let credentials;
  async function keys() {
    if (credentials) return credentials;
    const rows = await req(
      `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
      { Authorization: `Bearer ${token}` },
    );
    credentials = {};
    for (const role of ["anon", "service_role"]) {
      const selected = rows.filter((r) => r.name === role);
      check(selected.length === 1, "Existing TEST key required");
      const key = selected[0].api_key,
        claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
      check(claims.ref === TEST_PROJECT && claims.role === role, "Wrong TEST key");
      credentials[role] = key;
    }
    return credentials;
  }
  async function admin() {
    const k = (await keys()).service_role;
    return { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
  }
  async function client() {
    check(
      p.state === "active" && Date.parse(p.expiresAt) > Date.now() + 120000,
      "Active continuation with two minutes remaining required",
    );
    const db = clientFactory(base, (await keys()).anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetcher },
    });
    const r = await db.auth.signInWithPassword({ email: p.email, password: p.password });
    check(!r.error && r.data.user?.id === p.user, "Continuation login failed");
    return db;
  }
  async function preflight() {
    check((await catalog()).fingerprint === schema, "TEST release changed");
    const rows = await sql(AUTH_CONTRACT_QUERY);
    check(
      rows.length === 1 && actionAuthContractMatches(rows[0].contract),
      "Auth contract changed",
    );
    const endpoints = await req(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`, {
      Authorization: `Bearer ${token}`,
    });
    for (const slug of ["learn-commusoft-worker", "learn-commusoft-verify"]) {
      const e = endpoints.find((e) => e.slug === slug);
      check(e?.version === 4 && e.status === "ACTIVE" && e.verify_jwt === true, "Runtime changed");
    }
    const state = await sql(`select clock_timestamp() as cutoff,
   (select count(*)::int from public.tenants where id=${q(tenant)} and status='active' and metadata->>'learn_real_commusoft_session'=${q(origin)}) as tenant_count,
   (select count(*)::int from auth.users where id=${q(p.user)} or lower(email)=${q(p.email)}) as users,
   (select count(*)::int from public.platform_authority_grants where id=${q(p.grant)} or (permission='platform.controlplane.admin' and coalesce(effective_from,'-infinity')<=now() and coalesce(effective_to,'infinity')>now())) as grants,
   (select count(*)::int from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')) as active_jobs,
   (select count(*)::int from public.feature_flags where tenant_id=${q(tenant)} and flag in ('learn.enabled','learn.inputs.commusoft.enabled') and value='false'::jsonb) as paused_flags,
   (select jsonb_build_object('resource',settings->'commusoft_import'->>'resource','approval_id',settings->'commusoft_import'->>'approvalId','connection_id',settings->'commusoft_import'->>'connectionId','checkpoint',sync_cursor) from public.connector_accounts where id=${q(account)} and tenant_id=${q(tenant)} and account_key='19136') as account,
   (select id from public.platform_jobs where tenant_id=${q(tenant)} and job_type='commusoft.source_sync' and payload->>'connector_account_id'=${q(account)} order by created_at desc,id desc limit 1) as last_job,
   (select count(*)::int from public.provider_connections c join vault.secrets v on v.id=(c.secret_refs->>'api_key')::uuid where c.id=${q(connection)} and c.tenant_id=${q(tenant)} and c.provider='commusoft' and c.status='configured' and c.revoked_at is null and c.verified_at is not null and c.non_secret_config->>'account_key'='19136' and c.non_secret_config->>'region'='uk' and v.name='provider_secret:'||c.tenant_id||':commusoft:api_key') as credential_bound`);
    const s = state[0];
    check(
      state.length === 1 &&
        s.tenant_count === 1 &&
        s.users === 0 &&
        s.grants === 0 &&
        s.active_jobs === 0 &&
        s.paused_flags === 2 &&
        s.credential_bound === 1 &&
        s.account?.resource === "jobs" &&
        s.account.connection_id === connection &&
        s.account.checkpoint.complete === false &&
        s.account.checkpoint.pages === 100 &&
        uuid(s.last_job),
      "Retained TEST boundary changed",
    );
    return s;
  }
  if (mode === "prepare") {
    const old = await prior();
    check(
      old.state === "retired" &&
        old.runId === origin &&
        old.tenant === tenant &&
        old.preserved === true &&
        old.boundary.active_grants === 0 &&
        old.boundary.banned === 1 &&
        /^[a-f0-9]{64}$/.test(old.keyFingerprint),
      "Original run must remain retired",
    );
    const s = await preflight();
    p.cutoff = s.cutoff;
    p.keyFingerprint = old.keyFingerprint;
    p.checkpoint = s.account.checkpoint;
    p.approvalId = s.account.approval_id;
    p.lastJob = s.last_job;
    p.startPages = s.account.checkpoint.pages;
    p.before = await snapshot();
    await save(p, true);
  } else if (mode === "activate") {
    check(p.state === "prepared", "Activation cannot be replayed");
    const s = await preflight();
    check(
      sameCheckpoint(s.account.checkpoint, p.checkpoint) &&
        s.last_job === p.lastJob &&
        JSON.stringify(await snapshot()) === JSON.stringify(p.before),
      "Prepared boundary changed",
    );
    const headers = await admin();
    p.password = randomBytes(36).toString("base64url");
    p.state = "activation_started";
    await persist();
    const user = await req(base + "/auth/v1/admin/users", headers, "POST", {
      id: p.user,
      email: p.email,
      password: p.password,
      email_confirm: true,
      app_metadata: { learn_commusoft_continuation: p.runId },
    });
    check(user.id === p.user, "Created identity differs");
    p.state = "identity_created";
    await persist();
    const grant = await sql(
      `begin;do $$begin if not exists(select 1 from auth.users where id=${q(p.user)} and raw_app_meta_data->>'learn_commusoft_continuation'=${q(p.runId)}) then raise exception 'Continuation identity differs';end if;end $$;
   update public.profiles set tenant_id=${q(tenant)},role='viewer' where id=${q(p.user)} and lower(email)=${q(p.email)};
   do $$begin if not exists(select 1 from public.profiles where id=${q(p.user)} and tenant_id=${q(tenant)} and role='viewer') then raise exception 'Profile binding differs';end if;end $$;
   insert into public.platform_authority_grants(id,profile_id,permission,effective_from,effective_to,granted_by,reason,source) values(${q(p.grant)},${q(p.user)},'platform.controlplane.admin',clock_timestamp(),clock_timestamp()+interval '60 minutes',${q("approved-continuation:" + p.runId)},'Approved bounded Drummonds TEST continuation','test');commit;select effective_to as expires_at from public.platform_authority_grants where id=${q(p.grant)}`,
      false,
    );
    check(
      grant.length === 1 && Number.isFinite(Date.parse(grant[0].expires_at)),
      "Grant expiry unconfirmed",
    );
    p.expiresAt = grant[0].expires_at;
    p.state = "active";
    await persist();
  } else if (
    ["enable", "resume-jobs", "start-customer-contacts", "start-workaddress-contacts"].includes(
      mode,
    )
  ) {
    check(!p.inputRequests?.[mode], "Input request already journalled; inspect its result");
    const db = await client(),
      overview = await readOperatorInputs(db, tenant),
      definition = continuationDefinition(mode, p, overview);
    const request = { tenantId: tenant, actorId: p.user, requestId: randomUUID(), definition };
    p.inputRequests ??= {};
    p.inputRequests[mode] = { request, state: "submitting" };
    p.lastInputMode = mode;
    await persist();
    const receipt = await resolveOperatorInput(db, request, "apply");
    check(receipt.state === "recorded", "Input receipt unconfirmed");
    p.inputRequests[mode] = { request, state: "recorded", receipt };
    await persist();
  } else if (mode === "check-input") {
    const entry = p.inputRequests?.[p.lastInputMode];
    check(entry, "No input to inspect");
    entry.receipt = await resolveOperatorInput(await client(), entry.request, "check");
    entry.state = entry.receipt.state;
    await persist();
  } else if (mode === "worker-step") {
    check(
      p.state === "active" && Date.parse(p.expiresAt) > Date.now() + 120000,
      "Active continuation with two minutes remaining required",
    );
    check(
      p.inputRequests?.enable?.state === "recorded" &&
        p.inputRequests?.["resume-jobs"]?.state === "recorded",
      "Approved continuation required",
    );
    check(
      Number.isSafeInteger(p.workerInvocations) &&
        p.workerInvocations >= 0 &&
        p.workerInvocations < 4000 &&
        !p.workerUnconfirmed,
      "Request budget or unresolved worker prevents dispatch",
    );
    const jobs = await sql(
      `select id,tenant_id,status,payload->>'connector_account_id' as account_id from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')`,
    );
    check(
      jobs.length === 1 &&
        jobs[0].tenant_id === tenant &&
        jobs[0].account_id === account &&
        ["queued", "retrying"].includes(jobs[0].status),
      "Exactly one queued continuation job required",
    );
    const service = (await keys()).service_role;
    p.workerInvocations++;
    p.workerUnconfirmed = {
      jobId: jobs[0].id,
      invocation: p.workerInvocations,
      startedAt: new Date().toISOString(),
    };
    await persist();
    const result = await req(
      base + "/functions/v1/learn-commusoft-worker",
      { Authorization: `Bearer ${service}`, "x-serviceos-worker-key": service },
      "POST",
    );
    check(
      result.ok === true &&
        [0, 1].includes(result.result?.claimed) &&
        Array.isArray(result.result.outcomes) &&
        result.result.outcomes.length === result.result.claimed &&
        result.result.outcomes.every(
          (o) =>
            o.job_id === jobs[0].id &&
            typeof o.status === "string" &&
            (o.successor_id === null || uuid(o.successor_id)),
        ),
      "Worker reply unconfirmed",
    );
    p.lastWorker = result.result;
    delete p.workerUnconfirmed;
    await persist();
  } else if (mode === "check-worker") {
    check(p.workerUnconfirmed, "No worker uncertainty");
    const rows = await sql(
      `select status from public.platform_jobs where id=${q(p.workerUnconfirmed.jobId)} and tenant_id=${q(tenant)}`,
    );
    check(
      rows.length === 1 &&
        ["succeeded", "failed", "cancelled", "dead_letter"].includes(rows[0].status),
      "Worker is not terminal; keep its handle",
    );
    p.lastWorker = { recoveredTerminalStatus: rows[0].status };
    delete p.workerUnconfirmed;
    await persist();
  } else if (mode === "retire") {
    check(p.state !== "prepared", "No activation attempted");
    await sql(
      `begin;update public.feature_flags set value='false'::jsonb where tenant_id=${q(tenant)} and flag in ('learn.enabled','learn.inputs.commusoft.enabled') and exists(select 1 from public.tenants where id=${q(tenant)} and metadata->>'learn_real_commusoft_session'=${q(origin)});update public.platform_authority_grants set effective_to=least(coalesce(effective_to,clock_timestamp()),clock_timestamp()) where id=${q(p.grant)} and profile_id=${q(p.user)} and granted_by=${q("approved-continuation:" + p.runId)};commit;`,
      false,
    );
    p.state = "grant_retired";
    await persist();
    const headers = await admin(),
      current = await req(base + "/auth/v1/admin/users/" + p.user, headers);
    check(
      current.email === p.email && current.app_metadata?.learn_commusoft_continuation === p.runId,
      "Retirement identity differs",
    );
    const banned = await req(base + "/auth/v1/admin/users/" + p.user, headers, "PUT", {
      ban_duration: "876000h",
      password: randomBytes(48).toString("base64url"),
    });
    check(Date.parse(banned.banned_until) > Date.now() + 86400000, "Ban unconfirmed");
    delete p.password;
    p.state = "retired";
    p.retiredAt = new Date().toISOString();
    await persist();
  }
  if (mode !== "prepare") {
    p.preserved = JSON.stringify(await snapshot()) === JSON.stringify(p.before);
    await persist();
    check(p.preserved, "Retained data changed; inspect before continuing");
    const rows = await sql(
      `select (select count(*)::int from public.learn_business_input_request_permits where tenant_id=${q(tenant)} and requested_at>${q(p.cutoff)}::timestamptz) as requests,(select count(*)::int from public.platform_authority_grants where profile_id=${q(p.user)} and coalesce(effective_from,'-infinity')<=now() and coalesce(effective_to,'infinity')>now()) as active_grants,(select count(*)::int from auth.users where id=${q(p.user)} and banned_until>now()) as banned`,
    );
    check(
      rows.length === 1 && rows[0].requests <= 4000 && rows[0].requests <= p.workerInvocations,
      "Approved request boundary exceeded",
    );
    p.boundary = rows[0];
    await persist();
    if (p.state === "retired")
      check(p.boundary.active_grants === 0 && p.boundary.banned === 1, "Retirement incomplete");
  }
  return publicContinuationSummary(p);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, flag, approvedRun, ...extra] = process.argv.slice(2);
    check(
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT && extra.length === 0,
      "Explicit TEST target required",
    );
    check(
      writes.includes(mode) ? flag === "--approved-run" && uuid(approvedRun) : flag === undefined,
      "Explicit phase arguments required",
    );
    console.log(
      JSON.stringify(await runContinuation(mode, { token: savedCliToken(), approvedRun }), null, 2),
    );
  } catch {
    console.error(
      "Continuation stopped. Inspect its private journal; do not replay an uncertain mutation.",
    );
    process.exitCode = 1;
  }
}
