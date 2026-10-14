begin;
-- Restrict draft/source inspection to linked interaction candidates. Keep the
-- existing role, tenant, visibility, status, excerpt and row-limit checks.
-- No rows or access grants change; CREATE OR REPLACE retains ownership and ACLs.
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[])'::regprocedure);
 needle:=$old$ select coalesce(jsonb_agg(to_jsonb(s) order by s.occurred_at desc nulls last,s.id),'[]'::jsonb) into result from ($old$;
 replacement:=$new$ with job_context as materialized (
  select * from public.learn_card_slack_job_context(p_tenant,p_person,p_company)
 ), candidate_ids as materialized (
  select i.id from public.interactions i where i.tenant_id=p_tenant and
   (i.related_person_id=p_person or i.related_company_id=p_company or i.related_job_id=p_job or i.id=any(p_ids))
  union
  select jc.interaction_id from job_context jc
 )
 select coalesce(jsonb_agg(to_jsonb(s) order by s.occurred_at desc nulls last,s.id),'[]'::jsonb) into result from ($new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Card communication aggregate baseline differs';end if;
 d:=replace(d,needle,replacement);
 needle:=$old$from public.interactions i left join public.learn_card_slack_job_context(p_tenant,p_person,p_company) jc on jc.interaction_id=i.id where$old$;
 replacement:=$new$from candidate_ids candidate join public.interactions i on i.id=candidate.id and i.tenant_id=p_tenant left join job_context jc on jc.interaction_id=i.id where$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Card communication join baseline differs';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;
