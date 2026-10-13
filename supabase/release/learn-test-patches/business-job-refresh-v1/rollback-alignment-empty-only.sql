begin;set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $$begin if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or current_setting('serviceos.release_sha256',true) is distinct from 'e79685c57b546c9fde4eb904aee6fc7d8f68865f3d18db065b660848d7614851' then raise exception 'Reviewed rollback target required';end if;if md5(pg_get_functiondef('public.learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[])'::regprocedure))<>'fe5cb8bd96f3c5e4cc49141b5da2bda7' then raise exception 'Reader changed';end if;end$$;
do $empty_guard$begin
 if to_regclass('public.learn_business_input_refreshes') is not null or to_regclass('public.learn_business_input_refresh_cancellations') is not null then raise exception 'Undo unused refresh package first; retained history requires pause instead';end if;
 if exists(select 1 from public.slack_channel_visibility_receipts) or exists(select 1 from public.slack_source_visibility_proofs) then raise exception 'Retained capture proof exists; preserve alignment';end if;
 if (select md5(pg_get_functiondef(oid))='c9c46bc594b5008a9642bbcaa09d7e06' and pg_get_userbyid(proowner)='postgres' and proacl::text='{postgres=X/postgres,learn_card_communication_reader=X/postgres}' from pg_proc where oid='public.learn_card_slack_job_context(uuid,uuid,uuid)'::regprocedure) is not true then raise exception 'Aligned context definition/access changed';end if;
end$empty_guard$;
-- Use the deployer's existing ADMIN OPTION for this transaction only.
-- The original supabase_admin grant remains untouched; remove only our own grant.
create temporary table slack_context_role_baseline on commit drop as
select (select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)),'[]') from pg_auth_members) as memberships;
do $role_guard$begin
 if current_user<>'postgres' or (select rolsuper from pg_roles where rolname=current_user)
 or not has_schema_privilege(current_user,'public','CREATE')
 or (select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)),'[]') from pg_auth_members where roleid='learn_card_communication_reader'::regrole) is distinct from '[{"role": "learn_card_communication_reader", "member": "postgres", "grantor": "supabase_admin", "admin": true, "inherit": false, "set": false}]'::jsonb
 then raise exception 'Exact restricted-reader maintenance authority required';end if;
end$role_guard$;
grant learn_card_communication_reader to postgres with admin false,inherit true,set false granted by postgres;

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
revoke learn_card_communication_reader from postgres granted by postgres;
do $role_restore$begin
 if (select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)),'[]') from pg_auth_members) is distinct from (select memberships from slack_context_role_baseline)
 or pg_has_role('postgres','learn_card_communication_reader','USAGE')
 or pg_has_role('postgres','learn_card_communication_reader','SET')
 then raise exception 'Restricted-reader maintenance authority not restored';end if;
end$role_restore$;

drop function public.learn_card_slack_job_context(uuid,uuid,uuid);
drop function public.slack_commit_attested_page(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb);
drop table public.slack_source_visibility_proofs;
drop table public.slack_channel_visibility_receipts;
notify pgrst,'reload schema';commit;
