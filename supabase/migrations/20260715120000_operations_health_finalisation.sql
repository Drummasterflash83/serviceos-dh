-- ============================================================================
-- Operations Centre health finalisation — CURRENT-only phone dead-letters
-- ============================================================================
-- Root cause: phone_pipeline_health.dead_letter_count was an ALL-TIME count
-- (`count(*) filter (where status = 'dead_letter')`). Because phone.process_pending
-- enqueues under a STABLE per-tenant job_key and the active-job unique index only
-- covers queued/retrying, a job that dead-lettered once stays as a dead_letter row
-- forever while every later tick inserts a NEW row that succeeds. The all-time
-- count therefore latched phone health to CRITICAL indefinitely — the exact
-- "historical data shown as current" class the email connector was already fixed
-- for (email-connector-status supersession), but phone never received.
--
-- Fix: a dead-letter is CURRENT only when no LATER succeeded job for the same
-- job_key has recovered it. Identical supersession rule to the email endpoint.
-- Also exposes historical_dead_letter_count for parity/diagnostics. Everything
-- else in the function is unchanged. `dead_letter_count` keeps its name, so the
-- phone-pipeline-status consumer needs no change — it now means "current".
--
-- Idempotent: CREATE OR REPLACE. Rollback = re-apply 20260711120000.
-- ============================================================================

create or replace function phone_pipeline_health(p_tenant_id uuid)
returns jsonb
language sql
stable
as $$
with state as (
  select * from phone_recording_pipeline_state where tenant_id = p_tenant_id
),
stage_counts as (
  select
    count(*)                                                      as recordings_total,
    count(*) filter (where stage = 'download')                   as need_download,
    count(*) filter (where stage = 'transcribe')                 as need_transcription,
    count(*) filter (where stage = 'analyse')                    as need_analysis,
    count(*) filter (where stage = 'complete')                   as completed,
    count(*) filter (where is_incomplete)                        as eligible_backlog,
    count(*) filter (where stage = 'download' and not has_provider_id) as missing_provider_id,
    min(sort_at) filter (where is_incomplete)                    as oldest_eligible_at,
    -- remaining stage-advances still required (download=3, transcribe=2, analyse=1)
    (3 * count(*) filter (where stage = 'download')
      + 2 * count(*) filter (where stage = 'transcribe')
      + 1 * count(*) filter (where stage = 'analyse'))           as remaining_advances
  from state
),
-- latest pipeline run per recording (authoritative per-recording attempt record)
latest_pipeline as (
  select distinct on (metadata->>'recording_id')
    (metadata->>'recording_id')                                  as recording_id,
    status                                                       as run_status,
    started_at
  from phone_sync_runs
  where tenant_id = p_tenant_id
    and sync_type = 'pipeline'
    and metadata->>'recording_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  order by metadata->>'recording_id', started_at desc
),
failure_counts as (
  select
    count(*) filter (
      where lp.run_status = 'failed' and s.is_incomplete
    )                                                            as current_unresolved_failures
  from state s
  join latest_pipeline lp on lp.recording_id = s.id::text
),
historical as (
  select
    count(*) filter (where status = 'failed')                    as historical_failures,
    count(*) filter (where status = 'failed'
      and started_at > now() - interval '24 hours')              as failures_24h
  from phone_sync_runs
  where tenant_id = p_tenant_id and sync_type = 'pipeline'
),
useful as (
  -- a real stage advance in the throughput window (last 60 minutes)
  select
    count(*) filter (where sync_type = 'recording_download')     as downloads_win,
    count(*) filter (where sync_type = 'transcription')          as transcripts_win,
    count(*) filter (where sync_type = 'ai_analysis')            as analyses_win,
    count(*)                                                     as advances_win
  from phone_sync_runs
  where tenant_id = p_tenant_id
    and status = 'success'
    and records_processed > 0
    and sync_type in ('recording_download', 'transcription', 'ai_analysis')
    and completed_at > now() - interval '60 minutes'
),
last_useful as (
  select max(completed_at) as at
  from phone_sync_runs
  where tenant_id = p_tenant_id
    and status = 'success'
    and records_processed > 0
    and sync_type in ('recording_download', 'transcription', 'ai_analysis', 'pipeline')
),
ingest as (
  -- last successful recording-metadata ingestion from the provider
  select max(completed_at) as at
  from phone_sync_runs
  where tenant_id = p_tenant_id
    and status = 'success'
    and sync_type = 'recordings'
),
jobs as (
  select
    max(pj.created_at)                                           as last_scheduler_at,
    max(pj.completed_at) filter (where pj.status = 'succeeded')  as last_worker_success_at,
    count(*) filter (where pj.status in ('queued','running','retrying')) as active_jobs,
    -- CURRENT dead-letters only: unresolved unless a LATER succeeded job for the
    -- SAME job_key has since recovered it (mirrors email-connector-status).
    count(*) filter (
      where pj.status = 'dead_letter'
        and not exists (
          select 1 from platform_jobs s
          where s.tenant_id = pj.tenant_id
            and s.job_type = pj.job_type
            and s.job_key is not distinct from pj.job_key
            and s.status = 'succeeded'
            and s.completed_at > coalesce(pj.dead_lettered_at, pj.failed_at, pj.created_at)
        )
    )                                                            as dead_letter_count,
    count(*) filter (
      where pj.status = 'dead_letter'
        and exists (
          select 1 from platform_jobs s
          where s.tenant_id = pj.tenant_id
            and s.job_type = pj.job_type
            and s.job_key is not distinct from pj.job_key
            and s.status = 'succeeded'
            and s.completed_at > coalesce(pj.dead_lettered_at, pj.failed_at, pj.created_at)
        )
    )                                                            as historical_dead_letter_count
  from platform_jobs pj
  where pj.tenant_id = p_tenant_id and pj.job_type = 'phone.process_pending'
)
select jsonb_build_object(
  'recordings_total', sc.recordings_total,
  'need_download', sc.need_download,
  'need_transcription', sc.need_transcription,
  'need_analysis', sc.need_analysis,
  'completed', sc.completed,
  'eligible_backlog', sc.eligible_backlog,
  'missing_provider_id', sc.missing_provider_id,
  'oldest_eligible_at', sc.oldest_eligible_at,
  'oldest_eligible_age_seconds',
    case when sc.oldest_eligible_at is null then null
         else greatest(0, floor(extract(epoch from (now() - sc.oldest_eligible_at))))::int end,
  'current_unresolved_failures', coalesce(fc.current_unresolved_failures, 0),
  'historical_failures', h.historical_failures,
  'failures_24h', h.failures_24h,
  'dead_letter_count', j.dead_letter_count,
  'historical_dead_letter_count', j.historical_dead_letter_count,
  'active_jobs', j.active_jobs,
  'last_scheduler_at', j.last_scheduler_at,
  'last_worker_success_at', j.last_worker_success_at,
  'last_useful_at', lu.at,
  'last_ingestion_at', ing.at,
  'throughput_downloads_per_hour', u.downloads_win,
  'throughput_transcripts_per_hour', u.transcripts_win,
  'throughput_analyses_per_hour', u.analyses_win,
  'throughput_total_per_hour', u.advances_win,
  'estimated_drain_seconds',
    case when u.advances_win > 0 and sc.remaining_advances > 0
         then round((sc.remaining_advances::numeric / u.advances_win) * 3600)::int
         else null end
)
from stage_counts sc, failure_counts fc, historical h, useful u, last_useful lu, ingest ing, jobs j;
$$;

-- CREATE OR REPLACE preserves grants; re-assert for a clean/fresh apply.
revoke all on function phone_pipeline_health(uuid) from public;
grant execute on function phone_pipeline_health(uuid) to service_role;
