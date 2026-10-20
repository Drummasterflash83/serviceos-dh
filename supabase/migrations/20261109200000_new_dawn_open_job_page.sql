-- Every uniquely retained Commusoft job with a saved open status is reachable
-- through keyset paging, even before its customer/site identity is reviewed.
-- Source labels are not canonical links. Installation makes no provider call,
-- projection, backfill or flag change.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.new_dawn_open_job_page(
 p_tenant uuid,p_reason text default null,p_cursor text default null,
 p_status text default null,p_page_size integer default 40
) returns jsonb language plpgsql security definer
 set search_path=pg_catalog set statement_timeout='15s' as $$
declare
 actor uuid:=auth.uid(); operator_read boolean:=p_reason is not null;
 flag_name text; c jsonb; anchor timestamptz; after_rank integer;
 after_observed timestamptz; after_external text; after_connection uuid;
 entries jsonb:='[]'::jsonb; n integer:=0; more boolean:=false;
 item record; property public.learn_business_input_versions%rowtype;
 customer public.learn_business_input_versions%rowtype;
 property_ref text; customer_ref text; property_payload jsonb;
 customer_payload jsonb; source_customer text; source_site text;
 source_postcode text; context_state text; identity_state text;
 last_rank integer; last_observed timestamptz; last_external text;
 last_connection uuid; next_cursor text; audit_id uuid:=gen_random_uuid();
 checked timestamptz;
begin
 if actor is null or p_tenant is null or auth.role() is distinct from 'authenticated'
  or p_page_size not between 1 and 50
  or (p_status is not null and p_status not in ('on_hold','pending','open'))
  or (p_cursor is not null and length(p_cursor)>512) then
  raise exception 'open_job_page_invalid' using errcode='22023';end if;
 perform 1 from auth.users u where u.id=actor and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'open_job_page_forbidden' using errcode='42501';end if;
 if operator_read then
  if length(btrim(p_reason)) not between 3 and 500 then
   raise exception 'open_job_page_invalid' using errcode='22023';end if;
  perform public.learn_operator_input_access(p_tenant,actor,true);
  flag_name:='new_dawn.open_job_page.operator_preview';
 else
  perform 1 from public.profiles p join public.tenants t on t.id=p.tenant_id
   where p.id=actor and p.tenant_id=p_tenant and p.role in ('owner','admin')
    and t.status='active' for share of p,t;
  if not found or exists(select 1 from public.view_as_context v
   where v.actor_user_id=actor and v.ended_at is null
    and (v.expires_at is null or v.expires_at>clock_timestamp()))
   or exists(select 1 from public.platform_authority_grants g
    where g.profile_id=actor
     and g.permission in ('platform.controlplane.view','platform.controlplane.admin')
     and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
     and coalesce(g.effective_to,'infinity')>clock_timestamp())
   then raise exception 'open_job_page_forbidden' using errcode='42501';end if;
  flag_name:='new_dawn.open_job_page';
 end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag=flag_name and value='true'::jsonb for share;
 if not found then raise exception 'open_job_page_disabled' using errcode='42501';end if;

 if p_cursor is null then anchor:=clock_timestamp();
 else
  begin
   c:=convert_from(decode(p_cursor,'base64'),'utf8')::jsonb;
   if jsonb_typeof(c)<>'object' or c->>'v'<>'1'
    or c->>'tenant' is distinct from p_tenant::text
    or c->>'status' is distinct from p_status
    or (c->>'rank')::integer not between 0 and 2 then
    raise exception 'invalid cursor';end if;
   anchor:=(c->>'anchor')::timestamptz;
   after_rank:=(c->>'rank')::integer;
   after_observed:=(c->>'observed')::timestamptz;
   after_external:=c->>'external';
   after_connection:=(c->>'connection')::uuid;
   if anchor>clock_timestamp()+interval '1 minute'
    or anchor<clock_timestamp()-interval '2 hours'
    or after_observed>anchor or after_external is null
    or length(after_external)>200 or after_connection is null then
    raise exception 'invalid cursor';end if;
  exception when others then
   raise exception 'open_job_page_invalid_cursor' using errcode='22023';
  end;
 end if;

 -- The anchor makes later pages read the same immutable source history, even
 -- while new imports arrive. Equal-time conflicting versions are withheld.
 for item in
  with latest_time as materialized (
   select v.connection_id,v.external_id,max(pg.committed_at) observed_at
   from public.learn_business_input_versions v
   join public.learn_business_input_observations o on o.version_id=v.id
   join public.learn_business_input_pages pg on pg.id=o.page_id
    and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
    and pg.provider=v.provider and pg.collection=v.collection
   where v.tenant_id=p_tenant and v.provider='commusoft'
    and v.collection='jobs' and pg.committed_at<=anchor
   group by v.connection_id,v.external_id
  ), unique_latest as materialized (
   select t.connection_id,t.external_id,t.observed_at,
    min(v.id::text)::uuid version_id
   from latest_time t
   join public.learn_business_input_versions v
    on v.tenant_id=p_tenant and v.connection_id=t.connection_id
     and v.provider='commusoft' and v.collection='jobs'
     and v.external_id=t.external_id
   join public.learn_business_input_observations o on o.version_id=v.id
   join public.learn_business_input_pages pg on pg.id=o.page_id
    and pg.tenant_id=p_tenant and pg.connection_id=t.connection_id
    and pg.provider='commusoft' and pg.collection='jobs'
    and pg.committed_at=t.observed_at
   group by t.connection_id,t.external_id,t.observed_at
   having count(distinct v.id)=1
  ), open_source as materialized (
   select u.*,v.payload,
    case v.payload->>'status' when 'Open' then 'open'
     when 'ongoing' then 'open' when 'pending' then 'pending'
     when 'on_hold' then 'on_hold' end source_status
   from unique_latest u
   join public.learn_business_input_versions v on v.id=u.version_id
    and v.tenant_id=p_tenant and v.connection_id=u.connection_id
    and v.provider='commusoft' and v.collection='jobs'
   where jsonb_typeof(v.payload->'id')='number'
    and v.payload->>'id'=u.external_id
  )
  select x.connection_id,x.external_id,x.version_id,x.observed_at,
   x.payload,x.source_status,
   case x.source_status when 'on_hold' then 0
    when 'pending' then 1 else 2 end rank
  from open_source x
  where x.source_status is not null
   and (p_status is null or x.source_status=p_status)
   and (after_connection is null
    or (case x.source_status when 'on_hold' then 0
      when 'pending' then 1 else 2 end)>after_rank
    or ((case x.source_status when 'on_hold' then 0
      when 'pending' then 1 else 2 end)=after_rank
     and (x.observed_at<after_observed
      or (x.observed_at=after_observed
       and (x.external_id collate "C">after_external collate "C"
        or (x.external_id=after_external
         and x.connection_id>after_connection))))))
  order by rank,x.observed_at desc,x.external_id collate "C",x.connection_id
  limit p_page_size+1
 loop
  n:=n+1;
  if n>p_page_size then more:=true;exit;end if;
  property_ref:=case when jsonb_typeof(item.payload->'propertyID')='number'
   and item.payload->>'propertyID' ~ '^[1-9][0-9]{0,15}$'
   then item.payload->>'propertyID' end;
  property:=null;customer:=null;customer_ref:=null;
  source_customer:=null;source_site:=null;source_postcode:=null;
  context_state:='source_property_missing';
  if property_ref is not null then
   property:=public.learn_business_input_latest(
    p_tenant,item.connection_id,'commusoft','properties',property_ref);
  end if;
  if property.id is not null and property.payload->>'id'=property_ref
   and property.payload->>'type' in ('customer','workaddress') then
   property_payload:=property.payload;
   customer_ref:=case when property_payload->>'type'='customer'
    then property_ref when jsonb_typeof(property_payload->'parentPropertyID')='number'
     and property_payload->>'parentPropertyID' ~ '^[1-9][0-9]{0,15}$'
    then property_payload->>'parentPropertyID' end;
   if customer_ref=property_ref then customer:=property;
   elsif customer_ref is not null then
    customer:=public.learn_business_input_latest(
     p_tenant,item.connection_id,'commusoft','properties',customer_ref);
   end if;
   source_site:=nullif(left(concat_ws(', ',
    nullif(btrim(property_payload->>'addressLine1'),''),
    nullif(btrim(property_payload->>'addressLine2'),''),
    nullif(btrim(property_payload->>'addressLine3'),''),
    nullif(btrim(property_payload->>'town'),''),
    nullif(btrim(property_payload->>'province'),'')),1000),'');
   source_postcode:=nullif(left(btrim(property_payload->>'postcode'),40),'');
   if customer.id is not null and customer.payload->>'id'=customer_ref
    and customer.payload->>'type'='customer' then
    customer_payload:=customer.payload;
    source_customer:=nullif(left(coalesce(
     nullif(btrim(customer_payload->>'companyName'),''),
     nullif(btrim(concat_ws(' ',
      nullif(btrim(customer_payload->'contact'->>'firstName'),''),
      nullif(btrim(customer_payload->'contact'->>'lastName'),''))),'')),500),'');
    context_state:='source_customer_and_property';
   else context_state:='source_property_only';end if;
  end if;
  select case when count(*)=1 and bool_and(
   l.source_version_id=item.version_id and j.id is not null
   and j.metadata#>>'{learn_business_input,source_version_id}'=item.version_id::text)
   then 'reviewed_link' else 'awaiting_review' end
   into identity_state
   from public.learn_business_input_current_links l
   left join public.jobs j on j.id=l.entity_id and j.tenant_id=p_tenant
   where l.tenant_id=p_tenant and l.connection_id=item.connection_id
    and l.provider='commusoft' and l.collection='jobs'
    and l.external_id=item.external_id and l.entity_kind='job'
    and l.entity_table='jobs';
  entries:=entries||jsonb_build_array(jsonb_build_object(
   'connection_id',item.connection_id,'external_id',item.external_id,
   'source_version_id',item.version_id,'source_observed_at',item.observed_at,
   'status',item.source_status,
   'title',left(nullif(btrim(item.payload->>'description'),''),500),
   'source_customer',source_customer,'source_site',source_site,
   'source_postcode',source_postcode,'property_external_id',property_ref,
   'customer_external_id',customer_ref,'context_state',context_state,
   'identity_state',identity_state));
  last_rank:=item.rank;last_observed:=item.observed_at;
  last_external:=item.external_id;last_connection:=item.connection_id;
 end loop;
 if more then next_cursor:=encode(convert_to(jsonb_build_object(
  'v',1,'tenant',p_tenant,'status',p_status,'anchor',anchor,
  'rank',last_rank,'observed',last_observed,
  'external',last_external,'connection',last_connection)::text,'utf8'),'base64');end if;
 if operator_read then perform public.learn_operator_input_access(p_tenant,actor,true);end if;
 checked:=clock_timestamp();
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,
  case when operator_read then 'client_jobs.open_page_preview'
   else 'client_jobs.open_page_read' end,
  'jobs',p_tenant::text,jsonb_build_object(
   'source_keys',(select coalesce(jsonb_agg(jsonb_build_object(
    'connection',x->>'connection_id','external',x->>'external_id')),'[]'::jsonb)
    from jsonb_array_elements(entries) x),
   'status_filter',p_status,'returned_count',jsonb_array_length(entries),
   'has_more',more,'snapshot_at',anchor),
  case when operator_read then btrim(p_reason) else 'Client open job page' end,
  audit_id::text,false,'new-dawn-open-job-page');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-open-job-page/1',
  'tenant_id',p_tenant,'actor_id',actor,'audit_id',audit_id,
  'observed_at',checked,'snapshot_at',anchor,'status_filter',p_status,
  'rows',entries,'next_cursor',next_cursor,'has_more',more);
end $$;
revoke all on function public.new_dawn_open_job_page(uuid,text,text,text,integer)
 from public,anon,service_role;
grant execute on function public.new_dawn_open_job_page(uuid,text,text,text,integer)
 to authenticated;
commit;
