-- Actual production auth triggers; isolated synthetic identities.
-- Synthetic rows only; execute inside an isolated DB or rolled-back TEST transaction.
insert into tenants(id,slug,display_name) values('fae019ce-aaaa-4000-8000-000000000001','production-playback-a','Playback fixture A'),('fae019ce-aaaa-4000-8000-000000000002','production-playback-b','Playback fixture B');
insert into auth.users(id,email,banned_until) values('fae019ce-aaaa-4000-8000-000000000010','production-playback-owner@example.invalid','infinity'),('fae019ce-aaaa-4000-8000-000000000011','production-playback-viewer@example.invalid','infinity');
insert into profiles(id,tenant_id,role) values
 ('fae019ce-aaaa-4000-8000-000000000010','fae019ce-aaaa-4000-8000-000000000001','owner'),
 ('fae019ce-aaaa-4000-8000-000000000011','fae019ce-aaaa-4000-8000-000000000001','viewer') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into phone_calls(id,tenant_id,provider,provider_call_id) values
 ('fae019ce-aaaa-4000-8000-000000000020','fae019ce-aaaa-4000-8000-000000000001','simwood','playback-shared-ref');
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,provider_call_id,storage_path)
 select ('fae019ce-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fae019ce-aaaa-4000-8000-000000000001','simwood','playback-'||n,'playback-shared-ref','fae019ce-aaaa-4000-8000-000000000001/'||n||'.wav' from generate_series(100,130)n;
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,provider_call_id,storage_path) values
 ('fae019ce-aaaa-4000-8000-000000000200','fae019ce-aaaa-4000-8000-000000000002','simwood','foreign-recording','playback-shared-ref','fae019ce-aaaa-4000-8000-000000000002/200.wav'),
 ('fae019ce-aaaa-4000-8000-000000000201','fae019ce-aaaa-4000-8000-000000000001','other','wrong-provider','playback-shared-ref',null);
set local request.jwt.claim.sub='fae019ce-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare p jsonb;q jsonb;t uuid:='fae019ce-aaaa-4000-8000-000000000001';c uuid:='fae019ce-aaaa-4000-8000-000000000020';begin
 p:=public.learn_phone_recordings_read(t,'phone_calls',c);
 assert jsonb_array_length(p->'rows')=30;assert p->>'next_cursor'='fae019ce-aaaa-4000-8000-000000000129';
 assert not(p::text like '%.wav%');assert not(p::text like '%playback-shared-ref%');assert (p->'rows'->0->>'audio_stored')::boolean;
 q:=public.learn_phone_recordings_read(t,'phone_calls',c,(p->>'next_cursor')::uuid);assert jsonb_array_length(q->'rows')=1;assert q->'next_cursor'='null';
 assert public.learn_phone_recordings_read(t,'phone_recordings','fae019ce-aaaa-4000-8000-000000000200')->'source_available'='false';
 assert jsonb_array_length(public.learn_phone_recordings_read(t,'phone_recordings','fae019ce-aaaa-4000-8000-000000000100')->'rows')=1;
 begin perform public.learn_phone_recordings_read(t,'phone_calls',c,'fae019ce-aaaa-4000-8000-000000000201');raise exception 'Wrong provider cursor allowed';exception when invalid_parameter_value then null;end;
 begin perform public.learn_phone_recordings_read('fae019ce-aaaa-4000-8000-000000000002','phone_calls',c);raise exception 'Foreign tenant read';exception when insufficient_privilege then null;end;
 begin perform public.learn_phone_playback_authorize(t,'fae019ce-aaaa-4000-8000-000000000010','fae019ce-aaaa-4000-8000-000000000100');raise exception 'Direct client signing allowed';exception when insufficient_privilege then null;end;
end$$;reset role;
set local request.jwt.claim.sub='fae019ce-aaaa-4000-8000-000000000011';set local role authenticated;
do $$begin begin perform public.learn_phone_recordings_read('fae019ce-aaaa-4000-8000-000000000001','phone_calls','fae019ce-aaaa-4000-8000-000000000020');raise exception 'Viewer read';exception when insufficient_privilege then null;end;end$$;reset role;
create temp table playback_probe(digest text);grant all on playback_probe to service_role;
set local role service_role;
insert into playback_probe select public.learn_phone_playback_authorize('fae019ce-aaaa-4000-8000-000000000001','fae019ce-aaaa-4000-8000-000000000010','fae019ce-aaaa-4000-8000-000000000100')->>'source_digest';
do $$declare r jsonb;t uuid:='fae019ce-aaaa-4000-8000-000000000001';a uuid:='fae019ce-aaaa-4000-8000-000000000010';i uuid:='fae019ce-aaaa-4000-8000-000000000100';q uuid:='fae019ce-aaaa-4000-8000-000000000300';d text;begin
 select digest into d from playback_probe;
 r:=public.learn_phone_playback_authorize(t,a,i,d,q);assert r=public.learn_phone_playback_authorize(t,a,i,d,q);
 begin perform public.learn_phone_playback_authorize(t,a,'fae019ce-aaaa-4000-8000-000000000200');raise exception 'Foreign recording signed';exception when insufficient_privilege then null;end;
 begin perform public.learn_phone_playback_authorize(t,a,i,repeat('b',64),q);raise exception 'Stale pointer accepted';exception when sqlstate 'PT409' then null;end;
end$$;reset role;
do $$begin
 assert (select count(*) from public.learn_phone_playback_audit where tenant_id='fae019ce-aaaa-4000-8000-000000000001')=1;
 assert not has_table_privilege('authenticated','public.learn_phone_playback_audit','select');assert not has_table_privilege('service_role','public.learn_phone_playback_audit','insert');
 assert not has_function_privilege('anon','public.learn_phone_recordings_read(uuid,text,uuid,uuid)','execute');
 begin update public.learn_phone_playback_audit set source_digest=repeat('b',64) where id='fae019ce-aaaa-4000-8000-000000000300';raise exception 'Audit mutated';exception when sqlstate '55000' then null;end;
end$$;
update public.phone_recordings set storage_path='fae019ce-aaaa-4000-8000-000000000001/changed.wav' where id='fae019ce-aaaa-4000-8000-000000000100';
set local role service_role;do $$begin
 begin perform public.learn_phone_playback_authorize('fae019ce-aaaa-4000-8000-000000000001','fae019ce-aaaa-4000-8000-000000000010','fae019ce-aaaa-4000-8000-000000000100',(select digest from playback_probe),'fae019ce-aaaa-4000-8000-000000000301');raise exception 'Changed pointer signed';exception when sqlstate 'PT409' then null;end;
end$$;reset role;
update profiles set role='viewer' where id='fae019ce-aaaa-4000-8000-000000000010';
set local role service_role;do $$begin
 begin perform public.learn_phone_playback_authorize('fae019ce-aaaa-4000-8000-000000000001','fae019ce-aaaa-4000-8000-000000000010','fae019ce-aaaa-4000-8000-000000000100');raise exception 'Demoted actor signed';exception when insufficient_privilege then null;end;
end$$;reset role;
select 'PASS: exact provider and tenant matching, redacted pagination, permission boundaries, immutable audit, replay, changed source and current actor';
