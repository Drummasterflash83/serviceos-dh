/** Prepared, explicitly approved TEST session for a real Drummonds connection.
 * No provider writes or automatic retries. Each mutating phase is journalled first.
 * Unknown replies require read-only inspection; activation is never replayed.
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readTraversalCatalog,
  TRAVERSAL_PRESERVED,
} from "./learn-commusoft-contact-traversal-catalog.mjs";
import { AUTH_CONTRACT_QUERY } from "./learn-test-auth-contract.mjs";
import { actionAuthContractMatches } from "./learn-test-actions-acceptance.mjs";
import { readOperatorInputs, resolveOperatorInput } from "../../src/lib/learn-operator-inputs.ts";
import { resolveCommusoftSetup } from "../../src/lib/learn-commusoft-connection.ts";
import { resolveCommusoftVerification } from "../../src/lib/learn-commusoft-verification.ts";

const base = `https://${TEST_PROJECT}.supabase.co`;
const manifest = new URL(
  "../../.verification-results/commusoft-real-test-session.json",
  import.meta.url,
);
const keyFile = new URL(
  "../../.verification-results/commusoft-existing-private-key",
  import.meta.url,
);
const version = "commusoft-real-test-session/1";
const schema = "195ca207f0d8a7a95b0fb30580e093fd";
const writeModes = [
  "activate",
  "connect",
  "verify",
  "enable",
  "start-properties",
  "start-jobs",
  "start-customer-contacts",
  "start-workaddress-contacts",
  "worker-step",
];
const importLimits = {
  "start-properties": { resource: "properties", max_pages: 200 },
  "start-jobs": { resource: "jobs", max_pages: 100 },
  "start-customer-contacts": {
    resource: "propertyContacts",
    contact_type: "customer",
    max_pages: 50,
  },
  "start-workaddress-contacts": {
    resource: "propertyContacts",
    contact_type: "workaddress",
    max_pages: 50,
  },
};
const slug = "drummonds-commusoft-test";
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const uuid = (v) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const fingerprint = (key) =>
  createHash("sha256")
    .update("commusoft:" + key)
    .digest("hex");
export function newRealTestPlan() {
  const runId = randomUUID();
  return {
    version,
    projectRef: TEST_PROJECT,
    runId,
    tenant: randomUUID(),
    user: randomUUID(),
    grant: randomUUID(),
    email: `learn-drummonds-${runId.slice(0, 8)}@example.invalid`,
    slug,
    displayName: "Drummonds — Commusoft TEST",
    accountKey: "19136",
    durationMinutes: 30,
    state: "prepared",
    createdAt: new Date().toISOString(),
    maxProviderRequests: 401,
    restrictions: [
      "One hosted read-only verification plus at most 400 worker invocations: properties 200 pages, jobs 100 pages, customer contacts 50 pages, work-address contacts 50 pages; 100 records per page. No provider writes or schedule.",
      "Existing Drummonds private-app credential copied to TEST Vault through the authenticated setup RPC.",
      "New temporary operator can administer all TEST clients; actions restricted to the new Drummonds TEST tenant.",
      "Retain TEST tenant, encrypted credential, imported source records and receipts. Pause capture, end grant and ban temporary login. No production changes. Import completeness is not assumed when a budget or time limit is reached.",
    ],
  };
}
export function validateRealTestPlan(p) {
  check(
    p?.version === version &&
      p.projectRef === TEST_PROJECT &&
      p.slug === slug &&
      p.accountKey === "19136" &&
      p.durationMinutes === 30 &&
      p.maxProviderRequests === 401 &&
      p.displayName === "Drummonds — Commusoft TEST" &&
      ["runId", "tenant", "user", "grant"].every((k) => uuid(p[k])) &&
      new Set([p.runId, p.tenant, p.user, p.grant]).size === 4 &&
      p.email === `learn-drummonds-${p.runId.slice(0, 8)}@example.invalid`,
    "Prepared TEST scope differs",
  );
}
export function preservationQuery(p) {
  validateRealTestPlan(p);
  return [...TRAVERSAL_PRESERVED, "public.learn_commusoft_contact_targets"]
    .map((name) => {
      let predicate = `coalesce(to_jsonb(s)->>'tenant_id','')<>${q(p.tenant)}`;
      if (name === "public.tenants") predicate = `id<>${q(p.tenant)}`;
      if (name === "public.profiles") predicate = `id<>${q(p.user)}`;
      if (name === "public.platform_authority_grants") predicate = `id<>${q(p.grant)}`;
      if (name === "vault.secrets")
        predicate = `name is distinct from ${q("provider_secret:" + p.tenant + ":commusoft:api_key")}`;
      if (name === "public.learn_business_input_request_gates")
        predicate = `credential_fingerprint<>${q(p.keyFingerprint)}`;
      return `select '${name}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${name} s where ${predicate}`;
    })
    .join(" union all ");
}
export function publicRealTestSummary(p) {
  validateRealTestPlan(p);
  return {
    version,
    projectRef: TEST_PROJECT,
    runId: p.runId,
    state: p.state,
    tenant: p.tenant,
    email: p.email,
    durationMinutes: p.durationMinutes,
    maxProviderRequests: p.maxProviderRequests,
    expiresAt: p.expiresAt ?? null,
    verification: p.verification ?? null,
    workerInvocations: p.workerInvocations ?? 0,
    inputReceipts: Object.fromEntries(
      Object.entries(p.inputRequests ?? {}).map(([k, v]) => [
        k,
        { state: v.state, receipt: v.receipt ?? null },
      ]),
    ),
    boundary: p.boundary ?? null,
    preserved: p.preserved ?? null,
    restrictions: p.restrictions,
  };
}
function localKey() {
  const s = statSync(keyFile);
  check(
    s.isFile() && !(s.mode & 0o077) && s.size > 0 && s.size <= 4096,
    "Private credential file required",
  );
  const key = readFileSync(keyFile, "utf8").trim();
  check(/^[\x21-\x7e]{1,4096}$/.test(key), "Private credential format differs");
  return key;
}
export async function runRealTestSession(
  mode,
  {
    token,
    approvedRun,
    fetcher = fetch,
    read = () => {
      const s = statSync(manifest);
      check(s.isFile() && !(s.mode & 0o077), "Private journal required");
      return JSON.parse(readFileSync(manifest, "utf8"));
    },
    save = (p, exclusive = false) =>
      writeFileSync(manifest, JSON.stringify(p, null, 2) + "\n", {
        mode: 0o600,
        flag: exclusive ? "wx" : "w",
      }),
    sql = (query, readOnly = true) => communicationQuery(token, query, { readOnly, fetcher }),
    catalog = () => readTraversalCatalog(token, { fetcher }),
    key = localKey,
  } = {},
) {
  check(
    [
      "prepare",
      ...writeModes,
      "check-connection",
      "check-input",
      "check-verification",
      "check-worker",
      "status",
      "retire",
    ].includes(mode),
    "Explicit phase required",
  );
  const p = mode === "prepare" ? newRealTestPlan() : await read();
  validateRealTestPlan(p);
  const persist = () => save(p);
  if (writeModes.includes(mode))
    check(approvedRun === p.runId, "Explicit approval of this exact run required");
  const snapshot = async () => {
    const rows = await sql(preservationQuery(p));
    check(
      rows.length === 78 &&
        new Set(rows.map((r) => r.name)).size === 78 &&
        rows.every(
          (r) => Number.isInteger(r.count) && r.count >= 0 && /^[a-f0-9]{32}$/.test(r.fingerprint),
        ),
      "Complete preservation snapshot required",
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
      const chosen = rows.filter((r) => r.name === role);
      check(chosen.length === 1, "Unique existing TEST key required");
      const value = chosen[0].api_key,
        claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url"));
      check(claims.ref === TEST_PROJECT && claims.role === role, "TEST key target differs");
      credentials[role] = value;
    }
    return credentials;
  }
  async function admin() {
    const k = (await keys()).service_role;
    return { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
  }
  async function client() {
    check(
      p.state !== "retired" && Date.parse(p.expiresAt) > Date.now() + 60000,
      "Active session with at least one minute remaining required",
    );
    const db = createClient(base, (await keys()).anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetcher },
    });
    const result = await db.auth.signInWithPassword({ email: p.email, password: p.password });
    check(!result.error && result.data.user?.id === p.user, "TEST session authentication failed");
    return db;
  }
  async function preflight() {
    check((await catalog()).fingerprint === schema, "Installed contact schema differs");
    const contract = await sql(AUTH_CONTRACT_QUERY);
    check(
      contract.length === 1 && actionAuthContractMatches(contract[0].contract),
      "Auth contract differs",
    );
    const rows = await sql(`select
      (select count(*)::int from public.tenants where id=${q(p.tenant)} or slug=${q(slug)} or (metadata->>'commusoft_account'='19136' and metadata->>'test'='true')) as tenants,
      (select count(*)::int from auth.users where id=${q(p.user)} or lower(email)=${q(p.email)}) as users,
      (select count(*)::int from public.platform_authority_grants where id=${q(p.grant)} or (permission='platform.controlplane.admin' and coalesce(effective_from,'-infinity')<=now() and coalesce(effective_to,'infinity')>now())) as grants,
      (select count(*)::int from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')) as jobs,
      (select count(*)::int from public.learn_business_input_request_gates where credential_fingerprint=${q(p.keyFingerprint)}) as gates`);
    check(
      rows.length === 1 && Object.values(rows[0]).every((v) => v === 0),
      "Existing identity, client, authority or live work requires review",
    );
    const endpoints = await req(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`, {
      Authorization: `Bearer ${token}`,
    });
    for (const name of ["learn-commusoft-worker", "learn-commusoft-verify"]) {
      const r = endpoints.find((e) => e.slug === name);
      check(
        r?.version === 4 && r.status === "ACTIVE" && r.verify_jwt === true,
        "Published runtime differs",
      );
    }
  }
  if (mode === "prepare") {
    p.keyFingerprint = fingerprint(key());
    await preflight();
    p.before = await snapshot();
    await save(p, true);
  } else if (mode === "activate") {
    check(p.state === "prepared", "Activation cannot be replayed");
    check(fingerprint(key()) === p.keyFingerprint, "Existing credential changed");
    await preflight();
    check(
      JSON.stringify(await snapshot()) === JSON.stringify(p.before),
      "TEST data changed after preparation",
    );
    const headers = await admin();
    p.password = randomBytes(36).toString("base64url");
    p.state = "activation_started";
    await persist();
    const created = await req(base + "/auth/v1/admin/users", headers, "POST", {
      id: p.user,
      email: p.email,
      password: p.password,
      email_confirm: true,
      app_metadata: { learn_real_commusoft_session: p.runId },
    });
    check(created.id === p.user, "Created identity differs");
    p.state = "identity_created";
    await persist();
    const rows = await sql(
      `begin;set local statement_timeout='15s';
      do $$begin if not exists(select 1 from auth.users where id=${q(p.user)} and raw_app_meta_data->>'learn_real_commusoft_session'=${q(p.runId)}) then raise exception 'Session identity differs';end if;end $$;
      insert into public.tenants(id,slug,display_name,status,metadata) values(${q(p.tenant)},${q(slug)},${q(p.displayName)},'active',jsonb_build_object('test',true,'synthetic',false,'commusoft_account','19136','learn_real_commusoft_session',${q(p.runId)}));
      update public.profiles set tenant_id=${q(p.tenant)},role='viewer' where id=${q(p.user)} and lower(email)=${q(p.email)};
      do $$begin if not exists(select 1 from public.profiles where id=${q(p.user)} and tenant_id=${q(p.tenant)} and role='viewer') then raise exception 'Profile binding differs';end if;end $$;
      insert into public.platform_authority_grants(id,profile_id,permission,effective_from,effective_to,granted_by,reason,source)
      values(${q(p.grant)},${q(p.user)},'platform.controlplane.admin',clock_timestamp(),clock_timestamp()+interval '30 minutes',${q("approved-real-test:" + p.runId)},'Approved bounded Drummonds TEST connection and import acceptance','test');
      commit;select effective_to as expires_at from public.platform_authority_grants where id=${q(p.grant)}`,
      false,
    );
    check(
      rows.length === 1 && Number.isFinite(Date.parse(rows[0].expires_at)),
      "Grant expiry unconfirmed",
    );
    p.expiresAt = rows[0].expires_at;
    p.state = "active";
    await persist();
  } else if (mode === "connect") {
    check(p.state === "active", "Connection submission cannot be replayed");
    const secret = key();
    check(fingerprint(secret) === p.keyFingerprint, "Existing credential changed");
    const db = await client();
    p.setup = {
      tenantId: p.tenant,
      actorId: p.user,
      requestId: randomUUID(),
      definition: {
        kind: "configure_commusoft",
        reason: "Approved real Drummonds TEST connection verification",
        region: "uk",
        account_key: "19136",
        expected_revision: null,
        credential_mode: "replace",
        same_account_confirmed: true,
      },
    };
    p.state = "connection_submitting";
    await persist();
    p.connection = await resolveCommusoftSetup(db, p.setup, "apply", secret);
    check(p.connection.state === "recorded", "Connection receipt not recorded");
    p.state = "connected";
    await persist();
  } else if (mode === "check-connection") {
    check(p.setup, "No connection request to inspect");
    const db = await client();
    p.connection = await resolveCommusoftSetup(db, p.setup, "check");
    p.state = p.connection.state === "recorded" ? "connected" : "connection_requires_review";
    await persist();
  } else if (mode === "verify") {
    check(p.state === "connected", "Provider verification cannot be replayed");
    const db = await client();
    p.verificationRequest = {
      tenantId: p.tenant,
      actorId: p.user,
      requestId: randomUUID(),
      definition: {
        kind: "verify_commusoft",
        reason: "One approved hosted GET using the existing Drummonds private application",
        connection_id: p.connection.connection_id,
        revision: p.connection.revision,
        one_read_confirmed: true,
      },
    };
    p.state = "verification_submitting";
    await persist();
    p.verification = (
      await resolveCommusoftVerification(db, p.verificationRequest, "apply")
    ).receipt;
    p.state =
      p.verification.state === "recorded" && p.verification.code === "access_verified"
        ? "verified"
        : "verification_requires_review";
    await persist();
  } else if (mode === "check-verification") {
    check(p.verificationRequest, "No verification request to inspect");
    const db = await client();
    p.verification = (
      await resolveCommusoftVerification(db, p.verificationRequest, "check")
    ).receipt;
    p.state =
      p.verification.state === "recorded" && p.verification.code === "access_verified"
        ? "verified"
        : "verification_requires_review";
    await persist();
  } else if (mode === "enable" || Object.hasOwn(importLimits, mode)) {
    check(
      p.verification?.state === "recorded" && p.verification.code === "access_verified",
      "Hosted verification must succeed first",
    );
    check(!p.inputRequests?.[mode], "Input submission already journalled; inspect its receipt");
    const db = await client(),
      overview = await readOperatorInputs(db, p.tenant);
    const connection = overview.connections.find((c) => c.id === p.connection.connection_id);
    check(
      connection && !connection.revoked && connection.verified_at,
      "Current verified connection required",
    );
    const definition =
      mode === "enable"
        ? {
            kind: "set_modules",
            reason: "Approved bounded real TEST import",
            expected: overview.flags,
            values: { "learn.enabled": true, "learn.inputs.commusoft.enabled": true },
          }
        : {
            kind: "start_commusoft",
            reason: "Approved bounded real TEST import",
            connection_id: connection.id,
            revision: connection.revision,
            ...importLimits[mode],
            page_size: 100,
            expires_at: p.expiresAt,
          };
    const request = { tenantId: p.tenant, actorId: p.user, requestId: randomUUID(), definition };
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
    check(entry, "No input request to inspect");
    const db = await client();
    entry.receipt = await resolveOperatorInput(db, entry.request, "check");
    entry.state = entry.receipt.state;
    await persist();
  } else if (mode === "worker-step") {
    check(
      p.verification?.code === "access_verified" && p.inputRequests?.enable?.state === "recorded",
      "Verified enabled connection required",
    );
    check(
      Date.parse(p.expiresAt) > Date.now() + 120000,
      "At least two minutes of session authority required",
    );
    check((p.workerInvocations ?? 0) < 400, "Approved provider request budget exhausted");
    check(!p.workerUnconfirmed, "Previous worker invocation needs read-only inspection");
    const jobs = await sql(
      `select id,tenant_id,status from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')`,
    );
    check(
      jobs.length === 1 && jobs[0].tenant_id === p.tenant && jobs[0].status !== "running",
      "Exactly one owned queued or retrying job required",
    );
    const service = (await keys()).service_role;
    p.workerInvocations = (p.workerInvocations ?? 0) + 1;
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
    p.lastWorker = { invocation: p.workerInvocations, ...result.result };
    delete p.workerUnconfirmed;
    await persist();
  } else if (mode === "check-worker") {
    check(p.workerUnconfirmed, "No uncertain worker invocation");
    const rows = await sql(
      `select status from public.platform_jobs where id=${q(p.workerUnconfirmed.jobId)} and tenant_id=${q(p.tenant)}`,
    );
    check(
      rows.length === 1 &&
        ["succeeded", "failed", "cancelled", "dead_letter"].includes(rows[0].status),
      "Worker outcome is not terminal; retain the uncertain invocation",
    );
    p.lastWorker = {
      invocation: p.workerUnconfirmed.invocation,
      recoveredTerminalStatus: rows[0].status,
    };
    delete p.workerUnconfirmed;
    await persist();
  } else if (mode === "retire") {
    check(p.state !== "prepared", "No activation attempted");
    // Do not require unexpired operator authority to remove that exact authority.
    await sql(
      `begin;update public.feature_flags set value='false'::jsonb where tenant_id=${q(p.tenant)} and flag in ('learn.enabled','learn.inputs.commusoft.enabled') and exists(select 1 from public.tenants where id=${q(p.tenant)} and metadata->>'learn_real_commusoft_session'=${q(p.runId)});update public.platform_authority_grants set effective_to=least(coalesce(effective_to,clock_timestamp()),clock_timestamp()) where id=${q(p.grant)} and profile_id=${q(p.user)} and granted_by=${q("approved-real-test:" + p.runId)};commit;`,
      false,
    );
    p.state = "grant_retired";
    await persist();
    const headers = await admin();
    const current = await req(base + "/auth/v1/admin/users/" + p.user, headers);
    check(
      current.email === p.email && current.app_metadata?.learn_real_commusoft_session === p.runId,
      "Retirement identity differs",
    );
    const banned = await req(base + "/auth/v1/admin/users/" + p.user, headers, "PUT", {
      ban_duration: "876000h",
      password: randomBytes(48).toString("base64url"),
    });
    check(Date.parse(banned.banned_until) > Date.now() + 86400000, "Login ban unconfirmed");
    delete p.password;
    p.state = "retired";
    p.retiredAt = new Date().toISOString();
    await persist();
  }
  if (mode !== "prepare") {
    p.preserved = JSON.stringify(await snapshot()) === JSON.stringify(p.before);
    await persist();
    check(p.preserved, "Pre-existing data changed; inspect before continuing");
    const rows = await sql(
      `select (select count(*)::int from public.platform_jobs where tenant_id=${q(p.tenant)}) as jobs,(select count(*)::int from public.learn_business_input_pages where tenant_id=${q(p.tenant)}) as pages,(select count(*)::int from public.platform_authority_grants where profile_id=${q(p.user)} and coalesce(effective_from,'-infinity')<=now() and coalesce(effective_to,'infinity')>now()) as active_grants,(select count(*)::int from auth.users where id=${q(p.user)} and banned_until>now()) as banned`,
    );
    p.boundary = rows[0];
    await persist();
    check(rows.length === 1 && p.boundary.pages <= 400, "Approved import boundary differs");
    if (p.state === "retired")
      check(p.boundary.active_grants === 0 && p.boundary.banned === 1, "Retirement incomplete");
  }
  return publicRealTestSummary(p);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, flag, approvedRun, ...extra] = process.argv.slice(2);
    check(
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT && extra.length === 0,
      "Explicit TEST destination required",
    );
    check(
      writeModes.includes(mode)
        ? flag === "--approved-run" && uuid(approvedRun)
        : flag === undefined,
      "Explicit phase arguments required",
    );
    console.log(
      JSON.stringify(
        await runRealTestSession(mode, { token: savedCliToken(), approvedRun }),
        null,
        2,
      ),
    );
  } catch {
    console.error(
      "Real TEST session stopped. Inspect the private journal; do not repeat an uncertain mutation.",
    );
    process.exitCode = 1;
  }
}
