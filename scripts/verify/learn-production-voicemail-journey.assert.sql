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
-- Store the source through the actual v4 mailbox protocol (not a direct message insert).
insert into platform_jobs(id,tenant_id,job_type,job_key,connector_id,module_id,payload,status,claimed_by,attempt_count,lease_expires_at)
 values(pg_temp.vm(6),pg_temp.vm(1),'email.workspace_sync','email.workspace_sync:'||pg_temp.vm(3),'google-workspace','communications.email',jsonb_build_object('email_account_id',pg_temp.vm(3),'max_results',25),'running','voicemail-email-fixture',1,clock_timestamp()+interval '5 minutes');
set local role service_role;
do $$declare r jsonb;c jsonb;attempt uuid;ctx jsonb;begin
 r:=learn_email_job_attempt(pg_temp.vm(1),pg_temp.vm(6),'voicemail-email-fixture',1);attempt:=(r->>'attempt_id')::uuid;
 r:=email_ingestion_transition_v2(pg_temp.vm(1),pg_temp.vm(3),'recent',attempt,gen_random_uuid(),'claim',null,null,null,'{"recovery":null}');c:=r->'current_checkpoint';
 r:=email_ingestion_transition_v2(pg_temp.vm(1),pg_temp.vm(3),'recent',attempt,gen_random_uuid(),'initialize_traversal',(c->>'generation')::uuid,(c->>'revision')::bigint,attempt,'{"captured_history_id":"100","captured_at":"2026-10-10T12:00:00.000Z","page_size":25,"query":null}');c:=r->'current_checkpoint';
 ctx:=jsonb_build_object('tenant_id',pg_temp.vm(1),'email_account_id',pg_temp.vm(3),'attempt_id',attempt,'stream','recent','generation',c->>'generation','revision',c->>'revision','mailbox','voicemail@example.invalid','fetch_policy','refetch_all');
 r:=learn_email_store_page(ctx,
 jsonb_build_array(jsonb_build_object('tenant_id',pg_temp.vm(1),'provider','gmail','provider_thread_id','abcdef01','subject','New message in mailbox 601 from Synthetic','participants','["voicemail@example.invalid","notifications@birchills.net"]'::jsonb,'last_message_at','2026-10-10T12:00:00Z','updated_at','2026-10-10T12:00:00Z')),
 jsonb_build_array(jsonb_build_object('tenant_id',pg_temp.vm(1),'provider','gmail','provider_message_id','abcdef01','provider_thread_id','abcdef01','from_email','notifications@birchills.net','from_name',null,'to_emails','["voicemail@example.invalid"]'::jsonb,'cc_emails','[]'::jsonb,'subject','New message in mailbox 601 from Synthetic','snippet',null,'body_text','Synthetic retained notification','body_html',null,'sent_at','2026-10-10T12:00:00Z','received_at','2026-10-10T12:00:00Z','direction','inbound','raw_payload','{"label_ids":["INBOX"],"history_id":"100"}'::jsonb)), 'voicemail-email-fixture',1);
 assert r->>'message_upsert_count'='1';
 begin perform voicemail_discover_page(pg_temp.vm(1),pg_temp.vm(4),pg_temp.vm(7));raise exception 'Disabled route admitted';exception when invalid_parameter_value then assert sqlerrm='voicemail_route_unverified';end;
end$$;reset role;
create temp table vm_source_before as select to_jsonb(m) source from email_messages m where tenant_id=pg_temp.vm(1);
update receptionist_voicemail_email_routes set enabled=true where id=pg_temp.vm(4);
set local role service_role;
do $$declare r jsonb;j public.platform_jobs%rowtype;begin
 r:=voicemail_discover_page(pg_temp.vm(1),pg_temp.vm(4),pg_temp.vm(7));
 assert r->>'state'='retained_pass_complete' and r->>'jobs_enqueued'='1' and r->>'rows_examined'='1' and r->'coverage_complete'='false';
 assert voicemail_discover_page(pg_temp.vm(1),pg_temp.vm(4),pg_temp.vm(7))=r;
 begin perform voicemail_discover_page(pg_temp.vm(2),pg_temp.vm(4),pg_temp.vm(7));raise exception 'Foreign receipt admitted';exception when sqlstate 'PT409' then assert sqlerrm='voicemail_discovery_request_conflict';end;
 -- The transaction-wrapped fixture represents a later committed worker request.
 update public.platform_jobs set available_at=transaction_timestamp() where tenant_id=pg_temp.vm(1) and status='queued' and job_type='phone.voicemail_import';
 select * into strict j from platform_jobs_claim('voicemail-fixture-worker',1,300,array['phone.voicemail_import']);
 assert j.tenant_id=pg_temp.vm(1) and j.attempt_count=1;
 assert voicemail_queue_step(pg_temp.vm(1),j.id,'voicemail-fixture-worker',1,'bind')->>'state'='bound';
 begin perform voicemail_queue_step(pg_temp.vm(1),j.id,'foreign-worker',1,'bind');raise exception 'Wrong worker admitted';exception when sqlstate 'PT409' then assert sqlerrm='voicemail_queue_claim_lost';end;
 begin perform voicemail_queue_step(pg_temp.vm(2),j.id,'voicemail-fixture-worker',1,'bind');raise exception 'Wrong tenant admitted';exception when sqlstate 'PT409' then assert sqlerrm='voicemail_queue_claim_lost';end;
end$$;reset role;
create function pg_temp.vm_prepare() returns jsonb language sql as $$
 select voicemail_queue_step(pg_temp.vm(1),(select job_id from receptionist_voicemail_candidates where tenant_id=pg_temp.vm(1)),'voicemail-fixture-worker',1,'prepare',
 jsonb_build_object('p_tenant',pg_temp.vm(1),'p_route',pg_temp.vm(4),'p_source',jsonb_build_object('email_id','abcdef01','received_at','2026-10-10T12:00:00Z','raw_sha256',repeat('a',64),'raw_bytes',100,'audio_sha256',repeat('b',64),'audio_bytes',4,'content_sha256',repeat('c',64),'signing_domain','birchills-net.20251104.gappssmtp.com'),
 'p_candidate',jsonb_build_object('version','birchills-voicemail-email/1','system_reference',pg_temp.vm(20),'extension','601','caller_number','01632960100','caller_name',null,'duration_seconds',28,'transcript','Synthetic private voicemail')));
$$;
create function pg_temp.vm_publish() returns jsonb language sql as $$
 select voicemail_queue_step(pg_temp.vm(1),j.job_id,'voicemail-fixture-worker',1,'publish',jsonb_build_object('p_tenant',pg_temp.vm(1),'p_intake',j.intake_id,'p_source',j.source_id,'p_raw_sha256',repeat('a',64),'p_audio_sha256',repeat('b',64))) from receptionist_voicemail_jobs j where tenant_id=pg_temp.vm(1);
$$;
grant execute on function pg_temp.vm_prepare(),pg_temp.vm_publish() to service_role;
set local role service_role;
do $$declare r jsonb;begin
 r:=pg_temp.vm_prepare();assert r=pg_temp.vm_prepare();assert r->>'state'='prepared';
 begin perform pg_temp.vm_publish();raise exception 'Missing uploads published';exception when sqlstate '55000' then assert sqlerrm='voicemail_upload_incomplete';end;
end$$;reset role;
-- Metadata stands in for uploaded bytes only in this offline SQL journey.
insert into storage.objects(bucket_id,name,metadata)
 select 'receptionist-voicemails',tenant_id::text||'/'||mailbox_id::text||'/'||id::text,'{"size":4,"mimetype":"audio/mpeg"}' from receptionist_voicemail_intakes where tenant_id=pg_temp.vm(1);
insert into storage.objects(bucket_id,name,metadata)
 select 'learn-voicemail-sources',tenant_id::text||'/'||intake_id::text||'/'||id::text||'.eml','{"size":100,"mimetype":"message/rfc822"}' from receptionist_voicemail_sources where tenant_id=pg_temp.vm(1);
insert into feature_flags(tenant_id,flag,value) values(pg_temp.vm(1),'learn.inputs.phone.enabled','false');
set local role service_role;
do $$begin
 begin perform pg_temp.vm_publish();raise exception 'Paused capture published';exception when sqlstate '55000' then assert sqlerrm='voicemail_capture_paused';end;
end$$;reset role;
delete from feature_flags where tenant_id=pg_temp.vm(1) and flag='learn.inputs.phone.enabled';
-- Reassigning the extension does not rewrite its verified historical owner.
update receptionist_mailboxes set owner_user_id=pg_temp.vm(11) where id=pg_temp.vm(5);
create function pg_temp.vm_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic_receipt_failure';end$$;
create trigger vm_fail before insert on receptionist_voicemail_job_receipts for each row execute function pg_temp.vm_fail();
set local role service_role;
do $$begin
 begin perform pg_temp.vm_publish();raise exception 'Receipt failure ignored';exception when raise_exception then assert sqlerrm='synthetic_receipt_failure';end;
 assert not exists(select 1 from receptionist_voicemails where tenant_id=pg_temp.vm(1));
 assert (select state from receptionist_voicemail_intakes where tenant_id=pg_temp.vm(1))='prepared';
end$$;reset role;
drop trigger vm_fail on receptionist_voicemail_job_receipts;
set local role service_role;
do $$declare r jsonb;j uuid;begin
 r:=pg_temp.vm_publish();assert r->>'state'='succeeded' and r->'coverage_complete'='false';
 select job_id into j from receptionist_voicemail_jobs where tenant_id=pg_temp.vm(1);
 assert r=voicemail_queue_step(pg_temp.vm(1),j,'voicemail-fixture-worker',1,'inspect');
 assert (select status from platform_jobs where id=j)='succeeded';
 assert (select count(*) from receptionist_voicemails where tenant_id=pg_temp.vm(1))=1;
 assert (select owner_user_id from receptionist_voicemails where tenant_id=pg_temp.vm(1))=pg_temp.vm(10);
end$$;reset role;
-- Test real RLS under original owner, current owner, explicit manager and foreign tenant.
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='ce481300-aaaa-4000-8000-000000000010';set local role authenticated;
do $$begin
 assert learn_voicemail_mailboxes(pg_temp.vm(1))#>>'{rows,0,access_scope}'='retained_messages';
 assert (select count(*) from receptionist_voicemails where tenant_id=pg_temp.vm(1))=1;
 assert not exists(select 1 from storage.objects where bucket_id in('receptionist-voicemails','learn-voicemail-sources'));
 begin perform * from receptionist_voicemail_sources;raise exception 'Private sources readable';exception when insufficient_privilege then null;end;
end$$;
set local request.jwt.claim.sub='ce481300-aaaa-4000-8000-000000000011';
do $$begin assert not exists(select 1 from receptionist_voicemails where tenant_id=pg_temp.vm(1));end$$;
set local request.jwt.claim.sub='ce481300-aaaa-4000-8000-000000000013';
do $$begin assert learn_voicemail_mailboxes(pg_temp.vm(1))->'rows'='[]';end$$;reset role;
insert into receptionist_mailbox_managers(tenant_id,mailbox_id,user_id,granted_by) values(pg_temp.vm(1),pg_temp.vm(5),pg_temp.vm(12),pg_temp.vm(12));
set local request.jwt.claim.sub='ce481300-aaaa-4000-8000-000000000012';set local role authenticated;
do $$begin assert learn_voicemail_mailboxes(pg_temp.vm(1))#>>'{rows,0,message_count}'='1';end$$;reset role;
delete from receptionist_mailbox_managers where mailbox_id=pg_temp.vm(5);
set local role authenticated;
do $$begin
 assert learn_voicemail_mailboxes(pg_temp.vm(1))->'rows'='[]';
 begin perform learn_operator_voicemail_status(pg_temp.vm(1));raise exception 'Ordinary owner admitted';exception when insufficient_privilege then assert sqlerrm='learn_operator_forbidden';end;
end$$;reset role;
insert into platform_authority_grants(profile_id,permission,granted_by,reason) values(pg_temp.vm(12),'platform.controlplane.view','offline-fixture','Synthetic voicemail operator proof');
set local role authenticated;
do $$declare r jsonb;begin
 r:=learn_operator_voicemail_status(pg_temp.vm(1));assert jsonb_array_length(r->'routes')=1 and r#>'{routes,0,status,coverage_complete}'='false';
 assert position('Synthetic private voicemail' in r::text)=0 and position('voicemail@example.invalid' in r::text)=0;
 assert not exists(select 1 from receptionist_voicemails where tenant_id=pg_temp.vm(1));
end$$;reset role;
update platform_authority_grants set effective_to=clock_timestamp() where profile_id=pg_temp.vm(12);
set local role authenticated;
do $$begin begin perform learn_operator_voicemail_status(pg_temp.vm(1));raise exception 'Expired operator admitted';exception when insufficient_privilege then assert sqlerrm='learn_operator_forbidden';end;end$$;reset role;
-- Capture off does not remove the saved message, source evidence or successful receipt.
update receptionist_voicemail_email_routes set enabled=false where tenant_id=pg_temp.vm(1);
set local role service_role;
do $$declare r jsonb;begin
 r:=voicemail_schedule_tick();assert r->>'state'='idle' and r->'coverage_complete'='false';
 assert not exists(select 1 from receptionist_voicemail_dispatch_receipts);
end$$;reset role;
do $$begin
 assert (select source from vm_source_before)=(select to_jsonb(m) from email_messages m where tenant_id=pg_temp.vm(1));
 assert (select count(*) from receptionist_voicemail_sources where tenant_id=pg_temp.vm(1))=1;
 assert (select count(*) from receptionist_voicemails where tenant_id=pg_temp.vm(1))=1;
 assert (select count(*) from receptionist_voicemail_job_receipts where tenant_id=pg_temp.vm(1))=1;
end$$;
