-- OpenFolk capture switches govern admission of new batches, not retained history.
-- Missing switches inherit existing connector configuration; explicit false pauses.
-- No flags or provider work are seeded. Worker deployments must precede UI activation.
begin;
create table public.learn_capture_control_requests (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),definition jsonb not null,
 receipt jsonb not null,previous_state jsonb,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_capture_control_requests enable row level security;
revoke all on public.learn_capture_control_requests from public,anon,authenticated,service_role;
create trigger learn_capture_control_immutable before update or delete on public.learn_capture_control_requests
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_capture_allowed(p_tenant uuid,p_source text) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 if p_tenant is null or p_source is null or p_source not in ('email','phone','slack') then
  raise exception 'learn_capture_source_invalid' using errcode='22023';end if;
 return exists(select 1 from public.tenants where id=p_tenant and status='active')
  and not exists(select 1 from public.feature_flags where tenant_id=p_tenant
   and flag in ('learn.enabled','learn.inputs.'||p_source||'.enabled')
   and (jsonb_typeof(value) is distinct from 'boolean' or value is distinct from 'true'::jsonb));
end $$;

-- Operator data contains only normalized booleans and an opaque revision. A corrupt
-- flag blocks admission, but its raw value is never returned as diagnostic content.
create function public.learn_capture_control_state(p_tenant uuid) returns jsonb
language sql volatile security definer set search_path=pg_catalog as $$
 with names(flag) as (values('learn.enabled'),('learn.inputs.email.enabled'),('learn.inputs.phone.enabled'),('learn.inputs.slack.enabled')),
 raw as (select n.flag,f.value,f.tenant_id is not null as present from names n left join public.feature_flags f on f.tenant_id=p_tenant and f.flag=n.flag)
 select jsonb_build_object('version','learn-capture-controls/1','tenant_id',p_tenant,
  'revision',md5((select jsonb_agg(jsonb_build_object('flag',flag,'value',value,'present',present) order by flag)::text from raw)),
  'flags',(select jsonb_object_agg(flag,case when jsonb_typeof(value)='boolean' then value else 'null'::jsonb end) from raw),
  'sources',(select jsonb_object_agg(s,jsonb_build_object('allowed',public.learn_capture_allowed(p_tenant,s),
   'inherited',not exists(select 1 from public.feature_flags where tenant_id=p_tenant and flag='learn.inputs.'||s||'.enabled'),
   'invalid',exists(select 1 from public.feature_flags where tenant_id=p_tenant and flag in ('learn.enabled','learn.inputs.'||s||'.enabled') and jsonb_typeof(value) is distinct from 'boolean')))
   from unnest(array['email','phone','slack'])s));
$$;
create function public.learn_operator_capture_controls(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 return public.learn_capture_control_state(p_tenant);
end $$;
create function public.learn_operator_capture_control_request(p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_capture_control_requests%rowtype;previous jsonb;answer jsonb;k text;begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel') or jsonb_typeof(p_definition) is distinct from 'object'
  or octet_length(p_definition::text)>4000 then raise exception 'learn_capture_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-capture-request:'||p_request::text,0));
 select * into prior from public.learn_capture_control_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition then
   raise exception 'learn_capture_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then answer:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
 else
  if not p_definition ?& array['reason','revision','values'] or (p_definition-array['reason','revision','values'])<>'{}'::jsonb
   or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
   or jsonb_typeof(p_definition->'revision') is distinct from 'string' or p_definition->>'revision'!~'^[a-f0-9]{32}$'
   or jsonb_typeof(p_definition->'values') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_definition->'values'))<>4 then
   raise exception 'learn_capture_definition_invalid' using errcode='22023';end if;
  foreach k in array array['learn.enabled','learn.inputs.email.enabled','learn.inputs.phone.enabled','learn.inputs.slack.enabled'] loop
   if jsonb_typeof(p_definition->'values'->k) is distinct from 'boolean' then raise exception 'learn_capture_flags_invalid' using errcode='22023';end if;
  end loop;
  -- Same lock as existing Commusoft/master controls; concurrent operator edits cannot
  -- silently overwrite each other's master switch or admit a batch mid-update.
  perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
  previous:=public.learn_capture_control_state(p_tenant);
  if previous->>'revision' is distinct from p_definition->>'revision' then raise exception 'learn_capture_flags_changed' using errcode='PT409';end if;
  foreach k in array array['learn.enabled','learn.inputs.email.enabled','learn.inputs.phone.enabled','learn.inputs.slack.enabled'] loop
   update public.feature_flags set value=p_definition->'values'->k where tenant_id=p_tenant and flag=k;
   if not found then insert into public.feature_flags(tenant_id,flag,value) values(p_tenant,k,p_definition->'values'->k);end if;
  end loop;
  answer:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','controls',public.learn_capture_control_state(p_tenant));
 end if;
 insert into public.learn_capture_control_requests(id,tenant_id,actor_id,definition,receipt,previous_state)
  values(p_request,p_tenant,p_actor,p_definition,answer,previous);
 return answer;
end $$;

-- Called once at a server capture boundary before opening a run or obtaining a
-- provider credential. The short admission transaction does not hold an HTTP lock.
create function public.learn_capture_admission(p_tenant uuid,p_source text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare allowed boolean;begin
 if current_user<>'service_role' then raise exception 'learn_capture_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_capture_snapshot_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 allowed:=public.learn_capture_allowed(p_tenant,p_source);
 return jsonb_build_object('version','learn-capture-admission/1','tenant_id',p_tenant,'source',p_source,'allowed',allowed,'checked_at',clock_timestamp());
end $$;
create function public.learn_capture_job_allowed(p_tenant uuid,p_type text,p_metadata jsonb) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select case
  when p_type in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill','email.mailbox_discovery') then public.learn_capture_allowed(p_tenant,'email')
  when p_type in ('slack.history_sync','slack.thread_sync') then coalesce(p_metadata ? 'slack_page_v1',false) or public.learn_capture_allowed(p_tenant,'slack')
  else true end;
$$;
-- Filter before claiming: deliberate pauses never burn an attempt. Retain existing
-- dedicated-worker exclusions and every other part of the installed claim functions.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 needle:='and (p_job_types is null or c.job_type = any(p_job_types))';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_capture_queue_shape_changed';end if;
 execute replace(d,needle,needle||E'\n      and public.learn_capture_job_allowed(c.tenant_id,c.job_type,c.metadata)');
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 needle:='and q.status in (''queued'',''retrying'',''running'') and coalesce(q.available_at,''-infinity'')<=clock_timestamp()';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_capture_slack_shape_changed';end if;
 execute replace(d,needle,needle||E'\n  and public.learn_capture_job_allowed(q.tenant_id,q.job_type,q.metadata)');
 -- Recheck a selected row under its lock, before exhaustion/pacing accounting.
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 needle:='if not found then continue;end if;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_capture_slack_lock_shape_changed';end if;
 execute replace(d,needle,needle||E'\n  if not public.learn_capture_job_allowed(j.tenant_id,j.job_type,j.metadata) then continue;end if;');
 -- Apply the pause before the bounded phone selection, so waiting downloads do
 -- not starve transcription/analysis of audio already retained in this company.
 d:=pg_get_functiondef('public.phone_select_pending(uuid,integer,integer)'::regprocedure);
 needle:='where s.tenant_id = p_tenant_id and r.retry_state = ''ready''';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_capture_phone_selector_shape_changed';end if;
 execute replace(d,needle,needle||E'\n      and (s.stage <> ''download'' or public.learn_capture_allowed(p_tenant_id,''phone''))');
end $$;

-- A pause observed after claim returns this exact lease to the queue without
-- burning a retry. This is only for work stopped before provider admission.
create function public.learn_capture_defer_job(p_tenant uuid,p_job uuid,p_claimed_by text,p_attempt integer,p_reason text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;prior jsonb;answer jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_capture_forbidden' using errcode='42501';end if;
 if p_reason is null or p_reason not in ('paused','unavailable') or p_attempt is null or p_attempt<1 or nullif(p_claimed_by,'') is null then
  raise exception 'learn_capture_defer_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.job_type not in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill','email.mailbox_discovery','slack.history_sync','slack.thread_sync') then
  raise exception 'learn_capture_defer_not_owned' using errcode='PT409';end if;
 prior:=j.metadata->'learn_capture_deferred_v1';
 if prior->>'claimed_by'=p_claimed_by and prior->>'attempt'=p_attempt::text then
  if prior->>'reason' is distinct from p_reason then raise exception 'learn_capture_defer_conflict' using errcode='PT409';end if;
  return prior->'answer';
 end if;
 if j.status<>'running' or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() or coalesce(j.metadata,'{}') ? 'slack_page_v1' then
  raise exception 'learn_capture_defer_not_owned' using errcode='PT409';end if;
 answer:=jsonb_build_object('job_id',p_job,'state','waiting','reason',p_reason,'attempt_count',p_attempt-1);
 update public.platform_jobs set status='queued',claimed_by=null,claimed_at=null,lease_expires_at=null,
  attempt_count=p_attempt-1,available_at=clock_timestamp()+interval '60 seconds',
  metadata=coalesce(metadata,'{}')||jsonb_build_object('learn_capture_deferred_v1',jsonb_build_object('claimed_by',p_claimed_by,'attempt',p_attempt,'reason',p_reason,'answer',answer)) where id=j.id;
 if j.job_type in ('slack.history_sync','slack.thread_sync') then
  update public.slack_workspace_pacing set active_job_id=null,last_finished_at=clock_timestamp(),
   next_allowed_at=greatest(blocked_until,clock_timestamp()+interval '60 seconds') where active_job_id=j.id;
 end if;
 return answer;
end $$;

do $$declare name text;signature text;begin
 foreach name in array array['learn_capture_allowed','learn_capture_control_state','learn_operator_capture_controls','learn_operator_capture_control_request','learn_capture_admission','learn_capture_job_allowed','learn_capture_defer_job'] loop
  for signature in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name loop
   execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
  end loop;
 end loop;
end $$;
grant execute on function public.learn_operator_capture_controls(uuid),public.learn_operator_capture_control_request(uuid,uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.learn_capture_allowed(uuid,text),public.learn_capture_admission(uuid,text),public.learn_capture_job_allowed(uuid,text,jsonb),public.learn_capture_defer_job(uuid,uuid,text,integer,text) to service_role;
commit;
