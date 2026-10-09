-- Extends the synthetic handoff fixture. Existing source receipts remain untouched.
set request.jwt.claim.sub='bbbb0000-0000-0000-0000-000000000001';
set role authenticated;
do $$ declare t uuid:='aaaa0000-0000-0000-0000-000000000001'; p uuid:='dddd0000-0000-0000-0000-000000000002';
 r uuid:='99990000-0000-0000-0000-000000000001'; ack jsonb; first_at timestamptz; second_at timestamptz; draft jsonb; resolved jsonb;
begin
 ack:=learn_scorecard_publish(t,p,1,r,'Reviewed criteria and evidence');
 first_at:=(ack->>'effectiveFrom')::timestamptz;
 assert first_at>=statement_timestamp() and not (ack->>'reused')::boolean;
 assert (select value->>'status'='draft' from operating_profile_entries where value->>'id'=p::text and value->>'version'='1');
 assert (select policy->>'status'='published' from learn_scorecard_publications where id=r);
 assert (learn_scorecard_publish(t,p,1,r,'Reviewed criteria and evidence')->>'reused')::boolean;
 begin perform learn_scorecard_publish(t,p,1,r,'Changed reason');raise exception 'Unexpected changed retry';
 exception when serialization_failure then null;end;
 begin perform learn_scorecard_publish(t,p,1,'99990000-0000-0000-0000-000000000002','Second publish');raise exception 'Unexpected duplicate publish';
 exception when serialization_failure then null;end;
 assert learn_scorecard_policy_for_period(t,'member',null,first_at-interval '2 days',first_at-interval '1 day') is null;
 select value into draft from operating_profile_entries where value->>'id'=p::text and value->>'version'='1';
 draft:=learn_scorecard_save_draft(t,1,draft||'{"name":"New draft criteria"}','Prepare revision two');
 assert draft->>'version'='2' and draft->>'status'='draft';
 resolved:=learn_scorecard_policy_for_period(t,'member',null,first_at,first_at+interval '1 hour');
 assert resolved->>'version'='1', 'An unpublished draft does not replace published rules';
 draft:=learn_scorecard_save_draft(t,2,draft||'{"name":"Reviewed revision three"}','Prepare latest revision');
 begin perform learn_scorecard_publish(t,p,2,'99990000-0000-0000-0000-000000000003','Stale editor');raise exception 'Unexpected stale publication';
 exception when serialization_failure then null;end;
 ack:=learn_scorecard_publish(t,p,3,'99990000-0000-0000-0000-000000000004','Reviewed latest revision');
 second_at:=(ack->>'effectiveFrom')::timestamptz;
 assert second_at>first_at;
 resolved:=learn_scorecard_policy_for_period(t,'member',null,first_at,second_at);
 assert resolved->>'version'='1' and (resolved#>>'{publication,effectiveUntil}')::timestamptz=second_at;
 resolved:=learn_scorecard_policy_for_period(t,'member',null,second_at,second_at+interval '1 hour');
 assert resolved->>'version'='3';
 begin perform learn_scorecard_policy_for_period(t,'member',null,first_at,second_at+interval '1 hour');
 raise exception 'Unexpected mixed-period rules'; exception when invalid_parameter_value then null; end;
 begin perform learn_scorecard_publish('aaaa0000-0000-0000-0000-000000000002',p,3,'99990000-0000-0000-0000-000000000005','Foreign tenant');
 raise exception 'Unexpected foreign publication';exception when insufficient_privilege then null;end;
 assert not has_table_privilege('authenticated','learn_scorecard_publications','insert');
 assert not has_function_privilege('service_role','learn_scorecard_publish(uuid,uuid,int,uuid,text)','execute');
end $$;
reset role;
do $$ begin
 begin update operating_profile_entries set value=value||'{"name":"Changed old rules"}' where namespace='learn_scorecards';
 raise exception 'Unexpected rewrite';exception when object_not_in_prerequisite_state then null;end;
 begin update config_versions set status='published' where artifact_kind='learn_scorecard';
 raise exception 'Unexpected rewrite';exception when object_not_in_prerequisite_state then null;end;
 begin delete from learn_scorecard_publications;
 raise exception 'Unexpected deletion';exception when object_not_in_prerequisite_state then null;end;
 begin truncate learn_scorecard_publications;
 raise exception 'Unexpected truncate';exception when object_not_in_prerequisite_state then null;end;
 assert (select count(*) from learn_scorecard_publications)=2;
 assert (select count(*) from measurements)=2;
 assert (select count(*) from learn_work_measurement_runs)=2;
end $$;
update profiles set role='viewer' where id='bbbb0000-0000-0000-0000-000000000001';
set role authenticated;
do $$ begin
 assert (select count(*) from learn_scorecard_publications)=0;
 begin perform learn_scorecard_publish('aaaa0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000002',3,
 '99990000-0000-0000-0000-000000000006','Viewer denied'); raise exception 'Unexpected viewer'; exception when insufficient_privilege then null;end;
end $$;
reset role;
update profiles set role='owner' where id='bbbb0000-0000-0000-0000-000000000001';
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason)
values('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000001','role','owner','Synthetic publication authority check');
set role authenticated;
do $$ begin
 begin perform learn_scorecard_publish('aaaa0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000002',3,
 '99990000-0000-0000-0000-000000000007','View-As denied'); raise exception 'Unexpected View-As publication'; exception when insufficient_privilege then null;end;
end $$;
reset role;
update view_as_context set ended_at=clock_timestamp() where actor_user_id='bbbb0000-0000-0000-0000-000000000001' and ended_at is null;
