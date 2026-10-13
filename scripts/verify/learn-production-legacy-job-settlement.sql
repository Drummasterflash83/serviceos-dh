-- One reviewed historical recovery; no provider work, retries, source/cursor writes,
-- schema changes or permissions. Caller owns BEGIN/COMMIT (rehearsals ROLLBACK).
-- Exact complete-row fingerprints are loaded privately through a transaction-local GUC.
do $recovery$
declare m jsonb; e jsonb; j public.platform_jobs%rowtype; n integer:=0; observed timestamptz;
begin
 if current_user<>'postgres' or current_setting('serviceos.legacy_job_target',true) is distinct from 'tgbnakbxwcqjeimygroz' then
  raise exception 'legacy_recovery_target_required';end if;
 m:=current_setting('serviceos.legacy_job_manifest',true)::jsonb;
 if m is null or m->>'projectRef' is distinct from 'tgbnakbxwcqjeimygroz' or jsonb_typeof(m->'rows') is distinct from 'array'
 or jsonb_array_length(m->'rows')<>14 then raise exception 'legacy_recovery_exact_scope_required';end if;
 observed:=(m->>'observedAt')::timestamptz;
 if observed is null or observed>clock_timestamp() or observed<clock_timestamp()-interval '30 minutes' then
  raise exception 'legacy_recovery_observation_expired';end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(m->'rows')x)<>14 then
  raise exception 'legacy_recovery_duplicate_target';end if;
 -- Lock only the reviewed rows in stable order. An independent change rejects the
 -- entire transaction, including prior audit inserts; there is no partial success.
 for e in select value from jsonb_array_elements(m->'rows') order by value->>'id' loop
  select * into j from public.platform_jobs where id=(e->>'id')::uuid for update;
  if not found or md5(to_jsonb(j)::text) is distinct from e->>'rowHash'
   or j.tenant_id::text is distinct from e->>'tenantId'
   or j.status<>'running' or j.claimed_by is not null or j.claimed_at is not null
   or j.lease_expires_at is not null or j.attempt_count<>0 or j.completed_at is not null
   or j.failed_at is not null or j.cancelled_at is not null
   or j.started_at is null or j.started_at>=observed-interval '24 hours'
   or j.updated_at>=observed-interval '24 hours'
   or ((j.job_type='phone.scheduled_sync' and j.connector_id='simwood')
       or(j.job_type='graph.sync' and j.connector_id='openfolk-core')) is distinct from true then
    raise exception 'legacy_recovery_row_changed';end if;
  if exists(select 1 from public.audit_logs a where a.action='learn.legacy_job.interrupted' and a.resource_id=j.id::text) then
    raise exception 'legacy_recovery_already_recorded';end if;
  insert into public.audit_logs(tenant_id,actor,action,resource_type,resource_id,status,detail)
  values(j.tenant_id,'openfolk:learn-v1-release-recovery','learn.legacy_job.interrupted','platform_jobs',j.id::text,'interrupted',
   jsonb_build_object('version',1,'before',to_jsonb(j),'beforeHash',e->>'rowHash',
    'reason','Historical unleased tracking record; execution ended without confirmed settlement. Capture completeness is unproven.',
    'observationAt',observed,'recoveredAt',clock_timestamp(),'automaticRetry',false,'sourceRowsChanged',false));
  update public.platform_jobs set status='failed',failed_at=clock_timestamp(),
   last_error='legacy_execution_interrupted_capture_unverified' where id=j.id;
  n:=n+1;
 end loop;
 if n<>14 or (select count(*) from public.platform_jobs where id in(select(x->>'id')::uuid from jsonb_array_elements(m->'rows')x)
   and status='failed' and last_error='legacy_execution_interrupted_capture_unverified')<>14 then
  raise exception 'legacy_recovery_settlement_incomplete';end if;
end;
$recovery$;
