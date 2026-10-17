-- A transient unclassified worker exception in an unchanged approved public
-- recurring window should receive the existing bounded queue retry. Never
-- replay a page already published by this job, or extend revoked authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.learn_slack_recurring_unclassified_retry_allowed(
 p_tenant uuid,p_job uuid) returns boolean
 language sql volatile security definer set search_path=pg_catalog as $$
 select auth.role()='service_role'
  and public.learn_slack_recurring_authority_retry_allowed(p_tenant,p_job)
  and exists(select 1 from public.platform_jobs j
   where j.id=p_job and j.tenant_id=p_tenant and j.status='running'
    and j.job_type='slack.history_sync'
    and j.attempt_count<j.max_attempts
    and not(j.metadata ? 'slack_page_v1'));
$$;
revoke all on function public.learn_slack_recurring_unclassified_retry_allowed(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_recurring_unclassified_retry_allowed(uuid,uuid)
 to service_role;

do $patch$ declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef('public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure);
 needle:='(p_outcome->''retryable''=''true''::jsonb or
    (p_outcome->>''code''=''slack_history_authority_unavailable'' and
     public.learn_slack_recurring_authority_retry_allowed(j.tenant_id,j.id)))';
 replacement:='(p_outcome->''retryable''=''true''::jsonb or
    (p_outcome->>''code''=''slack_history_authority_unavailable'' and
     public.learn_slack_recurring_authority_retry_allowed(j.tenant_id,j.id)) or
    (p_outcome->>''code''=''slack_history_failed'' and
     public.learn_slack_recurring_unclassified_retry_allowed(j.tenant_id,j.id)))';
 if length(definition)-length(replace(definition,needle,''))<>length(needle)
  or position('j.attempt_count<j.max_attempts' in definition)=0 then
  raise exception 'slack_recurring_unclassified_retry_baseline_changed';
 end if;
 execute replace(definition,needle,replacement);
end $patch$;
commit;
