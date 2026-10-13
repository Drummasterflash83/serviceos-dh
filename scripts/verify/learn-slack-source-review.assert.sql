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
