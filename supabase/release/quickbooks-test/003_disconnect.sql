-- TEST saatxzwxvdvqevbnskxy; no credentials, revocations, source imports or capture changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='40s';
do $guard$ begin
if current_setting('serviceos.quickbooks_target',true) is distinct from 'saatxzwxvdvqevbnskxy' then raise exception 'QuickBooks TEST target required';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('auth.uid()') and md5(prosrc)='cdef18c69c4f4cbbced2eaf81e628b49' and pg_get_userbyid(proowner)='supabase_auth_admin') then raise exception 'QuickBooks disconnect prerequisite changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('auth.role()') and md5(prosrc)='f31486fed08a7402e89d4aa71b0ad273' and pg_get_userbyid(proowner)='supabase_auth_admin') then raise exception 'QuickBooks disconnect prerequisite changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.learn_operator_input_access(uuid,uuid,boolean)') and md5(prosrc)='6b26e22470bfb077e0c61d312c55f713' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks disconnect prerequisite changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.learn_quickbooks_actor_access(uuid,uuid)') and md5(prosrc)='309316a6759cde58d203837efb826788' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks disconnect prerequisite changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.provider_secret_name(uuid,text,text)') and md5(prosrc)='2e19bd2a1c02fecc48090bf9b066ad40' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks disconnect prerequisite changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') and md5(prosrc)='650d4c4b9939ea49ed73bdb3bfde1d39' and pg_get_userbyid(proowner)='supabase_admin') then raise exception 'QuickBooks disconnect prerequisite changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_actor_access' and md5(prosrc)='309316a6759cde58d203837efb826788' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_register_app' and md5(prosrc)='20341503dac3da941dae9256ebed37da' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_begin' and md5(prosrc)='c7dfbe1bbff48f302a8fcbdd16a3c4d9' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_claim' and md5(prosrc)='72e132b05e34ced0d3c78fae45791984' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_claim_current' and md5(prosrc)='29d4df0fb86dc8d90578675730b40e4a' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_validate_pair' and md5(prosrc)='b184daa13ca129d1ec31e740e6b9e5cf' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_finish' and md5(prosrc)='bdfa6d54a10c5fc4f7ded3509165d05c' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_fail' and md5(prosrc)='370cad57ba560344d74826df5d58728e' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_status' and md5(prosrc)='d8eaf9ff7970ba2fd0835cea48ea212d' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_control' and md5(prosrc)='88fcae503198c54a08a64b4921ed9cfd' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_refresh_acquire' and md5(prosrc)='159f7f3cad72e2b7a21049529016cf09' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_refresh_finish' and md5(prosrc)='62d882059246c18b145c33ec2deadf80' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_enabled' and md5(prosrc)='bdd3136f37f38cfaa84f332ed6b47185' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_set_enabled' and md5(prosrc)='27a08920240206b5e9c098283f69496a' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_import_start' and md5(prosrc)='ae1b504c9644788b08aa269845db225b' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_import_access' and md5(prosrc)='27bfb591c1007571c423cc1aab14b54b' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_import_acquire' and md5(prosrc)='a6eded8ea67c3e6633f976115c8d8b74' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_import_current' and md5(prosrc)='08602cf5c5e9a2ba4bd0f27f6fe108f0' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_import_commit' and md5(prosrc)='2c996e5b3935c53247c46e0dd7bcede4' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_import_fail' and md5(prosrc)='9f18a34602d3b8dac9b865942e1f40b7' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_import_status' and md5(prosrc)='1c78427470d0f3c51879fe9a9baec042' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;
if not exists(select 1 from public.learn_quickbooks_release_receipts where release_id='quickbooks_foundation_v1' and source_hashes='[{"name":"20261102000000_learn_quickbooks_oauth.sql","sha256":"344c2530955bb86a90fe7943060026661c9a8b68be467aa9f7c213afba50d046"},{"name":"20261102010000_learn_quickbooks_import.sql","sha256":"d801ba6a45af0570dd47312e8fb35552e3dfd085c130e7f5e7b3b5f9835e342c"}]'::jsonb) then raise exception 'QuickBooks foundation mismatch';end if;
end $guard$;
-- Stop local capture before revoking the app's QuickBooks grant. Uncertain
-- provider outcomes remain visible and never silently permit reconnection.

create table public.learn_quickbooks_disconnections (
 id uuid primary key,tenant_id uuid not null,connection_id uuid not null,
 actor_id uuid not null references public.profiles(id),reason text not null,
 connection_revision bigint not null,app_revision bigint not null,token_generation bigint not null,
 state text not null check(state in ('queued','revoking','revoked','manual_review','reviewed')),
 code text,lease_id uuid,lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 foreign key(connection_id,tenant_id) references public.learn_quickbooks_connections(id,tenant_id)
);
create unique index learn_quickbooks_one_disconnect on public.learn_quickbooks_disconnections(connection_id) where state not in ('revoked','reviewed');
alter table public.learn_quickbooks_disconnections enable row level security;
revoke all on public.learn_quickbooks_disconnections from public,anon,authenticated,service_role;

-- The existing OAuth and operator controls cannot revive a connection while a
-- revoke request could still be in flight or requires provider-side review.
create function public.learn_quickbooks_disconnect_fence() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-app-grant:'||new.app_id::text,0));
 if new.status<>'disconnected' and exists(select 1 from public.learn_quickbooks_disconnections d
  join public.learn_quickbooks_connections c on c.id=d.connection_id
  where d.state not in ('revoked','reviewed') and (d.connection_id=new.id or
   (c.app_id=new.app_id and (new.status='authorizing' or (c.realm_id=new.realm_id and c.environment=new.environment))))) then
  raise exception 'quickbooks_disconnect_unresolved' using errcode='55000';end if;
 return new;
end $$;
create trigger learn_quickbooks_disconnect_fence before insert or update on public.learn_quickbooks_connections for each row execute function public.learn_quickbooks_disconnect_fence();

-- New OAuth exchanges do not know the provider realm yet. Briefly fence new
-- exchanges for this app while a revoke remains unsettled. Other realms' existing
-- captures continue. Pending states cannot slip into an exchange after the fence.
create function public.learn_quickbooks_disconnect_authorization_fence() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if new.status in ('pending','exchanging') then
  perform pg_advisory_xact_lock(hashtextextended('quickbooks-app-grant:'||new.app_id::text,0));
  if exists(select 1 from public.learn_quickbooks_disconnections d join public.learn_quickbooks_connections c on c.id=d.connection_id
   where c.app_id=new.app_id and d.state not in ('revoked','reviewed')) then
   raise exception 'quickbooks_disconnect_unresolved' using errcode='55000';end if;
 end if;
 return new;
end $$;
create trigger learn_quickbooks_disconnect_authorization_fence before insert or update on public.learn_quickbooks_authorizations for each row execute function public.learn_quickbooks_disconnect_authorization_fence();

create function public.learn_quickbooks_disconnect_request(p_tenant uuid,p_connection uuid,p_request uuid,p_revision bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;d public.learn_quickbooks_disconnections%rowtype;a public.learn_quickbooks_apps%rowtype;review text;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 if p_request is null or p_revision is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
  raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-disconnect:'||p_request::text,0));
 -- Lock app before connection, consistent with authorisation starts.
 select a0.* into a from public.learn_quickbooks_apps a0 join public.learn_quickbooks_connections c0 on c0.app_id=a0.id
  where c0.id=p_connection and c0.tenant_id=p_tenant for share of a0;
 perform 1 from public.learn_quickbooks_imports where connection_id=p_connection and tenant_id=p_tenant and state in ('queued','running') order by id for update;
 select * into c from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant for update;
 if not found then raise exception 'quickbooks_connection_unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-app-grant:'||c.app_id::text,0));
 select * into d from public.learn_quickbooks_disconnections where id=p_request;
 if found then
  if (d.tenant_id,d.connection_id,d.actor_id,d.reason,d.connection_revision) is distinct from
   (p_tenant,p_connection,auth.uid(),p_reason,p_revision+1) then raise exception 'quickbooks_disconnect_conflict' using errcode='PT409';end if;
  return jsonb_build_object('id',d.id,'connectionId',d.connection_id,'state',d.state,'localCaptureStopped',true);
 end if;
 if c.revision<>p_revision or exists(select 1 from public.learn_quickbooks_disconnections where connection_id=c.id and state not in ('revoked','reviewed')) then
  raise exception 'quickbooks_connection_changed' using errcode='PT409';end if;
 -- In-flight exchanges may have issued credentials we did not save. Do not
 -- falsely claim that revoking the older saved token settles those exchanges.
 if c.refresh_lease is not null or exists(select 1 from public.learn_quickbooks_authorizations where (app_id=c.app_id or connection_id=c.id) and status='exchanging') then review:='exchange_uncertain';
 elsif c.token_secret_id is null or c.realm_id is null then review:='no_saved_token';
 elsif exists(select 1 from public.learn_quickbooks_connections where id<>c.id and app_id=c.app_id and environment=c.environment and realm_id=c.realm_id
  and (status<>'disconnected' or refresh_lease is not null)) then review:='shared_provider_grant';
 end if;
 update public.learn_quickbooks_connections set status='disconnected',revision=revision+1,confirmed_at=null,confirmed_by=null,updated_at=clock_timestamp()
  where id=c.id returning * into c;
 insert into public.learn_quickbooks_disconnections(id,tenant_id,connection_id,actor_id,reason,connection_revision,app_revision,token_generation,state,code)
 values(p_request,p_tenant,c.id,auth.uid(),p_reason,c.revision,a.revision,c.token_generation,case when review is null then 'queued' else 'manual_review' end,review) returning * into d;
 -- Keep retained pages/checkpoints, but do not leave a queued run looking active.
 update public.learn_quickbooks_imports set state='paused',updated_at=clock_timestamp() where connection_id=c.id and state in ('queued','running');
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
 values(p_tenant,c.id,auth.uid(),'disconnect_requested',jsonb_build_object('request_id',d.id,'reason',p_reason,'state',d.state,'code',review));
 return jsonb_build_object('id',d.id,'connectionId',c.id,'state',d.state,'localCaptureStopped',true);
end $$;

-- Service-only credential release is single-use. A caller retry inspects the
-- durable state; it never sends a second provider request automatically.
create function public.learn_quickbooks_disconnect_acquire(p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.learn_quickbooks_disconnections%rowtype;c public.learn_quickbooks_connections%rowtype;a public.learn_quickbooks_apps%rowtype;pair jsonb;secret text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into d from public.learn_quickbooks_disconnections where id=p_request for update;
 if not found then raise exception 'quickbooks_disconnect_unavailable' using errcode='42501';end if;
 perform public.learn_quickbooks_actor_access(d.tenant_id,d.actor_id);
 if d.state='revoking' and d.lease_until<=clock_timestamp() then
  update public.learn_quickbooks_disconnections set state='manual_review',code='outcome_unknown' where id=d.id returning * into d;
 end if;
 if d.state<>'queued' then return jsonb_build_object('state',d.state);end if;
 select * into c from public.learn_quickbooks_connections where id=d.connection_id and tenant_id=d.tenant_id for update;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-app-grant:'||c.app_id::text,0));
 select * into a from public.learn_quickbooks_apps where id=c.app_id for share;
 if c.status<>'disconnected' or c.revision<>d.connection_revision or c.token_generation<>d.token_generation or a.revision<>d.app_revision
  or exists(select 1 from public.learn_quickbooks_connections where id<>c.id and app_id=c.app_id and environment=c.environment and realm_id=c.realm_id and status<>'disconnected') then
  update public.learn_quickbooks_disconnections set state='manual_review',code='connection_changed' where id=d.id;
  return jsonb_build_object('state','manual_review');end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id=a.client_secret_id and name='quickbooks_app:'||a.id::text;
 select decrypted_secret::jsonb into pair from vault.decrypted_secrets where id=c.token_secret_id and name=public.provider_secret_name(c.tenant_id,'quickbooks',c.id::text||':tokens');
 if secret is null or pair->>'refreshToken' is null then
  update public.learn_quickbooks_disconnections set state='manual_review',code='credential_unavailable' where id=d.id;
  return jsonb_build_object('state','manual_review');end if;
 update public.learn_quickbooks_disconnections set state='revoking',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' where id=d.id returning * into d;
 return jsonb_build_object('state','ready','requestId',d.id,'leaseId',d.lease_id,'leaseUntil',d.lease_until,
  'clientId',a.client_id,'clientSecret',secret,'refreshToken',pair->>'refreshToken');
end $$;

create function public.learn_quickbooks_disconnect_current(p_request uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$declare d public.learn_quickbooks_disconnections%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into d from public.learn_quickbooks_disconnections where id=p_request and lease_id=p_lease and state='revoking' and lease_until>clock_timestamp();
 if not found then return false;end if;
 perform public.learn_quickbooks_actor_access(d.tenant_id,d.actor_id);
 return exists(select 1 from public.learn_quickbooks_connections c join public.learn_quickbooks_apps a on a.id=c.app_id
  where c.id=d.connection_id and c.tenant_id=d.tenant_id and c.status='disconnected'
  and c.revision=d.connection_revision and c.token_generation=d.token_generation and a.revision=d.app_revision);
end $$;

create function public.learn_quickbooks_disconnect_finish(p_request uuid,p_lease uuid,p_revoked boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.learn_quickbooks_disconnections%rowtype;c public.learn_quickbooks_connections%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into d from public.learn_quickbooks_disconnections where id=p_request for update;
 if not found or p_lease is null or d.lease_id is distinct from p_lease or p_revoked is null then raise exception 'quickbooks_disconnect_unavailable' using errcode='42501';end if;
 if d.state='revoked' and p_revoked then return jsonb_build_object('state','revoked');end if;
 if d.state<>'revoking' or d.lease_until<=clock_timestamp() then raise exception 'quickbooks_disconnect_expired' using errcode='55000';end if;
 select * into c from public.learn_quickbooks_connections where id=d.connection_id and tenant_id=d.tenant_id for update;
 if c.status<>'disconnected' or c.revision<>d.connection_revision or c.token_generation<>d.token_generation then raise exception 'quickbooks_connection_changed' using errcode='PT409';end if;
 -- Even if the initiating user's grant has since ended, a service receipt must
 -- record a revoke that was already sent, without restoring capture or access.
 if p_revoked then
  perform vault.update_secret(c.token_secret_id,'{}',public.provider_secret_name(c.tenant_id,'quickbooks',c.id::text||':tokens'));
  update public.learn_quickbooks_connections set token_secret_id=null,access_expires_at=null,refresh_expires_at=null,refresh_hard_expires_at=null,
   refresh_lease=null,refresh_lease_until=null,updated_at=clock_timestamp() where id=c.id;
 end if;
 update public.learn_quickbooks_disconnections set state=case when p_revoked then 'revoked' else 'manual_review' end,
  code=case when p_revoked then null else 'outcome_unknown' end,finished_at=clock_timestamp() where id=d.id returning * into d;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,event,detail)
 values(d.tenant_id,c.id,'disconnect_finished',jsonb_build_object('request_id',d.id,'state',d.state));
 return jsonb_build_object('state',d.state);
end $$;

-- An explicit operator attestation after checking the provider's connected-apps
-- page resolves an uncertain revoke. This is distinguished from an API receipt.
-- No automatic retries and no claim that ServiceOS independently verified it.
create function public.learn_quickbooks_disconnect_review(p_tenant uuid,p_request uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d public.learn_quickbooks_disconnections%rowtype;c public.learn_quickbooks_connections%rowtype;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 if p_reason is null or length(btrim(p_reason)) not between 20 and 1000 then raise exception 'quickbooks_review_required' using errcode='22023';end if;
 select * into d from public.learn_quickbooks_disconnections where id=p_request and tenant_id=p_tenant for update;
 if not found then raise exception 'quickbooks_disconnect_unavailable' using errcode='42501';end if;
 if d.state not in ('manual_review','queued') and not(d.state='revoking' and d.lease_until<=clock_timestamp()) then
  raise exception 'quickbooks_review_unavailable' using errcode='55000';end if;
 select * into c from public.learn_quickbooks_connections where id=d.connection_id and tenant_id=p_tenant for update;
 if c.status<>'disconnected' or c.revision<>d.connection_revision then raise exception 'quickbooks_connection_changed' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-app-grant:'||c.app_id::text,0));
 if exists(select 1 from public.learn_quickbooks_authorizations where (app_id=c.app_id or connection_id=c.id) and status='exchanging' and claim_until>clock_timestamp())
  or c.refresh_lease_until>clock_timestamp() then raise exception 'quickbooks_exchange_in_progress' using errcode='55000';end if;
 if exists(select 1 from public.learn_quickbooks_connections where id<>c.id and app_id=c.app_id and environment=c.environment and realm_id=c.realm_id and status<>'disconnected') then
  raise exception 'quickbooks_shared_grant_unresolved' using errcode='55000';end if;
 if c.token_secret_id is not null then
  perform vault.update_secret(c.token_secret_id,'{}',public.provider_secret_name(c.tenant_id,'quickbooks',c.id::text||':tokens'));end if;
 update public.learn_quickbooks_connections set token_secret_id=null,access_expires_at=null,refresh_expires_at=null,refresh_hard_expires_at=null,
  refresh_lease=null,refresh_lease_until=null,updated_at=clock_timestamp() where id=c.id;
 update public.learn_quickbooks_disconnections set state='reviewed',code='operator_verified_provider_disconnect',finished_at=clock_timestamp() where id=d.id;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
 values(p_tenant,c.id,auth.uid(),'disconnect_reviewed',jsonb_build_object('request_id',d.id,'reason',p_reason));
 return jsonb_build_object('state','reviewed');
end $$;

create function public.learn_quickbooks_disconnect_status(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare entries jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'connectionId',connection_id,
  'requestRevision',connection_revision-1,'reason',reason,'actorId',actor_id,
  'state',case when state='revoking' and lease_until<=clock_timestamp() then 'manual_review' else state end,
  'code',case when state='revoking' and lease_until<=clock_timestamp() then 'outcome_unknown' else code end,
  'createdAt',created_at,'finishedAt',finished_at) order by created_at desc),'[]') into entries
 from (select distinct on(connection_id) * from public.learn_quickbooks_disconnections where tenant_id=p_tenant order by connection_id,created_at desc,id desc)d;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event)
 select p_tenant,id,auth.uid(),'disconnect_status_read' from public.learn_quickbooks_connections where tenant_id=p_tenant;
 return jsonb_build_object('tenantId',p_tenant,'requests',entries);
end $$;
revoke all on function public.learn_quickbooks_disconnect_fence(),public.learn_quickbooks_disconnect_authorization_fence(),public.learn_quickbooks_disconnect_request(uuid,uuid,uuid,bigint,text),
 public.learn_quickbooks_disconnect_current(uuid,uuid),public.learn_quickbooks_disconnect_review(uuid,uuid,text),
 public.learn_quickbooks_disconnect_acquire(uuid),public.learn_quickbooks_disconnect_finish(uuid,uuid,boolean),public.learn_quickbooks_disconnect_status(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_disconnect_request(uuid,uuid,uuid,bigint,text),public.learn_quickbooks_disconnect_status(uuid),public.learn_quickbooks_disconnect_review(uuid,uuid,text) to authenticated;
grant execute on function public.learn_quickbooks_disconnect_acquire(uuid),public.learn_quickbooks_disconnect_finish(uuid,uuid,boolean),public.learn_quickbooks_disconnect_current(uuid,uuid) to service_role;


insert into public.learn_quickbooks_release_receipts(release_id,source_hashes) values('quickbooks_disconnect_v1','[{"name":"20261102030000_learn_quickbooks_disconnect.sql","sha256":"5a75324ea900a06d4bfb31edae26d85e0d9bc00eab80a4d1c2fb4d7014fb2e18"}]'::jsonb);
notify pgrst,'reload schema';
commit;
