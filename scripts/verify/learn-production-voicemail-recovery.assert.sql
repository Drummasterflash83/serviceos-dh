-- Combined production-schema journey. Synthetic source and storage metadata only;
-- real DKIM, byte readback, HTTP Storage and audible playback remain separate gates.
create function pg_temp.vm(n int) returns uuid language sql immutable as $$select ('ce481300-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.vm(int) to service_role,authenticated;
insert into tenants(id,slug,display_name,status) select pg_temp.vm(n),'voicemail-production-fixture-'||n,'Synthetic voicemail journey','active' from generate_series(1,2)n;
insert into auth.users(id,email,banned_until) select pg_temp.vm(n),'voicemail-production-fixture-'||n||'@example.invalid','infinity' from generate_series(10,13)n;
update profiles set tenant_id=pg_temp.vm(1),role='owner' where id in(pg_temp.vm(10),pg_temp.vm(11),pg_temp.vm(12));
update profiles set tenant_id=pg_temp.vm(2),role='owner' where id=pg_temp.vm(13);
insert into email_accounts(id,tenant_id,provider,email_address,status) values(pg_temp.vm(3),pg_temp.vm(1),'gmail','voicemail@example.invalid','active_dwd');
insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id)
 values(pg_temp.vm(5),pg_temp.vm(1),'synthetic-mailbox','Synthetic mailbox','601',pg_temp.vm(10));
insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,binding_evidence,verified_by)
 values(pg_temp.vm(4),pg_temp.vm(1),pg_temp.vm(5),pg_temp.vm(3),'voicemail@example.invalid','birchills-net.20251104.gappssmtp.com',pg_temp.vm(10),'owner','2026-10-01','Synthetic verified route only',pg_temp.vm(12));

-- Bounded retained discovery, dispatch and queue recovery in an isolated clone.
update receptionist_voicemail_email_routes set enabled=true where id=pg_temp.vm(4);
insert into email_messages(id,tenant_id,provider,provider_message_id,subject,from_email,received_at,raw_payload)
 select pg_temp.vm(1000+n),pg_temp.vm(1),'gmail',to_hex(n),'New message in mailbox 601 from synthetic','synthetic@birchills.net','2026-10-10T12:00:00Z',
 jsonb_build_object('provider_account_id',pg_temp.vm(3),'label_ids',case when n=1 then '["DRAFT"]'::jsonb else '["INBOX"]'::jsonb end,'provider_availability','available') from generate_series(1,1100)n;
insert into email_accounts(id,tenant_id,provider,email_address,status) values(pg_temp.vm(8),pg_temp.vm(1),'gmail','different@example.invalid','active_dwd');
insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,binding_evidence,verified_by,enabled)
 values(pg_temp.vm(9),pg_temp.vm(1),pg_temp.vm(5),pg_temp.vm(8),'mismatched@example.invalid','birchills-net.20251104.gappssmtp.com',pg_temp.vm(10),'owner','2026-10-01','Synthetic invalid binding',pg_temp.vm(12),true);
set local role service_role;
do $$declare r jsonb;replayed jsonb;begin
 r:=voicemail_schedule_tick();
 assert r->>'state'='attention' and r->>'routes_attempted'='2' and r->>'routes_failed'='1' and r->>'rows_examined'='500' and r->>'pages'='5' and r->>'jobs_enqueued'='499' and r->'coverage_complete'='false';
 replayed:=voicemail_schedule_tick();assert replayed->'historical_receipt'='true' and replayed-'historical_receipt'=r-'historical_receipt';
 assert (select rows_examined from receptionist_voicemail_scans where route_id=pg_temp.vm(4))=500;
 assert (select dispatch_code from receptionist_voicemail_scans where route_id=pg_temp.vm(9))='voicemail_route_unverified';
 assert (select code from receptionist_voicemail_candidates where route_id=pg_temp.vm(4) and email_message_id=pg_temp.vm(1001))='voicemail_source_ineligible';
end$$;reset role;
-- Force only the synthetic dispatch clock forward; no claim about wall-clock scheduling.
truncate receptionist_voicemail_dispatch_receipts,receptionist_voicemail_scan_receipts;
update receptionist_voicemail_scans set dispatch_next_at=null where route_id=pg_temp.vm(4);
set local role service_role;
do $$declare r jsonb;begin
 r:=voicemail_schedule_tick();assert r->>'rows_examined'='500' and r->>'jobs_enqueued'='500';
end$$;reset role;
truncate receptionist_voicemail_dispatch_receipts,receptionist_voicemail_scan_receipts;
update receptionist_voicemail_scans set dispatch_next_at=null where route_id=pg_temp.vm(4);
set local role service_role;
do $$declare r jsonb;begin
 r:=voicemail_schedule_tick();assert r->>'rows_examined'='100' and r->>'jobs_enqueued'='100';
 assert (select rows_examined from receptionist_voicemail_scans where route_id=pg_temp.vm(4))=1100;
 assert (select count(*) from platform_jobs where tenant_id=pg_temp.vm(1) and job_type='phone.voicemail_import')=1099;
 assert voicemail_discovery_status(pg_temp.vm(1),pg_temp.vm(4))->'coverage_complete'='false';
end$$;reset role;
-- Published failure receipt and retries use the actual lease claim, not fabricated worker ownership.
set local role service_role;
do $$declare j public.platform_jobs%rowtype;r jsonb;begin
 -- The transaction-wrapped fixture represents a later committed worker request.
 update public.platform_jobs set available_at=transaction_timestamp() where tenant_id=pg_temp.vm(1) and status='queued' and job_type='phone.voicemail_import';
 select * into strict j from platform_jobs_claim('recovery-fixture',1,300,array['phone.voicemail_import']);
 perform voicemail_queue_step(pg_temp.vm(1),j.id,'recovery-fixture',j.attempt_count,'bind');
 r:=voicemail_queue_step(pg_temp.vm(1),j.id,'recovery-fixture',j.attempt_count,'fail','{"code":"voicemail_provider_temporary"}');
 assert r->>'state'='retrying' and r->>'code'='voicemail_provider_temporary';
 assert r=voicemail_queue_step(pg_temp.vm(1),j.id,'recovery-fixture',j.attempt_count,'inspect');
 assert (select error_count from platform_jobs where id=j.id)=1;
end$$;reset role;
-- A pause after admission preserves failure budget and never presents success.
set local role service_role;
do $$declare j public.platform_jobs%rowtype;begin
 -- The transaction-wrapped fixture represents a later committed worker request.
 update public.platform_jobs set available_at=transaction_timestamp() where tenant_id=pg_temp.vm(1) and status='queued' and job_type='phone.voicemail_import';
 select * into strict j from platform_jobs_claim('paused-fixture',1,300,array['phone.voicemail_import']);
 perform voicemail_queue_step(pg_temp.vm(1),j.id,'paused-fixture',j.attempt_count,'bind');
end$$;reset role;
insert into feature_flags(tenant_id,flag,value) values(pg_temp.vm(1),'learn.inputs.email.enabled','false');
set local role service_role;
do $$declare j public.platform_jobs%rowtype;r jsonb;begin
 select * into strict j from platform_jobs where claimed_by='paused-fixture';
 r:=voicemail_queue_step(pg_temp.vm(1),j.id,'paused-fixture',j.attempt_count,'fail','{"code":"sensitive untrusted error text"}');
 assert r->>'state'='waiting' and r->>'code'='voicemail_capture_paused' and r->'coverage_complete'='false';
 assert (select error_count from platform_jobs where id=j.id)=0;
 assert position('sensitive' in r::text)=0;
end$$;reset role;
delete from feature_flags where tenant_id=pg_temp.vm(1);
-- Recover a worker that vanished; stale attempt cannot settle after recovery.
set local role service_role;
do $$declare j public.platform_jobs%rowtype;begin
 -- The transaction-wrapped fixture represents a later committed worker request.
 update public.platform_jobs set available_at=transaction_timestamp() where tenant_id=pg_temp.vm(1) and status='queued' and job_type='phone.voicemail_import';
 select * into strict j from platform_jobs_claim('interrupted-fixture',1,300,array['phone.voicemail_import']);
 perform voicemail_queue_step(pg_temp.vm(1),j.id,'interrupted-fixture',j.attempt_count,'bind');
end$$;reset role;
update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where tenant_id=pg_temp.vm(1) and claimed_by='interrupted-fixture';
set local role service_role;
do $$declare j public.platform_jobs%rowtype;begin
 assert voicemail_queue_recover()=1;
 select * into strict j from platform_jobs where tenant_id=pg_temp.vm(1) and claimed_by='interrupted-fixture';
 assert j.status='retrying' and j.error_count=1 and j.error_code='voicemail_worker_interrupted';
 begin perform voicemail_queue_step(pg_temp.vm(1),j.id,'interrupted-fixture',j.attempt_count,'bind');raise exception 'Stale worker admitted';exception when sqlstate 'PT409' then assert sqlerrm='voicemail_queue_claim_lost';end;
 assert voicemail_queue_recover()=0;
end$$;reset role;
-- Source rows and audio are not removed by dispatch/recovery.
do $$begin
 assert (select count(*) from email_messages where tenant_id=pg_temp.vm(1))=1100;
 assert not exists(select 1 from receptionist_voicemails where tenant_id=pg_temp.vm(1));
 assert not exists(select 1 from receptionist_voicemail_intakes where tenant_id=pg_temp.vm(1));
end$$;
