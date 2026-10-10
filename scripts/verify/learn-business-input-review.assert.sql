-- Exercise facade privileges and JWT actor binding as the actual authenticated role.
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
create temp table fixture_review_version as select fixture_version(10) as id;
grant select on fixture_review_version to authenticated;
insert into people(id,tenant_id,display_name) values(fixture_id(87),fixture_id(1),'Existing second customer');
set role authenticated;
do $$declare r jsonb;next_id text;seen text[]:='{}';item jsonb;begin
 r:=learn_commusoft_review_connections(fixture_id(1));assert jsonb_array_length(r->'connections')=2;
 loop
  r:=learn_commusoft_review_page(fixture_id(1),fixture_id(5),next_id,2);
  for item in select value from jsonb_array_elements(r->'rows') loop
   assert not ((item->>'external_id')=any(seen)),'duplicate source page row';seen:=array_append(seen,item->>'external_id');
   assert not item ? 'payload','raw payload exposed';
   if item->>'external_id'='3' then assert item->'link'->>'card_id'=fixture_id(86)::text;end if;
   if item->>'external_id'='7' then assert item->'summary'->>'person_name'='Newer','old observation displayed';end if;
  end loop;
  next_id:=r->>'next_cursor';exit when next_id is null;
 end loop;
 assert cardinality(seen)=9,'source pages omitted customer or included workaddress';
 r:=learn_commusoft_customer_candidates(fixture_id(1),(select id from fixture_review_version),'person','Existing',null,1);
 assert jsonb_array_length(r->'rows')=1 and r->'rows'->0->>'id'=fixture_id(83)::text;
 assert r->'rows'->0->>'reason'='search','search was presented as exact identity';
 assert r->>'next_cursor'=fixture_id(83)::text,'candidate continuation missing';
 r:=learn_commusoft_customer_candidates(fixture_id(1),(select id from fixture_review_version),'person','Existing',(r->>'next_cursor')::uuid,1);
 assert jsonb_array_length(r->'rows')=1 and r->'rows'->0->>'id'=fixture_id(87)::text and r->'next_cursor'='null','candidate continuation duplicated or omitted a row';
 r:=learn_commusoft_customer_candidates(fixture_id(1),(select id from fixture_review_version),'company','Existing');
 assert jsonb_array_length(r->'rows')=1 and r->'rows'->0->>'id'=fixture_id(85)::text,'person and company candidates mixed';
 begin perform learn_commusoft_review_customer(fixture_id(1),fixture_id(80),(select id from fixture_review_version),'person',null,'Cannot choose actor');raise exception 'private writer exposed';exception when insufficient_privilege then null;end;
 r:=learn_commusoft_confirm_customer(fixture_id(1),(select id from fixture_review_version),'person',fixture_id(83),'Reviewed existing customer');
 assert r->>'already'='false' and r->>'card_id'=fixture_id(86)::text;
 r:=learn_commusoft_confirm_customer(fixture_id(1),(select id from fixture_review_version),'person',fixture_id(83),'Reviewed existing customer');assert r->>'already'='true';
 begin perform learn_commusoft_review_page(fixture_id(99),fixture_id(5));raise exception 'foreign company exposed';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_review_page(fixture_id(1),fixture_id(99));raise exception 'foreign connection exposed';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_review_page(fixture_id(1),fixture_id(5),null,51);raise exception 'unbounded page accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
do $$begin assert (select actor_id from learn_business_input_links where external_id='10')=fixture_id(80);end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000081';
set role authenticated;
do $$begin
 begin perform learn_commusoft_review_connections(fixture_id(1));raise exception 'viewer read allowed';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_confirm_customer(fixture_id(1),(select id from fixture_review_version),'person',fixture_id(83),'Reviewed existing customer');raise exception 'viewer write allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;
set request.jwt.claim.sub='';
set role authenticated;
do $$begin
 begin perform learn_commusoft_review_connections(fixture_id(1));raise exception 'missing identity accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 'Signed-in review: paged retained sources, existing candidate search, caller-bound confirmation, replay and isolation passed.';
