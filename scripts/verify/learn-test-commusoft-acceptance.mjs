/** Real Auth/PostgREST acceptance of retained-input review, with synthetic TEST records only.
 * Does not test API transport or create a provider key, worker job or schedule.
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { readCommusoftCatalog } from "./learn-commusoft-catalog.mjs";
import { installedCommusoft } from "./learn-test-commusoft-release.mjs";
import { installedCommusoftWorker } from "./learn-test-commusoft-runtime.mjs";
import { AUTH_CONTRACT_QUERY } from "./learn-test-auth-contract.mjs";
import { actionAuthContractMatches } from "./learn-test-actions-acceptance.mjs";
import { readAcceptanceResponse } from "./learn-test-launch-acceptance.mjs";
import {
  loadCommusoftReviewConnections,
  loadCommusoftReviewPage,
  findCommusoftCustomers,
  confirmCommusoftCustomer,
} from "../../src/lib/learn-commusoft-review.ts";
import {
  loadWorkPage,
  resolveWorkDraft,
  readWorkDraft,
} from "../../src/lib/learn-commusoft-work.ts";
import { readLearnCards } from "../../src/lib/learn-cards.ts";
const base = `https://${TEST_PROJECT}.supabase.co`,
  q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const check = (v, s) => {
  if (!v) throw Error(s);
};
export async function acceptCommusoft({ allowProjectRef, token, fetcher = fetch }) {
  const pre = await readCommusoftCatalog({ allowProjectRef, token, fetcher });
  check(
    installedCommusoft(pre) || installedCommusoftWorker(pre),
    "Exact installed Commusoft TEST schema and supported endpoint catalog required",
  );
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
    check(r.ok, `Synthetic review SQL failed (HTTP ${r.status})`);
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
    check(rows.length === 1, "Unique TEST key required");
    const key = rows[0].api_key,
      claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    check(claims.ref === TEST_PROJECT && claims.role === role, "TEST credential scope differs");
    return key;
  }
  const anon = keyFor("anon"),
    service = keyFor("service_role"),
    headers = (jwt) => ({
      apikey: anon,
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    }),
    admin = {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    };
  const plan = {
    version: "learn-commusoft-acceptance-fixture/1",
    projectRef: TEST_PROJECT,
    runId: randomUUID(),
    tenants: [randomUUID(), randomUUID()],
    users: [],
    connection: randomUUID(),
    connector: randomUUID(),
    person: randomUUID(),
    card: randomUUID(),
    versions: {},
    batches: [],
    seeded: false,
  };
  plan.users = [
    ["owner", 0],
    ["viewer", 0],
    ["owner", 1],
  ].map(([role, t], n) => ({
    id: randomUUID(),
    tenant: plan.tenants[t],
    role,
    email: `learn-commusoft-${plan.runId}-${n}@example.invalid`,
    created: false,
  }));
  const tenant = plan.tenants[0],
    manifest = `/private/tmp/serviceos-learn-commusoft-${plan.runId}.json`,
    save = () => writeFileSync(manifest, JSON.stringify(plan, null, 2) + "\n", { mode: 0o600 });
  save();
  const checks = [],
    cleanupErrors = [],
    sessions = [],
    clients = [];
  let failure = null,
    stage = "setup",
    sourceBefore = null,
    sourceAfter = null,
    summary = null;
  const rpc = (jwt, name, args) =>
    request(`${base}/rest/v1/rpc/${name}`, headers(jwt), "POST", args);
  const sourceTables = [
    "email_messages",
    "phone_calls",
    "phone_recordings",
    "phone_transcripts",
    "slack_messages",
    "slack_message_versions",
    "interactions",
    "people",
    "companies",
    "customer_cards",
    "sites",
    "jobs",
    "provider_connections",
    "tenant_connectors",
    "connector_accounts",
    "platform_jobs",
  ];
  const snapshot = async () =>
    (
      await sql(
        sourceTables
          .map(
            (t) =>
              `select '${t}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from public.${t} s where tenant_id not in (${plan.tenants.map(q).join(",")})`,
          )
          .join(" union all "),
        true,
      )
    ).sort((a, b) => a.name.localeCompare(b.name));
  const denied = (r, label) =>
    check(!r.ok && [401, 403].includes(r.status), label + ` (HTTP ${r.status})`);
  async function seedPage(collection, records) {
    const page = randomUUID(),
      permit = randomUUID(),
      job = randomUUID(),
      fingerprint = createHash("sha256")
        .update(plan.runId + page)
        .digest("hex");
    let text = `begin;set local statement_timeout='15s';insert into learn_business_input_request_gates values(${q(fingerprint)},'infinity');insert into learn_business_input_request_permits(id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint) values(${q(permit)},${q(tenant)},${q(job)},'synthetic-review-fixture',1,'{}',${q(fingerprint)});insert into learn_business_input_pages(id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,checkpoint_before,checkpoint_after,record_count) values(${q(page)},${q(tenant)},${q(plan.connection)},'commusoft',${q(collection)},${q(job)},${q(permit)},${q(JSON.stringify({ data: records, pagination: { hasMore: false, nextCursor: records.at(-1).id }, synthetic: true }))}::jsonb,'{}','{}',${records.length});`;
    records.forEach((record, n) => {
      const version = randomUUID();
      plan.versions[collection + ":" + record.id] = version;
      const payload = JSON.stringify(record);
      text += `insert into learn_business_input_versions(id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload) values(${q(version)},${q(tenant)},${q(plan.connection)},'commusoft',${q(collection)},${q(record.id)},encode(sha256(convert_to((${q(payload)}::jsonb)::text,'UTF8')),'hex'),${q(payload)}::jsonb);insert into learn_business_input_observations values(${q(page)},${q(version)},${n});`;
    });
    save();
    await sql(text + "commit;");
  }
  const version = (collection, id) => plan.versions[collection + ":" + id];
  const batch = (kind, ids) => {
    const d = {
      version: 1,
      scope: { backend: base, actorId: plan.users[0].id, tenantId: tenant },
      id: randomUUID(),
      connection: plan.connection,
      kind,
      items: ids.map((id) => ({
        version_id: version(kind === "job" ? "jobs" : "properties", id),
        target_id: null,
      })),
      reason: "Synthetic reviewed customer relationships",
    };
    plan.batches.push(d.id);
    save();
    return d;
  };
  const batchArgs = (d) => ({
    p_tenant: tenant,
    p_request: d.id,
    p_connection: d.connection,
    p_kind: d.kind,
    p_items: d.items,
    p_reason: d.reason,
    p_expected_actor: d.scope.actorId,
  });
  try {
    sourceBefore = await snapshot();
    plan.sourceBefore = sourceBefore;
    save();
    for (const u of plan.users) {
      const password = randomBytes(36).toString("base64url");
      const made = await request(`${base}/auth/v1/admin/users`, admin, "POST", {
        id: u.id,
        email: u.email,
        password,
        email_confirm: true,
        app_metadata: { learn_commusoft_run: plan.runId },
      });
      check(made.ok && made.data?.id === u.id, "Synthetic Auth creation failed");
      u.created = true;
      save();
      const login = await request(`${base}/auth/v1/token?grant_type=password`, headers(), "POST", {
        email: u.email,
        password,
      });
      check(login.ok && login.data?.user?.id === u.id, "Synthetic sign-in failed");
      sessions.push(login.data.access_token);
      clients.push(
        createClient(base, anon, {
          global: {
            headers: { Authorization: `Bearer ${login.data.access_token}` },
            fetch: fetcher,
          },
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        }),
      );
    }
    let seed = "begin;";
    for (const [n, t] of plan.tenants.entries())
      seed += `insert into tenants(id,slug,display_name,metadata) values(${q(t)},${q("learn-commusoft-" + plan.runId + "-" + n)},'SYNTHETIC Commusoft review',${q(JSON.stringify({ synthetic: true, learn_commusoft_run: plan.runId }))});`;
    for (const u of plan.users)
      seed += `update profiles p set tenant_id=${q(u.tenant)},role=${q(u.role)} where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users a where a.id=p.id and a.raw_app_meta_data->>'learn_commusoft_run'=${q(plan.runId)});`;
    seed += `insert into feature_flags(tenant_id,flag,value) values(${q(tenant)},'learn.enabled','true'),(${q(tenant)},'learn.inputs.commusoft.enabled','true');insert into tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled,settings) values(${q(plan.connector)},${q(tenant)},'commusoft','commusoft','business_input','active',true,${q(JSON.stringify({ synthetic: true, learn_commusoft_run: plan.runId }))});insert into provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,non_secret_config) values(${q(plan.connection)},${q(tenant)},'commusoft','configured','private_api_key',clock_timestamp(),${q(JSON.stringify({ synthetic: true, learn_commusoft_run: plan.runId, account_key: "Synthetic retained source review", region: "uk" }))});insert into people(id,tenant_id,display_name,primary_email,verified,created_source) values(${q(plan.person)},${q(tenant)},'Alex Synthetic','alex@example.invalid',true,'interaction');insert into customer_cards(id,tenant_id,person_id,title,summary) values(${q(plan.card)},${q(tenant)},${q(plan.person)},'Existing synthetic card','Keep this reviewed summary');commit;`;
    await sql(seed);
    plan.seeded = true;
    save();
    const retainedBefore = await sql(
      `select to_jsonb(p) as person,to_jsonb(c) as card from people p join customer_cards c on c.person_id=p.id where p.id=${q(plan.person)} and c.id=${q(plan.card)}`,
      true,
    );
    await seedPage("properties", [
      {
        id: 101,
        type: "customer",
        contact: { firstName: "Alex", lastName: "Synthetic", email: "alex@example.invalid" },
        customerType: 45,
      },
      {
        id: 102,
        type: "customer",
        companyName: "Synthetic Example Company",
        contact: { firstName: "Sam", lastName: "Contact" },
        customerType: 99,
      },
      {
        id: 201,
        type: "workaddress",
        parentPropertyID: 101,
        addressLine1: "1 Synthetic Road",
        postcode: "TEST 1AA",
      },
    ]);
    await seedPage("jobs", [
      { id: 301, propertyID: 201, description: "Synthetic site job", status: "Open" },
      { id: 302, propertyID: 999, description: "Synthetic unresolved job", status: "Open" },
      {
        id: 303,
        propertyID: 102,
        description: "Synthetic company job",
        status: "Complete",
        completed: { completedOnDateTime: "2026-10-01T10:00:00Z" },
      },
      { id: 304, propertyID: 101, description: "Synthetic cancellation candidate", status: "Open" },
    ]);
    stage = "access boundaries";
    for (const jwt of [undefined, service, sessions[1], sessions[2]])
      denied(
        await rpc(jwt, "learn_commusoft_review_connections", { p_tenant: tenant }),
        "Unauthorized source review accepted",
      );
    for (const table of [
      "learn_business_input_versions",
      "learn_business_input_pages",
      "learn_business_input_links",
      "learn_business_input_projection_batches",
    ])
      denied(
        await request(`${base}/rest/v1/${table}?select=*&limit=1`, headers(sessions[0])),
        "Direct raw history read accepted",
      );
    const available = await loadCommusoftReviewConnections(clients[0], tenant);
    check(available.length === 1 && available[0].id === plan.connection, "Connection list differs");
    checks.push(
      "Real owner session sees only its configured fixture connection; anonymous, service, viewer and foreign-company review denied; raw source/history access denied.",
    );
    stage = "customer review";
    const page = await loadCommusoftReviewPage(clients[0], tenant, plan.connection);
    check(page.rows.length === 2, "Customer source page differs");
    const matches = await findCommusoftCustomers(
      clients[0],
      tenant,
      version("properties", 101),
      "person",
      "",
    );
    check(
      matches.rows.some((r) => r.id === plan.person && r.reason === "shared_email"),
      "Existing customer candidate not found",
    );
    const person = {
      tenant,
      version: version("properties", 101),
      kind: "person",
      target: plan.person,
      reason: "Synthetic existing identity reviewed",
    };
    const linked = await confirmCommusoftCustomer(clients[0], person);
    check(
      linked.cardId === plan.card && linked.entityId === plan.person,
      "Existing card not reused",
    );
    check(
      (await confirmCommusoftCustomer(clients[0], person)).already,
      "Customer replay not acknowledged",
    );
    await confirmCommusoftCustomer(clients[0], {
      tenant,
      version: version("properties", 102),
      kind: "company",
      target: null,
      reason: "Synthetic company identity reviewed",
    });
    const retainedAfter = await sql(
      `select to_jsonb(p) as person,to_jsonb(c) as card from people p join customer_cards c on c.person_id=p.id where p.id=${q(plan.person)} and c.id=${q(plan.card)}`,
      true,
    );
    check(
      JSON.stringify(retainedAfter) === JSON.stringify(retainedBefore),
      "Existing customer/card changed",
    );
    checks.push(
      "Actual client adapters list sources and candidates, reuse the existing person/card unchanged, create the reviewed company/card and acknowledge exact customer replay.",
    );
    stage = "work relationships";
    const early = batch("job", [301]);
    const held = await rpc(sessions[0], "learn_commusoft_work_batch", batchArgs(early));
    check(
      held.ok && held.data.linked === 0 && held.data.held === 1,
      "Unreviewed site job was not held",
    );
    const sites = await loadWorkPage(clients[0], tenant, plan.connection, "site");
    check(
      sites.rows.length === 1 && sites.rows[0].customer_name === "Alex Synthetic",
      "Site ownership summary differs",
    );
    const siteBatch = batch("site", [201]);
    const siteResult = await rpc(sessions[0], "learn_commusoft_work_batch", batchArgs(siteBatch));
    check(siteResult.ok && siteResult.data.linked === 1, "Reviewed site projection failed");
    const draft = batch("job", [301, 302, 303]);
    const values = new Map(),
      store = {
        getItem: (k) => values.get(k) ?? null,
        setItem: (k, v) => values.set(k, v),
        removeItem: (k) => values.delete(k),
      },
      lock = async (_key, work) => work();
    let writes = 0;
    const lostReply = {
      rpc: async (name, args) => {
        const result = await clients[0].rpc(name, args);
        if (name === "learn_commusoft_work_batch") {
          writes++;
          check(!result.error, "Batch write failed before simulated lost response");
          throw Error("Synthetic lost acknowledgement");
        }
        return result;
      },
    };
    let lost = false;
    try {
      await resolveWorkDraft(lostReply, store, lock, draft.scope, draft, "apply", () => true);
    } catch {
      lost = true;
    }
    check(
      lost && readWorkDraft(store, draft.scope)?.id === draft.id,
      "Uncertain batch draft not retained",
    );
    const recovered = await resolveWorkDraft(
      clients[0],
      store,
      lock,
      draft.scope,
      draft,
      "check",
      () => true,
    );
    check(
      writes === 1 &&
        recovered?.linked === 2 &&
        recovered.held === 1 &&
        readWorkDraft(store, draft.scope) === null,
      "Real saved receipt recovery differs",
    );
    const replay = await rpc(sessions[0], "learn_commusoft_work_batch", batchArgs(draft));
    check(
      replay.ok &&
        JSON.stringify(replay.data) ===
          JSON.stringify(
            await clients[0]
              .rpc("learn_commusoft_work_batch_result", { p_tenant: tenant, p_request: draft.id })
              .then((r) => r.data),
          ),
      "Exact batch replay differs",
    );
    checks.push(
      "A job waits for its reviewed site; site projection resolves its customer. Mixed job batch links two records and holds one. Lost-response simulation recovers the actual stored receipt without another write.",
    );
    stage = "cards and isolation";
    const ownerCards = await readLearnCards(clients[0], tenant, "customer"),
      viewerCards = await readLearnCards(clients[1], tenant, "customer"),
      foreignCards = await readLearnCards(clients[2], tenant, "customer");
    check(
      ownerCards.cards.length === 2 &&
        JSON.stringify(ownerCards) === JSON.stringify(viewerCards) &&
        foreignCards.cards.length === 0,
      "Customer card RLS differs",
    );
    const jobs = await readLearnCards(clients[0], tenant, "job");
    check(jobs.cards.length === 2, "Linked jobs missing from LEARN cards");
    const deniedBatch = batch("job", [304]);
    for (const jwt of [sessions[1], sessions[2]])
      denied(
        await rpc(jwt, "learn_commusoft_work_batch", batchArgs(deniedBatch)),
        "Unauthorized batch accepted",
      );
    denied(
      await rpc(sessions[0], "learn_commusoft_work_batch", {
        ...batchArgs(deniedBatch),
        p_expected_actor: plan.users[1].id,
      }),
      "Changed actor accepted",
    );
    checks.push(
      "Real card loaders show customer and job records; viewers can read customer cards but cannot project work; other-company sessions cannot read these customer cards or approve batches.",
    );
    stage = "disabled recovery and cancellation";
    await sql(
      `update feature_flags set value='false' where tenant_id=${q(tenant)} and flag='learn.inputs.commusoft.enabled';`,
    );
    const saved = await rpc(sessions[0], "learn_commusoft_work_batch_result", {
      p_tenant: tenant,
      p_request: draft.id,
    });
    check(saved.ok && saved.data.linked === 2, "Disabled module hid saved result");
    denied(
      await rpc(sessions[0], "learn_commusoft_work_batch", batchArgs(deniedBatch)),
      "Disabled module permitted projection",
    );
    const cancelled = await rpc(sessions[0], "learn_commusoft_work_batch", {
      ...batchArgs(deniedBatch),
      p_cancel: true,
    });
    check(
      cancelled.ok && cancelled.data.state === "cancelled",
      "Disabled module cancellation failed",
    );
    const late = await rpc(sessions[0], "learn_commusoft_work_batch", batchArgs(deniedBatch));
    check(late.ok && late.data.state === "cancelled", "Late request escaped cancellation");
    await sql(`update profiles set role='viewer' where id=${q(plan.users[0].id)};`);
    denied(
      await rpc(sessions[0], "learn_commusoft_work_batch_result", {
        p_tenant: tenant,
        p_request: draft.id,
      }),
      "Demoted owner retained review authority",
    );
    summary = (
      await sql(
        `select (select count(*)::int from sites where tenant_id=${q(tenant)}) as sites,(select count(*)::int from jobs where tenant_id=${q(tenant)}) as jobs,(select count(*)::int from customer_cards where tenant_id=${q(tenant)}) as cards,(select count(*)::int from learn_business_input_links where tenant_id=${q(tenant)}) as links,(select count(*)::int from learn_business_input_projection_batches where tenant_id=${q(tenant)}) as batches,(select count(*)::int from platform_jobs where tenant_id=${q(tenant)}) as worker_jobs`,
        true,
      )
    )[0];
    check(
      summary.sites === 1 &&
        summary.jobs === 2 &&
        summary.cards === 2 &&
        summary.links === 5 &&
        summary.batches === 4 &&
        summary.worker_jobs === 0,
      "Retained canonical/batch counts differ",
    );
    checks.push(
      "Module disable stops new projection but retains receipt reads and cancellation. Late apply returns cancellation. Demotion immediately denies receipt access; no worker job was created.",
    );
    stage = "passed";
  } catch (e) {
    failure = e instanceof Error ? e.message : "Commusoft acceptance failed";
  } finally {
    try {
      sourceAfter = await snapshot();
      if (sourceBefore && JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter))
        cleanupErrors.push("Pre-existing TEST records changed");
    } catch {
      cleanupErrors.push("Preservation read requires inspection");
    }
    try {
      await sql(
        `begin;update feature_flags set value='false' where tenant_id in (${plan.tenants.map(q).join(",")});update tenant_connectors set enabled=false,status='disabled' where id=${q(plan.connector)} and tenant_id=${q(tenant)};update provider_connections set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()) where id=${q(plan.connection)} and tenant_id=${q(tenant)};update profiles set role='viewer' where id in (${plan.users.map((u) => q(u.id)).join(",")});commit;`,
      );
    } catch {
      cleanupErrors.push("Fixture authority retirement requires inspection");
    }
    for (const u of plan.users) {
      try {
        const found = await request(`${base}/auth/v1/admin/users/${u.id}`, admin);
        if (found.status === 404 && !u.created) continue;
        check(
          found.ok && found.data?.app_metadata?.learn_commusoft_run === plan.runId,
          "Fixture identity marker differs",
        );
        const retired = await request(`${base}/auth/v1/admin/users/${u.id}`, admin, "PUT", {
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
    plan.stage = stage;
    plan.failure = failure;
    plan.cleanupErrors = cleanupErrors;
    plan.retained = summary;
    plan.sourceAfter = sourceAfter;
    save();
  }
  return {
    version: "learn-commusoft-test-acceptance/1",
    projectRef: TEST_PROJECT,
    runId: plan.runId,
    observedAt: new Date().toISOString(),
    state: !failure && !cleanupErrors.length ? "passed" : "requires_inspection",
    stage,
    checks,
    failure,
    cleanupErrors,
    retained: summary,
    preExistingSourcesPreserved:
      !!sourceBefore &&
      !!sourceAfter &&
      JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter),
    retiredLogins: plan.users.filter((u) => u.retired).length,
    manifest,
    limitations: [
      "Synthetic retained pages are seeded through management SQL, not obtained from Commusoft or the ingestion worker.",
      "Real Auth, PostgREST, client adapters and database review paths are exercised; browser recovery is separately verified.",
      "Synthetic records/history remain retained; logins are banned/passwords rotated, roles demoted and fixture switches/connections disabled.",
      "No real provider credentials, provider requests, worker jobs or production changes.",
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(
      process.argv.slice(2).join(" ") === "--run --existing-cli-login" &&
        process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
      "Explicit TEST synthetic acceptance required",
    );
    const result = await acceptCommusoft({ allowProjectRef: TEST_PROJECT, token: savedCliToken() });
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== "passed") process.exitCode = 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
