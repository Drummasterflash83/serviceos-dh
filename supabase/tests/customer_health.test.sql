-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/customer_health.test.sql
--
-- Proves the Customer Health universal schema invariants:
--   • the Drummonds tenant config seeded (draft policy, allowlist DISABLED baseline)
--   • Health Object identity uniqueness
--   • append-only assessments / sources / decisions (no update, no delete)
--   • valid supersession chain
--   • tenant isolation + Chris-only (Tenant-Superadmin) RLS, zero cross-tenant leakage
--   • authenticated/anon WRITE denial (writes are service-role only)
--   • shadow-safety: writing Health rows touches NO canonical work/execution/outcome tables
begin;

-- ── (0) Drummonds config seeding (migration 20260820120100 resolved the tenant). ─
-- Asserts the SHIPPED baseline: exactly one tenant matches the canonical/legacy slug,
-- a customer_health policy row exists for it, and the source allowlist is disabled.
do $$
declare v_count int; v_tenant uuid; v_policies int; v_enabled text;
begin
  select count(*) into v_count from tenants where slug in ('drummonds','drummond');
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 Drummonds tenant (slug drummonds/drummond), found %', v_count;
  end if;
  select id into v_tenant from tenants where slug in ('drummonds','drummond');
  select count(*) into v_policies from config_versions
   where tenant_id = v_tenant and artifact_kind='policy' and artifact_key='customer_health';
  if v_policies < 1 then
    raise exception 'FAIL: Drummonds customer_health policy row missing — config migration silently no-opped';
  end if;
  select value->>'enabled' into v_enabled from operating_profile_entries
   where tenant_id = v_tenant and namespace='customer_health' and key='source.allowlist'
   order by created_at desc limit 1;
  if v_enabled is distinct from 'false' then
    raise exception 'FAIL: Drummonds source.allowlist baseline must be disabled (enabled=%)', coalesce(v_enabled,'<missing>');
  end if;
end $$;

-- ── Fixtures (fixed uuids so RLS can reference them; rolled back at the end). ─
insert into tenants (id, slug, display_name, industry) values
  ('aaaa0000-0000-0000-0000-000000000001','ch-t1','CH Test Tenant 1','hvac'),
  ('aaaa0000-0000-0000-0000-000000000002','ch-t2','CH Test Tenant 2','hvac');

-- auth users → profiles auto-created by handle_new_user; then set tenant/role.
insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb0000-0000-0000-0000-000000000001','super1@ch.test',false,false),
  ('bbbb0000-0000-0000-0000-000000000002','ord1@ch.test',false,false),
  ('bbbb0000-0000-0000-0000-000000000003','super2@ch.test',false,false);
update profiles set tenant_id='aaaa0000-0000-0000-0000-000000000001', role='owner' where id='bbbb0000-0000-0000-0000-000000000001';
update profiles set tenant_id='aaaa0000-0000-0000-0000-000000000001', role='ops'   where id='bbbb0000-0000-0000-0000-000000000002';
update profiles set tenant_id='aaaa0000-0000-0000-0000-000000000002', role='owner' where id='bbbb0000-0000-0000-0000-000000000003';

-- team_members + active tenant.superadmin grants for super1 (T1) and super2 (T2).
insert into team_members (id, tenant_id, profile_id, display_name) values
  ('cccc0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000001','Super One'),
  ('cccc0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000002','bbbb0000-0000-0000-0000-000000000003','Super Two');
insert into authority_grants (tenant_id, member_id, permission, scope, effective_from, effective_to) values
  ('aaaa0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001','tenant.superadmin','company', now() - interval '1 hour', null),
  ('aaaa0000-0000-0000-0000-000000000002','cccc0000-0000-0000-0000-000000000003','tenant.superadmin','company', now() - interval '1 hour', null);

-- Health Objects for both tenants (same synthetic subject id, different tenant).
insert into health_objects (id, tenant_id, health_type, subject_type, subject_id) values
  ('dddd0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','customer_health','person','eeee0000-0000-0000-0000-000000000001'),
  ('dddd0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000002','customer_health','person','eeee0000-0000-0000-0000-000000000001');

-- ── (1) Identity uniqueness. ────────────────────────────────────────────────
do $$
begin
  begin
    insert into health_objects (tenant_id, health_type, subject_type, subject_id)
    values ('aaaa0000-0000-0000-0000-000000000001','customer_health','person','eeee0000-0000-0000-0000-000000000001');
    raise exception 'FAIL: duplicate Health Object identity was allowed';
  exception when unique_violation then null; -- expected
  end;
end $$;

-- ── (2) Append-only assessments (+ supersession chain). ─────────────────────
insert into health_assessments (id, tenant_id, health_object_id, state, trend, evaluator_version, input_hash)
values ('f0000000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000001','watch','unknown','customer-health@1','h1');
insert into health_assessments (id, tenant_id, health_object_id, state, trend, evaluator_version, input_hash, supersedes_id)
values ('f0000000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000001','at_risk','worsening','customer-health@1','h2','f0000000-0000-0000-0000-000000000001');

do $$
declare chain int;
begin
  -- idempotency: same (tenant, object, input_hash) rejected
  begin
    insert into health_assessments (tenant_id, health_object_id, state, evaluator_version, input_hash)
    values ('aaaa0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000001','watch','customer-health@1','h1');
    raise exception 'FAIL: duplicate assessment input_hash was allowed';
  exception when unique_violation then null; end;

  -- append-only: update rejected
  begin
    update health_assessments set state='healthy' where id='f0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: assessment UPDATE was allowed';
  exception when others then if sqlstate <> '23514' and sqlerrm not like '%append-only%' then raise; end if; end;

  -- append-only: delete rejected
  begin
    delete from health_assessments where id='f0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: assessment DELETE was allowed';
  exception when others then if sqlerrm not like '%append-only%' then raise; end if; end;

  -- supersession chain valid
  select count(*) into chain from health_assessments where supersedes_id='f0000000-0000-0000-0000-000000000001';
  if chain <> 1 then raise exception 'FAIL: supersession chain broken (%).', chain; end if;
end $$;

-- ── (3) Append-only proposal sources + decisions. ───────────────────────────
insert into health_commitment_proposals (id, tenant_id, health_object_id, commitment_type, group_key, state)
values ('a1000000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000001','callback','callback:person:x:quote','proposed');
insert into health_proposal_sources (id, tenant_id, proposal_id, source_kind, source_ref, role)
values ('a2000000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','interaction','int-1','candidate_evidence');
insert into health_proposal_decisions (id, tenant_id, proposal_id, health_object_id, decision, actor, from_state, to_state)
values ('a3000000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000001','confirm','tester','proposed','confirmed');

do $$
begin
  begin
    update health_proposal_sources set excerpt='changed' where id='a2000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: source UPDATE allowed';
  exception when others then if sqlerrm not like '%append-only%' then raise; end if; end;
  begin
    delete from health_proposal_decisions where id='a3000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: decision DELETE allowed';
  exception when others then if sqlerrm not like '%append-only%' then raise; end if; end;
end $$;

-- ── (4) Shadow-safety: canonical tables untouched by Health writes. ─────────
do $$
declare io_before int; ai_before int; oc_before int; rt_before int; dl_before int;
        io_after int;  ai_after int;  oc_after int;  rt_after int;  dl_after int;
begin
  select count(*) into io_before from intelligence_objects;
  select count(*) into ai_before from automation_intents;
  select count(*) into oc_before from outcomes;
  select count(*) into rt_before from review_tasks;
  select count(*) into dl_before from decision_log;

  -- a burst of Health writes
  insert into health_assessments (tenant_id, health_object_id, state, evaluator_version, input_hash)
  values ('aaaa0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000001','critical','customer-health@1','h3');
  insert into health_proposal_sources (tenant_id, proposal_id, source_kind, source_ref, role)
  values ('aaaa0000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','recommendation','rec-1','related');

  select count(*) into io_after from intelligence_objects;
  select count(*) into ai_after from automation_intents;
  select count(*) into oc_after from outcomes;
  select count(*) into rt_after from review_tasks;
  select count(*) into dl_after from decision_log;

  if io_after<>io_before or ai_after<>ai_before or oc_after<>oc_before or rt_after<>rt_before or dl_after<>dl_before then
    raise exception 'FAIL: Health writes changed a canonical table (io % ai % oc % rt % dl %)',
      io_after-io_before, ai_after-ai_before, oc_after-oc_before, rt_after-rt_before, dl_after-dl_before;
  end if;
end $$;

-- ── (5) RLS: Chris-only + tenant isolation + zero cross-tenant leakage. ─────
-- super1 (T1 superadmin) sees ONLY T1's Health Object.
set local role authenticated;
select set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-000000000001', true);
do $$
declare seen int; leak int;
begin
  select count(*) into seen from health_objects;
  select count(*) into leak from health_objects where tenant_id <> 'aaaa0000-0000-0000-0000-000000000001';
  if seen < 1 then raise exception 'FAIL: T1 superadmin cannot see T1 Health Object'; end if;
  if leak > 0 then raise exception 'FAIL: cross-tenant leakage for T1 superadmin (% rows)', leak; end if;
end $$;

-- ordinary T1 user (NOT superadmin) sees NOTHING (Chris-only enforced at RLS).
select set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-000000000002', true);
do $$
declare seen int;
begin
  select count(*) into seen from health_objects;
  if seen <> 0 then raise exception 'FAIL: ordinary user saw % Health rows (must be 0)', seen; end if;
  select count(*) into seen from health_assessments;
  if seen <> 0 then raise exception 'FAIL: ordinary user saw % assessments (must be 0)', seen; end if;
  select count(*) into seen from health_commitment_proposals;
  if seen <> 0 then raise exception 'FAIL: ordinary user saw % proposals (must be 0)', seen; end if;
  select count(*) into seen from health_proposal_sources;
  if seen <> 0 then raise exception 'FAIL: ordinary user saw % sources (must be 0)', seen; end if;
  select count(*) into seen from health_proposal_decisions;
  if seen <> 0 then raise exception 'FAIL: ordinary user saw % decisions (must be 0)', seen; end if;
end $$;

-- T2 superadmin sees ONLY T2's Health Object (never T1's).
select set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-000000000003', true);
do $$
declare leak int; seen int;
begin
  select count(*) into seen from health_objects;
  select count(*) into leak from health_objects where tenant_id <> 'aaaa0000-0000-0000-0000-000000000002';
  if seen < 1 then raise exception 'FAIL: T2 superadmin cannot see T2 Health Object'; end if;
  if leak > 0 then raise exception 'FAIL: cross-tenant leakage for T2 superadmin (% rows)', leak; end if;
end $$;

-- ── (6) WRITE denial: even a Tenant-Superadmin cannot write via PostgREST roles.
-- (Writes are service-role only: RLS has SELECT policies ONLY.)
select set_config('request.jwt.claim.sub','bbbb0000-0000-0000-0000-000000000001', true);
do $$
declare n int;
begin
  begin
    insert into health_objects (tenant_id, health_type, subject_type, subject_id)
    values ('aaaa0000-0000-0000-0000-000000000001','customer_health','person','eeee0000-0000-0000-0000-000000000099');
    raise exception 'FAIL: authenticated INSERT into health_objects was allowed';
  exception when insufficient_privilege then null; end;
  -- UPDATE is denied outright (no table grant for authenticated) or, at worst,
  -- affects zero rows (no UPDATE policy). Either way: no write.
  begin
    update health_commitment_proposals set state='rejected'
     where id='a1000000-0000-0000-0000-000000000001';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: authenticated UPDATE affected % proposal rows (must be 0)', n; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ── (7) anon sees nothing at all — denied at the GRANT level (no SELECT grant),
-- or at worst zero rows via RLS. Either way: nothing.
set local role anon;
do $$
declare seen int;
begin
  begin
    select count(*) into seen from health_objects;
    if seen <> 0 then raise exception 'FAIL: anon saw % health_objects (must be 0)', seen; end if;
  exception when insufficient_privilege then null; end;
  begin
    select count(*) into seen from health_assessments;
    if seen <> 0 then raise exception 'FAIL: anon saw % assessments (must be 0)', seen; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin raise notice 'CUSTOMER-HEALTH: ALL PASSED'; end $$;
rollback;
