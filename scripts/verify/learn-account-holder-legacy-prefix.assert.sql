-- Everything, including passwordless banned actors, rolls back with the caller.
create function pg_temp.brid(n int) returns uuid language sql immutable as $$select ('cf810000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.brid(int) to authenticated;
insert into public.tenants(id,slug,display_name,status) values
 (pg_temp.brid(1),'operator-review-home','Synthetic operator home','active'),
 (pg_temp.brid(2),'operator-review-client','Synthetic selected client','active');
insert into auth.users(id,email,banned_until) values
 (pg_temp.brid(10),'operator-review@example.invalid','infinity'),(pg_temp.brid(11),'ordinary-review@example.invalid','infinity');
insert into public.profiles(id,tenant_id,role) values(pg_temp.brid(10),pg_temp.brid(1),'viewer'),(pg_temp.brid(11),pg_temp.brid(2),'owner')
 on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.feature_flags(tenant_id,flag,value) values(pg_temp.brid(2),'learn.enabled','true'),(pg_temp.brid(2),'learn.inputs.commusoft.enabled','true');
insert into public.tenant_connectors(tenant_id,provider,connector_id,category,enabled,status) values(pg_temp.brid(2),'commusoft','commusoft','customer_system',true,'active');
insert into public.provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,non_secret_config)
 values(pg_temp.brid(5),pg_temp.brid(2),'commusoft','configured','private_api_key',clock_timestamp(),'{"region":"uk","account_key":"synthetic"}');
insert into public.learn_business_input_request_gates(credential_fingerprint,next_allowed_at) values('synthetic-operator-review',clock_timestamp());
create function pg_temp.brsource(n int,collection text,payload jsonb) returns void language plpgsql as $$
declare p uuid:=gen_random_uuid();permit uuid:=gen_random_uuid();job uuid:=gen_random_uuid();begin
 insert into public.learn_business_input_request_permits(id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
 values(permit,pg_temp.brid(2),job,'synthetic-operator-review',1,'{}','synthetic-operator-review');
 insert into public.learn_business_input_versions(id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(pg_temp.brid(n),pg_temp.brid(2),pg_temp.brid(5),'commusoft',collection,payload->>'id',md5(payload::text)||md5(payload::text),payload);
 insert into public.learn_business_input_pages(id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,checkpoint_before,checkpoint_after,record_count)
 values(p,pg_temp.brid(2),pg_temp.brid(5),'commusoft',collection,job,permit,jsonb_build_object('data',jsonb_build_array(payload)),'{}','{}',1);
 insert into public.learn_business_input_observations(page_id,version_id,ordinal) values(p,pg_temp.brid(n),0);
end$$;
select pg_temp.brsource(101,'properties','{"id":101,"type":"customer","contact":{"firstName":"Synthetic","lastName":"Customer","email":"customer@example.invalid"}}');
select pg_temp.brsource(102,'properties','{"id":102,"type":"workaddress","parentPropertyID":101,"addressLine1":"Synthetic work site"}');
select pg_temp.brsource(103,'jobs','{"id":103,"propertyID":102,"description":"Synthetic repair","status":"completed","createdOnDateTime":"2026-10-01T08:00:00Z","completed":{"completedOnDateTime":"2026-10-02T09:00:00Z"}}');
select pg_temp.brsource(104,'propertyContacts','{"id":104,"propertyID":102,"firstName":"Synthetic","lastName":"Site contact","email":"site@example.invalid","telephones":[]}');
select pg_temp.brsource(105,'properties','{"id":105,"type":"customer","contact":{"firstName":"Audit rollback"}}');
create function pg_temp.br(action text,args jsonb) returns jsonb language sql as $$
 select public.openfolk_business_review(pg_temp.brid(2),action,'Review selected client inputs',jsonb_build_object('p_tenant',pg_temp.brid(2))||args)$$;
grant execute on function pg_temp.br(text,jsonb) to authenticated;

insert into public.platform_authority_grants(profile_id,permission,granted_by,effective_to) values(pg_temp.brid(10),'platform.controlplane.admin','rollback probe',clock_timestamp()+interval '5 minutes');
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='cf810000-aaaa-4000-8000-000000000010';set local role authenticated;
select pg_temp.br('learn_commusoft_confirm_customer',jsonb_build_object('p_version',pg_temp.brid(101),'p_kind','person','p_target',null,'p_reason','Legacy reviewed customer'));
reset role;
