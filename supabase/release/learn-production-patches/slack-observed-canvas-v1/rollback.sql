begin;set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from '5b1f53fa2ae21b5ef8af8862299ab8251a6fa2af483fdf763f77b7a1f4c5896f' then raise exception 'Exact source-review release target/source/role required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_card_slack_job_context(uuid,uuid,uuid)'::regprocedure) is distinct from '17ee19d5f244e41cbf243532b5b0e5b6|postgres|{postgres=X/postgres,learn_card_communication_reader=X/postgres}' then raise exception 'Reviewed learn_card_slack_job_context definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)'::regprocedure) is distinct from '761848346ab060f537354ac8904e7847|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_dispatch definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_read(uuid,uuid)'::regprocedure) is distinct from '7e5932c66ff7915df26d8e3e53ba6f21|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_read definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure) is distinct from '29fc3bba92be4e9346dc49cc3ef9fe65|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_recover_page definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)'::regprocedure) is distinct from 'f2ad8d3280a6c89294259d970e0b7f4f|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_reserve_request definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_threads_step(uuid,uuid)'::regprocedure) is distinct from 'cbc8c540043042d736f53d5cc5971e53|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_threads_step definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_message_kind(jsonb)'::regprocedure) is distinct from '851d62e317c87461586c9568812e6ce4|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_message_kind definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_store_records(uuid,jsonb,jsonb,text)'::regprocedure) is distinct from '4f27b22141c8ffdaedf498bf2c7bae45|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_store_records definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.slack_commit_attested_page(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb)'::regprocedure) is distinct from '7e97b224d3dc219202f5eba08b9e17bd|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed slack_commit_attested_page definition/access differs';end if;
if exists(select 1 from public.slack_messages where provider_payload->>'subtype'='tabbed_canvas_updated') then raise exception 'Retained held sources exist; preserve additive SQL and roll back runtime only';end if;
if exists(select 1 from public.platform_jobs where job_type in ('slack.history_sync','slack.thread_sync') and status='running') then raise exception 'Running Slack lease; wait before rollback';end if;
end$guard$;
CREATE OR REPLACE FUNCTION public.learn_slack_campaign_read(p_tenant uuid, p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare h public.slack_history_campaigns%rowtype;rows jsonb;threads_done boolean;all_done boolean;begin
 perform public.learn_slack_control_access(p_tenant,false,'history');
 select * into h from public.slack_history_campaigns where id=p_campaign and tenant_id=p_tenant;
 if not found then raise exception 'slack_campaign_unavailable' using errcode='42501';end if;
 if exists(select 1 from public.slack_history_campaign_closures where campaign_id=h.id) then
  return (select x.snapshot||jsonb_build_object('enabled',false,'revision',h.revision,'lifecycle',x.outcome,'closedAt',x.created_at)
   from public.slack_history_campaign_closures x where x.campaign_id=h.id and x.tenant_id=p_tenant);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('accountId',m.account_id,'channelId',m.channel_id,'approvalId',m.current_import,
 'state',case when progress->'complete'='true'::jsonb then 'campaign_window_complete' else m.state end,
 'pagesThisApproval',a.sync_cursor->'pages')||progress order by m.channel_id),'[]'::jsonb)
 into rows from public.slack_history_campaign_channels m join public.connector_accounts a on a.id=m.account_id and a.tenant_id=m.tenant_id
 cross join lateral public.learn_slack_campaign_channel_progress(m.campaign_id,m.account_id) progress where m.campaign_id=h.id;
 select coalesce(bool_and((value->>'threadsComplete')::boolean),false),coalesce(bool_and((value->>'complete')::boolean),false)
 into threads_done,all_done from jsonb_array_elements(rows);
 return jsonb_build_object('version','learn-slack-campaign/1','tenantId',p_tenant,'campaignId',h.id,'revision',h.revision,
 'enabled',h.enabled,'start',h.starts_at,'end',h.ends_at,'expiresAt',h.expires_at,'requestBudget',h.request_budget,
 'requestsReserved',h.requests_reserved,'requestAccounting','conservative_dispatch_reservations',
 'sourceNeedsReviewCount',(select count(*) from public.slack_messages sm
  where sm.tenant_id=h.tenant_id and sm.team_id=h.team_id
   and sm.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
   and exists(select 1 from public.slack_history_campaign_channels mc where mc.campaign_id=h.id and mc.tenant_id=h.tenant_id and mc.channel_id=sm.channel_id)
   and sm.provider_payload->>'subtype'='welcome_party'),
 'sourceWithheldCount',(select count(*) from public.slack_messages sm
  where sm.tenant_id=h.tenant_id and sm.team_id=h.team_id
   and sm.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
   and exists(select 1 from public.slack_history_campaign_channels mc where mc.campaign_id=h.id and mc.tenant_id=h.tenant_id and mc.channel_id=sm.channel_id)
   and sm.provider_payload->>'type'='message' and sm.provider_payload->>'subtype'='tombstone' and sm.provider_payload->'hidden'='true'::jsonb),
 'threadsComplete',threads_done,'complete',all_done,'coverage','fixed_window_observed_threads','channels',rows);
end$function$
;
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
 if m->>'subtype'='welcome_party' then return 'source_needs_review';end if;
 if m->>'subtype'='ekm_access_denied' then raise exception 'slack_history_content_unavailable';end if;
 raise exception 'slack_history_message_subtype_unsupported';
end $function$
;
notify pgrst,'reload schema';commit;
