-- ServiceOS — Phone interaction projection incremental assertions (content version).
-- Run: psql "$DATABASE_URL" -f supabase/tests/phone_projection.test.sql
-- Rolls back — never mutates real data. Prints the PASS notice on success.
--
-- Proves the marker is a deterministic CONTENT hash (interactions.source_version),
-- immune to the no-op-re-upsert churn that broke the timestamp marker:
--   * an unchanged projected call is NOT re-selected (steady state 0),
--   * a NO-OP phone_calls re-upsert (bumps updated_at via set_updated_at) does NOT
--     re-select — the real regression that caused 221/221 every cycle,
--   * a new call is selected exactly once,
--   * a genuinely-changed AI insight triggers exactly one refresh,
--   * a re-projected call is not re-selected,
--   * one canonical interaction per call (no duplicates).

begin;

do $$
declare
  v_tenant uuid := '00000000-0000-0000-0000-0000000000dd';
  v_call1  uuid;
  v_call2  uuid;
  v_now    timestamptz := now();
  v_ver    text;
  v_cnt    int;
begin
  -- call1 with an AI insight; project it with the CURRENT content version.
  insert into phone_calls (id, tenant_id, provider, provider_call_id, direction, from_number,
                           to_number, started_at, duration_seconds, outcome, created_at, updated_at)
    values (gen_random_uuid(), v_tenant, 'simwood', 'C1', 'IN', '+441', '+442',
            v_now - interval '2 days', 60, 'answered', v_now - interval '2 days', v_now - interval '2 days')
    returning id into v_call1;
  insert into phone_ai_insights (tenant_id, call_id, summary, sentiment, created_at, updated_at)
    values (v_tenant, v_call1, 'Boiler fault', 'neutral', v_now - interval '2 days', v_now - interval '2 days');

  v_ver := phone_projection_version(v_tenant, v_call1);
  insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                            interaction_type, occurred_at, source_version)
    values (v_tenant, 'simwood', 'phone', 'phone_calls', v_call1, 'phone_call',
            v_now - interval '2 days', v_ver);

  -- 1) Steady state: unchanged projected call is NOT selected.
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call1;
  if v_cnt <> 0 then raise exception 'unchanged call selected (got %)', v_cnt; end if;

  -- 2) THE REGRESSION: a no-op re-upsert bumps phone_calls.updated_at=now() but
  --    changes no projected content → must STILL not be selected.
  insert into phone_calls (tenant_id, provider, provider_call_id, direction, from_number,
                           to_number, started_at, duration_seconds, outcome)
    values (v_tenant, 'simwood', 'C1', 'IN', '+441', '+442', v_now - interval '2 days', 60, 'answered')
    on conflict (tenant_id, provider, provider_call_id)
    do update set outcome = excluded.outcome;  -- fires set_updated_at → updated_at=now()
  if (select updated_at from phone_calls where id = v_call1) <= v_now - interval '2 days' then
    raise exception 'precondition: updated_at was not bumped by the re-upsert';
  end if;
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call1;
  if v_cnt <> 0 then raise exception 'no-op re-upsert re-selected the call (got %) — churn bug', v_cnt; end if;

  -- 3) A NEW call is selected exactly once.
  insert into phone_calls (id, tenant_id, provider, provider_call_id, direction, started_at, created_at, updated_at)
    values (gen_random_uuid(), v_tenant, 'simwood', 'C2', 'OUT', v_now - interval '1 hour',
            v_now - interval '1 hour', v_now - interval '1 hour')
    returning id into v_call2;
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call2;
  if v_cnt <> 1 then raise exception 'new call not selected once (got %)', v_cnt; end if;
  insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                            interaction_type, occurred_at, source_version)
    values (v_tenant, 'simwood', 'phone', 'phone_calls', v_call2, 'phone_call',
            v_now - interval '1 hour', phone_projection_version(v_tenant, v_call2));
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call2;
  if v_cnt <> 0 then raise exception 'projected new call re-selected (got %)', v_cnt; end if;

  -- 4) A genuinely-changed AI insight (new summary) selects the call once.
  update phone_ai_insights set summary = 'Boiler fault — engineer booked', updated_at = v_now
    where tenant_id = v_tenant and call_id = v_call1;
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call1;
  if v_cnt <> 1 then raise exception 'changed insight did not select the call (got %)', v_cnt; end if;

  -- 5) Re-project (store the new version) → not selected again.
  update interactions set source_version = phone_projection_version(v_tenant, v_call1)
    where tenant_id = v_tenant and source_table = 'phone_calls' and source_id = v_call1;
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call1;
  if v_cnt <> 0 then raise exception 'reprojected call re-selected (got %)', v_cnt; end if;

  -- 6) Idempotency: duplicate interaction upsert keeps exactly ONE row.
  insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                            interaction_type, occurred_at)
    values (v_tenant, 'simwood', 'phone', 'phone_calls', v_call1, 'phone_call', v_now)
    on conflict (tenant_id, source_table, source_id) do nothing;
  select count(*) into v_cnt from interactions
    where tenant_id = v_tenant and source_table = 'phone_calls' and source_id = v_call1;
  if v_cnt <> 1 then raise exception 'duplicate interaction created (got %)', v_cnt; end if;

  -- 7) Legacy repair: a null-version interaction is selected once.
  update interactions set source_version = null
    where tenant_id = v_tenant and source_table = 'phone_calls' and source_id = v_call2;
  select count(*) into v_cnt from phone_select_projectable(v_tenant, 500) where id = v_call2;
  if v_cnt <> 1 then raise exception 'null-version interaction not selected (got %)', v_cnt; end if;

  raise notice 'ALL PHONE PROJECTION (CONTENT-VERSION) ASSERTIONS PASSED';
end $$;

rollback;
