create table working_collection_before as select
 (select md5(string_agg(to_jsonb(x)::text,'' order by id)) from measurements x) measurements,
 (select md5(string_agg(to_jsonb(x)::text,'' order by id)) from learn_work_collection_runs x) runs,
 (select md5(string_agg(to_jsonb(x)::text,'' order by capture_sequence)) from object_state_history x) history;
insert into tenants(id,slug,display_name,industry) values('aaa50000-0000-4000-8000-000000000001','working-collection','Synthetic Working Collection','hvac');
insert into auth.users(id,email,is_sso_user,is_anonymous) values('bbb50000-0000-4000-8000-000000000001','working-owner@test.invalid',false,false);
update profiles set tenant_id='aaa50000-0000-4000-8000-000000000001',role='owner' where id='bbb50000-0000-4000-8000-000000000001';
insert into org_units(id,tenant_id,kind,name) values('ccc50000-0000-4000-8000-000000000001','aaa50000-0000-4000-8000-000000000001','team','Synthetic working team');
insert into team_members(id,tenant_id,org_unit_id,profile_id,display_name,confirmed_at,effective_from) values
 ('ddd50000-0000-4000-8000-000000000001','aaa50000-0000-4000-8000-000000000001','ccc50000-0000-4000-8000-000000000001','bbb50000-0000-4000-8000-000000000001','Synthetic working member',clock_timestamp(),now()-interval '1 day');
create table working_collection_fixture(member_policy jsonb,team_policy jsonb,starts timestamptz,ends timestamptz);
grant select,update,insert on working_collection_fixture to authenticated;
set request.jwt.claim.sub='bbb50000-0000-4000-8000-000000000001';set role authenticated;
do $$declare t uuid:='aaa50000-0000-4000-8000-000000000001';d jsonb;v jsonb;m jsonb;g jsonb;r jsonb;begin
 d:=jsonb_build_object('name','Synthetic always open','timezone','UTC','weekly',(select jsonb_agg(jsonb_build_object('day',day,'startMinute',0,'endMinute',1440)) from generate_series(1,7) day),'exceptions','[]'::jsonb);
 v:=learn_work_calendar_save(t,0,d,'ca150000-0000-4000-8000-000000000001','Synthetic calendar');
 perform learn_work_calendar_publish(t,'ca150000-0000-4000-8000-000000000001',null,'ca150000-0000-4000-8000-000000000002','Synthetic hours');
 d:='{"name":"Synthetic working rules","subjectKind":"member","groupId":null,"scaleMax":100,"metrics":[{"key":"work.working_item_minutes","label":"Selected work in opening hours","unit":"working_item_minutes","weight":1,"zeroAt":60,"fullAt":0,"minSamples":1,"minCoverage":1,"maxAgeHours":72,"sourceSystems":["serviceos.work.working-time@1"],"workStates":["ready","waiting"]}]}';
 m:=learn_scorecard_save_draft(t,0,d,'Synthetic member rules');
 d:=jsonb_set(jsonb_set(jsonb_set(d,'{subjectKind}','"team"'),'{metrics,0,key}','"work.team_working_item_minutes"'),'{metrics,0,sourceSystems}','["serviceos.work.team-working-time@1"]');
 g:=learn_scorecard_save_draft(t,0,d,'Synthetic team rules');
 insert into working_collection_fixture(member_policy,team_policy) values(m,g);
 begin perform learn_scorecard_save_draft(t,1,jsonb_set(d,'{metrics,0,workStates}','[]'),'Invalid empty states');raise exception 'Empty working states saved';exception when invalid_parameter_value then null;end;
 begin perform learn_scorecard_save_draft(t,1,jsonb_set(d,'{metrics,0,workStates}','["ready","ready"]'),'Repeated states');raise exception 'Repeated states saved';exception when invalid_parameter_value then null;end;
end $$;
reset role;
update working_collection_fixture set starts=clock_timestamp();
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref)
 select ('eee50000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aaa50000-0000-4000-8000-000000000001','serviceos','Action','action','Synthetic work '||n,'waiting',
 '{"kind":"member","ref":"ddd50000-0000-4000-8000-000000000001"}'::jsonb from generate_series(1,205) n;
select pg_sleep(.01);
update working_collection_fixture set ends=clock_timestamp();
set role authenticated;
do $$declare f working_collection_fixture%rowtype;t uuid:='aaa50000-0000-4000-8000-000000000001';p jsonb;r jsonb;begin
 select * into f from working_collection_fixture;
 p:=jsonb_build_object('objectId','eee50000-0000-4000-8000-000000000205','expectedRevision',0,'decision','approve','approvalId',null,
 'period',jsonb_build_object('start',(select occurred_at from object_state_history where object_id='eee50000-0000-4000-8000-000000000205' and capture_kind='insert'),'end',f.ends),
 'label','Synthetic waiting','reason','Synthetic full interval approval','evidenceIds',jsonb_build_array((select id from object_state_history where object_id='eee50000-0000-4000-8000-000000000205' and capture_kind='insert')));
 perform learn_work_delay_record(t,'de150000-0000-4000-8000-000000000001',p);
end $$;
-- Each API request is a separate committed statement, as in the real RPC path.
do $$declare f working_collection_fixture%rowtype;t uuid:='aaa50000-0000-4000-8000-000000000001';r jsonb;begin
 select * into f from working_collection_fixture;
 r:=learn_work_collection_begin(t,'workingTime','ddd50000-0000-4000-8000-000000000001',(f.member_policy->>'id')::uuid,1,f.starts,f.ends,'ff150000-0000-4000-8000-000000000001','Synthetic member working collection');
 assert r->>'population'='205' and r->>'processed'='0';
 assert r=learn_work_collection_begin(t,'workingTime','ddd50000-0000-4000-8000-000000000001',(f.member_policy->>'id')::uuid,1,f.starts,f.ends,'ff150000-0000-4000-8000-000000000001','Synthetic member working collection');
 perform learn_work_collection_begin(t,'teamWorkingTime','ccc50000-0000-4000-8000-000000000001',(f.team_policy->>'id')::uuid,1,f.starts,f.ends,'ff150000-0000-4000-8000-000000000002','Synthetic team working collection');
 r:=learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000001',0);
 assert r->>'state'='collecting' and r->>'processed'='100';
 assert r=learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000001',0),'Retry must not process next batch';
 assert not exists(select 1 from measurements where id='ff150000-0000-4000-8000-000000000001');
 -- Reversing after begin must not change the retained head for item 205.
 perform learn_work_delay_record(t,'de150000-0000-4000-8000-000000000002',jsonb_build_object('objectId','eee50000-0000-4000-8000-000000000205','expectedRevision',1,'decision','reverse',
 'approvalId','de150000-0000-4000-8000-000000000001','period',null,'label',null,'evidenceIds','[]'::jsonb,'reason','Synthetic reversal after collection snapshot'));
end $$;
reset role;
update intelligence_objects set status='closed',responsible_ref=null where id='eee50000-0000-4000-8000-000000000204';
update team_members set org_unit_id=null where id='ddd50000-0000-4000-8000-000000000001';
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status) values
 ('eee50000-0000-4000-8000-000000000206','aaa50000-0000-4000-8000-000000000001','serviceos','Action','action','After frozen population','ready');
set role authenticated;
do $$declare t uuid:='aaa50000-0000-4000-8000-000000000001';r jsonb;f working_collection_fixture%rowtype;v jsonb;begin
 select * into f from working_collection_fixture;
 perform learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000001',100);
 r:=learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000001',200);
 assert r->>'state'='completed' and r->>'population'='205' and r->>'processed'='205' and r->>'covered'='205';
 assert r=learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000001',200),'Finished retry must be stable';
 perform learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000002',0);
 perform learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000002',100);
 r:=learn_work_collection_step(t,'ff150000-0000-4000-8000-000000000002',200);
 assert r->>'state'='completed' and r->>'covered'='205';
 v:=learn_work_collection_evidence(t,'ff150000-0000-4000-8000-000000000001','calendar',0);
 assert v#>>'{data,calendar,complete}'='true' and v#>'{data,states}'='["ready","waiting"]';
 v:=learn_work_collection_evidence(t,'ff150000-0000-4000-8000-000000000001','workingItem',205);
 assert v#>>'{data,delayThrough}'='1' and jsonb_array_length(v#>'{data,delays,approvals}')=1,'Later reversal must not enter original receipt';
 assert (select result->>'assessedMicros'='0' from learn_work_collection_items where run_id='ff150000-0000-4000-8000-000000000001' and ordinal=205);
 assert (select result->>'assessedMicros'<>'0' from learn_work_collection_items where run_id='ff150000-0000-4000-8000-000000000001' and ordinal=204),'Later closed/unassigned state must not rewrite ownership';
 -- An ended-before-start request cannot subsequently collect.
 r:=learn_work_collection_abandon(t,'workingTime','ddd50000-0000-4000-8000-000000000001',(f.member_policy->>'id')::uuid,1,f.starts,f.ends,'ff150000-0000-4000-8000-000000000003','Never started','Synthetic cancel');
 assert r->>'state'='abandoned';
 assert r=learn_work_collection_begin(t,'workingTime','ddd50000-0000-4000-8000-000000000001',(f.member_policy->>'id')::uuid,1,f.starts,f.ends,'ff150000-0000-4000-8000-000000000003','Never started');
end $$;
reset role;
do $$declare total numeric;member_value numeric;team_value numeric;begin
 select sum((result->>'assessedMicros')::numeric) into total from learn_work_collection_items where run_id='ff150000-0000-4000-8000-000000000001';
 select value into member_value from measurements where id='ff150000-0000-4000-8000-000000000001';
 select value into team_value from measurements where id='ff150000-0000-4000-8000-000000000002';
 assert member_value=round(total/60000000,12) and member_value>0 and team_value=member_value,'Aggregate exact microseconds before rounding once';
 assert (select known_micros=total from learn_working_collection_runs where run_id='ff150000-0000-4000-8000-000000000001');
 begin update learn_working_collection_runs set known_micros=known_micros+1 where run_id='ff150000-0000-4000-8000-000000000001';raise exception 'Completed totals changed';exception when sqlstate '55000' then null;end;
 begin update learn_working_collection_items set delay_through=2 where run_id='ff150000-0000-4000-8000-000000000001' and ordinal=205;raise exception 'Frozen head changed';exception when sqlstate '55000' then null;end;
 begin truncate learn_working_collection_items;raise exception 'Working-time proof truncated';exception when sqlstate '55000' then null;end;
 assert (select measurements=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from measurements x where tenant_id<>'aaa50000-0000-4000-8000-000000000001') from working_collection_before);
 assert (select runs=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from learn_work_collection_runs x where tenant_id<>'aaa50000-0000-4000-8000-000000000001') from working_collection_before);
 assert (select history=(select md5(string_agg(to_jsonb(x)::text,'' order by capture_sequence)) from object_state_history x where tenant_id<>'aaa50000-0000-4000-8000-000000000001') from working_collection_before);
end $$;
-- The new migration must still execute the three original kinds correctly.
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000006';set role authenticated;
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000006';f batch_small_period%rowtype;k text;q uuid;p uuid;s uuid;r jsonb;begin
 select * into f from batch_small_period;
 foreach k in array array['handoffs','residence','teamResidence'] loop
  q:=case k when 'handoffs' then 'ff150000-0000-4000-8000-000000000011'::uuid when 'residence' then 'ff150000-0000-4000-8000-000000000012'::uuid else 'ff150000-0000-4000-8000-000000000013'::uuid end;
  p:=case when k='teamResidence' then 'ddd40000-0000-0000-0000-000000000063'::uuid else 'ddd40000-0000-0000-0000-000000000064'::uuid end;
  s:=case when k='teamResidence' then 'aaa40000-0000-0000-0000-000000000061'::uuid else 'ccc40000-0000-0000-0000-000000000061'::uuid end;
  perform learn_work_collection_begin(t,k,s,p,1,f.start_at+interval '.000017 second',f.end_at,q,'Original collector regression');
  r:=learn_work_collection_step(t,q,0);
  assert r->>'state'='completed';
  assert exists(select 1 from measurements m join learn_work_collection_runs c on c.id=m.id where m.id=q and m.value is not distinct from case when c.covered=c.eligible then c.known_value end),'Original coverage withholding must remain intact';
  assert not exists(select 1 from learn_working_collection_runs where run_id=q);
  assert not exists(select 1 from learn_working_collection_items where run_id=q);
 end loop;
end $$;
reset role;
-- Missing hours withhold a value even when no items existed in the period.
set request.jwt.claim.sub='bbb50000-0000-4000-8000-000000000001';set role authenticated;
do $$declare t uuid:='aaa50000-0000-4000-8000-000000000001';f working_collection_fixture%rowtype;r jsonb;q uuid;mode integer;begin
 select * into f from working_collection_fixture;
 for mode in 1..2 loop
  q:=case mode when 1 then 'ff150000-0000-4000-8000-000000000021'::uuid else 'ff150000-0000-4000-8000-000000000022'::uuid end;
  r:=learn_work_collection_begin(t,'workingTime','ddd50000-0000-4000-8000-000000000001',(f.member_policy->>'id')::uuid,1,
   f.starts-interval '1 day',case mode when 1 then f.starts-interval '1 hour' else f.ends end,q,'Missing or partial calendar');
  while r->>'state'='collecting' loop r:=learn_work_collection_step(t,q,(r->>'processed')::integer);end loop;
  assert r->>'state'='completed';
  assert (select value is null and source_through is null from measurements where id=q),'Missing hours must withhold the final value';
  assert (select calendar->>'complete'='false' from learn_working_collection_runs where run_id=q);
  if mode=1 then assert r->>'eligible'='0';else assert (r->>'eligible')::int>0;end if;
 end loop;
end $$;
reset role;
do $$declare role_name text;fn regprocedure;begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  assert not has_table_privilege(role_name,'learn_working_collection_runs','INSERT,UPDATE,DELETE,TRUNCATE');
  assert not has_table_privilege(role_name,'learn_working_collection_items','INSERT,UPDATE,DELETE,TRUNCATE');
  for fn in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
   ('learn_working_calendar_freeze','learn_working_delay_freeze','learn_working_rule_states','learn_working_collection_immutable') loop
   assert not has_function_privilege(role_name,fn,'EXECUTE');
  end loop;
 end loop;
end $$;
update profiles set role='viewer' where id='bbb50000-0000-4000-8000-000000000001';set role authenticated;
do $$begin
 assert not exists(select 1 from learn_working_collection_runs);
 assert not exists(select 1 from learn_working_collection_items);
 begin perform learn_work_collection_evidence('aaa50000-0000-4000-8000-000000000001','ff150000-0000-4000-8000-000000000001','calendar',0);raise exception 'Viewer read working hours';exception when insufficient_privilege then null;end;
 begin perform learn_work_collection_evidence('aaa50000-0000-4000-8000-000000000001','ff150000-0000-4000-8000-000000000001','workingItem',1);raise exception 'Viewer read working proof';exception when insufficient_privilege then null;end;
end $$;
reset role;update profiles set role='owner' where id='bbb50000-0000-4000-8000-000000000001';
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values('aaa50000-0000-4000-8000-000000000001','bbb50000-0000-4000-8000-000000000001','role','owner','Synthetic View-As');
set role authenticated;
do $$begin
 begin perform learn_work_collection_evidence('aaa50000-0000-4000-8000-000000000001','ff150000-0000-4000-8000-000000000001','workingItem',1);raise exception 'View-As read working inputs';exception when insufficient_privilege then null;end;
end $$;
reset role;update view_as_context set ended_at=clock_timestamp() where actor_user_id='bbb50000-0000-4000-8000-000000000001';
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000006';set role authenticated;
do $$begin
 assert not exists(select 1 from learn_working_collection_runs where tenant_id='aaa50000-0000-4000-8000-000000000001');
 assert not exists(select 1 from learn_working_collection_items where tenant_id='aaa50000-0000-4000-8000-000000000001');
 begin perform learn_work_collection_evidence('aaa50000-0000-4000-8000-000000000001','ff150000-0000-4000-8000-000000000001','workingItem',1);raise exception 'Foreign owner read working inputs';exception when insufficient_privilege then null;end;
end $$;
reset role;
