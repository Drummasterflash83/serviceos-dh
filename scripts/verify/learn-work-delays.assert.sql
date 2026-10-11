-- Synthetic delay lifecycle. No real sources or credentials in this database.
create table delay_before as select
 (select md5(string_agg(to_jsonb(x)::text,'' order by id)) from measurements x) measurements,
 (select md5(string_agg(to_jsonb(x)::text,'' order by id)) from learn_work_collection_runs x) runs,
 (select md5(string_agg(to_jsonb(x)::text,'' order by id)) from learn_work_calendar_versions x) calendars;
-- Actual capture is used; no invented historical ownership timestamps.
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref) values
 ('de1a0000-0000-4000-8000-000000000001','aaa40000-0000-0000-0000-000000000004','serviceos','Action','action','Synthetic supplier delay','waiting','{"kind":"member","ref":"ccc40000-0000-0000-0000-000000000041"}'),
 ('de1a0000-0000-4000-8000-000000000002','aaa40000-0000-0000-0000-000000000004','serviceos','Action','action','Another synthetic work item','ready',null),
 ('de1a0000-0000-4000-8000-000000000003','aaa40000-0000-0000-0000-000000000004','serviceos','Action','action','Synthetic interval union','waiting',null);
select pg_sleep(.02);
create table delay_fixture as select clock_timestamp() starts,null::timestamptz ends,null::uuid evidence,null::jsonb payload,null::jsonb first_snapshot;
select pg_sleep(.02);
update intelligence_objects set status='ready' where id='de1a0000-0000-4000-8000-000000000001';
select pg_sleep(.02);
update delay_fixture set ends=clock_timestamp(),evidence=(select id from object_state_history where object_id='de1a0000-0000-4000-8000-000000000001' and capture_kind='insert');
update delay_fixture set payload=jsonb_build_object('objectId','de1a0000-0000-4000-8000-000000000001','expectedRevision',0,'decision','approve','approvalId',null,'period',jsonb_build_object('start',starts,'end',ends),'label','Supplier wait','evidenceIds',jsonb_build_array(evidence),'reason','Owner reviewed the supplier delay');
grant select on delay_fixture to authenticated;
create table delay_source_before as select md5(string_agg(to_jsonb(x)::text,'' order by capture_sequence)) history from object_state_history x;
do $$declare role_name text;f record;begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  for f in select p.oid,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname like 'learn_work_delay_%' loop
   assert has_function_privilege(role_name,f.oid,'EXECUTE')=(role_name='authenticated' and f.proname in ('learn_work_delay_record','learn_work_delay_resolve','learn_work_delay_read','learn_work_delay_evidence'));
  end loop;
  assert not has_table_privilege(role_name,'learn_work_delay_events','INSERT,UPDATE,DELETE,TRUNCATE');
  assert not has_table_privilege(role_name,'learn_work_delay_cancellations','INSERT,UPDATE,DELETE,TRUNCATE');
 end loop;
end $$;
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';set role authenticated;
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000004';o uuid:='de1a0000-0000-4000-8000-000000000001';p jsonb;r jsonb;a jsonb;bad jsonb;begin
 select payload into p from delay_fixture;
 r:=learn_work_delay_read(t,o,0,null);assert r->>'through'='0' and r->'entries'='[]','Waiting alone must not create a delay approval';
 r:=learn_work_delay_resolve(t,'de1a0000-0000-4000-8000-000000000011',p,false);assert r->>'state'='pending';
 a:=learn_work_delay_record(t,'de1a0000-0000-4000-8000-000000000011',p);assert a->'entry'->>'revision'='1';
 assert a=learn_work_delay_record(t,'de1a0000-0000-4000-8000-000000000011',p),'Exact reply-loss retry must reuse approval';
 r:=learn_work_delay_resolve(t,'de1a0000-0000-4000-8000-000000000011',p,true);assert r->>'state'='recorded','Recovery cancellation cannot reverse an approved delay';
 r:=learn_work_delay_evidence(t,o,'de1a0000-0000-4000-8000-000000000011');assert r->'capture'->>'count'='2';assert r->'capture'->'events'->0->>'kind'='insert';
 begin perform learn_work_delay_record(t,'de1a0000-0000-4000-8000-000000000011',p||'{"reason":"Changed"}');raise exception 'Changed identity admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_delay_record(t,gen_random_uuid(),p);raise exception 'Stale head admitted';exception when sqlstate 'PT409' then null;end;
 p:=p||'{"expectedRevision":1}';
 foreach bad in array array[p-'label',p||'{"unexpected":true}',p||'{"reason":""}',p||'{"approvalId":"de1a0000-0000-4000-8000-000000000011"}',p||'{"expectedRevision":1.5}',p||'{"evidenceIds":[]}',p||jsonb_build_object('evidenceIds',p->'evidenceIds'||p->'evidenceIds'),p||'{"period":{"start":"2026-10-01T00:00:00","end":"2026-10-02T00:00:00Z"}}'] loop
  begin perform learn_work_delay_record(t,gen_random_uuid(),bad);raise exception 'Malformed approval admitted';exception when invalid_parameter_value then null;end;
 end loop;
 begin perform learn_work_delay_record(t,gen_random_uuid(),p||jsonb_build_object('evidenceIds',jsonb_build_array((select id from object_state_history where object_id='de1a0000-0000-4000-8000-000000000002' and capture_kind='insert'))));raise exception 'Other item evidence admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_work_delay_record(t,gen_random_uuid(),p||jsonb_build_object('evidenceIds',jsonb_build_array(gen_random_uuid())));raise exception 'Missing evidence admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_work_delay_record(t,gen_random_uuid(),p||jsonb_build_object('period',jsonb_build_object('start',clock_timestamp(),'end',clock_timestamp()+interval '1 day')));raise exception 'Future delay admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_work_delay_record(t,gen_random_uuid(),p||jsonb_build_object('period',jsonb_build_object('start',(select starts-interval '1 day' from delay_fixture),'end',(select ends from delay_fixture))));raise exception 'Unknown historical delay admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_work_delay_record('aaa40000-0000-0000-0000-000000000006',gen_random_uuid(),p);raise exception 'Foreign tenant admitted';exception when insufficient_privilege then null;end;
 r:=learn_work_delay_record(t,'de1a0000-0000-4000-8000-000000000012',p||'{"label":"Second overlapping cause","reason":"Separately reviewed overlapping supplier cause"}');assert r->'entry'->>'revision'='2';
 -- Freeze head 1: pagination cannot pull in a later approval or reversal.
 r:=learn_work_delay_read(t,o,0,1);assert r->>'through'='1' and r->>'next'='1' and jsonb_array_length(r->'entries')=1 and not (r->>'hasMore')::boolean;
end $$;
reset role;
update delay_fixture set first_snapshot=learn_work_delay_snapshot('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000001',starts,ends,clock_timestamp());
do $$declare s jsonb;begin select first_snapshot into s from delay_fixture;
 assert s->>'through'='2' and jsonb_array_length(s->'approvals')=2 and jsonb_array_length(s->'windows')=1,'Overlapping approvals must union once';
 assert (s->'windows'->0->>'start')::timestamptz=(select starts from delay_fixture) and (s->'windows'->0->>'end')::timestamptz=(select ends from delay_fixture);
end $$;
select pg_sleep(.002);
set role authenticated;
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000004';o uuid:='de1a0000-0000-4000-8000-000000000001';p jsonb;r jsonb;begin
 p:=jsonb_build_object('objectId',o,'expectedRevision',2,'decision','reverse','approvalId','de1a0000-0000-4000-8000-000000000011','period',null,'label',null,'evidenceIds','[]'::jsonb,'reason','Supplier delay was attributed incorrectly');
 r:=learn_work_delay_record(t,'de1a0000-0000-4000-8000-000000000013',p);assert r->'entry'->>'decision'='reverse' and r->'entry'->>'revision'='3';
 assert r=learn_work_delay_record(t,'de1a0000-0000-4000-8000-000000000013',p);
 assert learn_work_delay_resolve(t,'de1a0000-0000-4000-8000-000000000013',p,true)->>'state'='recorded';
 begin perform learn_work_delay_record(t,gen_random_uuid(),p||'{"expectedRevision":3}');raise exception 'Repeated reversal admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_delay_record(t,gen_random_uuid(),p||'{"expectedRevision":3,"approvalId":"de1a0000-0000-4000-8000-000000000013"}');raise exception 'Reversal of a reversal admitted';exception when sqlstate 'PT409' then null;end;
 p:=p||'{"expectedRevision":3,"approvalId":"de1a0000-0000-4000-8000-000000000012","reason":"Review remaining approval"}';
 r:=learn_work_delay_resolve(t,'de1a0000-0000-4000-8000-000000000014',p,true);assert r->>'state'='cancelled';
 assert r=learn_work_delay_resolve(t,'de1a0000-0000-4000-8000-000000000014',p,false);
 begin perform learn_work_delay_record(t,'de1a0000-0000-4000-8000-000000000014',p);raise exception 'Cancelled reversal arrived late';exception when sqlstate 'PT409' then null;end;
 r:=learn_work_delay_record(t,'de1a0000-0000-4000-8000-000000000015',p);assert r->'entry'->>'revision'='4';
 p:=(select payload from delay_fixture)||'{"expectedRevision":0}';
 assert learn_work_delay_resolve(t,'de1a0000-0000-4000-8000-000000000016',p,true)->>'state'='cancelled','Stale unsent approvals can end';
 begin perform learn_work_delay_record(t,'de1a0000-0000-4000-8000-000000000016',p);raise exception 'Cancelled approval arrived late';exception when sqlstate 'PT409' then null;end;
 r:=learn_work_delay_read(t,o,0,null);assert r->>'through'='4' and jsonb_array_length(r->'entries')=4;
 r:=learn_work_delay_read(t,o,2,2);assert r->'entries'='[]' and r->>'next'='2';
 begin perform learn_work_delay_read(t,o,0,999);raise exception 'Unknown fixed head admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_work_delay_evidence(t,'de1a0000-0000-4000-8000-000000000002','de1a0000-0000-4000-8000-000000000011');raise exception 'Other item proof admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_work_delay_snapshot(t,o,now()-interval '1 day',now(),now());raise exception 'Private snapshot exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$declare f record;s jsonb;begin select * into f from delay_fixture;
 s:=learn_work_delay_snapshot('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000001',f.starts,f.ends,clock_timestamp());
 assert s->'approvals'='[]' and s->'windows'='[]','Reversed approvals cannot exclude future calculations';
 assert f.first_snapshot=learn_work_delay_snapshot('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000001',f.starts,f.ends,(f.first_snapshot->>'observedAt')::timestamptz),'Earlier snapshot changed after reversal';
 begin update learn_work_delay_events set reason='rewrite';raise exception 'Event rewritten';exception when sqlstate '55000' then null;end;
 begin delete from learn_work_delay_events;raise exception 'Event deleted';exception when sqlstate '55000' then null;end;
 begin truncate learn_work_delay_cancellations;raise exception 'Cancellation removed';exception when sqlstate '55000' then null;end;
 assert (select measurements=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from measurements x) from delay_before);
 assert (select runs=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from learn_work_collection_runs x) from delay_before);
 assert (select calendars=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from learn_work_calendar_versions x) from delay_before);
 assert (select history=(select md5(string_agg(to_jsonb(x)::text,'' order by capture_sequence)) from object_state_history x) from delay_source_before);
end $$;
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000005';set role authenticated;
do $$begin
 begin perform learn_work_delay_resolve('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000011',(select payload from delay_fixture),false);raise exception 'Another owner recovered request';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';
update profiles set role='viewer' where id='bbb40000-0000-0000-0000-000000000004';set role authenticated;
do $$begin
 assert (select count(*)=0 from learn_work_delay_events);assert (select count(*)=0 from learn_work_delay_cancellations);
 begin perform learn_work_delay_read('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000001',0,null);raise exception 'Revoked access admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;update profiles set role='owner' where id='bbb40000-0000-0000-0000-000000000004';
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values('aaa40000-0000-0000-0000-000000000004','bbb40000-0000-0000-0000-000000000004','role','owner','Delay View-As assertion');
set role authenticated;
do $$begin
 begin perform learn_work_delay_record('aaa40000-0000-0000-0000-000000000004',gen_random_uuid(),'{}');raise exception 'View-As approved delay';exception when insufficient_privilege then null;end;
end $$;
reset role;update view_as_context set ended_at=clock_timestamp() where actor_user_id='bbb40000-0000-0000-0000-000000000004' and ended_at is null;
set request.jwt.claim.sub='';
do $$declare r text;denied boolean;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  execute 'set local role '||quote_ident(r);
  denied:=false;begin perform learn_work_delay_read('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000001',0,null);exception when insufficient_privilege then denied:=true;end;assert denied;
  denied:=false;begin perform learn_work_delay_record('aaa40000-0000-0000-0000-000000000004',gen_random_uuid(),'{}');exception when insufficient_privilege then denied:=true;end;assert denied;
  denied:=false;begin perform learn_work_delay_resolve('aaa40000-0000-0000-0000-000000000004',gen_random_uuid(),'{}',true);exception when insufficient_privilege then denied:=true;end;assert denied;
  denied:=false;begin perform learn_work_delay_evidence('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000001',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied;
  execute 'reset role';
 end loop;
end $$;
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000006';set role authenticated;
do $$begin assert (select count(*)=0 from learn_work_delay_events);assert (select count(*)=0 from learn_work_delay_cancellations);end $$;
reset role;

-- More than one page, built through the real owner RPC. A later reversal cannot
-- appear in a page pinned to the earlier head.
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';set role authenticated;
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000004';o uuid:='de1a0000-0000-4000-8000-000000000002';p jsonb;r jsonb;first_id uuid;begin
 p:=(select payload from delay_fixture)||jsonb_build_object('objectId',o,'evidenceIds',jsonb_build_array((select id from object_state_history where object_id=o and capture_kind='insert')));
 for i in 0..104 loop
  r:=learn_work_delay_record(t,gen_random_uuid(),p||jsonb_build_object('expectedRevision',i,'reason','Synthetic paging approval '||i));
  if i=0 then first_id:=(r->'entry'->>'id')::uuid;end if;
 end loop;
 r:=learn_work_delay_read(t,o,0,null);assert r->>'through'='105' and r->>'next'='100' and (r->>'hasMore')::boolean and jsonb_array_length(r->'entries')=100;
 perform learn_work_delay_record(t,gen_random_uuid(),jsonb_build_object('objectId',o,'expectedRevision',105,'decision','reverse','approvalId',first_id,'period',null,'label',null,'evidenceIds','[]'::jsonb,'reason','Later reversal must not enter a retained page'));
 r:=learn_work_delay_read(t,o,100,105);assert r->>'through'='105' and r->>'next'='105' and not (r->>'hasMore')::boolean and jsonb_array_length(r->'entries')=5;
 assert r->'entries'->0->>'revision'='101' and r->'entries'->4->>'revision'='105';
end $$;
-- Nested/overlapping/adjacent windows and a real gap: the union must retain two
-- intervals, not sum approval durations or bridge the gap.
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000004';o uuid:='de1a0000-0000-4000-8000-000000000003';p jsonb;f record;fractions numeric[][]:=array[[0,.3],[.1,.2],[.25,.5],[.5,.6],[.8,1]];begin
 select * into f from delay_fixture;
 p:=f.payload||jsonb_build_object('objectId',o,'evidenceIds',jsonb_build_array((select id from object_state_history where object_id=o and capture_kind='insert')));
 for i in 1..5 loop
  perform learn_work_delay_record(t,gen_random_uuid(),p||jsonb_build_object('expectedRevision',i-1,'period',jsonb_build_object('start',f.starts+(f.ends-f.starts)*fractions[i][1]::double precision,'end',f.starts+(f.ends-f.starts)*fractions[i][2]::double precision)));
 end loop;
end $$;
reset role;
create table delay_union_snapshot as select learn_work_delay_snapshot('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000003',starts,ends,clock_timestamp()) value from delay_fixture;
do $$declare s jsonb;f record;begin select * into f from delay_fixture;select value into s from delay_union_snapshot;
 assert jsonb_array_length(s->'windows')=2 and jsonb_array_length(s->'approvals')=5;
 assert (s->'windows'->0->>'start')::timestamptz=f.starts and (s->'windows'->0->>'end')::timestamptz=f.starts+(f.ends-f.starts)*.6;
 assert (s->'windows'->1->>'start')::timestamptz=f.starts+(f.ends-f.starts)*.8 and (s->'windows'->1->>'end')::timestamptz=f.ends;
 assert (select history=(select md5(string_agg(to_jsonb(x)::text,'' order by capture_sequence)) from object_state_history x) from delay_source_before);
end $$;
-- Excessive exclusion populations fail explicitly, never return a truncated set.
set role authenticated;
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000004';o uuid:='de1a0000-0000-4000-8000-000000000002';p jsonb;begin
 p:=(select payload from delay_fixture)||jsonb_build_object('objectId',o,'evidenceIds',jsonb_build_array((select id from object_state_history where object_id=o and capture_kind='insert')));
 for i in 106..1002 loop
  perform learn_work_delay_record(t,gen_random_uuid(),p||jsonb_build_object('expectedRevision',i,'reason','Synthetic evidence-bound approval '||i));
 end loop;
end $$;
reset role;
do $$declare f record;begin select * into f from delay_fixture;
 begin perform learn_work_delay_snapshot('aaa40000-0000-0000-0000-000000000004','de1a0000-0000-4000-8000-000000000002',f.starts,f.ends,clock_timestamp());raise exception 'Excessive delay snapshot silently admitted';exception when program_limit_exceeded then null;end;
end $$;
