-- Additive notification routing. Existing webhook delivery remains the default.
begin;
create table public.operator_slack_connection (
 id boolean primary key default true check(id),
 team_id text not null check(team_id='T0BLG3N4KN1'),
 team_name text not null,
 bot_id text not null,
 secret_id uuid not null,
 connected_by uuid not null references public.profiles(id),
 connected_at timestamptz not null default now()
);
create table public.operator_notification_routes (
 tenant_id uuid not null references public.tenants(id),
 event_key text not null check(event_key in ('practice_feedback','receptionist_feedback','urgent_feedback','module_updates','module_feedback')),
 team_id text not null check(team_id='T0BLG3N4KN1'),
 channel_id text not null check(channel_id ~ '^[CG][A-Z0-9]+$'),
 channel_name text not null,
 test_ts text not null check(test_ts ~ '^[0-9]+\.[0-9]+$'),
 version integer not null default 1 check(version>0),
 updated_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now(),
 primary key(tenant_id,event_key)
);
alter table public.operator_slack_connection enable row level security;
alter table public.operator_notification_routes enable row level security;
revoke all on public.operator_slack_connection,public.operator_notification_routes from public,anon,authenticated;
grant select on public.operator_notification_routes to authenticated;
grant all on public.operator_slack_connection,public.operator_notification_routes to service_role;
create policy notification_routes_admin on public.operator_notification_routes for select to authenticated
 using(public.current_user_is_openfolk_operator('platform.controlplane.admin'));

create function public.notification_require_actor(p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.platform_authority_grants where profile_id=p_actor
   and permission='platform.controlplane.admin' and coalesce(effective_from,'-infinity')<=now()
   and coalesce(effective_to,'infinity')>now()) then raise exception 'Administrator required' using errcode='42501'; end if;
 if exists(select 1 from public.view_as_context where actor_user_id=p_actor and ended_at is null
   and (expires_at is null or expires_at>now())) then raise exception 'Leave client preview before changing notifications' using errcode='42501'; end if;
end $$;

create function public.notification_connect_slack(p_actor uuid,p_team text,p_name text,p_bot text,p_token text)
returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 perform public.notification_require_actor(p_actor);
 if p_team is distinct from 'T0BLG3N4KN1' or p_bot is null or p_token is null or p_token not like 'xoxb-%'
   or length(p_token)>1000 then raise exception 'Invalid OpenFolk bot connection'; end if;
 perform pg_advisory_xact_lock(hashtextextended('openfolk-slack-connection',0));
 select secret_id into sid from public.operator_slack_connection where id;
 if sid is null then sid:=vault.create_secret(p_token,'openfolk_notification_bot','OpenFolk notifications bot');
 else perform vault.update_secret(sid,p_token); end if;
 insert into public.operator_slack_connection(id,team_id,team_name,bot_id,secret_id,connected_by)
 values(true,p_team,p_name,p_bot,sid,p_actor)
 on conflict(id) do update set team_id=excluded.team_id,team_name=excluded.team_name,bot_id=excluded.bot_id,
 connected_by=excluded.connected_by,connected_at=now();
 insert into public.controlplane_change_log(actor,action,resource_type,resource_id,after,reason,source)
 values(p_actor::text,'notifications.slack.connected','notification_connection','slack',
 jsonb_build_object('team',p_team,'bot',p_bot),'Verified OpenFolk bot connection','openfolk');
end $$;
create function public.notification_slack_token() returns text
language sql security definer set search_path='' as $$
 select v.decrypted_secret from public.operator_slack_connection c join vault.decrypted_secrets v on v.id=c.secret_id where c.id;
$$;
create function public.notification_save_route(p_actor uuid,p_tenant uuid,p_event text,p_version integer,p_team text,p_channel text,p_name text,p_test_ts text)
returns integer language plpgsql security definer set search_path='' as $$
declare old_row public.operator_notification_routes; n integer;
begin
 perform public.notification_require_actor(p_actor);
 if p_version is null or p_version<0 or p_name is null or length(p_name) not between 1 and 100 then raise exception 'Invalid route'; end if;
 if not exists(select 1 from public.operator_slack_connection where team_id=p_team) then raise exception 'Connect Slack first'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_event,0));
 select * into old_row from public.operator_notification_routes where tenant_id=p_tenant and event_key=p_event;
 if coalesce(old_row.version,0)<>p_version then raise exception 'Route changed. Reload before saving.' using errcode='40001'; end if;
 n:=p_version+1;
 insert into public.operator_notification_routes(tenant_id,event_key,team_id,channel_id,channel_name,test_ts,version,updated_by)
 values(p_tenant,p_event,p_team,p_channel,p_name,p_test_ts,n,p_actor)
 on conflict(tenant_id,event_key) do update set team_id=excluded.team_id,channel_id=excluded.channel_id,
 channel_name=excluded.channel_name,test_ts=excluded.test_ts,version=excluded.version,updated_by=excluded.updated_by,updated_at=now();
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,before,after,reason,source)
 values(p_tenant,p_actor::text,'notifications.route.verified','notification_route',p_event,
 jsonb_build_object('channel',old_row.channel_id,'version',old_row.version),
 jsonb_build_object('channel',p_channel,'version',n,'test_ts',p_test_ts),'Slack confirmed test message; use for subsequent dispatches','openfolk');
 return n;
end $$;
revoke all on function public.notification_require_actor(uuid),public.notification_connect_slack(uuid,text,text,text,text),public.notification_slack_token(),public.notification_save_route(uuid,uuid,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.notification_require_actor(uuid),public.notification_connect_slack(uuid,text,text,text,text),public.notification_slack_token(),public.notification_save_route(uuid,uuid,text,integer,text,text,text,text) to service_role;

-- A route is pinned before transmission. Uncertain sends must never be blindly retried.
alter table public.client_notification_outbox
 add column notification_route jsonb,
 add column slack_phase text check(slack_phase in ('prepared','posting','uncertain','confirmed')),
 add column slack_channel text,
 add column slack_ts text;
-- Preserve existing client delivery-status reads without exposing internal Slack routing.
revoke select on public.client_notification_outbox from authenticated;
grant select(id,tenant_id,source_type,source_id,source_version,priority,state,attempts,available_at,sent_at,last_error,created_at)
 on public.client_notification_outbox to authenticated;
create or replace function public.claim_client_notifications() returns setof public.client_notification_outbox
language sql security definer set search_path='' as $$
 update public.client_notification_outbox set state='sending',attempts=attempts+1,available_at=now()+interval '5 minutes'
 where id in(select id from public.client_notification_outbox where
 state in ('queued','failed','sending') and available_at<=now() and attempts<10
 and (slack_phase is null or slack_phase='prepared')
 order by created_at for update skip locked limit 20) returning *;
$$;
commit;
