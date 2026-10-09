-- Synthetic records only, after the recovered roster assertions in an offline clone.
create temporary table history_marks(label text primary key,at timestamptz);
insert into history_marks values('before',clock_timestamp());
insert into auth.users(id,email,is_sso_user,is_anonymous) values
 ('eeee0000-0000-0000-0000-000000000001','history@test.invalid',false,false);
update profiles set tenant_id='aaaa0000-0000-0000-0000-0000000000a1',role='owner'
 where id='eeee0000-0000-0000-0000-000000000001';
insert into org_units(id,tenant_id,kind,name) values
 ('eeee0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-0000000000a1','team','History team');
insert into team_members(id,tenant_id,profile_id,display_name,org_unit_id,confirmed_at,effective_from) values
 ('eeee0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-0000000000a1',
 'eeee0000-0000-0000-0000-000000000001','History person','bbbb0000-0000-0000-0000-0000000000a1',clock_timestamp(),now()-interval '1 day');
insert into history_marks values('inserted',clock_timestamp());
update team_members set org_unit_id='eeee0000-0000-0000-0000-000000000002'
 where id='eeee0000-0000-0000-0000-000000000003';
insert into history_marks values('transferred',clock_timestamp());
-- Current record's effective dates cannot erase the observed prior membership.
select cp_member_lifecycle('aaaa0000-0000-0000-0000-0000000000a1','eeee0000-0000-0000-0000-000000000003',
 'end',clock_timestamp(),'test','History fixture leave',null,false);
insert into history_marks values('ended',clock_timestamp());
select cp_member_lifecycle('aaaa0000-0000-0000-0000-0000000000a1','eeee0000-0000-0000-0000-000000000003',
 'reactivate',clock_timestamp(),'test','History fixture rejoin',null,false);
insert into history_marks values('rejoined',clock_timestamp());
select set_config('request.jwt.claim.sub','eeee0000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"eeee0000-0000-0000-0000-000000000001","role":"authenticated"}',false);

set role authenticated;
do $$ declare r jsonb; m jsonb; t uuid:='aaaa0000-0000-0000-0000-0000000000a1'; begin
 r:=learn_member_history_read(t,statement_timestamp()-interval '1 day',statement_timestamp());
 assert r->>'contract'='member-capture@1';
 select value into m from jsonb_array_elements(r->'members') where value->>'memberId'='eeee0000-0000-0000-0000-000000000003';
 assert m->>'firstKind'='insert' and (m->>'count')::int=4, 'Synthetic member result: '||m::text;
 assert m->'events'->0->'after'->>'teamId'='bbbb0000-0000-0000-0000-0000000000a1';
 assert m->'events'->1->'after'->>'teamId'='eeee0000-0000-0000-0000-000000000002';
 assert m->'events'->2->'after'->>'effectiveTo' is not null;
 assert m->'events'->3->'after'->>'effectiveTo' is null;
 assert exists(select 1 from jsonb_array_elements(r->'members') v where v->>'coverageStart' is null), 'Uncaptured legacy member remains unknown';
 begin perform learn_member_history_read('aaaa0000-0000-0000-0000-0000000000a2',now()-interval '1 day',now());
   raise exception 'Unexpected tenant read'; exception when insufficient_privilege then null; end;
 assert not has_table_privilege('authenticated','learn_member_history','select');
 assert not has_function_privilege('authenticated','learn_member_capture_baseline(uuid,uuid)','execute');
 assert not has_table_privilege('service_role','learn_member_history','insert');
end $$;
reset role;

do $$ declare m uuid; id1 uuid; id2 uuid; n int; begin
 select id into m from team_members where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and id<>'eeee0000-0000-0000-0000-000000000003' limit 1;
 id1:=learn_member_capture_baseline('aaaa0000-0000-0000-0000-0000000000a1',m);
 id2:=learn_member_capture_baseline('aaaa0000-0000-0000-0000-0000000000a1',m);
 assert id1=id2;
 assert (select kind='baseline' and observed_at>=statement_timestamp() from learn_member_history where id=id1);
 n:=(select count(*) from learn_member_history);
 update team_members set display_name=display_name||' renamed' where id=m;
 assert (select count(*) from learn_member_history)=n, 'Label-only edits do not invent membership changes';
 begin update learn_member_history set kind='update' where id=id1;
   raise exception 'Unexpected history update'; exception when object_not_in_prerequisite_state then null; end;
 begin delete from learn_member_history where id=id1;
   raise exception 'Unexpected history delete'; exception when object_not_in_prerequisite_state then null; end;
 begin truncate learn_member_history;
   raise exception 'Unexpected history truncate'; exception when object_not_in_prerequisite_state then null; end;
 begin delete from team_members where id=m;
   raise exception 'Unexpected member deletion'; exception when object_not_in_prerequisite_state then null; end;
 begin update team_members set tenant_id='aaaa0000-0000-0000-0000-0000000000a2' where id=m;
   raise exception 'Unexpected tenant change'; exception when check_violation then null; end;
 begin
   update team_members set confirmed_at=null where id=m;
   raise exception 'Synthetic rollback';
 exception when raise_exception then null; end;
 assert (select count(*) from learn_member_history)=n, 'Rollback retains neither partial source edit nor capture';
end $$;
-- A disabled capture or unrecorded source write cannot yield reassuring history.
alter table team_members disable trigger learn_capture_member_change;
do $$ begin
 begin perform learn_member_history_read('aaaa0000-0000-0000-0000-0000000000a1',now()-interval '1 day',now());
 raise exception 'Unexpected disabled capture read'; exception when object_not_in_prerequisite_state then null; end;
end $$;
update team_members set profile_id=null where id='eeee0000-0000-0000-0000-000000000003';
alter table team_members enable trigger learn_capture_member_change;
do $$ begin
 begin perform learn_member_history_read('aaaa0000-0000-0000-0000-0000000000a1',now()-interval '1 day',now());
 raise exception 'Unexpected stale head read'; exception when object_not_in_prerequisite_state then null; end;
end $$;
-- Restore the original current state without claiming the test-only gap is captured.
alter table team_members disable trigger learn_capture_member_change;
update team_members set profile_id='eeee0000-0000-0000-0000-000000000001' where id='eeee0000-0000-0000-0000-000000000003';
alter table team_members enable trigger learn_capture_member_change;
update profiles set role='viewer' where id='eeee0000-0000-0000-0000-000000000001';
set role authenticated;
do $$ begin
 begin perform learn_member_history_read('aaaa0000-0000-0000-0000-0000000000a1',now()-interval '1 day',now());
 raise exception 'Unexpected viewer read'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update profiles set role='owner' where id='eeee0000-0000-0000-0000-000000000001';
