reset role;
do $$ begin
 assert (select to_jsonb(h)-array['work_before','work_after','transition_verb','capture_kind','capture_sequence']=b.payload from object_state_history h cross join verify.old_work_history b where h.id=verify.id(691)),'Old history changed';
 assert (select count(*)=0 from object_state_history where capture_kind is not null),'Installation baselined old work';
end $$;
insert into tenants(id,slug,display_name) values(verify.id(701),'synthetic-work-a','Synthetic work A'),(verify.id(702),'synthetic-work-b','Synthetic work B');
insert into auth.users(id) select verify.id(n) from generate_series(711,714) n;
insert into profiles(id,tenant_id,role) values(verify.id(711),verify.id(701),'owner'),(verify.id(712),verify.id(701),'viewer'),(verify.id(713),verify.id(702),'owner'),(verify.id(714),verify.id(702),'openfolk');
insert into org_units(id,tenant_id,kind,name) values(verify.id(721),verify.id(701),'team','Work team A'),(verify.id(722),verify.id(702),'team','Work team B');
insert into team_members(id,tenant_id,org_unit_id,profile_id,display_name,confirmed_at,effective_from) values
 (verify.id(731),verify.id(701),verify.id(721),verify.id(711),'Work owner',now()-interval '1 day',now()-interval '1 day'),
 (verify.id(732),verify.id(701),verify.id(721),verify.id(712),'Work recipient',now()-interval '1 day',now()-interval '1 day');
create table verify.work_period(start_at timestamptz,end_at timestamptz,policy_id uuid);
grant select on verify.work_period to authenticated,service_role;
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000711';
set role authenticated;
create temporary table work_draft as select learn_scorecard_save_draft(verify.id(701),0,
 '{"name":"Synthetic captured work","subjectKind":"member","scaleMax":100,"metrics":[{"key":"work.recorded_handoffs","label":"Handoffs","unit":"handoffs","weight":1,"zeroAt":0,"fullAt":10,"minSamples":1,"minCoverage":1,"maxAgeHours":24,"sourceSystems":["serviceos.work.handoffs@1"]},{"key":"work.owned_item_minutes","label":"Owned item minutes","unit":"item_minutes","weight":1,"zeroAt":100,"fullAt":0,"minSamples":1,"minCoverage":1,"maxAgeHours":24,"sourceSystems":["serviceos.work.residence@1"]}]}',
 'Synthetic work evidence settings') policy;
reset role;
insert into verify.work_period select clock_timestamp(),null,(policy->>'id')::uuid from work_draft;
set role service_role;
insert into intelligence_objects(id,tenant_id,domain,object_type,subject,status,responsible_ref) values
 (verify.id(741),verify.id(701),'core','Task','Synthetic first work','ready',jsonb_build_object('kind','member','ref',verify.id(731))),
 (verify.id(742),verify.id(701),'core','Task','Synthetic concurrent work','waiting',jsonb_build_object('kind','user','ref',verify.id(711)));
update intelligence_objects set responsible_ref=jsonb_build_object('kind','user','ref',verify.id(711)),status='closed' where id=verify.id(741);
update intelligence_objects set responsible_ref=jsonb_build_object('kind','member','ref',verify.id(732)) where id=verify.id(741);
update intelligence_objects set subject='Synthetic label change' where id=verify.id(742);
reset role;
select pg_sleep(0.003);
update verify.work_period set end_at=clock_timestamp();
set role authenticated;
do $$ declare p verify.work_period%rowtype;r jsonb;expected numeric;begin
 select * into p from verify.work_period;
 r:=learn_work_history_read(verify.id(701),verify.id(741),p.start_at,p.end_at);
 assert r->>'count'='3' and r->>'contract'='work-capture@1';
 r:=learn_work_history_read(verify.id(701),verify.id(742),p.start_at,p.end_at);assert r->>'count'='1','Label-only change invented capture';
 r:=learn_work_handoffs_collect(verify.id(701),verify.id(731),p.policy_id,1,p.start_at,p.end_at,verify.id(751),'Recorded synthetic transfers');
 assert not (r->>'reused')::boolean;
 assert (select value=1 and eligible_count=2 and covered_count=2 and review_state='inferred' from measurements where id=verify.id(751)),'Alias was counted as a handoff or real transfer missed';
 assert (learn_work_handoffs_collect(verify.id(701),verify.id(731),p.policy_id,1,p.start_at,p.end_at,verify.id(751),'Recorded synthetic transfers')->>'reused')::boolean;
 begin perform learn_work_handoffs_collect(verify.id(701),verify.id(731),p.policy_id,1,p.start_at,p.end_at,verify.id(751),'Changed request');raise exception 'Changed retry accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_handoffs_collect(verify.id(701),verify.id(731),p.policy_id,1,p.start_at,p.end_at,verify.id(752),'Duplicate cell');raise exception 'Duplicate accepted';exception when sqlstate 'PT409' then null;end;
 perform learn_work_residence_collect(verify.id(701),verify.id(731),p.policy_id,1,p.start_at,p.end_at,verify.id(753),'Synthetic elapsed ownership');
 select sum(extract(epoch from least(p.end_at,coalesce(next_at,p.end_at))-occurred_at)/60) into expected from (
  select occurred_at,work_after,lead(occurred_at) over(partition by object_id order by capture_sequence) next_at
  from object_state_history where tenant_id=verify.id(701) and capture_kind is not null
 ) h where work_after#>>'{responsible_ref,ref}' in (verify.id(731)::text,verify.id(711)::text);
 assert (select abs(value-expected)<0.00000001 and covered_count=2 from measurements where id=verify.id(753));
 assert (select jsonb_array_length(proof->'credited')=3 from learn_work_measurement_runs where id=verify.id(753));
 assert exists(select 1 from learn_work_measurement_runs r cross join lateral jsonb_array_elements(r.proof->'credited') e where r.id=verify.id(753) and e->>'status'='closed'),'Closed elapsed interval lost';
 perform learn_performance_review(verify.id(701),verify.id(753),verify.id(761),0,'confirmed','Reviewed synthetic intervals');
end $$;
reset role;
-- Denied mutation leaves captures and calculations intact, including cascade deletion.
do $$ begin
 begin delete from intelligence_objects where id=verify.id(741);raise exception 'Captured object deleted';exception when raise_exception then if sqlerrm='Captured object deleted' then raise;end if;end;
 begin truncate object_state_history;raise exception 'Work history truncated';exception when object_not_in_prerequisite_state then null;end;
 begin truncate learn_work_measurement_runs;raise exception 'Work proof truncated';exception when object_not_in_prerequisite_state then null;end;
 assert (select count(*)=4 from object_state_history where tenant_id=verify.id(701));
 assert (select count(*)=2 from learn_work_measurement_runs where tenant_id=verify.id(701));
 assert (select to_jsonb(e)=b.payload from email_messages e cross join verify.email_before b),'Source email changed';
end $$;
-- Actual pre-capture items remain uncovered; no baseline inferred from old dates.
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000011';
set role authenticated;
do $$ declare r jsonb;begin
 r:=learn_work_history_read(verify.id(1),verify.id(181),now()-interval '1 day',statement_timestamp());assert r->>'coverageStart' is null and r->>'count'='0';
end $$;
reset role;
-- An unresolved reference withholds residence; existing snapshot rows aren't rewritten.
set role service_role;
update intelligence_objects set responsible_ref='{"kind":"user","ref":"unresolved@example.invalid"}' where id=verify.id(742);
reset role;
select pg_sleep(0.003);
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000711';
set role authenticated;
do $$ declare p verify.work_period%rowtype;begin
 select * into p from verify.work_period;
 perform learn_work_residence_collect(verify.id(701),verify.id(731),p.policy_id,1,p.start_at,statement_timestamp(),verify.id(754),'Incomplete synthetic identity');
 assert (select value is null and source_through is null and covered_count<eligible_count from measurements where id=verify.id(754));
end $$;
reset role;
set role authenticated;
do $$ declare n int;p verify.work_period%rowtype;begin
 select * into p from verify.work_period;
 foreach n in array array[712,713,714] loop
  perform set_config('request.jwt.claim.sub',verify.id(n)::text,true);
  assert (select count(*)=0 from learn_work_measurement_runs);
  begin perform learn_work_history_read(verify.id(701),verify.id(741),p.start_at,p.end_at);raise exception 'Unauthorized history read';exception when insufficient_privilege then null;end;
  begin perform learn_work_handoffs_collect(verify.id(701),verify.id(731),p.policy_id,1,p.start_at,p.end_at,verify.id(755),'Unauthorized');raise exception 'Unauthorized collection';exception when insufficient_privilege then null;end;
 end loop;
end $$;
reset role;
