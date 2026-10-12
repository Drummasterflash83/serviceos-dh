-- Append after Microsoft journey fixtures; the caller rolls back this clone.
-- Exercise the actual shared queue, not a manually assigned worker lease.
update public.platform_jobs set available_at=transaction_timestamp()+interval '1 day'
 where tenant_id='eb190660-aaaa-4000-8000-000000000001' and status in ('queued','retrying');
insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,payload,available_at)
 values('eb190660-aaaa-4000-8000-000000000860','eb190660-aaaa-4000-8000-000000000001',
 'microsoft-365','communications.email','email.microsoft_sync',
 'email.microsoft_sync:eb190660-aaaa-4000-8000-000000000004:ActualClaimFolder','queued',
 '{"email_account_id":"eb190660-aaaa-4000-8000-000000000002","mailbox_id":"eb190660-aaaa-4000-8000-000000000003","binding_id":"eb190660-aaaa-4000-8000-000000000004","kind":"messages","folder_id":"ActualClaimFolder"}',
 transaction_timestamp());
set local role service_role;
do $$begin
 assert not exists(select 1 from public.platform_jobs_claim('microsoft-actual-claim',1,60,array['email.microsoft_sync']));
end$$;reset role;
do $$begin
 assert exists(select 1 from public.platform_jobs where id='eb190660-aaaa-4000-8000-000000000860' and status='queued' and attempt_count=0 and claimed_by is null);
end$$;
delete from public.feature_flags where tenant_id='eb190660-aaaa-4000-8000-000000000001' and flag='learn.inputs.email.enabled';
update public.email_accounts set auth_state='ok' where id='eb190660-aaaa-4000-8000-000000000002';
set local role service_role;
do $$begin
 assert exists(select 1 from public.platform_jobs_claim('microsoft-actual-claim',1,60,array['email.microsoft_sync']) where id='eb190660-aaaa-4000-8000-000000000860');
end$$;reset role;
do $$begin
 assert exists(select 1 from public.platform_jobs where id='eb190660-aaaa-4000-8000-000000000860' and status='running' and attempt_count=1 and claimed_by='microsoft-actual-claim');
end$$;
insert into public.feature_flags(tenant_id,flag,value)
 values('eb190660-aaaa-4000-8000-000000000001','learn.inputs.email.enabled','false');
set local role service_role;
do $$declare r jsonb;begin
 r:=public.learn_microsoft_job_stop('eb190660-aaaa-4000-8000-000000000001','eb190660-aaaa-4000-8000-000000000860','microsoft-actual-claim',1,'capture_unconfirmed',null);
 assert r->>'state'='waiting' and r->>'attemptCount'='0';
end$$;reset role;
do $$begin
 assert not exists(select 1 from public.learn_microsoft_source_pages where job_id='eb190660-aaaa-4000-8000-000000000860');
 assert exists(select 1 from public.platform_jobs where id='eb190660-aaaa-4000-8000-000000000860' and status='queued' and claimed_by is null and attempt_count=0);
end$$;
