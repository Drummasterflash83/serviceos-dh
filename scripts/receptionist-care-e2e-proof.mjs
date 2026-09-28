// Combined local acceptance path. ALL database changes roll back.
// Provider call, model assessment, worker readiness and Slack receipts are
// explicitly SYNTHETIC. This is not a live browser/provider/Slack delivery proof.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")
  .replace(/^begin;\s*$/gim, "").replace(/^commit;\s*$/gim, "");
const canonical = migration("20260903120000_marketing_sequences.sql")
  .match(/create or replace function serviceos_schedule_defs\(\)[\s\S]*?select \* from \(values([\s\S]+?)\) as t\(job, fn, secret, sched\);/)?.[1];
if (!canonical) throw Error("Canonical scheduler definition not found");
const sql = `begin;
create function pg_temp.ok(b boolean,t text) returns void language plpgsql as $$begin if b is distinct from true then raise exception 'FAIL %',t;end if;raise notice 'PASS %',t;end$$;
create function pg_temp.refuses(q text,t text,expected text default null) returns void language plpgsql as $$declare b boolean:=false;begin begin execute q;exception when others then if expected is not null and sqlstate<>expected then raise;end if;b:=true;end;perform pg_temp.ok(b,t);end$$;
create function pg_temp.cron_snapshot() returns jsonb language plpgsql as $$declare r jsonb;begin
 if to_regclass('cron.job') is null then return jsonb_build_object('installed',false);end if;
 execute 'select jsonb_build_object(''installed'',true,''jobs'',coalesce(jsonb_agg(to_jsonb(j) order by j.jobid),''[]''::jsonb)) from cron.job j' into r;return r;end$$;
create temp table schedules_before as select * from public.serviceos_schedule_defs();
create temp table cron_before as select pg_temp.cron_snapshot() snapshot;
create temp table canonical_fourteen as select * from (values ${canonical}) as t(job,fn,secret,sched);
do $install$ begin if to_regclass('public.receptionist_practice_sessions') is null then execute $practice$${migration("20261020120000_receptionist_practice.sql")}$practice$;end if;end $install$;
${migration("20261022120000_receptionist_care_loop.sql")}
${migration("20261022130000_receptionist_care_delivery.sql")}
${migration("20261022140000_practice_feedback_drafts.sql")}
${migration("20261022145000_receptionist_notification_cutover.sql")}
${migration("20261022150000_receptionist_care_schedule.sql")}
select pg_temp.ok((select count(*)=14 from canonical_fourteen),'all fourteen repository-canonical scheduler rows are identified');
select pg_temp.ok(not exists(select * from canonical_fourteen except select * from public.serviceos_schedule_defs()),'all fourteen canonical schedules preserved exactly');
select pg_temp.ok(not exists(select * from schedules_before except select * from public.serviceos_schedule_defs()),'every actually installed definition preserved, including commitments');
select pg_temp.ok(exists(select 1 from public.serviceos_schedule_defs() where job='serviceos-emma-care' and fn='receptionist-care-scheduled-sync' and secret='RECEPTIONIST_CARE_WORKER_SECRET' and sched='* * * * *'),'new Emma registration has exact function secret and cadence');
select pg_temp.ok((select count(*)=1 from (select * from public.serviceos_schedule_defs() except select * from schedules_before) additions),'definition adds only the Emma schedule');
select pg_temp.ok((select snapshot=pg_temp.cron_snapshot() from cron_before),'migration installs or changes no actual cron jobs');

create temp table ids as select gen_random_uuid() tenant,gen_random_uuid() admin_id,gen_random_uuid() client_id,gen_random_uuid() call_id,gen_random_uuid() session_id,gen_random_uuid() submission,gen_random_uuid() worker_receipt;
grant select on ids to authenticated,service_role;
grant update on ids to service_role;
create temp table submitted(id uuid);grant select,insert on submitted to authenticated;
create temp table review_claims (like public.receptionist_review_queue including defaults);grant select,insert on review_claims to service_role;
create temp table alert_claims (like public.receptionist_alert_outbox including defaults);grant select,insert on alert_claims to service_role;
insert into public.tenants(id,slug,display_name) select tenant,'care-e2e-'||tenant,'Synthetic Emma acceptance client' from ids;
insert into auth.users(id,email) select admin_id,'care-e2e-operator-'||admin_id||'@example.invalid' from ids union all select client_id,'care-e2e-client-'||client_id||'@example.invalid' from ids;
insert into public.profiles(id,tenant_id,role) select admin_id,tenant,'owner' from ids union all select client_id,tenant,'viewer' from ids on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.platform_authority_grants(profile_id,permission,granted_by) select admin_id,'platform.controlplane.admin','synthetic-e2e-proof' from ids;
insert into public.receptionist_workspaces(tenant_id,company,name,assistant_id,vapi_secret_name) select tenant,'Synthetic Emma acceptance client','Emma',gen_random_uuid(),'RECEPTIONIST_VAPI_SYNTHETIC' from ids;
insert into public.receptionist_access(tenant_id,profile_id) select tenant,client_id from ids;
-- Synthetic provider binding: no Vapi call is placed by this proof.
insert into public.receptionist_practice_sessions(id,tenant_id,author_id,call_id,source_version,state) select session_id,tenant,client_id,call_id,'synthetic-provider-fixture','ended' from ids;
select pg_temp.ok((select count(*)=1 from public.receptionist_review_queue q,ids p where q.tenant_id=p.tenant and q.call_id=p.call_id),'completed practice creates durable analysis work');

set local role authenticated;
select set_config('request.jwt.claim.sub',(select client_id::text from ids),true);
select pg_temp.ok((public.save_receptionist_practice_draft(session_id,submission,0,'The opening hours were repeated. Please make that response clearer.')->>'version')::integer=1,'real client authorization can autosave typed feedback') from ids;
select pg_temp.ok((select count(*)=1 from public.receptionist_practice_drafts d,ids p where d.tenant_id=p.tenant),'draft survives separately from the page');
reset role;
select pg_temp.ok((select count(*)=0 from public.receptionist_care_issues i,ids p where i.tenant_id=p.tenant),'draft alone creates no false submitted issue');
select pg_temp.ok((select count(*)=0 from public.client_notification_outbox o,ids p where o.tenant_id=p.tenant),'draft alone sends no Slack notification');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select client_id::text from ids),true);
insert into submitted select public.complete_receptionist_practice_draft(session_id,submission,1) from ids;
insert into submitted select public.complete_receptionist_practice_draft(session_id,submission,1) from ids;
select pg_temp.ok((select count(distinct id)=1 and count(*)=2 from submitted),'retrying submit returns the same feedback receipt');
select pg_temp.ok((select count(*)=1 from public.receptionist_feedback f,ids p where f.tenant_id=p.tenant),'exactly one report is persisted for the client');
select pg_temp.ok((select count(*)=0 from public.receptionist_practice_drafts d,ids p where d.tenant_id=p.tenant),'completed draft is removed only after report persistence');
select pg_temp.ok((select count(*)=1 from public.care_customer_progress((select tenant from ids)) where stage='received'),'client sees the report received');
select pg_temp.refuses('select * from public.care_claim_reviews()','client cannot invoke the private review worker','42501');
reset role;
select pg_temp.ok((select count(*)=1 from public.receptionist_care_issues i,ids p where i.tenant_id=p.tenant),'submitted feedback creates exactly one governed issue');
select pg_temp.ok((select generation=2 from public.receptionist_review_queue q,ids p where q.tenant_id=p.tenant),'feedback queues fresh call evidence without duplicating the call');

set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select pg_temp.ok(public.care_save_settings(tenant,0,'State opening hours only once, then offer the approved voicemail option.',true)=1,'operator explicitly enables review against approved rules') from ids;
reset role;
set local role service_role;
insert into review_claims select * from public.care_claim_reviews(1,180);
select pg_temp.ok((select count(*)=1 from review_claims),'service worker claims the persisted call once');
-- Grounded SYNTHETIC model result, not a live model response or audio diagnosis.
select pg_temp.ok(position('Our office is closed. Our office is closed.' in 'Emma: Our office is closed. Our office is closed. Please leave a message.')>0,'synthetic finding quote is present in its synthetic transcript');
select pg_temp.ok(public.care_complete_review(tenant_id,call_id,lease_id,repeat('e',64),'synthetic-acceptance-reviewer','{"summary":"Opening hours are repeated in this synthetic transcript.","findings":[{"category":"repetition","severity":"normal","evidence":"Our office is closed. Our office is closed.","explanation":"The same approved-hours statement is repeated consecutively.","suggestedChange":"State opening hours once before offering voicemail."}],"limitations":["Synthetic fixture; no acoustic or network diagnosis."]}'),'synthetic assessment and queue completion store atomically') from review_claims;
reset role;
select pg_temp.ok((select q.state='reviewed' and q.generation=q.completed_generation from public.receptionist_review_queue q,ids p where q.tenant_id=p.tenant),'review coverage reflects completed latest generation');
select pg_temp.ok((select count(*)=2 from public.receptionist_care_issues i,ids p where i.tenant_id=p.tenant),'grounded finding is tracked alongside the client report');

set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select public.care_issue_action(i.tenant_id,i.id,1,'claim') from public.receptionist_care_issues i where i.feedback_id=(select min(id::text)::uuid from submitted);
select public.care_issue_action(i.tenant_id,i.id,2,'propose','{"diagnosis":"The synthetic transcript repeats the opening-hours sentence.","proposal":"Use the approved opening-hours sentence once, followed by voicemail guidance.","test_plan":"Retest office-open and office-closed scenarios; ensure urgent callers retain the approved escalation path."}') from public.receptionist_care_issues i where i.feedback_id=(select min(id::text)::uuid from submitted);
select public.care_issue_action(i.tenant_id,i.id,3,'approve') from public.receptionist_care_issues i where i.feedback_id=(select min(id::text)::uuid from submitted);
select pg_temp.ok((select stage='approved' and approved_by=p.admin_id and release_ref is null from public.receptionist_care_issues i,ids p where i.feedback_id=(select min(id::text)::uuid from submitted)),'human approval is recorded without inventing deployment');
select pg_temp.refuses(format('select public.care_issue_action(%L,%L,4,''resolve'')',tenant_id,id),'unverified release cannot be marked resolved') from public.receptionist_care_issues where feedback_id=(select min(id::text)::uuid from submitted);
select set_config('request.jwt.claim.sub',(select client_id::text from ids),true);
select pg_temp.ok((select stage='approved' and message like '%not been released%' from public.care_customer_progress((select tenant from ids))),'client sees approved-but-not-released progress honestly');
select pg_temp.ok((select count(*)=0 from public.receptionist_care_events),'client cannot see private diagnoses or internal audit');
reset role;

-- SYNTHETIC channel verification and worker readiness. No Slack request is sent.
insert into public.module_alert_routes(tenant_id,kind,team_id,channel_id,verified_at,verification_receipt,enabled)
select tenant,k,'TSYNTHETIC','CSYNTHETIC',now(),'{"channel":"CSYNTHETIC","ts":"1790600000.000001","synthetic":true}'::jsonb,true from ids cross join unnest(array['updates','attention','urgent']) k;
select pg_temp.ok((select count(*)=0 from public.care_claim_alerts()),'verified routes cannot send before governed cutover');
set local role service_role;
update ids set worker_receipt=public.care_record_worker_readiness('care-worker-v1');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select pg_temp.ok(public.care_enable_notifications(tenant,worker_receipt)=1,'operator enables verified lane and atomically hands off the old report') from ids;
select pg_temp.ok(public.care_enable_notifications(tenant,worker_receipt)=0,'cutover retry adds no duplicate handoff') from ids;
reset role;
select pg_temp.ok((select count(*)=1 from public.client_notification_handoffs h,ids p where h.tenant_id=p.tenant),'handoff retains a durable old-to-new receipt map');
select pg_temp.ok((select state='superseded' and sent_at is null from public.client_notification_outbox o where o.source_id=(select min(id::text)::uuid from submitted)),'handoff is not misrepresented as a Slack send');
select pg_temp.ok(not public.care_legacy_notification_allowed((select id from public.client_notification_outbox where source_id=(select min(id::text)::uuid from submitted))),'legacy webhook is blocked after cutover');
set local role service_role;
insert into alert_claims select * from public.care_claim_alerts(10,180);
select pg_temp.ok((select count(*)=5 from alert_claims),'new lane owns report finding and three operator progress events');
select pg_temp.ok(public.care_ack_alert(id,lease_id,channel_id,'1790600100.'||lpad(n::text,6,'0')),'synthetic Slack receipt is acknowledged only for its lease')
from (select *,row_number() over(order by id) n from alert_claims) a;
reset role;
select pg_temp.ok((select count(*)=5 from public.receptionist_alert_outbox o,ids p where o.tenant_id=p.tenant and o.state='sent' and o.receipt_ts is not null),'five synthetic provider receipts are durably recorded');
select pg_temp.ok((select count(*)=0 from public.client_notification_outbox o,ids p where o.tenant_id=p.tenant and o.source_type='receptionist_feedback' and o.state in ('queued','sending','failed')),'no feedback remains eligible for duplicate legacy delivery');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select pg_temp.ok((public.care_operating_summary(tenant)#>>'{reviews,reviewed}')::integer=1 and (public.care_operating_summary(tenant)#>>'{alerts,sent}')::integer=5,'operator overview reflects the complete synthetic acceptance path') from ids;
reset role;
select pg_temp.ok((select snapshot=pg_temp.cron_snapshot() from cron_before),'full acceptance exercise changes no cron installation');
rollback;`;
execFileSync("docker", ["exec", "-i", "supabase_db_serviceos-dh", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, stdio: ["pipe", "pipe", "inherit"] });
console.log("Synthetic end-to-end database acceptance passed. Every schema and fixture change rolled back. No browser call, AI request, Slack delivery, production change or cron activation was performed.");
