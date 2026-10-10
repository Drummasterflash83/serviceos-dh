-- One durable email sync attempt per queue job, independent of worker leases.
-- Replacements recover the same attempt; only the current lease may submit work.
begin;
create table public.learn_email_job_attempts (
 job_id uuid primary key references public.platform_jobs(id) on delete restrict,
 tenant_id uuid not null,email_account_id uuid not null,attempt_id uuid not null unique,
 stream text not null check(stream in ('recent','historical')),
 sync_type text not null check(sync_type in ('messages','workspace_messages','workspace_backfill')),
 definition jsonb not null check(jsonb_typeof(definition)='object'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,email_account_id) references public.email_accounts(tenant_id,id) on delete restrict,
 foreign key(tenant_id,attempt_id) references public.email_sync_runs(tenant_id,id) on delete restrict
);
alter table public.learn_email_job_attempts enable row level security;
revoke all on public.learn_email_job_attempts from public,anon,authenticated,service_role;
grant select,insert on public.learn_email_job_attempts to service_role;
create trigger learn_email_job_attempt_immutable before update or delete on public.learn_email_job_attempts
 for each row execute function public.learn_email_transition_immutable();

create function public.learn_email_job_attempt(p_tenant uuid,p_job uuid,p_claimed_by text,p_claim integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;b public.learn_email_job_attempts%rowtype;run public.email_sync_runs%rowtype;
 account uuid;kind text;stream_name text;definition jsonb;recovered boolean;begin
 if current_user<>'service_role' then raise exception 'learn_email_job_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or nullif(p_claimed_by,'') is null or p_claim is null or p_claim<1 then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_claim
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 if j.job_type not in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill')
  or jsonb_typeof(j.payload) is distinct from 'object' or octet_length(j.payload::text)>4000
  or jsonb_typeof(j.payload->'email_account_id') is distinct from 'string'
  or not coalesce(j.payload->>'email_account_id'~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false)
  or (j.payload-array['email_account_id','max_results','force','restart'])<>'{}'::jsonb then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 if j.payload ? 'max_results' then
  if jsonb_typeof(j.payload->'max_results') is distinct from 'number' or not coalesce(j.payload->>'max_results'~'^[0-9]{1,3}$',false) then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
  if (j.payload->>'max_results')::integer not between 1 and 500 then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 end if;
 if (j.payload ? 'force' and jsonb_typeof(j.payload->'force') is distinct from 'boolean')
  or (j.payload ? 'restart' and jsonb_typeof(j.payload->'restart') is distinct from 'boolean') then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 account:=(j.payload->>'email_account_id')::uuid;
 if j.job_key is distinct from j.job_type||':'||(j.payload->>'email_account_id') then raise exception 'learn_email_job_identity' using errcode='22023';end if;
 perform 1 from public.email_accounts where id=account and tenant_id=p_tenant and provider='gmail';
 if not found then raise exception 'learn_email_job_identity' using errcode='42501';end if;
 kind:=case j.job_type when 'email.gmail_sync' then 'messages' when 'email.workspace_sync' then 'workspace_messages' else 'workspace_backfill' end;
 stream_name:=case when j.job_type='email.workspace_backfill' then 'historical' else 'recent' end;
 definition:=jsonb_build_object('job_type',j.job_type,'job_key',j.job_key,'payload',j.payload,'connector_id',j.connector_id,'module_id',j.module_id);
 select * into b from public.learn_email_job_attempts where job_id=j.id;
 recovered:=found;
 if recovered then
  if b.tenant_id<>p_tenant or b.email_account_id<>account or b.stream<>stream_name or b.sync_type<>kind or b.definition<>definition then raise exception 'learn_email_job_definition_changed' using errcode='PT409';end if;
 else
  b.attempt_id:=gen_random_uuid();
  insert into public.email_sync_runs(id,tenant_id,provider,sync_type,status,metadata)
   values(b.attempt_id,p_tenant,'gmail',kind,'running',jsonb_build_object('email_account_id',account,'learn_email_job_id',j.id));
  insert into public.learn_email_job_attempts(job_id,tenant_id,email_account_id,attempt_id,stream,sync_type,definition)
   values(j.id,p_tenant,account,b.attempt_id,stream_name,kind,definition);
 end if;
 select * into run from public.email_sync_runs where id=b.attempt_id and tenant_id=p_tenant;
 if not found or run.provider<>'gmail' or run.sync_type<>kind or run.status not in ('running','success','failed')
  or (run.metadata->>'email_account_id')::uuid is distinct from account then raise exception 'learn_email_job_attempt_mismatch' using errcode='PT409';end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 return jsonb_build_object('version','learn-email-job-attempt/1','tenant_id',p_tenant,'job_id',j.id,'email_account_id',account,
  'attempt_id',b.attempt_id,'stream',stream_name,'sync_type',kind,'status',run.status,'records_processed',run.records_processed,
  'recovered',recovered,'claimed_by',p_claimed_by,'claim',p_claim,'lease_expires_at',j.lease_expires_at,'payload',j.payload);
end $$;

-- Job lock precedes the outbox attempt lock and the protocol's account/run locks.
-- Standalone attempts retain their original server-only behavior.
create function public.learn_email_attempt_lease(p_attempt uuid,p_claimed_by text,p_claim integer) returns void
language plpgsql security invoker set search_path=pg_catalog as $$declare j public.platform_jobs%rowtype;b public.learn_email_job_attempts%rowtype;begin
 if current_user<>'service_role' then raise exception 'learn_email_job_forbidden' using errcode='42501';end if;
 select * into b from public.learn_email_job_attempts where attempt_id=p_attempt;
 if not found then
  if p_claimed_by is not null or p_claim is not null then raise exception 'learn_email_job_binding_missing' using errcode='PT409';end if;
  return;
 end if;
 select * into j from public.platform_jobs where id=b.job_id and tenant_id=b.tenant_id for update;
 if not found or j.status<>'running' or nullif(p_claimed_by,'') is null or p_claim is null
  or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_claim
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
  or b.definition is distinct from jsonb_build_object('job_type',j.job_type,'job_key',j.job_key,'payload',j.payload,'connector_id',j.connector_id,'module_id',j.module_id)
 then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
end $$;

-- Add lease arguments to the two outbox mutation APIs. Remove the old signatures
-- so job-bound callers cannot accidentally use an entrypoint without lease checks.
do $$declare d text;needle text;signature text;begin
 d:=pg_get_functiondef('public.learn_email_transition_prepare(jsonb)'::regprocedure);
 needle:='p_document jsonb)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_prepare_shape_changed';end if;
 d:=replace(d,needle,'p_document jsonb, p_claimed_by text DEFAULT NULL, p_claim integer DEFAULT NULL)');
 needle:='perform pg_advisory_xact_lock(hashtextextended(''learn-email-attempt:''||attempt::text,0));';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_prepare_lock_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 needle:='return p_document;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_prepare_return_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 drop function public.learn_email_transition_prepare(jsonb);
 execute d;
 d:=pg_get_functiondef('public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid)'::regprocedure);
 needle:='p_request uuid)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_apply_shape_changed';end if;
 d:=replace(d,needle,'p_request uuid, p_claimed_by text DEFAULT NULL, p_claim integer DEFAULT NULL)');
 needle:='perform pg_advisory_xact_lock(hashtextextended(''learn-email-attempt:''||p_attempt::text,0));';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_apply_lock_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(p_attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 -- A long-running transition that outlives its lease must roll back, not settle.
 needle:='return answer;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_apply_return_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(p_attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 drop function public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid);
 execute d;
end $$;
revoke all on function public.learn_email_job_attempt(uuid,uuid,text,integer),public.learn_email_attempt_lease(uuid,text,integer),public.learn_email_transition_prepare(jsonb,text,integer),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_job_attempt(uuid,uuid,text,integer),public.learn_email_attempt_lease(uuid,text,integer),public.learn_email_transition_prepare(jsonb,text,integer),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid,text,integer) to service_role;
commit;
