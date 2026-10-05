\set ON_ERROR_STOP on
begin;
insert into public.tenants(id,slug,display_name) values
('ad000000-0000-0000-0000-000000000001','receptionist-test-a','Test A'),('ad000000-0000-0000-0000-000000000002','receptionist-test-b','Test B');
insert into auth.users(id,email) values
('ad100000-0000-0000-0000-000000000001','receptionist-member@example.test'),
('ad100000-0000-0000-0000-000000000002','receptionist-stranger@example.test'),
('ad100000-0000-0000-0000-000000000003','receptionist-operator@example.test');
insert into public.receptionist_workspaces(tenant_id,company,name,assistant_id,vapi_secret_name) values
('ad000000-0000-0000-0000-000000000001','A','Emma','ad200000-0000-0000-0000-000000000001','RECEPTIONIST_VAPI_TEST_A'),
('ad000000-0000-0000-0000-000000000002','B','Other','ad200000-0000-0000-0000-000000000002','RECEPTIONIST_VAPI_TEST_B');
insert into public.receptionist_access values('ad000000-0000-0000-0000-000000000001','ad100000-0000-0000-0000-000000000001');
insert into public.platform_authority_grants(profile_id,permission,granted_by,reason) values
('ad100000-0000-0000-0000-000000000003','platform.controlplane.admin','local-rollback-test','Receptionist permissions test');
set local role authenticated;
select set_config('request.jwt.claim.sub','ad100000-0000-0000-0000-000000000001',true);
do $$declare n integer;begin
 assert(select count(*) from public.receptionist_workspaces)=1,'Only assigned receptionist visible';
 assert(select count(*) from public.client_programmes)=0,'Receptionist access does not grant quotation access';
 assert public.current_tenant_id() is null,'No operational authority';
 insert into public.receptionist_feedback(tenant_id,title,body) values('ad000000-0000-0000-0000-000000000001','Routing','Check handover');
 assert(select count(*) from public.client_notification_outbox)=1,'Feedback creates one durable notification';
 begin
 insert into public.receptionist_feedback(tenant_id,title,body) values('ad000000-0000-0000-0000-000000000002','Cross tenant','Denied');
 raise exception 'Cross tenant insert allowed';exception when insufficient_privilege then null;end;
 begin
 insert into public.receptionist_feedback(tenant_id,title,body,author_id) values('ad000000-0000-0000-0000-000000000001','Spoof','Denied','ad100000-0000-0000-0000-000000000003');
 raise exception 'Author spoof allowed';exception when insufficient_privilege then null;end;
 update public.receptionist_feedback set status='Resolved';get diagnostics n=row_count;assert n=0,'Client cannot resolve an issue';
 begin perform public.claim_client_notifications();raise exception 'Client can claim notification jobs';exception when insufficient_privilege then null;end;
 raise notice 'PASS: tenant isolation, receptionist-only access, author integrity, client update denial, outbox creation and dispatcher denial';
end $$;
select set_config('request.jwt.claim.sub','ad100000-0000-0000-0000-000000000002',true);
do $$begin
 assert(select count(*) from public.receptionist_workspaces)=0,'Stranger sees no workspaces';
 assert(select count(*) from public.receptionist_feedback)=0,'Stranger sees no feedback';
 assert(select count(*) from public.client_notification_outbox)=0,'Stranger sees no notifications';
end $$;
select set_config('request.jwt.claim.sub','ad100000-0000-0000-0000-000000000003',true);
do $$declare n integer;begin
 update public.receptionist_feedback set status='Reviewing',response='Investigating' where tenant_id='ad000000-0000-0000-0000-000000000001' and version=1;
 get diagnostics n=row_count;assert n=1,'Operator can respond';
 update public.receptionist_feedback set status='Resolved' where tenant_id='ad000000-0000-0000-0000-000000000001' and version=1;
 get diagnostics n=row_count;assert n=0,'Stale update blocked';
 assert(select count(*) from public.client_notification_outbox where tenant_id='ad000000-0000-0000-0000-000000000001')=2,'Response queues new version';
 begin update public.receptionist_feedback set body='Rewrite customer words';raise exception 'Original feedback changed';exception when insufficient_privilege then null;end;
 raise notice 'PASS: operator response, concurrency check, original note protected';
end $$;
set local role anon;
do $$begin
 begin perform * from public.receptionist_feedback;raise exception 'Anonymous access allowed';exception when insufficient_privilege then null;end;
 begin perform * from public.receptionist_workspaces;raise exception 'Anonymous workspace access allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
