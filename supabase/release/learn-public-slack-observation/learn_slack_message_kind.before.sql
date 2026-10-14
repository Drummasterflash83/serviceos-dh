CREATE OR REPLACE FUNCTION public.learn_slack_message_kind(m jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$begin
 if m->>'type'='message' and m->>'subtype'='tombstone' and m->'hidden'='true'::jsonb then return 'source_withheld';end if;
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
 -- An observed but undocumented subtype is held for source review, not reclassified as activity.
 if m->>'subtype' in ('welcome_party','tabbed_canvas_updated','automatic_ai_huddle_notes_enabled') then return 'source_needs_review';end if;
 if m->>'subtype'='ekm_access_denied' then raise exception 'slack_history_content_unavailable';end if;
 raise exception 'slack_history_message_subtype_unsupported';
end $function$;
