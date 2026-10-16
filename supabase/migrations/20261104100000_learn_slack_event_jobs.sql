-- Inactive follow-up to the signed public-channel hint ledger. Each accepted
-- hint gets one bounded job in the existing Slack workspace queue. This does
-- not enable the receiver, schedule a worker, or contact Slack.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.learn_slack_event_hints
  add column job_id uuid unique references public.platform_jobs(id);
do $$begin
 if exists(select 1 from public.learn_slack_event_hints where job_id is null) then
  raise exception 'slack_event_existing_hint_requires_review';
 end if;
end$$;
alter table public.learn_slack_event_hints alter column job_id set not null;

-- Preserve the installed approval/revocation, timestamp, roster and duplicate
-- gates. Only append a job creation to its validated new-hint branch.
do $patch$declare definition text; needle text; replacement text;begin
 definition:=pg_get_functiondef('public.learn_slack_event_record(uuid,text,text,text,text,text,text,text,text)'::regprocedure);
 needle:='event_at timestamptz; source_at timestamptz;';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then
  raise exception 'slack_event_recorder_declaration_changed';end if;
 definition:=replace(definition,needle,needle||' job_id uuid;');
 needle:=$old$
 insert into public.learn_slack_event_hints(tenant_id,event_id,account_id,connection_id,
  team_id,channel_id,hint_kind,event_ts,source_ts,thread_ts,correction)
 values(p_tenant,p_event_id,s.account_id,c.id,p_team,p_channel,p_kind,
  p_event_ts,p_source_ts,p_thread_ts,p_correction);$old$;
 replacement:=$new$
 if p_thread_ts is not null and not s.include_threads then
  return jsonb_build_object('version','learn-slack-event-hint/1',
   'state','excluded','eventId',p_event_id);end if;
 job_id:=gen_random_uuid();
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,
  status,priority,max_attempts,available_at,payload,created_by)
 values(job_id,p_tenant,'slack','slack.event_sync',
  'slack.event:'||p_event_id,'queued',20,5,clock_timestamp(),
  jsonb_build_object('event_id',p_event_id),s.approved_by);
 insert into public.learn_slack_event_hints(tenant_id,event_id,account_id,connection_id,
  team_id,channel_id,hint_kind,event_ts,source_ts,thread_ts,correction,job_id)
 values(p_tenant,p_event_id,s.account_id,c.id,p_team,p_channel,p_kind,
  p_event_ts,p_source_ts,p_thread_ts,p_correction,job_id);$new$;
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then
  raise exception 'slack_event_recorder_insert_changed';end if;
 execute replace(definition,needle,replacement);
end$patch$;
commit;
