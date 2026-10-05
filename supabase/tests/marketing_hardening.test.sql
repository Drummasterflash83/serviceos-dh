-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_hardening.test.sql
--
-- Proves the Marketing Phase-1 HARDENING invariants (migration 20260828120000):
--   (1) Canonical resolver: owner/admin full defaults; ops working subset (no
--       launch/senders/ads/access-manage); viewer nothing; viewer + explicit grant
--       gains marketing.view; explicit deny strips an owner/admin role default;
--       marketing_enabled=false strips everything; unknown profile → nothing.
--   (2) STRUCTURAL module access (RLS): a same-tenant viewer WITHOUT
--       marketing.view reads ZERO rows from every protected Marketing table
--       (direct-read bypass closed); explicit deny revokes an admin's direct
--       reads; an explicitly granted viewer CAN read; cross-tenant users read
--       ZERO; grants are visible only to access managers; disabling Marketing
--       revokes reads tenant-wide.
--   (3) Browser writes remain impossible (no client write policies).
--   (4) STRUCTURAL tenant consistency: cross-tenant person/company/contact-point/
--       tag/segment/profile references and unknown lifecycle stages are rejected
--       by triggers even for service-role writes; valid same-tenant rows and
--       platform-operator actors succeed.
--   (5) Contact-point identity semantics: shared endpoints across People are
--       allowed (ambiguity preserved for identity review); duplicates per Person
--       rejected; one primary per (person, channel) enforced.
--   (6) Suppression integrity: destination-, person- and contact-point-scoped
--       active dedup; target required; lift preserves history and re-suppression
--       works.
--   (7) Governed materialisation: RPC execute is revoked from authenticated;
--       service-side call is idempotent and audited; a supplied actor must be a
--       profile of the target tenant (tenantless/cross-tenant actors rejected;
--       null actor = system, audited as 'service').
--   (8) Resolver grant boundary: authenticated callers can execute ONLY the
--       self-only wrapper (marketing_current_user_permissions) — the
--       arbitrary-profile resolver is service-role only, so cross-profile
--       permission inspection is impossible; anon has no execution path.
--   (9) Tenantless profiles are NEVER tenant actors: with or without an active
--       platform.controlplane.admin grant, a null-tenant profile is rejected
--       from every Marketing profile-reference column (platform authority
--       deliberately confers no tenant-data actorship — 20260822120000).
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into tenants (id, slug, display_name, industry) values
  ('aaaa0000-0000-0000-0000-0000000000e1','mh-t1','Hardening Tenant 1','hvac'),
  ('aaaa0000-0000-0000-0000-0000000000e2','mh-t2','Hardening Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb0000-0000-0000-0000-0000000000e1','owner-a@mh.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000e2','admin-a@mh.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000e3','ops-a@mh.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000e4','viewer-a@mh.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000e5','viewer-granted-a@mh.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000e6','admin-denied-a@mh.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000e7','admin-b@mh.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000e8','platform-op@mh.test',false,false);
update profiles set role='owner',  tenant_id='aaaa0000-0000-0000-0000-0000000000e1' where id='bbbb0000-0000-0000-0000-0000000000e1';
update profiles set role='admin',  tenant_id='aaaa0000-0000-0000-0000-0000000000e2' where id='bbbb0000-0000-0000-0000-0000000000e2';
update profiles set role='ops',    tenant_id='aaaa0000-0000-0000-0000-0000000000e1' where id='bbbb0000-0000-0000-0000-0000000000e3';
update profiles set role='viewer', tenant_id='aaaa0000-0000-0000-0000-0000000000e1' where id='bbbb0000-0000-0000-0000-0000000000e4';
update profiles set role='viewer', tenant_id='aaaa0000-0000-0000-0000-0000000000e1' where id='bbbb0000-0000-0000-0000-0000000000e5';
update profiles set role='admin',  tenant_id='aaaa0000-0000-0000-0000-0000000000e1' where id='bbbb0000-0000-0000-0000-0000000000e6';
update profiles set role='admin',  tenant_id='aaaa0000-0000-0000-0000-0000000000e7' where id='bbbb0000-0000-0000-0000-0000000000e7';
-- correct admin-a to tenant 1 and admin-b to tenant 2 (explicit, readable):
update profiles set role='admin', tenant_id='aaaa0000-0000-0000-0000-0000000000e1' where id='bbbb0000-0000-0000-0000-0000000000e2';
update profiles set role='admin', tenant_id='aaaa0000-0000-0000-0000-0000000000e2' where id='bbbb0000-0000-0000-0000-0000000000e7';
-- platform operator: no tenant
update profiles set role='openfolk', tenant_id=null where id='bbbb0000-0000-0000-0000-0000000000e8';

-- explicit grant + explicit deny
insert into marketing_access_grants (tenant_id, profile_id, permission, granted) values
  ('aaaa0000-0000-0000-0000-0000000000e1','bbbb0000-0000-0000-0000-0000000000e5','marketing.view', true),
  ('aaaa0000-0000-0000-0000-0000000000e1','bbbb0000-0000-0000-0000-0000000000e6','marketing.view', false);

insert into people (id, tenant_id, display_name, primary_email) values
  ('cccc0000-0000-0000-0000-0000000000e1','aaaa0000-0000-0000-0000-0000000000e1','Person A1','a1@mh.test'),
  ('cccc0000-0000-0000-0000-0000000000e2','aaaa0000-0000-0000-0000-0000000000e1','Person A2','a2@mh.test'),
  ('cccc0000-0000-0000-0000-0000000000e3','aaaa0000-0000-0000-0000-0000000000e2','Person B1','b1@mh.test');

insert into companies (id, tenant_id, name) values
  ('dddd0000-0000-0000-0000-0000000000e1','aaaa0000-0000-0000-0000-0000000000e1','Co A'),
  ('dddd0000-0000-0000-0000-0000000000e2','aaaa0000-0000-0000-0000-0000000000e2','Co B');

insert into marketing_tags (id, tenant_id, key, label) values
  ('eeee0000-0000-0000-0000-0000000000e1','aaaa0000-0000-0000-0000-0000000000e1','vip','VIP'),
  ('eeee0000-0000-0000-0000-0000000000e2','aaaa0000-0000-0000-0000-0000000000e2','vip','VIP');

insert into marketing_segments (id, tenant_id, name) values
  ('f0f00000-0000-0000-0000-0000000000e1','aaaa0000-0000-0000-0000-0000000000e1','Seg A'),
  ('f0f00000-0000-0000-0000-0000000000e2','aaaa0000-0000-0000-0000-0000000000e2','Seg B');

insert into contact_relationships (tenant_id, person_id, relationship_type) values
  ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','lead'),
  ('aaaa0000-0000-0000-0000-0000000000e2','cccc0000-0000-0000-0000-0000000000e3','lead');

-- ── (7a) Governed materialisation: idempotent + audited (service side). ────
do $$
declare r1 jsonb; r2 jsonb;
begin
  r1 := marketing_materialise_defaults('aaaa0000-0000-0000-0000-0000000000e1',
                                       'bbbb0000-0000-0000-0000-0000000000e1');
  assert (r1->>'created_settings')::boolean, 'first materialise creates settings';
  assert (r1->>'created_stages')::int = 8, 'first materialise copies 8 stages';
  r2 := marketing_materialise_defaults('aaaa0000-0000-0000-0000-0000000000e1',
                                       'bbbb0000-0000-0000-0000-0000000000e1');
  assert not (r2->>'created_settings')::boolean, 'second materialise is a no-op';
  assert (r2->>'created_stages')::int = 0, 'second materialise copies nothing';
  assert exists (select 1 from audit_logs
                  where tenant_id='aaaa0000-0000-0000-0000-0000000000e1'
                    and action='marketing.defaults.materialised'),
    'materialisation is audited';
end $$;

-- ── (1) Canonical resolver verdicts ─────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := marketing_effective_permissions('bbbb0000-0000-0000-0000-0000000000e1'); -- owner
  assert jsonb_array_length(v->'permissions') = 12, 'owner gets full set';
  v := marketing_effective_permissions('bbbb0000-0000-0000-0000-0000000000e2'); -- admin
  assert jsonb_array_length(v->'permissions') = 12, 'admin gets full set';
  v := marketing_effective_permissions('bbbb0000-0000-0000-0000-0000000000e3'); -- ops
  assert jsonb_array_length(v->'permissions') = 7, 'ops gets the working subset';
  assert not ((v->'permissions') ? 'marketing.campaigns.launch'), 'ops cannot launch';
  assert not ((v->'permissions') ? 'marketing.access.manage'), 'ops cannot manage access';
  v := marketing_effective_permissions('bbbb0000-0000-0000-0000-0000000000e4'); -- viewer
  assert jsonb_array_length(v->'permissions') = 0, 'viewer gets nothing by default';
  v := marketing_effective_permissions('bbbb0000-0000-0000-0000-0000000000e5'); -- viewer + grant
  assert (v->'permissions') ? 'marketing.view', 'explicitly granted viewer gains view';
  assert jsonb_array_length(v->'permissions') = 1, 'granted viewer gains ONLY the granted permission';
  v := marketing_effective_permissions('bbbb0000-0000-0000-0000-0000000000e6'); -- admin + deny
  assert not ((v->'permissions') ? 'marketing.view'), 'explicit deny strips an admin role default';
  assert (v->'permissions') ? 'marketing.campaigns.launch', 'deny removes only the denied permission';
  v := marketing_effective_permissions('00000000-0000-4000-8000-00000000dead'); -- unknown profile
  assert jsonb_array_length(v->'permissions') = 0 and (v->>'enabled')='false',
    'unknown profile resolves to nothing (fail-closed)';
end $$;

-- ── (2) Structural module access via RLS ────────────────────────────────────
-- same-tenant viewer WITHOUT marketing.view: ZERO rows from every protected table
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000e4';
do $$
begin
  assert (select count(*) from contact_relationships) = 0, 'viewer: relationships hidden';
  assert (select count(*) from marketing_settings) = 0, 'viewer: settings hidden';
  assert (select count(*) from marketing_lifecycle_stages) = 0, 'viewer: lifecycle (incl. template) hidden';
  assert (select count(*) from contact_points) = 0, 'viewer: contact points hidden';
  assert (select count(*) from communication_preferences) = 0, 'viewer: preferences hidden';
  assert (select count(*) from contact_suppressions) = 0, 'viewer: suppressions hidden';
  assert (select count(*) from marketing_tags) = 0, 'viewer: tags hidden';
  assert (select count(*) from contact_tag_assignments) = 0, 'viewer: tag assignments hidden';
  assert (select count(*) from marketing_segments) = 0, 'viewer: segments hidden';
  assert (select count(*) from marketing_campaigns) = 0, 'viewer: campaigns hidden';
  assert (select count(*) from marketing_access_grants) = 0, 'viewer: grants hidden';
  -- vocabulary stays readable (platform convention, like authority_permissions)
  assert (select count(*) from marketing_permissions) = 12, 'viewer: vocabulary readable';
end $$;
reset role;

-- admin with EXPLICIT DENY of marketing.view: direct reads revoked too
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000e6';
do $$
begin
  assert (select count(*) from contact_relationships) = 0, 'denied admin: relationships hidden';
  assert (select count(*) from marketing_settings) = 0, 'denied admin: settings hidden';
end $$;
reset role;

-- explicitly granted viewer: CAN read (and sees only their tenant)
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000e5';
do $$
begin
  assert (select count(*) from contact_relationships) = 1, 'granted viewer: sees tenant rows';
  assert (select bool_and(tenant_id = 'aaaa0000-0000-0000-0000-0000000000e1') from contact_relationships),
    'granted viewer: only own tenant';
  assert (select count(*) from marketing_lifecycle_stages) >= 8, 'granted viewer: lifecycle visible';
  assert (select count(*) from marketing_access_grants) = 0,
    'granted viewer: grants still hidden (needs access.manage)';
end $$;
reset role;

-- ops (role default view): sees rows; admin-a sees grants (access.manage)
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000e3';
do $$
begin
  assert (select count(*) from contact_relationships) = 1, 'ops: sees tenant rows';
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000e2';
do $$
begin
  assert (select count(*) from marketing_access_grants) = 2, 'admin: grants visible to access manager';
end $$;
reset role;

-- cross-tenant: admin of tenant 2 sees ZERO tenant-1 marketing rows
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000e7';
do $$
begin
  assert (select count(*) from contact_relationships
           where tenant_id='aaaa0000-0000-0000-0000-0000000000e1') = 0, 'cross-tenant: hidden';
  assert (select count(*) from marketing_settings
           where tenant_id='aaaa0000-0000-0000-0000-0000000000e1') = 0, 'cross-tenant settings: hidden';
end $$;
reset role;

-- ── (3) Browser writes remain impossible ────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000e2';
do $$
begin
  begin
    insert into contact_relationships (tenant_id, person_id, relationship_type)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','customer');
    assert false, 'authenticated INSERT must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_materialise_defaults('aaaa0000-0000-0000-0000-0000000000e1',
                                           'bbbb0000-0000-0000-0000-0000000000e2');
    assert false, 'materialise RPC must not be executable by authenticated';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── (4) Structural tenant consistency (service-role writes) ─────────────────
do $$
begin
  -- contact point → cross-tenant person
  begin
    insert into contact_points (tenant_id, person_id, channel, value, normalized_value)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e3','phone','01','01');
    assert false, 'cross-tenant person in contact_points must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- relationship → cross-tenant person
  begin
    insert into contact_relationships (tenant_id, person_id)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e3');
    assert false, 'cross-tenant person in relationships must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- relationship → cross-tenant company
  begin
    insert into contact_relationships (tenant_id, person_id, relationship_type, company_id)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e2','prospect',
              'dddd0000-0000-0000-0000-0000000000e2');
    assert false, 'cross-tenant company must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- relationship → cross-tenant owner profile
  begin
    insert into contact_relationships (tenant_id, person_id, relationship_type, owner_id)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e2','prospect',
              'bbbb0000-0000-0000-0000-0000000000e7');
    assert false, 'cross-tenant owner must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- relationship → unknown owner profile
  begin
    insert into contact_relationships (tenant_id, person_id, relationship_type, owner_id)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e2','prospect',
              '00000000-0000-4000-8000-00000000beef');
    assert false, 'unknown owner must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- relationship → unknown lifecycle stage
  begin
    insert into contact_relationships (tenant_id, person_id, relationship_type, lifecycle_stage_key)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e2','prospect','no_such_stage');
    assert false, 'unknown lifecycle stage must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- preference → cross-tenant contact point
  declare cp_b uuid;
  begin
    insert into contact_points (tenant_id, person_id, channel, value, normalized_value)
      values ('aaaa0000-0000-0000-0000-0000000000e2','cccc0000-0000-0000-0000-0000000000e3','email','b1@mh.test','b1@mh.test')
      returning id into cp_b;
    begin
      insert into communication_preferences (tenant_id, person_id, channel, state, contact_point_id)
        values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','email','subscribed', cp_b);
      assert false, 'cross-tenant contact point in preference must be rejected';
    exception when integrity_constraint_violation then null;
    end;
    -- suppression → cross-tenant contact point
    begin
      insert into contact_suppressions (tenant_id, person_id, channel, reason, contact_point_id)
        values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','email','manual', cp_b);
      assert false, 'cross-tenant contact point in suppression must be rejected';
    exception when integrity_constraint_violation then null;
    end;
  end;
  -- tag assignment → cross-tenant person / cross-tenant tag
  begin
    insert into contact_tag_assignments (tenant_id, person_id, tag_id)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e3','eeee0000-0000-0000-0000-0000000000e1');
    assert false, 'cross-tenant person in tag assignment must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  begin
    insert into contact_tag_assignments (tenant_id, person_id, tag_id)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','eeee0000-0000-0000-0000-0000000000e2');
    assert false, 'cross-tenant tag must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- campaign → cross-tenant segment
  begin
    insert into marketing_campaigns (tenant_id, name, segment_id)
      values ('aaaa0000-0000-0000-0000-0000000000e1','X','f0f00000-0000-0000-0000-0000000000e2');
    assert false, 'cross-tenant segment must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- access grant → cross-tenant profile
  begin
    insert into marketing_access_grants (tenant_id, profile_id, permission)
      values ('aaaa0000-0000-0000-0000-0000000000e1','bbbb0000-0000-0000-0000-0000000000e7','marketing.view');
    assert false, 'cross-tenant grant profile must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- settings → cross-tenant updated_by
  begin
    update marketing_settings set updated_by='bbbb0000-0000-0000-0000-0000000000e7'
      where tenant_id='aaaa0000-0000-0000-0000-0000000000e1';
    assert false, 'cross-tenant updated_by must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- (9) TENANTLESS profiles are NEVER tenant actors — with or without platform authority.
  -- e8 is a null-tenant profile with NO grant: rejected.
  begin
    insert into contact_relationships (tenant_id, person_id, relationship_type, created_by)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e2','prospect',
              'bbbb0000-0000-0000-0000-0000000000e8');
    assert false, 'tenantless profile (no grant) must be rejected as an actor';
  exception when integrity_constraint_violation then null;
  end;
  -- give e8 an ACTIVE platform.controlplane.admin grant: STILL rejected (platform
  -- authority deliberately confers no tenant-data actorship).
  insert into platform_authority_grants (profile_id, permission, granted_by, effective_from)
    values ('bbbb0000-0000-0000-0000-0000000000e8','platform.controlplane.admin','test', now() - interval '1 hour');
  begin
    insert into contact_relationships (tenant_id, person_id, relationship_type, created_by)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e2','prospect',
              'bbbb0000-0000-0000-0000-0000000000e8');
    assert false, 'tenantless profile WITH platform.controlplane.admin must still be rejected';
  exception when integrity_constraint_violation then null;
  end;
  begin
    insert into marketing_campaigns (tenant_id, name, owner_id)
      values ('aaaa0000-0000-0000-0000-0000000000e1','X2','bbbb0000-0000-0000-0000-0000000000e8');
    assert false, 'tenantless platform-granted profile must be rejected as campaign owner';
  exception when integrity_constraint_violation then null;
  end;

  -- VALID same-tenant actor rows succeed, and NULL actor columns stay allowed
  -- (system actions attribute via audit_logs, not a fabricated profile).
  insert into contact_relationships (tenant_id, person_id, relationship_type, company_id, owner_id, created_by)
    values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e2','prospect',
            'dddd0000-0000-0000-0000-0000000000e1','bbbb0000-0000-0000-0000-0000000000e3',
            'bbbb0000-0000-0000-0000-0000000000e2');
  insert into contact_tag_assignments (tenant_id, person_id, tag_id, assigned_by)
    values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1',
            'eeee0000-0000-0000-0000-0000000000e1','bbbb0000-0000-0000-0000-0000000000e2');
  insert into marketing_campaigns (tenant_id, name, segment_id, owner_id)
    values ('aaaa0000-0000-0000-0000-0000000000e1','Valid','f0f00000-0000-0000-0000-0000000000e1',
            'bbbb0000-0000-0000-0000-0000000000e2');
  insert into marketing_campaigns (tenant_id, name)  -- all actor columns null: system-created
    values ('aaaa0000-0000-0000-0000-0000000000e1','System Created');
end $$;

-- ── (7b) Materialise RPC actor integrity ────────────────────────────────────
do $$
begin
  -- cross-tenant actor rejected
  begin
    perform marketing_materialise_defaults('aaaa0000-0000-0000-0000-0000000000e2',
                                           'bbbb0000-0000-0000-0000-0000000000e1');
    assert false, 'cross-tenant materialise actor must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- tenantless (platform-granted) actor rejected
  begin
    perform marketing_materialise_defaults('aaaa0000-0000-0000-0000-0000000000e2',
                                           'bbbb0000-0000-0000-0000-0000000000e8');
    assert false, 'tenantless materialise actor must be rejected';
  exception when integrity_constraint_violation then null;
  end;
  -- null actor = genuine system action, audited as service
  perform marketing_materialise_defaults('aaaa0000-0000-0000-0000-0000000000e2', null);
  assert exists (select 1 from audit_logs
                  where tenant_id='aaaa0000-0000-0000-0000-0000000000e2'
                    and action='marketing.defaults.materialised'
                    and actor='service'),
    'system materialisation is attributed as service in the audit trail';
end $$;

-- ── (8) Resolver grant boundary (authenticated role, real execute checks) ───
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000e3'; -- ops
do $$
declare v jsonb;
begin
  -- self-only wrapper works and resolves the CALLER
  v := marketing_current_user_permissions();
  assert (v->'permissions') ? 'marketing.view', 'self-only wrapper resolves the caller (ops has view)';
  assert jsonb_array_length(v->'permissions') = 7, 'self-only wrapper returns ops subset';
  -- the arbitrary-profile resolver is NOT executable by authenticated (cross-profile
  -- inspection impossible)
  begin
    v := marketing_effective_permissions('bbbb0000-0000-0000-0000-0000000000e1');
    assert false, 'authenticated must not execute the arbitrary-profile resolver';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── (5) Contact-point identity semantics ────────────────────────────────────
do $$
begin
  -- two People SHARE a household phone — allowed, no merge, no failure
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value, is_primary)
    values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','phone','+44 1234 555000','+441234555000', true);
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value, is_primary)
    values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e2','phone','+44 1234 555000','+441234555000', true);
  -- two People SHARE a family inbox — allowed
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value)
    values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','email','family@mh.test','family@mh.test');
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value)
    values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e2','email','family@mh.test','family@mh.test');
  -- endpoint lookup returns AMBIGUITY (two People) — evidence, not a merge
  assert (select count(distinct person_id) from contact_points
           where tenant_id='aaaa0000-0000-0000-0000-0000000000e1'
             and channel='phone' and normalized_value='+441234555000') = 2,
    'shared endpoint lookup surfaces both People (ambiguity preserved)';
  -- duplicate endpoint for the SAME Person — rejected
  begin
    insert into contact_points (tenant_id, person_id, channel, value, normalized_value)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','phone','+441234555000','+441234555000');
    assert false, 'duplicate endpoint for the same person must be rejected';
  exception when unique_violation then null;
  end;
  -- a SECOND primary on the same (person, channel) — rejected (deterministic primary)
  begin
    insert into contact_points (tenant_id, person_id, channel, value, normalized_value, is_primary)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','phone','+44 999','+44999', true);
    assert false, 'second primary phone for the same person must be rejected';
  exception when unique_violation then null;
  end;
  -- a primary on a DIFFERENT channel — allowed
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value, is_primary)
    values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','email','p1@mh.test','p1@mh.test', true);
end $$;

-- ── (6) Suppression integrity ───────────────────────────────────────────────
do $$
declare cp1 uuid; s1 uuid;
begin
  select id into cp1 from contact_points
   where tenant_id='aaaa0000-0000-0000-0000-0000000000e1'
     and person_id='cccc0000-0000-0000-0000-0000000000e1'
     and channel='email' and normalized_value='p1@mh.test';

  -- a suppression must name a target
  begin
    insert into contact_suppressions (tenant_id, channel, reason) values
      ('aaaa0000-0000-0000-0000-0000000000e1','email','manual');
    assert false, 'target-less suppression must be rejected';
  exception when check_violation then null;
  end;

  -- person-scoped (no destination): duplicates rejected
  insert into contact_suppressions (tenant_id, person_id, channel, reason)
    values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','sms','manual')
    returning id into s1;
  begin
    insert into contact_suppressions (tenant_id, person_id, channel, reason)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','sms','unsubscribe');
    assert false, 'duplicate ACTIVE person-scoped suppression must be rejected';
  exception when unique_violation then null;
  end;

  -- contact-point-scoped: duplicates rejected
  insert into contact_suppressions (tenant_id, person_id, contact_point_id, channel, reason)
    values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1', cp1,'email','hard_bounce');
  begin
    insert into contact_suppressions (tenant_id, person_id, contact_point_id, channel, reason)
      values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1', cp1,'email','manual');
    assert false, 'duplicate ACTIVE contact-point suppression must be rejected';
  exception when unique_violation then null;
  end;

  -- destination-scoped: duplicates rejected (regression of the original proof)
  insert into contact_suppressions (tenant_id, channel, normalized_value, reason)
    values ('aaaa0000-0000-0000-0000-0000000000e1','email','dest@mh.test','unsubscribe');
  begin
    insert into contact_suppressions (tenant_id, channel, normalized_value, reason)
      values ('aaaa0000-0000-0000-0000-0000000000e1','email','dest@mh.test','manual');
    assert false, 'duplicate ACTIVE destination suppression must be rejected';
  exception when unique_violation then null;
  end;

  -- lifting preserves history and allows a future re-suppression
  update contact_suppressions set active=false, lifted_at=now() where id=s1;
  assert exists (select 1 from contact_suppressions where id=s1 and active=false and lifted_at is not null),
    'lifted suppression retains its history row';
  insert into contact_suppressions (tenant_id, person_id, channel, reason)
    values ('aaaa0000-0000-0000-0000-0000000000e1','cccc0000-0000-0000-0000-0000000000e1','sms','manual');
end $$;

-- ── (2b) Disabling Marketing revokes reads tenant-wide ──────────────────────
update marketing_settings set marketing_enabled=false
  where tenant_id='aaaa0000-0000-0000-0000-0000000000e1';
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000e3'; -- ops (had view)
do $$
begin
  assert (select count(*) from contact_relationships) = 0,
    'marketing disabled: even role-default holders read zero rows';
end $$;
reset role;

select 'marketing_hardening.test.sql: ALL ASSERTIONS PASSED' as result;
rollback;
