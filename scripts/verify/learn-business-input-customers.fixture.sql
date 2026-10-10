-- Synthetic only, layered on the actual foundational customer table definitions.
alter table people add column verified boolean not null default false,add column created_source text;
alter table companies add column verified boolean not null default false,add column created_source text;
create unique index learn_customer_card_person_uk on customer_cards(tenant_id,person_id) where person_id is not null;
create unique index learn_customer_card_company_uk on customer_cards(tenant_id,company_id) where person_id is null and company_id is not null;
create table profiles(id uuid primary key,tenant_id uuid,role text);
create table view_as_context(actor_user_id uuid,ended_at timestamptz,expires_at timestamptz);
insert into profiles values(fixture_id(80),fixture_id(1),'owner'),(fixture_id(81),fixture_id(1),'viewer'),(fixture_id(82),fixture_id(99),'owner');
insert into people(id,tenant_id,display_name,primary_email,verified,metadata)
 values(fixture_id(83),fixture_id(1),'Existing person','old@example.invalid',true,'{"manual":true}'),
 (fixture_id(84),fixture_id(99),'Foreign person',null,true,'{}');
insert into companies(id,tenant_id,name,verified) values(fixture_id(85),fixture_id(1),'Existing company',true);
insert into customer_cards(id,tenant_id,person_id,company_id,title,summary,owner_id,latest_activity_at,metadata)
 values(fixture_id(86),fixture_id(1),fixture_id(83),fixture_id(85),'Retained title','Retained summary',fixture_id(80),'2026-01-01Z','{"manual":true}');
create table fixture_customer_baseline as select to_jsonb(p) as person,(select to_jsonb(c) from customer_cards c where id=fixture_id(86)) as card from people p where p.id=fixture_id(83);
set request.jwt.claim.role='service_role';
-- Uses the actual permit and atomic page publisher for the end-to-end fixture.
do $$declare permit uuid;begin
 permit:=(fixture_acquire()->>'permitId')::uuid;
 perform learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,permit,
  '{"data":[
   {"id":1,"type":"customer","customerType":45,"contact":{"firstName":"New","lastName":"Person","email":"new@example.invalid"},"addressLine1":"Synthetic road"},
   {"id":2,"type":"customer","companyName":"Synthetic Company","contact":{"firstName":"Named","lastName":"Contact"}},
   {"id":3,"type":"customer","contact":{"firstName":"Different","lastName":"Name","email":"different@example.invalid"}},
   {"id":4,"type":"workaddress","parentPropertyID":1},
   {"id":5,"type":"customer","contact":{"firstName":{"invalid":true}}},
   {"id":6,"type":"customer","contact":{"firstName":"Rollback"}},
   {"id":7,"type":"customer","contact":{"firstName":"Stale"}},
   {"id":8,"type":"customer","companyName":"Existing company"},
   {"id":9,"type":"customer","contact":{"firstName":"Concurrent"}},
   {"id":10,"type":"customer","contact":{"firstName":"Future"}}
  ],"pagination":{"hasMore":false,"nextCursor":10}}');
 perform learn_commusoft_finish_job(fixture_id(1),fixture_id(2),'fixture-worker',1,'{"success":true}');
end $$;
-- Fixed synthetic ID lookup only, no production equivalent or generic source reader.
create function fixture_version(n integer) returns uuid language sql security definer set search_path=public as $$
 select id from learn_business_input_versions where tenant_id=fixture_id(1) and connection_id=fixture_id(5) and external_id=n::text order by first_seen_at limit 1;
$$;
set check_function_bodies=off;
create function fixture_review(n integer,kind text,target uuid,actor uuid default fixture_id(80)) returns jsonb
 language sql set search_path=public as $$
 select learn_commusoft_review_customer(fixture_id(1),actor,fixture_version(n),kind,target,'Synthetic reviewed identity');
$$;
reset check_function_bodies;
grant execute on function fixture_version(integer),fixture_review(integer,text,uuid,uuid) to service_role;
