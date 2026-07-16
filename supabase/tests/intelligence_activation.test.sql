-- Intelligence activation — selector + ledger idempotency + multi-tenant isolation.
-- Run: `supabase db execute < supabase/tests/intelligence_activation.test.sql`
-- Wrapped in a transaction and rolled back. Requires migrations through 20260803120000 and
-- the seeded Drummond tenant (00000000-0000-0000-0000-000000000001).

begin;

-- ── Fixtures: four interactions ───────────────────────────────────────────────
--  I1 Drummond, enriched, uningested   → selector SHOULD return it
--  I2 Drummond, enriched, ALREADY in ledger → selector must EXCLUDE it (no duplicate)
--  I3 Drummond, pending (not enriched) → selector must EXCLUDE it
--  I4 Tenant B, enriched               → selector for Drummond must EXCLUDE it (isolation)
insert into interactions
  (id, tenant_id, source_connector_id, source_type, source_table, source_id, interaction_type,
   direction, occurred_at, subject, processing_status)
values
  ('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','gmail','email','email_messages','50000000-0000-0000-0000-000000000001','email_message','inbound', now(), 'Boiler broken again','enriched'),
  ('c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','gmail','email','email_messages','50000000-0000-0000-0000-000000000002','email_message','inbound', now(), 'Already ingested','enriched'),
  ('c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','gmail','email','email_messages','50000000-0000-0000-0000-000000000003','email_message','inbound', now(), 'Not enriched yet','pending'),
  ('c0000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000bb','gmail','email','email_messages','50000000-0000-0000-0000-000000000004','email_message','inbound', now(), 'Tenant B message','enriched');

-- I2 already has a ledger row (previously ingested).
insert into intelligence_ingestions (tenant_id, interaction_id, mapper_version, ingest_key, domain, status)
values ('00000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','obs-ingest/1',
        'ingest:00000000-0000-0000-0000-000000000001:c0000000-0000-0000-0000-000000000002:obs-ingest/1','core','enqueued');

-- 1) The selector returns ONLY the uningested enriched Drummond interaction.
do $$
declare v_ids uuid[];
begin
  select array_agg(interaction_id order by interaction_id) into v_ids
    from intelligence_select_uningested('00000000-0000-0000-0000-000000000001','obs-ingest/1',25);
  if v_ids is distinct from array['c0000000-0000-0000-0000-000000000001'::uuid]
    then raise exception 'FAIL: selector returned %, expected only I1', v_ids; end if;
end $$;

-- 2) The atomic ledger claim rejects a DUPLICATE (same tenant+interaction+mapper) — no double intelligence.
do $$ begin
  insert into intelligence_ingestions (tenant_id, interaction_id, mapper_version, ingest_key, domain, status)
  values ('00000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','obs-ingest/1',
          'ingest:dup','core','enqueued');
  raise exception 'FAIL: duplicate ingestion was allowed';
exception when unique_violation then null; -- expected: unique (tenant, interaction, mapper_version)
end $$;

-- 3) A `skipped` decision (ineligible interaction) is recordable with its eligibility audit,
--    and once recorded the selector no longer returns it — decided ONCE, never re-ingested.
insert into intelligence_ingestions
  (tenant_id, interaction_id, mapper_version, ingest_key, domain, status, eligibility_reason, eligibility_confidence)
values ('00000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','obs-ingest/1',
        'ingest:00000000-0000-0000-0000-000000000001:c0000000-0000-0000-0000-000000000001:obs-ingest/1',
        'core','skipped','low_value',0.85);
do $$
declare n int;
begin
  select count(*) into n from intelligence_select_uningested('00000000-0000-0000-0000-000000000001','obs-ingest/1',25);
  if n <> 0 then raise exception 'FAIL: a decided (skipped) interaction is still selectable (%)', n; end if;
  if (select eligibility_reason from intelligence_ingestions
        where interaction_id='c0000000-0000-0000-0000-000000000001' and status='skipped') <> 'low_value'
    then raise exception 'FAIL: eligibility audit not recorded'; end if;
end $$;

-- 4) A DIFFERENT mapper version re-opens the interaction (a legitimate re-mapping, not a dup).
do $$ begin
  if (select count(*) from intelligence_select_uningested('00000000-0000-0000-0000-000000000001','obs-ingest/2',25)) < 1
    then raise exception 'FAIL: a new mapper version did not re-open uningested interactions'; end if;
end $$;

-- 5) Multi-tenant isolation — Tenant B's selector returns only Tenant B's interaction.
do $$
declare v_ids uuid[];
begin
  select array_agg(interaction_id) into v_ids
    from intelligence_select_uningested('00000000-0000-0000-0000-0000000000bb','obs-ingest/1',25);
  if v_ids is distinct from array['c0000000-0000-0000-0000-0000000000b4'::uuid]
    then raise exception 'FAIL: tenant isolation breach — B saw %', v_ids; end if;
end $$;

do $$ begin
  raise notice 'PASS: selector returns only uningested+enriched+own-tenant; duplicate ingestion rejected; skip is audited + decided-once; new mapper re-opens; tenant isolation holds';
end $$;

rollback;
