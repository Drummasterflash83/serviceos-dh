-- Settle a protocol-failed email job under its current lease. The generic
-- ID-only failure updater must not overwrite a replacement email worker.
begin;
create function public.learn_email_job_fail(p_tenant uuid,p_job uuid,p_attempt uuid,p_claimed_by text,p_claim integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;b public.learn_email_job_attempts%rowtype;r public.email_sync_runs%rowtype;receipt jsonb;code text;answer jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_email_job_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or p_attempt is null or nullif(p_claimed_by,'') is null or p_claim is null or p_claim<1 then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'learn_email_failure_v1';
 if j.status='dead_letter' and j.claimed_by=p_claimed_by and j.attempt_count=p_claim
  and receipt->>'attempt_id'=p_attempt::text and receipt->>'claimed_by'=p_claimed_by and receipt->>'claim'=p_claim::text
  and receipt->>'version'='learn-email-job-failure/1' then return receipt->'answer'||jsonb_build_object('disposition','replayed');end if;
 select * into b from public.learn_email_job_attempts where job_id=p_job and tenant_id=p_tenant and attempt_id=p_attempt;
 if not found then raise exception 'learn_email_job_binding_missing' using errcode='PT409';end if;
 perform public.learn_email_attempt_lease(p_attempt,p_claimed_by,p_claim);
 select * into r from public.email_sync_runs where id=b.attempt_id and tenant_id=b.tenant_id for key share;
 if not found or r.provider<>'gmail' or r.sync_type<>b.sync_type or r.status<>'failed' or r.completed_at is null
  or (r.metadata->>'email_account_id')::uuid is distinct from b.email_account_id then raise exception 'learn_email_attempt_not_failed' using errcode='PT409';end if;
 code:=case when r.error_message=any(array['history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure']) then r.error_message else 'capture_failed' end;
 answer:=jsonb_build_object('version','learn-email-job-failure/1','disposition','applied','job_id',j.id,'attempt_id',r.id,'code',code);
 receipt:=jsonb_build_object('version','learn-email-job-failure/1','attempt_id',r.id,'claimed_by',p_claimed_by,'claim',p_claim,'answer',answer);
 update public.platform_jobs set status='dead_letter',completed_at=clock_timestamp(),lease_expires_at=null,error_code=code,
  result=jsonb_build_object('sync_run_id',r.id,'error_code',code),metadata=coalesce(metadata,'{}')||jsonb_build_object('learn_email_failure_v1',receipt) where id=j.id;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 return answer;
end $$;
revoke all on function public.learn_email_job_fail(uuid,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_job_fail(uuid,uuid,uuid,text,integer) to service_role;
commit;
