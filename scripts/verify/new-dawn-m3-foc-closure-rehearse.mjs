/** Hosted TEST transaction only: synthetic FOC source receipt, access checks, rollback. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const read=(name)=>readFileSync(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8');
const unwrap=(source)=>{
  if(!/\nbegin;\n/i.test(source)||!/\ncommit;\s*$/i.test(source)) throw Error('migration_wrapper_changed');
  return source.replace(/\nbegin;\n/i,'\n').replace(/\ncommit;\s*$/i,'\n');
};
export function rehearsalSql(){
  const base=unwrap(read('20261106120000_new_dawn_commusoft_job_detail_read.sql'));
  const candidate=unwrap(read('20261109120000_new_dawn_foc_closure_review.sql'));
  return `begin;\n${base}\n${candidate}\n`+`do $fixture$
declare x record;actor uuid;ordinary uuid;v public.learn_business_input_versions%rowtype;
 got jsonb;req uuid:=gen_random_uuid();
begin
 select g.profile_id into actor from public.platform_authority_grants g
 join auth.users u on u.id=g.profile_id and u.deleted_at is null
 where g.permission='platform.controlplane.admin'
  and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
  and coalesce(g.effective_to,'infinity')>clock_timestamp() limit 1;
 if actor is null then raise exception 'no_test_operator';end if;
 for x in select l.*,j.id canonical_id,c.updated_at connection_revision
  from public.learn_business_input_current_links l
  join public.jobs j on j.id=l.entity_id and j.tenant_id=l.tenant_id
  join public.provider_connections c on c.id=l.connection_id and c.tenant_id=l.tenant_id
  where l.provider='commusoft' and l.collection='jobs' and l.entity_kind='job'
   and l.entity_table='jobs' and j.metadata#>>'{learn_business_input,source_version_id}'=l.source_version_id::text
   and j.source_system='commusoft:connection:'||l.connection_id::text
   and j.external_id=l.external_id loop
   v:=public.learn_business_input_latest(x.tenant_id,x.connection_id,'commusoft','jobs',x.external_id);
   exit when v.id=x.source_version_id;
 end loop;
 if x.canonical_id is null or v.id is distinct from x.source_version_id then raise exception 'no_current_test_job';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.new_dawn_foc_closure_review(x.tenant_id,'Synthetic flag denial');
  raise exception 'flag_off_allowed' using errcode='XX001';
 exception when sqlstate '42501' then
  if sqlerrm<>'foc_review_disabled' then raise;end if;
 end;
 insert into public.new_dawn_commusoft_job_detail_reads(id,tenant_id,actor_id,job_id,
  connection_id,connection_revision,secret_id,source_version_id,external_id,reason,
  state,raw_sha256,checked_at,result)
 values(req,x.tenant_id,actor,x.canonical_id,x.connection_id,x.connection_revision,
  gen_random_uuid(),x.source_version_id,x.external_id,'Synthetic FOC source receipt',
  'complete',repeat('a',64),clock_timestamp(),jsonb_build_object(
   'version','commusoft-exact-job-detail/5','source_closure_facts',jsonb_build_object(
    'closedOutcome',jsonb_build_object('state','present','value','FreeOfCharge'),
    'closedOnDateTime',jsonb_build_object('state','present','value','2026-10-20T15:00:00'),
    'focReason',jsonb_build_object('state','present','value','Synthetic agreement'))));
 insert into public.feature_flags(tenant_id,flag,value)
 values(x.tenant_id,'new_dawn.m3_foc_closure_review','true'::jsonb);
 got:=public.new_dawn_foc_closure_review(x.tenant_id,'Synthetic operator review');
 if got->>'audience'<>'openfolk_operator_only' or got->>'candidate_count'<>'1'
  or got#>>'{rows,0,job_id}'<>x.canonical_id::text
  or got#>>'{rows,0,external_id}'<>x.external_id
  or got#>>'{rows,0,foc_reason_source}'<>'Synthetic agreement'
  or got ? 'amount' or got#>'{rows,0}' ? 'amount'
  or not exists(select 1 from public.controlplane_change_log
   where id=(got->>'audit_id')::uuid and action='client_jobs.foc_closure_review_read')
 then raise exception 'synthetic_foc_review_failed';end if;
 -- A later exact detail for the same job supersedes, rather than leaves behind,
 -- an old free-of-charge candidate.
 insert into public.new_dawn_commusoft_job_detail_reads(id,tenant_id,actor_id,job_id,
  connection_id,connection_revision,secret_id,source_version_id,external_id,reason,
  state,raw_sha256,checked_at,result)
 values(gen_random_uuid(),x.tenant_id,actor,x.canonical_id,x.connection_id,x.connection_revision,
  gen_random_uuid(),x.source_version_id,x.external_id,'Synthetic later closure receipt',
  'complete',repeat('b',64),clock_timestamp()+interval '1 second',jsonb_build_object(
   'version','commusoft-exact-job-detail/5','source_closure_facts',jsonb_build_object(
    'closedOutcome',jsonb_build_object('state','present','value','Invoiced'))));
 got:=public.new_dawn_foc_closure_review(x.tenant_id,'Synthetic superseded review');
 if got->>'candidate_count'<>'0' or jsonb_array_length(got->'rows')<>0
 then raise exception 'superseded_foc_still_shown';end if;
 begin
  perform public.new_dawn_foc_closure_review(gen_random_uuid(),'Synthetic wrong tenant');
  raise exception 'wrong_tenant_allowed' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 select p.id into ordinary from public.profiles p join auth.users u on u.id=p.id
  where u.deleted_at is null and not exists(select 1 from public.platform_authority_grants g
   where g.profile_id=p.id and g.permission='platform.controlplane.admin'
    and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
    and coalesce(g.effective_to,'infinity')>clock_timestamp()) limit 1;
 if ordinary is null then raise exception 'no_ordinary_test_user';end if;
 perform set_config('request.jwt.claim.sub',ordinary::text,true);
 begin
  perform public.new_dawn_foc_closure_review(x.tenant_id,'Synthetic ordinary denial');
  raise exception 'ordinary_allowed' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 if has_function_privilege('anon','public.new_dawn_foc_closure_review(uuid,text)','EXECUTE')
  or has_function_privilege('service_role','public.new_dawn_foc_closure_review(uuid,text)','EXECUTE')
 then raise exception 'grant_boundary_failed';end if;
end $fixture$;
select 'new-dawn-foc-closure-review/1' as marker;
rollback;`;
}
export async function rehearse(fetcher=fetch,token=savedCliToken()){
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:rehearsalSql()}),redirect:'error',signal:AbortSignal.timeout(60000),
  });
  if(!r.ok){const e=await r.json().catch(()=>null);throw Error(`TEST rollback FOC review failed (HTTP ${r.status}, SQLSTATE ${e?.code??'unknown'})`);}
  const rows=await r.json();
  if(!Array.isArray(rows)||rows[0]?.marker!=='new-dawn-foc-closure-review/1') throw Error('TEST rollback marker missing');
  const after=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:"select to_regprocedure('public.new_dawn_foc_closure_review(uuid,text)') is null as absent"}),
    redirect:'error',signal:AbortSignal.timeout(30000),
  });
  if(!after.ok||(await after.json())[0]?.absent!==true) throw Error('TEST rollback not confirmed');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.slice(2).join(' ')!=='--test-rollback-only') throw Error('TEST rollback-only mode required');
  try{console.log(JSON.stringify(await rehearse()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
