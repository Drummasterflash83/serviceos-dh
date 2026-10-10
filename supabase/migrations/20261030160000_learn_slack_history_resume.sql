-- Reviewed recovery of an incomplete channel window. Preserve every prior
-- approval/checkpoint; reuse the same provider bounds and, when selected, cursor.
-- No source import, provider request, credential, schedule or existing-row change
-- occurs when this migration is installed.
begin;
create function public.learn_slack_history_state(p_tenant_id uuid,p_account_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;c public.provider_connections%rowtype;tc public.tenant_connectors%rowtype;
 h public.slack_history_imports%rowtype;j public.platform_jobs%rowtype;cfg jsonb;cp jsonb;valid boolean:=false;
 ready boolean:=false;active boolean;fingerprint text;begin
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id;
 if not found then return null;end if;
 select * into tc from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack';
 if not found then return null;end if;
 cfg:=a.settings->'slack_history';cp:=a.sync_cursor;
 select * into c from public.provider_connections where id::text=cfg->>'connectionId' and tenant_id=p_tenant_id and provider='slack';
 ready:=found and a.status='active' and tc.enabled and tc.status='active' and c.status='configured' and c.revoked_at is null
  and c.non_secret_config->>'team_id'=cfg->>'teamId' and 'bot_token'=any(c.configured_fields) and c.secret_refs->>'bot_token' is not null;
 select * into h from public.slack_history_imports where tenant_id=p_tenant_id and account_id=p_account_id
  and 'learn-slack-import:'||id::text=cfg->>'consentReference';
 if found then
  begin
   valid:=cfg->'approved'='true'::jsonb and cfg->>'teamId' ~ '^T[A-Z0-9]+$' and cfg->>'channelId' ~ '^C[A-Z0-9]+$'
    and cfg->>'oldest' ~ '^\d{1,12}\.\d{1,6}$' and cfg->>'latest' ~ '^\d{1,12}\.\d{1,6}$'
    and (cfg->>'latest')::numeric>(cfg->>'oldest')::numeric and (cfg->>'latest')::numeric-(cfg->>'oldest')::numeric<=86400
    and cfg->>'connectionId'=h.definition->>'connectionId' and cfg->>'channelId'=h.definition->>'channelId'
    and (cfg->>'oldest')::numeric=extract(epoch from (h.definition->>'start')::timestamptz)
    and (cfg->>'latest')::numeric=extract(epoch from (h.definition->>'end')::timestamptz)
    and (cfg->>'maxPages')::integer between 1 and 10 and cfg->'maxPages'=h.definition->'maxPages'
    and (cp='{}'::jsonb or (jsonb_typeof(cp)='object'
     and (cp->>'scopeKey')::jsonb=jsonb_build_array(p_tenant_id::text,cfg->>'teamId',cfg->>'channelId',cfg->>'oldest',cfg->>'latest',cfg->>'consentReference')
     and jsonb_typeof(cp->'pages')='number' and cp->>'pages' ~ '^\d+$' and (cp->>'pages')::integer between 0 and (cfg->>'maxPages')::integer
     and jsonb_typeof(cp->'complete')='boolean' and (cp->'cursor'='null'::jsonb or jsonb_typeof(cp->'cursor')='string' and length(cp->>'cursor') between 1 and 1024)
     and (cp->'complete'<>'true'::jsonb or cp->'cursor'='null'::jsonb)));
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then valid:=false;
  end;
 end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant_id and job_type='slack.history_sync'
  and payload->>'connector_account_id'=p_account_id::text order by created_at desc,id desc limit 1;
 select exists(select 1 from public.platform_jobs where tenant_id=p_tenant_id and job_type='slack.history_sync'
  and payload->>'connector_account_id'=p_account_id::text and status in ('queued','running','retrying')) into active;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(a.id,a.tenant_id,a.status,cfg,cp,h.id,
  tc.enabled,tc.status,c.id,c.updated_at,c.status,c.revoked_at,c.non_secret_config->>'team_id',ready,active,
  j.id,j.status,j.attempt_count,j.available_at,j.error_code,j.result->>'stopReason')::text,'UTF8')),'hex');
 return jsonb_build_object('tenantId',p_tenant_id,'accountId',p_account_id,'name',coalesce(a.display_name,cfg->>'channelId'),
  'scope',cfg,'checkpoint',cp,'approvalId',h.id,'approvedAt',h.approved_at,'stateVersion',fingerprint,
  'previousApprovalId',h.definition->>'resumesImportId','recoveryMode',h.definition->'recovery'->>'mode',
  'stateValid',coalesce(valid,false),'connectionReady',coalesce(ready,false),'active',active,
  'latestJob',case when j.id is null then null else jsonb_build_object('id',j.id,'status',j.status,
   'availableAt',case when j.status in ('queued','retrying') then j.available_at else null end,
   'errorCode',case when j.error_code ~ '^slack_history_[a-z_]{1,80}$' then j.error_code else null end,
   'stopReason',case when j.result->>'stopReason' in ('window_pages_complete','page_budget_exhausted','run_page_limit','authorisation_changed') then j.result->>'stopReason' else null end) end);
end $$;
revoke all on function public.learn_slack_history_state(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_slack_history_read(p_tenant_id uuid,p_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare state jsonb;cfg jsonb;cp jsonb;can_resume boolean;begin
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id() then raise exception 'Company access required' using errcode='42501';end if;
 state:=public.learn_slack_history_state(p_tenant_id,p_account_id);
 if state is null then raise exception 'Stored Slack channel unavailable' using errcode='42501';end if;
 cfg:=state->'scope';cp:=state->'checkpoint';
 can_resume:=state->'stateValid'='true'::jsonb and state->'connectionReady'='true'::jsonb and state->'active'='false'::jsonb and cp->'complete' is distinct from 'true'::jsonb;
 return (state-array['scope','checkpoint','connectionReady'])||jsonb_build_object('version','learn-slack-history/1','teamId',cfg->>'teamId','channelId',cfg->>'channelId',
  'window',case when state->'stateValid'='true'::jsonb then jsonb_build_object('start',to_timestamp((cfg->>'oldest')::numeric),'end',to_timestamp((cfg->>'latest')::numeric),
   'pageLimit',cfg->'maxPages','expiresAt',cfg->>'expiresAt') else null end,
  'progress',case when state->'stateValid'='true'::jsonb then jsonb_build_object('pagesThisApproval',coalesce((cp->>'pages')::integer,0),'complete',coalesce((cp->>'complete')::boolean,false),'hasCursor',cp->>'cursor' is not null) else null end,
  'canContinue',can_resume and (cp='{}'::jsonb or cp->>'cursor' is not null or cp->'pages'='0'::jsonb),
  'canRestart',can_resume,'coverage','bounded_channel_window');
end $$;
revoke all on function public.learn_slack_history_read(uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_history_read(uuid,uuid) to authenticated;

create function public.learn_slack_resume_history(p_tenant_id uuid,p_request_id uuid,p_account_id uuid,
 p_expected_state_version text,p_mode text,p_max_pages integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;c public.provider_connections%rowtype;tc public.tenant_connectors%rowtype;
 prior public.slack_history_imports%rowtype;state jsonb;cfg jsonb;cp jsonb;definition jsonb;scope jsonb;checkpoint jsonb;job_id uuid:=gen_random_uuid();begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Slack recovery requires a fresh snapshot' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant_id::text,0));
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id() or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';end if;
 if p_request_id is null or p_account_id is null or coalesce(p_expected_state_version,'') !~ '^[a-f0-9]{64}$'
  or p_mode is null or p_mode not in ('continue','restart') or p_max_pages is null or p_max_pages not between 1 and 10
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Invalid channel recovery approval' using errcode='22023';end if;
 -- Store supplied review identity separately so exact retries still resolve after
 -- later pages or approvals have changed the current channel state.
 definition:=jsonb_build_object('recovery',jsonb_build_object('accountId',p_account_id,'stateVersion',p_expected_state_version,'mode',p_mode,'maxPages',p_max_pages,'reason',btrim(p_reason)));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-request:'||p_request_id::text,0));
 select * into prior from public.slack_history_imports where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.account_id<>p_account_id or prior.definition->'recovery' is distinct from definition->'recovery' then
   raise exception 'Recovery request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('requestId',prior.id,'accountId',prior.account_id,'jobId',prior.job_id,'reused',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant_id::text,0));
 -- Follow initial setup's connection-before-account lock order. A different
 -- connection/config observed after the account lock makes the review stale.
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id;
 if not found then raise exception 'Stored Slack channel unavailable' using errcode='42501';end if;
 select * into c from public.provider_connections where id::text=a.settings->'slack_history'->>'connectionId' and tenant_id=p_tenant_id and provider='slack' for share;
 if not found then raise exception 'Slack connection unavailable' using errcode='55000';end if;
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id for update;
 select * into tc from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack' for share;
 if not found or a.settings->'slack_history'->>'connectionId' is distinct from c.id::text then raise exception 'Slack channel changed' using errcode='PT409';end if;
 state:=public.learn_slack_history_state(p_tenant_id,p_account_id);
 if state->>'stateVersion' is distinct from p_expected_state_version then raise exception 'Channel progress changed; reload review' using errcode='PT409';end if;
 if state->'stateValid' is distinct from 'true'::jsonb or state->'connectionReady' is distinct from 'true'::jsonb then raise exception 'Channel recovery unavailable' using errcode='55000';end if;
 if state->'active'='true'::jsonb then raise exception 'A channel import is still active' using errcode='55000';end if;
 cfg:=state->'scope';cp:=state->'checkpoint';
 if cp->'complete'='true'::jsonb then raise exception 'This window is already captured' using errcode='55000';end if;
 if p_mode='continue' and cp<>'{}'::jsonb and cp->>'cursor' is null and cp->'pages'<>'0'::jsonb then
  raise exception 'No saved cursor is available; review a restart' using errcode='55000';end if;
 scope:=cfg||jsonb_build_object('approved',true,'maxPages',p_max_pages,'expiresAt',clock_timestamp()+interval '24 hours','consentReference','learn-slack-import:'||p_request_id::text);
 checkpoint:=jsonb_build_object('scopeKey',array_to_json(array[p_tenant_id::text,scope->>'teamId',scope->>'channelId',scope->>'oldest',scope->>'latest',scope->>'consentReference'])::text,
  'cursor',case when p_mode='continue' then cp->>'cursor' else null end,'pages',0,'complete',false);
 definition:=definition||jsonb_build_object('connectionId',c.id,'connectionRevision',c.updated_at,'channelId',scope->>'channelId',
  'start',to_timestamp((scope->>'oldest')::numeric),'end',to_timestamp((scope->>'latest')::numeric),'maxPages',p_max_pages,'reason',btrim(p_reason),'resumesImportId',state->>'approvalId');
 update public.connector_accounts set settings=settings||jsonb_build_object('slack_history',scope),sync_cursor=checkpoint where id=p_account_id and tenant_id=p_tenant_id;
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(job_id,p_tenant_id,'slack','slack.history_sync','slack.history:'||p_account_id::text,'queued',5,clock_timestamp(),
   jsonb_build_object('connector_account_id',p_account_id,'history_import_id',p_request_id),auth.uid());
 insert into public.slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition,previous_state)
  values(p_request_id,p_tenant_id,p_account_id,job_id,auth.uid(),definition,jsonb_build_object('settings',cfg,'checkpoint',cp));
 return jsonb_build_object('requestId',p_request_id,'accountId',p_account_id,'jobId',job_id,'reused',false);
end $$;
revoke all on function public.learn_slack_resume_history(uuid,uuid,uuid,text,text,integer,text) from public,anon,service_role;
grant execute on function public.learn_slack_resume_history(uuid,uuid,uuid,text,text,integer,text) to authenticated;
commit;
