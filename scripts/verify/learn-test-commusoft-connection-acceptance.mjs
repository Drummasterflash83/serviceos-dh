/** Real TEST Auth/PostgREST operator acceptance with isolated synthetic identities.
 * Only a never-provider-valid synthetic key is stored; provider reads are intercepted locally.
 * Deployed endpoint checks use check/cancel/settled replay only, never a fresh execution.
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { readConnectionSetupCatalog } from "./learn-commusoft-setup-catalog.mjs";
import { installedVerificationRuntime } from "./learn-test-commusoft-verification-runtime.mjs";
import { connectionFingerprint } from "./learn-test-commusoft-setup-release.mjs";
import { CONNECTION_PRESERVED_TABLES } from "./learn-test-commusoft-setup-hosted.mjs";
import { CONNECTION_TABLES } from "./learn-commusoft-setup-catalog.mjs";
import { resolveCommusoftSetup } from "../../src/lib/learn-commusoft-connection.ts";
import { resolveCommusoftVerification } from "../../src/lib/learn-commusoft-verification.ts";
import {
  resolveSavedConnection,
  readSavedConnection,
} from "../../src/lib/learn-commusoft-connection-outbox.ts";
import { verifyCommusoftConnection } from "../../supabase/functions/_shared/commusoft/verify_connection.ts";
import { AUTH_CONTRACT_QUERY } from "./learn-test-auth-contract.mjs";
import { actionAuthContractMatches } from "./learn-test-actions-acceptance.mjs";
import { readAcceptanceResponse } from "./learn-test-launch-acceptance.mjs";
import { readOperatorInputs } from "../../src/lib/learn-operator-inputs.ts";

const base = `https://${TEST_PROJECT}.supabase.co`;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const check = (v, message) => {
  if (!v) throw Error(message);
};
export async function acceptCommusoftConnection({ allowProjectRef, token, fetcher = fetch }) {
  check(allowProjectRef === TEST_PROJECT, "Explicit TEST project required");
  const pre = await readConnectionSetupCatalog({ allowProjectRef, token, fetcher });
  check(installedVerificationRuntime(pre), "Exact installed operator TEST schema required");
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
    version: "learn-commusoft-connection-fixture/1",
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
    email: `learn-connection-${plan.runId}-${n}@example.invalid`,
    created: false,
  }));
  const manifest = `/private/tmp/serviceos-learn-connection-${plan.runId}.json`;
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
  const fakeKey = "SYNTHETIC_NOT_A_PROVIDER_KEY_" + randomUUID();
  const fingerprint = createHash("sha256")
    .update("commusoft:" + fakeKey)
    .digest("hex");
  plan.credentialFingerprint = fingerprint;
  const secretName = "provider_secret:" + tenant + ":commusoft:api_key";
  plan.secretName = secretName;
  plan.retiredSecretName = "retired-synthetic:" + plan.runId;
  const snapshot = async () => {
    const tables = [
      ...CONNECTION_PRESERVED_TABLES,
      ...CONNECTION_TABLES.map((n) => "public." + n),
      "public.tenants",
      "public.view_as_context",
    ];
    const rows = await sql(
      tables
        .map((name) => {
          let filter = `(tenant_id is null or tenant_id not in (${ids}))`;
          if (name === "public.learn_business_input_observations")
            filter = `page_id not in (select id from public.learn_business_input_pages where tenant_id in (${ids}))`;
          if (name === "public.platform_authority_grants")
            filter = `profile_id not in (${profileIds})`;
          if (name === "public.tenants") filter = `id not in (${ids})`;
          if (name === "public.profiles") filter = `id not in (${profileIds})`;
          if (name === "public.authority_permissions") filter = "true";
          if (name === "public.learn_business_input_request_gates")
            filter = `credential_fingerprint<>${q(fingerprint)}`;
          if (name === "vault.secrets")
            filter = `name is null or name not in (${q(secretName)},${q(plan.retiredSecretName)})`;
          if (
            [
              "public.learn_commusoft_verification_permits",
              "public.learn_commusoft_verification_results",
            ].includes(name)
          )
            filter = `request_id not in (select id from public.learn_commusoft_verification_requests where tenant_id in (${ids}))`;
          return `select '${name}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${name} s where ${filter}`;
        })
        .join(" union all "),
      true,
    );
    check(
      rows.length === tables.length && new Set(rows.map((r) => r.name)).size === tables.length,
      "Incomplete source fingerprint",
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  };
  const draft = (definition, actor = users.admin.id, target = tenant) => {
    const r = { tenantId: target, actorId: actor, requestId: randomUUID(), definition };
    plan.requests.push(r);
    save();
    return r;
  };
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
        app_metadata: { learn_connection_acceptance_run: plan.runId },
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
      seed += `insert into tenants(id,slug,display_name,metadata) values(${q(t)},${q("learn-connection-" + plan.runId + "-" + n)},'SYNTHETIC Operator acceptance',${q(JSON.stringify({ synthetic: true, learn_connection_acceptance_run: plan.runId }))});`;
    for (const u of plan.users) {
      seed += `update profiles p set tenant_id=${q(u.tenant)},role=${q(u.role)} where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users a where a.id=p.id and a.raw_app_meta_data->>'learn_connection_acceptance_run'=${q(plan.runId)});`;
      if (u.permission)
        seed += `insert into platform_authority_grants(id,profile_id,permission,granted_by,reason,source) values(${q(u.grant)},${q(u.id)},${q("platform.controlplane." + u.permission)},${q("synthetic:" + plan.runId)},'Temporary synthetic acceptance','test');`;
    }
    seed += `insert into companies(id,tenant_id,name,metadata) values(${q(plan.company)},${q(tenant)},'SYNTHETIC tenant-only company','{"synthetic":true}');`;
    seed += "commit;";
    await sql(seed);
    plan.seeded = true;
    save();
    stage = "setup authority and deployed authentication";
    const setup = draft({
      kind: "configure_commusoft",
      reason: "Synthetic hosted connection acceptance",
      region: "uk",
      account_key: "Synthetic account " + plan.runId,
      expected_revision: null,
      credential_mode: "replace",
      same_account_confirmed: true,
    });
    for (const label of ["reader", "owner"])
      denied(
        await rpc(sessions[label], "learn_commusoft_configure", {
          ...argsFor({ ...setup, actorId: users[label].id }),
          p_api_key: fakeKey,
        }),
        "Unprivileged setup accepted",
      );
    denied(
      await rpc(sessions.admin, "learn_commusoft_configure", {
        ...argsFor({ ...setup, actorId: users.owner.id }),
        p_api_key: fakeKey,
      }),
      "Wrong setup actor accepted",
    );
    for (const jwt of [undefined, anon, service])
      denied(
        await request(`${base}/functions/v1/learn-commusoft-verify`, headers(jwt), "POST", {}),
        "Non-user execution accepted",
        [401],
      );
    const malformed = await request(
      `${base}/functions/v1/learn-commusoft-verify`,
      headers(sessions.admin),
      "POST",
      {},
    );
    check(
      malformed.status === 400 && malformed.data?.code === "verification_request_invalid",
      "Signed-in endpoint validation failed",
    );
    checks.push(
      "Deployed JWT/authentication boundary rejects anonymous and infrastructure tokens; signed-in malformed input is rejected. Viewer/client owner/wrong actor cannot configure connections.",
    );

    stage = "actual encrypted setup and lost-response recovery";
    const memory = new Map(),
      store = {
        getItem: (k) => memory.get(k) ?? null,
        setItem: (k, v) => memory.set(k, v),
        removeItem: (k) => memory.delete(k),
      };
    const scope = { backend: base, actorId: users.admin.id, tenantId: tenant },
      saved = { version: 1, backend: base, request: setup },
      lock = async (_k, fn) => fn();
    let applications = 0,
      lost = false;
    const loseReply = {
      rpc: async (name, args) => {
        const response = await clients.admin.rpc(name, args);
        if (args.p_mode === "apply") {
          applications++;
          check(
            !response.error && response.data?.state === "recorded",
            "Actual connection configuration failed",
          );
          plan.connection = response.data.connection_id;
          save();
          lost = true;
          throw Error("Synthetic lost setup reply");
        }
        return response;
      },
    };
    try {
      await resolveSavedConnection(
        loseReply,
        store,
        lock,
        scope,
        saved,
        "apply",
        () => true,
        fakeKey,
      );
    } catch {
      check(lost, "Setup failed before deliberate lost reply");
    }
    check(
      lost && readSavedConnection(store, scope)?.request.requestId === setup.requestId,
      "Setup request was not retained",
    );
    check(
      !JSON.stringify([...memory.values()]).includes(fakeKey),
      "Credential persisted in recovery storage",
    );
    const recovered = await resolveSavedConnection(
      loseReply,
      store,
      lock,
      scope,
      readSavedConnection(store, scope),
      "check",
      () => true,
    );
    check(
      recovered.receipt.state === "recorded" &&
        applications === 1 &&
        readSavedConnection(store, scope) === null,
      "Setup recovery resubmitted or lost work",
    );
    let revision = recovered.receipt.revision;
    const overview = await readOperatorInputs(clients.admin, tenant);
    check(
      overview.connections.length === 1 &&
        overview.connections[0].credential_bound === true &&
        overview.connections[0].verified_at === null &&
        Object.values(overview.flags).every((v) => v === null),
      "Setup enabled capture or reported verification",
    );
    for (const table of CONNECTION_TABLES)
      for (const jwt of [sessions.admin, sessions.owner, service])
        denied(
          await request(`${base}/rest/v1/${table}?select=*`, headers(jwt)),
          "Private request history exposed",
        );
    denied(
      await rpc(sessions.admin, "learn_commusoft_configure", {
        ...argsFor({ ...setup, tenantId: plan.tenants[1] }),
        p_api_key: fakeKey,
      }),
      "Cross-client setup replay accepted",
      [409],
    );
    denied(
      await rpc(sessions.secondAdmin, "learn_commusoft_configure", {
        ...argsFor({ ...setup, actorId: users.secondAdmin.id }),
        p_api_key: fakeKey,
      }),
      "Another operator setup replay accepted",
      [409],
    );
    checks.push(
      "Real signed-in setup stores an encrypted synthetic key and retains a receipt. The production outbox recovered a deliberately lost acknowledgement without retaining or resending the key. Private raw history and cross-client/operator replay are denied.",
    );

    const verification = () =>
      draft({
        kind: "verify_commusoft",
        reason: "Synthetic bounded access check",
        connection_id: plan.connection,
        revision,
        one_read_confirmed: true,
      });
    const edge = async (r, mode, jwt = sessions.admin) =>
      request(`${base}/functions/v1/learn-commusoft-verify`, headers(jwt), "POST", {
        request: r,
        mode,
      });
    stage = "deployed receipt and cancellation";
    const cancelled = verification();
    const pending = await edge(cancelled, "check");
    check(
      pending.ok && pending.data?.receipt?.state === "pending",
      "Deployed authenticated receipt read failed",
    );
    const mismatch = await edge({ ...cancelled, actorId: users.owner.id }, "check");
    check(
      mismatch.status === 403 && mismatch.data?.code === "actor_mismatch",
      "Deployed actor mismatch accepted",
    );
    const cancellation = await edge(cancelled, "cancel");
    check(
      cancellation.ok && cancellation.data?.receipt?.state === "cancelled",
      "Deployed cancellation failed",
    );
    const replay = await resolveCommusoftVerification(clients.admin, cancelled, "apply");
    check(replay.receipt.state === "cancelled", "Cancelled endpoint replay executed");
    checks.push(
      "The deployed endpoint reads pending receipts and records cancellation through real Auth/PostgREST. Actor mismatch is denied; cancelled apply replay stays cancelled without a provider permit.",
    );

    stage = "hosted verification approval and simulated provider success";
    const verify = verification();
    for (const label of ["reader", "owner"])
      denied(
        await rpc(
          sessions[label],
          "learn_commusoft_verify_request",
          argsFor({ ...verify, actorId: users[label].id }),
        ),
        "Unprivileged verification approval accepted",
      );
    const approved = await rpc(sessions.admin, "learn_commusoft_verify_request", argsFor(verify));
    check(approved.ok && approved.data?.state === "approved", "Real verification approval failed");
    const adminClient = createClient(base, service, {
      global: { fetch: fetcher },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    let providerReads = 0,
      finishLost = false;
    const execution = await verifyCommusoftConnection(tenant, verify.requestId, {
      rpc: async (name, args) => {
        const result = await adminClient.rpc(name, args);
        if (name === "learn_commusoft_verify_finish") {
          check(
            !result.error && result.data?.code === "access_verified",
            "Actual verification finish failed",
          );
          finishLost = true;
          throw Error("Synthetic lost final reply");
        }
        return result;
      },
      fetcher: async (url, options) => {
        check(
          String(url) === "https://app.commusoft.co.uk/api/v2/properties?limit=1" &&
            options.method === "GET" &&
            options.headers.Authorization === `Bearer ${fakeKey}`,
          "Bounded synthetic request differs",
        );
        providerReads++;
        return Response.json({
          data: [{ id: 91001, privateText: "SYNTHETIC_SOURCE_NOT_RETAINED" }],
          pagination: { hasMore: true, nextCursor: 91001 },
        });
      },
    });
    check(
      execution.state === "unconfirmed" && finishLost && providerReads === 1,
      "Expected lost verification result not exercised",
    );
    const final = await resolveCommusoftVerification(clients.admin, verify, "check");
    check(
      final.receipt.state === "recorded" &&
        final.receipt.code === "access_verified" &&
        final.receipt.verified_at !== null,
      "Verification result was not recovered",
    );
    revision = final.receipt.revision;
    const settled = await resolveCommusoftVerification(clients.admin, verify, "apply");
    check(
      settled.receipt.state === "recorded" && settled.receipt.code === "access_verified",
      "Deployed settled replay differed",
    );
    const duplicate = await adminClient.rpc("learn_commusoft_verify_acquire", {
      p_tenant: tenant,
      p_request: verify.requestId,
    });
    check(
      !duplicate.error && duplicate.data === null,
      "Settled request released a second credential",
    );
    checks.push(
      "A real operator approval and hosted encrypted Vault/service RPCs were exercised by the production executor with intercepted synthetic provider responses. Lost final acknowledgement recovered through authenticated receipt; deployed settled replay and duplicate acquisition cannot issue another read. No real Commusoft request was sent.",
    );

    stage = "stored key reuse and verification invalidation";
    const reuse = draft({
      ...setup.definition,
      expected_revision: revision,
      credential_mode: "reuse",
    });
    const reused = await resolveCommusoftSetup(clients.admin, reuse, "apply");
    check(
      reused.state === "recorded" && reused.verification === "required",
      "Hosted key reuse failed",
    );
    const afterReuse = await readOperatorInputs(clients.admin, tenant);
    check(
      afterReuse.connections[0].verified_at === null &&
        afterReuse.connections[0].credential_bound === true,
      "Reuse did not invalidate previous verification",
    );
    denied(
      await rpc(sessions.admin, "learn_commusoft_verify_request", argsFor(verification())),
      "Stale verification revision accepted",
      [409],
    );
    checks.push(
      "Stored-key reuse succeeds under actual hosted Vault permissions and clears previous verification. A stale revision cannot approve a new check.",
    );

    stage = "view-as and revoked access";
    await sql(
      `insert into view_as_context(id,tenant_id,actor_user_id,subject_kind,subject_ref,reason) values(${q(plan.viewAs)},${q(tenant)},${q(users.admin.id)},'role','viewer','Synthetic connection preview denial');`,
    );
    denied(
      await rpc(sessions.admin, "learn_commusoft_configure", argsFor(setup, "check")),
      "View As receipt accepted",
    );
    await sql(
      `update view_as_context set ended_at=clock_timestamp() where id=${q(plan.viewAs)};update platform_authority_grants set effective_to=clock_timestamp() where id=${q(users.admin.grant)};`,
    );
    denied(
      await rpc(sessions.admin, "learn_commusoft_verify_request", argsFor(verify, "check")),
      "Revoked grant retained verification receipt access",
    );
    checks.push(
      "View As and administrator revocation immediately deny retained-request access using the existing signed-in JWT.",
    );
    summary = (
      await sql(
        `select
      (select count(*)::int from learn_commusoft_connection_requests where tenant_id in (${ids})) as setup_requests,
      (select count(*)::int from learn_commusoft_verification_requests where tenant_id in (${ids})) as verification_requests,
      (select count(*)::int from learn_commusoft_verification_permits where request_id in (select id from learn_commusoft_verification_requests where tenant_id in (${ids}))) as permits,
      (select count(*)::int from learn_commusoft_verification_results where request_id in (select id from learn_commusoft_verification_requests where tenant_id in (${ids}))) as results,
      (select count(*)::int from platform_jobs where tenant_id in (${ids})) as jobs,
      (select count(*)::int from connector_accounts where tenant_id in (${ids})) as accounts,
      (select count(*)::int from learn_business_input_pages where tenant_id in (${ids})) as source_pages`,
        true,
      )
    )[0];
    check(
      summary.setup_requests === 2 &&
        summary.verification_requests === 2 &&
        summary.permits === 1 &&
        summary.results === 2 &&
        summary.jobs === 0 &&
        summary.accounts === 0 &&
        summary.source_pages === 0,
      "Unexpected retained work or source payload",
    );

    const afterCatalog = await readConnectionSetupCatalog({ allowProjectRef, token, fetcher });
    check(
      installedVerificationRuntime(afterCatalog) &&
        connectionFingerprint(pre) === connectionFingerprint(afterCatalog),
      "Acceptance changed schema or runtime contracts",
    );
    stage = "passed";
  } catch (e) {
    failure = e instanceof Error ? e.message : "Operator acceptance failed";
  } finally {
    try {
      await sql(
        `begin;select vault.update_secret(id,new_name:=${q(plan.retiredSecretName)}) from vault.secrets where name=${q(secretName)};update feature_flags set value='false' where tenant_id in (${ids});update provider_connections set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()) where id=${q(plan.connection)} and tenant_id=${q(tenant)};update platform_authority_grants set effective_to=clock_timestamp() where profile_id in (${profileIds}) and source='test';update view_as_context set ended_at=coalesce(ended_at,clock_timestamp()) where id=${q(plan.viewAs)};update profiles set role='viewer' where id in (${profileIds});commit;`,
      );
    } catch {
      cleanupErrors.push("Fixture authority retirement requires inspection");
    }
    for (const u of plan.users) {
      try {
        const found = await request(`${base}/auth/v1/admin/users/${u.id}`, adminHeaders);
        if (found.status === 404 && !u.created) continue;
        check(
          found.ok && found.data?.app_metadata?.learn_connection_acceptance_run === plan.runId,
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
    version: "learn-commusoft-connection-test-acceptance/1",
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
      "Only a synthetic never-provider-valid key was stored. No actual provider traffic, import, job or production change.",
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
    const report = await acceptCommusoftConnection({
      allowProjectRef: TEST_PROJECT,
      token: savedCliToken(),
    });
    writeFileSync(
      ".verification-results/commusoft-connection-hosted-acceptance.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
    if (report.state !== "passed") process.exitCode = 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
