-- ============================================================================
-- Universal Intelligence Foundation — SEED: core types + both-domain slice
-- ============================================================================
-- Pure DATA. Proves the SAME engine runs for ServiceOS and ProductOS with no
-- code differences. Idempotent (on conflict do nothing / do update). Fixed UUIDs
-- for config_versions so downstream FKs can reference them deterministically.
-- ============================================================================

-- ── Versioned config artifacts (published pointers). ────────────────────────
insert into config_versions (id, tenant_id, artifact_kind, artifact_key, version, status, author, note, published_at)
values
  ('10000000-0000-0000-0000-000000000001', null, 'domain_pack',       'core',            1, 'published', 'system', 'Core object types', now()),
  ('10000000-0000-0000-0000-000000000002', null, 'operating_profile', 'platform',        1, 'published', 'system', 'Platform defaults',  now()),
  ('10000000-0000-0000-0000-000000000003', null, 'policy',            'core.commitment', 1, 'published', 'system', 'Commitment policy',  now()),
  ('10000000-0000-0000-0000-000000000004', null, 'domain_pack',       'serviceos',       1, 'published', 'system', 'ServiceOS pack',     now()),
  ('10000000-0000-0000-0000-000000000005', null, 'domain_pack',       'productos',       1, 'published', 'system', 'ProductOS pack',     now())
on conflict (id) do nothing;

-- ── The 22 CORE object types (the engine's whole vocabulary). ───────────────
insert into domain_object_types (domain, object_type, label) values
  ('core','Task','Task'),
  ('core','Commitment','Commitment'),
  ('core','MissingInformation','Missing information'),
  ('core','Blocker','Blocker'),
  ('core','Dependency','Dependency'),
  ('core','Risk','Risk'),
  ('core','Opportunity','Opportunity'),
  ('core','Decision','Decision'),
  ('core','ApprovalRequired','Approval required'),
  ('core','Waiting','Waiting'),
  ('core','Recommendation','Recommendation'),
  ('core','FollowUp','Follow up'),
  ('core','CustomerIntent','Customer intent'),
  ('core','SupplierIssue','Supplier issue'),
  ('core','MaterialIssue','Material issue'),
  ('core','StockIssue','Stock issue'),
  ('core','DeliveryIssue','Delivery issue'),
  ('core','QualityIssue','Quality issue'),
  ('core','ComplianceIssue','Compliance issue'),
  ('core','Relationship','Relationship'),
  ('core','Observation','Observation'),
  ('core','Unknown','Unknown')
on conflict (domain, object_type) do nothing;

-- Recommendation attributes carry the legacy fields so the compat view round-trips.
update domain_object_types
   set attributes_schema = jsonb_build_object(
     'type','object',
     'properties', jsonb_build_object(
       'type', jsonb_build_object('type','string'),
       'detail', jsonb_build_object('type','string'),
       'card_id', jsonb_build_object('type','string'),
       'person_id', jsonb_build_object('type','string'),
       'company_id', jsonb_build_object('type','string'),
       'recommended_action', jsonb_build_object('type','string'),
       'impact', jsonb_build_object('type','string')))
 where domain = 'core' and object_type = 'Recommendation';

-- ── Domain packs + the two-domain Commitment slice. ─────────────────────────
insert into domain_packs (id, display_name, description, version_id) values
  ('serviceos','ServiceOS','Field service / trades domain pack', '10000000-0000-0000-0000-000000000004'),
  ('productos','ProductOS','Product / inventory domain pack',   '10000000-0000-0000-0000-000000000005')
on conflict (id) do nothing;

-- Commitment registered in BOTH domains — same core type, domain-scoped extension.
insert into domain_object_types (domain, object_type, label, description) values
  ('serviceos','Commitment','Commitment','A promise made on a job/visit'),
  ('productos','Commitment','Commitment','A promise made on an order/fulfilment')
on conflict (domain, object_type) do nothing;

-- Representative entity types projected into the universal graph (Part 5).
insert into domain_entity_types (domain, node_type, label, is_high_integrity) values
  ('serviceos','Job','Job',false),
  ('serviceos','Visit','Visit',false),
  ('serviceos','Asset','Asset',false),
  ('serviceos','Site','Site',false),
  ('productos','Product','Product',false),
  ('productos','SKU','SKU',false),
  ('productos','PurchaseOrder','Purchase order',true),   -- high-integrity ⇒ dedicated SoR table, projected into graph
  ('productos','Stock','Stock',false)
on conflict (domain, node_type) do nothing;

-- Business terminology diverges per domain WITHOUT code (Part 1).
insert into domain_terminology (domain, tenant_id, term_key, label) values
  ('serviceos', null, 'work_unit', 'Job'),
  ('serviceos', null, 'field_worker', 'Engineer'),
  ('productos', null, 'work_unit', 'Order'),
  ('productos', null, 'field_worker', 'Operator')
on conflict do nothing;

-- ── State machines per (domain, Commitment) — states are DATA (Part 4). ─────
insert into state_definitions (domain, object_type, state, maps_to_universal, is_terminal) values
  ('serviceos','Commitment','unknown','unknown',false),
  ('serviceos','Commitment','ready','ready',false),
  ('serviceos','Commitment','waiting','waiting',false),
  ('serviceos','Commitment','awaiting_parts','waiting',false),  -- domain sub-state → universal 'waiting'
  ('serviceos','Commitment','blocked','blocked',false),
  ('serviceos','Commitment','escalated','escalated',false),
  ('serviceos','Commitment','complete','complete',true),
  ('serviceos','Commitment','cancelled','cancelled',true),
  ('productos','Commitment','unknown','unknown',false),
  ('productos','Commitment','ready','ready',false),
  ('productos','Commitment','waiting','waiting',false),
  ('productos','Commitment','awaiting_stock','waiting',false),   -- domain sub-state → universal 'waiting'
  ('productos','Commitment','blocked','blocked',false),
  ('productos','Commitment','escalated','escalated',false),
  ('productos','Commitment','complete','complete',true),
  ('productos','Commitment','cancelled','cancelled',true)
on conflict (domain, object_type, state) do nothing;

insert into state_transitions (domain, object_type, from_state, to_state) values
  ('serviceos','Commitment','unknown','ready'),
  ('serviceos','Commitment','ready','waiting'),
  ('serviceos','Commitment','ready','awaiting_parts'),
  ('serviceos','Commitment','waiting','ready'),
  ('serviceos','Commitment','awaiting_parts','ready'),
  ('serviceos','Commitment','ready','blocked'),
  ('serviceos','Commitment','blocked','escalated'),
  ('serviceos','Commitment','ready','complete'),
  ('serviceos','Commitment','ready','cancelled'),
  ('productos','Commitment','unknown','ready'),
  ('productos','Commitment','ready','waiting'),
  ('productos','Commitment','ready','awaiting_stock'),
  ('productos','Commitment','waiting','ready'),
  ('productos','Commitment','awaiting_stock','ready'),
  ('productos','Commitment','ready','blocked'),
  ('productos','Commitment','blocked','escalated'),
  ('productos','Commitment','ready','complete'),
  ('productos','Commitment','ready','cancelled')
on conflict (domain, object_type, from_state, to_state) do nothing;

-- ── Platform operating profile: confidence thresholds + SLA + escalation. ───
insert into operating_profile_entries (tenant_id, scope_kind, scope_ref, domain, namespace, key, value, version_id) values
  (null,'platform',null,null,'confidence','customer_facing_min','0.8'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'confidence','auto_max_ambiguity','0.3'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'risk','manual_min_risk','0.6'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'risk','irreversible_max','0.3'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'sla','commitment_hours','48'::jsonb,'10000000-0000-0000-0000-000000000002'),
  (null,'platform',null,null,'escalation','default_accountable_role','"ops"'::jsonb,'10000000-0000-0000-0000-000000000002')
on conflict do nothing;

-- Industry layer example (hvac) tightens the SLA — DATA, not code.
insert into operating_profile_entries (tenant_id, scope_kind, scope_ref, domain, namespace, key, value, version_id) values
  (null,'industry','hvac',null,'sla','commitment_hours','24'::jsonb,'10000000-0000-0000-0000-000000000002')
on conflict do nothing;

-- ── Enable the ServiceOS pack for the Drummond tenant. ──────────────────────
insert into tenant_domain_packs (tenant_id, domain, enabled, version_id) values
  ('00000000-0000-0000-0000-000000000001','serviceos', true, '10000000-0000-0000-0000-000000000004')
on conflict (tenant_id, domain) do nothing;

-- ── The Commitment policy (declarative decision table, Part 6). ─────────────
-- Rule DSL understood by the pure evaluator (see _shared/intelligence/policy.ts):
--   condition ops: and|or|not|eq|neq|lt|lte|gt|gte|in|exists
--   operands: {field}|{attr}|{profile:"ns.key"}|{const}
--   effects (closed set): set_priority|set_deadline_hours|assign|review_route|
--                         recommended_action|escalate|automation_permission
insert into policies (id, tenant_id, domain, scope_kind, name, priority, rules, version_id) values
  ('20000000-0000-0000-0000-000000000001', null, 'core', 'platform', 'Commitment routing & ownership', 100,
   jsonb_build_array(
     -- Always: default accountable to the profile's escalation role.
     jsonb_build_object(
       'id','assign-accountable',
       'when', jsonb_build_object('op','eq','left', jsonb_build_object('field','object_type'), 'right', jsonb_build_object('const','Commitment')),
       'then', jsonb_build_object(
         'assign', jsonb_build_array(jsonb_build_object('raci_role','accountable','party_kind','role','party_ref', jsonb_build_object('profile','escalation.default_accountable_role'))),
         'set_deadline_hours', jsonb_build_object('profile','sla.commitment_hours'))),
     -- Low confidence never reaches customers → OpenFolk review.
     jsonb_build_object(
       'id','route-low-confidence',
       'when', jsonb_build_object('op','lt','left', jsonb_build_object('field','confidence'), 'right', jsonb_build_object('profile','confidence.customer_facing_min')),
       'then', jsonb_build_object('review_route','openfolk','reason','Below customer-facing confidence threshold')),
     -- High-ambiguity → OpenFolk review.
     jsonb_build_object(
       'id','route-ambiguous',
       'when', jsonb_build_object('op','gt','left', jsonb_build_object('field','ambiguity'), 'right', jsonb_build_object('profile','confidence.auto_max_ambiguity')),
       'then', jsonb_build_object('review_route','openfolk','reason','Ambiguous extraction')),
     -- Risky AND hard to reverse → senior/manual review + high priority.
     jsonb_build_object(
       'id','route-irreversible-risk',
       'when', jsonb_build_object('op','and','clauses', jsonb_build_array(
                 jsonb_build_object('op','gte','left', jsonb_build_object('field','risk'), 'right', jsonb_build_object('profile','risk.manual_min_risk')),
                 jsonb_build_object('op','lt','left', jsonb_build_object('field','reversibility'), 'right', jsonb_build_object('profile','risk.irreversible_max')))),
       'then', jsonb_build_object('review_route','tenant_senior','set_priority','high','reason','High-risk irreversible commitment'))
   ),
   '10000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

-- ── Example subscription (dispatcher wiring is deferred; this documents intent). ─
insert into subscriptions (tenant_id, event_type, handler_job_type, enabled)
values (null, 'intelligence.object.created', 'intelligence.evaluate', false)
on conflict do nothing;
