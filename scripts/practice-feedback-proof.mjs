// Local database only. Every fixture and schema change is rolled back.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const migration = readFileSync(
  new URL("../supabase/migrations/20261022140000_practice_feedback_drafts.sql", import.meta.url),
  "utf8",
);
const practice = readFileSync(
  new URL("../supabase/migrations/20261020120000_receptionist_practice.sql", import.meta.url),
  "utf8",
);
const sql = `begin;
do $install$ begin
 if to_regclass('public.receptionist_practice_sessions') is null then
  execute $practice_migration$${practice}$practice_migration$;
 end if;
end $install$;
${migration}
create temp table ids as select gen_random_uuid() tenant,gen_random_uuid() other_tenant,gen_random_uuid() actor,gen_random_uuid() other_actor,gen_random_uuid() session,gen_random_uuid() other_session,gen_random_uuid() call_id,gen_random_uuid() submission;
grant select on ids to authenticated;
insert into public.tenants(id,slug,display_name) select tenant,'draft-proof-'||tenant,'Draft proof' from ids union all select other_tenant,'draft-proof-'||other_tenant,'Other proof' from ids;
insert into auth.users(id,email) select actor,'draft-'||actor||'@example.invalid' from ids union all select other_actor,'draft-'||other_actor||'@example.invalid' from ids;
insert into public.profiles(id,tenant_id,role) select actor,tenant,'owner' from ids union all select other_actor,other_tenant,'owner' from ids on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.receptionist_workspaces(tenant_id,company,name,assistant_id,vapi_secret_name) select tenant,'Proof','Emma',gen_random_uuid(),'RECEPTIONIST_VAPI_PROOF' from ids union all select other_tenant,'Other','Emma',gen_random_uuid(),'RECEPTIONIST_VAPI_PROOF' from ids;
insert into public.receptionist_access(tenant_id,profile_id) select tenant,actor from ids union all select other_tenant,other_actor from ids;
insert into public.receptionist_practice_sessions(id,tenant_id,author_id,call_id,state) select session,tenant,actor,call_id,'ended' from ids union all select other_session,other_tenant,other_actor,gen_random_uuid(),'ended' from ids;
create function pg_temp.ok(b boolean,t text) returns void language plpgsql as $$begin if b is distinct from true then raise exception 'FAIL %',t;end if;raise notice 'PASS %',t;end$$;
create function pg_temp.refuses(q text,t text,expected text default null) returns void language plpgsql as $$declare b boolean:=false;begin begin execute q;exception when others then if expected is not null and sqlstate<>expected then raise;end if;b:=true;end;perform pg_temp.ok(b,t);end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select actor::text from ids),true);
select pg_temp.ok((public.save_receptionist_practice_draft(session,submission,0,'First draft')->>'version')::integer=1,'author saves tenant-bound draft') from ids;
select pg_temp.ok((select count(*)=1 from public.receptionist_practice_drafts),'author can read acknowledged draft');
select pg_temp.ok((select count(*)=0 from public.receptionist_feedback f,ids p where f.tenant_id=p.tenant),'draft is not prematurely published as feedback');
select pg_temp.ok((select count(*)=0 from public.client_notification_outbox o,ids p where o.tenant_id=p.tenant),'typing does not create Slack notifications');
select pg_temp.ok((public.save_receptionist_practice_draft(session,submission,0,'First draft')->>'version')::integer=1,'ambiguous save retry is idempotent') from ids;
select pg_temp.refuses(format('select public.save_receptionist_practice_draft(%L,%L,0,%L)',session,submission,'Stale change'),'stale edit refused','40001') from ids;
select pg_temp.refuses(format('select public.save_receptionist_practice_draft(%L,%L,0,%L)',other_session,submission,'Foreign call'),'foreign practice session refused','42501') from ids;
select pg_temp.refuses(format('select public.save_receptionist_practice_draft(%L,%L,1,%L)',session,submission,repeat('x',3501)),'oversized draft refused','22023') from ids;
select pg_temp.refuses('update public.receptionist_practice_drafts set body=''forged''','direct draft update refused','42501');
select pg_temp.ok((public.save_receptionist_practice_draft(session,submission,1,'Final feedback')->>'version')::integer=2,'latest edit advances version') from ids;
select pg_temp.refuses(format('select public.complete_receptionist_practice_draft(%L,%L,1)',session,submission),'stale submission refused','40001') from ids;
select set_config('request.jwt.claim.sub',(select other_actor::text from ids),true);
select pg_temp.ok((select count(*)=0 from public.receptionist_practice_drafts),'other tenant cannot read the draft');
select pg_temp.refuses(format('select public.complete_receptionist_practice_draft(%L,%L,2)',session,submission),'other tenant cannot submit the draft','42501') from ids;
select set_config('request.jwt.claim.sub',(select actor::text from ids),true);
select pg_temp.ok(public.complete_receptionist_practice_draft(session,submission,2) is not null,'feedback finalisation returns a durable receipt') from ids;
select pg_temp.ok((select count(*)=0 from public.receptionist_practice_drafts),'submitted draft removed atomically');
select pg_temp.ok((select count(*)=1 from public.receptionist_feedback f,ids p where f.tenant_id=p.tenant and f.body='Final feedback' and f.call_id=p.call_id and f.practice_session_id=p.session and f.author_id=p.actor),'server binds exact author call and session');
select pg_temp.ok((select count(*)=1 from public.client_notification_outbox o,ids p where o.tenant_id=p.tenant and o.source_type='receptionist_feedback'),'one notification queued with feedback');
select pg_temp.ok(public.complete_receptionist_practice_draft(session,submission,1)=(select id from public.receptionist_feedback where submission_key=ids.submission),'lost finalisation receipt replays same feedback') from ids;
select pg_temp.ok((select count(*)=1 from public.client_notification_outbox o,ids p where o.tenant_id=p.tenant),'retry does not duplicate Slack work');
select pg_temp.refuses(format('select public.save_receptionist_practice_draft(%L,%L,0,%L)',session,submission,'Late autosave'),'late autosave cannot recreate a submitted report','40001') from ids;
select public.save_receptionist_practice_draft(session,other_session,0,'To be cleared') from ids;
select public.save_receptionist_practice_draft(session,other_session,1,'') from ids;
select pg_temp.ok(public.complete_receptionist_practice_draft(session,other_session,2) is null,'cleared draft does not fabricate feedback') from ids;
select pg_temp.ok((select count(*)=1 from public.receptionist_feedback f,ids p where f.tenant_id=p.tenant),'cleared draft leaves existing feedback unchanged');
select pg_temp.ok(public.submit_receptionist_observation(tenant,other_session,null,'Observation','Please improve this','improvement','normal') is not null,'general observation returns durable receipt') from ids;
select pg_temp.ok(public.submit_receptionist_observation(tenant,other_session,null,'Observation','Please improve this','improvement','normal')=(select id from public.receptionist_feedback where submission_key=ids.other_session),'observation retry returns same receipt') from ids;
select pg_temp.ok((select count(*)=2 from public.client_notification_outbox o,ids p where o.tenant_id=p.tenant),'observation retry creates no duplicate notification');
select pg_temp.refuses(format('select public.submit_receptionist_observation(%L,%L,null,%L,%L,%L,%L)',tenant,other_session,'Changed','Changed','improvement','normal'),'same submission cannot silently replace observation','40001') from ids;
select pg_temp.refuses(format('select public.submit_receptionist_observation(%L,%L,null,%L,%L,%L,%L)',other_tenant,gen_random_uuid(),'Foreign','Foreign','improvement','normal'),'observation cannot cross tenant','42501') from ids;
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
console.log("Practice feedback proof passed; schema and fixtures rolled back.");
