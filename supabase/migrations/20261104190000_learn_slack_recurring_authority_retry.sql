-- A transient authority read inside an unchanged, approved recurring public
-- window gets bounded retry. Revoked, expired or changed scopes remain held.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.learn_slack_recurring_authority_retry_allowed(p_tenant uuid,p_job uuid)
returns boolean language sql volatile security definer set search_path=pg_catalog as $$
 select auth.role()='service_role' and exists(
  select 1 from public.platform_jobs j
  join public.slack_history_imports i on i.job_id=j.id and i.tenant_id=j.tenant_id
  join public.slack_recurring_channels s on s.current_import=i.id and s.tenant_id=i.tenant_id
  join public.connector_accounts a on a.id=s.account_id and a.tenant_id=s.tenant_id
  join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  join public.provider_connections c on c.id=s.connection_id and c.tenant_id=s.tenant_id
  where j.id=p_job and j.tenant_id=p_tenant and j.job_type='slack.history_sync'
   and j.payload->>'connector_account_id'=a.id::text
   and s.enabled and s.team_id=a.settings->'slack_history'->>'teamId'
   and s.channel_id=a.settings->'slack_history'->>'channelId'
   and s.connection_revision=c.updated_at
   and a.status='active' and a.settings->'slack_history'->'approved'='true'::jsonb
   and not (a.settings->'slack_history' ? 'campaignId')
   and a.settings->'slack_history'->>'consentReference'='learn-slack-import:'||i.id::text
   and a.settings->'slack_history'->>'connectionId'=c.id::text
   and (a.settings->'slack_history'->>'expiresAt')::timestamptz>clock_timestamp()+interval '5 minutes'
   and a.settings->'slack_history'->>'oldest'=to_char(extract(epoch from (i.definition->>'start')::timestamptz),'FM999999999999.000000')
   and a.settings->'slack_history'->>'latest'=to_char(extract(epoch from (i.definition->>'end')::timestamptz),'FM999999999999.000000')
   and tc.connector_id='slack' and tc.enabled and tc.status='active'
   and c.provider='slack' and c.status='configured' and c.revoked_at is null
   and c.non_secret_config->>'team_id'=s.team_id
   and public.learn_capture_allowed(j.tenant_id,'slack')
 );
$$;
revoke all on function public.learn_slack_recurring_authority_retry_allowed(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_recurring_authority_retry_allowed(uuid,uuid) to service_role;

do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure);
 needle:='p_outcome->''retryable''=''true''::jsonb and j.attempt_count<j.max_attempts';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'slack_recurring_retry_finish_shape_changed';end if;
 execute replace(d,needle,
  '(p_outcome->''retryable''=''true''::jsonb or
    (p_outcome->>''code''=''slack_history_authority_unavailable'' and
     public.learn_slack_recurring_authority_retry_allowed(j.tenant_id,j.id)))
   and j.attempt_count<j.max_attempts');
end $patch$;
commit;
