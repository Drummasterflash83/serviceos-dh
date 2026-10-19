import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

if (process.argv.slice(2).join(' ') !== '--test-rollback-only')
 throw Error('TEST rollback-only mode required');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const files=[
 '20261106120000_new_dawn_commusoft_job_detail_read.sql',
 '20261106130000_new_dawn_commusoft_opportunities_probe.sql',
 '20261106150000_new_dawn_commusoft_shared_lease.sql',
 '20261106160000_new_dawn_commusoft_shared_lease_routes.sql',
 '20261106170000_new_dawn_commusoft_lease_coexistence.sql',
];
const sql=files.map(name=>{
 const source=readFileSync(resolve(root,'supabase/migrations',name),'utf8');
 if(!/^\s*(?:--[^\n]*\n)*begin;/i.test(source)||!/commit;\s*$/i.test(source))
  throw Error(`Migration transaction fence changed: ${name}`);
 return source.replace(/\bbegin;(?=[\s\S]*)/i,'').replace(/commit;\s*$/i,'');
}).join('\n');
const fixture=`do $$declare d text; result jsonb; fingerprint text:=repeat('b',64);
 x record; v public.learn_business_input_versions%rowtype; actor uuid;
 replay_id uuid:=gen_random_uuid();detail_id uuid:=gen_random_uuid();opportunity_id uuid:=gen_random_uuid();
 verification_id uuid:=gen_random_uuid();yield_id uuid:=gen_random_uuid();
 prior_retry timestamptz; yielded jsonb;begin
 for d in select pg_get_functiondef(route::regprocedure) from unnest(array[
  'public.new_dawn_commusoft_job_detail_acquire(uuid)',
  'public.new_dawn_commusoft_opportunity_probe_acquire(uuid)',
  'public.learn_commusoft_verify_acquire(uuid,uuid)']) route loop
  if position('learn_commusoft_shared_lease_acquire' in d)=0 then
   raise exception 'Manual route lacks shared lease';end if;
 end loop;
 if (select count(*) from pg_trigger where tgname in
  ('new_dawn_job_detail_lease_release','new_dawn_opportunity_lease_release','new_dawn_verification_lease_release'))<>3
  then raise exception 'Manual lease release triggers missing';end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 result:=public.learn_commusoft_shared_lease_acquire(fingerprint,'source_page',repeat('1',36));
 if result->>'state'<>'ready' then raise exception 'Source reservation failed';end if;
 result:=public.learn_commusoft_shared_lease_acquire(fingerprint,'job_detail',repeat('2',36));
 if result->>'state'<>'wait' or result->>'waitKind'<>'lease' then
  raise exception 'Exact read overlapped source or lost wait kind';end if;
 if public.learn_commusoft_shared_lease_release('opportunity',repeat('1',36)) then
  raise exception 'Foreign route cleared source lease';end if;
 if not public.learn_commusoft_shared_lease_release('source_page',repeat('1',36)) then
  raise exception 'Source owner release failed';end if;
 if has_function_privilege('authenticated','public.learn_commusoft_shared_lease_acquire(text,text,text)','execute')
  or has_function_privilege('authenticated','public.learn_commusoft_shared_lease_release(text,text)','execute') then
  raise exception 'Lease helper callable by user';end if;
 for x in select l.tenant_id,l.entity_id job_id,l.connection_id,l.source_version_id,l.external_id,
  c.updated_at connection_revision,(c.secret_refs->>'api_key')::uuid secret_id
  from public.learn_business_input_current_links l
  join public.jobs j on j.id=l.entity_id and j.tenant_id=l.tenant_id
  join public.provider_connections c on c.id=l.connection_id and c.tenant_id=l.tenant_id
  where l.provider='commusoft' and l.collection='jobs' and l.entity_kind='job'
   and l.entity_table='jobs' and l.external_id~'^[1-9][0-9]{0,15}$'
   and c.secret_refs->>'api_key'~'^[0-9a-f-]{36}$'
   and c.status='configured' and c.revoked_at is null and c.auth_mode='private_api_key'
   and c.verified_at is not null and c.non_secret_config->>'region' in ('uk','us')
   and j.metadata#>>'{learn_business_input,source_version_id}'=l.source_version_id::text
   and j.source_system='commusoft:connection:'||l.connection_id::text loop
  v:=public.learn_business_input_latest(x.tenant_id,x.connection_id,'commusoft','jobs',x.external_id);
  exit when v.id=x.source_version_id;
 end loop;
 select g.profile_id into actor from public.platform_authority_grants g
  join auth.users u on u.id=g.profile_id and u.deleted_at is null
  where g.permission='platform.controlplane.admin'
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp() limit 1;
 if x.job_id is null or v.id is null or v.id<>x.source_version_id or actor is null then
  raise exception 'TEST route fixture source missing';end if;
 for d in select pg_get_functiondef(route::regprocedure) from unnest(array[
  'public.new_dawn_commusoft_job_detail_start(uuid,uuid,uuid,text)',
  'public.new_dawn_commusoft_job_detail_current(uuid)',
  'public.learn_commusoft_verification_authority(public.learn_commusoft_verification_requests)',
  'public.learn_commusoft_verify_request(uuid,uuid,uuid,jsonb,text)']) route loop
  if position('new_dawn_commusoft_coexistence_enabled' in d)=0 then
   raise exception 'Queue guard lacks default-off coexistence check';end if;
 end loop;
 if public.new_dawn_commusoft_coexistence_enabled(x.tenant_id) then
  raise exception 'Coexistence unexpectedly enabled in TEST';end if;
 insert into public.feature_flags(tenant_id,flag,value)
 values(x.tenant_id,'new_dawn.m2_commusoft_coexistence','true'::jsonb);
 if not public.new_dawn_commusoft_coexistence_enabled(x.tenant_id) then
  raise exception 'Coexistence flag was not explicit';end if;
 update public.feature_flags set value='true'::jsonb
  where tenant_id=x.tenant_id and flag='learn.enabled';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(x.tenant_id,'learn.enabled','true'::jsonb);end if;
 update public.feature_flags set value='true'::jsonb
  where tenant_id=x.tenant_id and flag='learn.inputs.commusoft.enabled';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(x.tenant_id,'learn.inputs.commusoft.enabled','true'::jsonb);end if;
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,status,attempt_count,
  claimed_by,lease_expires_at)
 values(yield_id,x.tenant_id,'commusoft','commusoft.source_sync','running',1,
  'learn-commusoft:synthetic',clock_timestamp()+interval '2 minutes');
 yielded:=public.learn_commusoft_yield_job(x.tenant_id,yield_id,'learn-commusoft:synthetic',1,
  clock_timestamp()+interval '40 seconds');
 if yielded->>'status'<>'queued' or
  (select attempt_count from public.platform_jobs where id=yield_id)<>0 or
  (select error_count from public.platform_jobs where id=yield_id)<>0 or
  (select available_at from public.platform_jobs where id=yield_id)>clock_timestamp()+interval '4 seconds'
  then raise exception 'Lease yield consumed an attempt or failure backoff';end if;
 begin
  perform public.learn_commusoft_yield_job(x.tenant_id,yield_id,'learn-commusoft:synthetic',1,
   clock_timestamp()+interval '1 second');
  raise exception 'Replayed yield accepted' using errcode='XX001';
 exception when sqlstate 'PT409' then null;end;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 update public.feature_flags set value='false'::jsonb
  where tenant_id=x.tenant_id and flag='new_dawn.m2_commusoft_coexistence';
 begin
  perform public.new_dawn_commusoft_job_detail_start(x.tenant_id,x.job_id,gen_random_uuid(),
   'Synthetic default off guard');
  raise exception 'Active import admitted while coexistence off' using errcode='XX001';
 exception when sqlstate '55000' then null;end;
 update public.feature_flags set value='true'::jsonb
  where tenant_id=x.tenant_id and flag='new_dawn.m2_commusoft_coexistence';
 result:=public.new_dawn_commusoft_job_detail_start(x.tenant_id,x.job_id,replay_id,
  'Synthetic prepared request replay');
 if result->>'state'<>'prepared' then raise exception 'Exact request start failed';end if;
 result:=public.new_dawn_commusoft_job_detail_start(x.tenant_id,x.job_id,replay_id,
  'Synthetic prepared request replay');
 if result->>'state'<>'prepared' then raise exception 'Exact request replay failed';end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 insert into public.new_dawn_commusoft_job_detail_reads
  (id,tenant_id,actor_id,job_id,connection_id,connection_revision,secret_id,source_version_id,
   external_id,reason,state,claimed_at)
 values(detail_id,x.tenant_id,actor,x.job_id,x.connection_id,x.connection_revision,x.secret_id,
  x.source_version_id,x.external_id,'Synthetic lease release','claimed',clock_timestamp());
 result:=public.learn_commusoft_shared_lease_acquire(repeat('c',64),'job_detail',detail_id::text);
 if result->>'state'<>'ready' then raise exception 'Detail lease fixture failed';end if;
 update public.new_dawn_commusoft_job_detail_reads set credential_fingerprint=repeat('c',64)
  where id=detail_id;
 perform public.new_dawn_commusoft_job_detail_fail(detail_id,'rate_limited',clock_timestamp()+interval '1 minute');
 if exists(select 1 from public.learn_business_input_request_gates where credential_fingerprint=repeat('c',64)
  and lease_owner_id is not null) then raise exception 'Detail failure retained lease';end if;
 if (select next_allowed_at from public.learn_business_input_request_gates
  where credential_fingerprint=repeat('c',64))<clock_timestamp()+interval '50 seconds' then
  raise exception 'Detail 429 lost shared deferral';end if;
 select next_allowed_at into prior_retry from public.learn_business_input_request_gates
  where credential_fingerprint=repeat('c',64);
 perform public.new_dawn_commusoft_job_detail_fail(detail_id,'rate_limited',clock_timestamp()+interval '2 minutes');
 if (select next_allowed_at from public.learn_business_input_request_gates
  where credential_fingerprint=repeat('c',64))<=prior_retry then
  raise exception 'Late detail 429 lost shared deferral';end if;
 insert into public.new_dawn_commusoft_opportunity_probes
  (id,tenant_id,actor_id,connection_id,binding,reason,state,expires_at,claimed_at)
 values(opportunity_id,x.tenant_id,actor,x.connection_id,'{}'::jsonb,'Synthetic lease release',
  'claimed',clock_timestamp()+interval '2 minutes',clock_timestamp());
 result:=public.learn_commusoft_shared_lease_acquire(repeat('d',64),'opportunity',opportunity_id::text);
 if result->>'state'<>'ready' then raise exception 'Opportunity lease fixture failed';end if;
 update public.new_dawn_commusoft_opportunity_probes set credential_fingerprint=repeat('d',64)
  where id=opportunity_id;
 perform public.new_dawn_commusoft_opportunity_probe_fail(opportunity_id,'rate_limited',
  clock_timestamp()+interval '1 minute');
 if exists(select 1 from public.learn_business_input_request_gates where credential_fingerprint=repeat('d',64)
  and lease_owner_id is not null) then raise exception 'Opportunity failure retained lease';end if;
 if (select next_allowed_at from public.learn_business_input_request_gates
  where credential_fingerprint=repeat('d',64))<clock_timestamp()+interval '50 seconds' then
  raise exception 'Opportunity 429 lost shared deferral';end if;
 select next_allowed_at into prior_retry from public.learn_business_input_request_gates
  where credential_fingerprint=repeat('d',64);
 perform public.new_dawn_commusoft_opportunity_probe_fail(opportunity_id,'rate_limited',
  clock_timestamp()+interval '2 minutes');
 if (select next_allowed_at from public.learn_business_input_request_gates
  where credential_fingerprint=repeat('d',64))<=prior_retry then
  raise exception 'Late opportunity 429 lost shared deferral';end if;
 insert into public.learn_commusoft_verification_requests
  (id,tenant_id,actor_id,definition,binding,expires_at)
 values(verification_id,x.tenant_id,actor,'{}'::jsonb,'{}'::jsonb,clock_timestamp()+interval '2 minutes');
 result:=public.learn_commusoft_shared_lease_acquire(repeat('e',64),'verification',verification_id::text);
 if result->>'state'<>'ready' then raise exception 'Verification lease fixture failed';end if;
 insert into public.learn_commusoft_verification_results(request_id,observation_code,receipt)
 values(verification_id,'transport_unavailable','{}'::jsonb);
 if exists(select 1 from public.learn_business_input_request_gates where credential_fingerprint=repeat('e',64)
  and lease_owner_id is not null) then raise exception 'Verification result retained lease';end if;
end$$;`;
const query=`begin;\nset local lock_timeout='3s';\nset local statement_timeout='90s';\n${sql}\n${fixture}\nrollback;`;
const endpoint=`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`;
const headers={Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'};
const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
 headers,body:JSON.stringify({query,read_only:false})});
if(!response.ok)throw Error(`TEST rollback fixture HTTP ${response.status}: ${(await response.text()).slice(0,1200)}`);
const after=await fetch(`${endpoint}/read-only`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
 headers,body:JSON.stringify({query:"select to_regclass('public.new_dawn_commusoft_job_detail_reads') is null as absent, (select count(*) from information_schema.columns where table_schema='public' and table_name='learn_business_input_request_gates' and column_name='lease_owner_id')=0 as lease_absent"})});
const rows=after.ok?await after.json():[];
if(rows[0]?.absent!==true||rows[0]?.lease_absent!==true)throw Error('TEST rollback fence did not restore schema');
console.log(JSON.stringify({state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0}));
