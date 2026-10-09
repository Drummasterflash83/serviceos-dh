insert into authority_permissions(permission,category,description) values
 ('work.approve','work','Approval'),('ownership.confirm','work','Confirm ownership'),('tenant.superadmin','work','Tenant governance');
insert into auth.users(id,email,is_sso_user,is_anonymous) values
 ('bbbb0000-0000-0000-0000-0000000000b1','staff@authority.test',false,false),
 ('bbbb0000-0000-0000-0000-0000000000b2','other@authority.test',false,false);
update profiles set tenant_id='aaaa0000-0000-0000-0000-0000000000a1',role='viewer'
 where id in ('bbbb0000-0000-0000-0000-0000000000b1','bbbb0000-0000-0000-0000-0000000000b2');
insert into org_units(id,tenant_id,kind,name) values
 ('bbbb0000-0000-0000-0000-0000000000b3','aaaa0000-0000-0000-0000-0000000000a1','team','Other same-tenant team');
insert into team_members(id,tenant_id,profile_id,display_name,org_unit_id,confirmed_at,effective_from) values
 ('cccc0000-0000-0000-0000-0000000000b1','aaaa0000-0000-0000-0000-0000000000a1','bbbb0000-0000-0000-0000-0000000000b1','Acting staff','bbbb0000-0000-0000-0000-0000000000a1',now(),now()-interval '1 day'),
 ('cccc0000-0000-0000-0000-0000000000b2','aaaa0000-0000-0000-0000-0000000000a1','bbbb0000-0000-0000-0000-0000000000b2','Owned staff','bbbb0000-0000-0000-0000-0000000000a1',now(),now()-interval '1 day'),
 ('cccc0000-0000-0000-0000-0000000000b3','aaaa0000-0000-0000-0000-0000000000a1',null,'Other team staff','bbbb0000-0000-0000-0000-0000000000b3',now(),now()-interval '1 day');
insert into object_classes(class,label,description) values('action','Action','Synthetic action fixture');
insert into domain_object_types(domain,object_type,label,object_class) values('serviceos','Action','Action','action');
insert into state_transitions(domain,object_type,from_state,to_state) values
 ('serviceos','Action','ready','in_progress'),('serviceos','Action','in_progress','waiting');
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref) values
 ('dddd0000-0000-0000-0000-0000000000b1','aaaa0000-0000-0000-0000-0000000000a1','serviceos','Action','action','Authority fixture','ready',
  '{"kind":"member","ref":"cccc0000-0000-0000-0000-0000000000b2"}');
update tenants set metadata=metadata||'{"timezone":"Europe/London"}' where id='aaaa0000-0000-0000-0000-0000000000a1';

do $$ declare t uuid:='aaaa0000-0000-0000-0000-0000000000a1'; o uuid:='dddd0000-0000-0000-0000-0000000000b1';
 u uuid:='bbbb0000-0000-0000-0000-0000000000b1'; m uuid:='cccc0000-0000-0000-0000-0000000000b1';
 owner_id uuid:='cccc0000-0000-0000-0000-0000000000b2'; other_team uuid:='cccc0000-0000-0000-0000-0000000000b3';
 a jsonb; applied jsonb; g uuid; cover_id uuid; failed boolean; n int;
 h jsonb:='{"verb":"start","actor":{"user_id":"bbbb0000-0000-0000-0000-0000000000b1"}}';
begin
 assert learn_work_cover_day(1,'Europe/London','2026-10-05T00:30:00Z');
 assert not learn_work_cover_day(1,'Pacific/Honolulu','2026-10-05T00:30:00Z'), 'Tenant local day matters';
 assert learn_work_cover_day(64,'Europe/London','2026-10-25T01:30:00Z'), 'DST fallback remains the local Sunday';
 assert not learn_work_cover_day(1,null,now());
 assert not learn_work_cover_day(1,'Invalid/Timezone',now());
 assert not learn_work_cover_day(128,'Europe/London',now());
 assert learn_work_cover_day(null,null,now()), 'Explicit all-day cover does not require a timezone';
 a:=learn_work_authority(t,o,u,null);
 assert not (a->>'isAssignee')::boolean and not (a->>'canAssign')::boolean;
 update intelligence_objects set waiting_on_ref=jsonb_build_object('kind','member','ref',m) where id=o;
 assert not (learn_work_authority(t,o,u,null)->>'isAssignee')::boolean, 'Waiting-on is not ownership';
 g:=cp_grant_authority(t,m,'work.assign','self',null,true,'test','Self grant',null,false);
 assert not (learn_work_authority(t,o,u,null)->>'canAssign')::boolean, 'Self grant cannot reach another person';
 perform cp_end_authority(t,g,'test','End self fixture',null,false);
 g:=cp_grant_authority(t,m,'work.assign','team','bbbb0000-0000-0000-0000-0000000000a1',false,'test','Proposed team grant',null,false);
 assert not (learn_work_authority(t,o,u,null)->>'canAssign')::boolean, 'Proposal is not authority';
 perform cp_grant_authority(t,m,'work.assign','team','bbbb0000-0000-0000-0000-0000000000a1',true,'test','Confirm grant',null,false);
 update authority_grants set effective_from=now()+interval '1 day' where id=g;
 assert not (learn_work_authority(t,o,u,null)->>'canAssign')::boolean, 'Future grant is not current authority';
 update authority_grants set effective_from=now()-interval '1 day' where id=g;
 assert (learn_work_authority(t,o,u,owner_id)->>'canAssign')::boolean;
 update team_members set org_unit_id='bbbb0000-0000-0000-0000-0000000000b3' where id=m;
 assert not (learn_work_authority(t,o,u,null,true)->>'canAcceptAssigned')::boolean, 'Accept cannot move work outside the granted team';
 update team_members set org_unit_id='bbbb0000-0000-0000-0000-0000000000a1' where id=m;
 assert not (learn_work_authority(t,o,u,other_team)->>'canAssign')::boolean, 'Team grant cannot assign outside its team';
 update intelligence_objects set accountable_ref=jsonb_build_object('kind','member','ref',other_team) where id=o;
 assert not (learn_work_authority(t,o,u,null)->>'canAssign')::boolean, 'Mixed-team ownership is not one team scope';
 update intelligence_objects set accountable_ref=null where id=o;
 -- Authority was established above, but revocation before apply must still win.
 a:=learn_work_authority(t,o,u,null);
 perform cp_end_authority(t,g,'test','Revoke before apply',null,false);
 n:=(select count(*) from object_state_history where object_id=o);
 failed:=false;
 begin perform work_transition_apply(t,o,1,'in_progress','{}',h,null);
 exception when insufficient_privilege then failed:=true; end;
 assert failed and (select status from intelligence_objects where id=o)='ready';
 assert (select count(*) from object_state_history where object_id=o)=n, 'Denied authority creates no work history';
 cover_id:=cp_upsert_responsibility(t,null,m,'cover',null,'Cover fixture','responsible',false,0,owner_id,true,null,'test','No days selected',null,false);
 assert not (learn_work_authority(t,o,u,null)->>'isAssignee')::boolean;
 cover_id:=cp_upsert_responsibility(t,cover_id,null,null,null,null,'observer',null,127,null,true,null,'test','Observer cover fixture',null,false);
 assert not (learn_work_authority(t,o,u,null)->>'isAssignee')::boolean, 'Observer is not acting cover';
 cover_id:=cp_upsert_responsibility(t,cover_id,null,null,null,null,'responsible',null,127,null,true,null,'test','All days confirmed',null,false);
 a:=learn_work_authority(t,o,u,null);
 assert (a->>'isAssignee')::boolean and (a->>'viaCover')::boolean;
 assert jsonb_array_length(a->'coverIds')=1;
 assert not (a->>'canAcceptAssigned')::boolean, 'Cover is not permanent ownership authority';
 failed:=false;
 begin perform work_transition_apply(t,o,1,'ready',jsonb_build_object('responsible_ref',jsonb_build_object('kind','user','ref',u)),
   '{"verb":"accept","actor":{"user_id":"bbbb0000-0000-0000-0000-0000000000b1"}}',null);
 exception when insufficient_privilege then failed:=true; end;
 assert failed, 'Cover alone cannot claim the assigned item';
 applied:=work_transition_apply(t,o,1,'in_progress','{}',h,null);
 assert (applied->>'version')::int=2;
 assert (select actor->>'acted_via'='cover' and actor->>'member_id'=m::text
   and actor->'cover_assignment_ids' ? cover_id::text from object_state_history where id=(applied->>'history_id')::uuid);
 assert (select responsible_ref->>'ref' from intelligence_objects where id=o)=owner_id::text, 'Acting as cover does not silently reassign the work';
 update team_members set effective_to=clock_timestamp() where id=owner_id;
 assert not (learn_work_authority(t,o,u,null)->>'viaCover')::boolean, 'An ended owner cannot confer cover authority';
 update team_members set effective_to=null where id=owner_id;
 update team_members set confirmed_at=null where id=m;
 failed:=false;
 begin perform learn_work_authority(t,o,u,null); exception when insufficient_privilege then failed:=true; end;
 assert failed, 'Viewer requires confirmed staff identity';
 update team_members set confirmed_at=now() where id=m;
 update intelligence_objects set responsible_ref=jsonb_build_object('kind','user','ref',u),accountable_ref=null where id=o;
 assert (learn_work_authority(t,o,u,null)->>'directOwner')::boolean;
 update intelligence_objects set responsible_ref=null where id=o;
 assert (learn_work_authority(t,o,u,null)->>'canClaimUnassigned')::boolean;
 failed:=false;
 begin
   insert into team_members(tenant_id,profile_id,display_name,confirmed_at) values(t,u,'Duplicate active identity',now());
   perform learn_work_authority(t,o,u,null);
 exception when insufficient_privilege then failed:=true; end;
 assert failed, 'Duplicate active staff identities do not resolve by row order';
 assert not has_function_privilege('authenticated','learn_work_authority(uuid,uuid,uuid,uuid,boolean)','execute');
 assert has_function_privilege('service_role','learn_work_authority(uuid,uuid,uuid,uuid,boolean)','execute');
end $$;
