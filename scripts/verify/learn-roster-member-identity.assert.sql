-- Disposable schema clone only. Identity and audit rows are synthetic.
insert into auth.users(id,email,is_sso_user,is_anonymous) values
 ('bbbb0000-0000-0000-0000-0000000000b4','handoff@authority.test',false,false),
 ('bbbb0000-0000-0000-0000-0000000000b5','operator@authority.test',false,false),
 ('bbbb0000-0000-0000-0000-0000000000b6','foreign@authority.test',false,false);
update profiles set tenant_id='aaaa0000-0000-0000-0000-0000000000a1',role='owner'
 where id in ('bbbb0000-0000-0000-0000-0000000000b4','bbbb0000-0000-0000-0000-0000000000b5');
update profiles set tenant_id='aaaa0000-0000-0000-0000-0000000000a2',role='owner'
 where id='bbbb0000-0000-0000-0000-0000000000b6';
insert into team_members(id,tenant_id,profile_id,display_name,observed_status,effective_from) values
 ('cccc0000-0000-0000-0000-0000000000b4','aaaa0000-0000-0000-0000-0000000000a1',
  'bbbb0000-0000-0000-0000-0000000000b4','Handoff recipient','proposed',now()-interval '1 day'),
 ('cccc0000-0000-0000-0000-0000000000b5','aaaa0000-0000-0000-0000-0000000000a1',
  null,'Unlinked recipient','proposed',now()-interval '1 day'),
 ('cccc0000-0000-0000-0000-0000000000b6','aaaa0000-0000-0000-0000-0000000000a2',
  'bbbb0000-0000-0000-0000-0000000000b6','Foreign recipient','proposed',now()-interval '1 day');

set role service_role;
set request.jwt.claim.role = 'service_role';
do $$
declare t uuid:='aaaa0000-0000-0000-0000-0000000000a1';
 m uuid:='cccc0000-0000-0000-0000-0000000000b4';
 u uuid:='bbbb0000-0000-0000-0000-0000000000b5';
 failed boolean; n bigint; result jsonb;
begin
 n:=(select count(*) from controlplane_change_log where tenant_id=t);
 failed:=false;
 begin perform cp_confirm_member_identity(t,'cccc0000-0000-0000-0000-0000000000b6',1,u,'test','Foreign member',null,false);
 exception when no_data_found then failed:=true; end;
 assert failed;
 failed:=false;
 begin perform cp_confirm_member_identity(t,'cccc0000-0000-0000-0000-0000000000b5',1,u,'test','No linked login',null,false);
 exception when invalid_parameter_value then failed:=true; end;
 assert failed;
 failed:=false;
 begin perform cp_confirm_member_identity(t,m,2,u,'test','Stale version',null,false);
 exception when sqlstate 'P0409' then failed:=true; end;
 assert failed;
 failed:=false;
 begin perform cp_confirm_member_identity(t,m,1,u,'test','View-As denied',null,true);
 exception when raise_exception then failed:=true; end;
 assert failed;
 failed:=false;
 begin perform cp_confirm_member_identity(t,m,1,u,'test','',null,false);
 exception when raise_exception then failed:=true; end;
 assert failed;
 assert (select count(*) from controlplane_change_log where tenant_id=t)=n;
 result:=cp_confirm_member_identity(t,m,1,u,'test','Verified synthetic login',null,false);
 assert (result->>'version')::int=2;
 assert (select confirmed_at is not null and confirmed_by=u and observed_status='proposed'
         and version=2 from team_members where id=m),
  'Confirmed login must not confirm proposed job role';
 assert (select count(*) from controlplane_change_log where tenant_id=t
         and action='controlplane.roster.member_identity_confirm' and resource_id=m::text
         and reason='Verified synthetic login' and before->>'confirmed_at' is null
         and after->>'confirmed_at' is not null)=1;
 failed:=false;
 begin perform cp_confirm_member_identity(t,m,2,u,'test','Replay denied',null,false);
 exception when invalid_parameter_value then failed:=true; end;
 assert failed;
end $$;
reset role;
reset request.jwt.claim.role;
do $$begin
 assert not has_function_privilege('anon','cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)','execute');
 assert not has_function_privilege('authenticated','cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)','execute');
 assert has_function_privilege('service_role','cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)','execute');
end $$;
