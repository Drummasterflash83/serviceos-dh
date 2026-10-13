CREATE OR REPLACE FUNCTION public.learn_card_communications_read(p_tenant uuid, p_person uuid DEFAULT NULL::uuid, p_company uuid DEFAULT NULL::uuid, p_job uuid DEFAULT NULL::uuid, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor_tenant uuid;actor_role text;result jsonb;
begin
 -- The reader role can see only the actual caller profile through its RLS policy.
 -- Policies bind auth.uid() at creation; runtime auth-schema lookup is unnecessary.
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p;
 if actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin') then
  raise exception 'Company owner/admin communication access required' using errcode='42501';end if;
 if p_tenant is null or
  (p_ids is null and p_person is null and p_company is null and p_job is null) or
  (p_ids is not null and (cardinality(p_ids)<1 or cardinality(p_ids)>50 or array_position(p_ids,null) is not null or p_person is not null or p_company is not null or p_job is not null)) or
  (p_job is not null and (p_person is not null or p_company is not null)) then
  raise exception 'One bounded communication scope is required' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.occurred_at desc nulls last,s.id),'[]'::jsonb) into result from (
  select i.id,i.tenant_id,i.source_connector_id,i.source_type,i.source_table,i.source_id,i.occurred_at,
   case when length(i.subject)>4000 then left(i.subject,4000)||'… [excerpt shortened]' else i.subject end as subject,
   case when length(i.summary)>4000 then left(i.summary,4000)||'… [excerpt shortened]' else i.summary end as summary,
   case when length(i.body_preview)>4000 then left(i.body_preview,4000)||'… [excerpt shortened]' else i.body_preview end as body_preview,
   i.status,i.related_person_id,i.related_company_id,i.related_job_id
  from public.interactions i where i.tenant_id=p_tenant and not public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id) and coalesce(i.status,'') not in ('deleted','removed') and
   (i.related_person_id=p_person or i.related_company_id=p_company or i.related_job_id=p_job or i.id=any(p_ids))
  order by i.occurred_at desc nulls last,i.id limit 51
 ) s;
 return jsonb_build_object('version','learn-card-communications/1','tenant_id',p_tenant,'rows',result);
end $function$
;
