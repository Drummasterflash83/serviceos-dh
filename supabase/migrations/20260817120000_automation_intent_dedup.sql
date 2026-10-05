-- ServiceOS — Automation intent semantic de-duplication (additive, non-frozen).
--
-- Problem: intelligence.observe materialises one Action + one PENDING automation_intent
-- per observation. For the generic "record a controlled internal note" action this floods
-- the approval queue with hundreds of identical pending intents (one per signal), even when
-- they concern the same customer on the same day — the operator sees noise, not real work.
--
-- Fix: a SEMANTIC de-dup key on PENDING intents so at most one active intent exists per
-- (tenant, intent_type, primary entity, day). This is deliberately a NEW column, NOT the
-- existing `idempotency_key`: the frozen Automation Engine (automation_execute.ts) reads
-- `idempotency_key` for its execution exactly-once guard, so reusing it would perturb
-- execution semantics. `dedup_key` is read by NOTHING in the frozen engine.
--
-- Additive + idempotent: adds one nullable column + one PARTIAL unique index scoped to
-- pending rows with a non-null key, so existing pending intents (dedup_key = NULL) are
-- unaffected and the migration applies with zero conflicts.
--
-- Rollback:
--   drop index if exists automation_intents_active_dedup_uk;
--   alter table automation_intents drop column if exists dedup_key;

alter table automation_intents add column if not exists dedup_key text;

comment on column automation_intents.dedup_key is
  'Semantic de-dup key for PENDING intents: intent_type:primary_entity:day. Separate from '
  'idempotency_key (execution exactly-once, read by the frozen engine) to avoid perturbing '
  'execution. Enforced by automation_intents_active_dedup_uk. Set by intelligence.observe '
  'at materialise time; NULL is never de-duplicated.';

-- At most ONE pending intent per (tenant, dedup_key). Partial: only pending rows with a
-- non-null key participate, so terminal/legacy rows and unkeyed rows never conflict.
create unique index if not exists automation_intents_active_dedup_uk
  on automation_intents (tenant_id, dedup_key)
  where dedup_key is not null and status = 'pending';
