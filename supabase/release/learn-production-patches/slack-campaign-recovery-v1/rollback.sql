begin;set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from '02bf6603659818f4bc2d1c12645c19ca4e4ac5edb9b314b29a5d5ec60e2453f3' then raise exception 'Exact recovery rollback required';end if;
if exists(select 1 from public.platform_jobs where payload ? 'campaign_recovery_id' and status in('queued','retrying','running')) then raise exception 'Resolve active recovery jobs before rollback';end if;
if md5(pg_get_functiondef('public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)'::regprocedure))<>'761848346ab060f537354ac8904e7847' then raise exception 'Recovery function changed: learn_slack_campaign_dispatch';end if;
if md5(pg_get_functiondef('public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure))<>'383ee9a76dee87a499e43f69df1480f4' then raise exception 'Recovery function changed: learn_slack_campaign_job_allowed';end if;
end$guard$;
CREATE OR REPLACE FUNCTION public.learn_slack_campaign_dispatch(p_tenant uuid, p_actor uuid, p_request uuid, p_operation text, p_input jsonb, p_mode text DEFAULT 'apply'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null or p_actor is distinct from auth.uid() then
  raise exception 'slack_campaign_actor_changed' using errcode='42501';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_mode is null or p_mode not in ('apply','check','cancel') then
  raise exception 'slack_campaign_request_invalid' using errcode='22023';end if;
 if p_operation='replay_source' then return public.learn_slack_campaign_source_replay(p_tenant,p_request,p_input,p_mode);end if;
 if p_operation='start' then return public.learn_slack_campaign_start(p_tenant,p_request,p_input,p_mode);
 elsif p_operation='control' and p_input ?& array['campaignId','revision','enabled','reason']
  and p_input-array['campaignId','revision','enabled','reason']='{}' and jsonb_typeof(p_input->'enabled')='boolean'
  and jsonb_typeof(p_input->'revision')='number' and p_input->>'revision' ~ '^[0-9]+$' and jsonb_typeof(p_input->'reason')='string' then
  return public.learn_slack_campaign_control(p_tenant,p_request,(p_input->>'campaignId')::uuid,(p_input->>'revision')::bigint,(p_input->>'enabled')::boolean,p_input->>'reason',p_mode);
 elsif p_operation='close' and p_input ?& array['campaignId','revision','action','reason']
  and p_input-array['campaignId','revision','action','reason']='{}' and jsonb_typeof(p_input->'revision')='number'
  and p_input->>'revision' ~ '^[0-9]+$' and jsonb_typeof(p_input->'reason')='string' then
  return public.learn_slack_campaign_close(p_tenant,p_request,(p_input->>'campaignId')::uuid,(p_input->>'revision')::bigint,p_input->>'action',p_input->>'reason',p_mode);
 end if;
 raise exception 'slack_campaign_request_invalid' using errcode='22023';
end$function$
;
CREATE OR REPLACE FUNCTION public.learn_slack_campaign_job_allowed(p_tenant uuid, p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cfg jsonb;h public.slack_history_campaigns%rowtype;t public.slack_thread_imports%rowtype;begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant and job_type in ('slack.history_sync','slack.thread_sync');
 if not found then return false;end if;
 if j.payload ? 'source_replay_id' then return public.learn_slack_source_replay_allowed(p_tenant,p_job);end if;
 select * into a from public.connector_accounts where id::text=j.payload->>'connector_account_id' and tenant_id=p_tenant;
 if not found then return false;end if;
 cfg:=a.settings->'slack_history';
 if j.payload ? 'campaign_id' and (cfg->>'campaignId' is distinct from j.payload->>'campaign_id'
  or exists(select 1 from public.slack_history_campaign_closures x where x.campaign_id::text=j.payload->>'campaign_id' and x.tenant_id=p_tenant)) then return false;end if;
 if j.job_type='slack.thread_sync' and exists(select 1 from public.slack_thread_imports old_thread
  where old_thread.id::text=j.payload->>'thread_import_id' and old_thread.tenant_id=p_tenant and old_thread.scope ? 'campaignId'
  and (cfg->>'campaignId' is distinct from old_thread.scope->>'campaignId'
   or exists(select 1 from public.slack_history_campaign_closures x where x.campaign_id::text=old_thread.scope->>'campaignId' and x.tenant_id=p_tenant))) then return false;end if;
 if not coalesce(cfg ? 'campaignId',false) then return true;end if;
 select * into h from public.slack_history_campaigns where id::text=cfg->>'campaignId' and tenant_id=p_tenant;
 if not found or not public.learn_slack_campaign_authority(h.id) then return false;end if;
 if not coalesce(a.status='active' and cfg->'approved'='true'::jsonb and cfg->>'teamId'=h.team_id
 and cfg->>'connectionId'=h.connection_id::text
 and (cfg->>'oldest')::numeric=extract(epoch from h.starts_at) and (cfg->>'latest')::numeric=extract(epoch from h.ends_at)
 and exists(select 1 from public.slack_history_campaign_channels m join public.slack_history_imports i on i.id=m.current_import
 where m.campaign_id=h.id and m.tenant_id=p_tenant and m.account_id=a.id and m.channel_id=cfg->>'channelId'
 and cfg->>'consentReference'='learn-slack-import:'||i.id::text and i.tenant_id=p_tenant and i.account_id=a.id)
 and exists(select 1 from public.tenant_connectors tc where tc.id=a.tenant_connector_id and tc.tenant_id=p_tenant
 and tc.connector_id='slack' and tc.enabled and tc.status='active'),false) then return false;end if;
 if j.job_type='slack.history_sync' then return true;end if;
 select * into t from public.slack_thread_imports where id::text=j.payload->>'thread_import_id' and tenant_id=p_tenant and account_id=a.id;
 if not found then return false;end if;
 return coalesce(t.scope->>'campaignId'=h.id::text and t.scope->'approved'='true'::jsonb
 and t.scope->>'connectionId'=h.connection_id::text and t.scope->>'teamId'=h.team_id and t.scope->>'channelId'=cfg->>'channelId'
 and (t.definition->>'connectionRevision')::timestamptz=h.connection_revision
 and (t.scope->>'oldest')::numeric=extract(epoch from h.starts_at) and (t.scope->>'latest')::numeric=extract(epoch from h.ends_at)
 and exists(select 1 from public.slack_history_campaign_threads member where member.campaign_id=h.id and member.tenant_id=p_tenant
 and member.account_id=a.id and member.current_import=t.id and member.parent_timestamp=(t.scope->>'parentTimestamp')::numeric
 and member.source_message_id=t.source_message_id and member.source_version=t.definition->>'sourceVersion'),false);
end$function$
;
revoke all on function public.learn_slack_record_structure_diagnostic(uuid,uuid,text,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.learn_slack_campaign_recovery_read(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
-- Retain immutable requests, diagnostics, sources and checkpoints.
notify pgrst,'reload schema';commit;
