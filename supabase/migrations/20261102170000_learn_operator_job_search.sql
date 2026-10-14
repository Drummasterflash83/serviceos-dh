-- Audited tenant-scoped search of published jobs. No automatic identity links.
begin;
create function public.learn_operator_job_search(p_tenant uuid,p_query text,p_reason text,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();q text;entries jsonb;next_id uuid;audit_id uuid:=gen_random_uuid();checked timestamptz;
begin
 perform public.learn_operator_input_access(p_tenant,actor,true);
 if p_query is null or length(p_query)>120 or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'operator_job_search_invalid' using errcode='22023';end if;
 q:=btrim(p_query);
 with page as materialized(
  select j.id,jsonb_build_object('job_number',j.job_number,'title',left(j.title,500),'status',j.status,
   'customer',left(coalesce(p.display_name,c.name),500),
   'address',left(coalesce(s.address_text,p.address_text,c.address_text),1000),
   'postcode',coalesce(s.postcode,p.postcode,c.postcode)) fields
  from public.jobs j
  left join public.people p on p.id=j.customer_person_id and p.tenant_id=j.tenant_id
  left join public.companies c on c.id=j.customer_company_id and c.tenant_id=j.tenant_id
  left join public.sites s on s.id=j.site_id and s.tenant_id=j.tenant_id
  where j.tenant_id=p_tenant and (p_after is null or j.id>p_after)
   and (q='' or exists(select 1 from unnest(array[j.job_number,j.title,j.description,p.display_name,c.name,
    coalesce(s.address_text,p.address_text,c.address_text),coalesce(s.postcode,p.postcode,c.postcode)]) value
    where strpos(lower(value),lower(q))>0))
  order by j.id limit 26
 ), shown as(select * from page order by id limit 25)
 select coalesce((select jsonb_agg(jsonb_build_object('id',id,'fields',fields) order by id) from shown),'[]'::jsonb),
  case when (select count(*) from page)>25 then (select id from shown order by id desc limit 1) end
 into entries,next_id;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 checked:=clock_timestamp();
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,'client_jobs.search','jobs',p_tenant::text,
  jsonb_build_object('record_ids',(select coalesce(jsonb_agg(x->'id'),'[]'::jsonb) from jsonb_array_elements(entries)x),
   'query_sha256',encode(sha256(convert_to(q,'UTF8')),'hex'),'after',p_after),btrim(p_reason),audit_id::text,false,'openfolk-job-search');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','openfolk-job-search/1','tenant_id',p_tenant,'actor_id',actor,'query',q,
  'after',p_after,'rows',entries,'next_after',next_id,'observed_at',checked,'audit_id',audit_id);
end$$;
revoke all on function public.learn_operator_job_search(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.learn_operator_job_search(uuid,text,text,uuid) to authenticated;
commit;
