-- Client-owned Slack is isolated from OpenFolk's internal notification system.
begin;
create table public.customer_slack_connections (
 tenant_id uuid primary key references public.tenants(id),
 generation uuid not null default gen_random_uuid(),
 team_id text not null unique check(team_id ~ '^T[A-Z0-9]+$' and team_id <> 'T0BLG3N4KN1'),
 team_name text not null, bot_id text not null, secret_id uuid not null,
 enabled boolean not null default true,
 connected_by uuid not null references public.profiles(id), connected_at timestamptz not null default now()
);
create table public.customer_notification_routes (
 tenant_id uuid not null references public.customer_slack_connections(tenant_id),
 event_key text not null check(event_key in ('progress','resolved','urgent')),
 channel_id text not null check(channel_id ~ '^[CG][A-Z0-9]+$'), channel_name text not null,
 enabled boolean not null default true, version integer not null default 1,
 test_ts text not null, updated_at timestamptz not null default now(),
 primary key(tenant_id,event_key)
);
create table public.customer_notification_outbox (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 issue_id uuid not null, issue_version integer not null,
 generation uuid not null, event_key text not null,
 client_stage text not null check(client_stage in ('submitted','in_review','resolved')),
 channel_id text not null, channel_name text not null,
 state text not null default 'queued' check(state in ('queued','posting','sent','failed','uncertain','cancelled')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 created_at timestamptz not null default now(), sent_at timestamptz, slack_ts text,
 foreign key(tenant_id,issue_id) references public.receptionist_care_issues(tenant_id,id),
 unique(issue_id,issue_version)
);
alter table public.customer_slack_connections enable row level security;
alter table public.customer_notification_routes enable row level security;
alter table public.customer_notification_outbox enable row level security;
revoke all on public.customer_slack_connections,public.customer_notification_routes,public.customer_notification_outbox from public,anon,authenticated;
grant all on public.customer_slack_connections,public.customer_notification_routes,public.customer_notification_outbox to service_role;

create function public.customer_notification_actor(p_tenant uuid,p_actor uuid) returns boolean
language sql security definer set search_path='' as $$
 select p_actor is not null and not exists(select 1 from public.view_as_context where actor_user_id=p_actor and ended_at is null and (expires_at is null or expires_at>now())) and (
 exists(select 1 from public.client_portal_access where tenant_id=p_tenant and profile_id=p_actor)
 or exists(select 1 from public.profiles p join auth.users u on u.id=p.id join public.platform_authority_grants g on g.profile_id=p.id where p.id=p_actor and lower(u.email)='chris@openfolk.ai' and g.permission='platform.controlplane.admin' and coalesce(g.effective_from,'-infinity')<=now() and coalesce(g.effective_to,'infinity')>now())
 );
$$;
create function public.customer_slack_connect(p_tenant uuid,p_actor uuid,p_expected uuid,p_team text,p_name text,p_bot text,p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.customer_slack_connections; sid uuid; gen uuid:=gen_random_uuid();
begin
 if not public.customer_notification_actor(p_tenant,p_actor) then raise exception 'Workspace access required' using errcode='42501'; end if;
 if p_token is null or p_token not like 'xoxb-%' or length(p_token)>1000 then raise exception 'Invalid bot'; end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-slack:'||p_tenant::text,0));
 select * into c from public.customer_slack_connections where tenant_id=p_tenant for update;
 if c.generation is distinct from p_expected then raise exception 'Connection changed' using errcode='40001'; end if;
 sid:=c.secret_id;
 if sid is null then sid:=vault.create_secret(p_token,'customer_slack_'||p_tenant::text,'Client notifications bot');
 else perform vault.update_secret(sid,p_token); end if;
 insert into public.customer_slack_connections(tenant_id,generation,team_id,team_name,bot_id,secret_id,connected_by)
 values(p_tenant,gen,p_team,p_name,p_bot,sid,p_actor)
 on conflict(tenant_id) do update set generation=gen,team_id=excluded.team_id,team_name=excluded.team_name,bot_id=excluded.bot_id,enabled=true,connected_by=p_actor,connected_at=now();
 update public.customer_notification_routes set enabled=false,version=version+1,updated_at=now() where tenant_id=p_tenant;
 update public.customer_notification_outbox set state='cancelled' where tenant_id=p_tenant and state in ('queued','failed');
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,after,reason,source)
 values(p_tenant,p_actor::text,'customer.slack.connected','customer_notification',p_tenant::text,jsonb_build_object('team',p_team,'generation',gen),'Client verified bot connection; routes require a fresh test','client');
 return gen;
end $$;
create function public.customer_slack_token(p_tenant uuid,p_generation uuid) returns text
language sql security definer set search_path='' as $$
 select v.decrypted_secret from public.customer_slack_connections c join vault.decrypted_secrets v on v.id=c.secret_id where c.tenant_id=p_tenant and c.generation=p_generation and c.enabled;
$$;
create function public.customer_notification_route_save(p_tenant uuid,p_actor uuid,p_generation uuid,p_event text,p_version integer,p_channel text,p_name text,p_test text,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 if not public.customer_notification_actor(p_tenant,p_actor) then raise exception 'Workspace access required' using errcode='42501'; end if;
 perform 1 from public.customer_slack_connections where tenant_id=p_tenant and generation=p_generation and enabled for update;
 if not found then raise exception 'Connection changed'; end if;
 select version into v from public.customer_notification_routes where tenant_id=p_tenant and event_key=p_event for update;
 if coalesce(v,0) is distinct from p_version then raise exception 'Route changed' using errcode='40001'; end if;
 if p_test !~ '^[0-9]+\.[0-9]+$' or p_name is null or length(p_name)>100 then raise exception 'Test receipt required'; end if;
 insert into public.customer_notification_routes(tenant_id,event_key,channel_id,channel_name,test_ts,enabled,version)
 values(p_tenant,p_event,p_channel,p_name,p_test,p_enabled,coalesce(v,0)+1)
 on conflict(tenant_id,event_key) do update set channel_id=p_channel,channel_name=p_name,test_ts=p_test,enabled=p_enabled,version=excluded.version,updated_at=now();
 -- Changes affect new events only; don't send old queued updates to old channels.
 update public.customer_notification_outbox set state='cancelled' where tenant_id=p_tenant and event_key=p_event and state in ('queued','failed');
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,after,reason,source)
 values(p_tenant,p_actor::text,'customer.slack.route','customer_notification',p_event,jsonb_build_object('channel',p_channel,'enabled',p_enabled),'Client notification preference','client');
end $$;
create function public.customer_slack_disconnect(p_tenant uuid,p_actor uuid,p_generation uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.customer_notification_actor(p_tenant,p_actor) then raise exception 'Workspace access required' using errcode='42501'; end if;
 update public.customer_slack_connections set enabled=false where tenant_id=p_tenant and generation=p_generation;
 if not found then raise exception 'Connection changed'; end if;
 update public.customer_notification_routes set enabled=false,version=version+1,updated_at=now() where tenant_id=p_tenant;
 update public.customer_notification_outbox set state='cancelled' where tenant_id=p_tenant and state in ('queued','failed');
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,reason,source)
 values(p_tenant,p_actor::text,'customer.slack.disconnected','customer_notification',p_tenant::text,'Client paused their connection','client');
end $$;
create function public.customer_feedback_stage(p_stage text) returns text
language sql immutable set search_path='' as $$ select case p_stage when 'received' then 'submitted' when 'resolved' then 'resolved' else 'in_review' end $$;
create function public.customer_feedback_notify() returns trigger
language plpgsql security definer set search_path='' as $$
declare s text:=public.customer_feedback_stage(new.stage); event text;
begin
 if new.feedback_id is null then return new; end if;
 if tg_op='UPDATE' then
  if s=public.customer_feedback_stage(old.stage) and new.priority=old.priority then return new; end if;
 end if;
 event:=case when s='resolved' then 'resolved' when new.priority='urgent' then 'urgent' else 'progress' end;
 insert into public.customer_notification_outbox(tenant_id,issue_id,issue_version,generation,event_key,client_stage,channel_id,channel_name)
 select new.tenant_id,new.id,new.version,c.generation,event,s,r.channel_id,r.channel_name
 from public.customer_slack_connections c join public.customer_notification_routes r on r.tenant_id=c.tenant_id
 where c.tenant_id=new.tenant_id and c.enabled and r.enabled and r.event_key=event
 on conflict(issue_id,issue_version) do nothing;
 return new;
end $$;
create trigger customer_feedback_notification after insert or update on public.receptionist_care_issues for each row execute function public.customer_feedback_notify();
create function public.customer_notifications_claim() returns setof public.customer_notification_outbox
language plpgsql security definer set search_path='' as $$
begin
 update public.customer_notification_outbox set state='uncertain' where state='posting' and available_at<now();
 return query update public.customer_notification_outbox set state='posting', attempts=attempts+1, available_at=now()+interval '5 minutes'
 where id in(select id from public.customer_notification_outbox where state in ('queued','failed') and available_at<=now() and attempts<8 order by created_at for update skip locked limit 10) returning *;
end $$;
revoke all on function public.customer_notification_actor(uuid,uuid),public.customer_slack_connect(uuid,uuid,uuid,text,text,text,text),public.customer_slack_token(uuid,uuid),public.customer_notification_route_save(uuid,uuid,uuid,text,integer,text,text,text,boolean),public.customer_slack_disconnect(uuid,uuid,uuid),public.customer_feedback_stage(text),public.customer_feedback_notify(),public.customer_notifications_claim() from public,anon,authenticated;
grant execute on function public.customer_notification_actor(uuid,uuid),public.customer_slack_connect(uuid,uuid,uuid,text,text,text,text),public.customer_slack_token(uuid,uuid),public.customer_notification_route_save(uuid,uuid,uuid,text,integer,text,text,text,boolean),public.customer_slack_disconnect(uuid,uuid,uuid),public.customer_feedback_stage(text),public.customer_feedback_notify(),public.customer_notifications_claim() to service_role;
commit;
