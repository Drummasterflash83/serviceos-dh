-- Reliability hardening (enterprise-grade Intelligence → Approval → Automation vertical).
-- No new capabilities/channels/products — only makes the EXISTING execution path trustworthy:
--   P0-1 the claim RPC returns the exact immutable execution envelope; the adapter runs only it.
--   P0-2 retries get a per-attempt job key so they never collide with the running job.
--   P0-3 one atomic mechanism for unknown-result resolution (parity with claim/finalize/recover).
--   P0-4 no executable capability without a registered outcome contract.
--   P1-5 the integrity hash binds the FULL envelope (tenant, intent, decision, capability,
--        connector, parameters, schema version, adapter version, approval snapshot).
-- All additive/idempotent; nothing is seeded for a real tenant beyond the global registries.

-- ── Registries ────────────────────────────────────────────────────────────────
insert into automation_reason_codes (code, category) values
  ('outcome_contract_missing','contract')
on conflict (code) do nothing;

-- Outcome type for the reply-draft capability (operational; system-observed, never business).
insert into outcome_types (outcome_type, layer, description) values
  ('reply_draft_recorded','operational','A customer reply draft artifact was recorded (no transmission)')
on conflict (outcome_type) do nothing;

-- P0-4 + P1-5: the capability EXECUTION CONTRACT. A capability is executable ONLY if it has an
-- enabled row here: it names the outcome the execution must record AND the adapter version the
-- envelope hash binds. Adding a capability is a deliberate, reviewed registry change.
create table if not exists automation_capability_contracts (
  capability_key  text primary key references automation_connector_capabilities(capability_key),
  outcome_type    text not null references outcome_types(outcome_type),
  outcome_layer   text not null references outcome_layers(layer),
  adapter_version text not null default '1',
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
insert into automation_capability_contracts (capability_key, outcome_type, outcome_layer, adapter_version) values
  ('internal.record_execution','controlled_execution_recorded','operational','1'),
  ('internal.create_note','internal_note_recorded','operational','1'),
  ('email.reply_draft','reply_draft_recorded','operational','1')
on conflict (capability_key) do nothing;

alter table automation_capability_contracts enable row level security;
drop policy if exists automation_capability_contracts_select on automation_capability_contracts;
create policy automation_capability_contracts_select on automation_capability_contracts
  for select to authenticated using (true);

-- Attempts record which adapter version actually ran (audit of the executed envelope).
alter table automation_execution_attempts add column if not exists adapter_version text;

-- ── P1-5: the canonical envelope hash ─────────────────────────────────────────
-- Deterministic sha256 over the WHOLE execution envelope. jsonb canonicalises key order, so
-- the digest is stable across callers. Any change to any bound field invalidates the hash.
create or replace function automation_envelope_hash(
  p_tenant uuid, p_intent uuid, p_decision uuid, p_capability text, p_connector text,
  p_parameters jsonb, p_schema_version text, p_adapter_version text, p_snapshot uuid
) returns text language sql immutable as $$
  select encode(extensions.digest(
    jsonb_build_object(
      'tenant', p_tenant, 'intent', p_intent, 'decision', p_decision,
      'capability', p_capability, 'connector', p_connector,
      'parameters', coalesce(p_parameters,'{}'::jsonb),
      'schema_version', p_schema_version, 'adapter_version', p_adapter_version,
      'approval_snapshot', p_snapshot
    )::text, 'sha256'), 'hex');
$$;

-- The envelope hash of an intent AS IT STANDS (its frozen parameters + registered adapter +
-- its approval snapshot). Claim and finalise both call this so they can never diverge from
-- what approval bound. Returns null adapter/snapshot fields where none apply.
create or replace function automation_intent_envelope_hash(p_tenant uuid, p_intent uuid)
returns text language sql stable as $$
  select automation_envelope_hash(
    i.tenant_id, i.id, i.decision_id, i.capability_key, i.connector_id, i.parameters,
    coalesce(i.schema_version, it.schema_version),
    cc.adapter_version,
    s.id)
  from automation_intents i
  left join automation_intent_types it on it.intent_type = i.intent_type
  left join automation_capability_contracts cc on cc.capability_key = i.capability_key and cc.enabled
  left join response_approval_snapshots s on s.automation_intent_id = i.id and s.tenant_id = i.tenant_id
  where i.id = p_intent and i.tenant_id = p_tenant;
$$;

-- ── P1-5: approval binds the FULL envelope hash (was sha256(parameters) only) ──
create or replace function approve_response_intent_atomic(
  p_tenant_id uuid, p_intent_id uuid, p_approver_ref text, p_approver_kind text,
  p_authority_basis text, p_decision text, p_evidence jsonb, p_now timestamptz
) returns table (snapshot_id uuid, approval_id uuid, approved_payload_hash text)
language plpgsql as $$
declare v_intent automation_intents%rowtype; v_proposal response_proposals%rowtype;
  v_revision response_revisions%rowtype; v_body text; v_source text; v_provenance jsonb;
  v_params jsonb; v_hash text; v_snapshot uuid; v_approval uuid; v_corr uuid;
  v_adapter text; v_schema text;
begin
  select * into v_intent from automation_intents where id=p_intent_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'intent_not_found' using errcode='no_data_found'; end if;
  if v_intent.status <> 'pending' then raise exception 'intent_not_pending' using errcode='restrict_violation'; end if;
  if exists(select 1 from automation_approvals where tenant_id=p_tenant_id and automation_intent_id=p_intent_id) then
    raise exception 'already_decided' using errcode='unique_violation';
  end if;
  if exists(select 1 from response_approval_snapshots where tenant_id=p_tenant_id and automation_intent_id=p_intent_id) then
    raise exception 'already_decided' using errcode='unique_violation';
  end if;
  select * into v_proposal from response_proposals where tenant_id=p_tenant_id and automation_intent_id=p_intent_id;
  if not found then raise exception 'proposal_not_found' using errcode='no_data_found'; end if;

  -- P0-4: a capability with no enabled contract cannot be approved (⇒ cannot execute).
  select acc.adapter_version into v_adapter
  from automation_capability_contracts acc
  where acc.capability_key=v_intent.capability_key and acc.enabled;
  if v_adapter is null then raise exception 'capability_contract_missing' using errcode='restrict_violation'; end if;
  select ait.schema_version into v_schema from automation_intent_types ait where ait.intent_type=v_intent.intent_type;
  v_schema := coalesce(v_intent.schema_version, v_schema);

  select * into v_revision from response_revisions where tenant_id=p_tenant_id and automation_intent_id=p_intent_id order by revision_number desc limit 1;
  v_body := coalesce(v_revision.revised_body, v_proposal.original_body);
  v_source := case when v_revision.id is null then 'ai_proposal' else 'revision' end;
  v_provenance := v_proposal.provenance || case when v_revision.id is null then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('kind','human_revision','ref',v_revision.id::text)) end;
  v_params := v_intent.parameters || jsonb_build_object('body',v_body,'note',v_body,'response_provenance',v_provenance);
  v_corr := coalesce(v_intent.correlation_id, gen_random_uuid());

  -- Snapshot id is generated first so it can be bound INTO the envelope hash.
  v_snapshot := gen_random_uuid();
  v_hash := automation_envelope_hash(
    v_intent.tenant_id, v_intent.id, v_intent.decision_id, v_intent.capability_key,
    v_intent.connector_id, v_params, v_schema, v_adapter, v_snapshot);

  update automation_intents set parameters=v_params, approved_payload_hash=v_hash, correlation_id=v_corr
    where id=p_intent_id;
  insert into response_approval_snapshots(id, tenant_id, automation_intent_id, response_proposal_id,
    approved_revision_id, source, approved_body, provenance, draft_version, approver_ref, approver_kind,
    approved_at, approved_payload_hash)
  values(v_snapshot, p_tenant_id, p_intent_id, v_proposal.id, v_revision.id, v_source, v_body, v_provenance,
    v_proposal.draft_version, p_approver_ref, p_approver_kind, p_now, v_hash);
  insert into automation_approvals(tenant_id, automation_intent_id, decision_id, approver_kind, approver_ref,
    authority_basis, decision, granted_at, evidence, correlation_id)
  values(p_tenant_id, p_intent_id, v_intent.decision_id, p_approver_kind, p_approver_ref, p_authority_basis,
    p_decision, p_now,
    coalesce(p_evidence,'{}'::jsonb) || jsonb_build_object(
      'response_approval_snapshot_id', v_snapshot, 'approved_payload_hash', v_hash,
      'approved_envelope', true),
    v_corr) returning id into v_approval;

  snapshot_id:=v_snapshot; approval_id:=v_approval; approved_payload_hash:=v_hash; return next;
end $$;

-- ── P0-1 + P1-5: claim returns the exact immutable envelope; verifies the full hash ──
-- The return type changes (adds the envelope), so drop+recreate the specific signature.
drop function if exists automation_claim_and_start(uuid,uuid,text,int,text,uuid,text);
create function automation_claim_and_start(
  p_intent_id uuid, p_tenant_id uuid, p_worker text, p_lease_seconds int,
  p_idempotency_key text, p_correlation_id uuid, p_engine_version text
) returns table (
  attempt_id uuid, attempt_number int,
  envelope_parameters jsonb, capability_key text, connector_id text, intent_type text,
  action_object_id uuid, decision_id uuid, schema_version text, adapter_version text, envelope_hash text
) language plpgsql as $$
declare v automation_intents%rowtype; v_next int; v_id uuid; v_hash text; v_corr uuid;
  v_adapter text; v_schema text;
begin
  select * into v from automation_intents where id=p_intent_id and tenant_id=p_tenant_id for update;
  if not found or v.status not in ('pending','failed') then return; end if;
  if v.lease_expires_at is not null and v.lease_expires_at>now() then return; end if;
  if v.expires_at is not null and v.expires_at<now() then return; end if;
  if v.attempts>=v.max_attempts then return; end if;

  -- P0-4: a capability with no enabled contract can never be claimed for execution.
  select acc.adapter_version into v_adapter
  from automation_capability_contracts acc
  where acc.capability_key=v.capability_key and acc.enabled;
  if v.capability_key is not null and v_adapter is null then
    raise exception 'capability_contract_missing' using errcode='restrict_violation';
  end if;
  select ait.schema_version into v_schema from automation_intent_types ait where ait.intent_type=v.intent_type;
  v_schema := coalesce(v.schema_version, v_schema);

  -- P1-5: recompute the FULL envelope hash and refuse if the approved envelope was altered.
  v_hash := automation_intent_envelope_hash(p_tenant_id, p_intent_id);
  if v.approved_payload_hash is not null and v_hash <> v.approved_payload_hash then
    raise exception 'approved payload integrity mismatch' using errcode='data_exception';
  end if;

  v_corr := coalesce(p_correlation_id, v.correlation_id, gen_random_uuid());
  v_next := v.attempts + 1;
  update automation_intents set status='executing', attempts=v_next,
    lease_expires_at=now()+make_interval(secs=>greatest(p_lease_seconds,1)), claimed_by=p_worker,
    claimed_at=now(), idempotency_key=coalesce(idempotency_key,p_idempotency_key),
    correlation_id=v_corr, execution_version=p_engine_version, decided_at=now()
  where id=p_intent_id;
  insert into automation_execution_attempts(tenant_id, automation_intent_id, action_object_id,
    connector_id, capability_key, operation_type, idempotency_key, attempt_number, worker, status,
    request_fingerprint, request_snapshot, correlation_id, execution_engine_version,
    execution_payload_hash, adapter_version)
  values(v.tenant_id, v.id, v.action_object_id, v.connector_id, v.capability_key, v.intent_type,
    p_idempotency_key, v_next, p_worker, 'in_flight', p_idempotency_key, v.parameters, v_corr,
    p_engine_version, v_hash, v_adapter) returning id into v_id;

  -- P0-1: RETURN the exact claimed envelope. The executor passes THIS to the adapter — it
  -- never re-reads the intent — so the executed payload is provably the hashed/approved one.
  attempt_id:=v_id; attempt_number:=v_next;
  envelope_parameters:=v.parameters; capability_key:=v.capability_key; connector_id:=v.connector_id;
  intent_type:=v.intent_type; action_object_id:=v.action_object_id; decision_id:=v.decision_id;
  schema_version:=v_schema; adapter_version:=v_adapter; envelope_hash:=v_hash;
  return next;
end $$;

-- ── P1-5: finalise verifies the full envelope hash + records adapter version ──
-- ── P0-2: the retry job key is per-attempt, so it never collides with the running job. ──
create or replace function automation_finalize_execution(
  p_tenant_id uuid, p_intent_id uuid, p_inflight_attempt_id uuid, p_worker text,
  p_to_state text, p_result jsonb, p_error_code text, p_attempt_status text,
  p_retryable boolean, p_retry_at timestamptz, p_external_reference text,
  p_response_class text, p_outcome_type text, p_outcome_layer text,
  p_correlation_id uuid, p_job_id uuid
) returns table (execution_attempt_id uuid, outcome_id uuid, event_id uuid)
language plpgsql as $$
declare v_intent automation_intents%rowtype; v_inflight automation_execution_attempts%rowtype;
  v_attempt uuid; v_outcome uuid; v_event uuid; v_hash text; v_event_type text; v_adapter text;
begin
  select * into v_intent from automation_intents
    where id=p_intent_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'intent not found' using errcode='no_data_found'; end if;
  if v_intent.status <> 'executing' then
    -- Idempotent response-loss recovery: return the already-committed unit if it exists.
    select id into v_attempt from automation_execution_attempts
      where tenant_id=p_tenant_id and automation_intent_id=p_intent_id
        and previous_attempt_id=p_inflight_attempt_id order by created_at desc limit 1;
    if v_attempt is not null then
      select o.id into v_outcome from outcomes o
        where o.tenant_id=p_tenant_id
        and o.automation_intent_id=p_intent_id
        and o.execution_attempt_id=v_attempt limit 1;
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

  v_hash := automation_intent_envelope_hash(p_tenant_id, p_intent_id);
  if v_intent.approved_payload_hash is not null and v_hash <> v_intent.approved_payload_hash then
    raise exception 'approved payload integrity mismatch' using errcode='data_exception';
  end if;
  select acc.adapter_version into v_adapter
  from automation_capability_contracts acc
  where acc.capability_key=v_intent.capability_key and acc.enabled;

  insert into automation_execution_attempts
    (tenant_id,automation_intent_id,action_object_id,connector_id,capability_key,
     operation_type,idempotency_key,attempt_number,worker,started_at,completed_at,status,
     request_fingerprint,request_snapshot,external_reference,response_class,result,error_code,
     error_class,retryable,retry_at,correlation_id,previous_attempt_id,execution_engine_version,
     execution_payload_hash,adapter_version)
  values
    (p_tenant_id,p_intent_id,v_intent.action_object_id,v_intent.connector_id,v_intent.capability_key,
     v_intent.intent_type,v_inflight.idempotency_key,v_inflight.attempt_number,p_worker,
     v_inflight.started_at,now(),p_attempt_status,v_inflight.idempotency_key,v_intent.parameters,
     p_external_reference,p_response_class,p_result,p_error_code,
     case when p_attempt_status like 'failed%' then p_attempt_status end,p_retryable,p_retry_at,
     coalesce(p_correlation_id,v_intent.correlation_id),p_inflight_attempt_id,v_intent.execution_version,
     v_hash,v_adapter)
  returning id into v_attempt;

  update automation_intents set status=p_to_state,decided_at=now(),last_error=p_error_code,
    result=p_result,lease_expires_at=null
  where id=p_intent_id and tenant_id=p_tenant_id and status='executing';
  if not found then raise exception 'intent transition lost' using errcode='serialization_failure'; end if;

  if p_to_state='succeeded' and p_outcome_type is not null then
    insert into outcomes(tenant_id,action_object_id,automation_intent_id,execution_attempt_id,
      outcome_type,outcome_layer,status,observed_at,evidence,confidence,source,external_reference,
      correlation_id,source_kind,source_record_id,verification_state)
    values(p_tenant_id,v_intent.action_object_id,p_intent_id,v_attempt,p_outcome_type,p_outcome_layer,
      'observed',now(),jsonb_build_array(jsonb_build_object('execution_attempt_id',v_attempt)),1,
      'automation.execute',p_external_reference,coalesce(p_correlation_id,v_intent.correlation_id),
      'automation_execution',v_attempt,'system_observed')
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

  -- P0-2: a PER-ATTEMPT retry key. The running base job (…:{intent}) is still active while
  -- this commits, so a same-key insert would be swallowed by the active-job unique index and
  -- the retry would vanish. A distinct …:retry:{attempt} key is always insertable and stays
  -- claimable; the intent claim RPC still guarantees single execution.
  if p_retry_at is not null then
    insert into platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,
      max_attempts,available_at,payload)
    values(p_tenant_id,'openfolk-core','core.automation','automation.execute',
      'automation.execute:'||p_tenant_id::text||':'||p_intent_id::text||':retry:'||v_inflight.attempt_number::text,
      'queued',100,5,p_retry_at,
      jsonb_build_object('automation_intent_id',p_intent_id,'triggered_by','retry',
        'correlation_id',coalesce(p_correlation_id,v_intent.correlation_id)))
    on conflict do nothing;
  end if;

  execution_attempt_id:=v_attempt; outcome_id:=v_outcome; event_id:=v_event; return next;
end $$;

-- ── P0-3: ONE atomic mechanism for unknown-result resolution ──────────────────
-- A lost-response intent parked as `unknown` is reconciled in a single transaction: append the
-- superseding attempt, transition unknown→(succeeded|failed) or keep it unknown and route to
-- review — atomically, under the intent row lock. Mirrors finalise/recover so no recovery path
-- mutates lifecycle through scattered statements.
create or replace function automation_resolve_unknown_execution(
  p_tenant_id uuid, p_intent_id uuid, p_to_state text, p_result jsonb, p_error_code text,
  p_attempt_status text, p_external_reference text, p_response_class text,
  p_outcome_type text, p_outcome_layer text, p_correlation_id uuid, p_job_id uuid
) returns table (execution_attempt_id uuid, outcome_id uuid, event_id uuid, resolution text)
language plpgsql as $$
declare v_intent automation_intents%rowtype; v_prev automation_execution_attempts%rowtype;
  v_attempt uuid; v_outcome uuid; v_event uuid; v_corr uuid; v_event_type text; v_adapter text;
begin
  select * into v_intent from automation_intents where id=p_intent_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'intent not found' using errcode='no_data_found'; end if;
  if v_intent.status <> 'unknown' then raise exception 'intent is not unknown' using errcode='restrict_violation'; end if;
  v_corr := coalesce(p_correlation_id, v_intent.correlation_id, gen_random_uuid());
  select * into v_prev from automation_execution_attempts
    where tenant_id=p_tenant_id and automation_intent_id=p_intent_id order by started_at desc limit 1;
  select acc.adapter_version into v_adapter
  from automation_capability_contracts acc
  where acc.capability_key=v_intent.capability_key and acc.enabled;

  -- Still unknown ⇒ route to human review (idempotent) and stay unknown. One committed unit.
  if p_to_state = 'unknown' or p_to_state is null then
    if v_intent.action_object_id is not null and not exists(
        select 1 from review_tasks where tenant_id=p_tenant_id and object_id=v_intent.action_object_id
          and status='pending' and reason='automation execution result unknown — reconcile before any retry') then
      insert into review_tasks(tenant_id,object_id,route,reason,decision_id)
      values(p_tenant_id,v_intent.action_object_id,'openfolk',
        'automation execution result unknown — reconcile before any retry',v_intent.decision_id);
    end if;
    resolution:='routed_to_review'; return next; return;
  end if;

  -- Resolved ⇒ append the superseding attempt, transition, and (on success) the outcome.
  insert into automation_execution_attempts
    (tenant_id,automation_intent_id,action_object_id,connector_id,capability_key,operation_type,
     idempotency_key,attempt_number,worker,started_at,completed_at,status,response_class,
     external_reference,result,error_code,retryable,correlation_id,previous_attempt_id,
     execution_engine_version,execution_payload_hash,adapter_version)
  values
    (p_tenant_id,p_intent_id,v_intent.action_object_id,v_intent.connector_id,v_intent.capability_key,
     v_intent.intent_type,coalesce(v_intent.idempotency_key,''),coalesce(v_intent.attempts,1),
     'unknown_resolve',now(),now(),p_attempt_status,p_response_class,
     coalesce(p_external_reference,v_prev.external_reference),p_result,p_error_code,false,v_corr,v_prev.id,
     v_intent.execution_version,v_prev.execution_payload_hash,v_adapter)
  returning id into v_attempt;

  update automation_intents set status=p_to_state,decided_at=now(),last_error=p_error_code,lease_expires_at=null
    where id=p_intent_id and tenant_id=p_tenant_id and status='unknown';
  if not found then raise exception 'unknown transition lost' using errcode='serialization_failure'; end if;

  if p_to_state='succeeded' and p_outcome_type is not null and not exists(
      select 1 from outcomes where tenant_id=p_tenant_id and automation_intent_id=p_intent_id
        and outcome_type=p_outcome_type and supersedes is null) then
    insert into outcomes(tenant_id,action_object_id,automation_intent_id,execution_attempt_id,
      outcome_type,outcome_layer,status,observed_at,evidence,confidence,source,external_reference,
      correlation_id,source_kind,source_record_id,verification_state)
    values(p_tenant_id,v_intent.action_object_id,p_intent_id,v_attempt,p_outcome_type,p_outcome_layer,
      'observed',now(),jsonb_build_array(jsonb_build_object('execution_attempt_id',v_attempt,'resolved_from','unknown')),1,
      'automation.execute',p_external_reference,v_corr,'automation_execution',v_attempt,
      'system_observed')
    returning id into v_outcome;
  end if;

  v_event_type:=case p_to_state when 'succeeded' then 'automation.execution.succeeded'
    else 'automation.execution.failed' end;
  insert into platform_events(tenant_id,event_type,subject_type,subject_id,source,status,payload,
    metadata,actor,occurred_at,domain,correlation_id)
  values(p_tenant_id,v_event_type,'automation_intent',p_intent_id,'automation.execute','pending',
    jsonb_build_object('resolved_from','unknown','execution_attempt_id',v_attempt),
    jsonb_build_object('job_id',p_job_id),jsonb_build_object('kind','automation','ref','automation.execute'),
    now(),'core',v_corr) on conflict do nothing returning id into v_event;

  execution_attempt_id:=v_attempt; outcome_id:=v_outcome; event_id:=v_event; resolution:=p_to_state; return next;
end $$;

-- ── Grants (service-role only, like the sibling execution RPCs) ───────────────
revoke all on function automation_claim_and_start(uuid,uuid,text,int,text,uuid,text) from public,anon,authenticated;
grant execute on function automation_claim_and_start(uuid,uuid,text,int,text,uuid,text) to service_role;
revoke all on function automation_resolve_unknown_execution(uuid,uuid,text,jsonb,text,text,text,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function automation_resolve_unknown_execution(uuid,uuid,text,jsonb,text,text,text,text,text,text,uuid,uuid) to service_role;
