-- ServiceOS — Recommendation Engine v1 (deterministic, rule-based).
--
-- The `recommendations` table (Identity Engine v1) already carries type, title,
-- detail (=explanation), severity (=priority), status, card_id, interaction_id,
-- person_id, company_id, evidence, recommended_action (=next action), confidence,
-- resolved_at and the idempotency guard `recommendations_open_uk`
-- (tenant_id, card_id, type) WHERE status='open'. This migration only ADDS the
-- few columns the rule engine needs — non-destructive, existing rows untouched.
--
--   due_at      — when a time-bound action (e.g. respond to an unanswered inbound)
--                 is due; null for non-time-bound recommendations.
--   source_rule — which deterministic rule produced/last-updated the row
--                 (provenance + explainability). Distinct from `type`, which is
--                 the idempotency key shared with the Identity Engine.
--   impact      — "what happens if ignored" (Recommendation philosophy §1).
--
-- Reused as-is: detail (explanation), recommended_action (next action), severity
-- (priority), evidence, confidence, status/resolved_at (lifecycle).

alter table recommendations
  add column if not exists due_at      timestamptz,
  add column if not exists source_rule text,
  add column if not exists impact      text;

-- Speeds the engine's "open recs for this tenant, newest first" + severity reads.
create index if not exists recommendations_tenant_status_severity_idx
  on recommendations (tenant_id, status, severity);
