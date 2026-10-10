set request.jwt.claim.role='service_role';
do $$begin
 assert not has_table_privilege('service_role','learn_business_input_links','INSERT');
 assert not has_table_privilege('authenticated','learn_business_input_links','SELECT');
 assert not has_function_privilege('authenticated','learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)','EXECUTE');
 assert not has_function_privilege('anon','learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)','EXECUTE');
end $$;
-- Execute through the real service role; no table grants are needed by the caller.
set role service_role;
select fixture_review(1,'person',null);
select fixture_review(2,'company',null);
select fixture_review(3,'person',fixture_id(83));
select fixture_review(8,'company',fixture_id(85));
reset role;
do $$declare r jsonb; l learn_business_input_links%rowtype;begin
 assert (select count(*) from learn_business_input_links)=4;
 assert (select count(*) from people)=3 and (select count(*) from companies)=2;
 assert (select to_jsonb(p) from people p where id=fixture_id(83))=(select person from fixture_customer_baseline),'existing person overwritten';
 assert (select to_jsonb(c) from customer_cards c where id=fixture_id(86))=(select card from fixture_customer_baseline),'existing card overwritten';
 assert (select count(*) from customer_cards)=4,'person-with-company and company cards must be separate';
 select * into l from learn_business_input_links where external_id='1';
 assert (select display_name='New Person' and not verified and primary_email='new@example.invalid' from people where id=l.entity_id);
 assert (select owner_id is null and latest_activity_at is null and summary is null and status='grey' from customer_cards where id=l.card_id);
 r:=fixture_review(1,'person',null);assert r->>'already'='true';
 assert (select count(*) from people)=3,'replay duplicated customer';
 begin perform fixture_review(1,'person',fixture_id(83));raise exception 'changed review accepted';exception when sqlstate 'PT409' then null;end;
 begin perform fixture_review(4,'person',null);raise exception 'workaddress became customer';exception when invalid_parameter_value then null;end;
 begin perform fixture_review(5,'person',null);raise exception 'object became name';exception when invalid_parameter_value then null;end;
 begin perform fixture_review(6,'company',null);raise exception 'unnamed company accepted';exception when invalid_parameter_value then null;end;
 begin perform fixture_review(6,'person',fixture_id(84));raise exception 'cross-tenant target accepted';exception when invalid_parameter_value then null;end;
 begin perform fixture_review(6,'person',null,fixture_id(81));raise exception 'viewer accepted';exception when insufficient_privilege then null;end;
 begin perform fixture_review(6,'person',null,fixture_id(82));raise exception 'foreign actor accepted';exception when insufficient_privilege then null;end;
 insert into view_as_context values(fixture_id(80),null,clock_timestamp()+interval '1 hour');
 begin perform fixture_review(6,'person',null);raise exception 'View-As accepted';exception when insufficient_privilege then null;end;
 delete from view_as_context;
 update feature_flags set value='false' where flag='learn.inputs.commusoft.enabled';
 begin perform fixture_review(6,'person',null);raise exception 'disabled module accepted';exception when insufficient_privilege then null;end;
 update feature_flags set value='true' where flag='learn.inputs.commusoft.enabled';
 update provider_connections set revoked_at=clock_timestamp();
 begin perform fixture_review(6,'person',null);raise exception 'revoked connection accepted';exception when insufficient_privilege then null;end;
 update provider_connections set revoked_at=null;
 begin update learn_business_input_links set actor_id=fixture_id(81);raise exception 'identity rewrite accepted';exception when insufficient_privilege then null;end;
 begin delete from learn_business_input_links;raise exception 'identity deletion accepted';exception when insufficient_privilege then null;end;
 assert (select count(*) from learn_business_input_versions)=10,'review changed retained source';
end $$;
-- Failure after creating a customer/card must roll both back while retaining source.
create function fixture_fail_link() returns trigger language plpgsql as $$begin raise exception 'injected link failure';end$$;
create trigger fixture_fail_link before insert on learn_business_input_links for each row execute function fixture_fail_link();
do $$begin
 begin perform fixture_review(6,'person',null);raise exception 'injection failed';exception when raise_exception then if sqlerrm<>'injected link failure' then raise;end if;end;
 assert (select count(*) from people)=3 and (select count(*) from customer_cards)=4;
 assert (select count(*) from learn_business_input_links)=4;
 assert (select count(*) from learn_business_input_versions)=10;
end $$;
drop trigger fixture_fail_link on learn_business_input_links;
-- A later retained observation makes the pending review stale, even if an old
-- version's first_seen timestamp appears newer. No silent selection of old values.
do $$declare permit uuid;begin
 update connector_accounts set sync_cursor='{}';
 update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
 insert into platform_jobs(id,tenant_id,job_type,status,payload,claimed_by,attempt_count,lease_expires_at,metadata,job_key)
  select fixture_id(22),tenant_id,job_type,'running',payload,claimed_by,1,clock_timestamp()+interval '1 hour','{}',job_key from platform_jobs where id=fixture_id(2);
 permit:=(fixture_acquire(fixture_expected(fixture_id(22)),fixture_id(22))->>'permitId')::uuid;
 perform learn_commusoft_commit_page(fixture_id(1),fixture_id(22),'fixture-worker',1,permit,
  '{"data":[{"id":7,"type":"customer","contact":{"firstName":"Newer"}}],"pagination":{"hasMore":false,"nextCursor":7}}');
 perform learn_commusoft_finish_job(fixture_id(1),fixture_id(22),'fixture-worker',1,'{"success":true}');
 begin perform fixture_review(7,'person',null);raise exception 'stale review accepted';exception when sqlstate 'PT409' then null;end;
end $$;
-- The same numeric provider ID on a second connection is a separate identity.
-- Publish through the actual page writer, then restore both configured bindings.
do $$declare permit uuid; original public.provider_connections%rowtype; version uuid; r jsonb;begin
 select * into original from provider_connections where id=fixture_id(5);
 update provider_connections set id=fixture_id(55) where id=fixture_id(5);
 update connector_accounts set sync_cursor='{}',settings=jsonb_set(settings,'{commusoft_import,connectionId}',to_jsonb(fixture_id(55)::text));
 update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
 insert into platform_jobs(id,tenant_id,job_type,status,payload,claimed_by,attempt_count,lease_expires_at,metadata,job_key)
  select fixture_id(23),tenant_id,job_type,'running',payload,claimed_by,1,clock_timestamp()+interval '1 hour','{}',job_key from platform_jobs where id=fixture_id(2);
 permit:=(fixture_acquire(fixture_expected(fixture_id(23)),fixture_id(23))->>'permitId')::uuid;
 perform learn_commusoft_commit_page(fixture_id(1),fixture_id(23),'fixture-worker',1,permit,
  '{"data":[{"id":1,"type":"customer","contact":{"firstName":"Different account"}}],"pagination":{"hasMore":false,"nextCursor":1}}');
 insert into provider_connections select original.*;
 select id into version from learn_business_input_versions where connection_id=fixture_id(55);
 r:=learn_commusoft_review_customer(fixture_id(1),fixture_id(80),version,'person',fixture_id(83),'Synthetic separate account review');
 assert r->>'card_id'=fixture_id(86)::text,'second connection did not reuse reviewed card';
 assert (select count(*) from learn_business_input_links where external_id='1')=2,'source identity collapsed across connections';
 assert (select entity_id from learn_business_input_links where external_id='1' and connection_id=fixture_id(5))<>fixture_id(83),'first connection was relinked';
end $$;
select 'Customer projection: creation, existing-card reuse, exact replay, authority, stale evidence, source retention and late rollback passed.';
