-- Execution reliability hardening — BEHAVIOURAL assertions for the P0/P1 fixes.
--   P0-1 claim returns the exact immutable envelope; the hash matches the executed payload.
--   P0-2 a retry gets a per-attempt job key and never collides with the running base job.
--   P0-3 one atomic mechanism resolves an unknown result (rolls back on wrong state).
--   P0-4 no executable capability without a registered outcome contract.
--   P1-5 the integrity hash binds the FULL envelope (every field changes it).
--   lost-response: finalising twice is idempotent (no duplicate attempt/outcome).
-- Run in a real environment: `supabase db execute < supabase/tests/execution_reliability.test.sql`
-- Wrapped in a transaction and rolled back. Requires migrations through 20260801120000 and the
-- seeded Drummond tenant (00000000-0000-0000-0000-000000000001).

begin;

-- ── Shared fixture: one action object ─────────────────────────────────────────
insert into intelligence_objects (id, tenant_id, domain, object_type, object_class, subject, status)
values ('80000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
        'core','Action','action','reliability action','ready');

-- ══ P1-5: the envelope hash binds ALL nine fields (each change alters the digest). ══
do $$
declare b text; s uuid := gen_random_uuid();
begin
  b := automation_envelope_hash('00000000-0000-0000-0000-000000000001'::uuid,
        '81000000-0000-0000-0000-0000000000aa'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,
        'email.reply_draft','openfolk-core','{"body":"x"}'::jsonb,'1','1',s);
  if b = automation_envelope_hash('00000000-0000-0000-0000-0000000000ff'::uuid,'81000000-0000-0000-0000-0000000000aa'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'email.reply_draft','openfolk-core','{"body":"x"}'::jsonb,'1','1',s) then raise exception 'FAIL: hash not bound to tenant'; end if;
  if b = automation_envelope_hash('00000000-0000-0000-0000-000000000001'::uuid,'81000000-0000-0000-0000-0000000000bb'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'email.reply_draft','openfolk-core','{"body":"x"}'::jsonb,'1','1',s) then raise exception 'FAIL: hash not bound to intent'; end if;
  if b = automation_envelope_hash('00000000-0000-0000-0000-000000000001'::uuid,'81000000-0000-0000-0000-0000000000aa'::uuid,'22222222-2222-2222-2222-222222222222'::uuid,'email.reply_draft','openfolk-core','{"body":"x"}'::jsonb,'1','1',s) then raise exception 'FAIL: hash not bound to decision'; end if;
  if b = automation_envelope_hash('00000000-0000-0000-0000-000000000001'::uuid,'81000000-0000-0000-0000-0000000000aa'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'email.OTHER','openfolk-core','{"body":"x"}'::jsonb,'1','1',s) then raise exception 'FAIL: hash not bound to capability'; end if;
  if b = automation_envelope_hash('00000000-0000-0000-0000-000000000001'::uuid,'81000000-0000-0000-0000-0000000000aa'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'email.reply_draft','other-connector','{"body":"x"}'::jsonb,'1','1',s) then raise exception 'FAIL: hash not bound to connector'; end if;
  if b = automation_envelope_hash('00000000-0000-0000-0000-000000000001'::uuid,'81000000-0000-0000-0000-0000000000aa'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'email.reply_draft','openfolk-core','{"body":"TAMPERED"}'::jsonb,'1','1',s) then raise exception 'FAIL: hash not bound to parameters'; end if;
  if b = automation_envelope_hash('00000000-0000-0000-0000-000000000001'::uuid,'81000000-0000-0000-0000-0000000000aa'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'email.reply_draft','openfolk-core','{"body":"x"}'::jsonb,'2','1',s) then raise exception 'FAIL: hash not bound to schema version'; end if;
  if b = automation_envelope_hash('00000000-0000-0000-0000-000000000001'::uuid,'81000000-0000-0000-0000-0000000000aa'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'email.reply_draft','openfolk-core','{"body":"x"}'::jsonb,'1','2',s) then raise exception 'FAIL: hash not bound to adapter version'; end if;
  if b = automation_envelope_hash('00000000-0000-0000-0000-000000000001'::uuid,'81000000-0000-0000-0000-0000000000aa'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'email.reply_draft','openfolk-core','{"body":"x"}'::jsonb,'1','1',gen_random_uuid()) then raise exception 'FAIL: hash not bound to approval snapshot'; end if;
end $$;

-- ══ P0-1: claim returns the exact immutable envelope; the hash matches the payload. ══
-- Fixture: an approved reply-draft intent (envelope bound by the approval RPC).
insert into automation_intents
  (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id, capability_key,
   expires_at, max_attempts)
values
  ('81000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001','draft_email_reply','{}'::jsonb,'pending',
   'openfolk-core','email.reply_draft', now() + interval '1 day', 5);
insert into response_proposals
  (id, tenant_id, automation_intent_id, action_object_id, source_interaction, draft_version,
   original_body, provenance, generated_by, generated_at)
values
  ('82000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
   '81000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','int-x','response-draft/1',
   'Approved reply body', '[]'::jsonb, 'response-assistant', now());
do $$ declare r record; begin
  select * into r from approve_response_intent_atomic('00000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001','owner@d.co','tenant_senior','tenant_operator_review',
    'approved','{}'::jsonb, now());
  if r.snapshot_id is null then raise exception 'FAIL: approval did not bind an envelope'; end if;
end $$;

-- Tamper the connector while still pending: the recomputed envelope no longer matches → claim refuses.
update automation_intents set connector_id='tampered-connector' where id='81000000-0000-0000-0000-000000000001';
do $$ begin
  perform automation_claim_and_start('81000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001','w',300,'idem-1',null,'auto-exec@1');
  raise exception 'FAIL: a tampered envelope was allowed to execute';
exception when data_exception then null; -- expected: approved payload integrity mismatch
end $$;

-- Restore the bound connector; now the claim succeeds and RETURNS the exact envelope.
update automation_intents set connector_id='openfolk-core' where id='81000000-0000-0000-0000-000000000001';
do $$
declare r record; v_intent_hash text; v_attempt_hash text; v_snap_hash text;
begin
  select approved_payload_hash into v_intent_hash from automation_intents where id='81000000-0000-0000-0000-000000000001';
  select approved_payload_hash into v_snap_hash from response_approval_snapshots where automation_intent_id='81000000-0000-0000-0000-000000000001';
  select * into r from automation_claim_and_start('81000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001','w',300,'idem-1',null,'auto-exec@1');
  if r.attempt_id is null then raise exception 'FAIL: claim of a valid envelope did not start'; end if;
  if (r.envelope_parameters->>'body') <> 'Approved reply body' then raise exception 'FAIL: claim did not return the exact bound parameters'; end if;
  if r.envelope_hash is distinct from v_intent_hash or v_intent_hash is distinct from v_snap_hash then raise exception 'FAIL: returned envelope hash != approved hash'; end if;
  if r.adapter_version <> '1' then raise exception 'FAIL: claim did not return the contract adapter version'; end if;
  select execution_payload_hash into v_attempt_hash from automation_execution_attempts where id=r.attempt_id;
  if v_attempt_hash is distinct from v_intent_hash then raise exception 'FAIL: executed payload hash != approved envelope hash'; end if;
end $$;

-- ══ P0-4: a capability with NO registered outcome contract can never be claimed. ══
insert into automation_intents
  (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id, capability_key,
   expires_at, max_attempts)
values
  ('81000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001','record_internal_note','{}'::jsonb,'pending',
   'openfolk-core','test.no_contract', now() + interval '1 day', 5);
do $$ begin
  perform automation_claim_and_start('81000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000001','w',300,'idem-5',null,'auto-exec@1');
  raise exception 'FAIL: a capability with no outcome contract was claimed';
exception when restrict_violation then null; -- expected: capability_contract_missing
end $$;

-- ══ P0-2: a retry gets a per-attempt key and never collides with the running base job. ══
insert into automation_intents
  (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id, capability_key,
   expires_at, max_attempts)
values
  ('81000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001','record_internal_note','{"note":"n"}'::jsonb,'pending',
   'openfolk-core','internal.create_note', now() + interval '1 day', 5);
do $$
declare r record; v_inflight uuid; v_retry int; v_base int;
begin
  select * into r from automation_claim_and_start('81000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001','w',300,'idem-2',null,'auto-exec@1');
  v_inflight := r.attempt_id;
  -- The base job for this intent is STILL RUNNING while we finalise (this is the collision case).
  insert into platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,available_at,payload)
  values('00000000-0000-0000-0000-000000000001','openfolk-core','core.automation','automation.execute',
    'automation.execute:00000000-0000-0000-0000-000000000001:81000000-0000-0000-0000-000000000002',
    'running',100,5,now(),'{}'::jsonb);
  -- A transient failure schedules a retry.
  perform automation_finalize_execution('00000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002',
    v_inflight,'w','failed','{}'::jsonb,'transient','failed_transient',true, now()+interval '5 min',
    null,'failed_transient',null,'operational',null,null);
  -- The retry survives under a DISTINCT per-attempt key (it did not collapse onto the running base job).
  select count(*) into v_retry from platform_jobs
    where tenant_id='00000000-0000-0000-0000-000000000001' and status='queued'
      and job_key='automation.execute:00000000-0000-0000-0000-000000000001:81000000-0000-0000-0000-000000000002:retry:1';
  if v_retry <> 1 then raise exception 'FAIL: retry job disappeared (job-key collision), got %', v_retry; end if;
  select count(*) into v_base from platform_jobs
    where job_key='automation.execute:00000000-0000-0000-0000-000000000001:81000000-0000-0000-0000-000000000002';
  if v_base <> 1 then raise exception 'FAIL: the running base job was disturbed, got %', v_base; end if;
  if (select status from automation_intents where id='81000000-0000-0000-0000-000000000002') <> 'failed'
    then raise exception 'FAIL: intent not left failed for retry'; end if;
end $$;
-- The retry REMAINS CLAIMABLE: the failed intent (within budget) can be claimed again.
do $$ declare r record; begin
  select * into r from automation_claim_and_start('81000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001','w2',300,'idem-2',null,'auto-exec@1');
  if r.attempt_id is null then raise exception 'FAIL: retry is not claimable'; end if;
  if r.attempt_number <> 2 then raise exception 'FAIL: retry did not advance the attempt, got %', r.attempt_number; end if;
end $$;

-- ══ P0-3: ONE atomic mechanism resolves an unknown result — and rolls back on wrong state. ══
insert into automation_intents
  (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id, capability_key,
   expires_at, max_attempts)
values
  ('81000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001','record_internal_note','{"note":"n"}'::jsonb,'pending',
   'openfolk-core','internal.create_note', now() + interval '1 day', 5);
-- Drive it to `unknown` (claim → executing → unknown; a legal recovery transition).
do $$ declare r record; begin
  select * into r from automation_claim_and_start('81000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001','w',300,'idem-3',null,'auto-exec@1');
end $$;
update automation_intents set status='unknown', lease_expires_at=null where id='81000000-0000-0000-0000-000000000003';
-- Resolve it as succeeded — ONE transaction commits the superseding attempt + transition + outcome.
do $$
declare r record; v_att int; v_out int;
begin
  select * into r from automation_resolve_unknown_execution('00000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000003','succeeded','{"ok":true}'::jsonb,null,'succeeded',
    'ext-ref-3','succeeded','internal_note_recorded','operational',null,null);
  if r.resolution <> 'succeeded' or r.execution_attempt_id is null or r.outcome_id is null
    then raise exception 'FAIL: atomic unknown resolution did not commit attempt+outcome'; end if;
  if (select status from automation_intents where id='81000000-0000-0000-0000-000000000003') <> 'succeeded'
    then raise exception 'FAIL: unknown intent not transitioned to succeeded'; end if;
  select count(*) into v_out from outcomes where automation_intent_id='81000000-0000-0000-0000-000000000003';
  if v_out <> 1 then raise exception 'FAIL: expected exactly one outcome, got %', v_out; end if;
end $$;
-- ROLLBACK guarantee: resolving an intent that is NOT unknown raises and writes nothing.
do $$ declare v_before int; v_after int; begin
  select count(*) into v_before from automation_execution_attempts where automation_intent_id='81000000-0000-0000-0000-000000000003';
  begin
    perform automation_resolve_unknown_execution('00000000-0000-0000-0000-000000000001',
      '81000000-0000-0000-0000-000000000003','succeeded','{}'::jsonb,null,'succeeded',null,'succeeded',
      'internal_note_recorded','operational',null,null);
    raise exception 'FAIL: resolving a non-unknown intent was allowed';
  exception when restrict_violation then null; -- expected: intent is not unknown
  end;
  select count(*) into v_after from automation_execution_attempts where automation_intent_id='81000000-0000-0000-0000-000000000003';
  if v_after <> v_before then raise exception 'FAIL: a rejected resolution still wrote an attempt'; end if;
end $$;

-- ══ Lost-response retry: finalising twice is idempotent (no duplicate attempt/outcome). ══
insert into automation_intents
  (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id, capability_key,
   expires_at, max_attempts)
values
  ('81000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001','record_internal_note','{"note":"n"}'::jsonb,'pending',
   'openfolk-core','internal.create_note', now() + interval '1 day', 5);
do $$
declare r record; v_inflight uuid; a1 uuid; a2 uuid; v_terminal int; v_out int;
begin
  select * into r from automation_claim_and_start('81000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000001','w',300,'idem-6',null,'auto-exec@1');
  v_inflight := r.attempt_id;
  -- First finalise commits success.
  select execution_attempt_id into a1 from automation_finalize_execution(
    '00000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000006',v_inflight,'w','succeeded',
    '{"ok":true}'::jsonb,null,'succeeded',false,null,'ext-6','succeeded','internal_note_recorded','operational',null,null);
  -- The client lost the response and calls finalise AGAIN with the same in-flight attempt.
  select execution_attempt_id into a2 from automation_finalize_execution(
    '00000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000006',v_inflight,'w','succeeded',
    '{"ok":true}'::jsonb,null,'succeeded',false,null,'ext-6','succeeded','internal_note_recorded','operational',null,null);
  if a1 is distinct from a2 then raise exception 'FAIL: lost-response finalise was not idempotent'; end if;
  select count(*) into v_terminal from automation_execution_attempts
    where automation_intent_id='81000000-0000-0000-0000-000000000006' and status <> 'in_flight';
  if v_terminal <> 1 then raise exception 'FAIL: duplicate terminal attempt on lost-response retry, got %', v_terminal; end if;
  select count(*) into v_out from outcomes where automation_intent_id='81000000-0000-0000-0000-000000000006';
  if v_out <> 1 then raise exception 'FAIL: duplicate outcome on lost-response retry, got %', v_out; end if;
end $$;

do $$ begin
  raise notice 'PASS: envelope hash binds all nine fields; claim returns the exact hashed envelope; tampered envelope refused; no contract ⇒ no execution; retry survives under a per-attempt key and stays claimable; unknown resolution is atomic and rolls back on wrong state; lost-response finalise is idempotent';
end $$;

rollback;
