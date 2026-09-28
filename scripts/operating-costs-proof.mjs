// Local disposable transaction only. No production access or payments.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const migration = readFileSync(
  new URL("../supabase/migrations/20261022160000_openfolk_operating_costs.sql", import.meta.url),
  "utf8",
)
  .replace(/^begin;\s*$/gim, "")
  .replace(/^commit;\s*$/gim, "");
const sql = `begin;
${migration}
create temp table ids as select gen_random_uuid() tenant,gen_random_uuid() admin_id,gen_random_uuid() client_id;
grant select on ids to authenticated;
insert into public.tenants(id,slug,display_name) select tenant,'cost-proof-'||tenant,'Cost proof' from ids;
insert into auth.users(id,email) select admin_id,'cost-admin-'||admin_id||'@example.invalid' from ids union all select client_id,'cost-client-'||client_id||'@example.invalid' from ids;
insert into public.profiles(id,tenant_id,role) select admin_id,tenant,'owner' from ids union all select client_id,tenant,'owner' from ids on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.platform_authority_grants(profile_id,permission,granted_by) select admin_id,'platform.controlplane.admin','proof' from ids;
create function pg_temp.ok(b boolean,t text) returns void language plpgsql as $$begin if b is distinct from true then raise exception 'FAIL %',t;end if;raise notice 'PASS %',t;end$$;
create function pg_temp.refuses(q text,t text,expected text default null) returns void language plpgsql as $$declare b boolean:=false;begin begin execute q;exception when others then if expected is not null and sqlstate<>expected then raise;end if;b:=true;end;perform pg_temp.ok(b,t);end$$;
set local role anon;
select pg_temp.refuses('select public.costs_overview()','anonymous cannot see costs','42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select client_id::text from ids),true);
select pg_temp.refuses('select public.costs_overview()','client owner cannot see OpenFolk expenses','42501');
select pg_temp.refuses($q$select public.costs_add_account('vapi','org','Vapi','USD','prepaid',20)$q$,'client cannot create cost account','42501');
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select pg_temp.ok(public.costs_overview()->'accounts'='[]'::jsonb,'empty accounts are not seeded with guessed funding');
select public.costs_add_account('vapi','proof-org','Vapi proof','USD','prepaid',20,array[tenant,tenant]) from ids;
select pg_temp.ok(jsonb_array_length(public.costs_overview()->'accounts')=1,'admin registers account');
select pg_temp.ok(jsonb_array_length(public.costs_overview()->'accounts'->0->'clients')=1,'shared account client assignment deduplicates');
select pg_temp.ok(public.costs_overview()->'accounts'->0->'latest'='null'::jsonb,'new account has no fabricated observation');
select pg_temp.ok(public.costs_overview()->>'automatic_monitoring'='false','manual foundation never claims automated alerts');
select pg_temp.refuses($q$select public.costs_add_account('vapi','proof-org','Duplicate','USD','prepaid',20)$q$,'duplicate provider account refused','23505');
select pg_temp.refuses($q$select public.costs_add_account('vapi','new-org','Invalid','USD','prepaid',20,array['ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid])$q$,'unknown tenant refused','23503');
select pg_temp.ok(jsonb_array_length(public.costs_overview()->'accounts')=1,'failed client binding rolls back account');
select pg_temp.refuses($q$select public.costs_add_account('vapi','bad-currency','Invalid','ZZZ','prepaid',20)$q$,'invalid currency refused','23514');
select pg_temp.refuses($q$select public.costs_add_account('vapi','bad-threshold','Invalid','USD','prepaid','NaN')$q$,'NaN refused','23514');
select pg_temp.refuses('select * from public.openfolk_cost_checks','direct audit reads require governed function','42501');
select pg_temp.ok(public.costs_record_check((public.costs_overview()->'accounts'->0->>'id')::uuid,0,now(),0,12,current_date,current_date,'off','okay','dashboard','Billing screen')=1,'admin saves check');
select pg_temp.ok(public.costs_overview()->'accounts'->0->'latest'->>'balance'='0','zero credit preserved');
select pg_temp.refuses(format($q$select public.costs_record_check(%L,0,now(),100,null,null,null,'on','okay','dashboard','Replay')$q$,public.costs_overview()->'accounts'->0->>'id'),'stale replay refused','40001');
select pg_temp.refuses(format($q$select public.costs_record_check(%L,1,now()+interval '1 hour',100,null,null,null,'on','okay','dashboard','Future')$q$,public.costs_overview()->'accounts'->0->>'id'),'future observation refused');
select pg_temp.refuses(format($q$select public.costs_record_check(%L,1,now()-interval '1 day',100,null,null,null,'on','okay','dashboard','Old')$q$,public.costs_overview()->'accounts'->0->>'id'),'older observation cannot hide latest');
select pg_temp.refuses(format($q$select public.costs_record_check(%L,1,now(),100,12,null,null,'on','okay','dashboard','No period')$q$,public.costs_overview()->'accounts'->0->>'id'),'spend without period refused','23514');
select pg_temp.refuses(format($q$select public.costs_record_check(%L,1,now(),100,-1,current_date,current_date,'on','okay','dashboard','Negative spend')$q$,public.costs_overview()->'accounts'->0->>'id'),'negative spend refused','23514');
select pg_temp.refuses(format($q$select public.costs_record_check(%L,1,now(),100,null,null,null,'on','okay','api','Forged source')$q$,public.costs_overview()->'accounts'->0->>'id'),'manual entry cannot claim API verification','23514');
select pg_temp.ok(public.costs_overview()->'accounts'->0->>'version'='1','refused checks do not advance version');
select pg_temp.ok(public.costs_record_check((public.costs_overview()->'accounts'->0->>'id')::uuid,1,now(),null,null,null,null,'unknown','unknown','invoice','No balance on invoice')=2,'missing amounts can be recorded honestly');
select pg_temp.ok(public.costs_overview()->'accounts'->0->'latest'->'balance'='null'::jsonb,'missing balance stays null');
select pg_temp.refuses('update public.openfolk_cost_checks set balance=100','operator cannot rewrite check history','42501');
select pg_temp.refuses('delete from public.openfolk_cost_checks','operator cannot delete check history','42501');
reset role;
select pg_temp.ok((select count(*)=2 from public.openfolk_cost_checks),'both checks retained');
select pg_temp.ok((select bool_and(recorded_by=admin_id) from public.openfolk_cost_checks,ids),'actor server derived');
insert into public.view_as_context(tenant_id,actor_user_id,subject_kind,reason) select tenant,admin_id,'role','proof' from ids;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select pg_temp.refuses('select public.costs_overview()','client preview cannot disclose OpenFolk costs','42501');
select pg_temp.refuses($q$select public.costs_add_account('vapi','preview','Vapi','USD','prepaid',20)$q$,'client preview cannot edit costs','42501');
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
console.log("Cost proof passed; all schema and fixtures rolled back.");
