-- Exact observed undocumented Slack subtype: retain source/version, hold interpretation.
-- No provider calls, activation, credential, permission or stored-source changes.
begin;
set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from 'd3794e8ed87fcc0ac3cdf0b601a9c5e70826db575251b66c2c5ba7ac893625fa' then raise exception 'Exact source-review release target/source/role required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_card_slack_job_context(uuid,uuid,uuid)'::regprocedure) is distinct from '17ee19d5f244e41cbf243532b5b0e5b6|postgres|{postgres=X/postgres,learn_card_communication_reader=X/postgres}' then raise exception 'Reviewed learn_card_slack_job_context definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)'::regprocedure) is distinct from '761848346ab060f537354ac8904e7847|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_dispatch definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_read(uuid,uuid)'::regprocedure) is distinct from 'dac12f56ff35f3d6591b01ee4c90cd9a|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_read definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure) is distinct from '29fc3bba92be4e9346dc49cc3ef9fe65|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_recover_page definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)'::regprocedure) is distinct from 'f2ad8d3280a6c89294259d970e0b7f4f|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_reserve_request definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_threads_step(uuid,uuid)'::regprocedure) is distinct from '10205011300e13026c4b42df59fcfd23|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_threads_step definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_message_kind(jsonb)'::regprocedure) is distinct from 'f64096149cb752fd4e9f0e47aa6b3774|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_message_kind definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_store_records(uuid,jsonb,jsonb,text)'::regprocedure) is distinct from '0331faccc349d05a2f0c17d10f5f27c8|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_store_records definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.slack_commit_attested_page(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb)'::regprocedure) is distinct from '7e97b224d3dc219202f5eba08b9e17bd|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed slack_commit_attested_page definition/access differs';end if;
end$guard$;

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
do $guard$begin
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_card_slack_job_context(uuid,uuid,uuid)'::regprocedure) is distinct from '17ee19d5f244e41cbf243532b5b0e5b6|postgres|{postgres=X/postgres,learn_card_communication_reader=X/postgres}' then raise exception 'Reviewed learn_card_slack_job_context definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)'::regprocedure) is distinct from '761848346ab060f537354ac8904e7847|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_dispatch definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_read(uuid,uuid)'::regprocedure) is distinct from 'a35cdfd9bb69d768da4ed603140425c9|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_read definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure) is distinct from '29fc3bba92be4e9346dc49cc3ef9fe65|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_recover_page definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)'::regprocedure) is distinct from 'f2ad8d3280a6c89294259d970e0b7f4f|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_reserve_request definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_threads_step(uuid,uuid)'::regprocedure) is distinct from 'f3e7314dc78f6081a13eb13f9fbca993|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_threads_step definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_message_kind(jsonb)'::regprocedure) is distinct from 'd2662da691a9233b0d363912374ad128|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_message_kind definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_store_records(uuid,jsonb,jsonb,text)'::regprocedure) is distinct from '94d9e755e8f0913caec8a42c36925aa6|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_store_records definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.slack_commit_attested_page(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb)'::regprocedure) is distinct from '7e97b224d3dc219202f5eba08b9e17bd|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed slack_commit_attested_page definition/access differs';end if;
end$guard$;
notify pgrst,'reload schema';
commit;
