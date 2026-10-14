-- Synthetic source-to-storage journey after the entire production Slack package.
-- Only executed in the disposable offline clone; never calls Slack or reads a key.
set search_path=public,pg_catalog;
create schema verify;
create table verify.slack(result jsonb);
grant usage on schema verify to authenticated,service_role;
grant select,insert on verify.slack to authenticated,service_role;
insert into tenants(id,slug,display_name) values
 ('f7000000-0000-4000-8000-000000000001','production-slack-probe','Synthetic Slack company'),
 ('f7000000-0000-4000-8000-000000000002','production-slack-foreign','Synthetic foreign company');
insert into auth.users(id) values('f7000000-0000-4000-8000-000000000011'),('f7000000-0000-4000-8000-000000000012');
update profiles set tenant_id='f7000000-0000-4000-8000-000000000001',role='owner' where id='f7000000-0000-4000-8000-000000000011';
update profiles set tenant_id='f7000000-0000-4000-8000-000000000002',role='owner' where id='f7000000-0000-4000-8000-000000000012';
insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs) values
 ('f7000000-0000-4000-8000-000000000021','f7000000-0000-4000-8000-000000000001','slack','configured','{"team_id":"TPROBE"}',array['bot_token'],'{"bot_token":"f7000000-0000-4000-8000-000000000022"}');
set request.jwt.claim.sub='f7000000-0000-4000-8000-000000000011';set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare r jsonb;rev text;begin
 select updated_at::text into rev from provider_connections where id='f7000000-0000-4000-8000-000000000021';
 r:=learn_slack_start_import('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000031','f7000000-0000-4000-8000-000000000021',rev,'CPROBE','2026-01-01','2026-01-02',3,'Synthetic archived-schema journey');
 insert into verify.slack values(r);
 assert learn_slack_start_import('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000031','f7000000-0000-4000-8000-000000000021',rev,'CPROBE','2026-01-01','2026-01-02',3,'Synthetic archived-schema journey')->>'jobId'=r->>'jobId';
 begin perform learn_slack_start_import('f7000000-0000-4000-8000-000000000002',gen_random_uuid(),'f7000000-0000-4000-8000-000000000021',rev,'CPROBE','2026-01-01','2026-01-02',3,'Foreign company');raise exception 'Foreign approval admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;set request.jwt.claim.role='service_role';set role service_role;
do $$declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;c jsonb;n jsonb;p jsonb;r jsonb;begin
 select * into strict j from learn_slack_claim_jobs('f7000000-0000-4000-8000-000000000041',1);
 assert j.id=(select (result->>'jobId')::uuid from verify.slack);
 select * into strict a from connector_accounts where id=(select (result->>'accountId')::uuid from verify.slack);
 c:=jsonb_build_object('scopeKey',jsonb_build_array(a.tenant_id::text,a.settings#>>'{slack_history,teamId}',a.settings#>>'{slack_history,channelId}',a.settings#>>'{slack_history,oldest}',a.settings#>>'{slack_history,latest}',a.settings#>>'{slack_history,consentReference}')::text,'cursor',null,'pages',0,'complete',false);
 n:=c||'{"pages":1,"complete":true}';
 p:=jsonb_build_array(jsonb_build_object('tenant_id',a.tenant_id,'channel_id','CPROBE','source_external_id','TPROBE:CPROBE:1767225700.000001','provider_timestamp','1767225700.000001','thread_timestamp',null,'text','Synthetic retained communication','provider_payload','{"ts":"1767225700.000001","text":"Synthetic retained communication","reply_count":2}'::jsonb));
 begin perform slack_history_commit_page(a.tenant_id,j.id,a.id,'expired-worker',1,c,n,p);raise exception 'Unowned publication admitted';exception when sqlstate 'PT409' then null;end;
 assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,c,n,p);
 assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,c,n,p),'Exact replay failed';
 r:=learn_slack_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert (select status='succeeded' from platform_jobs where id=j.id);
 assert (select count(*)=1 from slack_messages where tenant_id=a.tenant_id);
 assert (select count(*)=1 from slack_message_versions where tenant_id=a.tenant_id);
 assert (select count(*)=1 from interactions where tenant_id=a.tenant_id and source_table='slack_messages');
 assert not has_table_privilege('service_role','slack_messages','INSERT,UPDATE,DELETE,TRUNCATE');
end $$;
reset role;
-- An ongoing approval is explicit. Pause stops admission while retained history stays.
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare r jsonb;a uuid;begin
 select (result->>'accountId')::uuid into a from verify.slack;
 r:=learn_slack_recurring_control('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000051',a,0,true,'Synthetic ongoing approval');
 assert r is not null;
end $$;
reset role;
insert into feature_flags(tenant_id,flag,value) values('f7000000-0000-4000-8000-000000000001','learn.inputs.slack.enabled','false');
set request.jwt.claim.role='service_role';set role service_role;
do $$declare before_jobs bigint;r jsonb;begin
 select count(*) into before_jobs from platform_jobs where tenant_id='f7000000-0000-4000-8000-000000000001';
 assert not learn_capture_allowed('f7000000-0000-4000-8000-000000000001','slack');
 r:=learn_slack_schedule_recurring(10);
 assert (select count(*) from platform_jobs where tenant_id='f7000000-0000-4000-8000-000000000001')=before_jobs;
 assert (select count(*)=1 from slack_messages where tenant_id='f7000000-0000-4000-8000-000000000001');
end $$;
reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7000000-0000-4000-8000-000000000012';set role authenticated;
do $$begin
 assert not exists(select 1 from slack_messages);
 assert not exists(select 1 from slack_message_versions);
 begin perform learn_slack_recurring_read('f7000000-0000-4000-8000-000000000001');raise exception 'Foreign status read admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 begin delete from slack_messages where tenant_id='f7000000-0000-4000-8000-000000000001';raise exception 'Source deletion admitted';exception when sqlstate '55000' then null;end;
 insert into provider_connection_events(tenant_id,provider,event) values('f7000000-0000-4000-8000-000000000001','slack','synthetic_retention_probe');
 begin update provider_connection_events set detail='{}' where tenant_id='f7000000-0000-4000-8000-000000000001';raise exception 'Audit overwrite admitted';exception when sqlstate '55000' then null;end;
end $$;

-- Run after the existing synthetic production Slack journey, offline only.
-- The private writer is tested here as database owner; its lack of direct
-- authenticated/service grants is also asserted. Public claim/publish paths
-- have already passed in the preceding journey.
reset role;set search_path=public,pg_catalog;
do $$declare t uuid:='f7000000-0000-4000-8000-000000000001';cfg jsonb;r jsonb;m jsonb;s text;
 rows_before bigint;versions_before bigint;interactions_before bigint;begin
 assert not has_function_privilege('authenticated','learn_slack_message_kind(jsonb)','execute');
 assert not has_function_privilege('service_role','learn_slack_message_kind(jsonb)','execute');
 assert not has_function_privilege('service_role','learn_slack_store_records(uuid,jsonb,jsonb,text)','execute');
 select settings->'slack_history' into strict cfg from connector_accounts where tenant_id=t;
 select count(*) into rows_before from slack_messages where tenant_id=t;
 select count(*) into versions_before from slack_message_versions where tenant_id=t;
 select count(*) into interactions_before from interactions where tenant_id=t and source_table='slack_messages';
 r:='[]';
 for m in select value from jsonb_array_elements('[
  {"type":"message","subtype":"channel_join","ts":"1767225800.000001","text":"Synthetic join"},
  {"type":"message","subtype":"file_share","ts":"1767225801.000001","text":"Synthetic shared file","files":[{"id":"FTEST","url_private":"https://files.slack.com/synthetic"}]},
  {"type":"message","subtype":"me_message","ts":"1767225802.000001","text":"Synthetic action"}
 ]'::jsonb) loop
  r:=r||jsonb_build_array(jsonb_build_object('tenant_id',t,'channel_id','CPROBE',
   'source_external_id','TPROBE:CPROBE:'||(m->>'ts'),'provider_timestamp',m->>'ts',
   'thread_timestamp',null,'text',m->>'text','provider_payload',m));
 end loop;
 perform learn_slack_store_records(t,cfg,r,null);
 perform learn_slack_store_records(t,cfg,r,null);
 assert (select count(*) from slack_messages where tenant_id=t)=rows_before+3,'Source retention or replay differs';
 assert (select count(*) from slack_message_versions where tenant_id=t)=versions_before+3,'Version retention or replay differs';
 assert (select count(*) from interactions where tenant_id=t and source_table='slack_messages')=interactions_before+2,'Activity projected as conversation';
 assert not exists(select 1 from interactions i join slack_messages m on m.id=i.source_id and i.source_table='slack_messages'
  where i.tenant_id=t and m.provider_payload->>'subtype'='channel_join');
 assert (select i.metadata->>'file_content'='not_downloaded' and i.metadata->>'provider_subtype'='file_share'
  from interactions i join slack_messages m on m.id=i.source_id and i.source_table='slack_messages'
  where i.tenant_id=t and m.provider_payload->>'subtype'='file_share');
 assert (select provider_payload=r#>'{0,provider_payload}' from slack_messages where tenant_id=t and provider_timestamp='1767225800.000001');
 -- Shape and subtype decisions match the worker for all supported variants.
 foreach s in array array['bot_message','thread_broadcast','me_message','file_share','file_comment','file_mention'] loop
  assert learn_slack_message_kind(jsonb_build_object('subtype',s))='conversation';
 end loop;
 foreach s in array array['channel_archive','channel_unarchive','channel_join','channel_leave','channel_name','channel_purpose','channel_topic',
 'channel_posting_permissions','channel_convert_to_private','channel_convert_to_public','group_archive','group_unarchive','group_join','group_leave',
 'group_name','group_purpose','group_topic','pinned_item','unpinned_item'] loop
  assert learn_slack_message_kind(jsonb_build_object('subtype',s))='channel_activity';
 end loop;
 for m in select value from jsonb_array_elements('[{"subtype":null},{"subtype":[]},{"hidden":true},{"hidden":"false"},{"type":null},{"type":"reaction_added"},{"subtype":"message_deleted"},{"subtype":"message_changed"},{"subtype":"future_subtype"},{"subtype":"ekm_access_denied"}]') loop
  begin
   perform learn_slack_message_kind(m);raise exception 'Invalid subtype accepted';
  exception when raise_exception then
   if sqlerrm not in ('slack_history_message_shape_unsupported','slack_history_message_subtype_unsupported','slack_history_content_unavailable') then raise;end if;
  end;
 end loop;
 -- A late invalid record rolls back an earlier valid record in the same page.
 r:=jsonb_build_array(jsonb_set(jsonb_set(jsonb_set(r->0,'{source_external_id}','"TPROBE:CPROBE:1767225803.000001"'),'{provider_timestamp}','"1767225803.000001"'),'{provider_payload,ts}','"1767225803.000001"'));
 r:=r||jsonb_build_array(jsonb_set(r->0,'{provider_payload,subtype}','"future_subtype"'));
 -- Give the second record a distinct identity to reach subtype validation.
 r:=jsonb_set(jsonb_set(jsonb_set(r,'{1,source_external_id}','"TPROBE:CPROBE:1767225804.000001"'),'{1,provider_timestamp}','"1767225804.000001"'),'{1,provider_payload,ts}','"1767225804.000001"');
 begin perform learn_slack_store_records(t,cfg,r,null);raise exception 'Unknown record accepted';
 exception when raise_exception then if sqlerrm<>'slack_history_message_subtype_unsupported' then raise;end if;end;
 assert not exists(select 1 from slack_messages where tenant_id=t and provider_timestamp in ('1767225803.000001','1767225804.000001'));
 -- A semantic edit must not leave old conversation observations attached to activity.
 r:=jsonb_build_array(jsonb_set(jsonb_set(jsonb_set(r->0,'{source_external_id}','"TPROBE:CPROBE:1767225801.000001"'),'{provider_timestamp}','"1767225801.000001"'),'{provider_payload,ts}','"1767225801.000001"'));
 begin perform learn_slack_store_records(t,cfg,r,null);raise exception 'Semantic identity change accepted';
 exception when raise_exception then if sqlerrm<>'slack_history_message_kind_changed' then raise;end if;end;
 assert (select count(*) from slack_messages where tenant_id=t)=rows_before+3;
 assert (select count(*) from slack_message_versions where tenant_id=t)=versions_before+3;
 assert (select count(*) from interactions where tenant_id=t and source_table='slack_messages')=interactions_before+2;
end $$;

reset role;set search_path=public,pg_catalog;
do $$declare t uuid:='f7000000-0000-4000-8000-000000000001';cfg jsonb;r jsonb;src bigint;ver bigint;ix bigint;obs bigint;begin
 select settings->'slack_history' into strict cfg from connector_accounts where tenant_id=t;
 select count(*) into src from slack_messages where tenant_id=t;
 select count(*) into ver from slack_message_versions where tenant_id=t;
 select count(*) into ix from interactions where tenant_id=t;
 select count(*) into obs from learn_observation_receipts where tenant_id=t;
 r:=jsonb_build_array(jsonb_build_object('tenant_id',t,'channel_id','CPROBE','source_external_id','TPROBE:CPROBE:1767225899.000001',
 'provider_timestamp','1767225899.000001','thread_timestamp',null,'text','Synthetic unclassified retained input',
 'provider_payload',jsonb_build_object('type','message','subtype','welcome_party','ts','1767225899.000001','text','Synthetic unclassified retained input','reply_count',2)));
 assert learn_slack_message_kind(r#>'{0,provider_payload}')='source_needs_review';
 perform learn_slack_store_records(t,cfg,r,null);perform learn_slack_store_records(t,cfg,r,null);
 assert (select count(*) from slack_messages where tenant_id=t)=src+1;
 assert (select count(*) from slack_message_versions where tenant_id=t)=ver+1;
 assert (select count(*) from interactions where tenant_id=t)=ix,'Unidentified source projected as conversation';
 assert (select count(*) from learn_observation_receipts where tenant_id=t)=obs,'Unidentified source used for scoring';
 assert (select provider_payload=r#>'{0,provider_payload}' from slack_messages where tenant_id=t and provider_timestamp='1767225899.000001');
 assert not has_function_privilege('authenticated','learn_slack_message_kind(jsonb)','execute');
 assert not has_function_privilege('service_role','learn_slack_message_kind(jsonb)','execute');
 begin perform learn_slack_message_kind('{"subtype":"welcome_party","hidden":true}');raise exception 'Hidden accepted';exception when raise_exception then if sqlerrm<>'slack_history_message_shape_unsupported' then raise;end if;end;
 begin perform learn_slack_message_kind('{"subtype":"welcome_party_v2"}');raise exception 'Unknown accepted';exception when raise_exception then if sqlerrm<>'slack_history_message_subtype_unsupported' then raise;end if;end;
end $$;

-- Run after the existing synthetic source-review journey, in an offline clone.
reset role;set search_path=public,pg_catalog;
do $$declare t uuid:='f7000000-0000-4000-8000-000000000001';cfg jsonb;r jsonb;src bigint;ver bigint;ix bigint;obs bigint;begin
 select settings->'slack_history' into strict cfg from connector_accounts where tenant_id=t;
 select count(*) into src from slack_messages where tenant_id=t;
 select count(*) into ver from slack_message_versions where tenant_id=t;
 select count(*) into ix from interactions where tenant_id=t;
 select count(*) into obs from learn_observation_receipts where tenant_id=t;
 r:=jsonb_build_array(jsonb_build_object('tenant_id',t,'channel_id','CPROBE','source_external_id','TPROBE:CPROBE:1767225898.000001',
 'provider_timestamp','1767225898.000001','thread_timestamp',null,'text','Synthetic unclassified retained input',
 'provider_payload',jsonb_build_object('type','message','subtype','automatic_ai_huddle_notes_enabled','ts','1767225898.000001','text','Synthetic unclassified retained input','reply_count',2)));
 assert learn_slack_message_kind(r#>'{0,provider_payload}')='source_needs_review';
 perform learn_slack_store_records(t,cfg,r,null);perform learn_slack_store_records(t,cfg,r,null);
 assert (select count(*) from slack_messages where tenant_id=t)=src+1;
 assert (select count(*) from slack_message_versions where tenant_id=t)=ver+1;
 assert (select count(*) from interactions where tenant_id=t)=ix,'Unidentified source projected as conversation';
 assert (select count(*) from learn_observation_receipts where tenant_id=t)=obs,'Unidentified source used for scoring';
 assert (select provider_payload=r#>'{0,provider_payload}' from slack_messages where tenant_id=t and provider_timestamp='1767225898.000001');
 assert not has_function_privilege('authenticated','learn_slack_message_kind(jsonb)','execute');
 assert not has_function_privilege('service_role','learn_slack_message_kind(jsonb)','execute');
 begin perform learn_slack_message_kind('{"subtype":"automatic_ai_huddle_notes_enabled","hidden":true}');raise exception 'Hidden accepted';exception when raise_exception then if sqlerrm<>'slack_history_message_shape_unsupported' then raise;end if;end;
 begin perform learn_slack_message_kind('{"subtype":"automatic_ai_huddle_notes_enabled_v2"}');raise exception 'Unknown accepted';exception when raise_exception then if sqlerrm<>'slack_history_message_subtype_unsupported' then raise;end if;end;
end $$;
