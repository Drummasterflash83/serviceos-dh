-- Synthetic protocol exercise inside a transaction that must be rolled back.
insert into public.tenants(id,slug,display_name,status)
values('ec390000-cccc-4000-8000-000000000001',
  'email-transient-retry-rollback','Synthetic email retry rollback','active');
insert into public.email_accounts(id,tenant_id,email_address,provider,status,auth_state,history_id)
values
 ('ec390000-cccc-4000-8000-000000000002','ec390000-cccc-4000-8000-000000000001',
  'retry@example.invalid','gmail','active_dwd','ok',null),
 ('ec390000-cccc-4000-8000-000000000003','ec390000-cccc-4000-8000-000000000001',
  'permanent@example.invalid','gmail','active_dwd','ok',null),
 ('ec390000-cccc-4000-8000-000000000004','ec390000-cccc-4000-8000-000000000001',
  'uncertain@example.invalid','gmail','active_dwd','ok',null);
do $probe$
declare
  t constant uuid:='ec390000-cccc-4000-8000-000000000001';
  a uuid; attempt uuid; c public.email_ingestion_checkpoints%rowtype;
  result jsonb; saved jsonb; n integer;
  safe_evidence constant jsonb:='{"persistence":"confirmed","message_upsert_count":0,
    "thread_upsert_count":0,"ids_seen":0,"gone_count":0,"unresolved_count":1,
    "classification":"fetch_failure","coverage_complete":false}'::jsonb;
  uncertain_evidence constant jsonb:='{"persistence":"unknown","message_upsert_count":null,
    "thread_upsert_count":null,"ids_seen":null,"gone_count":null,"unresolved_count":null,
    "classification":"fetch_failure","coverage_complete":false}'::jsonb;
begin
  for n in 1..3 loop
    a:='ec390000-cccc-4000-8000-000000000002'; attempt:=gen_random_uuid();
    insert into public.email_sync_runs(id,tenant_id,provider,sync_type,metadata)
    values(attempt,t,'gmail','workspace_messages',jsonb_build_object('email_account_id',a));
    select * into c from public.email_ingestion_checkpoints
      where tenant_id=t and email_account_id=a and stream='recent';
    result:=public.email_ingestion_transition_v2(t,a,'recent',attempt,gen_random_uuid(),
      'claim',c.generation,c.revision,c.owner_attempt_id,'{"recovery":null}'::jsonb);
    if result->>'disposition'<>'applied' or
      result#>>'{accepted_result,checkpoint_state}'<>'claimed'
    then raise exception 'retry_claim_failed'; end if;
    select * into c from public.email_ingestion_checkpoints
      where tenant_id=t and email_account_id=a and stream='recent';
    if n=1 then saved:=c.continuation; end if;
    result:=public.email_ingestion_transition_v2(t,a,'recent',attempt,gen_random_uuid(),
      'block',c.generation,c.revision,c.owner_attempt_id,
      jsonb_build_object('error_code','fetch_failed','attempt_evidence',safe_evidence));
    if result->>'disposition'<>'applied' or
      result#>>'{accepted_result,attempt_status}'<>'failed' or
      (n<3 and result#>>'{accepted_result,checkpoint_state}'<>'ready') or
      (n=3 and result#>>'{accepted_result,checkpoint_state}'<>'blocked')
    then raise exception 'bounded_retry_result_failed'; end if;
    select * into c from public.email_ingestion_checkpoints
      where tenant_id=t and email_account_id=a and stream='recent';
    if c.continuation is distinct from saved or c.owner_attempt_id is not null or
      (n<3 and c.block_code is not null) or
      (n=3 and c.block_code is distinct from 'fetch_failed') or
      not exists(select 1 from public.email_sync_runs r where r.id=attempt
        and r.status='failed' and r.error_message='fetch_failed' and r.records_processed=0) or
      not exists(select 1 from public.email_ingestion_transitions x
        where x.tenant_id=t and x.attempt_id=attempt and x.operation='block')
    then raise exception 'retry_preservation_failed'; end if;
  end loop;
  -- A permanently invalid delegation must still block on its first attempt.
  a:='ec390000-cccc-4000-8000-000000000003'; attempt:=gen_random_uuid();
  insert into public.email_sync_runs(id,tenant_id,provider,sync_type,metadata)
  values(attempt,t,'gmail','workspace_messages',jsonb_build_object('email_account_id',a));
  perform public.email_ingestion_transition_v2(t,a,'recent',attempt,gen_random_uuid(),
    'claim',null,null,null,'{"recovery":null}'::jsonb);
  select * into c from public.email_ingestion_checkpoints where tenant_id=t and email_account_id=a;
  result:=public.email_ingestion_transition_v2(t,a,'recent',attempt,gen_random_uuid(),
    'block',c.generation,c.revision,c.owner_attempt_id,
    jsonb_build_object('error_code','admin_delegation_missing','attempt_evidence',
      safe_evidence||'{"classification":"source_ineligible"}'::jsonb));
  if result#>>'{accepted_result,checkpoint_state}'<>'blocked'
    or result#>>'{current_checkpoint,block_code}'<>'admin_delegation_missing'
  then raise exception 'permanent_failure_was_retried'; end if;
  -- Unknown persistence cannot become an automatic retry.
  a:='ec390000-cccc-4000-8000-000000000004'; attempt:=gen_random_uuid();
  insert into public.email_sync_runs(id,tenant_id,provider,sync_type,metadata)
  values(attempt,t,'gmail','workspace_messages',jsonb_build_object('email_account_id',a));
  perform public.email_ingestion_transition_v2(t,a,'recent',attempt,gen_random_uuid(),
    'claim',null,null,null,'{"recovery":null}'::jsonb);
  select * into c from public.email_ingestion_checkpoints where tenant_id=t and email_account_id=a;
  result:=public.email_ingestion_transition_v2(t,a,'recent',attempt,gen_random_uuid(),
    'block',c.generation,c.revision,c.owner_attempt_id,
    jsonb_build_object('error_code','fetch_failed','attempt_evidence',uncertain_evidence));
  if result#>>'{accepted_result,checkpoint_state}'<>'blocked'
    or result#>>'{current_checkpoint,block_code}'<>'fetch_failed'
  then raise exception 'uncertain_failure_was_retried'; end if;
  if (select count(*) from public.email_ingestion_transitions where tenant_id=t)<>10
    or (select count(*) from public.email_sync_runs where tenant_id=t and status='failed')<>5
    or exists(select 1 from public.email_accounts where tenant_id=t and history_id is not null)
  then raise exception 'retry_probe_retention_failed'; end if;
end $probe$;
