-- ServiceOS — Add confirmed "German …" ASR mishears of "Drummond Heating" (Drummond only).
--
-- gpt-4o-transcribe frequently mangles the tenant's OWN name in the answer greeting
-- ("you're through to Drummond Heating") as "German Heating / German Teaching / German
-- Tutoring / German Teating". These are unambiguous compound mishears (word-boundary,
-- case-insensitive matching in vocabulary.ts cannot corrupt legitimate speech). Bare
-- "Germans"/"Germany" are deliberately NOT added — too close to legitimate words to
-- auto-apply; they remain suggestion-only observations for operator review.
--
-- Tenant-scoped by slug (never a hardcoded uuid); additive array-union so it is idempotent
-- and never drops existing variants. Only affects the Drummond tenant.
--
-- ROLLBACK: update tenant_vocabulary set phonetic_variants =
--   array(select e from unnest(phonetic_variants) e
--         where e not in ('German Heating','German Teaching','German Tutoring','German Teating'))
--   where tenant_id = (select id from tenants where slug='drummonds')
--     and category='org' and term='Drummond Heating';

update tenant_vocabulary
set
  phonetic_variants = (
    select array(
      select distinct e
      from unnest(
        coalesce(phonetic_variants, array[]::text[])
        || array['German Heating', 'German Teaching', 'German Tutoring', 'German Teating']::text[]
      ) as e
    )
  ),
  active = true,
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'drummonds')
  and category = 'org'
  and term = 'Drummond Heating';
