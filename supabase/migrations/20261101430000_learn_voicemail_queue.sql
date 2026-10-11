-- One-message voicemail jobs use the existing queue. No jobs, routes or schedules
-- are seeded. The private binding freezes source identity across attempts.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
create table public.receptionist_voicemail_jobs(
 job_id uuid primary key references public.platform_jobs(id),
 tenant_id uuid not null references public.tenants(id),request jsonb not null,
 intake_id uuid,source_id uuid,created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,intake_id) references public.receptionist_voicemail_intakes(tenant_id,id),
 foreign key(tenant_id,source_id) references public.receptionist_voicemail_sources(tenant_id,id),
 check((intake_id is null)=(source_id is null))
);
create table public.receptionist_voicemail_job_receipts(
 job_id uuid not null references public.platform_jobs(id),attempt integer not null,
 tenant_id uuid not null references public.tenants(id),worker text not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(job_id,attempt)
);
alter table public.receptionist_voicemail_jobs enable row level security;
alter table public.receptionist_voicemail_job_receipts enable row level security;
revoke all on public.receptionist_voicemail_jobs,public.receptionist_voicemail_job_receipts from public,anon,authenticated;
grant select,insert,update on public.receptionist_voicemail_jobs to service_role;
grant select,insert on public.receptionist_voicemail_job_receipts to service_role;
create function public.voicemail_job_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' and tg_table_name='receptionist_voicemail_jobs' then
  if old.intake_id is null and new.intake_id is not null and new.source_id is not null
   and to_jsonb(new)-array['intake_id','source_id']=to_jsonb(old)-array['intake_id','source_id'] then return new;end if;
 end if;
 raise exception 'voicemail_job_evidence_immutable' using errcode='22023';
end$$;
create trigger voicemail_job_binding_immutable before update or delete on public.receptionist_voicemail_jobs for each row execute function public.voicemail_job_immutable();
create trigger voicemail_job_receipt_immutable before update or delete on public.receptionist_voicemail_job_receipts for each row execute function public.voicemail_job_immutable();

-- Every operation locks the capture gate before the job and intake rows. The job
-- lock serializes reclaim/publication; the clock is checked again before commit.
-- Inspect returns historical settlement evidence, not fresh health/coverage.
create function public.voicemail_queue_step(p_tenant uuid,p_job uuid,p_worker text,p_attempt integer,p_operation text,p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog set timezone='UTC' as $$
declare j public.platform_jobs%rowtype;b public.receptionist_voicemail_jobs%rowtype;s public.receptionist_voicemail_job_receipts%rowtype;
 r public.receptionist_voicemail_email_routes%rowtype;request jsonb;result jsonb;receipt jsonb;received timestamptz;
 code text;outcome text;failures integer;delay integer;paused boolean;at_time timestamptz;
begin
 if current_user<>'service_role' then raise exception 'voicemail_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_tenant is null or p_job is null
  or p_worker is null or length(p_worker) not between 1 and 200 or p_attempt is null or p_attempt<1
  or p_operation is null or p_operation not in('bind','route','prepare','publish','fail','inspect')
  or jsonb_typeof(p_args) is distinct from 'object' or octet_length(p_args::text)>110000
 then raise exception 'voicemail_queue_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.job_type<>'phone.voicemail_import' then raise exception 'voicemail_queue_claim_lost' using errcode='PT409';end if;
 select * into s from public.receptionist_voicemail_job_receipts where job_id=p_job and attempt=p_attempt;
 if found then
  if s.tenant_id<>p_tenant or s.worker<>p_worker then raise exception 'voicemail_queue_claim_lost' using errcode='PT409';end if;
  if p_operation='bind' then return jsonb_build_object('state','settled','receipt',s.receipt);end if;
  if p_operation in('inspect','fail') then return s.receipt;end if;
  raise exception 'voicemail_queue_already_settled' using errcode='PT409';
 end if;
 if p_operation='inspect' then raise exception 'voicemail_queue_receipt_missing' using errcode='PT409';end if;
 if j.status<>'running' or j.claimed_by is distinct from p_worker or j.attempt_count<>p_attempt
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
 then raise exception 'voicemail_queue_claim_lost' using errcode='PT409';end if;
 request:=j.payload;
 if jsonb_typeof(request) is distinct from 'object' or not request?&array['routeId','accountId','messageId','internalDate']
  or request-array['routeId','accountId','messageId','internalDate']<>'{}'::jsonb
  or jsonb_typeof(request->'routeId') is distinct from 'string' or coalesce(request->>'routeId','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or jsonb_typeof(request->'accountId') is distinct from 'string' or coalesce(request->>'accountId','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or jsonb_typeof(request->'messageId') is distinct from 'string' or coalesce(request->>'messageId','')!~'^[a-f0-9]{1,64}$'
  or jsonb_typeof(request->'internalDate') is distinct from 'string' or coalesce(request->>'internalDate','')!~'^(0|[1-9][0-9]{0,14})$'
 then raise exception 'voicemail_queue_payload_invalid' using errcode='22023';end if;
 received:=to_timestamp((request->>'internalDate')::numeric/1000);
 select * into b from public.receptionist_voicemail_jobs where job_id=p_job;
 if found and (b.tenant_id<>p_tenant or b.request<>request) then raise exception 'voicemail_queue_binding_changed' using errcode='PT409';end if;
 select * into r from public.receptionist_voicemail_email_routes where tenant_id=p_tenant and id=(request->>'routeId')::uuid for share;
 if not found or r.email_account_id<>(request->>'accountId')::uuid then raise exception 'voicemail_queue_route_mismatch' using errcode='PT409';end if;
 if p_operation='bind' then
  if p_args<>'{}'::jsonb then raise exception 'voicemail_queue_request_invalid' using errcode='22023';end if;
  if b.job_id is null then
   insert into public.receptionist_voicemail_jobs(job_id,tenant_id,request) values(p_job,p_tenant,request);
  end if;
  result:=jsonb_build_object('state','bound','request',request||jsonb_build_object('tenantId',p_tenant));
 elsif b.job_id is null then raise exception 'voicemail_queue_binding_missing' using errcode='PT409';
 elsif p_operation='route' then
  if p_args is distinct from jsonb_build_object('p_tenant',p_tenant,'p_route',r.id,'p_received',p_args->>'p_received')
   or (p_args->>'p_received')::timestamptz is distinct from received then raise exception 'voicemail_queue_source_mismatch' using errcode='PT409';end if;
  result:=to_jsonb(public.voicemail_intake_route(p_tenant,r.id,received));
 elsif p_operation='prepare' then
  if not p_args?&array['p_tenant','p_route','p_source','p_candidate'] or p_args-array['p_tenant','p_route','p_source','p_candidate']<>'{}'::jsonb
   or p_args->>'p_tenant' is distinct from p_tenant::text or p_args->>'p_route' is distinct from r.id::text
   or p_args->'p_source'->>'email_id' is distinct from request->>'messageId'
   or (p_args->'p_source'->>'received_at')::timestamptz is distinct from received
  then raise exception 'voicemail_queue_source_mismatch' using errcode='PT409';end if;
  result:=public.voicemail_intake_prepare(p_tenant,r.id,p_args->'p_source',p_args->'p_candidate');
  if b.intake_id is null then
   update public.receptionist_voicemail_jobs set intake_id=(result->>'intake_id')::uuid,source_id=(result->>'source_id')::uuid where job_id=p_job;
  elsif b.intake_id::text is distinct from result->>'intake_id' or b.source_id::text is distinct from result->>'source_id' then
   raise exception 'voicemail_queue_source_mismatch' using errcode='PT409';end if;
 elsif p_operation='publish' then
  if not p_args?&array['p_tenant','p_intake','p_source','p_raw_sha256','p_audio_sha256']
   or p_args-array['p_tenant','p_intake','p_source','p_raw_sha256','p_audio_sha256']<>'{}'::jsonb
   or p_args->>'p_tenant' is distinct from p_tenant::text or b.intake_id is null
   or p_args->>'p_intake' is distinct from b.intake_id::text or p_args->>'p_source' is distinct from b.source_id::text
  then raise exception 'voicemail_queue_source_mismatch' using errcode='PT409';end if;
  -- Byte readback remains the trusted importer's responsibility. This transaction
  -- atomically publishes its validated source and settles exactly the leased job.
  result:=public.voicemail_intake_publish(p_tenant,b.intake_id,b.source_id,p_args->>'p_raw_sha256',p_args->>'p_audio_sha256');
  at_time:=clock_timestamp();outcome:='succeeded';
  update public.platform_jobs set status=outcome,records_processed=1,completed_at=at_time,failed_at=null,dead_lettered_at=null,
   lease_expires_at=null,error_code=null,last_error=null,next_run_at=null,result=jsonb_build_object('message_id',b.intake_id,'coverage_complete',false)
   where id=p_job;
 elsif p_operation='fail' then
  if p_args-array['code']<>'{}'::jsonb or jsonb_typeof(p_args->'code') is distinct from 'string' then raise exception 'voicemail_queue_request_invalid' using errcode='22023';end if;
  code:=p_args->>'code';
  -- Only machine codes survive. Exception text, provider bodies and credentials
  -- cannot enter tenant-visible queue diagnostics.
  if code not in('voicemail_provider_temporary','voicemail_fetch_failed','voicemail_persistence_failed','voicemail_provider_source_unavailable',
   'voicemail_provider_access_denied','voicemail_credentials_unverified','voicemail_sa_config_missing','voicemail_sa_credentials_invalid',
   'voicemail_admin_delegation_missing','voicemail_scopes_missing','voicemail_delegation_grant_invalid','voicemail_delegation_denied',
   'voicemail_source_ineligible','voicemail_provider_response_invalid','voicemail_provider_source_changed','voicemail_mailbox_binding_unverified',
   'voicemail_storage_content_conflict','voicemail_storage_readback_unconfirmed','voicemail_audio_decode_unconfirmed','voicemail_source_mutated',
   'notification_signature_unverified','notification_recipient_unverified','notification_audio_ambiguous','notification_audio_format_unverified',
   'voicemail_route_unconfirmed','voicemail_prepare_unconfirmed','voicemail_publish_unconfirmed','voicemail_route_unverified','voicemail_import_unconfirmed')
  then code:='voicemail_import_unconfirmed';end if;
  paused:=not r.enabled or not public.learn_capture_allowed(p_tenant,'email') or not public.learn_capture_allowed(p_tenant,'phone');
  failures:=j.error_count+case when paused then 0 else 1 end;
  outcome:=case when paused then 'waiting' when failures<greatest(1,j.max_attempts) and code in('voicemail_provider_temporary','voicemail_fetch_failed',
   'voicemail_persistence_failed','voicemail_storage_readback_unconfirmed','voicemail_route_unconfirmed','voicemail_prepare_unconfirmed','voicemail_publish_unconfirmed','voicemail_import_unconfirmed')
   then 'retrying' else 'dead_letter' end;
  if paused then code:='voicemail_capture_paused';end if;
  delay:=case when paused then 300 when failures=1 then 60 when failures=2 then 300 when failures=3 then 900 else 3600 end;
  at_time:=clock_timestamp();
  update public.platform_jobs set status=case when outcome='waiting' then 'retrying' else outcome end,error_count=failures,records_processed=0,
   completed_at=null,failed_at=case when outcome='dead_letter' then at_time else null end,dead_lettered_at=case when outcome='dead_letter' then at_time else null end,
   lease_expires_at=null,error_code=code,last_error=case when paused then 'Voicemail capture is paused. Retained inputs are unchanged.' else 'Voicemail import requires retry or operator review. See the recorded error code.' end,
   available_at=case when outcome<>'dead_letter' then at_time+make_interval(secs=>delay) else null end,
   next_run_at=case when outcome<>'dead_letter' then at_time+make_interval(secs=>delay) else null end,
   result=jsonb_build_object('coverage_complete',false) where id=p_job;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'voicemail_queue_claim_lost' using errcode='PT409';end if;
 if outcome is not null then
  receipt:=jsonb_build_object('version','voicemail-queue/1','tenant_id',p_tenant,'job_id',p_job,'worker',p_worker,'attempt',p_attempt,
   'state',outcome,'records_processed',case when outcome='succeeded' then 1 else 0 end,
   'message_id',case when outcome='succeeded' then b.intake_id else null end,'code',code,'settled_at',at_time,'coverage_complete',false);
  insert into public.receptionist_voicemail_job_receipts(job_id,attempt,tenant_id,worker,receipt) values(p_job,p_attempt,p_tenant,p_worker,receipt);
  return receipt;
 end if;
 return result;
end$$;

-- Bounded recovery for dead workers, including jobs that died before binding.
-- Pause waits never consume the failure budget; lease losses do. No source reads.
create function public.voicemail_queue_recover() returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;n integer:=0;at_time timestamptz;outcome text;
begin
 if current_user<>'service_role' then raise exception 'voicemail_queue_forbidden' using errcode='42501';end if;
 for j in select * from public.platform_jobs where job_type='phone.voicemail_import' and status='running' and lease_expires_at<=clock_timestamp()
  order by lease_expires_at,id for update skip locked limit 100 loop
  at_time:=clock_timestamp();outcome:=case when j.error_count+1>=greatest(1,j.max_attempts) then 'dead_letter' else 'retrying' end;
  update public.platform_jobs set status=outcome,error_count=j.error_count+1,lease_expires_at=null,error_code='voicemail_worker_interrupted',
   last_error='Voicemail import was interrupted. Retained inputs are available for retry or operator review.',
   available_at=case when outcome='retrying' then at_time+interval '60 seconds' else null end,
   next_run_at=case when outcome='retrying' then at_time+interval '60 seconds' else null end,
   failed_at=case when outcome='dead_letter' then at_time else null end,dead_lettered_at=case when outcome='dead_letter' then at_time else null end where id=j.id;
  n:=n+1;
 end loop;
 return n;
end$$;
revoke all on function public.voicemail_job_immutable(),public.voicemail_queue_step(uuid,uuid,text,integer,text,jsonb),public.voicemail_queue_recover() from public,anon,authenticated;
grant execute on function public.voicemail_queue_step(uuid,uuid,text,integer,text,jsonb),public.voicemail_queue_recover() to service_role;
commit;
