-- One bounded source page per owned Microsoft queue job. No scheduling/activation.
begin;
create unique index learn_microsoft_source_page_job_unique on public.learn_microsoft_source_pages(job_id);
create function public.learn_microsoft_journal_job(p_tenant uuid,p_job uuid,p_worker text,p_claim integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;r public.learn_microsoft_source_pages%rowtype;s public.learn_microsoft_capture_streams%rowtype;receipt jsonb:=null;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_worker or nullif(p_worker,'') is null or p_claim is null or p_claim<1 or j.attempt_count is distinct from p_claim
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 if j.connector_id is distinct from 'microsoft-365' or j.module_id is distinct from 'communications.email'
  or j.job_type not in ('email.microsoft_discovery','email.microsoft_sync') or jsonb_typeof(j.payload) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(j.payload))<>5
  or not(j.payload ?& array['email_account_id','mailbox_id','binding_id','kind','folder_id'])
 then raise exception 'learn_microsoft_job_identity_invalid' using errcode='PT409';end if;
 -- Keep the queue payload identical to the journal binding contract.
 if j.payload is distinct from jsonb_build_object('email_account_id',(j.payload->>'email_account_id')::uuid,
  'mailbox_id',(j.payload->>'mailbox_id')::uuid,'binding_id',(j.payload->>'binding_id')::uuid,
  'kind',case when j.job_type='email.microsoft_discovery' then 'folders' else 'messages' end,'folder_id',j.payload->>'folder_id')
  or not coalesce(case when j.job_type='email.microsoft_discovery' then j.payload->>'folder_id'='' else length(j.payload->>'folder_id') between 1 and 2048 and j.payload->>'folder_id'~'^[A-Za-z0-9+/_=-]+$' end,false)
 then raise exception 'learn_microsoft_job_identity_invalid' using errcode='PT409';end if;
 select * into r from public.learn_microsoft_source_pages where tenant_id=p_tenant and job_id=p_job;
 if found then
  select * into strict s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and id=r.stream_id;
  if j.payload is distinct from jsonb_build_object('email_account_id',s.email_account_id,'mailbox_id',s.mailbox_id,'binding_id',s.binding_id,'kind',s.kind,'folder_id',s.folder_id)
  then raise exception 'learn_microsoft_job_identity_invalid' using errcode='PT409';end if;
  receipt:=jsonb_build_object('contract','microsoft-journal-receipt/1','tenantId',p_tenant,'streamId',r.stream_id,'requestId',r.id,
   'revision',r.revision::text,'recordedAt',r.recorded_at,'checkpoint',r.after_checkpoint,
   'observationsStored',jsonb_array_length(case when s.kind='folders' then r.source_page->'folders' else r.source_page->'events' end));
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 return jsonb_build_object('contract','microsoft-journal-job/1','tenantId',p_tenant,'jobId',p_job,'jobType',j.job_type,'payload',j.payload,'receipt',receipt);
end $$;
revoke all on function public.learn_microsoft_journal_job(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_microsoft_journal_job(uuid,uuid,text,integer) to service_role;
commit;
