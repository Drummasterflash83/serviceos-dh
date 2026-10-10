-- Scheduler settlement derives progress from retained child evidence. Run, job,
-- account cursor and connector health commit together, or none of them do.
begin;
create table public.learn_phone_schedule_settlements (
 run_id uuid primary key references public.phone_sync_runs(id),
 tenant_id uuid not null references public.tenants(id),
 definition jsonb not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_schedule_settlements enable row level security;
revoke all on public.learn_phone_schedule_settlements from public,anon,authenticated,service_role;
grant select on public.learn_phone_schedule_settlements to service_role;
create trigger learn_phone_schedule_immutable before update or delete on public.learn_phone_schedule_settlements
 for each row execute function public.learn_operator_input_immutable();
create trigger learn_phone_schedule_no_truncate before truncate on public.learn_phone_schedule_settlements
 for each statement execute function public.learn_operator_input_immutable();
create function public.learn_phone_settle_schedule(p_tenant uuid,p_run uuid,p_calls uuid,p_recordings uuid,p_outcome text,p_errors jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.phone_sync_runs%rowtype;child public.phone_sync_runs%rowtype;j public.platform_jobs%rowtype;
 a public.connector_accounts%rowtype;c public.tenant_connectors%rowtype;prior public.learn_phone_schedule_settlements%rowtype;
 proof public.learn_phone_import_completions%rowtype;d jsonb;answer jsonb;scope jsonb;child_id uuid;k text;
 account_id uuid;connector uuid;job uuid;customer text;owner text;counts jsonb:='{}';n integer;
 window_from timestamptz;window_to timestamptz;cursor_at timestamptz;health text;checked_at timestamptz:=clock_timestamp();
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_schedule_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_outcome is null or p_outcome not in ('success','failed','paused')
 or jsonb_typeof(p_errors) is distinct from 'object' or octet_length(p_errors::text)>512 then
  raise exception 'phone_schedule_invalid' using errcode='22023';end if;
 if exists(select 1 from jsonb_each(p_errors)e where e.key not in ('calls','recordings') or jsonb_typeof(e.value)<>'string' or e.value#>>'{}' !~ '^[a-z][a-z0-9_]{0,79}$')
 or (p_outcome='success' and (p_errors<>'{}' or p_calls is null or p_recordings is null))
 or (p_outcome<>'success' and p_errors='{}')
 or (p_outcome='paused' and exists(select 1 from jsonb_each_text(p_errors)e where e.value not in ('learn_capture_paused','learn_capture_unavailable'))) then
  raise exception 'phone_schedule_invalid' using errcode='22023';end if;
 d:=jsonb_build_object('callsRunId',p_calls,'recordingsRunId',p_recordings,'outcome',p_outcome,'errors',p_errors);
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.phone_sync_runs where id=p_run and tenant_id=p_tenant for update;
 if not found or r.provider<>'simwood' or r.sync_type<>'scheduled_sync' then raise exception 'phone_schedule_run_changed' using errcode='PT409';end if;
 select * into prior from public.learn_phone_schedule_settlements where run_id=p_run;
 if found then
  if prior.tenant_id<>p_tenant or prior.definition<>d then raise exception 'phone_schedule_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if r.status<>'running' then raise exception 'phone_schedule_run_changed' using errcode='PT409';end if;
 account_id:=(r.metadata->>'connector_account_id')::uuid;connector:=(r.metadata->>'tenant_connector_id')::uuid;
 job:=(r.metadata->>'job_id')::uuid;owner:=r.metadata->>'job_owner';customer:=r.metadata->>'provider_customer_id';
 window_from:=(r.metadata->>'from')::timestamptz;window_to:=(r.metadata->>'to')::timestamptz;
 if account_id is null or connector is null or job is null or owner is null or owner='' or customer is null
 or window_from is null or window_to is null or not isfinite(window_from) or not isfinite(window_to) or window_from>=window_to
 or jsonb_typeof(r.metadata->'include_local') is distinct from 'boolean' or r.metadata->>'account_updated_at' is null then
  raise exception 'phone_schedule_scope_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=job and tenant_id=p_tenant for update;
 if not found or j.job_type<>'phone.scheduled_sync' or j.connector_id is distinct from 'simwood' or j.status<>'running'
 or j.claimed_by is distinct from owner or j.attempt_count<>1 or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
 or j.payload->>'provider_customer_id' is distinct from customer or j.payload->>'from' is distinct from r.metadata->>'from'
 or j.payload->>'to' is distinct from r.metadata->>'to' then raise exception 'phone_schedule_job_changed' using errcode='PT409';end if;
 -- Successful children require an immutable completion receipt, matching filters
 -- and the same time window. Counts come from saved pages, never HTTP claims.
 foreach k in array array['calls','recordings'] loop
  child_id:=case when k='calls' then p_calls else p_recordings end;n:=0;
  if child_id is not null then
   select * into child from public.phone_sync_runs where id=child_id and tenant_id=p_tenant for share;
   if not found or child.provider<>'simwood' or child.sync_type<>k
   or child.metadata->>'from' is distinct from r.metadata->>'from' or child.metadata->>'to' is distinct from r.metadata->>'to' then
    raise exception 'phone_schedule_child_changed' using errcode='PT409';end if;
   scope:=jsonb_build_object('accountId',account_id,'connectorId',connector,'customerId',customer,'kind',k);
   if exists(select 1 from public.learn_phone_capture_pages where run_id=child_id and (tenant_id<>p_tenant or definition-'recordsSha256'<>scope)) then
    raise exception 'phone_schedule_child_changed' using errcode='PT409';end if;
   select coalesce(sum((receipt->>'recordsProcessed')::integer),0) into n from public.learn_phone_capture_pages where run_id=child_id;
   if not (p_errors ? k) then
    select * into proof from public.learn_phone_import_completions where run_id=child_id and tenant_id=p_tenant;
    if not found or child.status<>'success' or proof.receipt->>'version' is distinct from 'learn-phone-import/1'
    or proof.receipt->'windowComplete' is distinct from 'true'::jsonb or proof.definition-(array['pages','recordsProcessed','metadata'])<>scope
    or proof.definition->'metadata' is distinct from child.metadata or proof.receipt->>'from' is distinct from r.metadata->>'from'
    or proof.receipt->>'to' is distinct from r.metadata->>'to' or proof.receipt->'recordsProcessed' is distinct from to_jsonb(n)
    or child.metadata->'limit' is distinct from 'null'::jsonb
    or (k='calls' and (child.metadata->'direction' is distinct from 'null'::jsonb or child.metadata->'include_local' is distinct from r.metadata->'include_local'))
    or (k='recordings' and (child.metadata->'call_id' is distinct from 'null'::jsonb or child.metadata->'linked_id' is distinct from 'null'::jsonb)) then
     raise exception 'phone_schedule_child_unconfirmed' using errcode='PT409';end if;
   end if;
  elsif not (p_errors ? k) then raise exception 'phone_schedule_child_unconfirmed' using errcode='PT409';
  end if;
  counts:=counts||jsonb_build_object(k,n);
 end loop;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 if p_outcome='success' and not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into c from public.tenant_connectors where id=connector and tenant_id=p_tenant for update;
 if not found or c.connector_id<>'simwood' or c.provider<>'simwood' or not c.enabled or c.status not in ('active','error') then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 select * into a from public.connector_accounts where id=account_id and tenant_id=p_tenant for update;
 if not found or a.tenant_connector_id<>connector or a.status<>'active'
 or coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key) is distinct from customer then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 if a.updated_at is distinct from (r.metadata->>'account_updated_at')::timestamptz
 or coalesce(a.settings->'include_local_calls'='true'::jsonb,false) is distinct from (r.metadata->>'include_local')::boolean then
  raise exception 'phone_schedule_account_changed' using errcode='PT409';end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'phone_schedule_job_changed' using errcode='PT409';end if;
 if jsonb_typeof(a.sync_cursor) is distinct from 'object' then raise exception 'phone_schedule_cursor_invalid' using errcode='PT409';end if;
 cursor_at:=coalesce((a.sync_cursor->>'last_synced_until')::timestamptz,a.last_successful_sync_at);
 if p_outcome='success' then
  if (cursor_at is not null and (not isfinite(cursor_at) or window_from>cursor_at or window_to<cursor_at))
  or (cursor_at is null and window_from>window_to-interval '24 hours') then raise exception 'phone_schedule_window_gap' using errcode='PT409';end if;
  update public.connector_accounts set sync_cursor=sync_cursor||jsonb_build_object('last_synced_until',r.metadata->>'to'),
   last_successful_sync_at=window_to,last_error=null where id=account_id;
  -- One successful account must not hide another account's missing/failed sync.
  health:=case when exists(select 1 from public.connector_accounts where tenant_connector_id=connector and tenant_id=p_tenant
   and status='active' and (last_successful_sync_at is null or last_error is not null)) then 'warning' else 'healthy' end;
  update public.tenant_connectors set last_successful_sync_at=greatest(last_successful_sync_at,window_to),health_status=health,
   last_error=case when health='healthy' then null else 'phone_accounts_need_attention' end where id=connector;
 elsif p_outcome='failed' then
  update public.connector_accounts set last_failed_sync_at=checked_at,last_error='phone_sync_failed' where id=account_id;
  update public.tenant_connectors set last_failed_sync_at=checked_at,health_status='warning',last_error='phone_sync_failed' where id=connector;
 end if;
 answer:=jsonb_build_object('version','learn-phone-schedule/1','tenantId',p_tenant,'runId',p_run,'accountId',account_id,
  'connectorId',connector,'customerId',customer,'jobId',job,'outcome',p_outcome,'callsRunId',p_calls,'recordingsRunId',p_recordings,
  'callsProcessed',counts->'calls','recordingsProcessed',counts->'recordings','from',r.metadata->>'from','to',r.metadata->>'to',
  'cursorAdvanced',p_outcome='success');
 n:=(counts->>'calls')::integer+(counts->>'recordings')::integer;
 update public.phone_sync_runs set status=p_outcome,completed_at=checked_at,records_processed=n,
  error_message=case when p_outcome='failed' then 'phone_sync_failed' else null end,
  metadata=metadata||jsonb_build_object('calls_sync_run_id',p_calls,'recordings_sync_run_id',p_recordings,
   'calls_processed',counts->'calls','recordings_processed',counts->'recordings','errors',p_errors,'settlement',answer) where id=p_run;
 update public.platform_jobs set status=case p_outcome when 'success' then 'succeeded' when 'paused' then 'cancelled' else 'failed' end,
  completed_at=checked_at,failed_at=case when p_outcome='failed' then checked_at else failed_at end,
  cancelled_at=case when p_outcome='paused' then checked_at else cancelled_at end,
  last_error=case when p_outcome='failed' then 'phone_sync_failed' else null end,records_processed=n,progress_current=n,
  error_count=case when p_outcome='failed' then 1 else 0 end,
  result=answer||jsonb_build_object('capture_waiting',p_outcome='paused'),lease_expires_at=null where id=job;
 insert into public.learn_phone_schedule_settlements(run_id,tenant_id,definition,receipt) values(p_run,p_tenant,d,answer);
 return answer;
end $$;
revoke all on function public.learn_phone_settle_schedule(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_settle_schedule(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
