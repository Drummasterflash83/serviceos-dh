-- Provider-neutral canonical business context; no projection, capture or source writes.
begin;
create function public.learn_customer_business_context(
 p_tenant uuid,p_card uuid,p_collection text,p_after uuid default null,p_operator_reason text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); customer public.customer_cards%rowtype;
 tab text;cols text[];body text;predicate text;entries jsonb;next_id uuid;total bigint;
 audit uuid;checked timestamptz;operator_mode boolean:=p_operator_reason is not null;
begin
 if auth.role() is distinct from 'authenticated' or actor is null then
  raise exception 'customer_context_forbidden' using errcode='42501';end if;
 if operator_mode then
  perform public.learn_operator_input_access(p_tenant,actor,true);
  if length(btrim(p_operator_reason)) not between 3 and 500 then
   raise exception 'customer_context_reason_invalid' using errcode='22023';end if;
 else
  perform public.learn_import_batch_authority(p_tenant,actor);
 end if;
 select * into customer from public.customer_cards where tenant_id=p_tenant and id=p_card;
 if not found then raise exception 'customer_context_unavailable' using errcode='42501';end if;
 case p_collection
 when 'sites' then
  tab:='sites';cols:=array['label','address_text','postcode','verified','source_system','external_id','updated_at'];
  predicate:='(($3 is not null and t.person_id=$3) or ($3 is null and $4 is not null and t.company_id=$4))';
 when 'jobs' then
  tab:='jobs';cols:=array['title','job_number','description','status','priority','site_id','verified','source_system','external_id','created_date','completed_date','updated_at'];
  predicate:='(($3 is not null and t.customer_person_id=$3) or ($3 is null and $4 is not null and t.customer_company_id=$4))';
 when 'contacts' then
  tab:='people';cols:=array['display_name','primary_email','primary_phone','verified','updated_at'];
  predicate:='(t.id=$3 or ($3 is null and $4 is not null and t.company_id=$4) or exists(
   select 1 from public.graph_edges e join public.graph_nodes f on f.id=e.from_node_id and f.tenant_id=e.tenant_id
   join public.graph_nodes dest on dest.id=e.to_node_id and dest.tenant_id=e.tenant_id
   where e.tenant_id=$1 and e.edge_type=''contact_for'' and e.status=''active''
    and f.node_type=''person'' and f.status=''active'' and f.source_table=''people'' and f.source_id=t.id
    and dest.node_type=''customer_card'' and dest.status=''active'' and dest.source_table=''customer_cards'' and dest.source_id=$5))';
 else raise exception 'customer_context_collection_invalid' using errcode='22023';end case;
 select string_agg(format('%L,to_jsonb(t.%I)',c,c),',') into body from unnest(cols)c;
 if p_collection='jobs' then body:=body||',''time_evidence'',(select jsonb_object_agg(k,jsonb_build_object(
  ''state'',left(t.metadata#>>array[''learn_business_input'',''timestamps'',k,''state''],32),
  ''source'',left(t.metadata#>>array[''learn_business_input'',''timestamps'',k,''source''],100),
  ''instant'',left(t.metadata#>>array[''learn_business_input'',''timestamps'',k,''instant''],50)))
  from unnest(array[''created'',''completed''])k)';end if;
 execute format($query$
  with matched as materialized(
   select t.id,jsonb_build_object(%s) fields from public.%I t where t.tenant_id=$1 and %s
  ),page as(select * from matched where $2::uuid is null or id>$2 order by id limit 26),
  shown as(select * from page order by id limit 25),mapped as(
   select s.id,jsonb_build_object('id',s.id,'fields',(
    select jsonb_object_agg(key,case when jsonb_typeof(value)='string' then to_jsonb(left(value#>>'{}',4000)) else value end)
    from jsonb_each(s.fields)),
    'truncated_fields',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb) from jsonb_each(s.fields)
      where jsonb_typeof(value)='string' and length(value#>>'{}')>4000),
    'sources',(select coalesce(jsonb_agg(x.entry order by x.link_id),'[]'::jsonb) from(
     select l.id link_id,jsonb_build_object('provider',l.provider,'collection',l.collection,'external_id',l.external_id,
      'version_id',v.id,'first_seen_at',v.first_seen_at) entry
     from public.learn_business_input_links l join public.learn_business_input_versions v
      on v.id=l.source_version_id and v.tenant_id=l.tenant_id and v.connection_id=l.connection_id
       and v.provider=l.provider and v.collection=l.collection and v.external_id=l.external_id
     where l.tenant_id=$1 and l.card_id=$5 and l.entity_table=%L and l.entity_id=s.id
     order by l.id limit 5)x)) entry from shown s
  ) select coalesce((select jsonb_agg(entry order by id) from mapped),'[]'::jsonb),
   case when (select count(*) from page)>25 then (select id from shown order by id desc limit 1) end,
   (select count(*) from matched)
 $query$,body,tab,predicate,tab) into entries,next_id,total
 using p_tenant,p_after,customer.person_id,customer.company_id,p_card;
 if operator_mode then
  perform public.learn_operator_input_access(p_tenant,actor,true);
  audit:=gen_random_uuid();
  insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
  values(audit,p_tenant,actor::text,'customer_context.read',p_collection,p_card::text,
   jsonb_build_object('record_ids',(select coalesce(jsonb_agg(x->'id'),'[]'::jsonb) from jsonb_array_elements(entries)x),'after',p_after),
   btrim(p_operator_reason),audit::text,false,'learn-customer-business-context');
 else perform public.learn_import_batch_authority(p_tenant,actor);end if;
 checked:=clock_timestamp();
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','learn-customer-business-context/1','tenant_id',p_tenant,'actor_id',actor,
  'card_id',p_card,'collection',p_collection,'after',p_after,'rows',entries,'next_after',next_id,'total',total,
  'observed_at',checked,'audit_id',audit,'operator_mode',operator_mode);
end$$;
revoke all on function public.learn_customer_business_context(uuid,uuid,text,uuid,text) from public,anon,service_role;
grant execute on function public.learn_customer_business_context(uuid,uuid,text,uuid,text) to authenticated;
commit;
