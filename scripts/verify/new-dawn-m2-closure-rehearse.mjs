import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
if (process.argv.slice(2).join(' ') !== '--test-rollback-only')
 throw Error('Closure source TEST rollback-only mode required');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const base=readFileSync(resolve(root,'supabase/migrations/20261106120000_new_dawn_commusoft_job_detail_read.sql'),'utf8');
const change=readFileSync(resolve(root,'supabase/migrations/20261107110000_new_dawn_commusoft_job_operational_facts.sql'),'utf8');
const quote=readFileSync(resolve(root,'supabase/migrations/20261107140000_new_dawn_commusoft_job_source_quote.sql'),'utf8');
const optional=readFileSync(resolve(root,'supabase/migrations/20261107150000_new_dawn_commusoft_job_optional_source_facts.sql'),'utf8');
const closure=readFileSync(resolve(root,'supabase/migrations/20261107160000_new_dawn_commusoft_job_closure_source_facts.sql'),'utf8');
// Apply both additive sources inside one disposable transaction; TEST receives
// no persistent migration, receipt, flag, user or Commusoft request.
const migration=base.replace(/commit;\s*$/,'')+'\n'+change.replace(/\bbegin;/i,'').replace(/commit;\s*$/,'')
 +'\n'+quote.replace(/\bbegin;/i,'').replace(/commit;\s*$/,'')
 +'\n'+optional.replace(/\bbegin;/i,'').replace(/commit;\s*$/,'')
 +'\n'+closure.replace(/\bbegin;/i,'');
const fixture=`do $$declare x record;v public.learn_business_input_versions%rowtype;actor uuid;req uuid:=gen_random_uuid();got jsonb;raw text;queue_state text;
begin
 select g.profile_id into actor from public.platform_authority_grants g
 join auth.users u on u.id=g.profile_id and u.deleted_at is null
 where g.permission='platform.controlplane.admin' and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
  and coalesce(g.effective_to,'infinity')>clock_timestamp() limit 1;
 if actor is null then raise exception 'No TEST operator fixture';end if;
 for x in select l.*,j.id canonical_id from public.learn_business_input_current_links l
  join public.jobs j on j.id=l.entity_id and j.tenant_id=l.tenant_id
  join public.provider_connections c on c.id=l.connection_id and c.tenant_id=l.tenant_id
  where l.provider='commusoft' and l.collection='jobs' and l.entity_kind='job' and l.entity_table='jobs'
   and c.status='configured' and c.revoked_at is null and c.auth_mode='private_api_key'
   and j.metadata#>>'{learn_business_input,source_version_id}'=l.source_version_id::text
   and j.source_system='commusoft:connection:'||l.connection_id::text
   and l.external_id~'^[1-9][0-9]{0,15}$' loop
   v:=public.learn_business_input_latest(x.tenant_id,x.connection_id,'commusoft','jobs',x.external_id);
   exit when v.id=x.source_version_id;
 end loop;
 if x.canonical_id is null or v.id is null or v.id<>x.source_version_id then raise exception 'No exact current TEST source';end if;
 update public.feature_flags set value='true'::jsonb where tenant_id=x.tenant_id and flag='learn.enabled';
 if not found then insert into public.feature_flags(tenant_id,flag,value) values(x.tenant_id,'learn.enabled','true'::jsonb);end if;
 update public.feature_flags set value='true'::jsonb where tenant_id=x.tenant_id and flag='learn.inputs.commusoft.enabled';
 if not found then insert into public.feature_flags(tenant_id,flag,value) values(x.tenant_id,'learn.inputs.commusoft.enabled','true'::jsonb);end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 for queue_state in select unnest(array['queued','running','retrying']) loop
  begin
   insert into public.platform_jobs(tenant_id,connector_id,job_type,status)
    values(x.tenant_id,'commusoft','commusoft.source_sync',queue_state);
   perform public.new_dawn_commusoft_job_detail_start(x.tenant_id,x.canonical_id,gen_random_uuid(),'Active import guard test');
   raise exception 'Active % import admitted at start',queue_state using errcode='XX001';
  exception when sqlstate '55000' then null;end;
 end loop;
 got:=public.new_dawn_commusoft_job_detail_start(x.tenant_id,x.canonical_id,req,'Rollback-only exact job source test');
 if got->>'state'<>'prepared' then raise exception 'TEST start failed';end if;
 begin
  perform public.new_dawn_commusoft_job_detail_start(gen_random_uuid(),x.canonical_id,gen_random_uuid(),'Wrong tenant test');
  raise exception 'Foreign TEST tenant admitted';
 exception when sqlstate '42501' then null;end;
 update public.new_dawn_commusoft_job_detail_reads set state='claimed',claimed_at=clock_timestamp() where id=req;
 perform set_config('request.jwt.claim.role','service_role',true);
 if not public.new_dawn_commusoft_job_detail_current(req) then raise exception 'TEST current predicate failed';end if;
 for queue_state in select unnest(array['queued','running','retrying']) loop
  begin
   insert into public.platform_jobs(tenant_id,connector_id,job_type,status)
    values(x.tenant_id,'commusoft','commusoft.source_sync',queue_state);
   if public.new_dawn_commusoft_job_detail_current(req) then
    raise exception 'Active % import admitted after claim',queue_state using errcode='XX001';end if;
   raise exception 'revert synthetic import job';
  exception when sqlstate 'P0001' then null;end;
 end loop;
 begin
  update public.platform_authority_grants set effective_to=clock_timestamp()-interval '1 second'
   where profile_id=actor and permission='platform.controlplane.admin';
  if public.new_dawn_commusoft_job_detail_current(req) then
   raise exception 'Revoked grant admitted' using errcode='XX001';end if;
  raise exception 'revert synthetic grant change';
 exception when sqlstate 'P0001' then null;end;
 begin
  insert into public.view_as_context(tenant_id,actor_user_id,subject_kind)
   values(x.tenant_id,actor,'unassigned');
  if public.new_dawn_commusoft_job_detail_current(req) then
   raise exception 'Active view-as admitted' using errcode='XX001';end if;
  raise exception 'revert synthetic view-as';
 exception when sqlstate 'P0001' then null;end;
 if not public.new_dawn_commusoft_job_detail_current(req) then raise exception 'TEST authority did not recover';end if;
 begin
  perform public.new_dawn_commusoft_job_detail_finish(req,'{"id":999999}');
  raise exception 'Wrong provider job admitted';
 exception when sqlstate '22023' then null;end;
 if (select state from public.new_dawn_commusoft_job_detail_reads where id=req)<>'claimed' then
  raise exception 'Wrong provider job changed request state';end if;
 begin
  got:=public.new_dawn_commusoft_job_detail_finish(req,
   format('{"id":%s,"isJobOnHold":"false"}',x.external_id));
  if got->>'version'<>'commusoft-exact-job-detail/5' or
   got#>>'{source_operational_facts,isJobOnHold,state}'<>'source_unrecognized' or
   got#>>'{source_operational_facts,isJobOnHold,value}' is not null then
   raise exception 'Wrong hold type was coerced' using errcode='XX001';end if;
  raise exception 'revert unsupported hold fixture';
 exception when sqlstate 'P0001' then null;end;
 begin
  got:=public.new_dawn_commusoft_job_detail_finish(req,
   format('{"id":%s,"quotedAmount":12.5}',x.external_id));
  if got#>>'{source_quoted_amount,state}'<>'source_unrecognized' or
   got#>>'{source_quoted_amount,value}' is not null then
   raise exception 'Numeric quote was coerced' using errcode='XX001';end if;
  raise exception 'revert unsupported quote fixture';
 exception when sqlstate 'P0001' then null;end;
 begin
  got:=public.new_dawn_commusoft_job_detail_finish(req,
   format('{"id":%s,"closed":{"closedOutcome":123,"closedOnDateTime":null}}',x.external_id));
  if got#>>'{source_closure_facts,closedOutcome,state}'<>'source_unrecognized' or
   got#>>'{source_closure_facts,closedOnDateTime,state}'<>'source_null' or
   got#>>'{source_closure_facts,focReason,state}'<>'not_supplied' then
   raise exception 'Malformed closure coerced' using errcode='XX001';end if;
  raise exception 'revert malformed closure fixture';
 exception when sqlstate 'P0001' then null;end;
 begin
  got:=public.new_dawn_commusoft_job_detail_finish(req,
   format('{"id":%s,"closed":null}',x.external_id));
  if got#>>'{source_closure_facts,closedOutcome,state}'<>'source_null' or
   got#>>'{source_closure_facts,focReason,state}'<>'source_null' then
   raise exception 'Null closure was not preserved' using errcode='XX001';end if;
  raise exception 'revert null closure fixture';
 exception when sqlstate 'P0001' then null;end;
 begin
  got:=public.new_dawn_commusoft_job_detail_finish(req,
   format('{"id":%s,"closed":"unexpected"}',x.external_id));
  if got#>>'{source_closure_facts,closedOutcome,state}'<>'source_unrecognized' or
   got#>>'{source_closure_facts,closedOnDateTime,state}'<>'source_unrecognized' then
   raise exception 'Malformed parent closure was not held' using errcode='XX001';end if;
  raise exception 'revert malformed parent closure fixture';
 exception when sqlstate 'P0001' then null;end;
 raw:=format('{"id":%s,"status":"Closed","stageName":"Final","expectedOnsiteDateTime":"2026-10-20T08:00:00Z","usersCurrentlyAssignedToJob":[{"id":7,"fullName":"Synthetic Source User"}],"isJobOnHold":false,"hasSLA":true,"SLAStatus":null,"contractID":123,"quotedAmount":"001.25","closed":{"closedOutcome":"final invoiced","closedOnDateTime":"2026-10-20T15:00:00","focReason":null}}',x.external_id);
 got:=public.new_dawn_commusoft_job_detail_finish(req,raw);
 if got->>'request_id'<>req::text or got->>'job_id'<>x.canonical_id::text
  or got->>'version'<>'commusoft-exact-job-detail/5'
  or got->'source_assigned_users'->0->>'source_user_id'<>'7'
  or got#>>'{source_operational_facts,isJobOnHold,state}'<>'present'
  or got#>>'{source_operational_facts,isJobOnHold,value}'<>'false'
  or got#>>'{source_operational_facts,onHoldReasonDescription,state}'<>'not_supplied'
  or got#>>'{source_operational_facts,SLAStatus,state}'<>'source_null'
  or got#>>'{source_operational_facts,contractID,value}'<>'123'
  or got#>>'{source_quoted_amount,state}'<>'present'
  or got#>>'{source_quoted_amount,value}'<>'001.25'
  or got#>>'{source_closure_facts,closedOutcome,state}'<>'present'
  or got#>>'{source_closure_facts,closedOutcome,value}'<>'final invoiced'
  or got#>>'{source_closure_facts,closedOnDateTime,value}'<>'2026-10-20T15:00:00'
  or got#>>'{source_closure_facts,focReason,state}'<>'source_null'
  or (select state from public.new_dawn_commusoft_job_detail_reads where id=req)<>'complete' then
  raise exception 'TEST finish mismatch';end if;
 begin
  update public.new_dawn_commusoft_job_detail_reads set result='{}'::jsonb where id=req;
  raise exception 'Completed source receipt was mutable' using errcode='XX001';
 exception when sqlstate '55000' then null;end;
 begin
  delete from public.new_dawn_commusoft_job_detail_reads where id=req;
  raise exception 'Completed source receipt was deletable' using errcode='XX001';
 exception when sqlstate '55000' then null;end;
 begin
  truncate public.new_dawn_commusoft_job_detail_reads;
  raise exception 'Source receipt table was truncatable' using errcode='XX001';
 exception when sqlstate '55000' then null;end;
 if public.new_dawn_commusoft_job_detail_current(req) then raise exception 'Complete TEST request remained current';end if;
end$$;
select encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
 'public.new_dawn_commusoft_job_detail_finish(uuid,text)')),'UTF8')),'hex') as candidate_function_sha256;
rollback;`;
const sql=migration.replace(/commit;\s*$/,()=>fixture);
if(!sql.endsWith('rollback;'))throw Error('Fixture rollback fence missing');
const r=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
 headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
 body:JSON.stringify({query:sql,read_only:false})
});
if(!r.ok)throw Error(`TEST fixture HTTP ${r.status}: ${(await r.text()).slice(0,800)}`);
const rows=await r.json();
const candidate=Array.isArray(rows) ? rows.find(row=>/^[a-f0-9]{64}$/.test(row?.candidate_function_sha256??'')) : null;
if(!candidate)throw Error('candidate_function_hash_unconfirmed');
const after=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
 headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
 body:JSON.stringify({query:"select to_regclass('public.new_dawn_commusoft_job_detail_reads') is null as absent"})
});
if(!after.ok || (await after.json())[0]?.absent!==true)throw Error('TEST fixture did not roll back');
console.log(JSON.stringify({state:'rollback_only_fixture_passed',candidateFunctionSha256:candidate.candidate_function_sha256}));
