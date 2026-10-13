-- Read-only canonical contact detail access, with the same card membership as
-- learn_customer_business_context. No identity, primary, consent or source writes.
begin;
create function public.learn_customer_contact_points(
 p_tenant uuid,p_card uuid,p_person uuid,p_after uuid default null,p_operator_reason text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); customer public.customer_cards%rowtype;
 entries jsonb;next_id uuid;total bigint;audit uuid;operator_mode boolean:=p_operator_reason is not null;
begin
 if auth.role() is distinct from 'authenticated' or actor is null then
  raise exception 'customer_contact_points_forbidden' using errcode='42501';end if;
 if operator_mode then
  perform public.learn_operator_input_access(p_tenant,actor,true);
  if length(btrim(p_operator_reason)) not between 3 and 500 then
   raise exception 'customer_contact_points_reason_invalid' using errcode='22023';end if;
 else perform public.learn_import_batch_authority(p_tenant,actor);end if;
 select * into customer from public.customer_cards where tenant_id=p_tenant and id=p_card;
 if not found then raise exception 'customer_contact_points_unavailable' using errcode='42501';end if;
 -- Match exactly the canonical people scope of the existing business-context reader.
 perform 1 from public.people t where t.tenant_id=p_tenant and t.id=p_person and
 (t.id=customer.person_id or (customer.person_id is null and customer.company_id is not null and t.company_id=customer.company_id) or exists(
  select 1 from public.graph_edges e join public.graph_nodes f on f.id=e.from_node_id and f.tenant_id=e.tenant_id
  join public.graph_nodes dest on dest.id=e.to_node_id and dest.tenant_id=e.tenant_id
  where e.tenant_id=p_tenant and e.edge_type='contact_for' and e.status='active'
   and f.node_type='person' and f.status='active' and f.source_table='people' and f.source_id=t.id
   and dest.node_type='customer_card' and dest.status='active' and dest.source_table='customer_cards' and dest.source_id=p_card));
 if not found then raise exception 'customer_contact_points_unavailable' using errcode='42501';end if;
 with matched as materialized(select cp.* from public.contact_points cp where cp.tenant_id=p_tenant and cp.person_id=p_person),
 page as(select * from matched where p_after is null or id>p_after order by id limit 26),
 shown as(select * from page order by id limit 25)
 select coalesce((select jsonb_agg(jsonb_build_object('id',id,'channel',channel,'value',left(value,4000),
  'label',left(label,200),'is_primary',is_primary,'verification_state',verification_state,
  'source',left(source,100),'last_observed_at',last_observed_at,'updated_at',updated_at,
  'truncated_fields',to_jsonb(array_remove(array[case when length(value)>4000 then 'value' end,
   case when length(label)>200 then 'label' end,case when length(source)>100 then 'source' end],null))) order by id) from shown),'[]'::jsonb),
  case when (select count(*) from page)>25 then (select id from shown order by id desc limit 1) end,
  (select count(*) from matched) into entries,next_id,total;
 if operator_mode then
  perform public.learn_operator_input_access(p_tenant,actor,true);
  audit:=gen_random_uuid();
  insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
  values(audit,p_tenant,actor::text,'customer_contact_points.read','contact_points',p_card::text,
   jsonb_build_object('person_id',p_person,'record_ids',(select coalesce(jsonb_agg(x->'id'),'[]'::jsonb) from jsonb_array_elements(entries)x),'after',p_after),
   btrim(p_operator_reason),audit::text,false,'learn-customer-contact-points');
 else perform public.learn_import_batch_authority(p_tenant,actor);end if;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','learn-customer-contact-points/1','tenant_id',p_tenant,'actor_id',actor,
  'card_id',p_card,'person_id',p_person,'after',p_after,'rows',entries,'next_after',next_id,'total',total,
  'observed_at',clock_timestamp(),'audit_id',audit,'operator_mode',operator_mode);
end$$;
revoke all on function public.learn_customer_contact_points(uuid,uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.learn_customer_contact_points(uuid,uuid,uuid,uuid,text) to authenticated;
commit;
