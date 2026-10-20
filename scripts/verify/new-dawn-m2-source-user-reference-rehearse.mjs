/** Rollback-only TEST rehearsal. Synthetic receipt; no Commusoft request. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

if (process.argv.slice(2).join(' ') !== '--test-rollback-only')
  throw Error('TEST rollback-only mode required');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const change = readFileSync(resolve(root,
  'supabase/migrations/20261107130000_new_dawn_job_source_user_reference.sql'), 'utf8');
const base = readFileSync(resolve(root,
  'supabase/migrations/20261106120000_new_dawn_commusoft_job_detail_read.sql'), 'utf8');
const query = async (sql, readOnly = false) => {
  const url = `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? '/read-only' : ''}`;
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  if (!response.ok) throw Error(`TEST query HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
};
const before = (await query(`select
 to_regclass('public.new_dawn_commusoft_job_detail_reads') is not null as detail_exists,
 to_regprocedure('public.new_dawn_job_source_user_reference(uuid,uuid,text)') is not null as candidate_exists`, true))[0];
if (before.candidate_exists) throw Error('Candidate already installed on TEST; refusing a second CREATE');
const strip = (sql) => sql.replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
const fixture = `do $$declare x record;actor uuid;req uuid:=gen_random_uuid();got jsonb;v public.learn_business_input_versions%rowtype;
begin
 select g.profile_id into actor from public.platform_authority_grants g
 join auth.users u on u.id=g.profile_id and u.deleted_at is null
 where g.permission='platform.controlplane.admin'
  and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
  and coalesce(g.effective_to,'infinity')>clock_timestamp() limit 1;
 if actor is null then raise exception 'No TEST operator fixture';end if;
 for x in select l.*,j.id canonical_id,c.updated_at connection_revision,
  (c.secret_refs->>'api_key')::uuid secret_id
  from public.learn_business_input_current_links l
  join public.jobs j on j.id=l.entity_id and j.tenant_id=l.tenant_id
  join public.provider_connections c on c.id=l.connection_id and c.tenant_id=l.tenant_id
  where l.provider='commusoft' and l.collection='jobs' and l.entity_kind='job' and l.entity_table='jobs'
   and c.status='configured' and c.revoked_at is null and c.auth_mode='private_api_key'
   and j.metadata#>>'{learn_business_input,source_version_id}'=l.source_version_id::text
   and j.metadata#>>'{learn_business_input,connection_id}'=l.connection_id::text
   and j.source_system='commusoft:connection:'||l.connection_id::text
   and j.external_id=l.external_id
   and l.external_id~'^[1-9][0-9]{0,15}$' loop
   v:=public.learn_business_input_latest(x.tenant_id,x.connection_id,'commusoft','jobs',x.external_id);
   exit when v.id=x.source_version_id;
 end loop;
 if x.canonical_id is null or v.id is null or v.id<>x.source_version_id then
  raise exception 'No exact current TEST source';end if;
 insert into public.new_dawn_commusoft_job_detail_reads
 (id,tenant_id,actor_id,job_id,connection_id,connection_revision,secret_id,
  source_version_id,external_id,reason,state,checked_at,result)
 values(req,x.tenant_id,actor,x.canonical_id,x.connection_id,x.connection_revision,x.secret_id,
  x.source_version_id,x.external_id,'Synthetic rollback source-user check','complete',clock_timestamp(),
  jsonb_build_object('version','commusoft-exact-job-detail/5','tenant_id',x.tenant_id,
   'job_id',x.canonical_id,'source_version_id',x.source_version_id,'external_id',x.external_id,
   'source_assigned_users',jsonb_build_array(jsonb_build_object(
    'source_user_id','9000000000000000','name','Synthetic Source User'))));
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.new_dawn_job_source_user_reference(x.tenant_id,x.canonical_id,'Synthetic gate check');
  raise exception 'Absent flag admitted source user reference' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 insert into public.feature_flags(tenant_id,flag,value)
 values(x.tenant_id,'new_dawn.m2_source_user_reference','true'::jsonb);
 got:=public.new_dawn_job_source_user_reference(x.tenant_id,x.canonical_id,'Synthetic source user check');
 if got->>'version'<>'new-dawn-job-source-user-reference/1'
  or got->>'job_source_version_id'<>x.source_version_id::text
  or got#>>'{users,0,source_user_id}'<>'9000000000000000'
  or got#>>'{users,0,state}'<>'source_record_not_captured'
  or got#>>'{users,0,identity}'<>'unverified'
  or got#>>'{users,0,appointment}'<>'unverified'
  or not exists(select 1 from public.controlplane_change_log where id=(got->>'audit_id')::uuid
   and action='client_jobs.source_user_reference' and tenant_id=x.tenant_id)
 then raise exception 'Source user reference contract failed';end if;
 begin
  perform public.new_dawn_job_source_user_reference(gen_random_uuid(),x.canonical_id,'Foreign tenant check');
  raise exception 'Foreign tenant admitted' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.role','service_role',true);
 begin
  perform public.new_dawn_job_source_user_reference(x.tenant_id,x.canonical_id,'Service role check');
  raise exception 'Service role admitted' using errcode='XX001';
 exception when sqlstate '22023' then null;end;
end$$;`;
const sql = 'begin;\n' + (before.detail_exists ? '' : strip(base) + '\n') +
  strip(change) + '\n' + fixture + '\nrollback;';
await query(sql);
const after = (await query(`select to_regprocedure('public.new_dawn_job_source_user_reference(uuid,uuid,text)') is null as absent`, true))[0];
if (!after.absent) throw Error('TEST fixture did not roll back');
console.log(JSON.stringify({ state: 'rollback_only_fixture_passed', provider_gets: 0 }));
