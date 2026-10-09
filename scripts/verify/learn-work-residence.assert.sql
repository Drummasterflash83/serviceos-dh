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
 ('dddd0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','learn_scorecard','residence-test',1,'draft');
insert into operating_profile_entries(tenant_id,namespace,scope_kind,scope_ref,key,version_id,value) values
 ('aaaa0000-0000-0000-0000-000000000001','learn_scorecards','tenant','member:all','definition.residence-test',
 'dddd0000-0000-0000-0000-000000000001',
 '{"id":"dddd0000-0000-0000-0000-000000000002","tenantId":"aaaa0000-0000-0000-0000-000000000001","version":1,
 "name":"Owned item minutes","status":"draft","subjectKind":"member","groupId":null,"scaleMax":100,
 "metrics":[{"key":"work.owned_item_minutes","label":"Elapsed owned item minutes","unit":"item_minutes","weight":1,
 "zeroAt":0,"fullAt":5,"minSamples":1,"minCoverage":1,"maxAgeHours":72,"sourceSystems":["serviceos.work.residence@1"]}]}');
insert into object_classes(class,label,description) values('action','Action','Synthetic action');
insert into domain_object_types(domain,object_type,label,object_class) values('serviceos','Action','Action','action');
create temporary table residence_period(start_at timestamptz,end_at timestamptz);
insert into residence_period values(clock_timestamp(),null);
grant select on residence_period to authenticated;
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref) values
 ('eeee0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','serviceos','Action','action','Concurrent item A','ready',
 '{"kind":"member","ref":"cccc0000-0000-0000-0000-000000000001"}'),
 ('eeee0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001','serviceos','Action','action','Concurrent item B','waiting',
 '{"kind":"user","ref":"bbbb0000-0000-0000-0000-000000000001"}');
-- Same identity under another reference and a closed state must not lose time.
update intelligence_objects set responsible_ref='{"kind":"user","ref":"bbbb0000-0000-0000-0000-000000000001"}',status='closed'
 where id='eeee0000-0000-0000-0000-000000000001';
select pg_sleep(0.02);
update residence_period set end_at=clock_timestamp();
set request.jwt.claim.sub='bbbb0000-0000-0000-0000-000000000001';
set role authenticated;
do $$ declare t uuid:='aaaa0000-0000-0000-0000-000000000001'; m uuid:='cccc0000-0000-0000-0000-000000000001';
 p uuid:='dddd0000-0000-0000-0000-000000000002'; r uuid:='ffff0000-0000-0000-0000-000000000001';
 a timestamptz; b timestamptz; expected numeric; actual numeric; ack jsonb;
begin
 select start_at,end_at into a,b from residence_period;
 -- Independent expected total: each item remained owned by the same person
 -- from actual insertion until the period end, despite alias/state changes.
 select sum(extract(epoch from b-occurred_at)/60) into expected from object_state_history
 where tenant_id=t and capture_kind='insert';
 ack:=learn_work_residence_collect(t,m,p,1,a,b,r,'Review elapsed ownership evidence');
 assert ack->>'reused'='false';
 select value into actual from measurements where id=r;
 assert abs(actual-expected)<0.00000001, 'Concurrent item durations must add without rounding loss';
 assert actual>extract(epoch from b-a)/60, 'Item minutes are not employee hours worked';
 assert (select review_state='inferred' and unit='item_minutes' and sample_count=2 and covered_count=2 and eligible_count=2 from measurements where id=r);
 assert (select source_system='serviceos.work.residence@1' and metric_key='work.owned_item_minutes' and proof->>'contract'='work-residence@1'
   and jsonb_array_length(proof->'credited')=3 from learn_work_measurement_runs where id=r);
 assert exists(select 1 from learn_work_measurement_runs r cross join lateral jsonb_array_elements(r.proof->'credited') e where e->>'status'='closed');
 assert (learn_work_residence_collect(t,m,p,1,a,b,r,'Review elapsed ownership evidence')->>'reused')::boolean;
 begin perform learn_work_residence_collect(t,m,p,1,a,b,r,'Changed reason'); raise exception 'Unexpected changed retry';exception when serialization_failure then null;end;
 begin perform learn_work_residence_collect(t,m,p,1,a,b,'ffff0000-0000-0000-0000-000000000002','Duplicate cell');raise exception 'Unexpected duplicate';exception when serialization_failure then null;end;
 begin perform learn_work_handoffs_collect(t,m,p,1,a,b,r,'Review elapsed ownership evidence');raise exception 'Unexpected cross-adapter retry';exception when serialization_failure then null;end;
 begin perform learn_work_residence_collect('aaaa0000-0000-0000-0000-000000000002',m,p,1,a,b,r,'Foreign tenant');raise exception 'Unexpected tenant';exception when insufficient_privilege then null;end;
 perform learn_performance_review(t,r,'ffff0000-0000-0000-0000-000000000003',0,'confirmed','Checked synthetic elapsed intervals');
 assert exists(select 1 from learn_performance_reviews where measurement_id=r and decision='confirmed');
 -- Complete known population, but second member owned no items: supported zero.
 perform learn_work_residence_collect(t,'cccc0000-0000-0000-0000-000000000002',p,1,a,b,'ffff0000-0000-0000-0000-000000000004','Known zero ownership');
 assert (select value=0 and covered_count=2 from measurements where id='ffff0000-0000-0000-0000-000000000004');
end $$;
reset role;
-- Exact clipping between captures while both items remain owned.
set role authenticated;
do $$ declare a timestamptz; b timestamptz; begin
 select max(occurred_at) into a from object_state_history where capture_kind='update';
 select end_at into b from residence_period;
 a:=a+(b-a)/2;
 perform learn_work_residence_collect('aaaa0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001',
 'dddd0000-0000-0000-0000-000000000002',1,a,b,'ffff0000-0000-0000-0000-000000000011','Clipped period within stable ownership');
 assert (select abs(value-2*extract(epoch from b-a)/60)<0.00000001 from measurements where id='ffff0000-0000-0000-0000-000000000011');
end $$;
reset role;
do $$ declare roster jsonb; a timestamptz; b timestamptz; begin
 select start_at,end_at into a,b from residence_period;
 perform set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-000000000001',true);
 roster:=learn_member_history_read('aaaa0000-0000-0000-0000-000000000001',a,b);
 assert learn_handoff_owner('aaaa0000-0000-0000-0000-000000000001',roster,'{"ref":"cccc0000-0000-0000-0000-000000000001"}',a) is null;
end $$;
-- A membership effective boundary may occur without a work-history event.
-- Keep only one item assigned to the user reference, the other explicitly unowned.
update intelligence_objects set responsible_ref=null where id='eeee0000-0000-0000-0000-000000000001';
update team_members set effective_to=clock_timestamp()+interval '0.05 seconds'
 where id='cccc0000-0000-0000-0000-000000000001';
select pg_sleep(0.08);
update residence_period set end_at=clock_timestamp();
set role authenticated;
do $$ declare a timestamptz; b timestamptz; ending timestamptz; begin
 select start_at,end_at into a,b from residence_period;
 select effective_to into ending from team_members where id='cccc0000-0000-0000-0000-000000000001';
 perform learn_work_residence_collect('aaaa0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001',
 'dddd0000-0000-0000-0000-000000000002',1,a,b,'ffff0000-0000-0000-0000-000000000005','Historical membership ending');
 assert (select value is null and source_through is null and covered_count=1 and eligible_count=2 from measurements where id='ffff0000-0000-0000-0000-000000000005'),
 'Inactive unresolved ownership must withhold the aggregate';
 assert not exists(select 1 from learn_work_measurement_runs r cross join lateral jsonb_array_elements(proof->'credited') e
 where r.id='ffff0000-0000-0000-0000-000000000005' and (e->>'end')::timestamptz>ending), 'No attribution after membership ends';
 assert (select (proof->>'knownItemMinutes')::numeric>0 from learn_work_measurement_runs where id='ffff0000-0000-0000-0000-000000000005');
end $$;
reset role;
-- Missing capture is never rewritten as zero; late baseline cannot backfill.
alter table intelligence_objects disable trigger learn_capture_work_change;
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status) values
 ('eeee0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000001','serviceos','Action','action','Legacy without ownership evidence','ready');
alter table intelligence_objects enable trigger learn_capture_work_change;
set role authenticated;
do $$ declare a timestamptz; b timestamptz; begin
 select start_at-interval '1 second',end_at into a,b from residence_period;
 perform learn_work_residence_collect('aaaa0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000002',
 'dddd0000-0000-0000-0000-000000000002',1,a,b,'ffff0000-0000-0000-0000-000000000006','Incomplete population');
 assert (select value is null and source_through is null and eligible_count=3 from measurements where id='ffff0000-0000-0000-0000-000000000006');
 assert not has_function_privilege('service_role','learn_work_residence_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text)','execute');
end $$;
reset role;
-- Actual owner authority and View-As gates, plus transactional rollback.
update profiles set role='viewer' where id='bbbb0000-0000-0000-0000-000000000001';
set role authenticated;
do $$ begin
 assert (select count(*) from learn_work_measurement_runs)=0;
 begin perform learn_work_residence_collect('aaaa0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001',
 'dddd0000-0000-0000-0000-000000000002',1,now()-interval '1 day',now(),'ffff0000-0000-0000-0000-000000000007','Viewer denied');
 raise exception 'Unexpected viewer';exception when insufficient_privilege then null;end;
end $$;
reset role;
update profiles set role='owner' where id='bbbb0000-0000-0000-0000-000000000001';
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values
 ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000001','role','owner','Test View-As gate');
set role authenticated;
do $$ begin
 begin perform learn_work_residence_collect('aaaa0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001',
 'dddd0000-0000-0000-0000-000000000002',1,now()-interval '1 day',now(),'ffff0000-0000-0000-0000-000000000007','View-As denied');
 raise exception 'Unexpected View-As';exception when insufficient_privilege then null;end;
end $$;
reset role;
update view_as_context set ended_at=clock_timestamp() where ended_at is null;
create function test_residence_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic append failure';end $$;
create trigger test_residence_failure before insert on measurements for each row when(new.id='ffff0000-0000-0000-0000-000000000008') execute function test_residence_failure();
set role authenticated;
do $$ declare failed boolean:=false; begin
 begin perform learn_work_residence_collect('aaaa0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001',
 'dddd0000-0000-0000-0000-000000000002',1,now()-interval '1 day',now(),'ffff0000-0000-0000-0000-000000000008','Append rollback');
 exception when raise_exception then failed:=true;end;
 assert failed;
 assert not exists(select 1 from learn_work_measurement_runs where id='ffff0000-0000-0000-0000-000000000008');
 assert not exists(select 1 from measurements where id='ffff0000-0000-0000-0000-000000000008');
end $$;
reset role;
drop trigger test_residence_failure on measurements;
drop function test_residence_failure();
