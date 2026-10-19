/** Rollback-only TEST proof. No Commusoft request, credential read or retained write. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const files = [
  "20261106120000_new_dawn_commusoft_job_detail_read.sql",
  "20261106130000_new_dawn_commusoft_opportunities_probe.sql",
  "20261106150000_new_dawn_commusoft_shared_lease.sql",
  "20261106160000_new_dawn_commusoft_shared_lease_routes.sql",
  "20261106180000_new_dawn_commusoft_lease_coexistence.sql",
  "20261107010000_new_dawn_commusoft_one_job_trial_permit.sql",
];
const rawSources = files.map(name => readFileSync(resolve(root, "supabase/migrations", name), "utf8"));
const migrations = rawSources.map((source, index) => {
  const name = files[index];
  if (!/^\s*(?:--[^\n]*\n)*begin;/i.test(source) || !/commit;\s*$/i.test(source))
    throw Error("migration_transaction_fence_changed:" + name);
  return source.replace(/\bbegin;(?=[\s\S]*)/i, "").replace(/commit;\s*$/i, "");
}).join("\n");
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const fixture = `do $$declare x record;actor uuid;trial_request_id uuid:=gen_random_uuid();
 other_id uuid:=gen_random_uuid();latest public.learn_business_input_versions%rowtype;
 result jsonb;queue_id uuid:=gen_random_uuid();d text;
begin
 for x in select l.tenant_id,l.entity_id job_id,l.connection_id,l.source_version_id,l.external_id
  from public.learn_business_input_current_links l
  join public.jobs j on j.id=l.entity_id and j.tenant_id=l.tenant_id
  join public.provider_connections c on c.id=l.connection_id and c.tenant_id=l.tenant_id
  where l.provider='commusoft' and l.collection='jobs' and l.entity_kind='job'
   and l.entity_table='jobs' and l.external_id~'^[1-9][0-9]{0,15}$'
   and c.status='configured' and c.auth_mode='private_api_key' and c.revoked_at is null
   and c.verified_at is not null and c.non_secret_config->>'region' in('uk','us')
   and j.metadata#>>'{learn_business_input,connection_id}'=l.connection_id::text
   and j.metadata#>>'{learn_business_input,source_version_id}'=l.source_version_id::text
   and j.source_system='commusoft:connection:'||l.connection_id::text loop
  latest:=public.learn_business_input_latest(x.tenant_id,x.connection_id,'commusoft','jobs',x.external_id);
  exit when latest.id=x.source_version_id;
 end loop;
 select g.profile_id into actor from public.platform_authority_grants g
  join auth.users u on u.id=g.profile_id and u.deleted_at is null
  where g.permission='platform.controlplane.admin'
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp() limit 1;
 if x.job_id is null or actor is null or latest.id is distinct from x.source_version_id
  then raise exception 'TEST reviewed scope unavailable';end if;
 update public.feature_flags set value='true'::jsonb
  where tenant_id=x.tenant_id and flag='learn.enabled';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(x.tenant_id,'learn.enabled','true'::jsonb);end if;
 update public.feature_flags set value='true'::jsonb
  where tenant_id=x.tenant_id and flag='learn.inputs.commusoft.enabled';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(x.tenant_id,'learn.inputs.commusoft.enabled','true'::jsonb);end if;
 if public.new_dawn_commusoft_coexistence_enabled(x.tenant_id) then
  raise exception 'Broad coexistence unexpectedly on';end if;
 if has_function_privilege('authenticated',
  'public.new_dawn_commusoft_job_trial_arm(uuid,uuid,uuid,uuid,uuid,timestamptz,text)','execute')
  or has_function_privilege('authenticated',
  'public.new_dawn_commusoft_job_trial_disarm(uuid,text)','execute')
  or has_function_privilege('service_role',
  'public.new_dawn_commusoft_job_trial_arm(uuid,uuid,uuid,uuid,uuid,timestamptz,text)','execute')
  or not has_function_privilege('authenticated',
  'public.new_dawn_commusoft_job_trial_offer(uuid,uuid)','execute') then
  raise exception 'Browser can arm trial';end if;
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,status)
 values(queue_id,x.tenant_id,'commusoft','commusoft.source_sync','queued');
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.new_dawn_commusoft_job_detail_start(x.tenant_id,x.job_id,trial_request_id,'TEST one job');
  raise exception 'Unarmed request admitted' using errcode='XX001';
 exception when sqlstate '55000' then null;end;
 perform set_config('request.jwt.claim.role','',true);
 result:=public.new_dawn_commusoft_job_trial_arm(x.tenant_id,x.job_id,actor,trial_request_id,
  x.source_version_id,clock_timestamp()+interval '5 minutes','TEST one job');
 if result->>'state'<>'armed' then raise exception 'Trial arm failed';end if;
 update public.feature_flags set value='true'::jsonb where tenant_id=x.tenant_id
  and flag='new_dawn.m2_commusoft_coexistence';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(x.tenant_id,'new_dawn.m2_commusoft_coexistence','true'::jsonb);end if;
 if public.new_dawn_commusoft_job_trial_current(x.tenant_id,x.job_id,actor,
  trial_request_id,x.source_version_id,false) then
  raise exception 'Broad coexistence left trial active';end if;
 update public.feature_flags set value='false'::jsonb where tenant_id=x.tenant_id
  and flag='new_dawn.m2_commusoft_coexistence';
 update public.feature_flags set value='true'::jsonb where tenant_id=x.tenant_id
  and flag='new_dawn.exact_job_detail';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(x.tenant_id,'new_dawn.exact_job_detail','true'::jsonb);end if;
 if public.new_dawn_commusoft_job_trial_current(x.tenant_id,x.job_id,actor,
  trial_request_id,x.source_version_id,false) then
  raise exception 'Broad UI flag left trial active';end if;
 update public.feature_flags set value='false'::jsonb where tenant_id=x.tenant_id
  and flag='new_dawn.exact_job_detail';
 if public.new_dawn_commusoft_job_trial_current(x.tenant_id,gen_random_uuid(),actor,
  trial_request_id,x.source_version_id,false) or
  public.new_dawn_commusoft_job_trial_current(x.tenant_id,x.job_id,gen_random_uuid(),
  trial_request_id,x.source_version_id,false) or
  public.new_dawn_commusoft_job_trial_current(x.tenant_id,x.job_id,actor,
  trial_request_id,gen_random_uuid(),false) then
  raise exception 'Foreign trial scope admitted';end if;
 begin
  perform public.new_dawn_commusoft_job_trial_arm(x.tenant_id,x.job_id,actor,other_id,
   x.source_version_id,clock_timestamp()+interval '5 minutes','TEST duplicate');
  raise exception 'Second active trial admitted' using errcode='XX001';
 exception when sqlstate '55000' then null;end;
 for d in select pg_get_functiondef(route::regprocedure) from unnest(array[
  'public.learn_commusoft_verification_authority(public.learn_commusoft_verification_requests)',
  'public.learn_commusoft_verify_request(uuid,uuid,uuid,jsonb,text)',
  'public.new_dawn_commusoft_opportunity_probe_authority(public.new_dawn_commusoft_opportunity_probes)']) route loop
  if position('new_dawn_commusoft_job_trial_current' in d)>0 then
   raise exception 'Another manual route inherited exact-job permit';end if;
  if position('new_dawn_commusoft_coexistence_enabled' in d)=0 and
   position('new_dawn.m5_opportunities_probe' in d)=0 then
   raise exception 'Other route guard is unverified';end if;
 end loop;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('role','authenticated',true);
 if current_user is distinct from 'authenticated' or session_user is distinct from 'postgres' then
  raise exception 'Authenticated TEST database role unavailable';end if;
 begin
  perform public.new_dawn_commusoft_job_trial_disarm(trial_request_id,'TEST forbidden');
  raise exception 'Authenticated role could disarm' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 result:=public.new_dawn_commusoft_job_trial_offer(x.tenant_id,x.job_id);
 if result->>'request_id' is distinct from trial_request_id::text or
  result->>'actor_id' is distinct from actor::text or
  public.new_dawn_commusoft_job_trial_offer(x.tenant_id,gen_random_uuid()) is not null then
  raise exception 'Signed-in offer was not exact';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.new_dawn_commusoft_job_trial_offer(x.tenant_id,x.job_id);
  raise exception 'Different actor saw offer' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 result:=public.new_dawn_commusoft_job_detail_start(x.tenant_id,x.job_id,trial_request_id,'TEST one job');
 if result->>'state'<>'prepared' then raise exception 'Exact armed start failed';end if;
 perform set_config('role','none',true);
 if current_user is distinct from 'postgres' then
  raise exception 'Postgres TEST role did not resume';end if;
 if (select p.used_at from public.new_dawn_commusoft_job_trial_permits p
  where p.request_id=trial_request_id) is null then raise exception 'Permit was not consumed';end if;
 begin
  perform public.new_dawn_commusoft_job_detail_start(x.tenant_id,x.job_id,other_id,'TEST other job request');
  raise exception 'Second request admitted' using errcode='XX001';
 exception when sqlstate '55000' then null;end;
 update public.new_dawn_commusoft_job_detail_reads set state='claimed',claimed_at=clock_timestamp()
  where id=trial_request_id;
 perform set_config('request.jwt.claim.role','service_role',true);
 if not public.new_dawn_commusoft_job_detail_current(trial_request_id) then
  raise exception 'Exact request was not current over active import';end if;
 perform public.new_dawn_commusoft_job_trial_disarm(trial_request_id,'TEST stop');
 if public.new_dawn_commusoft_job_detail_current(trial_request_id) then
  raise exception 'Revoked permit still current';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 if public.new_dawn_commusoft_job_trial_offer(x.tenant_id,x.job_id) is not null then
  raise exception 'Revoked offer still visible';end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 update public.new_dawn_commusoft_job_trial_permits set revoked_at=null,
  armed_at=clock_timestamp()-interval '2 minutes',
  expires_at=clock_timestamp()-interval '1 minute' where request_id=trial_request_id;
 if public.new_dawn_commusoft_job_detail_current(trial_request_id) then
  raise exception 'Expired permit still current';end if;
end$$;`;
const candidate = rawSources.at(-1);
const query = `begin;\nset local lock_timeout='3s';\nset local statement_timeout='90s';
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
${migrations}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('20261107010000','new_dawn_commusoft_one_job_trial_permit',array[${quote(candidate)}]);
do $ledger_check$ begin
 if (select count(*) from supabase_migrations.schema_migrations where
  version='20261107010000' and name='new_dawn_commusoft_one_job_trial_permit'
  and array_length(statements,1)=1 and statements[1]=${quote(candidate)})<>1
  then raise exception 'Synthetic exact ledger receipt missing';end if;
end $ledger_check$;
${fixture}
rollback;`;
const endpoint = `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`;
export async function rehearseTest(token = savedCliToken(), fetcher = fetch) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const before = await fetcher(endpoint + "/read-only", { method: "POST", headers, redirect: "error",
    signal: AbortSignal.timeout(30000), body: JSON.stringify({ query:
      "select to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent" }) });
  if (!before.ok || (await before.json())[0]?.ledger_absent !== true)
    throw Error("TEST_synthetic_ledger_precondition_changed");
  const response = await fetcher(endpoint, { method: "POST", headers, redirect: "error",
    signal: AbortSignal.timeout(120000), body: JSON.stringify({ query, read_only: false }) });
  if (!response.ok) throw Error("TEST_rollback_fixture_http_" + response.status + ":" +
    (await response.text()).slice(0, 1000));
  const after = await fetcher(endpoint + "/read-only", { method: "POST", headers, redirect: "error",
    signal: AbortSignal.timeout(30000), body: JSON.stringify({ query:
      "select to_regclass('public.new_dawn_commusoft_job_trial_permits') is null as permit_absent, to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent" }) });
  const row = after.ok ? (await after.json())[0] : null;
  if (row?.permit_absent !== true || row?.ledger_absent !== true)
    throw Error("TEST_rollback_unverified");
  return { state: "passed_rolled_back", syntheticLedger: true, providerRequests: 0 };
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.slice(2).join(" ") !== "--test-rollback-only")
    throw Error("test_rollback_only_required");
  console.log(JSON.stringify(await rehearseTest()));
}
