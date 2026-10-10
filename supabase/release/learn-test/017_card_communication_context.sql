-- TEST-only function-context repair; no new schema access or source changes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' then raise exception 'Explicit TEST target required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_card_communications_v1' and source_sha256='78b6871e377b3e35280769edff0f28c3ec0872208578daed958cec0b97776ebc' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Original reader receipt missing';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_card_communication_context_v1') then raise exception 'Context receipt already exists';end if;
 if not exists(select 1 from pg_proc where oid='public.learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[])'::regprocedure and proowner='learn_card_communication_reader'::regrole and md5(pg_get_functiondef(oid))='040d7f52c7758857a48eabde4f5b6a7a') then raise exception 'Original reader definition differs';end if;
end $$;
do $$ begin execute format('grant learn_card_communication_reader to %I with inherit true, set true',current_user);end $$;
create or replace function public.learn_card_communications_read(p_tenant uuid,p_person uuid default null,p_company uuid default null,p_job uuid default null,p_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
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
  from public.interactions i where i.tenant_id=p_tenant and coalesce(i.status,'') not in ('deleted','removed') and
   (i.related_person_id=p_person or i.related_company_id=p_company or i.related_job_id=p_job or i.id=any(p_ids))
  order by i.occurred_at desc nulls last,i.id limit 51
 ) s;
 return jsonb_build_object('version','learn-card-communications/1','tenant_id',p_tenant,'rows',result);
end $$;
do $$ begin execute format('revoke learn_card_communication_reader from %I',current_user);end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at) values(current_setting('serviceos.release_source_sha256'),'learn_card_communication_context_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
