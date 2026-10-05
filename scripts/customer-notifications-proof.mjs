// Local database only. Synthetic fixtures and schema are always rolled back.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const migration = (name) =>
  readFileSync(new URL("../supabase/migrations/" + name, import.meta.url), "utf8")
    .replace(/^begin;\s*$/gim, "")
    .replace(/^commit;\s*$/gim, "");
const sql = `begin;
${migration("20261020120000_receptionist_practice.sql")}
${migration("20261022120000_receptionist_care_loop.sql")}
${migration("20261023170000_customer_notifications.sql")}
create temp table ids as select gen_random_uuid() t, gen_random_uuid() other_t,gen_random_uuid() u,gen_random_uuid() outsider,gen_random_uuid() feedback;
grant select on ids to authenticated,service_role;
insert into public.tenants(id,slug,display_name) select t,'notify-'||t,'Synthetic' from ids union all select other_t,'other-'||other_t,'Other' from ids;
insert into auth.users(id,email) select u,u||'@example.invalid' from ids union all select outsider,outsider||'@example.invalid' from ids;
insert into public.profiles(id,tenant_id,role) select u,t,'viewer' from ids union all select outsider,other_t,'viewer' from ids on conflict(id) do update set tenant_id=excluded.tenant_id;
insert into public.client_portal_access(tenant_id,profile_id) select t,u from ids;
insert into public.receptionist_workspaces(tenant_id,company,name,assistant_id,vapi_secret_name) select t,'Synthetic','Emma',gen_random_uuid(),'RECEPTIONIST_VAPI_PROOF' from ids;
create function pg_temp.ok(b boolean,s text) returns void language plpgsql as $$begin if b is distinct from true then raise exception 'FAIL: %',s;end if;raise notice 'PASS: %',s;end$$;
create function pg_temp.refuses(q text,s text) returns void language plpgsql as $$declare b boolean:=false;begin begin execute q;exception when others then b:=true;end;perform pg_temp.ok(b,s);end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select u::text from ids),true);
select pg_temp.refuses('select * from public.customer_slack_connections','no direct credential metadata access');
select pg_temp.refuses(format('select public.customer_slack_token(%L,null)',t),'no browser credential RPC') from ids;
select pg_temp.refuses(format('select public.customer_slack_connect(%L,%L,null,''T123'',''Proof'',''B123'',''xoxb-synthetic'')',t,u),'no browser service impersonation') from ids;
reset role;
select pg_temp.ok(public.customer_notification_actor(t,u),'member can configure own workspace') from ids;
select pg_temp.ok(not public.customer_notification_actor(other_t,u),'member cannot configure another tenant') from ids;
select pg_temp.ok(not public.customer_notification_actor(t,outsider),'outsider refused') from ids;
select pg_temp.refuses(format('select public.customer_slack_connect(%L,%L,null,''T123'',''Proof'',''B123'',''xoxb-synthetic'')',t,outsider),'service cannot attribute connection to outsider') from ids;
select public.customer_slack_connect(t,u,null,'T123','Proof','B123','xoxb-synthetic') from ids;
select pg_temp.ok((select public.customer_slack_token(c.tenant_id,c.generation)='xoxb-synthetic' from public.customer_slack_connections c,ids where c.tenant_id=ids.t),'vault retrieval bound to tenant generation');
select pg_temp.ok((select public.customer_slack_token(c.tenant_id,gen_random_uuid()) is null from public.customer_slack_connections c,ids where c.tenant_id=ids.t),'wrong generation cannot retrieve token');
select pg_temp.refuses(format('select public.customer_slack_connect(%L,%L,null,''T123'',''Proof'',''B123'',''xoxb-synthetic'')',t,u),'stale connection refused') from ids;
select pg_temp.refuses(format('select public.customer_slack_connect(%L,%L,%L,''T0BLG3N4KN1'',''OpenFolk'',''B123'',''xoxb-synthetic'')',t,u,c.generation),'OpenFolk workspace cannot become a client connection') from ids join public.customer_slack_connections c on c.tenant_id=ids.t;
select public.customer_notification_route_save(t,u,c.generation,e,0,'C123','client-updates','123.001',true) from ids join public.customer_slack_connections c on c.tenant_id=ids.t cross join (values('progress'),('resolved'),('urgent')) events(e);
select pg_temp.refuses(format('select public.customer_notification_route_save(%L,%L,%L,''progress'',0,''C123'',''client-updates'',''123.001'',true)',t,u,c.generation),'stale route save refused') from ids join public.customer_slack_connections c on c.tenant_id=ids.t;
insert into public.receptionist_feedback(id,tenant_id,author_id,title,body) select feedback,t,u,'Synthetic','Private feedback never sent to Slack' from ids;
select pg_temp.ok((select count(*)=1 from public.customer_notification_outbox o,ids where o.tenant_id=ids.t and o.client_stage='submitted'),'submission queued once');
update public.receptionist_care_issues set stage='reviewing',version=version+1 where tenant_id=(select t from ids);
update public.receptionist_care_issues set stage='approval',version=version+1 where tenant_id=(select t from ids);
update public.receptionist_care_issues set stage='approved',version=version+1 where tenant_id=(select t from ids);
update public.receptionist_care_issues set stage='verifying',version=version+1 where tenant_id=(select t from ids);
select pg_temp.ok((select count(*)=2 from public.customer_notification_outbox o,ids where o.tenant_id=ids.t),'internal approval and testing do not spam client');
update public.receptionist_care_issues set priority='urgent',version=version+1 where tenant_id=(select t from ids);
select pg_temp.ok((select count(*)=1 from public.customer_notification_outbox o,ids where o.tenant_id=ids.t and o.event_key='urgent'),'urgent change uses urgent route');
update public.receptionist_care_issues set stage='resolved',version=version+1 where tenant_id=(select t from ids);
select pg_temp.ok((select count(*)=1 from public.customer_notification_outbox o,ids where o.tenant_id=ids.t and o.event_key='resolved'),'resolution uses resolved route');
create temp table claimed as select * from public.customer_notifications_claim();
select pg_temp.ok((select count(*)=4 from claimed),'worker claims all new events');
select pg_temp.ok((select count(*)=0 from public.customer_notifications_claim()),'no duplicate claim');
update public.customer_notification_outbox set available_at=now()-interval '10 minutes' where tenant_id=(select t from ids);
select count(*) from public.customer_notifications_claim();
select pg_temp.ok((select bool_and(state='uncertain') from public.customer_notification_outbox o,ids where o.tenant_id=ids.t),'interrupted posts are held rather than blindly resent');
select public.customer_slack_disconnect(t,u,c.generation) from ids join public.customer_slack_connections c on c.tenant_id=ids.t;
select pg_temp.ok((select public.customer_slack_token(t,c.generation) is null from ids join public.customer_slack_connections c on c.tenant_id=ids.t),'disconnect stops token retrieval');
select pg_temp.ok((select bool_and(not enabled) from public.customer_notification_routes r,ids where r.tenant_id=ids.t),'disconnect turns all client routes off');
insert into public.view_as_context(tenant_id,actor_user_id,subject_kind,reason) select t,u,'role','proof' from ids;
select pg_temp.ok(not public.customer_notification_actor(t,u),'View-As is read-only') from ids;
select pg_temp.ok((select not exists(select 1 from public.controlplane_change_log l,ids where l.tenant_id=ids.t and coalesce(l.after::text,'') like '%xoxb%')),'audit excludes credentials');
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
console.log("Client notification database proof passed; fixtures and schema rolled back.");
