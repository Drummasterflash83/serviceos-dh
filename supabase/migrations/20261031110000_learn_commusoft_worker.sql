-- Dedicated durable worker. No schedule, keys, flags, approvals or queue seed.
begin;
do $$declare d text;needle text:='where c.status in (''queued'', ''retrying'')';begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'commusoft_generic_claim_changed';end if;
 execute replace(d,needle,needle||chr(10)||'      and c.job_type <> ''commusoft.source_sync''');
end $$;
-- Bind the durable job key to its approval before any credential release.
do $$declare d text;needle text:='  select * into c from public.provider_connections';begin
 d:=pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure);
 if position(needle in d)=0 then raise exception 'commusoft_acquisition_contract_changed';end if;
 execute replace(d,needle,'  if j.job_key is distinct from ''commusoft.source:''||a.id::text||'':''||(cfg->>''approvalId'') then return null;end if;'||chr(10)||needle);
end $$;

-- The job's approval identity must also survive through publication.
do $$declare d text;needle text:='  b:=permit.binding; cfg:=b->''approval''; cp:=b->''checkpoint'';';begin
 d:=pg_get_functiondef('public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb)'::regprocedure);
 if position(needle in d)=0 then raise exception 'commusoft_publication_contract_changed';end if;
 execute replace(d,needle,needle||chr(10)||'  if j.job_key is distinct from ''commusoft.source:''||(b->>''accountId'')||'':''||(cfg->>''approvalId'') then raise exception ''commusoft_queue_identity'' using errcode=''PT409'';end if;');
end $$;

create function public.learn_commusoft_claim_jobs(p_worker uuid)
returns setof public.platform_jobs language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'commusoft_queue_forbidden' using errcode='42501';end if;
 if p_worker is null or current_setting('transaction_isolation')<>'read committed' then raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
 for j in select * from public.platform_jobs q where q.job_type='commusoft.source_sync'
   and q.status in ('queued','retrying','running') and coalesce(q.available_at,'-infinity')<=clock_timestamp()
   and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp()
   order by q.priority,q.created_at,q.id for update skip locked limit 1
 loop
   if j.attempt_count is null or j.attempt_count<0 or j.max_attempts is null or j.max_attempts<1 or
     (j.attempt_count>=j.max_attempts and not exists(select 1 from public.learn_business_input_pages p where p.job_id=j.id and p.tenant_id=j.tenant_id)) then
     update public.platform_jobs set status='dead_letter',dead_lettered_at=clock_timestamp(),failed_at=clock_timestamp(),
       lease_expires_at=null,error_code='commusoft_attempts_exhausted' where id=j.id;
   else
     update public.platform_jobs set status='running',claimed_by='learn-commusoft:'||p_worker::text,
       claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '180 seconds',
       attempt_count=j.attempt_count+1,last_attempt_at=clock_timestamp(),started_at=coalesce(started_at,clock_timestamp())
       where id=j.id returning * into j;
     return next j;
   end if;
 end loop;
end $$;

create function public.learn_commusoft_finish_job(
 p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_outcome jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;p public.learn_business_input_pages%rowtype;
 permit public.learn_business_input_request_permits%rowtype;a public.connector_accounts%rowtype;
 b jsonb;cfg jsonb;finish jsonb;receipt jsonb;answer jsonb;successor uuid;
 next_status text;stop_reason text;delay_seconds integer;failure_code text;allowed boolean;next_at timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'commusoft_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_claimed_by is null or p_attempt_count is null or p_attempt_count<1
   or jsonb_typeof(p_outcome) is distinct from 'object' or jsonb_typeof(p_outcome->'success') is distinct from 'boolean' then
   raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.job_type is distinct from 'commusoft.source_sync' or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count then
   raise exception 'commusoft_queue_not_owned' using errcode='PT409';end if;
 finish:=j.metadata->'commusoft_finish_v1';
 if j.status in ('succeeded','retrying','dead_letter') and finish->>'claimed_by'=p_claimed_by and (finish->>'attempt_count')::integer=p_attempt_count then
   if finish->'outcome'=p_outcome then return finish->'answer';end if;
   raise exception 'commusoft_queue_replay_conflict' using errcode='PT409';
 end if;
 if j.status is distinct from 'running' or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp() then
   raise exception 'commusoft_queue_not_owned' using errcode='PT409';end if;
 select * into p from public.learn_business_input_pages where job_id=j.id and tenant_id=p_tenant_id;
 if found then
   -- Never overwrite a committed page as failed, including a lost publication reply.
   if p_outcome<>'{"success":true}'::jsonb then raise exception 'commusoft_queue_page_committed' using errcode='PT409';end if;
   receipt:=jsonb_build_object('pageId',p.id,'checkpoint',p.checkpoint_after,'records',p.record_count,'already',false);
   if j.metadata->'commusoft_page_v1' is distinct from receipt then raise exception 'commusoft_queue_receipt_mismatch' using errcode='PT409';end if;
   select * into permit from public.learn_business_input_request_permits where id=p.permit_id;
   if not found then raise exception 'commusoft_queue_receipt_mismatch' using errcode='PT409';end if;
   b:=permit.binding;cfg:=b->'approval';
   if j.job_key is distinct from 'commusoft.source:'||(b->>'accountId')||':'||(cfg->>'approvalId') then
     raise exception 'commusoft_queue_identity' using errcode='PT409';end if;
   stop_reason:=case when p.checkpoint_after->'complete'='true'::jsonb then 'collection_exhausted'
     when (p.checkpoint_after->>'pages')::integer>=(cfg->>'maxPages')::integer then 'page_budget_exhausted' else 'next_page' end;
   if stop_reason='next_page' then
     -- Current switches/approval decide only whether to continue. Prior committed
     -- work is still acknowledged if an operator has since disabled processing.
     perform 1 from public.tenants where id=p_tenant_id and status='active' for share;
     allowed:=found;
     perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag='learn.enabled' and value='true'::jsonb for share;
     allowed:=allowed and found;
     perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
     allowed:=allowed and found;
     select * into a from public.connector_accounts where id::text=b->>'accountId' and tenant_id=p_tenant_id for share;
     allowed:=allowed and found and a.status='active' and a.settings->'commusoft_import'=cfg and a.sync_cursor=p.checkpoint_after
       and coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')>clock_timestamp();
     perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='commusoft'
       and provider='commusoft' and enabled and status='active' for share;
     allowed:=allowed and found;
     perform 1 from public.provider_connections where id::text=b->>'connectionId' and tenant_id=p_tenant_id
       and provider='commusoft' and status='configured' and auth_mode='private_api_key' and revoked_at is null and verified_at is not null
       and verified_at<=clock_timestamp() and updated_at=(b->>'connectionRevision')::timestamptz
       and non_secret_config->>'account_key'=a.account_key and non_secret_config->>'region'=b->'request'->>'region'
       and secret_refs->>'api_key'=b->>'secretId' and 'api_key'=any(configured_fields) for share;
     allowed:=allowed and found;
     if allowed is distinct from true then stop_reason:='authorisation_changed';end if;
   end if;
   update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),lease_expires_at=null,error_code=null,
     records_processed=p.record_count,result=jsonb_build_object('receipt',receipt,'stop_reason',stop_reason,
       'coverage','one_collection_traversal','ingestion_complete',false) where id=j.id;
   if stop_reason='next_page' then
     select next_allowed_at into next_at from public.learn_business_input_request_gates
       where credential_fingerprint=permit.credential_fingerprint for share;
     if not found then raise exception 'commusoft_queue_gate_missing' using errcode='PT409';end if;
     insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,available_at,parent_job_id,payload)
       values(p_tenant_id,j.connector_id,j.module_id,j.job_type,j.job_key,'queued',j.priority,j.max_attempts,
         greatest(clock_timestamp()+interval '1250 milliseconds',next_at),j.id,jsonb_build_object('connector_account_id',a.id)) returning id into successor;
   end if;
   next_status:='succeeded';
 else
   if coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1' then raise exception 'commusoft_queue_receipt_mismatch' using errcode='PT409';end if;
   if p_outcome->'success'='true'::jsonb then raise exception 'commusoft_queue_page_missing' using errcode='PT409';end if;
   if not p_outcome ?& array['success','code','retryable','retry_after_seconds'] or (select count(*) from jsonb_object_keys(p_outcome))<>4
     or jsonb_typeof(p_outcome->'retryable') is distinct from 'boolean' or jsonb_typeof(p_outcome->'code') is distinct from 'string'
     or p_outcome->>'code' !~ '^commusoft_[a-z_]{1,80}$' or jsonb_typeof(p_outcome->'retry_after_seconds') is distinct from 'number'
     or p_outcome->>'retry_after_seconds' !~ '^[0-9]{1,8}$' then raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
   delay_seconds:=(p_outcome->>'retry_after_seconds')::integer;
   if delay_seconds>31536000 then raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
   delay_seconds:=greatest(delay_seconds,case j.attempt_count when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end);
   next_status:=case when p_outcome->'retryable'='true'::jsonb and j.attempt_count<j.max_attempts then 'retrying' else 'dead_letter' end;
   failure_code:=p_outcome->>'code';
   update public.platform_jobs set status=next_status,lease_expires_at=null,error_code=failure_code,error_count=coalesce(error_count,0)+1,
     failed_at=clock_timestamp(),available_at=case when next_status='retrying' then clock_timestamp()+make_interval(secs=>delay_seconds) else available_at end,
     dead_lettered_at=case when next_status='dead_letter' then clock_timestamp() else dead_lettered_at end where id=j.id;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'commusoft_queue_not_owned' using errcode='PT409';end if;
 answer:=jsonb_build_object('job_id',j.id,'status',next_status,'successor_id',successor);
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('commusoft_finish_v1',
   jsonb_build_object('claimed_by',p_claimed_by,'attempt_count',p_attempt_count,'outcome',p_outcome,'answer',answer)) where id=j.id;
 return answer;
end $$;
revoke all on function public.learn_commusoft_claim_jobs(uuid),public.learn_commusoft_finish_job(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.learn_commusoft_claim_jobs(uuid),public.learn_commusoft_finish_job(uuid,uuid,text,integer,jsonb) to service_role;
commit;
