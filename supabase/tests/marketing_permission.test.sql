-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_permission.test.sql
--
-- Proves governed marketing-permission capture (migration 20260910120000):
-- marketing_permission_record / marketing_permission_record_bulk /
-- marketing_permission_history over the EXISTING append-only
-- communication_preferences model. Coverage:
--   * boundaries: all four functions service-role-only (anon/authenticated
--     revoked);
--   * authority: owner/ops succeed; viewer 42501; cross-tenant actor
--     integrity violation; cross-tenant person P0002 (non-enumerating);
--     cross-tenant/foreign contact point 22023;
--   * strict arguments: non-object, unknown key, bad uuid, bad decision,
--     future effective date, missing evidence pieces, missing attestation,
--     oversize note — all 22023, and every refusal writes NOTHING;
--   * evidence model: subscribed REQUIRES controlled basis + method +
--     reference/note + attestation; unsubscribed records immediately with
--     none of them;
--   * single success: appends ONE endpoint-bound preference row with the full
--     evidence envelope; eligibility flips unknown→subscribed; audit row +
--     platform event committed with it;
--   * append-only: history is never updated/deleted (guard fires even for
--     direct service-role UPDATE/DELETE);
--   * precedence: unsubscribe appended later WINS (latest endpoint-scoped
--     fact); a later resubscription with NEW evidence wins again; history
--     keeps every row;
--   * idempotency: byte-equivalent replay converges on the stored receipt
--     with NO second row; changed reuse of the request id is MK412;
--   * ATOMICITY: with the audit insert forced to fail, the preference row,
--     platform event and receipt ALL roll back;
--   * bulk: preflight names eligible AND refused (no usable email) members
--     exactly; apply is bound to the preflight contract (MK409 on drift),
--     appends ONE row per confirmed member all-or-nothing, audits with exact
--     counts; injected mid-write failure rolls back EVERY row; dedupe and the
--     1-100 cap enforced;
--   * suppression honesty: recording against a suppressed endpoint stores the
--     fact but returns eligibility 'suppressed' — recording never bypasses
--     suppression.
--
-- Correction-pass regressions (migration 20260911120000):
--   * replay INDEPENDENCE from mutable contact state: a byte-equivalent
--     single/bulk replay returns the stored authoritative result and writes
--     NOTHING even after the recorded contact point is invalidated and
--     replaced, the default email selection changes or a bulk member's
--     eligibility flips; changed reuse stays MK412;
--   * the COMPLETE versioned bulk contract: adding a refused member, removing
--     a refused member or changing a refusal reason all invalidate the old
--     contract (MK409, zero writes); duplicated ids can never alter or bypass
--     the canonical result; reordering identical ids preserves the contract;
--     an untouched selection still applies;
--   * FAIL-CLOSED actor gate: null / non-object / missing-field / malformed /
--     disabled / missing-permission resolver outcomes ALL deny 42501 (no
--     three-valued pass-through), proven against a savepoint-scoped resolver
--     shim, with a control case proving the shim drives the gate; a hostile
--     raw permission row still cannot widen authority;
--   * DETERMINISTIC opt-out-safe precedence: same-scope subscribed and
--     unsubscribed facts with IDENTICAL effective_at AND created_at resolve
--     to 'unsubscribed' in the contact summary, the segment gate and the
--     pre-send endpoint gate alike; the contact-detail projection and the
--     permission history agree; a genuinely newer evidenced resubscription
--     still wins.
begin;

insert into tenants (id, slug, display_name, industry) values
  ('aaaa9300-0000-0000-0000-0000000000f1','perm-t1','Permission Tenant 1','hvac'),
  ('aaaa9300-0000-0000-0000-0000000000f2','perm-t2','Permission Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb9300-0000-0000-0000-0000000000f1','owner-a@perm.test',false,false),
  ('bbbb9300-0000-0000-0000-0000000000f2','ops-a@perm.test',false,false),
  ('bbbb9300-0000-0000-0000-0000000000f3','viewer-a@perm.test',false,false),
  ('bbbb9300-0000-0000-0000-0000000000f4','owner-b@perm.test',false,false);
update profiles set role='owner',  tenant_id='aaaa9300-0000-0000-0000-0000000000f1' where id='bbbb9300-0000-0000-0000-0000000000f1';
update profiles set role='ops',    tenant_id='aaaa9300-0000-0000-0000-0000000000f1' where id='bbbb9300-0000-0000-0000-0000000000f2';
update profiles set role='viewer', tenant_id='aaaa9300-0000-0000-0000-0000000000f1' where id='bbbb9300-0000-0000-0000-0000000000f3';
update profiles set role='owner',  tenant_id='aaaa9300-0000-0000-0000-0000000000f2' where id='bbbb9300-0000-0000-0000-0000000000f4';

select marketing_materialise_defaults('aaaa9300-0000-0000-0000-0000000000f1','bbbb9300-0000-0000-0000-0000000000f1');
select marketing_materialise_defaults('aaaa9300-0000-0000-0000-0000000000f2','bbbb9300-0000-0000-0000-0000000000f4');

create temporary table perm_ctx (k text primary key, v text);

-- ── (0) service-role-only boundary ──────────────────────────────────────────
do $$
declare sig text;
begin
  foreach sig in array array[
    'marketing_permission_require_actor(uuid, uuid)',
    'marketing_permission_record(uuid, uuid, jsonb)',
    'marketing_permission_record_bulk(uuid, uuid, text, jsonb)',
    'marketing_permission_history(uuid, uuid)'
  ] loop
    assert not has_function_privilege('anon', sig, 'execute'),
      'anon must not execute ' || sig;
    assert not has_function_privilege('authenticated', sig, 'execute'),
      'authenticated must not execute ' || sig;
    assert has_function_privilege('service_role', sig, 'execute'),
      'service_role executes ' || sig;
  end loop;
  assert not has_table_privilege('authenticated', 'marketing_permission_requests', 'select'),
    'receipts are not browser-readable';
  assert not has_table_privilege('service_role', 'marketing_permission_requests', 'update'),
    'receipts are never edited';
end $$;

-- ── (1) fixture contacts through the REAL create path ───────────────────────
do $$
declare r jsonb;
begin
  r := marketing_create_contact('aaaa9300-0000-0000-0000-0000000000f1',
    'bbbb9300-0000-0000-0000-0000000000f1',
    '{"display_name":"Pat One","email":"pat.one@perm.test"}'::jsonb,
    'cccc9300-0000-0000-0000-000000000001');
  insert into perm_ctx values ('p1', r ->> 'person_id');
  r := marketing_create_contact('aaaa9300-0000-0000-0000-0000000000f1',
    'bbbb9300-0000-0000-0000-0000000000f1',
    '{"display_name":"Pat Two","email":"pat.two@perm.test"}'::jsonb,
    'cccc9300-0000-0000-0000-000000000002');
  insert into perm_ctx values ('p2', r ->> 'person_id');
  -- p3 has NO email at all (bulk refusal case)
  r := marketing_create_contact('aaaa9300-0000-0000-0000-0000000000f1',
    'bbbb9300-0000-0000-0000-0000000000f1',
    '{"display_name":"No Email"}'::jsonb,
    'cccc9300-0000-0000-0000-000000000003');
  insert into perm_ctx values ('p3', r ->> 'person_id');
  -- foreign-tenant person
  r := marketing_create_contact('aaaa9300-0000-0000-0000-0000000000f2',
    'bbbb9300-0000-0000-0000-0000000000f4',
    '{"display_name":"Foreign Person","email":"foreign@perm.test"}'::jsonb,
    'cccc9300-0000-0000-0000-000000000004');
  insert into perm_ctx values ('pF', r ->> 'person_id');

  assert marketing_contact_eligibility('aaaa9300-0000-0000-0000-0000000000f1',
           (select v from perm_ctx where k='p1')::uuid, 'email') = 'unknown',
    'a new contact starts with NO preference recorded';
end $$;

-- ── (2) authority + argument battery: every refusal writes NOTHING ──────────
do $$
declare p1 uuid := (select v from perm_ctx where k='p1')::uuid;
        pf uuid := (select v from perm_ctx where k='pF')::uuid;
        good jsonb;
begin
  good := jsonb_build_object('person_id', p1, 'decision', 'subscribed',
    'basis', 'explicit_opt_in', 'evidence_method', 'Signup form',
    'evidence_reference', 'form ref 123', 'attestation', true,
    'request_id', 'perm-req-never');
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f3', good);
    assert false, 'a viewer must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f4', good);
    assert false, 'a cross-tenant actor must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f2',
      'bbbb9300-0000-0000-0000-0000000000f4', good);  -- p1 belongs to tenant 1
    assert false, 'another tenant''s person must be NOT FOUND (non-enumerating)';
  exception when no_data_found or sqlstate 'P0002' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1',
      good || jsonb_build_object('contact_point_id',
        (select cp.id from contact_points cp where cp.person_id = pf limit 1)));
    assert false, 'a foreign contact point must be refused';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', '"nope"'::jsonb);
    assert false, 'non-object args must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', good || '{"sneaky":true}'::jsonb);
    assert false, 'an unknown argument key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1',
      good || '{"person_id":"not-a-uuid"}'::jsonb);
    assert false, 'a malformed person id must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', good || '{"decision":"maybe"}'::jsonb);
    assert false, 'an unknown decision must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1',
      good || jsonb_build_object('effective_at', (now() + interval '2 days')::text));
    assert false, 'a future effective date must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- evidence pieces are individually required for SUBSCRIBED
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', good - 'basis');
    assert false, 'subscribed without a controlled basis must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', good || '{"basis":"i_feel_like_it"}'::jsonb);
    assert false, 'an uncontrolled basis must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', good - 'evidence_method');
    assert false, 'subscribed without a method must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', good - 'evidence_reference');
    assert false, 'subscribed without reference OR note must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', good || '{"attestation":false}'::jsonb);
    assert false, 'subscribed without the attestation must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1',
      good || jsonb_build_object('note', repeat('x', 501)));
    assert false, 'an oversize note must raise 22023';
  exception when sqlstate '22023' then null;
  end;

  assert not exists (select 1 from communication_preferences
                      where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'),
    'every refusal wrote NOTHING';
  assert not exists (select 1 from marketing_permission_requests
                      where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'),
    'no refusal consumed a request id';
end $$;

-- ── (3) ATOMICITY: a failed REQUIRED audit write rolls back the whole act ───
create function perm_block_audit() returns trigger language plpgsql as $$
begin
  if new.action like 'marketing.permission.%' then
    raise exception 'perm-fault-injection: audit store unavailable';
  end if;
  return new;
end $$;
create trigger perm_block_audit before insert on audit_logs
  for each row execute function perm_block_audit();
do $$
declare p1 uuid := (select v from perm_ctx where k='p1')::uuid;
begin
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1',
      jsonb_build_object('person_id', p1, 'decision', 'subscribed',
        'basis', 'explicit_opt_in', 'evidence_method', 'Signup form',
        'evidence_reference', 'form ref 123', 'attestation', true,
        'request_id', 'perm-atomic-01'));
    assert false, 'a failed audit write must fail the whole act';
  exception when raise_exception then null;
  end;
  assert not exists (select 1 from communication_preferences
                      where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'),
    'AUDIT FAILURE: the preference row rolled back';
  assert not exists (select 1 from platform_events
                      where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
                        and event_type = 'marketing.permission.recorded'),
    'AUDIT FAILURE: no platform event survived';
  assert not exists (select 1 from marketing_permission_requests
                      where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'),
    'AUDIT FAILURE: no idempotency receipt survived';
end $$;
drop trigger perm_block_audit on audit_logs;
drop function perm_block_audit();

-- ── (4) SINGLE SUCCESS + idempotent replay + changed reuse ──────────────────
do $$
declare p1 uuid := (select v from perm_ctx where k='p1')::uuid;
        args jsonb; r jsonb; r2 jsonb; pref communication_preferences%rowtype;
begin
  args := jsonb_build_object('person_id', p1, 'decision', 'subscribed',
    'basis', 'explicit_opt_in', 'evidence_method', 'Signup form on drummonds.co',
    'evidence_reference', 'Form submission 2026-07-30 09:14',
    'attestation', true, 'request_id', 'perm-single-01',
    -- explicit effective times: now() is frozen inside this test transaction,
    -- so same-scope rows would otherwise tie on effective_at
    'effective_at', (now() - interval '2 hours')::text);
  r := marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', args);
  assert r ->> 'decision' = 'subscribed'
     and r ->> 'eligibility' = 'subscribed'
     and (r ->> 'suppressed')::boolean = false
     and (r ->> 'idempotent')::boolean = false
     and (r ->> 'preference_id') is not null
     and r ->> 'email' = 'pat.one@perm.test',
    'the return is the authoritative recorded state';
  insert into perm_ctx values ('pref1', r ->> 'preference_id');

  select * into pref from communication_preferences
   where id = (r ->> 'preference_id')::uuid;
  assert pref.state = 'subscribed' and pref.channel = 'email'
     and pref.contact_point_id is not null
     and pref.source = 'manual'
     and pref.lawful_basis = 'explicit_opt_in'
     and pref.recorded_by = 'bbbb9300-0000-0000-0000-0000000000f1'
     and pref.evidence ->> 'method' = 'Signup form on drummonds.co'
     and pref.evidence ->> 'reference' = 'Form submission 2026-07-30 09:14'
     and (pref.evidence ->> 'attestation')::boolean = true
     and pref.evidence ->> 'request_id' = 'perm-single-01',
    'the appended row carries the ENDPOINT binding and the full evidence envelope';
  assert (select count(*) from audit_logs
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
             and action = 'marketing.permission.recorded'
             and actor = 'owner-a@perm.test'
             and detail ->> 'authority_basis' = 'marketing.contacts.manage') = 1,
    'EXACTLY ONE audit row records who decided what under which authority';
  assert (select count(*) from platform_events
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
             and event_type = 'marketing.permission.recorded') = 1,
    'ONE platform event was appended';

  -- byte-equivalent replay CONVERGES: same result, no second row
  r2 := marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
         'bbbb9300-0000-0000-0000-0000000000f1', args);
  assert (r2 ->> 'idempotent')::boolean = true
     and r2 ->> 'preference_id' = r ->> 'preference_id',
    'identical replay converges on the stored receipt';
  assert (select count(*) from communication_preferences
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1') = 1,
    'replay appended NOTHING';

  -- changed reuse of the request id is refused
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1',
      args || '{"evidence_reference":"a different claim"}'::jsonb);
    assert false, 'request id reuse with different content must be refused';
  exception when sqlstate 'MK412' then null;
  end;
end $$;

-- ── (5) append-only history is structural, even for direct service writes ───
do $$
begin
  begin
    update communication_preferences set state = 'unsubscribed'
     where id = (select v from perm_ctx where k='pref1')::uuid;
    assert false, 'preference history can never be updated';
  exception when raise_exception then null;
  end;
  begin
    delete from communication_preferences
     where id = (select v from perm_ctx where k='pref1')::uuid;
    assert false, 'preference history can never be deleted';
  exception when raise_exception then null;
  end;
end $$;

-- ── (6) unsubscribe is easy, wins as the LATEST fact; resubscription needs
--        NEW evidence and wins again; history keeps every row ────────────────
do $$
declare p1 uuid := (select v from perm_ctx where k='p1')::uuid;
        r jsonb; h jsonb;
begin
  -- ops records the unsubscribe with nothing but the decision (easy + safe)
  r := marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f2',
        jsonb_build_object('person_id', p1, 'decision', 'unsubscribed',
          'note', 'Asked to stop by phone', 'request_id', 'perm-unsub-01',
          'effective_at', (now() - interval '1 hour')::text));
  assert r ->> 'eligibility' = 'unsubscribed',
    'the unsubscribe is immediately the effective state';

  -- resubscription WITHOUT evidence is refused
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1',
      jsonb_build_object('person_id', p1, 'decision', 'subscribed',
        'request_id', 'perm-resub-x'));
    assert false, 'resubscription without new evidence must be refused';
  exception when sqlstate '22023' then null;
  end;
  assert marketing_contact_eligibility('aaaa9300-0000-0000-0000-0000000000f1',
           p1, 'email') = 'unsubscribed', 'the refusal changed nothing';

  -- resubscription WITH new evidence wins as the newest fact
  r := marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1',
        jsonb_build_object('person_id', p1, 'decision', 'subscribed',
          'basis', 'explicit_opt_in',
          'evidence_method', 'New signup at the service visit',
          'evidence_reference', 'Paper form 2026-08-03, scanned to CRM',
          'attestation', true, 'request_id', 'perm-resub-01'));
  assert r ->> 'eligibility' = 'subscribed', 'new evidence re-subscribes';

  h := marketing_permission_history('aaaa9300-0000-0000-0000-0000000000f1', p1);
  assert h ->> 'eligibility' = 'subscribed'
     and jsonb_array_length(h -> 'history') = 3
     and h -> 'history' -> 0 ->> 'state' = 'subscribed'
     and h -> 'history' -> 1 ->> 'state' = 'unsubscribed'
     and h -> 'history' -> 2 ->> 'state' = 'subscribed',
    'history keeps every append-only fact, newest first';
end $$;

-- ── (7) BULK: preflight truth, contract binding, all-or-nothing apply ───────
do $$
declare p1 uuid := (select v from perm_ctx where k='p1')::uuid;
        p2 uuid := (select v from perm_ctx where k='p2')::uuid;
        p3 uuid := (select v from perm_ctx where k='p3')::uuid;
        pf uuid := (select v from perm_ctx where k='pF')::uuid;
        args jsonb; pre jsonb; r jsonb; before_n int;
begin
  -- cap + dedupe
  begin
    perform marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', 'preflight',
      jsonb_build_object('person_ids',
        (select jsonb_agg(gen_random_uuid()) from generate_series(1, 101)),
        'decision', 'subscribed'));
    assert false, 'more than 100 selected contacts must be refused';
  exception when sqlstate '22023' then null;
  end;

  args := jsonb_build_object(
    'person_ids', jsonb_build_array(p1, p2, p2, p3, pf),  -- dup + no-email + foreign
    'decision', 'subscribed',
    'basis', 'existing_customer_documented',
    'evidence_method', 'Service contract on file',
    'note', 'Annual service customers, contracts include marketing permission',
    'attestation', true);
  -- PREFLIGHT is about the selection: it works WITHOUT any evidence (the
  -- operator fills the evidence next), while APPLY still demands all of it
  pre := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
          'bbbb9300-0000-0000-0000-0000000000f1', 'preflight',
          jsonb_build_object('person_ids', jsonb_build_array(p1), 'decision', 'subscribed'));
  assert (pre ->> 'eligible_count')::int = 1, 'preflight needs no evidence';
  begin
    perform marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
      jsonb_build_object('person_ids', jsonb_build_array(p1), 'decision', 'subscribed',
        'request_id', 'perm-noev-01', 'contract', pre ->> 'contract'));
    assert false, 'bulk APPLY without evidence must be refused';
  exception when sqlstate '22023' then null;
  end;

  pre := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
          'bbbb9300-0000-0000-0000-0000000000f1', 'preflight', args);
  assert (pre ->> 'requested')::int = 5
     and (pre ->> 'unique')::int = 4
     and (pre ->> 'eligible_count')::int = 2
     and (pre ->> 'refused_count')::int = 2
     and (pre ->> 'cap')::int = 100,
    'preflight reports the EXACT selection truth';
  assert exists (select 1 from jsonb_array_elements(pre -> 'refused') e
                  where e ->> 'person_id' = p3::text
                    and e ->> 'reason' = 'no_usable_email'),
    'the member without a usable email is named, with the reason';
  assert exists (select 1 from jsonb_array_elements(pre -> 'refused') e
                  where e ->> 'person_id' = pf::text and e ->> 'reason' = 'not_found'),
    'the foreign member is refused without enumeration';

  -- a tampered/stale contract is refused
  begin
    perform marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
      args || jsonb_build_object('request_id', 'perm-bulk-01', 'contract', md5('tampered')));
    assert false, 'a mismatched contract must be refused';
  exception when sqlstate 'MK409' then null;
  end;

  -- injected mid-write failure: EVERY row rolls back (all-or-nothing)
  select count(*) into before_n from communication_preferences
   where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1';
  execute $trg$create function perm_block_second() returns trigger language plpgsql as $f$
    begin
      if new.person_id = '$trg$ || p2 || $trg$'::uuid
         and new.evidence ->> 'recorded_via' = 'marketing_permission_record_bulk' then
        raise exception 'perm-fault-injection: second member write fails';
      end if;
      return new;
    end $f$;$trg$;
  create trigger perm_block_second before insert on communication_preferences
    for each row execute function perm_block_second();
  begin
    perform marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
      args || jsonb_build_object('request_id', 'perm-bulk-01',
                                 'contract', pre ->> 'contract'));
    assert false, 'a failed member write must fail the WHOLE bulk act';
  exception when raise_exception then null;
  end;
  drop trigger perm_block_second on communication_preferences;
  drop function perm_block_second();
  assert (select count(*) from communication_preferences
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1') = before_n,
    'ALL-OR-NOTHING: the failed bulk apply appended ZERO rows';
  assert not exists (select 1 from marketing_permission_requests
                      where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
                        and request_id = 'perm-bulk-01'),
    'the failed bulk apply consumed no request id';

  -- the REAL apply: one row per confirmed member, exact evidence
  r := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
        args || jsonb_build_object('request_id', 'perm-bulk-01',
                                   'contract', pre ->> 'contract'));
  assert (r ->> 'applied')::int = 2 and (r ->> 'refused_count')::int = 2
     and (r ->> 'idempotent')::boolean = false,
    'apply covered exactly the confirmed selection';
  assert marketing_contact_eligibility('aaaa9300-0000-0000-0000-0000000000f1',
           p2, 'email') = 'subscribed', 'a bulk member is now subscribed';
  assert (select count(*) from communication_preferences
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
             and evidence ->> 'recorded_via' = 'marketing_permission_record_bulk') = 2,
    'exactly the confirmed members received rows';
  assert (select count(*) from audit_logs
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
             and action = 'marketing.permission.bulk_recorded'
             and (detail ->> 'applied')::int = 2) = 1,
    'ONE audit row records the exact bulk result';

  -- idempotent replay converges; changed reuse refused
  r := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
        args || jsonb_build_object('request_id', 'perm-bulk-01',
                                   'contract', pre ->> 'contract'));
  assert (r ->> 'idempotent')::boolean = true and (r ->> 'applied')::int = 2,
    'bulk replay converges on the stored receipt';
  begin
    perform marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
      jsonb_build_object('person_ids', jsonb_build_array(p1),
        'decision', 'unsubscribed', 'request_id', 'perm-bulk-01',
        'contract', md5('aaaa9300-0000-0000-0000-0000000000f1' || '|unsubscribed|'
          || p1 || ':' || (select cp.id from contact_points cp
                            where cp.person_id = p1 and cp.channel = 'email' limit 1))));
    assert false, 'bulk request id reuse with different content must be refused';
  exception when sqlstate 'MK412' then null;
  end;
end $$;

-- ── (8) suppression honesty: recording never bypasses a hard suppression ────
do $$
declare p2 uuid := (select v from perm_ctx where k='p2')::uuid;
        r jsonb;
begin
  insert into contact_suppressions (tenant_id, person_id, channel, reason, active, source)
  values ('aaaa9300-0000-0000-0000-0000000000f1', p2, 'email', 'spam_complaint', true, 'system');
  r := marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1',
        jsonb_build_object('person_id', p2, 'decision', 'subscribed',
          'basis', 'explicit_opt_in', 'evidence_method', 'Signup form',
          'evidence_reference', 'ref-999', 'attestation', true,
          'request_id', 'perm-supp-01'));
  assert r ->> 'eligibility' = 'suppressed' and (r ->> 'suppressed')::boolean = true,
    'the fact is recorded but suppression still excludes the contact — honestly reported';
end $$;

-- ── (9) REPLAY INDEPENDENCE (single): byte-equivalent replay must converge on
--        the stored receipt even after the underlying contact state moved ────
do $$
declare p9 uuid; p10 uuid; pt9 uuid; pt10a uuid;
        args jsonb; r jsonb; r2 jsonb;
        n_pref int; n_audit int; n_event int; n_rcpt int;
begin
  r := marketing_create_contact('aaaa9300-0000-0000-0000-0000000000f1',
    'bbbb9300-0000-0000-0000-0000000000f1',
    '{"display_name":"Replay One","email":"replay.one@perm.test"}'::jsonb,
    'cccc9300-0000-0000-0000-000000000009');
  p9 := (r ->> 'person_id')::uuid;
  select cp.id into pt9 from contact_points cp
   where cp.person_id = p9 and cp.channel = 'email' limit 1;

  -- (a) EXPLICITLY selected point, then that point is INVALIDATED and replaced
  --     (true hard-deletion is structurally impossible once a preference row
  --     references the point: the ON DELETE SET NULL touch is blocked by the
  --     append-only guard — itself a property worth keeping locked)
  args := jsonb_build_object('person_id', p9, 'contact_point_id', pt9,
    'decision', 'unsubscribed', 'note', 'Asked to stop at the door',
    'request_id', 'perm-replay-01',
    'effective_at', (now() - interval '30 minutes')::text);
  r := marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', args);
  assert (r ->> 'idempotent')::boolean = false, 'first recording is genuine work';

  select count(*) into n_pref from communication_preferences
   where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1';
  select count(*) into n_audit from audit_logs
   where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
     and action like 'marketing.permission.%';
  select count(*) into n_event from platform_events
   where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
     and event_type like 'marketing.permission.%';
  select count(*) into n_rcpt from marketing_permission_requests
   where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1';

  -- the recorded endpoint becomes UNUSABLE and a different one replaces it —
  -- a fresh resolution would now refuse the explicit point outright
  update contact_points set verification_state = 'invalid', is_primary = false
   where id = pt9;
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value,
                              is_primary, verification_state, source)
  values ('aaaa9300-0000-0000-0000-0000000000f1', p9, 'email',
          'replay.one.REPLACED@perm.test', 'replay.one.replaced@perm.test',
          true, 'unverified', 'manual');

  r2 := marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
         'bbbb9300-0000-0000-0000-0000000000f1', args);
  assert (r2 ->> 'idempotent')::boolean = true
     and r2 ->> 'preference_id' = r ->> 'preference_id'
     and r2 ->> 'contact_point_id' = pt9::text,
    'REPLAY AFTER INVALIDATION+REPLACEMENT: the stored authoritative result returns unchanged';
  assert (select count(*) from communication_preferences
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1') = n_pref
     and (select count(*) from audit_logs
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
             and action like 'marketing.permission.%') = n_audit
     and (select count(*) from platform_events
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
             and event_type like 'marketing.permission.%') = n_event
     and (select count(*) from marketing_permission_requests
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1') = n_rcpt,
    'REPLAY AFTER INVALIDATION+REPLACEMENT: no preference, audit, event or receipt was added';
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1',
      args || '{"note":"a different claim"}'::jsonb);
    assert false, 'changed reuse must stay refused after the state moved';
  exception when sqlstate 'MK412' then null;
  end;

  -- (b) DEFAULT selection, then the default CHANGES (new primary appears)
  r := marketing_create_contact('aaaa9300-0000-0000-0000-0000000000f1',
    'bbbb9300-0000-0000-0000-0000000000f1',
    '{"display_name":"Replay Two","email":"replay.two@perm.test"}'::jsonb,
    'cccc9300-0000-0000-0000-000000000010');
  p10 := (r ->> 'person_id')::uuid;
  select cp.id into pt10a from contact_points cp
   where cp.person_id = p10 and cp.channel = 'email' limit 1;
  args := jsonb_build_object('person_id', p10, 'decision', 'unsubscribed',
    'request_id', 'perm-replay-02',
    'effective_at', (now() - interval '29 minutes')::text);
  r := marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', args);
  assert r ->> 'contact_point_id' = pt10a::text, 'default selection resolved the original point';

  update contact_points set is_primary = false where id = pt10a;
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value,
                              is_primary, verification_state, source)
  values ('aaaa9300-0000-0000-0000-0000000000f1', p10, 'email',
          'replay.two.NEW@perm.test', 'replay.two.new@perm.test', true, 'unverified', 'manual');

  r2 := marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
         'bbbb9300-0000-0000-0000-0000000000f1', args);
  assert (r2 ->> 'idempotent')::boolean = true
     and r2 ->> 'preference_id' = r ->> 'preference_id'
     and r2 ->> 'contact_point_id' = pt10a::text,
    'REPLAY AFTER DEFAULT CHANGE: converges on the ORIGINAL stored result, never re-resolves';

  insert into perm_ctx values ('p9', p9::text), ('p10', p10::text);
end $$;

-- ── (10) COMPLETE BULK CONTRACT: refused members and reasons bind; duplicates
--         and reordering are canonical; drift is MK409 and writes NOTHING ────
do $$
declare pa uuid; pb uuid; pc uuid;
        pd uuid := 'dddd9300-0000-0000-0000-0000000000d1';
        r jsonb; c1 text; c2 text; c3 text; c4 text; c4r text;
        ev jsonb; before_n int;
        n_pref int; n_audit int; n_event int; n_rcpt int;
begin
  r := marketing_create_contact('aaaa9300-0000-0000-0000-0000000000f1',
    'bbbb9300-0000-0000-0000-0000000000f1',
    '{"display_name":"Bulk A","email":"bulk.a@perm.test"}'::jsonb,
    'cccc9300-0000-0000-0000-000000000011');
  pa := (r ->> 'person_id')::uuid;
  r := marketing_create_contact('aaaa9300-0000-0000-0000-0000000000f1',
    'bbbb9300-0000-0000-0000-0000000000f1',
    '{"display_name":"Bulk B","email":"bulk.b@perm.test"}'::jsonb,
    'cccc9300-0000-0000-0000-000000000012');
  pb := (r ->> 'person_id')::uuid;
  r := marketing_create_contact('aaaa9300-0000-0000-0000-0000000000f1',
    'bbbb9300-0000-0000-0000-0000000000f1',
    '{"display_name":"Bulk C No Email"}'::jsonb,
    'cccc9300-0000-0000-0000-000000000013');
  pc := (r ->> 'person_id')::uuid;
  ev := jsonb_build_object('decision', 'subscribed',
    'basis', 'existing_customer_documented',
    'evidence_method', 'Service contract on file',
    'note', 'v2 contract regression fixtures', 'attestation', true);
  select count(*) into before_n from communication_preferences
   where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1';

  -- the versioned contract format itself
  r := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', 'preflight',
        jsonb_build_object('person_ids', jsonb_build_array(pa), 'decision', 'subscribed'));
  c1 := r ->> 'contract';
  assert c1 ~ '^v2:[0-9a-f]{64}$', 'the contract is versioned SHA-256, not md5';

  -- ADDING a refused member changes the truth → the old contract is dead
  r := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', 'preflight',
        jsonb_build_object('person_ids', jsonb_build_array(pa, pc), 'decision', 'subscribed'));
  c2 := r ->> 'contract';
  assert (r ->> 'eligible_count')::int = 1 and (r ->> 'refused_count')::int = 1,
    'the second selection differs ONLY in a refused member';
  assert c2 <> c1,
    'REFUSED MEMBERS BIND: identical eligible pairs, different refusals ⇒ different contract';
  begin
    perform marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
      ev || jsonb_build_object('person_ids', jsonb_build_array(pa, pc),
        'request_id', 'perm-v2-add-01', 'contract', c1));
    assert false, 'adding a refused member must invalidate the old contract';
  exception when sqlstate 'MK409' then null;
  end;

  -- REMOVING the refused member likewise
  begin
    perform marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
      ev || jsonb_build_object('person_ids', jsonb_build_array(pa),
        'request_id', 'perm-v2-rem-01', 'contract', c2));
    assert false, 'removing a refused member must invalidate the old contract';
  exception when sqlstate 'MK409' then null;
  end;

  -- a CHANGED REFUSAL REASON alone (same people, same eligible pairs) binds too
  insert into people (id, tenant_id, display_name)
  values (pd, 'aaaa9300-0000-0000-0000-0000000000f1', 'Reason Change');
  r := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', 'preflight',
        jsonb_build_object('person_ids', jsonb_build_array(pa, pd), 'decision', 'subscribed'));
  c3 := r ->> 'contract';
  assert r -> 'refused' -> 0 ->> 'reason' = 'no_usable_email', 'pd starts refused for no email';
  delete from people where id = pd;            -- same person id now resolves not_found
  r := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', 'preflight',
        jsonb_build_object('person_ids', jsonb_build_array(pa, pd), 'decision', 'subscribed'));
  assert r -> 'refused' -> 0 ->> 'reason' = 'not_found'
     and (r ->> 'contract') <> c3,
    'REASONS BIND: the refusal reason alone changed and so did the contract';
  begin
    perform marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
      ev || jsonb_build_object('person_ids', jsonb_build_array(pa, pd),
        'request_id', 'perm-v2-reason-01', 'contract', c3));
    assert false, 'a changed refusal reason must invalidate the old contract';
  exception when sqlstate 'MK409' then null;
  end;

  -- DUPLICATES are canonicalised and can never alter or bypass the result;
  -- REORDERING identical ids preserves the contract exactly
  r := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', 'preflight',
        jsonb_build_object('person_ids', jsonb_build_array(pa, pa, pb), 'decision', 'subscribed'));
  c4 := r ->> 'contract';
  assert (r ->> 'requested')::int = 3 and (r ->> 'unique')::int = 2
     and (r ->> 'eligible_count')::int = 2,
    'duplicated input collapses to the canonical unique selection';
  r := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', 'preflight',
        jsonb_build_object('person_ids', jsonb_build_array(pb, pa, pa), 'decision', 'subscribed'));
  c4r := r ->> 'contract';
  assert c4r = c4, 'REORDERING identical ids preserves the contract byte-for-byte';
  begin
    perform marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
      ev || jsonb_build_object('person_ids', jsonb_build_array(pa, pb),
        'request_id', 'perm-v2-dup-01', 'contract', c4));
    assert false, 'a different duplicate shape is a DIFFERENT request envelope';
  exception when sqlstate 'MK409' then null;
  end;

  -- every refusal above wrote NOTHING and consumed NO request id
  assert (select count(*) from communication_preferences
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1') = before_n,
    'CONTRACT FAILURE WRITES NOTHING: zero preference rows appended';
  assert not exists (select 1 from marketing_permission_requests
                      where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
                        and request_id in ('perm-v2-add-01', 'perm-v2-rem-01',
                                           'perm-v2-reason-01', 'perm-v2-dup-01')),
    'no refused apply consumed a request id';

  -- the UNTOUCHED selection applies successfully — one row per unique member
  r := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
        ev || jsonb_build_object('person_ids', jsonb_build_array(pa, pa, pb),
          'request_id', 'perm-v2-apply-01', 'contract', c4));
  assert (r ->> 'applied')::int = 2 and (r ->> 'idempotent')::boolean = false,
    'the untouched selection applies';
  assert (select count(*) from communication_preferences
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
             and evidence ->> 'request_id' = 'perm-v2-apply-01') = 2,
    'duplicated ids never double-write a member';

  -- (10b) BULK REPLAY INDEPENDENCE: a member's eligibility flips afterwards —
  --        byte-equivalent replay still returns the stored result, writes zero
  select count(*) into n_pref from communication_preferences
   where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1';
  select count(*) into n_audit from audit_logs
   where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
     and action like 'marketing.permission.%';
  select count(*) into n_event from platform_events
   where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
     and event_type like 'marketing.permission.%';
  select count(*) into n_rcpt from marketing_permission_requests
   where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1';

  update contact_points set verification_state = 'invalid'
   where person_id = pb and channel = 'email';   -- pb would now be REFUSED

  r := marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
        ev || jsonb_build_object('person_ids', jsonb_build_array(pa, pa, pb),
          'request_id', 'perm-v2-apply-01', 'contract', c4));
  assert (r ->> 'idempotent')::boolean = true and (r ->> 'applied')::int = 2,
    'BULK REPLAY AFTER ELIGIBILITY FLIP: the stored authoritative result returns';
  assert (select count(*) from communication_preferences
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1') = n_pref
     and (select count(*) from audit_logs
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
             and action like 'marketing.permission.%') = n_audit
     and (select count(*) from platform_events
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
             and event_type like 'marketing.permission.%') = n_event
     and (select count(*) from marketing_permission_requests
           where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1') = n_rcpt,
    'BULK REPLAY AFTER ELIGIBILITY FLIP: no preference, audit, event or receipt added';
  begin
    perform marketing_permission_record_bulk('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1', 'apply',
      ev || jsonb_build_object('person_ids', jsonb_build_array(pa),
        'request_id', 'perm-v2-apply-01', 'contract', c1));
    assert false, 'changed reuse of a bulk request id must stay MK412';
  exception when sqlstate 'MK412' then null;
  end;
end $$;

-- ── (11) FAIL-CLOSED ACTOR GATE: malformed resolver output can never pass ───
-- Savepoint-scoped resolver shim (the repository's in-transaction
-- fault-injection pattern); ROLLBACK TO restores the canonical resolver,
-- which the closing assertions prove.
create temporary table perm_gate_shim (v jsonb);
savepoint gate_shim;
create or replace function marketing_effective_permissions(p_profile_id uuid)
returns jsonb language sql stable as $$ select v from perm_gate_shim limit 1 $$;
do $$
declare payload jsonb; label text; denied boolean;
begin
  -- control first: a WELL-FORMED verdict passes, proving the shim drives the gate
  insert into perm_gate_shim values
    ('{"enabled": true, "permissions": ["marketing.contacts.manage"]}'::jsonb);
  label := marketing_permission_require_actor('aaaa9300-0000-0000-0000-0000000000f1',
             'bbbb9300-0000-0000-0000-0000000000f1');
  assert label = 'owner-a@perm.test', 'control: the shim genuinely drives the gate';

  for payload in
    select * from (values
      (null::jsonb),                                              -- resolver returned NULL
      ('null'::jsonb),                                            -- JSON null
      ('"granted"'::jsonb),                                       -- non-object
      ('{}'::jsonb),                                              -- no fields at all
      ('{"permissions": ["marketing.contacts.manage"]}'::jsonb),  -- enabled MISSING
      ('{"enabled": null, "permissions": ["marketing.contacts.manage"]}'::jsonb),
      ('{"enabled": "maybe", "permissions": ["marketing.contacts.manage"]}'::jsonb),
      ('{"enabled": false, "permissions": ["marketing.contacts.manage"]}'::jsonb),
      ('{"enabled": true}'::jsonb),                               -- permissions MISSING
      ('{"enabled": true, "permissions": null}'::jsonb),
      ('{"enabled": true, "permissions": "marketing.contacts.manage"}'::jsonb),
      ('{"enabled": true, "permissions": {"marketing.contacts.manage": true}}'::jsonb),
      ('{"enabled": true, "permissions": []}'::jsonb),
      ('{"enabled": true, "permissions": ["marketing.view"]}'::jsonb)
    ) t(v)
  loop
    delete from perm_gate_shim;
    insert into perm_gate_shim values (payload);
    denied := false;
    begin
      perform marketing_permission_require_actor('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1');
    exception when insufficient_privilege then denied := true;
    end;
    assert denied, format('FAIL-CLOSED: resolver output %s must deny 42501',
                          coalesce(payload::text, 'SQL NULL'));
  end loop;

  -- the full RPC fails closed too, and a denied call writes NOTHING
  delete from perm_gate_shim;
  insert into perm_gate_shim values ('{}'::jsonb);
  denied := false;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f1',
      jsonb_build_object('person_id', (select v from perm_ctx where k = 'p1'),
        'decision', 'unsubscribed', 'request_id', 'perm-gate-never'));
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'the record RPC itself fails closed on malformed resolution';
  assert not exists (select 1 from marketing_permission_requests
                      where tenant_id = 'aaaa9300-0000-0000-0000-0000000000f1'
                        and request_id = 'perm-gate-never'),
    'the denied call consumed nothing';
end $$;
rollback to savepoint gate_shim;
do $$
declare denied boolean;
begin
  -- the canonical resolver is restored and intact
  assert (marketing_effective_permissions('bbbb9300-0000-0000-0000-0000000000f1')
            ->> 'enabled')::boolean = true
     and (marketing_effective_permissions('bbbb9300-0000-0000-0000-0000000000f1')
            -> 'permissions') ? 'marketing.contacts.manage',
    'the canonical resolver is restored after the shimmed section';

  -- a HOSTILE RAW permission row still cannot widen authority
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted)
  values ('aaaa9300-0000-0000-0000-0000000000f1',
          'bbbb9300-0000-0000-0000-0000000000f3', 'marketing.contacts.manage', true);
  denied := false;
  begin
    perform marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
      'bbbb9300-0000-0000-0000-0000000000f3',
      jsonb_build_object('person_id', (select v from perm_ctx where k = 'p1'),
        'decision', 'unsubscribed', 'request_id', 'perm-hostile-never'));
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'a hostile raw grant row cannot let a viewer record permission';
end $$;

-- ── (12) DETERMINISTIC OPT-OUT PRECEDENCE on an exact timestamp tie ─────────
do $$
declare pt uuid; ep uuid; r jsonb; ts timestamptz := now() - interval '3 hours';
        cur jsonb;
begin
  r := marketing_create_contact('aaaa9300-0000-0000-0000-0000000000f1',
    'bbbb9300-0000-0000-0000-0000000000f1',
    '{"display_name":"Tie Break","email":"tie.break@perm.test"}'::jsonb,
    'cccc9300-0000-0000-0000-000000000014');
  pt := (r ->> 'person_id')::uuid;
  select cp.id into ep from contact_points cp
   where cp.person_id = pt and cp.channel = 'email' limit 1;

  -- same scope, IDENTICAL effective_at AND created_at — subscribed AND
  -- unsubscribed facts recorded at the exact same instant
  insert into communication_preferences
    (tenant_id, person_id, contact_point_id, channel, state, source,
     evidence, effective_at, created_at)
  values
    ('aaaa9300-0000-0000-0000-0000000000f1', pt, ep, 'email', 'subscribed',
     'manual', '{"note":"tie fixture"}'::jsonb, ts, ts),
    ('aaaa9300-0000-0000-0000-0000000000f1', pt, ep, 'email', 'unsubscribed',
     'manual', '{"note":"tie fixture"}'::jsonb, ts, ts);

  -- the ONE deterministic rule, everywhere current state is derived:
  assert marketing_contact_eligibility('aaaa9300-0000-0000-0000-0000000000f1',
           pt, 'email') = 'unsubscribed',
    'CONTACT + SEGMENT GATE (marketing_contact_eligibility): unsubscribed wins the exact tie';
  assert marketing_endpoint_eligibility('aaaa9300-0000-0000-0000-0000000000f1',
           pt, 'email', ep) = 'unsubscribed',
    'PRE-SEND ENDPOINT GATE (broadcasts + sequences): unsubscribed wins the exact tie';
  select lp into cur from jsonb_array_elements(
    marketing_contact_detail('aaaa9300-0000-0000-0000-0000000000f1', pt) -> 'preferences') lp
   where lp ->> 'contact_point_id' = ep::text and lp ->> 'channel' = 'email';
  assert cur ->> 'state' = 'unsubscribed',
    'CONTACT DETAIL projection agrees: the displayed current preference is unsubscribed';
  r := marketing_permission_history('aaaa9300-0000-0000-0000-0000000000f1', pt);
  assert r ->> 'eligibility' = 'unsubscribed'
     and r -> 'history' -> 0 ->> 'state' = 'unsubscribed',
    'PERMISSION HISTORY agrees: the newest-first trail leads with the opt-out';

  -- a genuinely NEWER evidenced resubscription still wins
  r := marketing_permission_record('aaaa9300-0000-0000-0000-0000000000f1',
        'bbbb9300-0000-0000-0000-0000000000f1',
        jsonb_build_object('person_id', pt, 'contact_point_id', ep,
          'decision', 'subscribed', 'basis', 'explicit_opt_in',
          'evidence_method', 'New signup at the service visit',
          'evidence_reference', 'Paper form, scanned to CRM',
          'attestation', true, 'request_id', 'perm-tie-resub-01',
          'effective_at', (now() - interval '1 hour')::text));
  assert r ->> 'eligibility' = 'subscribed',
    'a genuinely newer evidenced resubscription still wins over the tied opt-out';
end $$;

select 'ALL ASSERTIONS PASSED — governed marketing-permission capture + correctness pass' as result;

rollback;
