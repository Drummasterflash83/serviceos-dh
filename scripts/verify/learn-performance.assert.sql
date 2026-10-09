insert into tenants values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into team_members values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',null,now(),'2026-01-01',null);
insert into interactions values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002');
insert into config_versions(id,tenant_id,artifact_kind,version,status) values('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','learn_scorecard',1,'draft');
insert into operating_profile_entries(tenant_id,namespace,scope_kind,key,version_id,value) values
 ('00000000-0000-4000-8000-000000000001','learn_scorecards','tenant','definition.fixture','00000000-0000-4000-8000-000000000006',
 '{"id":"00000000-0000-4000-8000-000000000007","version":1,"subjectKind":"member","metrics":[{"key":"response.minutes","label":"Response time","unit":"minutes","sourceSystems":["communications"]}]}');
create table test_payload(p jsonb);
insert into test_payload values ('{
 "id":"00000000-0000-4000-8000-000000000008","tenantId":"00000000-0000-4000-8000-000000000001",
 "policyId":"00000000-0000-4000-8000-000000000007","policyVersion":1,
 "subject":{"kind":"member","id":"00000000-0000-4000-8000-000000000003"},
 "period":{"start":"2026-01-01T00:00:00Z","end":"2026-01-02T00:00:00Z"},
 "metricKey":"response.minutes","unit":"minutes","sourceSystem":"communications","value":30,
 "sampleCount":10,"coveredCount":10,"eligibleCount":12,"observedAt":"2026-01-03T00:00:00Z",
 "sourceThrough":"2026-01-02T00:00:00Z","review":"inferred","exclusions":[],
 "evidence":[{"table":"interactions","id":"00000000-0000-4000-8000-000000000004"}]}');
grant select on test_payload to service_role;
set role service_role;
do $$
declare t uuid:='00000000-0000-4000-8000-000000000001'; p jsonb; r jsonb; bad jsonb;
begin
 select test_payload.p into p from test_payload;
 r:=learn_performance_append(t,p,'Synthetic source adapter');
 if r->>'reused'<>'false' then raise exception 'Initial write reused'; end if;
 r:=learn_performance_append(t,p,'Synthetic source adapter');
 if r->>'reused'<>'true' then raise exception 'Replay duplicated'; end if;
 begin perform learn_performance_append(t,p||'{"value":99}','Synthetic source adapter');raise exception 'Changed replay accepted';exception when serialization_failure then null;end;
 begin perform learn_performance_append('00000000-0000-4000-8000-000000000002',p,'Foreign tenant');raise exception 'Foreign payload accepted';exception when invalid_parameter_value then null;end;
 p:=p||'{"id":"00000000-0000-4000-8000-000000000009"}';
 for bad in select value from jsonb_array_elements('[
 {"review":"confirmed"},{"unit":"seconds"},{"sourceSystem":"invented"},{"policyVersion":2},
 {"subject":{"kind":"member","id":"00000000-0000-4000-8000-000000000005"}},
 {"sampleCount":1.5},{"period":{"start":"2026-01-02","end":"2026-01-01"}},
 {"observedAt":"2099-01-01"},{"value":"NaN"},
 {"evidence":[]},{"evidence":[{"table":"interactions","id":"00000000-0000-4000-8000-000000000005"}]},
 {"evidence":[{"table":"profiles","id":"00000000-0000-4000-8000-000000000004"}]},
 {"exclusions":[{"reason":"Not eligible","count":2,"evidence":[]}]}]') loop
  begin perform learn_performance_append(t,p||bad,'Invalid fixture');raise exception 'Invalid observation accepted: %',bad;exception when invalid_parameter_value then null;end;
 end loop;
 begin perform learn_performance_append(t,p||'{"coveredCount":13}','Over coverage');raise exception 'Invalid counts accepted';exception when check_violation then null;end;
 begin perform learn_performance_append(t,p||'{"sampleCount":-1}','Negative counts');raise exception 'Negative count accepted';exception when check_violation then null;end;
 p:=p||'{"supersedes":"00000000-0000-4000-8000-000000000008","observedAt":"2026-01-04T00:00:00Z","value":25}';
 perform learn_performance_append(t,p,'Corrected source calculation');
 begin perform learn_performance_append(t,p||'{"id":"00000000-0000-4000-8000-000000000010","observedAt":"2026-01-05T00:00:00Z"}','Competing correction');raise exception 'Fork accepted';exception when serialization_failure then null;end;
 begin perform learn_performance_append(t,p||'{"id":"00000000-0000-4000-8000-000000000010","supersedes":"00000000-0000-4000-8000-000000000009","observedAt":"2026-01-03T00:00:00Z"}','Older correction');raise exception 'Older correction accepted';exception when serialization_failure then null;end;
end $$;
reset role;
do $$
declare metric uuid; t uuid:='00000000-0000-4000-8000-000000000001';
begin
 if (select count(*) from measurements)<>2 then raise exception 'Rollback/replay lost'; end if;
 if (select count(*) from metric_definitions)<>1 then raise exception 'Metric registry duplicate'; end if;
 if exists(select 1 from measurements where review_state<>'inferred') then raise exception 'Adapter confirmed facts'; end if;
 select id into metric from metric_definitions limit 1;
 begin update measurements set value=10;raise exception 'Fact edited';exception when restrict_violation then null;end;
 begin delete from measurements;raise exception 'Fact deleted';exception when restrict_violation then null;end;
 begin update metric_definitions set measurement_scope='tenant';raise exception 'Scope edited';exception when check_violation then null;end;
 begin insert into measurements(tenant_id,metric_id,value) values(t,metric,100);raise exception 'Performance metric entered tenant scope';exception when check_violation then null;end;
 insert into objectives(id,tenant_id,objective_type,title,version_id) values('00000000-0000-4000-8000-000000000011',t,'people_target','Synthetic company objective','00000000-0000-4000-8000-000000000006');
 begin insert into objective_metrics(tenant_id,objective_id,metric_id,direction) values(t,'00000000-0000-4000-8000-000000000011',metric,'decrease');raise exception 'Performance metric attached to objective';exception when check_violation then null;end;
 begin insert into objective_constraints(tenant_id,objective_id,key,kind,metric_id) values(t,'00000000-0000-4000-8000-000000000011','guard','hard',metric);raise exception 'Performance metric attached as constraint';exception when check_violation then null;end;
 if has_function_privilege('authenticated','learn_performance_append(uuid,jsonb,text)','execute') or has_function_privilege('anon','learn_performance_append(uuid,jsonb,text)','execute') then raise exception 'Untrusted append granted'; end if;
end $$;
insert into metric_definitions(id,tenant_id,key,name,unit) values('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','legacy','Legacy metric','hours');
insert into measurements(tenant_id,metric_id,value,unit) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012',4.5,'hours');
grant select on measurements to authenticated;
set role authenticated;
select set_config('test.tenant','00000000-0000-4000-8000-000000000001',false);
select set_config('test.role','owner',false);
do $$ begin if (select count(*) from measurements)<>3 then raise exception 'Owner read failed';end if;end $$;
select set_config('test.role','viewer',false);
do $$ begin if (select count(*) from measurements)<>1 then raise exception 'Performance leaked to viewer';end if;end $$;
select set_config('test.role','',false);
do $$ begin if (select count(*) from measurements)<>1 then raise exception 'Performance leaked to missing role';end if;end $$;
select set_config('test.tenant','00000000-0000-4000-8000-000000000002',false);
select set_config('test.role','owner',false);
do $$ begin if (select count(*) from measurements)<>0 then raise exception 'Performance leaked across tenants';end if;end $$;
reset role;
select 'PASS: scoped atomic append/replay, corrections, evidence ownership, objective isolation, append-only history and role/tenant reads' as result;
-- Team-specific policy requires a confirmed member record spanning the period.
insert into org_units values('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001');
insert into config_versions(id,tenant_id,artifact_kind,version,status) values('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','learn_scorecard',2,'draft');
insert into operating_profile_entries(tenant_id,namespace,scope_kind,key,version_id,value)
 select tenant_id,namespace,scope_kind,'definition.group-fixture','00000000-0000-4000-8000-000000000021',value||'{"version":2,"groupId":"00000000-0000-4000-8000-000000000020"}' from operating_profile_entries limit 1;
update team_members set org_unit_id='00000000-0000-4000-8000-000000000020',effective_from='2026-01-02';
set role service_role;
do $$ declare p jsonb; begin
 select test_payload.p||'{"id":"00000000-0000-4000-8000-000000000022","policyVersion":2}' into p from test_payload;
 begin perform learn_performance_append('00000000-0000-4000-8000-000000000001',p,'Wrong membership period');raise exception 'Late membership accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
update team_members set effective_from='2026-01-01';
set role service_role;
select learn_performance_append('00000000-0000-4000-8000-000000000001',p||'{"id":"00000000-0000-4000-8000-000000000022","policyVersion":2}','Confirmed group fixture') from test_payload;
reset role;
do $$ begin
 if not exists(select 1 from measurements where id='00000000-0000-4000-8000-000000000022' and group_ids=array['00000000-0000-4000-8000-000000000020'::uuid]) then raise exception 'Group membership snapshot missing';end if;
end $$;
select 'PASS: team policy rejects insufficient membership period and retains server-derived group identity' as result;
