-- Inactive durable hints for signed, exact-roster public Slack Events.
-- This does not subscribe to Slack, fetch provider data, or publish evidence.
-- Only a separately verified receiver may call the service-only recorder.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.learn_slack_event_hints (
  tenant_id uuid not null references public.tenants(id),
  event_id text not null check(event_id ~ '^Ev[A-Za-z0-9]{4,100}$'),
  account_id uuid not null references public.slack_recurring_channels(account_id),
  connection_id uuid not null references public.provider_connections(id),
  team_id text not null check(team_id ~ '^T[A-Z0-9]{1,63}$'),
  channel_id text not null check(channel_id ~ '^C[A-Z0-9]{1,63}$'),
  hint_kind text not null check(hint_kind in ('message_hint','correction_hint')),
  event_ts text not null check(event_ts ~ '^[0-9]{10,12}\.[0-9]{1,6}$'),
  source_ts text not null check(source_ts ~ '^[0-9]{10,12}\.[0-9]{1,6}$'),
  thread_ts text check(thread_ts is null or thread_ts ~ '^[0-9]{10,12}\.[0-9]{1,6}$'),
  correction text check(correction is null or correction in ('changed','deleted')),
  state text not null default 'pending' check(state in ('pending','reconciling','settled','held')),
  received_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,event_id),
  check((hint_kind='message_hint' and correction is null and source_ts=event_ts)
    or (hint_kind='correction_hint' and correction is not null)),
  check(isfinite(received_at))
);
create index learn_slack_event_hints_pending_idx
  on public.learn_slack_event_hints(tenant_id,received_at,event_id) where state='pending';
alter table public.learn_slack_event_hints enable row level security;
revoke all on public.learn_slack_event_hints from public,anon,authenticated,service_role;

create function public.learn_slack_event_record(
  p_tenant uuid,p_team text,p_event_id text,p_channel text,p_kind text,
  p_event_ts text,p_source_ts text,p_thread_ts text,p_correction text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.slack_recurring_channels%rowtype;
 a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 existing public.learn_slack_event_hints%rowtype; cfg jsonb;
 event_at timestamptz; source_at timestamptz;
begin
 if auth.role() is distinct from 'service_role'
  then raise exception 'slack_event_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_team is null or p_team !~ '^T[A-Z0-9]{1,63}$'
  or p_event_id is null or p_event_id !~ '^Ev[A-Za-z0-9]{4,100}$'
  or p_channel is null or p_channel !~ '^C[A-Z0-9]{1,63}$'
  or p_kind is null or p_kind not in('message_hint','correction_hint')
  or p_event_ts is null or p_event_ts !~ '^[0-9]{10,12}\.[0-9]{1,6}$'
  or p_source_ts is null or p_source_ts !~ '^[0-9]{10,12}\.[0-9]{1,6}$'
  or (p_thread_ts is not null and p_thread_ts !~ '^[0-9]{10,12}\.[0-9]{1,6}$')
  or (p_kind='message_hint' and (p_correction is not null or p_source_ts<>p_event_ts))
  or (p_kind='correction_hint' and p_correction not in('changed','deleted'))
 then raise exception 'slack_event_invalid' using errcode='22023';end if;
 event_at:=to_timestamp(p_event_ts::double precision);
 source_at:=to_timestamp(p_source_ts::double precision);
 if not isfinite(event_at) or not isfinite(source_at)
  or source_at>event_at or event_at>clock_timestamp()+interval '5 minutes'
 then raise exception 'slack_event_invalid_time' using errcode='22023';end if;

 -- Current approval, capture, account and credential bindings are checked in
 -- the same transaction that records a hint; an Edge roster cache is not an
 -- authority for publication. Ambiguous duplicate subscriptions fail closed.
 select * into s from public.slack_recurring_channels
  where tenant_id=p_tenant and team_id=p_team and channel_id=p_channel and enabled
  order by account_id limit 1 for share;
 if not found then return jsonb_build_object('version','learn-slack-event-hint/1',
   'state','excluded','eventId',p_event_id);end if;
 if exists(select 1 from public.slack_recurring_channels x where x.tenant_id=p_tenant
   and x.team_id=p_team and x.channel_id=p_channel and x.enabled and x.account_id<>s.account_id)
  or event_at<s.next_start
  or not public.learn_capture_allowed(p_tenant,'slack')
  or not exists(select 1 from public.profiles p where p.id=s.approved_by and
    ((p.tenant_id=s.tenant_id and p.role in('owner','admin')) or exists(
      select 1 from public.platform_authority_grants g where g.profile_id=p.id
       and g.permission='platform.controlplane.admin'
       and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
       and coalesce(g.effective_to,'infinity')>clock_timestamp()))
    and not exists(select 1 from public.view_as_context v
      where v.actor_user_id=p.id and v.ended_at is null
       and (v.expires_at is null or v.expires_at>clock_timestamp())))
 then return jsonb_build_object('version','learn-slack-event-hint/1',
   'state','excluded','eventId',p_event_id);end if;
 select * into a from public.connector_accounts
  where id=s.account_id and tenant_id=p_tenant for share;
 if not found or a.status is distinct from 'active'
  then return jsonb_build_object('version','learn-slack-event-hint/1',
    'state','excluded','eventId',p_event_id);end if;
 cfg:=a.settings->'slack_history';
 select * into c from public.provider_connections
  where id=s.connection_id and tenant_id=p_tenant for share;
 if not found or c.provider is distinct from 'slack'
  or c.status is distinct from 'configured' or c.revoked_at is not null
  or c.updated_at is distinct from s.connection_revision
  or c.non_secret_config->>'team_id' is distinct from p_team
  or public.learn_slack_credential_field(c.non_secret_config) is null
  or not (public.learn_slack_credential_field(c.non_secret_config)=any(c.configured_fields))
  or c.secret_refs->>public.learn_slack_credential_field(c.non_secret_config) is null
  or cfg->>'connectionId' is distinct from c.id::text
  or cfg->>'teamId' is distinct from p_team
  or cfg->>'channelId' is distinct from p_channel
  or cfg->'approved' is distinct from 'true'::jsonb
  or not exists(select 1 from public.tenant_connectors tc
    where tc.id=a.tenant_connector_id and tc.tenant_id=p_tenant
      and tc.connector_id='slack' and tc.enabled and tc.status='active')
 then return jsonb_build_object('version','learn-slack-event-hint/1',
   'state','excluded','eventId',p_event_id);end if;

 perform pg_advisory_xact_lock(hashtextextended('learn-slack-event:'||p_tenant::text||':'||p_event_id,0));
 select * into existing from public.learn_slack_event_hints
  where tenant_id=p_tenant and event_id=p_event_id for update;
 if found then
  if existing.account_id is distinct from s.account_id
   or existing.connection_id is distinct from c.id
   or existing.team_id is distinct from p_team
   or existing.channel_id is distinct from p_channel
   or existing.hint_kind is distinct from p_kind
   or existing.event_ts is distinct from p_event_ts
   or existing.source_ts is distinct from p_source_ts
   or existing.thread_ts is distinct from p_thread_ts
   or existing.correction is distinct from p_correction
  then raise exception 'slack_event_id_changed' using errcode='40001';end if;
  return jsonb_build_object('version','learn-slack-event-hint/1',
    'state','duplicate','eventId',p_event_id);
 end if;
 insert into public.learn_slack_event_hints(tenant_id,event_id,account_id,connection_id,
  team_id,channel_id,hint_kind,event_ts,source_ts,thread_ts,correction)
 values(p_tenant,p_event_id,s.account_id,c.id,p_team,p_channel,p_kind,
  p_event_ts,p_source_ts,p_thread_ts,p_correction);
 return jsonb_build_object('version','learn-slack-event-hint/1',
  'state','recorded','eventId',p_event_id);
end $$;
revoke all on function public.learn_slack_event_record(uuid,text,text,text,text,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_event_record(uuid,text,text,text,text,text,text,text,text)
  to service_role;
commit;
