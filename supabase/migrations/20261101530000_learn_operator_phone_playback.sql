-- Explicit selected-client operator audio access; no tenant impersonation or new grants.
begin;
create function public.learn_operator_phone_recordings_read(p_tenant uuid,p_table text,p_id uuid,p_reason text,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();available boolean;call_provider text;call_ref text;rows jsonb;more boolean;last_id uuid;audit uuid:=gen_random_uuid();
begin
 perform public.learn_operator_input_access(p_tenant,actor,true);
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'phone_operator_reason_invalid' using errcode='22023';end if;
 if p_table is null or p_table not in ('phone_calls','phone_recordings') or p_id is null then raise exception 'phone_source_invalid' using errcode='22023';end if;
 if p_table='phone_calls' then
  select provider,provider_call_id into call_provider,call_ref from public.phone_calls where tenant_id=p_tenant and id=p_id;available:=found;
 else select exists(select 1 from public.phone_recordings where tenant_id=p_tenant and id=p_id) into available;end if;
 if not available then raise exception 'phone_source_unavailable' using errcode='42501';end if;
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
 perform public.learn_operator_input_access(p_tenant,actor,true);
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'phone_recordings.read',p_table,p_id::text,
  jsonb_build_object('record_ids',(select coalesce(jsonb_agg(x->'id'),'[]') from jsonb_array_elements(rows)x),'after',p_after),
  btrim(p_reason),audit::text,false,'learn-operator-phone-playback');
 return jsonb_build_object('version','learn-phone-recordings/1','tenant_id',p_tenant,'actor_id',actor,'audit_id',audit,'operator_mode',true,
  'table',p_table,'id',p_id,'source_available',true,'rows',rows,'next_cursor',case when more then last_id else null end);
end $$;

create function public.learn_operator_phone_playback_authorize(p_tenant uuid,p_actor uuid,p_recording uuid,p_reason text,p_source_digest text default null,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.phone_recordings%rowtype;fingerprint text;prior public.learn_phone_playback_audit%rowtype;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'phone_operator_reason_invalid' using errcode='22023';end if;
 if p_recording is null or (p_request is null)<>(p_source_digest is null) then raise exception 'phone_playback_invalid' using errcode='22023';end if;
 select * into r from public.phone_recordings where tenant_id=p_tenant and id=p_recording for share;
 if not found or r.storage_path is null or r.storage_path='' or r.storage_path not like p_tenant::text||'/%'
 then raise exception 'phone_playback_unavailable' using errcode='42501';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',r.id,'tenant',r.tenant_id,'path',r.storage_path,'size',r.file_size)::text,'UTF8')),'hex');
 if p_request is not null then
  if p_source_digest is distinct from fingerprint then raise exception 'phone_playback_source_changed' using errcode='PT409';end if;
  perform pg_advisory_xact_lock(hashtextextended('phone-playback:'||p_request::text,0));
  select * into prior from public.learn_phone_playback_audit where id=p_request;
  if found then
   if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.recording_id<>p_recording or prior.source_digest<>fingerprint
    or not exists(select 1 from public.controlplane_change_log where id=p_request and tenant_id=p_tenant and actor=p_actor::text
      and action='phone_recording.play' and resource_id=p_recording::text and reason=btrim(p_reason) and source='learn-operator-phone-playback')
    then raise exception 'phone_playback_request_conflict' using errcode='PT409';end if;
  else
   insert into public.learn_phone_playback_audit(id,tenant_id,actor_id,recording_id,source_digest) values(p_request,p_tenant,p_actor,p_recording,fingerprint);
   insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
   values(p_request,p_tenant,p_actor::text,'phone_recording.play','phone_recordings',p_recording::text,jsonb_build_object('source_digest',fingerprint),btrim(p_reason),p_request::text,false,'learn-operator-phone-playback');
  end if;
 end if;
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 return jsonb_build_object('version','learn-phone-playback-target/1','tenant_id',p_tenant,'actor_id',p_actor,'operator_mode',true,'recording_id',p_recording,'storage_path',r.storage_path,'source_digest',fingerprint,'request_id',p_request);
end $$;
revoke all on function public.learn_operator_phone_recordings_read(uuid,text,uuid,text,uuid),public.learn_operator_phone_playback_authorize(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_phone_recordings_read(uuid,text,uuid,text,uuid),public.learn_operator_phone_playback_authorize(uuid,uuid,uuid,text,text,uuid) to authenticated;
commit;
