// Local-only: notification handoff proof. Rolls back all schema and fixtures.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const migration = (name) =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")
    .replace(/^begin;\s*$/gim, "")
    .replace(/^commit;\s*$/gim, "");
const sql = `begin;
do $install$ begin if to_regclass('public.receptionist_practice_sessions') is null then execute $practice$${migration("20261020120000_receptionist_practice.sql")}$practice$;end if;end $install$;
${migration("20261022120000_receptionist_care_loop.sql")}
${migration("20261022130000_receptionist_care_delivery.sql")}
${migration("20261022145000_receptionist_notification_cutover.sql")}
create temp table ids as select gen_random_uuid() tenant,gen_random_uuid() admin_id,gen_random_uuid() client_id,gen_random_uuid() feedback,gen_random_uuid() already_sent,gen_random_uuid() programme_note,gen_random_uuid() worker_receipt;
grant select on ids to authenticated;
insert into public.tenants(id,slug,display_name) select tenant,'cutover-proof-'||tenant,'Cutover proof' from ids;
insert into auth.users(id,email) select admin_id,'cutover-admin-'||admin_id||'@example.invalid' from ids union all select client_id,'cutover-client-'||client_id||'@example.invalid' from ids;
insert into public.profiles(id,tenant_id,role) select admin_id,tenant,'owner' from ids union all select client_id,tenant,'viewer' from ids on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.platform_authority_grants(profile_id,permission,granted_by) select admin_id,'platform.controlplane.admin','proof' from ids;
insert into public.receptionist_workspaces(tenant_id,company,name,assistant_id,vapi_secret_name) select tenant,'Proof','Emma',gen_random_uuid(),'RECEPTIONIST_VAPI_PROOF' from ids;
insert into public.receptionist_review_settings(tenant_id) select tenant from ids;
insert into public.receptionist_feedback(id,tenant_id,author_id,title,body) select feedback,tenant,client_id,'Feedback','Inspect the greeting.' from ids;
insert into public.client_notification_outbox(tenant_id,source_type,source_id) select tenant,'programme_note',programme_note from ids;
create function pg_temp.ok(b boolean,t text) returns void language plpgsql as $$begin if b is distinct from true then raise exception 'FAIL %',t;end if;raise notice 'PASS %',t;end$$;
create function pg_temp.refuses(q text,t text,expected text default null) returns void language plpgsql as $$declare b boolean:=false;begin begin execute q;exception when others then if expected is not null and sqlstate<>expected then raise;end if;b:=true;end;perform pg_temp.ok(b,t);end$$;
select pg_temp.ok(public.care_legacy_handoff_safe('queued',0,null,null),'never-attempted report can hand off');
select pg_temp.ok(not public.care_legacy_handoff_safe('queued',1,null,null),'reset-to-queued prior attempt remains uncertain');
select pg_temp.ok(public.care_legacy_handoff_safe('failed',1,e,null),'known first-attempt pre-Slack failure is safe: '||e)
from unnest(array['Notification routing could not be verified','Slack delivery not configured','Invalid Slack destination','Feedback context unavailable','Practice report binding unavailable','Practice provider unavailable','Practice call unavailable','Practice call scope mismatch','Practice call still processing']) e;
select pg_temp.ok(not public.care_legacy_handoff_safe('failed',2,'Slack delivery not configured',null),'later pre-send error cannot erase earlier ambiguous send');
select pg_temp.ok(not public.care_legacy_handoff_safe('failed',10,'Practice call still processing',null),'many attempts remain uncertain without their history');
select pg_temp.ok(not public.care_legacy_handoff_safe('failed',1,e,null),'ambiguous failure cannot hand off: '||e)
from unnest(array['Delivery receipt not saved','Slack did not confirm delivery','Delivery failed','Failed to fetch','The operation was aborted due to timeout']) e;
select pg_temp.ok(not public.care_legacy_handoff_safe('failed',1,'Slack delivery not configured',now()),'previous sent timestamp cannot be disregarded by a later failure');
select pg_temp.ok(not public.care_legacy_handoff_safe('sending',1,null,null),'in-flight attempt is not safe handoff');
select pg_temp.ok(not public.care_legacy_handoff_safe(null,null,null,null),'unknown legacy state fails closed');
select pg_temp.ok((select count(*)=0 from public.care_claim_alerts()),'new delivery cannot race legacy before explicit cutover');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select pg_temp.refuses('select public.care_record_worker_readiness(''care-worker-v1'')','admin cannot forge deployed-worker receipt','42501');
select pg_temp.refuses(format('select public.care_enable_notifications(%L,%L)',tenant,worker_receipt),'missing readiness refuses cutover') from ids;
reset role;
update ids set worker_receipt=public.care_record_worker_readiness('care-worker-v1');
set local role authenticated;
select pg_temp.refuses(format('select public.care_enable_notifications(%L,%L)',tenant,worker_receipt),'unverified Slack routes refuse cutover') from ids;
reset role;
insert into public.module_alert_routes(tenant_id,kind,team_id,channel_id,verified_at,verification_receipt,enabled)
select tenant,k,'TPROOF','CPROOF',now(),'{"channel":"CPROOF","ts":"1790000000.000001"}'::jsonb,true from ids cross join unnest(array['updates','attention','urgent']) k;
update public.client_notification_outbox set state='sending' where source_id=(select feedback from ids);
set local role authenticated;
select pg_temp.refuses(format('select public.care_enable_notifications(%L,%L)',tenant,worker_receipt),'inflight legacy send refuses cutover') from ids;
reset role;
update public.client_notification_outbox set state='failed',attempts=1,last_error='Delivery receipt not saved' where source_id=(select feedback from ids);
set local role authenticated;
select pg_temp.refuses(format('select public.care_enable_notifications(%L,%L)',tenant,worker_receipt),'lost database receipt refuses cutover with explicit uncertainty','55000') from ids;
reset role;
select pg_temp.ok((select not care_notifications_enabled from public.receptionist_review_settings s,ids p where s.tenant_id=p.tenant),'uncertain delivery leaves new lane disabled');
select pg_temp.ok((select count(*)=0 from public.client_notification_handoffs h,ids p where h.tenant_id=p.tenant),'uncertain delivery creates no handoff receipt');
select pg_temp.refuses(format('select public.care_handoff_notification(%L)',o.id),'direct service handoff also refuses ambiguous failure','55000') from public.client_notification_outbox o,ids p where o.source_id=p.feedback;
update public.client_notification_outbox set state='failed',attempts=2,last_error='Slack delivery not configured' where source_id=(select feedback from ids);
set local role authenticated;
select pg_temp.refuses(format('select public.care_enable_notifications(%L,%L)',tenant,worker_receipt),'latest pre-Slack error cannot hide earlier attempt history','55000') from ids;
reset role;
-- Known first-attempt pre-Slack failure can migrate; a confirmed earlier report must not repeat.
update public.client_notification_outbox set state='failed',attempts=1,last_error='Slack delivery not configured' where source_id=(select feedback from ids);
insert into public.receptionist_feedback(id,tenant_id,author_id,title,body) select already_sent,tenant,client_id,'Previously delivered feedback','This was already delivered through the earlier dispatcher.' from ids;
update public.client_notification_outbox set state='sent',attempts=1,sent_at=now(),last_error=null where source_id=(select already_sent from ids);
set local role authenticated;
select public.care_issue_action(i.tenant_id,i.id,1,'claim') from public.receptionist_care_issues i,ids p where i.feedback_id=p.already_sent;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select client_id::text from ids),true);
select pg_temp.refuses(format('select public.care_enable_notifications(%L,%L)',tenant,worker_receipt),'client cannot change notification ownership','42501') from ids;
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select pg_temp.ok(public.care_enable_notifications(tenant,worker_receipt)=1,'one old report handed off atomically') from ids;
select pg_temp.ok((select care_notifications_enabled from public.receptionist_review_settings s,ids p where s.tenant_id=p.tenant),'new lane enabled only after gated cutover');
select pg_temp.ok((select state='superseded' and sent_at is null from public.client_notification_outbox o,ids p where o.source_id=p.feedback),'handoff is not fabricated Slack delivery');
select pg_temp.ok((select count(*)=1 from public.client_notification_handoffs h,ids p where h.tenant_id=p.tenant),'durable old-to-new mapping retained');
select pg_temp.ok((select state='queued' from public.client_notification_outbox o,ids p where o.source_id=p.programme_note),'programme note left untouched');
select pg_temp.ok((select a.state='superseded' and a.sent_at is null and a.receipt_ts is null and a.last_error='legacy_delivery_already_confirmed' from public.receptionist_alert_outbox a join public.receptionist_care_issues i on i.id=a.issue_id join ids p on p.already_sent=i.feedback_id where a.issue_version=1),'legacy-confirmed initial report suppressed without fake new delivery receipt');
select pg_temp.ok((select a.state='queued' from public.receptionist_alert_outbox a join public.receptionist_care_issues i on i.id=a.issue_id join ids p on p.already_sent=i.feedback_id where a.issue_version=2),'new operator progress remains queued even when initial report was delivered');
select pg_temp.ok(public.care_enable_notifications(tenant,worker_receipt)=0,'cutover replay performs no duplicate handoff') from ids;
reset role;
select pg_temp.ok((select count(*)=1 from public.claim_client_notifications()),'only programme note can use legacy dispatcher after cutover');
select pg_temp.ok(not public.care_legacy_notification_allowed((select id from public.client_notification_outbox o,ids p where o.source_id=p.feedback)),'runtime guard blocks superseded legacy report');
select pg_temp.ok(public.care_legacy_notification_allowed((select id from public.client_notification_outbox o,ids p where o.source_id=p.programme_note)),'runtime guard permits programme note');
select pg_temp.ok((select count(*)=2 from public.care_claim_alerts()),'new delivery claims handed-off report and new progress but not old sent report');
insert into public.receptionist_feedback(tenant_id,author_id,title,body) select tenant,client_id,'Next feedback','Another test.' from ids;
select pg_temp.ok((select count(*)=2 from public.client_notification_handoffs h,ids p where h.tenant_id=p.tenant),'new feedback immediately enters managed lane');
select pg_temp.ok((select count(*)=0 from public.client_notification_outbox o,ids p where o.tenant_id=p.tenant and o.source_type='receptionist_feedback' and o.state in ('queued','sending','failed')),'no new receptionist report remains eligible for legacy delivery');
update public.care_worker_readiness set observed_at=now()-interval '16 minutes';
set local role authenticated;
select pg_temp.refuses(format('select public.care_enable_notifications(%L,%L)',tenant,worker_receipt),'stale worker receipt cannot authorise cutover') from ids;
reset role;
rollback;`;
execFileSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_serviceos-dh",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  { input: sql, stdio: ["pipe", "pipe", "inherit"] },
);
console.log("Notification cutover proof passed; all schema and fixtures rolled back.");
