-- Per-recording recovery, not per-batch retries. No records are deleted or
-- falsely completed. Held work remains in existing backlog/failure diagnostics.
create or replace function phone_retry_state(p_stage text, p_runs jsonb, p_now timestamptz)
returns text language plpgsql immutable as $$
declare
  latest jsonb := p_runs->0;
  item jsonb;
  failures int := 0;
  delay_seconds int;
begin
  if latest is null then return 'ready'; end if;
  if latest->>'status' = 'running' then
    if (latest->>'started_at')::timestamptz > p_now - interval '5 minutes' then
      return 'in_progress';
    end if;
    return 'ready';
  end if;
  if latest->>'status' <> 'failed' or latest->>'failed_step' is distinct from p_stage then
    return 'ready';
  end if;
  if latest->>'error_code' = any(array[
    'invalid_audio','audio_too_short','audio_too_large','openai_invalid_request',
    'openai_quota_exhausted','openai_auth_failed','unsupported_format',
    'provider_recording_missing','invalid_recording','malformed_provider_id',
    'cross_tenant_mismatch','config_error','empty_audio'
  ]) then return 'needs_review'; end if;
  for item in select value from jsonb_array_elements(p_runs) loop
    exit when item->>'status' <> 'failed' or item->>'failed_step' is distinct from p_stage;
    failures := failures + 1;
    exit when failures >= 5;
  end loop;
  if failures >= 5 then return 'needs_review'; end if;
  delay_seconds := case failures when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end;
  if (latest->>'started_at')::timestamptz > p_now - make_interval(secs => delay_seconds) then
    return 'cooldown';
  end if;
  return 'ready';
end;
$$;

create index if not exists phone_sync_runs_recording_retry_idx
on phone_sync_runs (tenant_id, (metadata->>'recording_id'), started_at desc)
where sync_type = 'pipeline';

create or replace function phone_pending_readiness(p_tenant_id uuid)
returns table(recording_id uuid, stage text, sort_at timestamptz, retry_state text)
language sql stable as $$
  select s.id, s.stage, s.sort_at,
    phone_retry_state(s.stage, coalesce(r.runs,'[]'::jsonb), now())
  from phone_recording_pipeline_state s
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'status', x.status, 'started_at', x.started_at,
      'failed_step', x.metadata->>'failed_step',
      'error_code', x.metadata->>'error_code'
    ) order by x.started_at desc) runs
    from (
      select status, started_at, metadata from phone_sync_runs
      where tenant_id = s.tenant_id and sync_type = 'pipeline'
        and metadata->>'recording_id' = s.id::text
      order by started_at desc limit 5
    ) x
  ) r on true
  where s.tenant_id = p_tenant_id and s.is_incomplete;
$$;

create or replace function phone_select_pending(
  p_tenant_id uuid, p_limit int default 5, p_min_download_age_seconds int default 120
)
returns setof phone_recording_pipeline_state language sql stable as $$
  with eligible as (
    select s.*, s.sort_at >= now()-interval '24 hours' as recent
    from phone_recording_pipeline_state s
    join phone_pending_readiness(p_tenant_id) r on r.recording_id = s.id
    where s.tenant_id = p_tenant_id and r.retry_state = 'ready'
      and (s.stage <> 'download' or
        (s.has_provider_id and s.sort_at <= now()-make_interval(secs => greatest(0,p_min_download_age_seconds))))
  ), ranked as (
    select id, recent, sort_at,
      row_number() over(partition by recent order by sort_at, id) lane_position
    from eligible
  )
  select s.* from phone_recording_pipeline_state s join ranked r on r.id=s.id
  where s.tenant_id = p_tenant_id
  order by case
    when r.recent and r.lane_position <= greatest(1,least(50,p_limit)-1) then 0
    when not r.recent and r.lane_position = 1 then 1
    else 2 end, r.sort_at, r.id
  limit greatest(1,least(50,p_limit));
$$;

revoke all on function phone_retry_state(text,jsonb,timestamptz) from public;
revoke all on function phone_pending_readiness(uuid) from public;
revoke all on function phone_select_pending(uuid,int,int) from public;
grant execute on function phone_retry_state(text,jsonb,timestamptz) to service_role;
grant execute on function phone_pending_readiness(uuid) to service_role;
grant execute on function phone_select_pending(uuid,int,int) to service_role;
