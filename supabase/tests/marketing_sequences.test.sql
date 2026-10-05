-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_sequences.test.sql
--
-- Proves Marketing Phase 6 (migration 20260903120000) end to end with the REAL
-- untouched Automation Engine and STUBBED provider results (no network, no
-- email): authority ceilings, the governed sequence lifecycle with factual
-- anchoring, immutable revisions + steps, revision PINNING for live
-- enrolments, one-use activation and enrolment confirmations, the immutable
-- enrolment batch with every candidate and exact exclusion reasons, the
-- lease-safe due/claim engine, deterministic wait scheduling (including
-- non-hour DST folds), the complete per-step engine lineage (email with a
-- GENUINE tenant_senior approval; internal actions with an honest delegated
-- decision and NO fabricated approval), the three-point suppression race
-- closure, exit rules from canonical evidence only, pause/resume/cancel/close
-- semantics, truthful completion, factual reporting, cross-tenant and RLS
-- boundaries, and a catalog assertion that NO Phase-6 function is
-- client-reachable.
begin;

create temp table p6_ctx (key text primary key, val text);

insert into tenants (id, slug, display_name, industry) values
  ('aaaa9100-0000-0000-0000-0000000000f1','p6-t1','Phase6 Tenant 1','hvac'),
  ('aaaa9100-0000-0000-0000-0000000000f2','p6-t2','Phase6 Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb9100-0000-0000-0000-000000000001','p6-owner@x.test',false,false),
  ('bbbb9100-0000-0000-0000-000000000002','p6-ops@x.test',false,false),
  ('bbbb9100-0000-0000-0000-000000000003','p6-viewer@x.test',false,false),
  ('bbbb9100-0000-0000-0000-000000000004','p6-admin@x.test',false,false),
  ('bbbb9100-0000-0000-0000-000000000005','p6-admin-b@x.test',false,false);
update profiles set role='owner',  tenant_id='aaaa9100-0000-0000-0000-0000000000f1' where id='bbbb9100-0000-0000-0000-000000000001';
update profiles set role='ops',    tenant_id='aaaa9100-0000-0000-0000-0000000000f1' where id='bbbb9100-0000-0000-0000-000000000002';
update profiles set role='viewer', tenant_id='aaaa9100-0000-0000-0000-0000000000f1' where id='bbbb9100-0000-0000-0000-000000000003';
update profiles set role='admin',  tenant_id='aaaa9100-0000-0000-0000-0000000000f1' where id='bbbb9100-0000-0000-0000-000000000004';
update profiles set role='admin',  tenant_id='aaaa9100-0000-0000-0000-0000000000f2' where id='bbbb9100-0000-0000-0000-000000000005';

select marketing_materialise_defaults('aaaa9100-0000-0000-0000-0000000000f1','bbbb9100-0000-0000-0000-000000000001');
select marketing_materialise_defaults('aaaa9100-0000-0000-0000-0000000000f2','bbbb9100-0000-0000-0000-000000000005');

insert into email_accounts (id, tenant_id, provider, email_address, status, auth_state) values
  ('eeee9100-0000-0000-0000-0000000000a1','aaaa9100-0000-0000-0000-0000000000f1','gmail','sender@p6-t1.test','active','ok');
insert into email_oauth_tokens (tenant_id, email_account_id, provider, access_token, refresh_token, expires_at, scope) values
  ('aaaa9100-0000-0000-0000-0000000000f1','eeee9100-0000-0000-0000-0000000000a1','gmail','tok','ref', now() + interval '1 hour',
   'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');
do $$
declare r jsonb;
begin
  r := marketing_sender_create('aaaa9100-0000-0000-0000-0000000000f1','bbbb9100-0000-0000-0000-000000000001',
        '{"source_kind":"gmail_oauth","source_id":"eeee9100-0000-0000-0000-0000000000a1","label":"P6 sender","from_name":"Drummonds"}');
  insert into p6_ctx values ('sender', r ->> 'id');
  perform marketing_sender_set_enabled('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-000000000001', (r ->> 'id')::uuid, true,
    (select updated_at from marketing_sender_profiles where id = (r ->> 'id')::uuid));
  r := marketing_tag_mutate('aaaa9100-0000-0000-0000-0000000000f1','bbbb9100-0000-0000-0000-000000000001',
        'create','{"label":"P6 Nurtured"}');
  insert into p6_ctx values ('tag', r ->> 'id');
end $$;

-- PEOPLE: One is fully eligible; Two has no explicit preference; Three is
-- unsubscribed; Four has no contact point.
insert into people (id, tenant_id, display_name, first_name, last_name, primary_email) values
  ('de1e9100-0000-0000-0000-000000000001','aaaa9100-0000-0000-0000-0000000000f1','P6A One','Pat','One','p6a-one@x.test'),
  ('de1e9100-0000-0000-0000-000000000002','aaaa9100-0000-0000-0000-0000000000f1','P6A Two','Tia','Two','p6a-two@x.test'),
  ('de1e9100-0000-0000-0000-000000000003','aaaa9100-0000-0000-0000-0000000000f1','P6A Three','Tom','Three','p6a-three@x.test'),
  ('de1e9100-0000-0000-0000-000000000004','aaaa9100-0000-0000-0000-0000000000f1','P6A Four','Fay','Four',null);
insert into contact_points (id, tenant_id, person_id, channel, value, normalized_value, is_primary, verification_state) values
  ('c0149100-0000-0000-0000-000000000001','aaaa9100-0000-0000-0000-0000000000f1','de1e9100-0000-0000-0000-000000000001','email','p6a-one@x.test','p6a-one@x.test',true,'verified'),
  ('c0149100-0000-0000-0000-000000000002','aaaa9100-0000-0000-0000-0000000000f1','de1e9100-0000-0000-0000-000000000002','email','p6a-two@x.test','p6a-two@x.test',true,'unverified'),
  ('c0149100-0000-0000-0000-000000000003','aaaa9100-0000-0000-0000-0000000000f1','de1e9100-0000-0000-0000-000000000003','email','p6a-three@x.test','p6a-three@x.test',true,'unverified');
insert into communication_preferences (tenant_id, person_id, channel, state, source) values
  ('aaaa9100-0000-0000-0000-0000000000f1','de1e9100-0000-0000-0000-000000000001','email','subscribed','manual'),
  ('aaaa9100-0000-0000-0000-0000000000f1','de1e9100-0000-0000-0000-000000000003','email','unsubscribed','manual');
insert into marketing_segments (id, tenant_id, name, definition, definition_version, status) values
  ('5e9e9100-0000-0000-0000-000000000001','aaaa9100-0000-0000-0000-0000000000f1','P6A audience',
   '{"field":"search","value":"P6A"}', 1, 'active');

-- ── (1) AUTHORITY: draft vs launch ceilings; hostile grants inert ───────────
do $$
declare r jsonb; cid uuid;
begin
  -- viewer cannot draft
  begin
    perform marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000003',
      jsonb_build_object('name','X','sender_id',(select val from p6_ctx where key='sender'),
        'steps', jsonb_build_array(jsonb_build_object('type','send_email','config',
          jsonb_build_object('subject','S','body_authored','B')))));
    assert false, 'a viewer must be denied sequence creation';
  exception when sqlstate '42501' then null;
  end;
  -- a cross-tenant actor is rejected structurally
  begin
    perform marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000005', '{}'::jsonb);
    assert false, 'a cross-tenant actor must be rejected';
  exception when integrity_constraint_violation then null;
  end;

  -- ops CAN draft a full journey
  r := marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000002',
        jsonb_build_object('name','Welcome journey','description','First governed sequence',
          'sender_id',(select val from p6_ctx where key='sender'),
          'timezone','Europe/London',
          'exit_rules', jsonb_build_object('on_reply', true),
          'steps', jsonb_build_array(
            jsonb_build_object('key','s1','type','send_email','config',
              jsonb_build_object('subject','Hello {{first_name}}',
                                 'body_authored','Hi {{first_name}}, welcome.')),
            jsonb_build_object('key','s2','type','wait_duration','config',
              jsonb_build_object('unit','minutes','amount',1)),
            jsonb_build_object('key','s3','type','apply_tag','config',
              jsonb_build_object('tag_id',(select val from p6_ctx where key='tag'))))));
  cid := (r ->> 'id')::uuid;
  insert into p6_ctx values ('seqA', cid::text);
  assert (r ->> 'status') = 'draft' and (r ->> 'step_count')::int = 3,
    'ops created a 3-step draft sequence';
  assert (select campaign_type from marketing_campaigns where id = cid) = 'sequence',
    'a sequence IS a campaign of type sequence — one campaign identity';

  -- content validation reuses the ONE Phase-5 authored model
  begin
    perform marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000002',
      jsonb_build_object('name','Bad','sender_id',(select val from p6_ctx where key='sender'),
        'steps', jsonb_build_array(jsonb_build_object('type','send_email','config',
          jsonb_build_object('subject','Hi {{postcode}}','body_authored','B')))));
    assert false, 'an unknown personalisation token must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- arbitrary step configuration is refused
  begin
    perform marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000002',
      jsonb_build_object('name','Bad2','sender_id',(select val from p6_ctx where key='sender'),
        'steps', jsonb_build_array(jsonb_build_object('type','apply_tag','config',
          jsonb_build_object('tag_id',(select val from p6_ctx where key='tag'),
                             'sql','drop table people')))));
    assert false, 'an undeclared step config key must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- a cross-tenant tag can never be configured
  begin
    perform marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000002',
      jsonb_build_object('name','Bad3','sender_id',(select val from p6_ctx where key='sender'),
        'steps', jsonb_build_array(jsonb_build_object('type','apply_tag','config',
          jsonb_build_object('tag_id', gen_random_uuid())))));
    assert false, 'a tag outside the tenant must be rejected';
  exception when sqlstate 'P0002' then null;
  end;
  -- the first step may not be a wait
  begin
    perform marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000002',
      jsonb_build_object('name','Bad4','sender_id',(select val from p6_ctx where key='sender'),
        'steps', jsonb_build_array(jsonb_build_object('type','wait_duration','config',
          jsonb_build_object('unit','days','amount',1)))));
    assert false, 'a sequence cannot begin with a wait';
  exception when sqlstate '22023' then null;
  end;

  -- ops submits for review, but can NEVER approve…
  r := marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000002', cid, 'submit_review',
        (select version from marketing_campaigns where id = cid));
  assert (r ->> 'status') = 'review', 'draft -> review by the drafter';
  begin
    perform marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000002', cid, 'approve',
      (select version from marketing_campaigns where id = cid));
    assert false, 'ops must never approve a sequence';
  exception when sqlstate '42501' then null;
  end;
  -- …and a HOSTILE raw launch grant to ops stays inert
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa9100-0000-0000-0000-0000000000f1','bbbb9100-0000-0000-0000-000000000002',
          'marketing.campaigns.launch', true, 'bbbb9100-0000-0000-0000-000000000001');
  begin
    perform marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000002', cid, 'approve',
      (select version from marketing_campaigns where id = cid));
    assert false, 'a hostile raw grant must not bypass the owner/admin ceiling';
  exception when sqlstate '42501' then null;
  end;
  -- an explicit DENY defeats the admin role default
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa9100-0000-0000-0000-0000000000f1','bbbb9100-0000-0000-0000-000000000004',
          'marketing.campaigns.launch', false, 'bbbb9100-0000-0000-0000-000000000001');
  begin
    perform marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000004', cid, 'approve',
      (select version from marketing_campaigns where id = cid));
    assert false, 'an explicit deny must defeat the admin role default';
  exception when sqlstate '42501' then null;
  end;
  delete from marketing_access_grants where profile_id = 'bbbb9100-0000-0000-0000-000000000004';
end $$;

-- ── (2) LIFECYCLE: guarded machine + fabrication battery ────────────────────
do $$
declare cid uuid; r jsonb; rev1 uuid;
begin
  cid := (select val from p6_ctx where key='seqA')::uuid;

  -- FABRICATION battery (direct service-role writes):
  begin
    update marketing_campaigns set status = 'approved' where id = cid;
    assert false, 'approved cannot be fabricated without a sequence approval';
  exception when raise_exception then null;
  end;
  begin
    update marketing_campaigns set status = 'active' where id = cid;
    assert false, 'review -> active is illegal';
  exception when raise_exception then null;
  end;

  -- owner approves
  r := marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid, 'approve',
        (select version from marketing_campaigns where id = cid));
  assert (r ->> 'status') = 'approved' and (r ->> 'approval_id') is not null,
    'owner approval binds and transitions';
  rev1 := (select current_sequence_revision_id from marketing_campaigns where id = cid);
  insert into p6_ctx values ('revA1', rev1::text);
  assert (select bundle_hash from marketing_sequence_approvals
           where id = (r ->> 'approval_id')::uuid)
       = (select bundle_hash from marketing_sequence_revisions where id = rev1),
    'the approval binds the exact immutable bundle hash';

  -- revisions and steps are IMMUTABLE
  begin
    update marketing_sequence_revisions set timezone = 'UTC' where id = rev1;
    assert false, 'a sequence revision is immutable';
  exception when raise_exception then null;
  end;
  begin
    update marketing_sequence_steps set step_order = 9 where revision_id = rev1;
    assert false, 'a sequence step is immutable';
  exception when raise_exception then null;
  end;
  -- approvals are append-only
  begin
    update marketing_sequence_approvals set decision = 'changes_requested' where campaign_id = cid;
    assert false, 'sequence approvals are append-only';
  exception when raise_exception then null;
  end;

  -- ACTIVATION cannot be fabricated without a USED confirmation
  begin
    update marketing_campaigns set status = 'active' where id = cid;
    assert false, 'activation requires a used activation confirmation';
  exception when raise_exception then null;
  end;

  -- out-of-sequence transitions are STABLE client errors, not raw exceptions
  begin
    perform marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000001', cid, 'pause',
      (select version from marketing_campaigns where id = cid));
    assert false, 'pausing an approved (not yet active) sequence must be refused';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000001', cid, 'archive',
      (select version from marketing_campaigns where id = cid));
    assert false, 'archiving a live sequence must be refused';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ── (3) ACTIVATION: one-use, digest-only, revision-bound ────────────────────
do $$
declare cid uuid; conf jsonb; r jsonb; v int;
begin
  cid := (select val from p6_ctx where key='seqA')::uuid;
  v := (select version from marketing_campaigns where id = cid);

  -- an email-bearing sequence CANNOT activate without a public base URL
  begin
    perform marketing_sequence_preflight_activation('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000001', cid, v, null);
    assert false, 'a sending sequence must refuse activation without an unsubscribe base URL';
  exception when sqlstate 'MK428' then null;
  end;
  -- drafters cannot preflight activation
  begin
    perform marketing_sequence_preflight_activation('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000002', cid, v, 'https://unsub.p6.test/functions/v1');
    assert false, 'activation preflight requires launch authority';
  exception when sqlstate '42501' then null;
  end;

  conf := marketing_sequence_preflight_activation('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-000000000001', cid, v, 'https://unsub.p6.test/functions/v1');
  insert into p6_ctx values ('confA', conf ->> 'confirmation_id'),
                            ('challengeA', conf ->> 'challenge');
  assert (conf ->> 'email_steps')::int = 1 and (conf ->> 'step_count')::int = 3,
    'the activation preflight states exactly what will happen';
  -- ONLY the digest is stored
  assert (select challenge_digest from marketing_sequence_confirmations
           where id = (conf ->> 'confirmation_id')::uuid)
       = encode(extensions.digest(conf ->> 'challenge', 'sha256'), 'hex')
     and (select challenge_digest from marketing_sequence_confirmations
           where id = (conf ->> 'confirmation_id')::uuid) <> (conf ->> 'challenge'),
    'only the challenge DIGEST is stored';

  -- a wrong challenge is refused
  begin
    perform marketing_sequence_activate('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000001', cid,
      jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
        'challenge', repeat('d', 48), 'request_id', 'p6-act-bad1'));
    assert false, 'a wrong activation challenge must be refused';
  exception when sqlstate '42501' then null;
  end;
  -- another actor cannot use it
  begin
    perform marketing_sequence_activate('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000004', cid,
      jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
        'challenge', conf ->> 'challenge', 'request_id', 'p6-act-bad2'));
    assert false, 'a confirmation is bound to its requesting actor';
  exception when sqlstate '42501' then null;
  end;

  r := marketing_sequence_activate('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid,
        jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
          'challenge', conf ->> 'challenge', 'request_id', 'p6-act-0001'));
  assert (r ->> 'status') = 'active' and not (r ->> 'idempotent')::boolean,
    'the sequence is active';
  -- replay of the SAME request converges; a different one is a stable MK412
  r := marketing_sequence_activate('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid,
        jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
          'challenge', conf ->> 'challenge', 'request_id', 'p6-act-0001'));
  assert (r ->> 'idempotent')::boolean, 'the same activation request converges';
  begin
    perform marketing_sequence_activate('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000001', cid,
      jsonb_build_object('confirmation_id', gen_random_uuid(),
        'challenge', conf ->> 'challenge', 'request_id', 'p6-act-0001'));
    assert false, 'a reused request id with different data must be MK412';
  exception when sqlstate 'MK412' then null;
  end;
end $$;

-- ── (4) ENROLMENT: immutable batch, exact reasons, convergent confirmation ──
do $$
declare cid uuid; b jsonb; r jsonb; n int; brk jsonb;
begin
  cid := (select val from p6_ctx where key='seqA')::uuid;

  -- guardrail: a cap below the audience refuses and persists NOTHING
  update marketing_settings set max_sequence_enrolments = 2
   where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1';
  begin
    perform marketing_sequence_preflight_enrolment('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000001', cid,
      jsonb_build_object('source','segment','segment_id','5e9e9100-0000-0000-0000-000000000001'));
    assert false, 'an audience above the guardrail must be refused';
  exception when sqlstate 'MK413' then null;
  end;
  assert not exists (select 1 from marketing_enrolment_batches where campaign_id = cid),
    'a refused preflight persists no batch';
  update marketing_settings set max_sequence_enrolments = 500
   where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1';

  b := marketing_sequence_preflight_enrolment('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid,
        jsonb_build_object('source','segment','segment_id','5e9e9100-0000-0000-0000-000000000001'));
  insert into p6_ctx values ('batchA', b ->> 'batch_id'),
                            ('confEnrolA', b ->> 'confirmation_id'),
                            ('challengeEnrolA', b ->> 'challenge');
  assert (b ->> 'candidate_count')::int = 4
     and (b ->> 'eligible_count')::int = 1
     and (b ->> 'excluded_count')::int = 3,
    'every candidate is recorded: 4 candidates, 1 eligible, 3 excluded';
  brk := b -> 'exclusion_breakdown';
  assert (brk ->> 'unknown_preference')::int = 1     -- Two
     and (brk ->> 'unsubscribed')::int = 1           -- Three
     and (brk ->> 'no_contact_point')::int = 1,      -- Four
    'the exclusion breakdown is exact';
  select count(*) into n from marketing_enrolment_candidates
   where batch_id = (b ->> 'batch_id')::uuid;
  assert n = 4, 'EVERY candidate has an immutable row';
  assert (select eligible_count + excluded_count from marketing_enrolment_batches
           where id = (b ->> 'batch_id')::uuid) = n,
    'batch counts equal the persisted rows';
  -- candidate rows are immutable
  begin
    update marketing_enrolment_candidates set eligible = true
     where batch_id = (b ->> 'batch_id')::uuid and not eligible;
    assert false, 'enrolment candidates are immutable';
  exception when raise_exception then null;
  end;

  r := marketing_sequence_confirm_enrolment('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid,
        jsonb_build_object('confirmation_id', b ->> 'confirmation_id',
          'challenge', b ->> 'challenge', 'request_id', 'p6-enr-0001'));
  assert (r ->> 'enrolled')::int = 1, 'exactly the eligible Person is enrolled';
  insert into p6_ctx values ('enrolA',
    (select id::text from marketing_sequence_enrolments where campaign_id = cid limit 1));
  -- the enrolment pins BOTH the revision and the endpoint
  assert (select revision_id from marketing_sequence_enrolments where campaign_id = cid)
       = (select val from p6_ctx where key='revA1')::uuid
     and (select contact_point_id from marketing_sequence_enrolments where campaign_id = cid)
       = 'c0149100-0000-0000-0000-000000000001',
    'the enrolment pins its revision AND its contact point';
  -- replay converges; the batch cannot be confirmed twice
  r := marketing_sequence_confirm_enrolment('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid,
        jsonb_build_object('confirmation_id', b ->> 'confirmation_id',
          'challenge', b ->> 'challenge', 'request_id', 'p6-enr-0001'));
  assert (r ->> 'idempotent')::boolean, 'the same enrolment request converges';
  select count(*) into n from marketing_sequence_enrolments where campaign_id = cid;
  assert n = 1, 'no duplicate enrolment was created';

  -- an ALREADY-enrolled Person is excluded from a later batch by exact reason
  b := marketing_sequence_preflight_enrolment('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid,
        jsonb_build_object('source','manual','person_ids',
          jsonb_build_array('de1e9100-0000-0000-0000-000000000001')));
  assert (b -> 'exclusion_breakdown' ->> 'already_enrolled')::int = 1,
    'a live enrolment blocks re-enrolment with the exact reason';
end $$;

-- ── (5) WORKER: leases, wait determinism, engine lineage, approvals ─────────
do $$
declare
  cid uuid; enrol uuid; x record; b jsonb; lin jsonb; url text; n int;
  claim record; corr uuid := gen_random_uuid(); fin record; appr record;
begin
  cid := (select val from p6_ctx where key='seqA')::uuid;
  enrol := (select val from p6_ctx where key='enrolA')::uuid;

  -- claim step 1 (send_email); a second worker gets nothing
  select count(*) into n from marketing_sequence_claim_batch(
    'aaaa9100-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  assert n = 1, 'w1 leased the due step';
  select * into x from marketing_sequence_executions where enrolment_id = enrol;
  insert into p6_ctx values ('execA1', x.id::text);
  assert x.step_order = 1 and x.step_type = 'send_email' and x.status = 'preparing',
    'the first step is leased for work';
  assert not exists (select 1 from marketing_sequence_claim_batch(
    'aaaa9100-0000-0000-0000-0000000000f1', 'w2', 10, 120)),
    'a concurrent worker cannot claim a leased step';
  -- the wrong worker cannot use the lease
  begin
    perform marketing_sequence_step_bundle('aaaa9100-0000-0000-0000-0000000000f1', x.id, 'w2');
    assert false, 'a foreign worker must not read the bundle';
  exception when sqlstate 'MK423' then null;
  end;

  b := marketing_sequence_step_bundle('aaaa9100-0000-0000-0000-0000000000f1', x.id, 'w1');
  assert (b ->> 'step_type') = 'send_email'
     and (b -> 'personalisation' ->> 'first_name') = 'Pat'
     and (b ->> 'unsubscribe_token') ~ '^[0-9a-f]{48}$',
    'the bundle carries frozen inputs + a freshly minted token';
  assert (select token_digest from marketing_unsubscribe_tokens
           where id = (b ->> 'unsubscribe_token_id')::uuid)
       = encode(extensions.digest(b ->> 'unsubscribe_token', 'sha256'), 'hex'),
    'ONLY the token digest is stored';
  url := (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || (b ->> 'unsubscribe_token');

  -- a forged token in the rendered URL is refused
  begin
    perform marketing_sequence_create_email_lineage('aaaa9100-0000-0000-0000-0000000000f1',
      x.id, 'w1',
      jsonb_build_object('subject','Hello Pat',
        'body_text','Hi' || e'\n\nUnsubscribe: ' || (b ->> 'public_base_url')
                    || '/marketing-unsubscribe?t=' || repeat('f', 48),
        'body_html','<div>Hi <a href="x">u</a></div>',
        'unsubscribe_url', (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || repeat('f', 48)));
    assert false, 'a forged unsubscribe token must be refused';
  exception when sqlstate '22023' then null;
  end;

  lin := marketing_sequence_create_email_lineage('aaaa9100-0000-0000-0000-0000000000f1', x.id, 'w1',
    jsonb_build_object('subject','Hello Pat',
      'body_text','Hi Pat, welcome.' || e'\n\nUnsubscribe: ' || url,
      'body_html','<div>Hi Pat, welcome. <a href="' || url || '">Unsubscribe</a></div>',
      'unsubscribe_url', url));
  insert into p6_ctx values ('delA', lin ->> 'delivery_id'), ('intentA', lin ->> 'intent_id');
  assert (select intent_type from automation_intents where id = (lin ->> 'intent_id')::uuid)
       = 'send_marketing_sequence_email', 'the sequence intent type is used';
  assert (select requires_approval from automation_intent_types
           where intent_type = 'send_marketing_sequence_email'),
    'the sequence email intent type is registered approval-required';
  assert (select approved_payload_hash from automation_intents where id = (lin ->> 'intent_id')::uuid)
       = automation_intent_envelope_hash('aaaa9100-0000-0000-0000-0000000000f1',
                                         (lin ->> 'intent_id')::uuid),
    'the complete approved envelope hash is pinned';
  select * into appr from automation_approvals
   where automation_intent_id = (lin ->> 'intent_id')::uuid;
  assert appr.approver_kind = 'tenant_senior'
     and appr.approver_ref = 'bbbb9100-0000-0000-0000-000000000001'
     and appr.authority_basis = 'marketing.campaigns.launch',
    'ONE tenant_senior approval names the GENUINE owner who approved the sequence';
  assert (select decision from decision_log
           where id = (select decision_id from automation_intents where id = (lin ->> 'intent_id')::uuid))
       = 'AUTOMATION_REQUIRES_APPROVAL', 'the decision honestly requires approval';
  assert (select purpose from marketing_deliveries where id = (lin ->> 'delivery_id')::uuid) = 'sequence'
     and (select sequence_enrolment_id from marketing_deliveries where id = (lin ->> 'delivery_id')::uuid) = enrol,
    'the delivery carries the full sequence lineage';

  -- the canonical pre-provider authority (what the ADAPTER calls)
  b := marketing_sequence_send_authority('aaaa9100-0000-0000-0000-0000000000f1',
                                         (lin ->> 'delivery_id')::uuid);
  assert (b ->> 'allowed')::boolean, 'the authority allows the healthy recipient';

  -- REAL engine execution with a STUBBED provider result
  select * into claim from automation_claim_and_start(
    (select val from p6_ctx where key='intentA')::uuid, 'aaaa9100-0000-0000-0000-0000000000f1',
    'p6-worker', 120, 'idem-p6-' || (select val from p6_ctx where key='intentA'), corr, 'test');
  assert claim.intent_type = 'send_marketing_sequence_email'
     and claim.envelope_parameters ->> 'purpose' = 'sequence',
    'the engine hands the adapter the frozen sequence envelope';
  select * into fin from automation_finalize_execution(
    'aaaa9100-0000-0000-0000-0000000000f1', (select val from p6_ctx where key='intentA')::uuid,
    claim.attempt_id, 'p6-worker', 'succeeded',
    jsonb_build_object('message_id','gm-seq-001','thread_id','gm-thr-seq-001',
                       'delivery_id', (select val from p6_ctx where key='delA')::uuid,
                       'submitted_at', now()),
    null, 'succeeded', false, null, 'gm-seq-001', '2xx',
    'marketing_email_submitted', 'operational', corr, null);
  perform marketing_delivery_reconcile('aaaa9100-0000-0000-0000-0000000000f1',
                                       (select val from p6_ctx where key='delA')::uuid);
  assert (select status from marketing_deliveries where id = (select val from p6_ctx where key='delA')::uuid)
       = 'submitted', 'the delivery is submitted';
  assert (select status from marketing_sequence_executions where id = (select val from p6_ctx where key='execA1')::uuid)
       = 'succeeded', 'the step execution succeeded';
  -- the enrolment ADVANCED exactly once, to the wait step
  assert (select current_step_order from marketing_sequence_enrolments where id = enrol) = 2,
    'the enrolment advanced exactly once';

  -- canonical email projection with campaign + person provenance
  assert exists (select 1 from email_messages
                  where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1'
                    and provider_message_id = 'gm-seq-001'
                    and origin_campaign_id = cid
                    and origin_person_id = 'de1e9100-0000-0000-0000-000000000001'),
    'the canonical email carries structural campaign/person provenance';

  -- WAIT step: the claim resolves it in SQL and persists the instant ONCE
  select count(*) into n from marketing_sequence_claim_batch(
    'aaaa9100-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  assert n = 0, 'a wait step is a scheduling fact, never worker work';
  select * into x from marketing_sequence_executions
   where enrolment_id = enrol and step_order = 2;
  assert x.status = 'pending' and x.scheduled_for > now(),
    'the wait persisted its own future instant';
  assert (select next_eligible_at from marketing_sequence_enrolments where id = enrol)
       = x.scheduled_for, 'the enrolment is not due until the wait elapses';
  -- the persisted schedule is IMMUTABLE (a retry can never make it drift)
  begin
    update marketing_sequence_executions set scheduled_for = now() where id = x.id;
    assert false, 'a persisted wait instant is immutable';
  exception when raise_exception then null;
  end;
end $$;

-- ── (6) INTERNAL ACTION STEP: registered capability, honest authority ───────
do $$
declare cid uuid; enrol uuid; x record; lin jsonb; claim record; n int;
        corr uuid := gen_random_uuid();
begin
  cid := (select val from p6_ctx where key='seqA')::uuid;
  enrol := (select val from p6_ctx where key='enrolA')::uuid;
  -- fast-forward the wait: the ONLY supported way is the persisted instant
  update marketing_sequence_enrolments set next_eligible_at = now() - interval '1 second'
   where id = enrol;
  update marketing_sequence_executions set status = 'preparing'
   where enrolment_id = enrol and step_order = 2 and status = 'pending';
  update marketing_sequence_executions set status = 'succeeded', finished_at = now()
   where enrolment_id = enrol and step_order = 2;
  update marketing_sequence_enrolments set current_step_order = 3, next_eligible_at = now()
   where id = enrol;

  select count(*) into n from marketing_sequence_claim_batch(
    'aaaa9100-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  assert n = 1, 'the tag step is leased for work';
  select * into x from marketing_sequence_executions
   where enrolment_id = enrol and step_order = 3;
  assert x.step_type = 'apply_tag', 'step 3 is the internal action';

  lin := marketing_sequence_create_action_lineage('aaaa9100-0000-0000-0000-0000000000f1', x.id, 'w1');
  assert (lin ->> 'intent_id') is not null, 'the internal action created a governed intent';
  assert (select intent_type from automation_intents where id = (lin ->> 'intent_id')::uuid)
       = 'marketing_apply_tag'
     and (select capability_key from automation_intents where id = (lin ->> 'intent_id')::uuid)
       = 'marketing.contact_action',
    'the registered internal capability is used';
  assert (select external_side_effect from automation_intent_types
           where intent_type = 'marketing_apply_tag') = false
     and (select requires_approval from automation_intent_types
           where intent_type = 'marketing_apply_tag') = false,
    'internal actions are registered internal and approval-free — honestly';
  -- and NO approval row is fabricated for it
  assert not exists (select 1 from automation_approvals
                      where automation_intent_id = (lin ->> 'intent_id')::uuid),
    'no tenant-senior approval is fabricated for an internal action';
  assert (select decision from decision_log
           where id = (select decision_id from automation_intents where id = (lin ->> 'intent_id')::uuid))
       = 'AUTOMATION_AUTHORISED',
    'the decision records delegated authority, not a fake review requirement';

  -- the engine executes it; the enrolment then completes the journey
  select * into claim from automation_claim_and_start(
    (lin ->> 'intent_id')::uuid, 'aaaa9100-0000-0000-0000-0000000000f1', 'p6-worker', 120,
    'idem-p6a-' || (lin ->> 'intent_id'), corr, 'test');
  perform automation_finalize_execution(
    'aaaa9100-0000-0000-0000-0000000000f1', (lin ->> 'intent_id')::uuid, claim.attempt_id,
    'p6-worker', 'succeeded', jsonb_build_object('action','apply_tag'), null, 'succeeded',
    false, null, 'apply_tag:x', 'internal', 'marketing_contact_action_recorded', 'operational',
    corr, null);
  perform marketing_sequence_reconcile_execution('aaaa9100-0000-0000-0000-0000000000f1', x.id);
  assert (select status from marketing_sequence_executions where id = x.id) = 'succeeded',
    'the internal action execution succeeded';
  assert (select current_step_order from marketing_sequence_enrolments where id = enrol) = 4,
    'the enrolment advanced past the last step';

  -- the next claim COMPLETES the enrolment (no step 4 exists)
  perform marketing_sequence_claim_batch('aaaa9100-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  assert (select status from marketing_sequence_enrolments where id = enrol) = 'completed',
    'the enrolment completed the whole journey';
end $$;

-- ── (7) COMPLETION TRUTH: a reusable sequence does NOT complete on its own ──
do $$
declare cid uuid; r jsonb;
begin
  cid := (select val from p6_ctx where key='seqA')::uuid;
  assert (select status from marketing_campaigns where id = cid) = 'active',
    'an OPEN sequence stays active even with an empty cohort — it is reusable';
  assert not marketing_sequence_check_completion('aaaa9100-0000-0000-0000-0000000000f1', cid),
    'completion is refused while the sequence is open to enrolment';
  -- closing it is an explicit operator act; completion then derives
  r := marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid, 'close',
        (select version from marketing_campaigns where id = cid));
  assert (r ->> 'closed_at') is not null and (r ->> 'status') = 'active',
    'closing stops new enrolment without pretending the campaign ended';
  begin
    perform marketing_sequence_preflight_enrolment('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000001', cid,
      jsonb_build_object('source','manual','person_ids',
        jsonb_build_array('de1e9100-0000-0000-0000-000000000002')));
    assert false, 'a closed sequence must refuse new enrolment';
  exception when sqlstate '22023' then null;
  end;
  assert marketing_sequence_check_completion('aaaa9100-0000-0000-0000-0000000000f1', cid),
    'a closed sequence with no live enrolments completes truthfully';
  assert (select status from marketing_campaigns where id = cid) = 'completed',
    'the campaign is completed';
end $$;

-- ── (8) SUPPRESSION RACE CLOSURE + exit policy ──────────────────────────────
insert into people (id, tenant_id, display_name, first_name, primary_email) values
  ('de1e9100-0000-0000-0000-000000000011','aaaa9100-0000-0000-0000-0000000000f1','P6B Ann','Ann','p6b-ann@x.test');
insert into contact_points (id, tenant_id, person_id, channel, value, normalized_value, is_primary) values
  ('c0149100-0000-0000-0000-000000000011','aaaa9100-0000-0000-0000-0000000000f1','de1e9100-0000-0000-0000-000000000011','email','p6b-ann@x.test','p6b-ann@x.test',true);
insert into communication_preferences (tenant_id, person_id, channel, state, source) values
  ('aaaa9100-0000-0000-0000-0000000000f1','de1e9100-0000-0000-0000-000000000011','email','subscribed','manual');
insert into marketing_segments (id, tenant_id, name, definition, definition_version, status) values
  ('5e9e9100-0000-0000-0000-000000000002','aaaa9100-0000-0000-0000-0000000000f1','P6B','{"field":"search","value":"P6B"}',1,'active');

create or replace function pg_temp.p6_launch(p_name text, p_block text)
returns uuid language plpgsql as $$
declare r jsonb; cid uuid; conf jsonb;
begin
  r := marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000002',
        jsonb_build_object('name', p_name, 'sender_id',(select val from p6_ctx where key='sender'),
          'timezone','UTC', 'policy_block_action', p_block,
          'exit_rules', jsonb_build_object('on_reply', true),
          'steps', jsonb_build_array(
            jsonb_build_object('key','s1','type','send_email','config',
              jsonb_build_object('subject','Update','body_authored','Plain news.')))));
  cid := (r ->> 'id')::uuid;
  perform marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-000000000002', cid, 'submit_review',
    (select version from marketing_campaigns where id = cid));
  perform marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-000000000001', cid, 'approve',
    (select version from marketing_campaigns where id = cid));
  conf := marketing_sequence_preflight_activation('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-000000000001', cid,
    (select version from marketing_campaigns where id = cid),
    'https://unsub.p6.test/functions/v1');
  perform marketing_sequence_activate('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-000000000001', cid,
    jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
      'challenge', conf ->> 'challenge', 'request_id', 'act-' || left(md5(p_name), 20)));
  conf := marketing_sequence_preflight_enrolment('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-000000000001', cid,
    jsonb_build_object('source','segment','segment_id','5e9e9100-0000-0000-0000-000000000002'));
  perform marketing_sequence_confirm_enrolment('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-000000000001', cid,
    jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
      'challenge', conf ->> 'challenge', 'request_id', 'enr-' || left(md5(p_name), 20)));
  return cid;
end $$;

do $$
declare cid uuid; enrol uuid; x record; b jsonb;
begin
  -- policy_block_action = 'exit': suppression before the step EXITS the enrolment
  cid := pg_temp.p6_launch('Race exit', 'exit');
  enrol := (select id from marketing_sequence_enrolments where campaign_id = cid);
  insert into contact_suppressions (tenant_id, person_id, channel, normalized_value, reason, active)
  values ('aaaa9100-0000-0000-0000-0000000000f1','de1e9100-0000-0000-0000-000000000011',
          'email','p6b-ann@x.test','manual',true);
  perform marketing_sequence_claim_batch('aaaa9100-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  select * into x from marketing_sequence_executions where enrolment_id = enrol;
  b := marketing_sequence_step_bundle('aaaa9100-0000-0000-0000-0000000000f1', x.id, 'w1');
  assert (b ->> 'skipped')::boolean and (b ->> 'code') = 'not_subscribed',
    'the pre-intent recheck refused the suppressed recipient';
  assert (select status from marketing_sequence_executions where id = x.id) = 'skipped',
    'the step is skipped, never failed';
  assert (select status from marketing_sequence_enrolments where id = enrol) = 'exited'
     and (select exit_reason from marketing_sequence_enrolments where id = enrol) = 'hard_suppression',
    'the approved exit policy exited the enrolment with the exact reason';
  assert not exists (select 1 from marketing_deliveries where sequence_enrolment_id = enrol),
    'NO delivery was created for the suppressed recipient';
  assert not exists (select 1 from automation_intents
                      where parameters ->> 'sequence_enrolment_id' = enrol::text),
    'NO engine rows were created for the suppressed recipient';
  -- lift the suppression for the next probe
  update contact_suppressions set active = false
   where normalized_value = 'p6b-ann@x.test';
end $$;

-- ── (9) EXIT EVIDENCE: reply correlation is canonical, never a guess ────────
do $$
declare cid uuid; enrol uuid; x record; b jsonb; lin jsonb; url text;
        claim record; corr uuid := gen_random_uuid(); n int;
begin
  cid := pg_temp.p6_launch('Reply exit', 'exit');
  enrol := (select id from marketing_sequence_enrolments where campaign_id = cid);
  perform marketing_sequence_claim_batch('aaaa9100-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  select * into x from marketing_sequence_executions where enrolment_id = enrol;
  b := marketing_sequence_step_bundle('aaaa9100-0000-0000-0000-0000000000f1', x.id, 'w1');
  url := (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || (b ->> 'unsubscribe_token');
  lin := marketing_sequence_create_email_lineage('aaaa9100-0000-0000-0000-0000000000f1', x.id, 'w1',
    jsonb_build_object('subject','Update',
      'body_text','Plain news.' || e'\n\nUnsubscribe: ' || url,
      'body_html','<div>Plain news. <a href="' || url || '">Unsubscribe</a></div>',
      'unsubscribe_url', url));
  select * into claim from automation_claim_and_start(
    (lin ->> 'intent_id')::uuid, 'aaaa9100-0000-0000-0000-0000000000f1', 'p6-worker', 120,
    'idem-p6r-' || (lin ->> 'intent_id'), corr, 'test');
  perform automation_finalize_execution(
    'aaaa9100-0000-0000-0000-0000000000f1', (lin ->> 'intent_id')::uuid, claim.attempt_id,
    'p6-worker', 'succeeded',
    jsonb_build_object('message_id','gm-reply-001','thread_id','gm-thread-reply-1',
                       'delivery_id', (lin ->> 'delivery_id')::uuid),
    null, 'succeeded', false, null, 'gm-reply-001', '2xx',
    'marketing_email_submitted', 'operational', corr, null);
  perform marketing_delivery_reconcile('aaaa9100-0000-0000-0000-0000000000f1',
                                       (lin ->> 'delivery_id')::uuid);

  -- an UNRELATED inbound email must NOT exit the enrolment
  insert into email_messages (tenant_id, provider, provider_message_id, provider_thread_id,
                              subject, direction, from_email, received_at)
  values ('aaaa9100-0000-0000-0000-0000000000f1','gmail','gm-unrelated-1','gm-thread-other',
          'Re: something else','inbound',
          (select destination from marketing_sequence_enrolments where id = enrol),
          now() + interval '1 minute');
  n := marketing_sequence_apply_reply_exits('aaaa9100-0000-0000-0000-0000000000f1');
  assert n = 0, 'an unrelated inbound email is NOT a reply to this sequence';
  assert (select status from marketing_sequence_enrolments where id = enrol) = 'active',
    'the enrolment is untouched by an unrelated email';

  -- a REAL reply: on the thread this enrolment sent, AFTER that send, and FROM
  -- the endpoint this enrolment addressed. Anything weaker is not proof.
  insert into email_messages (tenant_id, provider, provider_message_id, provider_thread_id,
                              subject, direction, from_email, received_at)
  values ('aaaa9100-0000-0000-0000-0000000000f1','gmail','gm-reply-in-1','gm-thread-reply-1',
          'Re: Update','inbound',
          (select destination from marketing_sequence_enrolments where id = enrol),
          now() + interval '1 minute');
  n := marketing_sequence_apply_reply_exits('aaaa9100-0000-0000-0000-0000000000f1');
  assert n = 1, 'a canonical thread reply exits exactly one enrolment';
  assert (select exit_reason from marketing_sequence_enrolments where id = enrol) = 'replied'
     and (select exit_evidence ->> 'provider_thread_id' from marketing_sequence_enrolments
           where id = enrol) = 'gm-thread-reply-1',
    'the exit records its canonical provider evidence';
  -- idempotent: a second pass changes nothing
  n := marketing_sequence_apply_reply_exits('aaaa9100-0000-0000-0000-0000000000f1');
  assert n = 0, 'reply exits are idempotent';
end $$;

-- ── (10) DST: non-hour folds and nonexistent local times ────────────────────
do $$
declare v_utc timestamptz; v_alt timestamptz;
begin
  -- Lord Howe: 2026-04-05 01:45 local occurs TWICE (a 30-minute fold). The
  -- stored policy decides — the engine never guesses at execution time.
  v_utc := marketing_sequence_resolve_local('Australia/Lord_Howe', '2026-04-05 01:45', 'earlier');
  v_alt := marketing_sequence_resolve_local('Australia/Lord_Howe', '2026-04-05 01:45', 'later');
  assert v_utc < v_alt, 'a 30-minute fold resolves to two DIFFERENT instants by policy';
  assert (v_alt - v_utc) = interval '30 minutes', 'the fold is exactly 30 minutes';
  -- a nonexistent local time (spring-forward gap) moves deterministically forward
  v_utc := marketing_sequence_resolve_local('Europe/London', '2026-03-29 01:30', 'earlier');
  assert (v_utc at time zone 'Europe/London') > '2026-03-29 01:30'::timestamp,
    'a nonexistent local time moves forward to one that exists';
  assert v_utc = marketing_sequence_resolve_local('Europe/London', '2026-03-29 01:30', 'earlier'),
    'gap resolution is deterministic';
  -- the ordinary 1-hour London fold still resolves both ways
  assert marketing_sequence_resolve_local('Europe/London', '2026-10-25 01:30', 'earlier')
       < marketing_sequence_resolve_local('Europe/London', '2026-10-25 01:30', 'later'),
    'the 1-hour fold still resolves by policy';
  -- a local window never returns a past instant
  assert marketing_sequence_next_window('Europe/London', '[1,2,3,4,5]'::jsonb, 9, 17, 'earlier', now())
         >= now(), 'a scheduled window instant is never in the past';
end $$;

-- ── (11) PAUSE / RESUME / CANCEL ────────────────────────────────────────────
do $$
declare cid uuid; enrol uuid; r jsonb; n int;
begin
  cid := pg_temp.p6_launch('Control probe', 'exit');
  enrol := (select id from marketing_sequence_enrolments where campaign_id = cid);

  -- campaign pause stops claims
  r := marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid, 'pause',
        (select version from marketing_campaigns where id = cid));
  assert (r ->> 'status') = 'paused', 'active -> paused';
  select count(*) into n from marketing_sequence_claim_batch(
    'aaaa9100-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  assert n = 0, 'no step is claimable while the campaign is paused';

  r := marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid, 'resume',
        (select version from marketing_campaigns where id = cid));
  assert (r ->> 'status') = 'active', 'paused -> active';

  -- enrolment-level pause/resume preserves the pinned revision and step
  r := marketing_sequence_enrolment_control('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', enrol, 'pause');
  assert (r ->> 'status') = 'paused', 'the enrolment paused';
  select count(*) into n from marketing_sequence_claim_batch(
    'aaaa9100-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  assert n = 0, 'a paused enrolment is not claimable';
  r := marketing_sequence_enrolment_control('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', enrol, 'resume');
  assert (r ->> 'status') = 'active'
     and (select current_step_order from marketing_sequence_enrolments where id = enrol) = 1
     and (select revision_id from marketing_sequence_enrolments where id = enrol)
       = (select current_sequence_revision_id from marketing_campaigns where id = cid),
    'resume preserves the pinned revision and the current step';

  -- cancelling the campaign exits every live enrolment with an exact fact
  r := marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid, 'cancel',
        (select version from marketing_campaigns where id = cid));
  assert (r ->> 'status') = 'cancelled' and (r ->> 'exited_enrolments')::int = 1,
    'cancel exits exactly the live enrolments';
  assert (select exit_reason from marketing_sequence_enrolments where id = enrol)
       = 'campaign_cancelled', 'the exit reason is exact';
  -- a terminal enrolment can never be revived
  begin
    update marketing_sequence_enrolments set status = 'active' where id = enrol;
    assert false, 'an exited enrolment is terminal';
  exception when raise_exception then null;
  end;
end $$;

-- ── (12) REVISION PINNING: editing never migrates a live enrolment ──────────
do $$
declare cid uuid; enrol uuid; rev1 uuid; rev2 uuid; r jsonb;
begin
  cid := pg_temp.p6_launch('Pinning probe', 'exit');
  enrol := (select id from marketing_sequence_enrolments where campaign_id = cid);
  rev1 := (select revision_id from marketing_sequence_enrolments where id = enrol);

  -- an ACTIVE sequence cannot be edited in place: enrolled People are living
  -- that journey, so the operator must pause first
  begin
    perform marketing_sequence_revise('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000002', cid,
      jsonb_build_object('name','sneaky edit'),
      (select version from marketing_campaigns where id = cid));
    assert false, 'an active sequence must refuse an in-place edit';
  exception when sqlstate '22023' then null;
  end;
  perform marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
    'bbbb9100-0000-0000-0000-000000000001', cid, 'pause',
    (select version from marketing_campaigns where id = cid));

  -- revise the PAUSED sequence: a new revision + back to draft
  r := marketing_sequence_revise('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000002', cid,
        jsonb_build_object('steps', jsonb_build_array(
          jsonb_build_object('key','s1','type','send_email','config',
            jsonb_build_object('subject','Update v2','body_authored','Newer news.')))),
        (select version from marketing_campaigns where id = cid));
  rev2 := (r ->> 'revision_id')::uuid;
  assert rev2 <> rev1 and (r ->> 'status') = 'draft',
    'revising creates a NEW revision and returns to draft';
  assert (select revision_id from marketing_sequence_enrolments where id = enrol) = rev1,
    'the LIVE enrolment stays pinned to the revision it entered on';
  assert (select config ->> 'subject' from marketing_sequence_steps
           where revision_id = rev1 and step_order = 1 limit 1) = 'Update',
    'the older revision survives untouched with its own content';
  -- the pinned revision cannot be rewritten by any caller
  begin
    update marketing_sequence_enrolments set revision_id = rev2 where id = enrol;
    assert false, 'an enrolment revision pin is immutable';
  exception when raise_exception then null;
  end;
exception when others then
  -- surface the real failure rather than masking it
  raise;
end $$;

-- ── (13) CROSS-TENANT + RLS + catalog grant boundary ────────────────────────
do $$
declare fn text; n int;
begin
  -- a tenant-B revision can never attach tenant-A's campaign
  begin
    insert into marketing_sequence_revisions
      (tenant_id, campaign_id, revision_number, sender_profile_id, timezone, step_count, bundle_hash)
    values ('aaaa9100-0000-0000-0000-0000000000f2',
            (select val from p6_ctx where key='seqA')::uuid, 99,
            (select val from p6_ctx where key='sender')::uuid, 'UTC', 1, repeat('a', 64));
    assert false, 'a cross-tenant sequence revision is structurally impossible';
  exception when foreign_key_violation then null;
  end;
  -- an enrolment can never pin another tenant's revision
  begin
    insert into marketing_sequence_enrolments
      (tenant_id, campaign_id, revision_id, person_id, contact_point_id, destination,
       source, dedup_key)
    values ('aaaa9100-0000-0000-0000-0000000000f2',
            (select val from p6_ctx where key='seqA')::uuid,
            (select val from p6_ctx where key='revA1')::uuid,
            'de1e9100-0000-0000-0000-000000000001','c0149100-0000-0000-0000-000000000001',
            'p6a-one@x.test','manual','x');
    assert false, 'a cross-tenant enrolment is structurally impossible';
  -- the tenant guard fires BEFORE the composite FK, so either is a correct
  -- refusal; both are structural
  exception when foreign_key_violation then null; when raise_exception then null;
  end;
  -- the pinned endpoint must belong to the enrolled Person
  begin
    insert into marketing_sequence_enrolments
      (tenant_id, campaign_id, revision_id, person_id, contact_point_id, destination,
       source, dedup_key)
    values ('aaaa9100-0000-0000-0000-0000000000f1',
            (select val from p6_ctx where key='seqA')::uuid,
            (select val from p6_ctx where key='revA1')::uuid,
            'de1e9100-0000-0000-0000-000000000002','c0149100-0000-0000-0000-000000000001',
            'p6a-one@x.test','manual','y');
    assert false, 'an enrolment cannot pin another Person''s endpoint';
  exception when raise_exception then null;
  end;

  -- confirmations are NEVER client-readable
  assert (select count(*) from pg_policies
           where tablename = 'marketing_sequence_confirmations') = 0
     and not has_table_privilege('authenticated', 'marketing_sequence_confirmations', 'select'),
    'sequence challenge digests can never reach a browser';
  -- history cannot be rewritten, even by the service role
  assert not has_table_privilege('service_role', 'marketing_sequence_revisions', 'update')
     and not has_table_privilege('service_role', 'marketing_sequence_steps', 'update')
     and not has_table_privilege('service_role', 'marketing_sequence_approvals', 'update')
     and not has_table_privilege('service_role', 'marketing_enrolment_candidates', 'update'),
    'Phase-6 history rewriting privileges are revoked even for the service role';

  -- EVERY Phase-6 function is service-role only — enumerated from the CATALOG
  -- so a new helper missing its revoke fails loudly here
  for fn in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'marketing_sequence%' or p.proname like 'marketing_enrolment%')
  loop
    if exists (
      select 1 from information_schema.routine_privileges rp
       where rp.routine_name = fn and rp.grantee in ('anon', 'authenticated', 'PUBLIC')
         and rp.privilege_type = 'EXECUTE') then
      raise exception 'FAIL: Phase-6 function % is executable by a client role', fn;
    end if;
  end loop;
end $$;

-- ── (14) REPORTING truth ────────────────────────────────────────────────────
do $$
declare cid uuid; r jsonb;
begin
  cid := (select val from p6_ctx where key='seqA')::uuid;
  r := marketing_sequence_report('aaaa9100-0000-0000-0000-0000000000f1', cid);
  assert (r -> 'enrolments' ->> 'completed')::int = 1, 'the completed enrolment is counted';
  assert (r ->> 'candidates')::int >= 4, 'candidate totals derive from the immutable batches';
  assert r -> 'delivered' = 'null'::jsonb and r -> 'opened' = 'null'::jsonb
     and r -> 'clicked' = 'null'::jsonb and r -> 'bounced' = 'null'::jsonb,
    'unsupported metrics are honestly null, never zero';
  assert r ->> 'submitted_meaning' like '%NOT delivered%',
    'submitted is stated as acceptance, not delivery';
  assert r ->> 'bounce_evidence' like 'unavailable%',
    'bounces are honestly unavailable rather than invented';
  assert jsonb_array_length(r -> 'steps') = 3, 'per-step reporting covers every step';
  -- health reports real operational evidence
  r := marketing_sequence_health('aaaa9100-0000-0000-0000-0000000000f1');
  assert r ? 'due_now' and r ? 'active_leases' and r ? 'expired_leases'
     and r ? 'held_enrolments' and r ? 'unknown_executions' and r ? 'capability_enabled',
    'sequence health reports real operational evidence';
end $$;


-- ── (15) AUDIT REGRESSION LOCKS (independent hardening pass) ────────────────
-- Each block reproduces a defect CONFIRMED against the running code before it
-- was corrected, then proves the corrected behaviour.

-- (15a) An INTERNAL-ONLY journey (tag/lifecycle/owner) must not be governed by
-- EMAIL eligibility. Before the fix a Person with no email endpoint was
-- excluded from enrolment, and every internal step was skipped with
-- 'sender_disabled' — exiting the enrolment with policy_blocked even though the
-- sequence never sends anything.
do $$
declare cid uuid; r jsonb; conf jsonb; ex uuid; b jsonb; tagid uuid; stage text;
begin
  insert into people (id, tenant_id, display_name, primary_email) values
    ('de1e9100-0000-0000-0000-000000000061','aaaa9100-0000-0000-0000-0000000000f1','P6NE NoEmail', null);
  r := marketing_tag_mutate('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', 'create', '{"label":"P6NE Tag"}');
  tagid := (r ->> 'id')::uuid;
  select stage_key into stage from marketing_lifecycle_stages
   where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1' and not is_default limit 1;

  r := marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000002',
        jsonb_build_object('name','Internal only journey',
          'sender_id',(select val from p6_ctx where key='sender'), 'timezone','UTC',
          'steps', jsonb_build_array(
            jsonb_build_object('type','apply_tag','config', jsonb_build_object('tag_id', tagid)),
            jsonb_build_object('type','change_lifecycle','config',
              jsonb_build_object('stage_key', stage)))));
  cid := (r ->> 'id')::uuid;
  r := marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000002', cid, 'submit_review',
        (select version from marketing_campaigns where id = cid));
  r := marketing_sequence_transition('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid, 'approve',
        (select version from marketing_campaigns where id = cid));
  -- a NON-SENDING sequence needs no public unsubscribe base URL
  conf := marketing_sequence_preflight_activation('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid,
        (select version from marketing_campaigns where id = cid), null);
  assert (conf ->> 'email_steps')::int = 0,
    'an internal-only journey activates without an unsubscribe base URL';
  perform marketing_sequence_activate('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid,
        jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
          'challenge', conf ->> 'challenge', 'request_id', 'p6-ne-act-001'));

  conf := marketing_sequence_preflight_enrolment('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid,
        jsonb_build_object('source','manual','person_ids',
          jsonb_build_array('de1e9100-0000-0000-0000-000000000061')));
  assert (conf ->> 'candidate_count')::int = 1 and (conf ->> 'eligible_count')::int = 1
     and conf -> 'exclusion_breakdown' = '{}'::jsonb,
    'a Person with NO email endpoint is enrollable in a journey that never sends email';
  perform marketing_sequence_confirm_enrolment('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000001', cid,
        jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
          'challenge', conf ->> 'challenge', 'request_id', 'p6-ne-enr-001'));
  assert (select contact_point_id from marketing_sequence_enrolments where campaign_id = cid) is null,
    'no endpoint is invented for a non-sending journey';

  -- the sender was never enabled and the Person has no email preference at all
  perform marketing_sequence_claim_batch('aaaa9100-0000-0000-0000-0000000000f1', 'wne', 10, 120);
  select id into ex from marketing_sequence_executions
   where campaign_id = cid order by step_order limit 1;
  b := marketing_sequence_step_bundle('aaaa9100-0000-0000-0000-0000000000f1', ex, 'wne');
  assert coalesce((b ->> 'skipped')::boolean, false) = false
     and b ->> 'step_type' = 'apply_tag',
    'an internal step is NOT blocked by email preconditions';
  assert (select status from marketing_sequence_enrolments where campaign_id = cid) = 'active',
    'the enrolment is not exited by an email concern it can never encounter';

  -- and a SENDING journey still demands its endpoint
  assert exists (select 1 from marketing_sequence_enrolments e
                  join marketing_sequence_steps s
                    on s.revision_id = e.revision_id and s.step_type = 'send_email'
                 where e.campaign_id = (select val from p6_ctx where key='seqA')::uuid
                   and e.contact_point_id is not null),
    'a sending journey still pins a real endpoint';
end $$;

-- (15b) A follow-up step must not author work nobody can ever progress. The
-- platform seeds state_transitions for ('serviceos'|'productos','Action') but
-- NOT ('core','Action'), so a core Action can be created and shown but never
-- started, completed or dismissed. The step is gated on that REAL
-- configuration, so it becomes available the moment the platform seeds it —
-- with no Marketing change.
do $$
begin
  if marketing_sequence_follow_up_available() then
    -- the platform HAS been configured: the step must be authorable
    perform marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
      'bbbb9100-0000-0000-0000-000000000002',
      jsonb_build_object('name','FU available','sender_id',(select val from p6_ctx where key='sender'),
        'steps', jsonb_build_array(jsonb_build_object('type','create_follow_up','config',
          jsonb_build_object('subject','Ring the customer')))));
  else
    begin
      perform marketing_sequence_create('aaaa9100-0000-0000-0000-0000000000f1',
        'bbbb9100-0000-0000-0000-000000000002',
        jsonb_build_object('name','FU unavailable','sender_id',(select val from p6_ctx where key='sender'),
          'steps', jsonb_build_array(jsonb_build_object('type','create_follow_up','config',
            jsonb_build_object('subject','Ring the customer')))));
      assert false, 'an unusable follow-up step must be refused as configuration-required';
    exception when sqlstate 'MK428' then null;
    end;
  end if;
  -- the gate reads the REAL platform configuration, never a hardcoded answer
  assert marketing_sequence_follow_up_available()
       = (exists (select 1 from state_transitions where domain='core' and object_type='Action')
          and exists (select 1 from state_definitions where domain='core' and object_type='Action')),
    'follow-up availability is derived from the platform state machine itself';
end $$;

-- (15c) Reply correlation must require canonical evidence that is BOTH after
-- this enrolment's send AND from the endpoint this enrolment addressed. A
-- thread that already carried an older inbound message, or a message from a
-- different person on a reused thread, must never exit the enrolment.
do $$
declare cidR uuid; enrol uuid; x record; b jsonb; lin jsonb; url text;
        claim record; corr uuid := gen_random_uuid(); n int; dest text;
begin
  cidR := pg_temp.p6_launch('Reply evidence', 'exit');
  enrol := (select id from marketing_sequence_enrolments where campaign_id = cidR);
  dest := (select destination from marketing_sequence_enrolments where id = enrol);
  perform marketing_sequence_claim_batch('aaaa9100-0000-0000-0000-0000000000f1', 'wr', 10, 120);
  select * into x from marketing_sequence_executions where enrolment_id = enrol;
  b := marketing_sequence_step_bundle('aaaa9100-0000-0000-0000-0000000000f1', x.id, 'wr');
  url := (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || (b ->> 'unsubscribe_token');
  lin := marketing_sequence_create_email_lineage('aaaa9100-0000-0000-0000-0000000000f1', x.id, 'wr',
    jsonb_build_object('subject','Update',
      'body_text','Plain news.' || e'\n\nUnsubscribe: ' || url,
      'body_html','<div>Plain news. <a href="' || url || '">Unsubscribe</a></div>',
      'unsubscribe_url', url));
  select * into claim from automation_claim_and_start(
    (lin ->> 'intent_id')::uuid, 'aaaa9100-0000-0000-0000-0000000000f1', 'p6-worker', 120,
    'idem-p6e-' || (lin ->> 'intent_id'), corr, 'test');
  perform automation_finalize_execution(
    'aaaa9100-0000-0000-0000-0000000000f1', (lin ->> 'intent_id')::uuid, claim.attempt_id,
    'p6-worker', 'succeeded',
    jsonb_build_object('message_id','gm-ev-001','thread_id','gm-thread-ev-1',
                       'delivery_id', (lin ->> 'delivery_id')::uuid),
    null, 'succeeded', false, null, 'gm-ev-001', '2xx',
    'marketing_email_submitted', 'operational', corr, null);
  perform marketing_delivery_reconcile('aaaa9100-0000-0000-0000-0000000000f1',
                                       (lin ->> 'delivery_id')::uuid);

  -- (i) an inbound message on the thread that PREDATES our send is not a reply
  insert into email_messages (tenant_id, provider, provider_message_id, provider_thread_id,
                              subject, direction, from_email, received_at)
  values ('aaaa9100-0000-0000-0000-0000000000f1','gmail','gm-ev-old','gm-thread-ev-1',
          'Earlier note','inbound', dest, now() - interval '1 day');
  n := marketing_sequence_apply_reply_exits('aaaa9100-0000-0000-0000-0000000000f1');
  assert n = 0, 'an inbound message older than the send is NOT a reply to it';

  -- (ii) an inbound message from a DIFFERENT person on the same thread is not
  --      this Person's reply
  insert into email_messages (tenant_id, provider, provider_message_id, provider_thread_id,
                              subject, direction, from_email, received_at)
  values ('aaaa9100-0000-0000-0000-0000000000f1','gmail','gm-ev-other','gm-thread-ev-1',
          'Re: Update','inbound','someone-else@x.test', now() + interval '1 minute');
  n := marketing_sequence_apply_reply_exits('aaaa9100-0000-0000-0000-0000000000f1');
  assert n = 0, 'a reused thread cannot exit the wrong Person''s enrolment';
  assert (select status from marketing_sequence_enrolments where id = enrol) = 'active',
    'the enrolment survives both non-replies';

  -- (iii) the GENUINE reply — after the send, from the enrolled endpoint
  insert into email_messages (tenant_id, provider, provider_message_id, provider_thread_id,
                              subject, direction, from_email, received_at)
  values ('aaaa9100-0000-0000-0000-0000000000f1','gmail','gm-ev-real','gm-thread-ev-1',
          'Re: Update','inbound', dest, now() + interval '2 minutes');
  n := marketing_sequence_apply_reply_exits('aaaa9100-0000-0000-0000-0000000000f1');
  assert n = 1, 'a genuine reply exits exactly one enrolment';
  assert (select exit_reason from marketing_sequence_enrolments where id = enrol) = 'replied'
     and (select exit_evidence ->> 'provider_message_id' from marketing_sequence_enrolments
           where id = enrol) = 'gm-ev-real',
    'the exit cites the exact canonical message that proved it';
  n := marketing_sequence_apply_reply_exits('aaaa9100-0000-0000-0000-0000000000f1');
  assert n = 0, 'reply exits stay idempotent';
end $$;


-- ── (16) WHOLE-RUN INVARIANTS (asserted on the live fixture, never vacuously) ─
-- Every assertion here first proves it has rows to judge, so a teardown or an
-- empty database can never let this section report a pass it did not observe.
do $$
declare n int; seen int; cid uuid; r jsonb;
begin
  -- (16a) engine lineage, judged by the REGISTERED contract rather than by a
  -- blanket rule: an intent that the platform declares approval-required must
  -- carry an append-only tenant_senior approval AND still match the envelope
  -- frozen at approval time. An internal action is registered with no external
  -- side effect and no approval, and must never be able to claim otherwise.
  select count(*) into seen from marketing_sequence_executions
   where automation_intent_id is not null;
  assert seen > 0, 'lineage invariant has nothing to judge — refusing to pass vacuously';

  -- every sequence intent is a REGISTERED type (no ad-hoc intent smuggling)
  select count(*) into n from marketing_sequence_executions x
    join automation_intents i on i.id = x.automation_intent_id
   where not exists (select 1 from automation_intent_types t
                      where t.intent_type = i.intent_type and t.enabled);
  assert n = 0, format('%s sequence intents use an unregistered or disabled intent type', n);

  -- approval-required intents: approved, by a tenant_senior, append-only
  select count(*) into n from marketing_sequence_executions x
    join automation_intents i on i.id = x.automation_intent_id
    join automation_intent_types t on t.intent_type = i.intent_type
   where t.requires_approval
     and not exists (select 1 from automation_approvals a
                      where a.automation_intent_id = i.id
                        and a.approver_kind = 'tenant_senior' and a.decision = 'approved');
  assert n = 0, format('%s approval-required sequence intents lack a tenant_senior approval', n);

  -- and still bound to the exact envelope that was approved
  select count(*) into n from marketing_sequence_executions x
    join automation_intents i on i.id = x.automation_intent_id
    join automation_intent_types t on t.intent_type = i.intent_type
   where t.requires_approval
     and (i.approved_payload_hash is null
          or i.approved_payload_hash
             is distinct from automation_intent_envelope_hash(i.tenant_id, i.id));
  assert n = 0, format('%s approved sequence intents drifted from their approved envelope', n);

  -- the internal action capability is REGISTERED non-external. If that ever
  -- flipped, an unapproved internal step would silently gain external reach.
  assert not exists (select 1 from automation_intent_types
                      where connector_capability = 'marketing.contact_action'
                        and (external_side_effect or requires_approval)),
    'the internal contact-action capability must stay non-external and approval-free';
  assert (select count(*) from automation_intent_types
           where connector_capability = 'email.send_marketing'
             and intent_type = 'send_marketing_sequence_email'
             and external_side_effect and requires_approval and risk_category = 'high') = 1,
    'the sequence email intent must stay external, approval-required and high risk';

  select count(*) into n from marketing_sequence_executions x
    join automation_intents i on i.id = x.automation_intent_id
    join automation_intent_types t on t.intent_type = i.intent_type
   where t.requires_approval;
  raise notice '(16a) lineage: % sequence intents, % approval-required — all approved and envelope-bound', seen, n;

  -- (16b) step order is contiguous from 1 inside EVERY revision this run authored
  select count(*) into seen from marketing_sequence_revisions;
  assert seen > 0, 'ordering invariant has nothing to judge';
  select count(*) into n from (
    select revision_id, count(*) c, min(step_order) lo, max(step_order) hi
      from marketing_sequence_steps group by revision_id) q
   where q.lo <> 1 or q.hi <> q.c;
  assert n = 0, format('%s revisions have non-contiguous step_order', n);
  raise notice '(16b) ordering: % revisions, all contiguous from 1', seen;

  -- (16c) reporting never invents a number it cannot observe. delivered,
  -- opened, clicked and bounced must be JSON null — present, explicitly
  -- unknown, and never coerced to a comforting zero — and each must carry the
  -- plain-language reason it is unknown.
  select campaign_id into cid from marketing_sequence_executions
   where tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1' limit 1;
  assert cid is not null, 'reporting invariant has nothing to judge';
  r := marketing_sequence_report('aaaa9100-0000-0000-0000-0000000000f1', cid);
  assert r ?& array['delivered','opened','clicked','bounced'],
    'unobservable metrics must still be REPORTED, so the surface cannot silently omit them';
  assert jsonb_typeof(r -> 'delivered') = 'null' and jsonb_typeof(r -> 'opened') = 'null'
     and jsonb_typeof(r -> 'clicked')   = 'null' and jsonb_typeof(r -> 'bounced') = 'null',
    'an unobservable metric must be null, NEVER 0';
  assert (r -> 'tracking' ->> 'enabled') = 'false'
     and (r -> 'tracking' ->> 'state') = 'unavailable'
     and (r ->> 'bounce_evidence') like 'unavailable%'
     and (r ->> 'submitted_meaning') like 'accepted by Gmail%',
    'each unknown must carry the reason it is unknown, in plain language';
  -- and the numbers it DOES report are real counts, not estimates
  assert (r ->> 'unsubscribed')::int
       = (select count(*) from marketing_unsubscribe_tokens
           where campaign_id = cid and used_at is not null),
    'reported counts must equal the persisted rows they claim to count';
  raise notice '(16c) reporting: delivered/opened/clicked/bounced are null with stated reasons; counts equal rows';
end $$;

-- (16d) the immutable records really are immutable, on rows this run created
do $$
declare tgt uuid;
begin
  select id into tgt from marketing_sequence_steps limit 1;
  assert tgt is not null, 'immutability invariant has nothing to judge';
  begin
    update marketing_sequence_steps set step_order = step_order + 100 where id = tgt;
    assert false, 'an authored step must be immutable';
  exception when assert_failure then raise; when others then
    raise notice '(16d) steps immutable: %', left(sqlerrm, 70);
  end;
  select id into tgt from marketing_sequence_revisions limit 1;
  begin
    update marketing_sequence_revisions set step_count = 99 where id = tgt;
    assert false, 'a revision must be immutable';
  exception when assert_failure then raise; when others then
    raise notice '(16e) revisions immutable: %', left(sqlerrm, 70);
  end;
  -- the enrolment evidence ledger resists DELETE as well as UPDATE: a record of
  -- who was enrolled, and why each excluded Person was excluded, is only
  -- evidence if it cannot be quietly erased.
  select id into tgt from marketing_enrolment_candidates limit 1;
  assert tgt is not null, 'the candidate ledger has nothing to judge';
  begin
    update marketing_enrolment_candidates set eligible = not eligible where id = tgt;
    assert false, 'a recorded enrolment verdict must never be rewritten';
  exception when assert_failure then raise; when others then
    raise notice '(16f) candidate verdict not rewritable: %', left(sqlerrm, 70);
  end;
  begin
    delete from marketing_enrolment_candidates where id = tgt;
    assert false, 'a recorded enrolment verdict must never be erased';
  exception when assert_failure then raise; when others then
    raise notice '(16g) candidate verdict not erasable: %', left(sqlerrm, 70);
  end;
  select id into tgt from marketing_enrolment_batches limit 1;
  assert tgt is not null, 'the batch ledger has nothing to judge';
  begin
    delete from marketing_enrolment_batches where id = tgt;
    assert false, 'an enrolment batch must never be erased';
  exception when assert_failure then raise; when others then
    raise notice '(16h) batch not erasable: %', left(sqlerrm, 70);
  end;
end $$;


-- ── (17) SUB-HOUR DST: the gap walk must land on the FIRST real instant ─────
-- Lord Howe Island shifts by THIRTY minutes (UTC+10:30 → UTC+11:00), springing
-- 02:00 → 02:30. A coarse probe steps over the true first existing instant and
-- schedules late; this locks the exact landing point for every minute of a real
-- sub-hour gap, and proves no existing local time is ever moved.
do $$
declare l timestamp; landed timestamp; moved int := 0;
begin
  -- every nonexistent local minute resolves to 02:30 exactly — not 02:31, not 02:44
  for l in select generate_series(timestamp '2026-10-04 02:00',
                                  timestamp '2026-10-04 02:29', interval '1 minute') loop
    landed := marketing_sequence_resolve_local('Australia/Lord_Howe', l, 'earlier')
                at time zone 'Australia/Lord_Howe';
    assert landed = timestamp '2026-10-04 02:30',
      format('Lord Howe gap: %s resolved to %s, not the first real instant 02:30', l, landed);
  end loop;

  -- a local time that DOES exist is never moved, on either side of the shift
  for l in select generate_series(timestamp '2026-10-04 00:00',
                                  timestamp '2026-10-05 00:00', interval '7 minutes') loop
    continue when l >= timestamp '2026-10-04 02:00' and l < timestamp '2026-10-04 02:30';
    if (marketing_sequence_resolve_local('Australia/Lord_Howe', l, 'earlier')
          at time zone 'Australia/Lord_Howe') <> l then
      moved := moved + 1;
    end if;
  end loop;
  assert moved = 0, format('%s existing local times were moved by the gap walk', moved);

  -- the 30-minute FOLD resolves by stored policy, and the two instants really
  -- are half an hour apart — proving the fold is genuinely sub-hour
  assert marketing_sequence_resolve_local('Australia/Lord_Howe','2026-04-05 01:45','later')
       - marketing_sequence_resolve_local('Australia/Lord_Howe','2026-04-05 01:45','earlier')
       = interval '30 minutes',
    'a 30-minute fold must offer two instants exactly 30 minutes apart';
  assert marketing_sequence_resolve_local('Australia/Lord_Howe','2026-04-05 01:45','earlier')
       < marketing_sequence_resolve_local('Australia/Lord_Howe','2026-04-05 01:45','later'),
    'the earlier policy must never resolve later than the later policy';

  -- other real sub-hour and whole-hour zones stay correct
  assert (marketing_sequence_resolve_local('Pacific/Chatham','2026-09-27 02:45','earlier')
            at time zone 'Pacific/Chatham') = timestamp '2026-09-27 03:45',
    'Chatham (+12:45 → +13:45) must resolve its gap to the first real instant';
  assert (marketing_sequence_resolve_local('Europe/London','2026-03-29 01:30','earlier')
            at time zone 'Europe/London') = timestamp '2026-03-29 02:00',
    'a whole-hour gap must still resolve forward';
  assert (marketing_sequence_resolve_local('Asia/Kathmandu','2026-06-01 12:00','earlier')
            at time zone 'Asia/Kathmandu') = timestamp '2026-06-01 12:00',
    'a +05:45 zone with no DST must never be shifted';
  raise notice '(17) sub-hour DST: Lord Howe gap lands on 02:30 for all 30 minutes; 0 existing times moved';
end $$;


-- ── (18) THE CANONICAL-ACTION SEAM REFUSES AT THE LAYER THAT WRITES ─────────
-- Gating only the authoring path leaves the generic work-item seam open: it is
-- the RPC, not the builder, that actually mints a canonical Action. Any future
-- caller reaching it directly would create work that shows up on a real
-- person's list and can never be started, completed or dismissed.
do $$
declare ex uuid; per uuid; got text; before_n int; after_n int;
begin
  select x.id, e.person_id into ex, per
    from marketing_sequence_executions x
    join marketing_sequence_enrolments e on e.id = x.enrolment_id
   where x.tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1'
     and e.tenant_id = 'aaaa9100-0000-0000-0000-0000000000f1'
   limit 1;
  assert ex is not null and per is not null, 'the seam test has nothing to judge';
  select count(*) into before_n from intelligence_objects where object_class = 'action';

  if marketing_sequence_follow_up_available() then
    -- configured platform: the seam works AND is idempotent on the execution
    perform marketing_sequence_create_follow_up(
      'aaaa9100-0000-0000-0000-0000000000f1', ex, per,
      jsonb_build_object('subject','Ring the customer','due_in_days',2),
      'bbbb9100-0000-0000-0000-000000000001');
    assert (marketing_sequence_create_follow_up(
              'aaaa9100-0000-0000-0000-0000000000f1', ex, per,
              jsonb_build_object('subject','Ring the customer','due_in_days',2),
              'bbbb9100-0000-0000-0000-000000000001') ->> 'idempotent')::boolean,
      'a retried follow-up must converge on the existing work item, never mint a second';
  else
    begin
      perform marketing_sequence_create_follow_up(
        'aaaa9100-0000-0000-0000-0000000000f1', ex, per,
        jsonb_build_object('subject','Ring the customer','due_in_days',2),
        'bbbb9100-0000-0000-0000-000000000001');
      assert false, 'the seam must refuse to mint work the platform cannot progress';
    exception when assert_failure then raise; when sqlstate 'MK428' then
      get stacked diagnostics got = message_text;
      assert got like '%state_transitions%(core, Action)%',
        'the refusal must name the exact platform blocker, not a generic error';
    end;
    -- and it wrote NOTHING while refusing
    select count(*) into after_n from intelligence_objects where object_class = 'action';
    assert after_n = before_n,
      format('a refused follow-up must create no canonical work (%s → %s)', before_n, after_n);
  end if;
  raise notice '(18) canonical-Action seam: available=%, refusal writes nothing',
    marketing_sequence_follow_up_available();
end $$;

select 'marketing_sequences.test.sql: ALL ASSERTIONS PASSED' as result;

rollback;
