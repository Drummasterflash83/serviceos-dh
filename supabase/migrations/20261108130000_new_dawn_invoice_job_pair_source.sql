-- One exact, operator-only comparison of retained QuickBooks Invoice and
-- reviewed Commusoft job source. This creates no cross-provider relationship,
-- allocation, revenue, debt, client permission, or provider request.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.new_dawn_invoice_job_pair_source(
 p_tenant uuid,p_invoice_version uuid,p_job uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();c public.learn_quickbooks_connections%rowtype;
 realm_count integer;l public.learn_quickbooks_latest%rowtype;
 invoice public.learn_quickbooks_source_versions%rowtype;
 j public.jobs%rowtype;job_link_count integer;link record;
 job_source public.learn_business_input_versions%rowtype;
 fields jsonb:='[]'::jsonb;observed timestamptz;
 audit uuid;read_at timestamptz:=clock_timestamp();
begin
 if auth.role() is distinct from 'authenticated' or actor is null or p_tenant is null
  or p_invoice_version is null or p_job is null or p_reason is null
  or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'invoice_job_source_forbidden' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.learn_quickbooks_actor_access(p_tenant,actor);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.invoice_review_candidates_preview' and value='true'::jsonb for share;
 if not found then raise exception 'invoice_job_source_disabled' using errcode='42501';end if;

 select count(*) into realm_count from public.learn_quickbooks_connections
  where tenant_id=p_tenant and environment='production' and confirmed_at is not null
   and realm_id is not null and status<>'disconnected';
 if realm_count<>1 then raise exception 'invoice_job_source_realm_unconfirmed' using errcode='42501';end if;
 select * into c from public.learn_quickbooks_connections
  where tenant_id=p_tenant and environment='production' and confirmed_at is not null
   and realm_id is not null and status<>'disconnected' for share;
 select * into invoice from public.learn_quickbooks_source_versions
  where id=p_invoice_version and tenant_id=p_tenant and environment='production'
   and realm_id=c.realm_id and entity='Invoice';
 if not found or invoice.content_hash !~ '^[0-9a-f]{64}$'
  or invoice.external_id !~ '^[0-9]{1,30}$'
  or invoice.payload->>'Id' is distinct from invoice.external_id then
  raise exception 'invoice_job_source_invoice_unavailable' using errcode='42501';end if;
 select * into l from public.learn_quickbooks_latest
  where tenant_id=p_tenant and environment='production' and realm_id=c.realm_id
   and entity='Invoice' and external_id=invoice.external_id for share;
 if not found or l.conflicted or l.version_id is distinct from invoice.id
  or l.sync_token is distinct from invoice.sync_token
  or l.source_updated_at is distinct from invoice.source_updated_at
  or l.last_observed_at>read_at or l.last_observed_at<read_at-interval '7 days' then
  raise exception 'invoice_job_source_invoice_changed' using errcode='42501';end if;

 select * into j from public.jobs where id=p_job and tenant_id=p_tenant for share;
 if not found then raise exception 'invoice_job_source_job_unavailable' using errcode='42501';end if;
 select count(*) into job_link_count from public.learn_business_input_current_links x
  where x.tenant_id=p_tenant and x.entity_kind='job' and x.entity_table='jobs'
   and x.entity_id=p_job and x.provider='commusoft' and x.collection='jobs';
 if job_link_count<>1 then raise exception 'invoice_job_source_job_unreviewed' using errcode='42501';end if;
 select x.connection_id,x.source_version_id,x.external_id into link
  from public.learn_business_input_current_links x
  where x.tenant_id=p_tenant and x.entity_kind='job' and x.entity_table='jobs'
   and x.entity_id=p_job and x.provider='commusoft' and x.collection='jobs';
 select * into job_source from public.learn_business_input_versions
  where id=link.source_version_id and tenant_id=p_tenant
   and connection_id=link.connection_id and provider='commusoft'
   and collection='jobs' and external_id=link.external_id;
 if not found or j.metadata#>>'{learn_business_input,source_version_id}' is distinct from job_source.id::text
  or j.metadata#>>'{learn_business_input,connection_id}' is distinct from link.connection_id::text
  or j.external_id is distinct from link.external_id
  or job_source.payload->>'id' is distinct from link.external_id
  or job_source.content_hash !~ '^[0-9a-f]{64}$' then
  raise exception 'invoice_job_source_job_changed' using errcode='42501';end if;
 if (public.learn_business_input_latest(p_tenant,link.connection_id,'commusoft','jobs',
   link.external_id)).id is distinct from job_source.id then
  raise exception 'invoice_job_source_job_changed' using errcode='42501';end if;
 select max(p.committed_at) into observed from public.learn_business_input_observations o
  join public.learn_business_input_pages p on p.id=o.page_id
  where o.version_id=job_source.id and p.tenant_id=p_tenant
   and p.connection_id=link.connection_id and p.provider='commusoft' and p.collection='jobs';
 if observed is null then raise exception 'invoice_job_source_job_unobserved' using errcode='42501';end if;

 -- These are literal QuickBooks custom fields for human source review. A
 -- same-looking value is never interpreted as a Commusoft document/job link.
 if invoice.payload ? 'CustomField' and invoice.payload->'CustomField'<>'null'::jsonb
  and (jsonb_typeof(invoice.payload->'CustomField') is distinct from 'array'
   or jsonb_array_length(invoice.payload->'CustomField')>20) then
  raise exception 'invoice_job_source_custom_fields_unavailable' using errcode='42501';end if;
 if jsonb_typeof(invoice.payload->'CustomField')='array' then
  select coalesce(jsonb_agg(jsonb_build_object('name',left(x->>'Name',100),
   'value',left(x->>'StringValue',200)) order by ord),'[]'::jsonb)
  into fields from jsonb_array_elements(invoice.payload->'CustomField')
   with ordinality f(x,ord)
  where jsonb_typeof(x->'Name')='string' and jsonb_typeof(x->'StringValue')='string';
 end if;

 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.learn_quickbooks_actor_access(p_tenant,actor);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,actor,'invoice.job_pair_source_read',jsonb_build_object(
  'realm_id',c.realm_id,'invoice_id',invoice.external_id,'invoice_version_id',invoice.id,
  'job_id',j.id,'commusoft_connection_id',link.connection_id,
  'job_source_version_id',job_source.id,'relationship','unverified'),btrim(p_reason))
 returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-invoice-job-pair-source/1',
  'audience','openfolk_operator_only','tenant_id',p_tenant,'actor_id',actor,
  'read_at',read_at,'audit_id',audit,'relationship','unverified',
  'invoice',jsonb_build_object('realm_id',c.realm_id,'invoice_id',invoice.external_id,
   'version_id',invoice.id,'source_sha256',invoice.content_hash,
   'observed_at',l.last_observed_at,'document_number',left(invoice.payload->>'DocNumber',200),
   'customer_reference',left(invoice.payload#>>'{CustomerRef,value}',100),
   'custom_fields',fields),
  'job',jsonb_build_object('job_id',j.id,'connection_id',link.connection_id,
   'external_id',link.external_id,'job_number',j.job_number,
   'version_id',job_source.id,'source_sha256',job_source.content_hash,
   'observed_at',observed,
   'customer_reference',case when jsonb_typeof(job_source.payload->'customerReference')='string'
    then left(job_source.payload->>'customerReference',200) end));
end $$;
revoke all on function public.new_dawn_invoice_job_pair_source(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_invoice_job_pair_source(uuid,uuid,uuid,text)
 to authenticated;
commit;
