-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_templates_reporting_ai.test.sql
--
-- Proves Marketing Phase 7 (migration 20260904120000) end to end with the REAL
-- untouched Automation Engine and STUBBED provider results (no network, no
-- model call, no email):
--   TEMPLATES — authority ceilings, one safe content model through the ONE
--   canonical validator, immutable hash-addressed revisions, version
--   concurrency, duplicate lineage, archive/restore preserving history and
--   usage, exact-revision PINNING into broadcasts and sequence steps (lineage
--   must byte-match; a lineage lie is structurally rejected), pin survival
--   across later template edits, approval invalidation on use, the append-only
--   usage ledger.
--   OBJECTIVES — the ADDITIVE marketing_campaign target kind on the canonical
--   objective_links model with a governed same-tenant validator; link /
--   supersede / unlink with append-only history and request idempotency; the
--   legacy objective_link_ref placeholder is CLOSED; no measurement, health or
--   contribution fact is ever fabricated from marketing activity; honest
--   health/comparability/contribution context.
--   REPORTING — the unified overview COMPOSES the canonical per-type report
--   authorities (jsonb-equal, never re-derived), stable keyset pagination,
--   strict filters, campaign-count totals, cross-tenant zero.
--   AI DRAFTING — provider state honesty (Not configured → MK428), owner/admin
--   structural configuration ceiling (hostile grants inert), the governed
--   generation request (Action + delegated Decision Package + pending intent +
--   frozen brief + fingerprint idempotency + MK429 rate limit), the REAL
--   engine claim → stubbed model output → canonical-validator gate →
--   IMMUTABLE proposal, human revisions, accept-into-draft (template /
--   broadcast / sequence step) that can never approve/launch/send,
--   reject/cancel semantics, and a catalog assertion that NO Phase-7 function
--   is client-reachable.
begin;

create temp table p7_ctx (key text primary key, val text);

insert into tenants (id, slug, display_name, industry) values
  ('aaaa7700-0000-0000-0000-0000000000f1','p7-t1','Phase7 Tenant 1','hvac'),
  ('aaaa7700-0000-0000-0000-0000000000f2','p7-t2','Phase7 Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb7700-0000-0000-0000-000000000001','p7-owner@x.test',false,false),
  ('bbbb7700-0000-0000-0000-000000000002','p7-ops@x.test',false,false),
  ('bbbb7700-0000-0000-0000-000000000003','p7-viewer@x.test',false,false),
  ('bbbb7700-0000-0000-0000-000000000004','p7-admin@x.test',false,false),
  ('bbbb7700-0000-0000-0000-000000000005','p7-admin-b@x.test',false,false);
update profiles set role='owner',  tenant_id='aaaa7700-0000-0000-0000-0000000000f1' where id='bbbb7700-0000-0000-0000-000000000001';
update profiles set role='ops',    tenant_id='aaaa7700-0000-0000-0000-0000000000f1' where id='bbbb7700-0000-0000-0000-000000000002';
update profiles set role='viewer', tenant_id='aaaa7700-0000-0000-0000-0000000000f1' where id='bbbb7700-0000-0000-0000-000000000003';
update profiles set role='admin',  tenant_id='aaaa7700-0000-0000-0000-0000000000f1' where id='bbbb7700-0000-0000-0000-000000000004';
update profiles set role='admin',  tenant_id='aaaa7700-0000-0000-0000-0000000000f2' where id='bbbb7700-0000-0000-0000-000000000005';

select marketing_materialise_defaults('aaaa7700-0000-0000-0000-0000000000f1','bbbb7700-0000-0000-0000-000000000001');
select marketing_materialise_defaults('aaaa7700-0000-0000-0000-0000000000f2','bbbb7700-0000-0000-0000-000000000005');

insert into email_accounts (id, tenant_id, provider, email_address, status, auth_state) values
  ('ee7e7700-0000-0000-0000-0000000000a1','aaaa7700-0000-0000-0000-0000000000f1','gmail','sender@p7-t1.test','active','ok');
insert into email_oauth_tokens (tenant_id, email_account_id, provider, access_token, refresh_token, expires_at, scope) values
  ('aaaa7700-0000-0000-0000-0000000000f1','ee7e7700-0000-0000-0000-0000000000a1','gmail','tok','ref', now() + interval '1 hour',
   'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');
do $$
declare r jsonb;
begin
  r := marketing_sender_create('aaaa7700-0000-0000-0000-0000000000f1','bbbb7700-0000-0000-0000-000000000001',
        '{"source_kind":"gmail_oauth","source_id":"ee7e7700-0000-0000-0000-0000000000a1","label":"P7 sender","from_name":"P7 From"}');
  insert into p7_ctx values ('sender', r ->> 'id');
  perform marketing_sender_set_enabled('aaaa7700-0000-0000-0000-0000000000f1',
    'bbbb7700-0000-0000-0000-000000000001', (r ->> 'id')::uuid, true,
    (select updated_at from marketing_sender_profiles where id = (r ->> 'id')::uuid));
end $$;

insert into marketing_segments (id, tenant_id, name, definition, definition_version, status) values
  ('5e77e700-0000-0000-0000-000000000001','aaaa7700-0000-0000-0000-0000000000f1','P7A audience',
   '{"field":"search","value":"P7A"}', 1, 'active');

-- objectives fixture: a published ACTIVE objective + a draft one + tenant-B
insert into config_versions (id, tenant_id, artifact_kind, artifact_key, version, status) values
  ('c0f7e700-0000-0000-0000-000000000001','aaaa7700-0000-0000-0000-0000000000f1','objective','p7-obj-a',1,'published'),
  ('c0f7e700-0000-0000-0000-000000000002','aaaa7700-0000-0000-0000-0000000000f1','objective','p7-obj-d',1,'draft'),
  ('c0f7e700-0000-0000-0000-000000000003','aaaa7700-0000-0000-0000-0000000000f2','objective','p7-obj-b',1,'published');
insert into objectives (id, tenant_id, objective_type, title, status, version_id,
                        published_by, published_role, stale_after_hours) values
  ('0b7e7700-0000-0000-0000-000000000001','aaaa7700-0000-0000-0000-0000000000f1',
   'quarterly_priority','Win 20 boiler-service contracts','active',
   'c0f7e700-0000-0000-0000-000000000001','p7 operator','tenant_owner', 168),
  ('0b7e7700-0000-0000-0000-000000000002','aaaa7700-0000-0000-0000-0000000000f1',
   'operational_target','A draft objective','draft',
   'c0f7e700-0000-0000-0000-000000000002',null,null, 168),
  ('0b7e7700-0000-0000-0000-000000000003','aaaa7700-0000-0000-0000-0000000000f2',
   'quarterly_priority','Tenant-B objective','active',
   'c0f7e700-0000-0000-0000-000000000003','p7 operator b','tenant_owner', 168);
insert into metric_definitions (id, tenant_id, key, name, unit, direction) values
  ('3e7e7700-0000-0000-0000-000000000001','aaaa7700-0000-0000-0000-0000000000f1',
   'p7_contracts','Service contracts won','contracts','increase');
insert into objective_metrics (tenant_id, objective_id, metric_id, role, direction,
                               baseline_value, baseline_unit, target_value, target_unit) values
  ('aaaa7700-0000-0000-0000-0000000000f1','0b7e7700-0000-0000-0000-000000000001',
   '3e7e7700-0000-0000-0000-000000000001','primary','increase', 0,'contracts',20,'contracts');

-- ── (1) TEMPLATES: authority + one safe content model ───────────────────────
do $$
declare r jsonb; t uuid; rev uuid;
begin
  -- viewer cannot create
  begin
    perform marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000003',
      '{"name":"X","subject":"S","body_authored":"B"}');
    assert false, 'a viewer must be denied template creation';
  exception when sqlstate '42501' then null;
  end;
  -- cross-tenant actor rejected structurally
  begin
    perform marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000005', '{}'::jsonb);
    assert false, 'a cross-tenant actor must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- content is judged by the ONE canonical validator
  begin
    perform marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      '{"name":"Bad","subject":"S","body_authored":"Hi {{nickname}}","request_id":"p7-neg-create-1"}');
    assert false, 'an unknown personalisation token must be rejected';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      jsonb_build_object('name','Bad2','subject','S',
                         'body_authored','click [here](javascript:alert(1))',
                         'request_id','p7-neg-create-2'));
    assert false, 'a non-http link scheme must be rejected as malformed';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      '{"name":"Bad3","subject":"S","body_authored":"B","token_fallbacks":{"nickname":"pal"},"request_id":"p7-neg-create-3"}');
    assert false, 'a fallback for an unknown token must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- a MISSING request id refuses before any write
  begin
    perform marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      '{"name":"NoKey","subject":"S","body_authored":"B"}');
    assert false, 'a template mutation without a request id must be refused';
  exception when sqlstate '22023' then null;
  end;
  -- a MALFORMED request id refuses (too short / bad chars)
  begin
    perform marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      '{"name":"BadKey","subject":"S","body_authored":"B","request_id":"x!"}');
    assert false, 'a malformed request id must be refused';
  exception when sqlstate '22023' then null;
  end;
  -- ops CAN create a valid template
  r := marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('name','Service reminder','description','Annual service nudge',
          'subject','Time for your service, {{first_name}}',
          'preview_text','A quick reminder',
          'body_authored','Hi {{first_name}},' || E'\n\n' ||
            'Your annual service is due. [Book now](https://example.com/book)',
          'token_fallbacks', jsonb_build_object('first_name','there'),
          'request_id','p7-idem-create-A1'));
  t := (r ->> 'id')::uuid;
  insert into p7_ctx values ('tplA', t::text);
  insert into p7_ctx values ('tplA_rev1', r ->> 'revision_id');
  assert (r ->> 'revision')::int = 1 and (r ->> 'version')::int = 1
     and (r ->> 'status') = 'active', 'template born active with revision 1';
  -- deterministic content hash
  assert (select content_hash from marketing_template_revisions
           where id = (r ->> 'revision_id')::uuid)
       = marketing_template_revision_hash(
           'Time for your service, {{first_name}}', 'A quick reminder',
           'Hi {{first_name}},' || E'\n\n' ||
             'Your annual service is due. [Book now](https://example.com/book)',
           array['first_name'], '{"first_name":"there"}'::jsonb),
    'the stored content hash equals its canonical recomputation';
  -- tokens derived by the validator
  assert (select tokens_required from marketing_template_revisions
           where id = (r ->> 'revision_id')::uuid) = array['first_name'],
    'tokens_required derives from the canonical validator';
end $$;

-- ── (2) TEMPLATE revisions: immutability, concurrency, overlay, duplicate ───
do $$
declare r jsonb; t uuid; rev1 uuid; rev2 uuid; dup uuid;
begin
  t := (select val from p7_ctx where key='tplA')::uuid;
  rev1 := (select val from p7_ctx where key='tplA_rev1')::uuid;
  -- history is append-only for every caller including the service role
  begin
    update marketing_template_revisions set subject = 'tampered' where id = rev1;
    assert false, 'template revisions must be immutable';
  exception when raise_exception then null; when insufficient_privilege then null;
  end;
  assert not has_table_privilege('service_role', 'marketing_template_revisions', 'update')
     and not has_table_privilege('service_role', 'marketing_template_revisions', 'delete'),
    'revision rewrite/delete privileges are revoked even for the service role';
  -- stale version → MK409, nothing written (fresh id: the ledger is consulted
  -- first, so only a NEW request reaches the optimistic-concurrency gate)
  begin
    perform marketing_template_revise('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', t,
      '{"subject":"New","request_id":"p7-idem-rv-stale"}', 99);
    assert false, 'a stale template version must conflict';
  exception when sqlstate 'MK409' then null;
  end;
  assert (select count(*) from marketing_template_revisions where template_id = t) = 1,
    'a conflicted revise writes nothing';
  -- overlay revise: only the subject changes; body/fallbacks inherited
  r := marketing_template_revise('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', t,
        '{"subject":"Your boiler service is due, {{first_name}}","request_id":"p7-idem-rv-A1"}', 1);
  rev2 := (r ->> 'revision_id')::uuid;
  insert into p7_ctx values ('tplA_rev2', rev2::text);
  assert (r ->> 'revision')::int = 2 and (r ->> 'version')::int = 2,
    'revising creates revision 2 and bumps the concurrency token';
  assert (select body_authored from marketing_template_revisions where id = rev2)
       = (select body_authored from marketing_template_revisions where id = rev1),
    'unchanged fields inherit from the previous revision';
  assert (select subject from marketing_template_revisions where id = rev1)
       = 'Time for your service, {{first_name}}',
    'the earlier revision is untouched — old revisions stay readable and attributable';
  -- duplicate copies the CURRENT revision with lineage
  r := marketing_template_duplicate('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', t,
        '{"request_id":"p7-idem-dup-A1"}'::jsonb);
  dup := (r ->> 'id')::uuid;
  insert into p7_ctx values ('tplDup', dup::text);
  assert (r ->> 'name') = 'Copy of Service reminder', 'duplicate names default safely';
  assert (select source from marketing_template_revisions
           where template_id = dup and revision_number = 1) = 'duplicate'
     and (select source_template_revision_id from marketing_template_revisions
           where template_id = dup and revision_number = 1) = rev2,
    'the duplicate records its source revision lineage';
end $$;

-- ── (3) USE IN BROADCAST: exact-revision pinning + approval invalidation ────
do $$
declare r jsonb; t uuid; rev2 uuid; cid uuid; v int; n_usage int;
begin
  t := (select val from p7_ctx where key='tplA')::uuid;
  rev2 := (select val from p7_ctx where key='tplA_rev2')::uuid;
  -- viewer denied
  begin
    perform marketing_template_use_in_broadcast('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000003',
      jsonb_build_object('template_revision_id', rev2, 'mode', 'new'));
    assert false, 'a viewer must be denied use_in_broadcast';
  exception when sqlstate '42501' then null;
  end;
  -- new broadcast draft from the pinned revision
  r := marketing_template_use_in_broadcast('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('template_revision_id', rev2, 'mode', 'new',
          'name', 'Reminder broadcast',
          'sender_id', (select val from p7_ctx where key='sender'),
          'segment_id', '5e77e700-0000-0000-0000-000000000001',
          'request_id', 'p7-idem-useb-A1'));
  cid := (r ->> 'id')::uuid;
  insert into p7_ctx values ('campA', cid::text);
  assert (r ->> 'template_revision_id')::uuid = rev2, 'the pin names the exact revision';
  assert (select source from marketing_campaign_revisions
           where campaign_id = cid and revision_number = 1) = 'template'
     and (select source_template_revision_id from marketing_campaign_revisions
           where campaign_id = cid and revision_number = 1) = rev2,
    'the campaign revision records template lineage';
  assert (select subject from marketing_campaign_revisions
           where campaign_id = cid and revision_number = 1)
       = (select subject from marketing_template_revisions where id = rev2),
    'the campaign content IS the pinned revision content';
  -- the usage ledger row was written in the same transaction as the pin
  select count(*) into n_usage from marketing_template_usages
   where template_id = t and template_revision_id = rev2
     and used_in = 'broadcast' and campaign_id = cid;
  assert n_usage = 1, 'exactly one usage-ledger row records the pin';
  -- the ledger is append-only
  begin
    delete from marketing_template_usages where campaign_id = cid;
    assert false, 'usage history must be append-only';
  exception when raise_exception then null; when insufficient_privilege then null;
  end;

  -- LINEAGE CANNOT LIE: a direct service-role insert claiming lineage with
  -- DIFFERENT content is structurally rejected
  begin
    insert into marketing_campaign_revisions
      (tenant_id, campaign_id, revision_number, sender_profile_id, segment_id,
       segment_version, subject, body_authored, tokens_required, token_fallbacks,
       content_hash, source, source_template_revision_id, created_by)
    values ('aaaa7700-0000-0000-0000-0000000000f1', cid, 99,
            (select val from p7_ctx where key='sender')::uuid,
            '5e77e700-0000-0000-0000-000000000001', 1,
            'NOT the template subject', 'different body', '{}', '{}'::jsonb,
            repeat('0', 64), 'template', rev2, 'bbbb7700-0000-0000-0000-000000000002');
    assert false, 'a lineage claim with edited content must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- the lineage-shape constraint refuses source=template with no pin
  begin
    insert into marketing_campaign_revisions
      (tenant_id, campaign_id, revision_number, sender_profile_id, segment_id,
       segment_version, subject, body_authored, tokens_required, token_fallbacks,
       content_hash, source, created_by)
    values ('aaaa7700-0000-0000-0000-0000000000f1', cid, 99,
            (select val from p7_ctx where key='sender')::uuid,
            '5e77e700-0000-0000-0000-000000000001', 1,
            'S', 'B', '{}', '{}'::jsonb, repeat('0', 64), 'template',
            'bbbb7700-0000-0000-0000-000000000002');
    assert false, 'source=template requires its lineage column';
  exception when check_violation then null;
  end;

  -- approve the campaign, then replace content from a template revision:
  -- the approval is structurally invalidated (new revision + draft status)
  select version into v from marketing_campaigns where id = cid;
  r := marketing_campaign_transition('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', cid, 'submit_review', v);
  r := marketing_campaign_transition('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000001', cid, 'approve', (r ->> 'version')::int);
  assert r ->> 'status' = 'approved', 'the campaign reached approved';
  r := marketing_template_use_in_broadcast('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('template_revision_id',
          (select val from p7_ctx where key='tplA_rev1'), 'mode', 'existing',
          'campaign_id', cid, 'expected_version',
          (select version from marketing_campaigns where id = cid),
          'request_id', 'p7-idem-useb-A2'));
  assert (select status from marketing_campaigns where id = cid) = 'draft',
    'replacing draft content invalidates approval — the campaign returns to draft';
  assert (select current_revision_id from marketing_campaigns where id = cid)
       <> (select id from marketing_campaign_revisions
            where campaign_id = cid and revision_number = 1),
    'the campaign now points at the new pinned revision';

  -- PIN SURVIVAL: a later template edit never changes pinned campaign content
  perform marketing_template_revise('aaaa7700-0000-0000-0000-0000000000f1',
    'bbbb7700-0000-0000-0000-000000000002', t,
    '{"subject":"Completely new subject","request_id":"p7-idem-rv-A2"}',
    (select version from marketing_templates where id = t));
  assert (select subject from marketing_campaign_revisions
           where campaign_id = cid
           order by revision_number desc limit 1)
       = (select subject from marketing_template_revisions
           where id = (select val from p7_ctx where key='tplA_rev1')::uuid),
    'editing the template afterwards never changes the pinned campaign revision';
end $$;

-- ── (4) USE IN SEQUENCE STEP: lineage through the validated step config ─────
do $$
declare r jsonb; sid uuid; rev1 uuid;
begin
  rev1 := (select val from p7_ctx where key='tplA_rev1')::uuid;
  r := marketing_sequence_create('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('name','P7 journey',
          'sender_id',(select val from p7_ctx where key='sender'),
          'steps', jsonb_build_array(
            jsonb_build_object('key','s1','type','send_email','config',
              jsonb_build_object('subject','Step one','body_authored','Original body')))));
  sid := (r ->> 'id')::uuid;
  insert into p7_ctx values ('seqA', sid::text);
  -- replace s1 with the pinned template revision
  r := marketing_template_use_in_sequence_step('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('template_revision_id', rev1, 'campaign_id', sid,
          'step_key', 's1',
          'expected_version', (select version from marketing_campaigns where id = sid),
          'request_id', 'p7-idem-useq-A1'));
  assert (r ->> 'template_revision_id')::uuid = rev1, 'sequence use pins the exact revision';
  assert (select config ->> 'source_template_revision_id'
            from marketing_sequence_steps
           where campaign_id = sid and step_key = 's1'
             and revision_id = (select current_sequence_revision_id
                                  from marketing_campaigns where id = sid)) = rev1::text,
    'the step config carries the validated lineage key';
  assert (select config ->> 'subject' from marketing_sequence_steps
           where campaign_id = sid and step_key = 's1'
             and revision_id = (select current_sequence_revision_id
                                  from marketing_campaigns where id = sid))
       = (select subject from marketing_template_revisions where id = rev1),
    'the step content IS the pinned revision content';
  assert (select count(*) from marketing_template_usages
           where template_revision_id = rev1 and used_in = 'sequence_step'
             and campaign_id = sid) = 1,
    'the sequence pin wrote its usage-ledger row';
  -- validate_step rejects a lineage lie
  begin
    perform marketing_sequence_validate_step('aaaa7700-0000-0000-0000-0000000000f1',
      'send_email', jsonb_build_object('subject','Edited away',
        'body_authored','Different', 'source_template_revision_id', rev1::text));
    assert false, 'a sequence-step lineage claim with edited content must be rejected';
  exception when sqlstate '22023' then null;
  end;

  -- STRUCTURAL row-boundary defence (the campaign-revision parity guard):
  -- even a DIRECT service-role insert cannot record a sequence-step lineage
  -- lie — and therefore cannot mint a false usage-ledger fact through the
  -- AFTER-insert usage recorder
  declare seqrev uuid; tpl uuid; usage_n int; sid2 uuid;
  begin
    sid2 := (select val from p7_ctx where key='seqA')::uuid;
    select current_sequence_revision_id into seqrev
      from marketing_campaigns where id = sid2;
    select template_id into tpl from marketing_template_revisions where id = rev1;
    select count(*) into usage_n from marketing_template_usages where template_id = tpl;
    begin
      insert into marketing_sequence_steps
        (tenant_id, revision_id, campaign_id, step_order, step_key, step_type,
         config, config_hash, summary)
      values ('aaaa7700-0000-0000-0000-0000000000f1', seqrev, sid2, 97, 'forgedtpl',
              'send_email',
              jsonb_build_object('subject','FORGED — not the template content',
                                 'body_authored','FORGED body',
                                 'token_fallbacks','{}'::jsonb,
                                 'source_template_revision_id', rev1::text),
              marketing_sequence_step_hash('send_email', '{}'::jsonb), 'forged');
      assert false, 'a direct forged TEMPLATE lineage step insert must be refused';
    exception when sqlstate '22023' then null;
    end;
    begin
      insert into marketing_sequence_steps
        (tenant_id, revision_id, campaign_id, step_order, step_key, step_type,
         config, config_hash, summary)
      values ('aaaa7700-0000-0000-0000-0000000000f1', seqrev, sid2, 98, 'forgedai',
              'send_email',
              jsonb_build_object('subject','FORGED AI content',
                                 'body_authored','FORGED body',
                                 'token_fallbacks','{}'::jsonb,
                                 'source_ai_proposal_id', gen_random_uuid()::text),
              marketing_sequence_step_hash('send_email', '{}'::jsonb), 'forged');
      assert false, 'a direct forged AI lineage step insert must be refused';
    exception when sqlstate 'P0002' then null; when sqlstate '22023' then null;
    end;
    begin
      insert into marketing_sequence_steps
        (tenant_id, revision_id, campaign_id, step_order, step_key, step_type,
         config, config_hash, summary)
      values ('aaaa7700-0000-0000-0000-0000000000f1', seqrev, sid2, 96, 'forgedwait',
              'wait_duration',
              jsonb_build_object('unit','days','amount',1,
                                 'source_template_revision_id', rev1::text),
              marketing_sequence_step_hash('wait_duration', '{}'::jsonb), 'forged');
      assert false, 'a non-email step must refuse content lineage';
    exception when sqlstate '22023' then null;
    end;
    assert (select count(*) from marketing_template_usages where template_id = tpl)
         = usage_n,
      'no forged insert minted a usage-ledger row';
  end;
end $$;

-- ── (5) ARCHIVE: preserved history + usage; archived cannot be selected ─────
do $$
declare r jsonb; t uuid; rev1 uuid; usage_before int;
begin
  t := (select val from p7_ctx where key='tplA')::uuid;
  rev1 := (select val from p7_ctx where key='tplA_rev1')::uuid;
  select count(*) into usage_before from marketing_template_usages where template_id = t;
  r := marketing_template_set_status('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', t,
        '{"status":"archived","request_id":"p7-idem-arch-A1"}',
        (select version from marketing_templates where id = t));
  assert (r ->> 'status') = 'archived', 'template archived';
  assert (select count(*) from marketing_template_revisions where template_id = t) >= 3
     and (select count(*) from marketing_template_usages where template_id = t) = usage_before,
    'archive preserves every revision and every usage row';
  -- an archived template cannot be selected for NEW content
  begin
    perform marketing_template_use_in_broadcast('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      jsonb_build_object('template_revision_id', rev1, 'mode', 'new',
        'name', 'Should fail',
        'sender_id', (select val from p7_ctx where key='sender'),
        'segment_id', '5e77e700-0000-0000-0000-000000000001',
        'request_id', 'p7-neg-useb-arch'));
    assert false, 'an archived template must not be selectable for new content';
  exception when sqlstate '22023' then null;
  end;
  -- existing campaigns that pinned it remain valid (their revisions unchanged)
  assert (select count(*) from marketing_campaign_revisions
           where source_template_revision_id in
                 (select id from marketing_template_revisions where template_id = t)) >= 1,
    'existing pinned campaign revisions survive the archive';
  -- archived templates cannot be revised; restore reopens them
  begin
    perform marketing_template_revise('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', t,
      '{"subject":"Nope","request_id":"p7-neg-rv-arch"}',
      (select version from marketing_templates where id = t));
    assert false, 'an archived template must refuse revision';
  exception when sqlstate '22023' then null;
  end;
  -- archived templates cannot be DUPLICATED either — an active copy would
  -- launder the archive gate ("archived cannot be selected for new content")
  begin
    perform marketing_template_duplicate('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', t, '{"request_id":"p7-neg-dup-arch"}');
    assert false, 'an archived template must refuse duplication';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_template_set_status('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', t,
        '{"status":"active","request_id":"p7-idem-rest-A1"}',
        (select version from marketing_templates where id = t));
  assert (r ->> 'status') = 'active'
     and (select archived_at from marketing_templates where id = t) is null,
    'restore reactivates and clears the archive facts';
end $$;

-- ── (6) OBJECTIVES: governed link / supersede / unlink + honest context ─────
do $$
declare r jsonb; cid uuid; v int; link1 uuid; link2 uuid;
        n_meas int; n_health int; n_assess int;
begin
  cid := (select val from p7_ctx where key='campA')::uuid;
  select version into v from marketing_campaigns where id = cid;

  -- the legacy placeholder is CLOSED
  begin
    update marketing_campaigns set objective_link_ref = 'sneaky' where id = cid;
    assert false, 'objective_link_ref must reject new writes';
  exception when sqlstate '22023' then null;
  end;

  -- the target-kind registry accepted marketing_campaign, but the validator
  -- gates it: bad ref shape / missing campaign / wrong relation all die
  begin
    insert into objective_links (tenant_id, objective_id, target_kind, target_ref, relation)
    values ('aaaa7700-0000-0000-0000-0000000000f1','0b7e7700-0000-0000-0000-000000000001',
            'marketing_campaign','not-a-uuid','supports');
    assert false, 'a non-uuid campaign target_ref must be rejected';
  exception when sqlstate '22023' then null;
  end;
  begin
    insert into objective_links (tenant_id, objective_id, target_kind, target_ref, relation)
    values ('aaaa7700-0000-0000-0000-0000000000f1','0b7e7700-0000-0000-0000-000000000001',
            'marketing_campaign', gen_random_uuid()::text,'supports');
    assert false, 'a missing campaign must be rejected';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into objective_links (tenant_id, objective_id, target_kind, target_ref, relation)
    values ('aaaa7700-0000-0000-0000-0000000000f1','0b7e7700-0000-0000-0000-000000000001',
            'marketing_campaign', cid::text,'blocks');
    assert false, 'a campaign link relation outside supports|contributes_to must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- other target kinds keep their existing behaviour (no new validation)
  insert into objective_links (tenant_id, objective_id, target_kind, target_ref, relation)
  values ('aaaa7700-0000-0000-0000-0000000000f1','0b7e7700-0000-0000-0000-000000000001',
          'intelligence_object','free-text-ref','supports');

  -- ops cannot link (launch ceiling)
  begin
    perform marketing_campaign_objective_link('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', cid,
      jsonb_build_object('objective_id','0b7e7700-0000-0000-0000-000000000001',
                         'request_id','p7-link-ops-1'), v);
    assert false, 'ops must be denied objective linking';
  exception when sqlstate '42501' then null;
  end;
  -- cross-tenant objective rejected
  begin
    perform marketing_campaign_objective_link('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000001', cid,
      jsonb_build_object('objective_id','0b7e7700-0000-0000-0000-000000000003',
                         'request_id','p7-link-xt-1'), v);
    assert false, 'a tenant-B objective must be rejected';
  exception when sqlstate 'P0002' then null;
  end;
  -- inactive objective rejected
  begin
    perform marketing_campaign_objective_link('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000001', cid,
      jsonb_build_object('objective_id','0b7e7700-0000-0000-0000-000000000002',
                         'request_id','p7-link-dr-1'), v);
    assert false, 'a draft objective must be rejected';
  exception when sqlstate '22023' then null;
  end;

  select count(*) into n_meas from measurements;
  select count(*) into n_health from objective_health;
  select count(*) into n_assess from objective_contribution_assessments;

  -- owner links; the link is INTENT with approved_link verification
  r := marketing_campaign_objective_link('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000001', cid,
        jsonb_build_object('objective_id','0b7e7700-0000-0000-0000-000000000001',
          'relation','supports',
          'expected_contribution','Reactivate lapsed customers toward service contracts',
          'rationale','Campaign targets exactly the lapsed-service audience',
          'request_id','p7-link-ok-1'), v);
  link1 := (r ->> 'objective_link_id')::uuid;
  assert (select objective_link_id from marketing_campaigns where id = cid) = link1,
    'the campaign points at the canonical objective_links row';
  assert (select approved from objective_links where id = link1) = true
     and (select verification_state from objective_links where id = link1) = 'approved_link'
     and (select contribution_state from objective_links where id = link1) = 'proposed'
     and (select target_kind from objective_links where id = link1) = 'marketing_campaign'
     and (select target_ref from objective_links where id = link1) = cid::text,
    'the link is recorded through the canonical controlled vocabulary';
  assert (select count(*) from marketing_campaign_objective_history
           where campaign_id = cid and action = 'linked') = 1,
    'the linked act is in the append-only history';

  -- IDEMPOTENCY: byte-identical replay converges; changed reuse conflicts
  r := marketing_campaign_objective_link('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000001', cid,
        jsonb_build_object('objective_id','0b7e7700-0000-0000-0000-000000000001',
          'relation','supports',
          'expected_contribution','Reactivate lapsed customers toward service contracts',
          'rationale','Campaign targets exactly the lapsed-service audience',
          'request_id','p7-link-ok-1'), v);
  assert (r ->> 'objective_link_id')::uuid = link1, 'an identical replay converges';
  begin
    perform marketing_campaign_objective_link('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000001', cid,
      jsonb_build_object('objective_id','0b7e7700-0000-0000-0000-000000000001',
        'relation','contributes_to','request_id','p7-link-ok-1'),
      (select version from marketing_campaigns where id = cid));
    assert false, 'a reused request id with different input must conflict';
  exception when sqlstate 'MK412' then null;
  end;
  -- the fingerprint binds the CAMPAIGN VERSION: the same payload replayed
  -- against a DIFFERENT version is a different logical request → MK412
  -- (only the byte-identical replay — same expected_version — converges)
  begin
    perform marketing_campaign_objective_link('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000001', cid,
      jsonb_build_object('objective_id','0b7e7700-0000-0000-0000-000000000001',
        'relation','supports',
        'expected_contribution','Reactivate lapsed customers toward service contracts',
        'rationale','Campaign targets exactly the lapsed-service audience',
        'request_id','p7-link-ok-1'),
      (select version from marketing_campaigns where id = cid));
    assert false, 'request-id reuse against a DIFFERENT campaign version must conflict';
  exception when sqlstate 'MK412' then null;
  end;

  -- SUPERSEDE: relation change creates a NEW link; the old one deactivates
  -- without rewriting history
  r := marketing_campaign_objective_link('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000001', cid,
        jsonb_build_object('objective_id','0b7e7700-0000-0000-0000-000000000001',
          'relation','contributes_to','request_id','p7-link-ok-2'),
        (select version from marketing_campaigns where id = cid));
  link2 := (r ->> 'objective_link_id')::uuid;
  assert link2 <> link1, 'supersession creates a new canonical link row';
  assert (select approved from objective_links where id = link1) = false,
    'the superseded link is deactivated (approved=false), never deleted';
  assert (select count(*) from objective_links where id = link1) = 1,
    'the superseded row itself is preserved';
  assert (select count(*) from marketing_campaign_objective_history
           where campaign_id = cid and action = 'superseded') = 1,
    'the supersession is in the append-only history';
  -- history is append-only
  begin
    delete from marketing_campaign_objective_history where campaign_id = cid;
    assert false, 'objective history must be append-only';
  exception when raise_exception then null; when insufficient_privilege then null;
  end;

  -- NOTHING was fabricated into the Objective engine
  assert (select count(*) from measurements) = n_meas,
    'linking a campaign inserts NO measurement';
  assert (select count(*) from objective_health) = n_health,
    'linking a campaign writes NO health snapshot';
  assert (select count(*) from objective_contribution_assessments) = n_assess,
    'linking a campaign creates NO contribution assessment';

  -- HONEST CONTEXT: never-evaluated health; no verified contribution;
  -- comparable metric only when a measurement exists
  r := marketing_campaign_objective_context('aaaa7700-0000-0000-0000-0000000000f1', cid);
  assert (r ->> 'linked')::boolean and r -> 'health' = 'null'::jsonb
     and r ->> 'health_state' = 'never_evaluated',
    'missing health reads never_evaluated, not healthy';
  assert r -> 'contribution' ->> 'state' is null
     and r -> 'contribution' ->> 'note' like 'No verified contribution evidence%',
    'absent contribution evidence is stated explicitly';
  assert r -> 'primary_metric' ->> 'comparability' = 'no_measurement',
    'a metric without measurements is honestly not comparable';
  -- add a measurement in a MISMATCHED unit → unknown with the exact reason
  insert into measurements (tenant_id, metric_id, value, unit, measured_at)
  values ('aaaa7700-0000-0000-0000-0000000000f1','3e7e7700-0000-0000-0000-000000000001',
          5, 'jobs', now());
  r := marketing_campaign_objective_context('aaaa7700-0000-0000-0000-0000000000f1', cid);
  assert r -> 'primary_metric' ->> 'comparability' = 'unit_mismatch'
     and r -> 'primary_metric' -> 'current' = 'null'::jsonb,
    'unlike units are never compared — unknown with a reason, never a false value';
  -- a comparable measurement reads through
  insert into measurements (tenant_id, metric_id, value, unit, measured_at)
  values ('aaaa7700-0000-0000-0000-0000000000f1','3e7e7700-0000-0000-0000-000000000001',
          7, 'contracts', now() + interval '1 second');
  r := marketing_campaign_objective_context('aaaa7700-0000-0000-0000-0000000000f1', cid);
  assert r -> 'primary_metric' ->> 'comparability' = 'comparable'
     and (r -> 'primary_metric' ->> 'current')::numeric = 7,
    'a genuinely comparable measurement is shown factually';

  -- UNLINK: pointer clears; evidence survives
  r := marketing_campaign_objective_unlink('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000001', cid,
        '{"rationale":"Campaign repurposed"}',
        (select version from marketing_campaigns where id = cid));
  assert (select objective_link_id from marketing_campaigns where id = cid) is null,
    'unlink clears the current pointer';
  assert (select count(*) from objective_links where id in (link1, link2)) = 2,
    'both historical link rows survive unlink';
  assert (select count(*) from marketing_campaign_objective_history
           where campaign_id = cid) = 4,
    'linked + replay-free supersede pair + unlinked are all recorded';
  r := marketing_campaign_objective_context('aaaa7700-0000-0000-0000-0000000000f1', cid);
  assert (r ->> 'linked')::boolean = false and (r ->> 'history_count')::int = 4,
    'context reports the unlinked state with preserved history';

  -- re-link for the reporting section
  perform marketing_campaign_objective_link('aaaa7700-0000-0000-0000-0000000000f1',
    'bbbb7700-0000-0000-0000-000000000001', cid,
    jsonb_build_object('objective_id','0b7e7700-0000-0000-0000-000000000001',
      'relation','supports','request_id','p7-link-ok-3'),
    (select version from marketing_campaigns where id = cid));

  -- objective search is bounded + active-only
  r := marketing_objective_search('aaaa7700-0000-0000-0000-0000000000f1',
        '{"search":"boiler"}');
  assert jsonb_array_length(r -> 'objectives') = 1
     and r -> 'objectives' -> 0 ->> 'id' = '0b7e7700-0000-0000-0000-000000000001',
    'search finds the active objective and never the draft or tenant-B one';
end $$;

-- ── (7) REPORTING: canonical composition, filters, pagination, totals ───────
do $$
declare r jsonb; cid uuid; sid uuid; row0 jsonb; canonical jsonb; cur jsonb;
        page1 jsonb; page2 jsonb;
begin
  cid := (select val from p7_ctx where key='campA')::uuid;
  sid := (select val from p7_ctx where key='seqA')::uuid;

  r := marketing_reporting_overview('aaaa7700-0000-0000-0000-0000000000f1', '{}'::jsonb);
  assert (r -> 'totals' ->> 'campaigns')::int = 2, 'both campaigns are in the overview';
  assert (r -> 'totals' -> 'by_type' ->> 'broadcast')::int = 1
     and (r -> 'totals' -> 'by_type' ->> 'sequence')::int = 1,
    'totals count by type over the same filtered population';

  -- COMPOSITION, not re-derivation: the embedded report is jsonb-EQUAL to the
  -- canonical per-type authority
  select x into row0 from jsonb_array_elements(r -> 'campaigns') x
   where x ->> 'id' = cid::text;
  canonical := marketing_campaign_report('aaaa7700-0000-0000-0000-0000000000f1', cid);
  assert row0 -> 'report' = canonical,
    'the overview row report IS the canonical broadcast report, byte-for-byte';
  select x into row0 from jsonb_array_elements(r -> 'campaigns') x
   where x ->> 'id' = sid::text;
  canonical := marketing_sequence_report('aaaa7700-0000-0000-0000-0000000000f1', sid);
  assert row0 -> 'report' = canonical,
    'the overview row report IS the canonical sequence report, byte-for-byte';
  assert row0 -> 'report' -> 'delivered' = 'null'::jsonb,
    'unavailable metrics stay null through composition — never zero';

  -- objective filter
  r := marketing_reporting_overview('aaaa7700-0000-0000-0000-0000000000f1',
        jsonb_build_object('objective_id','0b7e7700-0000-0000-0000-000000000001'));
  assert (r -> 'totals' ->> 'campaigns')::int = 1
     and r -> 'campaigns' -> 0 ->> 'id' = cid::text,
    'the objective filter selects exactly the linked campaign';
  -- type + status + date filters validate strictly
  begin
    perform marketing_reporting_overview('aaaa7700-0000-0000-0000-0000000000f1',
      '{"campaign_type":"ads"}');
    assert false, 'an invalid campaign_type filter must be rejected';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_reporting_overview('aaaa7700-0000-0000-0000-0000000000f1',
      '{"created_from":"not-a-date"}');
    assert false, 'an invalid date filter must be rejected';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_reporting_overview('aaaa7700-0000-0000-0000-0000000000f1',
        jsonb_build_object('created_to', (now() - interval '1 day')::text));
  assert (r -> 'totals' ->> 'campaigns')::int = 0,
    'date filters act on factual created_at timestamps';

  -- STABLE PAGINATION: page 1 (limit 1) + page 2 never overlap, no phantom page
  page1 := marketing_reporting_overview('aaaa7700-0000-0000-0000-0000000000f1',
            '{"limit":1}');
  assert jsonb_array_length(page1 -> 'campaigns') = 1
     and page1 -> 'next_cursor' is not null
     and page1 -> 'next_cursor' <> 'null'::jsonb,
    'page 1 carries a continuation cursor';
  page2 := marketing_reporting_overview('aaaa7700-0000-0000-0000-0000000000f1',
            jsonb_build_object('limit', 1, 'cursor', page1 -> 'next_cursor'));
  assert jsonb_array_length(page2 -> 'campaigns') = 1
     and page2 -> 'campaigns' -> 0 ->> 'id' <> page1 -> 'campaigns' -> 0 ->> 'id',
    'page 2 is disjoint from page 1';
  assert (page2 -> 'next_cursor' is null or page2 -> 'next_cursor' = 'null'::jsonb)
      or jsonb_array_length((marketing_reporting_overview(
            'aaaa7700-0000-0000-0000-0000000000f1',
            jsonb_build_object('limit', 1, 'cursor', page2 -> 'next_cursor'))) -> 'campaigns') = 0,
    'no phantom third page';
  begin
    perform marketing_reporting_overview('aaaa7700-0000-0000-0000-0000000000f1',
      '{"cursor":{"at":"x"}}');
    assert false, 'a malformed cursor must be rejected';
  exception when sqlstate '22023' then null;
  end;

  -- cross-tenant: tenant B sees NOTHING of tenant A
  r := marketing_reporting_overview('aaaa7700-0000-0000-0000-0000000000f2', '{}'::jsonb);
  assert (r -> 'totals' ->> 'campaigns')::int = 0, 'tenant B reads zero tenant-A campaigns';
  begin
    perform marketing_reporting_campaign('aaaa7700-0000-0000-0000-0000000000f2', cid);
    assert false, 'a tenant-B read of a tenant-A campaign must be NOT_FOUND';
  exception when sqlstate 'P0002' then null;
  end;

  -- the per-campaign composition carries the objective context + lineage
  r := marketing_reporting_campaign('aaaa7700-0000-0000-0000-0000000000f1', cid);
  assert (r -> 'objective_context' ->> 'linked')::boolean, 'objective context rides the report';
  assert (r ->> 'version')::int = (select version from marketing_campaigns where id = cid),
    'the composition carries the campaign concurrency token';
end $$;

-- ── (8) AI DRAFTING: configuration honesty + structural ceilings ────────────
do $$
declare r jsonb; secret_ref uuid;
begin
  -- unconfigured is stated, never faked
  r := marketing_ai_provider_state('aaaa7700-0000-0000-0000-0000000000f1');
  assert (r ->> 'configured')::boolean = false
     and (r ->> 'connector_exists')::boolean = false,
    'the provider state is honestly unconfigured';
  -- generation without configuration is MK428
  begin
    perform marketing_ai_generation_request('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      jsonb_build_object('destination_kind','template',
        'campaign_objective','O','offer','F','audience','A','call_to_action','C',
        'request_id','p7-gen-unconf'));
    assert false, 'generation without a provider must be CONFIG_REQUIRED';
  exception when sqlstate 'MK428' then null;
  end;

  -- ops cannot configure, even with a HOSTILE marketing.ai.manage grant
  begin
    perform marketing_ai_configure('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', '{"model":"gpt-4o-mini"}');
    assert false, 'ops must be denied provider configuration';
  exception when sqlstate '42501' then null;
  end;
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa7700-0000-0000-0000-0000000000f1','bbbb7700-0000-0000-0000-000000000002',
          'marketing.ai.manage', true, 'bbbb7700-0000-0000-0000-000000000001');
  begin
    perform marketing_ai_configure('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', '{"model":"gpt-4o-mini"}');
    assert false, 'a hostile grant must not bypass the owner/admin structural ceiling';
  exception when sqlstate '42501' then null;
  end;
  delete from marketing_access_grants
   where profile_id = 'bbbb7700-0000-0000-0000-000000000002'
     and permission = 'marketing.ai.manage';

  -- owner configures: Vault-brokered secret reference + model + enablement
  secret_ref := provider_secret_store('aaaa7700-0000-0000-0000-0000000000f1',
                  'openai', 'api_key', 'p7-test-key-never-real');
  r := marketing_ai_configure('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000001',
        jsonb_build_object('model','gpt-4o-mini','secret_ref', secret_ref, 'enabled', true));
  assert (r ->> 'configured')::boolean and (r ->> 'model') = 'gpt-4o-mini'
     and (r ->> 'secret_ref_present')::boolean and (r ->> 'capability_enabled')::boolean,
    'the provider state derives from connector + capability + credential reference';
  assert (select enabled from tenant_connector_capabilities
           where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1'
             and connector_id = 'openai'
             and capability_key = 'ai.generate_marketing_draft'),
    'tenant enablement lives in the canonical capability registry the engine enforces';
  -- the state NEVER carries the secret value
  assert position('p7-test-key-never-real' in r::text) = 0,
    'no secret material ever appears in provider state';
end $$;

-- ── (9) AI generation request: frozen brief, idempotency, rate limit ────────
do $$
declare r jsonb; req uuid; i uuid; n_before int;
begin
  -- unknown key rejected
  begin
    perform marketing_ai_generation_request('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      '{"destination_kind":"template","campaign_objective":"O","offer":"F","audience":"A","call_to_action":"C","request_id":"p7-gen-x1","recipient_list":"no"}');
    assert false, 'an undeclared generation argument must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- bounds enforced
  begin
    perform marketing_ai_generation_request('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      jsonb_build_object('destination_kind','template',
        'campaign_objective', repeat('x', 501), 'offer','F','audience','A',
        'call_to_action','C','request_id','p7-gen-x2'));
    assert false, 'an oversized brief field must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- viewer denied
  begin
    perform marketing_ai_generation_request('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000003',
      jsonb_build_object('destination_kind','template','campaign_objective','O',
        'offer','F','audience','A','call_to_action','C','request_id','p7-gen-x3'));
    assert false, 'a viewer must be denied generation';
  exception when sqlstate '42501' then null;
  end;

  -- a valid request freezes the brief into Action + Decision + pending intent
  r := marketing_ai_generation_request('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('destination_kind','template',
          'campaign_objective','Win back lapsed service customers',
          'offer','Annual boiler service plan',
          'audience','Customers with no service in 18 months',
          'why_care','A serviced boiler fails less in winter',
          'objection','They think it is expensive',
          'tone','Warm, plain, no hype',
          'call_to_action','Book a service visit',
          'objective_id','0b7e7700-0000-0000-0000-000000000001',
          'request_id','p7-gen-ok-1'));
  req := (r ->> 'ai_request_id')::uuid;
  i := (r ->> 'intent_id')::uuid;
  insert into p7_ctx values ('aiReq', req::text);
  insert into p7_ctx values ('aiIntent', i::text);
  assert (select status from automation_intents where id = i) = 'pending'
     and (select intent_type from automation_intents where id = i) = 'generate_marketing_draft'
     and (select capability_key from automation_intents where id = i) = 'ai.generate_marketing_draft'
     and (select connector_id from automation_intents where id = i) = 'openai',
    'a pending governed intent exists on the registered capability';
  assert (select parameters ->> 'campaign_objective' from automation_intents where id = i)
       = 'Win back lapsed service customers'
     and (select parameters ->> 'prompt_version' from automation_intents where id = i)
       = 'marketing-draft@1'
     and (select parameters ->> 'objective_title' from automation_intents where id = i)
       = 'Win 20 boiler-service contracts',
    'the brief and prompt version are FROZEN on the immutable intent';
  assert (select approved_payload_hash from automation_intents where id = i) is not null,
    'the authorised envelope hash is pinned';
  -- the delegated decision fabricates NO approval
  assert (select count(*) from automation_approvals where automation_intent_id = i) = 0,
    'no approval row exists or is fabricated for a delegated draft generation';
  assert (select decision_package -> 'routing' ->> 'tenantReviewRequired'
            from decision_log where id = (select decision_id from automation_intents where id = i))
       = 'false',
    'the decision package honestly records delegated (non-review) authority';

  -- the request record is immutable except its close facts
  begin
    update marketing_ai_requests set campaign_objective = 'tampered' where id = req;
    assert false, 'the frozen brief must be immutable';
  exception when restrict_violation then null;
  end;

  -- byte-identical replay converges; changed reuse conflicts
  r := marketing_ai_generation_request('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('destination_kind','template',
          'campaign_objective','Win back lapsed service customers',
          'offer','Annual boiler service plan',
          'audience','Customers with no service in 18 months',
          'why_care','A serviced boiler fails less in winter',
          'objection','They think it is expensive',
          'tone','Warm, plain, no hype',
          'call_to_action','Book a service visit',
          'objective_id','0b7e7700-0000-0000-0000-000000000001',
          'request_id','p7-gen-ok-1'));
  assert (r ->> 'ai_request_id')::uuid = req and (r ->> 'idempotent')::boolean,
    'an identical replay converges on the stored request';
  begin
    perform marketing_ai_generation_request('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      jsonb_build_object('destination_kind','template',
        'campaign_objective','A DIFFERENT objective',
        'offer','Annual boiler service plan',
        'audience','Customers with no service in 18 months',
        'call_to_action','Book a service visit',
        'request_id','p7-gen-ok-1'));
    assert false, 'a reused request id with different input must conflict';
  exception when sqlstate 'MK412' then null;
  end;

  -- rate limit: two more requests are fine, the fourth in a minute is MK429
  perform marketing_ai_generation_request('aaaa7700-0000-0000-0000-0000000000f1',
    'bbbb7700-0000-0000-0000-000000000002',
    jsonb_build_object('destination_kind','broadcast','campaign_objective','O2',
      'offer','F','audience','A','call_to_action','C','request_id','p7-gen-ok-2'));
  perform marketing_ai_generation_request('aaaa7700-0000-0000-0000-0000000000f1',
    'bbbb7700-0000-0000-0000-000000000002',
    jsonb_build_object('destination_kind','sequence_step','campaign_objective','O3',
      'offer','F','audience','A','call_to_action','C','request_id','p7-gen-ok-3'));
  begin
    perform marketing_ai_generation_request('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      jsonb_build_object('destination_kind','template','campaign_objective','O4',
        'offer','F','audience','A','call_to_action','C','request_id','p7-gen-ok-4'));
    assert false, 'the per-tenant generation rate limit must hold';
  exception when sqlstate 'MK429' then null;
  end;

  -- derived status is queued (pending intent, no proposal)
  r := marketing_ai_request_status('aaaa7700-0000-0000-0000-0000000000f1', req);
  assert r ->> 'status' = 'queued', 'a pending intent reads as queued';
end $$;

-- ── (10) AI engine E2E: claim → stubbed model output → immutable proposal ───
do $$
declare r jsonb; req uuid; i uuid; claim record; fin record; prop uuid; corr uuid;
begin
  req := (select val from p7_ctx where key='aiReq')::uuid;
  i := (select val from p7_ctx where key='aiIntent')::uuid;
  select correlation_id into corr from automation_intents where id = i;

  -- the REAL engine claim (no network anywhere in this suite)
  select * into claim from automation_claim_and_start(
    i, 'aaaa7700-0000-0000-0000-0000000000f1', 'p7-test-worker', 120,
    'idem-p7-' || i, corr, 'generate');
  assert claim.attempt_id is not null
     and claim.capability_key = 'ai.generate_marketing_draft'
     and claim.intent_type = 'generate_marketing_draft'
     and claim.adapter_version = '1'
     and claim.envelope_parameters ->> 'campaign_objective' = 'Win back lapsed service customers',
    'the claimed envelope is the frozen brief on the registered contract';

  -- the recorder REFUSES model output the canonical validator rejects
  begin
    perform marketing_ai_record_proposal('aaaa7700-0000-0000-0000-0000000000f1', i,
      jsonb_build_object('provider','openai','model','gpt-4o-mini',
        'subject','S','body_authored','Hello {{nickname}}'));
    assert false, 'invalid model output must never become a proposal';
  exception when sqlstate '22023' then null;
  end;
  assert (select count(*) from marketing_ai_proposals where automation_intent_id = i) = 0,
    'the refused output persisted nothing';
  -- undeclared payload keys are refused
  begin
    perform marketing_ai_record_proposal('aaaa7700-0000-0000-0000-0000000000f1', i,
      jsonb_build_object('provider','openai','model','m','subject','S',
        'body_authored','B','send_now', true));
    assert false, 'an undeclared proposal field must be refused';
  exception when sqlstate '22023' then null;
  end;

  -- valid stubbed output → ONE immutable proposal with full provenance
  r := marketing_ai_record_proposal('aaaa7700-0000-0000-0000-0000000000f1', i,
        jsonb_build_object('provider','openai','model','gpt-4o-mini-2026',
          'subject','Your boiler deserves a check-up, {{first_name}}',
          'preview_text','Winter-ready in one visit',
          'body_authored','Hi {{first_name}},' || E'\n\n' ||
            'It has been a while since your last service. ' ||
            '[Book a visit](https://example.com/book) and beat the winter rush.',
          'token_fallbacks', jsonb_build_object('first_name','there'),
          'prompt_tokens', 412, 'completion_tokens', 128, 'finish_reason','stop'));
  prop := (r ->> 'proposal_id')::uuid;
  insert into p7_ctx values ('aiProp', prop::text);
  assert (r ->> 'idempotent')::boolean = false, 'first record is not a replay';
  -- idempotent convergence on retry
  r := marketing_ai_record_proposal('aaaa7700-0000-0000-0000-0000000000f1', i,
        '{"provider":"openai","model":"different","subject":"ignored","body_authored":"ignored"}');
  assert (r ->> 'proposal_id')::uuid = prop and (r ->> 'idempotent')::boolean,
    'a repeat record converges on the ONE proposal per intent';
  assert (select model from marketing_ai_proposals where id = prop) = 'gpt-4o-mini-2026'
     and (select prompt_version from marketing_ai_proposals where id = prop) = 'marketing-draft@1'
     and (select prompt_tokens from marketing_ai_proposals where id = prop) = 412,
    'model, prompt-version and token provenance are preserved';
  -- the ORIGINAL output is immutable forever
  begin
    update marketing_ai_proposals set body_authored = 'tampered' where id = prop;
    assert false, 'the original AI output must be immutable';
  exception when raise_exception then null; when insufficient_privilege then null;
  end;

  -- finalize through the REAL engine with the stubbed result
  select * into fin from automation_finalize_execution(
    'aaaa7700-0000-0000-0000-0000000000f1', i, claim.attempt_id, 'p7-test-worker',
    'succeeded',
    jsonb_build_object('proposal_id', prop, 'provider', 'openai',
                       'model', 'gpt-4o-mini-2026'),
    null, 'succeeded', false, null, prop::text, '2xx',
    'marketing_ai_draft_recorded', 'operational', corr, null);
  assert fin.execution_attempt_id is not null and fin.outcome_id is not null,
    'the engine recorded the immutable attempt + operational outcome';
  assert (select status from automation_intents where id = i) = 'succeeded', 'intent succeeded';
  r := marketing_ai_request_status('aaaa7700-0000-0000-0000-0000000000f1', req);
  assert r ->> 'status' = 'succeeded' and (r ->> 'proposal_id')::uuid = prop,
    'the derived request status reads succeeded from engine facts';
end $$;

-- ── (11) AI human revisions + accept-into-draft (never approve/launch) ──────
do $$
declare r jsonb; prop uuid; revn uuid; t uuid; cid uuid; sid uuid; v int;
begin
  prop := (select val from p7_ctx where key='aiProp')::uuid;

  -- human revision: validated, numbered, attributable; original untouched
  begin
    perform marketing_ai_revise('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', prop,
      '{"body_authored":"Now with {{bad_token}}"}');
    assert false, 'a human revision is judged by the same canonical validator';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_ai_revise('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', prop,
        jsonb_build_object('subject','A friendlier check-up reminder, {{first_name}}',
          'change_note','Softened the subject'));
  revn := (r ->> 'revision_id')::uuid;
  insert into p7_ctx values ('aiRev', revn::text);
  assert (r ->> 'revision')::int = 1, 'revision 1 recorded';
  assert (select subject from marketing_ai_proposals where id = prop)
       = 'Your boiler deserves a check-up, {{first_name}}',
    'the immutable original still carries its own subject';
  assert (select editor_profile_id from marketing_ai_revisions where id = revn)
       = 'bbbb7700-0000-0000-0000-000000000002',
    'the human editor is preserved';

  -- ACCEPT into a NEW template: draft only, AI lineage recorded
  r := marketing_ai_accept('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('proposal_id', prop, 'revision_id', revn,
          'destination_kind','template','template_name','AI check-up reminder',
          'request_id','p7-acc-1'));
  t := (r ->> 'id')::uuid;
  assert (select source from marketing_template_revisions
           where template_id = t and revision_number = 1) = 'ai_draft'
     and (select source_ai_proposal_id from marketing_template_revisions
           where template_id = t and revision_number = 1) = prop,
    'the template revision carries visible AI-origin provenance';
  assert (select subject from marketing_template_revisions
           where template_id = t and revision_number = 1)
       = 'A friendlier check-up reminder, {{first_name}}',
    'acceptance used the chosen human revision';
  -- replay converges; changed reuse conflicts
  assert (marketing_ai_accept('aaaa7700-0000-0000-0000-0000000000f1',
           'bbbb7700-0000-0000-0000-000000000002',
           jsonb_build_object('proposal_id', prop, 'revision_id', revn,
             'destination_kind','template','template_name','AI check-up reminder',
             'request_id','p7-acc-1')) ->> 'id')::uuid = t,
    'an identical accept replay converges without a second template';
  assert (select count(*) from marketing_templates
           where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1'
             and name = 'AI check-up reminder') = 1,
    'the accept replay persisted exactly ONE template';
  -- the internal template mutation ran under a DERIVED, NAMESPACED child
  -- request key (server-side only — accept''s own allowlist can never carry
  -- a template request id from the browser)
  assert exists (select 1 from marketing_request_keys
                  where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1'
                    and action = 'template_create'
                    and idempotency_key = md5('template_create:'
                          || substr(md5('ai-accept-child:p7-acc-1'), 1, 32))::uuid),
    'the child template mutation is ledgered under the derived namespaced key';
  -- a browser-path create reusing the child key VALUE can never fingerprint-
  -- match the child (the Edge create allowlist cannot carry AI lineage), so
  -- it conflicts — internal child keys are unreachable from outside
  begin
    perform marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      jsonb_build_object('name','AI check-up reminder',
        'subject','A friendlier check-up reminder, {{first_name}}',
        'body_authored','Whatever the browser guesses',
        'request_id', substr(md5('ai-accept-child:p7-acc-1'), 1, 32)));
    assert false, 'a browser reuse of the derived child key must conflict, never converge onto the child result';
  exception when sqlstate 'MK412' then null;
  end;
  begin
    perform marketing_ai_accept('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      jsonb_build_object('proposal_id', prop, 'destination_kind','template',
        'template_name','Different name','request_id','p7-acc-1'));
    assert false, 'a reused accept request id with different input must conflict';
  exception when sqlstate 'MK412' then null;
  end;

  -- ACCEPT into the EXISTING broadcast: draft only; approval invalidated
  cid := (select val from p7_ctx where key='campA')::uuid;
  select version into v from marketing_campaigns where id = cid;
  r := marketing_campaign_transition('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', cid, 'submit_review', v);
  r := marketing_campaign_transition('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000001', cid, 'approve', (r ->> 'version')::int);
  assert r ->> 'status' = 'approved', 'campaign re-approved for the acceptance test';
  r := marketing_ai_accept('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('proposal_id', prop, 'destination_kind','broadcast',
          'campaign_id', cid,
          'expected_version', (select version from marketing_campaigns where id = cid),
          'request_id','p7-acc-2'));
  assert (select status from marketing_campaigns where id = cid) = 'draft',
    'acceptance wrote a DRAFT and invalidated the prior approval — it can never approve';
  assert (select source from marketing_campaign_revisions
           where campaign_id = cid order by revision_number desc limit 1) = 'ai_draft'
     and (select source_ai_proposal_id from marketing_campaign_revisions
           where campaign_id = cid order by revision_number desc limit 1) = prop,
    'the broadcast draft carries AI lineage (the ORIGINAL, since no revision was named)';
  assert (select subject from marketing_campaign_revisions
           where campaign_id = cid order by revision_number desc limit 1)
       = 'Your boiler deserves a check-up, {{first_name}}',
    'accepting without naming a revision uses the immutable original';

  -- ACCEPT into a sequence step (append)
  sid := (select val from p7_ctx where key='seqA')::uuid;
  r := marketing_ai_accept('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('proposal_id', prop, 'revision_id', revn,
          'destination_kind','sequence_step','campaign_id', sid,
          'expected_version', (select version from marketing_campaigns where id = sid),
          'append_step', true, 'request_id','p7-acc-3'));
  assert (select count(*) from marketing_sequence_steps
           where campaign_id = sid
             and revision_id = (select current_sequence_revision_id
                                  from marketing_campaigns where id = sid)
             and config ->> 'source_ai_proposal_id' = prop::text) = 1,
    'the appended sequence step carries validated AI lineage';
  assert (select status from marketing_campaigns where id = sid) = 'draft',
    'the sequence returned to draft for re-approval — acceptance launches nothing';

  -- destination version conflict is a stable MK409
  begin
    perform marketing_ai_accept('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      jsonb_build_object('proposal_id', prop, 'destination_kind','broadcast',
        'campaign_id', cid, 'expected_version', 99, 'request_id','p7-acc-4'));
    assert false, 'a stale destination version must conflict';
  exception when sqlstate 'MK409' then null;
  end;
end $$;

-- ── (12) AI reject / cancel semantics ───────────────────────────────────────
do $$
declare r jsonb; req2 uuid; i2 uuid; claim record; req uuid;
begin
  req := (select val from p7_ctx where key='aiReq')::uuid;
  -- reject closes the request; the proposal survives as evidence
  r := marketing_ai_reject('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', req, '{"reason":"tone missed"}');
  assert r ->> 'closed_reason' = 'rejected', 'the request closed as rejected';
  assert (select count(*) from marketing_ai_proposals
           where id = (select val from p7_ctx where key='aiProp')::uuid) = 1,
    'the rejected proposal remains historical evidence';
  begin
    perform marketing_ai_reject('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', req, '{}'::jsonb);
    assert false, 'closing is write-once';
  exception when sqlstate '22023' then null;
  end;

  -- cancel BEFORE execution: the pending intent moves through the legal
  -- transition and the request closes; nothing external ever ran
  select id, automation_intent_id into req2, i2 from marketing_ai_requests
   where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1' and request_id = 'p7-gen-ok-2';
  r := marketing_ai_cancel('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', req2);
  assert (r ->> 'intent_cancelled')::boolean
     and (select status from automation_intents where id = i2) = 'cancelled',
    'cancellation before execution cancels the pending intent legally';
  r := marketing_ai_request_status('aaaa7700-0000-0000-0000-0000000000f1', req2);
  assert r ->> 'status' = 'cancelled', 'the derived status reads cancelled';

  -- cancel AFTER a claim is refused — the factual result path is preserved
  select id, automation_intent_id into req2, i2 from marketing_ai_requests
   where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1' and request_id = 'p7-gen-ok-3';
  select * into claim from automation_claim_and_start(
    i2, 'aaaa7700-0000-0000-0000-0000000000f1', 'p7-test-worker', 120,
    'idem-p7-' || i2, (select correlation_id from automation_intents where id = i2),
    'generate');
  begin
    perform marketing_ai_cancel('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', req2);
    assert false, 'an executing generation can no longer be cancelled';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ── (13) cross-tenant + RLS + catalog grant lock ────────────────────────────
do $$
declare fn text; r jsonb;
begin
  -- tenant B cannot read tenant-A template/AI objects through the RPC surface
  begin
    perform marketing_template_detail('aaaa7700-0000-0000-0000-0000000000f2',
      (select val from p7_ctx where key='tplA')::uuid);
    assert false, 'a tenant-B template detail read must be NOT_FOUND';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform marketing_ai_proposal_detail('aaaa7700-0000-0000-0000-0000000000f2',
      (select val from p7_ctx where key='aiProp')::uuid);
    assert false, 'a tenant-B proposal read must be NOT_FOUND';
  exception when sqlstate 'P0002' then null;
  end;
  -- cross-tenant template lineage is structurally impossible
  begin
    insert into marketing_template_usages
      (tenant_id, template_id, template_revision_id, used_in, campaign_id,
       campaign_revision_id)
    values ('aaaa7700-0000-0000-0000-0000000000f2',
            (select val from p7_ctx where key='tplA')::uuid,
            (select val from p7_ctx where key='tplA_rev1')::uuid,
            'broadcast', (select val from p7_ctx where key='campA')::uuid,
            gen_random_uuid());
    assert false, 'cross-tenant usage lineage is structurally impossible';
  exception when foreign_key_violation then null;
  end;

  -- every Phase-7 table has RLS enabled with a marketing.view-gated SELECT
  perform 1 from pg_class c
   where c.relname in ('marketing_templates','marketing_template_revisions',
                       'marketing_template_usages','marketing_campaign_objective_history',
                       'marketing_ai_requests','marketing_ai_proposals','marketing_ai_revisions')
     and not c.relrowsecurity;
  if found then
    raise exception 'FAIL: a Phase-7 table is missing row level security';
  end if;

  -- EVERY Phase-7 function is service-role only — enumerated from the CATALOG
  -- against the COMPLETE expected set. The exact-set comparison fails loudly
  -- in BOTH directions: an expected function missing from the catalog, or a
  -- catalog match the list forgot (so a new/renamed Phase-7 function can
  -- never silently escape this lock — the earlier pattern-only enumeration
  -- missed marketing_campaign_revision_lineage_guard).
  declare
    expected text[] := array[
      'marketing_template_guard','marketing_template_revision_hash',
      'marketing_template_usage_record','marketing_campaign_revision_lineage_guard',
      'marketing_sequence_step_lineage_guard',
      'marketing_template_lineage_check','marketing_ai_lineage_check',
      'marketing_template_request_gate',
      'marketing_template_create','marketing_template_revise',
      'marketing_template_duplicate','marketing_template_set_status',
      'marketing_template_list','marketing_template_detail',
      'marketing_template_use_in_broadcast','marketing_template_use_in_sequence_step',
      'objective_links_marketing_campaign_guard','marketing_campaigns_objective_ref_guard',
      'marketing_campaign_objective_link','marketing_campaign_objective_unlink',
      'marketing_objective_search','marketing_campaign_objective_context',
      'marketing_reporting_overview','marketing_reporting_campaign',
      'marketing_ai_request_guard','marketing_ai_provider_state',
      'marketing_ai_configure','marketing_ai_generation_request',
      'marketing_ai_record_proposal','marketing_ai_request_status',
      'marketing_ai_request_list','marketing_ai_proposal_detail',
      'marketing_ai_revise','marketing_ai_accept','marketing_ai_reject',
      'marketing_ai_cancel'];
    found_set text[];
    missing text[];
    extra text[];
  begin
    select coalesce(array_agg(distinct p.proname order by p.proname), '{}')
      into found_set
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'marketing\_template\_%'
            or p.proname like 'marketing\_ai\_%'
            or p.proname like 'marketing\_reporting\_%'
            or p.proname like 'marketing\_campaign\_objective\_%'
            or p.proname = 'marketing_campaign_revision_lineage_guard'
            or p.proname = 'marketing_sequence_step_lineage_guard'
            or p.proname = 'marketing_objective_search'
            or p.proname = 'objective_links_marketing_campaign_guard'
            or p.proname = 'marketing_campaigns_objective_ref_guard');
    select coalesce(array_agg(e), '{}') into missing
      from unnest(expected) e where e <> all (found_set);
    select coalesce(array_agg(f), '{}') into extra
      from unnest(found_set) f where f <> all (expected);
    if array_length(missing, 1) is not null then
      raise exception 'FAIL: expected Phase-7 function(s) missing from the catalog: %', missing;
    end if;
    if array_length(extra, 1) is not null then
      raise exception 'FAIL: catalog function(s) not in the Phase-7 lock list (extend the list + Part H): %', extra;
    end if;
    foreach fn in array expected loop
      if exists (
        select 1 from information_schema.routine_privileges rp
         where rp.routine_name = fn and rp.grantee in ('anon', 'authenticated', 'PUBLIC')
           and rp.privilege_type = 'EXECUTE') then
        raise exception 'FAIL: Phase-7 function % is executable by a client role', fn;
      end if;
    end loop;

    -- no Phase-7 function is SECURITY DEFINER (no new search_path exposure)
    perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname = any (expected);
    if found then
      raise exception 'FAIL: a Phase-7 function is unexpectedly SECURITY DEFINER';
    end if;
  end;
end $$;

-- ── (5b) REQUEST-ID IDEMPOTENCY: every template mutation replays exactly ────
-- Proves PERSISTED COUNTS, not response shapes: an exact replay converges on
-- the byte-identical original result with zero new rows in templates,
-- revisions, usages, campaign/sequence revisions, steps, audit or events;
-- changed reuse (payload, version or ACTOR) of the same id is MK412.
do $$
declare
  r jsonb; r2 jsonb; t uuid; c uuid; s uuid;
  n_tpl int; n_rev int; n_use int; n_camp int; n_camprev int;
  n_seqrev int; n_steps int; n_audit int; n_events int;
  args jsonb;
begin
  -- ══ CREATE ══
  args := jsonb_build_object('name','Idem tpl','subject','S1 {{first_name}}',
            'body_authored','Idem body {{first_name}}',
            'token_fallbacks', jsonb_build_object('first_name','there'),
            'request_id','p7-idem-battery-c1');
  r := marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', args);
  t := (r ->> 'id')::uuid;
  select count(*) into n_tpl from marketing_templates
   where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1';
  select count(*) into n_audit from audit_logs
   where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1'
     and action = 'marketing.template.created';
  select count(*) into n_events from platform_events
   where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1'
     and event_type = 'marketing.template.created';
  r2 := marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
         'bbbb7700-0000-0000-0000-000000000002', args);
  assert r2 = r, 'create replay returns the byte-identical original result';
  assert (select count(*) from marketing_templates
           where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1') = n_tpl,
    'create replay mints NO second template';
  assert (select count(*) from audit_logs
           where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1'
             and action = 'marketing.template.created') = n_audit,
    'create replay writes NO second audit row';
  assert (select count(*) from platform_events
           where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1'
             and event_type = 'marketing.template.created') = n_events,
    'create replay appends NO second event';
  -- changed payload, same id → MK412
  begin
    perform marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      args || jsonb_build_object('name','Different name'));
    assert false, 'changed-payload reuse of a create request id must conflict';
  exception when sqlstate 'MK412' then null;
  end;
  -- DIFFERENT ACTOR, same id + payload → MK412 (the fingerprint binds the
  -- genuine actor: one actor can never receive another actor's result)
  begin
    perform marketing_template_create('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000001', args);
    assert false, 'another actor reusing the request id must conflict';
  exception when sqlstate 'MK412' then null;
  end;

  -- ══ REVISE ══ (replay returns the ORIGINAL revision even after the
  -- template advanced past it — the ledger is consulted before the 409 gate)
  args := jsonb_build_object('subject','Idem revised {{first_name}}',
                             'request_id','p7-idem-battery-r1');
  r := marketing_template_revise('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', t, args, 1);
  perform marketing_template_revise('aaaa7700-0000-0000-0000-0000000000f1',
    'bbbb7700-0000-0000-0000-000000000002', t,
    '{"subject":"Advanced past it","request_id":"p7-idem-battery-r2"}', 2);
  select count(*) into n_rev from marketing_template_revisions where template_id = t;
  r2 := marketing_template_revise('aaaa7700-0000-0000-0000-0000000000f1',
         'bbbb7700-0000-0000-0000-000000000002', t, args, 1);
  assert r2 = r, 'revise replay returns the ORIGINALLY created revision result';
  assert (r2 ->> 'revision')::int = 2 and (r2 ->> 'version')::int = 2,
    'the replayed result is the original, not a re-execution at the new version';
  assert (select count(*) from marketing_template_revisions where template_id = t) = n_rev,
    'revise replay writes NO new revision';
  -- same id, DIFFERENT expected_version → MK412 (version is fingerprinted)
  begin
    perform marketing_template_revise('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', t, args, 3);
    assert false, 'changed-version reuse of a revise request id must conflict';
  exception when sqlstate 'MK412' then null;
  end;
  -- same id, different changes → MK412
  begin
    perform marketing_template_revise('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', t,
      jsonb_build_object('subject','Sneaky change','request_id','p7-idem-battery-r1'), 1);
    assert false, 'changed-payload reuse of a revise request id must conflict';
  exception when sqlstate 'MK412' then null;
  end;

  -- ══ DUPLICATE ══
  args := '{"request_id":"p7-idem-battery-d1"}'::jsonb;
  r := marketing_template_duplicate('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', t, args);
  select count(*) into n_tpl from marketing_templates
   where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1';
  r2 := marketing_template_duplicate('aaaa7700-0000-0000-0000-0000000000f1',
         'bbbb7700-0000-0000-0000-000000000002', t, args);
  assert r2 = r, 'duplicate replay returns the SAME duplicate';
  assert (select count(*) from marketing_templates
           where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1') = n_tpl,
    'duplicate replay mints NO second copy';
  begin
    perform marketing_template_duplicate('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', t,
      '{"name":"Other copy","request_id":"p7-idem-battery-d1"}');
    assert false, 'changed-payload reuse of a duplicate request id must conflict';
  exception when sqlstate 'MK412' then null;
  end;

  -- ══ ARCHIVE / RESTORE ══ (replay returns the original success even though
  -- a fresh identical call would now refuse as already-archived)
  args := '{"status":"archived","request_id":"p7-idem-battery-a1"}'::jsonb;
  r := marketing_template_set_status('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', t, args, 3);
  r2 := marketing_template_set_status('aaaa7700-0000-0000-0000-0000000000f1',
         'bbbb7700-0000-0000-0000-000000000002', t, args, 3);
  assert r2 = r, 'archive replay returns the original successful result';
  begin
    perform marketing_template_set_status('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002', t,
      '{"status":"active","request_id":"p7-idem-battery-a1"}', 3);
    assert false, 'changed-status reuse of a set_status request id must conflict';
  exception when sqlstate 'MK412' then null;
  end;
  r := marketing_template_set_status('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', t,
        '{"status":"active","request_id":"p7-idem-battery-a2"}', 4);
  r2 := marketing_template_set_status('aaaa7700-0000-0000-0000-0000000000f1',
         'bbbb7700-0000-0000-0000-000000000002', t,
         '{"status":"active","request_id":"p7-idem-battery-a2"}', 4);
  assert r2 = r, 'restore replay returns the original successful result';

  -- ══ USE IN BROADCAST (mode new) ══
  args := jsonb_build_object(
    'template_revision_id',
    (select current_revision_id from marketing_templates where id = t),
    'mode', 'new', 'name', 'Idem broadcast',
    'sender_id', (select val from p7_ctx where key='sender'),
    'segment_id', '5e77e700-0000-0000-0000-000000000001',
    'request_id', 'p7-idem-battery-u1');
  select count(*) into n_camp from marketing_campaigns
   where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1';
  select count(*) into n_camprev from marketing_campaign_revisions
   where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1';
  select count(*) into n_use from marketing_template_usages where template_id = t;
  r := marketing_template_use_in_broadcast('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', args);
  r2 := marketing_template_use_in_broadcast('aaaa7700-0000-0000-0000-0000000000f1',
         'bbbb7700-0000-0000-0000-000000000002', args);
  assert r2 = r, 'broadcast-use replay returns the original composed result';
  assert (select count(*) from marketing_campaigns
           where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1') = n_camp + 1
     and (select count(*) from marketing_campaign_revisions
           where tenant_id = 'aaaa7700-0000-0000-0000-0000000000f1') = n_camprev + 1
     and (select count(*) from marketing_template_usages where template_id = t)
       = n_use + 1,
    'broadcast-use replay creates NO second campaign, revision or usage row';
  begin
    perform marketing_template_use_in_broadcast('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      args || jsonb_build_object('name','Other broadcast'));
    assert false, 'changed-payload reuse of a use_in_broadcast id must conflict';
  exception when sqlstate 'MK412' then null;
  end;

  -- ══ USE IN SEQUENCE STEP ══
  r := marketing_sequence_create('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002',
        jsonb_build_object('name','Idem journey',
          'sender_id',(select val from p7_ctx where key='sender'),
          'steps', jsonb_build_array(
            jsonb_build_object('key','s1','type','send_email','config',
              jsonb_build_object('subject','Idem step','body_authored','Idem step body')))));
  s := (r ->> 'id')::uuid;
  args := jsonb_build_object(
    'template_revision_id',
    (select current_revision_id from marketing_templates where id = t),
    'campaign_id', s, 'step_key', 's1',
    'expected_version', (select version from marketing_campaigns where id = s),
    'request_id', 'p7-idem-battery-u2');
  select count(*) into n_seqrev from marketing_sequence_revisions where campaign_id = s;
  select count(*) into n_steps from marketing_sequence_steps where campaign_id = s;
  select count(*) into n_use from marketing_template_usages where template_id = t;
  r := marketing_template_use_in_sequence_step('aaaa7700-0000-0000-0000-0000000000f1',
        'bbbb7700-0000-0000-0000-000000000002', args);
  r2 := marketing_template_use_in_sequence_step('aaaa7700-0000-0000-0000-0000000000f1',
         'bbbb7700-0000-0000-0000-000000000002', args);
  assert r2 = r, 'sequence-use replay returns the original composed result';
  assert (select count(*) from marketing_sequence_revisions where campaign_id = s)
       = n_seqrev + 1
     and (select count(*) from marketing_sequence_steps where campaign_id = s)
       = n_steps + 1
     and (select count(*) from marketing_template_usages where template_id = t)
       = n_use + 1,
    'sequence-use replay creates NO second revision, step or usage row';
  begin
    perform marketing_template_use_in_sequence_step('aaaa7700-0000-0000-0000-0000000000f1',
      'bbbb7700-0000-0000-0000-000000000002',
      args || jsonb_build_object('append_step', true) - 'step_key');
    assert false, 'changed-payload reuse of a use_in_sequence_step id must conflict';
  exception when sqlstate 'MK412' then null;
  end;
end $$;

select 'marketing_templates_reporting_ai.test.sql: ALL ASSERTIONS PASSED' as result;
rollback;
