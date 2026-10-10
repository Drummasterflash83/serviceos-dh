-- Permit settlement of durable email work while fresh capture is paused. The
-- engine must still check capture admission before resolving provider credentials.
begin;
create function public.learn_capture_job_allowed(p_tenant uuid,p_type text,p_metadata jsonb,p_job uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select public.learn_capture_job_allowed(p_tenant,p_type,p_metadata)
 or (p_type in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill') and exists(
  select 1 from public.learn_email_job_attempts b
  join public.platform_jobs j on j.id=b.job_id and j.tenant_id=b.tenant_id
  join public.email_sync_runs r on r.id=b.attempt_id and r.tenant_id=b.tenant_id
  where b.job_id=p_job and b.tenant_id=p_tenant and j.job_type=p_type
   and b.definition=jsonb_build_object('job_type',j.job_type,'job_key',j.job_key,'payload',j.payload,'connector_id',j.connector_id,'module_id',j.module_id)
   and r.provider='gmail' and r.sync_type=b.sync_type
   and r.metadata->>'email_account_id'=b.email_account_id::text
   and ((r.status in ('success','failed') and r.completed_at is not null)
    or (r.status='running' and exists(
     select 1 from public.learn_email_transition_requests pending
     where pending.tenant_id=b.tenant_id and pending.email_account_id=b.email_account_id
      and pending.attempt_id=b.attempt_id and pending.stream=b.stream
      and not exists(select 1 from public.learn_email_transition_settlements settled where settled.request_id=pending.id)
    )))
 ));
$$;
revoke all on function public.learn_capture_job_allowed(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_capture_job_allowed(uuid,text,jsonb,uuid) to service_role;

-- Keep priority, due/lease checks, locking and dedicated-worker exclusions intact.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 needle:='public.learn_capture_job_allowed(c.tenant_id,c.job_type,c.metadata)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_recovery_queue_shape_changed';end if;
 execute replace(d,needle,'public.learn_capture_job_allowed(c.tenant_id,c.job_type,c.metadata,c.id)');
end $$;
commit;
