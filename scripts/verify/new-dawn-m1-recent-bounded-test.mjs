/** Rollback-only TEST rehearsal for the bounded recent-source RPC replacement. */
import { readFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const signature = "public.new_dawn_recent_unlinked_commusoft_jobs(uuid,uuid,text)";
const migration = readFileSync(
  new URL("../../supabase/migrations/20261107180000_new_dawn_recent_unlinked_commusoft_jobs_bounded.sql", import.meta.url),
  "utf8",
);
if (!/^--[\s\S]*\nbegin;\n/.test(migration) || !/\ncommit;\s*$/.test(migration))
  throw Error("Bounded recent-source migration envelope changed");
const body = migration.replace(/^([\s\S]*?)\nbegin;\n/, "").replace(/\ncommit;\s*$/, "");

async function query(sql, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
      redirect: "error",
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const marker = String(failure?.message ?? failure?.code ?? "unknown")
      .match(/ERROR:\s+[A-Z0-9]{5}:\s+([a-z_]{3,80})/)?.[1] ?? "unknown";
    throw Error(`TEST bounded recent-source query failed: HTTP ${response.status}, marker ${marker}`);
  }
  return response.json();
}

const before = await query(
  `select md5(coalesce(pg_get_functiondef(to_regprocedure('${signature}')),'')) as definition`,
);
const fixture = `do $fixture$
declare fixture_actor uuid;fixture_tenant uuid;fixture_connection uuid;got jsonb;
 source_job text:='900000000000001';source_property text:='900000000000002';
 property_payload jsonb;job_payload jsonb;property_version uuid:=gen_random_uuid();
 job_version uuid:=gen_random_uuid();newer_job_version uuid:=gen_random_uuid();
 property_page uuid:=gen_random_uuid();job_page uuid:=gen_random_uuid();
 newer_page uuid:=gen_random_uuid();canonical_job uuid:=gen_random_uuid();
 initial jsonb;permit uuid;synthetic_job uuid;
 synthetic_fingerprint text:='synthetic-bounded-'||gen_random_uuid()::text;
begin
 select c.tenant_id,c.id into fixture_tenant,fixture_connection
 from public.provider_connections c
 where c.provider='commusoft' and c.status='configured' and c.revoked_at is null
  and c.verified_at<=clock_timestamp()
  and exists(select 1 from public.feature_flags f where f.tenant_id=c.tenant_id
   and f.flag='learn.enabled' and f.value='true'::jsonb)
  and exists(select 1 from public.feature_flags f where f.tenant_id=c.tenant_id
   and f.flag='learn.inputs.commusoft.enabled' and f.value='true'::jsonb)
  and exists(select 1 from public.tenant_connectors t where t.tenant_id=c.tenant_id
   and t.provider='commusoft' and t.connector_id='commusoft' and t.enabled and t.status='active')
 order by c.id limit 1;
 if fixture_connection is null then raise exception 'bounded_recent_test_connection_missing';end if;
 for fixture_actor in select g.profile_id from public.platform_authority_grants g
  join public.profiles p on p.id=g.profile_id
  join auth.users u on u.id=g.profile_id and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
 where g.permission='platform.controlplane.admin'
  and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
  and coalesce(g.effective_to,'infinity')>clock_timestamp()
 order by g.profile_id loop
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',fixture_actor::text,true);
  exit when public.current_user_is_openfolk_operator('platform.controlplane.admin');
 end loop;
 if fixture_actor is null or not public.current_user_is_openfolk_operator('platform.controlplane.admin')
  then raise exception 'bounded_recent_test_operator_missing';end if;
 if exists(select 1 from public.learn_business_input_versions
  where tenant_id=fixture_tenant and connection_id=fixture_connection
   and external_id in (source_job,source_property))
 then raise exception 'bounded_recent_test_source_collision';end if;
 property_payload:=jsonb_build_object('id',source_property::numeric,'type','customer');
 job_payload:=jsonb_build_object('id',source_job::numeric,
  'propertyID',source_property::numeric,'status','ongoing');
 insert into public.learn_business_input_request_gates(credential_fingerprint,next_allowed_at)
 values(synthetic_fingerprint,clock_timestamp());
 synthetic_job:=gen_random_uuid();permit:=gen_random_uuid();
 insert into public.learn_business_input_request_permits
  (id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
 values(permit,fixture_tenant,synthetic_job,'rollback-only',1,'{}',synthetic_fingerprint);
 insert into public.learn_business_input_versions
  (id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(property_version,fixture_tenant,fixture_connection,'commusoft','properties',
  source_property,repeat('a',64),property_payload);
 insert into public.learn_business_input_pages
  (id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,
   checkpoint_before,checkpoint_after,record_count)
 values(property_page,fixture_tenant,fixture_connection,'commusoft','properties',
  synthetic_job,permit,jsonb_build_object('data',jsonb_build_array(property_payload)),
  '{}','{}',1);
 insert into public.learn_business_input_observations(page_id,version_id,ordinal)
 values(property_page,property_version,0);
 synthetic_job:=gen_random_uuid();permit:=gen_random_uuid();
 insert into public.learn_business_input_request_permits
  (id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
 values(permit,fixture_tenant,synthetic_job,'rollback-only',1,'{}',synthetic_fingerprint);
 insert into public.learn_business_input_versions
  (id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(job_version,fixture_tenant,fixture_connection,'commusoft','jobs',
  source_job,repeat('b',64),job_payload);
 insert into public.learn_business_input_pages
  (id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,
   checkpoint_before,checkpoint_after,record_count)
 values(job_page,fixture_tenant,fixture_connection,'commusoft','jobs',
  synthetic_job,permit,jsonb_build_object('data',jsonb_build_array(job_payload)),
  '{}','{}',1);
 insert into public.learn_business_input_observations(page_id,version_id,ordinal)
 values(job_page,job_version,0);
 insert into public.jobs(id,tenant_id,title,job_number,status,metadata)
 values(canonical_job,fixture_tenant,'Synthetic bounded review',source_job,'open',
  jsonb_build_object('learn_business_input',jsonb_build_object('source_version_id',job_version)));
 insert into public.learn_business_input_links
  (tenant_id,connection_id,provider,collection,external_id,source_version_id,
   entity_kind,entity_table,entity_id,request,actor_id)
 values(fixture_tenant,fixture_connection,'commusoft','jobs',source_job,job_version,
  'job','jobs',canonical_job,'{}',fixture_actor);
 initial:=public.new_dawn_recent_unlinked_commusoft_jobs(fixture_tenant,fixture_connection,
  'Rollback-only current source exclusion');
 if exists(select 1 from jsonb_array_elements(initial->'rows') r
  where r->>'external_id'=source_job)
 then raise exception 'bounded_recent_current_link_included';end if;
 job_payload:=jsonb_set(job_payload,'{status}','"on_hold"'::jsonb);
 synthetic_job:=gen_random_uuid();permit:=gen_random_uuid();
 insert into public.learn_business_input_request_permits
  (id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
 values(permit,fixture_tenant,synthetic_job,'rollback-only',1,'{}',synthetic_fingerprint);
 insert into public.learn_business_input_versions
  (id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(newer_job_version,fixture_tenant,fixture_connection,'commusoft','jobs',
  source_job,repeat('c',64),job_payload);
 insert into public.learn_business_input_pages
  (id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,
   checkpoint_before,checkpoint_after,record_count,committed_at)
 values(newer_page,fixture_tenant,fixture_connection,'commusoft','jobs',
  synthetic_job,permit,jsonb_build_object('data',jsonb_build_array(job_payload)),
  '{}','{}',1,clock_timestamp()+interval '1 millisecond');
 insert into public.learn_business_input_observations(page_id,version_id,ordinal)
 values(newer_page,newer_job_version,0);
 got:=public.new_dawn_recent_unlinked_commusoft_jobs(fixture_tenant,fixture_connection,
  'Rollback-only bounded recent source review');
 if got->>'version'<>'new-dawn-recent-unlinked-jobs/1'
  or got->>'actor_id'<>fixture_actor::text
  or got->>'tenant_id'<>fixture_tenant::text
  or jsonb_array_length(got->'rows')>25
  or not exists(select 1 from jsonb_array_elements(got->'rows') r
   where r->>'external_id'=source_job and r->>'version_id'=newer_job_version::text
    and r->>'source_status'='on_hold'
    and r->>'relationship_state'='customer_source_retained'
    and r->>'customer_identity_state'='unreviewed')
  or not exists(select 1 from public.controlplane_change_log log
   where log.id=(got->>'audit_id')::uuid and log.tenant_id=fixture_tenant
    and log.actor=fixture_actor::text
    and log.action='client_jobs.recent_unlinked_source_review'
    and log.view_as_active=false)
 then raise exception 'bounded_recent_test_contract_failed';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.new_dawn_recent_unlinked_commusoft_jobs(fixture_tenant,fixture_connection,
   'Foreign actor must be denied');
  raise exception 'bounded_recent_foreign_actor_accepted';
 exception when sqlstate '42501' then null;end;
 create temporary table bounded_recent_test_receipt on commit drop as
  select 'bounded-recent-test-passed/1'::text marker,
   (got->>'unlinked_count')::integer unlinked_count;
end $fixture$;
select marker,unlinked_count,
 md5(pg_get_functiondef('public.new_dawn_recent_unlinked_commusoft_jobs(uuid,uuid,text)'::regprocedure))
 as new_definition_hash from bounded_recent_test_receipt;`;

let result;
let failure;
try {
  result = await query(`begin;\n${body}\n${fixture}\nrollback;`, false);
} catch (cause) {
  failure = cause;
}
const after = await query(
  `select md5(coalesce(pg_get_functiondef(to_regprocedure('${signature}')),'')) as definition`,
);
if (JSON.stringify(before) !== JSON.stringify(after))
  throw Error("TEST bounded recent-source rehearsal did not roll back");
if (failure) throw failure;
const receipt = result?.find?.((row) => row.marker === "bounded-recent-test-passed/1");
if (!receipt || !Number.isInteger(receipt.unlinked_count))
  throw Error("TEST bounded recent-source receipt missing");
console.log(JSON.stringify({ state: "passed_rolled_back", unlinkedCount: receipt.unlinked_count,
  newDefinitionHash: receipt.new_definition_hash }));
