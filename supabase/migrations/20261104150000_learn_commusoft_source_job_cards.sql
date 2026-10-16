-- Source-backed job cards do not require person/company classification.
-- Read existing observations only; never create identities, jobs, scores or links.
begin;
create function public.learn_commusoft_source_job_rows(p_tenant uuid,p_connection uuid)
returns table(external_id text,version_id uuid,observed_at timestamptz,title text,source_status text,
 business_unit text,property_reference text,customer_reference text,company_name text,contact_name text,
 relationship_state text,customer_identity_state text,reviewed_job_id uuid)
language sql stable set search_path=pg_catalog as $$
 with observations as materialized(
  select v.id,v.collection,v.external_id,max(p.committed_at) seen
  from public.learn_business_input_versions v
  join public.learn_business_input_observations o on o.version_id=v.id
  join public.learn_business_input_pages p on p.id=o.page_id
   and (p.tenant_id,p.connection_id,p.provider,p.collection)=(v.tenant_id,v.connection_id,v.provider,v.collection)
  where v.tenant_id=p_tenant and v.connection_id=p_connection and v.provider='commusoft'
   and v.collection in ('jobs','properties') group by v.id,v.collection,v.external_id
 ), ranked as materialized(
  select *,dense_rank() over(partition by collection,external_id order by seen desc) recency from observations
 ), latest as materialized(
  select collection,external_id,case when count(*)=1 then min(id::text)::uuid end version_id,max(seen) seen
  from ranked where recency=1 group by collection,external_id
 ), sources as materialized(
  select l.*,v.payload from latest l left join public.learn_business_input_versions v
   on v.id=l.version_id and v.tenant_id=p_tenant and v.connection_id=p_connection
 ), jobs as materialized(
  select s.*,case when s.payload->>'propertyID' ~ '^[1-9][0-9]{0,15}$' then s.payload->>'propertyID' end property_ref
  from sources s where s.collection='jobs'
 ), related as materialized(
  select j.*,p.version_id property_version,p.external_id found_property,p.payload property_payload,
   case when p.payload->>'type'='customer' then p.external_id
    when p.payload->>'type'='workaddress' and p.payload->>'parentPropertyID' ~ '^[1-9][0-9]{0,15}$'
     then p.payload->>'parentPropertyID' end customer_ref,
   case when p.payload->>'type'='customer' then p.version_id else c.version_id end customer_version,
   case when p.payload->>'type'='customer' then p.payload else c.payload end customer_payload,
   c.external_id found_customer
  from jobs j left join sources p on p.collection='properties' and p.external_id=j.property_ref
  left join sources c on c.collection='properties' and c.external_id=p.payload->>'parentPropertyID'
 )
 select r.external_id,r.version_id,r.seen,
  coalesce(public.learn_business_input_text(r.payload,'description'),'Job '||r.external_id),
  public.learn_business_input_text(r.payload,'status'),public.learn_business_input_text(r.payload,'businessUnit'),
  r.property_ref,r.customer_ref,
  case when r.customer_payload->>'type'='customer' then public.learn_business_input_text(r.customer_payload,'companyName') end,
  case when r.customer_payload->>'type'='customer' then nullif(concat_ws(' ',
   public.learn_business_input_text(r.customer_payload->'contact','firstName'),
   public.learn_business_input_text(r.customer_payload->'contact','lastName')),'') end,
  case when r.version_id is null then 'job_source_conflict'
   when r.property_ref is null then 'property_reference_missing'
   when r.found_property is null then 'property_source_missing'
   when r.property_version is null then 'property_source_conflict'
   when r.property_payload->>'type'='customer' then 'customer_source_retained'
   when r.property_payload->>'type' is distinct from 'workaddress' then 'property_type_unresolved'
   when r.customer_ref is null then 'customer_reference_missing'
   when r.found_customer is null then 'customer_source_missing'
   when r.customer_version is null then 'customer_source_conflict'
   when r.customer_payload->>'type' is distinct from 'customer' then 'customer_type_unresolved'
   else 'site_customer_source_retained' end,
  case when r.customer_version is null or r.customer_payload->>'type' is distinct from 'customer' then 'unresolved'
   when cl.id is null then 'unreviewed'
   when cl.source_version_id is distinct from r.customer_version then 'review_changed'
   else 'reviewed' end,
  case when jl.source_version_id=r.version_id and j.metadata#>>'{learn_business_input,source_version_id}'=r.version_id::text
   then j.id end
 from related r
 left join public.learn_business_input_current_links cl on cl.tenant_id=p_tenant and cl.connection_id=p_connection
  and cl.provider='commusoft' and cl.collection='properties' and cl.external_id=r.customer_ref and cl.entity_kind='customer'
 left join public.learn_business_input_current_links jl on jl.tenant_id=p_tenant and jl.connection_id=p_connection
  and jl.provider='commusoft' and jl.collection='jobs' and jl.external_id=r.external_id and jl.entity_kind='job' and jl.entity_table='jobs'
 left join public.jobs j on j.tenant_id=p_tenant and j.id=jl.entity_id;
$$;
revoke all on function public.learn_commusoft_source_job_rows(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_commusoft_source_job_cards(p_tenant uuid,p_connection uuid,p_query text default '',p_open_only boolean default true,p_after text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare entries jsonb;counts jsonb;next_key text;audit uuid;latest_page timestamptz;
begin
 if p_connection is null or p_query is null or length(btrim(p_query))>200 or p_query ~ '[[:cntrl:]]'
  or p_open_only is null or (p_after is not null and p_after!~'^[1-9][0-9]{0,15}$') then
  raise exception 'commusoft_source_job_request_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 with all_jobs as materialized(select * from public.learn_commusoft_source_job_rows(p_tenant,p_connection)),
 filtered as materialized(select * from all_jobs where
  (not p_open_only or source_status in ('Open','ongoing','pending','on_hold')) and
  (btrim(p_query)='' or position(lower(btrim(p_query)) in lower(concat_ws(' ',external_id,title,business_unit,property_reference,customer_reference,company_name,contact_name)))>0)),
 page as materialized(select * from filtered where p_after is null or external_id collate "C">p_after collate "C"
  order by external_id collate "C" limit 26),shown as(select * from page order by external_id collate "C" limit 25)
 select coalesce((select jsonb_agg(to_jsonb(s) order by external_id collate "C") from shown s),'[]'),
  jsonb_build_object('retained_jobs',(select count(*) from all_jobs),'open_jobs',(select count(*) from all_jobs where source_status in ('Open','ongoing','pending','on_hold')),
   'matching_jobs',(select count(*) from filtered),'reviewed_jobs',(select count(*) from all_jobs where reviewed_job_id is not null),
   'source_relationship_gaps',(select count(*) from all_jobs where relationship_state not in ('customer_source_retained','site_customer_source_retained')),
   'unreviewed_customer_identities',(select count(*) from all_jobs where customer_identity_state<>'reviewed')),
  case when (select count(*) from page)>25 then(select external_id from shown order by external_id collate "C" desc limit 1) end
 into entries,counts,next_key;
 select max(committed_at) into latest_page from public.learn_business_input_pages
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft' and collection='jobs';
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,after,reason,view_as_active,source)
 values(p_tenant,auth.uid()::text,'commusoft.source_jobs.read','commusoft',p_connection::text,
  jsonb_build_object('row_count',jsonb_array_length(entries),'open_only',p_open_only),
  'Read retained job cards without inferring customer identity',false,'commusoft-source-job-cards') returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','commusoft-source-job-cards/1','tenant_id',p_tenant,'actor_id',auth.uid(),'connection_id',p_connection,
  'query',btrim(p_query),'open_only',p_open_only,'after',p_after,'rows',entries,'counts',counts,'next_after',next_key,
  'latest_job_page_at',latest_page,'observed_at',clock_timestamp(),'audit_id',audit);
end $$;
revoke all on function public.learn_commusoft_source_job_cards(uuid,uuid,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_source_job_cards(uuid,uuid,text,boolean,text) to authenticated;

-- Reuse explicit client selection, real operator identity and existing audit facade.
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure);
 needle:=$old$  when 'learn_commusoft_job_details' then array['p_tenant','p_connection','p_version']$old$;
 replacement:=needle||E'\n'||$new$  when 'learn_commusoft_source_job_cards' then array['p_tenant','p_connection','p_query','p_open_only','p_after']$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'commusoft_source_jobs_operator_contract_changed';end if;
 d:=replace(d,needle,replacement);
 needle:=$old$  when 'learn_commusoft_job_details' then result:=public.learn_commusoft_job_details(p_tenant,(p_args->>'p_connection')::uuid,(p_args->>'p_version')::uuid);$old$;
 replacement:=needle||E'\n'||$new$  when 'learn_commusoft_source_job_cards' then result:=public.learn_commusoft_source_job_cards(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_query',(p_args->>'p_open_only')::boolean,p_args->>'p_after');$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'commusoft_source_jobs_operator_dispatch_changed';end if;
 execute replace(d,needle,replacement);
end $$;
commit;
