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
