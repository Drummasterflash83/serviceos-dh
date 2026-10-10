-- Synthetic discovery only: shared endpoints remain separate review candidates.
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
update connector_accounts set settings=jsonb_set(settings,'{commusoft_import}',(settings->'commusoft_import')-'contactType');
select fixture_work_page('properties','{"data":[{"id":930,"type":"customer","contact":{"firstName":"Unrelated source name","email":"DISCOVERY-SHARED@example.invalid","telephone":"02079460999","mobile":"07700900888"}}],"pagination":{"hasMore":false,"nextCursor":930}}');
insert into people(id,tenant_id,display_name,primary_phone) values
 (fixture_id(901),fixture_id(1),'First shared endpoint',null),
 (fixture_id(902),fixture_id(1),'Second shared endpoint',null),
 (fixture_id(903),fixture_id(1),'Mobile primary','+44 7700 900888'),
 (fixture_id(904),fixture_id(1),'Invalid email endpoint',null),
 (fixture_id(905),fixture_id(1),'Secondary landline',null),
 (fixture_id(906),fixture_id(99),'Foreign endpoint',null);
insert into companies(id,tenant_id,name,phone) values(fixture_id(907),fixture_id(1),'Company mobile','+447700900888');
insert into tenants(id,status) values(fixture_id(99),'active') on conflict do nothing;
insert into contact_points(tenant_id,person_id,channel,value,normalized_value,verification_state) values
 (fixture_id(1),fixture_id(901),'email','discovery-shared@example.invalid','discovery-shared@example.invalid','unverified'),
 (fixture_id(1),fixture_id(902),'email','discovery-shared@example.invalid','discovery-shared@example.invalid','verified'),
 (fixture_id(1),fixture_id(904),'email','discovery-shared@example.invalid','discovery-shared@example.invalid','invalid'),
 (fixture_id(1),fixture_id(905),'phone','020 7946 0999','+442079460999','unverified'),
 (fixture_id(99),fixture_id(906),'email','discovery-shared@example.invalid','discovery-shared@example.invalid','verified');
create function fixture_discovery_hash() returns text language sql as $$
 select md5(coalesce(string_agg(value,'' order by value),'')) from (
 select row_to_json(t)::text as value from people t union all select row_to_json(t)::text from companies t
 union all select row_to_json(t)::text from contact_points t union all select row_to_json(t)::text from customer_cards t
 union all select row_to_json(t)::text from learn_business_input_pages t union all select row_to_json(t)::text from learn_business_input_versions t
 union all select row_to_json(t)::text from learn_business_input_links t) rows;
$$;
create temp table discovery_before as select fixture_discovery_hash() as hash;
set role authenticated;
do $$declare r jsonb;v uuid:=fixture_work_version('properties','930');begin
 r:=learn_commusoft_customer_candidates(fixture_id(1),v,'person');
 assert jsonb_array_length(r->'rows')=4,'Shared email, source mobile or secondary landline omitted, or invalid/foreign endpoint included';
 assert r->'rows'->0->>'id'=fixture_id(901)::text;
 assert r->'rows'->1->>'id'=fixture_id(902)::text,'Shared email silently chose one identity';
 assert r->'rows'->0->'match_detail'='{"channel":"email","value":"discovery-shared@example.invalid"}'::jsonb;
 assert r->'rows'->2->>'reason'='shared_phone' and r->'rows'->2->'match_detail'->>'value'='+447700900888','Source mobile lost behind telephone';
 assert r->'rows'->3->'match_detail'->>'value'='+442079460999';
 r:=learn_commusoft_customer_candidates(fixture_id(1),v,'person','discovery-shared@example.invalid',null,1);
 assert r->'rows'->0->>'id'=fixture_id(901)::text and r->>'next_cursor'=fixture_id(901)::text;
 r:=learn_commusoft_customer_candidates(fixture_id(1),v,'person','discovery-shared@example.invalid',(r->>'next_cursor')::uuid,1);
 assert r->'rows'->0->>'id'=fixture_id(902)::text and r->'next_cursor'='null'::jsonb,'Secondary endpoint pagination changed identity';
 r:=learn_commusoft_customer_candidates(fixture_id(1),v,'person','020 7946 0999');
 assert jsonb_array_length(r->'rows')=1 and r->'rows'->0->>'id'=fixture_id(905)::text,'Secondary phone search failed';
 r:=learn_commusoft_customer_candidates(fixture_id(1),v,'company');
 assert jsonb_array_length(r->'rows')=1 and r->'rows'->0->>'id'=fixture_id(907)::text,'Person/company scopes mixed';
 begin perform learn_commusoft_customer_candidates(fixture_id(99),v,'person');raise exception 'Foreign tenant accepted';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_customer_candidates(fixture_id(1),fixture_id(999),'person');raise exception 'Foreign source accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
-- Local-format numbers must use the connection's region; never assume UK for US.
update provider_connections set non_secret_config=jsonb_set(non_secret_config,'{region}','"us"') where id=fixture_id(5);
set role authenticated;
do $$declare r jsonb;begin
 r:=learn_commusoft_customer_candidates(fixture_id(1),fixture_work_version('properties','930'),'person');
 assert jsonb_array_length(r->'rows')=2,'US connection inferred UK equivalence';
end $$;
reset role;
update provider_connections set non_secret_config=jsonb_set(non_secret_config,'{region}','"uk"') where id=fixture_id(5);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000081';set role authenticated;
do $$begin begin perform learn_commusoft_customer_candidates(fixture_id(1),fixture_work_version('properties','930'),'person');raise exception 'Viewer accepted';exception when insufficient_privilege then null;end;end $$;
reset role;
set request.jwt.claim.sub='';set role authenticated;
do $$begin begin perform learn_commusoft_customer_candidates(fixture_id(1),fixture_work_version('properties','930'),'person');raise exception 'Missing identity accepted';exception when insufficient_privilege then null;end;end $$;
reset role;
do $$begin assert fixture_discovery_hash()=(select hash from discovery_before),'Discovery changed source records or canonical identities';end $$;
select 'Customer discovery: multiple shared endpoints, source mobile, region-aware phones, invalid/foreign exclusion, pagination, role boundaries and unchanged source/canonical data passed.';
