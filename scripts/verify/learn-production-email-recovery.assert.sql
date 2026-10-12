-- Actual queue, lease, durable transition and paused settlement; synthetic only.
insert into tenants(id,slug,display_name) values('ec410000-cccc-4000-8000-000000000001','email-recovery-offline','Synthetic email recovery');
insert into email_accounts(id,tenant_id,provider,email_address,status) values('ec410000-cccc-4000-8000-000000000002','ec410000-cccc-4000-8000-000000000001','gmail','recovery@example.invalid','active_dwd');
set local role service_role;
do $$declare t uuid:='ec410000-cccc-4000-8000-000000000001';a uuid:='ec410000-cccc-4000-8000-000000000002';
 j public.platform_jobs%rowtype;job uuid;attempt uuid;r jsonb;d jsonb;cp jsonb;request uuid;begin
 r:=learn_email_enqueue(t,a,'email.workspace_sync');job:=(r->>'job_id')::uuid;
 assert (learn_email_enqueue(t,a,'email.workspace_sync')->>'job_id')::uuid=job;
 assert learn_email_enqueue(t,a,'email.workspace_sync')->>'duplicate'='true';
 update public.platform_jobs set priority=-2147483648 where id=job;
 select * into j from platform_jobs_claim('email-offline-first',1,300,array['email.workspace_sync']);assert j.id=job;
 r:=learn_email_job_attempt(t,j.id,j.claimed_by,j.attempt_count);attempt:=(r->>'attempt_id')::uuid;
 d:=jsonb_build_object('tenantId',t,'accountId',a,'attemptId',attempt,'stream','recent','transitionId',gen_random_uuid(),
  'operation','claim','expectedGeneration',null,'expectedRevision',null,'expectedOwner',null,'payload','{"recovery":null}'::jsonb);
 assert learn_email_transition_prepare(d,j.claimed_by,j.attempt_count)=d;
 assert learn_email_transition_pending(t,a,'recent',attempt)=d;
 r:=learn_email_transition_apply(t,a,'recent',attempt,(d->>'transitionId')::uuid,j.claimed_by,j.attempt_count);
 assert r->>'disposition'='applied';cp:=r->'current_checkpoint';
 assert learn_email_transition_apply(t,a,'recent',attempt,(d->>'transitionId')::uuid,j.claimed_by,j.attempt_count)->>'disposition'='replayed';
 assert learn_email_transition_pending(t,a,'recent',attempt) is null;
 begin perform learn_email_transition_prepare(d||'{"operation":"release"}',j.claimed_by,j.attempt_count);raise exception 'Changed request accepted';exception when sqlstate 'PT409' then assert sqlerrm='learn_email_outbox_request_changed';end;
 request:=gen_random_uuid();
 d:=d||jsonb_build_object('transitionId',request,'operation','initialize_traversal','expectedGeneration',cp->>'generation','expectedRevision',cp->>'revision','expectedOwner',attempt,
  'payload','{"captured_history_id":"100","captured_at":"2026-10-12T00:00:00.000Z","page_size":25,"query":null}'::jsonb);
 perform learn_email_transition_prepare(d,j.claimed_by,j.attempt_count);
 insert into public.feature_flags(tenant_id,flag,value) values(t,'learn.inputs.email.enabled','false');
 assert learn_capture_admission(t,'email')->'allowed'='false';
 assert learn_capture_job_allowed(t,j.job_type,j.metadata,j.id),'Saved transition blocked by capture pause';
 begin perform learn_email_enqueue(t,a,'email.workspace_sync');raise exception 'Paused capture enqueued';exception when sqlstate 'PT409' then assert sqlerrm='learn_capture_paused';end;
 update public.platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=job;
 -- Model releaseExpiredLeases' guarded transition for this synthetic job only.
 -- The worker calls that reaper before platform_jobs_claim; claim does not reap.
 update public.platform_jobs set status='retrying',available_at=now(),lease_expires_at=null,error_code='lease_expired',last_error='Synthetic reclaimed lease'
 where id=job and status='running' and job_type<>'phone.voicemail_import' and lease_expires_at<clock_timestamp();
 select * into j from platform_jobs_claim('email-offline-replacement',1,300,array['email.workspace_sync']);assert j.id=job and j.attempt_count=2;
 r:=learn_email_job_attempt(t,job,j.claimed_by,j.attempt_count);assert (r->>'attempt_id')::uuid=attempt;
 begin perform learn_email_transition_apply(t,a,'recent',attempt,request,'email-offline-first',1);raise exception 'Stale worker settled request';exception when sqlstate 'PT409' then assert sqlerrm='learn_email_job_not_owned';end;
 r:=learn_email_transition_apply(t,a,'recent',attempt,request,j.claimed_by,j.attempt_count);
 assert r->>'disposition'='applied';cp:=r->'current_checkpoint';
 assert cp->'continuation'->>'version'='4';
 assert not learn_capture_job_allowed(t,j.job_type,j.metadata,j.id),'Pause admitted fresh provider work after settlement';
 d:=d||jsonb_build_object('transitionId',gen_random_uuid(),'operation','block','expectedGeneration',cp->>'generation','expectedRevision',cp->>'revision','expectedOwner',attempt,
  'payload','{"error_code":"delegation_denied","attempt_evidence":{"persistence":"confirmed","message_upsert_count":0,"thread_upsert_count":0,"ids_seen":0,"gone_count":0,"unresolved_count":1,"classification":"source_ineligible","coverage_complete":false}}'::jsonb);
 perform learn_email_transition_prepare(d,j.claimed_by,j.attempt_count);
 r:=learn_email_transition_apply(t,a,'recent',attempt,(d->>'transitionId')::uuid,j.claimed_by,j.attempt_count);
 assert r->'accepted_result'->>'attempt_status'='failed';
 r:=learn_email_job_fail(t,job,attempt,j.claimed_by,j.attempt_count);assert r->>'disposition'='applied' and r->>'code'='delegation_denied';
 assert learn_email_job_fail(t,job,attempt,j.claimed_by,j.attempt_count)->>'disposition'='replayed';
 assert (select count(*) from public.learn_email_transition_requests where tenant_id=t)=3;
 assert (select count(*) from public.learn_email_transition_settlements s join public.learn_email_transition_requests r on r.id=s.request_id where r.tenant_id=t)=3;
 assert (select history_id is null from public.email_accounts where id=a);
end$$;
reset role;
