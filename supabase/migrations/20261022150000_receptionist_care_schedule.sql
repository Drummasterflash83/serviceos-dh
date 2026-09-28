-- Preserve the complete canonical registry. Registration does not install cron.
-- Deploy worker/functions and provision the same secret in Vault and edge secrets
-- before deliberately scheduling this row. Never call schedule_all as a side effect.
begin;
create or replace function public.serviceos_schedule_defs()
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
    ('serviceos-intelligence-ingest', 'intelligence-ingestion-scheduled-sync',   'INTELLIGENCE_INGEST_SECRET',      '*/5 * * * *'),
    ('serviceos-marketing-broadcast', 'marketing-broadcast-scheduled-sync',      'MARKETING_BROADCAST_SECRET',      '* * * * *'),
    ('serviceos-marketing-sequence',  'marketing-sequence-scheduled-sync',       'MARKETING_SEQUENCE_SECRET',       '* * * * *'),
    ('serviceos-commitments',         'commitment-scheduled-sync',               'COMMITMENT_PROJECTION_SECRET',    '*/5 * * * *'),
    ('serviceos-emma-care', 'receptionist-care-scheduled-sync', 'RECEPTIONIST_CARE_WORKER_SECRET', '* * * * *')
  ) as t(job, fn, secret, sched);
$$;
commit;
