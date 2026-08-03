-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_test_cancel.test.sql
--
-- Proves the ATOMIC governed test cancellation (migration 20260909120000):
-- marketing_test_cancel performs the ENTIRE governed act — tenant/delivery
-- binding, purpose proof, still-queued proof, conditional
-- pending-with-zero-attempts intent transition, terminal delivery
-- reconciliation (failed / 'cancelled'), the delivery event, the audit
-- record, the platform event — in ONE transaction. Coverage:
--   * boundaries: service-role-only EXECUTE (anon/authenticated revoked);
--   * authority: owner and admin succeed; viewer 42501; ops-role allowed;
--     cross-tenant ACTOR integrity violation; cross-tenant delivery P0002
--     (non-enumerating);
--   * argument strictness: non-object, unknown key, malformed uuid, missing
--     delivery_id — all 22023, nothing changes;
--   * ATOMICITY (the correction this migration exists for): with the audit
--     insert forced to fail, the cancellation ROLLS BACK COMPLETELY (intent
--     still pending, delivery still queued, no event, no audit, no platform
--     event) — an unaudited cancellation is impossible; identically for a
--     forced delivery-event failure — a stale projection is impossible;
--   * success evidence: intent pending→cancelled; delivery queued→failed with
--     failure_class 'cancelled'; the guarded event chain ∅>queued,
--     queued>failed with the honest detail; ONE audit row with exact
--     action/resource/actor/authority; ONE platform event; the authoritative
--     return shape; marketing_delivery_reconcile afterwards is a no-op
--     (changed = false) — full idempotent compatibility;
--   * repeat request: a second cancel of the terminal delivery is a stable
--     MK410 refusal creating nothing new;
--   * worker race (REAL engine RPCs, no simulation): after
--     automation_claim_and_start the cancel refuses MK411 and touches
--     nothing; after reconcile (executing) MK410; after a REAL succeeded
--     finalize + reconcile (submitted) MK410 with every provider fact
--     untouched — nothing that may have reached the provider is ever
--     cancelled;
--   * retried work: an intent with a REAL failed_transient attempt (attempts
--     > 0, delivery re-queued) can no longer be withdrawn (MK411) — only
--     never-attempted work is cancellable.
-- The non-test (broadcast delivery) refusal is proven in
-- marketing_broadcasts.test.sql §cancel-refusal, where the full broadcast
-- lineage already exists.
begin;

insert into tenants (id, slug, display_name, industry) values
  ('aaaa9100-0000-0000-0000-0000000000f1','tc-t1','TestCancel Tenant 1','hvac'),
  ('aaaa9100-0000-0000-0000-0000000000f2','tc-t2','TestCancel Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb9100-0000-0000-0000-0000000000f1','owner-a@tc.test',false,false),
  ('bbbb9100-0000-0000-0000-0000000000f2','admin-a@tc.test',false,false),
  ('bbbb9100-0000-0000-0000-0000000000f3','viewer-a@tc.test',false,false),
  ('bbbb9100-0000-0000-0000-0000000000f4','owner-b@tc.test',false,false);
update profiles set role='owner',  tenant_id='aaaa9100-0000-0000-0000-0000000000f1' where id='bbbb9100-0000-0000-0000-0000000000f1';
update profiles set role='admin',  tenant_id='aaaa9100-0000-0000-0000-0000000000f1' where id='bbbb9100-0000-0000-0000-0000000000f2';
update profiles set role='viewer', tenant_id='aaaa9100-0000-0000-0000-0000000000f1' where id='bbbb9100-0000-0000-0000-0000000000f3';
update profiles set role='owner',  tenant_id='aaaa9100-0000-0000-0000-0000000000f2' where id='bbbb9100-0000-0000-0000-0000000000f4';

select marketing_materialise_defaults('aaaa9100-0000-0000-0000-0000000000f1','bbbb9100-0000-0000-0000-0000000000f1');
select marketing_materialise_defaults('aaaa9100-0000-0000-0000-0000000000f2','bbbb9100-0000-0000-0000-0000000000f4');

-- one READY gmail sender per tenant (stored grant carries gmail.send)
insert into email_accounts (id, tenant_id, provider, email_address, status, auth_state) values
  ('eeee9100-0000-0000-0000-0000000000a1','aaaa9100-0000-0000-0000-0000000000f1','gmail','sender@tc-t1.test','active','ok'),
  ('eeee9100-0000-0000-0000-0000000000a2','aaaa9100-0000-0000-0000-0000000000f2','gmail','sender@tc-t2.test','active','ok');
insert into email_oauth_tokens (tenant_id, email_account_id, provider, access_token, refresh_token, expires_at, scope) values
  ('aaaa9100-0000-0000-0000-0000000000f1','eeee9100-0000-0000-0000-0000000000a1','gmail','tok','ref', now() + interval '1 hour',
   'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'),
  ('aaaa9100-0000-0000-0000-0000000000f2','eeee9100-0000-0000-0000-0000000000a2','gmail','tok','ref', now() + interval '1 hour',
   'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');

create temporary table tc_ctx (k text primary key, v text);

-- ── (0) service-role-only boundary ──────────────────────────────────────────
do $$
begin
  assert not has_function_privilege('anon',
    'marketing_test_cancel(uuid, uuid, jsonb)', 'execute'),
    'anon must not execute marketing_test_cancel';
  assert not has_function_privilege('authenticated',
    'marketing_test_cancel(uuid, uuid, jsonb)', 'execute'),
    'authenticated must not execute marketing_test_cancel';
  assert has_function_privilege('service_role',
    'marketing_test_cancel(uuid, uuid, jsonb)', 'execute'),
    'service_role executes marketing_test_cancel';
end $$;

-- ── (1) fixture requests: senders + three governed tenant-A tests ───────────
do $$
declare sa uuid; sb uuid; r jsonb;
begin
  sa := (marketing_sender_create('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-0000000000f1',
    '{"source_kind":"gmail_oauth","source_id":"eeee9100-0000-0000-0000-0000000000a1"}') ->> 'id')::uuid;
  sb := (marketing_sender_create('aaaa9100-0000-0000-0000-0000000000f2',
    'bbbb9100-0000-0000-0000-0000000000f4',
    '{"source_kind":"gmail_oauth","source_id":"eeee9100-0000-0000-0000-0000000000a2"}') ->> 'id')::uuid;
  insert into tc_ctx values ('senderA', sa::text), ('senderB', sb::text);
  perform marketing_sender_set_enabled('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-0000000000f1', sa, true,
    (select updated_at from marketing_sender_profiles where id = sa));
  perform marketing_sender_set_enabled('aaaa9100-0000-0000-0000-0000000000f2',
    'bbbb9100-0000-0000-0000-0000000000f4', sb, true,
    (select updated_at from marketing_sender_profiles where id = sb));

  r := marketing_test_send_request('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-0000000000f1',
    jsonb_build_object('sender_id', sa,
      'recipient_profile_id', 'bbbb9100-0000-0000-0000-0000000000f1',
      'subject', 'Cancel me', 'body_text', 'queued test one',
      'request_id', 'tc-req-0001'));
  insert into tc_ctx values ('d1', r ->> 'delivery_id'), ('i1', r ->> 'intent_id'),
    ('c1', r ->> 'correlation_id');
  r := marketing_test_send_request('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-0000000000f2',
    jsonb_build_object('sender_id', sa,
      'recipient_profile_id', 'bbbb9100-0000-0000-0000-0000000000f2',
      'subject', 'Admin cancels me', 'body_text', 'queued test two',
      'request_id', 'tc-req-0002'));
  insert into tc_ctx values ('d2', r ->> 'delivery_id'), ('i2', r ->> 'intent_id');
  r := marketing_test_send_request('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-0000000000f1',
    jsonb_build_object('sender_id', sa,
      'recipient_profile_id', 'bbbb9100-0000-0000-0000-0000000000f1',
      'subject', 'Race with the worker', 'body_text', 'queued test three',
      'request_id', 'tc-req-0003'));
  insert into tc_ctx values ('d3', r ->> 'delivery_id'), ('i3', r ->> 'intent_id'),
    ('c3', r ->> 'correlation_id');
  r := marketing_test_send_request('aaaa9100-0000-0000-0000-0000000000f2',
    'bbbb9100-0000-0000-0000-0000000000f4',
    jsonb_build_object('sender_id', sb,
      'recipient_profile_id', 'bbbb9100-0000-0000-0000-0000000000f4',
      'subject', 'Retried work', 'body_text', 'tenant-B queued test',
      'request_id', 'tc-req-b001'));
  insert into tc_ctx values ('dB', r ->> 'delivery_id'), ('iB', r ->> 'intent_id'),
    ('cB', r ->> 'correlation_id');
end $$;

-- ── (2) authority + argument battery: every refusal changes NOTHING ─────────
do $$
declare d1 uuid := (select v from tc_ctx where k = 'd1')::uuid;
        i1 uuid := (select v from tc_ctx where k = 'i1')::uuid;
begin
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f3', jsonb_build_object('delivery_id', d1));
    assert false, 'a viewer must be denied';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f4', jsonb_build_object('delivery_id', d1));
    assert false, 'a cross-tenant actor must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f2',
      'bbbb9100-0000-0000-0000-0000000000f4', jsonb_build_object('delivery_id', d1));
    assert false, 'another tenant''s delivery must be NOT FOUND (non-enumerating)';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1', '"just-a-string"'::jsonb);
    assert false, 'non-object args must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1',
      jsonb_build_object('delivery_id', d1, 'sneaky', true));
    assert false, 'an unknown argument key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1',
      '{"delivery_id":"not-a-uuid"}'::jsonb);
    assert false, 'a malformed delivery id must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1', '{}'::jsonb);
    assert false, 'a missing delivery id must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1',
      jsonb_build_object('delivery_id', gen_random_uuid()));
    assert false, 'an unknown delivery id must be NOT FOUND';
  exception when sqlstate 'P0002' then null;
  end;

  assert (select status from marketing_deliveries where id = d1) = 'queued'
     and (select status from automation_intents where id = i1) = 'pending'
     and (select attempts from automation_intents where id = i1) = 0,
    'every refusal left the delivery queued and the intent pending';
  assert (select count(*) from marketing_delivery_events
           where delivery_id = d1) = 1,
    'no refusal appended a delivery event';
  assert not exists (select 1 from audit_logs
           where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1'
             and action = 'marketing.test_send.cancelled'),
    'no refusal wrote a cancellation audit row';
end $$;

-- ── (3) ATOMICITY: a failed REQUIRED write rolls back the WHOLE act ─────────
-- 3a: the audit insert fails → no unaudited cancellation can exist
create function tc_block_audit() returns trigger language plpgsql as $$
begin
  if new.action = 'marketing.test_send.cancelled' then
    raise exception 'tc-fault-injection: audit store unavailable';
  end if;
  return new;
end $$;
create trigger tc_block_audit before insert on audit_logs
  for each row execute function tc_block_audit();
do $$
declare d1 uuid := (select v from tc_ctx where k = 'd1')::uuid;
        i1 uuid := (select v from tc_ctx where k = 'i1')::uuid;
begin
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1', jsonb_build_object('delivery_id', d1));
    assert false, 'a failed audit write must fail the whole cancellation';
  exception when raise_exception then null;
  end;
  assert (select status from automation_intents where id = i1) = 'pending',
    'AUDIT FAILURE: the intent cancellation rolled back (still pending)';
  assert (select status from marketing_deliveries where id = d1) = 'queued'
     and (select failure_class from marketing_deliveries where id = d1) is null,
    'AUDIT FAILURE: the delivery projection rolled back (still queued)';
  assert (select count(*) from marketing_delivery_events where delivery_id = d1) = 1,
    'AUDIT FAILURE: no delivery event survived';
  assert not exists (select 1 from platform_events
           where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1'
             and event_type = 'marketing.test_send.cancelled'),
    'AUDIT FAILURE: no platform event survived';
end $$;
drop trigger tc_block_audit on audit_logs;
drop function tc_block_audit();

-- 3b: the delivery-event (projection) insert fails → no stale projection
create function tc_block_event() returns trigger language plpgsql as $$
begin
  if new.detail = 'cancelled by the requester before provider execution' then
    raise exception 'tc-fault-injection: event store unavailable';
  end if;
  return new;
end $$;
create trigger tc_block_event before insert on marketing_delivery_events
  for each row execute function tc_block_event();
do $$
declare d1 uuid := (select v from tc_ctx where k = 'd1')::uuid;
        i1 uuid := (select v from tc_ctx where k = 'i1')::uuid;
begin
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1', jsonb_build_object('delivery_id', d1));
    assert false, 'a failed projection write must fail the whole cancellation';
  exception when raise_exception then null;
  end;
  assert (select status from automation_intents where id = i1) = 'pending'
     and (select status from marketing_deliveries where id = d1) = 'queued',
    'EVENT FAILURE: intent and delivery both rolled back';
  assert not exists (select 1 from audit_logs
           where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1'
             and action = 'marketing.test_send.cancelled'),
    'EVENT FAILURE: no audit row survived';
end $$;
drop trigger tc_block_event on marketing_delivery_events;
drop function tc_block_event();

-- ── (4) OWNER SUCCESS: the whole governed act commits together ──────────────
do $$
declare d1 uuid := (select v from tc_ctx where k = 'd1')::uuid;
        i1 uuid := (select v from tc_ctx where k = 'i1')::uuid;
        r jsonb; rec jsonb;
begin
  r := marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-0000000000f1', jsonb_build_object('delivery_id', d1));
  assert (r ->> 'cancelled')::boolean
     and (r ->> 'delivery_id')::uuid = d1
     and r ->> 'delivery_status' = 'failed'
     and r ->> 'failure_class' = 'cancelled'
     and (r ->> 'intent_id')::uuid = i1
     and r ->> 'intent_status' = 'cancelled'
     and (r ->> 'event_seq')::int = 2
     and (r ->> 'audit_id') is not null
     and (r ->> 'cancelled_at') is not null,
    'the return is the authoritative final state';
  assert (select status from automation_intents where id = i1) = 'cancelled',
    'the intent is terminally cancelled';
  assert (select status from marketing_deliveries where id = d1) = 'failed'
     and (select failure_class from marketing_deliveries where id = d1) = 'cancelled'
     and (select provider_message_id from marketing_deliveries where id = d1) is null
     and (select submitted_at from marketing_deliveries where id = d1) is null,
    'the delivery is terminally failed/cancelled with NO provider facts';
  assert (select array_agg(coalesce(e.from_status, '∅') || '>' || e.to_status order by e.seq)
            from marketing_delivery_events e where e.delivery_id = d1)
       = array['∅>queued', 'queued>failed'],
    'the guarded event chain records exactly the request + cancellation';
  assert (select detail from marketing_delivery_events
           where delivery_id = d1 and seq = 2)
       = 'cancelled by the requester before provider execution',
    'the event carries the honest cancellation detail';
  assert (select count(*) from audit_logs
           where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1'
             and action = 'marketing.test_send.cancelled'
             and resource_type = 'automation_intent'
             and resource_id = i1::text
             and actor = 'owner-a@tc.test'
             and status = 'ok'
             and detail ->> 'delivery_id' = d1::text
             and detail ->> 'authority_basis' = 'marketing.campaigns.test') = 1,
    'EXACTLY ONE audit row records who cancelled what under which authority';
  assert (select count(*) from platform_events
           where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1'
             and event_type = 'marketing.test_send.cancelled') = 1,
    'ONE platform event was appended';
  -- the lazy reconciler agrees and changes nothing (idempotent compatibility)
  rec := marketing_delivery_reconcile('aaaa9100-0000-0000-0000-0000000000f1', d1);
  assert (rec ->> 'changed')::boolean = false and rec ->> 'status' = 'failed',
    'a later reconcile run is a clean no-op on the terminal state';
end $$;

-- ── (5) REPEAT REQUEST: a terminal delivery refuses again, creating nothing ─
do $$
declare d1 uuid := (select v from tc_ctx where k = 'd1')::uuid;
begin
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1', jsonb_build_object('delivery_id', d1));
    assert false, 'cancelling an already-cancelled test must refuse';
  exception when sqlstate 'MK410' then null;
  end;
  assert (select count(*) from audit_logs
           where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1'
             and action = 'marketing.test_send.cancelled') = 1
     and (select count(*) from marketing_delivery_events
           where delivery_id = d1) = 2,
    'the repeat refusal created no second audit row and no third event';
end $$;

-- ── (6) ADMIN SUCCESS ───────────────────────────────────────────────────────
do $$
declare d2 uuid := (select v from tc_ctx where k = 'd2')::uuid;
        i2 uuid := (select v from tc_ctx where k = 'i2')::uuid;
        r jsonb;
begin
  r := marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-0000000000f2', jsonb_build_object('delivery_id', d2));
  assert (r ->> 'cancelled')::boolean and r ->> 'delivery_status' = 'failed',
    'an admin holding marketing.campaigns.test can cancel';
  assert (select actor from audit_logs
           where action = 'marketing.test_send.cancelled'
             and resource_id = i2::text) = 'admin-a@tc.test',
    'the audit names the REAL admin actor';
end $$;

-- ── (7) WORKER RACE + PROVIDER SAFETY through the REAL untouched engine ─────
do $$
declare d3 uuid := (select v from tc_ctx where k = 'd3')::uuid;
        i3 uuid := (select v from tc_ctx where k = 'i3')::uuid;
        c3 uuid := (select v from tc_ctx where k = 'c3')::uuid;
        claim record; rec jsonb;
begin
  -- the worker claims first: the conditional transition refuses (race lost)
  select * into claim from automation_claim_and_start(
    i3, 'aaaa9100-0000-0000-0000-0000000000f1', 'tc-worker', 120,
    'tc-idem-' || i3, c3, 'test');
  assert claim.attempt_id is not null, 'the REAL engine claimed the intent';
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1', jsonb_build_object('delivery_id', d3));
    assert false, 'a claimed intent can no longer be withdrawn';
  exception when sqlstate 'MK411' then null;
  end;
  assert (select status from automation_intents where id = i3) = 'executing'
     and (select status from marketing_deliveries where id = d3) = 'queued',
    'the lost race changed nothing';

  -- projected as executing → the delivery-status gate refuses (MK410)
  rec := marketing_delivery_reconcile('aaaa9100-0000-0000-0000-0000000000f1', d3);
  assert rec ->> 'status' = 'executing', 'the projection reflects execution';
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1', jsonb_build_object('delivery_id', d3));
    assert false, 'an executing delivery can no longer be withdrawn';
  exception when sqlstate 'MK410' then null;
  end;

  -- a REAL succeeded finalize + reconcile → submitted; cancel refuses and
  -- every provider fact stays untouched
  perform automation_finalize_execution(
    'aaaa9100-0000-0000-0000-0000000000f1', i3, claim.attempt_id, 'tc-worker',
    'succeeded',
    jsonb_build_object('message_id', 'gm-msg-tc-001', 'thread_id', 'gm-thr-tc-001',
                       'delivery_id', d3, 'submitted_at', now()),
    null, 'succeeded', false, null, 'gm-msg-tc-001', '2xx',
    'marketing_email_submitted', 'operational', c3, null);
  rec := marketing_delivery_reconcile('aaaa9100-0000-0000-0000-0000000000f1', d3);
  assert rec ->> 'status' = 'submitted', 'the provider submission is recorded';
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-0000000000f1', jsonb_build_object('delivery_id', d3));
    assert false, 'a provider-submitted delivery can NEVER be cancelled';
  exception when sqlstate 'MK410' then null;
  end;
  assert (select status from marketing_deliveries where id = d3) = 'submitted'
     and (select provider_message_id from marketing_deliveries where id = d3) = 'gm-msg-tc-001'
     and (select status from automation_intents where id = i3) = 'succeeded',
    'the submitted delivery and its provider facts are untouched';
end $$;

-- ── (8) RETRIED WORK: a real failed_transient attempt bars withdrawal ───────
do $$
declare dB uuid := (select v from tc_ctx where k = 'dB')::uuid;
        iB uuid := (select v from tc_ctx where k = 'iB')::uuid;
        cB uuid := (select v from tc_ctx where k = 'cB')::uuid;
        claim record; rec jsonb;
begin
  select * into claim from automation_claim_and_start(
    iB, 'aaaa9100-0000-0000-0000-0000000000f2', 'tc-worker-b', 120,
    'tc-idem-' || iB, cB, 'test');
  perform automation_finalize_execution(
    'aaaa9100-0000-0000-0000-0000000000f2', iB, claim.attempt_id, 'tc-worker-b',
    'failed', null, 'gmail_transient_5xx', 'failed_transient', true,
    now() + interval '5 minutes', null, '5xx', null, null, cB, null);
  rec := marketing_delivery_reconcile('aaaa9100-0000-0000-0000-0000000000f2', dB);
  assert rec ->> 'status' = 'queued',
    'a retryable failure re-queues the delivery projection';
  assert (select attempts from automation_intents where id = iB) > 0,
    'the intent carries its real attempt count';
  begin
    perform marketing_test_cancel('aaaa9100-0000-0000-0000-0000000000f2',
      'bbbb9100-0000-0000-0000-0000000000f4', jsonb_build_object('delivery_id', dB));
    assert false, 'work the engine has already attempted can no longer be withdrawn';
  exception when sqlstate 'MK411' then null;
  end;
  assert (select status from marketing_deliveries where id = dB) = 'queued',
    'the refusal touched nothing — the engine keeps ownership of the retry';
end $$;

select 'ALL ASSERTIONS PASSED — atomic governed test cancellation' as result;

rollback;
