-- One bounded provider job at a time per Slack workspace across channels,
-- threads, connections and ServiceOS companies. Conservative across Slack apps
-- until an authenticated app identity and its rate tier are verified.
-- No schedule, provider request, source rewrite or credential change.
begin;
create table public.slack_workspace_pacing (
 team_id text primary key check(team_id ~ '^T[A-Z0-9]+$'),
 next_allowed_at timestamptz not null,
 blocked_until timestamptz not null default '-infinity',
 active_job_id uuid references public.platform_jobs(id) on delete restrict,
 last_started_at timestamptz not null,
 last_finished_at timestamptz
);
alter table public.slack_workspace_pacing enable row level security;
revoke all on public.slack_workspace_pacing from public,anon,authenticated,service_role;
grant select,insert,update on public.slack_workspace_pacing to service_role;

create or replace function public.learn_slack_claim_jobs(p_worker uuid,p_batch integer default 1)
returns setof public.platform_jobs language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;team text;pace public.slack_workspace_pacing%rowtype;
 claimed integer:=0;expires timestamptz;candidate uuid;begin
 if current_user<>'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_queue_snapshot' using errcode='22023';end if;
 if p_worker is null or p_batch is null or p_batch not between 1 and 5 then raise exception 'slack_queue_invalid' using errcode='22023';end if;
 -- Bounded scan; paced entries move out of the ready queue without consuming an
 -- attempt or becoming an error. Other workspaces can proceed in the same scan.
 for candidate in select q.id from public.platform_jobs q where q.job_type in ('slack.history_sync','slack.thread_sync')
  and q.status in ('queued','retrying','running') and coalesce(q.available_at,'-infinity')<=clock_timestamp()
  and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp()
  order by q.priority,q.created_at,q.id limit 100
 loop
  exit when claimed>=p_batch;
  -- Lock only the row being considered: a prefetched FOR UPDATE cursor would
  -- otherwise lock other workspaces before this worker has chosen its one job.
  select * into j from public.platform_jobs q where q.id=candidate
   and q.job_type in ('slack.history_sync','slack.thread_sync') and q.status in ('queued','retrying','running')
   and coalesce(q.available_at,'-infinity')<=clock_timestamp() and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp()
   for update skip locked;
  if not found then continue;end if;
  if j.attempt_count is null or j.max_attempts is null or j.max_attempts<1 or (j.attempt_count>=j.max_attempts and not(coalesce(j.metadata,'{}') ? 'slack_page_v1')) then
   update public.platform_jobs set status='dead_letter',dead_lettered_at=clock_timestamp(),failed_at=clock_timestamp(),
    lease_expires_at=null,error_code='slack_history_attempts_exhausted' where id=j.id;
   continue;
  end if;
  team:=null;
  -- A committed page needs only settlement. It never requests another provider
  -- page, so crash recovery is allowed even while that workspace is cooling down.
  if not(coalesce(j.metadata,'{}') ? 'slack_page_v1') then
   if j.job_type='slack.history_sync' then
    select a.settings->'slack_history'->>'teamId' into team from public.connector_accounts a
     join public.tenant_connectors c on c.id=a.tenant_connector_id and c.tenant_id=a.tenant_id and c.connector_id='slack'
     where a.id::text=j.payload->>'connector_account_id' and a.tenant_id=j.tenant_id;
   else
    select t.scope->>'teamId' into team from public.slack_thread_imports t
     join public.connector_accounts a on a.id=t.account_id and a.tenant_id=t.tenant_id
     join public.tenant_connectors c on c.id=a.tenant_connector_id and c.tenant_id=a.tenant_id and c.connector_id='slack'
     where t.id::text=j.payload->>'thread_import_id' and t.tenant_id=j.tenant_id and a.id::text=j.payload->>'connector_account_id';
   end if;
   if team is null or team !~ '^T[A-Z0-9]+$' then
    update public.platform_jobs set status='dead_letter',dead_lettered_at=clock_timestamp(),failed_at=clock_timestamp(),
     lease_expires_at=null,error_code='slack_history_binding_unavailable' where id=j.id;
    continue;
   end if;
   -- Never wait while holding other queue/gate rows. This also serializes the
   -- first insert when two workers see a previously unseen workspace.
   if not pg_try_advisory_xact_lock(hashtextextended('learn-slack-workspace:'||team,0)) then continue;end if;
   select * into pace from public.slack_workspace_pacing where team_id=team for update;
   if found and greatest(pace.next_allowed_at,pace.blocked_until)>clock_timestamp() then
    update public.platform_jobs set available_at=greatest(pace.blocked_until,least(pace.next_allowed_at,clock_timestamp()+interval '60 seconds')) where id=j.id;
    continue;
   end if;
  end if;
  expires:=clock_timestamp()+interval '180 seconds';
  if team is not null then
   insert into public.slack_workspace_pacing(team_id,next_allowed_at,active_job_id,last_started_at)
    values(team,expires+interval '60 seconds',j.id,clock_timestamp())
    on conflict(team_id) do update set next_allowed_at=excluded.next_allowed_at,active_job_id=excluded.active_job_id,last_started_at=excluded.last_started_at;
  end if;
  update public.platform_jobs set status='running',claimed_by='learn-slack:'||p_worker::text,
   claimed_at=clock_timestamp(),lease_expires_at=expires,attempt_count=j.attempt_count+1,last_attempt_at=clock_timestamp(),
   started_at=coalesce(started_at,clock_timestamp()),
   metadata=case when team is null then metadata else coalesce(metadata,'{}')||jsonb_build_object('slack_workspace_v1',jsonb_build_object('teamId',team)) end
   where id=j.id returning * into j;
  claimed:=claimed+1;
  return next j;
 end loop;
end $$;

-- Keep all completion/publication/replay/lease contracts. Only an acknowledged
-- terminal/retry settlement releases its workspace reservation. A lost completion
-- response replays the retained receipt without extending the cooldown again.
do $$declare name text;definition text;needle text:=' return answer;';addition text;begin
 addition:=$patch$
 -- Shared workspace pacing is infrastructure-only. Ownership and unexpired
 -- lease were verified above. No caller-supplied team or budget participates.
 if j.metadata->'slack_workspace_v1'->>'teamId' is not null then
  perform pg_advisory_xact_lock(hashtextextended('learn-slack-workspace:'||(j.metadata->'slack_workspace_v1'->>'teamId'),0));
  update public.slack_workspace_pacing set
   blocked_until=case when p_outcome->>'code'='slack_history_rate_limited' then greatest(blocked_until,clock_timestamp()+make_interval(secs=>greatest(60,(p_outcome->>'retry_after_seconds')::integer))) else blocked_until end,
   next_allowed_at=greatest(clock_timestamp()+interval '60 seconds',blocked_until,
    case when p_outcome->>'code'='slack_history_rate_limited' then clock_timestamp()+make_interval(secs=>greatest(60,(p_outcome->>'retry_after_seconds')::integer)) else '-infinity'::timestamptz end),
   active_job_id=null,last_finished_at=clock_timestamp()
   where team_id=j.metadata->'slack_workspace_v1'->>'teamId' and active_job_id=j.id;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 return answer;$patch$;
 foreach name in array array['learn_slack_finish_job','learn_slack_finish_thread_job'] loop
  definition:=pg_get_functiondef(('public.'||name||'(uuid,uuid,text,integer,jsonb)')::regprocedure);
  if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Reviewed Slack completion differs';end if;
  execute replace(definition,needle,addition);
 end loop;
end $$;
commit;
