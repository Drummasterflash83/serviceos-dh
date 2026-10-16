-- Inactive signed-event source reconciliation on the existing paced Slack queue.
-- The receiver must remain off until the Edge worker and app review are complete.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.learn_slack_event_hints
 add column settled_at timestamptz,
 add column result_source_version text,
 add column source_absent_verified boolean,
 add column visibility_checked_at timestamptz;

-- Service-only, current-approval gate used before claim, credential retrieval
-- and atomic source publication. The hint's event ID, tenant and queue job are
-- fixed at signed delivery; a caller cannot substitute a channel or source time.
create function public.learn_slack_event_job_allowed(p_tenant uuid,p_job uuid)
returns boolean language sql volatile security definer set search_path=pg_catalog as $$
 select auth.role()='service_role' and exists(
  select 1 from public.learn_slack_event_hints h
  join public.platform_jobs j on j.id=h.job_id and j.tenant_id=h.tenant_id
  join public.slack_recurring_channels s on s.account_id=h.account_id and s.tenant_id=h.tenant_id
  join public.connector_accounts a on a.id=s.account_id and a.tenant_id=s.tenant_id
  join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  join public.provider_connections c on c.id=s.connection_id and c.tenant_id=s.tenant_id
  join public.profiles p on p.id=s.approved_by
  where h.tenant_id=p_tenant and h.job_id=p_job and h.state='pending'
   and j.job_type='slack.event_sync' and j.payload->>'event_id'=h.event_id
   and j.created_by=s.approved_by and s.enabled and s.team_id=h.team_id
   and s.channel_id=h.channel_id and s.connection_id=h.connection_id
   and (h.thread_ts is null or s.include_threads)
   and a.status='active' and a.settings->'slack_history'->'approved'='true'::jsonb
   and a.settings->'slack_history'->>'connectionId'=c.id::text
   and a.settings->'slack_history'->>'teamId'=h.team_id
   and a.settings->'slack_history'->>'channelId'=h.channel_id
   and tc.connector_id='slack' and tc.enabled and tc.status='active'
   and c.provider='slack' and c.status='configured' and c.revoked_at is null
   and c.updated_at=s.connection_revision and c.non_secret_config->>'team_id'=h.team_id
   and public.learn_slack_credential_field(c.non_secret_config)=any(c.configured_fields)
   and c.secret_refs->>public.learn_slack_credential_field(c.non_secret_config) is not null
   and public.learn_capture_allowed(h.tenant_id,'slack')
   and not exists(select 1 from public.view_as_context v where v.actor_user_id=p.id
      and v.ended_at is null and (v.expires_at is null or v.expires_at>clock_timestamp()))
   and ((p.tenant_id=s.tenant_id and p.role in ('owner','admin')) or exists(
    select 1 from public.platform_authority_grants g where g.profile_id=p.id
     and g.permission='platform.controlplane.admin'
     and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
     and coalesce(g.effective_to,'infinity')>clock_timestamp()))
 );
$$;
revoke all on function public.learn_slack_event_job_allowed(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_event_job_allowed(uuid,uuid) to service_role;

create function public.learn_slack_event_team(p_tenant uuid,p_job uuid)
returns text language sql volatile security definer set search_path=pg_catalog as $$
 select h.team_id from public.learn_slack_event_hints h
 where h.tenant_id=p_tenant and h.job_id=p_job
  and public.learn_slack_event_job_allowed(p_tenant,p_job);
$$;
revoke all on function public.learn_slack_event_team(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_event_team(uuid,uuid) to service_role;

-- Preserve every existing claim gate, including campaign authority and
-- workspace pacing. A settled event is claimable only for idempotent finishing.
do $patch$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_capture_job_allowed(uuid,text,jsonb)'::regprocedure);
 needle:='(''slack.history_sync'',''slack.thread_sync'')';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'slack_event_capture_gate_changed';end if;
 execute replace(d,needle,'(''slack.history_sync'',''slack.thread_sync'',''slack.event_sync'')');
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 needle:='(''slack.history_sync'',''slack.thread_sync'')';
 if length(d)-length(replace(d,needle,''))<>2*length(needle) then
  raise exception 'slack_event_claim_type_gate_changed';end if;
 d:=replace(d,needle,'(''slack.history_sync'',''slack.thread_sync'',''slack.event_sync'')');
 needle:='and public.learn_capture_job_allowed(q.tenant_id,q.job_type,q.metadata)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'slack_event_claim_scan_gate_changed';end if;
 d:=replace(d,needle,needle||chr(10)||
  '  and (q.job_type<>''slack.event_sync'' or coalesce(q.metadata,''{}'') ? ''slack_event_v1'' or public.learn_slack_event_job_allowed(q.tenant_id,q.id))');
 needle:='if not public.learn_capture_job_allowed(j.tenant_id,j.job_type,j.metadata) then continue;end if;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'slack_event_claim_locked_gate_changed';end if;
 d:=replace(d,needle,needle||chr(10)||
  '  if j.job_type=''slack.event_sync'' and not(coalesce(j.metadata,''{}'') ? ''slack_event_v1'') and not public.learn_slack_event_job_allowed(j.tenant_id,j.id) then continue;end if;');
 needle:='public.learn_slack_campaign_claim_allowed(q.tenant_id,q.id)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'slack_event_campaign_scan_gate_changed';end if;
 d:=replace(d,needle,'(q.job_type=''slack.event_sync'' or '||needle||')');
 needle:='public.learn_slack_campaign_claim_allowed(j.tenant_id,j.id)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'slack_event_campaign_locked_gate_changed';end if;
 d:=replace(d,needle,'(j.job_type=''slack.event_sync'' or '||needle||')');
 needle:='if not(coalesce(j.metadata,''{}'') ? ''slack_page_v1'') then';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'slack_event_claim_receipt_gate_changed';end if;
 d:=replace(d,needle,
  'if not(coalesce(j.metadata,''{}'') ? ''slack_page_v1'') and not(coalesce(j.metadata,''{}'') ? ''slack_event_v1'') then');
 needle:='   else'||chr(10)||'    select t.scope->>''teamId'' into team';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'slack_event_claim_workspace_gate_changed';end if;
 d:=replace(d,needle,'   elsif j.job_type=''slack.event_sync'' then'||chr(10)||
  '    team:=public.learn_slack_event_team(j.tenant_id,j.id);'||chr(10)||needle);
 execute d;
 d:=pg_get_functiondef('public.learn_capture_defer_job(uuid,uuid,text,integer,text)'::regprocedure);
 needle:='''slack.history_sync'',''slack.thread_sync''';
 if length(d)-length(replace(d,needle,''))<>2*length(needle) then
  raise exception 'slack_event_capture_defer_gate_changed';end if;
 execute replace(d,needle,needle||',''slack.event_sync''');
end$patch$;

create function public.learn_slack_event_context(p_tenant uuid,p_job uuid,
 p_claimed_by text,p_attempt integer) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;h public.learn_slack_event_hints%rowtype;
 c public.provider_connections%rowtype;field text;kind text;subject text;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'slack_event_forbidden' using errcode='42501';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant;
 if not found or j.job_type<>'slack.event_sync' or j.status<>'running'
  or j.claimed_by is distinct from p_claimed_by
  or j.attempt_count is distinct from p_attempt
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
  or not public.learn_slack_event_job_allowed(p_tenant,p_job)
 then return null;end if;
 select * into h from public.learn_slack_event_hints where tenant_id=p_tenant and job_id=p_job;
 if not found then return null;end if;
 select * into c from public.provider_connections where id=h.connection_id and tenant_id=p_tenant;
 if not found then return null;end if;
 field:=public.learn_slack_credential_field(c.non_secret_config);
 kind:=c.non_secret_config->>'credential_kind';
 subject:=c.non_secret_config->>'authorized_user_id';
 if field not in('user_token','bot_token') or kind not in('user','bot')
  or (kind='user' and (field<>'user_token' or coalesce(subject,'') !~ '^U[A-Z0-9]{1,63}$'))
  or (kind='bot' and field<>'bot_token')
 then return null;end if;
 return jsonb_build_object('version','learn-slack-event-context/1',
  'tenantId',p_tenant,'jobId',p_job,'eventId',h.event_id,
  'teamId',h.team_id,'channelId',h.channel_id,'sourceTs',h.source_ts,
  'threadTs',coalesce(h.thread_ts,case when h.correction='deleted' then
    (select sm.thread_timestamp from public.slack_messages sm where sm.tenant_id=p_tenant
     and sm.source_external_id=h.team_id||':'||h.channel_id||':'||h.source_ts) end),
  'hintKind',h.hint_kind,'correction',h.correction,
  'connectionId',c.id,'connectionRevision',c.updated_at,
  'secretRef',c.secret_refs->>field,'tokenKind',kind,'userId',case when kind='user' then subject else null end);
end$$;
revoke all on function public.learn_slack_event_context(uuid,uuid,text,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_event_context(uuid,uuid,text,integer) to service_role;

create function public.learn_slack_event_credential(p_tenant uuid,p_job uuid,
 p_claimed_by text,p_attempt integer) returns text
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare binding jsonb;field text;value text;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'slack_event_forbidden' using errcode='42501';end if;
 binding:=public.learn_slack_event_context(p_tenant,p_job,p_claimed_by,p_attempt);
 if binding is null then return null;end if;
 field:=case when binding->>'tokenKind'='user' then 'user_token' else 'bot_token' end;
 select decrypted_secret into value from vault.decrypted_secrets
  where id=(binding->>'secretRef')::uuid
   and name='provider_secret:'||p_tenant::text||':slack:'||field;
 if field='user_token' and value !~ '^xoxp-[A-Za-z0-9-]+$'
  or field='bot_token' and value !~ '^xoxb-[A-Za-z0-9-]+$'
  or length(value)>1000 then return null;end if;
 return value;
end$$;
revoke all on function public.learn_slack_event_credential(uuid,uuid,text,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_event_credential(uuid,uuid,text,integer) to service_role;

create function public.learn_slack_event_commit(p_tenant uuid,p_job uuid,
 p_claimed_by text,p_attempt integer,p_records jsonb,p_source_absent boolean,
 p_public_visible boolean) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;h public.learn_slack_event_hints%rowtype;
 cfg jsonb;row_data jsonb;saved_id uuid;version text;receipt jsonb;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'slack_event_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_records) is distinct from 'array' or p_public_visible is distinct from true
  or p_source_absent is null then
  raise exception 'slack_event_commit_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.job_type<>'slack.event_sync' or j.status<>'running'
  or j.claimed_by is distinct from p_claimed_by
  or j.attempt_count is distinct from p_attempt
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
 then raise exception 'slack_event_job_not_owned' using errcode='PT409';end if;
 select * into h from public.learn_slack_event_hints
  where tenant_id=p_tenant and job_id=p_job for update;
 if not found or j.payload->>'event_id' is distinct from h.event_id then
  raise exception 'slack_event_binding_changed' using errcode='PT409';end if;
 if h.state='settled' and j.metadata ? 'slack_event_v1' then
  return j.metadata->'slack_event_v1';end if;
 if h.state<>'pending' or not public.learn_slack_event_job_allowed(p_tenant,p_job) then
  raise exception 'slack_event_authority_changed' using errcode='42501';end if;
 if coalesce(h.correction='deleted',false) is distinct from p_source_absent
  or (p_source_absent and jsonb_array_length(p_records)<>0)
  or (not p_source_absent and jsonb_array_length(p_records)<>1) then
  raise exception 'slack_event_source_outcome_invalid' using errcode='22023';end if;
 if not p_source_absent then
  row_data:=p_records->0;
  if row_data->>'tenant_id' is distinct from p_tenant::text
   or row_data->>'channel_id' is distinct from h.channel_id
   or row_data->>'provider_timestamp' is distinct from h.source_ts
   or row_data->>'source_external_id' is distinct from h.team_id||':'||h.channel_id||':'||h.source_ts
   or (h.correction='changed' and
      coalesce(row_data->'provider_payload'->'edited'->>'ts','') !~ '^[0-9]{10,12}\.[0-9]{1,6}$')
  then raise exception 'slack_event_source_identity_invalid' using errcode='22023';end if;
  cfg:=jsonb_build_object('teamId',h.team_id,'channelId',h.channel_id,
   'oldest',to_char(h.source_ts::numeric-0.000001,'FM999999999999.000000'),
   'latest',to_char(h.source_ts::numeric+0.000001,'FM999999999999.000000'));
  perform public.learn_slack_store_records(p_tenant,cfg,p_records,h.thread_ts);
  select id,source_version into saved_id,version from public.slack_messages
   where tenant_id=p_tenant and source_external_id=h.team_id||':'||h.channel_id||':'||h.source_ts;
  if not found then raise exception 'slack_event_source_not_saved' using errcode='PT409';end if;
  update public.interactions set status='active' where tenant_id=p_tenant
   and source_table='slack_messages' and source_id=saved_id
   and coalesce(status,'') in ('deleted','removed');
 else
  select id,source_version into saved_id,version from public.slack_messages
   where tenant_id=p_tenant and source_external_id=h.team_id||':'||h.channel_id||':'||h.source_ts;
  if found then
   update public.interactions set status='deleted',processing_status='pending'
    where tenant_id=p_tenant and source_table='slack_messages' and source_id=saved_id;
  end if;
 end if;
 receipt:=jsonb_build_object('version','learn-slack-event-source/1',
  'eventId',h.event_id,'sourceVersion',version,
  'outcome',case when p_source_absent then 'withheld_after_provider_absence' else 'stored_source' end);
 update public.learn_slack_event_hints set state='settled',settled_at=clock_timestamp(),
  result_source_version=version,source_absent_verified=p_source_absent,
  visibility_checked_at=clock_timestamp() where tenant_id=p_tenant and event_id=h.event_id;
 update public.platform_jobs set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('slack_event_v1',receipt),
  records_processed=case when p_source_absent then 0 else 1 end
  where id=p_job and tenant_id=p_tenant;
 return receipt;
end$$;
revoke all on function public.learn_slack_event_commit(uuid,uuid,text,integer,jsonb,boolean,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_event_commit(uuid,uuid,text,integer,jsonb,boolean,boolean)
 to service_role;

create function public.learn_slack_finish_event_job(p_tenant_id uuid,p_job_id uuid,
 p_claimed_by text,p_attempt_count integer,p_outcome jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;h public.learn_slack_event_hints%rowtype;
 success boolean;retryable boolean;delay_seconds integer;code text;next_status text;answer jsonb;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'slack_event_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_outcome) is distinct from 'object'
  or jsonb_typeof(p_outcome->'success') is distinct from 'boolean' then
  raise exception 'slack_event_outcome_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.job_type<>'slack.event_sync' or j.status<>'running'
  or j.claimed_by is distinct from p_claimed_by
  or j.attempt_count is distinct from p_attempt_count
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
 then raise exception 'slack_event_job_not_owned' using errcode='PT409';end if;
 select * into h from public.learn_slack_event_hints
  where tenant_id=p_tenant_id and job_id=p_job_id for update;
 if not found then raise exception 'slack_event_binding_changed' using errcode='PT409';end if;
 success:=h.state='settled' and j.metadata ? 'slack_event_v1';
 if p_outcome->>'success'='true' and not success then
  raise exception 'slack_event_source_receipt_missing' using errcode='PT409';end if;
 if success then
  next_status:='succeeded';
  update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),
   lease_expires_at=null,claimed_by=null,result=j.metadata->'slack_event_v1',error_code=null
   where id=p_job_id;
 else
  code:=p_outcome->>'code';
  if code is null or code !~ '^slack_event_[a-z_]{1,80}$'
   or jsonb_typeof(p_outcome->'retryable') is distinct from 'boolean'
   or coalesce(p_outcome->>'retry_after_seconds','0') !~ '^[0-9]{1,8}$' then
   raise exception 'slack_event_outcome_invalid' using errcode='22023';end if;
  delay_seconds:=greatest(60,(coalesce(p_outcome->>'retry_after_seconds','0'))::integer);
  if delay_seconds>31536000 then raise exception 'slack_event_outcome_invalid' using errcode='22023';end if;
  retryable:=p_outcome->>'retryable'='true' and j.attempt_count<j.max_attempts;
  next_status:=case when retryable then 'retrying' else 'dead_letter' end;
  update public.platform_jobs set status=next_status,available_at=case when retryable
    then clock_timestamp()+make_interval(secs=>delay_seconds) else available_at end,
   failed_at=case when retryable then failed_at else clock_timestamp() end,
   dead_lettered_at=case when retryable then dead_lettered_at else clock_timestamp() end,
   lease_expires_at=null,claimed_by=null,error_code=code,error_count=error_count+1
   where id=p_job_id;
  if not retryable then update public.learn_slack_event_hints set state='held'
    where tenant_id=p_tenant_id and event_id=h.event_id;end if;
 end if;
 if j.metadata->'slack_workspace_v1'->>'teamId' is not null then
  perform pg_advisory_xact_lock(hashtextextended('learn-slack-workspace:'||
    (j.metadata->'slack_workspace_v1'->>'teamId'),0));
  update public.slack_workspace_pacing set active_job_id=null,
   blocked_until=case when code='slack_event_rate_limited' then
    greatest(blocked_until,clock_timestamp()+make_interval(secs=>delay_seconds))
    else blocked_until end,
   next_allowed_at=greatest(clock_timestamp()+interval '60 seconds',blocked_until),
   last_finished_at=clock_timestamp()
   where team_id=j.metadata->'slack_workspace_v1'->>'teamId'
    and active_job_id=p_job_id;
 end if;
 answer:=jsonb_build_object('job_id',p_job_id,'status',next_status,
  'event_id',h.event_id,'source_retained',success);
 return answer;
end$$;
revoke all on function public.learn_slack_finish_event_job(uuid,uuid,text,integer,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_finish_event_job(uuid,uuid,text,integer,jsonb)
 to service_role;
commit;
