CREATE OR REPLACE FUNCTION public.learn_processing_settle(p_tenant uuid, p_job uuid, p_worker text, p_attempt integer, p_request uuid, p_definition jsonb, p_phase text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET "TimeZone" TO 'UTC'
AS $function$
#variable_conflict use_column
declare j public.platform_jobs%rowtype;s public.learn_processing_settlements%rowtype;child public.platform_jobs%rowtype;
 success boolean;continued boolean;retry boolean;outcome text;error_code text;records integer;actual integer;delay integer;limit_n integer;source text;key text;payload jsonb;r jsonb;
 allowed_keys text[];entry record;at_time timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_request is null or p_job is null or p_tenant is null
  or p_worker is null or length(p_worker) not between 1 and 200 or p_attempt is null or p_attempt<1 or p_phase is null or p_phase not in('settle','inspect')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>8000
  or not p_definition?&array['success','records_processed','result','continue','retryable','error_code']
  or p_definition-array['success','records_processed','result','continue','retryable','error_code']<>'{}'::jsonb
  or jsonb_typeof(p_definition->'success') is distinct from 'boolean' or jsonb_typeof(p_definition->'continue') is distinct from 'boolean'
  or jsonb_typeof(p_definition->'retryable') is distinct from 'boolean' or jsonb_typeof(p_definition->'result') is distinct from 'object'
  or jsonb_typeof(p_definition->'records_processed') is distinct from 'number' or coalesce(p_definition->>'records_processed','')!~'^[0-9]{1,6}$'
  or (p_definition->'error_code'<>'null'::jsonb and (jsonb_typeof(p_definition->'error_code') is distinct from 'string' or coalesce(p_definition->>'error_code','')!~'^[a-z_]{1,80}$'))
 then raise exception 'processing_settlement_invalid' using errcode='22023';end if;
 success:=(p_definition->>'success')::boolean;continued:=(p_definition->>'continue')::boolean;records:=(p_definition->>'records_processed')::integer;error_code:=p_definition->>'error_code';
 if (success and (error_code is not null or (p_definition->>'retryable')::boolean)) or (not success and (error_code is null or continued))
  or (continued and (records=0 or p_definition->'result'->'continued' is distinct from 'true'::jsonb))
 then raise exception 'processing_settlement_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-processing-settle:'||p_job::text,0));
 select * into s from public.learn_processing_settlements where request_id=p_request;
 if found then
  if s.tenant_id<>p_tenant or s.job_id<>p_job or s.attempt<>p_attempt or s.worker<>p_worker or s.definition<>p_definition then raise exception 'processing_settlement_conflict' using errcode='PT409';end if;
  return s.receipt;
 end if;
 if p_phase='inspect' then raise exception 'processing_receipt_missing' using errcode='PT409';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_worker or j.attempt_count<>p_attempt or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
  or j.job_type not in('identity.resolve','interactions.sync') then raise exception 'processing_claim_lost' using errcode='PT409';end if;
 allowed_keys:=case j.job_type when 'identity.resolve' then array['resolved','cards_enriched','people_created','companies_created','recommendations','suggestions_created','events_consumed','review_required','failed','continued']
  else array['phone_selected','phone_created','phone_updated','phone_skipped','email_selected','email_created','email_updated','interactions_upserted','phone_processed','email_processed','skipped','review_required','failed','continued'] end;
 for entry in select * from jsonb_each(p_definition->'result') loop
  if not entry.key=any(allowed_keys) or (entry.key='continued' and jsonb_typeof(entry.value)<>'boolean')
   or (entry.key<>'continued' and (jsonb_typeof(entry.value)<>'number' or entry.value::text!~'^[0-9]{1,6}$')) then raise exception 'processing_result_invalid' using errcode='22023';end if;
 end loop;
 if success and (coalesce((p_definition->'result'->>'failed')::integer,0)>0 or coalesce((p_definition->'result'->>'review_required')::integer,0)>0)
 then raise exception 'processing_success_unconfirmed' using errcode='PT409';end if;
 select count(*) into actual from public.learn_processing_publications where tenant_id=p_tenant and job_id=p_job and attempt=p_attempt and worker=p_worker and receipt->>'state'='committed'
  and case when j.job_type='identity.resolve' then receipt->'cardEnriched'='true'::jsonb else receipt->>'action'<>'unchanged' end;
 if records>actual or (success and records<>actual) then raise exception 'processing_count_unconfirmed' using errcode='PT409';end if;
 at_time:=clock_timestamp();retry:=not success and (p_definition->>'retryable')::boolean and p_attempt<j.max_attempts;
 outcome:=case when success then 'succeeded' when retry then 'retrying' else 'dead_letter' end;
 delay:=case p_attempt when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end;
 update public.platform_jobs set status=outcome,result=p_definition->'result',records_processed=records,lease_expires_at=null,
  completed_at=case when success then at_time else null end,failed_at=case when outcome='dead_letter' then at_time else null end,
  dead_lettered_at=case when outcome='dead_letter' then at_time else null end,error_code=p_definition->>'error_code',
  last_error=case when success then null else 'Retained-input processing requires retry or operator review. See the recorded error code and source receipts.' end,
  error_count=case when success then 0 else p_attempt end,
  available_at=case when retry then at_time+make_interval(secs=>delay) else available_at end,
  next_run_at=case when retry then at_time+make_interval(secs=>delay) else next_run_at end
 where tenant_id=p_tenant and id=p_job;
 if continued then
  limit_n:=case when coalesce(j.payload->>'limit','')~'^[0-9]{1,6}$' then greatest(1,least(50,(j.payload->>'limit')::integer)) else 20 end;
  source:=coalesce(j.payload->>'source','all');
  if j.job_type='interactions.sync' and source not in('all','phone','email') then raise exception 'processing_source_mismatch' using errcode='PT409';end if;
  key:=case j.job_type when 'identity.resolve' then 'identity.resolve:'||p_tenant::text else 'interactions.sync:'||p_tenant::text||':'||source end;
  payload:=jsonb_build_object('limit',limit_n)||case j.job_type when 'interactions.sync' then jsonb_build_object('source',source) else '{}'::jsonb end;
  insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,available_at,parent_job_id,payload)
   values(p_tenant,'openfolk-core',case j.job_type when 'identity.resolve' then 'core.identity' else 'core.interactions' end,j.job_type,key,'queued',50,j.max_attempts,at_time,p_job,payload)
   on conflict(tenant_id,job_key) where job_key is not null and status in('queued','running','retrying') do nothing returning * into child;
  if child.id is null then select * into child from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in('queued','running','retrying') for share;end if;
  if child.id is null or child.job_type<>j.job_type or (j.job_type='interactions.sync' and coalesce(child.payload->>'source','all')<>source)
  then raise exception 'processing_continuation_unconfirmed' using errcode='PT409';end if;
 end if;
 r:=jsonb_build_object('version','learn-processing-settlement/1','tenant_id',p_tenant,'job_id',p_job,'attempt',p_attempt,'worker',p_worker,'request_id',p_request,
  'job_type',j.job_type,'state',outcome,'continuation_job_id',child.id,'records_processed',records,'publications_committed',actual,'settled_at',at_time);
 insert into public.learn_processing_settlements(request_id,tenant_id,job_id,attempt,worker,definition,receipt) values(p_request,p_tenant,p_job,p_attempt,p_worker,p_definition,r);
 return r;
end$function$
