-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/control_plane.test.sql
--
-- Proves OpenFolk Control Plane invariants:
--   • current_user_is_openfolk_operator() — authenticated + existing profile + ACTIVE
--     platform.controlplane grant (admin⇒view). profiles.role is NOT consulted, so a
--     tenant `owner` can be an operator without surrendering their tenant role
--     (migration 20260822120000). Expired/revoked grants fail closed.
--   • RLS: OpenFolk operator reads; tenant superadmin / ordinary / anon see ZERO
--   • tenant isolation: cross-tenant owner/endpoint refs rejected by composite FKs
--   • effective-dated ownership: overlapping EXCLUSIVE accountable rejected; cover coexists
--   • integration-identity active-user uniqueness
--   • append-only change log + handoffs (no update/delete)
begin;

insert into tenants (id, slug, display_name, industry) values
  ('aaaa0000-0000-0000-0000-0000000000c1','cp-t1','CP Tenant 1','hvac'),
  ('aaaa0000-0000-0000-0000-0000000000c2','cp-t2','CP Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb0000-0000-0000-0000-0000000000c1','op@openfolk.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000c2','op-nogrant@openfolk.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000c3','tsa@cp.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000c4','ord@cp.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000c5','owner-operator@cp.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000c6','owner-expired@cp.test',false,false);
update profiles set role='openfolk', tenant_id=null where id='bbbb0000-0000-0000-0000-0000000000c1';
update profiles set role='openfolk', tenant_id=null where id='bbbb0000-0000-0000-0000-0000000000c2';
update profiles set role='owner', tenant_id='aaaa0000-0000-0000-0000-0000000000c1' where id='bbbb0000-0000-0000-0000-0000000000c3';
update profiles set role='ops',   tenant_id='aaaa0000-0000-0000-0000-0000000000c1' where id='bbbb0000-0000-0000-0000-0000000000c4';
-- The operator-bootstrap shape: a TENANT OWNER who keeps role='owner' and holds platform
-- authority purely via the grant ledger (this is the live Chris case).
update profiles set role='owner', tenant_id='aaaa0000-0000-0000-0000-0000000000c1' where id='bbbb0000-0000-0000-0000-0000000000c5';
update profiles set role='owner', tenant_id='aaaa0000-0000-0000-0000-0000000000c1' where id='bbbb0000-0000-0000-0000-0000000000c6';

-- Active platform grant for the operator (admin ⇒ implies view).
insert into platform_authority_grants (profile_id, permission, granted_by, effective_from) values
  ('bbbb0000-0000-0000-0000-0000000000c1','platform.controlplane.admin','system', now() - interval '1 hour'),
  ('bbbb0000-0000-0000-0000-0000000000c5','platform.controlplane.admin','system', now() - interval '1 hour');
-- EXPIRED grant (effective_to already past) — must fail closed.
insert into platform_authority_grants (profile_id, permission, granted_by, effective_from, effective_to) values
  ('bbbb0000-0000-0000-0000-0000000000c6','platform.controlplane.admin','system', now() - interval '5 hours', now() - interval '1 hour');

-- Tenant superadmin (team_member + tenant.superadmin grant) — must NOT see Control Plane.
insert into team_members (id, tenant_id, profile_id, display_name) values
  ('cccc0000-0000-0000-0000-0000000000c3','aaaa0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000c3','TSA'),
  ('cccc0000-0000-0000-0000-0000000000c1','aaaa0000-0000-0000-0000-0000000000c1',null,'Staff One (no login)'),
  ('cccc0000-0000-0000-0000-0000000000c2','aaaa0000-0000-0000-0000-0000000000c2',null,'Staff Two other tenant');
insert into authority_grants (tenant_id, member_id, permission, scope, effective_from) values
  ('aaaa0000-0000-0000-0000-0000000000c1','cccc0000-0000-0000-0000-0000000000c3','tenant.superadmin','company', now() - interval '1 hour');

insert into org_units (id, tenant_id, kind, name) values
  ('f1110000-0000-0000-0000-0000000000c1','aaaa0000-0000-0000-0000-0000000000c1','team','Scheduling');
insert into communication_endpoints (id, tenant_id, channel, endpoint_kind, normalized_value, display_value) values
  ('dddd0000-0000-0000-0000-0000000000c1','aaaa0000-0000-0000-0000-0000000000c1','phone','ddi','+441111000123','Main line'),
  ('dddd0000-0000-0000-0000-0000000000c2','aaaa0000-0000-0000-0000-0000000000c1','phone','extension','201','Ext 201');

-- ── (1) Authority resolver. ─────────────────────────────────────────────────
do $$
begin
  perform set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c1', true);
  if not current_user_is_openfolk_operator() then raise exception 'FAIL: operator+grant should be operator'; end if;
  if not current_user_is_openfolk_operator('platform.controlplane.admin') then raise exception 'FAIL: admin grant should satisfy admin'; end if;
  perform set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c2', true);
  if current_user_is_openfolk_operator() then raise exception 'FAIL: openfolk WITHOUT grant must NOT be operator'; end if;
  perform set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c3', true);
  if current_user_is_openfolk_operator() then raise exception 'FAIL: tenant superadmin must NOT be operator'; end if;

  -- REGRESSION (authority-model correction, migration 20260822120000):
  -- ordinary tenant user without a platform grant is denied.
  perform set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c4', true);
  if current_user_is_openfolk_operator() then raise exception 'FAIL: ordinary tenant user must NOT be operator'; end if;

  -- A tenant OWNER holding an ACTIVE platform grant IS an operator (role not consulted).
  perform set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c5', true);
  if not current_user_is_openfolk_operator() then raise exception 'FAIL: owner WITH active grant must be operator'; end if;
  if not current_user_is_openfolk_operator('platform.controlplane.admin') then raise exception 'FAIL: owner admin grant must satisfy admin'; end if;

  -- ...and their TENANT role is untouched by holding platform authority.
  if (select role from profiles where id='bbbb0000-0000-0000-0000-0000000000c5') is distinct from 'owner' then
    raise exception 'FAIL: operator profile role must remain owner';
  end if;

  -- An EXPIRED / revoked grant fails closed.
  perform set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c6', true);
  if current_user_is_openfolk_operator() then raise exception 'FAIL: EXPIRED platform grant must fail closed'; end if;
end $$;

-- ── (2) RLS: operator reads; superadmin/ordinary see ZERO. ──────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c1', true);
do $$
declare n int;
begin
  select count(*) into n from communication_endpoints;
  if n < 1 then raise exception 'FAIL: OpenFolk operator cannot read endpoints'; end if;
end $$;
select set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c3', true);
do $$
declare n int;
begin
  select count(*) into n from communication_endpoints;
  if n <> 0 then raise exception 'FAIL: tenant superadmin saw % Control Plane rows (must be 0)', n; end if;
  select count(*) into n from endpoint_ownership_assignments; if n<>0 then raise exception 'FAIL: superadmin saw ownership rows'; end if;
  select count(*) into n from member_integration_identities; if n<>0 then raise exception 'FAIL: superadmin saw identities'; end if;
end $$;
select set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c4', true);
do $$
declare n int;
begin
  select count(*) into n from communication_endpoints;
  if n <> 0 then raise exception 'FAIL: ordinary user saw % Control Plane rows (must be 0)', n; end if;
end $$;

-- REGRESSION: a tenant OWNER holding an ACTIVE platform grant reads Control Plane rows,
-- while the SAME tenant role with an EXPIRED grant reads ZERO (fails closed).
select set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c5', true);
do $$
declare n int;
begin
  select count(*) into n from communication_endpoints;
  if n < 1 then raise exception 'FAIL: owner WITH active platform grant cannot read Control Plane'; end if;
end $$;
select set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-0000000000c6', true);
do $$
declare n int;
begin
  select count(*) into n from communication_endpoints;
  if n <> 0 then raise exception 'FAIL: EXPIRED grant saw % Control Plane rows (must be 0)', n; end if;
end $$;
reset role;

-- anon: no grant + RLS ⇒ nothing.
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from communication_endpoints;
    if n <> 0 then raise exception 'FAIL: anon saw % rows', n; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ── (3) Tenant isolation: owner from another tenant rejected. ───────────────
do $$
begin
  begin
    insert into endpoint_ownership_assignments (tenant_id, endpoint_id, owner_kind, owner_member_id, assignment_role)
    values ('aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c1','person','cccc0000-0000-0000-0000-0000000000c2','accountable');
    raise exception 'FAIL: cross-tenant owner_member was allowed';
  exception when foreign_key_violation then null; end;
end $$;

-- ── (4) Effective-dated ownership + exclusion constraint. ───────────────────
insert into endpoint_ownership_assignments (id, tenant_id, endpoint_id, owner_kind, owner_member_id, assignment_role, effective_from)
values ('e0000000-0000-0000-0000-0000000000c1','aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c1','person','cccc0000-0000-0000-0000-0000000000c1','accountable', now() - interval '2 hours');
do $$
begin
  -- Overlapping exclusive accountable (both open-ended) ⇒ rejected.
  begin
    insert into endpoint_ownership_assignments (tenant_id, endpoint_id, owner_kind, owner_member_id, assignment_role)
    values ('aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c1','person','cccc0000-0000-0000-0000-0000000000c3','accountable');
    raise exception 'FAIL: overlapping exclusive accountable was allowed';
  exception when exclusion_violation then null; end;

  -- A cover assignment overlapping the accountable window ⇒ allowed (different role).
  insert into endpoint_ownership_assignments (tenant_id, endpoint_id, owner_kind, owner_member_id, assignment_role)
  values ('aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c1','person','cccc0000-0000-0000-0000-0000000000c3','cover');

  -- End the first accountable, then a NEW non-overlapping accountable ⇒ allowed (history kept).
  update endpoint_ownership_assignments set effective_to = now() - interval '1 hour' where id='e0000000-0000-0000-0000-0000000000c1';
  insert into endpoint_ownership_assignments (tenant_id, endpoint_id, owner_kind, owner_member_id, assignment_role, effective_from)
  values ('aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c1','person','cccc0000-0000-0000-0000-0000000000c3','accountable', now() - interval '1 hour');
  -- Prior (ended) accountable row still present ⇒ history preserved.
  if (select effective_to from endpoint_ownership_assignments where id='e0000000-0000-0000-0000-0000000000c1') is null then
    raise exception 'FAIL: history row was not preserved';
  end if;
end $$;

-- ── (5) Integration-identity active-user uniqueness. ────────────────────────
insert into member_integration_identities (tenant_id, team_member_id, provider, identity_kind, external_ref)
values ('aaaa0000-0000-0000-0000-0000000000c1','cccc0000-0000-0000-0000-0000000000c1','google_workspace','user','alice@drummonds.example');
do $$
begin
  begin
    insert into member_integration_identities (tenant_id, team_member_id, provider, identity_kind, external_ref)
    values ('aaaa0000-0000-0000-0000-0000000000c1','cccc0000-0000-0000-0000-0000000000c3','google_workspace','user','alice@drummonds.example');
    raise exception 'FAIL: same active user-identity assigned to two members';
  exception when unique_violation then null; end;
end $$;

-- ── (6) Append-only change log + handoffs. ──────────────────────────────────
insert into controlplane_change_log (tenant_id, actor, action, resource_type, resource_id, before, after, reason)
values ('aaaa0000-0000-0000-0000-0000000000c1','op@openfolk.test','controlplane.endpoint.map','communication_endpoint','dddd0000-0000-0000-0000-0000000000c1','{}','{"owner":"cccc...c1"}','initial mapping');
insert into responsibility_handoffs (tenant_id, handoff_type, subject_type, subject_ref, occurred_at)
values ('aaaa0000-0000-0000-0000-0000000000c1','phone_transfer','interaction','int-1', now());
do $$
begin
  begin
    update controlplane_change_log set reason='x' where actor='op@openfolk.test';
    raise exception 'FAIL: change_log UPDATE allowed';
  exception when others then if sqlerrm not like '%append-only%' then raise; end if; end;
  begin
    delete from responsibility_handoffs where subject_ref='int-1';
    raise exception 'FAIL: handoff DELETE allowed';
  exception when others then if sqlerrm not like '%append-only%' then raise; end if; end;
end $$;

-- ── (7) owner_kind integrity (exactly the applicable owner field). ──────────
do $$
begin
  -- no owner for a person kind
  begin
    insert into endpoint_ownership_assignments (tenant_id, endpoint_id, owner_kind, assignment_role)
    values ('aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c2','person','cover');
    raise exception 'FAIL: person with no member was allowed';
  exception when check_violation then null; end;
  -- multiple/incompatible owners (person AND org unit)
  begin
    insert into endpoint_ownership_assignments (tenant_id, endpoint_id, owner_kind, owner_member_id, owner_org_unit_id, assignment_role)
    values ('aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c2','person','cccc0000-0000-0000-0000-0000000000c1','f1110000-0000-0000-0000-0000000000c1','cover');
    raise exception 'FAIL: person with member AND org_unit was allowed';
  exception when check_violation then null; end;
  -- shared must carry no specific owner
  begin
    insert into endpoint_ownership_assignments (tenant_id, endpoint_id, owner_kind, owner_member_id, assignment_role)
    values ('aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c2','shared','cccc0000-0000-0000-0000-0000000000c1','cover');
    raise exception 'FAIL: shared with a member was allowed';
  exception when check_violation then null; end;
  -- team kind resolves to org unit only (valid)
  insert into endpoint_ownership_assignments (tenant_id, endpoint_id, owner_kind, owner_org_unit_id, assignment_role)
  values ('aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c2','team','f1110000-0000-0000-0000-0000000000c1','escalation');
end $$;

-- ── (8) atomic RPC: assign ownership writes change_log + ends prior accountable. ─
do $$
declare v1 uuid; v2 uuid; n_active int; n_log int;
begin
  v1 := cp_assign_ownership('aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c2',
        'person','cccc0000-0000-0000-0000-0000000000c1',null,null,'accountable',true,null,0.9,'confirmed',
        'op@openfolk.test','initial mapping',null,false);
  -- Reassigning accountable must END the prior one (no exclusion violation) and log both.
  v2 := cp_assign_ownership('aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c2',
        'person','cccc0000-0000-0000-0000-0000000000c3',null,null,'accountable',true,null,0.9,'confirmed',
        'op@openfolk.test','reassign accountable',null,false);
  select count(*) into n_active from endpoint_ownership_assignments
   where endpoint_id='dddd0000-0000-0000-0000-0000000000c2' and assignment_role='accountable' and effective_to is null;
  if n_active <> 1 then raise exception 'FAIL: expected exactly 1 active accountable after RPC reassign, got %', n_active; end if;
  select count(*) into n_log from controlplane_change_log
   where action='controlplane.ownership.assign' and resource_id in (v1::text, v2::text);
  if n_log <> 2 then raise exception 'FAIL: expected 2 change_log rows from RPC, got %', n_log; end if;
end $$;

-- ── (9) SECURITY DEFINER RPCs are NOT a back door (service_role only). ──────
do $$
declare sig text;
begin
  foreach sig in array array[
    'cp_upsert_endpoint(uuid,text,text,text,text,text,text,boolean,text,text,jsonb,text,text,text,boolean)',
    'cp_upsert_member(uuid,uuid,text,uuid,text,text,text,text,boolean)',
    'cp_upsert_identity(uuid,uuid,text,text,text,text,text,text,text,text,text,boolean)',
    'cp_assign_ownership(uuid,uuid,text,uuid,uuid,text,text,boolean,timestamptz,numeric,text,text,text,text,boolean)']
  loop
    if has_function_privilege('authenticated', sig, 'execute') then
      raise exception 'FAIL: authenticated can EXECUTE % (must be service_role only)', sig;
    end if;
    if has_function_privilege('anon', sig, 'execute') then
      raise exception 'FAIL: anon can EXECUTE %', sig;
    end if;
    if not has_function_privilege('service_role', sig, 'execute') then
      raise exception 'FAIL: service_role cannot EXECUTE %', sig;
    end if;
  end loop;
end $$;

-- ── (10) audit idempotency (migration 20260823120000). ─────────────────────
-- A no-op discovery refresh must NOT append a change-log row; a material change must.
do $$
declare r jsonb; eid uuid; n int;
begin
  r := cp_upsert_endpoint('aaaa0000-0000-0000-0000-0000000000c1','email','email','idem@drummonds.example',
        'Idem Test', null, 'gw-ref-idem', false, 'discovery', 'src-idem', '{}'::jsonb, 'op@openfolk.test', 'run 1', null, false);
  if (r->>'outcome') <> 'created' then raise exception 'FAIL: first upsert outcome=% (want created)', r->>'outcome'; end if;
  eid := (r->>'id')::uuid;
  select count(*) into n from controlplane_change_log where resource_id = eid::text and action = 'controlplane.endpoint.upsert';
  if n <> 1 then raise exception 'FAIL: created should log exactly 1 row, got %', n; end if;

  -- identical re-run → unchanged, NO new change-log row (the 64-row bug).
  r := cp_upsert_endpoint('aaaa0000-0000-0000-0000-0000000000c1','email','email','idem@drummonds.example',
        'Idem Test', null, 'gw-ref-idem', false, 'discovery', 'src-idem', '{}'::jsonb, 'op@openfolk.test', 'run 2', null, false);
  if (r->>'outcome') <> 'unchanged' then raise exception 'FAIL: identical re-run outcome=% (want unchanged)', r->>'outcome'; end if;
  select count(*) into n from controlplane_change_log where resource_id = eid::text and action = 'controlplane.endpoint.upsert';
  if n <> 1 then raise exception 'FAIL: unchanged must NOT add a change-log row, got %', n; end if;

  -- material change (display_value) → updated, exactly one additional row.
  r := cp_upsert_endpoint('aaaa0000-0000-0000-0000-0000000000c1','email','email','idem@drummonds.example',
        'Idem Test RENAMED', null, 'gw-ref-idem', false, 'discovery', 'src-idem', '{}'::jsonb, 'op@openfolk.test', 'run 3', null, false);
  if (r->>'outcome') <> 'updated' then raise exception 'FAIL: material change outcome=% (want updated)', r->>'outcome'; end if;
  select count(*) into n from controlplane_change_log where resource_id = eid::text and action = 'controlplane.endpoint.upsert';
  if n <> 2 then raise exception 'FAIL: material update should total 2 rows, got %', n; end if;
end $$;

-- ── (11) identity reviews, ownership ending, manual-endpoint editing. ───────
do $$
declare r jsonb; eid uuid; upd timestamptz; nlink int; nown int; nrev int; nupd int;
begin
  r := cp_upsert_endpoint('aaaa0000-0000-0000-0000-0000000000c1','email','email','flow@drummonds.example',
        'Flow', 'directory', null, false, 'manual', null, '{}'::jsonb, 'op@test','create',null,false);
  eid := (r->>'id')::uuid;
  select updated_at into upd from communication_endpoints where id = eid;

  -- OPTIMISTIC CONCURRENCY: a stale expected_updated_at is rejected.
  begin
    perform cp_update_manual_endpoint('aaaa0000-0000-0000-0000-0000000000c1', eid, 'New label', null, null,
      upd - interval '1 hour', 'op@test','edit',null,false);
    raise exception 'FAIL: stale write was allowed';
  exception when others then if sqlerrm not like 'stale_write%' then raise; end if; end;

  -- correct token → updated (one material audit row).
  r := cp_update_manual_endpoint('aaaa0000-0000-0000-0000-0000000000c1', eid, 'New label', null, null,
        upd, 'op@test','edit',null,false);
  if (r->>'outcome') <> 'updated' then raise exception 'FAIL: expected updated, got %', r->>'outcome'; end if;
  select updated_at into upd from communication_endpoints where id = eid;
  select count(*) into nupd from controlplane_change_log where resource_id = eid::text and action='controlplane.endpoint.update';

  -- no-op edit → unchanged, NO material audit row.
  r := cp_update_manual_endpoint('aaaa0000-0000-0000-0000-0000000000c1', eid, 'New label', null, null,
        upd, 'op@test','noop',null,false);
  if (r->>'outcome') <> 'unchanged' then raise exception 'FAIL: expected unchanged, got %', r->>'outcome'; end if;
  if (select count(*) from controlplane_change_log where resource_id = eid::text and action='controlplane.endpoint.update') <> nupd then
    raise exception 'FAIL: no-op edit created a material audit row'; end if;

  -- provider-discovered evidence cannot be edited via this path.
  begin
    perform cp_upsert_endpoint('aaaa0000-0000-0000-0000-0000000000c1','email','email','disc@drummonds.example',
      'Disc','google_workspace','gw-x',false,'discovery',null,'{}'::jsonb,'op@test','disc',null,false);
    perform cp_update_manual_endpoint('aaaa0000-0000-0000-0000-0000000000c1',
      (select id from communication_endpoints where normalized_value='disc@drummonds.example'), 'x', null, null,
      null,'op@test','edit',null,false);
    raise exception 'FAIL: a discovered endpoint was editable as manual';
  exception when others then if sqlerrm not like '%only manual endpoints%' then raise; end if; end;

  -- IDENTITY REVIEW: confirm creates a LINK but NEVER ownership.
  select count(*) into nown from endpoint_ownership_assignments where endpoint_id = eid;
  r := cp_review_identity('aaaa0000-0000-0000-0000-0000000000c1', eid, 'confirmed_person',
        'cccc0000-0000-0000-0000-0000000000c3', 'high', '{}'::jsonb, 'op@test','confirm',null,false);
  if (r->>'identity_id') is null then raise exception 'FAIL: confirm did not create an identity link'; end if;
  if (select count(*) from endpoint_ownership_assignments where endpoint_id = eid) <> nown then
    raise exception 'FAIL: identity confirmation created ownership (must not)'; end if;

  -- REJECT: no link created; review row preserved (append-only).
  r := cp_review_identity('aaaa0000-0000-0000-0000-0000000000c1', eid, 'rejected',
        'cccc0000-0000-0000-0000-0000000000c3', 'low', '{}'::jsonb, 'op@test','reject',null,false);
  if (r->>'identity_id') is not null then raise exception 'FAIL: reject created an identity link'; end if;
  select count(*) into nrev from endpoint_identity_reviews where endpoint_id = eid;
  if nrev < 2 then raise exception 'FAIL: review history not preserved (got %)', nrev; end if;
  begin
    delete from endpoint_identity_reviews where endpoint_id = eid;
    raise exception 'FAIL: review DELETE allowed';
  exception when others then if sqlerrm not like '%append-only%' then raise; end if; end;
end $$;

-- ── (12) operator workflow: team classification, ownership ending (explicit date +
--        optimistic concurrency), manual restore. ───────────────────────────────────
do $$
declare r jsonb; eid uuid; aid uuid; aupd timestamptz; discid uuid;
begin
  -- TEAM decision: records an operational classification, creates NO identity link.
  r := cp_upsert_endpoint('aaaa0000-0000-0000-0000-0000000000c1','email','email','team@drummonds.example',
        'Team', 'directory', null, false, 'manual', null, '{}'::jsonb, 'op@test','create',null,false);
  eid := (r->>'id')::uuid;
  r := cp_review_identity('aaaa0000-0000-0000-0000-0000000000c1', eid, 'team', null, 'unresolved',
        '{}'::jsonb, 'op@test','mark team',null,false);
  if (r->>'identity_id') is not null then raise exception 'FAIL: team decision created an identity link'; end if;
  if (r->>'decision') <> 'team' then raise exception 'FAIL: team decision not recorded'; end if;
  if (select count(*) from endpoint_identity_reviews where endpoint_id = eid and decision='team') <> 1 then
    raise exception 'FAIL: team review row not appended'; end if;

  -- OWNERSHIP ENDING: create a cover assignment, end it with an explicit date + concurrency token.
  insert into endpoint_ownership_assignments
    (id, tenant_id, endpoint_id, owner_kind, owner_member_id, assignment_role, effective_from, review_state, provenance)
  values (gen_random_uuid(), 'aaaa0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-0000000000c1',
    'person','cccc0000-0000-0000-0000-0000000000c1','cover', now() - interval '2 days','confirmed','test')
  returning id, updated_at into aid, aupd;

  -- stale token → rejected safely.
  begin
    perform cp_end_ownership('aaaa0000-0000-0000-0000-0000000000c1', aid, now(), aupd - interval '1 hour',
      'op@test','end',null,false);
    raise exception 'FAIL: stale ownership end was allowed';
  exception when others then if sqlerrm not like 'stale_write%' then raise; end if; end;

  -- correct token + explicit effective_to → ended; history remains (no hard-delete).
  r := cp_end_ownership('aaaa0000-0000-0000-0000-0000000000c1', aid, now(), aupd, 'op@test','end',null,false);
  if (r->>'outcome') <> 'ended' then raise exception 'FAIL: expected ended, got %', r->>'outcome'; end if;
  if (select effective_to from endpoint_ownership_assignments where id = aid) is null then
    raise exception 'FAIL: effective_to not set on end'; end if;
  if (select count(*) from endpoint_ownership_assignments where id = aid) <> 1 then
    raise exception 'FAIL: assignment was hard-deleted (must be preserved)'; end if;

  -- already-ended → safe no-op.
  r := cp_end_ownership('aaaa0000-0000-0000-0000-0000000000c1', aid, now(), null, 'op@test','end again',null,false);
  if (r->>'outcome') <> 'already_ended' then raise exception 'FAIL: re-end outcome=% (want already_ended)', r->>'outcome'; end if;

  -- MANUAL RESTORE: archive then restore a manual endpoint.
  r := cp_upsert_endpoint('aaaa0000-0000-0000-0000-0000000000c1','phone','ddi','+441111000999',
        'Restore line', 'sipcentric', null, false, 'manual', null, '{}'::jsonb, 'op@test','create',null,false);
  eid := (r->>'id')::uuid;
  perform cp_archive_endpoint('aaaa0000-0000-0000-0000-0000000000c1', eid, 'op@test','archive',null,false);
  if (select status from communication_endpoints where id = eid) <> 'inactive' then
    raise exception 'FAIL: archive did not deactivate'; end if;
  r := cp_restore_endpoint('aaaa0000-0000-0000-0000-0000000000c1', eid, 'op@test','restore',null,false);
  if (r->>'outcome') <> 'restored' then raise exception 'FAIL: expected restored, got %', r->>'outcome'; end if;
  if (select status from communication_endpoints where id = eid) <> 'active' then
    raise exception 'FAIL: restore did not reactivate'; end if;

  -- provider-discovered endpoints are NOT restorable via this path.
  r := cp_upsert_endpoint('aaaa0000-0000-0000-0000-0000000000c1','email','email','disc2@drummonds.example',
        'Disc2','google_workspace','gw-y',false,'discovery',null,'{}'::jsonb,'op@test','disc',null,false);
  discid := (r->>'id')::uuid;
  begin
    perform cp_restore_endpoint('aaaa0000-0000-0000-0000-0000000000c1', discid, 'op@test','restore',null,false);
    raise exception 'FAIL: a discovered endpoint was restorable as manual';
  exception when others then if sqlerrm not like '%only manual endpoints%' then raise; end if; end;
end $$;

do $$ begin raise notice 'CONTROL-PLANE: ALL PASSED'; end $$;
rollback;
