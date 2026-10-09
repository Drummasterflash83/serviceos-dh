-- Only the two classification columns from the subsequent action-loop schema
-- are needed by this fixture; action types remain registry data, not hardcoded.
alter table intelligence_objects add column object_class text;
alter table domain_object_types add column object_class text;
insert into domain_object_types(domain,object_type,label,object_class) values('serviceos','Action','Action','action');
insert into tenants values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into profiles values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner');
insert into team_members values
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',now()-interval '1 day',null,now()),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',now()-interval '1 day',null,now());
insert into objectives values
  ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
insert into intelligence_objects(id,tenant_id,domain,object_type,subject,status,responsible_ref,attributes) values
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','serviceos','Action','Synthetic work','ready',
   '{"kind":"user","ref":"20000000-0000-4000-8000-000000000001"}','{"done_when":"Synthetic proof"}'),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','serviceos','Action','Concurrent synthetic work','ready',null,'{}');
insert into state_transitions(domain,object_type,from_state,to_state) values
  ('serviceos','Action','ready','in_progress'),('serviceos','Action','in_progress','waiting');
insert into object_state_history(tenant_id,object_id,from_state,to_state) values
  ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',null,'ready');

do $$
declare
  t uuid := '10000000-0000-4000-8000-000000000001';
  o uuid := '40000000-0000-4000-8000-000000000001';
  h jsonb := '{"verb":"start","actor":{"user_id":"20000000-0000-4000-8000-000000000001"},"reason":"synthetic"}';
  r jsonb; n int; failed boolean;
begin
  assert not has_function_privilege('authenticated','work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb)','EXECUTE'), 'client cannot bypass Edge authority';
  assert not has_function_privilege('anon','work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb)','EXECUTE'), 'anonymous cannot bypass Edge';
  assert has_function_privilege('service_role','work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb)','EXECUTE'), 'trusted handler can persist';
  r := work_transition_apply(t,o,1,'in_progress','{}',h,null);
  assert (r->>'version')::int=2, 'atomic version advances';
  assert (select status='in_progress' and version=2 from intelligence_objects where id=o), 'canonical state advances';
  assert (select work_before->>'status'='ready' and work_after->>'status'='in_progress'
    and work_before->'responsible_ref'=work_after->'responsible_ref'
    and (work_before->>'version')::int=1 and (work_after->>'version')::int=2
    and actor->>'user_id'='20000000-0000-4000-8000-000000000001'
    from object_state_history where id=(r->>'history_id')::uuid), 'history stores actual ownership and versions';
  assert (select count(*) from object_state_history where object_id=o and work_before is null)=1, 'legacy history untouched';
  select count(*) into n from object_state_history where object_id=o;
  failed:=false;
  begin perform work_transition_apply(t,o,1,'in_progress','{}',h,null);
  exception when sqlstate 'P0409' then failed:=true; end;
  assert failed, 'repeated/stale expected version conflicts';
  assert (select count(*) from object_state_history where object_id=o)=n, 'stale request adds no false history';

  failed:=false;
  begin perform work_transition_apply(t,o,2,'waiting','{}',h,
    '{"objective_id":"50000000-0000-4000-8000-000000000001","relation":"reject-fixture"}');
  exception when check_violation then failed:=true; end;
  assert failed, 'fixture forces downstream link failure';
  assert (select version=2 and status='in_progress' from intelligence_objects where id=o), 'link failure rolls back object';
  assert (select count(*) from object_state_history where object_id=o)=n, 'link failure rolls back history';

  failed:=false;
  begin perform work_transition_apply(t,o,2,'waiting','{}',h,
    '{"objective_id":"50000000-0000-4000-8000-000000000002","relation":"supports"}');
  exception when invalid_parameter_value then failed:=true; end;
  assert failed, 'foreign objective rejected';
  failed:=false;
  begin perform work_transition_apply(t,o,2,'in_progress',
    '{"responsible_ref":{"kind":"member","ref":"30000000-0000-4000-8000-000000000002"}}',h,null);
  exception when invalid_parameter_value then failed:=true; end;
  assert failed, 'foreign member rejected';
  failed:=false;
  begin perform work_transition_apply(t,o,2,'complete','{}',h,null);
  exception when invalid_parameter_value then failed:=true; end;
  assert failed, 'illegal state move rejected';

  r:=work_transition_apply(t,o,2,'in_progress',
    '{"responsible_ref":{"kind":"member","ref":"30000000-0000-4000-8000-000000000001"}}',
    h||'{"verb":"assign"}'::jsonb,null);
  assert (select work_before->'responsible_ref'->>'kind'='user'
    and work_after->'responsible_ref'->>'kind'='member' and transition_verb='assign'
    from object_state_history where id=(r->>'history_id')::uuid), 'same-state assignment retains both owners';
  failed:=false;
  begin update object_state_history set work_after='{}' where id=(r->>'history_id')::uuid;
  exception when raise_exception then failed:=true; end;
  assert failed, 'structured history cannot be rewritten';
  failed:=false;
  begin delete from object_state_history where id=(r->>'history_id')::uuid;
  exception when raise_exception then failed:=true; end;
  assert failed, 'structured history cannot be deleted';
  failed:=false;
  begin insert into object_state_history(tenant_id,object_id,to_state,transition_verb,work_before)
    values(t,o,'in_progress','start','{}');
  exception when check_violation then failed:=true; end;
  assert failed, 'partial snapshots cannot pretend to be complete history';
  insert into view_as_context values('20000000-0000-4000-8000-000000000001',null,now()+interval '1 hour');
  failed:=false;
  begin perform work_transition_apply(t,o,3,'waiting','{}',h,null);
  exception when insufficient_privilege then failed:=true; end;
  assert failed, 'active View-As blocks the transaction';
  delete from view_as_context;
  raise notice 'LEARN WORK HISTORY: all synthetic assertions passed';
end $$;
