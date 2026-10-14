begin;
-- Candidate only: exclude jobs that cannot contribute reviewed Slack context
-- before evaluating their current provider versions. Final evidence, visibility,
-- ownership and source-version checks remain intact.
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_card_slack_job_context(uuid,uuid,uuid)'::regprocedure);
 needle:='where j.tenant_id=p_tenant and (j.customer_person_id=p_person or j.customer_company_id=p_company)';
 replacement:=needle||$filter$
   and exists (
    select 1 from public.interactions scoped_i
    join public.learn_slack_context_reviews scoped_r on scoped_r.tenant_id=scoped_i.tenant_id
     and scoped_r.interaction_id=scoped_i.id and scoped_r.receipt->>'state'='committed'
    where scoped_i.tenant_id=j.tenant_id and scoped_i.related_job_id=j.id
     and scoped_i.source_table='slack_messages' and scoped_i.source_connector_id='slack'
   )$filter$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed customer-context baseline differs';end if;
 execute replace(d,needle,replacement);
end$$;
commit;
