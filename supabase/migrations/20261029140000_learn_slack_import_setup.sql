-- Owner/admin approval and durable enqueue for the existing Slack history worker.
-- Additive; does not create credentials, change provider grants or import on apply.
begin;
create table public.slack_history_imports (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 account_id uuid not null references public.connector_accounts(id),
 job_id uuid not null references public.platform_jobs(id),
 approved_by uuid not null references public.profiles(id),
 approved_at timestamptz not null default now(),
 definition jsonb not null,
 previous_state jsonb
);
alter table public.slack_history_imports enable row level security;
create policy slack_import_read on public.slack_history_imports for select to authenticated
 using(tenant_id=public.current_tenant_id());
revoke all on public.slack_history_imports from public,anon,authenticated,service_role;
grant select on public.slack_history_imports to authenticated,service_role;
create trigger slack_import_immutable before update or delete on public.slack_history_imports
 for each row execute function public.slack_version_immutable();

create function public.learn_slack_start_import(
 p_tenant_id uuid,p_request_id uuid,p_connection_id uuid,p_expected_revision text,
 p_channel_id text,p_start timestamptz,p_end timestamptz,p_max_pages integer,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 c public.provider_connections%rowtype;
 tc public.tenant_connectors%rowtype;
 a public.connector_accounts%rowtype;
 prior public.slack_history_imports%rowtype;
 definition jsonb;
 scope jsonb;
 checkpoint jsonb;
 previous_state jsonb;
 aid uuid;
 jid uuid:=gen_random_uuid();
begin
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id()
  or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>now())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';
 end if;
 if p_request_id is null or p_connection_id is null or p_expected_revision is null
  or coalesce(p_channel_id,'') !~ '^C[A-Z0-9]+$' or length(p_channel_id)>100
  or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end-p_start>interval '24 hours' or p_end>clock_timestamp()
  or p_start<to_timestamp(0) or p_max_pages is null or p_max_pages not between 1 and 10
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'Choose a past window up to 24 hours, a public channel and a reason' using errcode='22023';
 end if;
 definition:=jsonb_build_object('connectionId',p_connection_id,'connectionRevision',p_expected_revision,
  'channelId',p_channel_id,'start',p_start,'end',p_end,'maxPages',p_max_pages,'reason',btrim(p_reason));
 -- Serialise retries before looking up an existing request. A lost response must
 -- never produce a second approval or job, even if no job is still active.
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-request:'||p_request_id::text,0));
 select * into prior from public.slack_history_imports where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.definition<>definition then
   raise exception 'Import request identity has changed' using errcode='40001';
  end if;
  return jsonb_build_object('requestId',prior.id,'accountId',prior.account_id,'jobId',prior.job_id,'reused',true);
 end if;
 -- Shared tenant connector before channel/account follows the same order for
 -- all setup requests. Publication takes row locks separately and stays atomic.
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant_id::text,0));
 select * into c from public.provider_connections where id=p_connection_id and tenant_id=p_tenant_id for share;
 if not found or c.provider<>'slack' or c.status<>'configured' or c.revoked_at is not null
  or c.updated_at is distinct from p_expected_revision::timestamptz
  or coalesce(c.non_secret_config->>'team_id','') !~ '^T[A-Z0-9]+$'
  or not ('bot_token'=any(c.configured_fields)) or c.secret_refs->>'bot_token' is null then
  raise exception 'Slack connection unavailable or changed; reload setup' using errcode='40001';
 end if;
 select * into tc from public.tenant_connectors where tenant_id=p_tenant_id and connector_id='slack';
 if not found then
  insert into public.tenant_connectors(tenant_id,connector_id,provider,category,status,enabled)
   values(p_tenant_id,'slack','slack','communications','active',true) returning * into tc;
 elsif not tc.enabled or tc.status<>'active' then
  raise exception 'Slack connector is disabled; restore it before importing' using errcode='55000';
 end if;
 select * into a from public.connector_accounts where tenant_connector_id=tc.id and tenant_id=p_tenant_id
  and account_key=(c.non_secret_config->>'team_id')||':'||p_channel_id for update;
 if found then
  if a.status<>'active' or exists(select 1 from public.platform_jobs where tenant_id=p_tenant_id
   and job_type='slack.history_sync' and payload->>'connector_account_id'=a.id::text
   and status in ('queued','running','retrying')) then
   raise exception 'A channel import is active or the account is disabled' using errcode='55000';
  end if;
  if a.settings ? 'slack_history' and a.sync_cursor->'complete' is distinct from 'true'::jsonb then
   raise exception 'Previous window is incomplete; retain its checkpoint for review' using errcode='55000';
  end if;
  previous_state:=jsonb_build_object('settings',a.settings->'slack_history','checkpoint',a.sync_cursor);
  aid:=a.id;
 else
  insert into public.connector_accounts(tenant_id,tenant_connector_id,account_key,display_name,status)
   values(p_tenant_id,tc.id,(c.non_secret_config->>'team_id')||':'||p_channel_id,p_channel_id,'active') returning id into aid;
 end if;
 scope:=jsonb_build_object('approved',true,'connectionId',c.id,'teamId',c.non_secret_config->>'team_id',
  'channelId',p_channel_id,'oldest',to_char(extract(epoch from p_start),'FM999999999999.000000'),
  'latest',to_char(extract(epoch from p_end),'FM999999999999.000000'),
  'consentReference','learn-slack-import:'||p_request_id::text,'expiresAt',clock_timestamp()+interval '24 hours','maxPages',p_max_pages);
 checkpoint:='{}'::jsonb; -- Worker creates the exact canonical scope key.
 select * into tc from public.tenant_connectors where id=tc.id and tenant_id=p_tenant_id for update;
 if not found or not tc.enabled or tc.status<>'active' then raise exception 'Slack connector changed' using errcode='55000'; end if;
 update public.connector_accounts set settings=settings||jsonb_build_object('slack_history',scope),sync_cursor=checkpoint where id=aid;
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(jid,p_tenant_id,'slack','slack.history_sync','slack.history:'||aid::text,'queued',5,clock_timestamp(),
   jsonb_build_object('connector_account_id',aid),auth.uid());
 insert into public.slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition,previous_state)
  values(p_request_id,p_tenant_id,aid,jid,auth.uid(),definition,previous_state);
 return jsonb_build_object('requestId',p_request_id,'accountId',aid,'jobId',jid,'reused',false);
end $$;
revoke all on function public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text) from public,anon;
grant execute on function public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text) to authenticated;
commit;
