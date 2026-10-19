-- Disposable, network-isolated database only. No provider or customer data.
set request.jwt.claim.role='service_role';
do $$declare f text:=repeat('b',64);a jsonb;b jsonb;first_owner text:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1';
 second_owner text:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:1';manual text:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
begin
 a:=public.learn_commusoft_shared_lease_acquire(f,'source_page',first_owner);
 assert a->>'state'='ready','First source lease refused';
 b:=public.learn_commusoft_shared_lease_acquire(f,'job_detail',manual);
 assert b->>'state'='wait','Manual waiter overlapped active source GET';
 assert not public.learn_commusoft_shared_lease_release('source_page',second_owner),
  'Wrong owner released a source lease';
 assert (select lease_owner_id from public.learn_business_input_request_gates where credential_fingerprint=f)=first_owner,
  'Wrong-owner release changed owner';
 assert public.learn_commusoft_shared_lease_release('source_page',first_owner),
  'Source owner could not release its lease';
 b:=public.learn_commusoft_shared_lease_acquire(f,'source_page',second_owner);
 assert b->>'state'='wait','Worker jumped ahead of bounded manual waiter';
 perform pg_sleep(1.35);
 b:=public.learn_commusoft_shared_lease_acquire(f,'job_detail',manual);
 assert b->>'state'='ready','Manual waiter did not get one turn';
 assert not public.learn_commusoft_shared_lease_release('source_page',first_owner),
  'Stale source release cleared manual owner';
 assert public.learn_commusoft_shared_lease_release('job_detail',manual),
  'Manual owner could not release its lease';
 b:=public.learn_commusoft_shared_lease_acquire(f,'source_page',second_owner);
 assert b->>'state'='wait','Quota interval disappeared after manual read';
 perform pg_sleep(1.35);
 b:=public.learn_commusoft_shared_lease_acquire(f,'source_page',second_owner);
 assert b->>'state'='ready','Worker could not resume after manual turn';
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '5 seconds'
  where credential_fingerprint=f;
 assert public.learn_commusoft_shared_lease_release('source_page',second_owner),
  'Second source owner could not release';
 b:=public.learn_commusoft_shared_lease_acquire(f,'source_page',first_owner);
 assert b->>'state'='wait','Provider backoff was cleared by release';
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second',
  lease_owner_kind='source_page',lease_owner_id=first_owner,lease_expires_at=clock_timestamp()-interval '1 second'
  where credential_fingerprint=f;
 b:=public.learn_commusoft_shared_lease_acquire(f,'source_page',second_owner);
 assert b->>'state'='ready','Expired lease did not recover';
 assert not public.learn_commusoft_shared_lease_release('source_page',first_owner),
  'Stale release cleared a recovered lease';
 assert (select lease_owner_id from public.learn_business_input_request_gates where credential_fingerprint=f)=second_owner,
  'Recovered owner was replaced';
end$$;
do $$declare job_id uuid:=gen_random_uuid();f text:=repeat('c',64);a jsonb;begin
 insert into public.platform_jobs(id,tenant_id,job_type,status,attempt_count)
  values(job_id,public.fixture_id(100),'commusoft.source_sync','running',1);
 a:=public.learn_commusoft_shared_lease_acquire(f,'source_page',job_id::text||':1');
 assert a->>'state'='ready','Synthetic failed worker could not acquire lease';
 perform set_config('request.jwt.claim.role','authenticated',true);
 update public.platform_jobs set status='retrying' where id=job_id;
 assert (select lease_owner_id is null from public.learn_business_input_request_gates
  where credential_fingerprint=f),'Failed worker settlement kept lease';
 update public.platform_jobs set status='cancelled' where id=job_id;
 perform set_config('request.jwt.claim.role','service_role',true);
end$$;
select 'PASS: owner-only release, expiry, quota, one manual waiter and worker resume' result;
