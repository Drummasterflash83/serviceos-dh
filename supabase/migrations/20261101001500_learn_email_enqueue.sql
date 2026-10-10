-- Manual capture requests use the same durable queue as scheduled capture.
begin;
create function public.learn_email_enqueue(p_tenant uuid,p_account uuid,p_type text,p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare a public.email_accounts%rowtype;j public.platform_jobs%rowtype;
 payload jsonb;connector text;key text;duplicate boolean;n integer;begin
 if current_user<>'service_role' then raise exception 'learn_email_enqueue_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_type is null or p_type not in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill')
  or jsonb_typeof(p_options) is distinct from 'object' or (p_options-array['max_results','force','restart'])<>'{}'::jsonb then
  raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
 if (p_options ? 'force' and jsonb_typeof(p_options->'force') is distinct from 'boolean')
  or (p_options ? 'restart' and jsonb_typeof(p_options->'restart') is distinct from 'boolean')
  or (p_type='email.workspace_backfill' and p_options ? 'force')
  or (p_type<>'email.workspace_backfill' and p_options ? 'restart') then
  raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
 if p_options ? 'max_results' then
  if jsonb_typeof(p_options->'max_results') is distinct from 'number' or not coalesce(p_options->>'max_results'~'^[0-9]{1,3}$',false) then
   raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
  if (p_options->>'max_results')::integer not between 1 and 500 then raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
 end if;
 if p_options->'restart'='true'::jsonb then raise exception 'learn_email_explicit_recovery_required' using errcode='PT409';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_capture_snapshot_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 if not public.learn_capture_allowed(p_tenant,'email') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into a from public.email_accounts where id=p_account and tenant_id=p_tenant and provider='gmail';
 if not found or (p_type='email.gmail_sync' and (a.status<>'active' or a.auth_state not in ('ok','unknown') or a.auth_state is null))
  or (p_type<>'email.gmail_sync' and a.status not in ('pending_tokenless_dwd','active_dwd')) then
  raise exception 'learn_email_source_ineligible' using errcode='PT409';end if;
 -- The worker rechecks all current mailbox/connection authority before tokens.
 payload:=jsonb_build_object('email_account_id',p_account);
 if p_type<>'email.workspace_backfill' or p_options ? 'max_results' then
  payload:=payload||jsonb_build_object('max_results',coalesce((p_options->>'max_results')::integer,25));end if;
 if p_options->'force'='true'::jsonb then payload:=payload||'{"force":true}'::jsonb;end if;
 connector:=case when p_type='email.gmail_sync' then 'gmail' else 'google-workspace' end;
 key:=p_type||':'||p_account::text;
 -- The unique active-job key arbitrates concurrent schedulers and requests.
 -- Never overwrite an existing payload, including a different rescan intent.
 for n in 1..3 loop
  insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,priority,max_attempts,payload)
   values(p_tenant,connector,'communications.email',p_type,key,case when p_type='email.workspace_backfill' then 200 else 100 end,5,payload)
   on conflict(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying') do nothing returning * into j;
  duplicate:=not found;
  if duplicate then
   select * into j from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in ('queued','running','retrying') for share;
   if not found then continue;end if;
   if j.job_type is distinct from p_type or j.connector_id is distinct from connector or j.module_id is distinct from 'communications.email' or j.payload is distinct from payload then
    raise exception 'learn_email_active_request_conflict' using errcode='PT409';end if;
  end if;
  return jsonb_build_object('version','learn-email-enqueue/1','success',true,'state','queued','job_id',j.id,'duplicate',duplicate,'provider','gmail','email_account_id',p_account);
 end loop;
 raise exception 'learn_email_enqueue_busy' using errcode='PT409';
end $$;
revoke all on function public.learn_email_enqueue(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_enqueue(uuid,uuid,text,jsonb) to service_role;
commit;
