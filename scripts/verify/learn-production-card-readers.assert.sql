-- Actual production Auth/profile/source policies; every fixture remains offline.
create function pg_temp.cr(n int) returns uuid language sql immutable as $$select ('ce120000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.cr(int) to authenticated,anon,service_role;
insert into tenants(id,slug,display_name) values(pg_temp.cr(1),'card-reader-a','Synthetic A'),(pg_temp.cr(2),'card-reader-b','Synthetic B');
insert into auth.users(id,email,banned_until) values(pg_temp.cr(10),'card-reader-owner-a@example.invalid','infinity'),(pg_temp.cr(11),'card-reader-owner-b@example.invalid','infinity');
update profiles set tenant_id=pg_temp.cr(case when id=pg_temp.cr(10) then 1 else 2 end),role='owner' where id in(pg_temp.cr(10),pg_temp.cr(11));
insert into companies(id,tenant_id,name) values(pg_temp.cr(20),pg_temp.cr(1),'Synthetic first company'),(pg_temp.cr(21),pg_temp.cr(2),'Synthetic foreign company');
insert into customer_cards(id,tenant_id,company_id,title) values(pg_temp.cr(22),pg_temp.cr(1),pg_temp.cr(20),'Synthetic card');
insert into email_messages(id,tenant_id,provider,provider_message_id,subject,snippet,body_text,raw_payload)
 values(pg_temp.cr(30),pg_temp.cr(1),'gmail','reader-sent',repeat('S',4500),'Retained excerpt','PRIVATE_BODY','{"label_ids":["SENT"],"private":"PRIVATE_PAYLOAD"}'),
 (pg_temp.cr(31),pg_temp.cr(1),'gmail','reader-draft','Draft','Draft preview','PRIVATE_DRAFT','{"label_ids":["DRAFT"]}'),
 (pg_temp.cr(32),pg_temp.cr(2),'gmail','reader-foreign','FOREIGN_SUBJECT','FOREIGN_SNIPPET','PRIVATE_FOREIGN','{}');
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,occurred_at,related_company_id,body_preview,metadata)
 select pg_temp.cr(100+n),pg_temp.cr(1),'gmail','email','email_messages',case when n=1 then pg_temp.cr(30) else gen_random_uuid() end,'email_message',now()-n*interval '1 second',pg_temp.cr(20),repeat('X',4500),'{"private":"PRIVATE_METADATA"}' from generate_series(1,55)n;
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,occurred_at,related_company_id,body_preview,status)
 values(pg_temp.cr(200),pg_temp.cr(1),'gmail','email','email_messages',pg_temp.cr(31),'email_message',now(),pg_temp.cr(20),'DRAFT_CANARY','active'),
 (pg_temp.cr(201),pg_temp.cr(1),'gmail','email','email_messages',gen_random_uuid(),'email_message',now(),pg_temp.cr(20),'DELETED_CANARY','deleted'),
 (pg_temp.cr(202),pg_temp.cr(2),'gmail','email','email_messages',pg_temp.cr(32),'email_message',now(),pg_temp.cr(21),'FOREIGN_CANARY','active');
insert into phone_calls(id,tenant_id,provider,provider_call_id,raw_payload) values(pg_temp.cr(40),pg_temp.cr(1),'simwood','reader-call','{"private":"PRIVATE_RAW"}');
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,storage_path,recording_uri) values(pg_temp.cr(41),pg_temp.cr(1),'simwood','reader-recording','PRIVATE_STORAGE','PRIVATE_URI');
create temp table reader_sources as select jsonb_build_object('emails',(select jsonb_agg(to_jsonb(m) order by id) from email_messages m where tenant_id in(pg_temp.cr(1),pg_temp.cr(2))),'interactions',(select jsonb_agg(to_jsonb(i) order by id) from interactions i where tenant_id in(pg_temp.cr(1),pg_temp.cr(2)))) as before;
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='ce120000-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare r jsonb;begin
 r:=learn_card_communications_read(pg_temp.cr(1),p_company=>pg_temp.cr(20));
 assert jsonb_array_length(r->'rows')=51;
 assert r::text not like '%PRIVATE%' and r::text not like '%DRAFT_CANARY%' and r::text not like '%FOREIGN_CANARY%' and r::text not like '%DELETED_CANARY%';
 assert (r->'rows'->0->>'id')=pg_temp.cr(101)::text and length(r->'rows'->0->>'body_preview')=4021;
 assert jsonb_array_length(learn_card_communications_read(pg_temp.cr(1),p_ids=>array[pg_temp.cr(101),pg_temp.cr(202)])->'rows')=1;
 begin perform learn_card_communications_read(pg_temp.cr(2),p_company=>pg_temp.cr(21));raise exception 'Foreign company admitted';exception when insufficient_privilege then null;end;
 begin perform learn_card_communications_read(pg_temp.cr(1));raise exception 'Unbounded read admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_card_communications_read(pg_temp.cr(1),p_ids=>array_fill(pg_temp.cr(101),array[51]));raise exception 'Oversize read admitted';exception when invalid_parameter_value then null;end;
 r:=learn_card_source_read(pg_temp.cr(1),'email_messages',pg_temp.cr(30));
 assert length(r->'record'->>'subject')=4021 and r::text not like '%PRIVATE%';
 assert learn_card_source_read(pg_temp.cr(1),'email_messages',pg_temp.cr(32))->'record'='null';
 assert learn_card_source_read(pg_temp.cr(1),'phone_calls',pg_temp.cr(40))::text not like '%PRIVATE%';
 assert learn_card_source_read(pg_temp.cr(1),'phone_recordings',pg_temp.cr(41))::text not like '%PRIVATE%';
 begin perform learn_card_source_read(pg_temp.cr(1),'email_oauth_tokens',pg_temp.cr(30));raise exception 'Unsupported source exposed';exception when invalid_parameter_value then null;end;
end$$;reset role;
update profiles set role='viewer' where id=pg_temp.cr(10);
set local role authenticated;
do $$begin
 begin perform learn_card_communications_read(pg_temp.cr(1),p_company=>pg_temp.cr(20));raise exception 'Demoted reader admitted';exception when insufficient_privilege then null;end;
 begin perform learn_card_source_read(pg_temp.cr(1),'email_messages',pg_temp.cr(30));raise exception 'Demoted source reader admitted';exception when insufficient_privilege then null;end;
end$$;reset role;
update profiles set role='admin' where id=pg_temp.cr(10);
set local role authenticated;
do $$begin assert jsonb_array_length(learn_card_communications_read(pg_temp.cr(1),p_company=>pg_temp.cr(20))->'rows')=51;end$$;reset role;
set local request.jwt.claim.sub='ce120000-aaaa-4000-8000-000000000011';set local role authenticated;
do $$begin
 assert jsonb_array_length(learn_card_communications_read(pg_temp.cr(2),p_ids=>array[pg_temp.cr(101),pg_temp.cr(202)])->'rows')=1;
 assert learn_card_source_read(pg_temp.cr(2),'email_messages',pg_temp.cr(30))->'record'='null';
end$$;reset role;
do $$declare r text;begin
 foreach r in array array['anon','service_role'] loop
  assert not has_function_privilege(r,'learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[])','execute');
  assert not has_function_privilege(r,'learn_card_source_read(uuid,text,uuid)','execute');
 end loop;
 assert (select before from reader_sources)=jsonb_build_object('emails',(select jsonb_agg(to_jsonb(m) order by id) from email_messages m where tenant_id in(pg_temp.cr(1),pg_temp.cr(2))),'interactions',(select jsonb_agg(to_jsonb(i) order by id) from interactions i where tenant_id in(pg_temp.cr(1),pg_temp.cr(2))));
end$$;
