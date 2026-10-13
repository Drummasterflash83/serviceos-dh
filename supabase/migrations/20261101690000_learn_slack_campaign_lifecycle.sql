-- Explicit terminal stop / completed-history handoff. Installation creates no
-- subscription, campaign, job, credential, schedule or provider request.
begin;
create table public.slack_history_campaign_closures (
 campaign_id uuid primary key,tenant_id uuid not null,request_id uuid not null unique,
 actor_id uuid not null references public.profiles(id),
 outcome text not null check(outcome in ('stopped','ongoing')),
 snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id),
 foreign key(request_id) references public.slack_history_campaign_requests(id) deferrable initially deferred
);
alter table public.slack_history_campaign_closures enable row level security;
revoke all on public.slack_history_campaign_closures from public,anon,authenticated,service_role;
create trigger slack_campaign_closure_immutable before update or delete on public.slack_history_campaign_closures
 for each row execute function public.slack_version_immutable();
create trigger slack_campaign_closure_retain before truncate on public.slack_history_campaign_closures
 for each statement execute function public.slack_version_immutable();

-- Original jobs never become legacy jobs merely because a later workflow removes
-- the account's campaign binding. Keep this before the legacy fast path.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure);
 needle:=' if not coalesce(cfg ? ''campaignId'',false) then return true;end if;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign job binding differs';end if;
 execute replace(d,needle,$patch$ if j.payload ? 'campaign_id' and (cfg->>'campaignId' is distinct from j.payload->>'campaign_id'
  or exists(select 1 from public.slack_history_campaign_closures x where x.campaign_id::text=j.payload->>'campaign_id' and x.tenant_id=p_tenant)) then return false;end if;
 if j.job_type='slack.thread_sync' and exists(select 1 from public.slack_thread_imports old_thread
  where old_thread.id::text=j.payload->>'thread_import_id' and old_thread.tenant_id=p_tenant and old_thread.scope ? 'campaignId'
  and (cfg->>'campaignId' is distinct from old_thread.scope->>'campaignId'
   or exists(select 1 from public.slack_history_campaign_closures x where x.campaign_id::text=old_thread.scope->>'campaignId' and x.tenant_id=p_tenant))) then return false;end if;
$patch$||needle);
 d:=pg_get_functiondef('public.learn_slack_campaign_control(uuid,uuid,uuid,bigint,boolean,text,text)'::regprocedure);
 needle:='  if p_enabled and (h.expires_at<=clock_timestamp() or h.requests_reserved>=h.request_budget) then';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign terminal control differs';end if;
 execute replace(d,needle,'  if exists(select 1 from public.slack_history_campaign_closures where campaign_id=h.id) then raise exception ''slack_campaign_closed'' using errcode=''55000'';end if;'||chr(10)||needle);
 -- A retained terminal snapshot continues to prove the old window even after the
 -- recurring account has advanced to another scope/checkpoint.
 d:=pg_get_functiondef('public.learn_slack_campaign_channel_progress(uuid,uuid)'::regprocedure);
 needle:=' select * into m from public.slack_history_campaign_channels where campaign_id=p_campaign and account_id=p_account;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign terminal progress differs';end if;
 execute replace(d,needle,$patch$ if exists(select 1 from public.slack_history_campaign_closures where campaign_id=p_campaign) then
  return (select entry from public.slack_history_campaign_closures x cross join lateral jsonb_array_elements(x.snapshot->'channels') entry
   where x.campaign_id=p_campaign and entry->>'accountId'=p_account::text);
 end if;
$patch$||needle);
 d:=pg_get_functiondef('public.learn_slack_campaign_read(uuid,uuid)'::regprocedure);
 needle:=' select coalesce(jsonb_agg(jsonb_build_object(''accountId'',m.account_id';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign terminal reader differs';end if;
 execute replace(d,needle,$patch$ if exists(select 1 from public.slack_history_campaign_closures where campaign_id=h.id) then
  return (select x.snapshot||jsonb_build_object('enabled',false,'revision',h.revision,'lifecycle',x.outcome,'closedAt',x.created_at)
   from public.slack_history_campaign_closures x where x.campaign_id=h.id and x.tenant_id=p_tenant);
 end if;
$patch$||needle);
end$$;

create function public.learn_slack_campaign_close(p_tenant uuid,p_request uuid,p_campaign uuid,p_revision bigint,p_action text,p_reason text,p_mode text default 'apply') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.slack_history_campaign_requests%rowtype;h public.slack_history_campaigns%rowtype;
 m public.slack_history_campaign_channels%rowtype;a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 d jsonb;r jsonb;snapshot jsonb;channels jsonb:='[]';subscription jsonb;recurring_revision bigint;begin
 perform public.learn_slack_control_access(p_tenant,true,'resume_history');
 if current_setting('transaction_isolation')<>'read committed' or p_request is null or p_campaign is null or p_revision is null or p_revision<1
 or p_action is null or p_action not in ('stop','handoff') or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
 or p_mode is null or p_mode not in ('apply','check','cancel') then raise exception 'slack_campaign_close_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 perform public.learn_slack_control_access(p_tenant,true,'resume_history');
 d:=jsonb_build_object('kind','close_campaign','campaignId',p_campaign,'revision',p_revision,'action',p_action,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-campaign-request:'||p_request::text,0));
 select * into prior from public.slack_history_campaign_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>auth.uid() or prior.definition<>d then raise exception 'slack_campaign_request_changed' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 r:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return r;end if;
 if p_mode='apply' then
  perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant::text,0));
  select * into h from public.slack_history_campaigns where id=p_campaign and tenant_id=p_tenant for update;
  if not found or h.revision<>p_revision then raise exception 'slack_campaign_revision_changed' using errcode='PT409';end if;
  if exists(select 1 from public.slack_history_campaign_closures where campaign_id=h.id) then raise exception 'slack_campaign_closed' using errcode='55000';end if;
  snapshot:=public.learn_slack_campaign_read(p_tenant,h.id);
  if p_action='handoff' then
   if snapshot->'complete' is distinct from 'true'::jsonb or snapshot->'threadsComplete' is distinct from 'true'::jsonb then
    raise exception 'slack_campaign_finish_history' using errcode='55000';end if;
   -- Handoff is a fresh ongoing approval by the actual caller, not an extension
   -- of the old campaign's request budget or original actor's authority.
   if not public.learn_capture_allowed(p_tenant,'slack') then raise exception 'slack_campaign_capture_disabled' using errcode='55000';end if;
   select * into c from public.provider_connections where id=h.connection_id and tenant_id=p_tenant for share;
   if not found or c.updated_at is distinct from h.connection_revision or c.status is distinct from 'configured' or c.revoked_at is not null then
    raise exception 'slack_campaign_connection_changed' using errcode='55000';end if;
   if exists(select 1 from public.platform_jobs j join public.slack_history_campaign_channels member on member.account_id::text=j.payload->>'connector_account_id'
    and member.tenant_id=j.tenant_id where member.campaign_id=h.id and j.job_type in ('slack.history_sync','slack.thread_sync')
    and j.status in ('queued','retrying','running')) then raise exception 'slack_campaign_work_active' using errcode='55000';end if;
  end if;
  update public.slack_history_campaigns set enabled=false,revision=revision+1 where id=h.id returning * into h;
  insert into public.slack_history_campaign_closures(campaign_id,tenant_id,request_id,actor_id,outcome,snapshot)
   values(h.id,p_tenant,p_request,auth.uid(),case when p_action='handoff' then 'ongoing' else 'stopped' end,snapshot);
  if p_action='handoff' then
   for m in select * from public.slack_history_campaign_channels where campaign_id=h.id order by account_id loop
    -- Existing subscription controls own their validation/audit/identity checks.
    -- They run in this same transaction, so any failure rolls back the whole handoff.
    select revision into recurring_revision from public.slack_recurring_channels where account_id=m.account_id for update;
    recurring_revision:=coalesce(recurring_revision,0);
    select * into a from public.connector_accounts where id=m.account_id and tenant_id=p_tenant for update;
    if not found or a.settings->'slack_history'->>'campaignId' is distinct from h.id::text
     or a.settings->'slack_history'->>'consentReference' is distinct from 'learn-slack-import:'||m.current_import::text then
     raise exception 'slack_campaign_scope_changed' using errcode='55000';end if;
    update public.connector_accounts set settings=jsonb_set(settings,'{slack_history}',(settings->'slack_history')-'campaignId') where id=a.id;
    subscription:=public.learn_slack_recurring_control(p_tenant,gen_random_uuid(),a.id,recurring_revision,true,btrim(p_reason));
    subscription:=public.learn_slack_recurring_threads_control(p_tenant,gen_random_uuid(),a.id,(subscription->>'revision')::bigint,true,btrim(p_reason));
    channels:=channels||jsonb_build_array(jsonb_build_object('accountId',a.id,'revision',subscription->'revision','start',h.ends_at,'includeThreads',true));
   end loop;
  end if;
  -- Stopping leaves saved bindings/checkpoints intact. In-flight requests may
  -- finish transport, but their publication is fenced; no new dispatch is allowed.
  r:=r||jsonb_build_object('state','recorded','campaignId',h.id,'revision',h.revision,'lifecycle',case when p_action='handoff' then 'ongoing' else 'stopped' end,
    'subscriptions',channels,'historicalCoverage',snapshot->'coverage','historicalComplete',snapshot->'complete');
 end if;
 insert into public.slack_history_campaign_requests values(p_request,p_tenant,auth.uid(),d,r,clock_timestamp());
 return r;
end$$;
revoke all on function public.learn_slack_campaign_close(uuid,uuid,uuid,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_close(uuid,uuid,uuid,bigint,text,text,text) to authenticated;
commit;
