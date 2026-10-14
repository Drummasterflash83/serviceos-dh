-- Caller runs this fixture inside a transaction and rolls it back.
create function pg_temp.sr(n int) returns uuid language sql immutable as $$select ('caa14000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.sr(int) to authenticated;
insert into public.tenants(id,slug,display_name,status) values(pg_temp.sr(1),'source-reader-a','Synthetic source A','active'),(pg_temp.sr(2),'source-reader-b','Synthetic source B','active');
insert into auth.users(id,email,banned_until) values(pg_temp.sr(10),'source-reader@example.invalid','infinity');
insert into public.profiles(id,tenant_id,role) values(pg_temp.sr(10),pg_temp.sr(1),'owner') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.provider_connections(id,tenant_id,provider,status,auth_mode,non_secret_config) values(pg_temp.sr(20),pg_temp.sr(1),'slack','configured','api_key','{"team_id":"TTEST"}');
insert into public.tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled) values(pg_temp.sr(21),pg_temp.sr(1),'slack','slack','communications','active',true);
insert into public.connector_accounts(id,tenant_id,tenant_connector_id,account_key,status) values(pg_temp.sr(22),pg_temp.sr(1),pg_temp.sr(21),'TTEST:CTEST','active');
create function pg_temp.message(n int, flags jsonb default '{}', proof boolean default true, body text default 'Synthetic historical request', subtype text default null) returns void language plpgsql as $$
declare payload jsonb;v uuid:=pg_temp.sr(200+n);e uuid:=pg_temp.sr(300+n);job uuid:=pg_temp.sr(400+n);s uuid:=pg_temp.sr(100+n);stamp text:=(1649347021+n)::text||'.123456';begin
 payload:=jsonb_build_object('type','message','ts',stamp,'text',body,'user','UTEST','private_unreturned','DO_NOT_RETURN');
 if subtype is not null then payload:=payload||jsonb_build_object('subtype',subtype,'hidden',true);end if;
 insert into public.slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,message_text,provider_payload,source_version,source_updated_at)
 values(s,pg_temp.sr(1),'TTEST:CTEST:'||stamp,'TTEST','CTEST',stamp,body,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),stamp::numeric);
 insert into public.slack_message_versions(id,tenant_id,message_id,source_version,provider_payload)select v,tenant_id,id,source_version,provider_payload from public.slack_messages where id=s;
 if not proof then return;end if;
 insert into public.platform_jobs(id,tenant_id,job_type,job_key,status,payload) values(job,pg_temp.sr(1),'slack.history_sync','source-reader-'||n,'succeeded','{}');
 insert into public.slack_channel_visibility_receipts(id,tenant_id,job_id,account_id,claimed_by,attempt_count,connection_id,connection_revision,team_id,channel_id,evidence,evidence_sha256,page_sha256)
 select e,pg_temp.sr(1),job,pg_temp.sr(22),'synthetic',1,id,updated_at,'TTEST','CTEST',jsonb_build_object('version','slack-capture-visibility/1','team_id','TTEST','channel_id','CTEST','connection_id',id,'connection_revision',updated_at,'is_channel',true,'is_private',false,'is_shared',false,'pending_shared',false,'is_im',false,'is_mpim',false,'is_ext_shared',false,'is_org_shared',false,'is_pending_ext_shared',false)||flags,repeat('c',64),repeat('d',64) from public.provider_connections where id=pg_temp.sr(20);
 insert into public.slack_source_visibility_proofs values(e,v);
end$$;
select pg_temp.message(1);
select pg_temp.message(2,'{}',false);
select pg_temp.message(3,'{"is_private":true}');
select pg_temp.message(4,'{"is_im":true}');
select pg_temp.message(5,'{"is_mpim":true}');
select pg_temp.message(6,'{"is_shared":true}');
select pg_temp.message(7,'{"is_ext_shared":true}');
select pg_temp.message(8,'{"pending_shared":true}');
select pg_temp.message(9,'{"team_id":"TOTHER"}');
select pg_temp.message(10,'{}',true,'','tombstone');
select pg_temp.message(11,'{}',true,repeat('😀',40001));
select pg_temp.message(12,'{}',true,'Synthetic changed source');
update public.slack_messages set source_version=repeat('b',64) where id=pg_temp.sr(112);
create temporary table source_reader_before as select id,md5(to_jsonb(s)::text) h from public.slack_messages s where tenant_id=pg_temp.sr(1);
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='caa14000-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare p jsonb;n int;begin
 p:=public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(101));
 assert p->>'version'='learn-slack-card-source/1' and p->'audit_id'='null' and p->'operator_mode'='false';
 assert p#>>'{record,message_text}'='Synthetic historical request' and p#>>'{record,author_ref}'='UTEST';
 assert p::text not like '%DO_NOT_RETURN%' and p::text not like '%provider_payload%' and p::text not like '%secret%';
 p:=public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(111));assert length(p#>>'{record,message_text}')=40000 and p#>'{record,text_shortened}'='true';
 foreach n in array array[102,103,104,105,106,107,108,109,110,112,999] loop
  begin perform public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(n));raise exception 'Unavailable source admitted %',n;exception when insufficient_privilege then null;end;
 end loop;
 begin perform public.learn_slack_card_source_read(pg_temp.sr(2),pg_temp.sr(101));raise exception 'Foreign tenant admitted';exception when insufficient_privilege then null;end;
end$$;reset role;
-- Disabling capture retains authorised source reads.
update public.connector_accounts set status='disabled' where id=pg_temp.sr(22);set local role authenticated;
do $$begin assert public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(101))#>>'{record,message_text}'='Synthetic historical request';end$$;reset role;
update public.provider_connections set revoked_at=clock_timestamp() where id=pg_temp.sr(20);set local role authenticated;
do $$begin begin perform public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(101));raise exception 'Revoked connection admitted';exception when insufficient_privilege then null;end;end$$;reset role;
update public.provider_connections set revoked_at=null where id=pg_temp.sr(20);
update public.profiles set tenant_id=pg_temp.sr(2),role='viewer' where id=pg_temp.sr(10);set local role authenticated;
do $$begin begin perform public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(101));raise exception 'Foreign viewer admitted';exception when insufficient_privilege then null;end;end$$;reset role;
insert into public.platform_authority_grants(profile_id,permission,granted_by,effective_to) values(pg_temp.sr(10),'platform.controlplane.admin','rollback fixture',clock_timestamp()+interval '5 minutes');set local role authenticated;
do $$declare p jsonb;begin
 p:=public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(101),'Review selected client source');assert p->>'audit_id' is not null and p->'operator_mode'='true' and p->>'actor_id'=pg_temp.sr(10)::text;
 begin perform public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(101),'');raise exception 'Blank reason accepted';exception when invalid_parameter_value then null;end;
end$$;reset role;
do $$begin assert (select count(*)=1 from public.controlplane_change_log where source='learn-slack-card-source' and actor=pg_temp.sr(10)::text);end$$;
create function pg_temp.source_audit_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic_slack_audit_failure';end$$;
create trigger source_audit_fail before insert on public.controlplane_change_log for each row execute function pg_temp.source_audit_fail();set local role authenticated;
do $$begin begin perform public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(101),'Audit failure');raise exception 'Unaudited data returned';exception when raise_exception then if sqlerrm<>'synthetic_slack_audit_failure' then raise;end if;end;end$$;reset role;
drop trigger source_audit_fail on public.controlplane_change_log;
insert into public.view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values(pg_temp.sr(1),pg_temp.sr(10),'role','viewer','rollback');set local role authenticated;
do $$begin begin perform public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(101),'Preview denied');raise exception 'Preview admitted';exception when insufficient_privilege then null;end;end$$;reset role;
update public.view_as_context set ended_at=clock_timestamp() where actor_user_id=pg_temp.sr(10);
update public.platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.sr(10);set local role authenticated;
do $$begin begin perform public.learn_slack_card_source_read(pg_temp.sr(1),pg_temp.sr(101),'Revoked operator');raise exception 'Revoked operator admitted';exception when insufficient_privilege then null;end;end$$;reset role;
do $$begin
 assert not exists(select 1 from source_reader_before b join public.slack_messages s on s.id=b.id where b.h<>md5(to_jsonb(s)::text));
 assert not has_function_privilege('anon','public.learn_slack_card_source_read(uuid,uuid,text)','execute');
 assert not has_function_privilege('service_role','public.learn_slack_card_source_read(uuid,uuid,text)','execute');
end$$;
