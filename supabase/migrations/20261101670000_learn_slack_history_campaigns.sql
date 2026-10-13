-- Durable, explicitly authorised public-channel historical campaigns. Applying
-- this migration creates no campaign, job, credential, schedule or provider read.
-- Thread coverage is deliberately unresolved until the thread traversal exists.
begin;
create table public.slack_history_campaigns (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null references public.provider_connections(id),
 connection_revision timestamptz not null, team_id text not null check(team_id ~ '^T[A-Z0-9]+$'),
 approved_by uuid not null references public.profiles(id), definition jsonb not null,
 starts_at timestamptz not null, ends_at timestamptz not null, expires_at timestamptz not null,
 request_budget integer not null check(request_budget between 9 and 1000000),
 requests_reserved integer not null default 0 check(requests_reserved>=0 and requests_reserved<=request_budget),
 enabled boolean not null default true, revision bigint not null default 1,
 created_at timestamptz not null default clock_timestamp(),
 check(isfinite(starts_at) and isfinite(ends_at) and starts_at>='epoch'::timestamptz and ends_at>starts_at),
 check(isfinite(expires_at)), unique(id,tenant_id)
);
create table public.slack_history_campaign_channels (
 campaign_id uuid not null, tenant_id uuid not null, account_id uuid not null references public.connector_accounts(id),
 channel_id text not null check(channel_id ~ '^C[A-Z0-9]+$'),
 current_import uuid not null references public.slack_history_imports(id),
 state text not null default 'queued', next_check_at timestamptz not null default clock_timestamp(),
 primary key(campaign_id,account_id), unique(campaign_id,channel_id),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id)
);
create index slack_campaign_channels_due on public.slack_history_campaign_channels(next_check_at,campaign_id,account_id);
create table public.slack_history_campaign_requests (
 id uuid primary key, tenant_id uuid not null references public.tenants(id), actor_id uuid not null references public.profiles(id),
 definition jsonb not null, receipt jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table public.slack_history_campaign_dispatches (
 campaign_id uuid not null, tenant_id uuid not null,
 job_id uuid not null references public.platform_jobs(id), attempt integer not null check(attempt>0),
 ordinal integer not null check(ordinal between 1 and 9), created_at timestamptz not null default clock_timestamp(),
 primary key(job_id,attempt,ordinal),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id)
);
do $$declare tab text;begin
 foreach tab in array array['slack_history_campaigns','slack_history_campaign_channels','slack_history_campaign_requests','slack_history_campaign_dispatches'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
  execute format('create trigger slack_campaign_retain before delete on public.%I for each row execute function public.slack_version_immutable()',tab);
  execute format('create trigger slack_campaign_retain_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',tab);
 end loop;
 foreach tab in array array['slack_history_campaign_requests','slack_history_campaign_dispatches'] loop
  execute format('create trigger slack_campaign_immutable before update on public.%I for each row execute function public.slack_version_immutable()',tab);
 end loop;
end$$;
create function public.learn_slack_campaign_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_table_name='slack_history_campaigns' then
  if to_jsonb(old)-array['requests_reserved','enabled','revision'] is distinct from to_jsonb(new)-array['requests_reserved','enabled','revision']
   or new.requests_reserved<old.requests_reserved or new.revision<old.revision then raise exception 'Campaign approval is immutable' using errcode='55000';end if;
 else
  if to_jsonb(old)-array['current_import','state','next_check_at'] is distinct from to_jsonb(new)-array['current_import','state','next_check_at'] then
   raise exception 'Campaign channel identity is immutable' using errcode='55000';end if;
 end if;
 return new;
end$$;
revoke all on function public.learn_slack_campaign_immutable() from public,anon,authenticated,service_role;
create trigger slack_campaign_approval_immutable before update on public.slack_history_campaigns for each row execute function public.learn_slack_campaign_immutable();
create trigger slack_campaign_channel_immutable before update on public.slack_history_campaign_channels for each row execute function public.learn_slack_campaign_immutable();

create function public.learn_slack_campaign_authority(p_campaign uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select coalesce(exists(select 1 from public.slack_history_campaigns h
 join public.provider_connections c on c.id=h.connection_id and c.tenant_id=h.tenant_id
 join public.profiles p on p.id=h.approved_by
 where h.id=p_campaign and h.enabled and h.expires_at>clock_timestamp()
 and c.provider='slack' and c.status='configured' and c.revoked_at is null and c.updated_at=h.connection_revision
 and c.non_secret_config->>'team_id'=h.team_id
 and public.learn_slack_credential_field(c.non_secret_config)=any(c.configured_fields)
 and c.secret_refs->>public.learn_slack_credential_field(c.non_secret_config) is not null
 and public.learn_capture_allowed(h.tenant_id,'slack')
 and ((p.tenant_id=h.tenant_id and p.role in ('owner','admin')) or exists(select 1 from public.platform_authority_grants g
 where g.profile_id=p.id and g.permission='platform.controlplane.admin'
 and coalesce(g.effective_from,'-infinity')<=clock_timestamp() and coalesce(g.effective_to,'infinity')>clock_timestamp()))),false);
$$;
revoke all on function public.learn_slack_campaign_authority(uuid) from public,anon,authenticated,service_role;

-- Legacy windows retain their existing checks. A campaign binding must also
-- match its frozen channel, source window, current approval and credential.
create function public.learn_slack_campaign_job_allowed(p_tenant uuid,p_job uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cfg jsonb;h public.slack_history_campaigns%rowtype;begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant and job_type in ('slack.history_sync','slack.thread_sync');
 if not found then return false;end if;
 select * into a from public.connector_accounts where id::text=j.payload->>'connector_account_id' and tenant_id=p_tenant;
 if not found then return false;end if;
 cfg:=a.settings->'slack_history';
 if not coalesce(cfg ? 'campaignId',false) then return true;end if;
 -- Campaign thread traversal will supply its own scoped approval/member contract.
 -- Do not borrow a channel campaign to authorise a manual or unrelated reply job.
 if j.job_type<>'slack.history_sync' then return false;end if;
 select * into h from public.slack_history_campaigns where id::text=cfg->>'campaignId' and tenant_id=p_tenant;
 if not found or not public.learn_slack_campaign_authority(h.id) then return false;end if;
 return coalesce(a.status='active' and cfg->'approved'='true'::jsonb and cfg->>'teamId'=h.team_id
 and cfg->>'connectionId'=h.connection_id::text
 and (cfg->>'oldest')::numeric=extract(epoch from h.starts_at) and (cfg->>'latest')::numeric=extract(epoch from h.ends_at)
 and exists(select 1 from public.slack_history_campaign_channels m join public.slack_history_imports i on i.id=m.current_import
 where m.campaign_id=h.id and m.tenant_id=p_tenant and m.account_id=a.id and m.channel_id=cfg->>'channelId'
 and cfg->>'consentReference'='learn-slack-import:'||i.id::text and i.tenant_id=p_tenant and i.account_id=a.id)
 and exists(select 1 from public.tenant_connectors tc where tc.id=a.tenant_connector_id and tc.tenant_id=p_tenant
 and tc.connector_id='slack' and tc.enabled and tc.status='active'),false);
end$$;
revoke all on function public.learn_slack_campaign_job_allowed(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_job_allowed(uuid,uuid) to service_role;

create function public.learn_slack_campaign_claim_allowed(p_tenant uuid,p_job uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select public.learn_slack_campaign_job_allowed(p_tenant,p_job) and not exists(
  select 1 from public.platform_jobs j join public.connector_accounts a on a.id::text=j.payload->>'connector_account_id' and a.tenant_id=j.tenant_id
  join public.slack_history_campaigns h on h.id::text=a.settings->'slack_history'->>'campaignId' and h.tenant_id=a.tenant_id
  where j.id=p_job and j.tenant_id=p_tenant and h.requests_reserved>=h.request_budget);
$$;
revoke all on function public.learn_slack_campaign_claim_allowed(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_claim_allowed(uuid,uuid) to service_role;

-- One reservation per actual provider dispatch, including auth/info/retries.
-- A lost acknowledgement can consume budget without a request: never refund or
-- reuse it on uncertainty. Re-acquiring a lease cannot reset its nine-request cap.
create function public.learn_slack_campaign_reserve_request(p_tenant uuid,p_job uuid,p_claimed_by text,p_attempt integer,p_ordinal integer)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;h public.slack_history_campaigns%rowtype;campaign text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_campaign_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_ordinal is null or p_ordinal not between 1 and 9 then
  raise exception 'slack_campaign_request_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_claimed_by or p_claimed_by is null
 or j.attempt_count is distinct from p_attempt or p_attempt is null or j.lease_expires_at is null
 or j.lease_expires_at<=clock_timestamp() or coalesce(j.metadata,'{}') ? 'slack_page_v1'
 or not public.learn_slack_campaign_job_allowed(p_tenant,p_job) then return false;end if;
 select a.settings->'slack_history'->>'campaignId' into campaign from public.connector_accounts a
 where a.id::text=j.payload->>'connector_account_id' and a.tenant_id=p_tenant;
 if campaign is null then return true;end if;
 select * into h from public.slack_history_campaigns where id::text=campaign and tenant_id=p_tenant for update;
 if not found or h.requests_reserved>=h.request_budget or not public.learn_slack_campaign_authority(h.id) then return false;end if;
 if exists(select 1 from public.slack_history_campaign_dispatches where job_id=p_job and attempt=p_attempt and ordinal=p_ordinal) then return false;end if;
 insert into public.slack_history_campaign_dispatches(campaign_id,tenant_id,job_id,attempt,ordinal) values(h.id,p_tenant,p_job,p_attempt,p_ordinal);
 update public.slack_history_campaigns set requests_reserved=requests_reserved+1 where id=h.id;
 return true;
end$$;
revoke all on function public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer) to service_role;

create function public.learn_slack_campaign_start(p_tenant uuid,p_request uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.slack_history_campaign_requests%rowtype;c public.provider_connections%rowtype;channel text;
 starts timestamptz;ends timestamptz;expires timestamptz;budget integer;r jsonb;answer jsonb;begin
 perform public.learn_slack_control_access(p_tenant,true,'start_history');
 if current_setting('transaction_isolation')<>'read committed' or p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
 or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>100000
 or not(p_definition ?& array['connectionId','connectionRevision','channelIds','start','end','expiresAt','requestBudget','reason'])
 or p_definition-array['connectionId','connectionRevision','channelIds','start','end','expiresAt','requestBudget','reason']<>'{}'
 or jsonb_typeof(p_definition->'channelIds') is distinct from 'array'
 or jsonb_array_length(p_definition->'channelIds') not between 1 and 500
 or exists(select 1 from jsonb_array_elements(p_definition->'channelIds') v where jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^C[A-Z0-9]{1,99}$')
 or (select count(*)<>count(distinct v) from jsonb_array_elements(p_definition->'channelIds') v)
 or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
 or jsonb_typeof(p_definition->'requestBudget') is distinct from 'number' or p_definition->>'requestBudget' !~ '^[0-9]+$' then
  raise exception 'slack_campaign_definition_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-campaign-request:'||p_request::text,0));
 select * into prior from public.slack_history_campaign_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>auth.uid() or prior.definition<>p_definition then raise exception 'slack_campaign_request_changed' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return answer;end if;
 if p_mode='cancel' then
  insert into public.slack_history_campaign_requests values(p_request,p_tenant,auth.uid(),p_definition,answer,clock_timestamp());return answer;
 end if;
 starts:=(p_definition->>'start')::timestamptz;ends:=(p_definition->>'end')::timestamptz;expires:=(p_definition->>'expiresAt')::timestamptz;
 budget:=(p_definition->>'requestBudget')::integer;
 if starts is null or ends is null or expires is null or not isfinite(starts) or not isfinite(ends) or not isfinite(expires)
 or starts<'epoch'::timestamptz or ends<=starts or ends>clock_timestamp() or expires<=clock_timestamp()
 or expires>clock_timestamp()+interval '30 days' or budget not between 9 and 1000000 then raise exception 'slack_campaign_bounds_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant::text,0));
 select * into c from public.provider_connections where id=(p_definition->>'connectionId')::uuid and tenant_id=p_tenant for share;
 if not found or c.updated_at is distinct from (p_definition->>'connectionRevision')::timestamptz or c.provider<>'slack'
 or c.status<>'configured' or c.revoked_at is not null then raise exception 'slack_campaign_connection_changed' using errcode='PT409';end if;
 insert into public.slack_history_campaigns(id,tenant_id,connection_id,connection_revision,team_id,approved_by,definition,starts_at,ends_at,expires_at,request_budget)
 values(p_request,p_tenant,c.id,c.updated_at,c.non_secret_config->>'team_id',auth.uid(),p_definition,starts,ends,expires,budget);
 -- Existing logged setup is called as the real authenticated actor. No service
 -- impersonation, new grant, credential or relaxed setup predicate is involved.
 for channel in select jsonb_array_elements_text(p_definition->'channelIds') order by 1 loop
  if exists(select 1 from public.connector_accounts a where a.tenant_id=p_tenant
   and a.account_key=(c.non_secret_config->>'team_id')||':'||channel
   and (exists(select 1 from public.slack_recurring_channels sub where sub.account_id=a.id and sub.enabled)
    or exists(select 1 from public.platform_jobs j where j.tenant_id=p_tenant and j.payload->>'connector_account_id'=a.id::text
     and j.job_type='slack.thread_sync' and j.status in ('queued','retrying','running')))) then
   raise exception 'slack_campaign_competing_capture' using errcode='55000';end if;
  r:=public.learn_slack_start_import(p_tenant,gen_random_uuid(),c.id,c.updated_at::text,channel,starts,ends,10,p_definition->>'reason');
  insert into public.slack_history_campaign_channels(campaign_id,tenant_id,account_id,channel_id,current_import)
   values(p_request,p_tenant,(r->>'accountId')::uuid,channel,(r->>'requestId')::uuid);
  update public.platform_jobs set payload=payload||jsonb_build_object('campaign_id',p_request,'campaign_revision',1) where id=(r->>'jobId')::uuid and tenant_id=p_tenant;
  update public.connector_accounts set settings=jsonb_set(settings,'{slack_history}',settings->'slack_history'||
   jsonb_build_object('campaignId',p_request,'expiresAt',least(expires,clock_timestamp()+interval '24 hours')))
   where id=(r->>'accountId')::uuid and tenant_id=p_tenant;
 end loop;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'state','recorded','campaignId',p_request,'revision',1);
 insert into public.slack_history_campaign_requests values(p_request,p_tenant,auth.uid(),p_definition,answer,clock_timestamp());
 return answer;
end$$;
revoke all on function public.learn_slack_campaign_start(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_start(uuid,uuid,jsonb,text) to authenticated;

create function public.learn_slack_campaign_control(p_tenant uuid,p_request uuid,p_campaign uuid,p_revision bigint,p_enabled boolean,p_reason text,p_mode text default 'apply') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.slack_history_campaign_requests%rowtype;h public.slack_history_campaigns%rowtype;d jsonb;r jsonb;begin
 perform public.learn_slack_control_access(p_tenant,true,'resume_history');
 if current_setting('transaction_isolation')<>'read committed' or p_request is null or p_campaign is null or p_revision is null or p_revision<1
 or p_enabled is null or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or p_mode is null or p_mode not in ('apply','check','cancel') then
 raise exception 'slack_campaign_control_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 perform public.learn_slack_control_access(p_tenant,true,'resume_history');
 d:=jsonb_build_object('campaignId',p_campaign,'revision',p_revision,'enabled',p_enabled,'reason',btrim(p_reason));
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
  if p_enabled and (h.expires_at<=clock_timestamp() or h.requests_reserved>=h.request_budget) then raise exception 'slack_campaign_approval_exhausted' using errcode='55000';end if;
  update public.slack_history_campaigns set enabled=p_enabled,revision=revision+1 where id=h.id returning * into h;
  if p_enabled and not public.learn_slack_campaign_authority(h.id) then raise exception 'slack_campaign_approval_changed' using errcode='55000';end if;
  update public.slack_history_campaign_channels set next_check_at=clock_timestamp() where campaign_id=h.id;
  r:=r||jsonb_build_object('state','recorded','campaignId',h.id,'revision',h.revision,'enabled',h.enabled);
 end if;
 insert into public.slack_history_campaign_requests values(p_request,p_tenant,auth.uid(),d,r,clock_timestamp());return r;
end$$;
revoke all on function public.learn_slack_campaign_control(uuid,uuid,uuid,bigint,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_control(uuid,uuid,uuid,bigint,boolean,text,text) to authenticated;

create function public.learn_slack_campaign_attribution_allowed(p_table text,r jsonb) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select coalesce(auth.role()='service_role' and p_table='slack_history_imports' and exists(
 select 1 from public.slack_history_campaigns h
 join public.slack_history_campaign_channels m on m.campaign_id=h.id and m.tenant_id=h.tenant_id
 join public.connector_accounts a on a.id=m.account_id and a.tenant_id=h.tenant_id
 join public.platform_jobs j on j.id=(r->>'job_id')::uuid and j.tenant_id=h.tenant_id
 where h.id::text=r->'definition'->>'campaignId' and h.tenant_id::text=r->>'tenant_id'
 and public.learn_slack_campaign_authority(h.id) and h.approved_by::text=r->>'approved_by'
 and a.id::text=r->>'account_id' and r->'definition'->>'resumesImportId'=m.current_import::text
 and r->'definition'->>'connectionId'=h.connection_id::text
 and (r->'definition'->>'connectionRevision')::timestamptz=h.connection_revision
 and (r->'definition'->>'start')::timestamptz=h.starts_at and (r->'definition'->>'end')::timestamptz=h.ends_at
 and r->'definition'->>'channelId'=m.channel_id and r->'definition'->'maxPages'='10'::jsonb
 and a.settings->'slack_history'->>'consentReference'='learn-slack-import:'||(r->>'id')
 and a.settings->'slack_history'->>'campaignId'=h.id::text
 and j.job_type='slack.history_sync' and j.status='queued' and j.created_by=h.approved_by
 and j.payload->>'connector_account_id'=a.id::text and j.payload->>'history_import_id'=r->>'id'),false);
$$;
revoke all on function public.learn_slack_campaign_attribution_allowed(text,jsonb) from public,anon,authenticated,service_role;

do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_reference_guard()'::regprocedure);
 needle:='   if auth.role() is distinct from ''authenticated'' or auth.uid() is null';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign attribution guard differs';end if;
 execute replace(d,needle,'   if tg_op=''INSERT'' and public.learn_slack_campaign_attribution_allowed(tg_table_name,j) then continue;end if;'||chr(10)||needle);
end$$;

create function public.learn_slack_schedule_campaigns(p_batch integer default 10) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare m public.slack_history_campaign_channels%rowtype;h public.slack_history_campaigns%rowtype;a public.connector_accounts%rowtype;
 state jsonb;cfg jsonb;cp jsonb;scope jsonb;checkpoint jsonb;request_id uuid;job_id uuid;reason text;status text;
 checked integer:=0;queued integer:=0;held integer:=0;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_campaign_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_batch is null or p_batch not between 1 and 50 then raise exception 'slack_campaign_batch_invalid' using errcode='22023';end if;
 for m in select c.* from public.slack_history_campaign_channels c join public.slack_history_campaigns header on header.id=c.campaign_id
 where header.enabled and c.next_check_at<=clock_timestamp() and c.state<>'history_captured_threads_pending'
 order by c.next_check_at,c.campaign_id,c.account_id limit p_batch loop
  -- Same order as manual setup/control. Never wait with locks from other tenants.
  if not pg_try_advisory_xact_lock(hashtextextended('learn-slack-setup:'||m.tenant_id::text,0)) then continue;end if;
  select * into h from public.slack_history_campaigns where id=m.campaign_id and enabled for update;
  if not found then continue;end if;
  select * into m from public.slack_history_campaign_channels where campaign_id=m.campaign_id and account_id=m.account_id and next_check_at<=clock_timestamp() for update;
  if not found then continue;end if;
  checked:=checked+1;status:='ready';
  if h.requests_reserved>=h.request_budget then status:='request_budget_exhausted';
  elsif h.expires_at<=clock_timestamp() then status:='approval_expired';
  elsif not public.learn_slack_campaign_authority(h.id) then status:='authority_or_capture_unavailable';end if;
  select * into a from public.connector_accounts where id=m.account_id and tenant_id=m.tenant_id for update;
  if not found then status:='account_unavailable';end if;
  cfg:=a.settings->'slack_history';cp:=a.sync_cursor;
  if status='ready' and (cfg->>'campaignId' is distinct from h.id::text or cfg->>'consentReference' is distinct from 'learn-slack-import:'||m.current_import::text
   or cfg->>'channelId' is distinct from m.channel_id or cfg->>'connectionId' is distinct from h.connection_id::text) then status:='scope_changed';end if;
  if status='ready' then
   state:=public.learn_slack_history_state(m.tenant_id,m.account_id);
   if state->'stateValid' is distinct from 'true'::jsonb or state->'connectionReady' is distinct from 'true'::jsonb then status:='stored_state_unavailable';
   elsif state->'active'='true'::jsonb then status:='window_active';
   elsif cp->'complete'='true'::jsonb then
    if exists(select 1 from public.platform_jobs j where j.tenant_id=m.tenant_id and j.job_type='slack.history_sync' and j.status='succeeded'
     and j.payload->>'connector_account_id'=m.account_id::text and j.metadata->'slack_page_v1'->'next'=cp
     and j.metadata->'slack_page_v1'->>'account_id'=m.account_id::text) then status:='history_captured_threads_pending';
    else status:='completion_unverified';end if;
   elsif not (coalesce(((cp->>'pages')::integer>=(cfg->>'maxPages')::integer and exists(
     select 1 from public.platform_jobs published where published.tenant_id=m.tenant_id and published.job_type='slack.history_sync'
     and published.status='succeeded' and published.payload->>'connector_account_id'=m.account_id::text
     and published.metadata->'slack_page_v1'->'next'=cp
     and published.metadata->'slack_page_v1'->>'account_id'=m.account_id::text)),false)
    or exists(select 1 from public.platform_jobs interrupted where interrupted.id::text=state->'latestJob'->>'id'
     and interrupted.tenant_id=m.tenant_id and interrupted.status in ('failed','dead_letter')
     and interrupted.payload->>'campaign_id'=h.id::text and (interrupted.payload->>'campaign_revision')::bigint<h.revision
     and interrupted.error_code in ('slack_history_campaign_request_unavailable','slack_history_campaign_request_unconfirmed',
       'slack_history_binding_unavailable','slack_history_authority_unavailable'))
    or coalesce(((cfg->>'expiresAt')::timestamptz<=clock_timestamp() and state->'latestJob'->>'status' in ('failed','dead_letter')
     and state->'latestJob'->>'errorCode' in ('slack_history_binding_unavailable','slack_history_authority_unavailable')),false)) then status:='needs_review';
   elsif cp<>'{}'::jsonb and cp->>'cursor' is null and cp->'pages'<>'0'::jsonb then status:='cursor_unavailable';
   else
    request_id:=gen_random_uuid();job_id:=gen_random_uuid();reason:='Continue the recorded historical campaign from its saved cursor';
    scope:=cfg||jsonb_build_object('approved',true,'maxPages',10,'expiresAt',least(h.expires_at,clock_timestamp()+interval '24 hours'),
     'consentReference','learn-slack-import:'||request_id::text);
    checkpoint:=jsonb_build_object('scopeKey',array_to_json(array[m.tenant_id::text,h.team_id,m.channel_id,scope->>'oldest',scope->>'latest',scope->>'consentReference'])::text,
     'cursor',cp->>'cursor','pages',0,'complete',false);
    update public.connector_accounts set settings=settings||jsonb_build_object('slack_history',scope),sync_cursor=checkpoint where id=a.id;
    insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
     values(job_id,m.tenant_id,'slack','slack.history_sync','slack.history:'||a.id::text,'queued',5,clock_timestamp(),
      jsonb_build_object('connector_account_id',a.id,'history_import_id',request_id,'campaign_id',h.id,'campaign_revision',h.revision),h.approved_by);
    insert into public.slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition,previous_state)
     values(request_id,m.tenant_id,a.id,job_id,h.approved_by,jsonb_build_object('campaignId',h.id,'connectionId',h.connection_id,
      'connectionRevision',h.connection_revision,'channelId',m.channel_id,'start',h.starts_at,'end',h.ends_at,'maxPages',10,
      'reason',reason,'resumesImportId',m.current_import),jsonb_build_object('settings',cfg,'checkpoint',cp));
    update public.slack_history_campaign_channels set current_import=request_id where campaign_id=h.id and account_id=a.id;
    queued:=queued+1;status:='window_queued';
   end if;
  end if;
  if status not in ('window_active','window_queued','history_captured_threads_pending') then held:=held+1;end if;
  update public.slack_history_campaign_channels set state=status,next_check_at=clock_timestamp()+interval '60 seconds' where campaign_id=h.id and account_id=m.account_id;
 end loop;
 return jsonb_build_object('checked',checked,'queued',queued,'held',held);
end$$;
revoke all on function public.learn_slack_schedule_campaigns(integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_schedule_campaigns(integer) to service_role;

create function public.learn_slack_campaign_read(p_tenant uuid,p_campaign uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare h public.slack_history_campaigns%rowtype;rows jsonb;begin
 perform public.learn_slack_control_access(p_tenant,false,'history');
 select * into h from public.slack_history_campaigns where id=p_campaign and tenant_id=p_tenant;
 if not found then raise exception 'slack_campaign_unavailable' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('accountId',m.account_id,'channelId',m.channel_id,'approvalId',m.current_import,
 'state',m.state,'pagesThisApproval',a.sync_cursor->'pages','channelPagesComplete',coalesce(a.sync_cursor->'complete','false'::jsonb)) order by m.channel_id),'[]'::jsonb)
 into rows from public.slack_history_campaign_channels m join public.connector_accounts a on a.id=m.account_id and a.tenant_id=m.tenant_id where m.campaign_id=h.id;
 return jsonb_build_object('version','learn-slack-campaign/1','tenantId',p_tenant,'campaignId',h.id,'revision',h.revision,
 'enabled',h.enabled,'start',h.starts_at,'end',h.ends_at,'expiresAt',h.expires_at,'requestBudget',h.request_budget,
 'requestsReserved',h.requests_reserved,'requestAccounting','conservative_dispatch_reservations',
 'threadsComplete',false,'complete',false,'channels',rows);
end$$;
revoke all on function public.learn_slack_campaign_read(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_read(uuid,uuid) to authenticated;

-- Stop competing manual windows from replacing a durable campaign's scope.
-- Pause and credential revocation remain available; they never discard history.
do $$declare d text;needle text;name text;sig regprocedure;begin
 d:=pg_get_functiondef('public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)'::regprocedure);
 needle:='  if a.status<>''active'' or exists';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign setup fence differs';end if;
 execute replace(d,needle,'  if a.settings->''slack_history'' ? ''campaignId'' then raise exception ''slack_campaign_scope_owned'' using errcode=''55000'';end if;'||chr(10)||needle);
 foreach name in array array['learn_slack_resume_history','learn_slack_start_thread_import'] loop
  select oid::regprocedure into strict sig from pg_proc where pronamespace='public'::regnamespace and proname=name;
  d:=pg_get_functiondef(sig);
  needle:=case when name='learn_slack_resume_history' then ' perform pg_advisory_xact_lock(hashtextextended(''learn-slack-setup:'''
   else ' select * into a from public.connector_accounts' end;
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign manual recovery fence differs';end if;
  execute replace(d,needle,' if exists(select 1 from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id and settings->''slack_history'' ? ''campaignId'') then raise exception ''slack_campaign_scope_owned'' using errcode=''55000'';end if;'||chr(10)||needle);
 end loop;
 d:=pg_get_functiondef('public.learn_slack_resume_thread(uuid,uuid,uuid,text,text,integer,text)'::regprocedure);
 needle:=' state:=public.learn_slack_thread_recovery_state(p_tenant_id,p_import_id);key:=state->>''jobKey'';';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign thread recovery fence differs';end if;
 execute replace(d,needle,' if exists(select 1 from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id and settings->''slack_history'' ? ''campaignId'') then raise exception ''slack_campaign_scope_owned'' using errcode=''55000'';end if;'||chr(10)||needle);
 d:=pg_get_functiondef('public.learn_slack_recurring_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid)'::regprocedure);
 needle:=' if p_enabled then';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign recurring fence differs';end if;
 execute replace(d,needle,' if p_enabled and a.settings->''slack_history'' ? ''campaignId'' then raise exception ''slack_campaign_scope_owned'' using errcode=''55000'';end if;'||chr(10)||needle);
 -- Claim filtering avoids consuming attempts while paused/revoked. A retained
 -- committed receipt may always settle without another provider dispatch.
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 needle:='and public.learn_capture_job_allowed(q.tenant_id,q.job_type,q.metadata)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign claim scan differs';end if;
 d:=replace(d,needle,needle||chr(10)||'  and (coalesce(q.metadata,''{}'') ? ''slack_page_v1'' or public.learn_slack_campaign_claim_allowed(q.tenant_id,q.id))');
 needle:='if not public.learn_capture_job_allowed(j.tenant_id,j.job_type,j.metadata) then continue;end if;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign locked claim differs';end if;
 execute replace(d,needle,needle||chr(10)||'  if not(coalesce(j.metadata,''{}'') ? ''slack_page_v1'') and not public.learn_slack_campaign_claim_allowed(j.tenant_id,j.id) then continue;end if;');
 foreach name in array array['learn_slack_read_credential','learn_slack_read_thread_credential'] loop
  select oid::regprocedure into strict sig from pg_proc where pronamespace='public'::regnamespace and proname=name;
  d:=pg_get_functiondef(sig);needle:=' select decrypted_secret into secret';
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign credential fence differs';end if;
  execute replace(d,needle,' if not public.learn_slack_campaign_job_allowed(p_tenant_id,p_job_id) then return null;end if;'||chr(10)||needle);
 end loop;
 foreach name in array array['learn_slack_commit_page_private','slack_thread_commit_page'] loop
  select oid::regprocedure into strict sig from pg_proc where pronamespace='public'::regnamespace and proname=name;
  d:=pg_get_functiondef(sig);needle:=' perform public.learn_slack_store_records(';
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign publication fence differs';end if;
  execute replace(d,needle,' if not public.learn_slack_campaign_job_allowed(p_tenant_id,p_job_id) then raise exception ''slack_history_authority_unavailable'' using errcode=''42501'';end if;'||chr(10)||needle);
 end loop;
end$$;
commit;
