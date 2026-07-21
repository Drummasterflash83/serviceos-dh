-- ServiceOS — Tenant vocabulary seed (Phone Intelligence V1) — Drummond Heating.
--
-- TENANT CONFIGURATION, not platform logic. Every row is scoped to a single tenant
-- (resolved by slug, never a hardcoded uuid), so it can never affect another tenant.
-- Idempotent: upsert on the (tenant_id, category, term) unique key — safe to re-run.
-- Confirmed terms ONLY; no speculative fuzzy variants (those corrupt legitimate speech).
--
-- Reuse for another tenant: copy this file, change the slug, and supply that company's
-- confirmed aliases/staff/suppliers/products/terminology. No code change required.
--
-- ROLLBACK:  delete from tenant_vocabulary
--            where tenant_id = (select id from tenants where slug = 'drummonds')
--              and metadata->>'seed' = 'phone_intelligence_v1';

with t as (select id from tenants where slug = 'drummonds')
insert into tenant_vocabulary
  (tenant_id, term, category, aliases, phonetic_variants, confidence, active, metadata)
select t.id, v.term, v.category, v.aliases, v.phonetic_variants, v.confidence, true,
       jsonb_build_object('seed', 'phone_intelligence_v1')
from t, (values
  -- Company identity (the flagship confirmed ASR mishear).
  ('Drummond Heating', 'org',
     array['Drummonds']::text[],
     array['John and Teething', 'Drummond eating']::text[], 0.92),
  -- Service software + telephony providers (confirmed proper nouns ASR mangles).
  ('Commusoft',  'service', array[]::text[], array['Comue soft', 'Commu soft']::text[], 0.85),
  ('Birchills',  'service', array[]::text[], array['Birch hills']::text[], 0.8),
  ('Simwood',    'service', array[]::text[], array['Sim wood']::text[], 0.8)
) as v(term, category, aliases, phonetic_variants, confidence)
on conflict (tenant_id, category, term) do update
  set aliases = excluded.aliases,
      phonetic_variants = excluded.phonetic_variants,
      confidence = excluded.confidence,
      active = true,
      metadata = excluded.metadata,
      updated_at = now();
