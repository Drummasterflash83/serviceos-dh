-- Offline synthetic volume exceeds the observed 14,394-item production population.
create table batch_original as select
 (select md5(string_agg(to_jsonb(x)::text,'|' order by id)) from measurements x) measurements,
 (select md5(string_agg(to_jsonb(x)::text,'|' order by id)) from learn_work_measurement_runs x) members,
 (select md5(string_agg(to_jsonb(x)::text,'|' order by id)) from learn_team_work_measurement_runs x) teams;
insert into tenants(id,slug,display_name,industry) values('aaa40000-0000-0000-0000-000000000004','batch-work','Batch Work','hvac');
insert into auth.users(id,email,is_sso_user,is_anonymous) values
 ('bbb40000-0000-0000-0000-000000000004','batch-owner@test.invalid',false,false),
 ('bbb40000-0000-0000-0000-000000000005','batch-other@test.invalid',false,false);
update profiles set tenant_id='aaa40000-0000-0000-0000-000000000004',role='owner' where id in ('bbb40000-0000-0000-0000-000000000004','bbb40000-0000-0000-0000-000000000005');
insert into org_units(id,tenant_id,kind,name) values ('aaa40000-0000-0000-0000-000000000041','aaa40000-0000-0000-0000-000000000004','team','Batch team');
insert into team_members(id,tenant_id,org_unit_id,profile_id,display_name,confirmed_at,effective_from) values
 ('ccc40000-0000-0000-0000-000000000041','aaa40000-0000-0000-0000-000000000004','aaa40000-0000-0000-0000-000000000041','bbb40000-0000-0000-0000-000000000004','Batch member',clock_timestamp(),now()-interval '1 day');
insert into config_versions(id,tenant_id,artifact_kind,artifact_key,version,status) values
 ('ddd40000-0000-0000-0000-000000000041','aaa40000-0000-0000-0000-000000000004','learn_scorecard','batch-team',1,'draft'),
 ('ddd40000-0000-0000-0000-000000000042','aaa40000-0000-0000-0000-000000000004','learn_scorecard','batch-member',1,'draft');
insert into operating_profile_entries(tenant_id,namespace,scope_kind,scope_ref,key,version_id,value) values
 ('aaa40000-0000-0000-0000-000000000004','learn_scorecards','tenant','team:all','definition.batch-team','ddd40000-0000-0000-0000-000000000041',
 '{"id":"ddd40000-0000-0000-0000-000000000043","tenantId":"aaa40000-0000-0000-0000-000000000004","version":1,"name":"Batch team","status":"draft","subjectKind":"team","groupId":null,"scaleMax":100,"metrics":[{"key":"work.team_owned_item_minutes","label":"Team ownership","unit":"item_minutes","weight":1,"zeroAt":0,"fullAt":5,"minSamples":1,"minCoverage":1,"maxAgeHours":72,"sourceSystems":["serviceos.work.team-residence@1"]}]}'),
 ('aaa40000-0000-0000-0000-000000000004','learn_scorecards','tenant','member:all','definition.batch-member','ddd40000-0000-0000-0000-000000000042',
 '{"id":"ddd40000-0000-0000-0000-000000000044","tenantId":"aaa40000-0000-0000-0000-000000000004","version":1,"name":"Batch member","status":"draft","subjectKind":"member","groupId":null,"scaleMax":100,"metrics":[{"key":"work.owned_item_minutes","label":"Ownership","unit":"item_minutes","weight":1,"zeroAt":0,"fullAt":5,"minSamples":1,"minCoverage":1,"maxAgeHours":72,"sourceSystems":["serviceos.work.residence@1"]},{"key":"work.recorded_handoffs","label":"Handoffs","unit":"handoffs","weight":0,"zeroAt":0,"fullAt":5,"minSamples":1,"minCoverage":1,"maxAgeHours":72,"sourceSystems":["serviceos.work.handoffs@1"]}]}');
create table batch_period(start_at timestamptz,end_at timestamptz,expected numeric);
insert into batch_period values(clock_timestamp(),null,null);
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref)
 select ('eee40000-0000-0000-0004-'||lpad(n::text,12,'0'))::uuid,'aaa40000-0000-0000-0000-000000000004','serviceos','Action','action','Synthetic volume item','ready',
 '{"kind":"member","ref":"ccc40000-0000-0000-0000-000000000041"}'::jsonb from generate_series(1,14500) n;
update batch_period set end_at=clock_timestamp();
update batch_period set expected=(select sum(extract(epoch from batch_period.end_at-occurred_at)/60) from object_state_history where tenant_id='aaa40000-0000-0000-0000-000000000004' and capture_kind='insert');
grant select on batch_period to authenticated;
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';set role authenticated;
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000004';s timestamptz;e timestamptz;a jsonb;begin
 select start_at,end_at into s,e from batch_period;
 a:=learn_work_collection_begin(t,'teamResidence','aaa40000-0000-0000-0000-000000000041','ddd40000-0000-0000-0000-000000000043',1,s,e,'fff40000-0000-0000-0000-000000000041','Frozen volume');
 assert a->>'population'='14500' and a->>'processed'='0' and a->>'state'='collecting';
 assert a=learn_work_collection_begin(t,'teamResidence','aaa40000-0000-0000-0000-000000000041','ddd40000-0000-0000-0000-000000000043',1,s,e,'fff40000-0000-0000-0000-000000000041','Frozen volume');
 assert not exists(select 1 from measurements where id='fff40000-0000-0000-0000-000000000041');
 a:=learn_work_collection_step(t,'fff40000-0000-0000-0000-000000000041',0);
 assert a->>'processed'='100' and a->>'state'='collecting';
 assert a=learn_work_collection_step(t,'fff40000-0000-0000-0000-000000000041',0),'Lost reply retry must not process another batch';
 begin perform learn_work_collection_step(t,'fff40000-0000-0000-0000-000000000041',101);raise exception 'Future checkpoint admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_collection_begin(t,'teamResidence','aaa40000-0000-0000-0000-000000000041','ddd40000-0000-0000-0000-000000000043',1,s,e,'fff40000-0000-0000-0000-000000000042','Duplicate cell');raise exception 'Duplicate cell admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_collection_begin(t,'teamResidence','aaa40000-0000-0000-0000-000000000041','ddd40000-0000-0000-0000-000000000043',1,s,e,'fff40000-0000-0000-0000-000000000041','Changed request');raise exception 'Changed request admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_collection_step('aaa40000-0000-0000-0000-000000000003','fff40000-0000-0000-0000-000000000041',100);raise exception 'Foreign tenant admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- New work and later membership/work mutations happen between committed batches.
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref) values
 ('eee40000-0000-0000-0004-999999999999','aaa40000-0000-0000-0000-000000000004','serviceos','Action','action','After snapshot','ready','{"kind":"team","ref":"aaa40000-0000-0000-0000-000000000041"}');
update team_members set org_unit_id=null where id='ccc40000-0000-0000-0000-000000000041';
update intelligence_objects set responsible_ref=null where id='eee40000-0000-0000-0004-000000014500';
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000005';set role authenticated;
do $$begin begin perform learn_work_collection_step('aaa40000-0000-0000-0000-000000000004','fff40000-0000-0000-0000-000000000041',100);raise exception 'Other actor continued request';exception when insufficient_privilege then null;end;end $$;
reset role;
update profiles set role='viewer' where id='bbb40000-0000-0000-0000-000000000004';
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';set role authenticated;
do $$begin
 assert (select count(*)=0 from learn_work_collection_runs);
 begin perform learn_work_collection_step('aaa40000-0000-0000-0000-000000000004','fff40000-0000-0000-0000-000000000041',100);raise exception 'Revoked actor continued';exception when insufficient_privilege then null;end;
end $$;
reset role;update profiles set role='owner' where id='bbb40000-0000-0000-0000-000000000004';
set role authenticated;
do $$declare a jsonb;i integer:=100;begin
 loop
  a:=learn_work_collection_step('aaa40000-0000-0000-0000-000000000004','fff40000-0000-0000-0000-000000000041',i);
  exit when a->>'state'<>'collecting';i:=(a->>'processed')::int;
 end loop;
 assert a->>'state'='completed' and a->>'population'='14500' and a->>'processed'='14500';
 assert (select abs(value-(select expected from batch_period))<.00000001 and covered_count=14500 and sample_count=14500 and review_state='inferred' from measurements where id='fff40000-0000-0000-0000-000000000041'), 'Frozen 14,500-item duration must match independent total despite later writes';
 assert (select count(*)=14500 from learn_work_collection_items where run_id='fff40000-0000-0000-0000-000000000041' and result is not null);
 assert not exists(select 1 from learn_work_collection_items where run_id='fff40000-0000-0000-0000-000000000041' and object_id='eee40000-0000-0000-0004-999999999999');
 assert a=learn_work_collection_step('aaa40000-0000-0000-0000-000000000004','fff40000-0000-0000-0000-000000000041',14400);
end $$;
reset role;
do $$begin
 begin update learn_work_collection_items set result='{}' where run_id='fff40000-0000-0000-0000-000000000041' and ordinal=1;raise exception 'Changed evidence';exception when sqlstate '55000' then null;end;
 begin update learn_work_collection_runs set reason='Changed';raise exception 'Changed scope';exception when sqlstate '55000' then null;end;
 begin delete from learn_work_collection_runs;raise exception 'Deleted run';exception when sqlstate '55000' then null;end;
 begin truncate learn_work_collection_items;raise exception 'Truncated evidence';exception when sqlstate '55000' then null;end;
 assert (select measurements from batch_original)=(select md5(string_agg(to_jsonb(x)::text,'|' order by id)) from measurements x where tenant_id<>'aaa40000-0000-0000-0000-000000000004');
 assert (select members from batch_original)=(select md5(string_agg(to_jsonb(x)::text,'|' order by id)) from learn_work_measurement_runs x);
 assert (select teams from batch_original)=(select md5(string_agg(to_jsonb(x)::text,'|' order by id)) from learn_team_work_measurement_runs x);
end $$;
-- Completed evidence paginates without losing rows, and does not expose another tenant.
set role authenticated;
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000004';q uuid:='fff40000-0000-0000-0000-000000000041';a jsonb;n integer:=0;cursor integer:=0;begin
 assert learn_work_collection_status(t,q)->>'state'='completed';
 assert learn_work_collection_evidence(t,q,'overview')->'proof'->>'populationCount'='14500';
 assert learn_work_collection_evidence(t,q,'membership')->'data'->>'count'='1';
 assert jsonb_array_length(learn_work_collection_evidence(t,q,'teams')->'data')=1;
 loop
  a:=learn_work_collection_evidence(t,q,'items',cursor);n:=n+jsonb_array_length(a->'items');
  assert (a->'items'->0->>'ordinal')::int=cursor+1;
  exit when a->>'next' is null;cursor:=(a->>'next')::int;
 end loop;
 assert n=14500;
 begin perform learn_work_collection_evidence('aaaa0000-0000-0000-0000-000000000003',q,'items');raise exception 'Foreign proof admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Small complete population: compare all three calculations with existing collectors.
insert into tenants(id,slug,display_name,industry) values('aaa40000-0000-0000-0000-000000000006','batch-small','Batch Small','hvac');
insert into auth.users(id,email,is_sso_user,is_anonymous) values('bbb40000-0000-0000-0000-000000000006','batch-small@test.invalid',false,false);
update profiles set tenant_id='aaa40000-0000-0000-0000-000000000006',role='owner' where id='bbb40000-0000-0000-0000-000000000006';
insert into org_units(id,tenant_id,kind,name) values('aaa40000-0000-0000-0000-000000000061','aaa40000-0000-0000-0000-000000000006','team','Small team');
insert into team_members(id,tenant_id,org_unit_id,profile_id,display_name,confirmed_at,effective_from) values
 ('ccc40000-0000-0000-0000-000000000061','aaa40000-0000-0000-0000-000000000006','aaa40000-0000-0000-0000-000000000061','bbb40000-0000-0000-0000-000000000006','Small first',clock_timestamp(),now()-interval '1 day'),
 ('ccc40000-0000-0000-0000-000000000062','aaa40000-0000-0000-0000-000000000006','aaa40000-0000-0000-0000-000000000061',null,'Small next',clock_timestamp(),now()-interval '1 day');
insert into config_versions(id,tenant_id,artifact_kind,artifact_key,version,status) values
 ('ddd40000-0000-0000-0000-000000000061','aaa40000-0000-0000-0000-000000000006','learn_scorecard','small-team',1,'draft'),
 ('ddd40000-0000-0000-0000-000000000062','aaa40000-0000-0000-0000-000000000006','learn_scorecard','small-member',1,'draft');
insert into operating_profile_entries(tenant_id,namespace,scope_kind,scope_ref,key,version_id,value)
 select 'aaa40000-0000-0000-0000-000000000006',namespace,scope_kind,scope_ref,replace(key,'batch','small'),
 case scope_ref when 'team:all' then 'ddd40000-0000-0000-0000-000000000061'::uuid else 'ddd40000-0000-0000-0000-000000000062'::uuid end,
 value||jsonb_build_object('tenantId','aaa40000-0000-0000-0000-000000000006','id',case scope_ref when 'team:all' then 'ddd40000-0000-0000-0000-000000000063' else 'ddd40000-0000-0000-0000-000000000064' end)
 from operating_profile_entries where tenant_id='aaa40000-0000-0000-0000-000000000004';
create table batch_small_period(start_at timestamptz,end_at timestamptz);insert into batch_small_period values(clock_timestamp(),null);grant select on batch_small_period to authenticated;
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref)
 select ('eee40000-0000-0000-0006-'||lpad(n::text,12,'0'))::uuid,'aaa40000-0000-0000-0000-000000000006','serviceos','Action','action','Small work','ready','{"kind":"member","ref":"ccc40000-0000-0000-0000-000000000061"}'::jsonb from generate_series(1,3) n;
update intelligence_objects set responsible_ref='{"kind":"user","ref":"bbb40000-0000-0000-0000-000000000006"}' where id='eee40000-0000-0000-0006-000000000001';
update intelligence_objects set responsible_ref='{"kind":"member","ref":"ccc40000-0000-0000-0000-000000000062"}' where id='eee40000-0000-0000-0006-000000000001';
update batch_small_period set end_at=clock_timestamp();
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000006';set role authenticated;
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000006';m uuid:='ccc40000-0000-0000-0000-000000000061';p uuid:='ddd40000-0000-0000-0000-000000000064';g uuid:='aaa40000-0000-0000-0000-000000000061';gp uuid:='ddd40000-0000-0000-0000-000000000063';s timestamptz;e timestamptz;a jsonb;begin
 select start_at,end_at into s,e from batch_small_period;
 perform learn_work_handoffs_collect(t,m,p,1,s,e,'fff40000-0000-0000-0000-000000000061','Old handoffs');
 perform learn_work_residence_collect(t,m,p,1,s,e,'fff40000-0000-0000-0000-000000000062','Old residence');
 perform learn_team_work_residence_collect(t,g,gp,1,s,e,'fff40000-0000-0000-0000-000000000063','Old team');
 s:=s+interval '.000001 second';
 perform learn_work_collection_begin(t,'handoffs',m,p,1,s,e,'fff40000-0000-0000-0000-000000000064','New handoffs');
 perform learn_work_collection_begin(t,'residence',m,p,1,s,e,'fff40000-0000-0000-0000-000000000065','New residence');
 perform learn_work_collection_begin(t,'teamResidence',g,gp,1,s,e,'fff40000-0000-0000-0000-000000000066','New team');
 perform learn_work_collection_step(t,'fff40000-0000-0000-0000-000000000064',0);
 perform learn_work_collection_step(t,'fff40000-0000-0000-0000-000000000065',0);
 perform learn_work_collection_step(t,'fff40000-0000-0000-0000-000000000066',0);
 assert (select value=1 from measurements where id='fff40000-0000-0000-0000-000000000064');
 assert (select value from measurements where id='fff40000-0000-0000-0000-000000000064')=(select value from measurements where id='fff40000-0000-0000-0000-000000000061');
 assert (select value from measurements where id='fff40000-0000-0000-0000-000000000065')=(select value from measurements where id='fff40000-0000-0000-0000-000000000062');
 assert (select value from measurements where id='fff40000-0000-0000-0000-000000000066')=(select value from measurements where id='fff40000-0000-0000-0000-000000000063');
end $$;
reset role;
-- Uncaptured history remains unknown even if a baseline is added after freezing.
alter table intelligence_objects disable trigger learn_capture_work_change;
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status) values
 ('eee40000-0000-0000-0006-000000000004','aaa40000-0000-0000-0000-000000000006','serviceos','Action','action','Unknown before capture','ready');
alter table intelligence_objects enable trigger learn_capture_work_change;
set role authenticated;
do $$declare s timestamptz;e timestamptz;p jsonb;begin
 select start_at+interval '.000002 second',end_at into s,e from batch_small_period;
 perform learn_work_collection_begin('aaa40000-0000-0000-0000-000000000006','residence','ccc40000-0000-0000-0000-000000000061','ddd40000-0000-0000-0000-000000000064',1,s,e,'fff40000-0000-0000-0000-000000000067','Unknown history');
 begin perform learn_work_collection_evidence('aaa40000-0000-0000-0000-000000000006','fff40000-0000-0000-0000-000000000067','overview');raise exception 'Incomplete proof exposed as completed';exception when insufficient_privilege then null;end;
 select request_payload||jsonb_build_object('id','fff40000-0000-0000-0000-000000000068','evidence',jsonb_build_array(jsonb_build_object('table','learn_work_collection_runs','id','fff40000-0000-0000-0000-000000000067'))) into p from measurements where id='fff40000-0000-0000-0000-000000000065';
 begin perform learn_performance_append('aaa40000-0000-0000-0000-000000000006',p,'Cannot use unfinished evidence');raise exception 'Incomplete receipt used as measurement evidence';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$declare p jsonb;begin
 select request_payload||jsonb_build_object('id','fff40000-0000-0000-0000-000000000068','evidence',jsonb_build_array(jsonb_build_object('table','learn_work_collection_runs','id','fff40000-0000-0000-0000-000000000067'))) into p from measurements where id='fff40000-0000-0000-0000-000000000065';
 begin perform learn_performance_append('aaa40000-0000-0000-0000-000000000006',p,'Cannot use unfinished evidence');raise exception 'Internal append accepted incomplete evidence';exception when invalid_parameter_value then null;end;
end $$;
select learn_work_capture_baseline('aaa40000-0000-0000-0000-000000000006','eee40000-0000-0000-0006-000000000004');
create function test_batch_append_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic final append failure';end $$;
create trigger test_batch_append_failure before insert on measurements for each row when(new.id='fff40000-0000-0000-0000-000000000067') execute function test_batch_append_failure();
set role authenticated;
do $$declare failed boolean:=false;begin
 begin perform learn_work_collection_step('aaa40000-0000-0000-0000-000000000006','fff40000-0000-0000-0000-000000000067',0);exception when raise_exception then failed:=true;end;
 assert failed;
 assert (select processed=0 and state='collecting' from learn_work_collection_runs where id='fff40000-0000-0000-0000-000000000067');
 assert not exists(select 1 from learn_work_collection_items where run_id='fff40000-0000-0000-0000-000000000067' and result is not null);
 assert not exists(select 1 from measurements where id='fff40000-0000-0000-0000-000000000067');
end $$;
reset role;drop trigger test_batch_append_failure on measurements;drop function test_batch_append_failure();
set role authenticated;
do $$begin
 assert learn_work_collection_step('aaa40000-0000-0000-0000-000000000006','fff40000-0000-0000-0000-000000000067',0)->>'state'='completed';
 assert (select value is null and covered_count=3 and eligible_count=4 and source_through is null from measurements where id='fff40000-0000-0000-0000-000000000067');
end $$;
reset role;
-- Cancellation, View-As and newly saved rules preserve the original request scope.
set role authenticated;
do $$declare s timestamptz;e timestamptz;begin
 select start_at+interval '.000003 second',end_at into s,e from batch_small_period;
 perform learn_work_collection_begin('aaa40000-0000-0000-0000-000000000006','handoffs','ccc40000-0000-0000-0000-000000000061','ddd40000-0000-0000-0000-000000000064',1,s,e,'fff40000-0000-0000-0000-000000000069','Will abandon');
 assert learn_work_collection_abandon('aaa40000-0000-0000-0000-000000000006','fff40000-0000-0000-0000-000000000069','Owner stopped') ->>'state'='abandoned';
 assert learn_work_collection_step('aaa40000-0000-0000-0000-000000000006','fff40000-0000-0000-0000-000000000069',0)->>'state'='abandoned';
 perform learn_work_collection_begin('aaa40000-0000-0000-0000-000000000006','handoffs','ccc40000-0000-0000-0000-000000000061','ddd40000-0000-0000-0000-000000000064',1,s,e,'fff40000-0000-0000-0000-000000000070','A new revision will be saved');
end $$;
reset role;
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values('aaa40000-0000-0000-0000-000000000006','bbb40000-0000-0000-0000-000000000006','role','owner','Synthetic View-As');
set role authenticated;
do $$begin begin perform learn_work_collection_step('aaa40000-0000-0000-0000-000000000006','fff40000-0000-0000-0000-000000000070',0);raise exception 'View-As batch admitted';exception when insufficient_privilege then null;end;end $$;
reset role;update view_as_context set ended_at=clock_timestamp() where actor_user_id='bbb40000-0000-0000-0000-000000000006';
do $$declare denied boolean:=false;begin
 begin update operating_profile_entries set value=value||'{"name":"Changed draft"}' where tenant_id='aaa40000-0000-0000-0000-000000000006' and scope_ref='member:all';
 exception when sqlstate '55000' then denied:=sqlerrm like 'Scorecard revisions are immutable%';end;assert denied;
end $$;
set role authenticated;
do $$declare d jsonb;new_policy jsonb;s timestamptz;e timestamptz;begin
 select value into d from operating_profile_entries where tenant_id='aaa40000-0000-0000-0000-000000000006' and scope_ref='member:all';
 new_policy:=learn_scorecard_save_draft('aaa40000-0000-0000-0000-000000000006',1,(d-'id'-'version'-'status'-'tenantId')||'{"name":"New draft revision"}','New rules during collection');
 assert new_policy->>'version'='2';
 assert learn_work_collection_step('aaa40000-0000-0000-0000-000000000006','fff40000-0000-0000-0000-000000000070',0)->>'state'='completed';
 assert (select policy_revision=1 from measurements where id='fff40000-0000-0000-0000-000000000070');
 assert not exists(select 1 from measurements where id='fff40000-0000-0000-0000-000000000069');
 select start_at+interval '.000004 second',end_at into s,e from batch_small_period;
 perform learn_work_collection_begin('aaa40000-0000-0000-0000-000000000006','handoffs','ccc40000-0000-0000-0000-000000000061','ddd40000-0000-0000-0000-000000000064',1,s,e,'fff40000-0000-0000-0000-000000000071','Legacy collector will win');
 perform learn_work_handoffs_collect('aaa40000-0000-0000-0000-000000000006','ccc40000-0000-0000-0000-000000000061','ddd40000-0000-0000-0000-000000000064',1,s,e,'fff40000-0000-0000-0000-000000000072','Legacy observation');
 assert learn_work_collection_step('aaa40000-0000-0000-0000-000000000006','fff40000-0000-0000-0000-000000000071',0)->>'state'='superseded';
 assert not exists(select 1 from measurements where id='fff40000-0000-0000-0000-000000000071');
end $$;
reset role;

set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';set role authenticated;
do $$declare s timestamptz;e timestamptz;begin
 select start_at+interval '.000001 second',end_at into s,e from batch_period;
 perform learn_work_collection_begin('aaa40000-0000-0000-0000-000000000004','teamResidence','aaa40000-0000-0000-0000-000000000041','ddd40000-0000-0000-0000-000000000043',1,s,e,'fff40000-0000-0000-0000-000000000081','Concurrent batch');
end $$;
reset role;
