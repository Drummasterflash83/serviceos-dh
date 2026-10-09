set "test.actor"='20000000-0000-4000-8000-000000000001';
set "test.tenant"='10000000-0000-4000-8000-000000000001';
-- Explicit baseline is service-only and repeatable. No old history is changed.
set role service_role;
select learn_work_capture_baseline('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001');
select learn_work_capture_baseline('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001');
reset role;
do $$ begin
  assert (select count(*) from object_state_history where object_id='40000000-0000-4000-8000-000000000001' and capture_kind is not null)=1,
    'repeated baseline creates one capture';
  assert (select count(*) from object_state_history where object_id='40000000-0000-4000-8000-000000000001' and work_before is null)=1,
    'legacy status row preserved';
  assert not has_function_privilege('authenticated','learn_work_capture_baseline(uuid,uuid)','EXECUTE'), 'client cannot invent coverage baselines';
end $$;

-- Oversized responses fail explicitly; neither the row budget nor the payload
-- budget may silently truncate evidence and claim complete coverage.
insert into intelligence_objects(id,tenant_id,domain,object_type,subject,status)
 values('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','serviceos','Action','Bounded history test','ready');
do $$ begin
  for i in 1..1000 loop
    update intelligence_objects set version=version+1 where id='40000000-0000-4000-8000-000000000004';
  end loop;
end $$;
do $$ declare failed boolean:=false; begin
  begin perform learn_work_history_read('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004',
    statement_timestamp()-interval '1 day',statement_timestamp());
  exception when program_limit_exceeded then failed:=true; end;
  assert failed, '1001 events cannot become a truncated complete result';
end $$;
insert into intelligence_objects(id,tenant_id,domain,object_type,subject,status,attributes)
 values('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','serviceos','Action','Payload limit test','ready',
   jsonb_build_object('description',repeat('x',1100000)));
do $$ declare failed boolean:=false; begin
  begin perform learn_work_history_read('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000005',
    statement_timestamp()-interval '1 day',statement_timestamp());
  exception when program_limit_exceeded then failed:=true; end;
  assert failed, 'oversized snapshots cannot become a truncated complete result';
end $$;
-- Background update deliberately does not advance the old object version.
update intelligence_objects set responsible_ref='{"kind":"user","ref":"20000000-0000-4000-8000-000000000001"}'
  where id='40000000-0000-4000-8000-000000000001';
do $$ begin
  assert (select count(*) from object_state_history where object_id='40000000-0000-4000-8000-000000000001' and capture_kind is not null)=2,
    'background ownership update is captured even without a version increment';
end $$;
select work_transition_apply('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',3,'waiting','{}',
  '{"verb":"wait","actor":{"user_id":"20000000-0000-4000-8000-000000000001"}}',null);
do $$ begin
  assert (select count(*) from object_state_history where object_id='40000000-0000-4000-8000-000000000001' and capture_kind is not null)=3,
    'governed transition creates exactly one source capture despite its separate attributed history row';
end $$;
-- Owner reads one coherent snapshot. The query cannot retrofit coverage before
-- the baseline; its start is the new capture time, not object.created_at.
set role authenticated;
select learn_work_history_read('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  statement_timestamp()-interval '1 day',statement_timestamp());
reset role;
do $$
declare r jsonb; failed boolean;
begin
  r:=learn_work_history_read('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
    statement_timestamp()-interval '1 day',statement_timestamp());
  assert (r->>'count')::int=3 and jsonb_array_length(r->'events')=3, 'read returns the complete bounded capture history';
  assert (r->>'coverageStart')::timestamptz > statement_timestamp()-interval '1 minute', 'baseline coverage begins now';
  assert r->'events'->0->>'kind'='baseline', 'earliest source is the honest current-state baseline';
  assert r->'events'->1->'before'->'responsible_ref'->>'kind'='member'
    and r->'events'->1->'after'->'responsible_ref'->>'kind'='user', 'background handoff retains both owners';
  failed:=false;
  begin perform learn_work_history_read('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',
    statement_timestamp()-interval '1 day',statement_timestamp());
  exception when insufficient_privilege then failed:=true; end;
  assert failed, 'foreign tenant rejected';
  failed:=false;
  begin perform learn_work_history_read('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
    statement_timestamp()-interval '1 day',statement_timestamp()+interval '1 hour');
  exception when invalid_parameter_value then failed:=true; end;
  assert failed, 'unfinished period rejected';
end $$;
update profiles set role='viewer' where id='20000000-0000-4000-8000-000000000001';
do $$ declare failed boolean:=false; begin
  begin perform learn_work_history_read('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
    statement_timestamp()-interval '1 day',statement_timestamp());
  exception when insufficient_privilege then failed:=true; end;
  assert failed, 'viewer cannot read performance-purpose history RPC';
end $$;
update profiles set role='owner' where id='20000000-0000-4000-8000-000000000001';

-- New objects start capture immediately; irrelevant subject-only edits do not
-- fabricate ownership events. A failed enclosing transaction rolls capture back.
insert into intelligence_objects(id,tenant_id,domain,object_type,subject,status)
 values('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','serviceos','Action','Capture test','ready');
update intelligence_objects set subject='Renamed' where id='40000000-0000-4000-8000-000000000003';
do $$ declare n int; begin
  select count(*) into n from object_state_history where object_id='40000000-0000-4000-8000-000000000003';
  assert n=1, 'insert observed once and subject-only change does not invent a handoff';
  begin
    update intelligence_objects set status='in_progress' where id='40000000-0000-4000-8000-000000000003';
    raise exception 'Synthetic rollback';
  exception when raise_exception then null; end;
  assert (select count(*) from object_state_history where object_id='40000000-0000-4000-8000-000000000003')=n, 'capture rolls back with source write';
end $$;
alter table intelligence_objects disable trigger learn_capture_work_change;
update intelligence_objects set status='blocked' where id='40000000-0000-4000-8000-000000000003';
do $$ declare failed boolean:=false; begin
  begin perform learn_work_history_read('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003',
    statement_timestamp()-interval '1 day',statement_timestamp());
  exception when object_not_in_prerequisite_state then failed:=true; end;
  assert failed, 'disabled capture cannot claim completeness';
end $$;
alter table intelligence_objects enable trigger learn_capture_work_change;
do $$ declare failed boolean:=false; begin
  begin perform learn_work_history_read('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003',
    statement_timestamp()-interval '1 day',statement_timestamp());
  exception when object_not_in_prerequisite_state then failed:=true; end;
  assert failed, 'uncaptured current state cannot claim completeness';
end $$;
update intelligence_objects set status='in_progress' where id='40000000-0000-4000-8000-000000000003';
do $$ declare failed boolean:=false; begin
  begin perform learn_work_history_read('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003',
    statement_timestamp()-interval '1 day',statement_timestamp());
  exception when object_not_in_prerequisite_state then failed:=true; end;
  assert failed, 'later capture does not hide a prior state gap';
  raise notice 'LEARN WORK CAPTURE: all synthetic assertions passed';
end $$;
