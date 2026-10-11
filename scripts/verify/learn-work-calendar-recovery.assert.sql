-- Run only against the disposable synthetic calendar verification database.
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';set role authenticated;
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000004';d jsonb;p jsonb;r jsonb;again jsonb;bad jsonb;begin
 select definition into d from calendar_fixture;
 p:=jsonb_build_object('expectedRevision',0,'definition',d,'reason','Initial company hours');
 r:=learn_work_calendar_resolve(t,'save','ca140000-0000-4000-8000-000000000001',p,false);
 assert r->>'state'='recorded' and r->>'kind'='save' and r->'payload'=p and r->>'recordedAt' is not null;
 assert r=learn_work_calendar_resolve(t,'save','ca140000-0000-4000-8000-000000000001',p,true),'Cancellation cannot undo an already recorded save';
 begin perform learn_work_calendar_resolve(t,'save','ca140000-0000-4000-8000-000000000001',p||'{"reason":"Changed"}',false);raise exception 'Changed recovery admitted';exception when sqlstate 'PT409' then null;end;
 p:=jsonb_build_object('versionId','ca140000-0000-4000-8000-000000000001','expectedPublication',null,'reason','Approve future calendar');
 r:=learn_work_calendar_resolve(t,'publish','ca140000-0000-4000-8000-000000000011',p,false);
 assert r->>'state'='recorded' and r->>'kind'='publish' and r->'payload'=p;
 assert r=learn_work_calendar_resolve(t,'publish','ca140000-0000-4000-8000-000000000011',p,true),'Cancellation cannot retract published hours';
 begin perform learn_work_calendar_resolve(t,'publish','ca140000-0000-4000-8000-000000000001',p,true);raise exception 'Cross-kind recovery admitted';exception when sqlstate 'PT409' then null;end;
 -- Stale revisions can still be cancelled; resolution must not require current heads.
 p:=jsonb_build_object('expectedRevision',0,'definition',d,'reason','Unsure whether sent');
 r:=learn_work_calendar_resolve(t,'save','ca140000-0000-4000-8000-000000000021',p,false);
 assert r->>'state'='pending' and r->'recordedAt'='null';
 assert (select count(*)=0 from learn_work_calendar_cancellations);
 r:=learn_work_calendar_resolve(t,'save','ca140000-0000-4000-8000-000000000021',p,true);
 assert r->>'state'='cancelled' and r->>'recordedAt' is not null;
 assert r=learn_work_calendar_resolve(t,'save','ca140000-0000-4000-8000-000000000021',p,false);
 assert r=learn_work_calendar_resolve(t,'save','ca140000-0000-4000-8000-000000000021',p,true);
 begin perform learn_work_calendar_save(t,0,d,'ca140000-0000-4000-8000-000000000021','Unsure whether sent');raise exception 'Cancelled save appeared late';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_calendar_resolve(t,'save','ca140000-0000-4000-8000-000000000021',p||'{"reason":"Replacement"}',true);raise exception 'Cancelled identity replaced';exception when sqlstate 'PT409' then null;end;
 p:=jsonb_build_object('versionId','ca140000-0000-4000-8000-000000000002','expectedPublication','ca140000-0000-4000-8000-000000000011','reason','Unsent publication');
 r:=learn_work_calendar_resolve(t,'publish','ca140000-0000-4000-8000-000000000022',p,true);
 assert r->>'state'='cancelled';
 begin perform learn_work_calendar_publish(t,'ca140000-0000-4000-8000-000000000002','ca140000-0000-4000-8000-000000000011','ca140000-0000-4000-8000-000000000022','Unsent publication');raise exception 'Cancelled publication appeared late';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_calendar_save(t,2,d,'ca140000-0000-4000-8000-000000000022','Cross-kind cancelled id');raise exception 'Cancelled id reused by save';exception when sqlstate 'PT409' then null;end;
 foreach bad in array array[p-'expectedPublication',p||'{"unexpected":true}',p||'{"versionId":null}',p||'{"expectedPublication":false}',p||'{"reason":""}'] loop
  begin perform learn_work_calendar_resolve(t,'publish',gen_random_uuid(),bad,true);raise exception 'Malformed publication descriptor admitted';exception when invalid_parameter_value then null;end;
 end loop;
 p:=jsonb_build_object('expectedRevision',2,'definition',d,'reason','Future save');
 foreach bad in array array[p-'definition',p||'{"unexpected":true}',p||'{"expectedRevision":null}',p||'{"expectedRevision":-1}',p||'{"expectedRevision":1.5}',p||'{"expectedRevision":2147483647}',p||'{"reason":false}'] loop
  begin perform learn_work_calendar_resolve(t,'save',gen_random_uuid(),bad,true);raise exception 'Malformed save descriptor admitted';exception when invalid_parameter_value then null;end;
 end loop;
 begin perform learn_work_calendar_resolve(t,'other',gen_random_uuid(),p,true);raise exception 'Unknown kind admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_work_calendar_resolve(t,'save',gen_random_uuid(),p,null);raise exception 'Unknown action admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_work_calendar_resolve('aaa40000-0000-0000-0000-000000000006','save',gen_random_uuid(),p,true);raise exception 'Foreign tenant cancellation admitted';exception when insufficient_privilege then null;end;
 assert (select count(*)=2 from learn_work_calendar_versions);
 assert (select count(*)=2 from learn_work_calendar_publications);
 assert (select count(*)=2 from learn_work_calendar_cancellations);
end $$;
reset role;
do $$begin
 begin update learn_work_calendar_cancellations set kind='publish';raise exception 'Cancellation changed';exception when sqlstate '55000' then null;end;
 begin delete from learn_work_calendar_cancellations;raise exception 'Cancellation deleted';exception when sqlstate '55000' then null;end;
 begin truncate learn_work_calendar_cancellations;raise exception 'Cancellation truncated';exception when sqlstate '55000' then null;end;
end $$;
-- Exact actor identity is required even when another actor is also a company owner.
update profiles set tenant_id='aaa40000-0000-0000-0000-000000000004' where id='bbb40000-0000-0000-0000-000000000006';
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000006';set role authenticated;
do $$begin
 begin perform learn_work_calendar_resolve('aaa40000-0000-0000-0000-000000000004','save','ca140000-0000-4000-8000-000000000021',jsonb_build_object('expectedRevision',0,'definition',(select definition from calendar_fixture),'reason','Unsure whether sent'),true);raise exception 'Different actor recovered request';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;update profiles set tenant_id='aaa40000-0000-0000-0000-000000000006' where id='bbb40000-0000-0000-0000-000000000006';
set role authenticated;
do $$begin assert (select count(*)=0 from learn_work_calendar_cancellations);end $$;
reset role;set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';
update profiles set role='viewer' where id='bbb40000-0000-0000-0000-000000000004';set role authenticated;
do $$begin
 assert (select count(*)=0 from learn_work_calendar_cancellations);
 begin perform learn_work_calendar_resolve('aaa40000-0000-0000-0000-000000000004','save',gen_random_uuid(),'{}',true);raise exception 'Revoked recovery admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;update profiles set role='owner' where id='bbb40000-0000-0000-0000-000000000004';
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values('aaa40000-0000-0000-0000-000000000004','bbb40000-0000-0000-0000-000000000004','role','owner','Calendar recovery View-As');
set role authenticated;
do $$begin
 begin perform learn_work_calendar_resolve('aaa40000-0000-0000-0000-000000000004','save',gen_random_uuid(),'{}',true);raise exception 'View-As recovery admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;update view_as_context set ended_at=clock_timestamp() where actor_user_id='bbb40000-0000-0000-0000-000000000004' and ended_at is null;
set request.jwt.claim.sub='';
do $$declare r text;denied boolean;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  execute 'set local role '||quote_ident(r);
  denied:=false;begin perform learn_work_calendar_resolve('aaa40000-0000-0000-0000-000000000004','save',gen_random_uuid(),'{}',true);exception when insufficient_privilege then denied:=true;end;assert denied;
  execute 'reset role';
 end loop;
 assert (select measurements=(select md5(string_agg(to_jsonb(m)::text,'' order by id)) from measurements m) from calendar_before);
 assert (select runs=(select md5(string_agg(to_jsonb(m)::text,'' order by id)) from learn_work_collection_runs m) from calendar_before);
 assert (select history=(select md5(string_agg(to_jsonb(m)::text,'' order by capture_sequence)) from object_state_history m) from calendar_before);
end $$;
