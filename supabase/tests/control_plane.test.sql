-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/control_plane.test.sql
--
-- Proves OpenFolk Control Plane invariants:
--   • current_user_is_openfolk_operator() (role='openfolk' AND active grant; admin⇒view)
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
  ('bbbb0000-0000-0000-0000-0000000000c4','ord@cp.test',false,false);
update profiles set role='openfolk', tenant_id=null where id='bbbb0000-0000-0000-0000-0000000000c1';
update profiles set role='openfolk', tenant_id=null where id='bbbb0000-0000-0000-0000-0000000000c2';
update profiles set role='owner', tenant_id='aaaa0000-0000-0000-0000-0000000000c1' where id='bbbb0000-0000-0000-0000-0000000000c3';
update profiles set role='ops',   tenant_id='aaaa0000-0000-0000-0000-0000000000c1' where id='bbbb0000-0000-0000-0000-0000000000c4';

-- Active platform grant for the operator (admin ⇒ implies view).
insert into platform_authority_grants (profile_id, permission, granted_by, effective_from) values
  ('bbbb0000-0000-0000-0000-0000000000c1','platform.controlplane.admin','system', now() - interval '1 hour');

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

do $$ begin raise notice 'CONTROL-PLANE: ALL PASSED'; end $$;
rollback;
