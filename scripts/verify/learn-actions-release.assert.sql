reset role;
do $$ begin
 assert (select count(*)=6 from object_classes);
 assert (select count(*)=2 from domain_object_types);
 assert (select count(*)=16 from state_definitions);
 assert (select count(*)=30 from state_transitions);
 assert (select count(*)=17 from authority_permissions);
 assert not exists(select 1 from intelligence_objects w where not exists(select 1 from verify.pre_action_work p where p.payload=to_jsonb(w)-'object_class')),'Action install changed work';
 assert not exists(select 1 from object_state_history h where not exists(select 1 from verify.pre_action_history p where p.payload=to_jsonb(h))),'Action install changed history';
 assert (select count(*) from object_state_history)=(select count(*) from verify.pre_action_history);
 assert (select to_jsonb(e)=b.payload from email_messages e cross join verify.email_before b),'Source email changed';
 assert not has_function_privilege('authenticated','work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb)','execute');
 assert not has_function_privilege('anon','learn_work_authority(uuid,uuid,uuid,uuid,boolean)','execute');
 assert has_function_privilege('service_role','work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb)','execute');
 assert not has_function_privilege('service_role','learn_work_cover_day(int,text,timestamptz)','execute');
end $$;
insert into tenants(id,slug,display_name,metadata) values
 (verify.id(801),'synthetic-action-a','Synthetic action A','{"timezone":"Europe/London"}'),
 (verify.id(802),'synthetic-action-b','Synthetic action B','{}');
insert into auth.users(id) select verify.id(n) from generate_series(811,815) n;
insert into profiles(id,tenant_id,role) values
 (verify.id(811),verify.id(801),'viewer'),(verify.id(812),verify.id(801),'viewer'),
 (verify.id(813),verify.id(801),'ops'),(verify.id(814),verify.id(802),'owner'),(verify.id(815),verify.id(801),'owner');
insert into org_units(id,tenant_id,kind,name) values
 (verify.id(821),verify.id(801),'team','Action team A'),(verify.id(822),verify.id(801),'team','Action team other'),(verify.id(823),verify.id(802),'team','Foreign action team');
insert into team_members(id,tenant_id,org_unit_id,profile_id,display_name,confirmed_at,effective_from) values
 (verify.id(831),verify.id(801),verify.id(821),verify.id(811),'Direct owner',now()-interval '1 day',now()-interval '1 day'),
 (verify.id(832),verify.id(801),verify.id(821),verify.id(812),'Cover actor',now()-interval '1 day',now()-interval '1 day'),
 (verify.id(833),verify.id(801),verify.id(821),verify.id(813),'Team authority',now()-interval '1 day',now()-interval '1 day'),
 (verify.id(834),verify.id(801),verify.id(822),null,'Other team recipient',now()-interval '1 day',now()-interval '1 day'),
 (verify.id(835),verify.id(802),verify.id(823),verify.id(814),'Foreign recipient',now()-interval '1 day',now()-interval '1 day');
insert into intelligence_objects(id,tenant_id,domain,object_type,subject,status,responsible_ref,attributes) values
 (verify.id(841),verify.id(801),'serviceos','Action','Governed synthetic action','ready',jsonb_build_object('kind','member','ref',verify.id(831)),
 '{"done_when":"Recorded confirmation","preserved":"Original fact"}'),
 (verify.id(842),verify.id(801),'serviceos','Action','Unclaimed synthetic action','proposed',null,'{}');
-- A denied transaction must leave both the current object and every history row intact.
create function verify.action_error(p_actor int,p_verb text,p_status text,p_patch jsonb,p_code text,p_reason text default 'Synthetic check',p_objective jsonb default null,p_object int default 841)
 returns void language plpgsql as $$
declare prior jsonb;history jsonb;v int;observed text;
begin
 select to_jsonb(o),version into prior,v from intelligence_objects o where id=verify.id(p_object);
 select jsonb_agg(to_jsonb(h) order by id) into history from object_state_history h where object_id=verify.id(p_object);
 begin
  perform work_transition_apply(verify.id(801),verify.id(p_object),v,p_status,p_patch,
   jsonb_build_object('verb',p_verb,'reason',p_reason,'actor',jsonb_build_object('user_id',verify.id(p_actor))),p_objective);
 exception when others then get stacked diagnostics observed=returned_sqlstate;
 end;
 assert observed=p_code,format('Expected %s for %s, got %s',p_code,p_verb,coalesce(observed,'success'));
 assert prior=(select to_jsonb(o) from intelligence_objects o where id=verify.id(p_object)),'Denied action changed object';
 assert history is not distinct from (select jsonb_agg(to_jsonb(h) order by id) from object_state_history h where object_id=verify.id(p_object)),'Denied action changed history';
end $$;
set role service_role;
select verify.action_error(812,'start','in_progress','{}','42501');
select verify.action_error(814,'start','in_progress','{}','42501');
select verify.action_error(815,'start','in_progress','{}','42501');
select verify.action_error(811,'start','in_progress',jsonb_build_object('responsible_ref',jsonb_build_object('kind','member','ref',verify.id(832))),'22023');
select verify.action_error(811,'wait','in_progress','{}','22023');
select verify.action_error(811,'dismiss','cancelled','{}','22023','   ');
reset role;
update state_transitions set guard='{"requires":"approval"}' where domain='serviceos' and object_type='Action' and from_state='ready' and to_state='in_progress';
set role service_role;
select verify.action_error(811,'start','in_progress','{}','22023');
reset role;
update state_transitions set guard=null where domain='serviceos' and object_type='Action' and from_state='ready' and to_state='in_progress';
-- Start commits one canonical capture and one attributable transition, not two captures.
set role service_role;
do $$ declare r jsonb;begin
 r:=work_transition_apply(verify.id(801),verify.id(841),1,'in_progress','{}',jsonb_build_object('verb','start','actor',jsonb_build_object('user_id',verify.id(811))),null);
 assert r->>'version'='2';
 assert (select count(*)=2 from object_state_history where object_id=verify.id(841) and capture_kind is not null);
 assert (select count(*)=1 from object_state_history where object_id=verify.id(841) and capture_kind is null);
 assert (select actor->>'member_id'=verify.id(831)::text and work_before->>'version'='1' and work_after->>'version'='2' from object_state_history where id=(r->>'history_id')::uuid);
 begin perform work_transition_apply(verify.id(801),verify.id(841),1,'waiting','{}',jsonb_build_object('verb','wait','actor',jsonb_build_object('user_id',verify.id(811))),null);
 raise exception 'Stale version accepted';exception when sqlstate 'P0409' then null;end;
end $$;
select verify.action_error(811,'wait','waiting','{}','22023');
select verify.action_error(811,'block','blocked','{"attributes":{"done_when":"Recorded confirmation","preserved":"Original fact","blocker":"  "}}','22023');
select verify.action_error(811,'complete','complete','{}','22023');
select verify.action_error(811,'complete','complete','{"attributes":{"completion_evidence":"Evidence supplied but lost originals"}}','22023');
select verify.action_error(811,'complete','complete','{"attributes":{"done_when":"Recorded confirmation","preserved":"Original fact","completion_evidence":"  "}}','22023');
reset role;
insert into authority_grants(id,tenant_id,member_id,permission,scope,scope_ref,confirmed,effective_from) values
 (verify.id(851),verify.id(801),verify.id(833),'work.assign','team',verify.id(821)::text,true,now()-interval '1 day');
set role service_role;
do $$ begin
 assert (learn_work_authority(verify.id(801),verify.id(841),verify.id(813),verify.id(832))->>'canAssign')::boolean;
 assert not (learn_work_authority(verify.id(801),verify.id(841),verify.id(813),verify.id(834))->>'canAssign')::boolean;
end $$;
select verify.action_error(813,'assign','in_progress',jsonb_build_object('responsible_ref',jsonb_build_object('kind','member','ref',verify.id(834))),'42501');
select verify.action_error(813,'assign','in_progress',jsonb_build_object('responsible_ref',jsonb_build_object('kind','member','ref',verify.id(835))),'22023');
reset role;
update authority_grants set effective_to=clock_timestamp() where id=verify.id(851);
set role service_role;
select verify.action_error(813,'assign','in_progress',jsonb_build_object('responsible_ref',jsonb_build_object('kind','member','ref',verify.id(832))),'42501');
reset role;
-- Temporary cover can move work but cannot silently become its permanent owner.
insert into responsibility_assignments(id,tenant_id,member_id,kind,label,raci_role,cover_for,weekday_mask,confirmed,effective_from) values
 (verify.id(861),verify.id(801),verify.id(832),'cover','Synthetic cover','responsible',verify.id(831),127,true,now()-interval '1 day');
set role service_role;
select verify.action_error(812,'accept','in_progress',jsonb_build_object('responsible_ref',jsonb_build_object('kind','user','ref',verify.id(812))),'42501');
do $$ declare r jsonb;begin
 r:=work_transition_apply(verify.id(801),verify.id(841),2,'waiting','{"waiting_on_ref":{"kind":"note","ref":"Awaiting test confirmation"}}',jsonb_build_object('verb','wait','actor',jsonb_build_object('user_id',verify.id(812))),null);
 assert (select actor->>'acted_via'='cover' and actor->'cover_assignment_ids' ? verify.id(861)::text from object_state_history where id=(r->>'history_id')::uuid);
 assert (select responsible_ref->>'ref'=verify.id(831)::text from intelligence_objects where id=verify.id(841));
end $$;
reset role;
update responsibility_assignments set effective_to=clock_timestamp() where id=verify.id(861);
set role service_role;
select verify.action_error(812,'resume','in_progress','{}','42501');
reset role;
-- Claiming an unowned item requires confirmed staff, not an owner role alone.
set role service_role;
select verify.action_error(815,'accept','ready',jsonb_build_object('responsible_ref',jsonb_build_object('kind','user','ref',verify.id(815))),'42501',p_object=>842);
reset role;
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref) values(verify.id(801),verify.id(811),'user',verify.id(812)::text);
set role service_role;
select verify.action_error(811,'resume','in_progress','{}','42501');
reset role;
update view_as_context set ended_at=clock_timestamp() where actor_user_id=verify.id(811);
set role service_role;
select work_transition_apply(verify.id(801),verify.id(841),3,'in_progress','{}',jsonb_build_object('verb','resume','actor',jsonb_build_object('user_id',verify.id(811))),null);
select work_transition_apply(verify.id(801),verify.id(841),4,'complete','{"attributes":{"done_when":"Recorded confirmation","preserved":"Original fact","completion_evidence":"Confirmed synthetic source"}}',jsonb_build_object('verb','complete','actor',jsonb_build_object('user_id',verify.id(811))),null);
reset role;
do $$ begin
 assert (select count(*)=5 from object_state_history where object_id=verify.id(841) and capture_kind is not null);
 assert (select count(*)=4 from object_state_history where object_id=verify.id(841) and capture_kind is null);
 assert (select status='complete' and version=5 and attributes->>'preserved'='Original fact' from intelligence_objects where id=verify.id(841));
 assert (select to_jsonb(e)=b.payload from email_messages e cross join verify.email_before b);
 assert learn_work_cover_day(1,'Europe/London','2026-10-05T00:30:00Z');
 assert not learn_work_cover_day(1,'Pacific/Honolulu','2026-10-05T00:30:00Z');
 assert learn_work_cover_day(64,'Europe/London','2026-10-25T01:30:00Z');
 assert not learn_work_cover_day(1,null,now());
 assert not learn_work_cover_day(1,'Invalid/Timezone',now());
end $$;
-- Attribution failures roll back the object update and the already-fired capture.
insert into intelligence_objects(id,tenant_id,domain,object_type,subject,status,responsible_ref,attributes) values
 (verify.id(843),verify.id(801),'serviceos','Action','Concurrent action fixture','ready',jsonb_build_object('kind','member','ref',verify.id(831)),'{}');
create function verify.fail_attribution() returns trigger language plpgsql as $$begin
 if new.object_id=verify.id(843) and new.capture_kind is null then raise exception 'Injected attribution failure' using errcode='23514';end if;return new;end $$;
create trigger verify_attribution_failure before insert on object_state_history for each row execute function verify.fail_attribution();
set role service_role;
select verify.action_error(811,'start','in_progress','{}','23514',p_object=>843);
reset role;
drop trigger verify_attribution_failure on object_state_history;
-- Operational collectors see only the canonical stream, not duplicate action annotations.
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000815';
set role authenticated;
do $$ declare h jsonb;begin
 h:=learn_work_history_read(verify.id(801),verify.id(841),now()-interval '1 day',statement_timestamp());
 assert h->>'count'='5','Attributed transitions doubled the canonical timeline';
end $$;
reset role;
