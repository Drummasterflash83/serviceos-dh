-- ============================================================================
-- Universal Operational Modes Engine — configuration (additive, backwards-compat)
-- ============================================================================
-- Operational Modes decide HOW MUCH AUTONOMY the platform has for a tenant. Mode
-- behaviour is DATA (this migration seeds it); the resolver never hardcodes it.
-- The tenant's current mode lives in the Tenant Operating Profile (a profile
-- entry), NOT on the tenants table. Every new tenant inherits the platform
-- default — DISCOVERY — until explicitly overridden.
-- ============================================================================

-- ── Canonical mode registry (behaviour is data; also drives the profile seed) ─
create table if not exists operational_modes (
  mode        text primary key,
  ordinal     int  not null,
  description text,
  behaviour   jsonb not null
);
insert into operational_modes (mode, ordinal, description, behaviour) values
  ('discovery', 0, 'Observe only — learn and model the business; no recommendations, no actions',
   '{"ordinal":0,"observe_only":true,"allows_execution":false,"requires_review":false,"max_risk":"none","require_reversible":true,"require_policy_authorised":true,"optimisation":false}'::jsonb),
  ('recommendation', 1, 'AI proposes improvements; nothing executes; everything routes to OpenFolk',
   '{"ordinal":1,"observe_only":false,"allows_execution":false,"requires_review":true,"max_risk":"none","require_reversible":true,"require_policy_authorised":true,"optimisation":false}'::jsonb),
  ('assisted', 2, 'AI automates only low-risk, fully-reversible, policy-authorised work',
   '{"ordinal":2,"observe_only":false,"allows_execution":true,"requires_review":false,"max_risk":"low","require_reversible":true,"require_policy_authorised":true,"optimisation":false}'::jsonb),
  ('trusted', 3, 'AI acts whenever policy, authority, confidence, risk and reversibility allow',
   '{"ordinal":3,"observe_only":false,"allows_execution":true,"requires_review":false,"max_risk":"critical","require_reversible":false,"require_policy_authorised":false,"optimisation":false}'::jsonb),
  ('optimisation', 4, 'Trusted autonomy plus continuous business optimisation',
   '{"ordinal":4,"observe_only":false,"allows_execution":true,"requires_review":false,"max_risk":"critical","require_reversible":false,"require_policy_authorised":false,"optimisation":true}'::jsonb)
on conflict (mode) do nothing;

-- ── Seed the platform-layer operating-profile config the resolver reads. ────
-- current = discovery (the onboarding default, inherited by every tenant);
-- behaviours = the registry, verbatim; promotion = the maturity thresholds.
insert into operating_profile_entries
  (tenant_id, scope_kind, scope_ref, domain, namespace, key, value, version_id)
values
  (null,'platform',null,null,'operational_mode','current','"discovery"'::jsonb,'10000000-0000-0000-0000-000000000002')
on conflict do nothing;

insert into operating_profile_entries
  (tenant_id, scope_kind, scope_ref, domain, namespace, key, value, version_id)
-- coalesce guards the NOT NULL column if the registry were ever empty; an empty
-- '{}' also fails safe (the resolver treats an unknown mode as observe-only).
select null,'platform',null,null,'operational_mode','behaviours',
       coalesce((select jsonb_object_agg(mode, behaviour) from operational_modes), '{}'::jsonb),
       '10000000-0000-0000-0000-000000000002'
on conflict do nothing;

insert into operating_profile_entries
  (tenant_id, scope_kind, scope_ref, domain, namespace, key, value, version_id)
values
  (null,'platform',null,null,'operational_mode','promotion',
   '{
      "recommendation": {"accuracy":0.6, "openfolk_confidence":0.6},
      "assisted":       {"accuracy":0.8, "false_positives":0.1, "manual_overrides":0.2, "openfolk_confidence":0.75},
      "trusted":        {"accuracy":0.9, "false_positives":0.05, "false_negatives":0.05, "automation_success":0.9, "customer_confidence":0.8, "openfolk_confidence":0.85},
      "optimisation":   {"accuracy":0.95, "automation_success":0.95, "customer_confidence":0.85, "openfolk_confidence":0.9}
    }'::jsonb,
   '10000000-0000-0000-0000-000000000002')
on conflict do nothing;

-- ── Audit: record the operational mode that gated each decision. ────────────
alter table decision_log add column if not exists operational_mode text;
create index if not exists decision_log_op_mode on decision_log (tenant_id, operational_mode);

-- ── RLS (registry is non-secret platform metadata). ─────────────────────────
alter table operational_modes enable row level security;
drop policy if exists operational_modes_select on operational_modes;
create policy operational_modes_select on operational_modes for select to authenticated using (true);
