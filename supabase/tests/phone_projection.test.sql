-- ServiceOS — Phone interaction projection incremental assertions (§9).
-- Run: psql "$DATABASE_URL" -f supabase/tests/phone_projection.test.sql
-- Rolls back — never mutates real data. Prints the PASS notice on success.
--
-- Proves: unchanged projected calls are NOT re-selected (steady state 0); a new
-- call is selected exactly once; a changed AI insight triggers exactly one refresh;
-- a re-projected call is not re-selected; legacy (null-marker) rows are repaired;
-- and one canonical interaction per call is preserved (no duplicates).

begin;

do $$
declare
  v_tenant uuid := '00000000-0000-0000-0000-0000000000dd';
  v_call1  uuid; -- projected & unchanged
  v_call2  uuid; -- new, no interaction
  v_now    timestamptz := now();
  v_cnt    int;
begin
  -- call1: already projected with an up-to-date marker.
  insert into phone_calls (id, tenant_id, provider, provider_call_id, started_at, created_at, updated_at)
    values (gen_random_uuid(), v_tenant, 'simwood', 'C1',
            v_now - interval '2 days', v_now - interval '2 days', v_now - interval '2 days')
    returning id into v_call1;
  insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                            interaction_type, occurred_at, source_updated_at)
    values (v_tenant, 'simwood', 'phone', 'phone_calls', v_call1, 'phone_call',
            v_now - interval '2 days', v_now - interval '2 days');

  -- 1) Steady state: an unchanged projected call is NOT selected.
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call1;
  if v_cnt <> 0 then raise exception 'unchanged call should not be selected (got %)', v_cnt; end if;

  -- 2) A NEW call with no interaction is selected exactly once.
  insert into phone_calls (id, tenant_id, provider, provider_call_id, started_at, created_at, updated_at)
    values (gen_random_uuid(), v_tenant, 'simwood', 'C2',
            v_now - interval '1 hour', v_now - interval '1 hour', v_now - interval '1 hour')
    returning id into v_call2;
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call2;
  if v_cnt <> 1 then raise exception 'new call should be selected once (got %)', v_cnt; end if;

  -- Project call2 (marker = call.updated_at) → no longer selected.
  insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                            interaction_type, occurred_at, source_updated_at)
    values (v_tenant, 'simwood', 'phone', 'phone_calls', v_call2, 'phone_call',
            v_now - interval '1 hour', v_now - interval '1 hour');
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call2;
  if v_cnt <> 0 then raise exception 'projected call2 should not reselect (got %)', v_cnt; end if;

  -- 3) A changed AI insight (updated_at newer than the marker) selects the call once.
  insert into phone_ai_insights (tenant_id, call_id, updated_at, created_at)
    values (v_tenant, v_call1, v_now, v_now);
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call1;
  if v_cnt <> 1 then raise exception 'changed insight should select the call (got %)', v_cnt; end if;

  -- 4) Re-project call1 (advance the marker) → not selected again (one refresh only).
  update interactions set source_updated_at = v_now
    where tenant_id = v_tenant and source_table = 'phone_calls' and source_id = v_call1;
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call1;
  if v_cnt <> 0 then raise exception 'reprojected call1 should not reselect (got %)', v_cnt; end if;

  -- 5) Idempotency: a duplicate interaction upsert keeps exactly ONE row.
  insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                            interaction_type, occurred_at)
    values (v_tenant, 'simwood', 'phone', 'phone_calls', v_call1, 'phone_call', v_now)
    on conflict (tenant_id, source_table, source_id) do nothing;
  select count(*) into v_cnt from interactions
    where tenant_id = v_tenant and source_table = 'phone_calls' and source_id = v_call1;
  if v_cnt <> 1 then raise exception 'duplicate interaction created (got %)', v_cnt; end if;

  -- 6) Legacy repair: an interaction with a NULL marker is selected once (then fixed).
  update interactions set source_updated_at = null
    where tenant_id = v_tenant and source_table = 'phone_calls' and source_id = v_call2;
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call2;
  if v_cnt <> 1 then raise exception 'legacy null-marker interaction should be selected (got %)', v_cnt; end if;

  raise notice 'ALL PHONE PROJECTION ASSERTIONS PASSED';
end $$;

rollback;
