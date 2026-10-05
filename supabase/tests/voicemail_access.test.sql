-- Rollback-only fixtures; run after the voicemail migration.
begin;
insert into storage.objects(bucket_id,name) values('receptionist-voicemails','private-test-object');
insert into public.tenants(id) values ('aa000000-0000-0000-0000-000000000001'),('aa000000-0000-0000-0000-000000000002');
insert into auth.users(id) values
('ab000000-0000-0000-0000-000000000001'), -- owner A
('ab000000-0000-0000-0000-000000000002'), -- another staff member
('ab000000-0000-0000-0000-000000000003'); -- explicitly authorised manager
insert into public.receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id) values
('ac000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','one','Example A','104','ab000000-0000-0000-0000-000000000001'),
('ac000000-0000-0000-0000-000000000002','aa000000-0000-0000-0000-000000000002','two','Example B','105',null);
insert into public.receptionist_voicemails(id,tenant_id,mailbox_id,provider_message_id,owner_user_id,received_at) values
('ad000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','message1','ab000000-0000-0000-0000-000000000001',now()),
('ad000000-0000-0000-0000-000000000002','aa000000-0000-0000-0000-000000000002','ac000000-0000-0000-0000-000000000002','message2',null,now());
insert into public.receptionist_mailbox_managers(tenant_id,mailbox_id,user_id,granted_by) values
('aa000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000003','ab000000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('test.tenant','aa000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.sub','ab000000-0000-0000-0000-000000000001',true);
do $$begin
 assert(select count(*) from public.receptionist_voicemails)=1,'Owner sees only their messages';
 assert(select count(*) from storage.objects where bucket_id='receptionist-voicemails')=0,'No direct storage access even with broad storage policy';
 assert(select message_count from public.voicemail_mailbox_summary('aa000000-0000-0000-0000-000000000001'))=1,'Owner count uses RLS';
 assert(select count(*) from public.voicemail_mailbox_summary('aa000000-0000-0000-0000-000000000002'))=0,'Foreign tenant request denied';
 begin update public.receptionist_voicemails set email_status='sent'; raise exception 'Client writes allowed'; exception when insufficient_privilege then null; end;
 begin insert into public.receptionist_mailbox_managers values('aa000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001',auth.uid(),auth.uid(),now()); raise exception 'Self grant allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','ab000000-0000-0000-0000-000000000002',true);
do $$begin
 assert(select count(*) from public.receptionist_mailboxes)=0,'Ordinary staff cannot see private mailbox metadata';
 assert(select count(*) from public.receptionist_voicemails)=0,'Ordinary staff cannot see messages';
end $$;
select set_config('request.jwt.claim.sub','ab000000-0000-0000-0000-000000000003',true);
do $$begin
 assert(select count(*) from public.receptionist_voicemails)=1,'Manager grant is mailbox scoped';
end $$;
reset role;
update public.receptionist_mailboxes set owner_user_id='ab000000-0000-0000-0000-000000000002' where extension='104';
delete from public.receptionist_mailbox_managers;
set local role authenticated;
select set_config('request.jwt.claim.sub','ab000000-0000-0000-0000-000000000002',true);
do $$begin
 assert(select count(*) from public.receptionist_mailboxes)=1,'New owner sees assigned mailbox';
 assert(select count(*) from public.receptionist_voicemails)=0,'New owner does not inherit old owner recordings';
 assert(select message_count from public.voicemail_mailbox_summary('aa000000-0000-0000-0000-000000000001'))=0,'Counts do not leak old messages';
end $$;
select set_config('request.jwt.claim.sub','ab000000-0000-0000-0000-000000000003',true);
do $$begin assert(select count(*) from public.receptionist_voicemails)=0,'Revoked manager loses access'; end $$;
set local role anon;
do $$begin
 begin perform * from public.receptionist_voicemails; raise exception 'Anonymous access allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$begin
 begin update public.receptionist_voicemails set email_status='delivered'; raise exception 'Delivery without evidence accepted'; exception when check_violation then null; end;
 begin update public.receptionist_voicemails set recording_path='https://example.com/audio'; raise exception 'Arbitrary audio URL accepted'; exception when check_violation then null; end;
 assert(select public from storage.buckets where id='receptionist-voicemails')=false,'Recordings bucket is private';
 raise notice 'PASS: owner, explicit manager, staff, tenant isolation, revocation, reassignment, protected counts, denied writes, private audio and email evidence';
end $$;
rollback;
