/** Aggregate-only follow-up for the two 23:05 UTC audited mailbox proofs. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with proofs as (
  select distinct on (r.resource_id) r.resource_id::uuid account_id,
    r.created_at proof_at,
    (r.detail->>'checkpoint_revision')::bigint proven_revision
  from public.audit_logs r
  where r.tenant_id='${tenant}'::uuid
    and r.action='learn.email.mailbox_source_probe_result'
    and r.resource_type='email_account' and r.status='success'
    and r.detail->>'code'='provider_verified'
    and r.created_at>='2026-10-15 23:05:00+00'::timestamptz
  order by r.resource_id,r.created_at desc,r.id desc
), states as (
  select p.proof_at,p.proven_revision,c.state,c.block_code,c.revision,
    (select count(*)::int from public.email_ingestion_transitions x
      where x.tenant_id='${tenant}'::uuid and x.email_account_id=p.account_id
        and x.operation='claim'
        and x.accepted_result->>'automatic_recovery'='confirmed_mailbox_profile_recovery') automatic_claims,
    (select r.status from public.email_sync_runs r
      where r.tenant_id='${tenant}'::uuid and r.sync_type='workspace_messages'
        and r.metadata->>'email_account_id'=p.account_id::text
      order by r.started_at desc,r.id desc limit 1) latest_run_status,
    (select r.completed_at from public.email_sync_runs r
      where r.tenant_id='${tenant}'::uuid and r.sync_type='workspace_messages'
        and r.metadata->>'email_account_id'=p.account_id::text
        and r.status='success' and r.completed_at>=p.proof_at
      order by r.completed_at desc,r.id desc limit 1) post_proof_success_at
  from proofs p join public.email_ingestion_checkpoints c
    on c.tenant_id='${tenant}'::uuid and c.email_account_id=p.account_id
      and c.stream='recent'
) select count(*)::int verified_proofs,
  count(*) filter(where state='blocked' and block_code='admin_delegation_missing')::int still_held,
  count(*) filter(where state<>'blocked' and block_code is null)::int cleared_holds,
  array_agg(distinct state order by state) checkpoint_states,
  count(*) filter(where revision>proven_revision)::int advanced_revisions,
  coalesce(sum(automatic_claims),0)::int automatic_recovery_claims,
  count(*) filter(where latest_run_status='success')::int latest_runs_success,
  count(*) filter(where post_proof_success_at is not null)::int post_proof_successes,
  max(post_proof_success_at) latest_post_proof_success_at
from states`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
if (!response.ok) throw Error(`Mailbox recovery readback failed (HTTP ${response.status})`);
const rows = await response.json();
const status = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 ||
  !Number.isInteger(status?.verified_proofs) || status.verified_proofs !== 2 ||
  !Number.isInteger(status.still_held) || !Number.isInteger(status.automatic_recovery_claims))
  throw Error("Exact two-proof recovery readback changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  ...status, productionDataWrites: false, customerContentReturned: false }));
