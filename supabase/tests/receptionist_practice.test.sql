\set ON_ERROR_STOP on
-- Run inside an outer rollback-only transaction containing the new migration.
insert into public.tenants(id,slug,display_name) values
('ae000000-0000-0000-0000-000000000001','practice-test-a','Practice A'),('ae000000-0000-0000-0000-000000000002','practice-test-b','Practice B');
insert into auth.users(id,email) values
('ae100000-0000-0000-0000-000000000001','practice-a@example.test'),('ae100000-0000-0000-0000-000000000002','practice-b@example.test');
insert into public.receptionist_workspaces(tenant_id,company,name,assistant_id,vapi_secret_name,practice_enabled) values
('ae000000-0000-0000-0000-000000000001','A','Emma','ae200000-0000-0000-0000-000000000001','RECEPTIONIST_VAPI_TEST_A',true),
('ae000000-0000-0000-0000-000000000002','B','Other','ae200000-0000-0000-0000-000000000002','RECEPTIONIST_VAPI_TEST_B',false);
insert into public.receptionist_access values('ae000000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001');
do $$begin
 assert public.reserve_receptionist_practice('ae000000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001');
 assert not public.reserve_receptionist_practice('ae000000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001');
 begin
 perform public.reserve_receptionist_practice('ae000000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000002');
 raise exception 'Overlap allowed';exception when raise_exception then assert sqlerrm='A practice conversation is already reserved';end;
 begin
 perform public.reserve_receptionist_practice('ae000000-0000-0000-0000-000000000002','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000002');
 raise exception 'Disabled workspace allowed';exception when raise_exception then assert sqlerrm='Practice not enabled';end;
 raise notice 'PASS reservation, replay, overlap and disabled workspace';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ae100000-0000-0000-0000-000000000001',true);
do $$begin
 assert(select count(*) from public.receptionist_practice_sessions)=1;
 begin perform public.reserve_receptionist_practice('ae000000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001',gen_random_uuid());raise exception 'Browser reservation allowed';exception when insufficient_privilege then null;end;
 insert into public.receptionist_feedback(tenant_id,practice_session_id,submission_key,title,body) values('ae000000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','ae400000-0000-0000-0000-000000000001','Practice note','Please improve the greeting');
 begin
 insert into public.receptionist_feedback(tenant_id,practice_session_id,submission_key,title,body) values('ae000000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','ae400000-0000-0000-0000-000000000001','Practice note','Same retry');
 raise exception 'Duplicate submission allowed';exception when unique_violation then null;end;
 begin
 insert into public.receptionist_feedback(tenant_id,practice_session_id,call_id,title,body) values('ae000000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001',gen_random_uuid(),'Wrong call','Must refuse');
 raise exception 'Forged call accepted';exception when raise_exception then assert sqlerrm='Practice feedback scope mismatch';end;
 assert(select count(*) from public.client_notification_outbox where tenant_id='ae000000-0000-0000-0000-000000000001')=1;
 raise notice 'PASS own session read, browser reserve denial, idempotent note, call binding, one outbox event';
end $$;
select set_config('request.jwt.claim.sub','ae100000-0000-0000-0000-000000000002',true);
do $$begin assert(select count(*) from public.receptionist_practice_sessions)=0;raise notice 'PASS stranger session denial';end $$;
reset role;
update public.receptionist_practice_sessions set state='ended' where tenant_id='ae000000-0000-0000-0000-000000000001';
insert into public.receptionist_practice_sessions(id,tenant_id,author_id,state) select gen_random_uuid(),'ae000000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','failed' from generate_series(1,9);
do $$begin
 begin perform public.reserve_receptionist_practice('ae000000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001',gen_random_uuid());raise exception 'Daily limit ignored';exception when raise_exception then assert sqlerrm='Practice daily limit reached';end;
 raise notice 'PASS failed attempts count toward daily quota';
end $$;
