-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_senders.test.sql
--
-- Proves Marketing Phase 4 (migration 20260901120000) AFTER the correctness/
-- security pass: sources honesty (stored-grant Gmail scope truth, DWD units
-- excluded, PER-MAILBOX connection reporting under multiple Workspace
-- connections); sender lifecycle (canonical owner/admin + senders.manage gate,
-- hostile-grant inertness, exact shapes, WRITE-TIME header-field validation,
-- MK409 concurrency, duplicate idempotency, immutable source lineage,
-- creator/updater composite tenant binding, no client delete); CANONICAL LIVE
-- READINESS (authoritative source facts drive enablement, capability sync and
-- test-send acceptance — revoked scope/auth/token/source/connection each make
-- the path truthfully un-executable); HONEST TEST-SEND AUTHORITY (an explicit
-- delegated request under marketing.campaigns.test: decision
-- AUTOMATION_AUTHORISED, no review routing, requiresApproval false, and NO
-- automation_approvals row exists or is fabricated — while the FUTURE
-- broadcast approval boundary stays distinct because the frozen engine still
-- demands approval wherever a package or intent type requires it); REQUEST
-- FINGERPRINT idempotency (same id + byte-equivalent request converges; same
-- id + ANY differing frozen input → stable MK412 with ZERO new rows); STRICT
-- marketing_test_send_status contract at the DB boundary; CANONICAL LIVE
-- READINESS is EXACT (auth_state must be EXACTLY 'ok' — unknown/null/revoked
-- are never ready; gmail.send matched as a whole whitespace token — fake
-- suffix scopes never authorise) and capability truth is SELF-REFRESHING
-- (source-table triggers re-derive capability on scope/auth/status/token/
-- connection/mailbox change — the degradation battery NEVER calls
-- marketing_sender_capability_sync manually); END-TO-END through
-- the REAL UNTOUCHED engine RPCs (claim → finalize succeeded/failed/unknown
-- with STUBBED provider results — no network, no email) with: the FROZEN
-- envelope surviving sender edits, FACTUAL delivery transitions AND INSERTS
-- (fabricated submission structurally impossible even for the service role —
-- a delivery is BORN queued with no execution/provider/failure facts and must
-- agree with its PENDING test intent's frozen envelope; wrong intent/tenant/
-- failed attempts, mismatched provider ids, terminal-fact rewrites and
-- attempt swaps without a factual transition all rejected),
-- delivery EVENTS composite-bound to the delivery's EXACT intent and
-- same-intent attempt with a guarded truthful chain (actual to_status,
-- delivery's own attempt, single null→queued initial event, unbroken
-- from_status lineage — fictional history impossible),
-- write-once provider facts, canonical outbound email_messages convergence
-- with composite-FK provenance, the standard interactions.sync job enqueued
-- deterministically on confirmed submission (idempotent against the active-key
-- index) and a test-side SIMULATION of the canonical projector proving
-- one-Interaction convergence (the projector itself is the only production
-- writer); failed/unknown produce NO canonical email row and NO projection
-- job; unknown freezes and resolves only by APPENDED reconciliation;
-- append-only delivery events; cross-tenant lineage structurally impossible
-- for EVERY new reference; observability; service-role-only boundaries;
-- tenant cascade cleanup.
begin;

insert into tenants (id, slug, display_name, industry) values
  ('aaaa4000-0000-0000-0000-0000000000f1','p4-t1','Phase4 Tenant 1','hvac'),
  ('aaaa4000-0000-0000-0000-0000000000f2','p4-t2','Phase4 Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb4000-0000-0000-0000-0000000000f1','owner-a@p4.test',false,false),
  ('bbbb4000-0000-0000-0000-0000000000f2','ops-a@p4.test',false,false),
  ('bbbb4000-0000-0000-0000-0000000000f3','viewer-a@p4.test',false,false),
  ('bbbb4000-0000-0000-0000-0000000000f4','recipient-a@p4.test',false,false),
  ('bbbb4000-0000-0000-0000-0000000000f5','admin-b@p4.test',false,false),
  ('bbbb4000-0000-0000-0000-0000000000f6','noemail-a@p4.test',false,false);
update profiles set role='owner',  tenant_id='aaaa4000-0000-0000-0000-0000000000f1' where id='bbbb4000-0000-0000-0000-0000000000f1';
update profiles set role='ops',    tenant_id='aaaa4000-0000-0000-0000-0000000000f1' where id='bbbb4000-0000-0000-0000-0000000000f2';
update profiles set role='viewer', tenant_id='aaaa4000-0000-0000-0000-0000000000f1' where id='bbbb4000-0000-0000-0000-0000000000f3';
update profiles set role='ops',    tenant_id='aaaa4000-0000-0000-0000-0000000000f1' where id='bbbb4000-0000-0000-0000-0000000000f4';
update profiles set role='admin',  tenant_id='aaaa4000-0000-0000-0000-0000000000f2' where id='bbbb4000-0000-0000-0000-0000000000f5';
update profiles set role='ops',    tenant_id='aaaa4000-0000-0000-0000-0000000000f1', email=null where id='bbbb4000-0000-0000-0000-0000000000f6';

select marketing_materialise_defaults('aaaa4000-0000-0000-0000-0000000000f1','bbbb4000-0000-0000-0000-0000000000f1');
select marketing_materialise_defaults('aaaa4000-0000-0000-0000-0000000000f2','bbbb4000-0000-0000-0000-0000000000f5');

-- email sources: A1 gmail active WITHOUT send scope; A2 gmail active WITH send
-- scope; A3 a DWD sync unit (must never appear as an OAuth source); A4 foreign
insert into email_accounts (id, tenant_id, provider, email_address, status, auth_state) values
  ('eeee4000-0000-0000-0000-0000000000a1','aaaa4000-0000-0000-0000-0000000000f1','gmail','readonly@p4-t1.test','active','ok'),
  ('eeee4000-0000-0000-0000-0000000000a2','aaaa4000-0000-0000-0000-0000000000f1','gmail','sender@p4-t1.test','active','ok'),
  ('eeee4000-0000-0000-0000-0000000000a3','aaaa4000-0000-0000-0000-0000000000f1','gmail','dwdunit@p4-t1.test','active_dwd','unknown'),
  ('eeee4000-0000-0000-0000-0000000000a4','aaaa4000-0000-0000-0000-0000000000f2','gmail','foreign@p4-t2.test','active','ok');
insert into email_oauth_tokens (tenant_id, email_account_id, provider, access_token, refresh_token, expires_at, scope) values
  ('aaaa4000-0000-0000-0000-0000000000f1','eeee4000-0000-0000-0000-0000000000a1','gmail','tok','ref', now() + interval '1 hour',
   'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email'),
  ('aaaa4000-0000-0000-0000-0000000000f1','eeee4000-0000-0000-0000-0000000000a2','gmail','tok','ref', now() + interval '1 hour',
   'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send');

-- TWO Workspace connections in DIFFERENT states (finding 9): C1 stays active,
-- C2 is set to error AFTER its sender exists
insert into google_workspace_connections (id, tenant_id, domain, status) values
  ('cccc4000-0000-0000-0000-0000000000c1','aaaa4000-0000-0000-0000-0000000000f1','p4-t1.test','active'),
  ('cccc4000-0000-0000-0000-0000000000c2','aaaa4000-0000-0000-0000-0000000000f1','p4-t1-b.test','active');
insert into google_workspace_mailboxes (id, tenant_id, connection_id, email_address, status, sync_enabled) values
  ('dddd4000-0000-0000-0000-0000000000d1','aaaa4000-0000-0000-0000-0000000000f1','cccc4000-0000-0000-0000-0000000000c1','ws-sender@p4-t1.test','active',true),
  ('dddd4000-0000-0000-0000-0000000000d2','aaaa4000-0000-0000-0000-0000000000f1','cccc4000-0000-0000-0000-0000000000c1','removed@p4-t1.test','removed',false),
  ('dddd4000-0000-0000-0000-0000000000d3','aaaa4000-0000-0000-0000-0000000000f1','cccc4000-0000-0000-0000-0000000000c2','ws-b@p4-t1-b.test','active',true);

-- ── (1) SOURCES: evidence-led; per-mailbox connection truth ─────────────────
do $$
declare r jsonb; g jsonb; w jsonb;
begin
  r := marketing_sender_sources('aaaa4000-0000-0000-0000-0000000000f1');
  select value into g from jsonb_array_elements(r -> 'gmail_accounts') e(value)
   where value ->> 'source_id' = 'eeee4000-0000-0000-0000-0000000000a1';
  assert g is not null and (g ->> 'has_send_scope')::boolean = false
     and (g ->> 'scope_known')::boolean = true,
    'A1: send scope honestly reported missing from the STORED grant';
  select value into g from jsonb_array_elements(r -> 'gmail_accounts') e(value)
   where value ->> 'source_id' = 'eeee4000-0000-0000-0000-0000000000a2';
  assert g is not null and (g ->> 'has_send_scope')::boolean = true,
    'A2: granted send scope reported from the stored token';
  assert not exists (select 1 from jsonb_array_elements(r -> 'gmail_accounts') e(value)
                      where value ->> 'source_id' = 'eeee4000-0000-0000-0000-0000000000a3'),
    'a DWD sync unit is never offered as an OAuth source';
  assert not exists (select 1 from jsonb_array_elements(r -> 'gmail_accounts') e(value)
                      where value ->> 'source_id' = 'eeee4000-0000-0000-0000-0000000000a4'),
    'foreign-tenant accounts never leak';
  select value into w from jsonb_array_elements(r -> 'workspace_mailboxes') e(value)
   where value ->> 'source_id' = 'dddd4000-0000-0000-0000-0000000000d1';
  assert w is not null
     and w ->> 'connection_id' = 'cccc4000-0000-0000-0000-0000000000c1',
    'each mailbox reports ITS OWN connection';
  assert not exists (select 1 from jsonb_array_elements(r -> 'workspace_mailboxes') e(value)
                      where value ->> 'source_id' = 'dddd4000-0000-0000-0000-0000000000d2'),
    'removed mailbox is not offered';
  assert jsonb_array_length(r -> 'workspace_connections') = 2,
    'every Workspace connection is listed';
end $$;

-- ── (2) SENDER CREATE: canonical gate, shapes, WRITE-TIME validation ─────────
do $$
declare r jsonb; sid uuid;
begin
  begin
    perform marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f2',
      '{"source_kind":"gmail_oauth","source_id":"eeee4000-0000-0000-0000-0000000000a2"}');
    assert false, 'ops actor must be denied sender creation';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f3',
      '{"source_kind":"gmail_oauth","source_id":"eeee4000-0000-0000-0000-0000000000a2"}');
    assert false, 'viewer actor must be denied sender creation';
  exception when sqlstate '42501' then null;
  end;
  -- a HOSTILE raw senders.manage grant to a viewer stays inert (resolver ceiling)
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa4000-0000-0000-0000-0000000000f1','bbbb4000-0000-0000-0000-0000000000f3',
          'marketing.senders.manage', true, 'bbbb4000-0000-0000-0000-0000000000f1');
  begin
    perform marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f3',
      '{"source_kind":"gmail_oauth","source_id":"eeee4000-0000-0000-0000-0000000000a2"}');
    assert false, 'hostile raw grant must not bypass the owner/admin ceiling';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f5',
      '{"source_kind":"gmail_oauth","source_id":"eeee4000-0000-0000-0000-0000000000a2"}');
    assert false, 'cross-tenant actor must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  begin
    perform marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f1',
      '{"source_kind":"gmail_oauth","source_id":"eeee4000-0000-0000-0000-0000000000a2","sneaky":1}');
    assert false, 'unknown create key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- WRITE-TIME header-field validation (finding 10): CR/LF + control chars +
  -- malformed reply-to are rejected at create, not just before sending
  begin
    perform marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f1',
      jsonb_build_object('source_kind','gmail_oauth',
        'source_id','eeee4000-0000-0000-0000-0000000000a2',
        'from_name', e'Evil\r\nBcc: victim@x.test'));
    assert false, 'CR/LF in from_name must be rejected at write time';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f1',
      jsonb_build_object('source_kind','gmail_oauth',
        'source_id','eeee4000-0000-0000-0000-0000000000a2',
        'reply_to','not-an-address'));
    assert false, 'a malformed reply_to must be rejected at write time';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f1',
      '{"source_kind":"gmail_oauth","source_id":"eeee4000-0000-0000-0000-0000000000a4"}');
    assert false, 'foreign-tenant account must be P0002';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f1',
      '{"source_kind":"gmail_oauth","source_id":"eeee4000-0000-0000-0000-0000000000a3"}');
    assert false, 'a DWD sync unit must not be authorisable as an OAuth sender';
  exception when sqlstate 'P0002' then null;
  end;
  -- create from the GRANTED account: scope evidence applied immediately
  r := marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
        'bbbb4000-0000-0000-0000-0000000000f1',
        '{"source_kind":"gmail_oauth","source_id":"eeee4000-0000-0000-0000-0000000000a2","label":"Main sender","from_name":"Drummonds Marketing"}');
  assert (r ->> 'created')::boolean and r ->> 'send_scope_state' = 'authorized',
    'granted send scope recognised from stored evidence at creation';
  sid := (r ->> 'id')::uuid;
  r := marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
        'bbbb4000-0000-0000-0000-0000000000f1',
        '{"source_kind":"gmail_oauth","source_id":"eeee4000-0000-0000-0000-0000000000a2"}');
  assert (r ->> 'created')::boolean = false and (r ->> 'id')::uuid = sid,
    'duplicate sender create returns the existing profile';
  -- workspace senders on BOTH connections + the scope-missing gmail account
  r := marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
        'bbbb4000-0000-0000-0000-0000000000f1',
        '{"source_kind":"workspace_dwd","source_id":"dddd4000-0000-0000-0000-0000000000d1"}');
  assert r ->> 'send_scope_state' = 'unknown',
    'DWD send scope is unknown until verified by a real token mint';
  perform marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f1',
    '{"source_kind":"workspace_dwd","source_id":"dddd4000-0000-0000-0000-0000000000d3"}');
  r := marketing_sender_create('aaaa4000-0000-0000-0000-0000000000f1',
        'bbbb4000-0000-0000-0000-0000000000f1',
        '{"source_kind":"gmail_oauth","source_id":"eeee4000-0000-0000-0000-0000000000a1"}');
  assert r ->> 'send_scope_state' = 'missing', 'missing send scope reported from the stored grant';
end $$;

-- the second connection degrades AFTER its sender exists
update google_workspace_connections set status = 'error'
 where id = 'cccc4000-0000-0000-0000-0000000000c2';

-- ── (3) STRUCTURE: composite tenant binding on EVERY reference ──────────────
do $$
declare sid uuid;
begin
  select id into sid from marketing_sender_profiles
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
     and email_account_id='eeee4000-0000-0000-0000-0000000000a2';
  begin
    insert into marketing_sender_profiles
      (tenant_id, source_kind, email_account_id, mailbox_address)
    values ('aaaa4000-0000-0000-0000-0000000000f1','gmail_oauth',
            'eeee4000-0000-0000-0000-0000000000a4','foreign@p4-t2.test');
    assert false, 'cross-tenant account reference must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  -- a FOREIGN-TENANT creator/updater is STRUCTURALLY impossible (uses a
  -- sender-less source row so only the creator FK can fire)
  begin
    insert into marketing_sender_profiles
      (tenant_id, source_kind, email_account_id, mailbox_address, created_by)
    values ('aaaa4000-0000-0000-0000-0000000000f1','gmail_oauth',
            'eeee4000-0000-0000-0000-0000000000a3','dwdunit@p4-t1.test',
            'bbbb4000-0000-0000-0000-0000000000f5');
    assert false, 'a foreign-tenant creator must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  begin
    update marketing_sender_profiles
       set updated_by = 'bbbb4000-0000-0000-0000-0000000000f5' where id = sid;
    assert false, 'a foreign-tenant updater must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  begin
    update marketing_sender_profiles
       set email_account_id = 'eeee4000-0000-0000-0000-0000000000a1' where id = sid;
    assert false, 're-pointing the source mailbox must be rejected';
  exception when raise_exception then null;
  end;
  begin
    update marketing_sender_profiles set mailbox_address = 'other@p4-t1.test' where id = sid;
    assert false, 'the mailbox address snapshot is immutable';
  exception when raise_exception then null;
  end;
  begin
    update marketing_sender_profiles
       set tenant_id = 'aaaa4000-0000-0000-0000-0000000000f2' where id = sid;
    assert false, 'a sender can never move tenants';
  exception when raise_exception then null;
  end;
  assert not has_table_privilege('authenticated', 'marketing_sender_profiles', 'delete')
     and not has_table_privilege('service_role', 'marketing_sender_profiles', 'delete')
     and not has_table_privilege('service_role', 'marketing_deliveries', 'delete')
     and not has_table_privilege('service_role', 'marketing_delivery_events', 'delete')
     and not has_table_privilege('service_role', 'marketing_delivery_events', 'update'),
    'hard deletion / event rewriting is not an operational action';
  -- CATALOG proof of the structural lineage (the guards fire before FK checks
  -- at runtime, so the exact composite shapes are asserted from the catalog):
  -- a delivery's attempt is bound to the SAME tenant AND SAME intent…
  assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'md_attempt_fk')
       ilike '%(tenant_id, automation_intent_id, execution_attempt_id)%references automation_execution_attempts(tenant_id, automation_intent_id, id)%',
    'md_attempt_fk composite-binds tenant AND intent';
  -- …a delivery EVENT is bound to its delivery''s EXACT intent…
  assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'mde_delivery_fk')
       ilike '%(tenant_id, delivery_id, automation_intent_id)%references marketing_deliveries(tenant_id, id, automation_intent_id)%',
    'mde_delivery_fk composite-binds the delivery AND its exact intent';
  -- …and an event''s attempt is bound to that SAME tenant + SAME intent
  assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'mde_attempt_fk')
       ilike '%(tenant_id, automation_intent_id, execution_attempt_id)%references automation_execution_attempts(tenant_id, automation_intent_id, id)%',
    'mde_attempt_fk composite-binds tenant AND intent for cited attempts';
  -- OAuth tokens are STRUCTURALLY tenant-bound to their account. The FK is
  -- MANDATORY (the migration fails loudly rather than skip it), scoped to
  -- the exact table, and VALIDATED — never NOT VALID.
  assert (select pg_get_constraintdef(oid) from pg_constraint
           where conname = 'email_oauth_tokens_account_tenant_fk'
             and conrelid = 'public.email_oauth_tokens'::regclass)
       ilike '%(tenant_id, email_account_id)%references email_accounts(tenant_id, id)%',
    'email_oauth_tokens is composite tenant-bound to its account';
  assert (select convalidated from pg_constraint
           where conname = 'email_oauth_tokens_account_tenant_fk'
             and conrelid = 'public.email_oauth_tokens'::regclass),
    'the token tenant FK is VALIDATED, not merely declared';
  -- and the invariant bites: a token disagreeing with its account's tenant
  -- can never exist
  begin
    -- a3 holds no token, so the composite FK is the ONLY thing that can fire
    insert into email_oauth_tokens (tenant_id, email_account_id, provider, access_token)
    values ('aaaa4000-0000-0000-0000-0000000000f2',
            'eeee4000-0000-0000-0000-0000000000a3', 'gmail', 'tok');
    assert false, 'a token with a foreign tenant must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  begin
    update email_oauth_tokens set tenant_id = 'aaaa4000-0000-0000-0000-0000000000f2'
     where email_account_id = 'eeee4000-0000-0000-0000-0000000000a1';
    assert false, 'moving a token to a foreign tenant must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
end $$;

-- ── (4) REGISTRATION HONESTY: delegated test authority, ZERO enablement ─────
do $$
begin
  assert exists (select 1 from automation_connector_capabilities
                  where capability_key = 'email.send_marketing'
                    and external_side_effect and risk_category = 'high'),
    'capability registered with external_side_effect=true, risk high';
  assert exists (select 1 from automation_capability_contracts
                  where capability_key = 'email.send_marketing'
                    and outcome_type = 'marketing_email_submitted'
                    and outcome_layer = 'operational' and enabled),
    'capability outcome contract registered (operational — submitted, not delivered)';
  assert exists (select 1 from automation_intent_types
                  where intent_type = 'send_marketing_test_email'
                    and connector_capability = 'email.send_marketing'
                    and external_side_effect and risk_category = 'high'
                    and NOT requires_approval
                    and not supports_status_lookup and enabled),
    'TEST intent type registered: delegated authority (no approval), NO status-lookup claim';
  assert not exists (select 1 from automation_intent_types
                      where intent_type = 'send_marketing_email'),
    'no bulk/broadcast send intent type exists — Phase 5 must register its own';
  -- (scoped to the fixture tenants so local proof-DB residue from earlier
  -- legitimate sender actions cannot mask the claim; the clean-chain run of
  -- this suite proves the GLOBAL zero-seed truth on a fresh database)
  assert not exists (select 1 from tenant_connector_capabilities
                      where capability_key = 'email.send_marketing'
                        and tenant_id in ('aaaa4000-0000-0000-0000-0000000000f1',
                                          'aaaa4000-0000-0000-0000-0000000000f2')),
    'NO tenant is enabled by the migration — enablement is an explicit sender action';
end $$;

-- ── (5) READINESS drives enable/capability; per-mailbox connection truth ─────
do $$
declare g uuid; m uuid; w uuid; w2 uuid; r jsonb; t timestamptz; v int; hist int;
begin
  select id into g from marketing_sender_profiles
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
     and email_account_id='eeee4000-0000-0000-0000-0000000000a2';
  select id into m from marketing_sender_profiles
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
     and email_account_id='eeee4000-0000-0000-0000-0000000000a1';
  select id into w from marketing_sender_profiles
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
     and workspace_mailbox_id='dddd4000-0000-0000-0000-0000000000d1';
  select id into w2 from marketing_sender_profiles
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
     and workspace_mailbox_id='dddd4000-0000-0000-0000-0000000000d3';

  -- LIVE readiness from authoritative source state
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'ready',
    'granted+active gmail sender is ready';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', m) ->> 'state') = 'send_scope_missing',
    'scope-missing gmail sender is honestly not ready';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', w) ->> 'state') = 'send_scope_unverified',
    'unverified DWD sender is honestly not ready';
  -- finding 9: each DWD sender reads ITS OWN connection
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', w2) ->> 'state') = 'connection_inactive',
    'a sender on the DEGRADED connection reports connection_inactive';
  perform marketing_sender_record_verification('aaaa4000-0000-0000-0000-0000000000f1',
    w, 'authorized', 'Delegated gmail.send token minted for this mailbox', now());
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', w) ->> 'state') = 'ready',
    'the sender on the HEALTHY connection is unaffected by the degraded one';

  -- enable requires CURRENT readiness, not cached columns
  select updated_at into t from marketing_sender_profiles where id = m;
  begin
    perform marketing_sender_set_enabled('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f1', m, true, t);
    assert false, 'enabling a not-ready sender must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  select updated_at into t from marketing_sender_profiles where id = g;
  begin
    perform marketing_sender_set_enabled('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f1', g, true, t - interval '1 hour');
    assert false, 'stale sender token must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  perform marketing_sender_set_enabled('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f1', g, true, t);
  assert (select enabled from tenant_connector_capabilities
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
             and connector_id='google-gmail' and capability_key='email.send_marketing'),
    'capability enabled by the explicit READY-sender action';
  assert (select health_status from tenant_connectors
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
             and connector_id='google-gmail') = 'healthy',
    'connector health backed by a READY sender, not a bare enabled row';

  -- ═══ AUTHORITATIVE degradation — SELF-REFRESHING capability truth ═══
  -- Every assertion below follows a mutation of AUTHORITATIVE SOURCE STATE
  -- only. NO manual marketing_sender_capability_sync call appears anywhere in
  -- this battery: the source-table triggers must re-derive capability truth
  -- in the same transaction, or these assertions fail.
  update email_oauth_tokens set scope = 'https://www.googleapis.com/auth/gmail.readonly'
   where email_account_id = 'eeee4000-0000-0000-0000-0000000000a2';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'send_scope_missing',
    'live readiness reflects the revoked scope immediately';
  assert not coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false)
     and (select health_status from tenant_connectors
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
             and connector_id='google-gmail') = 'unknown',
    'scope loss disables the capability + downgrades health WITHOUT a manual sync';
  -- EXACT whitespace-token matching: a superstring scope is NEVER authorisation
  update email_oauth_tokens
     set scope = 'https://www.googleapis.com/auth/gmail.send.extra https://www.googleapis.com/auth/gmail.sendfoo'
   where email_account_id = 'eeee4000-0000-0000-0000-0000000000a2';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'send_scope_missing',
    'a fake scope suffix is never send authorisation (exact token match)';
  assert not coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'a fake scope suffix never enables the capability';
  -- restoring the EXACT scope re-enables through the same trigger path
  update email_oauth_tokens
     set scope = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'
   where email_account_id = 'eeee4000-0000-0000-0000-0000000000a2';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'ready'
     and coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'restoring the exact granted scope re-enables the capability (trigger-driven)';
  -- auth_state truth: ONLY the authoritative 'ok' is authorisation
  update email_accounts set auth_state='unknown' where id='eeee4000-0000-0000-0000-0000000000a2';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'auth_invalid',
    'auth_state unknown is NOT ready';
  assert not coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'auth_state unknown disables the capability (trigger-driven)';
  -- (auth_state is NOT NULL by schema, so a null value is structurally
  -- impossible; the readiness check still uses IS DISTINCT FROM 'ok', so an
  -- unrecognised vocabulary value is equally NOT authorisation:)
  update email_accounts set auth_state='some_future_state'
   where id='eeee4000-0000-0000-0000-0000000000a2';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'auth_invalid',
    'an unrecognised auth_state is NOT ready';
  update email_accounts set auth_state='revoked' where id='eeee4000-0000-0000-0000-0000000000a2';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'auth_invalid',
    'revoked authorisation is not ready';
  update email_accounts set auth_state='ok', status='disabled'
   where id='eeee4000-0000-0000-0000-0000000000a2';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'source_inactive',
    'a disabled account is not ready';
  assert not coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'account disablement keeps the capability off (trigger-driven)';
  update email_accounts set status='active' where id='eeee4000-0000-0000-0000-0000000000a2';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'ready'
     and coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'restoring account + auth state re-enables the capability (trigger-driven)';
  delete from email_oauth_tokens where email_account_id='eeee4000-0000-0000-0000-0000000000a2';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'token_missing',
    'a lost token is not ready';
  assert not coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'token deletion disables the capability (trigger-driven)';
  -- restore the healthy grant: the token INSERT trigger re-derives capability
  insert into email_oauth_tokens (tenant_id, email_account_id, provider, access_token, refresh_token, expires_at, scope)
  values ('aaaa4000-0000-0000-0000-0000000000f1','eeee4000-0000-0000-0000-0000000000a2','gmail','tok','ref',
          now() + interval '1 hour',
          'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'ready'
     and coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'restoring the stored grant re-enables the capability (trigger-driven, no manual sync)';

  -- ═══ Workspace source triggers + per-sender isolation ═══
  select updated_at into t from marketing_sender_profiles where id = w;
  perform marketing_sender_set_enabled('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f1', w, true, t);
  -- degrade the HEALTHY connection: ONLY its own sender loses readiness; the
  -- capability stays on through the still-ready gmail sender
  update google_workspace_connections set status='error'
   where id = 'cccc4000-0000-0000-0000-0000000000c1';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', w) ->> 'state') = 'connection_inactive'
     and (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', g) ->> 'state') = 'ready'
     and coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'a degraded Workspace connection affects ONLY its own sender';
  -- with the gmail sender disabled, that same connection change alone decides
  -- capability truth — trigger-driven, no manual sync
  select updated_at into t from marketing_sender_profiles where id = g;
  perform marketing_sender_set_enabled('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f1', g, false, t);
  assert not coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'no ready enabled sender remains → capability off';
  update google_workspace_connections set status='active'
   where id = 'cccc4000-0000-0000-0000-0000000000c1';
  assert coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'connection restoration re-enables via the Workspace sender alone (trigger-driven)';
  update google_workspace_mailboxes set status='suspended'
   where id = 'dddd4000-0000-0000-0000-0000000000d1';
  assert (marketing_sender_readiness('aaaa4000-0000-0000-0000-0000000000f1', w) ->> 'state') = 'source_inactive'
     and not coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'mailbox suspension disables the capability (trigger-driven)';
  update google_workspace_mailboxes set status='active'
   where id = 'dddd4000-0000-0000-0000-0000000000d1';
  assert coalesce((select enabled from tenant_connector_capabilities
               where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                 and connector_id='google-gmail' and capability_key='email.send_marketing'), false),
    'mailbox restoration re-enables the capability (trigger-driven)';
  -- restore the fixture shape for the rest of the suite: w disabled, g enabled
  select updated_at into t from marketing_sender_profiles where id = w;
  perform marketing_sender_set_enabled('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f1', w, false, t);
  select updated_at into t from marketing_sender_profiles where id = g;
  perform marketing_sender_set_enabled('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f1', g, true, t);

  -- default: only an ENABLED sender; atomic + versioned into history
  select updated_at into t from marketing_sender_profiles where id = w;
  begin
    perform marketing_sender_set_default('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f1', w, t);
    assert false, 'a disabled sender can never become the default';
  exception when sqlstate '22023' then null;
  end;
  select version into v from marketing_settings
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1';
  select count(*) into hist from marketing_settings_history
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1';
  select updated_at into t from marketing_sender_profiles where id = g;
  r := marketing_sender_set_default('aaaa4000-0000-0000-0000-0000000000f1',
        'bbbb4000-0000-0000-0000-0000000000f1', g, t);
  assert (select default_sender_profile_id from marketing_settings
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1') = g
     and (select version from marketing_settings
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1') = v + 1
     and (select count(*) from marketing_settings_history
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1') = hist + 1,
    'default change is atomic, versioned and history-preserving';
  begin
    update marketing_settings set default_sender_profile_id = w
     where tenant_id='aaaa4000-0000-0000-0000-0000000000f1';
    assert false, 'settings trigger must reject a disabled default';
  exception when sqlstate '22023' then null;
  end;
  begin
    update marketing_sender_profiles set enabled = false where id = g;
    assert false, 'disabling the current default directly must be rejected';
  exception when sqlstate '22023' then null;
  end;
  select updated_at into t from marketing_sender_profiles where id = g;
  r := marketing_sender_set_enabled('aaaa4000-0000-0000-0000-0000000000f1',
        'bbbb4000-0000-0000-0000-0000000000f1', g, false, t);
  assert (r ->> 'default_cleared')::boolean
     and (select default_sender_profile_id from marketing_settings
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1') is null,
    'disabling the default sender clears the default atomically';
  assert (select count(*) from marketing_sender_profiles
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1') = 4,
    'disable/replace preserves every sender row (history survives)';
  -- re-enable + re-default for the test-send sections
  select updated_at into t from marketing_sender_profiles where id = g;
  perform marketing_sender_set_enabled('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f1', g, true, t);
  select updated_at into t from marketing_sender_profiles where id = g;
  perform marketing_sender_set_default('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f1', g, t);
  begin
    perform marketing_sender_record_verification('aaaa4000-0000-0000-0000-0000000000f1',
      w, 'totally_fine', null, null);
    assert false, 'verification state vocabulary is bounded';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ── (6) TEST SEND: delegated authority, fingerprint idempotency, strictness ──
do $$
declare g uuid; r jsonb; d uuid; i uuid; pkg jsonb; params jsonb; n int; nact int;
        ndec int; ndel int;
begin
  select id into g from marketing_sender_profiles
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
     and email_account_id='eeee4000-0000-0000-0000-0000000000a2';

  begin
    perform marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f3',
      jsonb_build_object('sender_id', g,
        'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f4',
        'subject', 'T', 'body_text', 'B', 'request_id', 'req-viewer-01'));
    assert false, 'viewer must be denied test sends';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f2',
      jsonb_build_object('sender_id', g,
        'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f4',
        'subject', 'T', 'body_text', 'B', 'request_id', 'req-x-01', 'to', 'evil@x.test'));
    assert false, 'unknown test-send key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f2',
      jsonb_build_object('sender_id', g,
        'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f4',
        'subject', e'evil\ninjected', 'body_text', 'B', 'request_id', 'req-x-02'));
    assert false, 'a subject control character must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f2',
      jsonb_build_object('sender_id', g,
        'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f5',
        'subject', 'T', 'body_text', 'B', 'request_id', 'req-x-03'));
    assert false, 'a foreign-tenant recipient must be rejected';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f2',
      jsonb_build_object('sender_id', g,
        'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f6',
        'subject', 'T', 'body_text', 'B', 'request_id', 'req-x-04'));
    assert false, 'a recipient without an email must be rejected';
  exception when sqlstate '22023' then null;
  end;

  -- happy path: FULL canonical lineage under HONEST delegated authority
  r := marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
        'bbbb4000-0000-0000-0000-0000000000f2',
        jsonb_build_object('sender_id', g,
          'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f4',
          'subject', 'Phase 4 governed test', 'body_text', 'Hello from the governed pipeline.',
          'request_id', 'req-main-0001'));
  d := (r ->> 'delivery_id')::uuid;
  i := (r ->> 'intent_id')::uuid;
  assert r ->> 'status' = 'queued' and not (r ->> 'idempotent')::boolean, 'request queued';

  select decision_package into pkg from decision_log
   where id = (select decision_id from automation_intents where id = i);
  assert pkg ->> 'decision' = 'AUTOMATION_AUTHORISED'
     and (pkg -> 'routing' ->> 'reviewRequired')::boolean = false
     and (pkg -> 'routing' ->> 'tenantReviewRequired')::boolean = false
     and (pkg -> 'automationIntent' ->> 'requiresApproval')::boolean = false
     and pkg -> 'risk' ->> 'level' = 'low'
     and pkg -> 'reversibility' ->> 'level' = 'irreversible'
     and pkg -> 'authority' ->> 'resolvedAuthorityHolder' = 'bbbb4000-0000-0000-0000-0000000000f2'
     and pkg -> 'rationale' -> 'policyMatches' ? 'marketing.campaigns.test',
    'the decision package is HONEST: delegated test authority, no review routing, IRREVERSIBLE';
  -- the frozen engine''s approval boundary is untouched: NO approval row
  -- exists and NONE was fabricated
  assert not exists (select 1 from automation_approvals
                      where tenant_id = 'aaaa4000-0000-0000-0000-0000000000f1'),
    'no automation_approvals row is fabricated for a delegated test send';
  select parameters into params from automation_intents where id = i;
  assert params ->> 'subject' = 'Phase 4 governed test'
     and params ->> 'recipient_email' = 'recipient-a@p4.test'
     and params ->> 'mailbox_address' = 'sender@p4-t1.test'
     and params ->> 'from_name' = 'Drummonds Marketing'
     and params ->> 'purpose' = 'test'
     and (params ->> 'delivery_id')::uuid = d,
    'the frozen envelope binds sender, recipient, content and delivery';
  assert (select intent_type from automation_intents where id = i) = 'send_marketing_test_email',
    'the TEST-ONLY intent type is used';
  assert (select approved_payload_hash from automation_intents where id = i)
       = automation_intent_envelope_hash('aaaa4000-0000-0000-0000-0000000000f1', i),
    'the authorised envelope hash is pinned for the claim-time integrity check';

  -- FINGERPRINT idempotency: byte-equivalent replay converges…
  r := marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
        'bbbb4000-0000-0000-0000-0000000000f2',
        jsonb_build_object('sender_id', g,
          'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f4',
          'subject', 'Phase 4 governed test', 'body_text', 'Hello from the governed pipeline.',
          'request_id', 'req-main-0001'));
  assert (r ->> 'idempotent')::boolean and (r ->> 'delivery_id')::uuid = d
     and (r ->> 'intent_id')::uuid = i,
    'the same request id + byte-equivalent request converges';
  -- …but the SAME id with a DIFFERENT frozen input is a stable conflict that
  -- creates NOTHING (no intent, delivery, action, decision or event)
  select count(*) into n from automation_intents
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
     and intent_type='send_marketing_test_email';
  select count(*) into nact from intelligence_objects
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1' and object_type='Action';
  select count(*) into ndec from decision_log
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1';
  select count(*) into ndel from marketing_deliveries
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1';
  begin
    perform marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f2',
      jsonb_build_object('sender_id', g,
        'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f4',
        'subject', 'Phase 4 governed test', 'body_text', 'DIFFERENT BODY',
        'request_id', 'req-main-0001'));
    assert false, 'a reused request id with different content must raise MK412';
  exception when sqlstate 'MK412' then null;
  end;
  begin
    perform marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f1',  -- DIFFERENT ACTOR
      jsonb_build_object('sender_id', g,
        'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f4',
        'subject', 'Phase 4 governed test', 'body_text', 'Hello from the governed pipeline.',
        'request_id', 'req-main-0001'));
    assert false, 'a reused request id with a different actor must raise MK412';
  exception when sqlstate 'MK412' then null;
  end;
  assert (select count(*) from automation_intents
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
             and intent_type='send_marketing_test_email') = n
     and (select count(*) from intelligence_objects
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1' and object_type='Action') = nact
     and (select count(*) from decision_log
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1') = ndec
     and (select count(*) from marketing_deliveries
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1') = ndel,
    'a fingerprint mismatch creates NOTHING';

  -- DB-backed rate limit: 3/minute per tenant
  perform marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f2',
    jsonb_build_object('sender_id', g,
      'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f4',
      'subject', 'RL 2', 'body_text', 'B', 'request_id', 'req-main-0002'));
  perform marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f2',
    jsonb_build_object('sender_id', g,
      'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f4',
      'subject', 'RL 3', 'body_text', 'B', 'request_id', 'req-main-0003'));
  begin
    perform marketing_test_send_request('aaaa4000-0000-0000-0000-0000000000f1',
      'bbbb4000-0000-0000-0000-0000000000f2',
      jsonb_build_object('sender_id', g,
        'recipient_profile_id', 'bbbb4000-0000-0000-0000-0000000000f4',
        'subject', 'RL 4', 'body_text', 'B', 'request_id', 'req-main-0004'));
    assert false, 'the 4th test send inside a minute must be rate limited';
  exception when sqlstate 'MK429' then null;
  end;

  -- STRICT status contract at the DATABASE boundary
  begin
    perform marketing_test_send_status('aaaa4000-0000-0000-0000-0000000000f1', 'null'::jsonb);
    assert false, 'non-object args must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_test_send_status('aaaa4000-0000-0000-0000-0000000000f1',
      '{"limit": 10, "sneaky": true}'::jsonb);
    assert false, 'an extra status key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_test_send_status('aaaa4000-0000-0000-0000-0000000000f1',
      '{"limit": 2.5}'::jsonb);
    assert false, 'a fractional limit must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_test_send_status('aaaa4000-0000-0000-0000-0000000000f1',
      '{"limit": "10"}'::jsonb);
    assert false, 'a string limit must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_test_send_status('aaaa4000-0000-0000-0000-0000000000f1',
      '{"limit": 51}'::jsonb);
    assert false, 'an out-of-range limit must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_test_send_status('aaaa4000-0000-0000-0000-0000000000f1', '{"limit": 5}'::jsonb);
  assert jsonb_array_length(r -> 'deliveries') = 3, 'a valid bounded status read works';
end $$;

-- ── (6b) DELIVERY-INSERT + EVENT-HISTORY adversarials (service role) ────────
-- The service role holds INSERT on marketing_deliveries and
-- marketing_delivery_events. These prove that privilege can fabricate
-- NOTHING: not a terminal delivery, not birth facts, not an envelope
-- disagreement, not fictional event history.
do $$
declare
  g uuid; d2 uuid; i2 uuid; xa uuid := gen_random_uuid(); xi uuid := gen_random_uuid();
  dd marketing_deliveries%rowtype;
begin
  select id into g from marketing_sender_profiles
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
     and email_account_id='eeee4000-0000-0000-0000-0000000000a2';
  select id, automation_intent_id into d2, i2 from marketing_deliveries
   where request_id = 'req-main-0002';  -- still queued; its intent still pending
  select * into dd from marketing_deliveries where id = d2;

  -- (a) a delivery cannot be BORN in any non-queued state, whatever facts ride it
  begin
    insert into marketing_deliveries
      (id, tenant_id, sender_profile_id, purpose, recipient_email, automation_intent_id,
       request_id, request_fingerprint, correlation_id, subject, body_text, content_hash,
       status, provider_message_id, submitted_at)
    values (gen_random_uuid(), 'aaaa4000-0000-0000-0000-0000000000f1', g, 'test',
            'victim@p4.test', i2, 'req-fab-sub-1', repeat('c', 64), gen_random_uuid(),
            'S', 'B', repeat('d', 64), 'submitted', 'fabricated-msg', now());
    assert false, 'a submitted delivery cannot be directly inserted';
  exception when raise_exception then null;
  end;
  begin
    insert into marketing_deliveries
      (tenant_id, sender_profile_id, purpose, recipient_email, automation_intent_id,
       request_id, request_fingerprint, correlation_id, subject, body_text, content_hash,
       status, failure_class)
    values ('aaaa4000-0000-0000-0000-0000000000f1', g, 'test', 'victim@p4.test', i2,
            'req-fab-fail-1', repeat('c', 64), gen_random_uuid(), 'S', 'B',
            repeat('d', 64), 'failed', 'fabricated');
    assert false, 'a failed delivery cannot be directly inserted';
  exception when raise_exception then null;
  end;
  begin
    insert into marketing_deliveries
      (tenant_id, sender_profile_id, purpose, recipient_email, automation_intent_id,
       request_id, request_fingerprint, correlation_id, subject, body_text, content_hash,
       status)
    values ('aaaa4000-0000-0000-0000-0000000000f1', g, 'test', 'victim@p4.test', i2,
            'req-fab-exec-1', repeat('c', 64), gen_random_uuid(), 'S', 'B',
            repeat('d', 64), 'executing');
    assert false, 'an executing delivery cannot be directly inserted';
  exception when raise_exception then null;
  end;
  begin
    insert into marketing_deliveries
      (tenant_id, sender_profile_id, purpose, recipient_email, automation_intent_id,
       request_id, request_fingerprint, correlation_id, subject, body_text, content_hash,
       status)
    values ('aaaa4000-0000-0000-0000-0000000000f1', g, 'test', 'victim@p4.test', i2,
            'req-fab-unk-1', repeat('c', 64), gen_random_uuid(), 'S', 'B',
            repeat('d', 64), 'unknown');
    assert false, 'an unknown delivery cannot be directly inserted';
  exception when raise_exception then null;
  end;
  -- (b) even a QUEUED insert cannot carry provider or attempt facts at birth
  begin
    insert into marketing_deliveries
      (tenant_id, sender_profile_id, purpose, recipient_email, automation_intent_id,
       request_id, request_fingerprint, correlation_id, subject, body_text, content_hash,
       execution_attempt_id)
    values ('aaaa4000-0000-0000-0000-0000000000f1', g, 'test', 'victim@p4.test', i2,
            'req-fab-att-1', repeat('c', 64), gen_random_uuid(), 'S', 'B',
            repeat('d', 64), gen_random_uuid());
    assert false, 'a queued delivery cannot be born citing an execution attempt';
  exception when raise_exception then null;
  end;
  begin
    insert into marketing_deliveries
      (tenant_id, sender_profile_id, purpose, recipient_email, automation_intent_id,
       request_id, request_fingerprint, correlation_id, subject, body_text, content_hash,
       provider_thread_id)
    values ('aaaa4000-0000-0000-0000-0000000000f1', g, 'test', 'victim@p4.test', i2,
            'req-fab-thr-1', repeat('c', 64), gen_random_uuid(), 'S', 'B',
            repeat('d', 64), 'fabricated-thread');
    assert false, 'a queued delivery cannot be born carrying provider facts';
  exception when raise_exception then null;
  end;
  -- (c) the row must AGREE with its intent's frozen envelope: same intent,
  -- forged recipient/actor/request/hash → rejected
  begin
    insert into marketing_deliveries
      (tenant_id, sender_profile_id, purpose, recipient_email, automation_intent_id,
       request_id, request_fingerprint, correlation_id, subject, body_text, content_hash)
    values ('aaaa4000-0000-0000-0000-0000000000f1', g, 'test', 'attacker@evil.test', i2,
            'req-fab-env-1', repeat('c', 64), gen_random_uuid(), 'S', 'B', repeat('d', 64));
    assert false, 'a delivery disagreeing with its intent''s frozen envelope must be rejected';
  exception when raise_exception then null;
  end;
  -- (c2) FULL-ENVELOPE binding: copy the LEGITIMATE pending delivery's row —
  -- including its genuine approved content_hash and fingerprint — and mutate
  -- ONE persisted content/lineage field at a time. A copied hash can never
  -- smuggle different persisted content past the guard; the fingerprint is
  -- RECOMPUTED, so a shape-valid forgery dies too. The unmutated control
  -- copy passes the guard completely and is stopped only by uniqueness —
  -- proving the guard accepts exactly the request-created shape.
  declare
    k int;
    v_subject text; v_body text; v_from text; v_reply text; v_sig text;
    v_ver text; v_corr uuid; v_fp text;
  begin
    for k in 1..8 loop
      v_subject := dd.subject;  v_body := dd.body_text;  v_from := dd.from_name;
      v_reply := dd.reply_to;   v_sig := dd.signature_text;
      v_ver := dd.content_version; v_corr := dd.correlation_id;
      v_fp := dd.request_fingerprint;
      case k
        when 1 then v_subject := 'FORGED subject';
        when 2 then v_body := 'FORGED body';
        when 3 then v_from := 'FORGED name';
        when 4 then v_reply := 'forged@evil.test';
        when 5 then v_sig := 'FORGED signature';
        when 6 then v_ver := '2';
        when 7 then v_corr := gen_random_uuid();
        when 8 then v_fp := repeat('e', 64);  -- shape-valid, canonically wrong
      end case;
      begin
        insert into marketing_deliveries
          (id, tenant_id, sender_profile_id, purpose, actor_profile_id,
           recipient_profile_id, recipient_email, automation_intent_id,
           request_id, request_fingerprint, correlation_id, subject, body_text,
           from_name, reply_to, signature_text, content_version, content_hash)
        values
          (dd.id, dd.tenant_id, dd.sender_profile_id, dd.purpose,
           dd.actor_profile_id, dd.recipient_profile_id, dd.recipient_email,
           dd.automation_intent_id, dd.request_id, v_fp, v_corr, v_subject,
           v_body, v_from, v_reply, v_sig, v_ver, dd.content_hash);
        assert false, format('mutation %s: forged content with a copied hash must be rejected', k);
      exception when raise_exception then null;
      end;
    end loop;
    -- control: the EXACT request-created shape passes the guard fully and is
    -- stopped only by the primary key — the legitimate path is untouched
    begin
      insert into marketing_deliveries
        (id, tenant_id, sender_profile_id, purpose, actor_profile_id,
         recipient_profile_id, recipient_email, automation_intent_id,
         request_id, request_fingerprint, correlation_id, subject, body_text,
         from_name, reply_to, signature_text, content_version, content_hash)
      values
        (dd.id, dd.tenant_id, dd.sender_profile_id, dd.purpose,
         dd.actor_profile_id, dd.recipient_profile_id, dd.recipient_email,
         dd.automation_intent_id, dd.request_id, dd.request_fingerprint,
         dd.correlation_id, dd.subject, dd.body_text, dd.from_name,
         dd.reply_to, dd.signature_text, dd.content_version, dd.content_hash);
      assert false, 'the exact duplicate must die on uniqueness, not the guard';
    exception when unique_violation then null;
    end;
    -- and the stored fingerprint IS the canonical recomputation
    assert dd.request_fingerprint = marketing_request_fingerprint(
             dd.request_id, dd.actor_profile_id, dd.sender_profile_id,
             dd.recipient_profile_id, dd.content_hash),
      'the request RPC and the canonical fingerprint formula agree';
  end;

  -- (d) only the Phase-4 TEST intent type + Marketing capability qualifies
  insert into intelligence_objects (id, tenant_id, domain, object_type, object_class, subject, status)
  values (xa, 'aaaa4000-0000-0000-0000-0000000000f1', 'core', 'Action', 'action',
          'non-marketing intent probe', 'ready');
  insert into automation_intents (id, tenant_id, action_object_id, intent_type, parameters, status)
  values (xi, 'aaaa4000-0000-0000-0000-0000000000f1', xa, 'record_internal_note',
          '{}'::jsonb, 'pending');
  begin
    insert into marketing_deliveries
      (tenant_id, sender_profile_id, purpose, recipient_email, automation_intent_id,
       request_id, request_fingerprint, correlation_id, subject, body_text, content_hash)
    values ('aaaa4000-0000-0000-0000-0000000000f1', g, 'test', 'victim@p4.test', xi,
            'req-fab-typ-1', repeat('c', 64), gen_random_uuid(), 'S', 'B', repeat('d', 64));
    assert false, 'a delivery cannot reference a non-Phase-4 intent type';
  exception when raise_exception then null;
  end;
  -- (e) EVENT truth: a second null-origin "initial" event is impossible…
  begin
    insert into marketing_delivery_events
      (tenant_id, delivery_id, automation_intent_id, from_status, to_status)
    values ('aaaa4000-0000-0000-0000-0000000000f1', d2, i2, null, 'queued');
    assert false, 'a duplicate initial event must be rejected';
  exception when raise_exception then null; when unique_violation then null;
  end;
  -- …a false to_status cannot be recorded…
  begin
    insert into marketing_delivery_events
      (tenant_id, delivery_id, automation_intent_id, from_status, to_status)
    values ('aaaa4000-0000-0000-0000-0000000000f1', d2, i2, 'queued', 'submitted');
    assert false, 'an event claiming a status the delivery does not hold must be rejected';
  exception when raise_exception then null;
  end;
  -- …and a mismatched intent is structurally impossible (guard + composite FK)
  begin
    insert into marketing_delivery_events
      (tenant_id, delivery_id, automation_intent_id, from_status, to_status)
    values ('aaaa4000-0000-0000-0000-0000000000f1', d2, xi, 'queued', 'queued');
    assert false, 'an event citing a different intent than its delivery must be rejected';
  exception when raise_exception then null; when foreign_key_violation then null;
  end;
end $$;

-- ── (7) END-TO-END via the REAL engine (stubbed provider results) ───────────
do $$
declare
  d uuid; i uuid; d2 uuid; i2 uuid; d3 uuid; i3 uuid; g uuid;
  claim record; claim2 record; fin record; r jsonb; em uuid; n int;
  att_inflight uuid; t timestamptz;
  corr uuid := gen_random_uuid();
begin
  select id, automation_intent_id into d, i from marketing_deliveries
   where request_id = 'req-main-0001';
  select id, automation_intent_id into d2, i2 from marketing_deliveries
   where request_id = 'req-main-0002';
  select id, automation_intent_id into d3, i3 from marketing_deliveries
   where request_id = 'req-main-0003';
  select id into g from marketing_sender_profiles
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
     and email_account_id='eeee4000-0000-0000-0000-0000000000a2';

  -- FROZEN ENVELOPE vs mutable sender (finding 2, SQL layer): edit the sender
  -- AFTER the request — the engine-claimed envelope must be the ORIGINAL
  select updated_at into t from marketing_sender_profiles where id = g;
  perform marketing_sender_update('aaaa4000-0000-0000-0000-0000000000f1',
    'bbbb4000-0000-0000-0000-0000000000f1', g,
    '{"from_name":"EDITED NAME","reply_to":"edited@p4-t1.test","signature_text":"EDITED SIG"}'::jsonb, t);
  select * into claim from automation_claim_and_start(
    i, 'aaaa4000-0000-0000-0000-0000000000f1', 'p4-test-worker', 120,
    'idem-p4-' || i, corr, 'test');
  assert claim.attempt_id is not null and claim.capability_key = 'email.send_marketing'
     and claim.intent_type = 'send_marketing_test_email'
     and claim.adapter_version = '1'
     and claim.envelope_parameters ->> 'subject' = 'Phase 4 governed test'
     and claim.envelope_parameters ->> 'from_name' = 'Drummonds Marketing'
     and claim.envelope_parameters ->> 'reply_to' is null
     and claim.envelope_parameters ->> 'signature_text' is null,
    'the claimed envelope is the ORIGINAL frozen request — sender edits never leak in';
  att_inflight := claim.attempt_id;
  select * into claim2 from automation_claim_and_start(
    i, 'aaaa4000-0000-0000-0000-0000000000f1', 'p4-other-worker', 120,
    'idem-p4-' || i, corr, 'test');
  assert claim2.attempt_id is null, 'a concurrent claim returns no work';

  r := marketing_delivery_reconcile('aaaa4000-0000-0000-0000-0000000000f1', d);
  assert r ->> 'status' = 'executing', 'delivery reflects the executing intent';

  -- FABRICATION adversarials (finding 6): even the service role cannot write
  -- an untrue submitted state
  begin
    update marketing_deliveries
       set status = 'submitted', provider_message_id = 'fabricated',
           submitted_at = now(), execution_attempt_id = att_inflight
     where id = d;
    assert false, 'submission cannot be fabricated while the intent is executing';
  exception when raise_exception then null;
  end;

  -- FINALIZE SUCCESS with a STUBBED sanitized provider result (no network)
  select * into fin from automation_finalize_execution(
    'aaaa4000-0000-0000-0000-0000000000f1', i, claim.attempt_id, 'p4-test-worker',
    'succeeded',
    jsonb_build_object('message_id','gm-msg-p4-001','thread_id','gm-thr-p4-001',
                       'delivery_id', d, 'submitted_at', now()),
    null, 'succeeded', false, null, 'gm-msg-p4-001', '2xx',
    'marketing_email_submitted', 'operational', corr, null);
  assert fin.execution_attempt_id is not null and fin.outcome_id is not null,
    'the engine recorded the immutable attempt + operational outcome';
  assert (select status from automation_intents where id = i) = 'succeeded', 'intent succeeded';

  -- post-success fabrication adversarials: wrong attempt / wrong ids still die
  begin
    update marketing_deliveries
       set status = 'submitted', provider_message_id = 'gm-msg-p4-001',
           submitted_at = now(), execution_attempt_id = att_inflight
     where id = d;
    assert false, 'an in-flight (non-succeeded) attempt is no evidence of submission';
  exception when raise_exception then null;
  end;
  begin
    update marketing_deliveries
       set status = 'submitted', provider_message_id = 'WRONG-ID',
           submitted_at = now(), execution_attempt_id = fin.execution_attempt_id
     where id = d;
    assert false, 'a provider id disagreeing with the attempt reference must be rejected';
  exception when raise_exception then null;
  end;
  begin
    update marketing_deliveries
       set status = 'submitted', submitted_at = now(),
           execution_attempt_id = fin.execution_attempt_id
     where id = d;
    assert false, 'submission without a provider message id must be rejected';
  exception when raise_exception then null;
  end;

  -- the LEGITIMATE reconciler path succeeds
  r := marketing_delivery_reconcile('aaaa4000-0000-0000-0000-0000000000f1', d);
  assert r ->> 'status' = 'submitted' and (r ->> 'changed')::boolean, 'delivery submitted';
  assert (select provider_message_id from marketing_deliveries where id = d) = 'gm-msg-p4-001'
     and (select provider_thread_id from marketing_deliveries where id = d) = 'gm-thr-p4-001'
     and (select execution_attempt_id from marketing_deliveries where id = d)
           = fin.execution_attempt_id
     and (select submitted_at from marketing_deliveries where id = d) is not null,
    'provider identifiers + succeeded attempt + submission time recorded';

  -- canonical outbound email row with COMPOSITE-FK provenance
  select id into em from email_messages
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
     and provider='gmail' and provider_message_id='gm-msg-p4-001';
  assert em is not null, 'canonical outbound email_messages row exists';
  assert (select direction from email_messages where id = em) = 'outbound'
     and (select from_email from email_messages where id = em) = 'sender@p4-t1.test'
     and (select to_emails from email_messages where id = em) = '["recipient-a@p4.test"]'::jsonb
     and (select subject from email_messages where id = em) = 'Phase 4 governed test'
     and (select origin from email_messages where id = em) = 'marketing_delivery'
     and (select origin_delivery_id from email_messages where id = em) = d
     and (select origin_automation_intent_id from email_messages where id = em) = i,
    'the canonical row carries exact content + full provenance';
  -- BYTE-CONSISTENT with the frozen MIME composition: body || signature
  -- delimiter (composeMarketingBody) — here the frozen signature is null, so
  -- the canonical body is exactly the frozen body text
  assert (select body_text from email_messages where id = em)
       = (select body_text from marketing_deliveries where id = d)
     and (select body_text from email_messages where id = em)
       = 'Hello from the governed pipeline.',
    'the canonical email body is byte-consistent with the frozen content';

  -- the STANDARD projector job was enqueued deterministically (finding 12)
  assert (select count(*) from platform_jobs
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
             and job_type='interactions.sync'
             and job_key='interactions.sync:aaaa4000-0000-0000-0000-0000000000f1:all'
             and status='queued') = 1,
    'confirmed submission enqueues the canonical interactions.sync job (once)';
  -- eligible for the projector — and the projector's own selection sees it
  assert exists (select 1 from email_select_unprojected('aaaa4000-0000-0000-0000-0000000000f1', 50) mm
                  where mm.id = em),
    'the outbound row is visible to the canonical interactions projector';

  -- reconcile idempotent; job not duplicated; ingestion converges on ONE row
  r := marketing_delivery_reconcile('aaaa4000-0000-0000-0000-0000000000f1', d);
  assert (r ->> 'changed')::boolean = false, 'reconcile is idempotent';
  assert (select count(*) from platform_jobs
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
             and job_type='interactions.sync' and status='queued') = 1,
    'repeat reconciliation never duplicates the projection job';
  insert into email_messages (tenant_id, provider, provider_message_id, provider_thread_id,
                              subject, direction)
  values ('aaaa4000-0000-0000-0000-0000000000f1','gmail','gm-msg-p4-001','gm-thr-p4-001',
          'Phase 4 governed test','outbound')
  on conflict (tenant_id, provider, provider_message_id) do nothing;
  select count(*) into n from email_messages
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1' and provider_message_id='gm-msg-p4-001';
  assert n = 1, 'later Gmail ingestion converges on the SAME canonical row';

  -- TEST-SIDE SIMULATION of the canonical projector's exact upsert contract
  -- (interactions_sync.ts: onConflict tenant/source_table/source_id). This is
  -- a TEST simulation only — the projector remains the ONLY production
  -- Interaction writer; the Deno worker itself runs only when deployed.
  insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                            source_external_id, interaction_type, direction, occurred_at,
                            subject, related_thread_id, processing_status)
  values ('aaaa4000-0000-0000-0000-0000000000f1','gmail','email','email_messages', em,
          'gm-msg-p4-001','email_message','outbound', now(),
          'Phase 4 governed test','gm-thr-p4-001','pending')
  on conflict (tenant_id, source_table, source_id) do nothing;
  insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                            source_external_id, interaction_type, direction, occurred_at,
                            subject, related_thread_id, processing_status)
  values ('aaaa4000-0000-0000-0000-0000000000f1','gmail','email','email_messages', em,
          'gm-msg-p4-001','email_message','outbound', now(),
          'Phase 4 governed test','gm-thr-p4-001','pending')
  on conflict (tenant_id, source_table, source_id) do nothing;
  assert (select count(*) from interactions
           where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
             and source_table='email_messages' and source_id = em) = 1,
    'the canonical projector contract yields EXACTLY ONE outbound Interaction';

  -- terminal immutability + append-only events
  begin
    update marketing_deliveries set status = 'failed' where id = d;
    assert false, 'a submitted delivery is terminal';
  exception when raise_exception then null;
  end;
  begin
    update marketing_deliveries set subject = 'tampered' where id = d;
    assert false, 'submitted content is immutable';
  exception when raise_exception then null;
  end;
  -- TERMINAL FACT PINNING on status-preserving updates (not only transitions):
  -- the submitted delivery's cited attempt can never be swapped or dropped
  begin
    update marketing_deliveries set execution_attempt_id = att_inflight where id = d;
    assert false, 'the attempt behind a submission can never be changed after the fact';
  exception when raise_exception then null;
  end;
  begin
    update marketing_deliveries set execution_attempt_id = null where id = d;
    assert false, 'the attempt behind a submission can never be detached';
  exception when raise_exception then null;
  end;
  begin
    update marketing_deliveries set failure_class = 'fabricated' where id = d;
    assert false, 'a submitted delivery can never grow a failure classification';
  exception when raise_exception then null;
  end;
  begin
    update marketing_deliveries set provider_thread_id = null where id = d;
    assert false, 'recorded provider facts can never be cleared';
  exception when raise_exception then null;
  end;
  begin
    update marketing_delivery_events set detail = 'rewritten'
     where delivery_id = d and to_status = 'submitted';
    assert false, 'delivery events are append-only';
  exception when raise_exception then null;
  end;
  -- the GENUINE request + reconciler sequence is the recorded history, whole
  -- and ordered: null→queued, queued→executing, executing→submitted
  assert (select array_agg(coalesce(e.from_status, '∅') || '>' || e.to_status order by e.seq)
            from marketing_delivery_events e
           where e.tenant_id = 'aaaa4000-0000-0000-0000-0000000000f1' and e.delivery_id = d)
       = array['∅>queued', 'queued>executing', 'executing>submitted'],
    'the genuine event chain is exactly the recorded request/reconcile history';
  -- fictional history adversarials against the SUBMITTED delivery:
  begin
    insert into marketing_delivery_events
      (tenant_id, delivery_id, automation_intent_id, from_status, to_status)
    values ('aaaa4000-0000-0000-0000-0000000000f1', d, i, 'queued', 'submitted');
    assert false, 'an event breaking the from-status chain must be rejected';
  exception when raise_exception then null;
  end;
  -- a delivery can no longer be inserted against the now-SUCCEEDED intent
  -- (fabricating a sibling delivery to reuse its succeeded attempt)
  begin
    insert into marketing_deliveries
      (tenant_id, sender_profile_id, purpose, recipient_email, automation_intent_id,
       request_id, request_fingerprint, correlation_id, subject, body_text, content_hash)
    values ('aaaa4000-0000-0000-0000-0000000000f1', g, 'test', 'victim@p4.test', i,
            'req-fab-succ-1', repeat('c', 64), gen_random_uuid(), 'S', 'B', repeat('d', 64));
    assert false, 'no delivery can be created against a non-pending intent';
  exception when raise_exception then null;
  end;

  -- FAILED path: permanent refusal → NO canonical email, NO projection job
  select * into claim from automation_claim_and_start(
    i2, 'aaaa4000-0000-0000-0000-0000000000f1', 'p4-test-worker', 120,
    'idem-p4-' || i2, corr, 'test');
  perform automation_finalize_execution(
    'aaaa4000-0000-0000-0000-0000000000f1', i2, claim.attempt_id, 'p4-test-worker',
    'failed', null, 'gmail_send_scope_missing', 'failed_permanent', false, null,
    null, '4xx', null, null, corr, null);
  -- CROSS-INTENT attempt fabrication: d2 cannot cite d1's succeeded attempt.
  -- The guard rejects the swap first (no factual transition); the composite
  -- FK (proven from the catalog in section 3) remains the structural backstop
  begin
    update marketing_deliveries
       set execution_attempt_id = (select execution_attempt_id from marketing_deliveries where id = d)
     where id = d2;
    assert false, 'another intent''s attempt can never be attached';
  exception when raise_exception then null; when foreign_key_violation then null;
  end;
  r := marketing_delivery_reconcile('aaaa4000-0000-0000-0000-0000000000f1', d2);
  assert r ->> 'status' = 'failed', 'permanent refusal projects as failed';
  assert (select failure_class from marketing_deliveries where id = d2) is not null,
    'failure carries its sanitized classification';
  -- TERMINAL FAILURE facts are pinned: no silent rewrite of the
  -- classification, no detaching/swapping the cited failure attempt
  begin
    update marketing_deliveries set failure_class = 'rewritten' where id = d2;
    assert false, 'a terminal failure classification can never be silently rewritten';
  exception when raise_exception then null;
  end;
  begin
    update marketing_deliveries set execution_attempt_id = null where id = d2;
    assert false, 'a terminal failure''s cited attempt can never be detached';
  exception when raise_exception then null;
  end;
  begin
    update marketing_deliveries
       set execution_attempt_id = (select execution_attempt_id from marketing_deliveries where id = d)
     where id = d2;
    assert false, 'a terminal failure can never adopt another intent''s attempt';
  exception when raise_exception then null; when foreign_key_violation then null;
  end;
  -- EVENT lineage: d2's history cannot cite the OTHER intent's succeeded
  -- attempt (same tenant, different intent) — guard + composite FK
  begin
    insert into marketing_delivery_events
      (tenant_id, delivery_id, automation_intent_id, from_status, to_status,
       execution_attempt_id)
    values ('aaaa4000-0000-0000-0000-0000000000f1', d2,
            (select automation_intent_id from marketing_deliveries where id = d2),
            'failed', 'failed', fin.execution_attempt_id);
    assert false, 'an event citing a different-intent attempt must be rejected';
  exception when raise_exception then null; when foreign_key_violation then null;
  end;
  assert not exists (select 1 from email_messages
                      where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                        and origin_delivery_id = d2),
    'a failed send creates NO canonical email row (and so no Interaction)';

  -- UNKNOWN path: frozen, never blindly resent; resolution APPENDS
  select * into claim from automation_claim_and_start(
    i3, 'aaaa4000-0000-0000-0000-0000000000f1', 'p4-test-worker', 120,
    'idem-p4-' || i3, corr, 'test');
  perform automation_finalize_execution(
    'aaaa4000-0000-0000-0000-0000000000f1', i3, claim.attempt_id, 'p4-test-worker',
    'unknown', null, 'external_result_unknown', 'unknown', false, null,
    null, 'lost', null, null, corr, null);
  assert (select status from automation_intents where id = i3) = 'unknown', 'intent frozen unknown';
  r := marketing_delivery_reconcile('aaaa4000-0000-0000-0000-0000000000f1', d3);
  assert r ->> 'status' = 'unknown', 'delivery reports the unknown truthfully';
  assert not exists (select 1 from email_messages
                      where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                        and origin_delivery_id = d3),
    'an unknown result creates NO canonical email row';
  select * into claim2 from automation_claim_and_start(
    i3, 'aaaa4000-0000-0000-0000-0000000000f1', 'p4-test-worker', 120,
    'idem-p4-' || i3, corr, 'test');
  assert claim2.attempt_id is null, 'an unknown intent is never re-claimed for execution';
  perform automation_resolve_unknown_execution(
    'aaaa4000-0000-0000-0000-0000000000f1', i3, 'unknown', null, null,
    'unknown', null, null, null, null, corr, null);
  assert exists (select 1 from review_tasks
                  where tenant_id='aaaa4000-0000-0000-0000-0000000000f1'
                    and object_id = (select action_object_id from automation_intents where id = i3)
                    and status = 'pending'),
    'a still-unknown result routes to a human review owner';
  select count(*) into n from automation_execution_attempts
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1' and automation_intent_id = i3;
  assert n >= 2, 'reconciliation appended — history was never rewritten';
end $$;

-- ── (8) cross-tenant lineage is STRUCTURALLY impossible everywhere ──────────
do $$
declare fa uuid := gen_random_uuid(); fi uuid := gen_random_uuid(); fs uuid; fd uuid;
        fp uuid; fd_intent uuid; fd_status text;
begin
  insert into intelligence_objects (id, tenant_id, domain, object_type, object_class, subject, status)
  values (fa, 'aaaa4000-0000-0000-0000-0000000000f2', 'core', 'Action', 'action', 'foreign action', 'ready');
  insert into automation_intents (id, tenant_id, action_object_id, intent_type, parameters, status)
  values (fi, 'aaaa4000-0000-0000-0000-0000000000f2', fa, 'record_internal_note', '{}'::jsonb, 'pending');
  select id into fs from marketing_sender_profiles
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1' limit 1;
  select id into fd from marketing_deliveries
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f1' limit 1;
  select id into fp from people
   where tenant_id='aaaa4000-0000-0000-0000-0000000000f2' limit 1;

  begin
    insert into marketing_deliveries
      (tenant_id, sender_profile_id, purpose, recipient_email, automation_intent_id,
       request_id, request_fingerprint, correlation_id, subject, body_text, content_hash)
    values ('aaaa4000-0000-0000-0000-0000000000f1', fs, 'test', 'x@y.test', fi,
            'req-cross-01', repeat('b', 64), gen_random_uuid(), 'S', 'B', repeat('a', 64));
    assert false, 'a tenant-A delivery can never reference tenant-B''s intent';
  -- the insert guard refuses the foreign intent first; the composite FK
  -- (asserted from the catalog in section 3) remains the structural backstop
  exception when raise_exception then null; when foreign_key_violation then null;
  end;
  begin
    update marketing_deliveries set actor_profile_id = 'bbbb4000-0000-0000-0000-0000000000f5'
     where id = fd;
    assert false, 'a foreign actor must violate the composite FK';
  exception when foreign_key_violation then null; when raise_exception then null;
  end;
  begin
    update marketing_deliveries set recipient_profile_id = 'bbbb4000-0000-0000-0000-0000000000f5'
     where id = fd;
    assert false, 'a foreign recipient must violate the composite FK';
  exception when foreign_key_violation then null; when raise_exception then null;
  end;
  if fp is not null then
    begin
      update marketing_deliveries set person_id = fp where id = fd;
      assert false, 'a foreign person must violate the composite FK';
    exception when foreign_key_violation then null; when raise_exception then null;
    end;
  end if;
  -- foreign origin provenance on the canonical email row
  begin
    insert into email_messages (tenant_id, provider, provider_message_id, direction,
                                origin, origin_delivery_id)
    values ('aaaa4000-0000-0000-0000-0000000000f2','gmail','x-origin-1','outbound',
            'marketing_delivery', fd);
    assert false, 'a foreign origin delivery must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into email_messages (tenant_id, provider, provider_message_id, direction,
                                origin, origin_automation_intent_id)
    values ('aaaa4000-0000-0000-0000-0000000000f1','gmail','x-origin-2','outbound',
            'marketing_delivery', fi);
    assert false, 'a foreign origin intent must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  -- delivery events: a foreign/cross-tenant attempt reference is impossible
  insert into automation_execution_attempts
    (tenant_id, automation_intent_id, action_object_id, operation_type,
     idempotency_key, attempt_number, status)
  values ('aaaa4000-0000-0000-0000-0000000000f2', fi, fa, 'record_internal_note',
          'idem-foreign-1', 1, 'in_flight');
  select automation_intent_id, status into fd_intent, fd_status
    from marketing_deliveries where id = fd;
  begin
    -- plausible intent/status/chain so the CROSS-TENANT ATTEMPT is the
    -- operative violation (guard first; composite FK beneath it)
    insert into marketing_delivery_events
      (tenant_id, delivery_id, automation_intent_id, from_status, to_status,
       execution_attempt_id)
    values ('aaaa4000-0000-0000-0000-0000000000f1', fd, fd_intent, fd_status, fd_status,
            (select id from automation_execution_attempts
              where tenant_id = 'aaaa4000-0000-0000-0000-0000000000f2' limit 1));
    assert false, 'a cross-tenant attempt on an event must be rejected';
  exception when raise_exception then null; when foreign_key_violation then null;
  end;
end $$;

-- ── (9) observability + tenant cascade cleanup ──────────────────────────────
do $$
declare h jsonb; n int;
begin
  h := marketing_sender_health('aaaa4000-0000-0000-0000-0000000000f1');
  assert (h ->> 'senders_configured')::int = 4
     and (h ->> 'senders_enabled')::int = 1
     and (h ->> 'senders_ready')::int >= 1
     and (h ->> 'capability_enabled')::boolean
     and (h -> 'deliveries' ->> 'submitted')::int = 1
     and (h -> 'deliveries' ->> 'failed')::int = 1
     and (h ->> 'unknown_needing_review')::int = 1,
    'sender health reports real evidence';
  select count(*) into n from marketing_deliveries
   where tenant_id = 'aaaa4000-0000-0000-0000-0000000000f1';
  assert n = 3, 'pre-cascade sanity';
  -- tenant cascade proof uses a throwaway tenant WITHOUT execution attempts:
  -- the engine's append-only attempt history deliberately makes an executed
  -- tenant undeletable, so cascade cleanup is proven on pre-execution lineage
  insert into tenants (id, slug, display_name, industry)
  values ('aaaa4000-0000-0000-0000-0000000000f3', 'p4-t3-cascade', 'Cascade T3', 'hvac');
  insert into intelligence_objects (id, tenant_id, domain, object_type, object_class, subject, status)
  values ('aaaa4000-0000-0000-0000-00000000c3a1', 'aaaa4000-0000-0000-0000-0000000000f3',
          'core', 'Action', 'action', 'cascade probe', 'ready');
  insert into automation_intents (id, tenant_id, action_object_id, intent_type, parameters, status)
  values ('aaaa4000-0000-0000-0000-00000000c3b1', 'aaaa4000-0000-0000-0000-0000000000f3',
          'aaaa4000-0000-0000-0000-00000000c3a1', 'record_internal_note', '{}'::jsonb, 'pending');
  delete from tenants where id = 'aaaa4000-0000-0000-0000-0000000000f3';
  assert not exists (select 1 from automation_intents
                      where tenant_id = 'aaaa4000-0000-0000-0000-0000000000f3'),
    'tenant cascade cleans pre-execution lineage';
end $$;

-- ── (10) service-role-only boundaries ───────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'marketing_scope_has',
    'marketing_sender_sources', 'marketing_sender_readiness', 'marketing_sender_readiness_all',
    'marketing_sender_create', 'marketing_sender_update',
    'marketing_sender_set_enabled', 'marketing_sender_set_default',
    'marketing_sender_record_verification', 'marketing_sender_capability_sync',
    'marketing_test_send_request', 'marketing_delivery_reconcile',
    'marketing_test_send_status', 'marketing_sender_health'
  ] loop
    if exists (
      select 1 from information_schema.routine_privileges rp
       where rp.routine_name = fn and rp.grantee in ('anon', 'authenticated', 'PUBLIC')
         and rp.privilege_type = 'EXECUTE') then
      raise exception 'FAIL: % is executable by a client role', fn;
    end if;
  end loop;
end $$;

select 'marketing_senders.test.sql: ALL ASSERTIONS PASSED' as result;

rollback;
