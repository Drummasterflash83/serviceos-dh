// Local-only proof: synthetic data and schema roll back together.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const migration = readFileSync(
  new URL("../supabase/migrations/20261023120000_operator_notifications.sql", import.meta.url),
  "utf8",
)
  .replace(/^begin;\s*$/gim, "")
  .replace(/^commit;\s*$/gim, "");
const sql = `begin;
${migration}
create temp table proof_ids as select gen_random_uuid() t, gen_random_uuid() admin_id, gen_random_uuid() user_id;
grant select on proof_ids to authenticated,service_role;
insert into public.tenants(id,slug,display_name) select t,'notification-proof-'||t,'Synthetic proof' from proof_ids;
insert into auth.users(id,email) select admin_id,'admin-'||admin_id||'@example.invalid' from proof_ids union all select user_id,'user-'||user_id||'@example.invalid' from proof_ids;
insert into public.profiles(id,tenant_id,role) select admin_id,t,'owner' from proof_ids union all select user_id,t,'viewer' from proof_ids on conflict(id) do update set tenant_id=excluded.tenant_id;
insert into public.platform_authority_grants(profile_id,permission,granted_by) select admin_id,'platform.controlplane.admin','local-proof' from proof_ids;
create function pg_temp.check_that(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label;end$$;
create function pg_temp.refuses(command text,label text,expected text default null) returns void language plpgsql as $$declare blocked boolean:=false;begin begin execute command; exception when others then if expected is not null and sqlstate<>expected then raise; end if; blocked:=true;end;perform pg_temp.check_that(blocked,label);end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from proof_ids),true);
select pg_temp.refuses('select public.notification_slack_token()','client cannot read bot token','42501');
select pg_temp.refuses('select * from public.operator_slack_connection','client cannot read connection secret reference','42501');
select pg_temp.refuses('select notification_route from public.client_notification_outbox','client cannot read internal Slack route','42501');
select pg_temp.refuses(format('select public.notification_connect_slack(%L,%L,%L,%L,%L)',admin_id,'T0BLG3N4KN1','OpenFolk','B123','xoxb-synthetic'),'client cannot impersonate admin in RPC','42501') from proof_ids;
reset role;
set local role service_role;
select pg_temp.refuses(format('select public.notification_require_actor(%L)',user_id),'service cannot attribute settings to non-admin','42501') from proof_ids;
select public.notification_connect_slack(admin_id,'T0BLG3N4KN1','OpenFolk','B123','xoxb-synthetic-only') from proof_ids;
select pg_temp.check_that(public.notification_slack_token()='xoxb-synthetic-only','Vault token available only to service');
select pg_temp.refuses(format('select public.notification_connect_slack(%L,%L,%L,%L,NULL)',admin_id,'T0BLG3N4KN1','OpenFolk','B123'),'null bot token rejected') from proof_ids;
select pg_temp.refuses(format('select public.notification_connect_slack(%L,%L,%L,%L,%L)',admin_id,'OTHER','Other','B123','xoxb-synthetic'),'wrong workspace rejected') from proof_ids;
select pg_temp.check_that(public.notification_save_route(admin_id,t,'practice_feedback',0,'T0BLG3N4KN1','C123','ai-emma','123.000001')=1,'verified route saved with version') from proof_ids;
select pg_temp.refuses(format('select public.notification_save_route(%L,%L,%L,0,%L,%L,%L,%L)',admin_id,t,'practice_feedback','T0BLG3N4KN1','C123','ai-emma','123.000001'),'stale route rejected','40001') from proof_ids;
reset role;
select pg_temp.check_that((select count(*) from public.controlplane_change_log c,proof_ids p where c.actor=p.admin_id::text and c.action like 'notifications.%')=2,'connection and route audited without token');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from proof_ids),true);
select pg_temp.check_that((select count(*) from public.operator_notification_routes)=0,'client cannot see admin routes');
select set_config('request.jwt.claim.sub',(select admin_id::text from proof_ids),true);
select pg_temp.check_that((select count(*) from public.operator_notification_routes)=1,'admin can see route metadata');
select pg_temp.refuses('update public.operator_notification_routes set channel_name=''wrong''','direct route mutation denied','42501');
select pg_temp.refuses('select public.notification_slack_token()','even admin browser cannot read bot token','42501');
reset role;
insert into public.view_as_context(tenant_id,actor_user_id,subject_kind,reason) select t,admin_id,'role','proof' from proof_ids;
set local role service_role;
select pg_temp.refuses(format('select public.notification_require_actor(%L)',admin_id),'View-As mutation refused','42501') from proof_ids;
reset role;
insert into public.client_notification_outbox(tenant_id,source_type,source_id,slack_phase) select t,'proof',gen_random_uuid(),phase from proof_ids cross join (values(null),('prepared'),('posting'),('uncertain'),('confirmed')) as phases(phase);
create temp table claimed as select * from public.claim_client_notifications();
select pg_temp.check_that((select count(*) from claimed where source_type='proof')=2,'only unsent or prepared jobs reclaimed; posting/uncertain/confirmed held');
select pg_temp.check_that((select count(*) from public.client_notification_outbox where source_type='proof' and slack_phase in ('posting','uncertain','confirmed') and attempts=0)=3,'held sends not retried');
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
console.log("Notifications proof passed; all fixtures and schema rolled back.");
