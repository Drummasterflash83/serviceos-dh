/** Rollback-only TEST check that unsupported zero-record continuation is rejected. */
import { randomUUID } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--test-rollback-only" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Exact TEST rollback-only settlement mode required");
const tenant = randomUUID(), job = randomUUID(), request = randomUUID();
const sql = `begin;
insert into public.tenants(id,slug,display_name,status,metadata)
 values('${tenant}'::uuid,'synthetic-email-settle-${tenant}',
 'Synthetic Email settlement guard','active','{"synthetic":true}'::jsonb);
insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,
 job_key,status,priority,max_attempts,payload,claimed_by,attempt_count,lease_expires_at)
 values('${job}'::uuid,'${tenant}'::uuid,'openfolk-core','core.interactions',
 'interactions.sync','interactions.sync:${tenant}:email','running',50,2,
 '{"source":"email","limit":1}'::jsonb,'synthetic-guard-worker',1,
 clock_timestamp()+interval '5 minutes');
do $$declare accepted boolean:=false;
begin
 begin
  perform public.learn_processing_settle('${tenant}'::uuid,'${job}'::uuid,
   'synthetic-guard-worker',1,'${request}'::uuid,
   '{"success":true,"records_processed":0,"result":{"interactions_upserted":0,"skipped":1,"failed":0,"review_required":0,"reviews_recorded":0,"continued":true},"continue":true,"retryable":false,"error_code":null}'::jsonb,'settle');
  accepted:=true;
 exception when sqlstate 'PT409' then
  if sqlerrm<>'processing_unchanged_receipts_unconfirmed'
   then raise exception 'unexpected_settlement_rejection';end if;
 end;
 if accepted then raise exception 'forged_unchanged_continuation_accepted';end if;
 if exists(select 1 from public.learn_processing_settlements
  where job_id='${job}'::uuid) then raise exception 'forged_settlement_saved';end if;
end$$;
rollback;`;
const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql, read_only: false }),
});
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  throw Error(`TEST settlement guard HTTP ${response.status} (${typeof detail.code === "string" ? detail.code : "unknown"})`);
}
const readback = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" },
  body: JSON.stringify({ query: `select count(*)::int remaining from public.tenants where id='${tenant}'::uuid` }),
});
const rows = await readback.json();
if (!readback.ok || rows.length !== 1 || rows[0].remaining !== 0)
  throw Error("TEST settlement guard rollback unconfirmed");
console.log(JSON.stringify({ state: "email_settlement_forgery_rejected",
  project: TEST_PROJECT, forgedContinuationSaved: false,
  rollbackVerified: true, providerRequests: 0, productionDataWrites: false }));
