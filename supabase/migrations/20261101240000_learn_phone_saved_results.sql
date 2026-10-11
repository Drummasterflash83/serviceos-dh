-- Read retained call results without processing, provider requests or source mutation.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
create function public.learn_phone_saved_results_read(p_tenant uuid,p_recording uuid,p_offset integer default 0,p_transcript_sha256 text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor public.profiles%rowtype;r public.phone_recordings%rowtype;t public.phone_transcripts%rowtype;i public.phone_ai_insights%rowtype;
 v public.learn_phone_result_versions%rowtype;download jsonb;digest text;tf text:='unverified';af text:='unverified';n integer;answer jsonb;
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or p_tenant is null or actor.tenant_id is distinct from p_tenant or coalesce(actor.role,'') not in ('owner','admin') then
  raise exception 'phone_results_unavailable' using errcode='42501';end if;
 if p_recording is null or p_offset is null or p_offset<0 or p_offset>1048576 or p_offset%12000<>0
 or (p_offset>0 and p_transcript_sha256 is null) or (p_transcript_sha256 is not null and p_transcript_sha256!~'^[a-f0-9]{64}$') then
  raise exception 'phone_results_cursor_invalid' using errcode='22023';end if;
 answer:=jsonb_build_object('version','learn-phone-saved-results/1','tenant_id',p_tenant,'recording_id',p_recording,'checked_at',statement_timestamp());
 select * into r from public.phone_recordings where tenant_id=p_tenant and id=p_recording;
 if not found then return answer||jsonb_build_object('source_available',false,'transcript',null,'analysis',null);end if;
 select * into t from public.phone_transcripts where tenant_id=p_tenant and recording_id=p_recording
  order by (status='completed') desc,created_at desc,id desc limit 1;
 select * into i from public.phone_ai_insights where tenant_id=p_tenant and recording_id=p_recording
  order by created_at desc,id desc limit 1;
 if t.id is not null then
  digest:=encode(sha256(convert_to(coalesce(t.transcript_text,''),'UTF8')),'hex');n:=length(coalesce(t.transcript_text,''));
  if (p_transcript_sha256 is not null and digest<>p_transcript_sha256) or (p_offset>0 and p_offset>=n) then
   raise exception 'phone_results_changed' using errcode='PT409';end if;
  select * into v from public.learn_phone_result_versions where tenant_id=p_tenant and recording_id=p_recording and stage='transcription' and run_id=t.processing_run_id and result_id=t.id;
  select a.prepared into download from public.learn_phone_processing_attempts a where a.tenant_id=p_tenant and a.recording_id=p_recording and a.stage='download' and a.state='succeeded' and a.prepared->>'storagePath'=r.storage_path order by a.completed_at desc,a.run_id desc limit 1;
  if r.storage_path is null or (t.source_storage_path is not null and t.source_storage_path<>r.storage_path)
   or (v.run_id is not null and (v.source->>'storagePath' is distinct from r.storage_path or v.result->>'text' is distinct from t.transcript_text))
   or (download->>'sha256' is not null and t.source_sha256 is not null and download->>'sha256'<>t.source_sha256) then tf:='stale';
  elsif t.status='completed' and n>0 and t.source_storage_path=r.storage_path and t.source_sha256~'^[a-f0-9]{64}$'
   and v.run_id is not null then tf:='source_matched';end if;
 elsif p_offset>0 or p_transcript_sha256 is not null then raise exception 'phone_results_changed' using errcode='PT409';end if;
 if i.id is not null then
  if tf='stale' or (i.transcript_id is not null and i.transcript_id is distinct from t.id)
   or (i.source_transcript_sha256 is not null and i.source_transcript_sha256 is distinct from digest) then af:='stale';
  elsif tf='source_matched' and i.transcript_id=t.id and i.source_transcript_sha256=digest then af:='source_matched';end if;
 end if;
 return answer||jsonb_build_object('source_available',true,
  'transcript',case when t.id is not null then jsonb_build_object('id',t.id,'status',t.status,'text',substring(coalesce(t.transcript_text,'') from p_offset+1 for 12000),
   'offset',p_offset,'next_offset',case when p_offset+12000<n then p_offset+12000 else null end,'total_characters',n,'sha256',digest,'freshness',tf,'updated_at',t.updated_at) end,
  'analysis',case when i.id is not null then jsonb_build_object('id',i.id,'summary',left(coalesce(i.summary,''),20000),'summary_truncated',length(coalesce(i.summary,''))>20000,
   'source_transcript_id',i.transcript_id,'freshness',af,'updated_at',i.updated_at) end);
end $$;
revoke all on function public.learn_phone_saved_results_read(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_saved_results_read(uuid,uuid,integer,text) to authenticated;
commit;
