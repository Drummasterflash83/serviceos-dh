-- MUST be run inside a rollback/savepoint probe. All identities are banned,
-- passwordless and transaction-local; no Auth session or platform grant is issued.
create function pg_temp.partial_id(n int) returns uuid language sql immutable as $$select ('eb190659-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
do $$begin
 assert not exists(select 1 from tenants where id in(pg_temp.partial_id(1),pg_temp.partial_id(2)));
 assert not exists(select 1 from auth.users where id=pg_temp.partial_id(80));
end$$;
insert into tenants(id,slug,display_name,status) values(pg_temp.partial_id(1),'partial-times-rollback-a','Synthetic timing rollback A','active'),(pg_temp.partial_id(2),'partial-times-rollback-b','Synthetic timing rollback B','active');
insert into auth.users(id,email,banned_until) values(pg_temp.partial_id(80),'partial-times-rollback@example.invalid','infinity');
insert into profiles(id,tenant_id,role) values(pg_temp.partial_id(80),pg_temp.partial_id(1),'owner') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into feature_flags(tenant_id,flag,value) values(pg_temp.partial_id(1),'learn.enabled','true'),(pg_temp.partial_id(1),'learn.inputs.commusoft.enabled','true');
insert into tenant_connectors(tenant_id,provider,connector_id,category,enabled,status) values(pg_temp.partial_id(1),'commusoft','commusoft','customer_system',true,'active');
insert into provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,non_secret_config) values(pg_temp.partial_id(5),pg_temp.partial_id(1),'commusoft','configured','private_api_key',clock_timestamp(),'{"region":"uk","account_key":"synthetic-only"}');
insert into learn_business_input_request_gates(credential_fingerprint,next_allowed_at) values('synthetic-partial-times-rollback',clock_timestamp());
create function pg_temp.partial_source(collection text,payload jsonb) returns uuid language plpgsql as $$
declare v uuid:=gen_random_uuid();p uuid:=gen_random_uuid();permit uuid:=gen_random_uuid();job uuid:=gen_random_uuid();begin
 insert into public.learn_business_input_request_permits(id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint) values(permit,pg_temp.partial_id(1),job,'synthetic-fixture',1,'{}','synthetic-partial-times-rollback');
 insert into public.learn_business_input_versions(id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload) values(v,pg_temp.partial_id(1),pg_temp.partial_id(5),'commusoft',collection,payload->>'id',md5(payload::text)||md5(payload::text),payload);
 insert into public.learn_business_input_pages(id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,checkpoint_before,checkpoint_after,record_count) values(p,pg_temp.partial_id(1),pg_temp.partial_id(5),'commusoft',collection,job,permit,jsonb_build_object('data',jsonb_build_array(payload)),'{}','{}',1);
 insert into public.learn_business_input_observations(page_id,version_id,ordinal) values(p,v,0);return v;
end$$;
create function pg_temp.partial_version(collection text,n int) returns uuid language sql security definer set search_path=pg_catalog as $$select id from public.learn_business_input_versions where tenant_id=pg_temp.partial_id(1) and collection=$1 and external_id=$2::text$$;
grant execute on function pg_temp.partial_id(int),pg_temp.partial_version(text,int) to authenticated;
select pg_temp.partial_source('properties','{"id":1,"type":"customer","contact":{"firstName":"Synthetic","lastName":"Customer"}}');
select pg_temp.partial_source('properties','{"id":2,"type":"workaddress","parentPropertyID":1,"addressLine1":"Synthetic site"}');
select pg_temp.partial_source('jobs','{"id":10,"propertyID":2,"description":"Synthetic repair","status":"completed","createdOnDateTime":"2026-01-01T01:00:00Z","completed":{"completedOnDateTime":"2026-10-25 01:30:00"}}');
select pg_temp.partial_source('jobs','{"id":11,"propertyID":2,"status":"completed","completed":{"completedOnDateTime":"2026-02-30 01:30:00"}}');
select pg_temp.partial_source('jobs','{"id":12,"propertyID":999,"status":"completed","completed":{"completedOnDateTime":"2026-10-25 01:30:00"}}');
select pg_temp.partial_source('jobs','{"id":13,"propertyID":2,"status":"completed","completed":{"completedOnDateTime":"2026-10-25T01:30:00+01:00"}}');
create temp table partial_sources_before as select md5(string_agg(to_jsonb(v)::text,'' order by id)) hash from learn_business_input_versions v where tenant_id=pg_temp.partial_id(1);
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='eb190659-aaaa-4000-8000-000000000080';set local role authenticated;
do $$declare r jsonb;first_job uuid;begin
 r:=public.learn_commusoft_confirm_customer(pg_temp.partial_id(1),pg_temp.partial_version('properties',1),'person',null,'Synthetic rollback customer review');assert r->>'card_id' is not null;
 r:=public.learn_commusoft_confirm_work_record(pg_temp.partial_id(1),pg_temp.partial_version('properties',2),null,'Synthetic rollback site review');assert r->>'state'='linked';
 r:=public.learn_commusoft_confirm_work_record(pg_temp.partial_id(1),pg_temp.partial_version('jobs',10),null,'Synthetic rollback job review');assert r->>'state'='linked' and r->'timing_limitations'='["completed"]'::jsonb;
 first_job:=(r->>'entity_id')::uuid;
 assert exists(select 1 from public.jobs j where j.id=first_job and j.tenant_id=pg_temp.partial_id(1) and j.completed_date is null and j.metadata#>>'{learn_business_input,timestamps,completed,state}'='timezone_required'),'Signed-in card reader cannot see timing evidence';
 assert not exists(select 1 from public.jobs where tenant_id<>pg_temp.partial_id(1)),'Job RLS exposed another company';
 r:=public.learn_commusoft_confirm_work_record(pg_temp.partial_id(1),pg_temp.partial_version('jobs',10),null,'Synthetic replay');assert r->>'already'='true' and (r->>'entity_id')::uuid=first_job and r->'timing_limitations'='["completed"]'::jsonb;
 r:=public.learn_commusoft_confirm_work_record(pg_temp.partial_id(1),pg_temp.partial_version('jobs',11),null,'Invalid calendar held');assert r->>'reason'='job_timestamp_invalid';
 r:=public.learn_commusoft_confirm_work_record(pg_temp.partial_id(1),pg_temp.partial_version('jobs',12),null,'Missing property held');assert r->>'reason'='property_missing_or_ambiguous';
 r:=public.learn_commusoft_confirm_work_record(pg_temp.partial_id(1),pg_temp.partial_version('jobs',13),null,'Explicit offset retained');assert r->>'state'='linked' and r->'timing_limitations'='[]'::jsonb;
 begin perform public.learn_commusoft_confirm_work_record(pg_temp.partial_id(2),pg_temp.partial_version('jobs',10),null,'Foreign tenant refused');raise exception 'Foreign review accepted';exception when insufficient_privilege then null;end;
end$$;reset role;
do $$declare j public.jobs%rowtype;begin
 select * into j from public.jobs where tenant_id=pg_temp.partial_id(1) and external_id='10';
 assert found and j.completed_date is null and j.status='completed' and not j.verified;
 assert j.metadata#>>'{learn_business_input,timestamps,completed,state}'='timezone_required';
 assert j.metadata#>>'{learn_business_input,timestamps,completed,source}'='2026-10-25 01:30:00';
 assert exists(select 1 from public.learn_business_input_links l join public.customer_cards c on c.id=l.card_id where l.entity_id=j.id and l.tenant_id=j.tenant_id and c.tenant_id=j.tenant_id);
 assert (select completed_date='2026-10-25T00:30:00Z'::timestamptz from jobs where tenant_id=pg_temp.partial_id(1) and external_id='13');
 assert (select count(*) from jobs where tenant_id=pg_temp.partial_id(1))=2;
 assert (select hash from partial_sources_before)=(select md5(string_agg(to_jsonb(v)::text,'' order by id)) from learn_business_input_versions v where tenant_id=pg_temp.partial_id(1));
end$$;
update profiles set role='viewer' where id=pg_temp.partial_id(80);
set local role authenticated;
do $$begin begin perform public.learn_commusoft_confirm_work_record(pg_temp.partial_id(1),pg_temp.partial_version('jobs',10),null,'Demoted user refused');raise exception 'Demoted review accepted';exception when insufficient_privilege then null;end;end$$;reset role;
-- No committed fixture or login may survive the caller's rollback.
