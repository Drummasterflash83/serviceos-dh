-- Only inside the release's single rollback transaction. Never retain fixture.
insert into public.tenants(id,slug,display_name,status)
values('ec394000-cccc-4000-8000-000000000001',
  'email-profile-claim-rollback','Synthetic profile claim rollback','active');
insert into public.google_workspace_connections
  (id,tenant_id,domain,status,last_verified_at)
values('ec394000-cccc-4000-8000-000000000002',
  'ec394000-cccc-4000-8000-000000000001','example.invalid','active',clock_timestamp());
insert into public.google_workspace_mailboxes
  (id,tenant_id,connection_id,email_address,mailbox_type,status,sync_enabled,
   directory_identity_conflict)
values('ec394000-cccc-4000-8000-000000000003',
  'ec394000-cccc-4000-8000-000000000001',
  'ec394000-cccc-4000-8000-000000000002',
  'proof@example.invalid','user','active',true,false);
insert into public.email_accounts(id,tenant_id,email_address,provider,status,auth_state)
values('ec394000-cccc-4000-8000-000000000004',
  'ec394000-cccc-4000-8000-000000000001',
  'proof@example.invalid','gmail','active_dwd','ok');
insert into public.email_sync_runs(id,tenant_id,provider,sync_type,metadata)
values('ec394000-cccc-4000-8000-000000000005',
  'ec394000-cccc-4000-8000-000000000001','gmail','workspace_messages',
  '{"email_account_id":"ec394000-cccc-4000-8000-000000000004"}'::jsonb);
set local role email_ingestion_protocol_owner;
insert into public.email_ingestion_checkpoints
  (tenant_id,email_account_id,stream,contract_version,generation,revision,
   state,owner_attempt_id,continuation,block_code,updated_at)
values('ec394000-cccc-4000-8000-000000000001',
  'ec394000-cccc-4000-8000-000000000004','recent',2,
  'ec394000-cccc-4000-8000-000000000010',1,'blocked',null,
  '{"version":4,"phase":"uninitialized","intent":"reconcile",
    "fetch_policy":"refetch_all"}'::jsonb,'admin_delegation_missing',
  clock_timestamp()-interval '10 minutes');
reset role;
do $negative$
declare result jsonb;
begin
 result:=public.email_ingestion_transition_v2(
   'ec394000-cccc-4000-8000-000000000001',
   'ec394000-cccc-4000-8000-000000000004','recent',
   'ec394000-cccc-4000-8000-000000000005',gen_random_uuid(),'claim',
   'ec394000-cccc-4000-8000-000000000010',1,null,'{"recovery":null}'::jsonb);
 if result->>'disposition'<>'conflict' or result->>'code'<>'explicit_recovery_required'
 then raise exception 'missing_profile_proof_allowed_claim'; end if;
end $negative$;
insert into public.audit_logs
  (id,tenant_id,actor,action,resource_type,resource_id,status,detail,created_at)
values
  ('ec394000-cccc-4000-8000-000000000006',
   'ec394000-cccc-4000-8000-000000000001','system:learn-email-mailbox-source-probe',
   'learn.email.mailbox_source_probe','email_account',
   'ec394000-cccc-4000-8000-000000000004','requested',
   '{"checkpoint_generation":"ec394000-cccc-4000-8000-000000000010",
     "checkpoint_revision":2,"provider_scope":"gmail.readonly",
     "mailbox_content_read":false}'::jsonb,clock_timestamp()-interval '2 seconds'),
  ('ec394000-cccc-4000-8000-000000000007',
   'ec394000-cccc-4000-8000-000000000001','system:learn-email-mailbox-source-probe',
   'learn.email.mailbox_source_probe_result','email_account',
   'ec394000-cccc-4000-8000-000000000004','success',
   '{"request_audit_id":"ec394000-cccc-4000-8000-000000000006",
     "checkpoint_generation":"ec394000-cccc-4000-8000-000000000010",
     "checkpoint_revision":2,"code":"provider_verified",
     "mailbox_content_read":false}'::jsonb,clock_timestamp()-interval '1 second');
do $negative$
declare result jsonb;
begin
 result:=public.email_ingestion_transition_v2(
   'ec394000-cccc-4000-8000-000000000001',
   'ec394000-cccc-4000-8000-000000000004','recent',
   'ec394000-cccc-4000-8000-000000000005',gen_random_uuid(),'claim',
   'ec394000-cccc-4000-8000-000000000010',1,null,'{"recovery":null}'::jsonb);
 if result->>'disposition'<>'conflict' or result->>'code'<>'explicit_recovery_required'
 then raise exception 'mismatched_profile_revision_allowed_claim'; end if;
end $negative$;
insert into public.audit_logs
  (id,tenant_id,actor,action,resource_type,resource_id,status,detail)
values
  ('ec394000-cccc-4000-8000-000000000008',
   'ec394000-cccc-4000-8000-000000000001','system:learn-email-mailbox-source-probe',
   'learn.email.mailbox_source_probe','email_account',
   'ec394000-cccc-4000-8000-000000000004','requested',
   '{"checkpoint_generation":"ec394000-cccc-4000-8000-000000000010",
     "checkpoint_revision":1,"provider_scope":"gmail.readonly",
     "mailbox_content_read":false}'::jsonb),
  ('ec394000-cccc-4000-8000-000000000009',
   'ec394000-cccc-4000-8000-000000000001','system:learn-email-mailbox-source-probe',
   'learn.email.mailbox_source_probe_result','email_account',
   'ec394000-cccc-4000-8000-000000000004','success',
   '{"request_audit_id":"ec394000-cccc-4000-8000-000000000008",
     "checkpoint_generation":"ec394000-cccc-4000-8000-000000000010",
     "checkpoint_revision":1,"code":"provider_verified",
     "mailbox_content_read":false}'::jsonb);
insert into public.audit_logs
  (id,tenant_id,actor,action,resource_type,resource_id,status,detail,created_at)
values('ec394000-cccc-4000-8000-000000000011',
  'ec394000-cccc-4000-8000-000000000001','system:learn-email-mailbox-source-probe',
  'learn.email.mailbox_source_probe_result','email_account',
  'ec394000-cccc-4000-8000-000000000004','failed',
  '{"request_audit_id":"ec394000-cccc-4000-8000-000000000008",
    "checkpoint_generation":"ec394000-cccc-4000-8000-000000000010",
    "checkpoint_revision":1,"code":"provider_unconfirmed",
    "mailbox_content_read":false}'::jsonb,clock_timestamp()+interval '1 second');
do $negative$
declare result jsonb;
begin
 result:=public.email_ingestion_transition_v2(
   'ec394000-cccc-4000-8000-000000000001',
   'ec394000-cccc-4000-8000-000000000004','recent',
   'ec394000-cccc-4000-8000-000000000005',gen_random_uuid(),'claim',
   'ec394000-cccc-4000-8000-000000000010',1,null,'{"recovery":null}'::jsonb);
 if result->>'disposition'<>'conflict' or result->>'code'<>'explicit_recovery_required'
 then raise exception 'later_failed_profile_probe_allowed_claim'; end if;
end $negative$;
insert into public.audit_logs
  (id,tenant_id,actor,action,resource_type,resource_id,status,detail,created_at)
values('ec394000-cccc-4000-8000-000000000012',
  'ec394000-cccc-4000-8000-000000000001','system:learn-email-mailbox-source-probe',
  'learn.email.mailbox_source_probe_result','email_account',
  'ec394000-cccc-4000-8000-000000000004','success',
  '{"request_audit_id":"ec394000-cccc-4000-8000-000000000008",
    "checkpoint_generation":"ec394000-cccc-4000-8000-000000000010",
    "checkpoint_revision":1,"code":"provider_verified",
    "mailbox_content_read":false}'::jsonb,clock_timestamp()+interval '2 seconds');
do $positive$
declare result jsonb; continuation jsonb;
begin
 select c.continuation into continuation from public.email_ingestion_checkpoints c
   where c.email_account_id='ec394000-cccc-4000-8000-000000000004';
 result:=public.email_ingestion_transition_v2(
   'ec394000-cccc-4000-8000-000000000001',
   'ec394000-cccc-4000-8000-000000000004','recent',
   'ec394000-cccc-4000-8000-000000000005',gen_random_uuid(),'claim',
   'ec394000-cccc-4000-8000-000000000010',1,null,'{"recovery":null}'::jsonb);
 if result->>'disposition'<>'applied' or
   result#>>'{accepted_result,checkpoint_state}'<>'claimed' or
   result#>>'{accepted_result,automatic_recovery}'<>'confirmed_mailbox_profile_recovery' or
   (select c.continuation from public.email_ingestion_checkpoints c
      where c.email_account_id='ec394000-cccc-4000-8000-000000000004') is distinct from continuation
 then raise exception 'verified_profile_claim_failed'; end if;
end $positive$;
