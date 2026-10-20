/** Rollback-only TEST rehearsal of exact dual-ID job linking and reversal. */
import { readFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const path = new URL("../../supabase/migrations/20261109130000_new_dawn_commusoft_exact_dual_id_link.sql", import.meta.url);
const migration = readFileSync(path, "utf8");
if (!/\nbegin;\n/.test(migration) || !/\ncommit;\s*$/.test(migration))
  throw Error("Exact-link migration envelope changed");
const body = migration.replace(/\nbegin;\n/, "\n").replace(/\ncommit;\s*$/, "\n");
const signature = "public.new_dawn_commusoft_exact_link_apply(uuid,uuid,text,uuid,text)";

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
    throw Error(`TEST exact-link rollback failed: HTTP ${response.status}, marker ${marker}`);
  }
  return response.json();
}

const before = await query(`select md5(coalesce(pg_get_functiondef(to_regprocedure('${signature}')),'')) as definition`);
const fixture = `do $fixture$
declare actor uuid;tenant uuid;connection uuid;customer_id uuid:=gen_random_uuid();
 site_id uuid:=gen_random_uuid();conflict_site_id uuid:=gen_random_uuid();
 card_id uuid:=gen_random_uuid();
 customer_external text:='900000000000101';property_external text:='900000000000102';
 job_external text:='900000000000103';missing_site_external text:='900000000000104';
 customer_version uuid:=gen_random_uuid();property_version uuid:=gen_random_uuid();
 job_version uuid:=gen_random_uuid();missing_site_version uuid:=gen_random_uuid();
 customer_payload jsonb;property_payload jsonb;job_payload jsonb;missing_site_payload jsonb;
 page_id uuid;permit_id uuid;source_job_id uuid;fingerprint text:='synthetic-exact-'||gen_random_uuid()::text;
 candidate jsonb;result jsonb;review jsonb;link_id uuid;
begin
 select c.tenant_id,c.id into tenant,connection from public.provider_connections c
 where c.provider='commusoft' and c.status='configured' and c.revoked_at is null
  and c.verified_at<=clock_timestamp()
  and exists(select 1 from public.feature_flags f where f.tenant_id=c.tenant_id
   and f.flag='learn.enabled' and f.value='true'::jsonb)
  and exists(select 1 from public.feature_flags f where f.tenant_id=c.tenant_id
   and f.flag='learn.inputs.commusoft.enabled' and f.value='true'::jsonb)
  and exists(select 1 from public.tenant_connectors t where t.tenant_id=c.tenant_id
   and t.provider='commusoft' and t.connector_id='commusoft'
   and t.enabled and t.status='active')
 order by c.id limit 1;
 if connection is null then raise exception 'exact_test_connection_missing';end if;
 for actor in select g.profile_id from public.platform_authority_grants g
  join public.profiles p on p.id=g.profile_id
  join auth.users u on u.id=g.profile_id and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
  where g.permission='platform.controlplane.admin'
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp()
  order by g.profile_id loop
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  exit when public.current_user_is_openfolk_operator('platform.controlplane.admin');
 end loop;
 if actor is null or not public.current_user_is_openfolk_operator('platform.controlplane.admin')
  then raise exception 'exact_test_operator_missing';end if;
 if exists(select 1 from public.learn_business_input_versions where tenant_id=tenant
  and connection_id=connection and external_id in
   (customer_external,property_external,job_external,missing_site_external))
  then raise exception 'exact_test_source_collision';end if;
 customer_payload:=jsonb_build_object('id',customer_external::numeric,'type','customer');
 property_payload:=jsonb_build_object('id',property_external::numeric,'type','workaddress',
  'parentPropertyID',customer_external::numeric);
 job_payload:=jsonb_build_object('id',job_external::numeric,'propertyID',property_external::numeric,
  'status','ongoing','description','Synthetic exact-link job');
 missing_site_payload:=jsonb_build_object('id',missing_site_external::numeric,
  'propertyID',customer_external::numeric,'status','ongoing');
 insert into public.learn_business_input_request_gates(credential_fingerprint,next_allowed_at)
 values(fingerprint,clock_timestamp());
 insert into public.people(id,tenant_id,display_name,verified,created_source)
 values(customer_id,tenant,'Synthetic exact-link customer',false,'synthetic');
 insert into public.customer_cards(id,tenant_id,person_id,title)
 values(card_id,tenant,customer_id,'Synthetic exact-link customer');
 insert into public.sites(id,tenant_id,person_id,label,source_system,external_id)
 values(site_id,tenant,customer_id,'Synthetic exact-link site',
  'commusoft:connection:'||connection::text,property_external);
 for source_job_id,permit_id,page_id in select gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
 loop
  insert into public.learn_business_input_request_permits
   (id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
  values(permit_id,tenant,source_job_id,'rollback-only',1,'{}',fingerprint);
  insert into public.learn_business_input_pages
   (id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,
    checkpoint_before,checkpoint_after,record_count)
  values(page_id,tenant,connection,'commusoft','properties',source_job_id,permit_id,
   jsonb_build_object('data',jsonb_build_array(customer_payload,property_payload)),
   '{}','{}',2);
  exit;
 end loop;
 insert into public.learn_business_input_versions
  (id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(customer_version,tenant,connection,'commusoft','properties',customer_external,
   repeat('a',64),customer_payload),
  (property_version,tenant,connection,'commusoft','properties',property_external,
   repeat('b',64),property_payload);
 insert into public.learn_business_input_observations(page_id,version_id,ordinal)
 values(page_id,customer_version,0),(page_id,property_version,1);
 insert into public.learn_business_input_links
  (tenant_id,connection_id,provider,collection,external_id,source_version_id,
   entity_kind,entity_table,entity_id,card_id,request,actor_id)
 values(tenant,connection,'commusoft','properties',customer_external,customer_version,
   'customer','people',customer_id,card_id,'{}',actor),
  (tenant,connection,'commusoft','properties',property_external,property_version,
   'site','sites',site_id,card_id,'{}',actor);
 source_job_id:=gen_random_uuid();permit_id:=gen_random_uuid();page_id:=gen_random_uuid();
 insert into public.learn_business_input_request_permits
  (id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
 values(permit_id,tenant,source_job_id,'rollback-only',1,'{}',fingerprint);
 insert into public.learn_business_input_pages
  (id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,
   checkpoint_before,checkpoint_after,record_count)
 values(page_id,tenant,connection,'commusoft','jobs',source_job_id,permit_id,
  jsonb_build_object('data',jsonb_build_array(job_payload,missing_site_payload)),
  '{}','{}',2);
 insert into public.learn_business_input_versions
  (id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(job_version,tenant,connection,'commusoft','jobs',job_external,repeat('c',64),job_payload),
  (missing_site_version,tenant,connection,'commusoft','jobs',missing_site_external,
   repeat('d',64),missing_site_payload);
 insert into public.learn_business_input_observations(page_id,version_id,ordinal)
 values(page_id,job_version,0),(page_id,missing_site_version,1);
 insert into public.sites(id,tenant_id,person_id,label,source_system,external_id)
 values(conflict_site_id,tenant,customer_id,'Conflicting synthetic source site',
  'commusoft',property_external);
 candidate:=public.new_dawn_commusoft_exact_link_candidate(tenant,connection,job_external);
 if candidate->>'state'<>'review' or candidate->>'reason'<>'site_identity_conflict'
  then raise exception 'exact_test_site_conflict_accepted';end if;
 delete from public.sites where id=conflict_site_id and tenant_id=tenant;
 candidate:=public.new_dawn_commusoft_exact_link_candidate(tenant,connection,job_external);
 if candidate->>'state'<>'ready' or candidate->>'job_version_id'<>job_version::text
  then raise exception 'exact_test_candidate_not_ready';end if;
 candidate:=public.new_dawn_commusoft_exact_link_candidate(tenant,connection,missing_site_external);
 if candidate->>'state'<>'review' or candidate->>'reason'<>'property_not_exact_work_site'
  then raise exception 'exact_test_missing_site_not_held';end if;
 review:=public.new_dawn_commusoft_exact_link_review_page(tenant,connection,
  '900000000000100',100,
  'Rollback-only exact-link review');
 if not exists(select 1 from jsonb_array_elements(review->'rows') r
  where r->>'external_id'=job_external and r->>'state'='ready')
  or not exists(select 1 from jsonb_array_elements(review->'rows') r
  where r->>'external_id'=missing_site_external and r->>'state'='review')
  then raise exception 'exact_test_review_queue_missing';end if;
 result:=public.new_dawn_commusoft_exact_link_apply(tenant,connection,job_external,
  gen_random_uuid(),'Stale source must not link');
 if result->>'reason'<>'job_source_changed' then raise exception 'exact_test_stale_source_accepted';end if;
 result:=public.new_dawn_commusoft_exact_link_apply(tenant,connection,job_external,
  job_version,'Rollback-only exact dual-ID link');
 if result->>'state'<>'linked' then raise exception 'exact_test_link_failed';end if;
 link_id:=(result->>'link_id')::uuid;
 if not exists(select 1 from public.learn_business_input_current_links where id=link_id)
  or not exists(select 1 from public.controlplane_change_log
   where id=(result->>'audit_id')::uuid and action='client_jobs.exact_dual_id_auto_link')
  then raise exception 'exact_test_link_audit_missing';end if;
 result:=public.new_dawn_commusoft_exact_link_toggle(tenant,link_id,'reverse',
  'Rollback-only link reversal');
 if result->>'state'<>'reversed' or exists(select 1 from public.learn_business_input_current_links
  where id=link_id) then raise exception 'exact_test_reverse_failed';end if;
 result:=public.new_dawn_commusoft_exact_link_toggle(tenant,link_id,'restore',
  'Rollback-only source recheck and restore');
 if result->>'state'<>'restored' or not exists(select 1 from public.learn_business_input_current_links
  where id=link_id) then raise exception 'exact_test_restore_failed';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.new_dawn_commusoft_exact_link_apply(tenant,connection,missing_site_external,
   missing_site_version,'Foreign actor must be denied');
  raise exception 'exact_test_foreign_actor_accepted';
 exception when sqlstate '42501' then null;end;
 create temporary table exact_link_test_receipt on commit drop as
  select 'exact-link-test-passed/1'::text marker;
end $fixture$;
select marker from exact_link_test_receipt;`;

let result;
let failure;
try {
  result = await query(`begin;\n${body}\n${fixture}\nrollback;`, false);
} catch (cause) {
  failure = cause;
}
const after = await query(`select md5(coalesce(pg_get_functiondef(to_regprocedure('${signature}')),'')) as definition`);
if (JSON.stringify(before) !== JSON.stringify(after))
  throw Error("TEST exact-link rehearsal did not roll back");
if (failure) throw failure;
if (result?.find?.((row) => row.marker === "exact-link-test-passed/1") == null)
  throw Error("TEST exact-link rollback receipt missing");
console.log(JSON.stringify({ state: "passed_rolled_back", durableChange: false }));
