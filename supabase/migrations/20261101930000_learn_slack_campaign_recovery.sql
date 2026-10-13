-- Exact failed-page recovery inside an existing campaign. No provider request,
-- scope change, source edit, permission grant, schedule or queued job on install.
begin;
create table public.slack_campaign_recovery_requests(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),actor_id uuid not null references public.profiles(id),
 campaign_id uuid not null references public.slack_history_campaigns(id),account_id uuid not null references public.connector_accounts(id),
 failed_job_id uuid not null references public.platform_jobs(id),job_id uuid unique references public.platform_jobs(id),
 definition jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp());
create table public.slack_structure_diagnostics(
 job_id uuid not null references public.platform_jobs(id),attempt integer not null,tenant_id uuid not null references public.tenants(id),
 diagnostic jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(job_id,attempt));
do $$declare tab text;begin
 foreach tab in array array['slack_campaign_recovery_requests','slack_structure_diagnostics'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
 execute format('create trigger retain_recovery before update or delete on public.%I for each row execute function public.slack_version_immutable()',tab);
 execute format('create trigger retain_recovery_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',tab);
 end loop;end$$;
create function public.learn_slack_record_structure_diagnostic(p_tenant uuid,p_job uuid,p_claimed_by text,p_attempt integer,p_diagnostic jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;old jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_diagnostic_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_diagnostic) is distinct from 'object' or not(p_diagnostic ?& array['version','code','type','hidden','subtypeType','subtype'])
 or p_diagnostic-array['version','code','type','hidden','subtypeType','subtype']<>'{}'
 or p_diagnostic->>'version' is distinct from 'slack-structure/1'
 or coalesce(p_diagnostic->>'code','') not in('slack_history_message_shape_unsupported','slack_history_message_subtype_unsupported')
 or coalesce(p_diagnostic->>'type','') not in('missing','message','other')
 or coalesce(p_diagnostic->>'hidden','') not in('missing','false','true','other')
 or coalesce(p_diagnostic->>'subtypeType','') not in('missing','string','other')
 or not(p_diagnostic->'subtype'='null'::jsonb or (jsonb_typeof(p_diagnostic->'subtype')='string' and p_diagnostic->>'subtype' ~ '^[a-z_]{1,64}$'))
 then raise exception 'slack_diagnostic_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.job_type not in('slack.history_sync','slack.thread_sync') or j.status<>'running'
 or j.claimed_by is distinct from p_claimed_by or p_claimed_by is null or j.attempt_count is distinct from p_attempt
 or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() or j.metadata ? 'slack_page_v1'
 or (j.payload ? 'campaign_id' and not exists(select 1 from public.slack_history_campaign_dispatches d where d.job_id=j.id and d.tenant_id=p_tenant and d.attempt=p_attempt))
 then raise exception 'slack_diagnostic_not_owned' using errcode='PT409';end if;
 select diagnostic into old from public.slack_structure_diagnostics where job_id=p_job and attempt=p_attempt;
 if found then
  if old<>p_diagnostic then raise exception 'slack_diagnostic_changed' using errcode='PT409';end if;return true;
 end if;
 insert into public.slack_structure_diagnostics(job_id,attempt,tenant_id,diagnostic) values(p_job,p_attempt,p_tenant,p_diagnostic);
 return true;
end$$;
revoke all on function public.learn_slack_record_structure_diagnostic(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.learn_slack_record_structure_diagnostic(uuid,uuid,text,integer,jsonb) to service_role;

create function public.learn_slack_campaign_recover_page(p_tenant uuid,p_request uuid,p_input jsonb,p_mode text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.slack_campaign_recovery_requests%rowtype;h public.slack_history_campaigns%rowtype;m public.slack_history_campaign_channels%rowtype;
 a public.connector_accounts%rowtype;j public.platform_jobs%rowtype;answer jsonb;jid uuid:=gen_random_uuid();begin
 perform public.learn_slack_control_access(p_tenant,true,'resume_history');
 if auth.role() is distinct from 'authenticated' or auth.uid() is null or current_setting('transaction_isolation')<>'read committed'
 or p_request is null or p_mode is null or p_mode not in('apply','check','cancel')
 or jsonb_typeof(p_input) is distinct from 'object' or not(p_input ?& array['campaignId','accountId','importId','failedJobId','checkpointHash','reason'])
 or p_input-array['campaignId','accountId','importId','failedJobId','checkpointHash','reason']<>'{}'
 or jsonb_typeof(p_input->'reason') is distinct from 'string' or length(btrim(p_input->>'reason')) not between 1 and 1000
 or coalesce(p_input->>'checkpointHash','') !~ '^[a-f0-9]{64}$'
 then raise exception 'slack_recovery_definition_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-campaign-recovery:'||p_request::text,0));
 select * into prior from public.slack_campaign_recovery_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>auth.uid() or prior.definition<>p_input then raise exception 'slack_recovery_request_changed' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 select * into h from public.slack_history_campaigns where id=(p_input->>'campaignId')::uuid and tenant_id=p_tenant for share;
 if not found then raise exception 'slack_recovery_campaign_unavailable' using errcode='42501';end if;
 select * into m from public.slack_history_campaign_channels where campaign_id=h.id and account_id=(p_input->>'accountId')::uuid and tenant_id=p_tenant for update;
 if not found or m.current_import is null or m.current_import is distinct from (p_input->>'importId')::uuid then raise exception 'slack_recovery_import_changed' using errcode='PT409';end if;
 select * into a from public.connector_accounts where id=m.account_id and tenant_id=p_tenant for update;
 if not found or encode(sha256(convert_to(a.sync_cursor::text,'UTF8')),'hex')<>p_input->>'checkpointHash'
 or a.settings->'slack_history'->>'campaignId' is distinct from h.id::text
 or a.settings->'slack_history'->>'consentReference' is distinct from 'learn-slack-import:'||m.current_import::text
 then raise exception 'slack_recovery_checkpoint_changed' using errcode='PT409';end if;
 select * into j from public.platform_jobs where id=(p_input->>'failedJobId')::uuid and tenant_id=p_tenant for update;
 if not found or j.job_type<>'slack.history_sync' or j.status not in('failed','dead_letter') or j.metadata ? 'slack_page_v1'
 or j.payload ? 'source_replay_id' or j.payload->>'campaign_id' is distinct from h.id::text
 or j.payload->>'connector_account_id' is distinct from a.id::text
 or j.error_code not in('slack_history_message_subtype_unsupported','slack_history_message_shape_unsupported','slack_history_diagnostic_unconfirmed')
 or j.error_code is null
 or exists(select 1 from public.slack_campaign_recovery_requests used where used.failed_job_id=j.id and used.job_id is not null)
 or exists(select 1 from public.platform_jobs later where later.tenant_id=p_tenant and later.job_type='slack.history_sync'
  and later.payload->>'connector_account_id'=a.id::text and not(later.payload ? 'source_replay_id') and (later.created_at,later.id)>(j.created_at,j.id))
 then raise exception 'slack_recovery_failure_changed' using errcode='PT409';end if;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return answer;end if;
 if p_mode='apply' then
  if not public.learn_slack_campaign_authority(h.id) or h.requests_reserved>=h.request_budget or a.status<>'active'
   or (a.settings->'slack_history'->>'expiresAt')::timestamptz<=clock_timestamp()
   or a.sync_cursor->'complete'='true'::jsonb or coalesce((a.sync_cursor->>'pages')::integer,0)>=(a.settings->'slack_history'->>'maxPages')::integer
   or (coalesce((a.sync_cursor->>'pages')::integer,0)>0 and nullif(a.sync_cursor->>'cursor','') is null)
   or exists(select 1 from public.platform_jobs active where active.tenant_id=p_tenant and active.payload->>'connector_account_id'=a.id::text and active.status in('queued','running','retrying'))
  then raise exception 'slack_recovery_not_ready' using errcode='55000';end if;
  insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by,created_at)
  values(jid,p_tenant,'slack','slack.history_sync','slack.history:'||a.id::text,'queued',3,clock_timestamp(),
   jsonb_build_object('connector_account_id',a.id,'campaign_id',h.id,'campaign_revision',h.revision,'history_import_id',m.current_import,'campaign_recovery_id',p_request),auth.uid(),clock_timestamp());
  answer:=answer||jsonb_build_object('state','committed','jobId',jid);
 else jid:=null;end if;
 insert into public.slack_campaign_recovery_requests(id,tenant_id,actor_id,campaign_id,account_id,failed_job_id,job_id,definition,receipt)
 values(p_request,p_tenant,auth.uid(),h.id,a.id,j.id,jid,p_input,answer);
 return answer;
end$$;
revoke all on function public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)'::regprocedure);
 needle:=' if p_operation=''start'' then';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Recovery dispatch baseline differs';end if;
 execute replace(d,needle,' if p_operation=''recover_page'' then return public.learn_slack_campaign_recover_page(p_tenant,p_request,p_input,p_mode);end if;'||chr(10)||needle);
 d:=pg_get_functiondef('public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure);
 needle:=' select * into a from public.connector_accounts';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Recovery authority baseline differs';end if;
 execute replace(d,needle,$guard$ if j.payload ? 'campaign_recovery_id' and not exists(
  select 1 from public.slack_campaign_recovery_requests r join public.profiles actor on actor.id=r.actor_id
  where r.id::text=j.payload->>'campaign_recovery_id' and r.job_id=j.id and r.tenant_id=p_tenant
   and r.account_id::text=j.payload->>'connector_account_id' and r.campaign_id::text=j.payload->>'campaign_id'
   and ((actor.tenant_id=p_tenant and actor.role in('owner','admin')) or exists(select 1 from public.platform_authority_grants g
    where g.profile_id=actor.id and g.permission='platform.controlplane.admin'
    and coalesce(g.effective_from,'-infinity')<=clock_timestamp() and coalesce(g.effective_to,'infinity')>clock_timestamp())))
 then return false;end if;
$guard$||needle);
end$$;
create function public.learn_slack_campaign_recovery_read(p_tenant uuid,p_campaign uuid,p_account uuid,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare m public.slack_history_campaign_channels%rowtype;a public.connector_accounts%rowtype;j public.platform_jobs%rowtype;
 r public.slack_campaign_recovery_requests%rowtype;diagnostic jsonb;begin
 perform public.learn_slack_control_access(p_tenant,true,'history');
 select * into m from public.slack_history_campaign_channels where campaign_id=p_campaign and account_id=p_account and tenant_id=p_tenant;
 if not found then raise exception 'slack_recovery_scope_unavailable' using errcode='42501';end if;
 select * into a from public.connector_accounts where id=p_account and tenant_id=p_tenant;
 if p_request is not null then
  select * into r from public.slack_campaign_recovery_requests where id=p_request and tenant_id=p_tenant and campaign_id=p_campaign and account_id=p_account and actor_id=auth.uid();
  if not found then raise exception 'slack_recovery_receipt_unavailable' using errcode='42501';end if;
  select * into j from public.platform_jobs where id=r.job_id and tenant_id=p_tenant;
 else
  select * into j from public.platform_jobs where tenant_id=p_tenant and job_type='slack.history_sync'
   and payload->>'connector_account_id'=p_account::text and not(payload ? 'source_replay_id') order by created_at desc,id desc limit 1;
 end if;
 select d.diagnostic into diagnostic from public.slack_structure_diagnostics d where d.job_id=j.id and d.tenant_id=p_tenant order by attempt desc limit 1;
 return jsonb_build_object('version','slack-campaign-recovery/1','tenantId',p_tenant,'campaignId',p_campaign,'accountId',p_account,'requestId',p_request,
 'importId',m.current_import,'checkpointHash',encode(sha256(convert_to(a.sync_cursor::text,'UTF8')),'hex'),'jobId',j.id,'status',j.status,
 'errorCode',case when j.error_code ~ '^slack_history_[a-z_]{1,80}$' then j.error_code else null end,'diagnostic',diagnostic,
 'receipt',r.receipt);
end$$;
revoke all on function public.learn_slack_campaign_recovery_read(uuid,uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_campaign_recovery_read(uuid,uuid,uuid,uuid) to authenticated;

commit;
