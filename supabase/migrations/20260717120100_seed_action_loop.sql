-- ============================================================================
-- Universal Intelligence Foundation — SEED: the Action loop (both domains)
-- ============================================================================
-- Pure DATA. The intent→Action mapping lives in domain-pack POLICIES, so the
-- SAME engine serves ServiceOS and ProductOS with zero code branching.
-- Idempotent. Additive — the Commitment slice and its policy are untouched.
-- ============================================================================

-- ── Versioned config artifacts ──────────────────────────────────────────────
insert into config_versions (id, tenant_id, artifact_kind, artifact_key, version, status, author, note, published_at)
values
  ('10000000-0000-0000-0000-000000000006', null, 'policy', 'core.observation',  1, 'published', 'system', 'Observation routing', now()),
  ('10000000-0000-0000-0000-000000000007', null, 'policy', 'serviceos.actions', 1, 'published', 'system', 'ServiceOS actions',   now()),
  ('10000000-0000-0000-0000-000000000008', null, 'policy', 'productos.actions', 1, 'published', 'system', 'ProductOS actions',   now())
on conflict (id) do nothing;

-- ── Object taxonomy: sensing vs work vs insight ─────────────────────────────
insert into domain_object_types (domain, object_type, label, object_class) values
  ('core','Action','Action','action')
on conflict (domain, object_type) do nothing;
update domain_object_types set object_class = 'observation' where domain = 'core' and object_type = 'Observation';
update domain_object_types set object_class = 'action'      where domain = 'core' and object_type = 'Action';
update domain_object_types set object_class = 'insight'     where domain = 'core' and object_type = 'Recommendation';

-- Observation + Action registered in BOTH domains (same core types, pack-scoped).
insert into domain_object_types (domain, object_type, label, object_class) values
  ('serviceos','Observation','Observation','observation'),
  ('serviceos','Action','Action','action'),
  ('productos','Observation','Observation','observation'),
  ('productos','Action','Action','action')
on conflict (domain, object_type) do nothing;

-- ── Action state machine (the reference lifecycle) — both domains ───────────
insert into state_definitions (domain, object_type, state, maps_to_universal, is_terminal) values
  ('serviceos','Action','proposed','ready',false),
  ('serviceos','Action','ready','ready',false),
  ('serviceos','Action','in_progress','monitoring',false),
  ('serviceos','Action','waiting','waiting',false),
  ('serviceos','Action','blocked','blocked',false),
  ('serviceos','Action','escalated','escalated',false),
  ('serviceos','Action','complete','complete',true),
  ('serviceos','Action','cancelled','cancelled',true),
  ('productos','Action','proposed','ready',false),
  ('productos','Action','ready','ready',false),
  ('productos','Action','in_progress','monitoring',false),
  ('productos','Action','waiting','waiting',false),
  ('productos','Action','blocked','blocked',false),
  ('productos','Action','escalated','escalated',false),
  ('productos','Action','complete','complete',true),
  ('productos','Action','cancelled','cancelled',true)
on conflict (domain, object_type, state) do nothing;

insert into state_transitions (domain, object_type, from_state, to_state) values
  ('serviceos','Action','proposed','ready'),
  ('serviceos','Action','ready','in_progress'),
  ('serviceos','Action','in_progress','waiting'),
  ('serviceos','Action','waiting','in_progress'),
  ('serviceos','Action','in_progress','blocked'),
  ('serviceos','Action','blocked','escalated'),
  ('serviceos','Action','in_progress','complete'),
  ('serviceos','Action','ready','cancelled'),
  ('productos','Action','proposed','ready'),
  ('productos','Action','ready','in_progress'),
  ('productos','Action','in_progress','waiting'),
  ('productos','Action','waiting','in_progress'),
  ('productos','Action','in_progress','blocked'),
  ('productos','Action','blocked','escalated'),
  ('productos','Action','in_progress','complete'),
  ('productos','Action','ready','cancelled')
on conflict (domain, object_type, from_state, to_state) do nothing;

-- ── SLA for Actions (platform default + hvac industry override). ────────────
insert into operating_profile_entries (tenant_id, scope_kind, scope_ref, domain, namespace, key, value, version_id) values
  (null,'platform',null,null,'sla','action_hours','48'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'industry','hvac',null,'sla','action_hours','24'::jsonb,'10000000-0000-0000-0000-000000000002')
on conflict do nothing;

-- ── Core policy: ownership + SLA + confidence routing for Observations. ─────
insert into policies (id, tenant_id, domain, scope_kind, name, priority, rules, version_id) values
  ('20000000-0000-0000-0000-000000000002', null, 'core', 'platform', 'Observation routing & ownership', 100,
   jsonb_build_array(
     jsonb_build_object(
       'id','assign-and-sla',
       'when', jsonb_build_object('op','eq','left', jsonb_build_object('field','object_class'), 'right', jsonb_build_object('const','observation')),
       'then', jsonb_build_object(
         'assign', jsonb_build_array(jsonb_build_object('raci_role','accountable','party_kind','role','party_ref', jsonb_build_object('profile','escalation.default_accountable_role'))),
         'set_deadline_hours', jsonb_build_object('profile','sla.action_hours'))),
     jsonb_build_object(
       'id','route-low-confidence',
       'when', jsonb_build_object('op','lt','left', jsonb_build_object('field','confidence'), 'right', jsonb_build_object('profile','confidence.customer_facing_min')),
       'then', jsonb_build_object('review_route','openfolk','reason','Below customer-facing confidence threshold'))
   ),
   '10000000-0000-0000-0000-000000000006')
on conflict (id) do nothing;

-- ── ServiceOS pack policy: intent → Action (DATA, not code). ────────────────
insert into policies (id, tenant_id, domain, scope_kind, name, priority, rules, version_id) values
  ('20000000-0000-0000-0000-000000000003', null, 'serviceos', 'domain', 'ServiceOS actions', 200,
   jsonb_build_array(
     jsonb_build_object(
       'id','engineer-visit',
       'when', jsonb_build_object('op','eq','left', jsonb_build_object('attr','intent'), 'right', jsonb_build_object('const','engineer_visit_requested')),
       'then', jsonb_build_object('propose_action', jsonb_build_object(
         'action_type','assign_engineer_visit','title','Assign engineer visit',
         'automation_intent','schedule_engineer_visit',
         'owner', jsonb_build_object('raci_role','responsible','party_kind','role','party_ref', jsonb_build_object('profile','escalation.default_accountable_role')))))
   ),
   '10000000-0000-0000-0000-000000000007')
on conflict (id) do nothing;

-- ── ProductOS pack policy: intent → Action (DATA, not code). ────────────────
insert into policies (id, tenant_id, domain, scope_kind, name, priority, rules, version_id) values
  ('20000000-0000-0000-0000-000000000004', null, 'productos', 'domain', 'ProductOS actions', 200,
   jsonb_build_array(
     jsonb_build_object(
       'id','stock-low',
       'when', jsonb_build_object('op','eq','left', jsonb_build_object('attr','intent'), 'right', jsonb_build_object('const','stock_low')),
       'then', jsonb_build_object('propose_action', jsonb_build_object(
         'action_type','raise_purchase_order','title','Raise purchase order',
         'automation_intent','create_purchase_order')))
   ),
   '10000000-0000-0000-0000-000000000008')
on conflict (id) do nothing;

-- ── Enable the ProductOS pack for the Drummond tenant (so the loop runs there too).
insert into tenant_domain_packs (tenant_id, domain, enabled, version_id) values
  ('00000000-0000-0000-0000-000000000001','productos', true, '10000000-0000-0000-0000-000000000005')
on conflict (tenant_id, domain) do nothing;
