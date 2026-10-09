-- The foundation fixtures precede capture. Historical membership stays unknown.
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000011';
set role authenticated;
do $$ declare r jsonb;begin
 r:=learn_member_history_read(verify.id(1),statement_timestamp()-interval '1 day',statement_timestamp());
 assert (r->>'count')::int=1 and r->'members'->0->>'coverageStart' is null;
 assert learn_scorecard_policy_for_period(verify.id(1),'member',null,now()-interval '2 days',now()-interval '1 day') is null;
end $$;
reset role;
set role service_role;
insert into team_members(id,tenant_id,profile_id,org_unit_id,display_name,confirmed_at,effective_from)
 values(verify.id(241),verify.id(1),verify.id(11),verify.id(131),'Synthetic captured member',clock_timestamp(),now()-interval '10 days');
update team_members set effective_to=clock_timestamp() where id=verify.id(241);
reset role;
set role authenticated;
do $$ declare t uuid:=verify.id(1); d jsonb; p uuid; first_at timestamptz; next_at timestamptz; ack jsonb; r jsonb;
 definition jsonb:='{"name":"Reviewed synthetic criteria","subjectKind":"member","scaleMax":50,"metrics":[{"key":"work.handoffs","label":"Handoffs","unit":"count","weight":2,"zeroAt":0,"fullAt":20,"minSamples":1,"minCoverage":1,"maxAgeHours":24,"sourceSystems":["serviceos.work.handoffs@1"]}]}';
begin
 d:=learn_scorecard_save_draft(t,0,definition,'Create synthetic rules');p:=(d->>'id')::uuid;
 assert d->>'scaleMax'='50' and d->>'version'='1' and d->>'status'='draft';
 begin perform learn_scorecard_save_draft(t,0,definition,'Stale editor');raise exception 'Stale draft accepted';exception when serialization_failure then null;end;
 begin perform learn_scorecard_save_draft(t,1,definition||jsonb_build_object('groupId',verify.id(132)),'Foreign group');raise exception 'Foreign group accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_scorecard_save_draft(t,1,definition||'{"scaleMax":0}','Invalid scale');raise exception 'Invalid scale accepted';exception when invalid_parameter_value then null;end;
 ack:=learn_scorecard_publish(t,p,1,verify.id(301),'Reviewed synthetic publication');first_at:=(ack->>'effectiveFrom')::timestamptz;
 assert first_at>=statement_timestamp();assert not (ack->>'reused')::boolean;
 assert (learn_scorecard_publish(t,p,1,verify.id(301),'Reviewed synthetic publication')->>'reused')::boolean;
 begin perform learn_scorecard_publish(t,p,1,verify.id(301),'Changed request');raise exception 'Changed retry accepted';exception when serialization_failure then null;end;
 assert learn_scorecard_policy_for_period(t,'member',null,first_at-interval '1 day',first_at) is null;
 d:=learn_scorecard_save_draft(t,1,definition||'{"scaleMax":100}','New criteria');
 assert d->>'version'='2' and d->>'scaleMax'='100';
 assert learn_scorecard_read_draft(t,'member',null)->>'version'='2','Reader must prefer revision even when created_at is tied in this transaction';
 r:=learn_scorecard_policy_for_period(t,'member',null,first_at,first_at+interval '1 hour');assert r->>'version'='1';
 ack:=learn_scorecard_publish(t,p,2,verify.id(302),'Reviewed changed scale');next_at:=(ack->>'effectiveFrom')::timestamptz;
 r:=learn_scorecard_policy_for_period(t,'member',null,first_at,next_at);assert r->>'version'='1' and r->>'scaleMax'='50';
 r:=learn_scorecard_policy_for_period(t,'member',null,next_at,next_at+interval '1 hour');assert r->>'version'='2' and r->>'scaleMax'='100';
 begin perform learn_scorecard_policy_for_period(t,'member',null,first_at,next_at+interval '1 hour');raise exception 'Mixed policy period accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_scorecard_save_draft(verify.id(2),0,definition,'Foreign tenant');raise exception 'Foreign save accepted';exception when insufficient_privilege then null;end;
 r:=learn_member_history_read(t,statement_timestamp()-interval '20 days',statement_timestamp());
 select value into r from jsonb_array_elements(r->'members') where value->>'memberId'=verify.id(241)::text;
 assert r->>'firstKind'='insert' and (r->>'count')::int=2;
 assert (r->>'coverageStart')::timestamptz>now()-interval '1 hour','Old effective date fabricated observed coverage';
 assert not has_table_privilege('authenticated','learn_member_history','SELECT');
 assert not has_function_privilege('service_role','learn_scorecard_save_draft(uuid,integer,jsonb,text)','EXECUTE');
end $$;
reset role;
-- Retain history and rule revisions even for privileged direct edits.
do $$ begin
 begin update operating_profile_entries set value=value||'{"name":"Rewritten"}' where namespace='learn_scorecards';raise exception 'Rule rewrite accepted';exception when object_not_in_prerequisite_state then null;end;
 begin delete from config_versions where artifact_kind='learn_scorecard';raise exception 'Rule deletion accepted';exception when object_not_in_prerequisite_state then null;end;
 begin truncate learn_scorecard_publications;raise exception 'Publication truncate accepted';exception when object_not_in_prerequisite_state then null;end;
 begin delete from team_members where id=verify.id(241);raise exception 'Member deletion accepted';exception when object_not_in_prerequisite_state then null;end;
 begin truncate team_members cascade;raise exception 'Member truncate accepted';exception when object_not_in_prerequisite_state then null;end;
 begin delete from learn_member_history;raise exception 'History deletion accepted';exception when object_not_in_prerequisite_state then null;end;
 assert (select to_jsonb(e)=b.payload from email_messages e cross join verify.email_before b),'Retained email changed';
end $$;
-- Owner preview sessions deny writes; actor context reads do not expose another user.
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref) values(verify.id(1),verify.id(11),'role','viewer');
set role authenticated;
do $$ declare p uuid;begin
 select policy_id into p from learn_scorecard_publications where id=verify.id(301);
 begin perform learn_scorecard_publish(verify.id(1),p,2,verify.id(303),'Preview write');raise exception 'Preview publication accepted';exception when insufficient_privilege then null;end;
 begin perform learn_scorecard_save_draft(verify.id(1),2,'{}','Preview write');raise exception 'Preview draft accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000012';
set role authenticated;
do $$ begin
 assert (select count(*)=0 from learn_scorecard_publications);assert (select count(*)=0 from view_as_context);
 begin perform learn_scorecard_read_draft(verify.id(1),'member',null);raise exception 'Viewer draft read accepted';exception when insufficient_privilege then null;end;
 begin perform learn_member_history_read(verify.id(1),now()-interval '1 day',now());raise exception 'Viewer history accepted';exception when insufficient_privilege then null;end;
 begin perform learn_scorecard_save_draft(verify.id(1),2,'{}','Viewer write');raise exception 'Viewer draft accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
