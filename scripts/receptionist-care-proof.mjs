// Local-only proof: complete transaction rolls back. Never contacts production.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const migration = readFileSync(
  new URL("../supabase/migrations/20261022120000_receptionist_care_loop.sql", import.meta.url),
  "utf8",
)
  .replace(/^begin;\s*$/gim, "")
  .replace(/^commit;\s*$/gim, "");
const sql = `begin;
${migration}
create temp table ids as select gen_random_uuid() tenant,gen_random_uuid() other_tenant,gen_random_uuid() admin_id,gen_random_uuid() client_id,gen_random_uuid() feedback,gen_random_uuid() call_id;
grant select on ids to authenticated;
insert into public.tenants(id,slug,display_name) select tenant,'care-proof-'||tenant,'Care proof' from ids union all select other_tenant,'care-proof-'||other_tenant,'Other proof' from ids;
insert into auth.users(id,email) select admin_id,'care-admin-'||admin_id||'@example.invalid' from ids union all select client_id,'care-client-'||client_id||'@example.invalid' from ids;
insert into public.profiles(id,tenant_id,role) select admin_id,tenant,'owner' from ids union all select client_id,other_tenant,'viewer' from ids on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.platform_authority_grants(profile_id,permission,granted_by) select admin_id,'platform.controlplane.admin','proof' from ids;
insert into public.receptionist_workspaces(tenant_id,company,name,assistant_id,vapi_secret_name) select tenant,'Proof','Emma',gen_random_uuid(),'RECEPTIONIST_VAPI_PROOF' from ids;
insert into public.receptionist_feedback(id,tenant_id,author_id,title,body) select feedback,tenant,admin_id,'Repeated opening hours','The greeting repeats.' from ids;
create function pg_temp.ok(b boolean,t text) returns void language plpgsql as $$begin if b is distinct from true then raise exception 'FAIL %',t;end if;raise notice 'PASS %',t;end$$;
create function pg_temp.refuses(q text,t text,expected text default null) returns void language plpgsql as $$declare b boolean:=false;begin begin execute q;exception when others then if expected is not null and sqlstate<>expected then raise;end if;b:=true;end;perform pg_temp.ok(b,t);end$$;
select pg_temp.ok((select count(*)=1 from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback),'feedback atomically creates one issue');
select pg_temp.ok((select count(*)=1 from public.receptionist_care_events e,ids p where e.tenant_id=p.tenant),'creation history recorded');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select client_id::text from ids),true);
select pg_temp.ok((select count(*)=0 from public.receptionist_care_issues),'client cannot read internal queue');
select pg_temp.refuses(format('select public.care_customer_progress(%L)',tenant),'cross-tenant progress refused','42501') from ids;
select pg_temp.refuses(format('select public.care_save_settings(%L,0,%L,true)',tenant,'Rules'),'client cannot enable analysis','42501') from ids;
select pg_temp.refuses(format('select public.care_save_alert_route(%L,%L,%L,%L)',tenant,'urgent','TTEST','CTEST'),'client cannot redirect alerts','42501') from ids;
select pg_temp.refuses('insert into public.receptionist_call_reviews values(null,null,null,null,null,null,null,null)','client cannot forge review','42501');
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select pg_temp.ok(public.care_save_settings(tenant,0,'Do not repeat opening hours.',true)=1,'admin can approve rules') from ids;
select pg_temp.refuses(format('select public.care_save_settings(%L,0,%L,true)',tenant,'Stale rules'),'stale rules refused','40001') from ids;
select pg_temp.refuses(format('select public.care_save_settings(%L,1,%L,true)',tenant,''),'empty enabled rules refused') from ids;
select public.care_save_alert_route(tenant,'urgent','TTEST','CTEST') from ids;
select pg_temp.ok((select not enabled and verified_at is null from public.module_alert_routes r,ids p where r.tenant_id=p.tenant),'new Slack route is not trusted');
select pg_temp.refuses(format('update public.module_alert_routes set enabled=true where tenant_id=%L',tenant),'operator cannot forge Slack verification','42501') from ids;
select pg_temp.refuses(format('select public.care_issue_action(%L,%L,1,%L)',i.tenant_id,i.id,'approve'),'cannot approve unreviewed issue') from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback;
select public.care_issue_action(i.tenant_id,i.id,1,'claim') from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback;
select pg_temp.ok((select stage='reviewing' and owner_id=p.admin_id from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback),'claim stores real owner');
select pg_temp.refuses(format('select public.care_issue_action(%L,%L,1,%L)',i.tenant_id,i.id,'claim'),'stale issue action refused','40001') from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback;
select public.care_issue_action(i.tenant_id,i.id,2,'propose','{"diagnosis":"Repeated hours","proposal":"Shorten the reply","test_plan":"Retest closed hours and emergencies"}') from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback;
select public.care_issue_action(i.tenant_id,i.id,3,'approve') from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback;
select pg_temp.ok((select approved_by=p.admin_id and stage='approved' and release_ref is null from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback),'approval is not deployment');
select pg_temp.refuses(format('select public.care_issue_action(%L,%L,4,%L)',i.tenant_id,i.id,'resolve'),'cannot claim unverified fix') from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback;
select pg_temp.refuses(format('update public.receptionist_feedback set status=%L where id=%L','Resolved',feedback),'legacy UI cannot bypass verified closure') from ids;
select public.care_issue_action(i.tenant_id,i.id,4,'propose','{"diagnosis":"Updated diagnosis","proposal":"Different reply","test_plan":"Different retest"}') from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback;
select pg_temp.ok((select approved_by is null and stage='approval' from public.receptionist_care_issues i,ids p where i.feedback_id=p.feedback),'changing proposal invalidates approval');
reset role;
insert into public.receptionist_access(tenant_id,profile_id) select tenant,client_id from ids;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select client_id::text from ids),true);
select pg_temp.ok((select count(*)=1 from public.care_customer_progress((select tenant from ids))),'client sees own progress projection');
select pg_temp.ok((select count(*)=0 from public.receptionist_care_events),'client cannot read internal audit');
reset role;
insert into public.view_as_context(tenant_id,actor_user_id,subject_kind,reason) select tenant,admin_id,'role','proof' from ids;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select pg_temp.refuses(format('select public.care_save_settings(%L,1,%L,true)',tenant,'Preview edit'),'View-As cannot configure review','42501') from ids;
reset role;
select public.care_store_review(tenant,call_id,repeat('a',64),'proof-v1','{"summary":"Repetition","findings":[{"category":"repetition","severity":"normal","evidence":"Repeated","explanation":"Repeat","suggestedChange":"Shorten"}],"limitations":["Text only"]}') from ids;
select pg_temp.ok(not public.care_store_review(tenant,call_id,repeat('a',64),'proof-v1','{"summary":"Repetition","findings":[],"limitations":[]}'),'review replay is idempotent') from ids;
select pg_temp.ok((select count(*)=2 from public.receptionist_care_issues i,ids p where i.tenant_id=p.tenant),'replay did not duplicate issue');
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
console.log("Care proof passed; all fixtures and schema rolled back.");
