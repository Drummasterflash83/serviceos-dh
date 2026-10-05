-- Phase 6 — Activate the intelligence loop (interaction → intelligence).
--
-- The bridge (intelligence.ingest_interaction) + ledger + observe engine already exist and
-- are idempotent/tenant-safe. What was missing: (1) an eligibility audit trail, (2) a
-- selector for enriched-but-uningested interactions, and (3) a scheduled enqueuer. This
-- migration adds (1)+(2) and registers (3) in the cron config. It changes no engine, guard,
-- worker or execution model. Additive + idempotent.

-- 1) Eligibility provenance on the ledger — records WHY an interaction did / did not become
--    intelligence (the pure decision lives in _shared/intelligence/eligibility.ts). The
--    ledger's existing (tenant, interaction, mapper_version) unique key makes both the
--    'enqueued' and 'skipped' decisions exactly-once + auditable.
alter table intelligence_ingestions add column if not exists eligibility_reason text;
alter table intelligence_ingestions add column if not exists eligibility_confidence numeric;

-- 2) Selector — enriched interactions with NO ledger row for this mapper version, oldest
--    first. Starvation-free + bounded; the scheduled scan enqueues one
--    intelligence.ingest_interaction job per returned id. Read-only.
create or replace function intelligence_select_uningested(
  p_tenant uuid,
  p_mapper_version text,
  p_limit int default 25
) returns table (interaction_id uuid) language sql stable as $$
  select i.id
  from interactions i
  where i.tenant_id = p_tenant
    and i.processing_status = 'enriched'
    and not exists (
      select 1 from intelligence_ingestions g
      where g.tenant_id = p_tenant
        and g.interaction_id = i.id
        and g.mapper_version = p_mapper_version
    )
  order by i.occurred_at asc nulls first, i.created_at asc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
$$;
revoke all on function intelligence_select_uningested(uuid, text, int)
  from public, anon, authenticated;
grant execute on function intelligence_select_uningested(uuid, text, int) to service_role;

-- 3) Register the scheduled scan in the cron config-as-code (guarded: nothing runs until an
--    operator enables pg_cron/pg_net and re-runs serviceos_schedule_all()). Adds the
--    intelligence-ingestion scan to the existing registry — every other stage is here too.
create or replace function serviceos_schedule_defs()
returns table (job text, fn text, secret text, sched text)
language sql immutable as $$
  select * from (values
    ('serviceos-worker',              'platform-worker',                         'WORKER_SECRET',                   '* * * * *'),
    ('serviceos-phone-sync',          'phone-scheduled-sync',                    'PHONE_SCHEDULE_SECRET',           '*/5 * * * *'),
    ('serviceos-phone-processing',    'phone-processing-scheduled-sync',         'PHONE_PROCESSING_SECRET',         '*/2 * * * *'),
    ('serviceos-email-sync',          'email-scheduled-sync',                    'EMAIL_SCHEDULE_SECRET',           '*/5 * * * *'),
    ('serviceos-email-workspace',     'email-workspace-scheduled-sync',          'EMAIL_WORKSPACE_SCHEDULE_SECRET', '*/5 * * * *'),
    ('serviceos-email-wksp-backfill', 'email-workspace-backfill-scheduled-sync', 'EMAIL_WORKSPACE_BACKFILL_SECRET', '*/15 * * * *'),
    ('serviceos-interactions',        'interactions-scheduled-sync',             'SIGNAL_SYNC_SECRET',              '*/5 * * * *'),
    ('serviceos-identity',            'identity-scheduled-sync',                 'IDENTITY_SYNC_SECRET',            '*/5 * * * *'),
    ('serviceos-business-graph',      'business-graph-scheduled-sync',           'GRAPH_SYNC_SECRET',               '*/5 * * * *'),
    ('serviceos-customer-cards',      'customer-card-scheduled-sync',            'CARD_SYNC_SECRET',                '*/5 * * * *'),
    ('serviceos-recommendations',     'recommendation-scheduled-sync',           'RECOMMENDATION_SYNC_SECRET',      '*/5 * * * *'),
    ('serviceos-intelligence-ingest', 'intelligence-ingestion-scheduled-sync',   'INTELLIGENCE_INGEST_SECRET',      '*/5 * * * *')
  ) as t(job, fn, secret, sched);
$$;
