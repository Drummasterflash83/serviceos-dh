-- Retain channel activity as source/version evidence without publishing it as
-- conversation input. No activation, provider request or existing-row rewrite.
begin;
create function public.learn_slack_message_kind(m jsonb) returns text
language plpgsql immutable security invoker set search_path=pg_catalog as $$begin
 if jsonb_typeof(m) is distinct from 'object'
  or (m ? 'type' and m->>'type' is distinct from 'message')
  or (m ? 'hidden' and m->'hidden' is distinct from 'false'::jsonb)
  or (m ? 'subtype' and jsonb_typeof(m->'subtype') is distinct from 'string') then
  raise exception 'slack_history_message_shape_unsupported';end if;
 if not(m ? 'subtype') or m->>'subtype' in
  ('bot_message','thread_broadcast','me_message','file_share','file_comment','file_mention') then return 'conversation';end if;
 if m->>'subtype' in ('channel_archive','channel_unarchive','channel_join','channel_leave',
  'channel_name','channel_purpose','channel_topic','channel_posting_permissions',
  'channel_convert_to_private','channel_convert_to_public','group_archive','group_unarchive',
  'group_join','group_leave','group_name','group_purpose','group_topic','pinned_item','unpinned_item')
  then return 'channel_activity';end if;
 if m->>'subtype'='ekm_access_denied' then raise exception 'slack_history_content_unavailable';end if;
 raise exception 'slack_history_message_subtype_unsupported';
end $$;
revoke all on function public.learn_slack_message_kind(jsonb) from public,anon,authenticated,service_role;

do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_store_records(uuid,jsonb,jsonb,text)'::regprocedure);
 needle:=E'  seen=array_append(seen,r->>''provider_timestamp'');';
 replacement:=$patch$  -- Classify independently in the durable writer, not from worker-supplied labels.
  perform public.learn_slack_message_kind(r->'provider_payload');
  if r->'provider_payload'->>'subtype'='thread_broadcast' and
   (r->>'thread_timestamp' is null or (r->>'thread_timestamp')::numeric >= (r->>'provider_timestamp')::numeric) then
   raise exception 'history_record_invalid';end if;
  -- Refuse a semantic identity change rather than leave an existing conversation
  -- attached to newly classified activity or erase its prior observations.
  if exists(select 1 from public.slack_messages m where m.tenant_id=p_tenant_id
   and m.source_external_id=r->>'source_external_id'
   and public.learn_slack_message_kind(m.provider_payload) <> public.learn_slack_message_kind(r->'provider_payload')) then
   raise exception 'slack_history_message_kind_changed';end if;
  seen=array_append(seen,r->>'provider_timestamp');$patch$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack kind validation differs';end if;
 d:=replace(d,needle,replacement);
 needle:='  -- Reuse the single existing interaction/observation engine.';
 replacement:=$patch$  -- System activity remains in both retained source tables. It is not a customer
  -- conversation, outstanding task or individual-performance observation.
  if public.learn_slack_message_kind(r->'provider_payload')='channel_activity' then continue;end if;
  -- Reuse the single existing interaction/observation engine.$patch$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack activity projection differs';end if;
 d:=replace(d,needle,replacement);
 needle:='''source_version'',version_hash))';
 replacement:=$patch$'source_version',version_hash,'message_kind','conversation',
    'provider_subtype',r->'provider_payload'->>'subtype','file_content','not_downloaded'))$patch$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack content metadata differs';end if;
 execute replace(d,needle,replacement);
end $$;
commit;
