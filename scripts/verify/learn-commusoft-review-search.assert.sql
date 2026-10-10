-- Source fixtures traverse the real permit/publication path; search must not mutate them.
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
select fixture_work_page('properties','{"data":[{"id":800001,"type":"customer","companyName":"Alpine Heating","addressLine1":"50 Oak Road","postcode":"AB1 2CD","contact":{"firstName":"Jane","lastName":"Smith","email":"jane@example.invalid","telephone":"02079460000","mobile":"07700900999"}},{"id":800002,"type":"customer","companyName":"Alpine West"},{"id":800003,"type":"customer","companyName":"FormerName"},{"id":800004,"type":"workaddress","parentPropertyID":800001,"addressLine1":"52 Oak Road","postcode":"AB1 2CD"}],"pagination":{"hasMore":false,"nextCursor":800004}}');
select fixture_work_page('properties','{"data":[{"id":800003,"type":"customer","companyName":"CurrentName"}],"pagination":{"hasMore":false,"nextCursor":800003}}');
select fixture_work_page('jobs','{"data":[{"id":800101,"propertyID":800001,"description":"Alpine repair 100% _","status":"ongoing"},{"id":800102,"propertyID":800001,"description":"Alpine repair second","status":"completed"},{"id":800103,"propertyID":800001,"description":"OldOnlyDescription","status":"ongoing"}],"pagination":{"hasMore":false,"nextCursor":800103}}');
select fixture_work_page('jobs','{"data":[{"id":800103,"propertyID":800001,"description":"LatestOnlyDescription","status":"ongoing"}],"pagination":{"hasMore":false,"nextCursor":800103}}');
-- Deliberate ambiguous and unobserved retained identities must stay held.
select fixture_work_page('jobs','{"data":[{"id":800105,"propertyID":800001,"description":"Conflicting source A","status":"ongoing"}],"pagination":{"hasMore":false,"nextCursor":800105}}');
do $$declare extra uuid;page uuid;begin
 select o.page_id into page from learn_business_input_observations o join learn_business_input_versions v on v.id=o.version_id where v.external_id='800105';
 insert into learn_business_input_versions(tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(fixture_id(1),fixture_id(5),'commusoft','jobs','800105','synthetic-conflict','{"id":800105,"description":"Conflicting source B"}') returning id into extra;
 insert into learn_business_input_observations(page_id,version_id,ordinal) values(page,extra,2);
 insert into learn_business_input_versions(tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(fixture_id(1),fixture_id(5),'commusoft','jobs','800106','synthetic-unobserved','{"id":800106,"description":"Unobserved source"}');
end $$;
create temporary table search_preserved as
select 'versions' as name,count(*) as n,md5(string_agg(md5(row_to_json(v)::text),'' order by v.id)) as fingerprint from learn_business_input_versions v
union all select 'pages',count(*),md5(string_agg(md5(row_to_json(v)::text),'' order by v.id)) from learn_business_input_pages v
union all select 'links',count(*),md5(string_agg(md5(row_to_json(v)::text),'' order by v.id)) from learn_business_input_links v
union all select 'jobs',count(*),md5(string_agg(md5(row_to_json(v)::text),'' order by v.id)) from jobs v;
set role authenticated;
do $$declare r jsonb;s jsonb;begin
 r:=learn_commusoft_review_search(fixture_id(1),fixture_id(5),'  aLPine  ',null,1);
 assert r->>'search'='aLPine' and r->'rows'->0->>'external_id'='800001' and r->>'next_cursor'='800001';
 s:=learn_commusoft_review_search(fixture_id(1),fixture_id(5),'aLPine',r->>'next_cursor',1);
 assert s->'rows'->0->>'external_id'='800002' and s->'next_cursor'='null'::jsonb;
 assert jsonb_array_length(learn_commusoft_review_search(fixture_id(1),fixture_id(5),'FormerName')->'rows')=0;
 assert learn_commusoft_review_search(fixture_id(1),fixture_id(5),'CurrentName')->'rows'->0->>'external_id'='800003';
 assert learn_commusoft_review_search(fixture_id(1),fixture_id(5),'07700900999')->'rows'->0->>'external_id'='800001';
 assert learn_commusoft_review_search(fixture_id(1),fixture_id(5),'jane@example.invalid')->'rows'->0->>'external_id'='800001';
 assert learn_commusoft_review_search(fixture_id(1),fixture_id(5),'800002')->'rows'->0->>'external_id'='800002';
 assert learn_commusoft_review_search(fixture_id(1),fixture_id(5),'AB1 2CD')->'rows'->0->>'external_id'='800001';
 r:=learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','Alpine repair',null,1);
 assert r->'rows'->0->>'external_id'='800101' and r->>'next_cursor'='800101';
 s:=learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','Alpine repair',r->>'next_cursor',1);
 assert s->'rows'->0->>'external_id'='800102' and s->'next_cursor'='null'::jsonb;
 assert jsonb_array_length(learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','OldOnlyDescription')->'rows')=0;
 assert learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','LatestOnlyDescription')->'rows'->0->>'external_id'='800103';
 assert jsonb_array_length(learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','100% _')->'rows')=1;
 assert jsonb_array_length(learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','%invalid%')->'rows')=0;
 assert jsonb_array_length(learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','800001')->'rows')=3;
 assert learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'site','52 Oak')->'rows'->0->>'external_id'='800004';
 r:=learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'contact','site@example.invalid');
 assert r->'rows'->0->>'external_id'='501' and jsonb_array_length(r->'rows'->0->'contact'->'phones')=3;
 assert learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'contact','020 7946 0123')->'rows'->0->>'external_id'='501';
 r:=learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','800105');
 assert r->'rows'->0->'version_id'='null'::jsonb and r->'rows'->0->'selectable'='false'::jsonb and r->'rows'->0->>'relationship_reason'='source_changed_or_ambiguous';
 assert jsonb_array_length(learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','Conflicting source')->'rows')=0;
 r:=learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','800106');
 assert r->'rows'->0->'version_id'='null'::jsonb and r->'rows'->0->'selectable'='false'::jsonb;
 assert (learn_commusoft_review_search(fixture_id(1),fixture_id(5),'')-'search')=learn_commusoft_review_page(fixture_id(1),fixture_id(5));
 assert (learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job','')-'search')=learn_commusoft_work_review_page(fixture_id(1),fixture_id(5),'job');
 assert not (r->'rows'->0) ? 'payload';
 begin perform learn_commusoft_review_search(fixture_id(1),fixture_id(5),null);raise exception 'Null search admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_commusoft_work_review_search(fixture_id(1),fixture_id(5),'job',repeat('a',151));raise exception 'Long search admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_commusoft_review_search(fixture_id(99),fixture_id(5),'Alpine');raise exception 'Foreign tenant admitted';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_work_review_search(fixture_id(1),fixture_id(99),'job','Alpine');raise exception 'Foreign connection admitted';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_source_matches('{}','1','job','');raise exception 'Private matcher exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000081';set role authenticated;
do $$begin begin perform learn_commusoft_review_search(fixture_id(1),fixture_id(5),'Alpine');raise exception 'Viewer admitted';exception when insufficient_privilege then null;end;end $$;
reset role;
do $$declare role_name text;begin
 foreach role_name in array array['anon','service_role'] loop
  assert not has_function_privilege(role_name,'learn_commusoft_review_search(uuid,uuid,text,text,integer)','execute');
  assert not has_function_privilege(role_name,'learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)','execute');
 end loop;
 assert not exists(select 1 from search_preserved b join (
  select 'versions' as name,count(*) as n,md5(string_agg(md5(row_to_json(v)::text),'' order by v.id)) as fingerprint from learn_business_input_versions v
  union all select 'pages',count(*),md5(string_agg(md5(row_to_json(v)::text),'' order by v.id)) from learn_business_input_pages v
  union all select 'links',count(*),md5(string_agg(md5(row_to_json(v)::text),'' order by v.id)) from learn_business_input_links v
  union all select 'jobs',count(*),md5(string_agg(md5(row_to_json(v)::text),'' order by v.id)) from jobs v
 ) a using(name) where a.n<>b.n or a.fingerprint is distinct from b.fingerprint);
end $$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
select 'PASS: server-filtered customer/work search, latest-source selection, literal terms, bounded pagination, authority, private helper and source/canonical preservation';
