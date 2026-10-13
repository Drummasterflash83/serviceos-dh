-- Reviewed scheduling decisions only. No decision, queue mutation, source read,
-- credential, schedule or permission grant to client roles is created here.
begin;
create table public.slack_campaign_dispatch_decisions (
 id uuid primary key,
 campaign_id uuid not null,
 tenant_id uuid not null,
 definition_hash text not null check(definition_hash ~ '^[a-f0-9]{32}$'),
 dispatch_priority integer not null check(dispatch_priority between 1 and 100),
 expires_at timestamptz not null,
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 evidence_reference text not null check(length(btrim(evidence_reference)) between 1 and 2000),
 recorded_by name not null default current_user,
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id),
 check(isfinite(expires_at) and expires_at>recorded_at)
);
create index slack_campaign_dispatch_latest on public.slack_campaign_dispatch_decisions(campaign_id,recorded_at desc,id desc);
alter table public.slack_campaign_dispatch_decisions enable row level security;
revoke all on public.slack_campaign_dispatch_decisions from public,anon,authenticated,service_role;
create trigger slack_campaign_dispatch_immutable before update or delete on public.slack_campaign_dispatch_decisions for each row execute function public.slack_version_immutable();
create trigger slack_campaign_dispatch_no_truncate before truncate on public.slack_campaign_dispatch_decisions for each statement execute function public.slack_version_immutable();

create function public.learn_slack_campaign_dispatch_priority(p_campaign uuid,p_tenant uuid)
returns integer language sql volatile security definer set search_path=pg_catalog as $$
 select d.dispatch_priority from public.slack_history_campaigns h
 cross join lateral(select x.* from public.slack_campaign_dispatch_decisions x
  where x.campaign_id=h.id and x.tenant_id=h.tenant_id order by x.recorded_at desc,x.id desc limit 1)d
 where h.id=p_campaign and h.tenant_id=p_tenant
  and d.definition_hash=md5(h.definition::text) and d.expires_at>clock_timestamp()
  and d.expires_at<=h.expires_at and d.recorded_at<=clock_timestamp()
  and public.learn_slack_campaign_authority(h.id)
$$;
revoke all on function public.learn_slack_campaign_dispatch_priority(uuid,uuid) from public,anon,authenticated;
grant execute on function public.learn_slack_campaign_dispatch_priority(uuid,uuid) to service_role;

create function public.learn_slack_job_dispatch_priority(p_job public.platform_jobs)
returns integer language sql volatile security definer set search_path=pg_catalog as $$
 -- Re-read the durable job and its bound account/thread; a payload cannot select
 -- another tenant's campaign or lend its claimed priority to a different thread.
 select coalesce((select public.learn_slack_campaign_dispatch_priority(h.id,j.tenant_id)
  from public.platform_jobs j
  join public.connector_accounts a on a.tenant_id=j.tenant_id and a.id::text=j.payload->>'connector_account_id'
  left join public.slack_thread_imports t on t.tenant_id=j.tenant_id and t.account_id=a.id and t.id::text=j.payload->>'thread_import_id'
  join public.slack_history_campaigns h on h.tenant_id=j.tenant_id
   and h.id::text=case when j.job_type='slack.thread_sync' then t.scope->>'campaignId' else a.settings->'slack_history'->>'campaignId' end
   and h.id::text=j.payload->>'campaign_id'
  join public.slack_history_campaign_channels m on m.campaign_id=h.id and m.tenant_id=j.tenant_id and m.account_id=a.id
  where j.id=p_job.id and j.tenant_id=p_job.tenant_id and j.job_type=p_job.job_type
   and j.job_type in ('slack.history_sync','slack.thread_sync')
   and (j.job_type='slack.history_sync' or exists(select 1 from public.slack_history_campaign_threads mt
     where mt.campaign_id=h.id and mt.tenant_id=j.tenant_id and mt.account_id=a.id and mt.current_import=t.id))
 ),p_job.priority)
$$;
revoke all on function public.learn_slack_job_dispatch_priority(public.platform_jobs) from public,anon,authenticated;
grant execute on function public.learn_slack_job_dispatch_priority(public.platform_jobs) to service_role;

do $$declare d text;needle text:='order by q.priority,q.created_at,q.id limit 100';begin
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack claim ordering differs';end if;
 execute replace(d,needle,'order by public.learn_slack_job_dispatch_priority(q),q.created_at,q.id limit 100');
end$$;
commit;
