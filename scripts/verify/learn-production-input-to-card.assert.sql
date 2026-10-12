-- Integrated synthetic journey: actual v4 email storage, Phone handoff, queued identity and owner card reads.
-- Offline synthetic capture/storage acceptance; caller rolls back.
insert into tenants(id,slug,display_name,status) values('ec400700-cccc-4000-8000-000000000001','email-storage-offline','Synthetic email storage','active');
-- Exercise the actual lease-fenced page store, not only direct fixture inserts.
insert into email_accounts(id,tenant_id,provider,email_address,status) values('ec400700-cccc-4000-8000-000000000005','ec400700-cccc-4000-8000-000000000001','gmail','office@example.invalid','active_dwd');
insert into platform_jobs(id,tenant_id,job_type,job_key,connector_id,module_id,payload,status,claimed_by,attempt_count,lease_expires_at)
 values('ec400700-cccc-4000-8000-000000000006','ec400700-cccc-4000-8000-000000000001','email.workspace_sync','email.workspace_sync:ec400700-cccc-4000-8000-000000000005','google-workspace','communications.email','{"email_account_id":"ec400700-cccc-4000-8000-000000000005","max_results":25}','running','draft-storage-probe',1,clock_timestamp()+interval '5 minutes');
set local role service_role;
do $$declare t uuid:='ec400700-cccc-4000-8000-000000000001';a uuid:='ec400700-cccc-4000-8000-000000000005';attempt uuid;r jsonb;c jsonb;ctx jsonb;threads jsonb;messages jsonb;begin
 r:=learn_email_job_attempt(t,'ec400700-cccc-4000-8000-000000000006','draft-storage-probe',1);attempt:=(r->>'attempt_id')::uuid;
 r:=email_ingestion_transition_v2(t,a,'recent',attempt,gen_random_uuid(),'claim',null,null,null,'{"recovery":null}');c:=r->'current_checkpoint';
 r:=email_ingestion_transition_v2(t,a,'recent',attempt,gen_random_uuid(),'initialize_traversal',(c->>'generation')::uuid,(c->>'revision')::bigint,attempt,'{"captured_history_id":"100","captured_at":"2026-10-11T19:00:00.000Z","page_size":25,"query":null}');c:=r->'current_checkpoint';
 ctx:=jsonb_build_object('tenant_id',t,'email_account_id',a,'attempt_id',attempt,'stream','recent','generation',c->>'generation','revision',c->>'revision','mailbox','office@example.invalid','fetch_policy','refetch_all');
 threads:=jsonb_build_array(jsonb_build_object('tenant_id',t,'provider','gmail','provider_thread_id','draft-storage-thread','subject','Synthetic unsent draft','participants','["office@example.invalid","draft-only@example.invalid"]'::jsonb,'last_message_at','2026-10-11T19:00:00Z','updated_at','2026-10-11T19:00:00Z'));
 messages:=jsonb_build_array(jsonb_build_object('tenant_id',t,'provider','gmail','provider_message_id','draft-storage-message','provider_thread_id','draft-storage-thread','from_email','office@example.invalid','from_name',null,'to_emails','["draft-only@example.invalid"]'::jsonb,'cc_emails','[]'::jsonb,'subject','Synthetic unsent draft','snippet',null,'body_text','Synthetic retained draft','body_html',null,'sent_at',null,'received_at','2026-10-11T19:00:00Z','direction','unknown','raw_payload','{"label_ids":["DRAFT"],"history_id":"100"}'::jsonb));
 r:=learn_email_store_page(ctx,threads,messages,'draft-storage-probe',1);
 assert r->>'message_upsert_count'='1';
 assert exists(select 1 from email_messages where tenant_id=t and provider_message_id='draft-storage-message' and direction='unknown' and sent_at is null and body_text='Synthetic retained draft');
 begin perform learn_email_store_page(ctx,threads,jsonb_set(messages,'{0,raw_payload,label_ids}','["SENT"]'),'draft-storage-probe',1);raise exception 'Unknown direction accepted without draft evidence';exception when invalid_parameter_value then assert sqlerrm='learn_email_store_message_invalid';end;
 begin perform learn_email_store_page(ctx,threads,jsonb_set(messages,'{0,sent_at}','"2026-10-11T19:00:00Z"'),'draft-storage-probe',1);raise exception 'Draft accepted as sent';exception when invalid_parameter_value then assert sqlerrm='learn_email_store_message_invalid';end;
 -- A confirmed provider absence retains the draft body and source ID.
 r:=learn_email_store_unavailable(ctx,'["draft-storage-message"]','draft-storage-probe',1);
 assert r->>'observed_count'='1';
 assert exists(select 1 from email_messages where tenant_id=t and provider_message_id='draft-storage-message' and body_text='Synthetic retained draft' and raw_payload->>'provider_availability'='unavailable');
 -- A newer fetched SENT state updates classification while retaining both older versions.
 messages:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(messages,'{0,raw_payload,label_ids}','["SENT"]'),'{0,raw_payload,history_id}','"101"'),'{0,direction}','"outbound"'),'{0,sent_at}','"2026-10-11T19:01:00Z"');
 messages:=jsonb_set(messages,'{0,body_text}','"Synthetic sent revision"');
 r:=learn_email_store_page(ctx,threads,messages,'draft-storage-probe',1);
 assert r->>'message_upsert_count'='1';
 assert exists(select 1 from email_messages where tenant_id=t and provider_message_id='draft-storage-message' and direction='outbound' and raw_payload->>'provider_availability'='available' and raw_payload->'label_ids'='["SENT"]'::jsonb);
 -- An older boundary cannot re-mark a newer source as unavailable.
 r:=learn_email_store_unavailable(ctx,'["draft-storage-message"]','draft-storage-probe',1);
 assert r->>'observed_count'='0';
 r:=learn_email_store_page(ctx,threads,messages,'draft-storage-probe',1);
 begin perform learn_email_store_page(ctx,threads,messages,'foreign-worker',1);raise exception 'Foreign worker stored a page';exception when sqlstate 'PT409' then assert sqlerrm='learn_email_job_not_owned';end;
 begin perform learn_email_store_page(jsonb_set(ctx,'{tenant_id}',to_jsonb(gen_random_uuid()::text)),threads,messages,'draft-storage-probe',1);raise exception 'Foreign tenant stored a page';exception when sqlstate 'PT409' then assert sqlerrm='learn_email_store_account_mismatch';end;
 begin update email_accounts set history_id='999' where id=a;raise exception 'Direct progress mutation accepted';exception when insufficient_privilege then assert sqlerrm='email_progress_requires_protocol';end;
 begin update email_sync_runs set status='success' where id=attempt;raise exception 'Direct attempt completion accepted';exception when insufficient_privilege then assert sqlerrm='email_attempt_requires_protocol';end;
end$$;
reset role;
do $$declare message_id uuid;begin
 select id into strict message_id from public.email_messages where tenant_id='ec400700-cccc-4000-8000-000000000001' and provider_message_id='draft-storage-message';
 assert (select count(*) from public.learn_email_source_versions where email_message_id=message_id)=2;
 assert (select count(*) from public.learn_email_source_versions where email_message_id=message_id and source_row->>'body_text'='Synthetic retained draft')=2;
 assert not has_table_privilege('authenticated','public.learn_email_source_versions','SELECT');
 assert not has_table_privilege('service_role','public.learn_email_source_versions','SELECT');
 assert not has_function_privilege('authenticated','public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)','EXECUTE');
 assert not has_table_privilege('email_ingestion_protocol_owner','public.email_oauth_tokens','SELECT');
 assert not has_column_privilege('email_ingestion_protocol_owner','public.email_accounts','email_address','UPDATE');
 assert not has_table_privilege('email_ingestion_protocol_owner','public.email_messages','SELECT');
end$$;
create function pg_temp.ic(n int) returns uuid language sql immutable as $$select ('ec411200-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.ic(int) to authenticated,service_role;
insert into auth.users(id,email,banned_until) values(pg_temp.ic(10),'input-card-owner@example.invalid','infinity');
update profiles set tenant_id='ec400700-cccc-4000-8000-000000000001',role='owner' where id=pg_temp.ic(10);
-- Synthetic retained Phone rows carry exact provenance, never a real recording.
insert into phone_calls(id,tenant_id,provider,provider_call_id,direction,from_number,to_number,started_at)
 values(pg_temp.ic(20),'ec400700-cccc-4000-8000-000000000001','simwood','input-card-call','IN','+441632960100','+441632960101','2026-10-11T19:02:00Z');
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,provider_call_id,storage_path)
 values(pg_temp.ic(21),'ec400700-cccc-4000-8000-000000000001','simwood','input-card-audio','input-card-call','ec400700-cccc-4000-8000-000000000001/synthetic.wav');
insert into phone_transcripts(id,tenant_id,recording_id,status,transcript_text,source_storage_path,source_sha256)
 values(pg_temp.ic(22),'ec400700-cccc-4000-8000-000000000001',pg_temp.ic(21),'completed','Synthetic retained transcript','ec400700-cccc-4000-8000-000000000001/synthetic.wav',repeat('b',64));
insert into phone_ai_insights(id,tenant_id,recording_id,transcript_id,summary,source_transcript_sha256)
 values(pg_temp.ic(23),'ec400700-cccc-4000-8000-000000000001',pg_temp.ic(21),pg_temp.ic(22),'Synthetic call needs follow-up',encode(sha256(convert_to('Synthetic retained transcript','UTF8')),'hex'));
insert into phone_sync_runs(id,tenant_id,provider,sync_type,status,metadata)
 values(pg_temp.ic(24),'ec400700-cccc-4000-8000-000000000001','pipeline','pipeline','running',jsonb_build_object('recording_id',pg_temp.ic(21)));
create temp table input_card_sources as select jsonb_build_object('mail',(select jsonb_agg(to_jsonb(m) order by id) from email_messages m where tenant_id='ec400700-cccc-4000-8000-000000000001'),'recording',(select to_jsonb(r) from phone_recordings r where id=pg_temp.ic(21)),'transcript',(select to_jsonb(t) from phone_transcripts t where id=pg_temp.ic(22))) as before;
insert into platform_jobs(id,tenant_id,job_type,job_key,status,claimed_by,attempt_count,max_attempts,lease_expires_at,payload)
 select pg_temp.ic(n),'ec400700-cccc-4000-8000-000000000001',case when n=30 then 'interactions.sync' else 'identity.resolve' end,'integrated-input-card-'||n,'running','integrated-worker',1,3,clock_timestamp()+interval '5 minutes',case when n=30 then '{"source":"email","limit":1}'::jsonb else '{"limit":1}'::jsonb end from generate_series(30,32)n;
do $$declare tenant uuid:='ec400700-cccc-4000-8000-000000000001';source uuid;rev text;i uuid;r jsonb;first jsonb;n int;begin
 select id,learn_projection_revision(learn_email_source_fields(m),'') into source,rev from email_messages m where tenant_id=tenant and provider_message_id='draft-storage-message';
 execute 'set local role service_role';
 r:=learn_processing_publish(tenant,pg_temp.ic(30),'integrated-worker',1,pg_temp.ic(40),'email',source,rev,'publish');
 assert r->>'state'='committed';i:=(r->>'interactionId')::uuid;
 assert r=learn_processing_publish(tenant,pg_temp.ic(30),'integrated-worker',1,pg_temp.ic(40),'email',source,rev,'inspect');
 perform learn_processing_settle(tenant,pg_temp.ic(30),'integrated-worker',1,pg_temp.ic(50),'{"success":true,"records_processed":1,"result":{"interactions_upserted":1,"failed":0,"review_required":0,"continued":false},"continue":false,"retryable":false,"error_code":null}','settle');
 execute 'reset role';
 select learn_identity_revision(x) into rev from interactions x where id=i;
 execute 'set local role service_role';
 r:=learn_processing_publish(tenant,pg_temp.ic(31),'integrated-worker',1,pg_temp.ic(41),'identity',i,rev,'publish');
 assert r->>'state'='committed' and r->'cardEnriched'='true';
 perform learn_processing_settle(tenant,pg_temp.ic(31),'integrated-worker',1,pg_temp.ic(51),'{"success":true,"records_processed":1,"result":{"resolved":1,"review_required":0,"failed":0,"continued":false},"continue":false,"retryable":false,"error_code":null}','settle');
 r:=learn_phone_handoff(tenant,pg_temp.ic(24),pg_temp.ic(21),pg_temp.ic(22),pg_temp.ic(23),'publish');
 assert r->>'state'='committed';i:=(r->>'interactionId')::uuid;
 execute 'reset role';
 select learn_identity_revision(x) into rev from interactions x where id=i;
 execute 'set local role service_role';
 r:=learn_processing_publish(tenant,pg_temp.ic(32),'integrated-worker',1,pg_temp.ic(42),'identity',i,rev,'publish');
 assert r->>'state'='committed' and r->'cardEnriched'='true';first:=r;
 assert learn_processing_publish(tenant,pg_temp.ic(32),'integrated-worker',1,pg_temp.ic(42),'identity',i,rev,'publish')=first;
 perform learn_processing_settle(tenant,pg_temp.ic(32),'integrated-worker',1,pg_temp.ic(52),'{"success":true,"records_processed":1,"result":{"resolved":1,"review_required":0,"failed":0,"continued":false},"continue":false,"retryable":false,"error_code":null}','settle');
 execute 'reset role';
 assert (select count(*) from customer_cards where tenant_id=tenant)=2;
 assert (select count(*) from interactions where tenant_id=tenant and processing_status='enriched')=2;
 assert (select count(*) from platform_jobs where id in(pg_temp.ic(30),pg_temp.ic(31),pg_temp.ic(32)) and status='succeeded')=3;
 assert not exists(select 1 from platform_events where tenant_id=tenant and event_type='interaction.ready' and status='pending');
end$$;
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='ec411200-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare c record;r jsonb;begin
 for c in select * from customer_cards where tenant_id='ec400700-cccc-4000-8000-000000000001' loop
  r:=learn_card_communications_read(c.tenant_id,p_person=>c.person_id);
  assert jsonb_array_length(r->'rows')=1;
  assert r->'rows'->0->>'source_table' in('email_messages','phone_calls');
  assert learn_card_source_read(c.tenant_id,r->'rows'->0->>'source_table',(r->'rows'->0->>'source_id')::uuid)->'record'<>'null';
 end loop;
end$$;reset role;
do $$begin
 assert (select before from input_card_sources)=jsonb_build_object('mail',(select jsonb_agg(to_jsonb(m) order by id) from email_messages m where tenant_id='ec400700-cccc-4000-8000-000000000001'),'recording',(select to_jsonb(r) from phone_recordings r where id=pg_temp.ic(21)),'transcript',(select to_jsonb(t) from phone_transcripts t where id=pg_temp.ic(22)));
end$$;
