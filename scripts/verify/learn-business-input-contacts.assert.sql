set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
select fixture_work_page('properties','{"data":[{"id":31,"type":"workaddress","parentPropertyID":3,"addressLine1":"Synthetic contact site"}],"pagination":{"hasMore":false,"nextCursor":31}}');
set role authenticated;
select learn_commusoft_confirm_work_record(fixture_id(1),fixture_work_version('properties','31'),null,'Contact site review');
reset role;
create function fixture_contact_page(body jsonb) returns void language plpgsql as $$
declare job uuid:=gen_random_uuid();approval uuid:=gen_random_uuid();permit uuid;expected jsonb;begin
 perform set_config('request.jwt.claim.role','service_role',true);
 update connector_accounts set sync_cursor='{}',settings=jsonb_set(settings,'{commusoft_import}',(settings->'commusoft_import')||jsonb_build_object('connectionId',fixture_id(5),'approvalId',approval,'resource','propertyContacts','contactType','customer'));
 update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
 insert into platform_jobs(id,tenant_id,job_type,status,payload,claimed_by,attempt_count,lease_expires_at,metadata,job_key)
 values(job,fixture_id(1),'commusoft.source_sync','running',jsonb_build_object('connector_account_id',fixture_id(3)),'fixture-worker',1,clock_timestamp()+interval '1 hour','{}','commusoft.source:'||fixture_id(3)||':'||approval);
 expected:=jsonb_set(fixture_expected(job),'{request,resource}','"propertyContacts"');expected:=jsonb_set(expected,'{request,contactType}','"customer"');
 permit:=(fixture_acquire(expected,job)->>'permitId')::uuid;
 if permit is null then raise exception 'Contact fixture permit unavailable';end if;
 perform learn_commusoft_commit_page(fixture_id(1),job,'fixture-worker',1,permit,body);
 perform learn_commusoft_finish_job(fixture_id(1),job,'fixture-worker',1,'{"success":true}');
 perform set_config('request.jwt.claim.role','authenticated',true);
end $$;
select fixture_contact_page('{"data":[
 {"id":501,"propertyID":31,"firstName":"Site","lastName":"Contact","position":"Caretaker","email":"SITE@example.invalid","telephones":[{"type":"Mobile","number":"07700 900123"},{"type":"Office","number":"020 7946 0123"},{"type":"Office","number":"02079460123"}],"communicationPreference":{"email":true}},
 {"id":502,"propertyID":2,"firstName":"Company","lastName":"Contact","email":"company-contact@example.invalid"},
 {"id":503,"propertyID":999,"firstName":"Missing property"},
 {"id":504,"propertyID":3,"firstName":"Shared","email":"old@example.invalid"},
 {"id":505,"propertyID":3,"firstName":"Invalid","telephones":[{"number":false}]},
 {"id":506,"propertyID":3,"firstName":"Rollback","email":"rollback@example.invalid"},
 {"id":507,"propertyID":3,"firstName":"Cancelled"},
 {"id":508,"propertyID":3,"firstName":"Foreign target"},
 {"id":509,"propertyID":3,"firstName":"Missing name","email":"bad address"},
 {"id":510,"propertyID":3,"firstName":"Concurrent contact"}
],"pagination":{"hasMore":false,"nextCursor":510}}');
create table fixture_contact_baseline as select (select count(*) from people) as people,(select count(*) from customer_cards) as cards;
set role authenticated;
do $$declare r jsonb;items jsonb;begin
 r:=learn_commusoft_work_review_page(fixture_id(1),fixture_id(5),'contact',null,20);
 assert jsonb_array_length(r->'rows')=10,'Contact review coverage differs';
 assert r->'rows'->0->>'title'='Site Contact';
 assert r->'rows'->0->'contact'->>'email'='SITE@example.invalid';
 assert jsonb_array_length(r->'rows'->0->'contact'->'phones')=3;
 r:=learn_commusoft_contact_candidates(fixture_id(1),fixture_work_version('propertyContacts','504'),'person');assert r->'rows'->0->>'id'=fixture_id(83)::text and r->'rows'->0->>'reason'='shared_email';
 r:=learn_commusoft_contact_candidates(fixture_id(1),fixture_work_version('propertyContacts','501'),'person','Foreign');assert jsonb_array_length(r->'rows')=0,'Foreign candidate exposed';
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_work_version('propertyContacts','501'),null,'Synthetic contact review');assert r->>'state'='linked' and r->>'entity_kind'='contact','Contact not linked';
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_work_version('propertyContacts','501'),null,'Synthetic contact review');assert r->>'already'='true','Contact replay failed';
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_work_version('propertyContacts','504'),null,'Synthetic shared identity');assert r->>'reason'='contact_identity_needs_review','Shared contact duplicated';
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_work_version('propertyContacts','504'),fixture_id(83),'Reviewed existing identity');assert r->>'state'='linked' and r->>'entity_id'=fixture_id(83)::text;
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_work_version('propertyContacts','508'),fixture_id(84),'Foreign person rejected');assert r->>'reason'='contact_target_missing';
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_work_version('propertyContacts','505'),null,'Malformed phone rejected');assert r->>'reason'='contact_phone_invalid';
 r:=learn_commusoft_confirm_contact(fixture_id(1),fixture_work_version('propertyContacts','509'),null,'Malformed email rejected');assert r->>'reason'='contact_email_invalid';
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_work_version('propertyContacts','502'),'target_id',null),jsonb_build_object('version_id',fixture_work_version('propertyContacts','503'),'target_id',null));
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(601),fixture_id(5),'contact',items,'Mixed contact review');assert r->>'linked'='1' and r->>'held'='1';
 assert r=learn_commusoft_work_batch(fixture_id(1),fixture_id(601),fixture_id(5),'contact',items,'Mixed contact review'),'Batch replay differs';
 items:=jsonb_build_array(jsonb_build_object('version_id',fixture_work_version('propertyContacts','507'),'target_id',null));
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(602),fixture_id(5),'contact',items,'Cancelled contact review',true);assert r->>'state'='cancelled';
 r:=learn_commusoft_work_batch(fixture_id(1),fixture_id(602),fixture_id(5),'contact',items,'Cancelled contact review');assert r->>'state'='cancelled';
end $$;
reset role;
do $$declare person uuid;begin
 select entity_id into person from learn_business_input_links where collection='propertyContacts' and external_id='501';
 assert (select count(*) from contact_points where person_id=person)=3,'Multiple observed endpoints not retained';
 assert not exists(select 1 from contact_points where verification_state<>'unverified' or is_primary),'Import changed verification/primary status';
 assert (select primary_phone is null and company_id is null and not verified from people where id=person),'Ambiguous primary or employment invented';
 assert (select count(*) from graph_edges e join graph_nodes n on n.id=e.from_node_id where n.source_id=person and e.edge_type='contact_for')=2,'Customer/site relationships missing';
 assert (select count(*) from customer_cards)=(select cards from fixture_contact_baseline),'Contact created duplicate customer card';
 assert (select to_jsonb(p) from people p where id=fixture_id(83))=(select b.person from fixture_customer_baseline b),'Existing contact fields overwritten';
 assert (select count(*) from graph_events where event_type='contact.linked')=3;
 assert not exists(select 1 from people where display_name in ('Rollback','Cancelled','Invalid'));
end $$;
-- A late receipt failure rolls back person, endpoints, graph and source link.
create trigger fixture_fail_contact_batch before insert on learn_business_input_projection_batches for each row execute function fixture_fail_batch();
set role authenticated;
do $$begin
 begin perform learn_commusoft_work_batch(fixture_id(1),fixture_id(603),fixture_id(5),'contact',jsonb_build_array(jsonb_build_object('version_id',fixture_work_version('propertyContacts','506'),'target_id',null)),'Late failure rollback');raise exception 'failure missed';
 exception when raise_exception then if sqlerrm<>'injected batch failure' then raise;end if;end;
end $$;
reset role;drop trigger fixture_fail_contact_batch on learn_business_input_projection_batches;
do $$begin assert not exists(select 1 from people where display_name='Rollback');assert not exists(select 1 from contact_points where normalized_value='rollback@example.invalid');assert not exists(select 1 from learn_business_input_links where collection='propertyContacts' and external_id='506');end $$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000081';set role authenticated;
do $$begin begin perform learn_commusoft_confirm_contact(fixture_id(1),fixture_work_version('propertyContacts','506'),null,'Viewer denied');raise exception 'viewer accepted';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'Contact projection: canonical people/endpoints, customer/site graph, no duplicate cards, explicit shared-identity review, immutable replay, cancellation, mixed results and late-failure rollback passed.';
