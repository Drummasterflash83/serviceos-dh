-- Reliability Phase 3: commit the local representation of an external result atomically.

create or replace function automation_finalize_execution(
  p_tenant_id uuid, p_intent_id uuid, p_inflight_attempt_id uuid, p_worker text,
  p_to_state text, p_result jsonb, p_error_code text, p_attempt_status text,
  p_retryable boolean, p_retry_at timestamptz, p_external_reference text,
  p_response_class text, p_outcome_type text, p_outcome_layer text,
  p_correlation_id uuid, p_job_id uuid
) returns table (execution_attempt_id uuid, outcome_id uuid, event_id uuid)
language plpgsql as $$
declare v_intent automation_intents%rowtype; v_inflight automation_execution_attempts%rowtype;
  v_attempt uuid; v_outcome uuid; v_event uuid; v_hash text; v_event_type text;
begin
  select * into v_intent from automation_intents
    where id=p_intent_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'intent not found' using errcode='no_data_found'; end if;
  if v_intent.status <> 'executing' then
    -- Idempotent response-loss recovery: the first call may have committed even when its
    -- client lost the response. Return that already-committed unit instead of failing.
    select id into v_attempt from automation_execution_attempts
      where tenant_id=p_tenant_id and automation_intent_id=p_intent_id
        and previous_attempt_id=p_inflight_attempt_id order by created_at desc limit 1;
    if v_attempt is not null then
      select id into v_outcome from outcomes where tenant_id=p_tenant_id
        and automation_intent_id=p_intent_id and execution_attempt_id=v_attempt limit 1;
      select id into v_event from platform_events where tenant_id=p_tenant_id
        and subject_type='automation_intent' and subject_id=p_intent_id
        and event_type like 'automation.execution.%' order by created_at desc limit 1;
      execution_attempt_id:=v_attempt; outcome_id:=v_outcome; event_id:=v_event; return next; return;
    end if;
    raise exception 'intent is not executing' using errcode='restrict_violation';
  end if;
  select * into v_inflight from automation_execution_attempts
    where id=p_inflight_attempt_id and tenant_id=p_tenant_id
      and automation_intent_id=p_intent_id and status='in_flight';
  if not found then raise exception 'in-flight attempt not found' using errcode='no_data_found'; end if;

  v_hash:=encode(extensions.digest(v_intent.parameters::text,'sha256'),'hex');
  if v_intent.approved_payload_hash is not null and v_hash <> v_intent.approved_payload_hash then
    raise exception 'approved payload integrity mismatch' using errcode='data_exception';
  end if;

  insert into automation_execution_attempts
    (tenant_id,automation_intent_id,action_object_id,connector_id,capability_key,
     operation_type,idempotency_key,attempt_number,worker,started_at,completed_at,status,
     request_fingerprint,request_snapshot,external_reference,response_class,result,error_code,
     error_class,retryable,retry_at,correlation_id,previous_attempt_id,execution_engine_version,
     execution_payload_hash)
  values
    (p_tenant_id,p_intent_id,v_intent.action_object_id,v_intent.connector_id,v_intent.capability_key,
     v_intent.intent_type,v_inflight.idempotency_key,v_inflight.attempt_number,p_worker,
     v_inflight.started_at,now(),p_attempt_status,v_inflight.idempotency_key,v_intent.parameters,
     p_external_reference,p_response_class,p_result,p_error_code,
     case when p_attempt_status like 'failed%' then p_attempt_status end,p_retryable,p_retry_at,
     coalesce(p_correlation_id,v_intent.correlation_id),p_inflight_attempt_id,v_intent.execution_version,v_hash)
  returning id into v_attempt;

  update automation_intents set status=p_to_state,decided_at=now(),last_error=p_error_code,
    result=p_result,lease_expires_at=null
  where id=p_intent_id and tenant_id=p_tenant_id and status='executing';
  if not found then raise exception 'intent transition lost' using errcode='serialization_failure'; end if;

  if p_to_state='succeeded' and p_outcome_type is not null then
    insert into outcomes(tenant_id,action_object_id,automation_intent_id,execution_attempt_id,
      outcome_type,outcome_layer,status,observed_at,evidence,confidence,source,external_reference,
      correlation_id,source_kind,source_ref,verification_state,verified_at,verified_by)
    values(p_tenant_id,v_intent.action_object_id,p_intent_id,v_attempt,p_outcome_type,p_outcome_layer,
      'observed',now(),jsonb_build_array(jsonb_build_object('execution_attempt_id',v_attempt)),1,
      'automation.execute',p_external_reference,coalesce(p_correlation_id,v_intent.correlation_id),
      'automation_execution',v_attempt::text,'system_observed',now(),'automation.execute')
    returning id into v_outcome;
  end if;

  v_event_type:=case p_to_state when 'succeeded' then 'automation.execution.succeeded'
    when 'unknown' then 'automation.execution.unknown' else 'automation.execution.failed' end;
  insert into platform_events(tenant_id,event_type,subject_type,subject_id,source,status,payload,
    metadata,actor,occurred_at,domain,correlation_id)
  values(p_tenant_id,v_event_type,'automation_intent',p_intent_id,'automation.execute','pending',
    jsonb_build_object('attempt',v_inflight.attempt_number,'execution_attempt_id',v_attempt,
      'external_reference',p_external_reference,'error_code',p_error_code),
    jsonb_build_object('job_id',p_job_id),jsonb_build_object('kind','automation','ref','automation.execute'),
    now(),'core',coalesce(p_correlation_id,v_intent.correlation_id))
  on conflict do nothing returning id into v_event;

  if p_retry_at is not null then
    insert into platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,
      max_attempts,available_at,payload)
    values(p_tenant_id,'openfolk-core','core.automation','automation.execute',
      'automation.execute:'||p_tenant_id::text||':'||p_intent_id::text,'queued',100,5,p_retry_at,
      jsonb_build_object('automation_intent_id',p_intent_id,'triggered_by','retry',
        'correlation_id',coalesce(p_correlation_id,v_intent.correlation_id)))
    on conflict do nothing;
  end if;

  execution_attempt_id:=v_attempt; outcome_id:=v_outcome; event_id:=v_event; return next;
end $$;

revoke all on function automation_finalize_execution(uuid,uuid,uuid,text,text,jsonb,text,text,boolean,timestamptz,text,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function automation_finalize_execution(uuid,uuid,uuid,text,text,jsonb,text,text,boolean,timestamptz,text,text,text,text,uuid,uuid) to service_role;

-- Integrity is checked before the adapter is called. The in-flight fact captures the exact
-- payload/hash under the same row lock that claims the intent.
create or replace function automation_claim_and_start(
  p_intent_id uuid, p_tenant_id uuid, p_worker text, p_lease_seconds int,
  p_idempotency_key text, p_correlation_id uuid, p_engine_version text
) returns table (attempt_id uuid, attempt_number int) language plpgsql as $$
declare v automation_intents%rowtype; v_next int; v_id uuid; v_hash text; v_corr uuid;
begin
  select * into v from automation_intents where id=p_intent_id and tenant_id=p_tenant_id for update;
  if not found or v.status not in ('pending','failed') then return; end if;
  if v.lease_expires_at is not null and v.lease_expires_at>now() then return; end if;
  if v.expires_at is not null and v.expires_at<now() then return; end if;
  if v.attempts>=v.max_attempts then return; end if;
  v_hash:=encode(extensions.digest(v.parameters::text,'sha256'),'hex');
  if v.approved_payload_hash is not null and v_hash<>v.approved_payload_hash then
    raise exception 'approved payload integrity mismatch' using errcode='data_exception';
  end if;
  v_corr:=coalesce(p_correlation_id,v.correlation_id,gen_random_uuid());
  v_next:=v.attempts+1;
  update automation_intents set status='executing',attempts=v_next,
    lease_expires_at=now()+make_interval(secs=>greatest(p_lease_seconds,1)),claimed_by=p_worker,
    claimed_at=now(),idempotency_key=coalesce(idempotency_key,p_idempotency_key),
    correlation_id=v_corr,execution_version=p_engine_version,decided_at=now()
  where id=p_intent_id;
  insert into automation_execution_attempts(tenant_id,automation_intent_id,action_object_id,
    connector_id,capability_key,operation_type,idempotency_key,attempt_number,worker,status,
    request_fingerprint,request_snapshot,correlation_id,execution_engine_version,execution_payload_hash)
  values(v.tenant_id,v.id,v.action_object_id,v.connector_id,v.capability_key,v.intent_type,
    p_idempotency_key,v_next,p_worker,'in_flight',p_idempotency_key,v.parameters,v_corr,
    p_engine_version,v_hash) returning id into v_id;
  attempt_id:=v_id; attempt_number:=v_next; return next;
end $$;

-- A worker can die after the provider call but before finalisation. Once its lease expires,
-- park the intent as unknown and create review evidence atomically; never execute it again.
create or replace function automation_recover_expired_execution(
  p_tenant_id uuid, p_intent_id uuid, p_job_id uuid
) returns boolean language plpgsql as $$
declare v automation_intents%rowtype; v_corr uuid;
begin
  select * into v from automation_intents where id=p_intent_id and tenant_id=p_tenant_id for update;
  if not found or v.status<>'executing' or v.lease_expires_at is null or v.lease_expires_at>=now() then
    return false;
  end if;
  v_corr:=coalesce(v.correlation_id,gen_random_uuid());
  update automation_intents set status='unknown',lease_expires_at=null,last_error='execution_lease_expired',
    decided_at=now(),correlation_id=v_corr where id=p_intent_id;
  insert into platform_events(tenant_id,event_type,subject_type,subject_id,source,status,payload,
    metadata,actor,occurred_at,domain,correlation_id)
  values(p_tenant_id,'automation.execution.unknown','automation_intent',p_intent_id,
    'automation.recovery','pending',jsonb_build_object('reason','execution_lease_expired'),
    jsonb_build_object('job_id',p_job_id),jsonb_build_object('kind','automation','ref','automation.recovery'),
    now(),'core',v_corr) on conflict do nothing;
  if not exists(select 1 from review_tasks where tenant_id=p_tenant_id and object_id=v.action_object_id
      and status='pending' and reason='automation execution result unknown — reconcile before any retry') then
    insert into review_tasks(tenant_id,object_id,route,reason,decision_id)
    values(p_tenant_id,v.action_object_id,'openfolk',
      'automation execution result unknown — reconcile before any retry',v.decision_id);
  end if;
  return true;
end $$;

revoke all on function automation_recover_expired_execution(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function automation_recover_expired_execution(uuid,uuid,uuid) to service_role;
