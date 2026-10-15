-- Preserve the existing provider workspace pacing and reviewed campaign
-- priorities. For equally prioritised history/reply work, alternate the first
-- eligible type by UTC minute so neither ongoing channel capture nor its replies
-- can monopolise the bounded oldest-100 candidate scan. No new source scope,
-- provider request, credential, schedule, queue row or client grant.
begin;
do $$
declare
  definition text;
  previous_order text;
  replacement text;
  split_type text := $order$
    case when mod(floor(extract(epoch from statement_timestamp()) / 60)::bigint, 2) = 0
      then case when q.job_type = 'slack.history_sync' then 0 else 1 end
      else case when q.job_type = 'slack.thread_sync' then 0 else 1 end
    end$order$;
begin
  definition := pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
  if position('case when mod(floor(extract(epoch from statement_timestamp()) / 60)::bigint, 2) = 0' in definition) > 0 then
    -- Manual TEST/LIVE release may precede the migration-ledger replay. Its
    -- exact expression is already present; preserve the installed function.
    if length(definition) - length(replace(definition,
      'case when mod(floor(extract(epoch from statement_timestamp()) / 60)::bigint, 2) = 0',
      '')) <> length('case when mod(floor(extract(epoch from statement_timestamp()) / 60)::bigint, 2) = 0') then
      raise exception 'Slack claim fairness expression is not unique';
    end if;
    return;
  end if;
  if position('order by public.learn_slack_job_dispatch_priority(q),q.created_at,q.id limit 100' in definition) > 0 then
    previous_order := 'order by public.learn_slack_job_dispatch_priority(q),q.created_at,q.id limit 100';
    replacement := 'order by public.learn_slack_job_dispatch_priority(q),' || split_type || ',q.created_at,q.id limit 100';
  elsif position('order by q.priority,q.created_at,q.id limit 100' in definition) > 0 then
    previous_order := 'order by q.priority,q.created_at,q.id limit 100';
    replacement := 'order by q.priority,' || split_type || ',q.created_at,q.id limit 100';
  else
    raise exception 'Slack claim ordering differs from reviewed TEST/LIVE baseline';
  end if;
  if length(definition) - length(replace(definition, previous_order, '')) <> length(previous_order) then
    raise exception 'Slack claim ordering is not unique';
  end if;
  execute replace(definition, previous_order, replacement);
end $$;
commit;
