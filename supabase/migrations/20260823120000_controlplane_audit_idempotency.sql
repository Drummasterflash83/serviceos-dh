-- ============================================================================
-- ServiceOS / OpenFolk — Control Plane audit idempotency.
--
-- DEFECT: cp_upsert_endpoint appended a controlplane_change_log row on EVERY call,
-- including a no-op discovery refresh where nothing changed. Two identical email
-- discovery runs of 32 mailboxes therefore produced 64 change-log rows (32 real inserts
-- + 32 no-op "updates"). A `before update` trigger (ce_set_updated_at) bumps updated_at
-- on any UPDATE, so a jsonb before/after diff cannot distinguish a real change — the fix
-- compares the MATERIAL fields explicitly and skips both the UPDATE and the change-log
-- when nothing material differs.
--
-- Behaviour now:
--   * created  → one endpoint-change audit row (INSERT)
--   * updated  → one endpoint-change audit row (material field changed)
--   * unchanged→ NO endpoint-change audit row, and no updated_at churn
-- The per-run discovery SUMMARY (one row per run, with imported/updated/unchanged/
-- excluded counts) is written by the discovery caller, not per endpoint.
--
-- Return type widens uuid → jsonb {id, outcome}. Only two callers exist
-- (openfolk-control-plane index.ts + controlplane/discovery.ts, both updated in the same
-- change); the SECURITY DEFINER privilege tests key on the ARGUMENT signature, which is
-- unchanged, so they are unaffected. Existing change-log history is preserved (never
-- deleted). Additive & idempotent.
-- ============================================================================

-- Return type widens uuid → jsonb, which CREATE OR REPLACE cannot do — drop first. The
-- argument signature is unchanged, so the SECURITY DEFINER privilege tests still match.
drop function if exists cp_upsert_endpoint(uuid,text,text,text,text,text,text,boolean,text,text,jsonb,text,text,text,boolean);

create or replace function cp_upsert_endpoint(
  p_tenant uuid, p_channel text, p_endpoint_kind text, p_normalized text,
  p_display text, p_provider text, p_provider_ref text, p_is_shared boolean,
  p_source text, p_source_object_ref text, p_metadata jsonb,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
  v_row communication_endpoints;
  v_outcome text;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_upsert_endpoint: actor is required';
  end if;
  select * into v_row from communication_endpoints
   where tenant_id = p_tenant and status = 'active'
     and ( (p_provider_ref is not null and provider is not distinct from p_provider and provider_external_ref = p_provider_ref)
        or (channel = p_channel and endpoint_kind = p_endpoint_kind and normalized_value = p_normalized) )
   limit 1;
  if found then
    v_id := v_row.id;
    v_before := to_jsonb(v_row);
    -- Material change? (coalesce mirrors the update's "keep existing when null" semantics.)
    if      v_row.display_value         is distinct from coalesce(p_display,           v_row.display_value)
         or v_row.provider              is distinct from coalesce(p_provider,          v_row.provider)
         or v_row.provider_external_ref is distinct from coalesce(p_provider_ref,      v_row.provider_external_ref)
         or v_row.is_shared             is distinct from coalesce(p_is_shared,         v_row.is_shared)
         or v_row.source_object_ref     is distinct from coalesce(p_source_object_ref, v_row.source_object_ref)
         or v_row.metadata              is distinct from coalesce(p_metadata,          v_row.metadata)
    then
      update communication_endpoints set
        display_value         = coalesce(p_display, display_value),
        provider              = coalesce(p_provider, provider),
        provider_external_ref = coalesce(p_provider_ref, provider_external_ref),
        is_shared             = coalesce(p_is_shared, is_shared),
        source_object_ref     = coalesce(p_source_object_ref, source_object_ref),
        metadata              = coalesce(p_metadata, metadata)
       where id = v_id;
      select to_jsonb(c) into v_after from communication_endpoints c where c.id = v_id;
      v_outcome := 'updated';
    else
      v_after := v_before;
      v_outcome := 'unchanged';
    end if;
  else
    insert into communication_endpoints
      (tenant_id, channel, endpoint_kind, normalized_value, display_value, provider,
       provider_external_ref, is_shared, source, source_object_ref, metadata)
    values (p_tenant, p_channel, p_endpoint_kind, p_normalized, p_display, p_provider,
       p_provider_ref, coalesce(p_is_shared, false), coalesce(p_source, 'openfolk'),
       p_source_object_ref, coalesce(p_metadata, '{}'::jsonb))
    returning id into v_id;
    select to_jsonb(c) into v_after from communication_endpoints c where c.id = v_id;
    v_outcome := 'created';
  end if;

  -- Append a change-log row ONLY on a material change (create or real update).
  if v_outcome <> 'unchanged' then
    insert into controlplane_change_log
      (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
    values (p_tenant, p_actor, 'controlplane.endpoint.upsert', 'communication_endpoint', v_id::text,
       v_before, v_after, p_reason, p_correlation, coalesce(p_view_as, false), coalesce(p_source, 'controlplane'));
  end if;

  return jsonb_build_object('id', v_id, 'outcome', v_outcome);
end $$;

-- DROP removed the execute grants — re-apply the exact lockdown from 20260821120000:
-- SECURITY DEFINER, callable ONLY by service_role (never public/anon/authenticated).
revoke execute on function cp_upsert_endpoint(uuid,text,text,text,text,text,text,boolean,text,text,jsonb,text,text,text,boolean) from public, anon, authenticated;
grant  execute on function cp_upsert_endpoint(uuid,text,text,text,text,text,text,boolean,text,text,jsonb,text,text,text,boolean) to service_role;

-- Governed record of the correction (idempotent by resource + action).
insert into controlplane_change_log
  (tenant_id, actor, action, resource_type, resource_id, before, after, reason, source)
select null, 'system:migration', 'controlplane.audit.idempotency_fix', 'function', 'cp_upsert_endpoint',
  jsonb_build_object('change_log', 'written on every call (incl. no-op)'),
  jsonb_build_object('change_log', 'written only on material create/update; per-run summary written by the caller'),
  'Stop no-op discovery refreshes from generating change-log noise (64 rows for 32 endpoints across two runs).',
  'migration'
where not exists (
  select 1 from controlplane_change_log
  where action = 'controlplane.audit.idempotency_fix' and resource_id = 'cp_upsert_endpoint'
);
