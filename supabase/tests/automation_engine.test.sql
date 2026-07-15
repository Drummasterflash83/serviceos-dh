-- Universal Automation Engine — persistence & safety assertions.
-- Run in a real environment: `supabase db execute < supabase/tests/automation_engine.test.sql`
-- Wrapped in a transaction and rolled back (non-destructive).
-- Requires migrations through 20260722120000 and the seeded Drummond tenant
-- (00000000-0000-0000-0000-000000000001).

begin;

-- Fixtures: an Action intelligence_object + an authorised Automation Intent -----
insert into intelligence_objects (id, tenant_id, domain, object_type, object_class, subject, status)
values ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
        'serviceos','Action','action','controlled action','ready');

insert into automation_intents
  (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id, capability_key,
   idempotency_key, expires_at, max_attempts)
values
  ('61000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001','record_controlled_execution','{}'::jsonb,'pending',
   'controlled_test','internal.record_execution','idem-A', now() + interval '1 day', 5);

-- 1) Legal transition allowed: pending → claimed.
update automation_intents set status='claimed' where id='61000000-0000-0000-0000-000000000001';
do $$ begin
  if (select status from automation_intents where id='61000000-0000-0000-0000-000000000001') <> 'claimed'
    then raise exception 'FAIL: legal transition pending->claimed did not apply'; end if;
end $$;

-- 2) ILLEGAL transition rejected: claimed → executing (must go via approved).
do $$ begin
  update automation_intents set status='executing' where id='61000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: illegal transition claimed->executing was allowed';
exception when restrict_violation then null; -- expected: automation_intents_transition_guard
end $$;

-- 3) ATOMIC CLAIM: a conditional claim on an already-claimed intent affects 0 rows
--    (the second concurrent worker cannot also claim it).
do $$
declare n int;
begin
  update automation_intents set status='approved'
   where id='61000000-0000-0000-0000-000000000001' and status='pending';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: claim on a non-pending intent affected % rows', n; end if;
end $$;

-- Drive it to a terminal success for the re-execution test: claimed→approved→executing→succeeded.
update automation_intents set status='approved'  where id='61000000-0000-0000-0000-000000000001';
update automation_intents set status='executing' where id='61000000-0000-0000-0000-000000000001';
update automation_intents set status='succeeded' where id='61000000-0000-0000-0000-000000000001';

-- 4) A succeeded intent cannot re-execute (succeeded is terminal).
do $$ begin
  update automation_intents set status='executing' where id='61000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: a succeeded intent was re-executed';
exception when restrict_violation then null; -- expected
end $$;

-- 5) Execution attempts are append-only + idempotency-unique on success.
insert into automation_execution_attempts
  (id, tenant_id, automation_intent_id, operation_type, idempotency_key, attempt_number, status)
values
  ('62000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
   '61000000-0000-0000-0000-000000000001','record_controlled_execution','idem-A',1,'succeeded');
do $$ begin
  update automation_execution_attempts set status='failed_transient'
    where id='62000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: execution attempt UPDATE was allowed';
exception when restrict_violation then null; -- expected: append-only
end $$;
do $$ begin
  -- a SECOND succeeded attempt with the same idempotency key is rejected (exactly-once)
  insert into automation_execution_attempts
    (tenant_id, automation_intent_id, operation_type, idempotency_key, attempt_number, status)
  values ('00000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001',
          'record_controlled_execution','idem-A',2,'succeeded');
  raise exception 'FAIL: duplicate succeeded idempotency key was allowed';
exception when unique_violation then null; -- expected: aea_idem_success_uk
end $$;

-- 6) Approvals are append-only.
insert into automation_approvals
  (id, tenant_id, automation_intent_id, approver_kind, decision)
values ('63000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
        '61000000-0000-0000-0000-000000000001','customer','approved');
do $$ begin
  update automation_approvals set decision='rejected' where id='63000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: approval UPDATE was allowed';
exception when restrict_violation then null; -- expected
end $$;

-- 7) Outcomes are append-only, and a BUSINESS-value outcome is impossible in v1
--    (no business outcome_type is registered → FK rejects it).
insert into outcomes
  (id, tenant_id, action_object_id, automation_intent_id, outcome_type, outcome_layer, status)
values ('64000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
        '60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001',
        'controlled_execution_recorded','operational','observed');
do $$ begin
  update outcomes set status='rejected' where id='64000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: outcome UPDATE was allowed';
exception when restrict_violation then null; -- expected
end $$;
do $$ begin
  insert into outcomes (tenant_id, action_object_id, outcome_type, outcome_layer, status)
  values ('00000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',
          'business_value_claimed','business','observed');
  raise exception 'FAIL: an unregistered business-value outcome was allowed';
exception when foreign_key_violation then null; -- expected: outcome_type FK (no business type seeded)
end $$;

-- 8) schedule_engineer_visit remains registered but UNSUPPORTED (never executable).
do $$ begin
  if (select enabled from automation_intent_types where intent_type='schedule_engineer_visit') <> false
    then raise exception 'FAIL: schedule_engineer_visit is enabled in v1'; end if;
end $$;

-- 9) HARDENING — ATOMIC claim + durable in-flight attempt (single RPC transaction).
insert into automation_intents
  (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id, capability_key, max_attempts)
values ('61000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
        '60000000-0000-0000-0000-000000000001','record_controlled_execution','{}'::jsonb,'pending',
        'controlled_test','internal.record_execution',5);
do $$
declare v_attempt uuid; v_n int; cnt int;
begin
  select attempt_id, attempt_number into v_attempt, v_n
    from automation_claim_and_start('61000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001','worker-1',300,'idem-B',null,'auto-exec@1');
  if v_attempt is null then raise exception 'FAIL: claim did not return an attempt'; end if;
  if (select status from automation_intents where id='61000000-0000-0000-0000-000000000002') <> 'executing'
    then raise exception 'FAIL: claim did not move intent to executing'; end if;
  if (select attempts from automation_intents where id='61000000-0000-0000-0000-000000000002') <> 1
    then raise exception 'FAIL: claim did not increment attempts exactly once'; end if;
  select count(*) into cnt from automation_execution_attempts where id=v_attempt and status='in_flight';
  if cnt <> 1 then raise exception 'FAIL: claim did not create exactly one in-flight attempt'; end if;
  -- a second concurrent worker cannot also claim it (it is no longer pending/failed)
  select count(*) into cnt from automation_claim_and_start('61000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001','worker-2',300,'idem-B',null,'auto-exec@1');
  if cnt <> 0 then raise exception 'FAIL: a second worker also claimed the intent'; end if;
end $$;

-- 10) HARDENING — authorised intent business fields are immutable in place.
insert into automation_intents
  (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id, capability_key, max_attempts)
values ('61000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001',
        '60000000-0000-0000-0000-000000000001','record_controlled_execution','{}'::jsonb,'pending',
        'controlled_test','internal.record_execution',5);
update automation_intents set parameters='{"a":1}'::jsonb where id='61000000-0000-0000-0000-000000000003'; -- pending is editable
update automation_intents set status='claimed' where id='61000000-0000-0000-0000-000000000003';           -- authorise/claim
do $$ begin
  update automation_intents set parameters='{"a":2}'::jsonb where id='61000000-0000-0000-0000-000000000003';
  raise exception 'FAIL: authorised intent parameters were edited in place';
exception when restrict_violation then null; -- expected
end $$;
do $$ begin
  update automation_intents set connector_id='other' where id='61000000-0000-0000-0000-000000000003';
  raise exception 'FAIL: authorised intent connector was edited in place';
exception when restrict_violation then null; -- expected
end $$;
-- lease/result fields still change on an authorised intent (lifecycle is not frozen)
update automation_intents set lease_expires_at=now() where id='61000000-0000-0000-0000-000000000003';

-- 11) HARDENING — Outcome provenance defaults + business-verification authority.
do $$ begin
  if (select verification_state from outcomes where id='64000000-0000-0000-0000-000000000001') <> 'system_observed'
    then raise exception 'FAIL: default outcome verification_state is not system_observed'; end if;
end $$;
insert into outcome_types (outcome_type, layer, description) values ('test_business_value','business','test only');
do $$ begin
  insert into outcomes (tenant_id, action_object_id, outcome_type, outcome_layer, status, verification_state)
  values ('00000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',
          'test_business_value','business','observed','system_observed');
  raise exception 'FAIL: a system_observed business outcome was allowed';
exception when check_violation then null; -- expected: outcomes_business_needs_verification
end $$;
-- with human/external verification a business outcome is permitted
insert into outcomes (tenant_id, action_object_id, outcome_type, outcome_layer, status, verification_state)
values ('00000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',
        'test_business_value','business','observed','human_verified');

do $$ begin
  raise notice 'PASS: atomic claim+attempt; concurrent claim blocked; authorised intent params immutable; outcome provenance + business-verification; legal transitions; append-only; exactly-once; no unverified business value; schedule_engineer_visit unsupported';
end $$;

rollback;
