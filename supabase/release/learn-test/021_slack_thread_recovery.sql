-- Additive, reviewed recovery of an existing thread window. Every earlier
-- approval/checkpoint/source remains intact. Installation queues no work.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' then raise exception 'Explicit TEST target required';end if;
 if coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed checksum required';end if;
 if (select count(*) from of_test_deploy.migrations)<>21 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_saved_assessments_v1' and source_sha256='728d46dcf93127cfcb917b355d86a006e46d72bb5249b784a485ba079bcd798a' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Exact assessment release prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_thread_recovery_v1') then raise exception 'Existing thread recovery release requires inspection';end if;
end $$;
create index learn_slack_thread_approval_order on public.slack_thread_imports(tenant_id,account_id,approved_at desc,id desc);
create unique index learn_slack_thread_one_recovery on public.slack_thread_imports(tenant_id,(definition->>'resumesImportId')) where definition ? 'resumesImportId';

create function public.learn_slack_thread_recovery_state(p_tenant_id uuid,p_import_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare t public.slack_thread_imports%rowtype;a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 tc public.tenant_connectors%rowtype;j public.platform_jobs%rowtype;cfg jsonb;cp jsonb;valid boolean:=false;ready boolean:=false;
 active boolean;newer uuid;key text;fingerprint text;
begin
 select * into t from public.slack_thread_imports where id=p_import_id and tenant_id=p_tenant_id;
 if not found then return null;end if;
 select * into a from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id;
 if not found then return null;end if;
 select * into tc from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack';
 if not found then return null;end if;
 cfg:=t.scope;cp:=t.checkpoint;
 select * into c from public.provider_connections where id::text=cfg->>'connectionId' and tenant_id=p_tenant_id and provider='slack';
 ready:=found and a.status='active' and tc.enabled and tc.status='active' and c.status='configured' and c.revoked_at is null
  and c.non_secret_config->>'team_id'=cfg->>'teamId' and 'bot_token'=any(c.configured_fields) and c.secret_refs->>'bot_token' is not null
  and a.settings->'slack_history'->>'connectionId'=cfg->>'connectionId'
  and a.settings->'slack_history'->>'teamId'=cfg->>'teamId' and a.settings->'slack_history'->>'channelId'=cfg->>'channelId';
 begin
  valid:=cfg->'approved'='true'::jsonb and cfg->>'consentReference'='learn-slack-thread:'||t.id::text
   and cfg->>'teamId' ~ '^T[A-Z0-9]+$' and cfg->>'channelId' ~ '^C[A-Z0-9]+$'
   and cfg->>'parentTimestamp' ~ '^\d{1,12}\.\d{1,6}$' and cfg->>'oldest' ~ '^\d{1,12}\.\d{1,6}$' and cfg->>'latest' ~ '^\d{1,12}\.\d{1,6}$'
   and (cfg->>'latest')::numeric>(cfg->>'oldest')::numeric and (cfg->>'latest')::numeric-(cfg->>'oldest')::numeric<=86400
   and (cfg->>'parentTimestamp')::numeric<=(cfg->>'latest')::numeric
   and (cfg->>'oldest')::numeric=extract(epoch from (t.definition->>'start')::timestamptz)
   and (cfg->>'latest')::numeric=extract(epoch from (t.definition->>'end')::timestamptz)
   and isfinite((cfg->>'expiresAt')::timestamptz)
   and jsonb_typeof(cfg->'maxPages')='number' and cfg->>'maxPages' ~ '^[0-9]+$' and (cfg->>'maxPages')::integer between 1 and 10 and cfg->'maxPages'=t.definition->'maxPages'
   and (cp='{}'::jsonb or (jsonb_typeof(cp)='object' and (select count(*)=4 from jsonb_object_keys(cp))
    and (cp->>'scopeKey')::jsonb=jsonb_build_array(p_tenant_id::text,cfg->>'teamId',cfg->>'channelId',cfg->>'oldest',cfg->>'latest',cfg->>'consentReference',cfg->>'parentTimestamp')
    and jsonb_typeof(cp->'pages')='number' and cp->>'pages' ~ '^\d+$' and (cp->>'pages')::integer between 0 and (cfg->>'maxPages')::integer
    and jsonb_typeof(cp->'complete')='boolean' and (cp->'cursor'='null'::jsonb or jsonb_typeof(cp->'cursor')='string' and length(cp->>'cursor') between 1 and 1024)
    and (cp->'complete'<>'true'::jsonb or cp->'cursor'='null'::jsonb)));
  key:='slack.thread:'||t.account_id::text||':'||(cfg->>'parentTimestamp')||':'||extract(epoch from (t.definition->>'start')::timestamptz)::text||':'||extract(epoch from (t.definition->>'end')::timestamptz)::text;
 exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then valid:=false;
 end;
 select id into newer from public.slack_thread_imports where tenant_id=p_tenant_id and account_id=t.account_id
  and ((approved_at,id)>(t.approved_at,t.id) or definition->>'resumesImportId'=t.id::text) and scope->>'parentTimestamp'=cfg->>'parentTimestamp'
  and scope->>'oldest'=cfg->>'oldest' and scope->>'latest'=cfg->>'latest' order by approved_at desc,id desc limit 1;
 select * into j from public.platform_jobs where tenant_id=p_tenant_id and job_type='slack.thread_sync'
  and payload->>'thread_import_id'=t.id::text order by created_at desc,id desc limit 1;
 select exists(select 1 from public.platform_jobs where tenant_id=p_tenant_id and job_type='slack.thread_sync'
  and (job_key=key or payload->>'thread_import_id'=t.id::text) and status in ('queued','running','retrying')) into active;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(t.id,t.definition,cfg,cp,a.id,a.status,a.settings->'slack_history'->>'connectionId',
  a.settings->'slack_history'->>'teamId',a.settings->'slack_history'->>'channelId',tc.enabled,tc.status,c.id,c.updated_at,c.status,c.revoked_at,
  c.non_secret_config->>'team_id',ready,active,newer,j.id,j.status,j.attempt_count,j.available_at,j.error_code,j.result->>'stopReason')::text,'UTF8')),'hex');
 return jsonb_build_object('tenantId',p_tenant_id,'accountId',t.account_id,'importId',t.id,'approvedAt',t.approved_at,
  'previousImportId',t.definition->>'resumesImportId','recoveryMode',t.definition->'recovery'->>'mode','supersededBy',newer,
  'scope',cfg,'checkpoint',cp,'jobKey',key,'stateVersion',fingerprint,'stateValid',coalesce(valid,false),'connectionReady',coalesce(ready,false),'active',active,
  'latestJob',case when j.id is null then null else jsonb_build_object('id',j.id,'status',j.status,
   'availableAt',case when j.status in ('queued','retrying') then j.available_at else null end,
   'errorCode',case when j.error_code ~ '^slack_history_[a-z_]{1,80}$' then j.error_code else null end,
   'stopReason',case when j.result->>'stopReason' in ('window_pages_complete','page_budget_exhausted','run_page_limit','authorisation_changed') then j.result->>'stopReason' else null end) end);
end $$;
revoke all on function public.learn_slack_thread_recovery_state(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_slack_thread_recovery_read(p_tenant_id uuid,p_import_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare state jsonb;cfg jsonb;cp jsonb;eligible boolean;
begin
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id() then raise exception 'Company access required' using errcode='42501';end if;
 state:=public.learn_slack_thread_recovery_state(p_tenant_id,p_import_id);
 if state is null then raise exception 'Stored thread import unavailable' using errcode='42501';end if;
 cfg:=state->'scope';cp:=state->'checkpoint';
 eligible:=state->'stateValid'='true'::jsonb and state->'connectionReady'='true'::jsonb and state->'active'='false'::jsonb
  and state->>'supersededBy' is null and cp->'complete' is distinct from 'true'::jsonb;
 return (state-array['scope','checkpoint','jobKey','connectionReady'])||jsonb_build_object('version','learn-slack-thread-recovery/1',
  'teamId',cfg->>'teamId','channelId',cfg->>'channelId','parentTimestamp',cfg->>'parentTimestamp','coverage','observed_thread_window',
  'window',case when state->'stateValid'='true'::jsonb then jsonb_build_object('start',to_timestamp((cfg->>'oldest')::numeric),'end',to_timestamp((cfg->>'latest')::numeric),'pageLimit',cfg->'maxPages','expiresAt',cfg->>'expiresAt') else null end,
  'progress',case when state->'stateValid'='true'::jsonb then jsonb_build_object('pagesThisApproval',coalesce((cp->>'pages')::integer,0),'complete',coalesce((cp->>'complete')::boolean,false),'hasCursor',cp->>'cursor' is not null) else null end,
  'canContinue',eligible and (cp='{}'::jsonb or cp->>'cursor' is not null or cp->'pages'='0'::jsonb),'canRestart',eligible);
end $$;
revoke all on function public.learn_slack_thread_recovery_read(uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_thread_recovery_read(uuid,uuid) to authenticated;

create function public.learn_slack_resume_thread(p_tenant_id uuid,p_request_id uuid,p_import_id uuid,p_expected_state_version text,p_mode text,p_max_pages integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.slack_thread_imports%rowtype;prior public.slack_thread_imports%rowtype;a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 state jsonb;cfg jsonb;cp jsonb;definition jsonb;scope jsonb;checkpoint jsonb;key text;job_id uuid:=gen_random_uuid();
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Thread recovery requires a fresh snapshot' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant_id::text,0));
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id() or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';end if;
 if p_request_id is null or p_import_id is null or coalesce(p_expected_state_version,'') !~ '^[a-f0-9]{64}$'
  or p_mode is null or p_mode not in ('continue','restart') or p_max_pages is null or p_max_pages not between 1 and 10
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Invalid thread recovery approval' using errcode='22023';end if;
 definition:=jsonb_build_object('recovery',jsonb_build_object('importId',p_import_id,'stateVersion',p_expected_state_version,'mode',p_mode,'maxPages',p_max_pages,'reason',btrim(p_reason)));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-thread-request:'||p_request_id::text,0));
 select * into prior from public.slack_thread_imports where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.approved_by<>auth.uid() or prior.definition->'recovery' is distinct from definition->'recovery' then raise exception 'Thread recovery request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('requestId',prior.id,'previousImportId',p_import_id,'accountId',prior.account_id,'jobId',prior.initial_job_id,'reused',true);
 end if;
 select * into t from public.slack_thread_imports where id=p_import_id and tenant_id=p_tenant_id;
 if not found then raise exception 'Stored thread import unavailable' using errcode='42501';end if;
 state:=public.learn_slack_thread_recovery_state(p_tenant_id,p_import_id);key:=state->>'jobKey';
 if state->'stateValid' is distinct from 'true'::jsonb or key is null then raise exception 'Thread recovery unavailable' using errcode='55000';end if;
 -- Share initial approval's exact window lock. Existing workers lock their import
 -- before publishing or completing; a still-active job always refuses recovery.
 perform pg_advisory_xact_lock(hashtextextended(key,0));
 select * into c from public.provider_connections where id::text=t.scope->>'connectionId' and tenant_id=p_tenant_id and provider='slack' for share;
 if not found then raise exception 'Thread connection unavailable' using errcode='55000';end if;
 select * into a from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id for share;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack' for share;
 select * into t from public.slack_thread_imports where id=p_import_id and tenant_id=p_tenant_id for update;
 state:=public.learn_slack_thread_recovery_state(p_tenant_id,p_import_id);
 if state->>'stateVersion' is distinct from p_expected_state_version then raise exception 'Thread progress changed; reload review' using errcode='PT409';end if;
 if state->'stateValid' is distinct from 'true'::jsonb or state->'connectionReady' is distinct from 'true'::jsonb
  or state->'active'='true'::jsonb or state->>'supersededBy' is not null then raise exception 'Thread recovery unavailable' using errcode='55000';end if;
 cfg:=state->'scope';cp:=state->'checkpoint';
 if cp->'complete'='true'::jsonb then raise exception 'This thread window is already captured' using errcode='55000';end if;
 if p_mode='continue' and cp<>'{}'::jsonb and cp->>'cursor' is null and cp->'pages'<>'0'::jsonb then raise exception 'No saved cursor; review a thread restart' using errcode='55000';end if;
 scope:=cfg||jsonb_build_object('approved',true,'maxPages',p_max_pages,'expiresAt',clock_timestamp()+interval '24 hours','consentReference','learn-slack-thread:'||p_request_id::text);
 checkpoint:=jsonb_build_object('scopeKey',array_to_json(array[p_tenant_id::text,scope->>'teamId',scope->>'channelId',scope->>'oldest',scope->>'latest',scope->>'consentReference',scope->>'parentTimestamp'])::text,
  'cursor',case when p_mode='continue' then cp->>'cursor' else null end,'pages',0,'complete',false);
 definition:=(t.definition-array['recovery','previousState','resumesImportId'])||definition||jsonb_build_object('connectionRevision',c.updated_at,'maxPages',p_max_pages,'reason',btrim(p_reason),
  'resumesImportId',t.id,'previousState',jsonb_build_object('scope',cfg,'checkpoint',cp));
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(job_id,p_tenant_id,'slack','slack.thread_sync',key,'queued',5,clock_timestamp(),jsonb_build_object('thread_import_id',p_request_id,'connector_account_id',t.account_id),auth.uid());
 insert into public.slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope,checkpoint)
  values(p_request_id,p_tenant_id,t.account_id,t.source_message_id,job_id,auth.uid(),definition,scope,checkpoint);
 return jsonb_build_object('requestId',p_request_id,'previousImportId',t.id,'accountId',t.account_id,'jobId',job_id,'reused',false);
end $$;
revoke all on function public.learn_slack_resume_thread(uuid,uuid,uuid,text,text,integer,text) from public,anon,service_role;
grant execute on function public.learn_slack_resume_thread(uuid,uuid,uuid,text,text,integer,text) to authenticated;
insert into of_test_deploy.migrations(migration_name,source_sha256,project_ref) values('learn_slack_thread_recovery_v1',current_setting('serviceos.release_source_sha256'),'saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
commit;
