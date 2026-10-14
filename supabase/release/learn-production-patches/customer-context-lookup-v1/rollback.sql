begin;
CREATE OR REPLACE FUNCTION public.learn_card_slack_job_context(p_tenant uuid, p_person uuid, p_company uuid)
 RETURNS TABLE(interaction_id uuid, context jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and tenant_id=p_tenant and role in('owner','admin'))
 then raise exception 'Company owner/admin communication access required' using errcode='42501';end if;
 if p_tenant is null or (p_person is null and p_company is null) then return;end if;
 return query
 with owned as materialized(
  select j.*,l.connection_id,l.source_version_id,l.external_id provider_job,l.id job_link_id
  from public.jobs j join public.learn_business_input_links l on l.tenant_id=j.tenant_id and l.entity_id=j.id
   and l.entity_kind='job' and l.entity_table='jobs' and l.provider='commusoft' and l.collection='jobs'
  join public.provider_connections c on c.tenant_id=l.tenant_id and c.id=l.connection_id and c.provider=l.provider
   and c.status='configured' and c.revoked_at is null
  where j.tenant_id=p_tenant and (j.customer_person_id=p_person or j.customer_company_id=p_company)
   and j.source_system='commusoft:connection:'||l.connection_id::text and j.external_id=l.external_id
   and j.metadata#>>'{learn_business_input,connection_id}'=l.connection_id::text
   and j.metadata#>>'{learn_business_input,source_version_id}'=l.source_version_id::text
 ), current_jobs as materialized(
  select j.*,cp.id customer_source_version,cl.id customer_link_id,pl.source_version_id property_source_version
  from owned j
  join lateral public.learn_business_input_latest(p_tenant,j.connection_id,'commusoft','jobs',j.provider_job)v
   on v.id=j.source_version_id and v.payload->>'id'=j.provider_job and jsonb_typeof(v.payload->'id')='number'
  join lateral public.learn_business_input_latest(p_tenant,j.connection_id,'commusoft','properties',v.payload->>'propertyID')p
   on p.id is not null and jsonb_typeof(v.payload->'propertyID')='number'
   and p.payload->>'id'=v.payload->>'propertyID' and jsonb_typeof(p.payload->'id')='number'
   and j.metadata#>>'{learn_business_input,property_external_id}'=v.payload->>'propertyID'
  join public.learn_business_input_links pl on pl.tenant_id=p_tenant and pl.connection_id=j.connection_id
   and pl.provider='commusoft' and pl.collection='properties' and pl.external_id=p.external_id and pl.source_version_id=p.id
  join lateral public.learn_business_input_latest(p_tenant,j.connection_id,'commusoft','properties',
   case p.payload->>'type' when 'customer' then p.external_id when 'workaddress' then p.payload->>'parentPropertyID' end)cp
   on cp.id is not null and cp.payload->>'type'='customer' and cp.payload->>'id'=cp.external_id and jsonb_typeof(cp.payload->'id')='number'
  join public.learn_business_input_links cl on cl.tenant_id=p_tenant and cl.connection_id=j.connection_id
   and cl.provider='commusoft' and cl.collection='properties' and cl.external_id=cp.external_id and cl.source_version_id=cp.id and cl.entity_kind='customer'
  join public.customer_cards card on card.tenant_id=p_tenant and card.id=cl.card_id
   and ((cl.entity_table='people' and card.person_id=cl.entity_id) or (cl.entity_table='companies' and card.person_id is null and card.company_id=cl.entity_id))
  where j.customer_person_id is not distinct from case when cl.entity_table='people' then cl.entity_id end
   and j.customer_company_id is not distinct from case when cl.entity_table='companies' then cl.entity_id end
   and ((cl.entity_table='people' and exists(select 1 from public.people where tenant_id=p_tenant and id=cl.entity_id))
    or (cl.entity_table='companies' and exists(select 1 from public.companies where tenant_id=p_tenant and id=cl.entity_id)))
   and ((p.payload->>'type'='customer' and j.site_id is null and pl.id=cl.id)
    or (p.payload->>'type'='workaddress' and pl.entity_kind='site' and pl.entity_table='sites' and pl.entity_id=j.site_id
     and jsonb_typeof(p.payload->'parentPropertyID')='number' and p.payload->>'parentPropertyID'=cp.external_id
     and exists(select 1 from public.sites site where site.tenant_id=p_tenant and site.id=j.site_id
      and site.person_id is not distinct from j.customer_person_id and site.company_id is not distinct from j.customer_company_id
      and site.metadata#>>'{learn_business_input,connection_id}'=j.connection_id::text
      and site.metadata#>>'{learn_business_input,source_version_id}'=p.id::text)))
 )
 select i.id,jsonb_build_object('version','learn-customer-job-context/1','kind','reviewed_slack_job',
  'job_id',j.id,'person_id',j.customer_person_id,'company_id',j.customer_company_id,
  'review_request_id',r.request_id,'source_version',s.source_version,'job_source_version_id',j.source_version_id,
  'property_source_version_id',j.property_source_version,'customer_source_version_id',j.customer_source_version)
 from public.interactions i
 join current_jobs j on j.tenant_id=i.tenant_id and j.id=i.related_job_id
 join public.slack_messages s on s.tenant_id=i.tenant_id and s.id=i.source_id and s.source_version=i.metadata->>'source_version'
 join public.learn_slack_context_reviews r on r.tenant_id=i.tenant_id and r.interaction_id=i.id
  and r.request_id::text=i.metadata#>>'{work_context,request_id}' and r.receipt->>'state'='committed'
  and r.receipt->'context'=i.metadata->'work_context' and r.definition->>'job_id'=j.id::text
 where i.tenant_id=p_tenant and i.source_table='slack_messages' and i.source_connector_id='slack'
  and i.interaction_type='slack_message' and i.processing_status='enriched' and coalesce(i.status,'') not in('deleted','removed')
  and i.metadata#>>'{work_context,version}'='learn-slack-work-context/1'
  and i.metadata#>>'{work_context,state}'='reviewed' and i.metadata#>>'{work_context,scope}'='job'
  and i.metadata#>>'{work_context,source_version}'=s.source_version and i.metadata#>>'{work_context,job_id}'=j.id::text
  and public.learn_slack_message_kind(s.provider_payload)='conversation'
  and exists(select 1 from public.slack_message_versions version
   join public.slack_source_visibility_proofs proof on proof.version_id=version.id
   join public.slack_channel_visibility_receipts visibility on visibility.id=proof.receipt_id and visibility.tenant_id=version.tenant_id
   join public.provider_connections slack_connection on slack_connection.id=visibility.connection_id and slack_connection.tenant_id=visibility.tenant_id
    and slack_connection.provider='slack' and slack_connection.status='configured' and slack_connection.revoked_at is null
    and slack_connection.non_secret_config->>'team_id'=visibility.team_id
   where version.tenant_id=s.tenant_id and version.message_id=s.id and version.source_version=s.source_version and version.provider_payload=s.provider_payload
    and visibility.team_id=s.team_id and visibility.channel_id=s.channel_id
    and visibility.evidence->>'version'='slack-capture-visibility/1'
    and visibility.evidence->'is_channel'='true'::jsonb and visibility.evidence->'is_private'='false'::jsonb
    and visibility.evidence->'is_shared'='false'::jsonb and visibility.evidence->'pending_shared'='false'::jsonb
    and not exists(select 1 from unnest(array['is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']) f
     where visibility.evidence->f not in('false'::jsonb,'null'::jsonb)))
 order by i.occurred_at desc nulls last,i.id limit 51;
end$function$
;
commit;
