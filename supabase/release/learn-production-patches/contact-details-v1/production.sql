-- Read-only canonical contact detail access, with the same card membership as
-- learn_customer_business_context. No identity, primary, consent or source writes.
begin isolation level repeatable read;
set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from '90b47cf7bea1e290e5b9f5d9f1364f73fb341b04c317eb4e122c271af586fcb9' then raise exception 'Exact contact-details target/source/role required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_customer_business_context(uuid,uuid,text,uuid,text)'::regprocedure) is distinct from '0aca3dac49b265d26a51034b00a7ce12|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed function/access differs: learn_customer_business_context';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_import_batch_authority(uuid,uuid)'::regprocedure) is distinct from '4b4020b92092a7f09453f765a55dee65|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed function/access differs: learn_import_batch_authority';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_operator_input_access(uuid,uuid,boolean)'::regprocedure) is distinct from '6ebce242963afa929b7465a99e7608c6|postgres|{postgres=X/postgres}' then raise exception 'Reviewed function/access differs: learn_operator_input_access';end if;
if to_regprocedure('public.learn_customer_contact_points(uuid,uuid,uuid,uuid,text)') is not null then raise exception 'Contact-details change already installed';end if;
end $guard$;
create temporary table contact_details_preservation on commit drop as select jsonb_build_object('roles',(select md5(jsonb_agg(to_jsonb(x) order by roleid,member,grantor)::text) from pg_auth_members x),'policies',(select md5(jsonb_agg(to_jsonb(x) order by schemaname,tablename,policyname)::text) from pg_policies x),'schedules',null,'tables',(select md5(jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.relname)::text) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'),'people',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.people x),'companies',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.companies x),'customer_cards',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.customer_cards x),'contact_points',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.contact_points x),'graph_nodes',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.graph_nodes x),'graph_edges',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.graph_edges x),'learn_business_input_links',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.learn_business_input_links x),'provider_connections',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.provider_connections x),'platform_authority_grants',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.platform_authority_grants x),'functions',(select md5(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.oid)::text) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in('f','p') and p.proname<>'learn_customer_contact_points')) evidence;
do $schedules$declare h text;begin if to_regclass('cron.job') is not null then execute 'select md5(jsonb_agg(to_jsonb(x) order by jobid)::text) from cron.job x' into h;end if;update pg_temp.contact_details_preservation set evidence=evidence||jsonb_build_object('schedules',h);end $schedules$;

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
do $guard$declare current_evidence jsonb;schedule_hash text;begin
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_customer_business_context(uuid,uuid,text,uuid,text)'::regprocedure) is distinct from '0aca3dac49b265d26a51034b00a7ce12|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed function/access differs: learn_customer_business_context';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_import_batch_authority(uuid,uuid)'::regprocedure) is distinct from '4b4020b92092a7f09453f765a55dee65|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed function/access differs: learn_import_batch_authority';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_operator_input_access(uuid,uuid,boolean)'::regprocedure) is distinct from '6ebce242963afa929b7465a99e7608c6|postgres|{postgres=X/postgres}' then raise exception 'Reviewed function/access differs: learn_operator_input_access';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_customer_contact_points(uuid,uuid,uuid,uuid,text)'::regprocedure) is distinct from 'f4c3c6a6872ae71f997e1628b550b614|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed function/access differs: learn_customer_contact_points';end if;
select evidence into current_evidence from (select jsonb_build_object('roles',(select md5(jsonb_agg(to_jsonb(x) order by roleid,member,grantor)::text) from pg_auth_members x),'policies',(select md5(jsonb_agg(to_jsonb(x) order by schemaname,tablename,policyname)::text) from pg_policies x),'schedules',null,'tables',(select md5(jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.relname)::text) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'),'people',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.people x),'companies',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.companies x),'customer_cards',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.customer_cards x),'contact_points',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.contact_points x),'graph_nodes',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.graph_nodes x),'graph_edges',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.graph_edges x),'learn_business_input_links',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.learn_business_input_links x),'provider_connections',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.provider_connections x),'platform_authority_grants',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.platform_authority_grants x),'functions',(select md5(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.oid)::text) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in('f','p') and p.proname<>'learn_customer_contact_points')) evidence) q;
if to_regclass('cron.job') is not null then execute 'select md5(jsonb_agg(to_jsonb(x) order by jobid)::text) from cron.job x' into schedule_hash;end if;current_evidence:=current_evidence||jsonb_build_object('schedules',schedule_hash);
if current_evidence is distinct from (select evidence from pg_temp.contact_details_preservation) then raise exception 'Contact-details release changed data/access/schedules';end if;end $guard$;
notify pgrst,'reload schema';
commit;
