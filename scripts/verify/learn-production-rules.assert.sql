-- Called only inside a rollback transaction on the offline restored database.
set local search_path=public,pg_catalog;
update profiles set role='owner' where id=current_setting('serviceos.rehearsal_actor')::uuid;
select set_config('request.jwt.claim.sub',current_setting('serviceos.rehearsal_actor'),true);
set local role authenticated;
do $$ declare t uuid:=current_setting('serviceos.rehearsal_tenant')::uuid;
 d jsonb; p uuid; first_at timestamptz; next_at timestamptz; ack jsonb;
 definition jsonb:='{"name":"Offline compatibility probe","subjectKind":"member","scaleMax":50,"metrics":[{"key":"work.handoffs","label":"Handoffs","unit":"count","weight":2,"zeroAt":0,"fullAt":20,"minSamples":1,"minCoverage":1,"maxAgeHours":24,"sourceSystems":["serviceos.work.handoffs@1"]}]}';
begin
 assert learn_scorecard_policy_for_period(t,'member',null,now()-interval '2 days',now()-interval '1 day') is null;
 d:=learn_scorecard_save_draft(t,0,definition,'Offline compatibility probe');p:=(d->>'id')::uuid;
 assert d->>'version'='1' and d->>'scaleMax'='50';
 begin perform learn_scorecard_save_draft(t,0,definition,'Stale editor');raise exception 'Stale editor accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_scorecard_save_draft(t,1,definition||'{"scaleMax":0}','Invalid scale');raise exception 'Invalid scale accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_scorecard_save_draft('baf00200-aaaa-4000-8000-000000000999',0,definition,'Foreign company');raise exception 'Foreign company accepted';exception when insufficient_privilege then null;end;
 ack:=learn_scorecard_publish(t,p,1,'baf00200-aaaa-4000-8000-000000000001','Offline first publication');first_at:=(ack->>'effectiveFrom')::timestamptz;
 assert not (ack->>'reused')::boolean;
 assert (learn_scorecard_publish(t,p,1,'baf00200-aaaa-4000-8000-000000000001','Offline first publication')->>'reused')::boolean;
 begin perform learn_scorecard_publish(t,p,1,'baf00200-aaaa-4000-8000-000000000001','Changed retry');raise exception 'Changed retry accepted';exception when sqlstate 'PT409' then null;end;
 d:=learn_scorecard_save_draft(t,1,definition||'{"scaleMax":100}','Offline second revision');
 assert d->>'version'='2' and learn_scorecard_read_draft(t,'member',null)->>'scaleMax'='100';
 assert learn_scorecard_policy_for_period(t,'member',null,first_at,first_at+interval '1 hour')->>'scaleMax'='50';
 ack:=learn_scorecard_publish(t,p,2,'baf00200-aaaa-4000-8000-000000000002','Offline second publication');next_at:=(ack->>'effectiveFrom')::timestamptz;
 assert next_at>first_at;
 assert learn_scorecard_policy_for_period(t,'member',null,first_at,next_at)->>'scaleMax'='50';
 assert learn_scorecard_policy_for_period(t,'member',null,next_at,next_at+interval '1 hour')->>'scaleMax'='100';
 begin perform learn_scorecard_policy_for_period(t,'member',null,first_at,next_at+interval '1 hour');raise exception 'Mixed rule period accepted';exception when invalid_parameter_value then null;end;
 assert not has_function_privilege('service_role','learn_scorecard_save_draft(uuid,integer,jsonb,text)','EXECUTE');
end $$;
reset role;
insert into team_members(id,tenant_id,profile_id,display_name,confirmed_at,effective_from)
 values('baf00200-aaaa-4000-8000-000000000100',current_setting('serviceos.rehearsal_tenant')::uuid,
 current_setting('serviceos.rehearsal_actor')::uuid,'Offline temporary member',clock_timestamp(),now()-interval '10 days');
update team_members set effective_to=clock_timestamp() where id='baf00200-aaaa-4000-8000-000000000100';
set local role authenticated;
do $$ declare r jsonb;begin
 r:=learn_member_history_read(current_setting('serviceos.rehearsal_tenant')::uuid,statement_timestamp()-interval '20 days',statement_timestamp());
 select value into r from jsonb_array_elements(r->'members') where value->>'memberId'='baf00200-aaaa-4000-8000-000000000100';
 assert r->>'firstKind'='insert' and (r->>'count')::int=2;
 assert (r->>'coverageStart')::timestamptz>now()-interval '1 hour','Retrospective membership coverage fabricated';
end $$;
reset role;
do $$ begin
 begin update operating_profile_entries set value=value||'{"name":"Rewritten"}' where namespace='learn_scorecards';raise exception 'Rule rewrite accepted';exception when object_not_in_prerequisite_state then null;end;
 begin delete from config_versions where artifact_kind='learn_scorecard';raise exception 'Rule deletion accepted';exception when object_not_in_prerequisite_state then null;end;
 begin delete from team_members where id='baf00200-aaaa-4000-8000-000000000100';raise exception 'Member deletion accepted';exception when object_not_in_prerequisite_state then null;end;
 begin truncate learn_scorecard_publications;raise exception 'Publication truncate accepted';exception when object_not_in_prerequisite_state then null;end;
 begin update customer_cards set tenant_id='baf00200-aaaa-4000-8000-000000000999' where id=(select id from customer_cards limit 1);raise exception 'Card tenant reassignment accepted';exception when check_violation then null;end;
end $$;
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref)
 values(current_setting('serviceos.rehearsal_tenant')::uuid,current_setting('serviceos.rehearsal_actor')::uuid,'role','viewer');
set local role authenticated;
do $$ begin
 begin perform learn_scorecard_save_draft(current_setting('serviceos.rehearsal_tenant')::uuid,2,'{}','Preview write');raise exception 'Preview write accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
update profiles set role='viewer' where id=current_setting('serviceos.rehearsal_actor')::uuid;
set local role authenticated;
do $$ begin
 assert (select count(*) from learn_scorecard_publications)=0;
 begin perform learn_scorecard_read_draft(current_setting('serviceos.rehearsal_tenant')::uuid,'member',null);raise exception 'Revoked owner read accepted';exception when insufficient_privilege then null;end;
 begin perform learn_member_history_read(current_setting('serviceos.rehearsal_tenant')::uuid,now()-interval '1 day',now());raise exception 'Viewer history accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
