-- The dedicated Slack worker scans only active Slack jobs. The general
-- tenant/type indexes include long-retained terminal work and can exhaust the
-- worker's statement limit before it finds one due campaign continuation.
-- This index changes no claim policy, priority, campaign approval or source.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if to_regclass('public.learn_slack_active_claim_idx') is not null
 then raise exception 'slack_active_claim_index_already_present';end if;
 if md5(pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure))
   not in ('ed0b67d6b68d134a0dde49621b30ceff',
           'fe9afac1a87f256b90d274c63805aa83')
 then raise exception 'slack_active_claim_selector_changed';end if;
end$$;
create index learn_slack_active_claim_idx on public.platform_jobs(available_at,created_at,id)
 where job_type in('slack.history_sync','slack.thread_sync')
  and status in('queued','retrying','running');
commit;
