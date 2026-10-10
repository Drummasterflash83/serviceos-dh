/** Synthetic provider responses, real TEST Vault/RPCs/Auth and production worker code.
 * Only recovery of an already committed page invokes the deployed worker, while
 * the fixture's capture module is disabled. Never calls a provider or adds a schedule.
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { contactFixtureIdentities } from "./learn-commusoft-contact-fixture-plan.mjs";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { readOperatorInputsCatalog } from "./learn-operator-inputs-catalog.mjs";
import {
  installedOperatorInputs,
  operatorInputFingerprint,
} from "./learn-test-operator-inputs-release.mjs";
import { OPERATOR_PRESERVED_TABLES } from "./learn-test-operator-inputs-hosted.mjs";
import { AUTH_CONTRACT_QUERY } from "./learn-test-auth-contract.mjs";
import { actionAuthContractMatches } from "./learn-test-actions-acceptance.mjs";
import { readAcceptanceResponse } from "./learn-test-launch-acceptance.mjs";
import { readOperatorInputs, resolveOperatorInput } from "../../src/lib/learn-operator-inputs.ts";
import { readApprovedCommusoftPage } from "../../supabase/functions/_shared/commusoft/bound_page.ts";
import { createCommusoftPermitPorts } from "../../supabase/functions/_shared/commusoft/permit_server.ts";
import {
  committedCommusoftPage,
  persistCommusoftPage,
} from "../../supabase/functions/_shared/commusoft/page_store.ts";
import {
  createCommusoftPageHandler,
  runCommusoftWorker,
} from "../../supabase/functions/_shared/commusoft/worker.ts";
import {
  confirmCommusoftCustomer,
  loadCommusoftReviewPage,
} from "../../src/lib/learn-commusoft-review.ts";
import { loadWorkPage, resolveWorkDraft } from "../../src/lib/learn-commusoft-work.ts";
import { readLearnCards } from "../../src/lib/learn-cards.ts";
import { readCaptureCatalog } from "./learn-capture-health-catalog.mjs";
import { installedCapture, captureFingerprint } from "./learn-test-capture-health-release.mjs";
import { installedResume } from "./learn-test-commusoft-resume-release.mjs";
import { installedContacts } from "./learn-test-commusoft-contacts-release.mjs";
import {
  syntheticContactPage,
  acceptCapturedContacts,
} from "./learn-commusoft-contact-acceptance-flow.mjs";
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const check = (v, m) => {
  if (!v) throw Error(m);
};
const base = `https://${TEST_PROJECT}.supabase.co`;
export async function acceptCommusoftIngestion({
  allowProjectRef,
  token,
  fetcher = fetch,
  includeContacts = false,
  contactFixturePlan = null,
}) {
  check(allowProjectRef === TEST_PROJECT, "Explicit TEST project required");
  const planned = includeContacts ? contactFixtureIdentities(contactFixturePlan) : null;
  // Hard network allowlist: no code in this runner can send a real provider request.
  const network = async (url, options) => {
    const parsed = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    check(
      parsed.origin === base ||
        (parsed.origin === "https://api.supabase.com" &&
          (parsed.pathname === `/v1/projects/${TEST_PROJECT}` ||
            parsed.pathname.startsWith(`/v1/projects/${TEST_PROJECT}/`))),
      "Network destination outside TEST refused",
    );
    return fetcher(url, { ...options, redirect: "error" });
  };
  const readRuntime = includeContacts ? readCaptureCatalog : readOperatorInputsCatalog,
    installedRuntime = includeContacts
      ? (c) => installedCapture(c) || installedResume(c) || installedContacts(c)
      : installedOperatorInputs,
    runtimeFingerprint = includeContacts ? captureFingerprint : operatorInputFingerprint;
  const pre = await readRuntime({ allowProjectRef, token, fetcher: network });
  check(installedRuntime(pre), "Exact installed ingestion/review TEST contract required");
  const management = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  async function request(url, headers, method = "GET", body) {
    return readAcceptanceResponse(
      await network(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(45000),
      }),
    );
  }
  async function sql(query, readOnly = false) {
    const r = await request(
      `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
      management,
      "POST",
      { query, ...(readOnly ? {} : { read_only: false }) },
    );
    check(r.ok, `Synthetic ingestion SQL failed (HTTP ${r.status})`);
    return r.data;
  }
  const auth = await sql(AUTH_CONTRACT_QUERY, true);
  check(
    auth?.length === 1 && actionAuthContractMatches(auth[0].contract),
    "Auth fixture contract differs",
  );
  const infrastructure = (
    await sql(
      "select to_regclass('cron.job') is not null as has_cron,(select count(*)::int from platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')) as active_jobs",
      true,
    )
  )[0];
  check(
    infrastructure.has_cron === false && infrastructure.active_jobs === 0,
    "No cron or other active Commusoft work permitted",
  );
  const keys = await request(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    management,
  );
  check(keys.ok && Array.isArray(keys.data), "Existing TEST keys unavailable");
  const keyFor = (role) => {
    const rows = keys.data.filter((k) => k.name === role);
    check(rows.length === 1, "Unique TEST key required");
    const key = rows[0].api_key;
    const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    check(claims.ref === TEST_PROJECT && claims.role === role, "TEST key scope differs");
    return key;
  };
  const anon = keyFor("anon"),
    service = keyFor("service_role");
  const adminHeaders = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const admin = createClient(base, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: network },
  });
  const p =
    planned ??
    Object.fromEntries(
      ["runId", "tenant", "actor", "grant", "connection"].map((k) => [k, randomUUID()]),
    );
  Object.assign(p, {
    version: "learn-commusoft-ingestion-fixture/1",
    projectRef: TEST_PROJECT,
    includeContacts,
    requests: [],
    created: false,
    secret: null,
    sourceBefore: null,
  });
  p.email = planned?.email ?? `learn-ingestion-${p.runId}@example.invalid`;
  const dummy = `SYNTHETIC_NOT_A_PROVIDER_KEY_${randomBytes(32).toString("hex")}`;
  const fingerprint = createHash("sha256")
    .update("commusoft:" + dummy)
    .digest("hex");
  const secretName = `provider_secret:${p.tenant}:commusoft:api_key`;
  const manifest = `/private/tmp/serviceos-commusoft-${includeContacts ? "contacts" : "ingestion"}-${p.runId}.json`;
  const save = () => writeFileSync(manifest, JSON.stringify(p, null, 2) + "\n", { mode: 0o600 });
  // A fixed approved plan is single-use. Preserve any earlier run's recovery
  // record instead of overwriting it and attempting the same identities again.
  writeFileSync(manifest, JSON.stringify(p, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  const snapshot = async () => {
    const tables = [
      ...new Set([
        ...OPERATOR_PRESERVED_TABLES,
        "learn_business_input_request_permits",
        "learn_business_input_links",
        "learn_business_input_projection_batches",
        "learn_operator_input_requests",
        "tenants",
        "profiles",
        "platform_authority_grants",
        ...(includeContacts
          ? [
              "contact_points",
              "graph_nodes",
              "graph_edges",
              "graph_events",
              "learn_business_input_projection_attempts",
              "provider_connection_events",
              "learn_commusoft_connection_requests",
              "learn_commusoft_verification_requests",
              "learn_commusoft_verification_permits",
              "learn_commusoft_verification_results",
            ]
          : []),
      ]),
    ];
    const statements = tables.map((name) => {
      const filter =
        name === "learn_business_input_observations"
          ? `page_id not in (select id from public.learn_business_input_pages where tenant_id=${q(p.tenant)})`
          : name === "platform_authority_grants"
            ? `profile_id<>${q(p.actor)}`
            : name === "profiles"
              ? `id<>${q(p.actor)}`
              : name === "tenants"
                ? `id<>${q(p.tenant)}`
                : `(tenant_id is null or tenant_id<>${q(p.tenant)})`;
      return `select '${name}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.${name} s where ${filter}`;
    });
    statements.push(
      `select 'credential_gates' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_request_gates s where credential_fingerprint<>${q(fingerprint)}`,
    );
    statements.push(
      `select 'vault_metadata' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from (select * from vault.secrets where name is distinct from ${q(secretName)} and name is distinct from ${q("retired-synthetic:" + p.runId)}) s`,
    );
    return (await sql(statements.join(" union all "), true)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  };
  const checks = [];
  let stage = "setup",
    failure = null,
    cleanupErrors = [],
    summary = null,
    sourceAfter = null,
    owner,
    contactSummary = null;
  let providerReads = 0,
    lostCommit = false;
  const fixtureFetch = async (url, options) => {
    const u = new URL(String(url));
    check(
      u.origin === "https://app.commusoft.co.uk" &&
        options.method === "GET" &&
        options.redirect === "error",
      "Unexpected synthetic transport request",
    );
    check(
      new Headers(options.headers).get("x-api-key") === dummy,
      "Vault binding did not deliver the synthetic key",
    );
    check(u.searchParams.get("limit") === "1", "Page limit differed");
    let data,
      hasMore = false,
      nextCursor;
    if (
      providerReads === 0 &&
      u.pathname === "/api/v2/properties" &&
      !u.searchParams.has("after")
    ) {
      data = [
        {
          id: 101,
          type: "customer",
          contact: { firstName: "Alex", lastName: "Synthetic", email: "alex@example.invalid" },
          customerType: 45,
        },
      ];
      hasMore = true;
      nextCursor = 101;
    } else if (
      providerReads === 1 &&
      u.pathname === "/api/v2/properties" &&
      u.searchParams.get("after") === "101"
    ) {
      data = [
        {
          id: 201,
          type: "workaddress",
          parentPropertyID: 101,
          addressLine1: "1 Synthetic Road",
          postcode: "TEST 1AA",
        },
      ];
      nextCursor = 201;
    } else if (
      providerReads === 2 &&
      u.pathname === "/api/v2/jobs" &&
      !u.searchParams.has("after")
    ) {
      check(
        new Headers(options.headers).get("x-api-version") === "2.1",
        "Jobs API version differs",
      );
      data = [{ id: 301, propertyID: 201, description: "Synthetic captured job", status: "Open" }];
      nextCursor = 301;
    } else if (includeContacts && providerReads >= 3 && providerReads <= 6) {
      const envelope = syntheticContactPage(u, providerReads - 3);
      providerReads++;
      return Response.json(envelope);
    } else throw Error("Unexpected duplicate or unscoped synthetic provider read");
    providerReads++;
    return Response.json({ data, pagination: { hasMore, nextCursor }, synthetic: true });
  };
  const handler = createCommusoftPageHandler({
    recover: committedCommusoftPage,
    read: (ctx) => readApprovedCommusoftPage(ctx, createCommusoftPermitPorts(ctx, fixtureFetch)),
    persist: async (ctx, input) => {
      const receipt = await persistCommusoftPage(ctx, input);
      if (input.scope.request.resource === "jobs") {
        lostCommit = true;
        throw Error("Synthetic committed response lost");
      }
      return receipt;
    },
    clock: Date.now,
  });
  const makeRequest = (definition) => {
    const r = { tenantId: p.tenant, actorId: p.actor, requestId: randomUUID(), definition };
    p.requests.push(r);
    save();
    return r;
  };
  const setModules = async (enabled) => {
    const current = await readOperatorInputs(owner, p.tenant);
    return resolveOperatorInput(
      owner,
      makeRequest({
        kind: "set_modules",
        reason: "Synthetic ingestion acceptance",
        expected: current.flags,
        values: { "learn.enabled": true, "learn.inputs.commusoft.enabled": enabled },
      }),
      "apply",
    );
  };
  const approve = async (resource, max_pages, contact_type) => {
    const current = await readOperatorInputs(owner, p.tenant);
    check(
      current.connections.length === 1 && current.connections[0].credential_bound,
      "Fixture binding missing",
    );
    const r = makeRequest({
      kind: "start_commusoft",
      reason: "Synthetic provider response acceptance",
      connection_id: p.connection,
      revision: current.connections[0].revision,
      resource,
      ...(resource === "propertyContacts" ? { contact_type } : {}),
      max_pages,
      page_size: 1,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    const receipt = await resolveOperatorInput(owner, r, "apply");
    check(
      receipt.state === "recorded" && receipt.job_id && receipt.account_id,
      "Approval did not queue work",
    );
    check(
      JSON.stringify(receipt) === JSON.stringify(await resolveOperatorInput(owner, r, "apply")),
      "Approval replay changed work",
    );
    p.account = receipt.account_id;
    save();
    return { request: r, receipt };
  };
  const onlyJob = async (id) => {
    const rows = await sql(
      "select id::text,tenant_id::text from platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')",
      true,
    );
    check(
      rows.length === 1 && rows[0].id === id && rows[0].tenant_id === p.tenant,
      "Only planned fixture may be claimable",
    );
  };
  try {
    p.sourceBefore = await snapshot();
    save();
    const password = randomBytes(36).toString("base64url");
    const made = await request(`${base}/auth/v1/admin/users`, adminHeaders, "POST", {
      id: p.actor,
      email: p.email,
      password,
      email_confirm: true,
      app_metadata: { learn_ingestion_run: p.runId },
    });
    check(made.ok && made.data?.id === p.actor, "Synthetic Auth creation failed");
    p.created = true;
    save();
    const login = await request(
      `${base}/auth/v1/token?grant_type=password`,
      { apikey: anon, "Content-Type": "application/json" },
      "POST",
      { email: p.email, password },
    );
    check(login.ok && login.data?.user?.id === p.actor, "Synthetic sign-in failed");
    owner = createClient(base, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${login.data.access_token}` }, fetch: network },
    });
    await sql(
      `begin;insert into tenants(id,slug,display_name,status,metadata) values(${q(p.tenant)},${q("learn-ingestion-" + p.runId)},'SYNTHETIC ingestion acceptance','active',${q(JSON.stringify({ synthetic: true, learn_ingestion_run: p.runId }))});update profiles set tenant_id=${q(p.tenant)},role='owner' where id=${q(p.actor)} and email=${q(p.email)};insert into platform_authority_grants(id,profile_id,permission,granted_by,reason,source,effective_to) values(${q(p.grant)},${q(p.actor)},'platform.controlplane.admin',${q("synthetic:" + p.runId)},'Temporary synthetic ingestion acceptance','test',clock_timestamp()+interval '30 minutes');commit;`,
    );
    // A fake, never-provider-valid value exists only in TEST Vault and process memory.
    const created = await sql(
      `select vault.create_secret(${q(dummy)},${q(secretName)},${q("Synthetic ingestion fixture " + p.runId)},null)::text as id`,
    );
    check(
      created?.length === 1 && /^[a-f0-9-]{36}$/.test(created[0].id),
      "Synthetic Vault creation unconfirmed",
    );
    p.secret = created[0].id;
    save();
    await sql(
      `insert into provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,configured_fields,secret_refs,non_secret_config) values(${q(p.connection)},${q(p.tenant)},'commusoft','configured','private_api_key',clock_timestamp(),array['api_key'],${q(JSON.stringify({ api_key: p.secret }))},${q(JSON.stringify({ synthetic: true, learn_ingestion_run: p.runId, account_key: p.runId, region: "uk" }))});`,
    );
    await setModules(true);
    const properties = await approve("properties", 2);
    stage = "first page and continuation";
    await onlyJob(properties.receipt.job_id);
    const first = await runCommusoftWorker(admin, randomUUID(), handler);
    check(
      first.claimed === 1 &&
        first.outcomes[0].job_id === properties.receipt.job_id &&
        first.outcomes[0].status === "succeeded" &&
        first.outcomes[0].successor_id,
      "First page did not create one successor",
    );
    p.successor = first.outcomes[0].successor_id;
    save();
    const progress = await readOperatorInputs(owner, p.tenant);
    check(
      progress.accounts.length === 1 &&
        progress.accounts[0].checkpoint.pages === 1 &&
        progress.accounts[0].checkpoint.after === 101 &&
        progress.accounts[0].checkpoint.complete === false,
      "First page checkpoint differs",
    );
    checks.push(
      "Signed-in operator approval atomically creates one account/job and replays without duplication. Production worker code uses real Vault acquisition, scoped RPCs and an intercepted provider response to commit page one and queue its successor.",
    );
    stage = "interrupted committed page";
    // Wait only for this confirmed queued successor's scheduled availability.
    const next = (
      await sql(
        `select available_at from platform_jobs where id=${q(p.successor)} and tenant_id=${q(p.tenant)}`,
        true,
      )
    )[0];
    const wait = Math.max(0, Date.parse(next.available_at) - Date.now() + 25);
    check(wait < 5000, "Unexpected successor delay");
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    await onlyJob(p.successor);
    const claim = await admin.rpc("learn_commusoft_claim_jobs", { p_worker: randomUUID() });
    check(
      !claim.error && claim.data?.length === 1 && claim.data[0].id === p.successor,
      "Successor claim failed",
    );
    const job = claim.data[0],
      ctx = {
        supabaseAdmin: admin,
        tenantId: p.tenant,
        jobId: job.id,
        jobType: job.job_type,
        claim: { claimedBy: job.claimed_by, attemptCount: job.attempt_count },
      };
    const read = await readApprovedCommusoftPage(
      ctx,
      createCommusoftPermitPorts(ctx, fixtureFetch),
    );
    const saved = await persistCommusoftPage(ctx, read);
    check(
      saved.checkpoint.complete && saved.checkpoint.pages === 2,
      "Terminal page checkpoint differs",
    );
    await setModules(false);
    await sql(
      `update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${q(job.id)} and tenant_id=${q(p.tenant)} and claimed_by=${q(job.claimed_by)} and status='running';`,
    );
    await onlyJob(job.id);
    const guard = (
      await sql(
        `select (select count(*)::int from learn_business_input_pages where job_id=${q(job.id)} and tenant_id=${q(p.tenant)}) as pages,(select value from feature_flags where tenant_id=${q(p.tenant)} and flag='learn.inputs.commusoft.enabled') as enabled`,
        true,
      )
    )[0];
    check(
      guard.pages === 1 && guard.enabled === false,
      "Deployed recovery requires a saved page and disabled capture",
    );
    const recovered = await request(
      `${base}/functions/v1/learn-commusoft-worker`,
      { Authorization: `Bearer ${service}`, "x-serviceos-worker-key": service },
      "POST",
    );
    check(
      recovered.ok &&
        recovered.data?.result?.claimed === 1 &&
        recovered.data.result.outcomes[0].job_id === job.id &&
        recovered.data.result.outcomes[0].status === "succeeded" &&
        recovered.data.result.outcomes[0].successor_id === null,
      "Deployed recovery failed",
    );
    const recoveredJob = (
      await sql(
        `select status,attempt_count,result->>'stop_reason' as stop_reason from platform_jobs where id=${q(job.id)}`,
        true,
      )
    )[0];
    check(
      recoveredJob.status === "succeeded" &&
        recoveredJob.attempt_count === 2 &&
        recoveredJob.stop_reason === "collection_exhausted",
      "Recovered job state differs",
    );
    check(providerReads === 2, "Recovery performed an additional synthetic read");
    checks.push(
      "Page two commits, then its claim is deliberately expired before settlement. With capture disabled, the deployed worker reclaims it at attempt two and settles the saved page successfully without any new provider authority or successor.",
    );
    stage = "next collection and lost publication response";
    await setModules(true);
    const jobs = await approve("jobs", 1);
    check(
      jobs.receipt.account_id === properties.receipt.account_id,
      "Completed collection did not reuse the existing account",
    );
    const previous = (
      await sql(
        `select previous_state from learn_operator_input_requests where id=${q(jobs.request.requestId)}`,
        true,
      )
    )[0]?.previous_state;
    check(
      previous?.checkpoint?.complete === true &&
        previous.checkpoint.pages === 2 &&
        previous.approval.approvalId === properties.request.requestId,
      "Previous approval/checkpoint was not retained",
    );
    await onlyJob(jobs.receipt.job_id);
    const jobRun = await runCommusoftWorker(admin, randomUUID(), handler);
    check(
      lostCommit &&
        jobRun.claimed === 1 &&
        jobRun.outcomes[0].status === "succeeded" &&
        jobRun.outcomes[0].successor_id === null,
      "Lost publication acknowledgement was not settled from retained state",
    );
    check(providerReads === 3, "Unexpected source read count");
    checks.push(
      "A subsequent jobs collection reuses the account and retains the completed prior approval/checkpoint. Its publication reply is deliberately lost after commit; the real worker settles success from durable state without a repeat request.",
    );
    stage = "captured source to reviewed cards";
    const customers = await loadCommusoftReviewPage(owner, p.tenant, p.connection);
    check(
      customers.rows.length === 1 && customers.rows[0].version_id,
      "Captured customer missing from review",
    );
    const customer = await confirmCommusoftCustomer(owner, {
      tenant: p.tenant,
      version: customers.rows[0].version_id,
      kind: "person",
      target: null,
      reason: "Synthetic captured customer reviewed",
    });
    const memory = new Map(),
      store = {
        getItem: (k) => memory.get(k) ?? null,
        setItem: (k, v) => memory.set(k, v),
        removeItem: (k) => memory.delete(k),
      },
      lock = async (_key, work) => work();
    for (const kind of ["site", "job"]) {
      const rows = await loadWorkPage(owner, p.tenant, p.connection, kind);
      check(rows.rows.length === 1 && rows.rows[0].version_id, "Captured work source missing");
      const draft = {
        version: 1,
        scope: { backend: base, actorId: p.actor, tenantId: p.tenant },
        id: randomUUID(),
        connection: p.connection,
        kind,
        items: [{ version_id: rows.rows[0].version_id, target_id: null }],
        reason: "Synthetic captured relationship reviewed",
      };
      const result = await resolveWorkDraft(
        owner,
        store,
        lock,
        draft.scope,
        draft,
        "apply",
        () => true,
      );
      check(result.linked === 1 && result.held === 0, "Captured work projection failed");
    }
    const customerCards = await readLearnCards(owner, p.tenant, "customer"),
      jobCards = await readLearnCards(owner, p.tenant, "job");
    check(
      customerCards.cards.length === 1 &&
        customerCards.cards[0].id === customer.cardId &&
        jobCards.cards.length === 1,
      "Captured source did not reach cards",
    );
    checks.push(
      "The captured customer, work address and job pass the real signed-in review adapters and produce one customer card, one site and one job visible through the application card reader.",
    );
    if (includeContacts) {
      stage = "contact collections and signed-in review";
      for (const [contactType, maxPages] of [
        ["workaddress", 1],
        ["customer", 3],
      ]) {
        const approval = await approve("propertyContacts", maxPages, contactType);
        let expected = approval.receipt.job_id;
        for (let index = 0; index < maxPages; index++) {
          await onlyJob(expected);
          const timing = (
            await sql(
              `select j.available_at,g.next_allowed_at from platform_jobs j left join learn_business_input_request_gates g on g.credential_fingerprint=${q(fingerprint)} where j.id=${q(expected)}`,
              true,
            )
          )[0];
          const delay = Math.max(
            0,
            Date.parse(timing.available_at) - Date.now() + 25,
            Date.parse(timing.next_allowed_at ?? new Date().toISOString()) - Date.now() + 25,
          );
          check(delay < 5000, "Unexpected contact job/pacing delay");
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          const run = await runCommusoftWorker(admin, randomUUID(), handler);
          check(
            run.claimed === 1 &&
              run.outcomes[0].job_id === expected &&
              run.outcomes[0].status === "succeeded",
            "Captured contact page failed",
          );
          expected = run.outcomes[0].successor_id;
          check(
            index === maxPages - 1 ? expected === null : !!expected,
            "Contact page continuation differs",
          );
        }
      }
      check(providerReads === 7, "Unexpected contact provider read count");
      const anonymous = createClient(base, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: network },
      });
      const contactResult = await acceptCapturedContacts({
        owner,
        anonymous,
        tenant: p.tenant,
        actor: p.actor,
        connection: p.connection,
        customerId: customer.entityId,
        backend: base,
        sql,
        setModules,
      });
      checks.push(...contactResult.checks);
      contactSummary = contactResult.summary;
    }
    summary = (
      await sql(
        `select (select count(*)::int from learn_business_input_pages where tenant_id=${q(p.tenant)}) as pages,(select count(*)::int from learn_business_input_versions where tenant_id=${q(p.tenant)}) as versions,(select count(*)::int from learn_business_input_request_permits where tenant_id=${q(p.tenant)}) as permits,(select count(*)::int from platform_jobs where tenant_id=${q(p.tenant)} and status='succeeded') as succeeded_jobs,(select count(*)::int from platform_jobs where tenant_id=${q(p.tenant)} and status in ('queued','running','retrying')) as active_jobs,(select count(*)::int from customer_cards where tenant_id=${q(p.tenant)}) as customer_cards,(select count(*)::int from sites where tenant_id=${q(p.tenant)}) as sites,(select count(*)::int from jobs where tenant_id=${q(p.tenant)}) as jobs`,
        true,
      )
    )[0];
    check(
      summary.pages === (includeContacts ? 7 : 3) &&
        summary.versions === (includeContacts ? 7 : 3) &&
        summary.permits === (includeContacts ? 7 : 3) &&
        summary.succeeded_jobs === (includeContacts ? 7 : 3) &&
        summary.active_jobs === 0 &&
        summary.customer_cards === 1 &&
        summary.sites === 1 &&
        summary.jobs === 1,
      "Retained ingestion counts differ",
    );
    const after = await readRuntime({ allowProjectRef, token, fetcher: network });
    check(
      installedRuntime(after) && runtimeFingerprint(pre) === runtimeFingerprint(after),
      "Schema/runtime changed during acceptance",
    );
    stage = "passed";
  } catch (e) {
    failure = e instanceof Error ? e.message : "Ingestion acceptance failed";
  } finally {
    try {
      // End only this fixture's authority. Durable source/review/job evidence remains.
      await sql(
        `begin;update feature_flags set value='false' where tenant_id=${q(p.tenant)};update provider_connections set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()) where id=${q(p.connection)} and tenant_id=${q(p.tenant)};update tenant_connectors set enabled=false,status='disabled' where tenant_id=${q(p.tenant)} and connector_id='commusoft';update connector_accounts set status='disabled' where tenant_id=${q(p.tenant)};update platform_jobs set status='dead_letter',lease_expires_at=null,dead_lettered_at=clock_timestamp(),error_code='commusoft_synthetic_retired' where tenant_id=${q(p.tenant)} and job_type='commusoft.source_sync' and status in ('queued','running','retrying');update platform_authority_grants set effective_to=clock_timestamp() where id=${q(p.grant)} and profile_id=${q(p.actor)};update profiles set role='viewer' where id=${q(p.actor)};select vault.update_secret(id,null,${q("retired-synthetic:" + p.runId)},'Retired synthetic non-provider credential',null) from vault.secrets where name=${q(secretName)};commit;`,
      );
    } catch {
      cleanupErrors.push("Fixture authority retirement requires inspection");
    }
    try {
      const found = await request(`${base}/auth/v1/admin/users/${p.actor}`, adminHeaders);
      if (!(found.status === 404 && !p.created)) {
        check(
          found.ok && found.data?.app_metadata?.learn_ingestion_run === p.runId,
          "Fixture identity marker differs",
        );
        const retired = await request(
          `${base}/auth/v1/admin/users/${p.actor}`,
          adminHeaders,
          "PUT",
          { ban_duration: "876000h", password: randomBytes(48).toString("base64url") },
        );
        check(
          retired.ok && Date.parse(retired.data?.banned_until) > Date.now() + 86400000,
          "Fixture login retirement failed",
        );
        p.retired = true;
      }
    } catch {
      cleanupErrors.push("Fixture login retirement requires inspection");
    }
    try {
      sourceAfter = await snapshot();
      if (!p.sourceBefore || JSON.stringify(p.sourceBefore) !== JSON.stringify(sourceAfter))
        cleanupErrors.push("Pre-existing TEST record preservation unconfirmed");
      const retired = (
        await sql(
          `select (select count(*)::int from platform_jobs where tenant_id=${q(p.tenant)} and status in ('queued','running','retrying')) as active_jobs,(select count(*)::int from feature_flags where tenant_id=${q(p.tenant)} and value<>'false'::jsonb) as enabled_flags,(select count(*)::int from platform_authority_grants where profile_id=${q(p.actor)} and coalesce(effective_to,'infinity')>clock_timestamp()) as active_grants,(select count(*)::int from vault.secrets where name=${q(secretName)}) as active_secret_bindings`,
          true,
        )
      )[0];
      check(
        Object.values(retired).every((v) => v === 0),
        "Fixture authority still active",
      );
      p.retirement = retired;
    } catch {
      cleanupErrors.push("Final preservation/retirement read requires inspection");
    }
    Object.assign(p, {
      stage,
      failure,
      cleanupErrors,
      sourceAfter,
      summary,
      contactSummary,
      providerReads,
    });
    save();
  }
  return {
    version: includeContacts
      ? "learn-commusoft-contacts-test-acceptance/1"
      : "learn-commusoft-ingestion-test-acceptance/1",
    projectRef: TEST_PROJECT,
    runId: p.runId,
    observedAt: new Date().toISOString(),
    state: !failure && !cleanupErrors.length ? "passed" : "requires_inspection",
    stage,
    checks,
    failure,
    cleanupErrors,
    summary,
    contactSummary,
    sourceDataSets: sourceAfter?.length ?? null,
    syntheticProviderReads: providerReads,
    preExistingSourcesPreserved:
      !!p.sourceBefore &&
      !!sourceAfter &&
      JSON.stringify(p.sourceBefore) === JSON.stringify(sourceAfter),
    retiredLogin: p.retired === true,
    retirement: p.retirement,
    manifest,
    limitations: [
      "Provider responses are intercepted synthetic fixtures. This does not prove real Commusoft credentials, API coverage or provider behavior.",
      "Successful source reads run the production worker modules locally against hosted TEST Vault and RPCs. Deployed Edge execution is exercised only for committed-page recovery while capture is disabled.",
      "All synthetic history remains retained; login/grant/connection/account/switch authority is retired and the fake Vault binding renamed. No production changes or scheduler.",
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(
      process.argv.slice(2).join(" ") === "--run --existing-cli-login" &&
        process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
      "Explicit synthetic TEST acceptance required",
    );
    const r = await acceptCommusoftIngestion({
      allowProjectRef: TEST_PROJECT,
      token: savedCliToken(),
    });
    writeFileSync(
      ".verification-results/commusoft-ingestion-acceptance.json",
      JSON.stringify(r, null, 2) + "\n",
    );
    console.log(JSON.stringify(r, null, 2));
    if (r.state !== "passed") process.exitCode = 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
