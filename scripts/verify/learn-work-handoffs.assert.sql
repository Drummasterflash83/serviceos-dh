-- Offline synthetic evidence. No simulated measurement values supplied to collector.
insert into tenants(id,slug,display_name,industry) values
 ('aaaa0000-0000-0000-0000-000000000001','handoff-test','Handoff Test','hvac'),
 ('aaaa0000-0000-0000-0000-000000000002','handoff-other','Other Tenant','hvac');
insert into auth.users(id,email,is_sso_user,is_anonymous) values
 ('bbbb0000-0000-0000-0000-000000000001','handoff@test.invalid',false,false);
update profiles set tenant_id='aaaa0000-0000-0000-0000-000000000001',role='owner'
 where id='bbbb0000-0000-0000-0000-000000000001';
insert into team_members(id,tenant_id,profile_id,display_name,confirmed_at,effective_from) values
 ('cccc0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000001','First member',clock_timestamp(),now()-interval '1 day'),
 ('cccc0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001',null,'Second member',clock_timestamp(),now()-interval '1 day');
insert into config_versions(id,tenant_id,artifact_kind,artifact_key,version,status) values
 ('dddd0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','learn_scorecard','handoffs-test',1,'draft');
insert into operating_profile_entries(tenant_id,namespace,scope_kind,scope_ref,key,version_id,value) values
 ('aaaa0000-0000-0000-0000-000000000001','learn_scorecards','tenant','member:all','definition.handoff-test',
 'dddd0000-0000-0000-0000-000000000001',
 '{"id":"dddd0000-0000-0000-0000-000000000002","tenantId":"aaaa0000-0000-0000-0000-000000000001","version":1,
 "name":"Recorded handoffs","status":"draft","subjectKind":"member","groupId":null,"scaleMax":100,
 "metrics":[{"key":"work.recorded_handoffs","label":"Recorded outgoing handoffs","unit":"handoffs","weight":1,
 "zeroAt":0,"fullAt":5,"minSamples":1,"minCoverage":1,"maxAgeHours":72,"sourceSystems":["serviceos.work.handoffs@1"]}]}');
insert into object_classes(class,label,description) values('action','Action','Synthetic action');
insert into domain_object_types(domain,object_type,label,object_class) values('serviceos','Action','Action','action');
create temporary table handoff_period(start_at timestamptz,end_at timestamptz);
insert into handoff_period values(clock_timestamp(),null);
grant select on handoff_period to authenticated;
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref) values
 ('eeee0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-00000000-00000001','serviceos','Action','action','Synthetic handoff','ready',
 '{"kind":"member","ref":"cccc0000-0000-0000-0000-000000000001"}');
-- Same person, different typed reference: must not be a handoff.
update intelligence_objects set responsible_ref='{"kind":"user","ref":"bbbb0000-0000-0000-0000-000000000001"}'
 where id='eeee0000-0000-0000-0000-000000000001';
-- One real outgoing ownership transfer.
update intelligence_objects set responsible_ref='{"kind":"member","ref":"cccc0000-0000-0000-0000-000000000002"}'
 where id='eeee0000-0000-0000-0000-000000000001';
update handoff_period set end_at=clock_timestamp();
select set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"bbbb0000-0000-0000-0000-000000000001","role":"authenticated"}',false);
set role authenticated;
do $$ declare t uuid:='aaaa0000-0000-0000-0000-000000000001'; m uuid:='cccc0000-0000-0000-0000-000000000001';
 p uuid:='dddd0000-0000-0000-0000-000000000002'; r uuid:='ffff0000-0000-0000-0000-000000000001'; a timestamptz; b timestamptz; ack jsonb; begin
 select start_at,end_at into a,b from handoff_period;
 ack:=learn_work_handoffs_collect(t,m,p,1,a,b,r,'Synthetic capture review');
 assert ack->>'reused'='false';
 assert (select value=1 and review_state='inferred' and sample_count=1 and covered_count=1 and eligible_count=1
   from measurements where id=r), 'Real snapshots produce one handoff; alias change does not count';
 assert (select jsonb_array_length(proof->'credited')=1 from learn_work_measurement_runs where id=r);
 ack:=learn_work_handoffs_collect(t,m,p,1,a,b,r,'Synthetic capture review');
 assert ack->>'reused'='true';
 begin perform learn_work_handoffs_collect(t,m,p,1,a,b,r,'Changed retry'); raise exception 'Unexpected changed retry';
 exception when serialization_failure then null; end;
 begin perform learn_work_handoffs_collect(t,m,p,1,a,b,'ffff0000-0000-0000-0000-000000000002','Duplicate cell');raise exception 'Unexpected second observation';
 exception when serialization_failure then null; end;
 begin perform learn_work_handoffs_collect('aaaa0000-0000-0000-0000-000000000002',m,p,1,a,b,r,'Foreign tenant');raise exception 'Unexpected foreign collection';
 exception when insufficient_privilege then null; end;
 perform learn_performance_review(t,r,'ffff0000-0000-0000-0000-000000000003',0,'confirmed','Synthetic reviewer checked source events');
 assert (select review_state='inferred' from measurements where id=r), 'Human review never changes the source row';
 assert exists(select 1 from learn_performance_reviews where measurement_id=r and decision='confirmed');
end $$;
reset role;
-- Add a pre-existing unobserved work item: missing coverage must withhold value.
alter table intelligence_objects disable trigger learn_capture_work_change;
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status) values
 ('eeee0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001','serviceos','Action','action','Unobserved legacy item','ready');
alter table intelligence_objects enable trigger learn_capture_work_change;
set role authenticated;
do $$ declare a timestamptz; b timestamptz; begin
 select start_at-interval '1 second',end_at into a,b from handoff_period;
 perform learn_work_handoffs_collect('aaaa0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001',
 'dddd0000-0000-0000-0000-000000000002',1,a,b,'ffff0000-0000-0000-0000-000000000004','Incomplete evidence fixture');
 assert (select value is null and source_through is null and eligible_count=2 and covered_count=1
   from measurements where id='ffff0000-0000-0000-0000-000000000004'), 'Incomplete work never becomes zero';
 assert not has_function_privilege('authenticated','learn_performance_append(uuid,jsonb,text)','execute');
 assert not has_table_privilege('authenticated','learn_work_measurement_runs','insert');
end $$;
reset role;
-- Mutation and privacy checks use actual table/RPC permissions.
update profiles set role='viewer' where id='bbbb0000-0000-0000-0000-000000000001';
set role authenticated;
do $$ begin
 assert (select count(*) from learn_work_measurement_runs)=0;
 begin perform learn_work_handoffs_collect('aaaa0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001',
 'dddd0000-0000-0000-0000-000000000002',1,now()-interval '1 day',now(),'ffff0000-0000-0000-0000-000000000005','Viewer denied');
 raise exception 'Unexpected viewer collection'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update profiles set role='owner' where id='bbbb0000-0000-0000-0000-000000000001';
do $$ begin
 begin update learn_work_measurement_runs set explanation='Edited';raise exception 'Unexpected evidence edit';
 exception when object_not_in_prerequisite_state then null; end;
 assert (select count(*) from measurements)=2;
 assert (select count(*) from learn_work_measurement_runs)=2;
end $$;
-- An append failure rolls back its retained calculation receipt as well.
create function test_handoff_append_failure() returns trigger language plpgsql as $$
begin raise exception 'Synthetic measurement append failure'; end $$;
create trigger test_handoff_append_failure before insert on measurements
 for each row when(new.id='ffff0000-0000-0000-0000-000000000008') execute function test_handoff_append_failure();
set role authenticated;
do $$ declare a timestamptz; b timestamptz; begin
 select start_at-interval '3 seconds',end_at into a,b from handoff_period;
 begin perform learn_work_handoffs_collect('aaaa0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001',
 'dddd0000-0000-0000-0000-000000000002',1,a,b,'ffff0000-0000-0000-0000-000000000008','Downstream rollback test');
 exception when raise_exception then null; end;
 assert not exists(select 1 from learn_work_measurement_runs where id='ffff0000-0000-0000-0000-000000000008');
 assert not exists(select 1 from measurements where id='ffff0000-0000-0000-0000-000000000008');
end $$;
reset role;
drop trigger test_handoff_append_failure on measurements;
drop function test_handoff_append_failure();
