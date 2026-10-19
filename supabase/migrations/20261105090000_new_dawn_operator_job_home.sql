-- Audited, tenant-scoped read-only home selection for an OpenFolk operator.
-- Recorded active statuses lead the bounded page; no provider priority or score is inferred.
begin;
create function public.new_dawn_operator_job_home(p_tenant uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); entries jsonb; audit_id uuid:=gen_random_uuid(); checked timestamptz;
begin
 perform public.learn_operator_input_access(p_tenant,actor,true);
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'new_dawn_operator_job_home_invalid' using errcode='22023';
 end if;
 with ranked as materialized (
  select j.id,j.updated_at,
   case j.status when 'on_hold' then 0 when 'pending' then 1 when 'open' then 2 else 3 end as review_order,
   jsonb_build_object(
    'job_number',j.job_number,'title',left(j.title,500),'status',j.status,
    'customer',left(coalesce(p.display_name,c.name),500),
    'address',left(coalesce(s.address_text,p.address_text,c.address_text),1000),
    'postcode',coalesce(s.postcode,p.postcode,c.postcode),
    'verified',j.verified,'updated_at',j.updated_at
   ) as fields
  from public.jobs j
  left join public.people p on p.id=j.customer_person_id and p.tenant_id=j.tenant_id
  left join public.companies c on c.id=j.customer_company_id and c.tenant_id=j.tenant_id
  left join public.sites s on s.id=j.site_id and s.tenant_id=j.tenant_id
  where j.tenant_id=p_tenant
  order by review_order,j.updated_at desc nulls last,j.id
  limit 12
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'fields',fields)
   order by review_order,updated_at desc nulls last,id),'[]'::jsonb) into entries from ranked;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 checked:=clock_timestamp();
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values
  (audit_id,p_tenant,actor::text,'client_jobs.home_preview','jobs',p_tenant::text,
   jsonb_build_object('record_ids',(select coalesce(jsonb_agg(x->'id'),'[]'::jsonb)
    from jsonb_array_elements(entries) x)),
   btrim(p_reason),audit_id::text,false,'new-dawn-job-home');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-operator-job-home/1','tenant_id',p_tenant,
  'actor_id',actor,'observed_at',checked,'audit_id',audit_id,'rows',entries);
end$$;
revoke all on function public.new_dawn_operator_job_home(uuid,text) from public,anon,service_role;
grant execute on function public.new_dawn_operator_job_home(uuid,text) to authenticated;
commit;
