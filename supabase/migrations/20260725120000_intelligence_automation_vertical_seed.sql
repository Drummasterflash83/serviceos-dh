-- ServiceOS — First Intelligence → Automation vertical: OPT-IN enabling config.
--
-- The complete horizontal vertical (inbound interaction → Observation → DecisionPackage
-- → pending automation_intent → human automation_approval → automation.execute →
-- internal.create_note → immutable outcome) requires three pieces of enabling config for
-- a tenant: `assisted` operational mode, the controlled internal connector +
-- `internal.create_note` capability, and a core policy proposing a controlled internal
-- note. Turning any of these on GLOBALLY would change existing tenants' decision routing,
-- so this migration changes NO data on apply — it only defines a deliberate, reversible,
-- per-tenant activation function. Existing production behaviour is therefore unchanged
-- until an operator explicitly opts a tenant in.
--
-- Activate:    select serviceos_set_automation_vertical('<tenant-uuid>', true);
-- Deactivate:  select serviceos_set_automation_vertical('<tenant-uuid>', false);
--
-- Isolation: the policy it creates is TENANT-SCOPED in its own `when` condition
-- (tenant_id = the activated tenant), so even though the decision engine loads all
-- enabled policies, this one can only ever match the activated tenant's observations.
-- No customer-specific logic, no external connector, no schema/engine change.

create or replace function serviceos_set_automation_vertical(
  p_tenant  uuid,
  p_enable  boolean
)
returns text
language plpgsql
as $fn$
declare
  v_connector text := 'openfolk-core';           -- the controlled internal connector
  v_policy_id uuid := md5('automation_vertical:' || p_tenant::text)::uuid;
begin
  if not exists (select 1 from tenants where id = p_tenant) then
    return format('tenant %s not found — no-op', p_tenant);
  end if;

  if p_enable then
    -- 1) assisted mode (tenant-scoped only; platform default stays untouched).
    delete from operating_profile_entries
     where tenant_id = p_tenant and scope_kind = 'tenant'
       and namespace = 'operational_mode' and key = 'current';
    insert into operating_profile_entries
      (tenant_id, scope_kind, scope_ref, domain, namespace, key, value, version_id)
    values
      (p_tenant, 'tenant', null, null, 'operational_mode', 'current', '"assisted"'::jsonb,
       '10000000-0000-0000-0000-000000000002');

    -- 2) controlled internal connector + capability (external_side_effect = false).
    insert into tenant_connectors
      (tenant_id, connector_id, provider, category, status, health_status, enabled, settings)
    values
      (p_tenant, v_connector, 'internal', 'automation', 'active', 'healthy', true,
       jsonb_build_object('purpose', 'controlled internal automation (no external effect)'))
    on conflict (tenant_id, connector_id) do update
       set status = 'active', health_status = 'healthy', enabled = true, updated_at = now();
    insert into tenant_connector_capabilities
      (tenant_id, connector_id, capability_key, enabled, config)
    values
      (p_tenant, v_connector, 'internal.create_note', true, '{}'::jsonb)
    on conflict (tenant_id, connector_id, capability_key) do update set enabled = true;

    -- 3) TENANT-SCOPED core policy: for an inbound communication of THIS tenant, propose
    --    a controlled internal note and REQUIRE human approval (automation_permission =
    --    suggest → AUTOMATION_REQUIRES_APPROVAL). The tenant_id clause isolates it.
    insert into policies (id, tenant_id, domain, scope_kind, name, rules, priority, enabled, version_id)
    values (
      v_policy_id,
      p_tenant,
      'core',
      'tenant',
      'Propose a controlled internal note for inbound communications (vertical)',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'propose-internal-note',
          'when', jsonb_build_object('op', 'and', 'clauses', jsonb_build_array(
            jsonb_build_object('op', 'exists', 'left', jsonb_build_object('attr', 'channel')),
            jsonb_build_object('op', 'eq',
              'left',  jsonb_build_object('field', 'tenant_id'),
              'right', jsonb_build_object('const', p_tenant::text))
          )),
          'then', jsonb_build_object(
            'propose_action', jsonb_build_object(
              'action_type', 'record_internal_note',
              'title', 'Record a controlled internal note',
              'description', 'Draft an internal suggested response for review',
              'automation_intent', 'record_internal_note'
            ),
            'automation_permission', 'suggest',
            'reason', 'Inbound communication — propose a controlled internal note for human approval'
          )
        )
      ),
      120,
      true,
      '10000000-0000-0000-0000-000000000003'
    )
    on conflict (id) do update
       set rules = excluded.rules, enabled = true, priority = excluded.priority, name = excluded.name;

    return format('automation vertical ENABLED for tenant %s (assisted mode, internal.create_note, tenant-scoped policy)', p_tenant);
  else
    -- Reverse every activation effect. Connector/capability are harmless when left, but
    -- we disable the capability + remove the mode override + disable the policy so the
    -- tenant returns EXACTLY to default behaviour.
    delete from operating_profile_entries
     where tenant_id = p_tenant and scope_kind = 'tenant'
       and namespace = 'operational_mode' and key = 'current';
    update policies set enabled = false where id = v_policy_id;
    update tenant_connector_capabilities set enabled = false
     where tenant_id = p_tenant and connector_id = v_connector and capability_key = 'internal.create_note';
    return format('automation vertical DISABLED for tenant %s (mode override removed, policy + capability disabled)', p_tenant);
  end if;
end;
$fn$;
