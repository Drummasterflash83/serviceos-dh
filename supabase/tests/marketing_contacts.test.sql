-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_contacts.test.sql
--
-- Proves the CORRECTED Marketing Phase-2 Contacts projection (migration
-- 20260829120000). Covers: canonical normalisation; inclusion; SINGLE-ROW
-- relationship filters (all supplied predicates on one row, projected
-- deterministically); typed keyset cursors incl. the null last-contact
-- sentinel; scope-ranked eligibility precedence + invalid-scalar-evidence;
-- destination linkage/mismatch/malformed rules; formatted scalar phone
-- suppression; identity ambiguity with per-identifier TENANT-SAFE BOUNDED
-- evidence; mandatory-key fingerprint idempotency (all material fields, null
-- key/actor rejected); STRICT payload shapes + relationship contract combos
-- with zero-write proofs; explicit relationship targeting + mandatory versions
-- + no-op rejection + allow_new; owner validation; Customer Card current-
-- relationship projection (relationship_id included); precise per-field events
-- with TRUE key-based dedup; contact-point update/protection/EXACT concurrency
-- token/invalid-primary safety/before-after evidence; no-op edit semantics;
-- tag audits/events; corrupted cross-tenant fixtures incl. evidence leakage;
-- service-role-only execution.
begin;

insert into tenants (id, slug, display_name, industry) values
  ('aaaa0000-0000-0000-0000-0000000000f1','mc-t1','Contacts Tenant 1','hvac'),
  ('aaaa0000-0000-0000-0000-0000000000f2','mc-t2','Contacts Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb0000-0000-0000-0000-0000000000f1','admin-a@mc.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000f2','ops-a@mc.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000f3','admin-b@mc.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000f4','viewer-a@mc.test',false,false);
update profiles set role='admin',  tenant_id='aaaa0000-0000-0000-0000-0000000000f1' where id='bbbb0000-0000-0000-0000-0000000000f1';
update profiles set role='ops',    tenant_id='aaaa0000-0000-0000-0000-0000000000f1' where id='bbbb0000-0000-0000-0000-0000000000f2';
update profiles set role='admin',  tenant_id='aaaa0000-0000-0000-0000-0000000000f2' where id='bbbb0000-0000-0000-0000-0000000000f3';
update profiles set role='viewer', tenant_id='aaaa0000-0000-0000-0000-0000000000f1' where id='bbbb0000-0000-0000-0000-0000000000f4';

select marketing_materialise_defaults('aaaa0000-0000-0000-0000-0000000000f1',
                                      'bbbb0000-0000-0000-0000-0000000000f1');

insert into companies (id, tenant_id, name) values
  ('dddd0000-0000-0000-0000-0000000000f1','aaaa0000-0000-0000-0000-0000000000f1','Co A'),
  ('dddd0000-0000-0000-0000-0000000000f2','aaaa0000-0000-0000-0000-0000000000f2','Co B');

-- Sam's scalar phone is FORMATTED; his suppression uses the NORMALISED value.
insert into people (id, tenant_id, display_name, primary_email, primary_phone, company_id) values
  ('cccc0000-0000-0000-0000-0000000000f1','aaaa0000-0000-0000-0000-0000000000f1','Alice Example','alice@mc.test','+441234000001','dddd0000-0000-0000-0000-0000000000f1'),
  ('cccc0000-0000-0000-0000-0000000000f2','aaaa0000-0000-0000-0000-0000000000f2','Bea Foreign','bea@mc.test',null,null);
insert into people (id, tenant_id, display_name, primary_email, primary_phone) values
  ('cccc0000-0000-0000-0000-0000000000f3','aaaa0000-0000-0000-0000-0000000000f1','Dora Discovered','dora@mc.test',null),
  ('cccc0000-0000-0000-0000-0000000000f4','aaaa0000-0000-0000-0000-0000000000f1','Ursula Unsub','ursula@mc.test',null),
  ('cccc0000-0000-0000-0000-0000000000f5','aaaa0000-0000-0000-0000-0000000000f1','Sam Suppressed','sam@mc.test','+44 7700 900-555'),
  ('cccc0000-0000-0000-0000-0000000000f6','aaaa0000-0000-0000-0000-0000000000f1','Pat PersonBlock','pat@mc.test',null),
  ('cccc0000-0000-0000-0000-0000000000f7','aaaa0000-0000-0000-0000-0000000000f1','Archie Archived','archie@mc.test',null);

insert into contact_relationships (id, tenant_id, person_id, relationship_type, lifecycle_stage_key, owner_id, source, status) values
  ('abcd0000-0000-0000-0000-0000000000f1','aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','lead','engaged','bbbb0000-0000-0000-0000-0000000000f2','discovery','active'),
  ('abcd0000-0000-0000-0000-0000000000f4','aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f4','lead','new_lead',null,'discovery','active'),
  ('abcd0000-0000-0000-0000-0000000000f5','aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f5','lead','new_lead',null,'discovery','active'),
  ('abcd0000-0000-0000-0000-0000000000f6','aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f6','lead','new_lead',null,'discovery','active'),
  ('abcd0000-0000-0000-0000-0000000000f7','aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f7','supplier','lost',null,'discovery','archived'),
  ('abcd0000-0000-0000-0000-0000000000f2','aaaa0000-0000-0000-0000-0000000000f2','cccc0000-0000-0000-0000-0000000000f2','lead','new_lead',null,'discovery','active');
-- Alice also has a SECOND (inactive, supplier) relationship — multi-relationship person.
insert into contact_relationships (id, tenant_id, person_id, relationship_type, lifecycle_stage_key, source, status) values
  ('abcd0000-0000-0000-0000-0000000000fa','aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','supplier','nurture','manual','inactive');

insert into contact_points (id, tenant_id, person_id, channel, value, normalized_value, is_primary) values
  ('eeee0000-0000-0000-0000-0000000000f1','aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email','alice@mc.test','alice@mc.test',true),
  ('eeee0000-0000-0000-0000-0000000000f2','aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email','alice.work@mc.test','alice.work@mc.test',false);

insert into communication_preferences (tenant_id, person_id, channel, state, source, effective_at) values
  ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email','subscribed','signup', now() - interval '10 days'),
  ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f4','email','unsubscribed','unsubscribe_link', now() - interval '10 days');

-- suppressions: Sam via NORMALISED phone destination (his scalar is formatted)
-- and via email destination; Pat via PERSON scope.
insert into contact_suppressions (tenant_id, channel, normalized_value, reason) values
  ('aaaa0000-0000-0000-0000-0000000000f1','email','sam@mc.test','hard_bounce'),
  ('aaaa0000-0000-0000-0000-0000000000f1','phone','+447700900555','provider_policy');
insert into contact_suppressions (tenant_id, person_id, channel, reason) values
  ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f6','email','manual');

insert into marketing_tags (id, tenant_id, key, label, tone) values
  ('f1f10000-0000-0000-0000-0000000000f1','aaaa0000-0000-0000-0000-0000000000f1','vip','VIP','positive');
insert into contact_tag_assignments (tenant_id, person_id, tag_id, assigned_by) values
  ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','f1f10000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1');
insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                          interaction_type, direction, occurred_at, subject, related_person_id) values
  ('aaaa0000-0000-0000-0000-0000000000f1','gmail','email','email_messages', gen_random_uuid(),
   'email_message','inbound', now() - interval '1 hour', 'Boiler service enquiry',
   'cccc0000-0000-0000-0000-0000000000f1');

insert into customer_cards (id, tenant_id, person_id, title, context) values
  ('abab0000-0000-0000-0000-0000000000f1','aaaa0000-0000-0000-0000-0000000000f1',
   'cccc0000-0000-0000-0000-0000000000f1','Alice Example',
   '{"projection": {"health": "green"},
     "marketing": {"attribution": {"source": "google_ads"}, "campaigns": ["c1"]}}'::jsonb);

-- ── (1) Inclusion + classified definition (ACTIVE relationship) ─────────────
do $$
declare l jsonb; c jsonb;
begin
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1', '{"limit":50}');
  assert jsonb_array_length(l->'items') = 6, 'include-all: all 6 tenant People listed';
  c := marketing_contacts_counts('aaaa0000-0000-0000-0000-0000000000f1');
  -- Dora (no rel) and Archie (only archived) are both UNCLASSIFIED
  assert (c->>'total')::int = 6 and (c->>'unclassified')::int = 2,
    'classified = has an ACTIVE relationship (archived-only Person is unclassified)';
  update marketing_settings set include_all_discovered = false
    where tenant_id = 'aaaa0000-0000-0000-0000-0000000000f1';
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1', '{"limit":50}');
  assert jsonb_array_length(l->'items') = 4,
    'classified-only: 4 People (no Dora, no archived-only Archie)';
  update marketing_settings set include_all_discovered = true
    where tenant_id = 'aaaa0000-0000-0000-0000-0000000000f1';
end $$;

-- ── (2) Relationship filters: ONE row satisfies ALL supplied predicates ─────
do $$
declare l jsonb;
begin
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
        '{"relationship_status":"archived"}');
  assert jsonb_array_length(l->'items') = 1
     and l->'items'->0->>'display_name' = 'Archie Archived', 'archived filter works';
  -- the PROJECTED relationship is the row that satisfied the filters
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
        '{"relationship_status":"inactive"}');
  assert jsonb_array_length(l->'items') = 1
     and l->'items'->0->>'display_name' = 'Alice Example',
    'inactive filter finds the multi-relationship person';
  assert l->'items'->0->>'relationship_status' = 'inactive'
     and l->'items'->0->>'relationship_id' = 'abcd0000-0000-0000-0000-0000000000fa',
    'the projected relationship IS the matching (inactive) row, deterministically';
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
        '{"relationship_type":"supplier"}');
  assert jsonb_array_length(l->'items') = 2, 'type filter spans all relationships';
  -- ALL supplied relationship predicates must hold on the SAME row
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
        '{"relationship_type":"supplier","relationship_status":"active"}');
  assert jsonb_array_length(l->'items') = 0,
    'type+status must match the same relationship (no active supplier exists)';
  -- lifecycle (active row: engaged) + type (inactive row: supplier) can NEVER
  -- be satisfied by two different rows
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
        '{"lifecycle":"engaged","relationship_type":"supplier"}');
  assert jsonb_array_length(l->'items') = 0,
    'lifecycle+type from DIFFERENT rows never match';
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
        '{"lifecycle":"nurture","relationship_type":"supplier","relationship_status":"inactive"}');
  assert jsonb_array_length(l->'items') = 1
     and l->'items'->0->>'relationship_id' = 'abcd0000-0000-0000-0000-0000000000fa',
    'coherent triple matches ONE row and projects it';
  -- owner is a relationship predicate on the same row
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
        jsonb_build_object('owner_id','bbbb0000-0000-0000-0000-0000000000f2',
                           'relationship_type','supplier'));
  assert jsonb_array_length(l->'items') = 0,
    'owner (active lead row) + type (inactive supplier row) never match';
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
        jsonb_build_object('owner_id','bbbb0000-0000-0000-0000-0000000000f2'));
  assert jsonb_array_length(l->'items') = 1
     and l->'items'->0->>'relationship_id' = 'abcd0000-0000-0000-0000-0000000000f1',
    'owner filter matches and projects the owning row';
  -- relationship SOURCE is part of the same single-row contract
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
        '{"source":"manual","relationship_status":"active"}');
  assert jsonb_array_length(l->'items') = 0,
    'source (manual, inactive row) + status active never match';
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1', '{"source":"manual"}');
  assert jsonb_array_length(l->'items') = 1
     and l->'items'->0->>'relationship_id' = 'abcd0000-0000-0000-0000-0000000000fa',
    'source filter matches the manual relationship row';
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
        '{"relationship_type":"lead","relationship_status":"active"}');
  assert jsonb_array_length(l->'items') = 4, 'combined filter finds active leads';
  -- no duplicated rows for multi-relationship people; display rel without
  -- filters stays the documented current relationship (active first)
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1', '{"search":"alice"}');
  assert jsonb_array_length(l->'items') = 1, 'multi-relationship person appears once';
  assert l->'items'->0->>'relationship_status' = 'active',
    'without relationship filters the display relationship is the current one';
end $$;

-- ── (3) Invalid inputs → clean 22023 ────────────────────────────────────────
do $$
begin
  begin
    perform marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
      '{"cursor": {"v": "not-a-time", "id": "not-a-uuid"}, "sort": "created"}');
    assert false, 'malformed cursor must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1', '{"sort":"evil"}');
    assert false, 'invalid sort must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1', '{"owner_id":"zzz"}');
    assert false, 'invalid uuid filter must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- Typed cursor contract: null v is legal ONLY for last_contact; malformed
  -- cursors are rejected, never silently ignored.
  begin
    perform marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
      '{"sort":"created","cursor":{"v":null,"id":"cccc0000-0000-0000-0000-0000000000f1"}}');
    assert false, 'null cursor v with sort=created must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
      '{"sort":"name","cursor":{"v":null,"id":"cccc0000-0000-0000-0000-0000000000f1"}}');
    assert false, 'null cursor v with sort=name must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
      '{"cursor":"garbage"}');
    assert false, 'non-object cursor must raise 22023 (never silently ignored)';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
      '{"cursor":{"id":"cccc0000-0000-0000-0000-0000000000f1"}}');
    assert false, 'cursor without v must raise 22023';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ── (4) Pagination incl. NULL last-contact cursors ──────────────────────────
do $$
declare p1 jsonb; p2 jsonb; p3 jsonb; seen text[]; e jsonb;
begin
  -- name pagination (regression)
  p1 := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1', '{"limit":2}');
  p2 := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
          jsonb_build_object('limit', 2, 'cursor', p1->'next_cursor'));
  p3 := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
          jsonb_build_object('limit', 2, 'cursor', p2->'next_cursor'));
  seen := array[]::text[];
  for e in (select * from jsonb_array_elements((p1->'items') || (p2->'items') || (p3->'items')))
  loop
    assert not (e->>'person_id' = any(seen)), 'no person on two pages (name)';
    seen := seen || (e->>'person_id');
  end loop;
  assert array_length(seen, 1) = 6, 'name pages union to the full set';

  -- last_contact DESC: only Alice has an interaction → 5 null rows follow; the
  -- page-1 boundary cursor has v = null and MUST round-trip.
  p1 := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
          '{"sort":"last_contact","dir":"desc","limit":2}');
  assert p1->'items'->0->>'display_name' = 'Alice Example', 'contacted row first (desc)';
  assert (p1->'next_cursor'->'v') = 'null'::jsonb,
    'boundary cursor carries an explicit null v';
  p2 := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
          jsonb_build_object('sort','last_contact','dir','desc','limit',2,
                             'cursor', p1->'next_cursor'));
  p3 := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
          jsonb_build_object('sort','last_contact','dir','desc','limit',2,
                             'cursor', p2->'next_cursor'));
  seen := array[]::text[];
  for e in (select * from jsonb_array_elements((p1->'items') || (p2->'items') || (p3->'items')))
  loop
    assert not (e->>'person_id' = any(seen)), 'no person on two pages (null-heavy desc)';
    seen := seen || (e->>'person_id');
  end loop;
  assert array_length(seen, 1) = 6, 'null-heavy desc pages: no gaps, full set';

  -- last_contact ASC: nulls (as -infinity) come FIRST and span several pages.
  p1 := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
          '{"sort":"last_contact","dir":"asc","limit":2}');
  assert (p1->'next_cursor'->'v') = 'null'::jsonb, 'asc boundary cursor null v';
  p2 := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
          jsonb_build_object('sort','last_contact','dir','asc','limit',2,
                             'cursor', p1->'next_cursor'));
  p3 := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1',
          jsonb_build_object('sort','last_contact','dir','asc','limit',2,
                             'cursor', p2->'next_cursor'));
  seen := array[]::text[];
  for e in (select * from jsonb_array_elements((p1->'items') || (p2->'items') || (p3->'items')))
  loop
    assert not (e->>'person_id' = any(seen)), 'no person on two pages (null-heavy asc)';
    seen := seen || (e->>'person_id');
  end loop;
  assert array_length(seen, 1) = 6, 'null-heavy asc pages: no gaps, full set';
  assert (p3->'items'->(jsonb_array_length(p3->'items')-1))->>'display_name' = 'Alice Example',
    'contacted row last (asc)';
end $$;

-- ── (5) Eligibility: normalisation, linkage, precedence ─────────────────────
do $$
declare sup uuid;
begin
  -- formatted scalar phone matches its NORMALISED destination suppression
  assert marketing_contact_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f5','phone') = 'suppressed',
    'formatted scalar phone still hits normalised destination suppression';
  -- malformed destinations → invalid
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email', null, 'not-an-email') = 'invalid',
    'malformed email destination → invalid';
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','phone', null, 'abc') = 'invalid',
    'malformed phone destination → invalid';
  -- unlinked destination NEVER inherits the generic subscription
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email', null, 'stranger@else.test') = 'invalid',
    'unlinked destination → invalid (no generic-subscribe inheritance)';
  -- destination/contact-point mismatch → 22023
  begin
    perform marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f1','email',
      'eeee0000-0000-0000-0000-0000000000f1','alice.work@mc.test');
    assert false, 'cp/destination mismatch must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- PRECEDENCE: endpoint-specific unsubscribe (older) beats a NEWER generic subscribe
  insert into communication_preferences (tenant_id, person_id, contact_point_id, channel, state, source, effective_at)
    values ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1',
            'eeee0000-0000-0000-0000-0000000000f2','email','unsubscribed','manual', now() - interval '5 days');
  insert into communication_preferences (tenant_id, person_id, channel, state, source, effective_at)
    values ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1',
            'email','subscribed','manual', now() - interval '1 day');
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email','eeee0000-0000-0000-0000-0000000000f2') = 'unsubscribed',
    'NEWER generic subscribe never overrides endpoint-specific unsubscribe';
  -- later SAME-SCOPE resubscribe is honoured
  insert into communication_preferences (tenant_id, person_id, contact_point_id, channel, state, source, effective_at)
    values ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1',
            'eeee0000-0000-0000-0000-0000000000f2','email','subscribed','manual', now());
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email','eeee0000-0000-0000-0000-0000000000f2') = 'subscribed',
    'later same-scope resubscribe honoured';
  -- topic-specific unsubscribe beats newer generic subscribe FOR THAT TOPIC
  insert into communication_preferences (tenant_id, person_id, channel, topic, state, source, effective_at)
    values ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1',
            'email','newsletter','unsubscribed','manual', now() - interval '5 days');
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email','eeee0000-0000-0000-0000-0000000000f1', null, 'newsletter') = 'unsubscribed',
    'topic unsubscribe beats newer generic subscribe for that topic';
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email','eeee0000-0000-0000-0000-0000000000f1') = 'subscribed',
    'no-topic decision unaffected';
  -- invalid points are never usable primaries: primary invalid → fall to usable secondary
  update contact_points set verification_state='invalid'
    where id='eeee0000-0000-0000-0000-0000000000f1';
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email') = 'subscribed',
    'default endpoint skips the invalid primary and uses the usable secondary';
  update contact_points set verification_state='unverified'
    where id='eeee0000-0000-0000-0000-0000000000f1';
  -- explicit invalid point → invalid
  update contact_points set verification_state='invalid'
    where id='eeee0000-0000-0000-0000-0000000000f2';
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email','eeee0000-0000-0000-0000-0000000000f2') = 'invalid',
    'explicitly selected invalid point → invalid';
  update contact_points set verification_state='unverified'
    where id='eeee0000-0000-0000-0000-0000000000f2';
  -- suppression still beats everything (endpoint-scoped)
  insert into contact_suppressions (tenant_id, channel, normalized_value, reason)
    values ('aaaa0000-0000-0000-0000-0000000000f1','email','alice.work@mc.test','spam_complaint')
    returning id into sup;
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f1','email','eeee0000-0000-0000-0000-0000000000f2') = 'suppressed',
    'suppression beats resubscribed preference';
  update contact_suppressions set active=false, lifted_at=now() where id=sup;
  -- no usable endpoint at all
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f4','phone') = 'no_contact_point',
    'no endpoint → no_contact_point';
  -- INVALID EVIDENCE BEATS THE SCALAR: Dora's only point is INVALID and carries
  -- the SAME normalised value as her scalar email → the scalar is a known-bad
  -- endpoint; it never becomes the fallback and never inherits a generic
  -- subscription.
  insert into contact_points (id, tenant_id, person_id, channel, value, normalized_value, verification_state) values
    ('eeee0000-0000-0000-0000-0000000000d1','aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f3','email','dora@mc.test','dora@mc.test','invalid');
  assert marketing_contact_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f3','email') = 'invalid',
    'invalid point matching the scalar → invalid (scalar fallback suppressed)';
  insert into communication_preferences (tenant_id, person_id, channel, state, source)
    values ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f3','email','subscribed','manual');
  assert marketing_contact_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f3','email') = 'invalid',
    'invalid matching point never inherits a generic subscribed';
  -- a DIFFERENT usable endpoint is still selected over the invalid one
  insert into contact_points (id, tenant_id, person_id, channel, value, normalized_value) values
    ('eeee0000-0000-0000-0000-0000000000d2','aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f3','email','dora.alt@mc.test','dora.alt@mc.test');
  assert marketing_contact_eligibility('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f3','email') = 'subscribed',
    'a usable alternative endpoint is selected over the invalid match';
  delete from contact_points where id in
    ('eeee0000-0000-0000-0000-0000000000d1','eeee0000-0000-0000-0000-0000000000d2');
end $$;

-- ── (6) Detail: destination suppressions visible (incl. formatted scalar) ───
do $$
declare d jsonb;
begin
  d := marketing_contact_detail('aaaa0000-0000-0000-0000-0000000000f1',
                                'cccc0000-0000-0000-0000-0000000000f5');
  assert jsonb_array_length(d->'suppressions') = 2,
    'BOTH destination suppressions visible (email + normalised phone vs formatted scalar)';
  assert exists (select 1 from jsonb_array_elements(d->'suppressions') e
                  where e->>'scope'='destination' and e->>'destination'='+447700900555'),
    'phone destination suppression matched through normalisation';
  d := marketing_contact_detail('aaaa0000-0000-0000-0000-0000000000f1',
                                'cccc0000-0000-0000-0000-0000000000f1');
  assert jsonb_array_length(d->'relationships') = 2, 'ALL relationships returned';
  assert d->'relationships'->0->>'status' = 'active', 'active relationship ordered first';
  assert (d->'contact_points'->0) ? 'protected', 'contact points carry protected flag';
end $$;

-- ── (7) Identity ambiguity with PER-IDENTIFIER evidence ─────────────────────
do $$
declare r jsonb; n int; rec record;
begin
  -- Alice matches by EMAIL; Sam matches by PHONE — supplied together they are
  -- DIFFERENT candidate People and the evidence must say which matched which.
  r := marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1',
        '{"display_name":"Mixed Probe","email":"ALICE@mc.test","phone":"+44 7700 900 555"}'::jsonb,
        'ac0e0000-0000-4000-8000-0000000000b1');
  assert r->>'status' = 'ambiguous' and jsonb_array_length(r->'candidates') = 2,
    'mixed identifiers → ambiguous with both People';
  select * into rec from marketing_identity_conflicts
   where id = (r->>'conflict_id')::uuid;
  assert jsonb_array_length(rec.identifiers) = 2, 'evidence carries BOTH identifiers';
  assert exists (select 1 from jsonb_array_elements(rec.identifiers) i
                  where i->>'channel'='email'
                    and i->'candidate_person_ids' = '["cccc0000-0000-0000-0000-0000000000f1"]'::jsonb),
    'email evidence names exactly the email-matched Person';
  assert exists (select 1 from jsonb_array_elements(rec.identifiers) i
                  where i->>'channel'='phone'
                    and i->'candidate_person_ids' = '["cccc0000-0000-0000-0000-0000000000f5"]'::jsonb),
    'phone evidence names exactly the phone-matched Person (never mislabelled as email)';
  assert exists (select 1 from platform_events
                  where tenant_id='aaaa0000-0000-0000-0000-0000000000f1'
                    and event_type='marketing.identity_conflict.created'
                    and subject_id=rec.id and status='pending'),
    'identity_conflict.created event emitted';
  -- single match (case/format-insensitive) → existing, nothing written
  select count(*) into n from people where tenant_id='aaaa0000-0000-0000-0000-0000000000f1';
  r := marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1',
        '{"display_name":"Someone","email":"ALICE@mc.test"}'::jsonb,
        'ac0e0000-0000-4000-8000-0000000000b2');
  assert r->>'status' = 'existing', 'single email match → existing';
  assert (select count(*) from people where tenant_id='aaaa0000-0000-0000-0000-0000000000f1') = n,
    'nothing written on match';
  -- fresh identity with owner persisted; malformed email rejected
  r := marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1',
        '{"display_name":"Nina New","email":"nina@mc.test","owner_id":"bbbb0000-0000-0000-0000-0000000000f2"}'::jsonb,
        'ac0e0000-0000-4000-8000-0000000000b3');
  assert (r->>'created')::boolean and exists (
    select 1 from contact_relationships
     where person_id=(r->>'person_id')::uuid and owner_id='bbbb0000-0000-0000-0000-0000000000f2'),
    'create persists the supplied owner';
  begin
    perform marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"display_name":"Bad","email":"not-an-email"}'::jsonb,
      'ac0e0000-0000-4000-8000-0000000000b4');
    assert false, 'malformed email must raise 22023';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ── (8) Fingerprint-bound idempotency ───────────────────────────────────────
do $$
declare r1 jsonb; r2 jsonb; n int;
begin
  r1 := marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1',
        '{"display_name":"Ida Idem","email":"ida@mc.test"}'::jsonb,
        'ac0e0000-0000-4000-8000-0000000000a1');
  assert (r1->>'created')::boolean, 'first keyed create succeeds';
  select count(*) into n from people
   where tenant_id='aaaa0000-0000-0000-0000-0000000000f1' and primary_email='ida@mc.test';
  -- identical retry → stored result
  r2 := marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1',
        '{"display_name":"Ida Idem","email":"ida@mc.test"}'::jsonb,
        'ac0e0000-0000-4000-8000-0000000000a1');
  assert r2 = r1, 'identical retry returns the stored result';
  assert (select count(*) from people
           where tenant_id='aaaa0000-0000-0000-0000-0000000000f1'
             and primary_email='ida@mc.test') = n, 'no duplicate Person on retry';
  -- SAME KEY, DIFFERENT MATERIAL INPUT → 55000 (even with the same action)
  begin
    perform marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"display_name":"Ida CHANGED","email":"ida@mc.test"}'::jsonb,
      'ac0e0000-0000-4000-8000-0000000000a1');
    assert false, 'same key + different payload must raise 55000';
  exception when sqlstate '55000' then null;
  end;
  -- SAME KEY, DIFFERENT ACTOR → 55000
  begin
    perform marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'bbbb0000-0000-0000-0000-0000000000f2',
      '{"display_name":"Ida Idem","email":"ida@mc.test"}'::jsonb,
      'ac0e0000-0000-4000-8000-0000000000a1');
    assert false, 'same key + different actor must raise 55000';
  exception when sqlstate '55000' then null;
  end;
  -- NULL KEY → 22023 before ANY write
  select count(*) into n from people where tenant_id='aaaa0000-0000-0000-0000-0000000000f1';
  begin
    perform marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"display_name":"No Key Person"}'::jsonb, null);
    assert false, 'null idempotency key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  assert (select count(*) from people
           where tenant_id='aaaa0000-0000-0000-0000-0000000000f1') = n,
    'null-key create wrote nothing';
  -- NULL ACTOR → 22023 (a real same-tenant actor is mandatory)
  begin
    perform marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1', null,
      '{"display_name":"No Actor Person"}'::jsonb,
      'ac0e0000-0000-4000-8000-0000000000a2');
    assert false, 'null actor must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- FIRST/LAST NAME ARE MATERIAL: same key + changed first_name → 55000
  r1 := marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1',
        '{"display_name":"Fp Person","first_name":"Ann","last_name":"Field","email":"fp@mc.test"}'::jsonb,
        'ac0e0000-0000-4000-8000-0000000000a3');
  assert (r1->>'created')::boolean, 'fingerprint fixture created';
  begin
    perform marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"display_name":"Fp Person","first_name":"Anne","last_name":"Field","email":"fp@mc.test"}'::jsonb,
      'ac0e0000-0000-4000-8000-0000000000a3');
    assert false, 'same key + changed first_name must raise 55000';
  exception when sqlstate '55000' then null;
  end;
  begin
    perform marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"display_name":"Fp Person","first_name":"Ann","last_name":"Fields","email":"fp@mc.test"}'::jsonb,
      'ac0e0000-0000-4000-8000-0000000000a3');
    assert false, 'same key + changed last_name must raise 55000';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- ── (9) Relationship targeting, mandatory versions, no-op rejection ─────────
do $$
declare r jsonb; v int; rel uuid := 'abcd0000-0000-0000-0000-0000000000f1';
begin
  select version into v from contact_relationships where id = rel;
  -- update WITHOUT relationship_id on a classified person → 22023
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
      '{"lifecycle_stage_key":"qualified"}'::jsonb);
    assert false, 'classified person requires relationship_id';
  exception when sqlstate '22023' then null;
  end;
  -- update WITHOUT expected_version → 22023
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('relationship_id', rel, 'lifecycle_stage_key','qualified'));
    assert false, 'expected_version is mandatory for updates';
  exception when sqlstate '22023' then null;
  end;
  -- stale version → MK409, nothing changed
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('relationship_id', rel, 'lifecycle_stage_key','qualified',
                         'expected_version', v + 9));
    assert false, 'stale version must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  assert (select lifecycle_stage_key from contact_relationships where id = rel) = 'engaged',
    'stale update wrote nothing';
  -- NO-OP mutation (same values) → 22023, version NOT bumped
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('relationship_id', rel, 'lifecycle_stage_key','engaged',
                         'expected_version', v));
    assert false, 'no-op mutation must be rejected';
  exception when sqlstate '22023' then null;
  end;
  assert (select version from contact_relationships where id = rel) = v,
    'no-op rejected without a version bump';
  -- valid update: targets exactly this relationship; the person''s OTHER
  -- (inactive) relationship stays untouched
  r := marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
        jsonb_build_object('relationship_id', rel, 'lifecycle_stage_key','qualified',
                           'expected_version', v));
  assert (r->>'version')::int = v + 1, 'version incremented and returned';
  assert (select lifecycle_stage_key from contact_relationships
           where id='abcd0000-0000-0000-0000-0000000000fa') = 'nurture',
    'the other relationship is untouched';
  -- wrong-person relationship id → P0002
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('relationship_id', rel, 'lifecycle_stage_key','engaged',
                         'expected_version', v + 1));
    assert false, 'relationship of another person must raise P0002';
  exception when no_data_found then null;
  end;
  -- CREATE path: discovered person (no rows) → creates; owner persisted
  r := marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f3','bbbb0000-0000-0000-0000-0000000000f1',
        '{"lifecycle_stage_key":"engaged","owner_id":"bbbb0000-0000-0000-0000-0000000000f2"}'::jsonb);
  assert (r->>'created')::boolean and r->>'owner_id' = 'bbbb0000-0000-0000-0000-0000000000f2',
    'create-classification stores the owner';
  -- historical-only person (Archie, archived): create WITHOUT allow_new → 22023
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f7','bbbb0000-0000-0000-0000-0000000000f1',
      '{"lifecycle_stage_key":"new_lead"}'::jsonb);
    assert false, 'historical relationships must not be silently shadowed';
  exception when sqlstate '22023' then null;
  end;
  -- explicit allow_new → intentional new active relationship
  r := marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f7','bbbb0000-0000-0000-0000-0000000000f1',
        '{"lifecycle_stage_key":"new_lead","allow_new":true}'::jsonb);
  assert (r->>'created')::boolean, 'allow_new creates intentionally';
  -- REACTIVATION path: archive the new one, then reactivate the ORIGINAL by id
  perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
    'cccc0000-0000-0000-0000-0000000000f7','bbbb0000-0000-0000-0000-0000000000f1',
    jsonb_build_object('relationship_id', (r->>'relationship_id')::uuid,
                       'status','archived','expected_version',(r->>'version')::int));
  select version into v from contact_relationships where id='abcd0000-0000-0000-0000-0000000000f7';
  r := marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f7','bbbb0000-0000-0000-0000-0000000000f1',
        jsonb_build_object('relationship_id','abcd0000-0000-0000-0000-0000000000f7',
                           'status','active','expected_version', v));
  assert r->>'status' = 'active', 'explicit reactivation by id works';
end $$;

-- ── (9b) STRICT SHAPES + relationship contract: zero writes on rejection ────
do $$
declare
  fresh uuid;
  n_rel int; n_audit int; n_ev int;
begin
  insert into people (tenant_id, display_name, primary_email)
  values ('aaaa0000-0000-0000-0000-0000000000f1','Shape Probe','shape@mc.test')
  returning id into fresh;
  select count(*) into n_audit from audit_logs where tenant_id='aaaa0000-0000-0000-0000-0000000000f1';
  select count(*) into n_ev from platform_events where tenant_id='aaaa0000-0000-0000-0000-0000000000f1';

  -- classify: array / scalar / empty-object changes are rejected
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1', '[]'::jsonb);
    assert false, 'array changes must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1', '"scalar"'::jsonb);
    assert false, 'scalar changes must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1', '{}'::jsonb);
    assert false, 'empty changes must never create a relationship';
  exception when sqlstate '22023' then null;
  end;
  -- expected_version without relationship_id is invalid
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"lifecycle_stage_key":"engaged","expected_version":1}'::jsonb);
    assert false, 'expected_version without relationship_id must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- allow_new only applies to a NEW classification
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('relationship_id','abcd0000-0000-0000-0000-0000000000f1',
        'expected_version', (select version from contact_relationships
                              where id='abcd0000-0000-0000-0000-0000000000f1'),
        'allow_new', true, 'lifecycle_stage_key','engaged'));
    assert false, 'allow_new with relationship_id must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- non-active status on create is rejected, never silently ignored
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"lifecycle_stage_key":"engaged","status":"archived"}'::jsonb);
    assert false, 'non-active status on create must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- invalid booleans are rejected explicitly
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"lifecycle_stage_key":"engaged","allow_new":"yes"}'::jsonb);
    assert false, 'non-boolean allow_new must raise 22023';
  exception when sqlstate '22023' then null;
  end;

  -- update: malformed shapes are rejected before any write
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1', '[]'::jsonb);
    assert false, 'array update changes must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1', '{"person":[]}'::jsonb);
    assert false, 'array person changes must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"contact_points":{"add":{"channel":"email","value":"x@y.zz"}}}'::jsonb);
    assert false, 'non-array contact_points.add must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"contact_points":{"add":["scalar-item"]}}'::jsonb);
    assert false, 'scalar add item must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1',
      '{"contact_points":{"add":[{"channel":"email","value":"x@y.zz","make_primary":"yes"}]}}'::jsonb);
    assert false, 'non-boolean make_primary must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1', fresh,
      'bbbb0000-0000-0000-0000-0000000000f1', '{"relationship":[1,2]}'::jsonb);
    assert false, 'array relationship changes must raise 22023';
  exception when sqlstate '22023' then null;
  end;

  -- ZERO WRITES: nothing above touched relationships, audits or events
  select count(*) into n_rel from contact_relationships
   where tenant_id='aaaa0000-0000-0000-0000-0000000000f1' and person_id=fresh;
  assert n_rel = 0, 'rejected shapes created no relationship';
  assert (select count(*) from audit_logs
           where tenant_id='aaaa0000-0000-0000-0000-0000000000f1') = n_audit,
    'rejected shapes wrote no audits';
  assert (select count(*) from platform_events
           where tenant_id='aaaa0000-0000-0000-0000-0000000000f1') = n_ev,
    'rejected shapes emitted no events';
  -- create: details must be an object
  begin
    perform marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'bbbb0000-0000-0000-0000-0000000000f1', '["not","an","object"]'::jsonb,
      'ac0e0000-0000-4000-8000-0000000000a4');
    assert false, 'array details must raise 22023';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ── (10) Customer Card: nested merge preserved (regression) ─────────────────
do $$
declare card jsonb; v int;
begin
  select context into card from customer_cards where id='abab0000-0000-0000-0000-0000000000f1';
  assert card->'marketing'->>'lifecycle_stage_key' = 'qualified', 'card carries classification';
  assert card->'marketing'->>'relationship_id' = 'abcd0000-0000-0000-0000-0000000000f1',
    'card projection names the CURRENT relationship id';
  assert card->'marketing'->'attribution'->>'source' = 'google_ads', 'nested marketing keys survive';
  assert card->'projection'->>'health' = 'green', 'non-marketing context survives';
  -- editing a HISTORICAL (inactive) relationship must NOT overwrite the card
  -- with non-current state: the projection is recomputed from the display rel.
  select version into v from contact_relationships
   where id='abcd0000-0000-0000-0000-0000000000fa';
  perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
    'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
    jsonb_build_object('relationship_id','abcd0000-0000-0000-0000-0000000000fa',
                       'lifecycle_stage_key','lost','expected_version', v));
  select context into card from customer_cards where id='abab0000-0000-0000-0000-0000000000f1';
  assert card->'marketing'->>'relationship_id' = 'abcd0000-0000-0000-0000-0000000000f1'
     and card->'marketing'->>'lifecycle_stage_key' = 'qualified'
     and card->'marketing'->>'relationship_status' = 'active',
    'card still projects the ACTIVE relationship after a historical-row edit';
end $$;

-- ── (11) Precise per-field events (actual types + payloads) ─────────────────
do $$
declare ev record; r jsonb; v int; rel uuid := 'abcd0000-0000-0000-0000-0000000000f1';
begin
  select * into ev from platform_events
   where tenant_id='aaaa0000-0000-0000-0000-0000000000f1'
     and event_type='marketing.contact.lifecycle_changed'
     and subject_id='cccc0000-0000-0000-0000-0000000000f1' and status='pending';
  assert found, 'lifecycle_changed event emitted';
  assert ev.payload->'current'->>'from' = 'engaged'
     and ev.payload->'current'->>'to' = 'qualified'
     and (ev.payload->'current'->>'version') is not null
     and (ev.payload->'current'->>'actor') is not null,
    'lifecycle event carries from/to/version/actor';
  -- owner change → owner_changed (and consecutive transitions accumulate)
  select version into v from contact_relationships where id = rel;
  r := marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
        jsonb_build_object('relationship_id', rel, 'clear_owner', true,
                           'expected_version', v));
  select * into ev from platform_events
   where tenant_id='aaaa0000-0000-0000-0000-0000000000f1'
     and event_type='marketing.contact.owner_changed'
     and subject_id='cccc0000-0000-0000-0000-0000000000f1' and status='pending';
  assert found and ev.payload->'current'->>'to' is null, 'owner_changed emitted with null to';
  -- status change → relationship_status_changed
  select version into v from contact_relationships where id = rel;
  r := marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
        jsonb_build_object('relationship_id', rel, 'status','inactive',
                           'expected_version', v));
  assert exists (select 1 from platform_events
                  where event_type='marketing.contact.relationship_status_changed'
                    and subject_id='cccc0000-0000-0000-0000-0000000000f1' and status='pending'),
    'relationship_status_changed emitted';
  -- restore
  select version into v from contact_relationships where id = rel;
  perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
    'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
    jsonb_build_object('relationship_id', rel, 'status','active','expected_version', v));
  -- consecutive lifecycle transitions accumulate on the pending event
  select version into v from contact_relationships where id = rel;
  perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
    'cccc0000-0000-0000-0000-0000000000f1','bbbb0000-0000-0000-0000-0000000000f1',
    jsonb_build_object('relationship_id', rel, 'lifecycle_stage_key','survey_quote',
                       'expected_version', v));
  select * into ev from platform_events
   where event_type='marketing.contact.lifecycle_changed'
     and subject_id='cccc0000-0000-0000-0000-0000000000f1' and status='pending';
  assert jsonb_array_length(ev.payload->'transitions') >= 2
     and ev.payload->'current'->>'to' = 'survey_quote',
    'consecutive lifecycle transitions preserved; current = latest';
end $$;

-- ── (11b) Event dedup is truly KEY-based ────────────────────────────────────
do $$
declare ev record; subj uuid := gen_random_uuid();
begin
  -- same k, DIFFERENT timestamps → exactly one transition; current unchanged
  perform marketing_event_append('aaaa0000-0000-0000-0000-0000000000f1',
    'marketing.test.k_dedup', 'probe', subj, 'test',
    jsonb_build_object('k','fact-1','payload','first','at','2026-01-01T00:00:00Z'));
  perform marketing_event_append('aaaa0000-0000-0000-0000-0000000000f1',
    'marketing.test.k_dedup', 'probe', subj, 'test',
    jsonb_build_object('k','fact-1','payload','retry','at','2026-01-02T09:09:09Z'));
  select * into ev from platform_events
   where tenant_id='aaaa0000-0000-0000-0000-0000000000f1'
     and event_type='marketing.test.k_dedup' and subject_id=subj and status='pending';
  assert jsonb_array_length(ev.payload->'transitions') = 1,
    'identical k with a different timestamp adds NO transition';
  assert ev.payload->'current'->>'payload' = 'first',
    'current only changes when a genuinely new key is accepted';
  -- a NEW k appends independently and becomes current
  perform marketing_event_append('aaaa0000-0000-0000-0000-0000000000f1',
    'marketing.test.k_dedup', 'probe', subj, 'test',
    jsonb_build_object('k','fact-2','payload','second','at','2026-01-03T00:00:00Z'));
  select * into ev from platform_events
   where tenant_id='aaaa0000-0000-0000-0000-0000000000f1'
     and event_type='marketing.test.k_dedup' and subject_id=subj and status='pending';
  assert jsonb_array_length(ev.payload->'transitions') = 2
     and ev.payload->'current'->>'payload' = 'second',
    'different keys append independently; current = latest accepted key';
  -- an empty/missing k is a contract violation
  begin
    perform marketing_event_append('aaaa0000-0000-0000-0000-0000000000f1',
      'marketing.test.k_dedup', 'probe', subj, 'test',
      jsonb_build_object('payload','no key','at','2026-01-04T00:00:00Z'));
    assert false, 'entries without a non-empty k must raise 22023';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ── (12) Edit surface: contact-point UPDATE, protection, optimistic ts ──────
do $$
declare r jsonb; d jsonb; cpid uuid; ts timestamptz; conflict_n int;
begin
  -- add a point, then EDIT its value/label with optimistic ts
  r := marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
        '{"contact_points":{"add":[{"channel":"phone","value":"+44 7700 900123","label":"mobile","make_primary":true}]}}'::jsonb);
  d := marketing_contact_detail('aaaa0000-0000-0000-0000-0000000000f1',
                                'cccc0000-0000-0000-0000-0000000000f4');
  select (e->>'id')::uuid, (e->>'updated_at')::timestamptz into cpid, ts
    from jsonb_array_elements(d->'contact_points') e
   where e->>'channel'='phone' limit 1;
  assert exists (select 1 from platform_events
                  where event_type='marketing.contact_point.created'
                    and subject_id='cccc0000-0000-0000-0000-0000000000f4' and status='pending'),
    'contact_point.created event emitted';
  -- stale expected_updated_at → MK409
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
        jsonb_build_object('id', cpid, 'expected_updated_at', ts - interval '1 hour',
                           'value','+44 7700 900124')))));
    assert false, 'stale contact-point ts must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  -- valid edit: value + label; identity evidence recorded when value matches others
  select count(*) into conflict_n from marketing_identity_conflicts
   where tenant_id='aaaa0000-0000-0000-0000-0000000000f1';
  r := marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
        jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
          jsonb_build_object('id', cpid, 'expected_updated_at', ts,
                            'value','+44 7700 900555', 'label','shared line')))));
  d := marketing_contact_detail('aaaa0000-0000-0000-0000-0000000000f1',
                                'cccc0000-0000-0000-0000-0000000000f4');
  assert exists (select 1 from jsonb_array_elements(d->'contact_points') e
                  where e->>'normalized_value'='+447700900555' and e->>'label'='shared line'),
    'value normalised + label updated';
  assert (select count(*) from marketing_identity_conflicts
           where tenant_id='aaaa0000-0000-0000-0000-0000000000f1') = conflict_n + 1,
    'endpoint change matching another Person records identity evidence (no block)';
  assert exists (select 1 from platform_events
                  where event_type='marketing.contact_point.updated'
                    and subject_id='cccc0000-0000-0000-0000-0000000000f4' and status='pending'),
    'contact_point.updated event emitted';
  assert exists (select 1 from audit_logs where action='marketing.contact_point.updated'),
    'contact-point update audited';
  assert exists (select 1 from audit_logs
                  where action='marketing.contact_point.updated'
                    and detail->>'value_from' = '+44 7700 900123'
                    and detail->>'value_to' = '+44 7700 900555'),
    'audit carries BEFORE/AFTER values for the real change';
  assert exists (select 1 from audit_logs
                  where action='marketing.identity_conflict.created'
                    and detail->>'reason' = 'contact_point_value_change'),
    'endpoint-edit identity review has AUDIT evidence, not only an event';
  -- PROTECTED: verified value cannot be edited (MK403); label still can
  update contact_points set verification_state='verified' where id=cpid;
  select (e->>'updated_at')::timestamptz into ts
    from jsonb_array_elements(
           marketing_contact_detail('aaaa0000-0000-0000-0000-0000000000f1',
                                    'cccc0000-0000-0000-0000-0000000000f4') -> 'contact_points') e
   where (e->>'id')::uuid = cpid;
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
        jsonb_build_object('id', cpid, 'expected_updated_at', ts, 'value','+44 7700 900999')))));
    assert false, 'verified value edit must raise MK403';
  exception when sqlstate 'MK403' then null;
  end;
  perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
    'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
    jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
      jsonb_build_object('id', cpid, 'expected_updated_at', ts, 'label','verified line')))));
  -- person-field protection on verified people (regression)
  update people set verified=true where id='cccc0000-0000-0000-0000-0000000000f4';
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
      '{"person":{"display_name":"Hacked"}}'::jsonb);
    assert false, 'verified person names protected (MK403)';
  exception when sqlstate 'MK403' then null;
  end;
  update people set verified=false where id='cccc0000-0000-0000-0000-0000000000f4';
end $$;

-- ── (12b) No-op edits: skipped without events; wholly-ineffective → 22023 ───
do $$
declare
  r jsonb; d jsonb; ev record;
  cpid uuid; ts timestamptz;
  phone_cpid uuid; phone_ts timestamptz;
  cur_name text; conflict_n int;
begin
  -- fresh manual email point to probe against
  r := marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
        '{"contact_points":{"add":[{"channel":"email","value":"Noop.Probe@mc.test","label":"probe"}]}}'::jsonb);
  d := marketing_contact_detail('aaaa0000-0000-0000-0000-0000000000f1',
                                'cccc0000-0000-0000-0000-0000000000f4');
  select (e->>'id')::uuid, (e->>'updated_at')::timestamptz into cpid, ts
    from jsonb_array_elements(d->'contact_points') e
   where e->>'normalized_value'='noop.probe@mc.test';
  select (e->>'id')::uuid, (e->>'updated_at')::timestamptz into phone_cpid, phone_ts
    from jsonb_array_elements(d->'contact_points') e
   where e->>'channel'='phone' and (e->>'is_primary')::boolean limit 1;

  -- (a) identical value + identical label → wholly no-op → 22023, no transition
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
        jsonb_build_object('id', cpid, 'expected_updated_at', ts,
                           'value', 'Noop.Probe@mc.test', 'label', 'probe')))));
    assert false, 'wholly no-op contact-point update must raise 22023';
  exception when sqlstate '22023' then null;
  end;

  -- (b) make_primary on the CURRENT primary with no other change → no-op → 22023
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
        jsonb_build_object('id', phone_cpid, 'expected_updated_at', phone_ts,
                           'make_primary', true)))));
    assert false, 'make_primary on the current primary must raise 22023';
  exception when sqlstate '22023' then null;
  end;

  -- (c) the set_primary shorthand is REMOVED — it bypassed the optimistic
  --     contract; primary changes go through update items with a token
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('contact_points',
        jsonb_build_object('set_primary', phone_cpid)));
    assert false, 'the removed set_primary shorthand must be rejected';
  exception when sqlstate '22023' then null;
  end;

  -- (d) identical person fields → no-op → 22023 (no contact.updated emission)
  select display_name into cur_name from people
   where id='cccc0000-0000-0000-0000-0000000000f4';
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('person', jsonb_build_object('display_name', cur_name)));
    assert false, 'identical person fields must raise 22023';
  exception when sqlstate '22023' then null;
  end;

  -- (e) mixed request: identical value + CHANGED label → succeeds; the event
  --     flags say exactly what changed; no identity conflict for an unchanged value
  select count(*) into conflict_n from marketing_identity_conflicts
   where tenant_id='aaaa0000-0000-0000-0000-0000000000f1';
  r := marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
        jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
          jsonb_build_object('id', cpid, 'expected_updated_at', ts,
                             'value', 'Noop.Probe@mc.test', 'label', 'probe renamed')))));
  select * into ev from platform_events
   where event_type='marketing.contact_point.updated'
     and subject_id='cccc0000-0000-0000-0000-0000000000f4' and status='pending';
  assert (ev.payload->'current'->>'label_changed')::boolean
     and not (ev.payload->'current'->>'value_changed')::boolean
     and not (ev.payload->'current'->>'made_primary')::boolean,
    'event flags reflect the ACTUAL change (label only)';
  assert (select count(*) from marketing_identity_conflicts
           where tenant_id='aaaa0000-0000-0000-0000-0000000000f1') = conflict_n,
    'unchanged value records no identity conflict';

  -- (f) protection guards CHANGES: identical value on a VERIFIED point is a
  --     no-op, not MK403 — a label-only edit alongside it still succeeds
  select (e->>'updated_at')::timestamptz into phone_ts
    from jsonb_array_elements(
           marketing_contact_detail('aaaa0000-0000-0000-0000-0000000000f1',
                                    'cccc0000-0000-0000-0000-0000000000f4') -> 'contact_points') e
   where (e->>'id')::uuid = phone_cpid;
  r := marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
        jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
          jsonb_build_object('id', phone_cpid, 'expected_updated_at', phone_ts,
                             'value', '+44 7700 900555', 'label', 'still verified')))));
  assert exists (select 1 from contact_points
                  where id=phone_cpid and label='still verified'
                    and verification_state='verified'),
    'identical value on a protected point is a no-op; the label edit lands';

  -- (g) an INVALID point can never be made primary
  update contact_points set verification_state='invalid' where id=cpid;
  select updated_at into ts from contact_points where id=cpid;
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
        jsonb_build_object('id', cpid, 'expected_updated_at', ts, 'make_primary', true)))));
    assert false, 'invalid point must never become primary';
  exception when sqlstate '22023' then null;
  end;
  assert not exists (select 1 from contact_points where id=cpid and is_primary),
    'invalid point stayed non-primary';
  update contact_points set verification_state='unverified' where id=cpid;

  -- (h) a STALE token on a primary change → MK409 (checked before no-op logic)
  select updated_at into ts from contact_points where id=cpid;
  begin
    perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f4','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
        jsonb_build_object('id', cpid, 'expected_updated_at', ts - interval '1 second',
                           'make_primary', true)))));
    assert false, 'stale token on a primary change must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
end $$;

-- ── (13) Tags: audits + PRECISE events (incl. tag.created) ──────────────────
do $$
declare r jsonb; tid uuid; ev record;
begin
  r := marketing_tag_mutate('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1','create','{"label":"Hot Lead","tone":"attention"}');
  tid := (r->>'id')::uuid;
  assert exists (select 1 from platform_events
                  where event_type='marketing.tag.created' and subject_id=tid and status='pending'),
    'tag.created EVENT emitted (not only audited)';
  r := marketing_tag_mutate('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1','assign',
        jsonb_build_object('tag_id', tid, 'person_id','cccc0000-0000-0000-0000-0000000000f1'));
  r := marketing_tag_mutate('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1','assign',
        jsonb_build_object('tag_id', tid, 'person_id','cccc0000-0000-0000-0000-0000000000f1'));
  assert (r->>'idempotent')::boolean, 're-assign is idempotent';
  select * into ev from platform_events
   where event_type='marketing.contact.tag_changed'
     and subject_id='cccc0000-0000-0000-0000-0000000000f1' and status='pending';
  assert jsonb_array_length(ev.payload->'transitions') = 1,
    'idempotent re-assign adds no transition';
  r := marketing_tag_mutate('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1','remove',
        jsonb_build_object('tag_id', tid, 'person_id','cccc0000-0000-0000-0000-0000000000f1'));
  select * into ev from platform_events
   where event_type='marketing.contact.tag_changed'
     and subject_id='cccc0000-0000-0000-0000-0000000000f1' and status='pending';
  assert jsonb_array_length(ev.payload->'transitions') = 2, 'remove appended as distinct fact';
end $$;

-- ── (14) Owner directory + validation regressions ───────────────────────────
do $$
declare o jsonb;
begin
  o := marketing_owners_list('aaaa0000-0000-0000-0000-0000000000f1');
  assert jsonb_array_length(o) = 2, 'owners = tenant operational users only';
  begin
    perform marketing_classify_contact('aaaa0000-0000-0000-0000-0000000000f1',
      'cccc0000-0000-0000-0000-0000000000f3','bbbb0000-0000-0000-0000-0000000000f1',
      jsonb_build_object('relationship_id',
        (select id from contact_relationships
          where tenant_id='aaaa0000-0000-0000-0000-0000000000f1'
            and person_id='cccc0000-0000-0000-0000-0000000000f3' and status='active'),
        'owner_id','bbbb0000-0000-0000-0000-0000000000f4',
        'expected_version', 1));
    assert false, 'viewer owner rejected';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ── (15) Corrupted cross-tenant fixtures cannot leak ────────────────────────
do $$
declare l jsonb; d jsonb;
begin
  update people set company_id='dddd0000-0000-0000-0000-0000000000f2'
   where id='cccc0000-0000-0000-0000-0000000000f5';
  l := marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1', '{"search":"sam"}');
  assert l->'items'->0->>'company_name' is null, 'cross-tenant company never leaks (list)';
  alter table contact_relationships disable trigger contact_relationships_tenant_guard;
  update contact_relationships set owner_id='bbbb0000-0000-0000-0000-0000000000f3'
   where id='abcd0000-0000-0000-0000-0000000000f5';
  alter table contact_relationships enable trigger contact_relationships_tenant_guard;
  d := marketing_contact_detail('aaaa0000-0000-0000-0000-0000000000f1',
                                'cccc0000-0000-0000-0000-0000000000f5');
  assert d->'relationships'->0->>'owner_name' is null, 'cross-tenant owner never leaks (detail)';
end $$;

-- ── (15b) Corrupted refs cannot leak into IDENTITY EVIDENCE ─────────────────
do $$
declare r jsonb; rec record; d jsonb; cpid uuid; ts timestamptz;
begin
  -- two legit tenant-1 People share leak@mc.test; a CORRUPT tenant-1 contact
  -- point references a TENANT-2 Person with the same address
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value) values
    ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f3','email','leak@mc.test','leak@mc.test'),
    ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f4','email','leak@mc.test','leak@mc.test');
  alter table contact_points disable trigger contact_points_tenant_guard;
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value) values
    ('aaaa0000-0000-0000-0000-0000000000f1','cccc0000-0000-0000-0000-0000000000f2','email','leak@mc.test','leak@mc.test');
  alter table contact_points enable trigger contact_points_tenant_guard;

  -- CREATE ambiguity: the foreign Person id appears NOWHERE
  r := marketing_create_contact('aaaa0000-0000-0000-0000-0000000000f1',
        'bbbb0000-0000-0000-0000-0000000000f1',
        '{"display_name":"Leak Probe","email":"leak@mc.test"}'::jsonb,
        'ac0e0000-0000-4000-8000-0000000000c1');
  assert r->>'status' = 'ambiguous' and jsonb_array_length(r->'candidates') = 2,
    'only the two same-tenant People are candidates';
  assert not exists (select 1 from jsonb_array_elements(r->'candidates') e
                      where e->>'person_id' = 'cccc0000-0000-0000-0000-0000000000f2'),
    'foreign Person never appears in returned candidates';
  select * into rec from marketing_identity_conflicts
   where id = (r->>'conflict_id')::uuid;
  assert not ('cccc0000-0000-0000-0000-0000000000f2'::uuid = any(rec.candidate_person_ids)),
    'foreign Person never enters candidate_person_ids';
  assert not exists (select 1 from jsonb_array_elements(rec.identifiers) i,
                            jsonb_array_elements_text(i->'candidate_person_ids') pid
                      where pid = 'cccc0000-0000-0000-0000-0000000000f2'),
    'foreign Person never enters stored per-identifier evidence';

  -- CONTACT-POINT EDIT ambiguity: same guarantee on the edit path
  perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
    'cccc0000-0000-0000-0000-0000000000f5','bbbb0000-0000-0000-0000-0000000000f1',
    '{"contact_points":{"add":[{"channel":"email","value":"edit.probe@mc.test"}]}}'::jsonb);
  d := marketing_contact_detail('aaaa0000-0000-0000-0000-0000000000f1',
                                'cccc0000-0000-0000-0000-0000000000f5');
  select (e->>'id')::uuid, (e->>'updated_at')::timestamptz into cpid, ts
    from jsonb_array_elements(d->'contact_points') e
   where e->>'normalized_value'='edit.probe@mc.test';
  perform marketing_update_contact('aaaa0000-0000-0000-0000-0000000000f1',
    'cccc0000-0000-0000-0000-0000000000f5','bbbb0000-0000-0000-0000-0000000000f1',
    jsonb_build_object('contact_points', jsonb_build_object('update', jsonb_build_array(
      jsonb_build_object('id', cpid, 'expected_updated_at', ts, 'value', 'leak@mc.test')))));
  select * into rec from marketing_identity_conflicts
   where tenant_id='aaaa0000-0000-0000-0000-0000000000f1'
     and requested->>'edited_person_id' = 'cccc0000-0000-0000-0000-0000000000f5'
   order by created_at desc limit 1;
  assert found and array_length(rec.candidate_person_ids, 1) = 2
     and not ('cccc0000-0000-0000-0000-0000000000f2'::uuid = any(rec.candidate_person_ids)),
    'edit-path evidence carries only same-tenant People';
end $$;

-- ── (16) RPC execute denied to authenticated ────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000f1';
do $$
begin
  begin
    perform marketing_contacts_list('aaaa0000-0000-0000-0000-0000000000f1', '{}');
    assert false, 'list RPC must not be executable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_normalize_endpoint('email', 'x@y.zz');
    assert false, 'normalizer must not be executable by authenticated';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'marketing_contacts.test.sql: ALL ASSERTIONS PASSED' as result;
rollback;
