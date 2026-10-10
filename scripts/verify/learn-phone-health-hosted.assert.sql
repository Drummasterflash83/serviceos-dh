-- Actual scheduled import to operator-evidence probe; no identity, credential or provider setup.
-- The release rolls this entire synthetic fixture back before checking preservation.
do $probe$ declare
 t uuid:=gen_random_uuid();a uuid:=gen_random_uuid();c uuid:=gen_random_uuid();other_account uuid:=gen_random_uuid();
 cr uuid:=gen_random_uuid();rr uuid:=gen_random_uuid();parent uuid:=gen_random_uuid();job uuid:=gen_random_uuid();
 evidence jsonb;processing jsonb;receipt jsonb;first_receipt jsonb;m jsonb;call_meta jsonb;rec_meta jsonb;owner text:='synthetic-schedule-owner';
 fm text:='2026-10-10T00:00:00.000Z';tm text:='2026-10-10T01:00:00.000Z';revision timestamptz;
 role_name text;denied boolean;outcome text;rows jsonb;recording_id uuid;
begin
 insert into public.tenants(id,slug,display_name,metadata) values(t,'phone-settlement-fixture-'||t,'Phone settlement rollback fixture','{"synthetic":true}');
 insert into public.tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled) values(c,t,'simwood','simwood','communications','active',true);
 insert into public.connector_accounts(id,tenant_id,tenant_connector_id,account_key,status,sync_cursor,last_successful_sync_at)
 values(a,t,c,'synthetic-phone','active','{"last_synced_until":"2026-10-10T00:15:00.000Z","retain":"other-progress"}','2026-10-10T00:15:00Z') returning updated_at into revision;
 call_meta:=jsonb_build_object('from',fm,'to',tm,'limit',null,'direction',null,'include_local',false);
 rec_meta:=jsonb_build_object('from',fm,'to',tm,'limit',null,'call_id',null,'linked_id',null);
 insert into public.phone_sync_runs(id,tenant_id,sync_type,metadata) values(cr,t,'calls',call_meta),(rr,t,'recordings',rec_meta);
 call_meta:=call_meta||'{"customer_id":"synthetic-phone","pages_fetched":1,"skipped_no_call_id":0,"window_complete":true}';
 rec_meta:=rec_meta||'{"customer_id":"synthetic-phone","pages_fetched":1,"skipped_no_recording_id":0,"window_complete":true}';
 foreach role_name in array array['anon','authenticated'] loop
  execute 'set local role '||quote_ident(role_name);denied:=false;
  begin perform public.learn_phone_complete_import(t,cr,a,c,'synthetic-phone','calls',1,1,call_meta);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Browser role completed an import';end if;
  denied:=false;
  begin perform public.learn_phone_settle_schedule(t,parent,cr,rr,'success','{}');exception when insufficient_privilege then denied:=true;end;
  execute 'reset role';
  if not denied then raise exception 'Browser role settled a scheduler run';end if;
 end loop;
 execute 'set local role service_role';
 rows:=jsonb_build_array(jsonb_build_object('tenant_id',t,'provider','simwood','provider_call_id','synthetic-call','raw_payload','{}'::jsonb));
 perform public.learn_phone_publish_page(t,cr,a,c,'synthetic-phone','calls',1,rows);
 first_receipt:=public.learn_phone_complete_import(t,cr,a,c,'synthetic-phone','calls',1,1,call_meta);
 assert first_receipt=public.learn_phone_complete_import(t,cr,a,c,'synthetic-phone','calls',1,1,call_meta);
 begin perform public.learn_phone_complete_import(t,cr,a,c,'synthetic-phone','calls',1,0,call_meta);raise exception 'Conflicting completion replay admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_completion_conflict';end;
 begin perform public.learn_phone_complete_import(gen_random_uuid(),cr,a,c,'synthetic-phone','calls',1,1,call_meta);raise exception 'Foreign tenant admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_completion_run_changed';end;
 rows:=jsonb_build_array(jsonb_build_object('tenant_id',t,'provider','simwood','provider_recording_id','synthetic-recording','raw_payload','{}'::jsonb));
 receipt:=public.learn_phone_publish_page(t,rr,a,c,'synthetic-phone','recordings',1,rows);
 recording_id:=(receipt->'newRecordingIds'->>0)::uuid;
 execute 'reset role';
 update public.phone_recordings set storage_path='synthetic-retained-audio.wav' where id=recording_id;
 execute 'set local role service_role';
 perform public.learn_phone_complete_import(t,rr,a,c,'synthetic-phone','recordings',1,1,rec_meta);
 execute 'reset role';
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,status,claimed_by,attempt_count,lease_expires_at,payload)
 values(job,t,'simwood','phone.scheduled_sync','running',owner,1,clock_timestamp()+interval '5 minutes',jsonb_build_object('provider_customer_id','synthetic-phone','from',fm,'to',tm));
 m:=jsonb_build_object('connector_account_id',a,'tenant_connector_id',c,'job_id',job,'job_owner',owner,
  'provider_customer_id','synthetic-phone','account_updated_at',revision,'include_local',false,'from',fm,'to',tm);
 insert into public.phone_sync_runs(id,tenant_id,sync_type,metadata) values(parent,t,'scheduled_sync',m);
 -- Every deliberate refusal uses a subtransaction; its fixture edits roll back.
 begin
  update public.platform_jobs set claimed_by='another-owner' where id=job;
  execute 'set local role service_role';perform public.learn_phone_settle_schedule(t,parent,cr,rr,'success','{}');
  raise exception 'Replaced owner admitted';
 exception when sqlstate 'PT409' then execute 'reset role';assert SQLERRM='phone_schedule_job_changed';end;
 begin
  update public.phone_sync_runs set metadata=metadata||jsonb_build_object('account_updated_at',revision-interval '1 second') where id=parent;
  execute 'set local role service_role';perform public.learn_phone_settle_schedule(t,parent,cr,rr,'success','{}');
  raise exception 'Stale account admitted';
 exception when sqlstate 'PT409' then execute 'reset role';assert SQLERRM='phone_schedule_account_changed';end;
 begin
  update public.phone_sync_runs set status='failed' where id=cr;
  execute 'set local role service_role';perform public.learn_phone_settle_schedule(t,parent,cr,rr,'success','{}');
  raise exception 'Unsuccessful child admitted';
 exception when sqlstate 'PT409' then execute 'reset role';assert SQLERRM='phone_schedule_child_unconfirmed';end;
 begin
  insert into public.feature_flags(tenant_id,flag,value) values(t,'learn.inputs.phone.enabled','false');
  execute 'set local role service_role';
  assert first_receipt=public.learn_phone_complete_import(t,cr,a,c,'synthetic-phone','calls',1,1,call_meta);
  perform public.learn_phone_settle_schedule(t,parent,cr,rr,'success','{}');raise exception 'Paused cursor admitted';
 exception when sqlstate 'PT409' then execute 'reset role';assert SQLERRM='learn_capture_paused';end;
 execute 'set local role service_role';
 receipt:=public.learn_phone_settle_schedule(t,parent,cr,rr,'success','{}');
 assert receipt=public.learn_phone_settle_schedule(t,parent,cr,rr,'success','{}');
 assert receipt->>'callsProcessed'='1' and receipt->>'recordingsProcessed'='1' and receipt->'cursorAdvanced'='true';
 execute 'reset role';
 assert(select status='success' and records_processed=2 from public.phone_sync_runs where id=parent);
 assert(select status='succeeded' and records_processed=2 and lease_expires_at is null from public.platform_jobs where id=job);
 assert(select sync_cursor->>'last_synced_until'=tm and sync_cursor->>'retain'='other-progress' from public.connector_accounts where id=a);
 assert(select health_status='healthy' from public.tenant_connectors where id=c);
 assert(select storage_path='synthetic-retained-audio.wav' from public.phone_recordings where id=recording_id);
 evidence:=public.learn_phone_account_evidence(t,a);
 processing:=public.learn_phone_processing_evidence(t);
 assert evidence->'latest_attempt'->'confirmed'='true'::jsonb and evidence->'last_confirmed'->>'id'=parent::text;
 assert evidence->'last_confirmed'->>'calls_processed'='1' and evidence->'last_confirmed'->>'recordings_processed'='1';
 assert evidence->'last_confirmed'->>'from'=fm and evidence->'last_confirmed'->>'to'=tm;
 assert processing->>'total'='1' and processing->>'complete'='0' and processing->>'transcribe_pending'='1';
 assert evidence::text not like '%synthetic-phone%' and processing::text not like '%synthetic-retained-audio%';
 begin
  update public.platform_jobs set payload=payload||'{"to":"2026-10-10T02:00:00.000Z"}' where id=job;
  evidence:=public.learn_phone_account_evidence(t,a);
  assert evidence->'latest_attempt'->'confirmed'='false'::jsonb and evidence->'last_confirmed'='null'::jsonb;
  raise exception 'rollback health mismatch probe';
 exception when raise_exception then assert SQLERRM='rollback health mismatch probe';end;
 begin
  update public.phone_sync_runs set metadata=metadata||'{"from":"2026-10-10T00:10:00.000Z"}' where id=parent;
  assert public.learn_phone_account_evidence(t,a)->'latest_attempt'->'confirmed'='false'::jsonb;
  raise exception 'rollback health mismatch probe';
 exception when raise_exception then assert SQLERRM='rollback health mismatch probe';end;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  assert not has_function_privilege(role_name,'public.learn_phone_account_evidence(uuid,uuid)','execute');
  assert not has_function_privilege(role_name,'public.learn_phone_processing_evidence(uuid)','execute');
 end loop;

 foreach outcome in array array['paused','failed'] loop
  parent:=gen_random_uuid();job:=gen_random_uuid();select updated_at into revision from public.connector_accounts where id=a;
  insert into public.platform_jobs(id,tenant_id,connector_id,job_type,status,claimed_by,attempt_count,lease_expires_at,payload)
   values(job,t,'simwood','phone.scheduled_sync','running',owner,1,clock_timestamp()+interval '5 minutes',jsonb_build_object('provider_customer_id','synthetic-phone','from',fm,'to',tm));
  m:=m||jsonb_build_object('job_id',job,'account_updated_at',revision);
  insert into public.phone_sync_runs(id,tenant_id,sync_type,metadata) values(parent,t,'scheduled_sync',m);
  execute 'set local role service_role';
  receipt:=public.learn_phone_settle_schedule(t,parent,cr,rr,outcome,jsonb_build_object('recordings',case when outcome='paused' then 'learn_capture_paused' else 'provider_unavailable' end));
  assert receipt->'cursorAdvanced'='false';
  execute 'reset role';
  assert(select status=outcome from public.phone_sync_runs where id=parent);
  assert(select status=case when outcome='paused' then 'cancelled' else 'failed' end and lease_expires_at is null from public.platform_jobs where id=job);
  assert(select sync_cursor->>'last_synced_until'=tm and sync_cursor->>'retain'='other-progress' from public.connector_accounts where id=a);
 end loop;
 assert(select health_status='warning' from public.tenant_connectors where id=c);
 foreach role_name in array array['anon','authenticated'] loop
  assert not has_table_privilege(role_name,'public.learn_phone_import_completions','select,insert,update,delete');
  assert not has_table_privilege(role_name,'public.learn_phone_schedule_settlements','select,insert,update,delete');
 end loop;
 assert not has_table_privilege('service_role','public.learn_phone_import_completions','insert,update,delete,truncate');
 assert not has_table_privilege('service_role','public.learn_phone_schedule_settlements','insert,update,delete,truncate');
 begin update public.learn_phone_import_completions set receipt='{}' where run_id=cr;raise exception 'Completion receipt overwritten';exception when sqlstate '55000' then null;end;
 begin update public.learn_phone_schedule_settlements set receipt='{}' where run_id=parent;raise exception 'Settlement receipt overwritten';exception when sqlstate '55000' then null;end;
end $probe$;
