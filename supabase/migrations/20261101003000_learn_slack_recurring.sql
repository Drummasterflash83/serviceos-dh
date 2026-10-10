-- Explicit ongoing channel approval; no activation, credentials or schedule seeded.
-- Each new window uses the existing fenced Slack worker and retained page protocol.
begin;
create function public.learn_slack_recurring_access(p_tenant uuid,p_write boolean) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(auth.uid() is not null and p_tenant is not null and p_write is not null
  and (case when p_write then
   ((p_tenant=public.current_tenant_id() and public.current_user_role() in ('owner','admin'))
     or public.current_user_is_openfolk_operator('platform.controlplane.admin'))
   and not exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null
    and (expires_at is null or expires_at>now()))
  else p_tenant=public.current_tenant_id() or public.current_user_is_openfolk_operator('platform.controlplane.view') end),false);
$$;
revoke all on function public.learn_slack_recurring_access(uuid,boolean) from public,anon;
grant execute on function public.learn_slack_recurring_access(uuid,boolean) to authenticated;
create table public.slack_recurring_channels (
 account_id uuid primary key references public.connector_accounts(id),
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null references public.provider_connections(id),
 connection_revision timestamptz not null,
 team_id text not null check(team_id ~ '^T[A-Z0-9]+$'),
 channel_id text not null check(channel_id ~ '^C[A-Z0-9]+$'),
 approved_by uuid not null references public.profiles(id),
 enabled boolean not null,
 revision bigint not null default 1 check(revision>0),
 next_start timestamptz not null,
 current_import uuid references public.slack_history_imports(id),
 last_state text not null default 'ready',
 next_check_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(isfinite(next_start) and next_start>=to_timestamp(0))
);
alter table public.slack_recurring_channels enable row level security;
create index slack_recurring_due on public.slack_recurring_channels(next_check_at,account_id) where enabled;
revoke all on public.slack_recurring_channels from public,anon,authenticated,service_role;
grant select on public.slack_recurring_channels to authenticated,service_role;
create policy slack_recurring_read on public.slack_recurring_channels for select to authenticated
 using(public.learn_slack_recurring_access(tenant_id,false));
create table public.slack_recurring_requests (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),definition jsonb not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.slack_recurring_requests enable row level security;
revoke all on public.slack_recurring_requests from public,anon,authenticated,service_role;
create trigger slack_recurring_request_immutable before update or delete on public.slack_recurring_requests
 for each row execute function public.slack_version_immutable();

create function public.learn_slack_recurring_control(p_tenant uuid,p_request uuid,p_account uuid,
 p_revision bigint,p_enabled boolean,p_reason text,p_mode text default 'apply',p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 s public.slack_recurring_channels%rowtype;r public.slack_recurring_requests%rowtype;
 definition jsonb;answer jsonb;cfg jsonb;boundary timestamptz;resume_paused boolean;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'slack_recurring_snapshot' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 if p_actor is distinct from auth.uid() or not public.learn_slack_recurring_access(p_tenant,true) then
  raise exception 'slack_recurring_forbidden' using errcode='42501';end if;
 if p_request is null or p_account is null or p_revision is null or p_revision<0 or p_enabled is null
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or p_mode is null or p_mode not in ('apply','check','cancel') then
  raise exception 'slack_recurring_invalid' using errcode='22023';end if;
 definition:=jsonb_build_object('accountId',p_account,'revision',p_revision,'enabled',p_enabled,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-recurring-request:'||p_request::text,0));
 select * into r from public.slack_recurring_requests where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.actor_id<>auth.uid() or r.definition<>definition then
   raise exception 'slack_recurring_request_changed' using errcode='40001';end if;
  return r.receipt;
 end if;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'accountId',p_account,
  'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return answer;end if;
 if p_mode='cancel' then
  insert into public.slack_recurring_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,auth.uid(),definition,answer);
  return answer;
 end if;
 -- Same setup lock as manual channel imports; subscription precedes account locks.
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant::text,0));
 select * into s from public.slack_recurring_channels where account_id=p_account for update;
 if (found and (s.tenant_id<>p_tenant or s.revision<>p_revision)) or (not found and p_revision<>0) then
  raise exception 'slack_recurring_changed' using errcode='40001';end if;
 select * into a from public.connector_accounts where id=p_account and tenant_id=p_tenant for update;
 if not found then raise exception 'slack_recurring_account_unavailable' using errcode='42501';end if;
 cfg:=a.settings->'slack_history';
 resume_paused:=s.account_id is not null and not s.enabled and s.current_import is not null
  and cfg->>'consentReference'='learn-slack-import:'||s.current_import::text
  and cfg->'approved'='false'::jsonb;
 resume_paused:=coalesce(resume_paused,false);
 if p_enabled then
  if a.status is distinct from 'active' or coalesce(cfg->>'channelId','') !~ '^C[A-Z0-9]+$'
   or coalesce(cfg->>'teamId','') !~ '^T[A-Z0-9]+$'
   or coalesce(cfg->>'latest','') !~ '^\d{1,12}\.\d{1,6}$'
   or not exists(select 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant
    and connector_id='slack' and enabled and status='active') then
   raise exception 'slack_recurring_finish_initial_import' using errcode='55000';end if;
  if not resume_paused and a.sync_cursor->'complete' is distinct from 'true'::jsonb then
   raise exception 'slack_recurring_finish_initial_import' using errcode='55000';end if;
  if not resume_paused and exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='slack.history_sync'
   and payload->>'connector_account_id'=p_account::text and status in ('queued','running','retrying')) then
   raise exception 'slack_recurring_window_active' using errcode='55000';end if;
  -- A true checkpoint alone is insufficient: require matching durable publication.
  if not resume_paused and not exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='slack.history_sync'
   and payload->>'connector_account_id'=p_account::text and status='succeeded'
   and metadata->'slack_page_v1'->'next'=a.sync_cursor
   and metadata->'slack_page_v1'->>'account_id'=p_account::text) then
   raise exception 'slack_recurring_completion_unverified' using errcode='55000';end if;
  select * into c from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant for share;
  if not found or c.provider is distinct from 'slack' or c.status is distinct from 'configured' or c.revoked_at is not null
   or c.non_secret_config->>'team_id' is distinct from cfg->>'teamId'
   or ('bot_token'=any(c.configured_fields)) is distinct from true or c.secret_refs->>'bot_token' is null then
   raise exception 'slack_recurring_connection_unavailable' using errcode='55000';end if;
  boundary:=to_timestamp((cfg->>'latest')::double precision);
  if boundary>clock_timestamp() then raise exception 'slack_recurring_future_window' using errcode='22023';end if;
  if resume_paused then
   if c.id<>s.connection_id or c.updated_at<>s.connection_revision or cfg->>'teamId'<>s.team_id or cfg->>'channelId'<>s.channel_id then
    raise exception 'slack_recurring_connection_changed' using errcode='40001';end if;
   -- Restore only the approved unfinished scope. Expiry and page limits stay as
   -- recorded; exhausted work still uses the explicit existing recovery flow.
   update public.slack_recurring_channels set enabled=true,revision=revision+1,approved_by=auth.uid(),
    last_state='ready',next_check_at=clock_timestamp(),updated_at=clock_timestamp()
    where account_id=p_account returning * into s;
  else
  insert into public.slack_recurring_channels(account_id,tenant_id,connection_id,connection_revision,team_id,channel_id,approved_by,enabled,next_start)
   values(p_account,p_tenant,c.id,c.updated_at,cfg->>'teamId',cfg->>'channelId',auth.uid(),true,boundary)
   on conflict(account_id) do update set connection_id=excluded.connection_id,connection_revision=excluded.connection_revision,
    team_id=excluded.team_id,channel_id=excluded.channel_id,
    approved_by=excluded.approved_by,enabled=true,next_start=excluded.next_start,current_import=null,
    revision=slack_recurring_channels.revision+1,last_state='ready',next_check_at=clock_timestamp(),updated_at=clock_timestamp()
   returning * into s;
  end if;
  update public.connector_accounts set settings=jsonb_set(settings,'{slack_history,approved}','true') where id=p_account;
 else
  if s.account_id is null then raise exception 'slack_recurring_not_configured' using errcode='55000';end if;
  update public.slack_recurring_channels set enabled=false,revision=revision+1,last_state='disabled',updated_at=clock_timestamp()
   where account_id=p_account returning * into s;
  -- Stop further requests for this recurring window without erasing its checkpoint.
  if s.current_import is not null and cfg->>'consentReference'='learn-slack-import:'||s.current_import::text then
   update public.connector_accounts set settings=jsonb_set(settings,'{slack_history,approved}','false') where id=p_account;
  end if;
 end if;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'accountId',p_account,'state','recorded','enabled',s.enabled,'revision',s.revision);
 insert into public.slack_recurring_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,auth.uid(),definition,answer);
 return answer;
end $$;

create function public.learn_slack_schedule_recurring(p_batch integer default 10) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.slack_recurring_channels%rowtype;a public.connector_accounts%rowtype;
 c public.provider_connections%rowtype;cfg jsonb;previous jsonb;approval jsonb;
 boundary timestamptz;ending timestamptz;request_id uuid;job_id uuid;state text;
 checked integer:=0;queued integer:=0;held integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_recurring_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_batch is null or p_batch not between 1 and 50 then
  raise exception 'slack_recurring_invalid' using errcode='22023';end if;
 -- Select due IDs before taking the established tenant setup lock. All callers
 -- then take the subscription and account locks in that same order.
 for s in select * from public.slack_recurring_channels where enabled and next_check_at<=clock_timestamp()
  order by next_check_at,account_id limit p_batch
 loop
  if not pg_try_advisory_xact_lock(hashtextextended('learn-slack-setup:'||s.tenant_id::text,0)) then continue;end if;
  select * into s from public.slack_recurring_channels where account_id=s.account_id and enabled
   and next_check_at<=clock_timestamp() for update;
  if not found then continue;end if;
  checked:=checked+1;state:='ready';boundary:=s.next_start;
  if not public.learn_capture_allowed(s.tenant_id,'slack') then state:='capture_paused';
  end if;
  perform 1 from public.profiles p where p.id=s.approved_by and
   ((p.tenant_id=s.tenant_id and p.role in ('owner','admin')) or exists(select 1 from public.platform_authority_grants g
     where g.profile_id=p.id and g.permission='platform.controlplane.admin'
     and coalesce(g.effective_from,'-infinity')<=now() and coalesce(g.effective_to,'infinity')>now())) for share;
  if state='ready' and not found then state:='approval_changed';end if;
  select * into a from public.connector_accounts where id=s.account_id and tenant_id=s.tenant_id for update;
  if not found or a.status is distinct from 'active' then state:='account_unavailable';end if;
  cfg:=a.settings->'slack_history';
  if state='ready' and cfg->'approved' is distinct from 'true'::jsonb then state:='approval_changed';end if;
  select * into c from public.provider_connections where id=s.connection_id and tenant_id=s.tenant_id for share;
  if not found or c.provider is distinct from 'slack' or c.status is distinct from 'configured' or c.revoked_at is not null
   or c.updated_at is distinct from s.connection_revision or c.non_secret_config->>'team_id' is distinct from cfg->>'teamId'
   or cfg->>'connectionId' is distinct from s.connection_id::text or ('bot_token'=any(c.configured_fields)) is distinct from true
   or cfg->>'teamId' is distinct from s.team_id or cfg->>'channelId' is distinct from s.channel_id
   or c.secret_refs->>'bot_token' is null then state:='connection_changed';end if;
  if not exists(select 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=s.tenant_id
   and connector_id='slack' and enabled and status='active') then state:='connector_paused';end if;
  if state='ready' and exists(select 1 from public.platform_jobs where tenant_id=s.tenant_id and job_type='slack.history_sync'
   and payload->>'connector_account_id'=s.account_id::text and status in ('queued','running','retrying')) then state:='window_active';end if;
  if state='ready' then
   if s.current_import is not null and cfg->>'consentReference' is distinct from 'learn-slack-import:'||s.current_import::text then state:='window_changed';
   elsif a.sync_cursor->'complete' is distinct from 'true'::jsonb then state:='window_incomplete';
   elsif not exists(select 1 from public.platform_jobs where tenant_id=s.tenant_id and job_type='slack.history_sync'
    and payload->>'connector_account_id'=s.account_id::text and status='succeeded'
    and metadata->'slack_page_v1'->'next'=a.sync_cursor and metadata->'slack_page_v1'->>'account_id'=s.account_id::text)
    then state:='completion_unverified';
   elsif coalesce(cfg->>'latest','') !~ '^\d{1,12}\.\d{1,6}$' then state:='window_changed';
   else
    boundary:=to_timestamp((cfg->>'latest')::double precision);
    if (s.current_import is null and boundary is distinct from s.next_start) or boundary<s.next_start then state:='window_changed';end if;
   end if;
  end if;
  if state='ready' then
   -- Fifteen-minute windows bound busy-channel pages; 2-minute settling delay.
   ending:=least(boundary+interval '15 minutes',clock_timestamp()-interval '2 minutes');
   if ending-boundary<interval '1 minute' then state:='caught_up';
   else
    request_id:=gen_random_uuid();job_id:=gen_random_uuid();
    previous:=jsonb_build_object('settings',cfg,'checkpoint',a.sync_cursor);
    approval:=jsonb_build_object('approved',true,'connectionId',c.id,'teamId',cfg->>'teamId','channelId',cfg->>'channelId',
     'oldest',to_char(extract(epoch from boundary),'FM999999999999.000000'),
     'latest',to_char(extract(epoch from ending),'FM999999999999.000000'),
     'consentReference','learn-slack-import:'||request_id::text,'expiresAt',clock_timestamp()+interval '24 hours','maxPages',10);
    update public.connector_accounts set settings=settings||jsonb_build_object('slack_history',approval),sync_cursor='{}' where id=a.id;
    insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
     values(job_id,s.tenant_id,'slack','slack.history_sync','slack.history:'||a.id::text,'queued',5,clock_timestamp(),jsonb_build_object('connector_account_id',a.id),s.approved_by);
    insert into public.slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition,previous_state)
     values(request_id,s.tenant_id,a.id,job_id,s.approved_by,jsonb_build_object('connectionId',c.id,'connectionRevision',c.updated_at,
      'channelId',cfg->>'channelId','start',boundary,'end',ending,'maxPages',10,'recurringAccountId',a.id,
      'recurringRevision',s.revision,'reason','Approved recurring channel capture'),previous);
    update public.slack_recurring_channels set current_import=request_id,next_start=boundary where account_id=a.id;
    queued:=queued+1;state:='window_queued';
   end if;
  end if;
  if state not in ('window_queued','window_active','caught_up') then held:=held+1;end if;
  update public.slack_recurring_channels set last_state=state,next_check_at=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() where account_id=s.account_id;
 end loop;
 return jsonb_build_object('checked',checked,'queued',queued,'held',held);
end $$;
revoke all on function public.learn_slack_recurring_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_recurring_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid) to authenticated;
revoke all on function public.learn_slack_schedule_recurring(integer) from public,anon,authenticated;
grant execute on function public.learn_slack_schedule_recurring(integer) to service_role;

create function public.learn_slack_recurring_read(p_tenant uuid,p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;begin
 if not public.learn_slack_recurring_access(p_tenant,false) then raise exception 'slack_recurring_forbidden' using errcode='42501';end if;
 with candidates as (
  select a.* from public.connector_accounts a join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=p_tenant
  where a.tenant_id=p_tenant and tc.connector_id='slack' and (p_after is null or a.id>p_after)
   and a.settings ? 'slack_history' order by a.id limit 51
 ), page as (select * from candidates order by id limit 50), rows as (
  select a.id,jsonb_build_object('accountId',a.id,'name',left(coalesce(a.display_name,'Slack channel'),200),
   'teamId',case when a.settings->'slack_history'->>'teamId' ~ '^T[A-Z0-9]+$' then a.settings->'slack_history'->>'teamId' else null end,
   'channelId',case when a.settings->'slack_history'->>'channelId' ~ '^C[A-Z0-9]+$' then a.settings->'slack_history'->>'channelId' else null end,
   'enabled',coalesce(s.enabled,false),'revision',coalesce(s.revision,0),'state',coalesce(s.last_state,'not_configured'),
   'nextStart',s.next_start,'nextCheckAt',s.next_check_at,'updatedAt',s.updated_at,
   'completeVerified',coalesce(a.sync_cursor->'complete'='true'::jsonb and exists(select 1 from public.platform_jobs j
    where j.tenant_id=p_tenant and j.job_type='slack.history_sync' and j.payload->>'connector_account_id'=a.id::text and j.status='succeeded'
     and j.metadata->'slack_page_v1'->'next'=a.sync_cursor and j.metadata->'slack_page_v1'->>'account_id'=a.id::text),false),
   'pausedWindow',coalesce(not s.enabled and s.current_import is not null
    and a.settings->'slack_history'->>'consentReference'='learn-slack-import:'||s.current_import::text
    and a.settings->'slack_history'->'approved'='false'::jsonb,false)
  ) as item from page a left join public.slack_recurring_channels s on s.account_id=a.id and s.tenant_id=p_tenant
 ) select jsonb_build_object('version','learn-slack-recurring/1','tenantId',p_tenant,
  'canWrite',public.learn_slack_recurring_access(p_tenant,true),'channels',coalesce((select jsonb_agg(item order by id) from rows),'[]'),
  'next',case when (select count(*) from candidates)>50 then (select id from page order by id desc limit 1) else null end)
 into result;
 return result;
end $$;
revoke all on function public.learn_slack_recurring_read(uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_recurring_read(uuid,uuid) to authenticated;
commit;
