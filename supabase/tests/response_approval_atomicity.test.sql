-- Response approval boundary — BEHAVIOURAL atomicity + concurrency assertions.
-- Proves the transactional approval boundary (approve_response_intent_atomic) and the
-- revision boundary (record_response_revision_atomic) enforce the production-readiness
-- invariants the audit flagged P0. Run in a real environment:
--   `supabase db execute < supabase/tests/response_approval_atomicity.test.sql`
-- Wrapped in a transaction and rolled back (non-destructive). Requires migrations through
-- 20260731120000 and the seeded Drummond tenant (00000000-0000-0000-0000-000000000001).
--
-- Concurrency note: `supabase db execute` runs a single session, so true parallelism is
-- demonstrated the same way the rest of this suite does it (verification_locks/automation_
-- engine) — by driving the SECOND actor against the state the first committed. The real
-- concurrency guarantee is the row lock (SELECT … FOR UPDATE) inside the function plus the
-- unique(automation_intent_id) snapshot constraint; both are exercised below.

begin;

-- ── Fixtures: action → pending intent → AI proposal → one human revision ───────
insert into intelligence_objects (id, tenant_id, domain, object_type, object_class, subject, status)
values ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
        'core','Action','action','draft reply','ready');

insert into automation_intents
  (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id, capability_key,
   expires_at, max_attempts)
values
  ('71000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000001','draft_email_reply','{}'::jsonb,'pending',
   'openfolk-core','email.reply_draft', now() + interval '1 day', 5);

insert into response_proposals
  (id, tenant_id, automation_intent_id, action_object_id, source_interaction, draft_version,
   original_body, provenance, generated_by, generated_at)
values
  ('72000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
   '71000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','int-x','response-draft/1',
   'AI original body', '[{"kind":"customer_card","ref":"card-1"}]'::jsonb, 'response-assistant', now());

-- one human refinement through the ATOMIC revision boundary (binds the edited body).
do $$
declare r record;
begin
  select * into r from record_response_revision_atomic(
    '00000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001',
    'ops@drummonds.co.uk','tenant_operator','HUMAN edited body','concrete appointment', now());
  if r.revision_id is null then raise exception 'FAIL: revision boundary returned no revision'; end if;
  if (r.effective_parameters->>'body') <> 'HUMAN edited body'
    then raise exception 'FAIL: revision did not bind the edited body onto the intent'; end if;
end $$;

-- APPROVE through the ATOMIC boundary (snapshot + payload binding + engine approval).
do $$
declare r record;
begin
  select * into r from approve_response_intent_atomic(
    '00000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001',
    'owner@drummonds.co.uk','tenant_senior','tenant_operator_review','approved','{}'::jsonb, now());
  if r.snapshot_id is null or r.approval_id is null or r.approved_payload_hash is null
    then raise exception 'FAIL: approval boundary did not return snapshot+approval+hash'; end if;
end $$;

-- 1) EXACTLY ONE SUCCESS under contention: the second approval is rejected and creates
--    NO second snapshot or approval.
do $$ begin
  perform approve_response_intent_atomic(
    '00000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001',
    'other@drummonds.co.uk','tenant_senior','tenant_operator_review','approved','{}'::jsonb, now());
  raise exception 'FAIL: a second concurrent approval succeeded';
exception when unique_violation then null; -- expected: already_decided
end $$;
do $$
declare n_snap int; n_appr int;
begin
  select count(*) into n_snap from response_approval_snapshots
    where automation_intent_id='71000000-0000-0000-0000-000000000001';
  select count(*) into n_appr from automation_approvals
    where automation_intent_id='71000000-0000-0000-0000-000000000001' and decision='approved';
  if n_snap <> 1 then raise exception 'FAIL: expected exactly 1 snapshot, got %', n_snap; end if;
  if n_appr <> 1 then raise exception 'FAIL: expected exactly 1 approval, got %', n_appr; end if;
end $$;

-- The unique(automation_intent_id) snapshot constraint is the hard backstop even if a
-- caller bypassed the function: a divergent second snapshot is impossible.
do $$ begin
  insert into response_approval_snapshots
    (tenant_id, automation_intent_id, response_proposal_id, source, approved_body,
     approved_payload_hash, approver_ref, approver_kind)
  values ('00000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001',
          '72000000-0000-0000-0000-000000000001','ai_proposal','divergent body','deadbeef','x','tenant_senior');
  raise exception 'FAIL: a divergent second snapshot was allowed';
exception when unique_violation then null; -- expected: unique(automation_intent_id)
end $$;

-- 2) A LOSING APPROVAL CANNOT MUTATE THE INTENT PARAMETERS: capture the bound payload,
--    drive a second (failing) approval, and prove the executable payload is unchanged.
do $$
declare v_body_before text; v_hash_before text; v_body_after text; v_hash_after text;
begin
  select parameters->>'body', approved_payload_hash into v_body_before, v_hash_before
    from automation_intents where id='71000000-0000-0000-0000-000000000001';
  begin
    perform approve_response_intent_atomic(
      '00000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001',
      'loser@drummonds.co.uk','tenant_senior','tenant_operator_review','approved','{}'::jsonb, now());
  exception when unique_violation then null; -- the loser is rejected
  end;
  select parameters->>'body', approved_payload_hash into v_body_after, v_hash_after
    from automation_intents where id='71000000-0000-0000-0000-000000000001';
  if v_body_before is distinct from v_body_after or v_hash_before is distinct from v_hash_after
    then raise exception 'FAIL: a losing approval mutated the intent payload'; end if;
  if v_body_after <> 'HUMAN edited body'
    then raise exception 'FAIL: the bound payload is not the reviewed version'; end if;
end $$;

-- 3) SNAPSHOT AND APPROVAL CANNOT DIVERGE: one FULL-envelope hash binds the snapshot, the
--    intent, and the recomputed envelope hash of the bound intent; the approval evidence
--    points at the snapshot; the approved body is the reviewed (edited) version.
do $$
declare v_snap_id uuid; v_snap_hash text; v_snap_body text;
        v_intent_hash text; v_calc_hash text; v_evi_snap uuid;
begin
  select id, approved_payload_hash, approved_body into v_snap_id, v_snap_hash, v_snap_body
    from response_approval_snapshots where automation_intent_id='71000000-0000-0000-0000-000000000001';
  select approved_payload_hash into v_intent_hash
    from automation_intents where id='71000000-0000-0000-0000-000000000001';
  v_calc_hash := automation_intent_envelope_hash(
    '00000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001');
  select (evidence->>'response_approval_snapshot_id')::uuid into v_evi_snap
    from automation_approvals
    where automation_intent_id='71000000-0000-0000-0000-000000000001' and decision='approved';
  if v_snap_hash is distinct from v_intent_hash
    then raise exception 'FAIL: snapshot hash and intent hash diverge'; end if;
  if v_intent_hash is distinct from v_calc_hash
    then raise exception 'FAIL: intent hash != recomputed full-envelope hash'; end if;
  if v_evi_snap is distinct from v_snap_id
    then raise exception 'FAIL: approval evidence does not reference the snapshot'; end if;
  if v_snap_body <> 'HUMAN edited body'
    then raise exception 'FAIL: approved body is not the reviewed (edited) version'; end if;
end $$;

-- 4) REVISION AFTER APPROVAL IS REJECTED, and writes no revision row.
do $$
declare n_before int; n_after int;
begin
  select count(*) into n_before from response_revisions
    where automation_intent_id='71000000-0000-0000-0000-000000000001';
  begin
    perform record_response_revision_atomic(
      '00000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001',
      'ops@drummonds.co.uk','tenant_operator','late edit after approval', null, now());
    raise exception 'FAIL: a revision after approval was accepted';
  exception when restrict_violation then null; -- expected: already_approved
  end;
  select count(*) into n_after from response_revisions
    where automation_intent_id='71000000-0000-0000-0000-000000000001';
  if n_after <> n_before then raise exception 'FAIL: a revision row was written after approval'; end if;
end $$;

-- 5a) APPROVED PAYLOAD HASH == EXECUTED PAYLOAD: claiming the approved intent records the
--     same payload hash on the execution attempt (the engine binds to the approved bytes).
do $$
declare r record; v_attempt_hash text; v_snap_hash text;
begin
  select approved_payload_hash into v_snap_hash from response_approval_snapshots
    where automation_intent_id='71000000-0000-0000-0000-000000000001';
  select * into r from automation_claim_and_start('71000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001','worker-1',300,'idem-I1',null,'auto-exec@1');
  if r.attempt_id is null then raise exception 'FAIL: claim of an approved intent did not start'; end if;
  select execution_payload_hash into v_attempt_hash
    from automation_execution_attempts where id=r.attempt_id;
  if v_attempt_hash is distinct from v_snap_hash
    then raise exception 'FAIL: executed payload hash != approved payload hash'; end if;
end $$;

-- 5b) A TAMPERED PAYLOAD IS REFUSED AT CLAIM: if the bound parameters no longer match the
--     approved hash, execution is blocked (never runs the wrong content).
insert into automation_intents
  (id, tenant_id, action_object_id, intent_type, parameters, status, connector_id, capability_key,
   approved_payload_hash, expires_at, max_attempts)
values
  ('71000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000001','draft_email_reply','{"body":"tampered after approval"}'::jsonb,
   'pending','openfolk-core','email.reply_draft','deadbeefdeadbeef', now() + interval '1 day', 5);
do $$ begin
  perform automation_claim_and_start('71000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001','worker-2',300,'idem-I2',null,'auto-exec@1');
  raise exception 'FAIL: a tampered payload was allowed to execute';
exception when data_exception then null; -- expected: approved payload integrity mismatch
end $$;

do $$ begin
  raise notice 'PASS: approval boundary is atomic — exactly-once under contention; a losing approval cannot mutate the payload; snapshot/approval/intent share one hash (no divergence); revision-after-approval rejected; executed payload hash == approved hash; a tampered payload is refused at claim';
end $$;

rollback;
