-- Rolled back in full; no provider calls or retained users/grants/audio.
create function pg_temp.opid(n int) returns uuid language sql immutable as $$select ('cf830000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.opid(int) to authenticated;
insert into tenants(id,slug,display_name,status) values(pg_temp.opid(1),'operator-audio-rollback-home','Synthetic home','active'),(pg_temp.opid(2),'operator-audio-rollback-client','Synthetic client','active');
insert into auth.users(id,email,banned_until) values(pg_temp.opid(10),'operator-audio-rollback@example.invalid','infinity');
insert into profiles(id,tenant_id,role) values(pg_temp.opid(10),pg_temp.opid(1),'owner') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into phone_calls(id,tenant_id,provider,provider_call_id) values(pg_temp.opid(20),pg_temp.opid(2),'simwood','synthetic-call');
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,provider_call_id,storage_path,file_size)
 select pg_temp.opid(100+n),pg_temp.opid(2),'simwood','synthetic-'||n,'synthetic-call',pg_temp.opid(2)::text||'/synthetic-'||n||'.wav',128 from generate_series(1,31)n;
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,provider_call_id,storage_path)
 values(pg_temp.opid(200),pg_temp.opid(1),'simwood','foreign','synthetic-call',pg_temp.opid(1)::text||'/foreign.wav');
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='cf830000-aaaa-4000-8000-000000000010';set local role authenticated;
do $$begin begin perform learn_operator_phone_recordings_read(pg_temp.opid(2),'phone_calls',pg_temp.opid(20),'Operator check');raise exception 'Tenant owner admitted as operator';exception when insufficient_privilege then null;end;end$$;
reset role;insert into platform_authority_grants(profile_id,permission,granted_by,effective_to) values(pg_temp.opid(10),'platform.controlplane.view','rollback fixture',clock_timestamp()+interval '5 minutes');set local role authenticated;
do $$begin begin perform learn_operator_phone_recordings_read(pg_temp.opid(2),'phone_calls',pg_temp.opid(20),'Operator check');raise exception 'View grant admitted';exception when insufficient_privilege then null;end;end$$;
reset role;insert into platform_authority_grants(profile_id,permission,granted_by,effective_to) values(pg_temp.opid(10),'platform.controlplane.admin','rollback fixture',clock_timestamp()+interval '5 minutes');set local role authenticated;
do $$declare a jsonb;b jsonb;t jsonb;begin
 a:=learn_operator_phone_recordings_read(pg_temp.opid(2),'phone_calls',pg_temp.opid(20),'Operator check');
 assert jsonb_array_length(a->'rows')=30 and a->>'next_cursor'=pg_temp.opid(130)::text;
 assert a->>'actor_id'=pg_temp.opid(10)::text and a->'operator_mode'='true'::jsonb and a->>'audit_id' is not null;
 assert a::text not like '%storage_path%' and a::text not like '%foreign%';
 b:=learn_operator_phone_recordings_read(pg_temp.opid(2),'phone_calls',pg_temp.opid(20),'Operator check',(a->>'next_cursor')::uuid);
 assert jsonb_array_length(b->'rows')=1 and b->'next_cursor'='null'::jsonb;
 a:=learn_operator_phone_recordings_read(pg_temp.opid(2),'phone_recordings',pg_temp.opid(101),'Operator check');assert jsonb_array_length(a->'rows')=1;
 begin perform learn_operator_phone_recordings_read(pg_temp.opid(2),'phone_recordings',pg_temp.opid(200),'Operator check');raise exception 'Foreign source admitted';exception when insufficient_privilege then null;end;
 begin perform learn_operator_phone_recordings_read(pg_temp.opid(2),'phone_calls',pg_temp.opid(20),'Operator check',pg_temp.opid(200));raise exception 'Foreign cursor admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_operator_phone_recordings_read(pg_temp.opid(2),'phone_calls',pg_temp.opid(20),'');raise exception 'Blank reason admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_operator_phone_playback_authorize(pg_temp.opid(2),pg_temp.opid(11),pg_temp.opid(101),'Operator check');raise exception 'Spoofed actor admitted';exception when insufficient_privilege then null;end;
 t:=learn_operator_phone_playback_authorize(pg_temp.opid(2),pg_temp.opid(10),pg_temp.opid(101),'Operator check');
 assert t->>'actor_id'=pg_temp.opid(10)::text and t->'request_id'='null'::jsonb;
 a:=learn_operator_phone_playback_authorize(pg_temp.opid(2),pg_temp.opid(10),pg_temp.opid(101),'Operator check',t->>'source_digest',pg_temp.opid(300));
 b:=learn_operator_phone_playback_authorize(pg_temp.opid(2),pg_temp.opid(10),pg_temp.opid(101),'Operator check',t->>'source_digest',pg_temp.opid(300));assert a=b;
 begin perform learn_operator_phone_playback_authorize(pg_temp.opid(2),pg_temp.opid(10),pg_temp.opid(101),'Changed reason',t->>'source_digest',pg_temp.opid(300));raise exception 'Reason changed on replay';exception when sqlstate 'PT409' then null;end;
 begin perform learn_operator_phone_playback_authorize(pg_temp.opid(2),pg_temp.opid(10),pg_temp.opid(101),'Operator check',repeat('f',64),pg_temp.opid(301));raise exception 'Stale pointer accepted';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
do $$begin assert(select count(*)=1 from learn_phone_playback_audit where tenant_id=pg_temp.opid(2));assert(select count(*)=4 from controlplane_change_log where source='learn-operator-phone-playback' and tenant_id=pg_temp.opid(2));assert(select tenant_id=pg_temp.opid(1) and role='owner' from profiles where id=pg_temp.opid(10));end$$;
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values(pg_temp.opid(2),pg_temp.opid(10),'role','viewer','rollback fixture');set local role authenticated;
do $$begin begin perform learn_operator_phone_playback_authorize(pg_temp.opid(2),pg_temp.opid(10),pg_temp.opid(101),'Operator check');raise exception 'View-As admitted';exception when insufficient_privilege then null;end;end$$;
reset role;update view_as_context set ended_at=clock_timestamp() where actor_user_id=pg_temp.opid(10);
create function pg_temp.reject_operator_audio_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic_audio_audit_failure';end$$;
create trigger synthetic_audio_audit_failure before insert on controlplane_change_log for each row execute function pg_temp.reject_operator_audio_audit();set local role authenticated;
do $$declare t jsonb;begin
 begin perform learn_operator_phone_recordings_read(pg_temp.opid(2),'phone_calls',pg_temp.opid(20),'Audit failure');raise exception 'Failed audit released rows' using errcode='XX000';exception when raise_exception then if sqlerrm<>'synthetic_audio_audit_failure' then raise;end if;end;
 t:=learn_operator_phone_playback_authorize(pg_temp.opid(2),pg_temp.opid(10),pg_temp.opid(101),'Audit failure');
 begin perform learn_operator_phone_playback_authorize(pg_temp.opid(2),pg_temp.opid(10),pg_temp.opid(101),'Audit failure',t->>'source_digest',pg_temp.opid(302));raise exception 'Failed audit released target' using errcode='XX000';exception when raise_exception then if sqlerrm<>'synthetic_audio_audit_failure' then raise;end if;end;
end$$;
reset role;drop trigger synthetic_audio_audit_failure on controlplane_change_log;
do $$begin assert not exists(select 1 from learn_phone_playback_audit where id=pg_temp.opid(302));end$$;
update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.opid(10);set local role authenticated;
do $$begin begin perform learn_operator_phone_playback_authorize(pg_temp.opid(2),pg_temp.opid(10),pg_temp.opid(101),'Revoked');raise exception 'Revoked grant admitted';exception when insufficient_privilege then null;end;end$$;
reset role;
do $$declare r text;begin foreach r in array array['anon','service_role'] loop
 assert not has_function_privilege(r,'learn_operator_phone_recordings_read(uuid,text,uuid,text,uuid)','execute');
 assert not has_function_privilege(r,'learn_operator_phone_playback_authorize(uuid,uuid,uuid,text,text,uuid)','execute');end loop;end$$;
