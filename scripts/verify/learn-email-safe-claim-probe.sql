-- Synthetic legacy blocked fetch, resumed by an ordinary system-labelled claim.
-- Caller must wrap every statement in a single rollback transaction.
insert into public.tenants(id,slug,display_name,status)
values('ec393000-cccc-4000-8000-000000000001',
  'email-safe-claim-rollback','Synthetic safe claim rollback','active');
insert into public.google_workspace_connections
  (id,tenant_id,domain,status,last_verified_at)
values('ec393000-cccc-4000-8000-000000000002',
  'ec393000-cccc-4000-8000-000000000001','example.invalid','active',clock_timestamp());
insert into public.google_workspace_mailboxes
  (id,tenant_id,connection_id,email_address,mailbox_type,status,sync_enabled)
values('ec393000-cccc-4000-8000-000000000003',
  'ec393000-cccc-4000-8000-000000000001',
  'ec393000-cccc-4000-8000-000000000002',
  'resume@example.invalid','user','active',true);
insert into public.email_accounts(id,tenant_id,email_address,provider,status,auth_state)
values('ec393000-cccc-4000-8000-000000000004',
  'ec393000-cccc-4000-8000-000000000001',
  'resume@example.invalid','gmail','active_dwd','ok');
insert into public.email_sync_runs(id,tenant_id,provider,sync_type,metadata)
values('ec393000-cccc-4000-8000-000000000005',
  'ec393000-cccc-4000-8000-000000000001','gmail','workspace_messages',
  '{"email_account_id":"ec393000-cccc-4000-8000-000000000004"}'::jsonb);
do $prior$
declare t constant uuid:='ec393000-cccc-4000-8000-000000000001';
 a constant uuid:='ec393000-cccc-4000-8000-000000000004';
 run constant uuid:='ec393000-cccc-4000-8000-000000000005';
 c public.email_ingestion_checkpoints%rowtype; result jsonb;
begin
 result:=public.email_ingestion_transition_v2(t,a,'recent',run,gen_random_uuid(),
   'claim',null,null,null,'{"recovery":null}'::jsonb);
 if result#>>'{accepted_result,checkpoint_state}'<>'claimed'
 then raise exception 'safe_claim_fixture_claim_failed'; end if;
 select * into c from public.email_ingestion_checkpoints
   where tenant_id=t and email_account_id=a and stream='recent';
 result:=public.email_ingestion_transition_v2(t,a,'recent',run,gen_random_uuid(),
   'block',c.generation,c.revision,c.owner_attempt_id,
   '{"error_code":"fetch_failed","attempt_evidence":{"persistence":"confirmed",
    "message_upsert_count":0,"thread_upsert_count":0,"ids_seen":0,"gone_count":0,
    "unresolved_count":1,"classification":"fetch_failure","coverage_complete":false}}'::jsonb);
 if result#>>'{accepted_result,checkpoint_state}'<>'ready'
 then raise exception 'safe_claim_fixture_failure_boundary_changed'; end if;
end $prior$;
-- The next three changes reconstruct a legacy blocked result solely inside
-- this rollback fixture. The real production repair uses no direct row writes.
set local role email_ingestion_protocol_owner;
update public.email_sync_runs set completed_at=clock_timestamp()-interval '10 minutes'
where id='ec393000-cccc-4000-8000-000000000005';
update public.email_ingestion_checkpoints set state='blocked',block_code='fetch_failed',
 updated_at=(select completed_at from public.email_sync_runs
   where id='ec393000-cccc-4000-8000-000000000005')
where tenant_id='ec393000-cccc-4000-8000-000000000001'
  and email_account_id='ec393000-cccc-4000-8000-000000000004' and stream='recent';
insert into public.email_ingestion_transitions
  (tenant_id,email_account_id,stream,transition_id,operation,attempt_id,
   expected_generation,expected_revision,expected_owner_attempt_id,
   request_document,request_fingerprint,accepted_result,checkpoint_stream,
   result_generation,result_revision)
select x.tenant_id,x.email_account_id,x.stream,
 'ec393000-cccc-4000-8000-000000000007'::uuid,x.operation,x.attempt_id,
 x.expected_generation,x.expected_revision,x.expected_owner_attempt_id,
 jsonb_set(x.request_document,'{transition_id}',
   '"ec393000-cccc-4000-8000-000000000007"'::jsonb),
 md5(jsonb_set(x.request_document,'{transition_id}',
   '"ec393000-cccc-4000-8000-000000000007"'::jsonb)::text),
 x.accepted_result||'{"checkpoint_state":"blocked"}'::jsonb,
 x.checkpoint_stream,x.result_generation,x.result_revision
from public.email_ingestion_transitions x
where x.tenant_id='ec393000-cccc-4000-8000-000000000001'
  and x.attempt_id='ec393000-cccc-4000-8000-000000000005'
  and x.operation='block';
reset role;
insert into public.email_sync_runs(id,tenant_id,provider,sync_type,metadata)
values('ec393000-cccc-4000-8000-000000000006',
  'ec393000-cccc-4000-8000-000000000001','gmail','workspace_messages',
  '{"email_account_id":"ec393000-cccc-4000-8000-000000000004"}'::jsonb);
do $recover$
declare t constant uuid:='ec393000-cccc-4000-8000-000000000001';
 a constant uuid:='ec393000-cccc-4000-8000-000000000004';
 run constant uuid:='ec393000-cccc-4000-8000-000000000006';
 c public.email_ingestion_checkpoints%rowtype; result jsonb; before_continuation jsonb;
begin
 select * into c from public.email_ingestion_checkpoints
   where tenant_id=t and email_account_id=a and stream='recent';
 if c.state<>'blocked' or c.block_code<>'fetch_failed' then
   raise exception 'synthetic_legacy_block_missing'; end if;
 before_continuation:=c.continuation;
 result:=public.email_ingestion_transition_v2(t,a,'recent',run,gen_random_uuid(),
   'claim',c.generation,c.revision,null,'{"recovery":null}'::jsonb);
 if result->>'disposition'<>'applied'
   or result#>>'{accepted_result,checkpoint_state}'<>'claimed'
   or result#>>'{accepted_result,automatic_recovery}'<>'confirmed_zero_write_fetch_retry'
 then raise exception 'ordinary_safe_claim_failed'; end if;
 select * into c from public.email_ingestion_checkpoints
   where tenant_id=t and email_account_id=a and stream='recent';
 if c.continuation is distinct from before_continuation or c.block_code is not null
   or c.owner_attempt_id is distinct from run
 then raise exception 'safe_claim_changed_continuation'; end if;
 result:=public.email_ingestion_transition_v2(t,a,'recent',run,gen_random_uuid(),
   'release',c.generation,c.revision,c.owner_attempt_id,
   '{"reason_code":"requested_yield","attempt_evidence":{"persistence":"confirmed",
    "message_upsert_count":0,"thread_upsert_count":0,"ids_seen":0,"gone_count":0,
    "unresolved_count":0,"coverage_complete":false}}'::jsonb);
 if result#>>'{accepted_result,checkpoint_state}'<>'ready'
 then raise exception 'safe_claim_release_failed'; end if;
 if not exists(select 1 from public.email_ingestion_transitions x
   where x.tenant_id=t and x.attempt_id=run and x.operation='claim'
     and x.accepted_result->>'automatic_recovery'='confirmed_zero_write_fetch_retry')
 then raise exception 'system_recovery_audit_missing'; end if;
end $recover$;
-- A blocked checkpoint without an immutable matching failed attempt cannot
-- use the automatic path, even when its visible code says fetch_failed.
insert into public.email_accounts(id,tenant_id,email_address,provider,status,auth_state)
values('ec393000-cccc-4000-8000-000000000008',
  'ec393000-cccc-4000-8000-000000000001',
  'unproven@example.invalid','gmail','active_dwd','ok');
insert into public.email_ingestion_checkpoints
  (tenant_id,email_account_id,stream,contract_version,generation,revision,
   state,owner_attempt_id,continuation,block_code,updated_at)
values('ec393000-cccc-4000-8000-000000000001',
  'ec393000-cccc-4000-8000-000000000008','recent',2,
  'ec393000-cccc-4000-8000-000000000010',1,'blocked',null,
  '{"version":4,"phase":"uninitialized","intent":"reconcile",
    "fetch_policy":"refetch_all"}'::jsonb,'fetch_failed',
  clock_timestamp()-interval '10 minutes');
insert into public.email_sync_runs(id,tenant_id,provider,sync_type,metadata)
values('ec393000-cccc-4000-8000-000000000009',
  'ec393000-cccc-4000-8000-000000000001','gmail','workspace_messages',
  '{"email_account_id":"ec393000-cccc-4000-8000-000000000008"}'::jsonb);
do $negative$
declare result jsonb;
begin
 result:=public.email_ingestion_transition_v2(
   'ec393000-cccc-4000-8000-000000000001',
   'ec393000-cccc-4000-8000-000000000008','recent',
   'ec393000-cccc-4000-8000-000000000009',gen_random_uuid(),'claim',
   'ec393000-cccc-4000-8000-000000000010',1,null,'{"recovery":null}'::jsonb);
 if result->>'disposition'<>'conflict' or
   result->>'code'<>'explicit_recovery_required' or
   (select state from public.email_ingestion_checkpoints
     where email_account_id='ec393000-cccc-4000-8000-000000000008')<>'blocked'
 then raise exception 'unproven_fetch_block_auto_resumed'; end if;
end $negative$;
