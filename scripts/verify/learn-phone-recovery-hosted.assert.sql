-- Synthetic service-path acceptance, entirely rolled back. No users, grants or provider calls.
begin;
set local lock_timeout='3s';set local statement_timeout='15s';set local search_path=public,pg_catalog;
do $$declare
 t uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
 cr uuid:=gen_random_uuid(); rr uuid:=gen_random_uuid(); rr2 uuid:=gen_random_uuid();
 rows jsonb; answer jsonb; first_receipt jsonb; rec uuid; denied boolean; role_name text;
begin
 if exists(select 1 from learn_phone_capture_pages) then raise exception 'Initial empty publication receipts required';end if;
 if has_table_privilege('authenticated','learn_phone_capture_pages','select,insert,update,delete')
 or has_table_privilege('service_role','learn_phone_capture_pages','insert,update,delete,truncate')
 or not (select relrowsecurity from pg_class where oid='learn_phone_capture_pages'::regclass) then raise exception 'Private receipt boundary changed';end if;
 insert into tenants(id,slug,display_name,metadata) values(t,'phone-publication-fixture-'||t,'Phone publication rollback fixture','{"synthetic":true}');
 insert into tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled) values(c,t,'simwood','simwood','communications','active',true);
 insert into connector_accounts(id,tenant_id,tenant_connector_id,account_key,status) values(a,t,c,'synthetic-phone','active');
 insert into phone_sync_runs(id,tenant_id,sync_type) values(cr,t,'calls'),(rr,t,'recordings'),(rr2,t,'recordings');
 rows:=jsonb_build_array(jsonb_build_object('tenant_id',t,'provider','simwood','provider_call_id','synthetic-call','raw_payload','{}'::jsonb));
 foreach role_name in array array['anon','authenticated'] loop
  execute 'set local role '||quote_ident(role_name);
  denied:=false;
  begin perform public.learn_phone_publish_page(t,cr,a,c,'synthetic-phone','calls',1,rows);
  exception when insufficient_privilege then denied:=true;end;
  execute 'reset role';
  if not denied then raise exception 'Browser role published a page';end if;
 end loop;
 execute 'set local role service_role';
 first_receipt:=public.learn_phone_publish_page(t,cr,a,c,'synthetic-phone','calls',1,rows);
 assert first_receipt->>'recordsProcessed'='1';
 assert first_receipt=public.learn_phone_publish_page(t,cr,a,c,'synthetic-phone','calls',1,rows);
 begin perform public.learn_phone_publish_page(t,cr,a,c,'synthetic-phone','calls',1,'[]');raise exception 'Conflicting replay admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_page_conflict';end;
 begin perform public.learn_phone_publish_page(t,cr,a,c,'synthetic-phone','calls',3,'[]');raise exception 'Skipped page admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_page_sequence_changed';end;
 begin perform public.learn_phone_publish_page(gen_random_uuid(),cr,a,c,'synthetic-phone','calls',1,'[]');raise exception 'Cross tenant admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_page_run_changed';end;
 execute 'reset role';
 insert into feature_flags(tenant_id,flag,value) values(t,'learn.inputs.phone.enabled','false');
 execute 'set local role service_role';
 begin perform public.learn_phone_publish_page(t,cr,a,c,'synthetic-phone','calls',2,'[]');raise exception 'Paused page admitted';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
 assert first_receipt=public.learn_phone_publish_page(t,cr,a,c,'synthetic-phone','calls',1,rows);
 execute 'reset role';
 update feature_flags set value='true' where tenant_id=t;
 update connector_accounts set status='disabled' where id=a;
 execute 'set local role service_role';
 begin perform public.learn_phone_publish_page(t,cr,a,c,'synthetic-phone','calls',2,'[]');raise exception 'Disabled account admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_account_unavailable';end;
 execute 'reset role';
 update connector_accounts set status='active' where id=a;
 rows:=jsonb_build_array(jsonb_build_object('tenant_id',t,'provider','simwood','provider_recording_id','synthetic-recording','raw_payload','{}'::jsonb));
 execute 'set local role service_role';
 answer:=public.learn_phone_publish_page(t,rr,a,c,'synthetic-phone','recordings',1,rows);
 assert jsonb_array_length(answer->'newRecordingIds')=1; rec:=(answer->'newRecordingIds'->>0)::uuid;
 execute 'reset role';
 update phone_recordings set storage_path='synthetic-retained-pointer.wav' where id=rec;
 execute 'set local role service_role';
 answer:=public.learn_phone_publish_page(t,rr2,a,c,'synthetic-phone','recordings',1,rows);
 assert answer->'newRecordingIds'='[]';
 execute 'reset role';
 assert (select storage_path from phone_recordings where id=rec)='synthetic-retained-pointer.wav';
 assert (select count(*) from phone_recordings where tenant_id=t)=1;
 -- A saved recording remains recoverable even if its import lost completion.
 update phone_sync_runs set status='failed',metadata='{"publication_unconfirmed":true}' where id=rr;
 execute 'set local role service_role';
 assert exists(select 1 from phone_select_pending(t,50,120) where id=rec and stage='transcribe');
 execute 'reset role';
 insert into phone_sync_runs(tenant_id,sync_type,status,started_at,metadata)
 select t,'pipeline','failed',now()-make_interval(mins=>n),
  jsonb_build_object('recording_id',rec,'failed_step','transcribe','error_code','provider_timeout')
 from generate_series(1,5)n;
 execute 'set local role service_role';
 assert (select retry_state from phone_pending_readiness(t) where recording_id=rec)='needs_review';
 assert not exists(select 1 from phone_select_pending(t,50,120) where id=rec);
 assert exists(select 1 from phone_recording_pipeline_state where id=rec and tenant_id=t and is_incomplete);
 assert not exists(select 1 from phone_select_pending(gen_random_uuid(),50,120) where id=rec);
 execute 'reset role';
 assert (select count(*) from phone_sync_runs where tenant_id=t and metadata->>'recording_id'=rec::text and status='failed')=5;
 -- A later bad record must roll back an earlier valid row in the same page.
 rows:=jsonb_build_array(
  jsonb_build_object('tenant_id',t,'provider','simwood','provider_call_id','a-rollback','raw_payload','{}'::jsonb),
  jsonb_build_object('tenant_id',t,'provider','simwood','provider_call_id','z-invalid','started_at','invalid-date','raw_payload','{}'::jsonb));
 execute 'set local role service_role';
 begin perform public.learn_phone_publish_page(t,cr,a,c,'synthetic-phone','calls',2,rows);raise exception 'Bad row accepted';exception when invalid_datetime_format then null;end;
 execute 'reset role';
 assert not exists(select 1 from phone_calls where tenant_id=t and provider_call_id='a-rollback');
 assert not exists(select 1 from learn_phone_capture_pages where run_id=cr and page=2);
 begin update learn_phone_capture_pages set receipt='{}' where run_id=cr;raise exception 'Receipt overwritten';exception when sqlstate '55000' then null;end;
 assert(select count(*) from learn_phone_capture_pages where tenant_id=t)=3;
end $$;
select 'learn-phone-recovery-hosted/1' as marker,true as interrupted_import_recovery,true as review_hold_preserves_backlog,true as retained_failure_history,true as service_publication,true as browser_denial,
 true as replay_and_sequence,true as pause_and_account_checks,true as recording_pointer_retained,
 true as page_rollback,true as immutable_receipts;
rollback;
