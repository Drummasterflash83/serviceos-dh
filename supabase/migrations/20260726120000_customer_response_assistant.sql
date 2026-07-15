-- ServiceOS — Customer Response Assistant: the email.reply_draft capability (OPT-IN).
--
-- The first customer-facing operational vertical:
--   inbound email → intelligence.observe → DecisionPackage → proposed reply action
--   → human approval → email.reply_draft capability → immutable approved reply artifact
--
-- SANDBOXED: email.reply_draft PREPARES an approved reply (recipient/subject/body +
-- source-interaction provenance) recorded IMMUTABLY on the execution attempt. It has
-- external_side_effect = false and performs NO transmission — a real email.send_reply
-- connector is a separate, future, explicitly-reviewed change. This keeps the v1 "no
-- dangerous connector" safety invariant (conformance G6) intact.
--
-- Registry rows below are additive + global but INERT (no policy proposes the intent
-- until a tenant is opted in). Turning the vertical on is a deliberate, reversible,
-- per-tenant call — existing production behaviour is unchanged on apply.
--   Activate:   select serviceos_set_customer_response_assistant('<tenant>', true);
-- Deactivate:  select serviceos_set_customer_response_assistant('<tenant>', false);

-- 1) Capability registry — a SAFE internal capability (no external effect).
insert into automation_connector_capabilities (capability_key, description, external_side_effect, risk_category)
values ('email.reply_draft', 'Prepare an approved customer reply draft (no external transmission)', false, 'low')
on conflict (capability_key) do nothing;

-- 2) Intent-type registry — requires_approval = true (no reply drafted without approval).
insert into automation_intent_types
  (intent_type, connector_capability, risk_category, external_side_effect, supports_idempotency, supports_status_lookup, requires_approval, default_expiry_seconds, schema_version, enabled)
values
  ('draft_email_reply', 'email.reply_draft', 'low', false, true, false, true, 86400, '1', true)
on conflict (intent_type) do nothing;

-- 3) Opt-in, reversible per-tenant activation.
create or replace function serviceos_set_customer_response_assistant(
  p_tenant  uuid,
  p_enable  boolean
)
returns text
language plpgsql
as $fn$
declare
  v_connector text := 'openfolk-core';
  v_policy_id uuid := md5('customer_response_assistant:' || p_tenant::text)::uuid;
begin
  if not exists (select 1 from tenants where id = p_tenant) then
    return format('tenant %s not found — no-op', p_tenant);
  end if;

  if p_enable then
    -- assisted mode (tenant-scoped only).
    delete from operating_profile_entries
     where tenant_id = p_tenant and scope_kind = 'tenant'
       and namespace = 'operational_mode' and key = 'current';
    insert into operating_profile_entries
      (tenant_id, scope_kind, scope_ref, domain, namespace, key, value, version_id)
    values
      (p_tenant, 'tenant', null, null, 'operational_mode', 'current', '"assisted"'::jsonb,
       '10000000-0000-0000-0000-000000000002');

    -- controlled internal connector + email.reply_draft capability.
    insert into tenant_connectors
      (tenant_id, connector_id, provider, category, status, health_status, enabled, settings)
    values
      (p_tenant, v_connector, 'internal', 'automation', 'active', 'healthy', true,
       jsonb_build_object('purpose', 'controlled internal automation (no external effect)'))
    on conflict (tenant_id, connector_id) do update
       set status = 'active', health_status = 'healthy', enabled = true, updated_at = now();
    insert into tenant_connector_capabilities (tenant_id, connector_id, capability_key, enabled, config)
    values (p_tenant, v_connector, 'email.reply_draft', true, '{}'::jsonb)
    on conflict (tenant_id, connector_id, capability_key) do update set enabled = true;

    -- TENANT-SCOPED policy: for an inbound EMAIL of this tenant, propose a reply DRAFT
    -- and require human approval. The channel + tenant_id clauses isolate it.
    insert into policies (id, tenant_id, domain, scope_kind, name, rules, priority, enabled, version_id)
    values (
      v_policy_id, p_tenant, 'core', 'tenant',
      'Propose a customer reply draft for inbound email (response assistant)',
      jsonb_build_array(jsonb_build_object(
        'id', 'propose-reply-draft',
        'when', jsonb_build_object('op', 'and', 'clauses', jsonb_build_array(
          jsonb_build_object('op', 'eq', 'left', jsonb_build_object('attr', 'channel'), 'right', jsonb_build_object('const', 'email')),
          jsonb_build_object('op', 'eq', 'left', jsonb_build_object('field', 'tenant_id'), 'right', jsonb_build_object('const', p_tenant::text))
        )),
        'then', jsonb_build_object(
          'propose_action', jsonb_build_object(
            'action_type', 'draft_email_reply',
            'title', 'Draft a reply to the customer',
            'description', 'Thank you for your message — a member of the team will help with your request shortly.',
            'automation_intent', 'draft_email_reply'
          ),
          'automation_permission', 'suggest',
          'reason', 'Inbound customer email — propose a reply draft for human approval'
        )
      )),
      110, true, '10000000-0000-0000-0000-000000000003'
    )
    on conflict (id) do update
       set rules = excluded.rules, enabled = true, priority = excluded.priority, name = excluded.name;

    return format('customer response assistant ENABLED for tenant %s (assisted mode, email.reply_draft, tenant-scoped email policy)', p_tenant);
  else
    delete from operating_profile_entries
     where tenant_id = p_tenant and scope_kind = 'tenant'
       and namespace = 'operational_mode' and key = 'current';
    update policies set enabled = false where id = v_policy_id;
    update tenant_connector_capabilities set enabled = false
     where tenant_id = p_tenant and connector_id = v_connector and capability_key = 'email.reply_draft';
    return format('customer response assistant DISABLED for tenant %s', p_tenant);
  end if;
end;
$fn$;
