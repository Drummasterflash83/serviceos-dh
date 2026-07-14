-- Objective Evaluation Worker — persistence assertions.
-- Run in a real environment: `supabase db execute < supabase/tests/objective_health_evaluation.test.sql`
-- Wrapped in a transaction and rolled back (non-destructive).
-- Requires migrations through 20260721120000 and the seeded Drummond tenant
-- (00000000-0000-0000-0000-000000000001).

begin;

-- Fixtures -------------------------------------------------------------------
insert into config_versions (id, tenant_id, artifact_kind, artifact_key, version, status, author) values
  ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','objective','test.health',1,'draft','tester');

insert into objectives (id, tenant_id, objective_type, title, status, source, version_id, created_by)
values ('51000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','service_target','Health test objective','draft','tenant_configuration','50000000-0000-0000-0000-000000000001','tester');

insert into metric_definitions (id, tenant_id, key, name, unit, direction)
values ('52000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','test_response_time','Response time','hours','decrease');

insert into objective_metrics (tenant_id, objective_id, metric_id, role, direction, baseline_value, baseline_unit, target_value, target_unit)
values ('00000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','primary','decrease',6,'hours',2,'hours');

-- 1) A health snapshot can be appended with the evaluation identity + lineage.
insert into objective_health
  (id, tenant_id, objective_id, status, progress, confidence, reasons, objective_version_id,
   evaluator_version, input_hash, triggered_by, snapshot)
values
  ('53000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
   '51000000-0000-0000-0000-000000000001','at_risk',0.375,0.9,'{at_risk}',
   '50000000-0000-0000-0000-000000000001','obj-health@1','hash-A','measurement','{"objective":{}}'::jsonb);

-- 2) Health snapshots are APPEND-ONLY: update is rejected.
do $$ begin
  update objective_health set status='on_track' where id='53000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: objective_health UPDATE was allowed';
exception when restrict_violation then null; -- expected: append-only trigger fired
end $$;

-- 3) Health snapshots are APPEND-ONLY: delete is rejected (prior snapshot immutable).
do $$ begin
  delete from objective_health where id='53000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: objective_health DELETE was allowed';
exception when restrict_violation then null; -- expected
end $$;

-- 4) IDEMPOTENCY: a second snapshot with the SAME (tenant, objective, input_hash)
--    is rejected — a retry can never create a duplicate logical snapshot.
do $$ begin
  insert into objective_health
    (tenant_id, objective_id, status, input_hash, triggered_by)
  values
    ('00000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','at_risk','hash-A','measurement');
  raise exception 'FAIL: duplicate input_hash snapshot was allowed';
exception when unique_violation then null; -- expected: objective_health_idem_uk
end $$;

-- 5) A CHANGED input (new hash) legitimately appends a new snapshot.
insert into objective_health
  (id, tenant_id, objective_id, status, input_hash, triggered_by, supersedes)
values
  ('53000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
   '51000000-0000-0000-0000-000000000001','off_track','hash-B','measurement',
   '53000000-0000-0000-0000-000000000001');
do $$ begin
  if (select count(*) from objective_health where objective_id='51000000-0000-0000-0000-000000000001') <> 2
    then raise exception 'FAIL: new-hash snapshot did not append'; end if;
  -- the original snapshot is unchanged (append-only lineage, not mutation)
  if (select status from objective_health where id='53000000-0000-0000-0000-000000000001') <> 'at_risk'
    then raise exception 'FAIL: prior snapshot was mutated'; end if;
end $$;

-- 6) Contribution assessments are append-only + idempotent by input hash.
insert into objective_contribution_assessments
  (id, tenant_id, objective_id, state, confidence, input_hash, evaluator_version)
values
  ('54000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
   '51000000-0000-0000-0000-000000000001','inconclusive',0.3,'chash-A','obj-health@1');
do $$ begin
  update objective_contribution_assessments set state='contribution_confirmed'
    where id='54000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: contribution assessment UPDATE was allowed';
exception when restrict_violation then null; -- expected: append-only
end $$;
do $$ begin
  insert into objective_contribution_assessments
    (tenant_id, objective_id, state, input_hash)
  values ('00000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','inconclusive','chash-A');
  raise exception 'FAIL: duplicate contribution input_hash was allowed';
exception when unique_violation then null; -- expected: oca_idem_uk (null link coalesced)
end $$;

-- 7) Parent-objective hierarchy must stay acyclic (worker enqueues parents on change).
insert into objectives (id, tenant_id, objective_type, title, status, source, version_id, created_by)
values ('51000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-000000000001','initiative','Parent','draft','tenant_configuration','50000000-0000-0000-0000-000000000001','tester');
update objectives set parent_objective_id='51000000-0000-0000-0000-0000000000aa'
  where id='51000000-0000-0000-0000-000000000001'; -- child → parent: fine
do $$ begin
  -- closing the loop (parent → its own child) must be rejected
  update objectives set parent_objective_id='51000000-0000-0000-0000-000000000001'
    where id='51000000-0000-0000-0000-0000000000aa';
  raise exception 'FAIL: a parent cycle was allowed';
exception when restrict_violation then null; -- expected: objectives_no_parent_cycle
end $$;
do $$ begin
  update objectives set parent_objective_id='51000000-0000-0000-0000-0000000000aa'
    where id='51000000-0000-0000-0000-0000000000aa'; -- self-parent
  raise exception 'FAIL: self-parent was allowed';
exception when restrict_violation then null; -- expected
end $$;

do $$ begin
  raise notice 'PASS: health append-only + idempotent; prior snapshots immutable; new-hash appends; contribution append-only + idempotent; parent cycles rejected';
end $$;

rollback;
