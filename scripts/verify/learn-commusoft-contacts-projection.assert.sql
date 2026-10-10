-- Synthetic sources in a disposable reproduction of the observed TEST schema.
-- The separate ingestion acceptance covers the source publisher; this targets projection.
create function fixture_id(n integer) returns uuid language sql immutable as $$select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into tenants(id,slug,display_name,status) values(fixture_id(1),'contact-projection','Synthetic contact projection','active'),(fixture_id(2),'contact-foreign','Synthetic foreign company','active');
insert into auth.users(id,email) values(fixture_id(80),'contact-owner@example.invalid'),(fixture_id(81),'contact-viewer@example.invalid');
insert into profiles(id,tenant_id,role) values(fixture_id(80),fixture_id(1),'owner'),(fixture_id(81),fixture_id(1),'viewer');
insert into feature_flags(tenant_id,flag,value) values(fixture_id(1),'learn.enabled','true'),(fixture_id(1),'learn.inputs.commusoft.enabled','true');
insert into tenant_connectors(tenant_id,provider,connector_id,category,enabled,status) values(fixture_id(1),'commusoft','commusoft','customer_system',true,'active');
insert into provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,non_secret_config) values(fixture_id(5),fixture_id(1),'commusoft','configured','private_api_key',clock_timestamp(),'{"region":"uk","account_key":"synthetic"}');
insert into people(id,tenant_id,display_name,primary_email,verified) values(fixture_id(83),fixture_id(1),'Retained identity','shared@example.invalid',true),(fixture_id(84),fixture_id(2),'Foreign identity','foreign@example.invalid',true);
insert into contact_points(tenant_id,person_id,channel,value,normalized_value,verification_state,is_primary) values(fixture_id(1),fixture_id(83),'email','shared@example.invalid','shared@example.invalid','verified',true);
create table fixture_retained_person as select to_jsonb(p) person,(select jsonb_agg(to_jsonb(cp) order by cp.id) from contact_points cp where cp.person_id=fixture_id(83)) endpoints from people p where p.id=fixture_id(83);
insert into learn_business_input_request_gates(credential_fingerprint,next_allowed_at) values('synthetic-contact-fingerprint',clock_timestamp());
create function fixture_source(collection text,payload jsonb) returns uuid language plpgsql as $$
declare v uuid:=gen_random_uuid();p uuid:=gen_random_uuid();permit uuid:=gen_random_uuid();job uuid:=gen_random_uuid();begin
 insert into learn_business_input_request_permits(id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint) values(permit,fixture_id(1),job,'synthetic-fixture',1,'{}','synthetic-contact-fingerprint');
 insert into learn_business_input_versions(id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload) values(v,fixture_id(1),fixture_id(5),'commusoft',collection,payload->>'id',md5(payload::text)||md5(payload::text),payload);
 insert into learn_business_input_pages(id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,checkpoint_before,checkpoint_after,record_count) values(p,fixture_id(1),fixture_id(5),'commusoft',collection,job,permit,jsonb_build_object('data',jsonb_build_array(payload)),'{}','{}',1);
 insert into learn_business_input_observations(page_id,version_id,ordinal) values(p,v,0);return v;
end $$;
create function fixture_version(collection text,n integer) returns uuid language sql security definer set search_path=pg_catalog as $$select id from public.learn_business_input_versions where tenant_id=public.fixture_id(1) and collection=$1 and external_id=$2::text$$;
select fixture_source('properties','{"id":1,"type":"customer","contact":{"firstName":"Sample","lastName":"Customer"}}');
select fixture_source('properties','{"id":2,"type":"workaddress","parentPropertyID":1,"addressLine1":"Synthetic site"}');
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='92000000-0000-4000-8000-000000000080';set role authenticated;
do $$declare r jsonb;begin
 r:=learn_commusoft_confirm_customer(fixture_id(1),fixture_version('properties',1),'person',null,'Synthetic customer review');assert r->>'link_id' is not null,'Customer link missing';
 r:=learn_commusoft_confirm_work_record(fixture_id(1),fixture_version('properties',2),null,'Synthetic site review');assert r->>'state'='linked';
end $$;
reset role;
select fixture_source('propertyContacts','{"id":501,"propertyID":2,"firstName":"Site","lastName":"Contact","position":"Caretaker","email":"SITE@example.invalid","telephones":[{"type":"Mobile","number":"07700 900123"},{"type":"Office","number":"020 7946 0123"},{"number":"02079460123"}],"communicationPreference":{"email":true}}');
select fixture_source('propertyContacts','{"id":502,"propertyID":1,"firstName":"Shared","email":"shared@example.invalid"}');
select fixture_source('propertyContacts','{"id":503,"propertyID":999,"firstName":"Unresolved"}');
select fixture_source('propertyContacts','{"id":504,"propertyID":1,"firstName":"Bad phone","telephones":[{"number":false}]}');
select fixture_source('propertyContacts','{"id":505,"propertyID":1,"firstName":"Foreign target"}');
select fixture_source('propertyContacts','{"id":506,"propertyID":1,"firstName":"Rollback"}');
select fixture_source('propertyContacts','{"id":507,"propertyID":1,"firstName":"Cancelled"}');
select fixture_source('propertyContacts','{"id":508,"propertyID":1,"firstName":"Concurrent"}');
create table fixture_card_count as select count(*) n from customer_cards;
set role authenticated;
do $$declare r jsonb;items jsonb;begin
 r:=learn_commusoft_work_review_page(fixture_id(1),fixture_id(5),'contact');assert jsonb_array_length(r->'rows')=8;assert jsonb_array_length(r->'rows'->0->'contact'->'phones')=3;
 r:=learn_commusoft_contact_candidates(fixture_id(1),fixture_version('propertyContacts',502),'person');assert r->'rows'->0->>'id'=fixture_id(83)::text;
 r:=learn_commusoft_contact_candidates(fixture_id(1),fixture_version('propertyContacts',501),'person','Foreign');assert jsonb_array_length(r->'rows')=0;
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_version('propertyContacts',502),null,'Shared identity requires review');assert r->>'reason'='contact_identity_needs_review';
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_version('propertyContacts',502),fixture_id(83),'Reviewed existing identity');assert r->>'state'='linked';
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_version('propertyContacts',504),null,'Bad phone held');assert r->>'reason'='contact_phone_invalid';
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_version('propertyContacts',505),fixture_id(84),'Foreign target rejected');assert r->>'reason'='contact_target_missing';
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_version('propertyContacts',501),'target_id',null),jsonb_build_object('version_id',fixture_version('propertyContacts',503),'target_id',null));
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(601),fixture_id(5),'contact',items,'Reviewed synthetic batch');assert r->>'linked'='1' and r->>'held'='1';
 assert r=learn_commusoft_work_batch(fixture_id(1),fixture_id(601),fixture_id(5),'contact',items,'Reviewed synthetic batch');
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_version('propertyContacts',501),null,'Replay reviewed contact');assert r->>'already'='true';
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_version('propertyContacts',507),'target_id',null));
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(602),fixture_id(5),'contact',items,'Cancelled synthetic batch',true);assert r->>'state'='cancelled';
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(602),fixture_id(5),'contact',items,'Cancelled synthetic batch');assert r->>'state'='cancelled';
end $$;
reset role;
do $$declare p uuid;begin
 select entity_id into p from learn_business_input_links where collection='propertyContacts' and external_id='501';
 assert (select count(*) from contact_points where person_id=p)=3;
 assert not exists(select 1 from contact_points where person_id=p and (is_primary or verification_state<>'unverified'));
 assert (select primary_phone is null and company_id is null and not verified from people where id=p);
 assert (select count(*) from graph_edges e join graph_nodes n on n.id=e.from_node_id where n.source_id=p and e.edge_type='contact_for')=2;
 assert (select count(*) from customer_cards)=(select n from fixture_card_count);
 assert (select to_jsonb(t) from people t where id=fixture_id(83))=(select person from fixture_retained_person);
 assert (select jsonb_agg(to_jsonb(cp) order by cp.id) from contact_points cp where cp.person_id=fixture_id(83))=(select endpoints from fixture_retained_person);
end $$;
create function fixture_fail_receipt() returns trigger language plpgsql as $$begin raise exception 'synthetic_receipt_failure';end$$;
create trigger fixture_fail_receipt before insert on learn_business_input_projection_batches for each row execute function fixture_fail_receipt();
set role authenticated;
do $$begin
 begin
 perform learn_commusoft_work_batch(fixture_id(1),fixture_id(603),fixture_id(5),'contact',jsonb_build_array(jsonb_build_object('version_id',fixture_version('propertyContacts',506),'target_id',null)),'Rollback synthetic batch');
 raise exception 'Receipt failure did not fire';
 exception when raise_exception then if sqlerrm<>'synthetic_receipt_failure' then raise;end if;end;
end $$;
reset role;
drop trigger fixture_fail_receipt on learn_business_input_projection_batches;
do $$begin assert not exists(select 1 from people where display_name='Rollback');assert not exists(select 1 from learn_business_input_links where external_id='506');end$$;
set request.jwt.claim.sub='92000000-0000-4000-8000-000000000081';set role authenticated;
do $$begin
 begin perform learn_commusoft_confirm_contact(fixture_id(1),fixture_version('propertyContacts',508),null,'Viewer must be denied');raise exception 'Viewer was allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
