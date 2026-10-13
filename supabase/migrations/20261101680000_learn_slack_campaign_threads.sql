-- Observed-thread traversal within a recorded historical campaign. No campaign,
-- job, credential, schedule or provider request is created by installation.
begin;
create table public.slack_history_campaign_thread_scans (
 campaign_id uuid not null, account_id uuid not null, tenant_id uuid not null,
 after_parent numeric, discovery_complete boolean not null default false,
 primary key(campaign_id,account_id),
 foreign key(campaign_id,account_id) references public.slack_history_campaign_channels(campaign_id,account_id),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id)
);
create table public.slack_history_campaign_threads (
 campaign_id uuid not null, account_id uuid not null, tenant_id uuid not null,
 parent_timestamp numeric not null check(parent_timestamp>=0),
 source_message_id uuid not null references public.slack_messages(id), source_version text not null check(source_version ~ '^[a-f0-9]{64}$'),
 current_import uuid references public.slack_thread_imports(id), state text not null default 'observed',
 primary key(campaign_id,account_id,parent_timestamp),
 foreign key(campaign_id,account_id) references public.slack_history_campaign_thread_scans(campaign_id,account_id),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id)
);
do $$declare tab text;begin
 foreach tab in array array['slack_history_campaign_thread_scans','slack_history_campaign_threads'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
  execute format('create trigger slack_campaign_thread_retain before delete on public.%I for each row execute function public.slack_version_immutable()',tab);
  execute format('create trigger slack_campaign_thread_retain_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',tab);
 end loop;
end$$;
create function public.learn_slack_campaign_thread_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_table_name='slack_history_campaign_thread_scans' then
  if to_jsonb(old)-array['after_parent','discovery_complete'] is distinct from to_jsonb(new)-array['after_parent','discovery_complete']
   or (old.discovery_complete and not new.discovery_complete)
   or (old.after_parent is not null and (new.after_parent is null or new.after_parent<old.after_parent)) then
   raise exception 'Campaign thread discovery cannot regress' using errcode='55000';end if;
 else
  if to_jsonb(old)-array['current_import','state'] is distinct from to_jsonb(new)-array['current_import','state'] then
   raise exception 'Observed campaign thread identity is immutable' using errcode='55000';end if;
 end if;
 return new;
end$$;
revoke all on function public.learn_slack_campaign_thread_immutable() from public,anon,authenticated,service_role;
create trigger slack_campaign_thread_scan_immutable before update on public.slack_history_campaign_thread_scans for each row execute function public.learn_slack_campaign_thread_immutable();
create trigger slack_campaign_thread_member_immutable before update on public.slack_history_campaign_threads for each row execute function public.learn_slack_campaign_thread_immutable();

-- Coverage depends on matching durable publication, independent of whether a
-- completed approval is now paused/expired. It covers only the fixed window and
-- observed roots; deleted/unavailable provider history is never inferred.
create function public.learn_slack_campaign_channel_progress(p_campaign uuid,p_account uuid) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare h public.slack_history_campaigns%rowtype;m public.slack_history_campaign_channels%rowtype;a public.connector_accounts%rowtype;
 cfg jsonb;history_done boolean;discovered boolean;observed bigint;completed bigint;begin
 select * into m from public.slack_history_campaign_channels where campaign_id=p_campaign and account_id=p_account;
 if not found then return null;end if;
 select * into h from public.slack_history_campaigns where id=m.campaign_id and tenant_id=m.tenant_id;
 select * into a from public.connector_accounts where id=m.account_id and tenant_id=m.tenant_id;
 cfg:=a.settings->'slack_history';
 history_done:=coalesce(cfg->>'campaignId'=h.id::text and cfg->>'teamId'=h.team_id and cfg->>'channelId'=m.channel_id
 and cfg->>'consentReference'='learn-slack-import:'||m.current_import::text
 and (cfg->>'oldest')::numeric=extract(epoch from h.starts_at) and (cfg->>'latest')::numeric=extract(epoch from h.ends_at)
 and a.sync_cursor->'complete'='true'::jsonb and exists(select 1 from public.platform_jobs j where j.tenant_id=m.tenant_id
 and j.job_type='slack.history_sync' and j.status='succeeded' and j.payload->>'connector_account_id'=a.id::text
 and j.metadata->'slack_page_v1'->'next'=a.sync_cursor and j.metadata->'slack_page_v1'->>'account_id'=a.id::text),false);
 select coalesce(s.discovery_complete,false) into discovered from public.slack_history_campaign_thread_scans s where s.campaign_id=p_campaign and s.account_id=p_account;
 select count(*),count(*) filter(where t.tenant_id=m.tenant_id and t.account_id=m.account_id
 and t.scope->>'campaignId'=h.id::text and (t.scope->>'parentTimestamp')::numeric=member.parent_timestamp
 and (t.scope->>'oldest')::numeric=extract(epoch from h.starts_at) and (t.scope->>'latest')::numeric=extract(epoch from h.ends_at)
 and t.checkpoint->'complete'='true'::jsonb and exists(select 1 from public.platform_jobs j where j.tenant_id=m.tenant_id
 and j.job_type='slack.thread_sync' and j.status='succeeded' and j.payload->>'thread_import_id'=t.id::text
 and j.payload->>'connector_account_id'=m.account_id::text and j.metadata->'slack_page_v1'->>'thread_import_id'=t.id::text
 and j.metadata->'slack_page_v1'->'next'=t.checkpoint)) into observed,completed
 from public.slack_history_campaign_threads member left join public.slack_thread_imports t on t.id=member.current_import
 where member.campaign_id=p_campaign and member.account_id=p_account;
 return jsonb_build_object('channelPagesComplete',history_done,'discoveryComplete',coalesce(discovered,false),'observedThreads',observed,
 'completedThreads',completed,'threadsComplete',coalesce(discovered,false) and observed=completed,
 'complete',history_done and coalesce(discovered,false) and observed=completed,'coverage','fixed_window_observed_threads');
end$$;
revoke all on function public.learn_slack_campaign_channel_progress(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.learn_slack_campaign_job_allowed(p_tenant uuid,p_job uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cfg jsonb;h public.slack_history_campaigns%rowtype;t public.slack_thread_imports%rowtype;begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant and job_type in ('slack.history_sync','slack.thread_sync');
 if not found then return false;end if;
 select * into a from public.connector_accounts where id::text=j.payload->>'connector_account_id' and tenant_id=p_tenant;
 if not found then return false;end if;
 cfg:=a.settings->'slack_history';
 if not coalesce(cfg ? 'campaignId',false) then return true;end if;
 select * into h from public.slack_history_campaigns where id::text=cfg->>'campaignId' and tenant_id=p_tenant;
 if not found or not public.learn_slack_campaign_authority(h.id) then return false;end if;
 if not coalesce(a.status='active' and cfg->'approved'='true'::jsonb and cfg->>'teamId'=h.team_id
 and cfg->>'connectionId'=h.connection_id::text
 and (cfg->>'oldest')::numeric=extract(epoch from h.starts_at) and (cfg->>'latest')::numeric=extract(epoch from h.ends_at)
 and exists(select 1 from public.slack_history_campaign_channels m join public.slack_history_imports i on i.id=m.current_import
 where m.campaign_id=h.id and m.tenant_id=p_tenant and m.account_id=a.id and m.channel_id=cfg->>'channelId'
 and cfg->>'consentReference'='learn-slack-import:'||i.id::text and i.tenant_id=p_tenant and i.account_id=a.id)
 and exists(select 1 from public.tenant_connectors tc where tc.id=a.tenant_connector_id and tc.tenant_id=p_tenant
 and tc.connector_id='slack' and tc.enabled and tc.status='active'),false) then return false;end if;
 if j.job_type='slack.history_sync' then return true;end if;
 select * into t from public.slack_thread_imports where id::text=j.payload->>'thread_import_id' and tenant_id=p_tenant and account_id=a.id;
 if not found then return false;end if;
 return coalesce(t.scope->>'campaignId'=h.id::text and t.scope->'approved'='true'::jsonb
 and t.scope->>'connectionId'=h.connection_id::text and t.scope->>'teamId'=h.team_id and t.scope->>'channelId'=cfg->>'channelId'
 and (t.definition->>'connectionRevision')::timestamptz=h.connection_revision
 and (t.scope->>'oldest')::numeric=extract(epoch from h.starts_at) and (t.scope->>'latest')::numeric=extract(epoch from h.ends_at)
 and exists(select 1 from public.slack_history_campaign_threads member where member.campaign_id=h.id and member.tenant_id=p_tenant
 and member.account_id=a.id and member.current_import=t.id and member.parent_timestamp=(t.scope->>'parentTimestamp')::numeric
 and member.source_message_id=t.source_message_id and member.source_version=t.definition->>'sourceVersion'),false);
end$$;

create function public.learn_slack_campaign_thread_attribution_allowed(r jsonb) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select coalesce(auth.role()='service_role' and exists(select 1 from public.slack_history_campaigns h
 join public.slack_history_campaign_channels c on c.campaign_id=h.id and c.tenant_id=h.tenant_id
 join public.connector_accounts a on a.id=c.account_id and a.tenant_id=h.tenant_id
 join public.slack_history_campaign_threads member on member.campaign_id=h.id and member.account_id=a.id and member.tenant_id=h.tenant_id
 join public.slack_messages m on m.id=member.source_message_id and m.tenant_id=h.tenant_id and m.team_id=h.team_id and m.channel_id=c.channel_id
 join public.slack_message_versions v on v.message_id=m.id and v.tenant_id=h.tenant_id and v.source_version=member.source_version
 join public.platform_jobs j on j.id=(r->>'initial_job_id')::uuid and j.tenant_id=h.tenant_id
 where h.id::text=r->'definition'->>'campaignId' and h.tenant_id::text=r->>'tenant_id' and public.learn_slack_campaign_authority(h.id)
 and h.approved_by::text=r->>'approved_by' and a.id::text=r->>'account_id' and a.status='active'
 and a.settings->'slack_history'->>'campaignId'=h.id::text and a.settings->'slack_history'->'approved'='true'::jsonb
 and a.settings->'slack_history'->>'consentReference'='learn-slack-import:'||c.current_import::text
 and r->'definition'->>'resumesImportId' is not distinct from member.current_import::text
 and r->>'source_message_id'=member.source_message_id::text and r->'definition'->>'sourceVersion'=member.source_version
 and r->'definition'->>'sourceMessageId'=member.source_message_id::text and r->'definition'->>'accountId'=a.id::text
 and (r->'definition'->>'connectionRevision')::timestamptz=h.connection_revision
 and (r->'definition'->>'start')::timestamptz=h.starts_at and (r->'definition'->>'end')::timestamptz=h.ends_at
 and r->'definition'->'maxPages'='10'::jsonb and r->'scope'->'maxPages'='10'::jsonb
 and r->'scope'->>'campaignId'=h.id::text and r->'scope'->>'connectionId'=h.connection_id::text
 and r->'scope'->>'teamId'=h.team_id and r->'scope'->>'channelId'=c.channel_id and r->'scope'->'approved'='true'::jsonb
 and r->'scope'->>'consentReference'='learn-slack-thread:'||(r->>'id')
 and (r->'scope'->>'oldest')::numeric=extract(epoch from h.starts_at) and (r->'scope'->>'latest')::numeric=extract(epoch from h.ends_at)
 and (r->'scope'->>'expiresAt')::timestamptz<=h.expires_at and (r->'scope'->>'expiresAt')::timestamptz>clock_timestamp()
 and (r->'scope'->>'parentTimestamp')::numeric=member.parent_timestamp
 and member.parent_timestamp=case when v.provider_payload->>'thread_ts' is not null
  and (v.provider_payload->>'thread_ts')::numeric<(v.provider_payload->>'ts')::numeric then (v.provider_payload->>'thread_ts')::numeric
  when coalesce(v.provider_payload->>'reply_count','') ~ '^[0-9]+$' and (v.provider_payload->>'reply_count')::numeric>0 then (v.provider_payload->>'ts')::numeric end
 and j.job_type='slack.thread_sync' and j.status='queued' and j.created_by=h.approved_by
 and j.payload->>'connector_account_id'=a.id::text and j.payload->>'thread_import_id'=r->>'id'),false);
$$;
revoke all on function public.learn_slack_campaign_thread_attribution_allowed(jsonb) from public,anon,authenticated,service_role;
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_reference_guard()'::regprocedure);
 needle:='   if auth.role() is distinct from ''authenticated'' or auth.uid() is null';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign thread attribution guard differs';end if;
 execute replace(d,needle,'   if tg_op=''INSERT'' and tg_table_name=''slack_thread_imports'' and public.learn_slack_campaign_thread_attribution_allowed(j) then continue;end if;'||chr(10)||needle);
end$$;

create function public.learn_slack_campaign_thread_import_complete(p_import uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select coalesce(exists(select 1 from public.slack_thread_imports t where t.id=p_import and t.checkpoint->'complete'='true'::jsonb
 and exists(select 1 from public.platform_jobs j where j.tenant_id=t.tenant_id and j.job_type='slack.thread_sync' and j.status='succeeded'
 and j.payload->>'thread_import_id'=t.id::text and j.payload->>'connector_account_id'=t.account_id::text
 and j.metadata->'slack_page_v1'->>'thread_import_id'=t.id::text and j.metadata->'slack_page_v1'->'next'=t.checkpoint)),false);
$$;
revoke all on function public.learn_slack_campaign_thread_import_complete(uuid) from public,anon,authenticated,service_role;

-- Runs under the campaign scheduler's tenant/header/channel/account lock order.
-- At most twenty observed parents are recorded and one reply job is queued per
-- channel/pass. All work uses the existing paced, fenced one-page Slack worker.
create function public.learn_slack_campaign_threads_step(p_campaign uuid,p_account uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare h public.slack_history_campaigns%rowtype;c public.slack_history_campaign_channels%rowtype;a public.connector_accounts%rowtype;
 scan public.slack_history_campaign_thread_scans%rowtype;member public.slack_history_campaign_threads%rowtype;
 t public.slack_thread_imports%rowtype;last_job public.platform_jobs%rowtype;root record;progress jsonb;cfg jsonb;scope jsonb;cp jsonb;d jsonb;
 n integer:=0;request_id uuid;job_id uuid;key text;can_renew boolean;begin
 if auth.role() is distinct from 'service_role' or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'slack_campaign_forbidden' using errcode='42501';end if;
 select * into h from public.slack_history_campaigns where id=p_campaign;
 if not found then return jsonb_build_object('state','campaign_unavailable','queued',false);end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||h.tenant_id::text,0));
 select * into h from public.slack_history_campaigns where id=p_campaign for update;
 select * into c from public.slack_history_campaign_channels where campaign_id=h.id and account_id=p_account and tenant_id=h.tenant_id for update;
 if not found then return jsonb_build_object('state','channel_unavailable','queued',false);end if;
 select * into a from public.connector_accounts where id=c.account_id and tenant_id=h.tenant_id for update;
 progress:=public.learn_slack_campaign_channel_progress(h.id,a.id);
 if progress->'complete'='true'::jsonb then return jsonb_build_object('state','campaign_window_complete','queued',false);end if;
 if progress->'channelPagesComplete' is distinct from 'true'::jsonb then return jsonb_build_object('state','channel_completion_unverified','queued',false);end if;
 if not public.learn_slack_campaign_authority(h.id) then return jsonb_build_object('state','authority_or_capture_unavailable','queued',false);end if;
 if h.requests_reserved>=h.request_budget then return jsonb_build_object('state','request_budget_exhausted','queued',false);end if;
 cfg:=a.settings->'slack_history';
 if a.status<>'active' or cfg->'approved' is distinct from 'true'::jsonb or not exists(select 1 from public.tenant_connectors tc
 where tc.id=a.tenant_connector_id and tc.tenant_id=h.tenant_id and tc.connector_id='slack' and tc.enabled and tc.status='active') then
 return jsonb_build_object('state','account_or_connector_unavailable','queued',false);end if;
 insert into public.slack_history_campaign_thread_scans(campaign_id,account_id,tenant_id) values(h.id,a.id,h.tenant_id) on conflict do nothing;
 select * into scan from public.slack_history_campaign_thread_scans where campaign_id=h.id and account_id=a.id for update;
 if not scan.discovery_complete then
  -- Unusable parent evidence is a coverage gap, not an empty thread list.
  if exists(select 1 from public.slack_messages sm where sm.tenant_id=h.tenant_id and sm.team_id=h.team_id and sm.channel_id=c.channel_id
   and sm.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
   and ((sm.provider_payload ? 'reply_count' and case when jsonb_typeof(sm.provider_payload->'reply_count')='number'
    and sm.provider_payload->>'reply_count' ~ '^[0-9]+$' then (sm.provider_payload->>'reply_count')::numeric>9007199254740991 else true end)
    or sm.thread_timestamp::numeric>sm.provider_timestamp::numeric)) then
   return jsonb_build_object('state','thread_evidence_invalid','queued',false);end if;
  for root in with observed as (
   select sm.id,sm.source_version,sm.provider_timestamp,
    case when sm.thread_timestamp is not null and sm.thread_timestamp::numeric<sm.provider_timestamp::numeric then sm.thread_timestamp::numeric
     when coalesce(sm.provider_payload->>'reply_count','') ~ '^[0-9]+$' and (sm.provider_payload->>'reply_count')::numeric>0 then sm.provider_timestamp::numeric end as parent
   from public.slack_messages sm where sm.tenant_id=h.tenant_id and sm.team_id=h.team_id and sm.channel_id=c.channel_id
   and sm.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
   and public.learn_slack_message_kind(sm.provider_payload)='conversation'
  ), parents as (select distinct on(parent) * from observed where parent is not null and (scan.after_parent is null or parent>scan.after_parent)
    order by parent,(provider_timestamp::numeric=parent) desc,id)
  select * from parents order by parent limit 20 loop
   insert into public.slack_history_campaign_threads(campaign_id,account_id,tenant_id,parent_timestamp,source_message_id,source_version)
    values(h.id,a.id,h.tenant_id,root.parent,root.id,root.source_version);
   n:=n+1;scan.after_parent:=root.parent;
  end loop;
  update public.slack_history_campaign_thread_scans set after_parent=scan.after_parent,discovery_complete=n<20 where campaign_id=h.id and account_id=a.id;
 end if;
 update public.slack_history_campaign_threads mt set state='captured' where mt.campaign_id=h.id and mt.account_id=a.id
 and mt.state<>'captured' and public.learn_slack_campaign_thread_import_complete(mt.current_import);
 -- Stable parent ordering and one unfinished thread per channel keep the queue
 -- bounded, without confusing queueing/discovery with captured replies.
 select * into member from public.slack_history_campaign_threads mt where mt.campaign_id=h.id and mt.account_id=a.id
 and not public.learn_slack_campaign_thread_import_complete(mt.current_import) order by mt.parent_timestamp limit 1 for update;
 if not found then
  progress:=public.learn_slack_campaign_channel_progress(h.id,a.id);
  return jsonb_build_object('state',case when progress->'complete'='true'::jsonb then 'campaign_window_complete' else 'discovering_threads' end,'queued',false);
 end if;
 cp:='{}';
 if member.current_import is not null then
  select * into t from public.slack_thread_imports where id=member.current_import and tenant_id=h.tenant_id and account_id=a.id for update;
  if not found or t.scope->>'campaignId' is distinct from h.id::text or t.scope->>'parentTimestamp' is distinct from member.parent_timestamp::text then
   return jsonb_build_object('state','thread_scope_changed','queued',false);end if;
  if exists(select 1 from public.platform_jobs pending where pending.tenant_id=h.tenant_id and pending.job_type='slack.thread_sync'
   and pending.payload->>'thread_import_id'=t.id::text and pending.status in ('queued','retrying','running')) then
   return jsonb_build_object('state','thread_active','queued',false);end if;
  cp:=t.checkpoint;
  select * into last_job from public.platform_jobs recent where recent.tenant_id=h.tenant_id and recent.job_type='slack.thread_sync'
   and recent.payload->>'thread_import_id'=t.id::text order by recent.created_at desc,recent.id desc limit 1;
  can_renew:=coalesce((cp->>'pages')::integer>=(t.scope->>'maxPages')::integer and exists(select 1 from public.platform_jobs published
   where published.tenant_id=h.tenant_id and published.job_type='slack.thread_sync' and published.status='succeeded'
   and published.payload->>'thread_import_id'=t.id::text and published.metadata->'slack_page_v1'->>'thread_import_id'=t.id::text
   and published.metadata->'slack_page_v1'->'next'=cp),false)
   or coalesce(last_job.status in ('failed','dead_letter') and last_job.payload->>'campaign_id'=h.id::text
    and (last_job.payload->>'campaign_revision')::bigint<h.revision and last_job.error_code in
    ('slack_history_campaign_request_unavailable','slack_history_campaign_request_unconfirmed','slack_history_binding_unavailable','slack_history_authority_unavailable'),false)
   or coalesce((t.scope->>'expiresAt')::timestamptz<=clock_timestamp() and last_job.status in ('failed','dead_letter')
    and last_job.error_code in ('slack_history_binding_unavailable','slack_history_authority_unavailable'),false);
  if not can_renew or cp->'complete'='true'::jsonb or (cp<>'{}'::jsonb and cp->>'cursor' is null and cp->'pages'<>'0'::jsonb) then
   return jsonb_build_object('state','thread_needs_review','queued',false);end if;
 end if;
 request_id:=gen_random_uuid();job_id:=gen_random_uuid();
 scope:=cfg||jsonb_build_object('approved',true,'parentTimestamp',member.parent_timestamp::text,'maxPages',10,
  'expiresAt',least(h.expires_at,clock_timestamp()+interval '24 hours'),'consentReference','learn-slack-thread:'||request_id::text);
 -- Parenthesised fields keep the queue key identical to the existing thread worker.
 key:='slack.thread:'||a.id::text||':'||member.parent_timestamp::text||':'||(scope->>'oldest')||':'||(scope->>'latest');
 d:=jsonb_build_object('campaignId',h.id,'campaignRevision',h.revision,'accountId',a.id,'sourceMessageId',member.source_message_id,
  'sourceVersion',member.source_version,'connectionRevision',h.connection_revision,'start',h.starts_at,'end',h.ends_at,'maxPages',10,
  'reason','Capture observed replies within the recorded historical campaign','resumesImportId',member.current_import,
  'previousState',case when member.current_import is null then null else jsonb_build_object('scope',t.scope,'checkpoint',cp) end);
 cp:=jsonb_build_object('scopeKey',array_to_json(array[h.tenant_id::text,h.team_id,c.channel_id,scope->>'oldest',scope->>'latest',scope->>'consentReference',scope->>'parentTimestamp'])::text,
  'cursor',cp->>'cursor','pages',0,'complete',false);
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(job_id,h.tenant_id,'slack','slack.thread_sync',key,'queued',5,clock_timestamp(),
   jsonb_build_object('connector_account_id',a.id,'thread_import_id',request_id,'campaign_id',h.id,'campaign_revision',h.revision),h.approved_by);
 insert into public.slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope,checkpoint)
  values(request_id,h.tenant_id,a.id,member.source_message_id,job_id,h.approved_by,d,scope,cp);
 update public.slack_history_campaign_threads set current_import=request_id,state='queued' where campaign_id=h.id and account_id=a.id and parent_timestamp=member.parent_timestamp;
 return jsonb_build_object('state','thread_queued','queued',true);
end$$;
revoke all on function public.learn_slack_campaign_threads_step(uuid,uuid) from public,anon,authenticated,service_role;

-- Carry reply traversal through the existing infrastructure-authenticated scheduler.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_schedule_campaigns(integer)'::regprocedure);
 needle:='c.state<>''history_captured_threads_pending''';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign thread scheduling filter differs';end if;
 d:=replace(d,needle,'c.state<>''campaign_window_complete''');
 needle:='  if status not in (''window_active'',''window_queued'',''history_captured_threads_pending'') then held:=held+1;end if;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign thread scheduling settlement differs';end if;
 execute replace(d,needle,$patch$  if status='history_captured_threads_pending' then
   state:=public.learn_slack_campaign_threads_step(h.id,a.id);
   if state->'queued'='true'::jsonb then queued:=queued+1;end if;
   status:=state->>'state';
  end if;
  if status not in ('window_active','window_queued','thread_active','thread_queued','discovering_threads','campaign_window_complete') then held:=held+1;end if;$patch$);
end$$;

create or replace function public.learn_slack_campaign_read(p_tenant uuid,p_campaign uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare h public.slack_history_campaigns%rowtype;rows jsonb;threads_done boolean;all_done boolean;begin
 perform public.learn_slack_control_access(p_tenant,false,'history');
 select * into h from public.slack_history_campaigns where id=p_campaign and tenant_id=p_tenant;
 if not found then raise exception 'slack_campaign_unavailable' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('accountId',m.account_id,'channelId',m.channel_id,'approvalId',m.current_import,
 'state',case when progress->'complete'='true'::jsonb then 'campaign_window_complete' else m.state end,
 'pagesThisApproval',a.sync_cursor->'pages')||progress order by m.channel_id),'[]'::jsonb)
 into rows from public.slack_history_campaign_channels m join public.connector_accounts a on a.id=m.account_id and a.tenant_id=m.tenant_id
 cross join lateral public.learn_slack_campaign_channel_progress(m.campaign_id,m.account_id) progress where m.campaign_id=h.id;
 select coalesce(bool_and((value->>'threadsComplete')::boolean),false),coalesce(bool_and((value->>'complete')::boolean),false)
 into threads_done,all_done from jsonb_array_elements(rows);
 return jsonb_build_object('version','learn-slack-campaign/1','tenantId',p_tenant,'campaignId',h.id,'revision',h.revision,
 'enabled',h.enabled,'start',h.starts_at,'end',h.ends_at,'expiresAt',h.expires_at,'requestBudget',h.request_budget,
 'requestsReserved',h.requests_reserved,'requestAccounting','conservative_dispatch_reservations',
 'threadsComplete',threads_done,'complete',all_done,'coverage','fixed_window_observed_threads','channels',rows);
end$$;
commit;
