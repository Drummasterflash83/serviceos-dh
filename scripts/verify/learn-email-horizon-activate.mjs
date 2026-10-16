/** Owner-approved Drummonds full-import cutoff. Retains all captured mail. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";

const PROJECT = "tgbnakbxwcqjeimygroz";
const TENANT = "00000000-0000-0000-0000-000000000001";
const CUTOFF = "2023-10-16T00:00:00Z";
const REHEARSAL = ".verification-results/learn-email-horizon-live-activation-rehearsal.json";
const counts = `select
 (select count(*) from public.email_accounts where tenant_id='${TENANT}' and provider='gmail') as accounts,
 (select count(*) from public.email_accounts where tenant_id='${TENANT}' and provider='gmail' and full_import_after_at is not null) as policies,
 (select count(*) from public.email_ingestion_checkpoints where tenant_id='${TENANT}' and stream='recent' and state='ready') as ready,
 (select count(*) from public.email_ingestion_checkpoints where tenant_id='${TENANT}' and stream='recent' and state='blocked') as blocked,
 (select count(*) from public.email_ingestion_checkpoints where tenant_id='${TENANT}' and stream='recent' and state='completed') as completed,
 (select count(*) from public.email_ingestion_checkpoints where tenant_id='${TENANT}' and stream='recent' and state='claimed') as claimed,
 (select count(*) from public.learn_email_transition_requests r
   left join public.learn_email_transition_settlements s on s.request_id=r.id
   where r.tenant_id='${TENANT}' and r.stream='recent' and s.request_id is null) as unsettled,
 (select count(*) from public.email_ingestion_checkpoints where tenant_id='${TENANT}'
   and stream='recent' and state='ready' and continuation->>'version'='4'
   and continuation->>'mode'='reconcile' and continuation->>'query' is null
   and continuation->>'fetch_policy'='refetch_all') as eligible_ready,
 (select count(*) from public.email_ingestion_checkpoints where tenant_id='${TENANT}'
   and stream='recent' and state='ready' and continuation->>'phase'='uninitialized'
   and continuation->>'fetch_policy'='refetch_all') as reset_ready`;
const mutation = `
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
select 1 from public.email_accounts where tenant_id='${TENANT}' and provider='gmail' for update;
select 1 from public.email_ingestion_checkpoints where tenant_id='${TENANT}' and stream='recent' for update;
do $guard$begin
 if (select count(*) from public.email_accounts where tenant_id='${TENANT}' and provider='gmail')<>30
 or (select count(*) from public.email_accounts where tenant_id='${TENANT}' and provider='gmail' and full_import_after_at is not null)<>0
 or (select count(*) from public.email_ingestion_checkpoints where tenant_id='${TENANT}' and stream='recent' and state='ready')<>12
 or (select count(*) from public.email_ingestion_checkpoints where tenant_id='${TENANT}' and stream='recent' and state='claimed')<>0
 or (select count(*) from public.learn_email_transition_requests r
    left join public.learn_email_transition_settlements s on s.request_id=r.id
    where r.tenant_id='${TENANT}' and r.stream='recent' and s.request_id is null)<>0
 or (select count(*) from public.email_ingestion_checkpoints where tenant_id='${TENANT}'
    and stream='recent' and state='ready' and continuation->>'version'='4'
    and continuation->>'mode'='reconcile' and continuation->>'query' is null
    and continuation->>'fetch_policy'='refetch_all')<>12
 then raise exception 'drummonds_horizon_preflight_changed'; end if;
end $guard$;
update public.email_accounts set full_import_after_at='${CUTOFF}'::timestamptz
 where tenant_id='${TENANT}' and provider='gmail';
create temporary table email_horizon_reset on commit drop as
 with prior as materialized (
   select tenant_id,email_account_id,generation,revision,continuation
   from public.email_ingestion_checkpoints
   where tenant_id='${TENANT}' and stream='recent' and state='ready'
 ), reset as (
   update public.email_ingestion_checkpoints c
   set generation=gen_random_uuid(),revision=c.revision+1,state='ready',
     owner_attempt_id=null,block_code=null,
     continuation=jsonb_build_object('version',4,'phase','uninitialized',
       'intent','reconcile','fetch_policy',p.continuation->>'fetch_policy'),
     updated_at=clock_timestamp()
   from prior p where c.tenant_id=p.tenant_id and c.email_account_id=p.email_account_id
     and c.stream='recent' and c.state='ready'
   returning c.email_account_id,p.generation as old_generation,c.generation as new_generation,
     p.revision as old_revision,c.revision as new_revision
 ) select * from reset;
insert into public.audit_logs(tenant_id,actor,action,resource_type,resource_id,status,detail)
 select '${TENANT}'::uuid,'owner_authorized','learn.email.full_import_horizon_activated',
   'email_account',email_account_id::text,'success',jsonb_build_object(
     'cutoff','${CUTOFF}','old_generation',old_generation,'new_generation',new_generation,
     'old_revision',old_revision,'new_revision',new_revision,'retained_messages_preserved',true)
 from email_horizon_reset;
do $guard$begin
 if (select count(*) from email_horizon_reset)<>12 or
   (select count(*) from public.email_accounts where tenant_id='${TENANT}' and provider='gmail'
      and full_import_after_at='${CUTOFF}'::timestamptz)<>30 or
   (select count(*) from public.email_ingestion_checkpoints where tenant_id='${TENANT}'
     and stream='recent' and state='ready' and continuation->>'phase'='uninitialized'
     and continuation->>'fetch_policy'='refetch_all')<>12
 then raise exception 'drummonds_horizon_postcondition_failed'; end if;
end $guard$;
select count(*) as reset_count from email_horizon_reset;
`;
const sha256 = createHash("sha256").update(mutation).digest("hex");

async function query(token, sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
      redirect: "error", signal: AbortSignal.timeout(45000) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw Error(String(payload.message ?? "horizon_activation_failed").split("\n")[0].slice(0, 240));
  }
  return response.json();
}

async function main() {
  const mode = process.argv[2];
  if (!["--rehearse-live", "--apply-live"].includes(mode) ||
      process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== PROJECT)
    throw Error("explicit_live_activation_scope_required");
  const token = savedCliToken();
  const before = (await query(token, counts))[0];
  if (!before || before.accounts !== 30 || before.policies !== 0 || before.ready !== 12 ||
      before.blocked !== 4 || before.completed !== 14 || before.claimed !== 0 ||
      before.unsettled !== 0 || before.eligible_ready !== 12 || before.reset_ready !== 0)
    throw Error("drummonds_mailbox_state_changed");
  const edge = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/functions`,
    { headers: { Authorization: `Bearer ${token}` }, redirect: "error" });
  if (!edge.ok) throw Error("live_worker_inventory_unavailable");
  const worker = (await edge.json()).find((row) => row.slug === "platform-worker");
  if (worker?.version !== 93 || worker.status !== "ACTIVE" || worker.verify_jwt !== false)
    throw Error("verified_live_worker_required");
  if (mode === "--apply-live") {
    const rehearsal = JSON.parse(readFileSync(REHEARSAL, "utf8"));
    if (rehearsal.state !== "rehearsed_rolled_back" || rehearsal.sha256 !== sha256 ||
        Date.now() - Date.parse(rehearsal.completedAt) > 3600000)
      throw Error("fresh_exact_activation_rehearsal_required");
  }
  let staged;
  try {
    staged = await query(token, mutation + (mode === "--rehearse-live" ? "rollback;" : "commit;"), false);
  } catch (error) {
    const afterUnknown = (await query(token, counts))[0];
    if (afterUnknown?.policies !== 0 || afterUnknown.reset_ready !== 0)
      throw Error("activation_outcome_uncertain_inspect_before_retry");
    throw error;
  }
  const after = (await query(token, counts))[0];
  const rehearsal = mode === "--rehearse-live";
  if (!Array.isArray(staged) || !staged.some((row) => row.reset_count === 12) ||
      (rehearsal
        ? after?.policies !== 0 || after.reset_ready !== 0
        : after?.policies !== 30 || after.reset_ready !== 12 || after.unsettled !== 0))
    throw Error("activation_readback_mismatch");
  const receipt = { state: rehearsal ? "rehearsed_rolled_back" : "activated",
    projectRef: PROJECT, tenantId: TENANT, cutoff: CUTOFF, sha256,
    resetReady: 12, retainedMessagesPreserved: true, completedAt: new Date().toISOString() };
  if (rehearsal) writeFileSync(REHEARSAL, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(receipt));
}
main().catch((error) => {
  console.error(JSON.stringify({ state: "horizon_activation_unconfirmed",
    code: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
});
