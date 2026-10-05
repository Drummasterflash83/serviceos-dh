-- ServiceOS — Phone Pipeline Selection & Health (Reliability v2).
--
-- WHY: the backlog drainer selected the NEWEST 40 recordings by created_at, then
-- filtered for incomplete work in memory. Old undownloaded recordings sit OUTSIDE
-- that window and were never selected → permanent starvation, and a batch of
-- already-complete recent rows returned the misleading `skipped: 40`. Health
-- metrics (oldest waiting, throughput, "failed") were likewise computed from a
-- bounded scan or from ALL-TIME sync-run history.
--
-- This migration moves selection AND health math into the database so:
--   * old incomplete work is always chosen first (no starvation),
--   * "failed" means CURRENTLY blocked, not all-time history,
--   * scheduler / worker / useful-processing are measured separately.
--
-- Non-destructive: adds ONE view + FOUR read-only functions. No table/column
-- changes, no data mutation. Reuses the existing phone_* schema and indexes
-- (phone_transcripts_recording_id_idx, phone_ai_insights_recording_id_idx).
--
-- Security: `security_invoker` view + functions granted to service_role ONLY.
-- The browser never reads these (Edge Functions do, via the service-role key,
-- which bypasses RLS). No policy grants selection/health to authenticated.

-- ---------------------------------------------------------------------------
-- View: per-recording pipeline stage (the single source of "what's incomplete")
-- ---------------------------------------------------------------------------
-- stage: download → transcribe → analyse → complete. A recording is incomplete
-- until it has stored audio, a COMPLETED transcript, and an AI insight.
create or replace view phone_recording_pipeline_state
with (security_invoker = on) as
select
  r.id,
  r.tenant_id,
  r.provider,
  r.provider_recording_id,
  r.provider_call_id,
  r.recording_uri,
  r.storage_path,
  r.started_at,
  r.created_at,
  coalesce(r.started_at, r.created_at)               as sort_at,
  (r.provider_recording_id is not null)              as has_provider_id,
  (r.storage_path is not null)                       as has_download,
  (ct.recording_id is not null)                      as has_transcript,
  (ins.recording_id is not null)                     as has_insight,
  case
    when r.storage_path is null            then 'download'
    when ct.recording_id is null           then 'transcribe'
    when ins.recording_id is null          then 'analyse'
    else 'complete'
  end                                                as stage,
  (
    r.storage_path is null
    or ct.recording_id is null
    or ins.recording_id is null
  )                                                  as is_incomplete
from phone_recordings r
left join lateral (
  select t.recording_id
  from phone_transcripts t
  where t.recording_id = r.id
    and t.tenant_id = r.tenant_id
    and t.status = 'completed'
  limit 1
) ct on true
left join lateral (
  select i.recording_id
  from phone_ai_insights i
  where i.recording_id = r.id
    and i.tenant_id = r.tenant_id
  limit 1
) ins on true;

-- ---------------------------------------------------------------------------
-- phone_select_pending — the drainer's selection (oldest incomplete first)
-- ---------------------------------------------------------------------------
-- Returns up to p_limit incomplete recordings, OLDEST FIRST, so old work can
-- never starve. Readiness gate applies ONLY to the download stage: a brand-new
-- recording whose audio may not be on the provider yet waits
-- p_min_download_age_seconds; recordings already downloaded (needing transcribe
-- or analyse) are never delayed. Download-stage rows with no provider_recording_id
-- are excluded (they can never be fetched — surfaced as blocked in health).
create or replace function phone_select_pending(
  p_tenant_id uuid,
  p_limit int default 5,
  p_min_download_age_seconds int default 120
)
returns setof phone_recording_pipeline_state
language sql
stable
as $$
  select *
  from phone_recording_pipeline_state s
  where s.tenant_id = p_tenant_id
    and s.is_incomplete
    and (
      -- transcribe/analyse never blocked by the download-readiness delay
      s.stage <> 'download'
      or (
        s.has_provider_id
        and s.sort_at <= now() - make_interval(secs => greatest(0, p_min_download_age_seconds))
      )
    )
  order by s.sort_at asc
  limit greatest(1, least(50, p_limit));
$$;

-- ---------------------------------------------------------------------------
-- phone_pipeline_health — every metric, computed DB-side over the FULL table
-- ---------------------------------------------------------------------------
-- Returns one jsonb object. No scan window, no all-time "failed" conflation.
--   * current_unresolved_failures = incomplete recordings whose LATEST pipeline
--     run failed (a later success would resolve it → excluded).
--   * last_useful_at = latest sync-run that actually advanced a stage
--     (records_processed > 0), distinct from a healthy no-op worker run.
--   * last_worker_success_at / last_scheduler_at come from platform_jobs so
--     worker health is separate from useful throughput.
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
    max(created_at)                                              as last_scheduler_at,
    max(completed_at) filter (where status = 'succeeded')        as last_worker_success_at,
    count(*) filter (where status = 'dead_letter')               as dead_letter_count,
    count(*) filter (where status in ('queued','running','retrying')) as active_jobs
  from platform_jobs
  where tenant_id = p_tenant_id and job_type = 'phone.process_pending'
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

-- ---------------------------------------------------------------------------
-- phone_pipeline_diagnostics — per unresolved-item rows for the operator table
-- ---------------------------------------------------------------------------
-- Read-only. Codes + timestamps only — NEVER a signed URL, transcript or audio.
-- `attempts` and error detail come from the recording's pipeline sync-runs.
create or replace function phone_pipeline_diagnostics(
  p_tenant_id uuid,
  p_limit int default 100
)
returns table (
  recording_id uuid,
  provider_call_id text,
  stage text,
  started_at timestamptz,
  age_seconds int,
  attempts int,
  last_error_code text,
  last_error text,
  last_attempt_at timestamptz,
  last_run_status text
)
language sql
stable
as $$
  with runs as (
    select
      (metadata->>'recording_id') as rid,
      status, error_message, started_at,
      metadata->>'error_code' as error_code,
      metadata->>'failed_step' as failed_step
    from phone_sync_runs
    where tenant_id = p_tenant_id
      and sync_type = 'pipeline'
      and metadata->>'recording_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  agg as (
    select rid, count(*)::int as attempts from runs group by rid
  ),
  latest as (
    select distinct on (rid) rid, status, error_message, error_code, failed_step, started_at
    from runs
    order by rid, started_at desc
  )
  select
    s.id                                    as recording_id,
    s.provider_call_id,
    s.stage,
    s.started_at,
    greatest(0, floor(extract(epoch from (now() - s.sort_at))))::int as age_seconds,
    coalesce(a.attempts, 0)                 as attempts,
    l.error_code                            as last_error_code,
    left(l.error_message, 300)              as last_error,
    l.started_at                            as last_attempt_at,
    l.status                                as last_run_status
  from phone_recording_pipeline_state s
  left join agg a    on a.rid = s.id::text
  left join latest l on l.rid = s.id::text
  where s.tenant_id = p_tenant_id
    and s.is_incomplete
  order by s.sort_at asc
  limit greatest(1, least(500, p_limit));
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only (Edge Functions). Never authenticated/public.
-- ---------------------------------------------------------------------------
revoke all on function phone_select_pending(uuid, int, int) from public;
revoke all on function phone_pipeline_health(uuid) from public;
revoke all on function phone_pipeline_diagnostics(uuid, int) from public;
grant execute on function phone_select_pending(uuid, int, int) to service_role;
grant execute on function phone_pipeline_health(uuid) to service_role;
grant execute on function phone_pipeline_diagnostics(uuid, int) to service_role;
grant select on phone_recording_pipeline_state to service_role;
