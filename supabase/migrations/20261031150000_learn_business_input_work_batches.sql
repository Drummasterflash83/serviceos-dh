-- Bounded reviewed work batches, source summaries and recoverable/cancellable receipts.
begin;
create table public.learn_business_input_projection_batches (
 tenant_id uuid not null,id uuid not null,actor_id uuid not null,request jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,id)
);
alter table public.learn_business_input_projection_batches enable row level security;
revoke all on public.learn_business_input_projection_batches from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_projection_batches
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_projection_batches
 for each statement execute function public.learn_business_input_retain();

create function public.learn_commusoft_work_batch(p_tenant uuid,p_request uuid,p_connection uuid,p_kind text,p_items jsonb,p_reason text,p_cancel boolean default false,p_expected_actor uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.learn_business_input_projection_batches%rowtype;v public.learn_business_input_versions%rowtype;
 request jsonb;result jsonb;outcomes jsonb:='[]';item jsonb;outcome jsonb;version uuid;target uuid;
 seen uuid[]:='{}';identities text[]:='{}';linked integer:=0;held integer:=0;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 if p_expected_actor is distinct from auth.uid() then raise exception 'business_input_actor_changed' using errcode='42501';end if;
 -- Existing tenant roster lock also serializes competing confirmations/cancellations.
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 if p_request is null or p_connection is null or p_kind is null or p_kind not in ('site','job') or p_cancel is null
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
   if not found or (p_kind='job' and v.collection<>'jobs') or
    (p_kind='site' and (v.collection<>'properties' or v.payload->>'type' is distinct from 'workaddress')) then
    raise exception 'business_input_batch_scope_invalid' using errcode='22023';end if;
   if v.external_id=any(identities) then raise exception 'business_input_batch_identity_duplicate' using errcode='22023';end if;
   identities:=array_append(identities,v.external_id);
  end loop;
  for item in select value from jsonb_array_elements(p_items) loop
   outcome:=public.learn_commusoft_confirm_work_record(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));
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

create function public.learn_commusoft_work_batch_result(p_tenant uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 if p_request is null then raise exception 'business_input_batch_invalid' using errcode='22023';end if;
 select b.result into result from public.learn_business_input_projection_batches b where tenant_id=p_tenant and id=p_request and actor_id=auth.uid();
 return result; -- null is an observed absence, never a cancelled/incomplete write guarantee.
end $$;

create function public.learn_commusoft_work_review_page(p_tenant uuid,p_connection uuid,p_kind text,p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r record;v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 rows jsonb:='[]';owner jsonb;attempt jsonb;label text;parent text;customer text;v_collection text;last_id text;counted integer:=0;more boolean:=false;
begin
 if p_connection is null or p_kind is null or p_kind not in ('site','job') or p_limit is null or p_limit not between 1 and 50
  or (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 v_collection:=case when p_kind='site' then 'properties' else 'jobs' end;
 for r in select distinct s.external_id collate "C" as external_id from public.learn_business_input_versions s where s.tenant_id=p_tenant and s.connection_id=p_connection
  and s.provider='commusoft' and s.collection=v_collection and (p_kind='job' or s.payload->>'type'='workaddress')
  and (p_after is null or s.external_id collate "C">p_after collate "C") order by s.external_id collate "C" limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.external_id;
  v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft',v_collection,r.external_id);
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and learn_business_input_links.collection=v_collection and external_id=r.external_id;
  parent:=case when p_kind='site' then v.payload->>'parentPropertyID' else v.payload->>'propertyID' end;
  owner:=case when v.id is null then jsonb_build_object('state','held','reason','source_changed_or_ambiguous')
   else public.learn_commusoft_property_owner(p_tenant,p_connection,parent,p_kind='job') end;
  customer:=null;
  if owner->>'state'='ready' then
   if owner->>'person_id' is not null then select display_name into customer from public.people where tenant_id=p_tenant and id=(owner->>'person_id')::uuid;
   else select name into customer from public.companies where tenant_id=p_tenant and id=(owner->>'company_id')::uuid;end if;
  end if;
  select a.result into attempt from public.learn_business_input_projection_attempts a where a.tenant_id=p_tenant and a.source_version_id=v.id order by a.created_at desc,a.id desc limit 1;
  label:=case when p_kind='site' then public.learn_business_input_text(v.payload,'addressLine1') else public.learn_business_input_text(v.payload,'description') end;
  rows:=rows||jsonb_build_array(jsonb_build_object('external_id',r.external_id,'version_id',v.id,'title',coalesce(label,initcap(p_kind)||' '||r.external_id),
   'property_reference',case when parent~'^[1-9][0-9]{0,15}$' then parent end,'customer_name',left(customer,1000),'relationship_reason',owner->>'reason',
   'source_status',public.learn_business_input_text(v.payload,'status'),'linked_version_id',l.source_version_id,'last_result',attempt,
   'selectable',v.id is not null and coalesce(p_kind='job' or v.payload->>'type'='workaddress',false)));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'kind',p_kind,'rows',rows,'next_cursor',case when more then last_id end);
end $$;
revoke all on function public.learn_commusoft_work_batch(uuid,uuid,uuid,text,jsonb,text,boolean,uuid),public.learn_commusoft_work_batch_result(uuid,uuid),public.learn_commusoft_work_review_page(uuid,uuid,text,text,integer) from public,anon,service_role;
grant execute on function public.learn_commusoft_work_batch(uuid,uuid,uuid,text,jsonb,text,boolean,uuid),public.learn_commusoft_work_batch_result(uuid,uuid),public.learn_commusoft_work_review_page(uuid,uuid,text,text,integer) to authenticated;
commit;
