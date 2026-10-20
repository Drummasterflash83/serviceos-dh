/** Rollback-only TEST rehearsal; no durable source, identity or schema writes. */
import { readFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const migration = readFileSync(
  new URL("../../supabase/migrations/20261109150000_new_dawn_commusoft_exact_site_review.sql", import.meta.url),
  "utf8",
);
if (!/\nbegin;\n/.test(migration) || !/\ncommit;\s*$/.test(migration))
  throw Error("Exact-site migration envelope changed");
const body = migration.replace(/\nbegin;\n/, "\n").replace(/\ncommit;\s*$/, "\n");
const dependency = readFileSync(
  new URL("../../supabase/migrations/20261109130000_new_dawn_commusoft_exact_dual_id_link.sql", import.meta.url),
  "utf8",
);
const dependencyBody = dependency.replace(/\nbegin;\n/, "\n").replace(/\ncommit;\s*$/, "\n");
const signature = "public.new_dawn_commusoft_exact_site_apply(uuid,uuid,text,uuid,text)";
const snapshotSql = `select
 md5(coalesce(pg_get_functiondef(to_regprocedure('${signature}')),'')) function_definition,
 to_regclass('public.new_dawn_commusoft_exact_site_events') is not null event_table_exists,
 md5(coalesce(pg_get_viewdef('public.learn_business_input_current_links'::regclass,true),'')) current_links_view`;

async function query(sql, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
      redirect: "error", signal: AbortSignal.timeout(90000),
    },
  );
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const marker = String(failure?.message ?? failure?.code ?? "unknown")
      .match(/ERROR:\s+[A-Z0-9]{5}:\s+([a-z_]{3,80})/)?.[1] ?? "unknown";
    throw Error(`TEST exact-site rollback failed: HTTP ${response.status}, marker ${marker}`);
  }
  return response.json();
}

const before = await query(snapshotSql);
const needsDependency = !(await query("select to_regclass('public.new_dawn_commusoft_exact_link_events') is not null installed"))[0]?.installed;
const fixture = `do $fixture$
declare actor uuid;tenant uuid;connection uuid;customer_id uuid:=gen_random_uuid();
 card_id uuid:=gen_random_uuid();customer_external text:='900000000000201';
 site_external text:='900000000000202';unmapped_external text:='900000000000203';
 customer_version uuid:=gen_random_uuid();site_version uuid:=gen_random_uuid();
 unmapped_version uuid:=gen_random_uuid();page_id uuid;permit_id uuid;
 source_job_id uuid;fingerprint text:='synthetic-exact-site-'||gen_random_uuid()::text;
 customer_payload jsonb;site_payload jsonb;unmapped_payload jsonb;
 candidate jsonb;result jsonb;review jsonb;link_id uuid;site_id uuid;conflict_id uuid:=gen_random_uuid();
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
   and t.enabled and t.status='active') order by c.id limit 1;
 if connection is null then raise exception 'exact_site_test_connection_missing';end if;
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
  then raise exception 'exact_site_test_operator_missing';end if;
 if exists(select 1 from public.learn_business_input_versions where tenant_id=tenant
  and connection_id=connection and external_id in
   (customer_external,site_external,unmapped_external))
  then raise exception 'exact_site_test_source_collision';end if;
 customer_payload:=jsonb_build_object('id',customer_external::numeric,'type','customer');
 site_payload:=jsonb_build_object('id',site_external::numeric,'type','workaddress',
  'parentPropertyID',customer_external::numeric,'addressLine1','Synthetic exact site');
 unmapped_payload:=jsonb_build_object('id',unmapped_external::numeric,'type','workaddress',
  'parentPropertyID',900000000000204::numeric,'addressLine1','Unmapped synthetic site');
 insert into public.learn_business_input_request_gates(credential_fingerprint,next_allowed_at)
 values(fingerprint,clock_timestamp());
 insert into public.people(id,tenant_id,display_name,verified,created_source)
 values(customer_id,tenant,'Synthetic exact-site customer',false,'synthetic');
 insert into public.customer_cards(id,tenant_id,person_id,title)
 values(card_id,tenant,customer_id,'Synthetic exact-site customer');
 source_job_id:=gen_random_uuid();permit_id:=gen_random_uuid();page_id:=gen_random_uuid();
 insert into public.learn_business_input_request_permits
  (id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
 values(permit_id,tenant,source_job_id,'rollback-only',1,'{}',fingerprint);
 insert into public.learn_business_input_pages
  (id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,
   checkpoint_before,checkpoint_after,record_count)
 values(page_id,tenant,connection,'commusoft','properties',source_job_id,permit_id,
  jsonb_build_object('data',jsonb_build_array(customer_payload,site_payload,unmapped_payload)),
  '{}','{}',3);
 insert into public.learn_business_input_versions
  (id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(customer_version,tenant,connection,'commusoft','properties',customer_external,
   repeat('a',64),customer_payload),
  (site_version,tenant,connection,'commusoft','properties',site_external,
   repeat('b',64),site_payload),
  (unmapped_version,tenant,connection,'commusoft','properties',unmapped_external,
   repeat('c',64),unmapped_payload);
 insert into public.learn_business_input_observations(page_id,version_id,ordinal)
 values(page_id,customer_version,0),(page_id,site_version,1),
  (page_id,unmapped_version,2);
 insert into public.learn_business_input_links
  (tenant_id,connection_id,provider,collection,external_id,source_version_id,
   entity_kind,entity_table,entity_id,card_id,request,actor_id)
 values(tenant,connection,'commusoft','properties',customer_external,customer_version,
   'customer','people',customer_id,card_id,'{}',actor);
 insert into public.sites(id,tenant_id,person_id,label,source_system,external_id)
 values(conflict_id,tenant,customer_id,'Conflicting synthetic site','commusoft',site_external);
 candidate:=public.new_dawn_commusoft_exact_site_candidate(tenant,connection,site_external);
 if candidate->>'reason'<>'site_external_identity_conflict'
  then raise exception 'exact_site_test_conflict_accepted';end if;
 delete from public.sites where id=conflict_id and tenant_id=tenant;
 candidate:=public.new_dawn_commusoft_exact_site_candidate(tenant,connection,site_external);
 if candidate->>'state'<>'ready' then raise exception 'exact_site_test_candidate_not_ready';end if;
 candidate:=public.new_dawn_commusoft_exact_site_candidate(tenant,connection,unmapped_external);
 if candidate->>'reason'<>'customer_source_missing_or_ambiguous'
  then raise exception 'exact_site_test_unmapped_not_held';end if;
 review:=public.new_dawn_commusoft_exact_site_review_page(tenant,connection,
  '900000000000200',50,'Rollback-only exact site review');
 if not exists(select 1 from jsonb_array_elements(review->'rows') r
  where r->>'external_id'=site_external and r->>'state'='ready')
  or not exists(select 1 from jsonb_array_elements(review->'rows') r
  where r->>'external_id'=unmapped_external and r->>'state'='review')
  then raise exception 'exact_site_test_review_queue_missing';end if;
 result:=public.new_dawn_commusoft_exact_site_apply(tenant,connection,site_external,
  gen_random_uuid(),'Stale source must not project');
 if result->>'reason'<>'site_source_changed' then raise exception 'exact_site_test_stale_accepted';end if;
 result:=public.new_dawn_commusoft_exact_site_apply(tenant,connection,site_external,
  site_version,'Rollback-only exact workaddress projection');
 if result->>'state'<>'linked' then raise exception 'exact_site_test_project_failed';end if;
 link_id:=(result->>'link_id')::uuid;site_id:=(result->>'site_id')::uuid;
 if not exists(select 1 from public.learn_business_input_current_links where id=link_id)
  or not exists(select 1 from public.controlplane_change_log
   where id=(result->>'audit_id')::uuid and action='client_sites.exact_site_project')
  then raise exception 'exact_site_test_audit_missing';end if;
 result:=public.new_dawn_commusoft_exact_site_toggle(tenant,link_id,'reverse',
  'Rollback-only exact site reversal');
 if result->>'state'<>'reversed'
  or exists(select 1 from public.learn_business_input_current_links where id=link_id)
  then raise exception 'exact_site_test_reverse_failed';end if;
 result:=public.new_dawn_commusoft_exact_site_toggle(tenant,link_id,'restore',
  'Rollback-only exact site restore');
 if result->>'state'<>'restored'
  or not exists(select 1 from public.learn_business_input_current_links where id=link_id)
  then raise exception 'exact_site_test_restore_failed';end if;
 insert into public.jobs(tenant_id,source_system,external_id,job_number,
  customer_person_id,site_id,title,status,created_source,verified)
 values(tenant,'synthetic',unmapped_external,unmapped_external,customer_id,
  site_id,'Synthetic dependent job','open','synthetic',false);
 result:=public.new_dawn_commusoft_exact_site_toggle(tenant,link_id,'reverse',
  'Linked jobs must block site reversal');
 if result->>'reason'<>'site_in_use_by_job'
  then raise exception 'exact_site_test_job_dependency_ignored';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.new_dawn_commusoft_exact_site_toggle(tenant,link_id,'reverse',
   'Foreign actor must be denied');
  raise exception 'exact_site_test_foreign_actor_accepted';
 exception when sqlstate '42501' then null;end;
 create temporary table exact_site_test_receipt on commit drop as
  select 'exact-site-test-passed/1'::text marker;
end $fixture$;
select marker from exact_site_test_receipt;`;

let result;
let failure;
try { result = await query(`begin;\n${needsDependency ? dependencyBody : ""}\n${body}\n${fixture}\nrollback;`, false); }
catch (cause) { failure = cause; }
const after = await query(snapshotSql);
if (JSON.stringify(before) !== JSON.stringify(after))
  throw Error("TEST exact-site rehearsal did not roll back");
if (failure) throw failure;
if (result?.find?.((row) => row.marker === "exact-site-test-passed/1") == null)
  throw Error("TEST exact-site rollback receipt missing");
console.log(JSON.stringify({ state: "passed_rolled_back", durableChange: false }));
