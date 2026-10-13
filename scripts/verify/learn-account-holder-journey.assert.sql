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
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='cf810000-aaaa-4000-8000-000000000010';set local role authenticated;
do $$begin
 begin perform pg_temp.br('learn_commusoft_review_connections','{}');raise exception 'Viewer obtained operator review';exception when insufficient_privilege then null;end;
end$$;
reset role;
insert into public.platform_authority_grants(profile_id,permission,granted_by,effective_to) values(pg_temp.brid(10),'platform.controlplane.admin','rollback probe',clock_timestamp()+interval '5 minutes');
set local role authenticated;
do $$declare r jsonb;a jsonb;kind text;v int;begin
 begin perform public.learn_commusoft_review_connections(pg_temp.brid(2));raise exception 'Operator bypassed audited facade';exception when insufficient_privilege then null;end;
 r:=pg_temp.br('learn_commusoft_review_connections','{}');
 assert r->>'actor_id'=pg_temp.brid(10)::text and r->>'tenant_id'=pg_temp.brid(2)::text and r->>'audit_id' is not null;
 assert jsonb_array_length(r#>'{result,connections}')=1;
 r:=pg_temp.br('learn_commusoft_review_page',jsonb_build_object('p_connection',pg_temp.brid(5),'p_after',null,'p_limit',20));
 assert jsonb_array_length(r#>'{result,rows}')=2;
 r:=pg_temp.br('learn_commusoft_review_search',jsonb_build_object('p_connection',pg_temp.brid(5),'p_search','Synthetic','p_after',null,'p_limit',20));
 assert jsonb_array_length(r#>'{result,rows}')=1;
 r:=pg_temp.br('learn_commusoft_customer_candidates',jsonb_build_object('p_version',pg_temp.brid(101),'p_kind','person','p_search','','p_after',null,'p_limit',20));
 assert r#>'{result,rows}'='[]'::jsonb;
 a:=jsonb_build_object('p_version',pg_temp.brid(101),'p_kind','person','p_target',null,'p_reason','Reviewed synthetic customer');
 r:=pg_temp.br('learn_commusoft_confirm_customer_identity',a||jsonb_build_object('p_identity',jsonb_build_object('display_name','Synthetic Customer','contact_is_customer',true,'evidence','Synthetic provider account screen')));
 assert r#>>'{result,card_id}' is not null and r#>>'{result,already}'='false';
 r:=pg_temp.br('learn_commusoft_confirm_customer_identity',a||jsonb_build_object('p_identity',jsonb_build_object('display_name','Synthetic Customer','contact_is_customer',true,'evidence','Synthetic provider account screen')));assert r#>>'{result,already}'='true';
 foreach kind in array array['site','job','contact'] loop
  v:=case kind when 'site' then 102 when 'job' then 103 else 104 end;
  r:=pg_temp.br('learn_commusoft_work_review_page',jsonb_build_object('p_connection',pg_temp.brid(5),'p_kind',kind,'p_after',null,'p_limit',20));
  assert jsonb_array_length(r#>'{result,rows}')=1;
  r:=pg_temp.br('learn_commusoft_work_review_search',jsonb_build_object('p_connection',pg_temp.brid(5),'p_kind',kind,'p_search','Synthetic','p_after',null,'p_limit',20));
  assert jsonb_array_length(r#>'{result,rows}')=1;
  a:=jsonb_build_object('p_request',pg_temp.brid(v+100),'p_connection',pg_temp.brid(5),'p_kind',kind,
   'p_items',jsonb_build_array(jsonb_build_object('version_id',pg_temp.brid(v),'target_id',null)),
   'p_reason','Reviewed synthetic work','p_cancel',false,'p_expected_actor',pg_temp.brid(10));
  r:=pg_temp.br('learn_commusoft_work_batch',a);assert r#>>'{result,linked}'='1',r::text;
  r:=pg_temp.br('learn_commusoft_work_batch',a);assert r#>>'{result,linked}'='1';
  r:=pg_temp.br('learn_commusoft_work_batch_result',jsonb_build_object('p_request',pg_temp.brid(v+100)));
  assert r#>>'{result,state}'='recorded';
 end loop;
 r:=pg_temp.br('learn_commusoft_contact_candidates',jsonb_build_object('p_version',pg_temp.brid(104),'p_kind','person','p_search','','p_after',null,'p_limit',20));
 assert jsonb_array_length(r#>'{result,rows}')=1;
 r:=pg_temp.br('learn_commusoft_job_details',jsonb_build_object('p_connection',pg_temp.brid(5),'p_version',pg_temp.brid(103)));
 assert r#>>'{result,current}'='true';
 assert coalesce(current_setting('openfolk.business_review',true),'')='','Authority context leaked';
 begin perform public.openfolk_business_review(pg_temp.brid(1),'learn_commusoft_review_page','reject wrong scope',jsonb_build_object('p_tenant',pg_temp.brid(2)));raise exception 'Foreign args admitted';exception when invalid_parameter_value then null;end;
 begin perform pg_temp.br('vault_secrets','{}');raise exception 'Arbitrary function admitted';exception when invalid_parameter_value then null;end;
 begin perform pg_temp.br('learn_commusoft_work_batch',a||jsonb_build_object('p_expected_actor',pg_temp.brid(11)));raise exception 'Actor spoof admitted';exception when invalid_parameter_value then null;end;
end$$;
reset role;
do $$begin
 assert (select count(*)=1 from public.customer_cards where tenant_id=pg_temp.brid(2));
 assert (select display_name='Synthetic Customer' and first_name='Synthetic' and last_name='Customer'
  and primary_email='customer@example.invalid' and not verified
  and metadata#>>'{reviewed_account_holder,contact_is_customer}'='true'
  from public.people where tenant_id=pg_temp.brid(2) and display_name='Synthetic Customer');
 assert (select count(*)=4 and count(distinct card_id)=1 from public.learn_business_input_links where tenant_id=pg_temp.brid(2));
 assert (select count(*)=1 from public.jobs where tenant_id=pg_temp.brid(2) and status='completed' and site_id is not null and customer_person_id is not null);
 assert (select tenant_id=pg_temp.brid(1) and role='viewer' from public.profiles where id=pg_temp.brid(10));
 assert not exists(select 1 from public.controlplane_change_log where source='openfolk-business-review' and tenant_id=pg_temp.brid(2) and after::text like '%example.invalid%');
 assert (select count(*)>20 from public.controlplane_change_log where source='openfolk-business-review' and actor=pg_temp.brid(10)::text);
end$$;
-- A receipt failure after the writer ran must roll back the projected customer too.
create function pg_temp.br_fail_audit() returns trigger language plpgsql as $$begin
 if new.action='business_review.result' then raise exception 'synthetic_review_audit_failure';end if;return new;end$$;
create trigger synthetic_review_audit_failure before insert on public.controlplane_change_log for each row execute function pg_temp.br_fail_audit();
set local role authenticated;
do $$begin begin
 perform pg_temp.br('learn_commusoft_confirm_customer_identity',jsonb_build_object('p_version',pg_temp.brid(105),'p_kind','person','p_target',null,'p_reason','Synthetic rollback','p_identity',jsonb_build_object('display_name','Separate account holder','contact_is_customer',false,'evidence','Synthetic account screen')));
 raise exception 'Audit failure did not roll back' using errcode='XX000';
 exception when raise_exception then if sqlerrm<>'synthetic_review_audit_failure' then raise;end if;end;end$$;
reset role;drop trigger synthetic_review_audit_failure on public.controlplane_change_log;
do $$begin assert not exists(select 1 from public.learn_business_input_links where tenant_id=pg_temp.brid(2) and external_id='105');end$$;
insert into public.view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values(pg_temp.brid(2),pg_temp.brid(10),'role','viewer','rollback probe');
set local role authenticated;
do $$begin begin perform pg_temp.br('learn_commusoft_review_connections','{}');raise exception 'View-As admitted';exception when insufficient_privilege then null;end;end$$;
reset role;update public.view_as_context set ended_at=clock_timestamp() where actor_user_id=pg_temp.brid(10);
update public.platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.brid(10);
set local role authenticated;
do $$begin begin perform pg_temp.br('learn_commusoft_review_connections','{}');raise exception 'Revoked operator admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local request.jwt.claim.sub='cf810000-aaaa-4000-8000-000000000011';set local role authenticated;
do $$declare r jsonb;begin
 r:=public.learn_commusoft_review_connections(pg_temp.brid(2));assert jsonb_array_length(r->'connections')=1,'Ordinary owner path broken';
 begin perform pg_temp.br('learn_commusoft_review_connections','{}');raise exception 'Ordinary owner gained operator access';exception when insufficient_privilege then null;end;
end$$;
reset role;set local role anon;
do $$begin begin perform public.openfolk_business_review(null,'x','test','{}');raise exception 'Anon admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local role service_role;
do $$begin begin perform public.openfolk_business_review(null,'x','test','{}');raise exception 'Machine admitted';exception when insufficient_privilege then null;end;end$$;
reset role;
