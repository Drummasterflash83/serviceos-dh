-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_ads.test.sql
--
-- Proves Marketing Phase 8 (migration 20260905120000) end to end with
-- SYNTHETIC fixtures only — no provider, no real lead, no email:
--   SOURCES — owner/admin + marketing.ads.manage structural ceiling (hostile
--   grants inert), request-id idempotency (replay converges / changed reuse
--   MK412 / different actor MK412), MK409 concurrency, provider/mode
--   immutability, unsupported providers truthfully inert (no credential, no
--   manual sync), archive recoverable with append-only version history.
--   INGEST — post-signature dedup: identical replay converges and counts;
--   same id + different body records a digest-only conflict; ledger identity
--   and payload immutable; state machine forward-only.
--   PROCESSING — ONE canonical inbound Interaction per event (replay-safe),
--   canonical identity resolution (create / existing convergence / ambiguity
--   → the EXISTING marketing_identity_conflicts review path), version-pinned
--   relationship/tag/lifecycle defaults through the canonical authorities,
--   verified facts preserved, NO communication preference invented,
--   append-only attribution touchpoints (one per factual event), honest
--   failure classes incl. retired-default holds.
--   ATTRIBUTION — deterministic first/last touch with stable tie-breaks.
--   METRICS — append-only facts + supersession, CPL only when genuinely
--   derivable (null + exact reason otherwise), browser write denial.
--   CATALOG — the COMPLETE Phase-8 function set derived from the catalog and
--   locked service-role-only in BOTH directions; RLS on every new table.
begin;

create temp table p8_ctx (key text primary key, val text);

insert into tenants (id, slug, display_name, industry) values
  ('aaaa8800-0000-0000-0000-0000000000f1','p8-t1','Phase8 Tenant 1','hvac'),
  ('aaaa8800-0000-0000-0000-0000000000f2','p8-t2','Phase8 Tenant 2','hvac');
insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb8800-0000-0000-0000-000000000001','p8-owner@x.test',false,false),
  ('bbbb8800-0000-0000-0000-000000000002','p8-ops@x.test',false,false),
  ('bbbb8800-0000-0000-0000-000000000003','p8-viewer@x.test',false,false),
  ('bbbb8800-0000-0000-0000-000000000005','p8-admin-b@x.test',false,false);
update profiles set role='owner',  tenant_id='aaaa8800-0000-0000-0000-0000000000f1' where id='bbbb8800-0000-0000-0000-000000000001';
update profiles set role='ops',    tenant_id='aaaa8800-0000-0000-0000-0000000000f1' where id='bbbb8800-0000-0000-0000-000000000002';
update profiles set role='viewer', tenant_id='aaaa8800-0000-0000-0000-0000000000f1' where id='bbbb8800-0000-0000-0000-000000000003';
update profiles set role='admin',  tenant_id='aaaa8800-0000-0000-0000-0000000000f2' where id='bbbb8800-0000-0000-0000-000000000005';
select marketing_materialise_defaults('aaaa8800-0000-0000-0000-0000000000f1','bbbb8800-0000-0000-0000-000000000001');
select marketing_materialise_defaults('aaaa8800-0000-0000-0000-0000000000f2','bbbb8800-0000-0000-0000-000000000005');
do $$
declare r jsonb;
begin
  r := marketing_tag_mutate('aaaa8800-0000-0000-0000-0000000000f1',
        'bbbb8800-0000-0000-0000-000000000001', 'create', '{"label":"Ad lead"}');
  insert into p8_ctx values ('tag', r ->> 'id');
end $$;

-- ── (1) SOURCES: ceilings, idempotency, immutability, truthful providers ────
do $$
declare r jsonb; r2 jsonb; s uuid; args jsonb; n int;
begin
  -- viewer and ops are refused STRUCTURALLY
  begin
    perform marketing_ad_source_create('aaaa8800-0000-0000-0000-0000000000f1',
      'bbbb8800-0000-0000-0000-000000000003',
      '{"provider":"webhook","name":"X","request_id":"p8-src-v1"}');
    assert false, 'a viewer must be denied source creation';
  exception when sqlstate '42501' then null;
  end;
  -- a HOSTILE grant of marketing.ads.manage to ops stays inert (role ceiling)
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa8800-0000-0000-0000-0000000000f1','bbbb8800-0000-0000-0000-000000000002',
          'marketing.ads.manage', true, 'bbbb8800-0000-0000-0000-000000000001');
  begin
    perform marketing_ad_source_create('aaaa8800-0000-0000-0000-0000000000f1',
      'bbbb8800-0000-0000-0000-000000000002',
      '{"provider":"webhook","name":"X","request_id":"p8-src-o1"}');
    assert false, 'a hostile ads.manage grant must not bypass the owner/admin ceiling';
  exception when sqlstate '42501' then null;
  end;
  -- an EXPLICIT DENY beats the owner default
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa8800-0000-0000-0000-0000000000f1','bbbb8800-0000-0000-0000-000000000001',
          'marketing.ads.manage', false, 'bbbb8800-0000-0000-0000-000000000001');
  begin
    perform marketing_ad_source_create('aaaa8800-0000-0000-0000-0000000000f1',
      'bbbb8800-0000-0000-0000-000000000001',
      '{"provider":"webhook","name":"X","request_id":"p8-src-d1"}');
    assert false, 'an explicit deny must stay effective';
  exception when sqlstate '42501' then null;
  end;
  delete from marketing_access_grants
   where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1';

  -- missing / malformed request id refuse before any write
  begin
    perform marketing_ad_source_create('aaaa8800-0000-0000-0000-0000000000f1',
      'bbbb8800-0000-0000-0000-000000000001', '{"provider":"webhook","name":"X"}');
    assert false, 'a source mutation without a request id must refuse';
  exception when sqlstate '22023' then null;
  end;

  -- CREATE a signed-webhook source; exact replay converges; changed reuse MK412
  args := jsonb_build_object('provider','webhook','name','Site form',
    'default_relationship_type','lead','default_lifecycle_stage_key','new_lead',
    'default_tag_id',(select val from p8_ctx where key='tag'),
    'campaign_ref','spring-boilers','form_ref','quote-form',
    'request_id','p8-src-c1');
  r := marketing_ad_source_create('aaaa8800-0000-0000-0000-0000000000f1',
        'bbbb8800-0000-0000-0000-000000000001', args);
  s := (r ->> 'id')::uuid;
  insert into p8_ctx values ('src', s::text);
  assert (r ->> 'public_key') ~ '^[0-9a-f]{48}$',
    'a webhook source carries an opaque non-enumerable public key';
  assert (r ->> 'credential_state') = 'unconfigured',
    'a new webhook source is honestly unconfigured';
  r2 := marketing_ad_source_create('aaaa8800-0000-0000-0000-0000000000f1',
         'bbbb8800-0000-0000-0000-000000000001', args);
  assert r2 = r, 'create replay returns the byte-identical original result';
  assert (select count(*) from marketing_ad_sources
           where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1') = 1,
    'create replay mints NO second source';
  begin
    perform marketing_ad_source_create('aaaa8800-0000-0000-0000-0000000000f1',
      'bbbb8800-0000-0000-0000-000000000001',
      args || jsonb_build_object('name','Different'));
    assert false, 'changed-payload reuse of a create request id must conflict';
  exception when sqlstate 'MK412' then null;
  end;
  -- the request ledger is TENANT-SCOPED (no MK412 collision for tenant B) and
  -- a cross-tenant default tag is structurally refused
  begin
    perform marketing_ad_source_create('aaaa8800-0000-0000-0000-0000000000f2',
      'bbbb8800-0000-0000-0000-000000000005', args);
    assert false, 'tenant A''s default tag must be invisible to tenant B';
  exception
    when sqlstate 'MK412' then
      assert false, 'the request ledger is tenant-scoped — tenant B must not collide';
    when sqlstate 'P0002' then null;
  end;

  -- REVISE: MK409 stale, provider/mode immutable, history appends
  begin
    perform marketing_ad_source_revise('aaaa8800-0000-0000-0000-0000000000f1',
      'bbbb8800-0000-0000-0000-000000000001', s,
      '{"name":"New name","request_id":"p8-src-r0"}', 99);
    assert false, 'a stale source version must conflict';
  exception when sqlstate 'MK409' then null;
  end;
  begin
    perform marketing_ad_source_revise('aaaa8800-0000-0000-0000-0000000000f1',
      'bbbb8800-0000-0000-0000-000000000001', s,
      '{"provider":"meta","request_id":"p8-src-r1"}', 1);
    assert false, 'provider/mode must be immutable';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_ad_source_revise('aaaa8800-0000-0000-0000-0000000000f1',
        'bbbb8800-0000-0000-0000-000000000001', s,
        '{"name":"Website quote form","request_id":"p8-src-r2"}', 1);
  assert (r ->> 'version')::int = 2, 'revise bumps the concurrency token';
  select count(*) into n from marketing_ad_source_versions
   where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1' and source_id = s;
  assert n = 2, 'every change is an immutable version row';
  begin
    delete from marketing_ad_source_versions
     where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1' and source_id = s;
    assert false, 'version history must be append-only';
  exception when raise_exception then null; when insufficient_privilege then null;
  end;

  -- UNSUPPORTED provider: creatable config, but truthfully inert
  r := marketing_ad_source_create('aaaa8800-0000-0000-0000-0000000000f1',
        'bbbb8800-0000-0000-0000-000000000001',
        '{"provider":"meta","name":"Meta leads","request_id":"p8-src-c2"}');
  insert into p8_ctx values ('srcMeta', r ->> 'id');
  assert (r ->> 'public_key') is null, 'an api-mode source has no webhook key';
  begin
    perform marketing_ad_source_credential_mark('aaaa8800-0000-0000-0000-0000000000f1',
      'bbbb8800-0000-0000-0000-000000000001', (r ->> 'id')::uuid,
      '{"request_id":"p8-src-cm1"}', 1);
    assert false, 'a non-webhook source carries no webhook credential';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_ad_manual_sync('aaaa8800-0000-0000-0000-0000000000f1',
      'bbbb8800-0000-0000-0000-000000000001', (r ->> 'id')::uuid,
      '{"request_id":"p8-sync-1"}');
    assert false, 'no v1 adapter supports sync — manual sync must refuse truthfully';
  exception when sqlstate 'MK430' then null;
  end;

  -- credential mark (the Edge stores the Vault secret; this records the fact)
  r := marketing_ad_source_credential_mark('aaaa8800-0000-0000-0000-0000000000f1',
        'bbbb8800-0000-0000-0000-000000000001', s, '{"request_id":"p8-src-cm2"}', 2);
  assert (r ->> 'credential_state') = 'configured', 'credential presence recorded';

  -- disable preserves everything; archive is recoverable; restore reopens
  r := marketing_ad_source_set_status('aaaa8800-0000-0000-0000-0000000000f1',
        'bbbb8800-0000-0000-0000-000000000001', s,
        '{"status":"disabled","request_id":"p8-src-s1"}', 3);
  r := marketing_ad_source_set_status('aaaa8800-0000-0000-0000-0000000000f1',
        'bbbb8800-0000-0000-0000-000000000001', s,
        '{"status":"archived","request_id":"p8-src-s2"}', 4);
  begin
    perform marketing_ad_source_revise('aaaa8800-0000-0000-0000-0000000000f1',
      'bbbb8800-0000-0000-0000-000000000001', s,
      '{"name":"Nope","request_id":"p8-src-r3"}', 5);
    assert false, 'an archived source must refuse revision';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_ad_source_set_status('aaaa8800-0000-0000-0000-0000000000f1',
        'bbbb8800-0000-0000-0000-000000000001', s,
        '{"status":"active","request_id":"p8-src-s3"}', 5);
  assert (select archived_at from marketing_ad_sources where id = s) is null,
    'restore clears archive facts';
  assert (select count(*) from marketing_ad_source_versions
           where source_id = s) = 6,
    'create/revise/credential/disable/archive/restore all versioned';
end $$;

-- ── (2) INGEST: dedup, replay, conflict, immutability ───────────────────────
do $$
declare s uuid; r jsonb; e1 uuid; env jsonb; n int;
begin
  s := (select val from p8_ctx where key='src')::uuid;
  env := jsonb_build_object('schema_version','ads-lead@1',
    'lead', jsonb_build_object('first_name','Jo','last_name','Beam',
                               'email','jo.beam@example.test','phone','+447700900123'),
    'campaign_ref','spring-boilers','form_ref','quote-form',
    'meta', jsonb_build_object('utm_source','meta','utm_campaign','spring'));
  r := marketing_ad_event_ingest('aaaa8800-0000-0000-0000-0000000000f1', s,
        jsonb_build_object('provider_event_id','evt-001',
          'occurred_at', now()::text, 'body_digest', repeat('ab', 32),
          'schema_version','ads-lead@1','envelope', env));
  e1 := (r ->> 'event_id')::uuid;
  insert into p8_ctx values ('evt1', e1::text);
  assert (r ->> 'outcome') = 'accepted', 'first delivery accepted';
  -- identical replay CONVERGES on the same event and counts
  r := marketing_ad_event_ingest('aaaa8800-0000-0000-0000-0000000000f1', s,
        jsonb_build_object('provider_event_id','evt-001',
          'occurred_at', now()::text, 'body_digest', repeat('ab', 32),
          'schema_version','ads-lead@1','envelope', env));
  assert (r ->> 'outcome') = 'replayed' and (r ->> 'event_id')::uuid = e1,
    'an identical replay converges on ONE logical event';
  assert (select replay_count from marketing_ad_events where id = e1) = 1,
    'replay evidence counts';
  assert (select count(*) from marketing_ad_events
           where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1') = 1,
    'replay creates no second event';
  -- same id + DIFFERENT body = integrity conflict, digests only
  r := marketing_ad_event_ingest('aaaa8800-0000-0000-0000-0000000000f1', s,
        jsonb_build_object('provider_event_id','evt-001',
          'occurred_at', now()::text, 'body_digest', repeat('cd', 32),
          'schema_version','ads-lead@1','envelope', env));
  assert (r ->> 'outcome') = 'conflicted', 'a different body under the same id conflicts';
  select count(*) into n from marketing_ad_event_conflicts
   where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1' and source_id = s;
  assert n = 1, 'the conflict is durable evidence';
  assert (select position('jo.beam' in c::text) = 0
            from marketing_ad_event_conflicts c
           where c.tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1' limit 1),
    'conflict evidence carries digests only — never lead PII';
  -- ledger immutability
  begin
    update marketing_ad_events set envelope = '{}'::jsonb where id = e1;
    assert false, 'event payload must be immutable';
  exception when restrict_violation then null;
  end;
  begin
    update marketing_ad_events set processing_state = 'resolved' where id = e1;
    assert false, 'pending cannot jump to resolved without processing';
  exception when sqlstate '22023' then null;
  end;
  begin
    delete from marketing_ad_events where id = e1;
    assert false, 'event history must be undeletable';
  exception when raise_exception then null; when insufficient_privilege then null;
  end;
  -- a DISABLED source stops accepting (commit-time re-check)
  perform marketing_ad_source_set_status('aaaa8800-0000-0000-0000-0000000000f1',
    'bbbb8800-0000-0000-0000-000000000001', s,
    '{"status":"disabled","request_id":"p8-src-s4"}',
    (select version from marketing_ad_sources where id = s));
  begin
    perform marketing_ad_event_ingest('aaaa8800-0000-0000-0000-0000000000f1', s,
      jsonb_build_object('provider_event_id','evt-002',
        'occurred_at', now()::text, 'body_digest', repeat('ef', 32),
        'schema_version','ads-lead@1','envelope', env));
    assert false, 'a disabled source must not accept events';
  exception when sqlstate '22023' then null;
  end;
  perform marketing_ad_source_set_status('aaaa8800-0000-0000-0000-0000000000f1',
    'bbbb8800-0000-0000-0000-000000000001', s,
    '{"status":"active","request_id":"p8-src-s5"}',
    (select version from marketing_ad_sources where id = s));
end $$;

-- ── (3) PROCESSING: interaction, identity, defaults, touchpoint, honesty ────
do $$
declare s uuid; e1 uuid; e2 uuid; e3 uuid; r jsonb; person uuid; n int;
        claimed marketing_ad_events%rowtype; pref_n int;
begin
  s := (select val from p8_ctx where key='src')::uuid;
  e1 := (select val from p8_ctx where key='evt1')::uuid;
  select count(*) into pref_n from communication_preferences
   where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1';

  -- unclaimed processing refuses; claim then process
  begin
    perform marketing_ad_lead_process('aaaa8800-0000-0000-0000-0000000000f1', e1);
    assert false, 'processing requires a claim';
  exception when sqlstate '22023' then null;
  end;
  select * into claimed from marketing_ad_claim_events(
    'aaaa8800-0000-0000-0000-0000000000f1', 'test-worker', 5, 300) limit 1;
  assert claimed.id = e1, 'the pending event is claimable';
  r := marketing_ad_lead_process('aaaa8800-0000-0000-0000-0000000000f1', e1);
  assert (r ->> 'state') = 'resolved', 'a clean lead resolves';
  person := (r ->> 'person_id')::uuid;
  insert into p8_ctx values ('person', person::text);

  -- ONE canonical inbound Interaction, projected from the ledger row
  assert (select count(*) from interactions
           where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1'
             and source_table = 'marketing_ad_events' and source_id = e1) = 1,
    'exactly one canonical Interaction exists for the event';
  assert (select direction from interactions
           where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1'
             and source_table = 'marketing_ad_events' and source_id = e1) = 'inbound',
    'the Interaction is inbound';
  assert (select related_person_id from interactions
           where source_table = 'marketing_ad_events' and source_id = e1) = person,
    'the Interaction links the resolved Person';

  -- accurate provenance through the canonical identity authority
  assert (select created_source from people where id = person) = 'ad_lead',
    'the Person records ad_lead provenance';
  assert (select source from contact_relationships
           where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1'
             and person_id = person and status = 'active') = 'ad_lead',
    'the relationship records ad_lead provenance';
  assert (select lifecycle_stage_key from contact_relationships
           where person_id = person and status = 'active') = 'new_lead',
    'the version-pinned lifecycle default applied';
  assert exists (select 1 from contact_tag_assignments
                  where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1'
                    and person_id = person
                    and tag_id = (select val from p8_ctx where key='tag')::uuid),
    'the default tag applied through the canonical tag authority';
  -- NO subscription invented; eligibility stays unknown
  assert (select count(*) from communication_preferences
           where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1') = pref_n,
    'a captured lead NEVER creates a communication preference';
  assert marketing_endpoint_eligibility('aaaa8800-0000-0000-0000-0000000000f1',
           person, 'email') = 'unknown',
    'lead capture is evidence, not consent — eligibility is unknown';

  -- ONE touchpoint, exact confidence, event resolved with write-once refs
  assert (select count(*) from marketing_ad_touchpoints
           where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1'
             and event_id = e1) = 1, 'one touchpoint per factual event';
  assert (select confidence from marketing_ad_touchpoints where event_id = e1) = 'exact',
    'created-person resolution is exact confidence';
  begin
    update marketing_ad_touchpoints set person_id = gen_random_uuid()
     where event_id = e1;
    assert false, 'a recorded touchpoint person link must be write-once';
  exception when restrict_violation then null;
  end;

  -- SECOND event, same email → canonical convergence on the SAME Person,
  -- existing classification preserved (never overwritten)
  perform marketing_ad_event_ingest('aaaa8800-0000-0000-0000-0000000000f1', s,
    jsonb_build_object('provider_event_id','evt-010',
      'occurred_at', (now() + interval '1 hour')::text,
      'body_digest', repeat('11', 32), 'schema_version','ads-lead@1',
      'envelope', jsonb_build_object('schema_version','ads-lead@1',
        'lead', jsonb_build_object('full_name','Josephine Beam',
                                   'email','JO.BEAM@example.test'),
        'campaign_ref','spring-boilers')));
  select id into e2 from marketing_ad_events
   where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1'
     and provider_event_id = 'evt-010';
  perform marketing_ad_claim_events('aaaa8800-0000-0000-0000-0000000000f1', 'w', 5, 300);
  r := marketing_ad_lead_process('aaaa8800-0000-0000-0000-0000000000f1', e2);
  assert (r ->> 'state') = 'resolved' and (r ->> 'person_id')::uuid = person,
    'a normalised email match converges on the existing Person';
  assert (select count(*) from people
           where tenant_id = 'aaaa8800-0000-0000-0000-0000000000f1') = 1,
    'no duplicate Person is ever created';
  assert (select count(*) from contact_relationships
           where person_id = person and status = 'active') = 1,
    'the existing active classification is preserved, not duplicated';

  -- AMBIGUITY → the EXISTING review path, no silent merge, no person link
  insert into people (id, tenant_id, display_name, primary_email, created_source, verified)
  values ('cccc8800-0000-0000-0000-000000000001',
          'aaaa8800-0000-0000-0000-0000000000f1', 'Ambig One',
          'shared@example.test', 'manual', false),
         ('cccc8800-0000-0000-0000-000000000002',
          'aaaa8800-0000-0000-0000-0000000000f1', 'Ambig Two',
          'shared@example.test', 'manual', false);
  perform marketing_ad_event_ingest('aaaa8800-0000-0000-0000-0000000000f1', s,
    jsonb_build_object('provider_event_id','evt-020',
      'occurred_at', now()::text, 'body_digest', repeat('22', 32),
      'schema_version','ads-lead@1',
      'envelope', jsonb_build_object('schema_version','ads-lead@1',
        'lead', jsonb_build_object('full_name','Somebody Shared',
                                   'email','shared@example.test'))));
  select id into e3 from marketing_ad_events where provider_event_id = 'evt-020';
  perform marketing_ad_claim_events('aaaa8800-0000-0000-0000-0000000000f1', 'w', 5, 300);
  r := marketing_ad_lead_process('aaaa8800-0000-0000-0000-0000000000f1', e3);
  assert (r ->> 'state') = 'review', 'ambiguous identity routes to review';
  assert (r ->> 'person_id') is null, 'no person is fabricated on ambiguity';
  assert exists (select 1 from marketing_identity_conflicts
                  where id = (r ->> 'conflict_id')::uuid),
    'the EXISTING marketing_identity_conflicts review path is used';
  assert (select confidence from marketing_ad_touchpoints where event_id = e3) = 'review',
    'the touchpoint is honest about unresolved identity';
  assert (select count(*) from interactions
           where source_table = 'marketing_ad_events' and source_id = e3) = 1,
    'the inbound Interaction evidence is preserved without a person';
  -- governed retry: review → pending → claim → converges again to review
  r := marketing_ad_event_retry('aaaa8800-0000-0000-0000-0000000000f1',
        'bbbb8800-0000-0000-0000-000000000001', e3, '{"request_id":"p8-rt-0001"}');
  perform marketing_ad_claim_events('aaaa8800-0000-0000-0000-0000000000f1', 'w', 5, 300);
  r := marketing_ad_lead_process('aaaa8800-0000-0000-0000-0000000000f1', e3);
  assert (r ->> 'state') = 'review', 'reprocessing converges without duplicates';
  assert (select count(*) from interactions
           where source_table = 'marketing_ad_events' and source_id = e3) = 1
     and (select count(*) from marketing_ad_touchpoints where event_id = e3) = 1,
    'replayed processing creates NO duplicate Interaction or touchpoint';
end $$;

-- ── (4) ATTRIBUTION: deterministic first/last with stable ties ──────────────
do $$
declare person uuid; r jsonb; tp1 uuid; tp2 uuid;
begin
  person := (select val from p8_ctx where key='person')::uuid;
  r := marketing_ad_attribution('aaaa8800-0000-0000-0000-0000000000f1',
        jsonb_build_object('person_id', person));
  assert jsonb_array_length(r -> 'touchpoints') = 2,
    'the complete touchpoint history is preserved';
  assert (r -> 'first_touch' ->> 'occurred_at')::timestamptz
       < (r -> 'last_touch' ->> 'occurred_at')::timestamptz,
    'first and last touch derive deterministically from occurred_at';
  select id into tp1 from marketing_ad_touchpoints
   where person_id = person order by occurred_at, id limit 1;
  assert (r -> 'first_touch' ->> 'id')::uuid = tp1,
    'ties and order break on the stable (occurred_at, id) key';
  assert position('revenue' in lower(r ->> 'note')) > 0,
    'attribution states its own limits — no business outcome is claimed';
end $$;

-- ── (5) METRICS: append-only facts, supersession, honest CPL ────────────────
do $$
declare s uuid; r jsonb; f1 uuid; f2 uuid;
begin
  s := (select val from p8_ctx where key='src')::uuid;
  -- no facts yet → CPL unavailable with the exact reason
  r := marketing_ad_metrics('aaaa8800-0000-0000-0000-0000000000f1',
        jsonb_build_object('source_id', s));
  assert r -> 'cpl_provider' = 'null'::jsonb
     and (r ->> 'cpl_unavailable_reason') = 'no_spend_facts',
    'no spend facts → CPL null with reason, never zero';
  -- spend requires a currency (structurally)
  begin
    perform marketing_ad_metric_record('aaaa8800-0000-0000-0000-0000000000f1', s,
      '{"window_start":"2026-07-01","window_end":"2026-07-07","spend":100,"adapter_version":"test"}');
    assert false, 'spend without a currency must be impossible';
  exception when check_violation then null;
  end;
  r := marketing_ad_metric_record('aaaa8800-0000-0000-0000-0000000000f1', s,
        '{"window_start":"2026-07-01","window_end":"2026-07-07","currency":"GBP","spend":120.50,"impressions":1000,"clicks":50,"provider_leads":4,"adapter_version":"test"}');
  f1 := (r ->> 'id')::uuid;
  r := marketing_ad_metrics('aaaa8800-0000-0000-0000-0000000000f1',
        jsonb_build_object('source_id', s));
  assert (r -> 'totals' ->> 'spend')::numeric = 120.50
     and (r ->> 'cpl_provider')::numeric = round(120.50 / 4, 2),
    'CPL derives only from genuine spend and a factual denominator';
  assert (r -> 'totals' ->> 'provider_leads')::int = 4
     and (r -> 'totals' ->> 'received_events')::int >= 3,
    'provider-reported leads and ServiceOS received events stay distinct';
  -- correction SUPERSEDES — history preserved, projection current
  r := marketing_ad_metric_record('aaaa8800-0000-0000-0000-0000000000f1', s,
        jsonb_build_object('window_start','2026-07-01','window_end','2026-07-07',
          'currency','GBP','spend',95.00,'provider_leads',4,
          'adapter_version','test','supersedes_id', f1));
  f2 := (r ->> 'id')::uuid;
  r := marketing_ad_metrics('aaaa8800-0000-0000-0000-0000000000f1',
        jsonb_build_object('source_id', s));
  assert (r -> 'totals' ->> 'spend')::numeric = 95.00,
    'the current projection uses the correction';
  assert (select count(*) from marketing_ad_metric_facts where source_id = s) = 2,
    'the corrected fact remains as history';
  begin
    update marketing_ad_metric_facts set spend = 1 where id = f1;
    assert false, 'metric facts must be append-only';
  exception when raise_exception then null; when insufficient_privilege then null;
  end;
  -- mixed currencies never aggregate
  perform marketing_ad_metric_record('aaaa8800-0000-0000-0000-0000000000f1', s,
    '{"window_start":"2026-07-08","window_end":"2026-07-14","currency":"EUR","spend":10,"adapter_version":"test"}');
  r := marketing_ad_metrics('aaaa8800-0000-0000-0000-0000000000f1',
        jsonb_build_object('source_id', s));
  assert (r ->> 'cpl_unavailable_reason') = 'mixed_currencies'
     and r -> 'totals' -> 'currency' = 'null'::jsonb,
    'incompatible currencies are never summed into a fake total';
  -- REGRESSION (mixed-currency totals.spend): the cross-currency SUM must NOT be
  -- returned — totals.spend is JSON null with the reason, never a currency-less
  -- meaningless number (95.00 GBP + 10 EUR = 105.00 must never surface).
  assert r -> 'totals' -> 'spend' = 'null'::jsonb,
    'totals.spend is null under mixed currencies — a cross-currency sum is never shown';
end $$;

-- ── (6) HEALTH + overview honesty ───────────────────────────────────────────
do $$
declare r jsonb; h jsonb;
begin
  r := marketing_ad_source_health('aaaa8800-0000-0000-0000-0000000000f1');
  select x into h from jsonb_array_elements(r -> 'sources') x
   where x ->> 'id' = (select val from p8_ctx where key='src') limit 1;
  assert (h ->> 'review')::int = 1 and (h ->> 'attention')::boolean,
    'review-required leads surface attention';
  assert position('review' in lower(h ->> 'remediation')) > 0,
    'remediation names the exact human step';
  assert (h ->> 'sync_supported')::boolean = false,
    'no fake sync capability is ever claimed';
  select x into h from jsonb_array_elements(r -> 'sources') x
   where x ->> 'id' = (select val from p8_ctx where key='srcMeta') limit 1;
  assert (h ->> 'connection_state') = 'not_connected',
    'an adapterless provider is truthfully not connected';
  r := marketing_ads_overview('aaaa8800-0000-0000-0000-0000000000f1');
  assert position('does not create or edit advertisements' in (r ->> 'note')) > 0,
    'the overview states what Ads is not';
end $$;

-- ── (6b) AUDIT REGRESSION LOCKS — occurred_at bounds, credential rotation
--    retirement + double-rotation idempotency, structural attribution FK,
--    retired-default rejection, poison-event ceiling ──────────────────────────
do $$
declare
  t uuid := 'aaaa8800-0000-0000-0000-0000000000f1';
  owner uuid := 'bbbb8800-0000-0000-0000-000000000001';
  rs uuid; r jsonb; v int; v2 int; rotated_at timestamptz;
  ev jsonb; poison uuid; forge uuid; claimed uuid[];
begin
  -- fresh isolated webhook source for these locks
  r := marketing_ad_source_create(t, owner,
        '{"provider":"webhook","name":"Regression source","request_id":"reg-src-1"}');
  rs := (r ->> 'id')::uuid;

  -- F4 · FIRST configuration records NO overlap clock (no previous secret)
  r := marketing_ad_source_credential_mark(t, owner, rs, '{"request_id":"reg-cm-1"}', 1);
  assert (r ->> 'rotated') = 'false' and (r ->> 'replayed') = 'false',
    'first credential configuration is not a rotation';
  select credential_rotated_at into rotated_at from marketing_ad_sources where id = rs;
  assert rotated_at is null, 'first configuration grants no previous-secret overlap window';
  v := (r ->> 'version')::int;

  -- F4 · ROTATION starts a bounded overlap clock
  r := marketing_ad_source_credential_mark(t, owner, rs, '{"request_id":"reg-cm-2"}', v);
  assert (r ->> 'rotated') = 'true', 'a rotation over a configured secret is flagged';
  select credential_rotated_at into rotated_at from marketing_ad_sources where id = rs;
  assert rotated_at is not null, 'rotation records credential_rotated_at (retirement clock)';
  v2 := (r ->> 'version')::int;
  assert v2 = v + 1, 'a genuine rotation advances the version once';

  -- F4 · REPLAYING a rotation request_id CONVERGES — it must not rotate twice
  r := marketing_ad_source_credential_mark(t, owner, rs, '{"request_id":"reg-cm-2"}', v);
  assert (r ->> 'replayed') = 'true', 'a repeated rotation request id is a replay';
  assert (r ->> 'version')::int = v2, 'the replay returns the original version';
  assert (select version from marketing_ad_sources where id = rs) = v2,
    'a repeated rotation request id NEVER rotates the secret a second time';

  -- F2 · occurred_at must sit in the sane window (real-time capture)
  begin
    perform marketing_ad_event_ingest(t, rs, jsonb_build_object(
      'provider_event_id','occ-future','occurred_at',(now() + interval '60 days')::text,
      'body_digest', repeat('ab',32), 'envelope','{}'::jsonb));
    assert false, 'a far-future occurred_at must be refused';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_ad_event_ingest(t, rs, jsonb_build_object(
      'provider_event_id','occ-ancient','occurred_at','2000-01-01T00:00:00Z',
      'body_digest', repeat('cd',32), 'envelope','{}'::jsonb));
    assert false, 'an ancient occurred_at must be refused';
  exception when sqlstate '22023' then null;
  end;
  -- a sane occurred_at is accepted
  ev := marketing_ad_event_ingest(t, rs, jsonb_build_object(
    'provider_event_id','occ-ok','occurred_at', now()::text,
    'body_digest', repeat('ef',32), 'envelope', jsonb_build_object(
      'schema_version','ads-lead@1','lead', jsonb_build_object('email','reg@example.test'))));
  assert (ev ->> 'outcome') = 'accepted', 'a real-time occurred_at is accepted';
  forge := (ev ->> 'event_id')::uuid;

  -- F6 · the attribution Person link is STRUCTURALLY tenant-bound: a service-role
  -- insert can NOT forge a non-existent / cross-tenant person into a touchpoint
  begin
    insert into marketing_ad_touchpoints
      (tenant_id, source_id, source_version_id, provider, event_id, person_id,
       confidence, occurred_at, correlation_id)
    select t, rs, e.source_version_id, 'webhook', forge, gen_random_uuid(),
           'exact', now(), gen_random_uuid()
      from marketing_ad_events e where e.id = forge;
    assert false, 'a forged attribution person reference must fail structurally';
  exception when foreign_key_violation then null;
  end;

  -- F7 · a RETIRED (inactive) lifecycle stage can NOT be an ad-source default
  insert into marketing_lifecycle_stages (tenant_id, stage_key, label, sort_order, active)
  values (t, 'reg_retired', 'Retired', 99, false);
  begin
    perform marketing_ad_source_create(t, owner, jsonb_build_object(
      'provider','webhook','name','Bad default',
      'default_lifecycle_stage_key','reg_retired','request_id','reg-badstage'));
    assert false, 'a retired lifecycle stage must not be accepted as a default';
  exception when sqlstate 'P0002' then null;
  end;

  -- F8 · a POISON event (processing + expired lease + attempts exhausted) is
  -- retired to failed by the claim, never re-leased forever
  update marketing_ad_events
     set processing_state = 'processing', attempts = 10,
         lease_expires_at = now() - interval '5 minutes'
   where id = forge;
  select array_agg(id) into claimed
    from marketing_ad_claim_events(t, 'reg-worker', 5, 300);
  assert not (forge = any(coalesce(claimed, array[]::uuid[]))),
    'an attempt-exhausted poison event is NOT re-leased';
  assert (select processing_state from marketing_ad_events where id = forge) = 'failed'
     and (select error_class from marketing_ad_events where id = forge) = 'max_attempts_exhausted',
    'the poison event is retired to failed with an honest class';
end $$;

-- ── (7) cross-tenant + RLS + catalog grant lock ─────────────────────────────
do $$
declare fn text;
begin
  -- tenant B reads/reaches nothing of tenant A
  begin
    perform marketing_ad_source_detail('aaaa8800-0000-0000-0000-0000000000f2',
      (select val from p8_ctx where key='src')::uuid);
    assert false, 'a tenant-B source read must be NOT_FOUND';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform marketing_ad_event_ingest('aaaa8800-0000-0000-0000-0000000000f2',
      (select val from p8_ctx where key='src')::uuid,
      ('{"provider_event_id":"x-1","occurred_at":"2026-07-01T00:00:00Z","body_digest":"'
       || repeat('99', 32) || '","envelope":{}}')::jsonb);
    assert false, 'cross-tenant ingest must fail';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform marketing_ad_attribution('aaaa8800-0000-0000-0000-0000000000f2',
      jsonb_build_object('person_id', (select val from p8_ctx where key='person')));
    assert false, 'cross-tenant attribution must fail';
  exception when sqlstate 'P0002' then null;
  end;

  -- RLS on every Phase-8 table
  perform 1 from pg_class c
   where c.relname in ('marketing_ad_sources','marketing_ad_source_versions',
                       'marketing_ad_events','marketing_ad_event_conflicts',
                       'marketing_ad_touchpoints','marketing_ad_metric_facts',
                       'marketing_ad_sync_runs')
     and not c.relrowsecurity;
  if found then
    raise exception 'FAIL: a Phase-8 table is missing row level security';
  end if;
  -- no browser write path to evidence tables
  if has_table_privilege('authenticated', 'marketing_ad_events', 'insert')
     or has_table_privilege('authenticated', 'marketing_ad_touchpoints', 'insert')
     or has_table_privilege('authenticated', 'marketing_ad_metric_facts', 'insert') then
    raise exception 'FAIL: a browser role can write Phase-8 evidence';
  end if;

  -- the COMPLETE Phase-8 function set, derived from the catalog, locked in
  -- BOTH directions (missing or extra fails loudly)
  declare
    expected text[] := array[
      'marketing_require_ads_actor','marketing_ad_source_guard',
      'marketing_ad_event_guard','marketing_ad_touchpoint_guard',
      'marketing_ad_sync_run_guard','marketing_ad_source_snapshot',
      'marketing_ad_source_create','marketing_ad_source_revise',
      'marketing_ad_source_set_status','marketing_ad_source_credential_mark',
      'marketing_ad_manual_sync','marketing_ad_event_ingest',
      'marketing_ad_claim_events','marketing_ad_lead_process',
      'marketing_ad_event_retry','marketing_ad_metric_record',
      'marketing_ad_source_list','marketing_ad_source_detail',
      'marketing_ad_lead_feed','marketing_ad_event_detail',
      'marketing_ad_attribution','marketing_ad_metrics',
      'marketing_ad_source_health','marketing_ads_overview'];
    found_set text[];
    missing text[];
    extra text[];
  begin
    select coalesce(array_agg(distinct p.proname order by p.proname), '{}')
      into found_set
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'marketing\_ad\_%'
            or p.proname like 'marketing\_ads\_%'
            or p.proname = 'marketing_require_ads_actor');
    select coalesce(array_agg(e), '{}') into missing
      from unnest(expected) e where e <> all (found_set);
    select coalesce(array_agg(f), '{}') into extra
      from unnest(found_set) f where f <> all (expected);
    if array_length(missing, 1) is not null then
      raise exception 'FAIL: expected Phase-8 function(s) missing: %', missing;
    end if;
    if array_length(extra, 1) is not null then
      raise exception 'FAIL: catalog function(s) not in the Phase-8 lock list: %', extra;
    end if;
    foreach fn in array expected loop
      if exists (
        select 1 from information_schema.routine_privileges rp
         where rp.routine_name = fn and rp.grantee in ('anon', 'authenticated', 'PUBLIC')
           and rp.privilege_type = 'EXECUTE') then
        raise exception 'FAIL: Phase-8 function % is executable by a client role', fn;
      end if;
    end loop;
    perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = any (expected);
    if found then
      raise exception 'FAIL: a Phase-8 function is unexpectedly SECURITY DEFINER';
    end if;
  end;
end $$;

select 'marketing_ads.test.sql: ALL ASSERTIONS PASSED' as result;
rollback;
