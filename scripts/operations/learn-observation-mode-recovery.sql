-- Session-local maintenance helper, never installed as an application RPC.
-- Caller must pin the repaired worker, exact tenant/job/payload and a fresh batch.
-- It preserves the terminal parent and moves only its unobserved ingestion lineage
-- to one child with the identical payload. No source, mode or access changes.
create function pg_temp.learn_recover_mode_observation(p_tenant uuid,p_old uuid,p_new uuid,p_payload_md5 text,p_batch uuid)
returns uuid language plpgsql set search_path=pg_catalog,public as $$
declare q public.platform_jobs%rowtype; child public.platform_jobs%rowtype;
 g public.intelligence_ingestions%rowtype; i public.interactions%rowtype; d jsonb;
begin
 if p_tenant is null or p_old is null or p_new is null or p_batch is null or p_old=p_new
 or p_payload_md5 is null or p_payload_md5!~'^[a-f0-9]{32}$' then raise exception 'recovery_arguments_invalid';end if;
 select * into q from public.platform_jobs where tenant_id=p_tenant and id=p_old for update;
 if not found or q.job_type<>'intelligence.observe' or q.status<>'dead_letter'
 or q.error_code is distinct from 'learn_observation_mode_review' or q.job_key is null
 or md5(q.payload::text) is distinct from p_payload_md5
 then raise exception 'recovery_parent_changed';end if;
 d:=q.payload->'observation';
 if d->>'created_from' is distinct from 'intelligence.ingest_interaction'
 or d#>>'{attributes,ingest,mapper_version}' is distinct from 'obs-ingest/2'
 or jsonb_typeof(d->'source_interactions') is distinct from 'array'
 or jsonb_array_length(d->'source_interactions') is distinct from 1 then raise exception 'recovery_payload_invalid';end if;
 select * into g from public.intelligence_ingestions where tenant_id=p_tenant
 and interaction_id=(d->'source_interactions'->>0)::uuid and mapper_version='obs-ingest/2' for update;
 if not found then raise exception 'recovery_lineage_missing';end if;
 select * into child from public.platform_jobs where id=p_new;
 if found then
  if child.tenant_id is distinct from p_tenant or child.parent_job_id is distinct from p_old
  or child.job_type is distinct from q.job_type or child.job_key is distinct from q.job_key
  or child.payload is distinct from q.payload or child.metadata#>>'{recovery,batch_id}' is distinct from p_batch::text
  or g.observe_job_id is distinct from p_new then raise exception 'recovery_child_conflict';end if;
  return p_new;
 end if;
 if g.status<>'enqueued' or g.observe_job_id is distinct from p_old or g.observation_id is not null
 or exists(select 1 from public.learn_observation_receipts where tenant_id=p_tenant and job_id=p_old)
 then raise exception 'recovery_lineage_changed';end if;
 select * into i from public.interactions where id=g.interaction_id and tenant_id=p_tenant for share;
 if not found or i.processing_status<>'enriched' or d#>>'{attributes,ingest,source_updated_at}' is null
 or i.updated_at is distinct from (d#>>'{attributes,ingest,source_updated_at}')::timestamptz
 then raise exception 'recovery_source_changed';end if;
 if not exists(select 1 from public.tenants where id=p_tenant and status='active')
 or exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_key=q.job_key and status in('queued','retrying','running'))
 then raise exception 'recovery_inactive_or_busy';end if;
 insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,available_at,parent_job_id,payload,metadata)
 values(p_new,p_tenant,q.connector_id,q.module_id,q.job_type,q.job_key,'queued',q.priority,q.max_attempts,clock_timestamp(),p_old,q.payload,
 jsonb_build_object('recovery',jsonb_build_object('version','learn-observation-mode-recovery/1','batch_id',p_batch,'parent_job_id',p_old,'reason',q.error_code)));
 update public.intelligence_ingestions set observe_job_id=p_new where id=g.id;
 insert into public.platform_events(tenant_id,event_type,subject_type,subject_id,source,domain,actor,payload,metadata)
 values(p_tenant,'intelligence.observation.recovery_queued','platform_job',p_new,'learn-observation-mode-recovery/1',d->>'domain',
 '{"kind":"automation","ref":"learn-observation-mode-recovery/1"}',jsonb_build_object('parent_job_id',p_old,'interaction_id',i.id),jsonb_build_object('batch_id',p_batch,'reason',q.error_code));
 return p_new;
end$$;
