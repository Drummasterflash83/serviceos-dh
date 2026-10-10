-- Opt-in recurring observed-thread capture. No subscriptions, jobs or credentials seeded.
begin;
alter table public.slack_recurring_channels add column include_threads boolean not null default false,
 add column thread_revision bigint not null default 0;
create table public.slack_recurring_thread_windows (
 history_import_id uuid primary key references public.slack_history_imports(id),
 tenant_id uuid not null references public.tenants(id),
 account_id uuid not null references public.connector_accounts(id),
 recurring_revision bigint not null,
 after_parent numeric,
 discovery_complete boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.slack_recurring_thread_windows enable row level security;
revoke all on public.slack_recurring_thread_windows from public,anon,authenticated,service_role;
grant select on public.slack_recurring_thread_windows to service_role;
create table public.slack_recurring_thread_members (
 history_import_id uuid not null references public.slack_recurring_thread_windows(history_import_id),
 parent_timestamp numeric not null,
 thread_import_id uuid not null unique references public.slack_thread_imports(id),
 primary key(history_import_id,parent_timestamp)
);
alter table public.slack_recurring_thread_members enable row level security;
revoke all on public.slack_recurring_thread_members from public,anon,authenticated,service_role;
grant select on public.slack_recurring_thread_members to service_role;

-- Separate control preserves the existing ongoing-channel request contract.
create function public.learn_slack_recurring_threads_control(p_tenant uuid,p_request uuid,p_account uuid,p_revision bigint,p_enabled boolean,p_reason text,p_mode text default 'apply',p_actor uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.slack_recurring_channels%rowtype;r public.slack_recurring_requests%rowtype;definition jsonb;answer jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_recurring_snapshot' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 if p_actor is distinct from auth.uid() or not public.learn_slack_recurring_access(p_tenant,true) then raise exception 'slack_recurring_forbidden' using errcode='42501';end if;
 if p_request is null or p_account is null or p_revision is null or p_revision<1 or p_enabled is null
 or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or p_mode is null or p_mode not in ('apply','check','cancel') then raise exception 'slack_recurring_invalid' using errcode='22023';end if;
 definition:=jsonb_build_object('kind','observed_threads','accountId',p_account,'revision',p_revision,'enabled',p_enabled,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-recurring-request:'||p_request::text,0));
 select * into r from public.slack_recurring_requests where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.actor_id<>auth.uid() or r.definition<>definition then raise exception 'slack_recurring_request_changed' using errcode='40001';end if;
  return r.receipt;
 end if;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'accountId',p_account,'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return answer;end if;
 if p_mode='cancel' then
  insert into public.slack_recurring_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,auth.uid(),definition,answer);
  return answer;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant::text,0));
 select * into s from public.slack_recurring_channels where account_id=p_account and tenant_id=p_tenant for update;
 if not found or s.revision<>p_revision then raise exception 'slack_recurring_changed' using errcode='40001';end if;
 if p_enabled and not s.enabled then raise exception 'slack_recurring_channel_disabled' using errcode='55000';end if;
 -- Do not attach a new approval to an already-discovered window. Disabling is always allowed;
 -- re-enabling waits for a fresh channel window, retaining all earlier thread evidence.
 if p_enabled and exists(select 1 from public.slack_recurring_thread_windows where history_import_id=s.current_import) then
  raise exception 'slack_recurring_thread_window_started' using errcode='55000';end if;
 update public.slack_recurring_channels set include_threads=p_enabled,thread_revision=thread_revision+1,revision=revision+1,approved_by=auth.uid(),
  next_check_at=clock_timestamp(),updated_at=clock_timestamp() where account_id=p_account returning * into s;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'accountId',p_account,'state','recorded','enabled',s.include_threads,'revision',s.revision);
 insert into public.slack_recurring_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,auth.uid(),definition,answer);
 return answer;
end $$;
revoke all on function public.learn_slack_recurring_threads_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_recurring_threads_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid) to authenticated;

-- Rechecked before credential access and page publication. Manual approvals retain
-- their existing gate; recurring approvals additionally depend on the live subscription.
create function public.learn_slack_recurring_thread_allowed(p_tenant uuid,p_import uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.slack_thread_imports t where t.id=p_import and t.tenant_id=p_tenant
 and (not (t.definition ? 'recurringHistoryImportId') or exists(
  select 1 from public.slack_recurring_channels s
  join public.provider_connections c on c.id=s.connection_id and c.tenant_id=s.tenant_id
  join public.profiles p on p.id=t.approved_by
  where s.account_id=t.account_id and s.tenant_id=p_tenant and s.enabled and s.include_threads
  and s.thread_revision=(t.definition->>'recurringRevision')::bigint
  and c.updated_at=s.connection_revision and c.updated_at=(t.definition->>'connectionRevision')::timestamptz
  and c.status='configured' and c.revoked_at is null and c.provider='slack'
  and public.learn_capture_allowed(p_tenant,'slack')
  and ((p.tenant_id=p_tenant and p.role in ('owner','admin')) or exists(select 1 from public.platform_authority_grants g
   where g.profile_id=p.id and g.permission='platform.controlplane.admin'
   and coalesce(g.effective_from,'-infinity')<=now() and coalesce(g.effective_to,'infinity')>now())))));
$$;
revoke all on function public.learn_slack_recurring_thread_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.learn_slack_recurring_thread_allowed(uuid,uuid) to service_role;

-- Follow explicit recovery lineage while retaining every earlier approval.
create function public.learn_slack_recurring_thread_window_progress(p_window uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 with recursive lineage(root,id,tenant_id,account_id,scope,definition,checkpoint,approved_at) as (
  select m.thread_import_id,t.id,t.tenant_id,t.account_id,t.scope,t.definition,t.checkpoint,t.approved_at
  from public.slack_recurring_thread_members m join public.slack_thread_imports t on t.id=m.thread_import_id where m.history_import_id=p_window
  union
  select l.root,t.id,t.tenant_id,t.account_id,t.scope,t.definition,t.checkpoint,t.approved_at
  from lineage l join public.slack_thread_imports t on t.definition->>'resumesImportId'=l.id::text
  and t.tenant_id=l.tenant_id and t.account_id=l.account_id
  and t.definition->>'recurringHistoryImportId'=p_window::text
  and t.scope->>'parentTimestamp'=l.scope->>'parentTimestamp'
  and t.scope->>'oldest'=l.scope->>'oldest' and t.scope->>'latest'=l.scope->>'latest'
 ), latest as (select distinct on(root) * from lineage order by root,approved_at desc,id desc)
 select jsonb_build_object('discoveryComplete',(select discovery_complete from public.slack_recurring_thread_windows where history_import_id=p_window),
 'observed',(select count(*) from latest),'completed',(select count(*) from latest t where t.checkpoint->'complete'='true'::jsonb and exists(
  select 1 from public.platform_jobs j where j.tenant_id=t.tenant_id and j.job_type='slack.thread_sync' and j.status='succeeded'
  and j.payload->>'thread_import_id'=t.id::text and j.metadata->'slack_page_v1'->'next'=t.checkpoint
  and j.metadata->'slack_page_v1'->>'thread_import_id'=t.id::text)));
$$;
revoke all on function public.learn_slack_recurring_thread_window_progress(uuid) from public,anon,authenticated,service_role;
create function public.learn_slack_recurring_thread_window_complete(p_window uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(p->'discoveryComplete'='true'::jsonb and p->'observed'=p->'completed',false)
 from public.learn_slack_recurring_thread_window_progress(p_window) p;
$$;
revoke all on function public.learn_slack_recurring_thread_window_complete(uuid) from public,anon,authenticated,service_role;
create function public.learn_slack_recurring_threads_status(p_account uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('enabled',coalesce(s.include_threads,false),'canEnable',coalesce(s.enabled and w.history_import_id is null,false),
 'discoveryComplete',case when w.history_import_id is not null then w.discovery_complete else null end,
 'observed',case when w.history_import_id is not null then progress->'observed' else 'null'::jsonb end,
 'completed',case when w.history_import_id is not null then progress->'completed' else 'null'::jsonb end)
 from (select 1) seed left join public.slack_recurring_channels s on s.account_id=p_account
 left join public.slack_recurring_thread_windows w on w.history_import_id=s.current_import
 left join lateral public.learn_slack_recurring_thread_window_progress(w.history_import_id) progress on true;
$$;
revoke all on function public.learn_slack_recurring_threads_status(uuid) from public,anon,authenticated,service_role;
-- Only the existing tenant-scoped reader exposes this non-secret summary.
do $patch$declare d text;needle text:='   ''pausedWindow'',coalesce';begin
 d:=pg_get_functiondef('public.learn_slack_recurring_read(uuid,uuid)'::regprocedure);
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed recurring reader changed';end if;
 execute replace(d,needle,'   ''threads'',public.learn_slack_recurring_threads_status(a.id),'||chr(10)||needle);
end $patch$;

-- Called under the existing scheduler's subscription/account locks. At most twenty
-- observed parents are queued per pass. Numeric timestamps deduplicate equivalent IDs.
create function public.learn_slack_queue_recurring_threads(p_account uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.slack_recurring_channels%rowtype;a public.connector_accounts%rowtype;i public.slack_history_imports%rowtype;
 w public.slack_recurring_thread_windows%rowtype;m record;request_id uuid;job_id uuid;key text;cfg jsonb;scope jsonb;scanned integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_recurring_forbidden' using errcode='42501';end if;
 select * into s from public.slack_recurring_channels where account_id=p_account;
 if not found then return false;end if;
 -- Serialize direct calls with the channel scheduler and controls, in their lock order.
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||s.tenant_id::text,0));
 select * into s from public.slack_recurring_channels where account_id=p_account for update;
 if not s.enabled or not s.include_threads or s.current_import is null then return false;end if;
 if not public.learn_capture_allowed(s.tenant_id,'slack') then return false;end if;
 perform 1 from public.profiles p where p.id=s.approved_by and
 ((p.tenant_id=s.tenant_id and p.role in ('owner','admin')) or exists(select 1 from public.platform_authority_grants g
 where g.profile_id=p.id and g.permission='platform.controlplane.admin'
 and coalesce(g.effective_from,'-infinity')<=now() and coalesce(g.effective_to,'infinity')>now())) for share;
 if not found then return false;end if;
 select * into a from public.connector_accounts where id=s.account_id and tenant_id=s.tenant_id for update;
 cfg:=a.settings->'slack_history';
 if not found or a.status<>'active' or cfg->'approved' is distinct from 'true'::jsonb
 or cfg->>'consentReference' is distinct from 'learn-slack-import:'||s.current_import::text
 or cfg->>'connectionId' is distinct from s.connection_id::text or cfg->>'teamId' is distinct from s.team_id
 or cfg->>'channelId' is distinct from s.channel_id or a.sync_cursor->'complete' is distinct from 'true'::jsonb then return false;end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=s.tenant_id and connector_id='slack' and enabled and status='active' for share;
 if not found then return false;end if;
 perform 1 from public.provider_connections where id=s.connection_id and tenant_id=s.tenant_id and provider='slack'
 and status='configured' and revoked_at is null and updated_at=s.connection_revision and non_secret_config->>'team_id'=s.team_id
 and 'bot_token'=any(configured_fields) and secret_refs->>'bot_token' is not null for share;
 if not found then return false;end if;
 select * into i from public.slack_history_imports where id=s.current_import and tenant_id=s.tenant_id and account_id=s.account_id;
 if not found or i.definition->>'recurringAccountId' is distinct from s.account_id::text then return false;end if;
 if not exists(select 1 from public.platform_jobs where tenant_id=s.tenant_id and job_type='slack.history_sync' and status='succeeded'
 and payload->>'connector_account_id'=s.account_id::text and metadata->'slack_page_v1'->'next'=a.sync_cursor
 and metadata->'slack_page_v1'->>'account_id'=s.account_id::text) then return false;end if;
 insert into public.slack_recurring_thread_windows(history_import_id,tenant_id,account_id,recurring_revision)
 values(i.id,s.tenant_id,s.account_id,s.thread_revision) on conflict do nothing;
 select * into w from public.slack_recurring_thread_windows where history_import_id=i.id for update;
 if w.recurring_revision<>s.thread_revision then return false;end if;
 if not w.discovery_complete then
  for m in
   with observed as (
    select sm.*,case when sm.thread_timestamp is not null and sm.thread_timestamp::numeric<sm.provider_timestamp::numeric then sm.thread_timestamp
    when coalesce(sm.provider_payload->>'reply_count','') ~ '^[0-9]+$' and (sm.provider_payload->>'reply_count')::numeric>0 then sm.provider_timestamp end as parent
    from public.slack_messages sm where sm.tenant_id=s.tenant_id and sm.team_id=s.team_id and sm.channel_id=s.channel_id
   ), parents as (
    select distinct on (parent::numeric) id,source_version,parent from observed where parent is not null
    and parent::numeric<=(cfg->>'latest')::numeric and (w.after_parent is null or parent::numeric>w.after_parent)
    order by parent::numeric,id
   ) select * from parents order by parent::numeric limit 20
  loop
   request_id:=gen_random_uuid();job_id:=gen_random_uuid();
   key:='slack.thread:'||a.id::text||':'||m.parent||':'||extract(epoch from (i.definition->>'start')::timestamptz)::text||':'||extract(epoch from (i.definition->>'end')::timestamptz)::text;
   -- Recovery locks the window before the account. Do not wait while holding the account.
   if not pg_try_advisory_xact_lock(hashtextextended(key,0)) then return false;end if;
   if exists(select 1 from public.platform_jobs where tenant_id=s.tenant_id and job_key=key and status in ('queued','running','retrying')) then return false;end if;
   scope:=jsonb_build_object('approved',true,'connectionId',s.connection_id,'teamId',s.team_id,'channelId',s.channel_id,
    'parentTimestamp',m.parent,'oldest',cfg->>'oldest','latest',cfg->>'latest','consentReference','learn-slack-thread:'||request_id::text,
    'expiresAt',clock_timestamp()+interval '24 hours','maxPages',10);
   insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
   values(job_id,s.tenant_id,'slack','slack.thread_sync',key,'queued',5,clock_timestamp(),jsonb_build_object('thread_import_id',request_id,'connector_account_id',a.id),s.approved_by);
   insert into public.slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope)
   values(request_id,s.tenant_id,a.id,m.id,job_id,s.approved_by,jsonb_build_object('accountId',a.id,'sourceMessageId',m.id,'sourceVersion',m.source_version,
    'connectionRevision',s.connection_revision,'start',i.definition->'start','end',i.definition->'end','maxPages',10,
    'recurringHistoryImportId',i.id,'recurringRevision',s.thread_revision,'reason','Approved recurring observed-thread capture'),scope);
   insert into public.slack_recurring_thread_members values(i.id,m.parent::numeric,request_id);
   update public.slack_recurring_thread_windows set after_parent=m.parent::numeric where history_import_id=i.id;
   scanned:=scanned+1;
  end loop;
  if scanned<20 then update public.slack_recurring_thread_windows set discovery_complete=true where history_import_id=i.id;else return false;end if;
 end if;
 return public.learn_slack_recurring_thread_window_complete(i.id);
end $$;
revoke all on function public.learn_slack_queue_recurring_threads(uuid) from public,anon,authenticated;
grant execute on function public.learn_slack_queue_recurring_threads(uuid) to service_role;

-- Preserve the existing channel protocol, inserting only the new optional gate.
do $patch$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_schedule_recurring(integer)'::regprocedure);
 needle:='  if state=''ready'' then'||chr(10)||'   -- Fifteen-minute windows';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed channel scheduler changed';end if;
 execute replace(d,needle,'  if state=''ready'' and s.include_threads and s.current_import is not null then'||chr(10)||
 '   if not public.learn_slack_queue_recurring_threads(s.account_id) then state:=''threads_pending'';end if;'||chr(10)||'  end if;'||chr(10)||needle);
end $patch$;
-- Re-approving an already-enabled channel must not discard unfinished replies.
do $patch$declare d text;needle text:=' resume_paused:=coalesce(resume_paused,false);';begin
 d:=pg_get_functiondef('public.learn_slack_recurring_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid)'::regprocedure);
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed recurring control changed';end if;
 execute replace(d,needle,needle||chr(10)||' if p_enabled and s.include_threads and s.current_import is not null and not resume_paused and not public.learn_slack_recurring_thread_window_complete(s.current_import) then raise exception ''slack_recurring_threads_incomplete'' using errcode=''55000'';end if;');
end $patch$;

-- Both server-side credential and publication paths enforce pause/revocation.
do $patch$declare d text;signature text;needle text:=' cfg:=t.scope;';begin
 foreach signature in array array['public.learn_slack_read_thread_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid)',
  'public.slack_thread_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed thread gate changed: %',signature;end if;
  execute replace(d,needle,' if not public.learn_slack_recurring_thread_allowed(p_tenant_id,t.id) then raise exception ''slack_recurring_thread_paused'' using errcode=''42501'';end if;'||chr(10)||needle);
 end loop;
end $patch$;
commit;
