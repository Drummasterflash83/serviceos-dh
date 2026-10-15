/** Focused hosted Auth/PostgREST check of the guarded TEST open-work matcher.
 * Creates only marked synthetic TEST data; retires its authority in finally.
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { loadWorkPage, OPEN_WORK_QUERY } from "../../src/lib/learn-commusoft-work.ts";

const tenant = randomUUID();
const run = randomUUID();
const actor = randomUUID();
const connector = randomUUID();
const connection = randomUUID();
const page = randomUUID();
const permit = randomUUID();
const job = randomUUID();
const email = `build01-open-work-${run}@example.invalid`;
const password = randomBytes(40).toString("base64url");
const base = `https://${TEST_PROJECT}.supabase.co`;
const management = `https://api.supabase.com/v1/projects/${TEST_PROJECT}`;
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const manifest = `.verification-results/learn-build01-test-open-work-${run}.json`;
const state = { version: "learn-build01-test-open-work-hosted/1", project: TEST_PROJECT,
  run, tenant, actor, connector, connection, page, fixtureCreated: false,
  actorCreated: false, authorityRetired: false, actorRetired: false,
  result: "started", steps: [], at: new Date().toISOString() };
function save() { writeFileSync(manifest, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 }); }
function check(value, label) { if (!value) throw Error(label); }
async function request(url, headers, method = "GET", body) {
  const response = await fetch(url, { method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error", signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}
async function main() {
  const args = process.argv.slice(2).join(" ");
  const browserHold = args === "--synthetic-test --existing-cli-login --operator-browser";
  check((args === "--synthetic-test --existing-cli-login" || browserHold) &&
    process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
    "Explicit TEST target and existing management login required");
  save();
  const mgmt = { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" };
  async function sql(query, readOnly = true) {
    const response = await request(`${management}/database/query${readOnly ? "/read-only" : ""}`,
      mgmt, "POST", { query, ...(readOnly ? {} : { read_only: false }) });
    check(response.ok && Array.isArray(response.data), `Scoped TEST SQL failed (HTTP ${response.status})`);
    return response.data;
  }
  const baseline = await sql(`select md5(pg_get_functiondef(
    'public.learn_commusoft_source_matches(jsonb,text,text,text)'::regprocedure)) matcher,
    (select count(*)::int from public.learn_business_input_versions where tenant_id=${q(tenant)}::uuid) fixture_versions`);
  check(baseline.length === 1 && baseline[0].matcher === "c19b0bd500f741aa48c838da2a5a669e" &&
    baseline[0].fixture_versions === 0, "Exact TEST matcher or fresh fixture boundary changed");
  const keys = await request(`${management}/api-keys?reveal=true`, mgmt);
  check(keys.ok && Array.isArray(keys.data), "Existing TEST API keys unavailable");
  function key(role) {
    const found = keys.data.filter((item) => item.name === role);
    check(found.length === 1 && typeof found[0].api_key === "string", "TEST key role differs");
    const value = found[0].api_key;
    const claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString());
    check(claims.ref === TEST_PROJECT && claims.role === role, "TEST key scope differs");
    return value;
  }
  const anon = key("anon"), service = key("service_role");
  const admin = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
  const publicHeaders = { apikey: anon, "Content-Type": "application/json" };
  let accessToken = null;
  try {
    const created = await request(`${base}/auth/v1/admin/users`, admin, "POST", {
      id: actor, email, password, email_confirm: true,
      app_metadata: { learn_build01_open_work_run: run },
    });
    check(created.ok && created.data?.id === actor, "Synthetic TEST Auth creation unconfirmed");
    state.actorCreated = true; save();
    const login = await request(`${base}/auth/v1/token?grant_type=password`,
      publicHeaders, "POST", { email, password });
    check(login.ok && login.data?.user?.id === actor &&
      typeof login.data?.access_token === "string", "Synthetic TEST sign-in unconfirmed");
    accessToken = login.data.access_token;
    state.steps.push("Fresh synthetic TEST Auth sign-in passed"); save();
    const versions = [
      { id: "910001", status: "Open", description: "Synthetic ongoing job" },
      { id: "910002", status: "on_hold", description: "Synthetic held job" },
      { id: "910003", status: "Complete", description: "Synthetic completed job" },
      { id: "910004", status: "pending", description: "Synthetic pending job" },
    ];
    const fingerprint = createHash("sha256").update(run).digest("hex");
    let seed = `begin;set local statement_timeout='20s';
      insert into public.tenants(id,slug,display_name,metadata) values(${q(tenant)}::uuid,
      ${q("build01-open-work-" + run)},'Synthetic open-work review',
      jsonb_build_object('synthetic',true,'learn_build01_open_work_run',${q(run)}));
      update public.profiles set tenant_id=${q(tenant)}::uuid,role='owner'
      where id=${q(actor)}::uuid and email=${q(email)} and exists(
        select 1 from auth.users where id=${q(actor)}::uuid
        and raw_app_meta_data->>'learn_build01_open_work_run'=${q(run)});
      insert into public.feature_flags(tenant_id,flag,value) values
      (${q(tenant)}::uuid,'learn.enabled','true'),
      (${q(tenant)}::uuid,'learn.inputs.commusoft.enabled','true');
      insert into public.tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled,settings)
      values(${q(connector)}::uuid,${q(tenant)}::uuid,'commusoft','commusoft','business_input',
      'active',true,jsonb_build_object('synthetic',true,'learn_build01_open_work_run',${q(run)}));
      insert into public.provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,non_secret_config)
      values(${q(connection)}::uuid,${q(tenant)}::uuid,'commusoft','configured','private_api_key',
      clock_timestamp(),jsonb_build_object('synthetic',true,'learn_build01_open_work_run',${q(run)},
      'account_key','Synthetic no-provider review','region','uk'));
      insert into public.learn_business_input_request_gates values(${q(fingerprint)},'infinity');
      insert into public.learn_business_input_request_permits(id,tenant_id,job_id,claimed_by,
      attempt_count,binding,credential_fingerprint) values(${q(permit)}::uuid,${q(tenant)}::uuid,
      ${q(job)}::uuid,'synthetic-open-work',1,'{}',${q(fingerprint)});
      insert into public.learn_business_input_pages(id,tenant_id,connection_id,provider,collection,
      job_id,permit_id,envelope,checkpoint_before,checkpoint_after,record_count)
      values(${q(page)}::uuid,${q(tenant)}::uuid,${q(connection)}::uuid,'commusoft','jobs',
      ${q(job)}::uuid,${q(permit)}::uuid,'{"synthetic":true}','{}','{}',4);`;
    versions.forEach((record, ordinal) => {
      const version = randomUUID();
      const payload = JSON.stringify({ ...record, propertyID: 999001 });
      seed += `insert into public.learn_business_input_versions(id,tenant_id,connection_id,
        provider,collection,external_id,content_hash,payload) values(${q(version)}::uuid,
        ${q(tenant)}::uuid,${q(connection)}::uuid,'commusoft','jobs',${q(record.id)},
        encode(sha256(convert_to((${q(payload)}::jsonb)::text,'UTF8')),'hex'),${q(payload)}::jsonb);
        insert into public.learn_business_input_observations values(${q(page)}::uuid,
        ${q(version)}::uuid,${ordinal});`;
    });
    await sql(seed + "commit;", false);
    state.fixtureCreated = true; state.steps.push("Four marked source versions retained only in TEST"); save();
    const db = createClient(base, anon, { global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const open = await loadWorkPage(db, tenant, connection, "job", null, OPEN_WORK_QUERY);
    check(JSON.stringify(open.rows.map((row) => row.external_id)) ===
      JSON.stringify(["910001", "910002", "910004"]) && open.next === null,
      "Signed-in TEST open-work filter returned the wrong source identities");
    const all = await loadWorkPage(db, tenant, connection, "job");
    check(JSON.stringify(all.rows.map((row) => row.external_id)) ===
      JSON.stringify(["910001", "910002", "910003", "910004"]),
      "Existing signed-in source page changed");
    const anonymous = await request(`${base}/rest/v1/rpc/learn_commusoft_work_review_search`,
      publicHeaders, "POST", { p_tenant: tenant, p_connection: connection, p_kind: "job",
        p_search: OPEN_WORK_QUERY, p_limit: 20 });
    check(!anonymous.ok && [401, 403].includes(anonymous.status),
      "Anonymous raw review unexpectedly allowed");
    const otherTenant = await request(`${base}/rest/v1/rpc/learn_commusoft_work_review_search`,
      { ...publicHeaders, Authorization: `Bearer ${accessToken}` }, "POST",
      { p_tenant: "00000000-0000-0000-0000-000000000001", p_connection: connection,
        p_kind: "job", p_search: OPEN_WORK_QUERY, p_limit: 20 });
    check(!otherTenant.ok && [401, 403].includes(otherTenant.status),
      "Cross-tenant review unexpectedly allowed");
    state.steps.push("Signed-in TEST adapter includes only open/on-hold/pending sources; ordinary page preserved; anonymous and cross-tenant reads denied");
    state.result = "hosted_filter_verified";
    if (browserHold) {
      state.browserReady = true; save();
      console.log(JSON.stringify({ state: "operator_browser_ready",
        project: TEST_PROJECT, tenantSlug: `build01-open-work-${run}`,
        expiresInSeconds: 180 }));
      await new Promise((resolve) => {
        const finish = () => { clearTimeout(timer); process.stdin.pause(); resolve(); };
        const timer = setTimeout(finish, 180000);
        process.stdin.once("data", finish);
      });
    }
  } catch (error) {
    state.result = "requires_inspection";
    state.failure = error instanceof Error ? error.message : "Unknown focused TEST failure";
  } finally {
    if (state.actorCreated) {
      try {
        const retired = await sql(`begin;
          update public.feature_flags set value='false' where tenant_id=${q(tenant)}::uuid;
          update public.tenant_connectors set enabled=false,status='disabled'
          where id=${q(connector)}::uuid and tenant_id=${q(tenant)}::uuid;
          update public.provider_connections set status='revoked',
            revoked_at=coalesce(revoked_at,clock_timestamp())
          where id=${q(connection)}::uuid and tenant_id=${q(tenant)}::uuid;
          update public.profiles set role='viewer' where id=${q(actor)}::uuid
          and tenant_id=${q(tenant)}::uuid;commit;
          select (select count(*)::int from public.feature_flags where tenant_id=${q(tenant)}::uuid and value='true') enabled_flags,
          (select count(*)::int from public.tenant_connectors where id=${q(connector)}::uuid and enabled) enabled_connectors,
          (select count(*)::int from public.provider_connections where id=${q(connection)}::uuid and status='configured') active_connections;`, false);
        check(retired.at(-1)?.enabled_flags === 0 && retired.at(-1)?.enabled_connectors === 0 &&
          retired.at(-1)?.active_connections === 0, "Synthetic fixture authority retirement unconfirmed");
        state.authorityRetired = true;
      } catch { state.cleanupFailure = "Synthetic TEST authority retirement requires inspection"; }
      try {
        const found = await request(`${base}/auth/v1/admin/users/${actor}`, admin);
        check(found.ok && found.data?.app_metadata?.learn_build01_open_work_run === run,
          "Synthetic TEST user marker differs");
        const banned = await request(`${base}/auth/v1/admin/users/${actor}`, admin, "PUT",
          { ban_duration: "876000h", password: randomBytes(48).toString("base64url") });
        check(banned.ok && Date.parse(banned.data?.banned_until) > Date.now() + 86400000,
          "Synthetic TEST login retirement unconfirmed");
        state.actorRetired = true;
      } catch { state.cleanupFailure = "Synthetic TEST login retirement requires inspection"; }
    }
    state.at = new Date().toISOString(); save();
  }
  console.log(JSON.stringify({ version: state.version, at: state.at, project: state.project,
    result: state.result, steps: state.steps, authorityRetired: state.authorityRetired,
    actorRetired: state.actorRetired, failure: state.failure ?? null,
    cleanupFailure: state.cleanupFailure ?? null, manifest }));
  if (state.result !== "hosted_filter_verified" || !state.authorityRetired || !state.actorRetired)
    process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
