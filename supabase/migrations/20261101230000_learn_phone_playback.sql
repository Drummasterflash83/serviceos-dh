-- Retained Phone audio on LEARN cards. No provider fetch, capture or source writes.
begin;
create table public.learn_phone_playback_audit(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),recording_id uuid not null references public.phone_recordings(id),
 source_digest text not null check(source_digest ~ '^[a-f0-9]{64}$'),
 authorised_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_playback_audit enable row level security;
revoke all on public.learn_phone_playback_audit from public,anon,authenticated,service_role;
create trigger learn_phone_playback_audit_immutable before update or delete on public.learn_phone_playback_audit
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_phone_recordings_read(p_tenant uuid,p_table text,p_id uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor public.profiles%rowtype;available boolean;call_provider text;call_ref text;rows jsonb;more boolean;last_id uuid;
begin
 if p_table is null or p_table not in ('phone_calls','phone_recordings') then raise exception 'phone_source_invalid' using errcode='22023';end if;
 -- Match the existing source reader's actual-caller company owner/admin boundary.
 -- No new raw-table grants or changes to the existing source reader's ACL.
 select * into actor from public.profiles where id=auth.uid() for share;
 if not found or p_tenant is null or actor.tenant_id is distinct from p_tenant or (actor.role is null or actor.role not in ('owner','admin')) then raise exception 'phone_source_unavailable' using errcode='42501';end if;
 if p_id is null then raise exception 'phone_source_invalid' using errcode='22023';end if;
 if p_table='phone_calls' then
  select provider,provider_call_id into call_provider,call_ref from public.phone_calls where tenant_id=p_tenant and id=p_id;available:=found;
 else select exists(select 1 from public.phone_recordings where tenant_id=p_tenant and id=p_id) into available;end if;
 if not available then
  return jsonb_build_object('version','learn-phone-recordings/1','tenant_id',p_tenant,'table',p_table,'id',p_id,'source_available',false,'rows','[]'::jsonb,'next_cursor',null);
 end if;
 if p_after is not null and not exists(select 1 from public.phone_recordings r where r.tenant_id=p_tenant and r.id=p_after
  and ((p_table='phone_recordings' and r.id=p_id) or (p_table='phone_calls' and r.provider=call_provider and r.provider_call_id=call_ref)))
 then raise exception 'phone_recording_cursor_invalid' using errcode='22023';end if;
 with bounded as materialized(
  select r.id,r.started_at,r.duration_seconds,(r.storage_path is not null and r.storage_path<>'') as audio_stored
  from public.phone_recordings r where r.tenant_id=p_tenant and (p_after is null or r.id>p_after)
   and ((p_table='phone_recordings' and r.id=p_id) or (p_table='phone_calls' and r.provider=call_provider and r.provider_call_id=call_ref))
  order by r.id limit 31
 ),page as materialized(select * from bounded order by id limit 30)
 select coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from page p),'[]'),(select count(*)>30 from bounded),(select id from page order by id desc limit 1)
 into rows,more,last_id;
 return jsonb_build_object('version','learn-phone-recordings/1','tenant_id',p_tenant,'table',p_table,'id',p_id,'source_available',true,'rows',rows,'next_cursor',case when more then last_id else null end);
end $$;
revoke all on function public.learn_phone_recordings_read(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_recordings_read(uuid,text,uuid,uuid) to authenticated;

-- Only the authenticated-user Edge path may call this with its verified actor.
-- Recheck current profile and pointer after signing, before releasing any link.
create function public.learn_phone_playback_authorize(p_tenant uuid,p_actor uuid,p_recording uuid,p_source_digest text default null,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor public.profiles%rowtype;r public.phone_recordings%rowtype;fingerprint text;prior public.learn_phone_playback_audit%rowtype;
begin
 if p_tenant is null or p_actor is null or p_recording is null or (p_request is null)<>(p_source_digest is null) then raise exception 'phone_playback_invalid' using errcode='22023';end if;
 select * into actor from public.profiles where id=p_actor for share;
 if not found or actor.tenant_id is distinct from p_tenant or (actor.role is null or actor.role not in ('owner','admin')) then raise exception 'phone_playback_unavailable' using errcode='42501';end if;
 select * into r from public.phone_recordings where tenant_id=p_tenant and id=p_recording for share;
 if not found or r.storage_path is null or r.storage_path='' or r.storage_path not like p_tenant::text||'/%'
 then raise exception 'phone_playback_unavailable' using errcode='42501';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',r.id,'tenant',r.tenant_id,'path',r.storage_path,'size',r.file_size)::text,'UTF8')),'hex');
 if p_request is not null then
  if p_source_digest is distinct from fingerprint then raise exception 'phone_playback_source_changed' using errcode='PT409';end if;
  perform pg_advisory_xact_lock(hashtextextended('phone-playback:'||p_request::text,0));
  select * into prior from public.learn_phone_playback_audit where id=p_request;
  if found then
   if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.recording_id<>p_recording or prior.source_digest<>fingerprint then raise exception 'phone_playback_request_conflict' using errcode='PT409';end if;
  else insert into public.learn_phone_playback_audit(id,tenant_id,actor_id,recording_id,source_digest) values(p_request,p_tenant,p_actor,p_recording,fingerprint);end if;
 end if;
 return jsonb_build_object('version','learn-phone-playback-target/1','tenant_id',p_tenant,'recording_id',p_recording,'storage_path',r.storage_path,'source_digest',fingerprint,'request_id',p_request);
end $$;
revoke all on function public.learn_phone_playback_authorize(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_playback_authorize(uuid,uuid,uuid,text,uuid) to service_role;
commit;
