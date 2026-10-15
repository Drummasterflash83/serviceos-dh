-- Bound operator health reads to the latest matching job. Existing broad
-- tenant/type indexes cannot satisfy the NULLS LAST + id ordering, and the
-- Slack account lookup also needs the account key before the timestamp.
-- No source, job, grant, capture setting or schedule is changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
do $$begin
 if to_regclass('public.learn_scheduler_latest_jobs_idx') is not null
  or to_regclass('public.learn_slack_health_account_latest_idx') is not null
  or md5(pg_get_functiondef('public.learn_scheduler_health_read(uuid)'::regprocedure))
    is distinct from '18fb4f9556f5d5d52fd0e5a97ab40b40'
  or md5(pg_get_functiondef('public.learn_operator_capture_health(uuid,text)'::regprocedure))
    is distinct from '7c52320c0d9f19a36af3909f51de0ff8' then
  raise exception 'operator_health_index_prerequisites_changed';
 end if;
end$$;
create index learn_scheduler_latest_jobs_idx on public.platform_jobs
 (tenant_id,job_type,created_at desc nulls last,id desc);
create index learn_slack_health_account_latest_idx on public.platform_jobs
 (tenant_id,(payload->>'connector_account_id'),created_at desc nulls last,id desc)
 where job_type='slack.history_sync';
commit;
