-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_broadcasts.test.sql
--
-- Proves Marketing Phase 5 (migration 20260902120000) end to end with the
-- REAL untouched Automation Engine and STUBBED provider results (no network,
-- no email): authority ceilings (drafter vs owner/admin launch; hostile raw
-- grants inert; explicit deny wins), the server-enforced campaign state
-- machine with FACTUAL anchoring (approved/launched/completed cannot be
-- fabricated by any caller incl. service role), immutable revisions and
-- append-only approvals/events, the immutable audience snapshot (EVERY
-- candidate represented; exact exclusion reasons for unknown-preference,
-- unsubscribed, hard-suppression, no-contact-point, invalid-destination,
-- shared-destination ambiguity and missing personalisation; counts equal
-- immutable member rows; refresh = new snapshot; guardrail enforced), the
-- one-use exact-binding launch confirmation (challenge digest; stale
-- preflight refused; replay converges; changed reuse = stable MK412; DST gap
-- rejected + fold required for ambiguity), lease-safe dispatch (SKIP LOCKED
-- claims; wrong-worker refused; deterministic per-member idempotency), the
-- complete per-recipient engine lineage (Action + REQUIRES_APPROVAL decision
-- + intent + pinned envelope hash + append-only tenant_senior approval
-- naming the GENUINE owner/admin launch approver), the THREE-point
-- suppression race closure (snapshot, pre-intent skip with no engine rows,
-- and the canonical send authority the adapter calls pre-provider), factual
-- delivery/dispatch sync incl. skipped/cancelled vocabularies, canonical
-- email projection with structural campaign/person linkage and ingestion
-- convergence, completion derived from recipient facts (unknown BLOCKS it),
-- pause/resume/cancel safety (only pending work cancels; unknown never
-- rewritten or re-dispatched), the digest-only non-enumerating idempotent
-- unsubscribe, factual reporting (clicked/delivered honestly null), stable
-- recipient pagination, cross-tenant structural impossibility, RLS +
-- service-role-only boundaries, and tenant cascade cleanup (append-only
-- guards do NOT block owner-level cascade).
begin;

create temp table p5_ctx (key text primary key, val text);

insert into tenants (id, slug, display_name, industry) values
  ('aaaa6000-0000-0000-0000-0000000000f1','p5-t1','Phase5 Tenant 1','hvac'),
  ('aaaa6000-0000-0000-0000-0000000000f2','p5-t2','Phase5 Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb6000-0000-0000-0000-000000000001','owner-a@p5.test',false,false),
  ('bbbb6000-0000-0000-0000-000000000002','ops-a@p5.test',false,false),
  ('bbbb6000-0000-0000-0000-000000000003','viewer-a@p5.test',false,false),
  ('bbbb6000-0000-0000-0000-000000000004','admin-a2@p5.test',false,false),
  ('bbbb6000-0000-0000-0000-000000000005','admin-b@p5.test',false,false);
update profiles set role='owner',  tenant_id='aaaa6000-0000-0000-0000-0000000000f1' where id='bbbb6000-0000-0000-0000-000000000001';
update profiles set role='ops',    tenant_id='aaaa6000-0000-0000-0000-0000000000f1' where id='bbbb6000-0000-0000-0000-000000000002';
update profiles set role='viewer', tenant_id='aaaa6000-0000-0000-0000-0000000000f1' where id='bbbb6000-0000-0000-0000-000000000003';
update profiles set role='admin',  tenant_id='aaaa6000-0000-0000-0000-0000000000f1' where id='bbbb6000-0000-0000-0000-000000000004';
update profiles set role='admin',  tenant_id='aaaa6000-0000-0000-0000-0000000000f2' where id='bbbb6000-0000-0000-0000-000000000005';

select marketing_materialise_defaults('aaaa6000-0000-0000-0000-0000000000f1','bbbb6000-0000-0000-0000-000000000001');
select marketing_materialise_defaults('aaaa6000-0000-0000-0000-0000000000f2','bbbb6000-0000-0000-0000-000000000005');

-- authorised sender (Phase-4 RPCs — the real path)
insert into email_accounts (id, tenant_id, provider, email_address, status, auth_state) values
  ('eeee6000-0000-0000-0000-0000000000a1','aaaa6000-0000-0000-0000-0000000000f1','gmail','sender@p5-t1.test','active','ok');
insert into email_oauth_tokens (tenant_id, email_account_id, provider, access_token, refresh_token, expires_at, scope) values
  ('aaaa6000-0000-0000-0000-0000000000f1','eeee6000-0000-0000-0000-0000000000a1','gmail','tok','ref', now() + interval '1 hour',
   'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');
do $$
declare r jsonb; t timestamptz;
begin
  r := marketing_sender_create('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001',
        '{"source_kind":"gmail_oauth","source_id":"eeee6000-0000-0000-0000-0000000000a1","label":"P5 sender","from_name":"Drummonds"}');
  insert into p5_ctx values ('sender', r ->> 'id');
  select updated_at into t from marketing_sender_profiles where id = (r ->> 'id')::uuid;
  perform marketing_sender_set_enabled('aaaa6000-0000-0000-0000-0000000000f1',
    'bbbb6000-0000-0000-0000-000000000001', (r ->> 'id')::uuid, true, t);
end $$;

-- PEOPLE — campaign A's audience is exactly the nine 'P5A' people
insert into people (id, tenant_id, display_name, first_name, last_name, primary_email) values
  ('de1e6000-0000-0000-0000-000000000001','aaaa6000-0000-0000-0000-0000000000f1','P5A One','Pat','One','p5a-one@x.test'),
  ('de1e6000-0000-0000-0000-000000000002','aaaa6000-0000-0000-0000-0000000000f1','P5A Two','Tia','Two','p5a-two@x.test'),
  ('de1e6000-0000-0000-0000-000000000003','aaaa6000-0000-0000-0000-0000000000f1','P5A Three','Tom','Three','p5a-three@x.test'),
  ('de1e6000-0000-0000-0000-000000000004','aaaa6000-0000-0000-0000-0000000000f1','P5A Four','Fay','Four','p5a-four@x.test'),
  ('de1e6000-0000-0000-0000-000000000005','aaaa6000-0000-0000-0000-0000000000f1','P5A Five','Fin','Five',null),
  ('de1e6000-0000-0000-0000-000000000006','aaaa6000-0000-0000-0000-0000000000f1','P5A Six','Sam','Six','p5a-shared@x.test'),
  ('de1e6000-0000-0000-0000-000000000007','aaaa6000-0000-0000-0000-0000000000f1','P5A Seven','Sue','Seven','p5a-shared@x.test'),
  ('de1e6000-0000-0000-0000-000000000008','aaaa6000-0000-0000-0000-0000000000f1','P5A Eight',null,'Eight','p5a-eight@x.test'),
  ('de1e6000-0000-0000-0000-000000000009','aaaa6000-0000-0000-0000-0000000000f1','P5A Nine','Nia','Nine','p5a-nine@x.test');
insert into contact_points (id, tenant_id, person_id, channel, value, normalized_value, is_primary, verification_state) values
  ('c0146000-0000-0000-0000-000000000001','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000001','email','p5a-one@x.test','p5a-one@x.test',true,'verified'),
  ('c0146000-0000-0000-0000-000000000002','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000002','email','p5a-two@x.test','p5a-two@x.test',true,'unverified'),
  ('c0146000-0000-0000-0000-000000000003','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000003','email','p5a-three@x.test','p5a-three@x.test',true,'unverified'),
  ('c0146000-0000-0000-0000-000000000004','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000004','email','p5a-four@x.test','p5a-four@x.test',true,'unverified'),
  ('c0146000-0000-0000-0000-000000000006','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000006','email','p5a-shared@x.test','p5a-shared@x.test',true,'unverified'),
  ('c0146000-0000-0000-0000-000000000007','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000007','email','p5a-shared@x.test','p5a-shared@x.test',true,'unverified'),
  ('c0146000-0000-0000-0000-000000000008','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000008','email','p5a-eight@x.test','p5a-eight@x.test',true,'unverified'),
  ('c0146000-0000-0000-0000-000000000009','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000009','email','p5a-nine@x.test','p5a-nine@x.test',true,'invalid');
-- preferences: explicit subscribed for One, Four, Six, Seven, Eight; Three unsubscribed
insert into communication_preferences (tenant_id, person_id, channel, state, source) values
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000001','email','subscribed','manual'),
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000003','email','unsubscribed','manual'),
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000004','email','subscribed','manual'),
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000006','email','subscribed','manual'),
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000007','email','subscribed','manual'),
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000008','email','subscribed','manual');
-- Four is hard-suppressed despite the subscription
insert into contact_suppressions (tenant_id, person_id, channel, normalized_value, reason, active) values
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000004','email','p5a-four@x.test','manual',true);

-- saved segments (valid ASTs the Phase-3 validator accepts)
insert into marketing_segments (id, tenant_id, name, definition, definition_version, status) values
  ('5e9e6000-0000-0000-0000-000000000001','aaaa6000-0000-0000-0000-0000000000f1','P5A audience',
   '{"field":"search","value":"P5A"}', 1, 'active'),
  ('5e9e6000-0000-0000-0000-000000000002','aaaa6000-0000-0000-0000-0000000000f1','P5 empty',
   '{"field":"search","value":"P5-NOBODY"}', 1, 'active');

-- ── (1) AUTHORITY: drafter vs launch ceilings; hostile grants inert ─────────
do $$
declare r jsonb; cid uuid; v int;
begin
  -- viewer cannot draft
  begin
    perform marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000003',
      jsonb_build_object('name','X','sender_id', (select val from p5_ctx where key='sender'),
        'segment_id','5e9e6000-0000-0000-0000-000000000001',
        'subject','S','body_authored','B'));
    assert false, 'viewer must be denied campaign creation';
  exception when sqlstate '42501' then null;
  end;
  -- cross-tenant actor rejected
  begin
    perform marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000005', '{}'::jsonb);
    assert false, 'cross-tenant actor must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- ops CAN draft
  r := marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002',
        jsonb_build_object('name','Autumn service reminder',
          'description','First governed broadcast',
          'sender_id', (select val from p5_ctx where key='sender'),
          'segment_id','5e9e6000-0000-0000-0000-000000000001',
          'subject','Hello {{first_name}}',
          'preview_text','Book your autumn service',
          'body_authored', e'Hi {{first_name}},\n\nBook here: [Book a service](https://drummonds.test/book)\n\nThanks,\nDrummonds'));
  cid := (r ->> 'id')::uuid;
  insert into p5_ctx values ('campaignA', cid::text);
  assert r ->> 'status' = 'draft' and (r ->> 'version')::int = 1, 'ops created a draft';

  -- unknown token / malformed braces / bad link / unknown fallback rejected
  begin
    perform marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002',
      jsonb_build_object('name','X','sender_id', (select val from p5_ctx where key='sender'),
        'segment_id','5e9e6000-0000-0000-0000-000000000001',
        'subject','Hi {{postcode}}','body_authored','B'));
    assert false, 'unknown personalisation token must be rejected';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002',
      jsonb_build_object('name','X','sender_id', (select val from p5_ctx where key='sender'),
        'segment_id','5e9e6000-0000-0000-0000-000000000001',
        'subject','S','body_authored','bad [link](javascript:alert(1))'));
    assert false, 'a non-http link must be rejected';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002',
      jsonb_build_object('name','X','sender_id', (select val from p5_ctx where key='sender'),
        'segment_id','5e9e6000-0000-0000-0000-000000000001',
        'subject','S','body_authored','B {{ broken','token_fallbacks','{}'::jsonb));
    assert false, 'malformed braces must be rejected';
  exception when sqlstate '22023' then null;
  end;

  select version into v from marketing_campaigns where id = cid;
  -- ops submits for review (allowed)
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review', v);
  assert r ->> 'status' = 'review', 'draft -> review by drafter';
  -- ops CANNOT approve (role ceiling)…
  begin
    perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002', cid, 'approve', (r ->> 'version')::int);
    assert false, 'ops must never approve';
  exception when sqlstate '42501' then null;
  end;
  -- …and a HOSTILE raw launch grant to ops stays inert (resolver ceiling)
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa6000-0000-0000-0000-0000000000f1','bbbb6000-0000-0000-0000-000000000002',
          'marketing.campaigns.launch', true, 'bbbb6000-0000-0000-0000-000000000001');
  begin
    perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002', cid, 'approve',
      (select version from marketing_campaigns where id = cid));
    assert false, 'a hostile raw grant must not bypass the owner/admin launch ceiling';
  exception when sqlstate '42501' then null;
  end;
  -- explicit DENY defeats role defaults: deny launch to admin-a2
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa6000-0000-0000-0000-0000000000f1','bbbb6000-0000-0000-0000-000000000004',
          'marketing.campaigns.launch', false, 'bbbb6000-0000-0000-0000-000000000001');
  begin
    perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000004', cid, 'approve',
      (select version from marketing_campaigns where id = cid));
    assert false, 'an explicit deny must defeat the admin role default';
  exception when sqlstate '42501' then null;
  end;
  delete from marketing_access_grants
   where profile_id = 'bbbb6000-0000-0000-0000-000000000004';
end $$;

-- ── (2) LIFECYCLE: guarded machine, fabrication battery, revisions ──────────
do $$
declare cid uuid; r jsonb; v int; rev1 uuid; rev2 uuid; dup uuid; n int;
begin
  cid := (select val from p5_ctx where key='campaignA')::uuid;

  -- FABRICATION battery (service-role direct writes):
  begin
    update marketing_campaigns set status = 'approved' where id = cid;
    assert false, 'approved cannot be fabricated without an approval row';
  exception when raise_exception then null;
  end;
  begin
    update marketing_campaigns set status = 'active' where id = cid;
    assert false, 'review -> active is an illegal transition';
  exception when raise_exception then null;
  end;
  begin
    update marketing_campaigns set approved_at = now() where id = cid;
    assert false, 'approval facts move only with their transition';
  exception when raise_exception then null;
  end;
  begin
    update marketing_campaigns set version = version - 1 where id = cid;
    assert false, 'campaign version can never move backwards';
  exception when raise_exception then null;
  end;
  begin
    insert into marketing_campaigns (tenant_id, name, status)
    values ('aaaa6000-0000-0000-0000-0000000000f1', 'fabricated', 'active');
    assert false, 'a campaign cannot be born active';
  exception when raise_exception then null;
  end;

  -- owner requests changes → draft (+ append-only changes_requested approval)
  v := (select version from marketing_campaigns where id = cid);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'request_changes', v,
        '{"note":"tighten the subject"}'::jsonb);
  assert r ->> 'status' = 'draft', 'review -> draft on request_changes';
  assert (select count(*) from marketing_campaign_approvals
           where campaign_id = cid and decision = 'changes_requested') = 1,
    'changes_requested recorded append-only';

  -- stale version → MK409
  begin
    perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review', 1);
    assert false, 'stale version must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;

  -- back to review, then APPROVE (owner)
  v := (select version from marketing_campaigns where id = cid);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review', v);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'approve', (r ->> 'version')::int);
  assert r ->> 'status' = 'approved' and r ->> 'approval_id' is not null,
    'owner approval binds and transitions';
  rev1 := (select current_revision_id from marketing_campaigns where id = cid);
  assert (select revision_id from marketing_campaign_approvals
           where id = (r ->> 'approval_id')::uuid) = rev1
     and (select revision_hash from marketing_campaign_approvals
           where id = (r ->> 'approval_id')::uuid)
       = (select content_hash from marketing_campaign_revisions where id = rev1),
    'the approval binds the exact revision + hash';

  -- approved revision IMMUTABLE
  begin
    update marketing_campaign_revisions set subject = 'tampered' where id = rev1;
    assert false, 'revisions are immutable';
  exception when raise_exception then null;
  end;
  -- approvals append-only
  begin
    update marketing_campaign_approvals set decision = 'changes_requested'
     where campaign_id = cid and decision = 'approved';
    assert false, 'approvals are append-only';
  exception when raise_exception then null;
  end;
  -- events chain: guarded truth
  begin
    insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status)
    values ('aaaa6000-0000-0000-0000-0000000000f1', cid, 'draft', 'active');
    assert false, 'a campaign event must record the ACTUAL status';
  exception when raise_exception then null;
  end;
  assert (select array_agg(coalesce(from_status,'∅') || '>' || to_status order by seq)
            from marketing_campaign_events where campaign_id = cid)
       = array['∅>draft','draft>review','review>draft','draft>review','review>approved'],
    'the event chain is exactly the recorded history';

  -- REVISE the approved campaign → new immutable revision + back to draft
  v := (select version from marketing_campaigns where id = cid);
  r := marketing_campaign_revise('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid,
        '{"subject":"Hello {{first_name}} — autumn service"}'::jsonb, v);
  rev2 := (r ->> 'revision_id')::uuid;
  assert (r ->> 'revision')::int = 2 and r ->> 'status' = 'draft',
    'editing an approved campaign creates revision 2 and returns to draft';
  assert (select subject from marketing_campaign_revisions where id = rev1)
       = 'Hello {{first_name}}', 'revision 1 content survives untouched';
  -- the old approval no longer authorises the CURRENT revision
  assert not exists (select 1 from marketing_campaign_approvals a
                      where a.campaign_id = cid and a.revision_id = rev2
                        and a.decision = 'approved'),
    'no approval exists for the new revision';

  -- duplicate → distinct draft with copied content
  r := marketing_campaign_duplicate('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid);
  dup := (r ->> 'id')::uuid;
  assert dup <> cid and (select status from marketing_campaigns where id = dup) = 'draft',
    'duplicate is a distinct draft';
  select count(*) into n from marketing_campaign_revisions where campaign_id = dup;
  assert n = 1, 'duplicate starts at revision 1';

  -- re-approve campaign A (rev 2) for the audience sections
  v := (select version from marketing_campaigns where id = cid);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review', v);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'approve', (r ->> 'version')::int);
  assert r ->> 'status' = 'approved', 'campaign A re-approved on revision 2';
end $$;

-- ── (3) AUDIENCE: draft preview + the immutable preflight snapshot ──────────
do $$
declare cid uuid; r jsonb; v int; snap uuid; n int; b jsonb;
begin
  cid := (select val from p5_ctx where key='campaignA')::uuid;

  -- bounded draft preview for the drafter (estimate; not the launch truth)
  r := marketing_campaign_preview_audience('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid);
  assert (r ->> 'candidate_count')::int = 9, 'preview sees all nine candidates';
  assert (r ->> 'eligible_estimate')::int = 4,
    'preview estimate: One, Six, Seven, Eight (shared-destination dedup and personalisation are preflight decisions)';

  -- guardrail: cap below the audience → MK413, nothing persisted
  update marketing_settings set max_bulk_recipients = 5
   where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f1';
  v := (select version from marketing_campaigns where id = cid);
  begin
    perform marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid, v, 'https://unsub.p5.test/functions/v1');
    assert false, 'audience above max_bulk_recipients must be refused';
  exception when sqlstate 'MK413' then null;
  end;
  update marketing_settings set max_bulk_recipients = 500
   where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f1';
  assert not exists (select 1 from marketing_audience_snapshots where campaign_id = cid),
    'a refused preflight persists nothing';

  -- missing public base URL → honest MK428
  begin
    perform marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid, v, null);
    assert false, 'preflight without the public base URL must be refused';
  exception when sqlstate 'MK428' then null;
  end;

  -- drafters cannot preflight (launch authority only)
  begin
    perform marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002', cid, v, 'https://unsub.p5.test/functions/v1');
    assert false, 'preflight requires launch authority';
  exception when sqlstate '42501' then null;
  end;

  -- THE preflight: every candidate represented with exact reasons
  r := marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, v, 'https://unsub.p5.test/functions/v1');
  snap := (r ->> 'snapshot_id')::uuid;
  insert into p5_ctx values ('snapA', snap::text),
                            ('confA', r ->> 'confirmation_id'),
                            ('challengeA', r ->> 'challenge');
  assert (r ->> 'candidate_count')::int = 9
     and (r ->> 'included_count')::int = 1
     and (r ->> 'excluded_count')::int = 8, 'counts: 9 candidates, 1 included, 8 excluded';
  b := r -> 'exclusion_breakdown';
  assert (b ->> 'unknown_preference')::int = 1        -- Two
     and (b ->> 'unsubscribed')::int = 1              -- Three
     and (b ->> 'hard_suppression')::int = 1          -- Four
     and (b ->> 'no_contact_point')::int = 1          -- Five
     and (b ->> 'duplicate_shared_destination')::int = 2  -- Six + Seven
     and (b ->> 'missing_personalisation')::int = 1   -- Eight (no first_name, no fallback)
     and (b ->> 'invalid_destination')::int = 1,      -- Nine (invalid-only endpoint)
    'the exclusion breakdown is exact';
  select count(*) into n from marketing_audience_members where snapshot_id = snap;
  assert n = 9, 'EVERY candidate has an immutable member row';
  assert (select count(*) from marketing_audience_members
           where snapshot_id = snap and included) = 1
     and (select person_id from marketing_audience_members
           where snapshot_id = snap and included) = 'de1e6000-0000-0000-0000-000000000001',
    'exactly ONE included member (P5A One)';
  assert (select personalisation ->> 'first_name' from marketing_audience_members
           where snapshot_id = snap and included) = 'Pat',
    'the personalisation context is frozen on the member';
  assert (select exclusion_reasons from marketing_audience_members
           where snapshot_id = snap
             and person_id = 'de1e6000-0000-0000-0000-000000000007') @> array['duplicate_shared_destination'],
    'shared-destination sharers carry the exact reason';
  -- counts equal immutable rows
  assert (select included_count + excluded_count from marketing_audience_snapshots
           where id = snap) = n, 'snapshot counts equal member rows';
  -- segment version + hash captured
  assert (select segment_version from marketing_audience_snapshots where id = snap) = 1
     and (select segment_hash from marketing_audience_snapshots where id = snap)
       = encode(extensions.digest((select definition::text from marketing_segments
                                    where id = '5e9e6000-0000-0000-0000-000000000001'), 'sha256'), 'hex'),
    'the exact segment definition version + hash are captured';

  -- IMMUTABILITY
  begin
    update marketing_audience_members set included = false
     where snapshot_id = snap and included;
    assert false, 'member rows are immutable';
  exception when raise_exception then null;
  end;
  begin
    update marketing_audience_snapshots set included_count = 99 where id = snap;
    assert false, 'snapshots are immutable';
  exception when raise_exception then null;
  end;

  -- refresh = a NEW snapshot with its own hash; the old row is untouched
  r := marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid,
        (select version from marketing_campaigns where id = cid),
        'https://unsub.p5.test/functions/v1');
  assert (r ->> 'snapshot_id')::uuid <> snap, 'refresh creates a NEW snapshot';
  insert into p5_ctx values ('snapA2', r ->> 'snapshot_id'),
                            ('confA2', r ->> 'confirmation_id'),
                            ('challengeA2', r ->> 'challenge');
  assert (select count(*) from marketing_audience_snapshots where campaign_id = cid) = 2,
    'both snapshots persist immutably';

  -- segment drift after approval → preflight refused until re-revision
  update marketing_segments set definition_version = 2
   where id = '5e9e6000-0000-0000-0000-000000000001';
  begin
    perform marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid,
      (select version from marketing_campaigns where id = cid),
      'https://unsub.p5.test/functions/v1');
    assert false, 'a changed segment definition must refuse preflight';
  exception when sqlstate 'MK409' then null;
  end;
  update marketing_segments set definition_version = 1
   where id = '5e9e6000-0000-0000-0000-000000000001';
end $$;

-- ── (4) LAUNCH: exact one-use confirmation; DST truth; idempotency ──────────
do $$
declare cid uuid; r jsonb; v int; snapA uuid; n int;
begin
  cid := (select val from p5_ctx where key='campaignA')::uuid;

  -- DST: a nonexistent local time is rejected (spring-forward gap)
  begin
    perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid,
      jsonb_build_object('confirmation_id', gen_random_uuid(),
        'challenge', repeat('a', 48), 'request_id', 'req-dst-00001',
        'mode', 'scheduled', 'schedule_local', '2026-03-29 01:30',
        'timezone', 'Europe/London'));
    assert false, 'a nonexistent DST local time must be rejected';
  exception when sqlstate 'MK414' then null;
  end;
  -- DST: an ambiguous local time demands an explicit fold…
  begin
    perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid,
      jsonb_build_object('confirmation_id', gen_random_uuid(),
        'challenge', repeat('a', 48), 'request_id', 'req-dst-00002',
        'mode', 'scheduled', 'schedule_local', '2026-10-25 01:30',
        'timezone', 'Europe/London'));
    assert false, 'an ambiguous DST local time must demand a fold';
  exception when sqlstate 'MK415' then null;
  end;
  -- …and WITH a fold the resolution proceeds (dying later on the fake
  -- confirmation, which proves the schedule step accepted the fold)
  begin
    perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid,
      jsonb_build_object('confirmation_id', gen_random_uuid(),
        'challenge', repeat('a', 48), 'request_id', 'req-dst-00003',
        'mode', 'scheduled', 'schedule_local', '2026-10-25 01:30',
        'timezone', 'Europe/London', 'fold', 'earlier'));
    assert false, 'the fake confirmation must not be found';
  exception when sqlstate 'P0002' then null;
  end;

  -- wrong challenge → refused
  begin
    perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid,
      jsonb_build_object('confirmation_id', (select val from p5_ctx where key='confA2'),
        'challenge', repeat('d', 48), 'request_id', 'req-launch-bad1', 'mode', 'immediate'));
    assert false, 'a wrong challenge must be refused';
  exception when sqlstate '42501' then null;
  end;
  -- another actor cannot use the owner's confirmation
  begin
    perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000004', cid,
      jsonb_build_object('confirmation_id', (select val from p5_ctx where key='confA2'),
        'challenge', (select val from p5_ctx where key='challengeA2'),
        'request_id', 'req-launch-bad2', 'mode', 'immediate'));
    assert false, 'a confirmation is bound to its requesting actor';
  exception when sqlstate '42501' then null;
  end;
  -- a STALE confirmation (older snapshot) cannot launch a refreshed preflight
  begin
    perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid,
      jsonb_build_object('confirmation_id', (select val from p5_ctx where key='confA'),
        'challenge', (select val from p5_ctx where key='challengeA'),
        'request_id', 'req-launch-bad3', 'mode', 'immediate'));
    assert false, 'an old confirmation must not launch a refreshed snapshot';
  exception when sqlstate 'MK409' then null;
  end;

  -- the REAL launch (immediate)
  r := marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid,
        jsonb_build_object('confirmation_id', (select val from p5_ctx where key='confA2'),
          'challenge', (select val from p5_ctx where key='challengeA2'),
          'request_id', 'req-launch-a-001', 'mode', 'immediate'));
  assert r ->> 'status' = 'active' and (r ->> 'dispatches_created')::int = 1
     and not (r ->> 'idempotent')::boolean, 'launch: active with ONE dispatch';
  snapA := (r ->> 'snapshot_id')::uuid;
  assert snapA = (select val from p5_ctx where key='snapA2')::uuid,
    'the LATEST snapshot is the launched audience';
  assert (select used_at from marketing_launch_confirmations
           where id = (select val from p5_ctx where key='confA2')::uuid) is not null,
    'the confirmation is used exactly once';

  -- double-click / replay: the SAME exact request converges
  r := marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid,
        jsonb_build_object('confirmation_id', (select val from p5_ctx where key='confA2'),
          'challenge', (select val from p5_ctx where key='challengeA2'),
          'request_id', 'req-launch-a-001', 'mode', 'immediate'));
  assert (r ->> 'idempotent')::boolean, 'the same launch request converges';
  select count(*) into n from marketing_broadcast_dispatches where campaign_id = cid;
  assert n = 1, 'replay created no extra dispatch rows';
  -- the same request id with DIFFERENT data is a stable conflict
  begin
    perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid,
      jsonb_build_object('confirmation_id', (select val from p5_ctx where key='confA2'),
        'challenge', (select val from p5_ctx where key='challengeA2'),
        'request_id', 'req-launch-a-001', 'mode', 'scheduled',
        'schedule_local', '2027-01-01 09:00', 'timezone', 'Europe/London'));
    assert false, 'a reused launch request id with different data must be MK412';
  exception when sqlstate 'MK412' then null;
  end;

  -- launch-state fabrication: a dispatch can only mirror an INCLUDED member
  begin
    insert into marketing_broadcast_dispatches
      (tenant_id, campaign_id, snapshot_id, member_id, person_id, generation)
    select m.tenant_id, m.campaign_id, m.snapshot_id, m.id, m.person_id, 1
      from marketing_audience_members m
     where m.snapshot_id = snapA and not m.included limit 1;
    assert false, 'an excluded member can never gain a dispatch row';
  exception when raise_exception then null;
  end;

  -- EMPTY audience: nothing to launch is an honest refusal
  r := marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002',
        jsonb_build_object('name','Empty audience probe',
          'sender_id', (select val from p5_ctx where key='sender'),
          'segment_id','5e9e6000-0000-0000-0000-000000000002',
          'subject','S','body_authored','B'));
  v := (r ->> 'version')::int;
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', (r ->> 'id')::uuid, 'submit_review', v);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', (r ->> 'id')::uuid, 'approve',
        (r ->> 'version')::int);
  declare cempty uuid := (r ->> 'id')::uuid; conf jsonb;
  begin
    conf := marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cempty,
      (select version from marketing_campaigns where id = cempty),
      'https://unsub.p5.test/functions/v1');
    assert (conf ->> 'included_count')::int = 0, 'empty audience preflights honestly';
    begin
      perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cempty,
        jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
          'challenge', conf ->> 'challenge', 'request_id', 'req-launch-e-001',
          'mode', 'immediate'));
      assert false, 'an empty snapshot must refuse to launch';
    exception when sqlstate '22023' then null;
    end;
  end;
end $$;

-- ── (5) WORKER: leases, frozen bundle, complete engine lineage, projection ──
do $$
declare
  cid uuid; snapA uuid; d record; r jsonb; b jsonb; disp uuid;
  del uuid; itn uuid; claim record; fin record; em uuid; n int;
  corr uuid := gen_random_uuid(); url text;
begin
  cid := (select val from p5_ctx where key='campaignA')::uuid;
  snapA := (select val from p5_ctx where key='snapA2')::uuid;

  -- lease a batch; a second worker gets nothing
  select * into d from marketing_broadcast_claim_batch(
    'aaaa6000-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  assert d.id is not null and d.status = 'preparing', 'w1 leased the recipient';
  disp := d.id;
  insert into p5_ctx values ('dispA', disp::text);
  assert not exists (select 1 from marketing_broadcast_claim_batch(
    'aaaa6000-0000-0000-0000-0000000000f1', 'w2', 10, 120)),
    'a concurrent worker cannot claim a leased recipient';
  -- the wrong worker cannot use the lease
  begin
    perform marketing_broadcast_recipient_bundle(
      'aaaa6000-0000-0000-0000-0000000000f1', disp, 'w2');
    assert false, 'a foreign worker must not read the bundle';
  exception when sqlstate 'MK423' then null;
  end;

  -- the FROZEN bundle + freshly minted unsubscribe token
  b := marketing_broadcast_recipient_bundle(
    'aaaa6000-0000-0000-0000-0000000000f1', disp, 'w1');
  assert b ->> 'subject' = 'Hello {{first_name}} — autumn service'
     and b ->> 'destination' = 'p5a-one@x.test'
     and (b -> 'personalisation' ->> 'first_name') = 'Pat'
     and b ->> 'unsubscribe_token' ~ '^[0-9a-f]{48}$'
     and b ->> 'public_base_url' = 'https://unsub.p5.test/functions/v1',
    'the bundle carries the frozen revision + member context + token';
  insert into p5_ctx values ('unsubTokenA', b ->> 'unsubscribe_token');
  assert (select token_digest from marketing_unsubscribe_tokens
           where id = (b ->> 'unsubscribe_token_id')::uuid)
       = encode(extensions.digest(b ->> 'unsubscribe_token', 'sha256'), 'hex')
     and (select token_digest from marketing_unsubscribe_tokens
           where id = (b ->> 'unsubscribe_token_id')::uuid) <> (b ->> 'unsubscribe_token'),
    'ONLY the token digest is stored';

  url := (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || (b ->> 'unsubscribe_token');

  -- a forged token in the rendered URL is refused
  begin
    perform marketing_broadcast_create_lineage(
      'aaaa6000-0000-0000-0000-0000000000f1', disp, 'w1',
      jsonb_build_object('subject', 'Hello Pat — autumn service',
        'body_text', 'Hi Pat' || e'\n\nUnsubscribe: ' ||
          (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || repeat('f', 48),
        'body_html', '<div>Hi Pat <a href="' ||
          (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || repeat('f', 48) ||
          '">Unsubscribe</a></div>',
        'unsubscribe_url',
          (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || repeat('f', 48)));
    assert false, 'a forged unsubscribe token must be refused';
  exception when sqlstate '22023' then null;
  end;

  -- the REAL lineage: Action + REQUIRES_APPROVAL decision + intent + pinned
  -- hash + append-only tenant_senior approval + delivery + dispatch queued
  r := marketing_broadcast_create_lineage(
    'aaaa6000-0000-0000-0000-0000000000f1', disp, 'w1',
    jsonb_build_object('subject', 'Hello Pat — autumn service',
      'body_text', 'Hi Pat,' || e'\n\nBook here: Book a service (https://drummonds.test/book)'
        || e'\n\nThanks,\nDrummonds\n\n--\nDrummonds\n\nUnsubscribe: ' || url,
      'body_html', '<div>Hi Pat, <a href="https://drummonds.test/book">Book a service</a>'
        || ' <a href="' || url || '">Unsubscribe</a></div>',
      'preview_text', 'Book your autumn service',
      'unsubscribe_url', url));
  del := (r ->> 'delivery_id')::uuid;
  itn := (r ->> 'intent_id')::uuid;
  insert into p5_ctx values ('delA', del::text), ('intentA', itn::text);
  assert not (r ->> 'idempotent')::boolean, 'lineage created';

  assert (select intent_type from automation_intents where id = itn)
       = 'send_marketing_broadcast_email', 'the BULK intent type is used';
  assert (select requires_approval from automation_intent_types
           where intent_type = 'send_marketing_broadcast_email'),
    'the bulk intent type is registered approval-required';
  assert (select approved_payload_hash from automation_intents where id = itn)
       = automation_intent_envelope_hash('aaaa6000-0000-0000-0000-0000000000f1', itn),
    'the complete approved envelope hash is pinned';
  assert (select decision from decision_log
           where id = (select decision_id from automation_intents where id = itn))
       = 'AUTOMATION_REQUIRES_APPROVAL', 'the decision honestly requires approval';
  -- the approval is REAL, append-only, and names the GENUINE owner approver
  assert (select count(*) from automation_approvals
           where automation_intent_id = itn and decision = 'approved'
             and approver_kind = 'tenant_senior'
             and approver_ref = 'bbbb6000-0000-0000-0000-000000000001'
             and authority_basis = 'marketing.campaigns.launch') = 1,
    'ONE tenant_senior approval names the real owner/admin launch approver';
  assert (select evidence ->> 'snapshot_member_id' from automation_approvals
           where automation_intent_id = itn)
       = (select member_id::text from marketing_broadcast_dispatches where id = disp),
    'the approval evidence binds the exact snapshot member';
  assert (select purpose from marketing_deliveries where id = del) = 'broadcast'
     and (select campaign_id from marketing_deliveries where id = del) = cid
     and (select body_html from marketing_deliveries where id = del) like '%Unsubscribe%'
     and (select person_id from marketing_deliveries where id = del)
       = 'de1e6000-0000-0000-0000-000000000001',
    'the broadcast delivery carries the full frozen lineage';
  assert (select status from marketing_broadcast_dispatches where id = disp) = 'queued',
    'dispatch is queued';
  -- deterministic idempotency: the dispatch is no longer claimable or re-preparable
  assert not exists (select 1 from marketing_broadcast_claim_batch(
    'aaaa6000-0000-0000-0000-0000000000f1', 'w1', 10, 120)),
    'a queued recipient is never re-claimed';

  -- the canonical send authority (what the ADAPTER calls pre-provider)
  r := marketing_broadcast_send_authority('aaaa6000-0000-0000-0000-0000000000f1', del);
  assert (r ->> 'allowed')::boolean, 'authority allows the healthy recipient';
  -- frozen content survives later edits: change the SENDER's display config
  -- and the PERSON's name AFTER the envelope froze
  update marketing_sender_profiles set from_name = 'EDITED NAME'
   where id = (select val from p5_ctx where key='sender')::uuid;
  update people set first_name = 'EDITED' where id = 'de1e6000-0000-0000-0000-000000000001';
  assert (select parameters ->> 'from_name' from automation_intents where id = itn)
       = 'Drummonds'
     and (select parameters ->> 'subject' from automation_intents where id = itn)
       = 'Hello Pat — autumn service',
    'the frozen envelope survives sender + person edits';

  -- REAL engine execution with a STUBBED provider result
  select * into claim from automation_claim_and_start(
    itn, 'aaaa6000-0000-0000-0000-0000000000f1', 'p5-test-worker', 120,
    'idem-p5-' || itn, corr, 'test');
  assert claim.attempt_id is not null
     and claim.intent_type = 'send_marketing_broadcast_email'
     and claim.envelope_parameters ->> 'campaign_id' = cid::text,
    'the engine hands the adapter the frozen broadcast envelope';
  r := marketing_delivery_reconcile('aaaa6000-0000-0000-0000-0000000000f1', del);
  assert r ->> 'status' = 'executing', 'delivery executing';
  assert (select status from marketing_broadcast_dispatches where id = disp) = 'executing',
    'dispatch executing';
  select * into fin from automation_finalize_execution(
    'aaaa6000-0000-0000-0000-0000000000f1', itn, claim.attempt_id, 'p5-test-worker',
    'succeeded',
    jsonb_build_object('message_id','gm-bc-001','thread_id','gm-thr-bc-001',
                       'delivery_id', del, 'submitted_at', now()),
    null, 'succeeded', false, null, 'gm-bc-001', '2xx',
    'marketing_email_submitted', 'operational', corr, null);
  r := marketing_delivery_reconcile('aaaa6000-0000-0000-0000-0000000000f1', del);
  assert r ->> 'status' = 'submitted', 'delivery submitted';
  assert (select status from marketing_broadcast_dispatches where id = disp) = 'submitted',
    'dispatch submitted';

  -- canonical email row: STRUCTURAL campaign + person linkage
  select id into em from email_messages
   where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f1'
     and provider_message_id = 'gm-bc-001';
  assert em is not null
     and (select origin_campaign_id from email_messages where id = em) = cid
     and (select origin_person_id from email_messages where id = em)
       = 'de1e6000-0000-0000-0000-000000000001'
     and (select body_text from email_messages where id = em) like '%Unsubscribe:%',
    'the canonical email carries structural campaign/person provenance';
  -- later Gmail ingestion converges, never duplicates
  insert into email_messages (tenant_id, provider, provider_message_id, subject, direction)
  values ('aaaa6000-0000-0000-0000-0000000000f1','gmail','gm-bc-001','x','outbound')
  on conflict (tenant_id, provider, provider_message_id) do nothing;
  select count(*) into n from email_messages
   where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f1'
     and provider_message_id = 'gm-bc-001';
  assert n = 1, 'ingestion converges on ONE canonical row';
  -- the standard projector job is queued (the projector stays the only writer)
  assert exists (select 1 from platform_jobs
                  where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f1'
                    and job_type = 'interactions.sync' and status = 'queued'),
    'the canonical interactions.sync job is enqueued';

  -- COMPLETION derived from recipient facts (single recipient → completed)
  assert (select status from marketing_campaigns where id = cid) = 'completed',
    'the campaign completed from recipient facts';
  assert exists (select 1 from platform_events
                  where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f1'
                    and event_type = 'marketing.message.submitted'),
    'the submitted fact was published';

  -- terminal facts pinned everywhere
  begin
    update marketing_broadcast_dispatches set status = 'failed', failure_class = 'x'
     where id = disp;
    assert false, 'a submitted dispatch is terminal';
  exception when raise_exception then null;
  end;
end $$;

-- ── (6) SUPPRESSION RACES: the three-point closure ──────────────────────────
insert into people (id, tenant_id, display_name, first_name, primary_email) values
  ('de1e6000-0000-0000-0000-000000000011','aaaa6000-0000-0000-0000-0000000000f1','P5C Ann','Ann','p5c-ann@x.test'),
  ('de1e6000-0000-0000-0000-000000000012','aaaa6000-0000-0000-0000-0000000000f1','P5D Bob','Bob','p5d-bob@x.test');
insert into contact_points (id, tenant_id, person_id, channel, value, normalized_value, is_primary) values
  ('c0146000-0000-0000-0000-000000000011','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000011','email','p5c-ann@x.test','p5c-ann@x.test',true),
  ('c0146000-0000-0000-0000-000000000012','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000012','email','p5d-bob@x.test','p5d-bob@x.test',true);
insert into communication_preferences (tenant_id, person_id, channel, state, source) values
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000011','email','subscribed','manual'),
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000012','email','subscribed','manual');
insert into marketing_segments (id, tenant_id, name, definition, definition_version, status) values
  ('5e9e6000-0000-0000-0000-000000000003','aaaa6000-0000-0000-0000-0000000000f1','P5C','{"field":"search","value":"P5C"}',1,'active'),
  ('5e9e6000-0000-0000-0000-000000000004','aaaa6000-0000-0000-0000-0000000000f1','P5D','{"field":"search","value":"P5D"}',1,'active');

create or replace function pg_temp.p5_launch(p_name text, p_segment uuid)
returns uuid language plpgsql as $$
declare r jsonb; cid uuid; conf jsonb;
begin
  r := marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002',
        jsonb_build_object('name', p_name,
          'sender_id', (select val from p5_ctx where key='sender'),
          'segment_id', p_segment,
          'subject','Update from Drummonds','body_authored','Plain news.'));
  cid := (r ->> 'id')::uuid;
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review', (r ->> 'version')::int);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'approve', (r ->> 'version')::int);
  conf := marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid,
        (select version from marketing_campaigns where id = cid),
        'https://unsub.p5.test/functions/v1');
  perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid,
        jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
          'challenge', conf ->> 'challenge',
          'request_id', 'req-' || left(md5(p_name), 20), 'mode', 'immediate'));
  return cid;
end $$;

do $$
declare cidC uuid; cidD uuid; d record; b jsonb; r jsonb; url text;
        del uuid; itn uuid; claim record; corr uuid := gen_random_uuid();
begin
  -- RACE 1: eligible at snapshot, suppressed BEFORE dispatch → skipped with
  -- NO intent, NO delivery, NO provider anything
  cidC := pg_temp.p5_launch('Race C', '5e9e6000-0000-0000-0000-000000000003');
  insert into contact_suppressions (tenant_id, person_id, channel, normalized_value, reason, active)
  values ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000011',
          'email','p5c-ann@x.test','manual',true);
  select * into d from marketing_broadcast_claim_batch(
    'aaaa6000-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  assert d.campaign_id = cidC, 'claimed the race-C recipient';
  b := marketing_broadcast_recipient_bundle('aaaa6000-0000-0000-0000-0000000000f1', d.id, 'w1');
  assert (b ->> 'skipped')::boolean and b ->> 'code' = 'not_subscribed',
    'the pre-intent recheck skipped the suppressed recipient';
  assert (select status from marketing_broadcast_dispatches where id = d.id) = 'skipped'
     and (select skip_reason from marketing_broadcast_dispatches where id = d.id)
       = 'policy_not_subscribed', 'dispatch skipped with the exact reason';
  assert not exists (select 1 from automation_intents
                      where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f1'
                        and parameters ->> 'campaign_id' = cidC::text),
    'NO intent was created for the skipped recipient';
  assert not exists (select 1 from marketing_deliveries where campaign_id = cidC),
    'NO delivery was created for the skipped recipient';
  assert (select status from marketing_campaigns where id = cidC) = 'completed',
    'the all-skipped campaign completes from recipient facts';
  assert exists (select 1 from platform_events
                  where event_type = 'marketing.broadcast.recipient_skipped'),
    'the skip fact was published';

  -- RACE 2: suppressed AFTER intent creation — the canonical authority blocks
  -- pre-provider (delivery becomes skipped, never failed, no email row)
  cidD := pg_temp.p5_launch('Race D', '5e9e6000-0000-0000-0000-000000000004');
  select * into d from marketing_broadcast_claim_batch(
    'aaaa6000-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  b := marketing_broadcast_recipient_bundle('aaaa6000-0000-0000-0000-0000000000f1', d.id, 'w1');
  url := (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || (b ->> 'unsubscribe_token');
  r := marketing_broadcast_create_lineage('aaaa6000-0000-0000-0000-0000000000f1', d.id, 'w1',
        jsonb_build_object('subject','Update from Drummonds',
          'body_text', 'Plain news.' || e'\n\nUnsubscribe: ' || url,
          'body_html', '<div>Plain news. <a href="' || url || '">Unsubscribe</a></div>',
          'unsubscribe_url', url));
  del := (r ->> 'delivery_id')::uuid;
  itn := (r ->> 'intent_id')::uuid;
  -- the frozen endpoint changing blocks too (checked before suppression)
  update contact_points set normalized_value = 'moved@x.test', value = 'moved@x.test'
   where id = 'c0146000-0000-0000-0000-000000000012';
  r := marketing_broadcast_send_authority('aaaa6000-0000-0000-0000-0000000000f1', del);
  assert not (r ->> 'allowed')::boolean and r ->> 'code' = 'endpoint_changed',
    'a changed frozen endpoint blocks before the provider';
  update contact_points set normalized_value = 'p5d-bob@x.test', value = 'p5d-bob@x.test'
   where id = 'c0146000-0000-0000-0000-000000000012';
  -- now the unsubscribe race (explicit later effective_at — inside one test
  -- transaction now() is constant, so the append-only ordering needs it)
  insert into communication_preferences (tenant_id, person_id, channel, state, source, effective_at)
  values ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000012',
          'email','unsubscribed','manual', now() + interval '1 second');
  r := marketing_broadcast_send_authority('aaaa6000-0000-0000-0000-0000000000f1', del);
  assert not (r ->> 'allowed')::boolean and r ->> 'code' = 'not_subscribed',
    'the adapter-facing authority blocks the unsubscribed recipient pre-provider';
  -- the engine records the adapter's policy refusal; the projection is SKIPPED
  select * into claim from automation_claim_and_start(
    itn, 'aaaa6000-0000-0000-0000-0000000000f1', 'p5-test-worker', 120,
    'idem-p5-' || itn, corr, 'test');
  perform automation_finalize_execution(
    'aaaa6000-0000-0000-0000-0000000000f1', itn, claim.attempt_id, 'p5-test-worker',
    'failed', null, 'policy_not_subscribed', 'failed_permanent', false, null,
    null, 'policy', null, null, corr, null);
  r := marketing_delivery_reconcile('aaaa6000-0000-0000-0000-0000000000f1', del);
  assert r ->> 'status' = 'skipped', 'a policy refusal projects as SKIPPED, not failed';
  assert (select failure_class from marketing_deliveries where id = del)
       = 'policy_not_subscribed', 'the exact policy code is preserved';
  assert not exists (select 1 from email_messages
                      where origin_delivery_id = del),
    'a skipped send creates NO canonical email row (and so no Interaction)';
  assert (select status from marketing_campaigns where id = cidD) = 'completed',
    'race-D campaign completed';
end $$;

-- ── (7) PAUSE / RESUME / CANCEL: only unsent work stops ─────────────────────
insert into people (id, tenant_id, display_name, first_name, primary_email) values
  ('de1e6000-0000-0000-0000-000000000013','aaaa6000-0000-0000-0000-0000000000f1','P5E Cid','Cid','p5e-cid@x.test'),
  ('de1e6000-0000-0000-0000-000000000014','aaaa6000-0000-0000-0000-0000000000f1','P5E Dee','Dee','p5e-dee@x.test'),
  ('de1e6000-0000-0000-0000-000000000015','aaaa6000-0000-0000-0000-0000000000f1','P5F Eve','Eve','p5f-eve@x.test');
insert into contact_points (id, tenant_id, person_id, channel, value, normalized_value, is_primary) values
  ('c0146000-0000-0000-0000-000000000013','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000013','email','p5e-cid@x.test','p5e-cid@x.test',true),
  ('c0146000-0000-0000-0000-000000000014','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000014','email','p5e-dee@x.test','p5e-dee@x.test',true),
  ('c0146000-0000-0000-0000-000000000015','aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000015','email','p5f-eve@x.test','p5f-eve@x.test',true);
insert into communication_preferences (tenant_id, person_id, channel, state, source) values
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000013','email','subscribed','manual'),
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000014','email','subscribed','manual'),
  ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000015','email','subscribed','manual');
insert into marketing_segments (id, tenant_id, name, definition, definition_version, status) values
  ('5e9e6000-0000-0000-0000-000000000005','aaaa6000-0000-0000-0000-0000000000f1','P5E','{"field":"search","value":"P5E"}',1,'active'),
  ('5e9e6000-0000-0000-0000-000000000006','aaaa6000-0000-0000-0000-0000000000f1','P5F','{"field":"search","value":"P5F"}',1,'active');

do $$
declare cidE uuid; d record; b jsonb; r jsonb; url text; del uuid; itn uuid; n int;
begin
  cidE := pg_temp.p5_launch('Pause E', '5e9e6000-0000-0000-0000-000000000005');
  assert (select count(*) from marketing_broadcast_dispatches where campaign_id = cidE) = 2,
    'two recipients dispatched';
  -- prepare ONE recipient fully (queued intent) before pausing
  select * into d from marketing_broadcast_claim_batch(
    'aaaa6000-0000-0000-0000-0000000000f1', 'w1', 1, 120);
  b := marketing_broadcast_recipient_bundle('aaaa6000-0000-0000-0000-0000000000f1', d.id, 'w1');
  url := (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || (b ->> 'unsubscribe_token');
  r := marketing_broadcast_create_lineage('aaaa6000-0000-0000-0000-0000000000f1', d.id, 'w1',
        jsonb_build_object('subject','Update from Drummonds',
          'body_text', 'Plain news.' || e'\n\nUnsubscribe: ' || url,
          'body_html', '<div>Plain news. <a href="' || url || '">Unsubscribe</a></div>',
          'unsubscribe_url', url));
  del := (r ->> 'delivery_id')::uuid;
  itn := (r ->> 'intent_id')::uuid;

  -- PAUSE stops new preparation immediately
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cidE, 'pause',
        (select version from marketing_campaigns where id = cidE));
  assert r ->> 'status' = 'paused', 'active -> paused';
  assert not exists (select 1 from marketing_broadcast_claim_batch(
    'aaaa6000-0000-0000-0000-0000000000f1', 'w1', 10, 120)),
    'no recipient is claimable while paused';
  -- the adapter authority also refuses while paused (no provider call)
  r := marketing_broadcast_send_authority('aaaa6000-0000-0000-0000-0000000000f1', del);
  assert not (r ->> 'allowed')::boolean and r ->> 'code' = 'campaign_not_active',
    'the canonical authority blocks a paused campaign pre-provider';

  -- RESUME continues; nothing is re-dispatched
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cidE, 'resume',
        (select version from marketing_campaigns where id = cidE));
  assert r ->> 'status' = 'active' and (r ->> 'dispatches_created')::int = 0,
    'resume re-activates without duplicating dispatch rows';

  -- CANCEL: pending work cancels outright; the queued recipient's PENDING
  -- intent cancels through the engine's legal transition; nothing in flight
  -- is rewritten
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cidE, 'cancel',
        (select version from marketing_campaigns where id = cidE));
  assert r ->> 'status' = 'cancelled'
     and (r ->> 'cancelled_pending')::int = 1
     and (r ->> 'cancelled_intents')::int = 1, 'cancel stopped exactly the unsent work';
  assert (select status from automation_intents where id = itn) = 'cancelled',
    'the pending intent was cancelled through the legal engine transition';
  assert (select status from marketing_deliveries where id = del) = 'cancelled',
    'the queued delivery is factually cancelled';
  select count(*) into n from marketing_broadcast_dispatches
   where campaign_id = cidE and status = 'cancelled';
  assert n = 2, 'both recipients ended cancelled';
  -- cancelled -> only archived
  begin
    perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cidE, 'resume',
      (select version from marketing_campaigns where id = cidE));
    assert false, 'a cancelled campaign can never resume';
  exception when sqlstate '22023' then null; when raise_exception then null;
  end;
  insert into p5_ctx values ('campaignE', cidE::text);
end $$;

-- ── (8) UNKNOWN: frozen, blocks completion, never re-dispatched ─────────────
do $$
declare cidF uuid; d record; b jsonb; r jsonb; url text; del uuid; itn uuid;
        claim record; corr uuid := gen_random_uuid(); n int;
begin
  cidF := pg_temp.p5_launch('Unknown F', '5e9e6000-0000-0000-0000-000000000006');
  select * into d from marketing_broadcast_claim_batch(
    'aaaa6000-0000-0000-0000-0000000000f1', 'w1', 10, 120);
  b := marketing_broadcast_recipient_bundle('aaaa6000-0000-0000-0000-0000000000f1', d.id, 'w1');
  url := (b ->> 'public_base_url') || '/marketing-unsubscribe?t=' || (b ->> 'unsubscribe_token');
  r := marketing_broadcast_create_lineage('aaaa6000-0000-0000-0000-0000000000f1', d.id, 'w1',
        jsonb_build_object('subject','Update from Drummonds',
          'body_text', 'Plain news.' || e'\n\nUnsubscribe: ' || url,
          'body_html', '<div>Plain news. <a href="' || url || '">Unsubscribe</a></div>',
          'unsubscribe_url', url));
  del := (r ->> 'delivery_id')::uuid;
  itn := (r ->> 'intent_id')::uuid;
  select * into claim from automation_claim_and_start(
    itn, 'aaaa6000-0000-0000-0000-0000000000f1', 'p5-test-worker', 120,
    'idem-p5-' || itn, corr, 'test');
  perform automation_finalize_execution(
    'aaaa6000-0000-0000-0000-0000000000f1', itn, claim.attempt_id, 'p5-test-worker',
    'unknown', null, 'external_result_unknown', 'unknown', false, null,
    null, 'lost', null, null, corr, null);
  r := marketing_delivery_reconcile('aaaa6000-0000-0000-0000-0000000000f1', del);
  assert r ->> 'status' = 'unknown', 'the lost provider result freezes as unknown';
  assert (select status from marketing_broadcast_dispatches where id = d.id) = 'unknown',
    'dispatch unknown';
  assert (select status from marketing_campaigns where id = cidF) = 'active',
    'an unknown result BLOCKS completion';
  -- pause + resume never re-dispatches or rewrites the unknown recipient
  perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
    'bbbb6000-0000-0000-0000-000000000001', cidF, 'pause',
    (select version from marketing_campaigns where id = cidF));
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cidF, 'resume',
        (select version from marketing_campaigns where id = cidF));
  assert (r ->> 'dispatches_created')::int = 0, 'resume NEVER retries unknown work';
  select count(*) into n from marketing_broadcast_dispatches where campaign_id = cidF;
  assert n = 1, 'still exactly one dispatch generation';
  begin
    update marketing_broadcast_dispatches set status = 'queued' where id = d.id;
    assert false, 'an unknown dispatch can never be rewritten into a retry';
  exception when raise_exception then null;
  end;
  -- the ENGINE's explicit resolution is the only exit
  perform automation_resolve_unknown_execution(
    'aaaa6000-0000-0000-0000-0000000000f1', itn, 'succeeded',
    jsonb_build_object('message_id','gm-f-001','delivery_id', del),
    null, 'succeeded', 'gm-f-001', '2xx',
    'marketing_email_submitted', 'operational', corr, null);
  r := marketing_delivery_reconcile('aaaa6000-0000-0000-0000-0000000000f1', del);
  assert r ->> 'status' = 'submitted', 'the appended resolution submits';
  assert (select status from marketing_campaigns where id = cidF) = 'completed',
    'completion follows only once the unknown is resolved';
end $$;

-- ── (9) UNSUBSCRIBE: digest-only, non-enumerating, idempotent, immediate ────
do $$
declare tok text; r1 jsonb; r2 jsonb; r3 jsonb; n int; p uuid;
begin
  tok := (select val from p5_ctx where key='unsubTokenA');
  p := 'de1e6000-0000-0000-0000-000000000001';

  r1 := marketing_unsubscribe_apply(tok);
  assert r1 = '{"ok": true}'::jsonb, 'a valid unsubscribe returns the generic ok';
  assert (select count(*) from communication_preferences
           where person_id = p and state = 'unsubscribed'
             and source = 'unsubscribe_link') = 1, 'ONE unsubscribed preference fact';
  assert (select count(*) from contact_suppressions
           where normalized_value = 'p5a-one@x.test' and active
             and reason = 'unsubscribe') = 1, 'ONE active hard suppression';
  assert (select count(*) from platform_events
           where event_type = 'marketing.unsubscribe.recorded'
             and subject_id = p) = 1, 'ONE unsubscribe fact/event';
  assert (select used_at from marketing_unsubscribe_tokens
           where token_digest = encode(extensions.digest(tok, 'sha256'), 'hex')) is not null,
    'the token use is recorded once';

  -- REPLAY: converges with zero new facts
  r2 := marketing_unsubscribe_apply(tok);
  assert r2 = r1, 'a replay is indistinguishable';
  assert (select count(*) from communication_preferences
           where person_id = p and state = 'unsubscribed'
             and source = 'unsubscribe_link') = 1
     and (select count(*) from contact_suppressions
           where normalized_value = 'p5a-one@x.test' and active) = 1
     and (select count(*) from platform_events
           where event_type = 'marketing.unsubscribe.recorded'
             and subject_id = p) = 1,
    'replay created NO duplicate preference/suppression/event';

  -- invalid / expired / revoked are indistinguishable from success
  r3 := marketing_unsubscribe_apply(repeat('0', 48));
  assert r3 = r1, 'an invalid token gets the SAME generic response';
  insert into marketing_unsubscribe_tokens
    (tenant_id, token_digest, person_id, contact_point_id, destination, expires_at)
  values ('aaaa6000-0000-0000-0000-0000000000f1',
          encode(extensions.digest(repeat('1', 48), 'sha256'), 'hex'),
          'de1e6000-0000-0000-0000-000000000002',
          'c0146000-0000-0000-0000-000000000002', 'p5a-two@x.test',
          now() - interval '1 day');
  r3 := marketing_unsubscribe_apply(repeat('1', 48));
  assert r3 = r1, 'an expired token gets the SAME generic response';
  assert not exists (select 1 from communication_preferences
                      where person_id = 'de1e6000-0000-0000-0000-000000000002'
                        and state = 'unsubscribed'),
    'an expired token changes NOTHING';
  insert into marketing_unsubscribe_tokens
    (tenant_id, token_digest, person_id, contact_point_id, destination, expires_at, revoked_at)
  values ('aaaa6000-0000-0000-0000-0000000000f1',
          encode(extensions.digest(repeat('2', 48), 'sha256'), 'hex'),
          'de1e6000-0000-0000-0000-000000000002',
          'c0146000-0000-0000-0000-000000000002', 'p5a-two@x.test',
          now() + interval '30 days', now());
  r3 := marketing_unsubscribe_apply(repeat('2', 48));
  assert r3 = r1, 'a revoked token gets the SAME generic response';

  -- IMMEDIATE effect on eligibility (queued/future sends re-derive live)
  assert marketing_endpoint_eligibility('aaaa6000-0000-0000-0000-0000000000f1', p,
           'email', 'c0146000-0000-0000-0000-000000000001') = 'suppressed',
    'the unsubscribed endpoint is immediately ineligible';

  -- no plaintext token is ever stored
  select count(*) into n from marketing_unsubscribe_tokens
   where token_digest = tok;
  assert n = 0, 'the plaintext token exists nowhere in storage';
end $$;

-- ── (10) REPORTING + stable recipient pagination ─────────────────────────────
do $$
declare cid uuid; r jsonb; p1 jsonb; p2 jsonb;
begin
  cid := (select val from p5_ctx where key='campaignA')::uuid;
  r := marketing_campaign_report('aaaa6000-0000-0000-0000-0000000000f1', cid);
  assert (r -> 'dispatch' ->> 'submitted')::int = 1
     and (r -> 'snapshot' ->> 'included')::int = 1
     and (r -> 'snapshot' ->> 'excluded')::int = 8,
    'report counts derive from source rows';
  assert r -> 'clicked' = 'null'::jsonb and r -> 'delivered' = 'null'::jsonb
     and r -> 'opened' = 'null'::jsonb,
    'unsupported metrics are honestly null, never zero';
  assert r ->> 'submitted_meaning' like '%NOT delivered%',
    'submitted is stated as acceptance, not delivery';

  -- stable pagination over campaign E's two recipients (page size 1)
  cid := (select val from p5_ctx where key='campaignE')::uuid;
  p1 := marketing_campaign_recipient_page('aaaa6000-0000-0000-0000-0000000000f1', cid,
          '{"limit": 1}'::jsonb);
  assert jsonb_array_length(p1 -> 'recipients') = 1 and p1 -> 'next_cursor' is not null
     and p1 -> 'next_cursor' <> 'null'::jsonb, 'page 1 of 2';
  p2 := marketing_campaign_recipient_page('aaaa6000-0000-0000-0000-0000000000f1', cid,
          jsonb_build_object('limit', 1, 'cursor', p1 -> 'next_cursor'));
  assert jsonb_array_length(p2 -> 'recipients') = 1
     and (p2 -> 'recipients' -> 0 ->> 'dispatch_id')
       <> (p1 -> 'recipients' -> 0 ->> 'dispatch_id'),
    'page 2 has no overlap';
  assert p2 -> 'next_cursor' is null or p2 -> 'next_cursor' = 'null'::jsonb,
    'no phantom third page';
end $$;

-- ── (11) CROSS-TENANT + boundaries ──────────────────────────────────────────
do $$
declare fn text; cidB uuid;
begin
  -- a tenant-B campaign cannot reference tenant-A's sender/segment/revision
  insert into marketing_campaigns (id, tenant_id, name, campaign_type, status)
  values ('aaaa6000-0000-0000-0000-00000000c0b1', 'aaaa6000-0000-0000-0000-0000000000f2',
          'B probe', 'broadcast', 'draft');
  cidB := 'aaaa6000-0000-0000-0000-00000000c0b1';
  begin
    update marketing_campaigns
       set sender_profile_id = (select val from p5_ctx where key='sender')::uuid
     where id = cidB;
    assert false, 'a cross-tenant sender must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into marketing_campaign_revisions
      (tenant_id, campaign_id, revision_number, sender_profile_id, segment_id,
       segment_version, subject, body_authored, content_hash)
    values ('aaaa6000-0000-0000-0000-0000000000f2',
            (select val from p5_ctx where key='campaignA')::uuid, 99,
            (select val from p5_ctx where key='sender')::uuid,
            '5e9e6000-0000-0000-0000-000000000001', 1, 'S', 'B', repeat('a', 64));
    assert false, 'a tenant-B revision can never attach tenant-A''s campaign';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into marketing_audience_snapshots
      (tenant_id, campaign_id, revision_id, approval_id, segment_id, segment_version,
       segment_hash, sender_profile_id, settings_version, candidate_count,
       included_count, excluded_count, snapshot_hash)
    select 'aaaa6000-0000-0000-0000-0000000000f2', s.campaign_id, s.revision_id,
           s.approval_id, s.segment_id, s.segment_version, s.segment_hash,
           s.sender_profile_id, 1, 0, 0, 0, repeat('b', 64)
      from marketing_audience_snapshots s limit 1;
    assert false, 'a cross-tenant snapshot lineage is structurally impossible';
  exception when foreign_key_violation then null;
  end;
  -- launch confirmations + unsubscribe tokens are NOT client-readable
  assert (select count(*) from pg_policies
           where tablename in ('marketing_launch_confirmations',
                               'marketing_unsubscribe_tokens')) = 0
     and not has_table_privilege('authenticated', 'marketing_launch_confirmations', 'select')
     and not has_table_privilege('authenticated', 'marketing_unsubscribe_tokens', 'select'),
    'challenge/token digests can never reach a browser';
  -- interactions campaign linkage is structural
  assert (select pg_get_constraintdef(oid) from pg_constraint
           where conname = 'interactions_related_campaign_fk')
       ilike '%(tenant_id, related_campaign_id)%references marketing_campaigns(tenant_id, id)%',
    'interactions.related_campaign_id is composite tenant-bound';
  -- no client role can delete/rewrite Phase-5 history
  assert not has_table_privilege('service_role', 'marketing_campaign_revisions', 'delete')
     and not has_table_privilege('service_role', 'marketing_campaign_revisions', 'update')
     and not has_table_privilege('service_role', 'marketing_campaign_approvals', 'update')
     and not has_table_privilege('service_role', 'marketing_audience_members', 'update')
     and not has_table_privilege('service_role', 'marketing_campaigns', 'delete'),
    'history rewriting privileges are revoked even for the service role';
  -- EVERY Phase-5 function is service-role-only, enumerated from the CATALOG
  -- rather than from a hand-kept list — a new helper added without its
  -- revoke/grant would otherwise ship with PUBLIC EXECUTE and go unnoticed
  for fn in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'marketing_campaign%' or p.proname like 'marketing_broadcast%'
            or p.proname = 'marketing_unsubscribe_apply')
       and p.prokind = 'f'
       and p.proname not like '%_guard'          -- trigger functions take no grant
  loop
    if exists (
      select 1 from information_schema.routine_privileges rp
       where rp.routine_name = fn and rp.grantee in ('anon', 'authenticated', 'PUBLIC')
         and rp.privilege_type = 'EXECUTE') then
      raise exception 'FAIL: Phase-5 function % is executable by a client role', fn;
    end if;
  end loop;
  -- the named contract stays asserted explicitly as well
  foreach fn in array array[
    'marketing_campaign_create', 'marketing_campaign_revise', 'marketing_campaign_duplicate',
    'marketing_campaign_transition', 'marketing_campaign_preview_audience',
    'marketing_campaign_preflight', 'marketing_campaign_launch', 'marketing_broadcast_due',
    'marketing_broadcast_claim_batch', 'marketing_broadcast_recipient_bundle',
    'marketing_broadcast_create_lineage', 'marketing_unsubscribe_apply',
    'marketing_campaign_list', 'marketing_campaign_detail', 'marketing_campaign_report',
    'marketing_campaign_recipient_page', 'marketing_broadcast_health',
    'marketing_broadcast_send_authority', 'marketing_broadcast_check_completion'
  ] loop
    if exists (
      select 1 from information_schema.routine_privileges rp
       where rp.routine_name = fn and rp.grantee in ('anon', 'authenticated', 'PUBLIC')
         and rp.privilege_type = 'EXECUTE') then
      raise exception 'FAIL: % is executable by a client role', fn;
    end if;
  end loop;
end $$;

-- ── (12) TENANT CASCADE: append-only guards never block owner-level cleanup ─
do $$
declare r jsonb; conf jsonb; cid uuid;
begin
  insert into tenants (id, slug, display_name, industry)
  values ('aaaa6000-0000-0000-0000-0000000000f3', 'p5-t3-cascade', 'Cascade T3', 'hvac');
  insert into auth.users (id, email, is_sso_user, is_anonymous)
  values ('bbbb6000-0000-0000-0000-000000000006','owner-c@p5.test',false,false);
  update profiles set role='owner', tenant_id='aaaa6000-0000-0000-0000-0000000000f3'
   where id='bbbb6000-0000-0000-0000-000000000006';
  perform marketing_materialise_defaults('aaaa6000-0000-0000-0000-0000000000f3',
    'bbbb6000-0000-0000-0000-000000000006');
  insert into email_accounts (id, tenant_id, provider, email_address, status, auth_state)
  values ('eeee6000-0000-0000-0000-0000000000a3','aaaa6000-0000-0000-0000-0000000000f3',
          'gmail','sender@p5-t3.test','active','ok');
  insert into email_oauth_tokens (tenant_id, email_account_id, provider, access_token, scope)
  values ('aaaa6000-0000-0000-0000-0000000000f3','eeee6000-0000-0000-0000-0000000000a3',
          'gmail','tok','https://www.googleapis.com/auth/gmail.send');
  r := marketing_sender_create('aaaa6000-0000-0000-0000-0000000000f3',
        'bbbb6000-0000-0000-0000-000000000006',
        '{"source_kind":"gmail_oauth","source_id":"eeee6000-0000-0000-0000-0000000000a3"}');
  perform marketing_sender_set_enabled('aaaa6000-0000-0000-0000-0000000000f3',
    'bbbb6000-0000-0000-0000-000000000006', (r ->> 'id')::uuid,
    true, (select updated_at from marketing_sender_profiles where id = (r ->> 'id')::uuid));
  -- NOTE: no communication_preferences row is seeded — the PRE-EXISTING
  -- platform preference ledger blocks DELETE for every role (its own
  -- append-only trigger), so a tenant with recorded preferences is
  -- deliberately undeletable, exactly like engine attempt history (Phase-4
  -- precedent). The cascade proof therefore uses preference-free lineage;
  -- the candidate is honestly excluded as unknown_preference.
  insert into people (id, tenant_id, display_name, primary_email)
  values ('de1e6000-0000-0000-0000-000000000031','aaaa6000-0000-0000-0000-0000000000f3',
          'C3 Person','c3@x.test');
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value, is_primary)
  values ('aaaa6000-0000-0000-0000-0000000000f3','de1e6000-0000-0000-0000-000000000031',
          'email','c3@x.test','c3@x.test',true);
  insert into marketing_segments (id, tenant_id, name, definition, definition_version, status)
  values ('5e9e6000-0000-0000-0000-000000000031','aaaa6000-0000-0000-0000-0000000000f3',
          'C3','{"field":"search","value":"C3"}',1,'active');
  r := marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f3',
        'bbbb6000-0000-0000-0000-000000000006',
        jsonb_build_object('name','Cascade probe',
          'sender_id', (select id::text from marketing_sender_profiles
                         where tenant_id='aaaa6000-0000-0000-0000-0000000000f3'),
          'segment_id','5e9e6000-0000-0000-0000-000000000031',
          'subject','S','body_authored','B'));
  cid := (r ->> 'id')::uuid;
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f3',
        'bbbb6000-0000-0000-0000-000000000006', cid, 'submit_review', (r ->> 'version')::int);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f3',
        'bbbb6000-0000-0000-0000-000000000006', cid, 'approve', (r ->> 'version')::int);
  conf := marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f3',
        'bbbb6000-0000-0000-0000-000000000006', cid,
        (select version from marketing_campaigns where id = cid),
        'https://unsub.p5.test/functions/v1');
  assert (conf ->> 'candidate_count')::int = 1
     and (conf ->> 'included_count')::int = 0,
    'the preference-free candidate is honestly excluded';
  -- an unsubscribe token participates in the cascade too
  insert into marketing_unsubscribe_tokens
    (tenant_id, token_digest, campaign_id, person_id, destination, expires_at)
  values ('aaaa6000-0000-0000-0000-0000000000f3',
          encode(extensions.digest(repeat('3', 48), 'sha256'), 'hex'), cid,
          'de1e6000-0000-0000-0000-000000000031', 'c3@x.test',
          now() + interval '30 days');
  -- dispatch cascade is the same structural shape: FK on delete cascade with
  -- NO delete-blocking trigger (asserted from the catalog — an included
  -- member would need a preference row, which is undeletable by design)
  assert (select confdeltype from pg_constraint where conname = 'mbd_campaign_fk') = 'c'
     and not exists (select 1 from pg_trigger t
                      where t.tgrelid = 'marketing_broadcast_dispatches'::regclass
                        and not t.tgisinternal
                        and t.tgtype::int & 8 = 8),  -- no user DELETE trigger
    'dispatch rows cascade with the campaign';
  -- pre-execution lineage only (no intents/attempts/preferences) → deletable
  delete from tenants where id = 'aaaa6000-0000-0000-0000-0000000000f3';
  assert not exists (select 1 from marketing_campaigns
                      where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f3')
     and not exists (select 1 from marketing_campaign_revisions
                      where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f3')
     and not exists (select 1 from marketing_audience_members
                      where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f3')
     and not exists (select 1 from marketing_broadcast_dispatches
                      where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f3')
     and not exists (select 1 from marketing_launch_confirmations
                      where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f3')
     and not exists (select 1 from marketing_unsubscribe_tokens
                      where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f3'),
    'tenant cascade cleans every Phase-5 table despite append-only guards';
end $$;

-- ── (13) HEALTH ──────────────────────────────────────────────────────────────
do $$
declare h jsonb;
begin
  h := marketing_broadcast_health('aaaa6000-0000-0000-0000-0000000000f1');
  assert (h -> 'campaigns' ->> 'completed')::int >= 3
     and h ? 'queue_depth' and h ? 'oldest_pending_seconds'
     and h ? 'active_leases' and h ? 'unknown_needing_review'
     and h ? 'in_quiet_hours' and h ? 'sender_health',
    'broadcast health reports real evidence';
end $$;

-- ── (14) ADVERSARIAL HARDENING (independent audit pass) ─────────────────────
-- Each block below reproduces a defect the audit CONFIRMED against the running
-- code, then proves the corrected behaviour. They are regression locks, not
-- restatements of the sections above.

-- (14a) A campaign created BEFORE Phase 5 has no event history. It must be
-- adoptable into the governed lifecycle — previously `revise` succeeded but
-- EVERY subsequent transition failed on the event-chain guard, so the campaign
-- could never be reviewed, approved or launched (a permanent dead end).
do $$
declare skel uuid := gen_random_uuid(); r jsonb; n int; first_ev text;
begin
  insert into marketing_campaigns (id, tenant_id, name, campaign_type, status)
  values (skel, 'aaaa6000-0000-0000-0000-0000000000f1', 'Pre-Phase-5 skeleton', 'broadcast', 'draft');
  assert not exists (select 1 from marketing_campaign_events where campaign_id = skel),
    'the skeleton starts with no recorded history';
  r := marketing_campaign_revise('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', skel,
        jsonb_build_object('sender_id', (select val from p5_ctx where key='sender'),
          'segment_id', '5e9e6000-0000-0000-0000-000000000001',
          'subject', 'Adopted', 'body_authored', 'Adopted body'),
        (select version from marketing_campaigns where id = skel));
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', skel, 'submit_review',
        (select version from marketing_campaigns where id = skel));
  assert r ->> 'status' = 'review', 'an adopted skeleton reaches review';
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', skel, 'approve',
        (select version from marketing_campaigns where id = skel));
  assert r ->> 'status' = 'approved', 'an adopted skeleton can be approved';
  select count(*) into n from marketing_campaign_events where campaign_id = skel;
  select coalesce(from_status, '∅') || '>' || to_status into first_ev
    from marketing_campaign_events where campaign_id = skel order by seq limit 1;
  assert n = 3 and first_ev = '∅>draft',
    'adoption records the initial draft fact and nothing fictional';
  -- the bootstrap route is the ONLY way in: a first revision must carry content
  declare skel2 uuid := gen_random_uuid();
  begin
    insert into marketing_campaigns (id, tenant_id, name, campaign_type, status)
    values (skel2, 'aaaa6000-0000-0000-0000-0000000000f1', 'Skeleton 2', 'broadcast', 'draft');
    begin
      perform marketing_campaign_revise('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', skel2, '{"name":"just a rename"}'::jsonb,
        (select version from marketing_campaigns where id = skel2));
      assert false, 'a revisionless campaign cannot be revised without full content';
    exception when sqlstate '22023' then null;
    end;
  end;
end $$;

-- (14b) A campaign paused BEFORE its scheduled instant must NOT start sending
-- when resumed: resume previously forced 'active' and materialised dispatches
-- immediately, turning pause+resume into an early launch.
do $$
declare cid uuid; r jsonb; conf jsonb; n int; v_future text;
begin
  r := marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002',
        jsonb_build_object('name','Scheduled pause probe',
          'sender_id', (select val from p5_ctx where key='sender'),
          'segment_id','5e9e6000-0000-0000-0000-000000000005',
          'subject','Scheduled','body_authored','Scheduled body'));
  cid := (r ->> 'id')::uuid;
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review', (r ->> 'version')::int);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'approve', (r ->> 'version')::int);
  conf := marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid,
        (select version from marketing_campaigns where id = cid),
        'https://unsub.p5.test/functions/v1');
  v_future := to_char(now() + interval '7 days', 'YYYY-MM-DD') || ' 09:00';
  r := marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid,
        jsonb_build_object('confirmation_id', conf ->> 'confirmation_id',
          'challenge', conf ->> 'challenge', 'request_id', 'req-sched-pause-1',
          'mode', 'scheduled', 'schedule_local', v_future, 'timezone', 'UTC'));
  assert r ->> 'status' = 'scheduled', 'the campaign is scheduled, not active';
  assert (select count(*) from marketing_broadcast_dispatches where campaign_id = cid) = 0,
    'a scheduled campaign materialises no dispatches yet';
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'pause',
        (select version from marketing_campaigns where id = cid));
  assert r ->> 'status' = 'paused', 'a scheduled campaign can be paused';
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'resume',
        (select version from marketing_campaigns where id = cid));
  assert r ->> 'status' = 'scheduled' and (r ->> 'dispatches_created')::int = 0,
    'resuming an unreached schedule returns to SCHEDULED and sends nothing';
  select count(*) into n from marketing_broadcast_dispatches where campaign_id = cid;
  assert n = 0, 'no recipient was dispatched early';
  assert (select schedule_at from marketing_campaigns where id = cid) > now(),
    'the original scheduled instant is preserved';
  -- and the scheduler still activates it when the instant genuinely arrives
  update marketing_campaigns set schedule_at = now() - interval '1 minute' where id = cid;
  perform marketing_broadcast_due(20);
  assert (select status from marketing_campaigns where id = cid) = 'active'
     and (select count(*) from marketing_broadcast_dispatches where campaign_id = cid) = 2,
    'the scheduler activates the resumed campaign at its own time';
  -- a campaign paused AFTER activation still resumes into active dispatch
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'pause',
        (select version from marketing_campaigns where id = cid));
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'resume',
        (select version from marketing_campaigns where id = cid));
  assert r ->> 'status' = 'active', 'an activated campaign still resumes to active';
  perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
    'bbbb6000-0000-0000-0000-000000000001', cid, 'cancel',
    (select version from marketing_campaigns where id = cid));
end $$;

-- (14c) Out-of-sequence transitions are STABLE client errors (22023), not raw
-- trigger exceptions surfacing as INTERNAL 500s at the Edge boundary.
do $$
declare cid uuid; r jsonb;
begin
  r := marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002',
        jsonb_build_object('name','Sequence probe',
          'sender_id', (select val from p5_ctx where key='sender'),
          'segment_id','5e9e6000-0000-0000-0000-000000000002',
          'subject','S','body_authored','B'));
  cid := (r ->> 'id')::uuid;
  begin
    perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid, 'pause',
      (select version from marketing_campaigns where id = cid));
    assert false, 'pausing a draft must be refused';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid, 'archive',
      (select version from marketing_campaigns where id = cid));
    assert false, 'archiving a draft must be refused';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review',
        (select version from marketing_campaigns where id = cid));
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'approve', (r ->> 'version')::int);
  begin
    perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review',
      (select version from marketing_campaigns where id = cid));
    assert false, 'submitting an approved campaign for review must be refused';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- (14d) A revision can never introduce an unvalidated campaign identity —
-- name/description are held to the SAME bounds as create.
do $$
declare cid uuid; r jsonb;
begin
  r := marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002',
        jsonb_build_object('name','Identity probe',
          'sender_id', (select val from p5_ctx where key='sender'),
          'segment_id','5e9e6000-0000-0000-0000-000000000002',
          'subject','S','body_authored','B'));
  cid := (r ->> 'id')::uuid;
  begin
    perform marketing_campaign_revise('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002', cid,
      jsonb_build_object('name', repeat('x', 500)),
      (select version from marketing_campaigns where id = cid));
    assert false, 'an oversized revised name must be rejected';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_campaign_revise('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002', cid,
      jsonb_build_object('name', 'ok' || chr(1) || 'ctrl'),
      (select version from marketing_campaigns where id = cid));
    assert false, 'a control-character revised name must be rejected';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_campaign_revise('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000002', cid,
      jsonb_build_object('description', repeat('d', 900)),
      (select version from marketing_campaigns where id = cid));
    assert false, 'an oversized revised description must be rejected';
  exception when sqlstate '22023' then null;
  end;
  assert (select name from marketing_campaigns where id = cid) = 'Identity probe',
    'a rejected revision changed nothing';
end $$;

-- (14e) DAYLIGHT SAVING is not always a one-hour fold. Lord Howe Island shifts
-- 30 minutes: 2026-04-05 01:45 local occurs TWICE. A ±1-hour probe cannot see
-- that, and would have silently picked one of the two instants.
do $$
begin
  begin
    perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', (select val from p5_ctx where key='campaignA')::uuid,
      jsonb_build_object('confirmation_id', gen_random_uuid(), 'challenge', repeat('a', 48),
        'request_id', 'req-lhi-00001', 'mode', 'scheduled',
        'schedule_local', '2026-04-05 01:45', 'timezone', 'Australia/Lord_Howe'));
    assert false, 'a 30-minute DST fold must demand an explicit fold';
  exception when sqlstate 'MK415' then null;
  end;
  -- with the fold supplied it resolves and moves on (dying on the fake
  -- confirmation, which proves the DST step accepted it)
  begin
    perform marketing_campaign_launch('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', (select val from p5_ctx where key='campaignA')::uuid,
      jsonb_build_object('confirmation_id', gen_random_uuid(), 'challenge', repeat('a', 48),
        'request_id', 'req-lhi-00002', 'mode', 'scheduled',
        'schedule_local', '2027-04-04 01:45', 'timezone', 'Australia/Lord_Howe',
        'fold', 'later'));
    assert false, 'the fake confirmation must not be found';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

-- (14f) AUDIENCE BOUNDARIES: zero, one, exactly the cap and cap+1 candidates.
-- Counts must equal persisted immutable rows at every boundary, and the
-- guardrail refusal must persist nothing.
do $$
declare cid uuid; r jsonb; conf jsonb; n int;
begin
  insert into people (id, tenant_id, display_name, first_name, primary_email) values
    ('de1e6000-0000-0000-0000-000000000041','aaaa6000-0000-0000-0000-0000000000f1','P5BND One','Bo','bnd1@x.test'),
    ('de1e6000-0000-0000-0000-000000000042','aaaa6000-0000-0000-0000-0000000000f1','P5BND Two','Bi','bnd2@x.test');
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value, is_primary) values
    ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000041','email','bnd1@x.test','bnd1@x.test',true),
    ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000042','email','bnd2@x.test','bnd2@x.test',true);
  insert into communication_preferences (tenant_id, person_id, channel, state, source) values
    ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000041','email','subscribed','manual'),
    ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000042','email','subscribed','manual');
  insert into marketing_segments (id, tenant_id, name, definition, definition_version, status) values
    ('5e9e6000-0000-0000-0000-000000000041','aaaa6000-0000-0000-0000-0000000000f1','P5BND-one',
     '{"field":"search","value":"P5BND One"}', 1, 'active'),
    ('5e9e6000-0000-0000-0000-000000000042','aaaa6000-0000-0000-0000-0000000000f1','P5BND-both',
     '{"field":"search","value":"P5BND"}', 1, 'active');

  -- ZERO candidates: an honest empty snapshot, every count zero
  r := marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002',
        jsonb_build_object('name','Boundary zero',
          'sender_id', (select val from p5_ctx where key='sender'),
          'segment_id','5e9e6000-0000-0000-0000-000000000002',
          'subject','S','body_authored','B'));
  cid := (r ->> 'id')::uuid;
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review', (r ->> 'version')::int);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'approve', (r ->> 'version')::int);
  conf := marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid,
        (select version from marketing_campaigns where id = cid),
        'https://unsub.p5.test/functions/v1');
  assert (conf ->> 'candidate_count')::int = 0 and (conf ->> 'included_count')::int = 0
     and (conf ->> 'excluded_count')::int = 0
     and (select count(*) from marketing_audience_members
           where snapshot_id = (conf ->> 'snapshot_id')::uuid) = 0,
    'zero candidates: counts and rows agree at zero';

  -- ONE candidate
  r := marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002',
        jsonb_build_object('name','Boundary one',
          'sender_id', (select val from p5_ctx where key='sender'),
          'segment_id','5e9e6000-0000-0000-0000-000000000041',
          'subject','S','body_authored','B'));
  cid := (r ->> 'id')::uuid;
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review', (r ->> 'version')::int);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'approve', (r ->> 'version')::int);
  conf := marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid,
        (select version from marketing_campaigns where id = cid),
        'https://unsub.p5.test/functions/v1');
  assert (conf ->> 'candidate_count')::int = 1 and (conf ->> 'included_count')::int = 1
     and (select count(*) from marketing_audience_members
           where snapshot_id = (conf ->> 'snapshot_id')::uuid) = 1,
    'one candidate: counts equal the single immutable row';

  -- EXACTLY the cap is allowed; cap+1 is refused and persists NOTHING
  update marketing_settings set max_bulk_recipients = 2
   where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f1';
  r := marketing_campaign_create('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002',
        jsonb_build_object('name','Boundary cap',
          'sender_id', (select val from p5_ctx where key='sender'),
          'segment_id','5e9e6000-0000-0000-0000-000000000042',
          'subject','S','body_authored','B'));
  cid := (r ->> 'id')::uuid;
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000002', cid, 'submit_review', (r ->> 'version')::int);
  r := marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid, 'approve', (r ->> 'version')::int);
  conf := marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
        'bbbb6000-0000-0000-0000-000000000001', cid,
        (select version from marketing_campaigns where id = cid),
        'https://unsub.p5.test/functions/v1');
  assert (conf ->> 'candidate_count')::int = 2
     and (select count(*) from marketing_audience_members
           where snapshot_id = (conf ->> 'snapshot_id')::uuid) = 2,
    'an audience of exactly max_bulk_recipients is allowed and complete';
  select count(*) into n from marketing_audience_snapshots where campaign_id = cid;
  update marketing_settings set max_bulk_recipients = 1
   where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f1';
  begin
    perform marketing_campaign_preflight('aaaa6000-0000-0000-0000-0000000000f1',
      'bbbb6000-0000-0000-0000-000000000001', cid,
      (select version from marketing_campaigns where id = cid),
      'https://unsub.p5.test/functions/v1');
    assert false, 'cap + 1 candidates must be refused';
  exception when sqlstate 'MK413' then null;
  end;
  assert (select count(*) from marketing_audience_snapshots where campaign_id = cid) = n,
    'the refused preflight persisted no snapshot';
  update marketing_settings set max_bulk_recipients = 500
   where tenant_id = 'aaaa6000-0000-0000-0000-0000000000f1';
end $$;

-- (14g) CANCELLATION while a recipient is leased must not leave that recipient
-- reported as 'pending' work that can never happen.
do $$
declare cidG uuid; d record; b jsonb; r jsonb;
begin
  insert into people (id, tenant_id, display_name, first_name, primary_email)
  values ('de1e6000-0000-0000-0000-000000000051','aaaa6000-0000-0000-0000-0000000000f1','P5CAN One','Cy','can1@x.test');
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value, is_primary)
  values ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000051','email','can1@x.test','can1@x.test',true);
  insert into communication_preferences (tenant_id, person_id, channel, state, source)
  values ('aaaa6000-0000-0000-0000-0000000000f1','de1e6000-0000-0000-0000-000000000051','email','subscribed','manual');
  insert into marketing_segments (id, tenant_id, name, definition, definition_version, status)
  values ('5e9e6000-0000-0000-0000-000000000051','aaaa6000-0000-0000-0000-0000000000f1','P5CAN',
          '{"field":"search","value":"P5CAN"}', 1, 'active');
  cidG := pg_temp.p5_launch('Cancel G', '5e9e6000-0000-0000-0000-000000000051');
  select * into d from marketing_broadcast_claim_batch(
    'aaaa6000-0000-0000-0000-0000000000f1', 'wg', 10, 120);
  assert d.status = 'preparing', 'the recipient is leased';
  -- cancel while the worker holds the lease
  perform marketing_campaign_transition('aaaa6000-0000-0000-0000-0000000000f1',
    'bbbb6000-0000-0000-0000-000000000001', cidG, 'cancel',
    (select version from marketing_campaigns where id = cidG));
  b := marketing_broadcast_recipient_bundle('aaaa6000-0000-0000-0000-0000000000f1', d.id, 'wg');
  assert (b ->> 'cancelled')::boolean, 'the leased recipient reports cancellation, not deferral';
  assert (select status from marketing_broadcast_dispatches where id = d.id) = 'cancelled',
    'a cancelled campaign never leaves a recipient falsely pending';
  assert not exists (select 1 from marketing_deliveries where campaign_id = cidG),
    'no delivery was created for the cancelled recipient';
  assert not exists (select 1 from automation_intents
                      where parameters ->> 'campaign_id' = cidG::text),
    'no engine lineage was created for the cancelled recipient';
end $$;

select 'marketing_broadcasts.test.sql: ALL ASSERTIONS PASSED' as result;

rollback;
