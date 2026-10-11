-- Called inside a single rollback transaction after the candidate migration.
insert into tenants(id,slug,display_name,status) values('ec370670-cccc-4000-8000-000000000001','email-coverage-rollback','Synthetic email coverage rollback','active');
insert into email_accounts(id,tenant_id,email_address,provider,status,auth_state,history_id)
 values('ec370670-cccc-4000-8000-000000000002','ec370670-cccc-4000-8000-000000000001','coverage@example.invalid','gmail','active_dwd','ok',null);
create function pg_temp.coverage_step(a uuid,op text,payload jsonb) returns jsonb language plpgsql as $$
declare c public.email_ingestion_checkpoints%rowtype;begin
 select * into c from public.email_ingestion_checkpoints where tenant_id='ec370670-cccc-4000-8000-000000000001' and email_account_id='ec370670-cccc-4000-8000-000000000002' and stream='recent';
 return public.email_ingestion_transition_v2('ec370670-cccc-4000-8000-000000000001','ec370670-cccc-4000-8000-000000000002','recent',a,gen_random_uuid(),op,c.generation,c.revision,c.owner_attempt_id,payload);
end$$;
do $$
declare a uuid:=gen_random_uuid();b uuid;result jsonb;old_cursor text;c public.email_ingestion_checkpoints%rowtype; frozen jsonb;bad boolean;
 boundary jsonb:='{"captured_history_id":"100","captured_at":"2026-10-11T19:30:00.000Z","page_size":25,"query":null}';
 page jsonb:='{"label":"ALL","expected_input_page_token":null,"returned_next_page_token":null,"exhausted":true,"page_evidence":{"persistence":"confirmed","message_upsert_count":0,"thread_upsert_count":0,"ids_seen":0,"gone_count":0,"unresolved_count":0},"yield_after_page":true}';
begin
 insert into email_sync_runs(id,tenant_id,provider,sync_type,metadata) values(a,'ec370670-cccc-4000-8000-000000000001','gmail','workspace_messages','{"email_account_id":"ec370670-cccc-4000-8000-000000000002"}');
 result:=pg_temp.coverage_step(a,'claim','{"recovery":null}');
 assert result->'accepted_result'->>'attempt_status'='running';
 result:=pg_temp.coverage_step(a,'initialize_traversal',boundary);
 select * into c from email_ingestion_checkpoints where email_account_id='ec370670-cccc-4000-8000-000000000002';
 assert c.continuation->>'version'='3' and c.continuation->>'mode'='reconcile' and c.continuation->'labels'='["ALL"]';
 assert (select history_id from email_accounts where id=c.email_account_id) is null;
 -- Wrong label cannot consume an ALL page or advance its cursor.
 result:=pg_temp.coverage_step(a,'checkpoint',jsonb_set(page,'{label}','"INBOX"'));
 assert result->>'code'='page_conflict' and result->'accepted_result'='null','Foreign page scope accepted';
 assert (select revision from email_ingestion_checkpoints where email_account_id=c.email_account_id)=c.revision;
 result:=pg_temp.coverage_step(a,'checkpoint',page||'{"returned_next_page_token":"page-two","exhausted":false}');
 assert result->'accepted_result'->>'coverage_complete'='false';
 assert (select history_id from email_accounts where id=c.email_account_id) is null;
 b:=gen_random_uuid();
 insert into email_sync_runs(id,tenant_id,provider,sync_type,metadata) values(b,'ec370670-cccc-4000-8000-000000000001','gmail','workspace_messages','{"email_account_id":"ec370670-cccc-4000-8000-000000000002"}');
 perform pg_temp.coverage_step(b,'claim','{"recovery":null}');
 result:=pg_temp.coverage_step(b,'checkpoint',page||'{"expected_input_page_token":"page-two"}');
 assert result->'accepted_result'->>'coverage_complete'='true';
 assert (select history_id from email_accounts where id=c.email_account_id)='100';
 -- Only now may a new generation use unfiltered history.
 a:=gen_random_uuid();
 insert into email_sync_runs(id,tenant_id,provider,sync_type,metadata) values(a,'ec370670-cccc-4000-8000-000000000001','gmail','workspace_messages','{"email_account_id":"ec370670-cccc-4000-8000-000000000002"}');
 perform pg_temp.coverage_step(a,'claim','{"recovery":null}');
 perform pg_temp.coverage_step(a,'initialize_traversal',boundary||'{"captured_history_id":"200"}');
 select * into c from email_ingestion_checkpoints where email_account_id='ec370670-cccc-4000-8000-000000000002';
 assert c.continuation->>'mode'='history' and c.continuation->>'origin_history_id'='100';
 perform pg_temp.coverage_step(a,'checkpoint',page);
 assert (select history_id from email_accounts where id=c.email_account_id)='200';
 -- No client permissions or function owner change is part of this upgrade.
 assert not has_function_privilege('authenticated','public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)','EXECUTE');
 assert (select pg_get_userbyid(proowner) from pg_proc where oid='public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure)='email_ingestion_protocol_owner';
end$$;
