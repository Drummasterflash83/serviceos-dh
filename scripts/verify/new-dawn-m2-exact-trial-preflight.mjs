/** Read-only LIVE gate for one reviewed Commusoft job-detail trial.
 * No feature update, operator RPC, credential release or provider GET.
 */
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { PROJECT, TENANT, readM2Postrelease } from "./new-dawn-m2-live-preflight.mjs";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SOURCE_ID = /^[1-9][0-9]{0,15}$/;
const quoted = value => "'" + value + "'";

export function trialQueries(jobId, sourceId) {
  if (!UUID.test(jobId ?? "") || !SOURCE_ID.test(sourceId ?? "") ||
    Number(sourceId) > Number.MAX_SAFE_INTEGER) throw Error("exact_trial_scope_invalid");
  const tenant = quoted(TENANT), job = quoted(jobId), external = quoted(sourceId);
  return {
    queue: `select status,count(*)::int n from public.platform_jobs where tenant_id=${tenant}::uuid
      and job_type='commusoft.source_sync' and status in('queued','running','retrying')
      group by status order by status`,
    lease: `select count(*) filter(where lease_owner_id is not null
      and lease_expires_at>clock_timestamp())::int active_leases,
      count(*) filter(where manual_waiter_id is not null
      and manual_waiter_expires_at>clock_timestamp())::int manual_waiters,
      count(*) filter(where next_allowed_at>clock_timestamp())::int quota_waits
      from public.learn_business_input_request_gates`,
    receipts: `select count(*) filter(where state in('prepared','claimed'))::int active,
      count(*)::int total from public.new_dawn_commusoft_job_detail_reads
      where tenant_id=${tenant}::uuid`,
    permissions: `select
      has_function_privilege('authenticated',
       'public.new_dawn_commusoft_job_detail_start(uuid,uuid,uuid,text)','execute') auth_start,
      not has_function_privilege('anon',
       'public.new_dawn_commusoft_job_detail_start(uuid,uuid,uuid,text)','execute') anon_denied,
      has_function_privilege('service_role',
       'public.new_dawn_commusoft_job_detail_acquire(uuid)','execute') service_acquire,
      not has_function_privilege('authenticated',
       'public.new_dawn_commusoft_job_detail_acquire(uuid)','execute') auth_acquire_denied,
      has_function_privilege('service_role',
       'public.new_dawn_commusoft_job_detail_finish(uuid,text)','execute') service_finish,
      has_function_privilege('service_role',
       'public.new_dawn_commusoft_job_detail_fail(uuid,text,timestamptz)','execute') service_fail,
      (select count(distinct g.profile_id)::int from public.platform_authority_grants g
       join auth.users u on u.id=g.profile_id and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=clock_timestamp())
       where g.permission='platform.controlplane.admin'
        and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
        and coalesce(g.effective_to,'infinity')>clock_timestamp()
        and not exists(select 1 from public.view_as_context v
         where v.actor_user_id=g.profile_id and v.ended_at is null
          and (v.expires_at is null or v.expires_at>clock_timestamp()))) eligible_admins`,
    baseFlags: `select count(*)::int n from public.feature_flags where tenant_id=${tenant}::uuid
      and flag in('learn.enabled','learn.inputs.commusoft.enabled') and value='true'::jsonb`,
    job: `with selected as materialized (
      select j.id,j.tenant_id,j.external_id,j.metadata,j.source_system,
       l.connection_id,l.source_version_id,l.external_id linked_external,
       v.payload->>'id' payload_id,jsonb_typeof(v.payload->'id') payload_id_type,
       c.status connection_status,c.auth_mode,c.revoked_at,c.verified_at,
       c.non_secret_config->>'region' region,c.secret_refs->>'api_key' secret_ref
      from public.jobs j join public.learn_business_input_current_links l
       on l.tenant_id=j.tenant_id and l.entity_id=j.id
        and l.entity_kind='job' and l.entity_table='jobs'
        and l.provider='commusoft' and l.collection='jobs'
      join public.learn_business_input_versions v on v.id=l.source_version_id
       and v.tenant_id=l.tenant_id and v.connection_id=l.connection_id
       and v.provider=l.provider and v.collection=l.collection
       and v.external_id=l.external_id
      join public.provider_connections c on c.id=l.connection_id
       and c.tenant_id=l.tenant_id and c.provider='commusoft'
      where j.tenant_id=${tenant}::uuid and j.id=${job}::uuid
       and l.external_id=${external}
    ), observed as (
      select v.id,max(p.committed_at) seen
      from public.learn_business_input_versions v
      join public.learn_business_input_observations o on o.version_id=v.id
      join public.learn_business_input_pages p on p.id=o.page_id
       and (p.tenant_id,p.connection_id,p.provider,p.collection)=
         (v.tenant_id,v.connection_id,v.provider,v.collection)
      join selected s on s.tenant_id=v.tenant_id
       and s.connection_id=v.connection_id and s.external_id=v.external_id
      where v.provider='commusoft' and v.collection='jobs' group by v.id
    ), latest as (select max(seen) seen from observed)
    select count(*)::int candidate_rows,
      bool_and(s.source_system='commusoft:connection:'||s.connection_id::text
       and s.external_id=s.linked_external
       and s.metadata#>>'{learn_business_input,connection_id}'=s.connection_id::text
       and s.metadata#>>'{learn_business_input,source_version_id}'=s.source_version_id::text
       and s.payload_id_type='number' and s.payload_id=s.external_id
       and s.connection_status='configured' and s.auth_mode='private_api_key'
       and s.revoked_at is null and s.verified_at is not null
       and s.region in('uk','us') and s.secret_ref ~
        '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') exact_scope,
      (select count(*)::int from public.learn_business_input_current_links l
       where l.tenant_id=${tenant}::uuid and l.entity_id=${job}::uuid
        and l.entity_kind='job' and l.entity_table='jobs'
        and l.provider='commusoft' and l.collection='jobs') reviewed_link_count,
      (select count(*)::int from observed where seen=(select seen from latest)) latest_tie_count,
      (select count(*)::int from observed o join selected s on s.source_version_id=o.id
       where o.seen=(select seen from latest)) selected_latest_count,
      (select seen from latest) latest_observed_at
    from selected s`,
  };
}

const one = (rows, name) => {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object")
    throw Error(name + "_shape_unverified");
  return rows[0];
};
const count = (value, name) => {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) throw Error(name + "_unverified");
  return Number(value);
};

export function assessExactTrialPreflight(snapshot, now = Date.now()) {
  const runtimeFlags = snapshot?.runtime?.flagsPresent;
  const exactOffM5 = Array.isArray(runtimeFlags) && runtimeFlags.length === 1 &&
    runtimeFlags[0]?.flag === "new_dawn.m5_opportunities_probe" &&
    runtimeFlags[0]?.value === false;
  if (snapshot?.runtime?.state !== "installed_default_off_readback" ||
    (!Array.isArray(runtimeFlags) || (runtimeFlags.length !== 0 && !exactOffM5)))
    throw Error("runtime_not_default_off");
  const job = one(snapshot.job, "job"), lease = one(snapshot.lease, "lease"),
    receipts = one(snapshot.receipts, "receipts"), permissions = one(snapshot.permissions, "permissions"),
    baseFlags = one(snapshot.baseFlags, "base_flags");
  if (count(job.candidate_rows, "candidate_rows") !== 1 || job.exact_scope !== true ||
    count(job.reviewed_link_count, "reviewed_link_count") !== 1 ||
    count(job.latest_tie_count, "latest_tie_count") !== 1 ||
    count(job.selected_latest_count, "selected_latest_count") !== 1 ||
    count(baseFlags.n, "base_flags") !== 2) throw Error("exact_job_scope_unverified");
  const observed = Date.parse(job.latest_observed_at ?? "");
  if (!Number.isFinite(observed) || observed > now) throw Error("source_observation_unverified");
  for (const field of ["auth_start", "anon_denied", "service_acquire",
    "auth_acquire_denied", "service_finish", "service_fail"])
    if (permissions[field] !== true) throw Error("permit_unverified:" + field);
  if (count(permissions.eligible_admins, "eligible_admins") < 1)
    throw Error("operator_unavailable");
  const activeRequests = count(receipts.active, "active_requests");
  const leases = count(lease.active_leases, "active_leases"),
    waiters = count(lease.manual_waiters, "manual_waiters"),
    quota = count(lease.quota_waits, "quota_waits");
  if (!Array.isArray(snapshot.queue) || snapshot.queue.some(row =>
    !["queued", "running", "retrying"].includes(row?.status) ||
    !Number.isSafeInteger(Number(row.n)) || Number(row.n) < 0))
    throw Error("queue_unverified");
  const activeImport = snapshot.queue.reduce((sum, row) => sum + Number(row.n), 0);
  if (Boolean(activeImport) !== snapshot.runtime.activeImport) throw Error("queue_changed_during_read");
  const blockers = [];
  if (activeImport > 0) blockers.push("source_queue_active_coexistence_off");
  if (activeRequests > 0) blockers.push("manual_request_already_active");
  if (leases > 0 || waiters > 0 || quota > 0) blockers.push("shared_credential_gate_busy");
  blockers.push("exact_job_detail_flag_off");
  return { state: "reviewed_job_preflight_verified_trial_not_enabled",
    sourceObservedAt: new Date(observed).toISOString(),
    sourceAgeHours: Math.round((now - observed) / 3600000),
    activeImport, activeRequests, activeLeases: leases, manualWaiters: waiters,
    quotaWaits: quota, blockers, providerRequests: 0, productionWrites: false };
}

async function readSql(query, token) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query/read-only`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error("management_read_http_" + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 16384) throw Error("management_read_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readExactTrialPreflight(jobId, sourceId,
  { token = savedCliToken(), runtime = readM2Postrelease } = {}) {
  const queries = trialQueries(jobId, sourceId);
  const before = await runtime({ token, allowOffM5Probe: true });
  const snapshot = { runtime: before };
  for (const [name, query] of Object.entries(queries)) snapshot[name] = await readSql(query, token);
  const after = await runtime({ token, allowOffM5Probe: true });
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error("runtime_changed_during_read");
  return assessExactTrialPreflight(snapshot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.NEW_DAWN_M2_ALLOW_PROJECT !== PROJECT || process.argv.length !== 7 ||
      process.argv[2] !== "--live-read-only" || process.argv[3] !== "--job-id" ||
      process.argv[5] !== "--source-id") throw Error("explicit_live_read_only_scope_required");
    console.log(JSON.stringify(await readExactTrialPreflight(process.argv[4], process.argv[6])));
  } catch (error) {
    console.error(JSON.stringify({ state: "exact_trial_preflight_unverified",
      code: error instanceof Error ? error.message : "unknown", providerRequests: 0,
      productionWrites: false }));
    process.exitCode = 1;
  }
}
