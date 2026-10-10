-- Reviewed property contacts use canonical People, contact points and graph edges.
-- Source consent flags stay evidence; they never grant marketing permission.
begin;
create function public.learn_business_contact_phone(p_value text,p_region text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case when nullif(btrim(p_value),'') is null then null
  when p_region='uk' then public.import_normalize_phone_uk(p_value)
  else nullif((case when left(btrim(p_value),1)='+' then '+' else '' end)||regexp_replace(p_value,'[^0-9]','','g'),'') end;
$$;

create function public.learn_commusoft_confirm_contact(p_tenant uuid,p_version uuid,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;owner jsonb;request jsonb;result jsonb;
 parent text;reason text;field text;label text;email text;region text;phone jsonb;phones jsonb:='[]';normalized text;
 target uuid;namespace text;meta jsonb;person_node uuid;card_node uuid;site_node uuid;edge uuid;phone_count integer;
begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_version is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
  raise exception 'business_input_review_invalid' using errcode='22023';end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft' and collection='propertyContacts';
 if not found then raise exception 'business_input_contact_source_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 select non_secret_config->>'region' into region from public.provider_connections where tenant_id=p_tenant and id=v.connection_id for update;
 request:=jsonb_build_object('target',p_target,'reason',btrim(p_reason),'kind','contact');
 <<project>> begin
  latest:=public.learn_business_input_latest(p_tenant,v.connection_id,v.provider,v.collection,v.external_id);
  if latest.id is distinct from v.id then reason:='source_changed_or_ambiguous';exit project;end if;
  if jsonb_typeof(v.payload->'id') is distinct from 'number' or v.payload->>'id' is distinct from v.external_id then reason:='source_identity_invalid';exit project;end if;
  parent:=v.payload->>'propertyID';
  if jsonb_typeof(v.payload->'propertyID') is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$' then reason:='property_reference_invalid';exit project;end if;
  if parent::numeric>9007199254740991 then reason:='property_reference_invalid';exit project;end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,v.connection_id,parent,true);
  if owner->>'state'<>'ready' then reason:=owner->>'reason';exit project;end if;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=v.connection_id
   and provider=v.provider and collection=v.collection and external_id=v.external_id;
  if found then
   if l.source_version_id<>v.id or l.entity_kind<>'contact' or l.entity_table<>'people'
    or (p_target is not null and p_target<>l.entity_id) or l.card_id is distinct from (owner->>'card_id')::uuid then
    reason:='existing_identity_needs_review';exit project;end if;
   perform 1 from public.people where tenant_id=p_tenant and id=l.entity_id for share;
   if not found then reason:='contact_target_missing';exit project;end if;
   result:=jsonb_build_object('state','linked','entity_id',l.entity_id,'entity_kind','contact','link_id',l.id,'already',true);
   exit project;
  end if;
  foreach field in array array['firstName','lastName','position','email'] loop
   if v.payload ? field and v.payload->field<>'null'::jsonb and (jsonb_typeof(v.payload->field)<>'string' or length(v.payload->>field)>1000) then
    reason:='contact_field_invalid';exit project;end if;
  end loop;
  label:=nullif(btrim(concat_ws(' ',nullif(btrim(v.payload->>'firstName'),''),nullif(btrim(v.payload->>'lastName'),''))),'');
  if label is null then reason:='contact_name_required';exit project;end if;
  email:=nullif(lower(btrim(v.payload->>'email')),'');
  if email is not null and (length(email)>320 or email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then reason:='contact_email_invalid';exit project;end if;
  if v.payload ? 'telephones' and v.payload->'telephones'<>'null'::jsonb then
   if jsonb_typeof(v.payload->'telephones')<>'array' then reason:='contact_phone_invalid';exit project;end if;
   if jsonb_array_length(v.payload->'telephones')>50 then reason:='contact_phone_invalid';exit project;end if;
   for phone in select value from jsonb_array_elements(v.payload->'telephones') loop
    if jsonb_typeof(phone)<>'object' or jsonb_typeof(phone->'number') is distinct from 'string' or length(phone->>'number')>1000
     or (phone ? 'type' and phone->'type'<>'null'::jsonb and (jsonb_typeof(phone->'type')<>'string' or length(phone->>'type')>100)) then
     reason:='contact_phone_invalid';exit project;end if;
    normalized:=public.learn_business_contact_phone(phone->>'number',region);
    if normalized is null or normalized!~'^\+?[0-9]{5,20}$' then reason:='contact_phone_invalid';exit project;end if;
    if not exists(select 1 from jsonb_array_elements(phones) x where x->>'normalized'=normalized) then
     phones:=phones||jsonb_build_array(jsonb_build_object('value',phone->>'number','normalized',normalized,'label',nullif(btrim(phone->>'type'),'')));
    end if;
   end loop;
  end if;
  target:=p_target;
  if target is not null then
   perform 1 from public.people where id=target and tenant_id=p_tenant for share;
   if not found then reason:='contact_target_missing';exit project;end if;
  else
   -- Potential channel matches need explicit selection; never silently duplicate
   -- or merge a customer, household member or shared reception identity.
   if exists(select 1 from public.people p where p.tenant_id=p_tenant and
     ((email is not null and lower(btrim(p.primary_email))=email) or exists(select 1 from jsonb_array_elements(phones) x where public.learn_business_contact_phone(p.primary_phone,region)=x->>'normalized')))
    or exists(select 1 from public.contact_points cp where cp.tenant_id=p_tenant and
     ((email is not null and cp.channel='email' and cp.normalized_value=email) or (cp.channel='phone' and exists(select 1 from jsonb_array_elements(phones) x where cp.normalized_value=x->>'normalized')))) then
    reason:='contact_identity_needs_review';exit project;end if;
  end if;
  -- Existing inactive relationship evidence is not reactivated by an import.
  if target is not null and exists(select 1 from public.graph_edges e
   join public.graph_nodes f on f.id=e.from_node_id and f.tenant_id=e.tenant_id
   join public.graph_nodes t on t.id=e.to_node_id and t.tenant_id=e.tenant_id
   where e.tenant_id=p_tenant and e.edge_type='contact_for' and f.node_type='person' and f.source_table='people' and f.source_id=target
    and ((t.node_type='customer_card' and t.source_table='customer_cards' and t.source_id=(owner->>'card_id')::uuid)
      or (t.node_type='site' and t.source_table='sites' and t.source_id=(owner->>'site_id')::uuid)) and e.status<>'active') then
   reason:='contact_relationship_needs_review';exit project;end if;
  meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,'source_version_id',v.id,'property_external_id',parent,'position',v.payload->'position','relationships',owner));
  phone_count:=jsonb_array_length(phones);
  if target is null then
   insert into public.people(tenant_id,display_name,first_name,last_name,primary_email,primary_phone,verified,created_source,metadata)
    values(p_tenant,label,nullif(btrim(v.payload->>'firstName'),''),nullif(btrim(v.payload->>'lastName'),''),email,
     case when phone_count=1 then phones->0->>'value' end,false,'business_input:commusoft',meta) returning id into target;
  end if;
  -- Existing person fields and endpoint verification/primary choices remain intact.
  if email is not null then
   insert into public.contact_points(tenant_id,person_id,channel,value,normalized_value,is_primary,verification_state,source,source_record_ref,metadata)
    values(p_tenant,target,'email',btrim(v.payload->>'email'),email,false,'unverified','import',v.id::text,meta) on conflict(tenant_id,person_id,channel,normalized_value) do nothing;
  end if;
  for phone in select value from jsonb_array_elements(phones) loop
   insert into public.contact_points(tenant_id,person_id,channel,value,normalized_value,label,is_primary,verification_state,source,source_record_ref,metadata)
    values(p_tenant,target,'phone',phone->>'value',phone->>'normalized',phone->>'label',false,'unverified','import',v.id::text,meta) on conflict(tenant_id,person_id,channel,normalized_value) do nothing;
  end loop;
  insert into public.graph_nodes(tenant_id,node_type,source_table,source_id,label,metadata)
   select p_tenant,'person','people',id,display_name,meta from public.people where id=target and tenant_id=p_tenant
   on conflict(tenant_id,node_type,source_table,source_id) where source_id is not null do nothing;
  select id into person_node from public.graph_nodes where tenant_id=p_tenant and node_type='person' and source_table='people' and source_id=target;
  insert into public.graph_nodes(tenant_id,node_type,source_table,source_id,label,metadata)
   select p_tenant,'customer_card','customer_cards',id,title,meta from public.customer_cards where id=(owner->>'card_id')::uuid and tenant_id=p_tenant
   on conflict(tenant_id,node_type,source_table,source_id) where source_id is not null do nothing;
  select id into card_node from public.graph_nodes where tenant_id=p_tenant and node_type='customer_card' and source_table='customer_cards' and source_id=(owner->>'card_id')::uuid;
  insert into public.graph_edges(tenant_id,edge_type,from_node_id,to_node_id,evidence,metadata)
   values(p_tenant,'contact_for',person_node,card_node,jsonb_build_array(jsonb_build_object('source_version_id',v.id)),meta)
   on conflict(tenant_id,edge_type,from_node_id,to_node_id) do nothing;
  if owner->>'site_id' is not null then
   insert into public.graph_nodes(tenant_id,node_type,source_table,source_id,label,metadata)
    select p_tenant,'site','sites',s.id,s.label,meta from public.sites s where s.id=(owner->>'site_id')::uuid and tenant_id=p_tenant
    on conflict(tenant_id,node_type,source_table,source_id) where source_id is not null do nothing;
   select id into site_node from public.graph_nodes where tenant_id=p_tenant and node_type='site' and source_table='sites' and source_id=(owner->>'site_id')::uuid;
   insert into public.graph_edges(tenant_id,edge_type,from_node_id,to_node_id,evidence,metadata)
    values(p_tenant,'contact_for',person_node,site_node,jsonb_build_array(jsonb_build_object('source_version_id',v.id)),meta)
    on conflict(tenant_id,edge_type,from_node_id,to_node_id) do nothing;
  end if;
  insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
   values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,'contact','people',target,(owner->>'card_id')::uuid,request||jsonb_build_object('relationships',owner),auth.uid()) returning * into l;
  insert into public.graph_events(tenant_id,event_type,node_id,payload) values(p_tenant,'contact.linked',person_node,jsonb_build_object('source_link_id',l.id,'source_version_id',v.id,'customer_card_id',l.card_id));
  result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind','contact','link_id',l.id,'already',false);
 end project;
 if reason is not null then result:=jsonb_build_object('state','held','reason',reason);end if;
 return public.learn_business_input_projection_result(p_tenant,v.id,request,result);
end $$;
revoke all on function public.learn_business_contact_phone(text,text) from public,anon,authenticated,service_role;
revoke all on function public.learn_commusoft_confirm_contact(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.learn_commusoft_confirm_contact(uuid,uuid,uuid,text) to authenticated;

create or replace function public.learn_commusoft_work_batch(p_tenant uuid,p_request uuid,p_connection uuid,p_kind text,p_items jsonb,p_reason text,p_cancel boolean default false,p_expected_actor uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.learn_business_input_projection_batches%rowtype;v public.learn_business_input_versions%rowtype;
 request jsonb;result jsonb;outcomes jsonb:='[]';item jsonb;outcome jsonb;version uuid;target uuid;
 seen uuid[]:='{}';identities text[]:='{}';linked integer:=0;held integer:=0;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 if p_expected_actor is distinct from auth.uid() then raise exception 'business_input_actor_changed' using errcode='42501';end if;
 -- Existing tenant roster lock also serializes competing confirmations/cancellations.
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 if p_request is null or p_connection is null or p_kind is null or p_kind not in ('site','job','contact') or p_cancel is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 or jsonb_typeof(p_items) is distinct from 'array'
  or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'business_input_batch_invalid' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>2
   or jsonb_typeof(item->'version_id') is distinct from 'string' or item->>'version_id'!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or not item ? 'target_id' or not (item->'target_id'='null'::jsonb or (jsonb_typeof(item->'target_id')='string' and item->>'target_id'~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')) then
   raise exception 'business_input_batch_item_invalid' using errcode='22023';end if;
  version:=(item->>'version_id')::uuid;
  if version=any(seen) then raise exception 'business_input_batch_duplicate' using errcode='22023';end if;
  seen:=array_append(seen,version);
 end loop;
 request:=jsonb_build_object('connection_id',p_connection,'kind',p_kind,'items',p_items,'reason',btrim(p_reason));
 select * into b from public.learn_business_input_projection_batches where tenant_id=p_tenant and id=p_request;
 if found then
  if b.actor_id is distinct from auth.uid() or b.request is distinct from request then raise exception 'business_input_batch_conflict' using errcode='PT409';end if;
  return b.result; -- A saved cancellation also fences a late original apply.
 end if;
 if not p_cancel then
  perform public.learn_business_input_review_access(p_tenant,p_connection);
  perform 1 from public.provider_connections where id=p_connection and tenant_id=p_tenant for update;
  -- Prevalidate every scope before any row is projected. Unknown/foreign rows
  -- abort the batch, rather than becoming successful partial application.
  for item in select value from jsonb_array_elements(p_items) loop
   select * into v from public.learn_business_input_versions where id=(item->>'version_id')::uuid and tenant_id=p_tenant
    and connection_id=p_connection and provider='commusoft';
   if not found or (p_kind='contact' and v.collection<>'propertyContacts') or (p_kind='job' and v.collection<>'jobs') or
    (p_kind='site' and (v.collection<>'properties' or v.payload->>'type' is distinct from 'workaddress')) then
    raise exception 'business_input_batch_scope_invalid' using errcode='22023';end if;
   if v.external_id=any(identities) then raise exception 'business_input_batch_identity_duplicate' using errcode='22023';end if;
   identities:=array_append(identities,v.external_id);
  end loop;
  for item in select value from jsonb_array_elements(p_items) loop
   if p_kind='contact' then outcome:=public.learn_commusoft_confirm_contact(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));
   else outcome:=public.learn_commusoft_confirm_work_record(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));end if;
   if outcome->>'state'='linked' then linked:=linked+1;
   elsif outcome->>'state'='held' then held:=held+1;
   else raise exception 'business_input_batch_outcome_invalid';end if;
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('version_id',item->>'version_id','outcome',outcome));
  end loop;
 end if;
 result:=jsonb_build_object('batch_id',p_request,'tenant_id',p_tenant,'actor_id',auth.uid(),'connection_id',p_connection,'kind',p_kind,
  'state',case when p_cancel then 'cancelled' else 'recorded' end,'items',outcomes,'linked',linked,'held',held);
 insert into public.learn_business_input_projection_batches(tenant_id,id,actor_id,request,result) values(p_tenant,p_request,auth.uid(),request,result);
 return result;
end $$;


create or replace function public.learn_commusoft_work_review_page(p_tenant uuid,p_connection uuid,p_kind text,p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r record;v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 rows jsonb:='[]';owner jsonb;attempt jsonb;label text;parent text;customer text;v_collection text;last_id text;counted integer:=0;more boolean:=false;
begin
 if p_connection is null or p_kind is null or p_kind not in ('site','job','contact') or p_limit is null or p_limit not between 1 and 50
  or (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 v_collection:=case when p_kind='site' then 'properties' when p_kind='contact' then 'propertyContacts' else 'jobs' end;
 for r in select distinct s.external_id collate "C" as external_id from public.learn_business_input_versions s where s.tenant_id=p_tenant and s.connection_id=p_connection
  and s.provider='commusoft' and s.collection=v_collection and (p_kind in ('job','contact') or s.payload->>'type'='workaddress')
  and (p_after is null or s.external_id collate "C">p_after collate "C") order by s.external_id collate "C" limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.external_id;
  v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft',v_collection,r.external_id);
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and learn_business_input_links.collection=v_collection and external_id=r.external_id;
  parent:=case when p_kind='site' then v.payload->>'parentPropertyID' else v.payload->>'propertyID' end;
  owner:=case when v.id is null then jsonb_build_object('state','held','reason','source_changed_or_ambiguous')
   else public.learn_commusoft_property_owner(p_tenant,p_connection,parent,p_kind in ('job','contact')) end;
  customer:=null;
  if owner->>'state'='ready' then
   if owner->>'person_id' is not null then select display_name into customer from public.people where tenant_id=p_tenant and id=(owner->>'person_id')::uuid;
   else select name into customer from public.companies where tenant_id=p_tenant and id=(owner->>'company_id')::uuid;end if;
  end if;
  select a.result into attempt from public.learn_business_input_projection_attempts a where a.tenant_id=p_tenant and a.source_version_id=v.id order by a.created_at desc,a.id desc limit 1;
  label:=case when p_kind='site' then public.learn_business_input_text(v.payload,'addressLine1') when p_kind='contact' then nullif(btrim(concat_ws(' ',public.learn_business_input_text(v.payload,'firstName'),public.learn_business_input_text(v.payload,'lastName'))),'') else public.learn_business_input_text(v.payload,'description') end;
  rows:=rows||jsonb_build_array(jsonb_build_object('external_id',r.external_id,'version_id',v.id,'title',coalesce(label,initcap(p_kind)||' '||r.external_id),
   'property_reference',case when parent~'^[1-9][0-9]{0,15}$' then parent end,'customer_name',left(customer,1000),'relationship_reason',owner->>'reason',
   'source_status',public.learn_business_input_text(v.payload,'status'),'linked_version_id',l.source_version_id,'last_result',attempt,
   'contact',case when p_kind='contact' then jsonb_build_object('email',public.learn_business_input_text(v.payload,'email'),'position',public.learn_business_input_text(v.payload,'position'),
    'phones',(select coalesce(jsonb_agg(x.number),'[]'::jsonb) from (select left(concat_ws(': ',ph->>'type',ph->>'number'),1000) as number from jsonb_array_elements(case when jsonb_typeof(v.payload->'telephones')='array' then v.payload->'telephones' else '[]'::jsonb end) ph where jsonb_typeof(ph->'number')='string' limit 50) x)) end,
   'selectable',v.id is not null and coalesce(p_kind in ('job','contact') or v.payload->>'type'='workaddress',false)));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'kind',p_kind,'rows',rows,'next_cursor',case when more then last_id end);
end $$;

create function public.learn_commusoft_contact_candidates(p_tenant uuid,p_version uuid,p_kind text,p_search text default '',p_after uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;region text;label text;email text;r record;rows jsonb:='[]';last_id uuid;counted integer:=0;more boolean:=false;begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_version is null or p_kind is distinct from 'person' or p_search is null or length(btrim(p_search))=1 or length(btrim(p_search))>150
  or p_limit is null or p_limit not between 1 and 50 then raise exception 'business_input_candidates_invalid' using errcode='22023';end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft' and collection='propertyContacts';
 if not found then raise exception 'business_input_contact_source_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 select non_secret_config->>'region' into region from public.provider_connections where id=v.connection_id and tenant_id=p_tenant;
 label:=lower(btrim(concat_ws(' ',public.learn_business_input_text(v.payload,'firstName'),public.learn_business_input_text(v.payload,'lastName'))));
 email:=lower(public.learn_business_input_text(v.payload,'email'));
 for r in with matches as (
  select p.*,
   (email is not null and (lower(btrim(p.primary_email))=email or exists(select 1 from public.contact_points cp where cp.tenant_id=p_tenant and cp.person_id=p.id and cp.channel='email' and cp.normalized_value=email))) as shared_email,
   exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v.payload->'telephones')='array' then v.payload->'telephones' else '[]'::jsonb end) ph
    where jsonb_typeof(ph->'number')='string' and (public.learn_business_contact_phone(p.primary_phone,region)=public.learn_business_contact_phone(ph->>'number',region)
     or exists(select 1 from public.contact_points cp where cp.tenant_id=p_tenant and cp.person_id=p.id and cp.channel='phone' and cp.normalized_value=public.learn_business_contact_phone(ph->>'number',region)))) as shared_phone
  from public.people p where p.tenant_id=p_tenant and (p_after is null or p.id>p_after)
 ) select * from matches m where
  (btrim(p_search)='' and (m.shared_email or m.shared_phone or (label<>'' and lower(btrim(m.display_name))=label)))
  or (btrim(p_search)<>'' and (strpos(lower(m.display_name),lower(btrim(p_search)))>0 or strpos(lower(coalesce(m.primary_email,'')),lower(btrim(p_search)))>0))
  order by m.id limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.id;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',r.id,'name',left(r.display_name,1000),'email',left(r.primary_email,1000),'phone',left(r.primary_phone,1000),'postcode',left(r.postcode,1000),
   'reason',case when r.shared_email then 'shared_email' when r.shared_phone then 'shared_phone' when btrim(p_search)='' then 'same_name' else 'search' end));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'version_id',p_version,'kind','person','rows',rows,'next_cursor',case when more then last_id end);
end $$;
revoke all on function public.learn_commusoft_contact_candidates(uuid,uuid,text,text,uuid,integer) from public,anon,service_role;
grant execute on function public.learn_commusoft_contact_candidates(uuid,uuid,text,text,uuid,integer) to authenticated;
commit;
