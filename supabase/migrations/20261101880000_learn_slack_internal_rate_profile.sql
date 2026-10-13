-- Explicit reviewed internal-app throughput. No profile, capture, job or schedule
-- is activated here. Unknown/expired/rotated connections retain 15 / 60 seconds.
begin;
create table public.slack_internal_rate_profiles (
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid primary key references public.provider_connections(id),
 team_id text not null check(team_id ~ '^T[A-Z0-9]+$'),
 app_id text not null check(app_id ~ '^A[A-Z0-9]+$'),
 connection_revision timestamptz not null,
 credential_ref uuid not null,
 evidence_reference text not null check(length(btrim(evidence_reference)) between 1 and 2000),
 verified_at timestamptz not null,
 expires_at timestamptz not null check(expires_at>verified_at and expires_at<=verified_at+interval '30 days')
);
alter table public.slack_internal_rate_profiles enable row level security;
revoke all on public.slack_internal_rate_profiles from public,anon,authenticated,service_role;

create function public.learn_slack_page_limit(p_tenant uuid,p_connection uuid,p_team text)
returns integer language sql stable security definer set search_path=pg_catalog as $$
 select case when exists(
  select 1 from public.slack_internal_rate_profiles p join public.provider_connections c
   on c.id=p.connection_id and c.tenant_id=p.tenant_id
  where p.tenant_id=p_tenant and p.connection_id=p_connection and p.team_id=p_team
   and p.verified_at<=statement_timestamp() and p.expires_at>statement_timestamp()
   and c.provider='slack' and c.status='configured' and c.revoked_at is null
   and c.updated_at=p.connection_revision and c.non_secret_config->>'team_id'=p.team_id
   and c.secret_refs->>(case when c.non_secret_config->>'credential_kind'='user' then 'user_token' else 'bot_token' end)=p.credential_ref::text
 ) then 100 else 15 end
$$;
revoke all on function public.learn_slack_page_limit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.learn_slack_page_limit(uuid,uuid,text) to service_role;

create function public.learn_slack_job_cooldown(p_job public.platform_jobs)
returns integer language sql stable security definer set search_path=pg_catalog as $$
 select case when coalesce((select public.learn_slack_page_limit(p_job.tenant_id,(scope->>'connectionId')::uuid,scope->>'teamId') from (
  select case when p_job.job_type='slack.thread_sync' then t.scope else a.settings->'slack_history' end as scope
  from public.connector_accounts a left join public.slack_thread_imports t on t.tenant_id=a.tenant_id and t.account_id=a.id and t.id::text=p_job.payload->>'thread_import_id'
  where a.tenant_id=p_job.tenant_id and a.id::text=p_job.payload->>'connector_account_id'
 ) bound),15)=100 then 30 else 60 end
$$;
revoke all on function public.learn_slack_job_cooldown(public.platform_jobs) from public,anon,authenticated;
grant execute on function public.learn_slack_job_cooldown(public.platform_jobs) to service_role;

-- Exact single replacements fail closed against unexpected installed versions.
do $$declare d text;needle text;name text;begin
 d:=pg_get_functiondef('public.learn_slack_store_records(uuid,jsonb,jsonb,text)'::regprocedure);
 needle:='jsonb_array_length(p_records)>15';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Slack source writer differs';end if;
 execute replace(d,needle,'jsonb_array_length(p_records)>public.learn_slack_page_limit(p_tenant_id,(cfg->>''connectionId'')::uuid,cfg->>''teamId'')');
 foreach name in array array['learn_slack_finish_job','learn_slack_finish_thread_job'] loop
  d:=pg_get_functiondef(('public.'||name||'(uuid,uuid,text,integer,jsonb)')::regprocedure);
  needle:='next_allowed_at=greatest(clock_timestamp()+interval ''60 seconds'',blocked_until,';
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Slack settlement pacing differs';end if;
  d:=replace(d,needle,'next_allowed_at=greatest(clock_timestamp()+make_interval(secs=>public.learn_slack_job_cooldown(j)),blocked_until,');
  needle:='greatest(clock_timestamp(),(page->>''committed_at'')::timestamptz)+interval ''60 seconds''';
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Slack continuation pacing differs';end if;
  execute replace(d,needle,'greatest(clock_timestamp(),(page->>''committed_at'')::timestamptz)+make_interval(secs=>public.learn_slack_job_cooldown(j))');
 end loop;
end $$;
commit;
