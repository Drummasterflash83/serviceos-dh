-- Pure assertions: no fixtures, customer writes, provider calls or paid processing.
do $$
declare
  clock timestamptz := '2026-10-01T12:00:00Z';
  one_failure jsonb := '[{"status":"failed","failed_step":"transcribe","error_code":"openai_error","started_at":"2026-10-01T11:59:40Z"}]';
  five_failures jsonb;
begin
  if phone_retry_state('transcribe','[]',clock) <> 'ready' then raise exception 'new work blocked'; end if;
  if phone_retry_state('transcribe',one_failure,clock) <> 'cooldown' then raise exception 'backoff missing'; end if;
  if phone_retry_state('analyse',one_failure,clock) <> 'ready' then raise exception 'old stage blocks new stage'; end if;
  if phone_retry_state('transcribe',one_failure,clock+interval '2 minutes') <> 'ready' then raise exception 'retry never resumes'; end if;
  select jsonb_agg(one_failure->0) into five_failures from generate_series(1,5);
  if phone_retry_state('transcribe',five_failures,clock+interval '2 days') <> 'needs_review' then raise exception 'poison row repeats'; end if;
  if phone_retry_state('transcribe','[{"status":"failed","failed_step":"transcribe","error_code":"invalid_audio","started_at":"2026-10-01T11:00:00Z"}]',clock) <> 'needs_review' then raise exception 'invalid audio retried'; end if;
  if phone_retry_state('transcribe','[{"status":"running","started_at":"2026-10-01T11:59:00Z"}]',clock) <> 'in_progress' then raise exception 'active run duplicated'; end if;
  if phone_retry_state('transcribe','[{"status":"running","started_at":"2026-10-01T11:00:00Z"}]',clock) <> 'ready' then raise exception 'abandoned run held forever'; end if;
  if phone_retry_state('transcribe','[{"status":"success","started_at":"2026-10-01T11:59:00Z"}]'::jsonb || five_failures,clock) <> 'ready' then raise exception 'successful correction cannot reset hold'; end if;
end;
$$;
