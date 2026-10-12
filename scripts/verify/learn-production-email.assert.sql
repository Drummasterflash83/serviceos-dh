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
