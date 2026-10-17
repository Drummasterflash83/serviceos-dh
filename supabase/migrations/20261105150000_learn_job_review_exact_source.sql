-- A one-job review must not materialise every retained Commusoft job and
-- property. Preserve the same latest-observation/conflict and reviewed-link
-- tests while narrowing the source lookup to the requested external job ID.
begin;
do $migration$
declare d text; needle text; replacement text;
begin
 d:=pg_get_functiondef('public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)'::regprocedure);
 needle:=$old$  select * into source_row from public.learn_commusoft_source_job_rows(p_tenant,p_connection)
    where external_id=p_external_id;$old$;
 replacement:=$new$  with observed as materialized (
    select v.id,max(p.committed_at) seen
    from public.learn_business_input_versions v
    join public.learn_business_input_observations o on o.version_id=v.id
    join public.learn_business_input_pages p on p.id=o.page_id
      and (p.tenant_id,p.connection_id,p.provider,p.collection)=
          (v.tenant_id,v.connection_id,v.provider,v.collection)
    where v.tenant_id=p_tenant and v.connection_id=p_connection
      and v.provider='commusoft' and v.collection='jobs'
      and v.external_id=p_external_id
    group by v.id
  ), latest as (
    select max(seen) seen from observed
  ), current_source as (
    select case when count(*)=1 then min(id::text)::uuid end version_id,
      max(seen) observed_at
    from observed where seen=(select seen from latest)
  )
  select current_source.version_id,current_source.observed_at,
    case when current_source.version_id is not null
      then public.learn_business_input_text(v.payload,'status') end source_status,
    case when jl.source_version_id=current_source.version_id
      and j.metadata#>>'{learn_business_input,source_version_id}'=current_source.version_id::text
      then j.id end reviewed_job_id
  into source_row
  from current_source
  left join public.learn_business_input_versions v
    on v.id=current_source.version_id and v.tenant_id=p_tenant
      and v.connection_id=p_connection and v.provider='commusoft' and v.collection='jobs'
  left join public.learn_business_input_current_links jl
    on jl.tenant_id=p_tenant and jl.connection_id=p_connection and jl.provider='commusoft'
      and jl.collection='jobs' and jl.external_id=p_external_id
      and jl.entity_kind='job' and jl.entity_table='jobs'
  left join public.jobs j on j.tenant_id=p_tenant and j.id=jl.entity_id;$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'job_review_source_lookup_contract_changed';
 end if;
 execute replace(d,needle,replacement);
end $migration$;
commit;
