reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';set role authenticated;
do $$declare r jsonb;paired jsonb;begin
 r:=learn_imported_customer_catalog(fixture_id(1),'production','all','Paired synthetic',null,'Review captured customers');
 perform fixture_assert(jsonb_array_length(r->'rows')=2,'only reviewed links group, identical names stay separate');
 select x into paired from jsonb_array_elements(r->'rows')x where x->>'card_id'=fixture_id(990)::text;
 perform fixture_assert(jsonb_array_length(paired->'sources')=2,'reviewed provider sources together');
 perform fixture_assert(paired->'sources'->0->>'address'<>paired->'sources'->1->>'address','distinct service and billing source addresses retained');
 perform fixture_assert(position('FOREIGN_SOURCE_SENTINEL' in r::text)=0 and position('SANDBOX_SENTINEL' in r::text)=0,'tenant and environment isolated');
 perform fixture_assert(position('CAT_CHILD' in r::text)=0,'subaccounts not falsely listed as main customers');
 perform fixture_assert(r->>'operator_mode'='true' and r->>'actor_id'=fixture_id(10)::text and r->>'coverage'='retained_source_accounts','scoped audited retained account envelope');
 r:=learn_imported_customer_catalog(fixture_id(1),'production','all','',null,'Review captured customers','card:'||fixture_id(990)::text);
 perform fixture_assert(jsonb_array_length(r->'rows')=2 and (select bool_and(jsonb_array_length(x->'sources')=1) from jsonb_array_elements(r->'rows')x),'group members separately pageable');
 r:=learn_imported_customer_catalog(fixture_id(1),'production','quickbooks','Paired synthetic',null,'Review captured customers');
 perform fixture_assert((select bool_and(x->>'provider'='quickbooks') from jsonb_array_elements(r->'rows')e cross join jsonb_array_elements(e->'sources')x),'provider filter never includes another provider');
 r:=learn_imported_customer_catalog(fixture_id(1),'production','all','%',null,'Review captured customers');
 perform fixture_assert((select coalesce(bool_and(position('%' in (x->>'name')||(x->'sources')::text)>0),true) from jsonb_array_elements(r->'rows')x),'literal query, not wildcard matching');
end $$;
select fixture_finance_denied('select learn_imported_customer_catalog(fixture_id(1),''production'',''bad'')','22023');
select fixture_finance_denied('select learn_imported_customer_catalog(fixture_id(1),''production'',''all'','''',''bogus cursor'',''Review'')','22023');
-- Company admin uses their existing finance scope, never gains another tenant.
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000011';
select fixture_assert(learn_imported_customer_catalog(fixture_id(1))->>'operator_mode'='false','own-company admin source read');
select fixture_finance_denied('select learn_imported_customer_catalog(fixture_id(2))','42501');
reset role;update profiles set role='staff' where id=fixture_id(11);set role authenticated;
select fixture_finance_denied('select learn_imported_customer_catalog(fixture_id(1))','42501');
reset role;update profiles set role='admin' where id=fixture_id(11);update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=fixture_id(11);set role authenticated;
select fixture_finance_denied('select learn_imported_customer_catalog(fixture_id(1))','42501');
reset role;update auth.users set banned_until=null where id=fixture_id(11);set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';set role authenticated;
-- Changed identity withdraws the old match without discarding either source.
reset role;select fixture_finance_source('production','Customer','CAT1','{"Id":"CAT1","SyncToken":"1","DisplayName":"Changed source identity"}');set role authenticated;
do $$declare r jsonb;begin
 r:=learn_imported_customer_catalog(fixture_id(1),'production','quickbooks','Changed source identity',null,'Review changed customer');
 perform fixture_assert(jsonb_array_length(r->'rows')=1 and r->'rows'->0->>'card_id' is null and r->'rows'->0->'sources'->0->>'review_state'='review_changed','identity drift never silently remains combined');
end $$;
reset role;
-- Bounded groups with member paging and literal pagination over real SQL rows.
insert into learn_quickbooks_source_versions(tenant_id,environment,realm_id,entity,external_id,content_hash,payload,sync_token)
select fixture_id(1),'production','finance-realm','Customer','PAGE'||g::text,'catalog-page-hash-'||g::text,jsonb_build_object('Id','PAGE'||g::text,'DisplayName','Paging synthetic customer '||g::text),0 from generate_series(1,32)g;
insert into learn_quickbooks_latest(tenant_id,environment,realm_id,entity,external_id,version_id,sync_token,last_observed_at)
select tenant_id,environment,realm_id,entity,external_id,id,0,clock_timestamp() from learn_quickbooks_source_versions where content_hash like 'catalog-page-hash-%';
set role authenticated;
do $$declare a jsonb;b jsonb;begin
 a:=learn_imported_customer_catalog(fixture_id(1),'production','quickbooks','Paging synthetic',null,'Review paged customers');
 b:=learn_imported_customer_catalog(fixture_id(1),'production','quickbooks','Paging synthetic',a->>'next_after','Review paged customers');
 perform fixture_assert(jsonb_array_length(a->'rows')=25 and jsonb_array_length(b->'rows')=7 and b->>'next_after' is null,'every retained account reachable with bounded pages');
end $$;
reset role;
select fixture_assert(not has_function_privilege('anon','learn_imported_customer_catalog(uuid,text,text,text,text,text,text)','execute') and not has_function_privilege('service_role','learn_imported_customer_catalog(uuid,text,text,text,text,text,text)','execute'),'anonymous and service access denied');
select fixture_assert(not has_function_privilege('authenticated','learn_imported_customer_sources(uuid,text)','execute'),'private source helper unavailable directly');
