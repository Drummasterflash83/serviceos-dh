-- Synthetic full-schema source -> interaction -> customer card assertions, rolled back by caller.
insert into tenants(id,slug,display_name,status) values('ed380680-cccc-4000-8000-000000000001','email-draft-rollback','Synthetic draft rollback','active');
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,to_emails,cc_emails,direction,received_at,body_text,raw_payload) values
('ed380680-cccc-4000-8000-000000000002','ed380680-cccc-4000-8000-000000000001','gmail','draft-only','office@example.invalid','["customer@example.invalid"]','[]','outbound','2026-10-11T19:00:00Z','Retained synthetic draft','{"label_ids":["DRAFT"]}'),
('ed380680-cccc-4000-8000-000000000003','ed380680-cccc-4000-8000-000000000001','gmail','sent-separate-id','office@example.invalid','["customer@example.invalid"]','[]','outbound','2026-10-11T19:01:00Z','Sent synthetic message','{"label_ids":["SENT"]}');
do $$declare t uuid:='ed380680-cccc-4000-8000-000000000001';d uuid:='ed380680-cccc-4000-8000-000000000002';s uuid:='ed380680-cccc-4000-8000-000000000003';rev text;r jsonb;i uuid;v uuid;person uuid;before_source jsonb;begin
 select jsonb_agg(to_jsonb(m) order by id) into before_source from email_messages m where tenant_id=t;
 assert (select count(*) from learn_projection_pending(t,'email',50))=1;
 assert (select source_id from learn_projection_pending(t,'email',50))=s;
 select learn_projection_revision(learn_email_source_fields(m),'') into rev from email_messages m where id=d;
 r:=learn_project_interaction(t,gen_random_uuid(),'email',d,rev,'publish');
 assert r->>'state'='review_required' and r->>'reason'='email_draft' and r->'interactionId'='null';
 assert not exists(select 1 from interactions where tenant_id=t);
 select learn_projection_revision(learn_email_source_fields(m),'') into rev from email_messages m where id=s;
 r:=learn_project_interaction(t,gen_random_uuid(),'email',s,rev,'publish');
 assert r->>'state'='committed';i:=(r->>'interactionId')::uuid;
 select learn_identity_revision(x) into rev from interactions x where id=i;
 r:=learn_identity_deliver(t,gen_random_uuid(),i,rev,'publish');
 assert r->'cardEnriched'='true';
 assert (select count(*) from customer_cards where tenant_id=t)=1;
 -- Model a retained legacy draft interaction. It may not generate a second card.
 v:=gen_random_uuid();
 insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,from_address,to_addresses,processing_status)
 values(v,t,'email','email','email_messages',d,'email_message','outbound','2026-10-11T19:00:00Z','office@example.invalid',array['draft-only@example.invalid'],'ready');
 assert not exists(select 1 from learn_identity_pending(t,50) where interaction_id=v);
 select learn_identity_revision(x) into rev from interactions x where id=v;
 r:=learn_identity_deliver(t,gen_random_uuid(),v,rev,'publish');
 assert r->>'state'='review_required' and r->>'reason'='email_draft' and r->'cardEnriched'='false';
 select person_id into person from customer_cards where tenant_id=t;
 r:=learn_identity_review_state(t,v,person);
 assert r->'can_apply'='false' and r->>'blocked_reason'='email_draft';
 select learn_identity_revision(x) into rev from interactions x where id=v;
 r:=learn_identity_deliver_internal(t,gen_random_uuid(),v,rev,'publish',person);
 assert r->>'state'='review_required' and r->>'reason'='email_draft';
 assert (select count(*) from customer_cards where tenant_id=t)=1;
 assert learn_projection_review_count(t,'email')=0;
 assert learn_identity_review_count(t)=0;
 assert (select jsonb_agg(to_jsonb(m) order by id) from email_messages m where tenant_id=t)=before_source;
 assert exists(select 1 from interactions where id=v);
 assert not learn_interaction_is_draft(t,null,null),'An unbound non-email interaction became a draft';
 assert not learn_interaction_is_draft(gen_random_uuid(),'email_messages',d),'Cross-tenant draft lookup';
 -- Only the synthetic fixture is corrected; retained live sources remain unchanged.
 select learn_projection_revision(learn_email_source_fields(m),'') into rev from email_messages m where id=d;
 update email_messages set raw_payload='{"label_ids":["SENT"]}' where id=d;
 assert (select learn_projection_revision(learn_email_source_fields(m),'') from email_messages m where id=d)<>rev;
 assert exists(select 1 from learn_projection_pending(t,'email',50) where source_id=d);
 assert not has_function_privilege('authenticated','learn_interaction_is_draft(uuid,text,uuid)','EXECUTE');
 assert not has_function_privilege('anon','learn_interaction_is_draft(uuid,text,uuid)','EXECUTE');
 assert not has_function_privilege('service_role','learn_interaction_is_draft(uuid,text,uuid)','EXECUTE');
 assert has_function_privilege('learn_card_communication_reader','learn_interaction_is_draft(uuid,text,uuid)','EXECUTE');
end$$;
-- Exercise the actual lease-fenced page store, not only direct fixture inserts.
insert into email_accounts(id,tenant_id,provider,email_address,status) values('ed380680-cccc-4000-8000-000000000005','ed380680-cccc-4000-8000-000000000001','gmail','office@example.invalid','active_dwd');
insert into platform_jobs(id,tenant_id,job_type,job_key,connector_id,module_id,payload,status,claimed_by,attempt_count,lease_expires_at)
 values('ed380680-cccc-4000-8000-000000000006','ed380680-cccc-4000-8000-000000000001','email.workspace_sync','email.workspace_sync:ed380680-cccc-4000-8000-000000000005','google-workspace','communications.email','{"email_account_id":"ed380680-cccc-4000-8000-000000000005","max_results":25}','running','draft-storage-probe',1,clock_timestamp()+interval '5 minutes');
set local role service_role;
do $$declare t uuid:='ed380680-cccc-4000-8000-000000000001';a uuid:='ed380680-cccc-4000-8000-000000000005';attempt uuid;r jsonb;c jsonb;ctx jsonb;threads jsonb;messages jsonb;begin
 r:=learn_email_job_attempt(t,'ed380680-cccc-4000-8000-000000000006','draft-storage-probe',1);attempt:=(r->>'attempt_id')::uuid;
 r:=email_ingestion_transition_v2(t,a,'recent',attempt,gen_random_uuid(),'claim',null,null,null,'{"recovery":null}');c:=r->'current_checkpoint';
 r:=email_ingestion_transition_v2(t,a,'recent',attempt,gen_random_uuid(),'initialize_traversal',(c->>'generation')::uuid,(c->>'revision')::bigint,attempt,'{"captured_history_id":"100","captured_at":"2026-10-11T19:00:00.000Z","page_size":25,"query":null}');c:=r->'current_checkpoint';
 ctx:=jsonb_build_object('tenant_id',t,'email_account_id',a,'attempt_id',attempt,'stream','recent','generation',c->>'generation','revision',c->>'revision','mailbox','office@example.invalid','fetch_policy','missing_only');
 threads:=jsonb_build_array(jsonb_build_object('tenant_id',t,'provider','gmail','provider_thread_id','draft-storage-thread','subject','Synthetic unsent draft','participants','["office@example.invalid","draft-only@example.invalid"]'::jsonb,'last_message_at','2026-10-11T19:00:00Z','updated_at','2026-10-11T19:00:00Z'));
 messages:=jsonb_build_array(jsonb_build_object('tenant_id',t,'provider','gmail','provider_message_id','draft-storage-message','provider_thread_id','draft-storage-thread','from_email','office@example.invalid','from_name',null,'to_emails','["draft-only@example.invalid"]'::jsonb,'cc_emails','[]'::jsonb,'subject','Synthetic unsent draft','snippet',null,'body_text','Synthetic retained draft','body_html',null,'sent_at',null,'received_at','2026-10-11T19:00:00Z','direction','unknown','raw_payload','{"label_ids":["DRAFT"],"history_id":"100"}'::jsonb));
 r:=learn_email_store_page(ctx,threads,messages,'draft-storage-probe',1);
 assert r->>'message_upsert_count'='1';
 assert exists(select 1 from email_messages where tenant_id=t and provider_message_id='draft-storage-message' and direction='unknown' and sent_at is null and body_text='Synthetic retained draft');
 begin perform learn_email_store_page(ctx,threads,jsonb_set(messages,'{0,raw_payload,label_ids}','["SENT"]'),'draft-storage-probe',1);raise exception 'Unknown direction accepted without draft evidence';exception when invalid_parameter_value then assert sqlerrm='learn_email_store_message_invalid';end;
 begin perform learn_email_store_page(ctx,threads,jsonb_set(messages,'{0,sent_at}','"2026-10-11T19:00:00Z"'),'draft-storage-probe',1);raise exception 'Draft accepted as sent';exception when invalid_parameter_value then assert sqlerrm='learn_email_store_message_invalid';end;
end$$;
reset role;
