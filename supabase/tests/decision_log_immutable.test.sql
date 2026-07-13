-- Decision Package immutability — append-only proof.
-- Run in a real environment: `supabase db execute < supabase/tests/decision_log_immutable.test.sql`
-- Wrapped in a transaction and rolled back, so it is non-destructive.
-- Requires migrations through 20260718120100 and the seeded Drummond tenant.

begin;

-- Fixtures ------------------------------------------------------------------
insert into intelligence_objects (id, tenant_id, domain, object_type, object_class, subject, status)
values ('99999999-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
        'serviceos', 'Observation', 'observation', 'immutability test', 'monitoring');

-- 1. Insert a Decision Package.
insert into decision_log
  (id, tenant_id, object_id, object_snapshot, effective_profile_hash, input_hash,
   decision, next_owner_kind, reason_codes, decision_package)
values
  ('99999999-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000002', '{"snap":true}'::jsonb, 'h-in', 'h-in',
   'NO_ACTION', 'ai', '{no_action_required}', '{"decision":"NO_ACTION"}'::jsonb);

-- 2. Altering the decision/rationale/package MUST be rejected.
do $$
begin
  update decision_log set decision = 'REJECT'
   where id = '99999999-0000-0000-0000-000000000001';
  raise exception 'FAIL: decision_log UPDATE was allowed';
exception
  when restrict_violation then null;  -- expected: append-only trigger fired
end $$;

do $$
begin
  delete from decision_log where id = '99999999-0000-0000-0000-000000000001';
  raise exception 'FAIL: decision_log DELETE was allowed';
exception
  when restrict_violation then null;  -- expected
end $$;

-- 3. A review resolution (separate table) can still be inserted.
insert into review_tasks (tenant_id, object_id, route, decision_id)
values ('00000000-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000002',
        'openfolk', '99999999-0000-0000-0000-000000000001');

-- 4. An outcome (separate append-only history) can still be recorded.
insert into object_state_history (tenant_id, object_id, from_state, to_state, decision_id)
values ('00000000-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000002',
        'monitoring', 'complete', '99999999-0000-0000-0000-000000000001');

-- 5. A superseding decision can be inserted and linked.
insert into decision_log
  (id, tenant_id, object_id, object_snapshot, effective_profile_hash, input_hash,
   decision, next_owner_kind, supersedes)
values
  ('99999999-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000002', '{"snap":true}'::jsonb, 'h-in2', 'h-in2',
   'AUTOMATION_AUTHORISED', 'automation', '99999999-0000-0000-0000-000000000001');

-- 6. The original decision remains unchanged.
do $$
declare d text;
begin
  select decision into d from decision_log where id = '99999999-0000-0000-0000-000000000001';
  if d is distinct from 'NO_ACTION' then
    raise exception 'FAIL: original decision mutated to %', d;
  end if;
  raise notice 'PASS: decision_log is append-only; original preserved; supersession + review + outcome all work';
end $$;

rollback;
