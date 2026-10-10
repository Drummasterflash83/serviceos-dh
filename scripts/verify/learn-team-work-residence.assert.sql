-- Synthetic third tenant; earlier member regression records remain retained.
create table team_residence_baseline as select
 (select md5(string_agg(to_jsonb(m)::text,'|' order by id)) from measurements m) measurements,
 (select md5(string_agg(to_jsonb(r)::text,'|' order by id)) from learn_work_measurement_runs r) member_receipts;
insert into tenants(id,slug,display_name,industry) values
 ('aaaa0000-0000-0000-0000-000000000003','team-residence','Team residence','hvac');
insert into auth.users(id,email,is_sso_user,is_anonymous) values
 ('bbbb0000-0000-0000-0000-000000000003','team-residence@test.invalid',false,false);
update profiles set tenant_id='aaaa0000-0000-0000-0000-000000000003',role='owner' where id='bbbb0000-0000-0000-0000-000000000003';
insert into org_units(id,tenant_id,kind,name) values
 ('aaaa0000-0000-0000-0000-000000000011','aaaa0000-0000-0000-0000-000000000003','team','Office'),
 ('aaaa0000-0000-0000-0000-000000000012','aaaa0000-0000-0000-0000-000000000003','team','Field'),
 ('aaaa0000-0000-0000-0000-000000000013','aaaa0000-0000-0000-0000-000000000003','team','Empty team'),
 ('aaaa0000-0000-0000-0000-000000000014','aaaa0000-0000-0000-0000-000000000002','team','Foreign team');
insert into team_members(id,tenant_id,org_unit_id,profile_id,display_name,confirmed_at,effective_from) values
 ('cccc0000-0000-0000-0000-000000000011','aaaa0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000011','bbbb0000-0000-0000-0000-000000000003','Moving member',clock_timestamp(),now()-interval '1 day'),
 ('cccc0000-0000-0000-0000-000000000012','aaaa0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000011',null,'Office member',clock_timestamp(),now()-interval '1 day'),
 ('cccc0000-0000-0000-0000-000000000013','aaaa0000-0000-0000-0000-000000000003',null,null,'Ungrouped member',clock_timestamp(),now()-interval '1 day');
insert into config_versions(id,tenant_id,artifact_kind,artifact_key,version,status) values
 ('dddd0000-0000-0000-0000-000000000011','aaaa0000-0000-0000-0000-000000000003','learn_scorecard','team-residence',1,'draft');
insert into operating_profile_entries(tenant_id,namespace,scope_kind,scope_ref,key,version_id,value) values
 ('aaaa0000-0000-0000-0000-000000000003','learn_scorecards','tenant','team:all','definition.team-residence','dddd0000-0000-0000-0000-000000000011',
 '{"id":"dddd0000-0000-0000-0000-000000000012","tenantId":"aaaa0000-0000-0000-0000-000000000003","version":1,"name":"Team item minutes","status":"draft","subjectKind":"team","groupId":null,"scaleMax":100,"metrics":[{"key":"work.team_owned_item_minutes","label":"Team ownership load","unit":"item_minutes","weight":1,"zeroAt":0,"fullAt":5,"minSamples":1,"minCoverage":1,"maxAgeHours":72,"sourceSystems":["serviceos.work.team-residence@1"]}]}');
create table team_residence_period(start_at timestamptz,end_at timestamptz,transfer_at timestamptz);
insert into team_residence_period values(clock_timestamp(),null,null);
grant select on team_residence_period to authenticated;
select pg_sleep(.01);
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref) values
 ('eeee0000-0000-0000-0000-000000000011','aaaa0000-0000-0000-0000-000000000003','serviceos','Action','action','Moving member work','ready','{"kind":"member","ref":"cccc0000-0000-0000-0000-000000000011"}'),
 ('eeee0000-0000-0000-0000-000000000012','aaaa0000-0000-0000-0000-000000000003','serviceos','Action','action','Direct team work','waiting','{"kind":"org_unit","ref":"aaaa0000-0000-0000-0000-000000000011"}'),
 ('eeee0000-0000-0000-0000-000000000013','aaaa0000-0000-0000-0000-000000000003','serviceos','Action','action','Other member work','closed','{"kind":"member","ref":"cccc0000-0000-0000-0000-000000000012"}'),
 ('eeee0000-0000-0000-0000-000000000014','aaaa0000-0000-0000-0000-000000000003','serviceos','Action','action','Ungrouped work','ready','{"kind":"member","ref":"cccc0000-0000-0000-0000-000000000013"}');
select pg_sleep(.02);
update team_members set org_unit_id='aaaa0000-0000-0000-0000-000000000012' where id='cccc0000-0000-0000-0000-000000000011';
update intelligence_objects set responsible_ref='{"kind":"user","ref":"bbbb0000-0000-0000-0000-000000000003"}' where id='eeee0000-0000-0000-0000-000000000011';
select pg_sleep(.02);
update team_residence_period set end_at=clock_timestamp(),transfer_at=(select max(observed_at) from learn_member_history where member_id='cccc0000-0000-0000-0000-000000000011');
set request.jwt.claim.sub='bbbb0000-0000-0000-0000-000000000003';
set role authenticated;
do $$ declare t uuid:='aaaa0000-0000-0000-0000-000000000003'; a uuid:='aaaa0000-0000-0000-0000-000000000011';
 b uuid:='aaaa0000-0000-0000-0000-000000000012'; p uuid:='dddd0000-0000-0000-0000-000000000012'; r uuid:='ffff0000-0000-0000-0000-000000000021';
 s timestamptz; e timestamptz; x timestamptz; expected_a numeric; expected_b numeric;
begin
 select start_at,end_at,transfer_at into s,e,x from team_residence_period;
 select sum(extract(epoch from (case when object_id='eeee0000-0000-0000-0000-000000000011' then x else e end)-occurred_at)/60)
 into expected_a from object_state_history where tenant_id=t and capture_kind='insert' and object_id<>'eeee0000-0000-0000-0000-000000000014';
 expected_b:=extract(epoch from e-x)/60;
 perform learn_team_work_residence_collect(t,a,p,1,s,e,r,'Observed team load');
 perform learn_team_work_residence_collect(t,b,p,1,s,e,'ffff0000-0000-0000-0000-000000000022','Observed transfer to Field');
 assert (select abs(value-expected_a)<.00000001 and sample_count=4 and covered_count=4 and eligible_count=4 and subject_kind='team' and review_state='inferred' from measurements where id=r), 'Office duration must follow history including direct team work';
 assert (select abs(value-expected_b)<.00000001 from measurements where id='ffff0000-0000-0000-0000-000000000022'), 'Field time starts at observed transfer, not period start';
 assert (select team_id=a and proof->>'contract'='team-work-residence@1' from learn_team_work_measurement_runs where id=r);
 assert exists(select 1 from learn_team_work_measurement_runs q cross join lateral jsonb_array_elements(proof->'credited') z where q.id=r and z->>'owner' like 'team:%' and z->>'membershipEventId' is null);
 assert exists(select 1 from learn_team_work_measurement_runs q cross join lateral jsonb_array_elements(proof->'credited') z where q.id=r and z->>'owner' like 'member:%' and z->>'membershipEventId' is not null);
 assert exists(select 1 from learn_team_work_measurement_runs q cross join lateral jsonb_array_elements(proof->'credited') z where q.id=r and z->>'status'='closed');
 assert (learn_team_work_residence_collect(t,a,p,1,s,e,r,'Observed team load')->>'reused')::boolean;
 begin perform learn_team_work_residence_collect(t,a,p,1,s,e,r,'Changed'); raise exception 'Unexpected changed retry';exception when sqlstate 'PT409' then null;end;
 begin perform learn_team_work_residence_collect(t,a,p,1,s,e,'ffff0000-0000-0000-0000-000000000023','Second cell'); raise exception 'Unexpected duplicate';exception when sqlstate 'PT409' then null;end;
 begin perform learn_team_work_residence_collect(t,'aaaa0000-0000-0000-0000-000000000014',p,1,s,e,'ffff0000-0000-0000-0000-000000000023','Foreign team'); raise exception 'Unexpected foreign team';exception when invalid_parameter_value then null;end;
 begin perform learn_team_work_residence_collect('aaaa0000-0000-0000-0000-000000000002',a,p,1,s,e,r,'Foreign tenant'); raise exception 'Unexpected foreign tenant';exception when insufficient_privilege then null;end;
 perform learn_team_work_residence_collect(t,'aaaa0000-0000-0000-0000-000000000013',p,1,s,e,'ffff0000-0000-0000-0000-000000000024','Known empty team');
 assert (select value=0 and covered_count=4 from measurements where id='ffff0000-0000-0000-0000-000000000024');
 perform learn_performance_review(t,r,'ffff0000-0000-0000-0000-000000000025',0,'confirmed','Checked source intervals and observed affiliation');
 assert exists(select 1 from learn_performance_reviews where measurement_id=r and decision='confirmed');
 assert not has_function_privilege('service_role','learn_team_work_residence_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text)','execute');
 assert not has_table_privilege('authenticated','learn_team_work_measurement_runs','insert');
end $$;
reset role;
-- Team-specific policy binds the team itself, never a member's present group.
set role authenticated;
do $$ declare t uuid:='aaaa0000-0000-0000-0000-000000000003'; a uuid:='aaaa0000-0000-0000-0000-000000000011'; p jsonb; d jsonb; s timestamptz; e timestamptz; begin
 select value into d from operating_profile_entries where tenant_id=t and scope_ref='team:all';
 p:=learn_scorecard_save_draft(t,0,(d-'id'-'version'-'status'-'tenantId')||jsonb_build_object('groupId',a),'Specific team criteria');
 select start_at,end_at into s,e from team_residence_period;
 perform learn_team_work_residence_collect(t,a,(p->>'id')::uuid,1,s,e,'ffff0000-0000-0000-0000-000000000029','Team scoped evidence');
 assert (select group_ids=array[a] and subject_id=a from measurements where id='ffff0000-0000-0000-0000-000000000029');
 begin perform learn_team_work_residence_collect(t,'aaaa0000-0000-0000-0000-000000000012',(p->>'id')::uuid,1,s,e,'ffff0000-0000-0000-0000-000000000030','Wrong team rules');raise exception 'Unexpected wrong group';exception when invalid_parameter_value then null;end;
end $$;
reset role;
-- A later roster transfer cannot rewrite the earlier team's elapsed time.
update team_members set org_unit_id='aaaa0000-0000-0000-0000-000000000011' where id='cccc0000-0000-0000-0000-000000000011';
set role authenticated;
do $$ declare s timestamptz; e timestamptz; begin
 select start_at+interval '.001 second',end_at into s,e from team_residence_period;
 perform learn_team_work_residence_collect('aaaa0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000011','dddd0000-0000-0000-0000-000000000012',1,s,e,'ffff0000-0000-0000-0000-000000000026','Earlier period after later transfer');
 assert (select value from measurements where id='ffff0000-0000-0000-0000-000000000026')=(select value from measurements where id='ffff0000-0000-0000-0000-000000000021');
end $$;
reset role;
-- Membership expiry splits attribution even without a work ownership change.
update team_members set effective_to=clock_timestamp()+interval '.01 second' where id='cccc0000-0000-0000-0000-000000000012';
select pg_sleep(.02);
set role authenticated;
do $$ declare s timestamptz; e timestamptz:=statement_timestamp(); ending timestamptz; begin
 select start_at into s from team_residence_period;
 select effective_to into ending from team_members where id='cccc0000-0000-0000-0000-000000000012';
 perform learn_team_work_residence_collect('aaaa0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000011','dddd0000-0000-0000-0000-000000000012',1,s,e,'ffff0000-0000-0000-0000-000000000033','Expired member identity');
 assert (select value is null and covered_count=3 and eligible_count=4 from measurements where id='ffff0000-0000-0000-0000-000000000033');
 assert not exists(select 1 from learn_team_work_measurement_runs r cross join lateral jsonb_array_elements(proof->'credited') z where r.id='ffff0000-0000-0000-0000-000000000033' and z->>'owner'='member:cccc0000-0000-0000-0000-000000000012' and (z->>'end')::timestamptz>ending);
end $$;
reset role;
-- Missing work capture cannot become a zero or partial team aggregate.
alter table intelligence_objects disable trigger learn_capture_work_change;
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status) values
 ('eeee0000-0000-0000-0000-000000000015','aaaa0000-0000-0000-0000-000000000003','serviceos','Action','action','Unobserved legacy item','ready');
alter table intelligence_objects enable trigger learn_capture_work_change;
set role authenticated;
do $$ declare s timestamptz; e timestamptz; begin
 select start_at-interval '1 second',end_at into s,e from team_residence_period;
 perform learn_team_work_residence_collect('aaaa0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000011','dddd0000-0000-0000-0000-000000000012',1,s,e,'ffff0000-0000-0000-0000-000000000027','Missing work capture');
 assert (select value is null and source_through is null and covered_count=4 and eligible_count=5 from measurements where id='ffff0000-0000-0000-0000-000000000027');
 assert (select (proof->>'knownItemMinutes')::numeric>0 from learn_team_work_measurement_runs where id='ffff0000-0000-0000-0000-000000000027');
end $$;
reset role;
-- Revocation affects both observation authority and retained evidence visibility.
update profiles set role='viewer' where id='bbbb0000-0000-0000-0000-000000000003';
set role authenticated;
do $$ begin
 assert (select count(*) from learn_team_work_measurement_runs)=0;
 begin perform learn_team_work_residence_collect('aaaa0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000011','dddd0000-0000-0000-0000-000000000012',1,now()-interval '1 day',now(),'ffff0000-0000-0000-0000-000000000028','Viewer denied'); raise exception 'Unexpected viewer';exception when insufficient_privilege then null;end;
end $$;
reset role;
update profiles set role='owner' where id='bbbb0000-0000-0000-0000-000000000003';
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values ('aaaa0000-0000-0000-0000-000000000003','bbbb0000-0000-0000-0000-000000000003','role','owner','Synthetic View-As');
set role authenticated;
do $$ begin
 begin perform learn_team_work_residence_collect('aaaa0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000011','dddd0000-0000-0000-0000-000000000012',1,now()-interval '1 day',now(),'ffff0000-0000-0000-0000-000000000028','View-As denied'); raise exception 'Unexpected View-As';exception when insufficient_privilege then null;end;
end $$;
reset role;
update view_as_context set ended_at=clock_timestamp() where actor_user_id='bbbb0000-0000-0000-0000-000000000003';
create function test_team_append_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic team append failure';end $$;
create trigger test_team_append_failure before insert on measurements for each row when(new.id='ffff0000-0000-0000-0000-000000000028') execute function test_team_append_failure();
set role authenticated;
do $$ declare failed boolean:=false; begin
 begin perform learn_team_work_residence_collect('aaaa0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000011','dddd0000-0000-0000-0000-000000000012',1,now()-interval '1 day',now(),'ffff0000-0000-0000-0000-000000000028','Append must roll back');exception when raise_exception then failed:=true;end;
 assert failed;
 assert not exists(select 1 from learn_team_work_measurement_runs where id='ffff0000-0000-0000-0000-000000000028');
 assert not exists(select 1 from measurements where id='ffff0000-0000-0000-0000-000000000028');
end $$;
reset role;
drop trigger test_team_append_failure on measurements;
drop function test_team_append_failure();
do $$ begin
 begin update learn_team_work_measurement_runs set explanation='Changed';raise exception 'Unexpected mutation';exception when sqlstate '55000' then null;end;
 begin truncate learn_team_work_measurement_runs;raise exception 'Unexpected truncation';exception when sqlstate '55000' then null;end;
 assert (select measurements from team_residence_baseline)=(select md5(string_agg(to_jsonb(m)::text,'|' order by id)) from measurements m where tenant_id='aaaa0000-0000-0000-0000-000000000001');
 assert (select member_receipts from team_residence_baseline)=(select md5(string_agg(to_jsonb(r)::text,'|' order by id)) from learn_work_measurement_runs r);
end $$;
-- A directory group created later cannot validate an earlier dangling team reference.
create temporary table team_late_period as select clock_timestamp() as start_at,null::timestamptz as end_at;
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref) values
 ('eeee0000-0000-0000-0000-000000000016','aaaa0000-0000-0000-0000-000000000003','serviceos','Action','action','Unresolved team at capture','ready','{"kind":"team","ref":"aaaa0000-0000-0000-0000-000000000015"}');
select pg_sleep(.01);
update team_late_period set end_at=clock_timestamp();
insert into org_units(id,tenant_id,kind,name) values ('aaaa0000-0000-0000-0000-000000000015','aaaa0000-0000-0000-0000-000000000003','team','Later directory identity');
grant select on team_late_period to authenticated;
set role authenticated;
do $$ declare s timestamptz; e timestamptz; begin
 select start_at,end_at into s,e from team_late_period;
 perform learn_team_work_residence_collect('aaaa0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000015','dddd0000-0000-0000-0000-000000000012',1,s,e,'ffff0000-0000-0000-0000-000000000041','No retroactive directory identity');
 assert (select (proof->>'knownItemMinutes')::numeric=0 from learn_team_work_measurement_runs where id='ffff0000-0000-0000-0000-000000000041');
 assert exists(select 1 from learn_team_work_measurement_runs r cross join lateral jsonb_array_elements(proof->'items') z where r.id='ffff0000-0000-0000-0000-000000000041' and z->>'objectId'='eeee0000-0000-0000-0000-000000000016' and z->>'complete'='false');
end $$;
reset role;
