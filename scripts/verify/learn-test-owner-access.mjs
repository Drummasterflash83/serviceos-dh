/** Prepare read-only. Apply only after approval of this exact saved access plan.
 * Existing Chris TEST identity only; no password is generated or disclosed.
 * No automatic retries: uncertain Auth, grant or email outcomes require inspection.
 */
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, lstatSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { AUTH_CONTRACT_QUERY } from "./learn-test-auth-contract.mjs";
import { currentCommusoftAuthContractMatches } from "./learn-commusoft-current-auth-contract.mjs";
export const OWNER = Object.freeze({
  email: "chris@openfolk.ai",
  user: "08929d74-42e4-471a-982e-5b8ac812cbf1",
  priorTenant: "23665e71-465d-4548-b608-b81d80e95778",
  tenant: "f8c114fa-fee7-4983-8970-f6e7f5fd3129",
  origin: "0be31171-a302-4840-80fd-f433726a7300",
  tenantOrigin: "ef5a92ff-b2de-4dbf-ba21-1c2e0a3f7c6d",
  redirect: "https://serviceos-learn-test-allkin.vercel.app/login?reset=1",
});
const version = "learn-test-owner-access/1",
  file = ".verification-results/learn-test-owner-access-session.json";
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const need = (ok, code) => {
  if (!ok) throw Error(code);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uuid = (v) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export function newOwnerPlan() {
  return {
    version,
    project: TEST_PROJECT,
    ...OWNER,
    runId: randomUUID(),
    grant: randomUUID(),
    audit: randomUUID(),
    state: "prepared",
    createdAt: new Date().toISOString(),
    permission: "platform.controlplane.admin",
    expiresAt: null,
    tenantRole: "viewer",
    recoveryEmails: 1,
  };
}
export function validateOwnerPlan(p) {
  need(
    p?.version === version &&
      p.project === TEST_PROJECT &&
      Object.entries(OWNER).every(([k, v]) => p[k] === v) &&
      ["runId", "grant", "audit"].every((k) => uuid(p[k])) &&
      new Set([p.runId, p.grant, p.audit, p.user, p.tenant, p.priorTenant]).size === 6 &&
      p.permission === "platform.controlplane.admin" &&
      p.expiresAt === null &&
      p.tenantRole === "viewer" &&
      p.recoveryEmails === 1,
    "owner_scope_differs",
  );
}
export function ownerPreservationSql(p, tables) {
  validateOwnerPlan(p);
  need(
    Array.isArray(tables) &&
      tables.length > 0 &&
      new Set(tables).size === tables.length &&
      tables.every((t) => /^(public|storage|vault)\.[a-z][a-z0-9_]*$/.test(t)),
    "snapshot_tables_invalid",
  );
  return tables
    .map((name) => {
      const filter =
        name === "public.platform_authority_grants"
          ? `id<>${q(p.grant)}`
          : name === "public.controlplane_change_log"
            ? `id<>${q(p.audit)}`
            : "true";
      const row = "to_jsonb(s)";
      return `select '${name}' as name,count(*)::int as count,md5(coalesce(string_agg(md5((${row})::text),'' order by md5((${row})::text)),'')) as fingerprint from ${name} s where ${filter}`;
    })
    .join(" union all ");
}
export function ownerGrantSql(p) {
  validateOwnerPlan(p);
  return `begin;set local statement_timeout='15s';set local lock_timeout='5s';
 do $$begin
  if not exists(select 1 from auth.users where id=${q(p.user)} and email=${q(p.email)} and coalesce(banned_until,'-infinity')<=now() and raw_app_meta_data->>'learn_hosted_operator_session'=${q(p.origin)}) then raise exception 'Owner Auth differs';end if;
  if not exists(select 1 from public.profiles where id=${q(p.user)} and email=${q(p.email)} and tenant_id=${q(p.priorTenant)} and role='viewer') then raise exception 'Owner profile differs';end if;
  if not exists(select 1 from public.tenants where id=${q(p.tenant)} and status='active' and metadata->>'learn_real_commusoft_session'=${q(p.tenantOrigin)}) then raise exception 'Drummonds TEST differs';end if;
  if exists(select 1 from public.platform_authority_grants where id=${q(p.grant)} or (profile_id=${q(p.user)} and coalesce(effective_from,'-infinity')<=now() and coalesce(effective_to,'infinity')>now())) then raise exception 'Owner grant differs';end if;
 end $$;
 insert into public.platform_authority_grants(id,profile_id,permission,effective_from,effective_to,granted_by,reason,source)
 values(${q(p.grant)},${q(p.user)},'platform.controlplane.admin',clock_timestamp(),null,${q("owner-approved:" + p.runId)},'Chris ongoing TEST operator access; no production authority','approved-test-owner');
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,before,after,reason,correlation_id,source)
 values(${q(p.audit)},null,${q("owner-approved:" + p.email)},'test.owner_access.activate','profile',${q(p.user)},jsonb_build_object('tenant_id',${q(p.priorTenant)},'role','viewer'),jsonb_build_object('tenant_id',${q(p.priorTenant)},'role','viewer','platform_permission','platform.controlplane.admin','grant_id',${q(p.grant)}),'Approved ongoing TEST operator across clients; tenant profile and historical grants retained',${q(p.runId)},'approved-test-owner');
 commit;select 'owner_access_committed' as marker;`;
}
const stateSql = (p) => `select
 (select count(*)::int from auth.users where id=${q(p.user)} and email=${q(p.email)} and raw_app_meta_data->>'learn_hosted_operator_session'=${q(p.origin)}) as identity,
 (select count(*)::int from auth.users where id=${q(p.user)} and banned_until>now()) as banned,
 (select count(*)::int from auth.users where lower(email)=${q(p.email)}) as email_identities,
 (select count(*)::int from public.profiles where id=${q(p.user)} and tenant_id=${q(p.priorTenant)} and role='viewer' and email=${q(p.email)}) as prior_profile,
 (select count(*)::int from public.profiles where id=${q(p.user)} and tenant_id=${q(p.tenant)} and role='owner' and email=${q(p.email)}) as owner_profile,
 (select count(*)::int from public.tenants where id=${q(p.tenant)} and status='active' and metadata->>'learn_real_commusoft_session'=${q(p.tenantOrigin)}) as target_tenant,
 (select count(*)::int from public.platform_authority_grants where profile_id=${q(p.user)} and coalesce(effective_from,'-infinity')<=now() and coalesce(effective_to,'infinity')>now()) as active_grants,
 (select count(*)::int from public.platform_authority_grants where id=${q(p.grant)} and profile_id=${q(p.user)} and permission='platform.controlplane.admin' and effective_to is null and granted_by=${q("owner-approved:" + p.runId)}) as exact_grant,
 (select count(*)::int from public.controlplane_change_log where id=${q(p.audit)} and resource_id=${q(p.user)} and correlation_id=${q(p.runId)}) as exact_audit`;
export async function runOwnerAccess(
  mode,
  {
    token,
    approvedRun,
    read,
    save,
    sql = (s, readOnly = true) => communicationQuery(token, s, { readOnly }),
    fetcher = fetch,
    checkContract = currentCommusoftAuthContractMatches,
  } = {},
) {
  need(["prepare", "apply", "inspect"].includes(mode), "owner_mode_invalid");
  const p = mode === "prepare" ? newOwnerPlan() : await read();
  validateOwnerPlan(p);
  const persist = () => save(p);
  const request = async (url, headers, method = "GET", body) => {
    const r = await fetcher(url, {
      method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    need(r.ok, "owner_remote_request_unconfirmed");
    const text = await r.text();
    need(text.length < 1048576, "owner_response_too_large");
    return text ? JSON.parse(text) : {};
  };
  const config = async () => {
    const c = await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/config/auth`, {
      Authorization: `Bearer ${token}`,
    });
    need(
      c.site_url === p.redirect &&
        typeof c.uri_allow_list === "string" &&
        c.uri_allow_list.split(",").includes(p.redirect),
      "reset_destination_unverified",
    );
    return { siteUrl: c.site_url, redirectAllowed: true, customSmtpConfigured: !!c.smtp_host };
  };
  const inspect = async () => {
    const r = await sql(stateSql(p));
    need(r.length === 1, "owner_state_missing");
    return r[0];
  };
  const catalog = async () => {
    const a = await sql(AUTH_CONTRACT_QUERY);
    need(a.length === 1 && checkContract(a[0].contract), "owner_auth_contract_differs");
    const rows = await sql(
      `select n.nspname||'.'||c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','storage','vault') and c.relkind in('r','p') and not c.relispartition order by 1`,
    );
    const tables = rows.map((r) => r.name);
    need(
      [
        "public.profiles",
        "public.platform_authority_grants",
        "public.controlplane_change_log",
        "vault.secrets",
        "storage.objects",
      ].every((t) => tables.includes(t)),
      "owner_catalog_incomplete",
    );
    return tables;
  };
  const snapshot = async (tables) =>
    (await sql(ownerPreservationSql(p, tables))).sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "prepare") {
    p.authConfig = await config();
    p.tables = await catalog();
    p.before = await snapshot(p.tables);
    p.initial = await inspect();
    need(
      p.initial.identity === 1 &&
        p.initial.email_identities === 1 &&
        p.initial.banned === 1 &&
        p.initial.prior_profile === 1 &&
        p.initial.target_tenant === 1 &&
        p.initial.owner_profile === 0 &&
        p.initial.active_grants === 0 &&
        p.initial.exact_grant === 0 &&
        p.initial.exact_audit === 0,
      "owner_prepared_boundary_differs",
    );
    await save(p, true);
  } else if (mode === "apply") {
    need(p.state === "prepared" && approvedRun === p.runId, "exact_owner_approval_required");
    await config();
    need(
      same(await catalog(), p.tables) &&
        same(await snapshot(p.tables), p.before) &&
        same(await inspect(), p.initial),
      "owner_prepared_state_changed",
    );
    const keys = await request(
      `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
      { Authorization: `Bearer ${token}` },
    );
    const key = (role) => {
      const rows = keys.filter((k) => k.name === role);
      need(rows.length === 1, "owner_key_missing");
      const k = rows[0].api_key,
        c = JSON.parse(Buffer.from(k.split(".")[1], "base64url"));
      need(c.ref === TEST_PROJECT && c.role === role, "owner_key_target_differs");
      return k;
    };
    const service = key("service_role"),
      anon = key("anon"),
      base = `https://${TEST_PROJECT}.supabase.co`,
      headers = {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "Content-Type": "application/json",
      };
    const user = await request(`${base}/auth/v1/admin/users/${p.user}`, headers);
    need(
      user.id === p.user &&
        user.email === p.email &&
        user.app_metadata?.learn_hosted_operator_session === p.origin &&
        Date.parse(user.banned_until) > Date.now(),
      "owner_auth_identity_differs",
    );
    p.state = "unban_started";
    await persist();
    const unbanned = await request(`${base}/auth/v1/admin/users/${p.user}`, headers, "PUT", {
      ban_duration: "none",
    });
    need(
      unbanned.id === p.user &&
        (!unbanned.banned_until || Date.parse(unbanned.banned_until) <= Date.now()),
      "owner_unban_unconfirmed",
    );
    p.state = "unbanned";
    await persist();
    p.state = "grant_started";
    await persist();
    const result = await sql(ownerGrantSql(p), false);
    need(
      result.length === 1 && result[0].marker === "owner_access_committed",
      "owner_grant_unconfirmed",
    );
    p.checks = await inspect();
    p.preserved = same(await snapshot(p.tables), p.before);
    need(
      p.preserved &&
        p.checks.identity === 1 &&
        p.checks.banned === 0 &&
        p.checks.prior_profile === 1 &&
        p.checks.owner_profile === 0 &&
        p.checks.active_grants === 1 &&
        p.checks.exact_grant === 1 &&
        p.checks.exact_audit === 1,
      "owner_access_unconfirmed",
    );
    p.state = "grant_verified";
    await persist();
    p.state = "recovery_email_started";
    await persist();
    await request(
      `${base}/auth/v1/recover?redirect_to=${encodeURIComponent(p.redirect)}`,
      { apikey: anon, "Content-Type": "application/json" },
      "POST",
      { email: p.email },
    );
    p.state = "ready_needs_owner_signin";
    p.recoveryRequestAcceptedAt = new Date().toISOString();
    await persist();
  } else {
    p.checks = await inspect();
    p.preserved = same(await snapshot(p.tables), p.before);
    await persist();
  }
  return {
    version,
    project: TEST_PROJECT,
    runId: p.runId,
    state: p.state,
    email: p.email,
    homeTenant: p.priorTenant,
    clientScope: "all_TEST_clients",
    permission: p.permission,
    expiresAt: p.expiresAt,
    tenantRole: p.tenantRole,
    redirect: p.redirect,
    preserved: p.preserved ?? null,
    checks: p.checks ?? p.initial,
    datasets: p.tables.length,
    recoveryRequestAcceptedAt: p.recoveryRequestAcceptedAt ?? null,
    emailDeliveryVerified: false,
    signedInVerified: false,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, flag, run, ...extra] = process.argv.slice(2);
    need(
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT &&
        extra.length === 0 &&
        (mode === "apply" ? flag === "--approved-run" && uuid(run) : flag === undefined),
      "explicit_owner_arguments_required",
    );
    const hash = createHash("sha256")
      .update(readFileSync(new URL(import.meta.url)))
      .digest("hex");
    const read = () => {
      const st = lstatSync(file);
      need(
        st.isFile() && !st.isSymbolicLink() && (st.mode & 0o077) === 0,
        "private_owner_journal_required",
      );
      const p = JSON.parse(readFileSync(file, "utf8"));
      need(p.sourceSha256 === hash, "owner_runner_changed_since_preparation");
      return p;
    };
    const save = (p, exclusive = false) =>
      writeFileSync(file, JSON.stringify({ ...p, sourceSha256: hash }, null, 2) + "\n", {
        flag: exclusive ? "wx" : "w",
        mode: 0o600,
      });
    console.log(
      JSON.stringify(
        await runOwnerAccess(mode, { token: savedCliToken(), approvedRun: run, read, save }),
        null,
        2,
      ),
    );
  } catch {
    console.error(
      "TEST owner access stopped. Inspect the saved phase before any retry; no recovery email is retried automatically.",
    );
    process.exitCode = 1;
  }
}
