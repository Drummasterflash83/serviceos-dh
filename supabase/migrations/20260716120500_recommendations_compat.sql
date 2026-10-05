-- ============================================================================
-- Universal Intelligence Foundation — recommendations COMPATIBILITY LAYER
-- ============================================================================
-- Strategy (approved): new intelligence_objects table + a compat layer, ZERO
-- disruption to the two live producers (recommendation.sync, identity.resolve)
-- which keep writing the legacy `recommendations` table untouched. Read-side
-- compatibility is provided by views, so a reader can migrate to the unified
-- surface at its own pace. Rollback = drop the two views. See docs §3.3, §12.
--
-- `Recommendation` is now simply one object_type. The Recommendation type's
-- attributes carry the legacy-specific fields (card_id/person_id/company_id/
-- detail/recommended_action/impact) so the projection round-trips exactly.
-- ============================================================================

-- Project Recommendation-type intelligence objects INTO the legacy column shape.
create or replace view recommendation_objects
  with (security_invoker = on) as
select
  o.id,
  o.tenant_id,
  coalesce(o.attributes->>'type', o.object_type)                          as type,
  o.subject                                                               as title,
  o.attributes->>'detail'                                                 as detail,
  o.severity                                                              as severity,
  case when o.status in ('complete','cancelled','approved','rejected')
       then 'resolved' else 'open' end                                    as status,
  nullif(o.attributes->>'card_id','')::uuid                               as card_id,
  (case when array_length(o.source_interactions, 1) >= 1
        then o.source_interactions[1] end)                               as interaction_id,
  nullif(o.attributes->>'person_id','')::uuid                            as person_id,
  nullif(o.attributes->>'company_id','')::uuid                           as company_id,
  o.evidence                                                              as evidence,
  o.attributes->>'recommended_action'                                    as recommended_action,
  o.confidence                                                            as confidence,
  o.created_by,
  o.created_at,
  o.updated_at,
  (case when o.status in ('complete','cancelled','approved','rejected')
        then o.updated_at end)                                           as resolved_at,
  o.deadline                                                             as due_at,
  o.created_from                                                         as source_rule,
  o.attributes->>'impact'                                                as impact
from intelligence_objects o
where o.object_type = 'Recommendation';

-- Unified read surface: legacy rows + object-backed rows. Readers (e.g. the
-- customer_card projection) can point here to see both during/after cutover.
create or replace view recommendations_compat
  with (security_invoker = on) as
  select id, tenant_id, type, title, detail, severity, status, card_id, interaction_id,
         person_id, company_id, evidence, recommended_action, confidence, created_by,
         created_at, updated_at, resolved_at, due_at, source_rule, impact,
         'legacy'::text as origin
  from recommendations
  union all
  select id, tenant_id, type, title, detail, severity, status, card_id, interaction_id,
         person_id, company_id, evidence, recommended_action, confidence, created_by,
         created_at, updated_at, resolved_at, due_at, source_rule, impact,
         'object'::text as origin
  from recommendation_objects;
