-- Exact observed undocumented Slack subtype: retain source/version, hold interpretation.
-- No provider calls, activation, credential, permission or stored-source changes.
begin;
create or replace function public.learn_slack_message_kind(m jsonb) returns text
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
 -- An observed but undocumented subtype is held for source review, not reclassified as activity.
 if m->>'subtype'='welcome_party' then return 'source_needs_review';end if;
 if m->>'subtype'='ekm_access_denied' then raise exception 'slack_history_content_unavailable';end if;
 raise exception 'slack_history_message_subtype_unsupported';
end $$;

do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_store_records(uuid,jsonb,jsonb,text)'::regprocedure);
 needle:=$old$if public.learn_slack_message_kind(r->'provider_payload')='channel_activity' then continue;end if;$old$;
 replacement:=$new$if public.learn_slack_message_kind(r->'provider_payload') in ('channel_activity','source_needs_review') then continue;end if;$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed source-only projection differs';end if;
 execute replace(d,needle,replacement);
 -- Unknown parent semantics must not cause genuine observed replies to disappear.
 -- Their own records pass the same classifier; no thread content is inferred.
 d:=pg_get_functiondef('public.learn_slack_campaign_threads_step(uuid,uuid)'::regprocedure);
 needle:=$old$public.learn_slack_message_kind(sm.provider_payload)='conversation'$old$;
 replacement:=$new$public.learn_slack_message_kind(sm.provider_payload) in ('conversation','source_needs_review')$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed observed thread discovery differs';end if;
 execute replace(d,needle,replacement);
 -- Existing authorised read exposes the honest interpretation gap, without text.
 d:=pg_get_functiondef('public.learn_slack_campaign_read(uuid,uuid)'::regprocedure);
 needle:=$old$'threadsComplete',threads_done,'complete',all_done,$old$;
 replacement:=$new$'sourceNeedsReviewCount',(select count(*) from public.slack_messages sm
  where sm.tenant_id=h.tenant_id and sm.team_id=h.team_id
   and sm.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
   and exists(select 1 from public.slack_history_campaign_channels mc where mc.campaign_id=h.id and mc.tenant_id=h.tenant_id and mc.channel_id=sm.channel_id)
   and sm.provider_payload->>'subtype'='welcome_party'),
 'threadsComplete',threads_done,'complete',all_done,$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign coverage reader differs';end if;
 execute replace(d,needle,replacement);
end $$;
commit;
