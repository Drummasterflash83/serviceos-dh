-- Preserve allowlisted Workspace diagnostics through the existing durable protocol.
-- No source rows, authority, function owners or grants are changed.
begin;
CREATE OR REPLACE FUNCTION public.email_ingestion_payload_v2(op text, stream text, v jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare names text[]; t jsonb; k text;
begin
  case op
  when 'claim' then
    names:=array['recovery'];
    if stream='recent' and v ? 'force' then
      names:=names||array['force'];
      if jsonb_typeof(v->'force') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_force'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names);
    if v->'recovery'<>'null'::jsonb then perform public.email_ingestion_recovery_v2(v->'recovery'); end if;
  when 'initialize_traversal' then
    perform public.email_ingestion_keys_v2(v,array['captured_history_id','captured_at','page_size','query']);
    if stream<>'recent' or jsonb_typeof(v->'captured_history_id') is distinct from 'string' or
      not coalesce(v->>'captured_history_id'~'^(0|[1-9][0-9]{0,19})$',false) then raise exception using errcode='22023',message='invalid_boundary'; end if;
    if (v->>'captured_history_id')::numeric>18446744073709551615 or v->'query'<>'null'::jsonb or
      not public.email_ingestion_count_v2(v->'page_size') or (v->>'page_size')::integer not between 1 and 500 or
      not coalesce(v->>'captured_at'~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$',false) then raise exception using errcode='22023',message='invalid_boundary'; end if;
    perform (v->>'captured_at')::timestamptz;
  when 'checkpoint' then
    names:=array['returned_next_page_token','exhausted','page_evidence','yield_after_page'];
    if stream='recent' then names:=names||array['label','expected_input_page_token'];
    else names:=names||array['expected_page_token','expected_total','listed_count']; end if;
    perform public.email_ingestion_keys_v2(v,names);
    perform public.email_ingestion_evidence_v2(v->'page_evidence','success');
    if stream='recent' then
      if not coalesce(v->>'label'=any(array['INBOX','SENT']),false) then raise exception using errcode='22023',message='invalid_page'; end if;
      k:='expected_input_page_token';
    else
      k:='expected_page_token';
      if not public.email_ingestion_count_v2(v->'expected_total') or not public.email_ingestion_count_v2(v->'listed_count') then raise exception using errcode='22023',message='invalid_page'; end if;
    end if;
    foreach t in array array[v->k,v->'returned_next_page_token'] loop
      if t<>'null'::jsonb and (jsonb_typeof(t)<>'string' or length(t#>>'{}') not between 1 and 8192) then raise exception using errcode='22023',message='invalid_token'; end if;
    end loop;
    if jsonb_typeof(v->'exhausted')<>'boolean' or jsonb_typeof(v->'yield_after_page')<>'boolean' or
      (v->>'exhausted')::boolean is distinct from (v->'returned_next_page_token'='null'::jsonb) then raise exception using errcode='22023',message='invalid_page'; end if;
  when 'release' then
    perform public.email_ingestion_keys_v2(v,array['reason_code','attempt_evidence']);
    if not coalesce(v->>'reason_code'=any(array['page_budget','time_budget','requested_yield']),false) then raise exception using errcode='22023',message='invalid_release'; end if;
    perform public.email_ingestion_evidence_v2(v->'attempt_evidence','release');
  when 'block','finish_attempt' then
    names:=array['error_code','attempt_evidence'];
    if op='finish_attempt' then names:=names||array['outcome'];
      if not coalesce(v->>'outcome'=any(array['failed','superseded']),false) then raise exception using errcode='22023',message='invalid_outcome'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names);
    if not coalesce(v->>'error_code'=any(array['history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure','sa_config_missing','sa_credentials_invalid','admin_delegation_missing','scopes_missing','delegation_grant_invalid','delegation_denied']),false) then raise exception using errcode='22023',message='invalid_error'; end if;
    perform public.email_ingestion_evidence_v2(v->'attempt_evidence','failure');
  when 'takeover' then
    perform public.email_ingestion_keys_v2(v,array['recovery']); perform public.email_ingestion_recovery_v2(v->'recovery');
  when 'restart' then
    names:=array['reason_code','recovery'];
    if stream='recent' and v ? 'fetch_policy' then
      names:=names||array['fetch_policy'];
      if not coalesce(v->>'fetch_policy'=any(array['missing_only','refetch_all']),false) then raise exception using errcode='22023',message='invalid_fetch_policy'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names); perform public.email_ingestion_recovery_v2(v->'recovery');
    if not coalesce(v->>'reason_code'=any(array['operator_restart','history_expired','continuation_expired']),false) then raise exception using errcode='22023',message='invalid_restart'; end if;
  else raise exception using errcode='22023',message='invalid_operation';
  end case;
end $function$
;
create or replace function public.learn_email_job_fail(p_tenant uuid,p_job uuid,p_attempt uuid,p_claimed_by text,p_claim integer) returns jsonb
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
 code:=case when r.error_message=any(array['history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure','sa_config_missing','sa_credentials_invalid','admin_delegation_missing','scopes_missing','delegation_grant_invalid','delegation_denied']) then r.error_message else 'capture_failed' end;
 answer:=jsonb_build_object('version','learn-email-job-failure/1','disposition','applied','job_id',j.id,'attempt_id',r.id,'code',code);
 receipt:=jsonb_build_object('version','learn-email-job-failure/1','attempt_id',r.id,'claimed_by',p_claimed_by,'claim',p_claim,'answer',answer);
 update public.platform_jobs set status='dead_letter',completed_at=clock_timestamp(),lease_expires_at=null,error_code=code,
  result=jsonb_build_object('sync_run_id',r.id,'error_code',code),metadata=coalesce(metadata,'{}')||jsonb_build_object('learn_email_failure_v1',receipt) where id=j.id;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 return answer;
end $$;
commit;
