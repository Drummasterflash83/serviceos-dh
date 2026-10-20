/** Exact one-use Drummonds Commusoft job-detail permit. No provider call. */
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { readExactTrialPreflight } from "./new-dawn-m2-exact-trial-preflight.mjs";

export const PROJECT = "tgbnakbxwcqjeimygroz";
export const TENANT = "00000000-0000-0000-0000-000000000001";
export const JOB = "ff774d9a-0ed6-4bf8-a3cd-fa735e9b7137";
export const EXTERNAL = "13136";
export const VERSION = "ecc0788e-ffb8-4361-bdfa-d93c9535a711";
export const CONNECTION = "87d0d4fa-1097-4a73-80fd-61357edb1e5d";
export const OPERATOR = "ec84daae-b135-4547-a1de-794bfcd3fbf2";
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const reasonText = (value) => {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < 3 || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason))
    throw Error("exact_job_trial_reason_required");
  return reason;
};
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";

async function management(token, query, write = false, fetcher = fetch) {
  const response = await fetcher(
    `https://api.supabase.com/v1/projects/${PROJECT}/database/query${write ? "" : "/read-only"}`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, read_only: !write }),
    },
  );
  if (!response.ok)
    throw Error(`exact_job_trial_${write ? "write" : "read"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 8192) throw Error("exact_job_trial_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

const scopeSql = (requestId = null) => `select
 (select count(*)::int from public.learn_business_input_current_links l
  join public.learn_business_input_versions v on v.id=l.source_version_id
   and v.tenant_id=l.tenant_id and v.connection_id=l.connection_id
   and v.provider='commusoft' and v.collection='jobs' and v.external_id=l.external_id
  join public.jobs j on j.id=l.entity_id and j.tenant_id=l.tenant_id
  where l.tenant_id='${TENANT}'::uuid and l.entity_id='${JOB}'::uuid
   and l.entity_kind='job' and l.entity_table='jobs' and l.provider='commusoft'
   and l.collection='jobs' and l.connection_id='${CONNECTION}'::uuid
   and l.source_version_id='${VERSION}'::uuid and l.external_id='${EXTERNAL}'
   and j.metadata#>>'{learn_business_input,source_version_id}'=v.id::text
   and j.metadata#>>'{learn_business_input,connection_id}'=v.connection_id::text
   and j.source_system='commusoft:connection:'||v.connection_id::text
   and j.external_id=v.external_id and lower(btrim(v.payload->>'status')) in ('closed','completed')
   and lower(btrim(v.payload#>>'{closed,closedOutcome}'))='aborted') as exact_aborted_source,
 (select count(*)::int from auth.users u join public.platform_authority_grants g
   on g.profile_id=u.id and g.permission='platform.controlplane.admin'
  where u.id='${OPERATOR}'::uuid and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp()) as operator_grants,
 (select count(*)::int from public.view_as_context v where v.actor_user_id='${OPERATOR}'::uuid
  and v.ended_at is null and (v.expires_at is null or v.expires_at>clock_timestamp())) as view_as_active,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag in ('new_dawn.m2_commusoft_coexistence','new_dawn.exact_job_detail')
  and value='true'::jsonb) as broad_flags_on,
 (select count(*)::int from public.new_dawn_commusoft_job_trial_permits
  where tenant_id='${TENANT}'::uuid and expires_at>clock_timestamp()
   and revoked_at is null) as active_permits,
 ${
   requestId
     ? `(select count(*)::int from public.new_dawn_commusoft_job_trial_permits
  where request_id='${requestId}'::uuid) as request_rows`
     : "0::int as request_rows"
 },
 to_regprocedure('public.new_dawn_commusoft_job_trial_arm(uuid,uuid,uuid,uuid,uuid,timestamptz,text)') is not null as arm_installed,
 to_regprocedure('public.new_dawn_commusoft_job_trial_disarm(uuid,text)') is not null as disarm_installed,
 coalesce(has_function_privilege('authenticated',
  'public.new_dawn_commusoft_job_trial_offer(uuid,uuid)','execute'),false) as authenticated_offer,
 coalesce(has_function_privilege('authenticated',
  'public.new_dawn_commusoft_job_trial_arm(uuid,uuid,uuid,uuid,uuid,timestamptz,text)','execute'),false) as authenticated_arm,
 coalesce(has_function_privilege('service_role',
  'public.new_dawn_commusoft_job_trial_arm(uuid,uuid,uuid,uuid,uuid,timestamptz,text)','execute'),false) as service_arm`;

const receiptSql = (requestId) => `select
 p.request_id::text,p.tenant_id::text,p.job_id::text,p.actor_id::text,
 p.connection_id::text,p.source_version_id::text,p.external_id,
 p.armed_at,p.expires_at,p.used_at is not null as used,p.revoked_at is not null as revoked,
 (select count(*)::int from public.controlplane_change_log a
  where a.tenant_id=p.tenant_id and a.correlation_id=p.request_id::text
   and a.action='client_jobs.provider_detail_trial_armed' and a.resource_id=p.job_id::text
   and a.actor='postgres_release' and a.source='new-dawn-commusoft-job-trial') as arm_audits,
 (select a.reason from public.controlplane_change_log a
  where a.tenant_id=p.tenant_id and a.correlation_id=p.request_id::text
   and a.action='client_jobs.provider_detail_trial_armed' and a.resource_id=p.job_id::text
   and a.actor='postgres_release' and a.source='new-dawn-commusoft-job-trial'
  limit 1) as arm_reason,
 (select count(*)::int from public.controlplane_change_log a
  where a.tenant_id=p.tenant_id and a.correlation_id=p.request_id::text
   and a.action='client_jobs.provider_detail_trial_disarmed' and a.resource_id=p.job_id::text
   and a.actor='postgres_release' and a.source='new-dawn-commusoft-job-trial') as disarm_audits,
 (select a.reason from public.controlplane_change_log a
  where a.tenant_id=p.tenant_id and a.correlation_id=p.request_id::text
   and a.action='client_jobs.provider_detail_trial_disarmed' and a.resource_id=p.job_id::text
   and a.actor='postgres_release' and a.source='new-dawn-commusoft-job-trial'
  limit 1) as disarm_reason
 from public.new_dawn_commusoft_job_trial_permits p where p.request_id='${requestId}'::uuid`;

const detailSql = (requestId) => `select
 p.request_id::text,p.tenant_id::text,p.job_id::text,p.actor_id::text,
 p.connection_id::text,p.source_version_id::text,p.external_id,
 r.id is not null as receipt_exists,coalesce(r.state,'not_started') as receipt_state,
 r.tenant_id::text as receipt_tenant,r.job_id::text as receipt_job,
 r.actor_id::text as receipt_actor,r.connection_id::text as receipt_connection,
 r.source_version_id::text as receipt_version,r.external_id as receipt_external,
 r.checked_at,r.raw_sha256,r.result->>'version' as result_version,
 case when r.result#>>'{source_closure_facts,closedOutcome,state}' is distinct from 'present'
  then 'held_or_not_supplied'
  when nullif(btrim(r.result#>>'{source_closure_facts,closedOutcome,value}'),'') is null
  then 'held_or_not_supplied'
  when lower(btrim(r.result#>>'{source_closure_facts,closedOutcome,value}'))='aborted'
  then 'aborted_recorded'
  when lower(btrim(r.result#>>'{source_closure_facts,closedOutcome,value}'))='freeofcharge'
  then 'free_of_charge_recorded'
  when lower(btrim(r.result#>>'{source_closure_facts,closedOutcome,value}')) in
   ('final invoiced','finalinvoiced') then 'final_invoiced_label_recorded'
  else 'other_source_label' end as closure_class,
 (select count(*)::int from public.controlplane_change_log a
  where a.tenant_id=p.tenant_id and a.correlation_id=p.request_id::text
   and a.action='client_jobs.provider_detail_requested'
   and a.resource_id=p.job_id::text and a.source='new-dawn-commusoft-job-detail') as request_audits,
 (select count(*)::int from public.controlplane_change_log a
  where a.tenant_id=p.tenant_id and a.correlation_id=p.request_id::text
   and a.action='client_jobs.provider_detail_completed'
   and a.resource_id=p.job_id::text and a.source='new-dawn-commusoft-job-detail') as complete_audits
 from public.new_dawn_commusoft_job_trial_permits p
 left join public.new_dawn_commusoft_job_detail_reads r on r.id=p.request_id
 where p.request_id='${requestId}'::uuid`;

export function assessScope(preflight, rows) {
  const row = rows?.[0];
  if (
    preflight?.state !== "reviewed_job_preflight_verified_trial_not_enabled" ||
    preflight.activeImport !== 0 ||
    preflight.activeRequests !== 0 ||
    preflight.activeLeases !== 0 ||
    preflight.manualWaiters !== 0 ||
    preflight.quotaWaits !== 0 ||
    JSON.stringify(preflight.blockers) !== JSON.stringify(["exact_job_detail_flag_off"]) ||
    rows?.length !== 1 ||
    row?.exact_aborted_source !== 1 ||
    row.operator_grants !== 1 ||
    row.view_as_active !== 0 ||
    row.broad_flags_on !== 0 ||
    row.active_permits !== 0 ||
    row.request_rows !== 0 ||
    row.arm_installed !== true ||
    row.disarm_installed !== true ||
    row.authenticated_offer !== true ||
    row.authenticated_arm !== false ||
    row.service_arm !== false
  )
    throw Error("exact_job_trial_scope_changed");
  return {
    state: "exact_aborted_job_trial_ready_not_armed",
    project: PROJECT,
    tenant: TENANT,
    job: JOB,
    externalId: EXTERNAL,
    sourceVersionId: VERSION,
    operatorId: OPERATOR,
    sourceObservedAt: preflight.sourceObservedAt,
    providerRequests: 0,
    productionWrites: false,
  };
}

export async function readScope(
  requestId = null,
  {
    token = savedCliToken(),
    preflight = readExactTrialPreflight,
    read = (sql) => management(token, sql),
  } = {},
) {
  if (requestId !== null && !UUID.test(requestId))
    throw Error("exact_job_trial_request_id_invalid");
  const before = await preflight(JOB, EXTERNAL, { token });
  const rows = await read(scopeSql(requestId));
  const after = await preflight(JOB, EXTERNAL, { token });
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error("exact_job_trial_preflight_changed_during_read");
  return assessScope(before, rows);
}

export function armSql(requestId, reasonInput) {
  if (!UUID.test(requestId)) throw Error("exact_job_trial_request_id_invalid");
  const reason = reasonText(reasonInput);
  return `select public.new_dawn_commusoft_job_trial_arm('${TENANT}'::uuid,
 '${JOB}'::uuid,'${OPERATOR}'::uuid,'${requestId}'::uuid,
 '${VERSION}'::uuid,clock_timestamp()+interval '5 minutes',${quote(reason)}) as permit`;
}
export function disarmSql(requestId, reasonInput) {
  if (!UUID.test(requestId)) throw Error("exact_job_trial_request_id_invalid");
  return `select public.new_dawn_commusoft_job_trial_disarm('${requestId}'::uuid,${quote(reasonText(reasonInput))})`;
}
export function assessReceipt(
  rows,
  requestId,
  revoked,
  expectedReason = null,
  { requireLive = false } = {},
) {
  const row = rows?.[0];
  const armedAt = Date.parse(row?.armed_at ?? "");
  const expiresAt = Date.parse(row?.expires_at ?? "");
  if (
    !UUID.test(requestId) ||
    rows?.length !== 1 ||
    row?.request_id !== requestId ||
    row.tenant_id !== TENANT ||
    row.job_id !== JOB ||
    row.actor_id !== OPERATOR ||
    row.connection_id !== CONNECTION ||
    row.source_version_id !== VERSION ||
    row.external_id !== EXTERNAL ||
    !Number.isFinite(armedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= armedAt ||
    expiresAt > armedAt + 10 * 60_000 ||
    typeof row.used !== "boolean" ||
    (requireLive && expiresAt <= Date.now()) ||
    row.arm_audits !== 1 ||
    row.revoked !== revoked ||
    (revoked ? row.disarm_audits !== 1 : row.disarm_audits !== 0) ||
    (expectedReason !== null && (revoked ? row.disarm_reason : row.arm_reason) !== expectedReason)
  )
    throw Error("exact_job_trial_receipt_changed");
  return {
    requestId,
    job: JOB,
    operatorId: OPERATOR,
    expiresAt: row.expires_at,
    used: row.used,
    revoked,
    armAuditVerified: true,
    disarmAuditVerified: revoked,
    providerRequests: 0,
  };
}

export async function armOnce(
  requestId,
  reason,
  {
    token = savedCliToken(),
    scope = readScope,
    write = (sql) => management(token, sql, true),
    read = (sql) => management(token, sql),
  } = {},
) {
  if (!UUID.test(requestId)) throw Error("exact_job_trial_request_id_invalid");
  const reviewedReason = reasonText(reason);
  await scope(requestId, { token });
  let acknowledged = false;
  try {
    const rows = await write(armSql(requestId, reviewedReason));
    acknowledged = rows?.[0]?.permit?.request_id === requestId;
  } catch {
    /* The request ID is known; inspect once and never replay a write. */
  }
  try {
    const result = assessReceipt(
      await read(receiptSql(requestId)),
      requestId,
      false,
      reviewedReason,
      { requireLive: true },
    );
    return { ...result, state: "exact_aborted_job_permit_armed", writeAcknowledged: acknowledged };
  } catch {
    throw Error(`exact_job_trial_arm_outcome_unverified_no_replay:${requestId}`);
  }
}

export async function disarmOnce(
  requestId,
  reason,
  {
    token = savedCliToken(),
    write = (sql) => management(token, sql, true),
    read = (sql) => management(token, sql),
  } = {},
) {
  if (!UUID.test(requestId)) throw Error("exact_job_trial_request_id_invalid");
  const reviewedReason = reasonText(reason);
  const before = assessReceipt(await read(receiptSql(requestId)), requestId, false);
  let acknowledged = false;
  try {
    await write(disarmSql(requestId, reviewedReason));
    acknowledged = true;
  } catch {
    /* Inspect once; never replay a possibly applied disarm. */
  }
  try {
    const after = assessReceipt(await read(receiptSql(requestId)), requestId, true, reviewedReason);
    return {
      ...after,
      state: "exact_aborted_job_permit_disarmed",
      wasUsed: before.used,
      writeAcknowledged: acknowledged,
    };
  } catch {
    throw Error(`exact_job_trial_disarm_outcome_unverified_no_replay:${requestId}`);
  }
}

export function assessDetail(rows, requestId) {
  const row = rows?.[0];
  if (
    !UUID.test(requestId) ||
    rows?.length !== 1 ||
    row?.request_id !== requestId ||
    row.tenant_id !== TENANT ||
    row.job_id !== JOB ||
    row.actor_id !== OPERATOR ||
    row.connection_id !== CONNECTION ||
    row.source_version_id !== VERSION ||
    row.external_id !== EXTERNAL ||
    typeof row.receipt_exists !== "boolean"
  )
    throw Error("exact_job_trial_detail_scope_changed");
  if (!row.receipt_exists) {
    if (
      row.receipt_state !== "not_started" ||
      row.request_audits !== 0 ||
      row.complete_audits !== 0
    )
      throw Error("exact_job_trial_detail_state_changed");
    return { state: "not_started", requestId, providerResultVerified: false };
  }
  if (
    row.receipt_tenant !== TENANT ||
    row.receipt_job !== JOB ||
    row.receipt_actor !== OPERATOR ||
    row.receipt_connection !== CONNECTION ||
    row.receipt_version !== VERSION ||
    row.receipt_external !== EXTERNAL ||
    !["prepared", "claimed", "complete", "failed"].includes(row.receipt_state) ||
    row.request_audits !== 1
  )
    throw Error("exact_job_trial_detail_state_changed");
  if (row.receipt_state === "complete") {
    if (
      row.complete_audits !== 1 ||
      row.result_version !== "commusoft-exact-job-detail/5" ||
      !Number.isFinite(Date.parse(row.checked_at)) ||
      !/^[a-f\d]{64}$/.test(row.raw_sha256 ?? "") ||
      ![
        "aborted_recorded",
        "free_of_charge_recorded",
        "final_invoiced_label_recorded",
        "other_source_label",
        "held_or_not_supplied",
      ].includes(row.closure_class)
    )
      throw Error("exact_job_trial_detail_state_changed");
    return {
      state: "complete",
      requestId,
      checkedAt: row.checked_at,
      detailSha256: row.raw_sha256,
      closureClass: row.closure_class,
      providerResultVerified: true,
    };
  }
  if (row.complete_audits !== 0) throw Error("exact_job_trial_detail_state_changed");
  return { state: row.receipt_state, requestId, providerResultVerified: false };
}

export async function readDetail(
  requestId,
  { token = savedCliToken(), read = (sql) => management(token, sql) } = {},
) {
  if (!UUID.test(requestId)) throw Error("exact_job_trial_request_id_invalid");
  return assessDetail(await read(detailSql(requestId)), requestId);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.env.NEW_DAWN_M3_TRIAL_PROJECT !== PROJECT ||
      process.env.NEW_DAWN_M3_TRIAL_JOB !== JOB ||
      process.env.NEW_DAWN_M3_TRIAL_OPERATOR !== OPERATOR
    )
      throw Error("exact_live_trial_scope_required");
    const [mode, requestArg, reasonArg] = process.argv.slice(2);
    if (mode === "--live-read-only" && !requestArg && !reasonArg)
      console.log(JSON.stringify(await readScope()));
    else if (
      mode === "--live-receipt-read-only" &&
      requestArg?.startsWith("--request-id=") &&
      !reasonArg &&
      process.argv.length === 4
    )
      console.log(JSON.stringify(await readDetail(requestArg.slice(13))));
    else if (
      mode === "--live-arm-once" &&
      requestArg?.startsWith("--request-id=") &&
      reasonArg?.startsWith("--reason=") &&
      process.argv.length === 5 &&
      process.env.NEW_DAWN_M3_SIGNED_IN_CLICK_READY === "1"
    )
      console.log(JSON.stringify(await armOnce(requestArg.slice(13), reasonArg.slice(9))));
    else if (
      mode === "--live-disarm-once" &&
      requestArg?.startsWith("--request-id=") &&
      reasonArg?.startsWith("--reason=") &&
      process.argv.length === 5
    )
      console.log(JSON.stringify(await disarmOnce(requestArg.slice(13), reasonArg.slice(9))));
    else throw Error("exact_live_trial_action_required");
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "exact_aborted_job_trial_stopped",
        code: error instanceof Error ? error.message : "unknown",
        retryAllowed: false,
        providerRequests: 0,
      }),
    );
    process.exitCode = 1;
  }
}
