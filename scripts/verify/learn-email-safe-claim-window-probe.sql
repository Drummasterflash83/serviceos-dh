-- Append after learn-email-safe-claim-probe.sql inside the same rollback.
-- Three confirmed failures originally in one two-hour window must remain
-- blocked after the window ages out; a fresh claim must not revive them.
set local role email_ingestion_protocol_owner;
update public.email_sync_runs set completed_at=clock_timestamp()-interval '6 hours'
where id='ec393000-cccc-4000-8000-000000000005';
reset role;
insert into public.email_sync_runs(id,tenant_id,provider,sync_type,metadata) values
 ('ec393000-cccc-4000-8000-000000000011',
  'ec393000-cccc-4000-8000-000000000001','gmail','workspace_messages',
  '{"email_account_id":"ec393000-cccc-4000-8000-000000000004"}'::jsonb),
 ('ec393000-cccc-4000-8000-000000000012',
  'ec393000-cccc-4000-8000-000000000001','gmail','workspace_messages',
  '{"email_account_id":"ec393000-cccc-4000-8000-000000000004"}'::jsonb),
 ('ec393000-cccc-4000-8000-000000000013',
  'ec393000-cccc-4000-8000-000000000001','gmail','workspace_messages',
  '{"email_account_id":"ec393000-cccc-4000-8000-000000000004"}'::jsonb);
do $triples$
declare t constant uuid:='ec393000-cccc-4000-8000-000000000001';
 a constant uuid:='ec393000-cccc-4000-8000-000000000004';
 run uuid;c public.email_ingestion_checkpoints%rowtype;result jsonb;n integer;
begin
 for n in 11..13 loop
  run:=('ec393000-cccc-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  select * into c from public.email_ingestion_checkpoints
    where tenant_id=t and email_account_id=a and stream='recent';
  result:=public.email_ingestion_transition_v2(t,a,'recent',run,gen_random_uuid(),
    'claim',c.generation,c.revision,null,'{"recovery":null}'::jsonb);
  if result#>>'{accepted_result,checkpoint_state}'<>'claimed'
  then raise exception 'three_failure_fixture_claim_failed'; end if;
  select * into c from public.email_ingestion_checkpoints
    where tenant_id=t and email_account_id=a and stream='recent';
  result:=public.email_ingestion_transition_v2(t,a,'recent',run,gen_random_uuid(),
    'block',c.generation,c.revision,c.owner_attempt_id,
    '{"error_code":"fetch_failed","attempt_evidence":{"persistence":"confirmed",
     "message_upsert_count":0,"thread_upsert_count":0,"ids_seen":0,"gone_count":0,
     "unresolved_count":1,"classification":"fetch_failure","coverage_complete":false}}'::jsonb);
  if result#>>'{accepted_result,checkpoint_state}'<>
    (case when n=13 then 'blocked' else 'ready' end)
  then raise exception 'three_failure_fixture_boundary_changed'; end if;
 end loop;
end $triples$;
set local role email_ingestion_protocol_owner;
update public.email_sync_runs set completed_at=clock_timestamp()-interval '3 hours'
where id in('ec393000-cccc-4000-8000-000000000011',
 'ec393000-cccc-4000-8000-000000000012',
 'ec393000-cccc-4000-8000-000000000013');
update public.email_ingestion_checkpoints
 set updated_at=(select completed_at from public.email_sync_runs
   where id='ec393000-cccc-4000-8000-000000000013')
where tenant_id='ec393000-cccc-4000-8000-000000000001'
 and email_account_id='ec393000-cccc-4000-8000-000000000004' and stream='recent';
reset role;
insert into public.email_sync_runs(id,tenant_id,provider,sync_type,metadata)
values('ec393000-cccc-4000-8000-000000000014',
 'ec393000-cccc-4000-8000-000000000001','gmail','workspace_messages',
 '{"email_account_id":"ec393000-cccc-4000-8000-000000000004"}'::jsonb);
do $still_blocked$
declare t constant uuid:='ec393000-cccc-4000-8000-000000000001';
 a constant uuid:='ec393000-cccc-4000-8000-000000000004';
 c public.email_ingestion_checkpoints%rowtype;result jsonb;
begin
 select * into c from public.email_ingestion_checkpoints
   where tenant_id=t and email_account_id=a and stream='recent';
 if c.state<>'blocked' or c.block_code<>'fetch_failed'
 then raise exception 'third_failure_fixture_not_blocked'; end if;
 result:=public.email_ingestion_transition_v2(t,a,'recent',
   'ec393000-cccc-4000-8000-000000000014',gen_random_uuid(),
   'claim',c.generation,c.revision,null,'{"recovery":null}'::jsonb);
 if result->>'disposition'<>'conflict' or
    result->>'code'<>'explicit_recovery_required' or
    (select state from public.email_ingestion_checkpoints
     where tenant_id=t and email_account_id=a and stream='recent')<>'blocked'
 then raise exception 'aged_third_failure_auto_resumed'; end if;
end $still_blocked$;
