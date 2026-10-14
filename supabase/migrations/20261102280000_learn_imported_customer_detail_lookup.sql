-- Resolve one retained source directly. The full customer catalogue takes several
-- seconds and must not run twice for every job/contact/accounting detail request.
begin;
create function public.learn_imported_customer_source_ref(p_tenant uuid,p_environment text,p_source_key text)
returns table(provider text,scope_ref text,external_id text,version_id uuid,conflicted boolean)
language sql stable set search_path=pg_catalog as $$
 with parts as (select split_part(p_source_key,':',1) provider,split_part(p_source_key,':',2) scope_ref,split_part(p_source_key,':',3) external_id),
 cs_observed as materialized(
  select v.id,max(page.committed_at) seen from parts x
  join public.learn_business_input_versions v on v.tenant_id=p_tenant and v.connection_id=case when x.provider='commusoft' and x.scope_ref ~ '^[a-fA-F0-9-]{36}$' then x.scope_ref::uuid end and v.external_id=x.external_id and v.provider='commusoft' and v.collection='properties'
  join public.learn_business_input_observations o on o.version_id=v.id
  join public.learn_business_input_pages page on page.id=o.page_id and(page.tenant_id,page.connection_id,page.provider,page.collection)=(v.tenant_id,v.connection_id,v.provider,v.collection)
  where x.provider='commusoft' group by v.id
 ),cs_latest as(
  select min(id::text)::uuid id,max(seen) seen,count(*) versions from cs_observed
  where seen=(select max(seen) from cs_observed)
 ),cs as(
  select 'commusoft'::text provider,x.scope_ref,x.external_id,v.id version_id,(r.versions<>1) conflicted
  from parts x join cs_latest r on r.id is not null
  join public.learn_business_input_versions v on v.id=r.id and v.tenant_id=p_tenant
  where x.provider='commusoft' and (v.payload->>'type'='customer' or exists(
   select 1 from public.learn_business_input_links k where k.tenant_id=p_tenant and k.connection_id=v.connection_id
    and k.provider='commusoft' and k.collection='properties' and k.external_id=v.external_id and k.entity_kind='customer'))
 ),qb as(
  select 'quickbooks'::text provider,x.scope_ref,x.external_id,l.version_id,l.conflicted
  from parts x join public.learn_quickbooks_latest l on l.tenant_id=p_tenant and l.environment=p_environment and l.realm_id=x.scope_ref and l.entity='Customer' and l.external_id=x.external_id
  join public.learn_quickbooks_source_versions v on v.id=l.version_id and v.tenant_id=p_tenant
  where x.provider='quickbooks' and v.payload->'Job' is distinct from 'true'::jsonb and nullif(v.payload#>>'{ParentRef,value}','') is null
 )
 select * from cs union all select * from qb;
$$;
revoke all on function public.learn_imported_customer_source_ref(uuid,text,text) from public,anon,authenticated,service_role;

do $patch$
declare previous text;updated text;begin
 select p.prosrc into previous from pg_proc p where p.oid='public.learn_imported_customer_detail(uuid,text,text,uuid,text,uuid,text)'::regprocedure;
 if md5(previous)<>'4e8c1b522bf2db572f936c803d66d6ac' then raise exception 'imported_customer_detail_baseline_changed';end if;
 updated:=replace(previous,
  'select * into root from public.learn_imported_customer_sources(p_tenant,p_environment) where source_key=p_source_key;',
  'select * into root from public.learn_imported_customer_source_ref(p_tenant,p_environment,p_source_key);');
 if updated=previous then raise exception 'imported_customer_detail_root_patch_missing';end if;
 previous:=updated;
 updated:=replace(previous,$needle$root.review_state='source_conflict'$needle$,'root.conflicted');
 if updated=previous then raise exception 'imported_customer_detail_conflict_patch_missing';end if;
 previous:=updated;
 updated:=replace(previous,
  $needle$public.learn_imported_customer_sources(p_tenant,p_environment) s where s.source_key=p_source_key and s.version_id=p_source_version and s.review_state<>'source_conflict'$needle$,
  'public.learn_imported_customer_source_ref(p_tenant,p_environment,p_source_key) s where s.version_id=p_source_version and not s.conflicted');
 if updated=previous then raise exception 'imported_customer_detail_recheck_patch_missing';end if;
 execute format('create or replace function public.learn_imported_customer_detail(p_tenant uuid,p_environment text,p_source_key text,p_source_version uuid,p_kind text,p_after uuid default null,p_operator_reason text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',updated);
end $patch$;
commit;
