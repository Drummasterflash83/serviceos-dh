-- Native reference joins are tested independently of canonical publication.
reset role;
insert into learn_business_input_versions values
 (fixture_id(1101),fixture_id(1),fixture_id(992),'commusoft','properties','2010','{"id":2010,"type":"workaddress","parentPropertyID":100,"addressLine1":"3 Fictional Road"}'),
 (fixture_id(1102),fixture_id(1),fixture_id(992),'commusoft','jobs','2001','{"id":2001,"propertyID":100,"description":"Direct synthetic job","status":"completed"}'),
 (fixture_id(1103),fixture_id(1),fixture_id(992),'commusoft','jobs','2002','{"id":2002,"propertyID":2010,"description":"Site synthetic job","status":"open"}'),
 (fixture_id(1104),fixture_id(1),fixture_id(992),'commusoft','jobs','100','{"id":100,"propertyID":999,"description":"UNRELATED_JOB_SENTINEL"}'),
 (fixture_id(1105),fixture_id(1),fixture_id(992),'commusoft','propertyContacts','3001','{"id":3001,"propertyID":100,"firstName":"Synthetic","lastName":"Contact","email":"person@example.invalid","position":"Site contact"}');
insert into learn_business_input_pages select fixture_id(1200+row_number() over()::integer),fixture_id(1),fixture_id(992),'commusoft',x,clock_timestamp() from unnest(array['properties','jobs','propertyContacts'])x;
insert into learn_business_input_observations select p.id,v.id from learn_business_input_versions v join learn_business_input_pages p on p.tenant_id=v.tenant_id and p.connection_id=v.connection_id and p.collection=v.collection where v.id in(fixture_id(1101),fixture_id(1102),fixture_id(1103),fixture_id(1104),fixture_id(1105));
select fixture_finance_source('production','Invoice','CAT_INVOICE','{"Id":"CAT_INVOICE","CustomerRef":{"value":"CAT_CHILD"},"TotalAmt":9007199254740993.01,"Balance":0.10,"CurrencyRef":{"value":"GBP"}}');
select fixture_finance_source('production','Invoice','UNRELATED_INVOICE','{"Id":"UNRELATED_INVOICE","CustomerRef":{"value":"SOME_OTHER_CUSTOMER"},"TotalAmt":99}');
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';set role authenticated;
do $$declare r jsonb;v uuid;begin
 r:=learn_imported_customer_detail(fixture_id(1),'production','commusoft:'||fixture_id(992)::text||':100',fixture_id(991),'jobs',null,'Review source relationships');
 perform fixture_assert(r->>'total'='2' and position('UNRELATED_JOB_SENTINEL' in r::text)=0,'direct and site jobs included; numeric reference collision excluded');
 r:=learn_imported_customer_detail(fixture_id(1),'production','commusoft:'||fixture_id(992)::text||':100',fixture_id(991),'sites',null,'Review source relationships');
 perform fixture_assert(r->>'total'='1','native site relationship');
 r:=learn_imported_customer_detail(fixture_id(1),'production','commusoft:'||fixture_id(992)::text||':100',fixture_id(991),'contacts',null,'Review source relationships');
 perform fixture_assert(r->>'total'='1' and r->'rows'->0->>'role'='Site contact','native contact role retained without a person/account-holder claim');
 select (x->>'version_id')::uuid into v from jsonb_array_elements(learn_imported_customer_catalog(fixture_id(1),'production','quickbooks','Changed source identity',null,'Read current source')->'rows')e cross join jsonb_array_elements(e->'sources')x where x->>'external_id'='CAT1';
 r:=learn_imported_customer_detail(fixture_id(1),'production','quickbooks:finance-realm:CAT1',v,'subaccounts',null,'Review source relationships');
 perform fixture_assert(r->>'total'='1','native accounting subaccounts');
 r:=learn_imported_customer_detail(fixture_id(1),'production','quickbooks:finance-realm:CAT1',v,'transactions',null,'Review source relationships');
 perform fixture_assert(r->>'total'='1' and r->'rows'->0->>'amount'='9007199254740993.01' and r->'rows'->0->>'balance'='0.10','native hierarchy finance, exact decimal and no unrelated transactions');
 perform fixture_assert(r->>'coverage'='native_source_relationships','source relationships not a canonical matching claim');
end $$;
select fixture_finance_denied('select learn_imported_customer_detail(fixture_id(1),''production'',''commusoft:''||fixture_id(992)::text||'':100'',fixture_id(990),''jobs'',null,''Review changed source'')','PT409');
select fixture_finance_denied('select learn_imported_customer_detail(fixture_id(2),''production'',''commusoft:''||fixture_id(992)::text||'':100'',fixture_id(991),''jobs'',null,''Review foreign source'')','42501');
reset role;
select fixture_assert(not has_function_privilege('service_role','learn_imported_customer_detail(uuid,text,text,uuid,text,uuid,text)','execute') and not has_function_privilege('anon','learn_imported_customer_detail(uuid,text,text,uuid,text,uuid,text)','execute'),'no unauthenticated/service source-detail route');
