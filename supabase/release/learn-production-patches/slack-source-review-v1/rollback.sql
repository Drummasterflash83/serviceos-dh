begin;set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from 'd3794e8ed87fcc0ac3cdf0b601a9c5e70826db575251b66c2c5ba7ac893625fa' then raise exception 'Exact source-review release target/source/role required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_card_slack_job_context(uuid,uuid,uuid)'::regprocedure) is distinct from '17ee19d5f244e41cbf243532b5b0e5b6|postgres|{postgres=X/postgres,learn_card_communication_reader=X/postgres}' then raise exception 'Reviewed learn_card_slack_job_context definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)'::regprocedure) is distinct from '761848346ab060f537354ac8904e7847|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_dispatch definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_read(uuid,uuid)'::regprocedure) is distinct from 'a35cdfd9bb69d768da4ed603140425c9|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_read definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure) is distinct from '29fc3bba92be4e9346dc49cc3ef9fe65|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_recover_page definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)'::regprocedure) is distinct from 'f2ad8d3280a6c89294259d970e0b7f4f|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_reserve_request definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_threads_step(uuid,uuid)'::regprocedure) is distinct from 'f3e7314dc78f6081a13eb13f9fbca993|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_campaign_threads_step definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_message_kind(jsonb)'::regprocedure) is distinct from 'd2662da691a9233b0d363912374ad128|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_message_kind definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_store_records(uuid,jsonb,jsonb,text)'::regprocedure) is distinct from '94d9e755e8f0913caec8a42c36925aa6|postgres|{postgres=X/postgres}' then raise exception 'Reviewed learn_slack_store_records definition/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.slack_commit_attested_page(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb)'::regprocedure) is distinct from '7e97b224d3dc219202f5eba08b9e17bd|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed slack_commit_attested_page definition/access differs';end if;
if exists(select 1 from public.slack_messages where provider_payload->>'subtype'='welcome_party') then raise exception 'Retained held sources exist; preserve additive SQL and roll back runtime only';end if;
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
 'threadsComplete',threads_done,'complete',all_done,'coverage','fixed_window_observed_threads','channels',rows);
end$function$
;
CREATE OR REPLACE FUNCTION public.learn_slack_campaign_threads_step(p_campaign uuid, p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare h public.slack_history_campaigns%rowtype;c public.slack_history_campaign_channels%rowtype;a public.connector_accounts%rowtype;
 scan public.slack_history_campaign_thread_scans%rowtype;member public.slack_history_campaign_threads%rowtype;
 t public.slack_thread_imports%rowtype;last_job public.platform_jobs%rowtype;root record;progress jsonb;cfg jsonb;scope jsonb;cp jsonb;d jsonb;
 n integer:=0;request_id uuid;job_id uuid;key text;can_renew boolean;begin
 if auth.role() is distinct from 'service_role' or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'slack_campaign_forbidden' using errcode='42501';end if;
 select * into h from public.slack_history_campaigns where id=p_campaign;
 if not found then return jsonb_build_object('state','campaign_unavailable','queued',false);end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||h.tenant_id::text,0));
 select * into h from public.slack_history_campaigns where id=p_campaign for update;
 select * into c from public.slack_history_campaign_channels where campaign_id=h.id and account_id=p_account and tenant_id=h.tenant_id for update;
 if not found then return jsonb_build_object('state','channel_unavailable','queued',false);end if;
 select * into a from public.connector_accounts where id=c.account_id and tenant_id=h.tenant_id for update;
 progress:=public.learn_slack_campaign_channel_progress(h.id,a.id);
 if progress->'complete'='true'::jsonb then return jsonb_build_object('state','campaign_window_complete','queued',false);end if;
 if progress->'channelPagesComplete' is distinct from 'true'::jsonb then return jsonb_build_object('state','channel_completion_unverified','queued',false);end if;
 if not public.learn_slack_campaign_authority(h.id) then return jsonb_build_object('state','authority_or_capture_unavailable','queued',false);end if;
 if h.requests_reserved>=h.request_budget then return jsonb_build_object('state','request_budget_exhausted','queued',false);end if;
 cfg:=a.settings->'slack_history';
 if a.status<>'active' or cfg->'approved' is distinct from 'true'::jsonb or not exists(select 1 from public.tenant_connectors tc
 where tc.id=a.tenant_connector_id and tc.tenant_id=h.tenant_id and tc.connector_id='slack' and tc.enabled and tc.status='active') then
 return jsonb_build_object('state','account_or_connector_unavailable','queued',false);end if;
 insert into public.slack_history_campaign_thread_scans(campaign_id,account_id,tenant_id) values(h.id,a.id,h.tenant_id) on conflict do nothing;
 select * into scan from public.slack_history_campaign_thread_scans where campaign_id=h.id and account_id=a.id for update;
 if not scan.discovery_complete then
  -- Unusable parent evidence is a coverage gap, not an empty thread list.
  if exists(select 1 from public.slack_messages sm where sm.tenant_id=h.tenant_id and sm.team_id=h.team_id and sm.channel_id=c.channel_id
   and sm.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
   and ((sm.provider_payload ? 'reply_count' and case when jsonb_typeof(sm.provider_payload->'reply_count')='number'
    and sm.provider_payload->>'reply_count' ~ '^[0-9]+$' then (sm.provider_payload->>'reply_count')::numeric>9007199254740991 else true end)
    or sm.thread_timestamp::numeric>sm.provider_timestamp::numeric)) then
   return jsonb_build_object('state','thread_evidence_invalid','queued',false);end if;
  for root in with observed as (
   select sm.id,sm.source_version,sm.provider_timestamp,
    case when sm.thread_timestamp is not null and sm.thread_timestamp::numeric<sm.provider_timestamp::numeric then sm.thread_timestamp::numeric
     when coalesce(sm.provider_payload->>'reply_count','') ~ '^[0-9]+$' and (sm.provider_payload->>'reply_count')::numeric>0 then sm.provider_timestamp::numeric end as parent
   from public.slack_messages sm where sm.tenant_id=h.tenant_id and sm.team_id=h.team_id and sm.channel_id=c.channel_id
   and sm.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
   and public.learn_slack_message_kind(sm.provider_payload)='conversation'
  ), parents as (select distinct on(parent) * from observed where parent is not null and (scan.after_parent is null or parent>scan.after_parent)
    order by parent,(provider_timestamp::numeric=parent) desc,id)
  select * from parents order by parent limit 20 loop
   insert into public.slack_history_campaign_threads(campaign_id,account_id,tenant_id,parent_timestamp,source_message_id,source_version)
    values(h.id,a.id,h.tenant_id,root.parent,root.id,root.source_version);
   n:=n+1;scan.after_parent:=root.parent;
  end loop;
  update public.slack_history_campaign_thread_scans set after_parent=scan.after_parent,discovery_complete=n<20 where campaign_id=h.id and account_id=a.id;
 end if;
 update public.slack_history_campaign_threads mt set state='captured' where mt.campaign_id=h.id and mt.account_id=a.id
 and mt.state<>'captured' and public.learn_slack_campaign_thread_import_complete(mt.current_import);
 -- Stable parent ordering and one unfinished thread per channel keep the queue
 -- bounded, without confusing queueing/discovery with captured replies.
 select * into member from public.slack_history_campaign_threads mt where mt.campaign_id=h.id and mt.account_id=a.id
 and not public.learn_slack_campaign_thread_import_complete(mt.current_import) order by mt.parent_timestamp limit 1 for update;
 if not found then
  progress:=public.learn_slack_campaign_channel_progress(h.id,a.id);
  return jsonb_build_object('state',case when progress->'complete'='true'::jsonb then 'campaign_window_complete' else 'discovering_threads' end,'queued',false);
 end if;
 cp:='{}';
 if member.current_import is not null then
  select * into t from public.slack_thread_imports where id=member.current_import and tenant_id=h.tenant_id and account_id=a.id for update;
  if not found or t.scope->>'campaignId' is distinct from h.id::text or t.scope->>'parentTimestamp' is distinct from member.parent_timestamp::text then
   return jsonb_build_object('state','thread_scope_changed','queued',false);end if;
  if exists(select 1 from public.platform_jobs pending where pending.tenant_id=h.tenant_id and pending.job_type='slack.thread_sync'
   and pending.payload->>'thread_import_id'=t.id::text and pending.status in ('queued','retrying','running')) then
   return jsonb_build_object('state','thread_active','queued',false);end if;
  cp:=t.checkpoint;
  select * into last_job from public.platform_jobs recent where recent.tenant_id=h.tenant_id and recent.job_type='slack.thread_sync'
   and recent.payload->>'thread_import_id'=t.id::text order by recent.created_at desc,recent.id desc limit 1;
  can_renew:=coalesce((cp->>'pages')::integer>=(t.scope->>'maxPages')::integer and exists(select 1 from public.platform_jobs published
   where published.tenant_id=h.tenant_id and published.job_type='slack.thread_sync' and published.status='succeeded'
   and published.payload->>'thread_import_id'=t.id::text and published.metadata->'slack_page_v1'->>'thread_import_id'=t.id::text
   and published.metadata->'slack_page_v1'->'next'=cp),false)
   or coalesce(last_job.status in ('failed','dead_letter') and last_job.payload->>'campaign_id'=h.id::text
    and (last_job.payload->>'campaign_revision')::bigint<h.revision and last_job.error_code in
    ('slack_history_campaign_request_unavailable','slack_history_campaign_request_unconfirmed','slack_history_binding_unavailable','slack_history_authority_unavailable'),false)
   or coalesce((t.scope->>'expiresAt')::timestamptz<=clock_timestamp() and last_job.status in ('failed','dead_letter')
    and last_job.error_code in ('slack_history_binding_unavailable','slack_history_authority_unavailable'),false);
  if not can_renew or cp->'complete'='true'::jsonb or (cp<>'{}'::jsonb and cp->>'cursor' is null and cp->'pages'<>'0'::jsonb) then
   return jsonb_build_object('state','thread_needs_review','queued',false);end if;
 end if;
 request_id:=gen_random_uuid();job_id:=gen_random_uuid();
 scope:=cfg||jsonb_build_object('approved',true,'parentTimestamp',member.parent_timestamp::text,'maxPages',10,
  'expiresAt',least(h.expires_at,clock_timestamp()+interval '24 hours'),'consentReference','learn-slack-thread:'||request_id::text);
 -- Parenthesised fields keep the queue key identical to the existing thread worker.
 key:='slack.thread:'||a.id::text||':'||member.parent_timestamp::text||':'||(scope->>'oldest')||':'||(scope->>'latest');
 d:=jsonb_build_object('campaignId',h.id,'campaignRevision',h.revision,'accountId',a.id,'sourceMessageId',member.source_message_id,
  'sourceVersion',member.source_version,'connectionRevision',h.connection_revision,'start',h.starts_at,'end',h.ends_at,'maxPages',10,
  'reason','Capture observed replies within the recorded historical campaign','resumesImportId',member.current_import,
  'previousState',case when member.current_import is null then null else jsonb_build_object('scope',t.scope,'checkpoint',cp) end);
 cp:=jsonb_build_object('scopeKey',array_to_json(array[h.tenant_id::text,h.team_id,c.channel_id,scope->>'oldest',scope->>'latest',scope->>'consentReference',scope->>'parentTimestamp'])::text,
  'cursor',cp->>'cursor','pages',0,'complete',false);
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(job_id,h.tenant_id,'slack','slack.thread_sync',key,'queued',5,clock_timestamp(),
   jsonb_build_object('connector_account_id',a.id,'thread_import_id',request_id,'campaign_id',h.id,'campaign_revision',h.revision),h.approved_by);
 insert into public.slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope,checkpoint)
  values(request_id,h.tenant_id,a.id,member.source_message_id,job_id,h.approved_by,d,scope,cp);
 update public.slack_history_campaign_threads set current_import=request_id,state='queued' where campaign_id=h.id and account_id=a.id and parent_timestamp=member.parent_timestamp;
 return jsonb_build_object('state','thread_queued','queued',true);
end$function$
;
CREATE OR REPLACE FUNCTION public.learn_slack_message_kind(m jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$begin
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
end $function$
;
CREATE OR REPLACE FUNCTION public.learn_slack_store_records(p_tenant_id uuid, cfg jsonb, p_records jsonb, p_parent_timestamp text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
 declare r jsonb;sid uuid;version_hash text;provider_updated numeric;current_version text;seen text[]:=array[]::text[];
 begin
  if p_parent_timestamp is not null then
   if p_parent_timestamp !~ '^\d{1,12}\.\d{1,6}$' then raise exception 'thread_parent_invalid';end if;
   for r in select value from jsonb_array_elements(p_records) loop
    if r->>'provider_timestamp'=p_parent_timestamp then
     if r->>'thread_timestamp' is not null and r->>'thread_timestamp'<>p_parent_timestamp then raise exception 'thread_record_mismatch';end if;
    elsif r->>'thread_timestamp' is distinct from p_parent_timestamp then raise exception 'thread_record_mismatch';end if;
    if (r->>'provider_timestamp')::numeric<p_parent_timestamp::numeric then raise exception 'thread_record_mismatch';end if;
   end loop;
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>public.learn_slack_page_limit(p_tenant_id,(cfg->>'connectionId')::uuid,cfg->>'teamId') then raise exception 'history_page_invalid'; end if;
 for r in select value from jsonb_array_elements(p_records) loop
  if r->>'tenant_id' is distinct from p_tenant_id::text
   or r->>'channel_id' is distinct from cfg->>'channelId'
   or r->>'source_external_id' is distinct from concat(cfg->>'teamId',':',cfg->>'channelId',':',r->>'provider_timestamp')
   or coalesce(r->>'provider_timestamp','') !~ '^\d{1,12}\.\d{1,6}$'
   or (r->>'provider_timestamp')::numeric<(cfg->>'oldest')::numeric
   or (r->>'provider_timestamp')::numeric>(cfg->>'latest')::numeric
   or r->>'provider_timestamp'=any(seen)
   or r->>'thread_timestamp' is not null and r->>'thread_timestamp' !~ '^\d{1,12}\.\d{1,6}$'
   or jsonb_typeof(r->'provider_payload') is distinct from 'object'
   or octet_length((r->'provider_payload')::text)>262144
   or r->'provider_payload'->>'ts' is distinct from r->>'provider_timestamp'
   or r->'provider_payload'->>'text' is distinct from r->>'text'
   or r->'provider_payload'->'edited' is not null and (coalesce(r->'provider_payload'->'edited'->>'ts','') !~ '^\d{1,12}\.\d{1,6}$')
   or r->'provider_payload'->>'thread_ts' is distinct from r->>'thread_timestamp'
   or jsonb_typeof(r->'text') is distinct from 'string' or length(r->>'text')>40000
  then raise exception 'history_record_invalid'; end if;
  -- Classify independently in the durable writer, not from worker-supplied labels.
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
  seen=array_append(seen,r->>'provider_timestamp');
  version_hash=encode(sha256(convert_to((r->'provider_payload')::text,'UTF8')),'hex');
  provider_updated=coalesce(r->'provider_payload'->'edited'->>'ts',r->>'provider_timestamp')::numeric;
  if provider_updated<(r->>'provider_timestamp')::numeric then raise exception 'history_edit_timestamp_invalid'; end if;
  sid=md5(p_tenant_id::text||':'||(r->>'source_external_id'))::uuid;
  insert into public.slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,thread_timestamp,message_text,provider_payload,source_version,source_updated_at)
   values(sid,p_tenant_id,r->>'source_external_id',cfg->>'teamId',cfg->>'channelId',r->>'provider_timestamp',r->>'thread_timestamp',r->>'text',r->'provider_payload',version_hash,provider_updated)
   on conflict(tenant_id,source_external_id) do update set message_text=excluded.message_text,thread_timestamp=excluded.thread_timestamp,provider_payload=excluded.provider_payload,source_version=excluded.source_version,source_updated_at=excluded.source_updated_at,updated_at=now()
   where slack_messages.source_updated_at<=excluded.source_updated_at and slack_messages.source_version is distinct from excluded.source_version;
  insert into public.slack_message_versions(tenant_id,message_id,source_version,provider_payload)
   values(p_tenant_id,sid,version_hash,r->'provider_payload') on conflict do nothing;
  select source_version into current_version from public.slack_messages where id=sid and tenant_id=p_tenant_id;
  if current_version<>version_hash then continue; end if; -- Older replay is retained, not made current.
  -- System activity remains in both retained source tables. It is not a customer
  -- conversation, outstanding task or individual-performance observation.
  if public.learn_slack_message_kind(r->'provider_payload')='channel_activity' then continue;end if;
  -- Reuse the single existing interaction/observation engine. No AI execution,
  -- event fan-out or consequential follow-on jobs are introduced by this page.
  insert into public.interactions(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,interaction_type,direction,occurred_at,body_preview,metadata)
   values(p_tenant_id,'slack','chat','slack_messages',sid,r->>'source_external_id','slack_message','unknown',to_timestamp((r->>'provider_timestamp')::numeric),left(r->>'text',2000),jsonb_build_object('channel_id',cfg->>'channelId','coverage',case when p_parent_timestamp is null then 'bounded_history_page' else 'observed_thread_page' end,'threads','unverified','source_version',version_hash,'message_kind','conversation',
    'provider_subtype',r->'provider_payload'->>'subtype','file_content','not_downloaded'))
   on conflict(tenant_id,source_table,source_id) do update set body_preview=excluded.body_preview,metadata=interactions.metadata||excluded.metadata,
    processing_status=case when interactions.metadata->>'source_version' is distinct from excluded.metadata->>'source_version' then 'pending' else interactions.processing_status end
   where interactions.metadata->>'source_version' is distinct from excluded.metadata->>'source_version';
 end loop;

end $function$
;
notify pgrst,'reload schema';commit;
