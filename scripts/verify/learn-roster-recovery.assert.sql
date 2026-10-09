-- Executed only in the disposable offline schema clone. All rows are synthetic.
-- Vocabulary is data, so a schema-only clone intentionally has no permissions.
insert into authority_permissions(permission,category,description) values
 ('work.assign','work','Assign work to others');
insert into tenants(id,slug,display_name,industry) values
 ('aaaa0000-0000-0000-0000-0000000000a1','roster-test-a','Roster Test A','hvac'),
 ('aaaa0000-0000-0000-0000-0000000000a2','roster-test-b','Roster Test B','hvac');
insert into org_units(id,tenant_id,kind,name) values
 ('bbbb0000-0000-0000-0000-0000000000a1','aaaa0000-0000-0000-0000-0000000000a1','team','Example team A'),
 ('bbbb0000-0000-0000-0000-0000000000a2','aaaa0000-0000-0000-0000-0000000000a2','team','Example team B');
set role service_role;
do $$
declare t uuid:='aaaa0000-0000-0000-0000-0000000000a1';
  m uuid; foreign_member uuid; r uuid; successor uuid; g uuid; old_start timestamptz;
  n bigint; failed boolean;
begin
 m:=cp_roster_upsert_member(t,null,'Example coordinator','bbbb0000-0000-0000-0000-0000000000a1',
   'Coordinator',null,'Manager','individual',now()-interval '1 day','synthetic-operator','Create test person',null,false);
 assert (select formal_role_status from team_members where id=m)='proposed';
 assert (select count(*) from controlplane_change_log where resource_id=m::text)=1;
 foreign_member:=cp_roster_upsert_member('aaaa0000-0000-0000-0000-0000000000a2',null,'Foreign person',null,
   null,null,null,null,null,'synthetic-operator','Create foreign fixture',null,false);
 perform cp_roster_upsert_member(t,m,null,null,'Confirmed coordinator','confirmed',null,null,null,
   'synthetic-operator','Confirm formal title',null,false);
 assert (select version from team_members where id=m)=2;
 assert (select confirmed_at from team_members where id=m) is null, 'Title confirmation does not invent identity confirmation';
 r:=cp_upsert_responsibility(t,null,m,'workflow',null,'Example queue','responsible',true,31,null,false,null,
   'synthetic-operator','Propose working-week responsibility',null,false);
 assert (select weekday_mask=31 and is_shared and not confirmed from responsibility_assignments where id=r);
 n:=(select count(*) from controlplane_change_log where tenant_id=t);
 failed:=false;
 begin perform cp_upsert_responsibility(t,r,foreign_member,null,null,null,null,null,null,null,null,null,
   'synthetic-operator','Reject foreign successor',null,false);
 exception when raise_exception then failed:=true; end;
 assert failed and (select effective_to is null from responsibility_assignments where id=r);
 assert (select count(*) from controlplane_change_log where tenant_id=t)=n;
 failed:=false;
 begin perform cp_upsert_responsibility(t,r,null,null,null,null,null,null,null,foreign_member,null,null,
   'synthetic-operator','Reject foreign cover',null,false);
 exception when raise_exception then failed:=true; end;
 assert failed;
 failed:=false;
 begin perform cp_roster_upsert_member(t,m,null,'bbbb0000-0000-0000-0000-0000000000a2',null,null,null,null,null,
   'synthetic-operator','Reject foreign team',null,false);
 exception when raise_exception then failed:=true; end;
 assert failed;
 failed:=false;
 begin perform cp_grant_authority(t,m,'work.assign','team',null,false,'synthetic-operator','Missing team',null,false);
 exception when raise_exception then failed:=true; end;
 assert failed;
 failed:=false;
 begin perform cp_grant_authority(t,m,'work.assign','team','bbbb0000-0000-0000-0000-0000000000a2',false,
   'synthetic-operator','Foreign team',null,false);
 exception when raise_exception then failed:=true; end;
 assert failed;
 g:=cp_grant_authority(t,m,'work.assign','team','bbbb0000-0000-0000-0000-0000000000a1',false,
   'synthetic-operator','Propose team authority',null,false);
 assert (select not confirmed from authority_grants where id=g);
 perform cp_grant_authority(t,m,'work.assign','team','bbbb0000-0000-0000-0000-0000000000a1',true,
   'synthetic-operator','Confirm proposed authority',null,false);
 successor:=cp_upsert_responsibility(t,r,null,null,null,'Updated queue',null,null,null,null,true,null,
   'synthetic-operator','Confirm updated queue',null,false);
 assert successor<>r and (select effective_to is not null from responsibility_assignments where id=r);
 assert (select version=2 and confirmed from responsibility_assignments where id=successor);
 failed:=false;
 begin perform cp_end_responsibility(t,successor,now()-interval '2 days','synthetic-operator','Invalid end',null,false);
 exception when raise_exception then failed:=true; end;
 assert failed;
 failed:=false;
 begin perform cp_upsert_responsibility(t,null,m,'cover',null,'Invalid weekdays',null,null,128,null,null,null,
   'synthetic-operator','Invalid mask',null,false);
 exception when raise_exception then failed:=true; end;
 assert failed;
 foreach failed in array array[false,true] loop
   -- Direct SQL is still required to carry a reason and cannot claim View-As writes.
   begin
     perform cp_end_authority(t,g,'synthetic-operator',case when failed then 'View-As denied' else '' end,null,failed);
     raise exception 'Unexpected accepted write' using errcode='23514';
   exception when raise_exception then null; end;
 end loop;
 assert (select effective_to is null from authority_grants where id=g);
 old_start:=(select effective_from from team_members where id=m);
 perform cp_member_lifecycle(t,m,'end',now(),'synthetic-operator','Leave fixture',null,false);
 assert (select effective_to is not null from team_members where id=m);
 assert not exists(select 1 from responsibility_assignments where member_id=m and effective_to is null);
 assert not exists(select 1 from authority_grants where member_id=m and effective_to is null);
 perform cp_member_lifecycle(t,m,'reactivate',now(),'synthetic-operator','Rejoin fixture',null,false);
 assert (select effective_to is null and effective_from>old_start from team_members where id=m),
   'Rejoin begins a new current membership period';
 assert not exists(select 1 from responsibility_assignments where member_id=m and effective_to is null), 'Duties not restored automatically';
 assert exists(select 1 from controlplane_change_log where resource_id=m::text
   and action='controlplane.roster.member_reactivate' and before->>'effective_to' is not null), 'Prior period retained in immutable log';
 assert g=cp_grant_authority(t,m,'work.assign','team','bbbb0000-0000-0000-0000-0000000000a1',null,
   'synthetic-operator','Re-propose authority',null,false);
 assert (select not confirmed from authority_grants where id=g), 'Re-proposing an ended grant cannot reuse its old confirmation';
 -- A downstream audit failure must undo the proposed change.
 n:=(select version from team_members where id=m);
 begin
   perform cp_roster_upsert_member(t,m,'Rollback name',null,null,null,null,null,null,'synthetic-operator','Rollback fixture',null,false);
   raise exception 'Synthetic downstream rollback';
 exception when raise_exception then null; end;
 assert (select version from team_members where id=m)=n;
end $$;
reset role;
do $$ declare sig text; begin
 for sig in select oid::regprocedure::text from pg_proc where pronamespace='public'::regnamespace and proname in
  ('cp_roster_upsert_member','cp_member_lifecycle','cp_upsert_responsibility','cp_end_responsibility','cp_grant_authority','cp_end_authority') loop
  assert not has_function_privilege('anon',sig,'execute') and not has_function_privilege('authenticated',sig,'execute');
  assert has_function_privilege('service_role',sig,'execute');
 end loop;
end $$;
insert into responsibility_assignments(id,tenant_id,member_id,kind,label,source)
 select 'cccc0000-0000-0000-0000-0000000000a1','aaaa0000-0000-0000-0000-0000000000a1',id,'workflow','Race predecessor','synthetic'
 from team_members where display_name='Example coordinator';
