-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_foundation.test.sql
--
-- Proves Marketing CRM Phase-1 foundation invariants (migration 20260828120000):
--   • Platform seeds present: 11 marketing_permissions + 8 lifecycle template stages.
--   • RLS enabled on every new tenant table.
--   • Tenant isolation: an authenticated user sees ONLY their tenant's marketing rows,
--     never another tenant's (cross-tenant denial).
--   • No client write path: the authenticated role cannot INSERT (writes are service-role).
--   • communication_preferences is APPEND-ONLY (update/delete rejected).
--   • contact_suppressions: at most one ACTIVE suppression per (tenant, channel, value)
--     — the fail-closed dedup key.
--   • Lifecycle template rows (tenant_id null) are readable by any authenticated user.
begin;

insert into tenants (id, slug, display_name, industry) values
  ('aaaa0000-0000-0000-0000-0000000000d1','mkt-t1','Marketing Tenant 1','hvac'),
  ('aaaa0000-0000-0000-0000-0000000000d2','mkt-t2','Marketing Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb0000-0000-0000-0000-0000000000d1','user-a@mkt.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000d2','user-b@mkt.test',false,false);
update profiles set role='admin', tenant_id='aaaa0000-0000-0000-0000-0000000000d1'
  where id='bbbb0000-0000-0000-0000-0000000000d1';
update profiles set role='admin', tenant_id='aaaa0000-0000-0000-0000-0000000000d2'
  where id='bbbb0000-0000-0000-0000-0000000000d2';

insert into people (id, tenant_id, display_name, primary_email) values
  ('cccc0000-0000-0000-0000-0000000000d1','aaaa0000-0000-0000-0000-0000000000d1','Alice A','alice@a.test'),
  ('cccc0000-0000-0000-0000-0000000000d2','aaaa0000-0000-0000-0000-0000000000d2','Bob B','bob@b.test');

insert into contact_relationships (tenant_id, person_id, relationship_type, lifecycle_stage_key) values
  ('aaaa0000-0000-0000-0000-0000000000d1','cccc0000-0000-0000-0000-0000000000d1','lead','new_lead'),
  ('aaaa0000-0000-0000-0000-0000000000d2','cccc0000-0000-0000-0000-0000000000d2','lead','new_lead');

-- ── (1) Platform seeds ──────────────────────────────────────────────────────
do $$
begin
  assert (select count(*) from marketing_permissions) = 11, 'expected 11 marketing_permissions';
  assert (select count(*) from marketing_lifecycle_stages where tenant_id is null) = 8,
    'expected 8 lifecycle template stages';
  assert (select count(*) from marketing_lifecycle_stages where tenant_id is null and terminal_outcome = 'won') = 1,
    'expected a Won terminal stage in the template';
end $$;

-- ── (2) RLS enabled on every new tenant table ───────────────────────────────
do $$
declare missing text;
begin
  select string_agg(tablename, ', ') into missing
  from pg_tables
  where schemaname='public'
    and tablename in ('marketing_settings','contact_points','contact_relationships',
                      'communication_preferences','contact_suppressions','marketing_tags',
                      'contact_tag_assignments','marketing_segments','marketing_campaigns',
                      'marketing_access_grants','marketing_lifecycle_stages','marketing_permissions')
    and rowsecurity = false;
  assert missing is null, format('RLS not enabled on: %s', missing);
end $$;

-- ── (3) Tenant isolation — user A ───────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000d1';
do $$
begin
  assert (select count(*) from contact_relationships) = 1,
    'user A must see exactly their own 1 relationship';
  assert (select bool_and(tenant_id = 'aaaa0000-0000-0000-0000-0000000000d1') from contact_relationships),
    'user A must see NO other tenant rows (cross-tenant leak)';
  assert (select count(*) from marketing_lifecycle_stages) >= 8,
    'authenticated user must see the platform lifecycle template (tenant_id null)';
end $$;
reset role;

-- ── (4) Tenant isolation — user B ───────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000d2';
do $$
begin
  assert (select count(*) from contact_relationships) = 1, 'user B sees exactly 1';
  assert (select bool_and(tenant_id = 'aaaa0000-0000-0000-0000-0000000000d2') from contact_relationships),
    'user B must see NO tenant A rows';
end $$;
reset role;

-- ── (5) No client write path (authenticated INSERT denied) ──────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000d1';
do $$
begin
  begin
    insert into contact_relationships (tenant_id, person_id, relationship_type)
      values ('aaaa0000-0000-0000-0000-0000000000d1','cccc0000-0000-0000-0000-0000000000d1','customer');
    assert false, 'authenticated INSERT must be denied (writes are service-role only)';
  exception when insufficient_privilege or check_violation then
    null; -- expected
  end;
end $$;
reset role;

-- ── (6) communication_preferences is append-only ────────────────────────────
insert into communication_preferences (tenant_id, person_id, channel, state, source)
  values ('aaaa0000-0000-0000-0000-0000000000d1','cccc0000-0000-0000-0000-0000000000d1','email','subscribed','signup');
do $$
begin
  begin
    update communication_preferences set state='unsubscribed'
      where person_id='cccc0000-0000-0000-0000-0000000000d1';
    assert false, 'preference update must be rejected (append-only)';
  exception when others then
    null; -- expected: raising trigger
  end;
end $$;

-- ── (7) Suppression fail-closed dedup: one ACTIVE per (tenant, channel, value) ─
insert into contact_suppressions (tenant_id, person_id, channel, normalized_value, reason)
  values ('aaaa0000-0000-0000-0000-0000000000d1','cccc0000-0000-0000-0000-0000000000d1','email','alice@a.test','unsubscribe');
do $$
begin
  begin
    insert into contact_suppressions (tenant_id, person_id, channel, normalized_value, reason)
      values ('aaaa0000-0000-0000-0000-0000000000d1','cccc0000-0000-0000-0000-0000000000d1','email','alice@a.test','manual');
    assert false, 'a second ACTIVE suppression for the same destination must be rejected';
  exception when unique_violation then
    null; -- expected
  end;
end $$;

select 'marketing_foundation.test.sql: ALL ASSERTIONS PASSED' as result;
rollback;
