-- Actual production tenant/reference constraints remain enabled.
-- Synthetic fixtures only, always in a caller-controlled rollback transaction.
insert into tenants(id,slug,display_name,status) values
('ed390000-aaaa-4000-8000-000000000001','card-draft-rehearsal','Synthetic card eligibility','active'),
('ed390000-aaaa-4000-8000-000000000009','card-draft-other','Synthetic other company','active');
insert into people(id,tenant_id,display_name,primary_email) values
('ed390000-aaaa-4000-8000-000000000002','ed390000-aaaa-4000-8000-000000000001','Synthetic contact','card-probe@example.org');
insert into people(id,tenant_id,display_name) values('ed390000-aaaa-4000-8000-000000000008','ed390000-aaaa-4000-8000-000000000009','Synthetic foreign contact');
insert into customer_cards(id,tenant_id,person_id,title,latest_activity_at,context) values
('ed390000-aaaa-4000-8000-000000000003','ed390000-aaaa-4000-8000-000000000001','ed390000-aaaa-4000-8000-000000000002','Retained card',statement_timestamp(),'{"manual_note":"keep"}');
insert into email_messages(id,tenant_id,provider,provider_message_id,direction,raw_payload)
 select ('ed390001-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ed390000-aaaa-4000-8000-000000000001','gmail','draft-probe-'||n,'outbound','{"label_ids":["DRAFT"]}'::jsonb from generate_series(1,110)n;
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,related_person_id,sentiment)
 select ('ed390002-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ed390000-aaaa-4000-8000-000000000001','email','email','email_messages',('ed390001-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'email_message','outbound',statement_timestamp()-interval '1 minute','ed390000-aaaa-4000-8000-000000000002','negative' from generate_series(1,110)n;
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,related_person_id)
 select ('ed390003-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ed390000-aaaa-4000-8000-000000000001','phone','phone','phone_calls',gen_random_uuid(),'phone_call','inbound',statement_timestamp()-interval '1 hour'-n*interval '1 minute','ed390000-aaaa-4000-8000-000000000002' from generate_series(1,105)n;
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,related_person_id)
 values('ed390004-aaaa-4000-8000-000000000001','ed390000-aaaa-4000-8000-000000000009','phone','phone','phone_calls',gen_random_uuid(),'phone_call','outbound',statement_timestamp(),'ed390000-aaaa-4000-8000-000000000008');
insert into recommendations(tenant_id,type,title,severity,status,card_id,interaction_id)
 values('ed390000-aaaa-4000-8000-000000000001','draft-rec','Draft-derived recommendation','critical','open','ed390000-aaaa-4000-8000-000000000003','ed390002-aaaa-4000-8000-000000000001');
insert into recommendations(tenant_id,type,title,severity,status,card_id,created_at)
 select 'ed390000-aaaa-4000-8000-000000000001','retained-'||n,'Retained recommendation',case when n=51 then 'critical' else 'info' end,'open','ed390000-aaaa-4000-8000-000000000003',statement_timestamp()-n*interval '1 minute' from generate_series(1,51)n;
set local role service_role;
do $$declare r jsonb;before_sources text;begin
 r:=public.learn_card_projection_inputs('ed390000-aaaa-4000-8000-000000000001','ed390000-aaaa-4000-8000-000000000003');
 assert r->>'version'='learn-card-inputs/1';
 assert jsonb_array_length(r->'interactions')=100;
 assert r->'coverage'->>'eligibleInteractions'='105';
 assert r->'coverage'->>'excludedDraftInteractions'='110';
 assert r->'coverage'->>'interactionsLast7'='105';
 assert not exists(select 1 from jsonb_array_elements(r->'interactions')x where x->>'direction'='outbound');
 assert jsonb_array_length(r->'recommendations')=50;
 assert r->'coverage'->>'eligibleRecommendations'='51';
 assert r->'coverage'->>'urgentRecommendations'='1';
 assert r->'coverage'->>'excludedDraftRecommendations'='1';
 assert not exists(select 1 from jsonb_array_elements(r->'recommendations')x where x->>'type'='draft-rec');
 begin
  perform public.learn_card_projection_inputs('ed390000-aaaa-4000-8000-000000000009','ed390000-aaaa-4000-8000-000000000003');
  raise exception 'Cross-tenant lookup succeeded';
 exception when sqlstate 'PT404' then null;end;
 assert not has_function_privilege('anon','public.learn_card_projection_inputs(uuid,uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','public.learn_card_projection_inputs(uuid,uuid)','EXECUTE');
end$$;
reset role;
