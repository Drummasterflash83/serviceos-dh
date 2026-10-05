-- ServiceOS — OAuth-state cleanup proof: consumed + expired purged, ACTIVE retained.
-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres < supabase/tests/provider_oauth_state_cleanup.test.sql
begin;

do $$
declare
  t uuid := '99999999-9999-4999-8999-999999999999';
  removed int;
  active_left int;
  consumed_left int;
  expired_left int;
begin
  -- active: unused, future expiry → must survive
  insert into provider_oauth_states (tenant_id, provider, state, expires_at, created_at)
    values (t, 'oauth_demo', 'active-1', now() + interval '10 min', now() - interval '2 hour');
  -- consumed: used_at set → must be purged
  insert into provider_oauth_states (tenant_id, provider, state, expires_at, used_at, created_at)
    values (t, 'oauth_demo', 'consumed-1', now() + interval '10 min', now() - interval '5 min', now() - interval '2 hour');
  -- expired: past expiry, unused → must be purged
  insert into provider_oauth_states (tenant_id, provider, state, expires_at, created_at)
    values (t, 'oauth_demo', 'expired-1', now() - interval '20 min', now() - interval '2 hour');

  -- retain grace 0 → purge all eligible immediately
  removed := public.cleanup_provider_oauth_states('0 seconds'::interval);
  if removed <> 2 then raise exception 'FAIL: expected 2 removed, got %', removed; end if;

  select count(*) into active_left  from provider_oauth_states where tenant_id = t and state = 'active-1';
  select count(*) into consumed_left from provider_oauth_states where tenant_id = t and state = 'consumed-1';
  select count(*) into expired_left  from provider_oauth_states where tenant_id = t and state = 'expired-1';
  if active_left  <> 1 then raise exception 'FAIL: active state was deleted'; end if;
  if consumed_left<> 0 then raise exception 'FAIL: consumed state survived'; end if;
  if expired_left <> 0 then raise exception 'FAIL: expired state survived'; end if;

  -- retain grace protects a JUST-consumed row (created within the grace window)
  insert into provider_oauth_states (tenant_id, provider, state, expires_at, used_at, created_at)
    values (t, 'oauth_demo', 'fresh-consumed', now() + interval '10 min', now(), now());
  removed := public.cleanup_provider_oauth_states('1 hour'::interval);
  if (select count(*) from provider_oauth_states where tenant_id = t and state = 'fresh-consumed') <> 1 then
    raise exception 'FAIL: retain grace did not protect a just-consumed row';
  end if;

  raise notice 'OAUTH-STATE CLEANUP: ALL PASSED';
end $$;

-- authorization surface: maintenance fn is service_role only
do $$
begin
  if has_function_privilege('authenticated', 'public.cleanup_provider_oauth_states(interval)', 'execute')
    then raise exception 'FAIL: authenticated can execute cleanup fn'; end if;
  if not has_function_privilege('service_role', 'public.cleanup_provider_oauth_states(interval)', 'execute')
    then raise exception 'FAIL: service_role cannot execute cleanup fn'; end if;
  raise notice 'OAUTH-STATE CLEANUP AUTH: PASSED';
end $$;

rollback;
