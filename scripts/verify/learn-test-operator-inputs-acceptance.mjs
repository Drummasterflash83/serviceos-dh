/** Real TEST Auth/PostgREST operator acceptance with isolated synthetic identities.
 * No provider key, provider call, worker invocation or schedule is created.
 */
import { randomUUID, randomBytes } from "node:crypto";
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
import { readSavedInput, resolveSavedInput } from "../../src/lib/learn-operator-input-outbox.ts";

const base = `https://${TEST_PROJECT}.supabase.co`;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const check = (v, message) => {
  if (!v) throw Error(message);
};
export async function acceptOperatorInputs({ allowProjectRef, token, fetcher = fetch }) {
  check(allowProjectRef === TEST_PROJECT, "Explicit TEST project required");
  const pre = await readOperatorInputsCatalog({ allowProjectRef, token, fetcher });
  check(installedOperatorInputs(pre), "Exact installed operator TEST schema required");
  async function request(url, headers, method = "GET", body) {
    return readAcceptanceResponse(
      await fetcher(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      }),
    );
  }
  const management = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  async function sql(query, readOnly = false) {
    const r = await request(
      `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
      management,
      "POST",
      { query, ...(readOnly ? {} : { read_only: false }) },
    );
    check(r.ok, `Synthetic operator SQL failed (HTTP ${r.status})`);
    return r.data;
  }
  const auth = await sql(AUTH_CONTRACT_QUERY, true);
  check(
    auth?.length === 1 && actionAuthContractMatches(auth[0].contract),
    "Auth fixture contract differs",
  );
  const keys = await request(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    management,
  );
  check(keys.ok && Array.isArray(keys.data), "Existing TEST keys unavailable");
  function keyFor(role) {
    const rows = keys.data.filter((k) => k.name === role);
    check(rows.length === 1 && typeof rows[0].api_key === "string", "Unique TEST key required");
    const key = rows[0].api_key;
    const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    check(claims.ref === TEST_PROJECT && claims.role === role, "TEST credential scope differs");
    return key;
  }
  const anon = keyFor("anon"),
    service = keyFor("service_role");
  const headers = (jwt) => ({
    apikey: anon,
    "Content-Type": "application/json",
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
  });
  const adminHeaders = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const plan = {
    version: "learn-operator-inputs-fixture/1",
    projectRef: TEST_PROJECT,
    runId: randomUUID(),
    tenants: [randomUUID(), randomUUID()],
    users: [],
    company: randomUUID(),
    connection: randomUUID(),
    missingSecret: randomUUID(),
    viewAs: randomUUID(),
    requests: [],
    seeded: false,
  };
  plan.users = [
    ["admin", 1, "viewer", "admin"],
    ["reader", 1, "viewer", "view"],
    ["owner", 0, "owner", null],
    ["secondAdmin", 1, "viewer", "admin"],
  ].map(([label, t, role, permission], n) => ({
    id: randomUUID(),
    label,
    tenant: plan.tenants[t],
    role,
    permission,
    grant: randomUUID(),
    email: `learn-inputs-${plan.runId}-${n}@example.invalid`,
    created: false,
  }));
  const manifest = `/private/tmp/serviceos-learn-operator-inputs-${plan.runId}.json`;
  const save = () => writeFileSync(manifest, JSON.stringify(plan, null, 2) + "\n", { mode: 0o600 });
  save();
  const tenant = plan.tenants[0],
    users = Object.fromEntries(plan.users.map((u) => [u.label, u]));
  const sessions = {},
    clients = {},
    checks = [],
    cleanupErrors = [];
  let sourceBefore = null,
    sourceAfter = null,
    summary = null,
    failure = null,
    stage = "setup";
  const rpc = (jwt, name, args) =>
    request(`${base}/rest/v1/rpc/${name}`, headers(jwt), "POST", args);
  const argsFor = (r, mode = "apply") => ({
    p_tenant: r.tenantId,
    p_actor: r.actorId,
    p_request: r.requestId,
    p_definition: r.definition,
    p_mode: mode,
  });
  const denied = (r, label, codes = [401, 403]) =>
    check(!r.ok && codes.includes(r.status), `${label} (HTTP ${r.status})`);
  const ids = plan.tenants.map(q).join(","),
    profileIds = plan.users.map((u) => q(u.id)).join(",");
  const snapshot = async () => {
    const tables = [
      ...OPERATOR_PRESERVED_TABLES,
      "tenants",
      "profiles",
      "view_as_context",
      "platform_authority_grants",
      "learn_operator_input_requests",
    ];
    return (
      await sql(
        tables
          .map((name) => {
            const filter =
              name === "learn_business_input_observations"
                ? `page_id not in (select id from public.learn_business_input_pages where tenant_id in (${ids}))`
                : name === "platform_authority_grants"
                  ? `profile_id not in (${profileIds})`
                  : name === "tenants"
                    ? `id not in (${ids})`
                    : name === "profiles"
                      ? `id not in (${profileIds})`
                      : `(tenant_id is null or tenant_id not in (${ids}))`;
            return `select '${name}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.${name} s where ${filter}`;
          })
          .join(" union all "),
        true,
      )
    ).sort((a, b) => a.name.localeCompare(b.name));
  };
  const draft = (definition, actor = users.admin.id, target = tenant) => {
    const r = { tenantId: target, actorId: actor, requestId: randomUUID(), definition };
    plan.requests.push(r);
    save();
    return r;
  };
  const flagValues = (learn, commusoft) => ({
    "learn.enabled": learn,
    "learn.inputs.commusoft.enabled": commusoft,
  });
  const modules = (expected, values) => ({
    kind: "set_modules",
    reason: "Synthetic operator acceptance",
    expected,
    values,
  });
  try {
    sourceBefore = await snapshot();
    plan.sourceBefore = sourceBefore;
    save();
    for (const u of plan.users) {
      const password = randomBytes(36).toString("base64url");
      const made = await request(`${base}/auth/v1/admin/users`, adminHeaders, "POST", {
        id: u.id,
        email: u.email,
        password,
        email_confirm: true,
        app_metadata: { learn_operator_inputs_run: plan.runId },
      });
      check(made.ok && made.data?.id === u.id, "Synthetic Auth creation failed");
      u.created = true;
      save();
      const login = await request(`${base}/auth/v1/token?grant_type=password`, headers(), "POST", {
        email: u.email,
        password,
      });
      check(login.ok && login.data?.user?.id === u.id, "Synthetic sign-in failed");
      sessions[u.label] = login.data.access_token;
      clients[u.label] = createClient(base, anon, {
        global: { headers: { Authorization: `Bearer ${login.data.access_token}` }, fetch: fetcher },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }
    let seed = "begin;set local statement_timeout='15s';";
    for (const [n, t] of plan.tenants.entries())
      seed += `insert into tenants(id,slug,display_name,metadata) values(${q(t)},${q("learn-inputs-" + plan.runId + "-" + n)},'SYNTHETIC Operator acceptance',${q(JSON.stringify({ synthetic: true, learn_operator_inputs_run: plan.runId }))});`;
    for (const u of plan.users) {
      seed += `update profiles p set tenant_id=${q(u.tenant)},role=${q(u.role)} where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users a where a.id=p.id and a.raw_app_meta_data->>'learn_operator_inputs_run'=${q(plan.runId)});`;
      if (u.permission)
        seed += `insert into platform_authority_grants(id,profile_id,permission,granted_by,reason,source) values(${q(u.grant)},${q(u.id)},${q("platform.controlplane." + u.permission)},${q("synthetic:" + plan.runId)},'Temporary synthetic acceptance','test');`;
    }
    seed += `insert into companies(id,tenant_id,name,metadata) values(${q(plan.company)},${q(tenant)},'SYNTHETIC tenant-only company','{"synthetic":true}');`;
    seed += `insert into provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,configured_fields,secret_refs,non_secret_config) values(${q(plan.connection)},${q(tenant)},'commusoft','configured','private_api_key',clock_timestamp(),array['api_key'],${q(JSON.stringify({ api_key: plan.missingSecret }))},${q(JSON.stringify({ synthetic: true, learn_operator_inputs_run: plan.runId, account_key: "Synthetic input authority", region: "uk" }))});commit;`;
    await sql(seed);
    plan.seeded = true;
    save();
    stage = "platform access boundaries";
    for (const jwt of [undefined, service, sessions.owner])
      denied(
        await rpc(jwt, "learn_operator_inputs", { p_tenant: tenant }),
        "Unprivileged operator read accepted",
      );
    const overview = await readOperatorInputs(clients.admin, tenant);
    const reader = await readOperatorInputs(clients.reader, tenant);
    check(
      JSON.stringify(overview.flags) === JSON.stringify(reader.flags) &&
        Object.values(overview.flags).every((v) => v === null),
      "Initial flags must remain unknown",
    );
    check(
      overview.connections.length === 1 && overview.connections[0].credential_bound === false,
      "Missing binding was not reported accurately",
    );
    check(
      !JSON.stringify(overview).includes(plan.missingSecret),
      "Secret reference exposed in control metadata",
    );
    const ownerCompany = await request(
      `${base}/rest/v1/companies?id=eq.${plan.company}&select=id`,
      headers(sessions.owner),
    );
    const adminCompany = await request(
      `${base}/rest/v1/companies?id=eq.${plan.company}&select=id`,
      headers(sessions.admin),
    );
    check(
      ownerCompany.ok &&
        ownerCompany.data.length === 1 &&
        adminCompany.ok &&
        adminCompany.data.length === 0,
      "Platform authority broadened tenant data access",
    );
    for (const jwt of [sessions.admin, sessions.reader, sessions.owner, service])
      denied(
        await request(`${base}/rest/v1/learn_operator_input_requests?select=id`, headers(jwt)),
        "Raw request history readable",
      );
    const enable = draft(modules(flagValues(null, null), flagValues(true, true)));
    for (const label of ["reader", "owner"])
      denied(
        await rpc(
          sessions[label],
          "learn_operator_input_request",
          argsFor({ ...enable, actorId: users[label].id }),
        ),
        "Unprivileged operator write accepted",
      );
    denied(
      await rpc(
        sessions.admin,
        "learn_operator_input_request",
        argsFor({ ...enable, actorId: users.owner.id }),
      ),
      "Wrong expected actor accepted",
    );
    checks.push(
      "Real platform admin/view grants authorize cross-client control metadata without widening tenant-data access; client owner, anonymous and service sessions cannot use operator RPCs; private request history remains inaccessible.",
    );

    stage = "recorded change and lost-response recovery";
    const memory = new Map();
    const store = {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => memory.set(k, v),
      removeItem: (k) => memory.delete(k),
    };
    const scope = { backend: base, actorId: users.admin.id, tenantId: tenant };
    const saved = { version: 1, backend: base, request: enable };
    const lock = async (_key, operation) => operation();
    let applications = 0,
      lost = false;
    const loseReply = {
      rpc: async (name, args) => {
        const response = await clients.admin.rpc(name, args);
        if (args.p_mode === "apply") {
          applications++;
          check(
            !response.error && response.data?.state === "recorded",
            "Actual module change failed",
          );
          lost = true;
          throw Error("Synthetic lost reply");
        }
        return response;
      },
    };
    try {
      await resolveSavedInput(loseReply, store, lock, scope, saved, "apply", () => true);
    } catch (e) {
      check(
        lost && e.message === "Synthetic lost reply",
        "Failure was not the deliberate lost acknowledgement",
      );
    }
    check(
      lost && readSavedInput(store, scope)?.request.requestId === enable.requestId,
      "Uncertain request was not retained",
    );
    const recovered = await resolveSavedInput(
      loseReply,
      store,
      lock,
      scope,
      readSavedInput(store, scope),
      "check",
      () => true,
    );
    check(
      recovered.state === "recorded" && applications === 1 && readSavedInput(store, scope) === null,
      "Receipt recovery resubmitted or lost work",
    );
    check(
      (await resolveOperatorInput(clients.admin, enable, "apply")).state === "recorded",
      "Exact replay failed",
    );
    denied(
      await rpc(
        sessions.admin,
        "learn_operator_input_request",
        argsFor({ ...enable, definition: { ...enable.definition, reason: "Changed" } }),
      ),
      "Changed definition accepted",
      [409],
    );
    denied(
      await rpc(
        sessions.admin,
        "learn_operator_input_request",
        argsFor({ ...enable, tenantId: plan.tenants[1] }),
      ),
      "Cross-client receipt accepted",
      [409],
    );
    denied(
      await rpc(
        sessions.secondAdmin,
        "learn_operator_input_request",
        argsFor({ ...enable, actorId: users.secondAdmin.id }),
      ),
      "Another operator's receipt accepted",
      [409],
    );
    const stale = draft(enable.definition);
    denied(
      await rpc(sessions.admin, "learn_operator_input_request", argsFor(stale)),
      "Stale module state accepted",
      [409],
    );
    checks.push(
      "Actual module save with simulated lost acknowledgement recovers through the application outbox using only a receipt read. Exact replay is stable; changed definition, tenant, actor and stale settings are rejected.",
    );

    stage = "cancellation and missing credential";
    const start = draft({
      kind: "start_commusoft",
      reason: "Synthetic no-provider approval",
      connection_id: plan.connection,
      revision: overview.connections[0].revision,
      resource: "properties",
      max_pages: 1,
      page_size: 1,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    const missing = await sql(
      `select count(*)::int as count from vault.secrets where id=${q(plan.missingSecret)}`,
      true,
    );
    check(missing?.[0]?.count === 0, "Fixture secret reference unexpectedly exists");
    const refused = await rpc(sessions.admin, "learn_operator_input_request", argsFor(start));
    check(
      !refused.ok &&
        refused.data?.code === "55000" &&
        refused.data?.message === "learn_operator_credential_missing",
      "Missing binding failed for unexpected reason",
    );
    check(
      (await resolveOperatorInput(clients.admin, start, "check")).state === "pending",
      "Rejected approval retained a receipt",
    );
    const cancelled = await resolveOperatorInput(clients.admin, start, "cancel");
    check(
      cancelled.state === "cancelled" &&
        (await resolveOperatorInput(clients.admin, start, "apply")).state === "cancelled",
      "Late apply bypassed cancellation",
    );
    const disable = draft(modules(flagValues(true, true), flagValues(true, false)));
    check(
      (await resolveOperatorInput(clients.admin, disable, "apply")).state === "recorded",
      "Module disable failed",
    );
    check(
      (await resolveOperatorInput(clients.admin, enable, "check")).state === "recorded",
      "Disabled module hid prior receipt",
    );
    const disabledStart = draft(start.definition);
    const disabledReply = await rpc(
      sessions.admin,
      "learn_operator_input_request",
      argsFor(disabledStart),
    );
    check(
      !disabledReply.ok && disabledReply.data?.message === "learn_operator_module_disabled",
      "Disabled module allowed new approval",
    );
    check(
      (await resolveOperatorInput(clients.admin, disabledStart, "cancel")).state === "cancelled",
      "Disabled module cancellation failed",
    );
    checks.push(
      "A nonexistent Vault binding prevents an approval without creating work. Cancellation fences delayed apply; disabling Commusoft stops new approval while retaining receipt access and cancellation.",
    );

    stage = "preview and immediate grant revocation";
    await sql(
      `insert into view_as_context(id,tenant_id,actor_user_id,subject_kind,subject_ref,reason) values(${q(plan.viewAs)},${q(tenant)},${q(users.admin.id)},'role','viewer','Synthetic operator preview denial');`,
    );
    denied(
      await rpc(sessions.admin, "learn_operator_inputs", { p_tenant: tenant }),
      "View As retained operator read",
    );
    denied(
      await rpc(sessions.admin, "learn_operator_input_request", argsFor(enable, "check")),
      "View As retained receipt access",
    );
    await sql(
      `update view_as_context set ended_at=clock_timestamp() where id=${q(plan.viewAs)};update platform_authority_grants set effective_to=clock_timestamp() where id=${q(users.admin.grant)};`,
    );
    denied(
      await rpc(sessions.admin, "learn_operator_inputs", { p_tenant: tenant }),
      "Revoked grant retained read access",
    );
    denied(
      await rpc(sessions.admin, "learn_operator_input_request", argsFor(enable, "check")),
      "Revoked grant retained receipt access",
    );
    await sql(
      `update platform_authority_grants set effective_from=clock_timestamp()+interval '1 hour',effective_to=null where id=${q(users.admin.grant)};`,
    );
    denied(
      await rpc(sessions.admin, "learn_operator_inputs", { p_tenant: tenant }),
      "Future grant accepted before effective time",
    );
    checks.push(
      "View As blocks operator reads and receipt access. Revocation and future-effective grants are enforced immediately against the existing signed-in JWT.",
    );
    summary = (
      await sql(
        `select (select count(*)::int from learn_operator_input_requests where tenant_id in (${ids})) as requests,(select count(*)::int from platform_jobs where tenant_id in (${ids})) as jobs,(select count(*)::int from connector_accounts where tenant_id in (${ids})) as accounts,(select count(*)::int from learn_business_input_pages where tenant_id in (${ids})) as source_pages`,
        true,
      )
    )[0];
    check(
      summary.requests === 4 &&
        summary.jobs === 0 &&
        summary.accounts === 0 &&
        summary.source_pages === 0,
      "Fixture retained unexpected requests or work",
    );
    const afterCatalog = await readOperatorInputsCatalog({ allowProjectRef, token, fetcher });
    check(
      installedOperatorInputs(afterCatalog) &&
        operatorInputFingerprint(pre) === operatorInputFingerprint(afterCatalog),
      "Acceptance changed schema or runtime contracts",
    );
    stage = "passed";
  } catch (e) {
    failure = e instanceof Error ? e.message : "Operator acceptance failed";
  } finally {
    try {
      await sql(
        `begin;update feature_flags set value='false' where tenant_id in (${ids});update provider_connections set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()) where id=${q(plan.connection)} and tenant_id=${q(tenant)};update platform_authority_grants set effective_to=clock_timestamp() where profile_id in (${profileIds}) and source='test';update view_as_context set ended_at=coalesce(ended_at,clock_timestamp()) where id=${q(plan.viewAs)};update profiles set role='viewer' where id in (${profileIds});commit;`,
      );
    } catch {
      cleanupErrors.push("Fixture authority retirement requires inspection");
    }
    for (const u of plan.users) {
      try {
        const found = await request(`${base}/auth/v1/admin/users/${u.id}`, adminHeaders);
        if (found.status === 404 && !u.created) continue;
        check(
          found.ok && found.data?.app_metadata?.learn_operator_inputs_run === plan.runId,
          "Fixture identity marker differs",
        );
        const retired = await request(`${base}/auth/v1/admin/users/${u.id}`, adminHeaders, "PUT", {
          ban_duration: "876000h",
          password: randomBytes(48).toString("base64url"),
        });
        check(
          retired.ok && Date.parse(retired.data?.banned_until) > Date.now() + 86400000,
          "Fixture ban not verified",
        );
        u.retired = true;
      } catch {
        cleanupErrors.push("Fixture login retirement requires inspection");
      }
    }
    try {
      sourceAfter = await snapshot();
      if (sourceBefore && JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter))
        cleanupErrors.push("Pre-existing TEST records changed");
      const retired = (
        await sql(
          `select (select count(*)::int from platform_authority_grants where profile_id in (${profileIds}) and coalesce(effective_to,'infinity')>clock_timestamp()) as grants,(select count(*)::int from feature_flags where tenant_id in (${ids}) and value<>'false'::jsonb) as enabled_flags,(select count(*)::int from provider_connections where id=${q(plan.connection)} and (revoked_at is null or status<>'revoked')) as active_connections`,
          true,
        )
      )[0];
      check(
        retired?.grants === 0 && retired?.enabled_flags === 0 && retired?.active_connections === 0,
        "Fixture retirement state differs",
      );
      plan.retirement = retired;
    } catch {
      cleanupErrors.push("Final preservation or retirement check requires inspection");
    }
    Object.assign(plan, { stage, failure, cleanupErrors, sourceAfter, retained: summary });
    save();
  }
  return {
    version: "learn-operator-inputs-test-acceptance/1",
    projectRef: TEST_PROJECT,
    runId: plan.runId,
    observedAt: new Date().toISOString(),
    state: !failure && !cleanupErrors.length ? "passed" : "requires_inspection",
    stage,
    checks,
    failure,
    cleanupErrors,
    retained: summary,
    retiredLogins: plan.users.filter((u) => u.retired).length,
    preExistingSourcesPreserved:
      !!sourceBefore &&
      !!sourceAfter &&
      JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter),
    retirement: plan.retirement,
    manifest,
    limitations: [
      "Synthetic identities and records only; original records preserved and synthetic histories retained.",
      "No provider credential, provider call, successful import approval, worker job or production change.",
      "Real Auth/PostgREST and application adapters/outbox exercised; browser rendering was verified separately.",
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
    const report = await acceptOperatorInputs({
      allowProjectRef: TEST_PROJECT,
      token: savedCliToken(),
    });
    writeFileSync(
      ".verification-results/operator-inputs-hosted-acceptance.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
    if (report.state !== "passed") process.exitCode = 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
