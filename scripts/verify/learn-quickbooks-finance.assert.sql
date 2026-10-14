-- Synthetic financial evidence only, in the disposable OAuth/import test DB.
reset role;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';
update feature_flags set value='true' where tenant_id=fixture_id(1);
insert into customer_cards values(fixture_id(501),fixture_id(1)),(fixture_id(502),fixture_id(2)),(fixture_id(503),fixture_id(1));
update profiles set tenant_id=fixture_id(1),role='admin' where id=fixture_id(11);
create function fixture_finance_denied(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then
  if sqlstate=expected then return;else raise exception 'Wrong denial code: %, expected %',sqlstate,expected;end if;
 end;raise exception 'Expected denial';end $$;
-- Insert exact synthetic provider payloads using the same retained schemas.
create function fixture_finance_source(env text,kind text,key text,p jsonb,conflict boolean default false) returns uuid
language plpgsql as $$declare v uuid;begin
 insert into learn_quickbooks_source_versions(tenant_id,environment,realm_id,entity,external_id,content_hash,payload,sync_token)
 values(fixture_id(1),env,'finance-realm',kind,key,md5(p::text),p,coalesce((p->>'SyncToken')::numeric,0)) returning id into v;
 insert into learn_quickbooks_latest values(fixture_id(1),env,'finance-realm',kind,key,v,coalesce((p->>'SyncToken')::numeric,0),null,conflict,clock_timestamp())
 on conflict(tenant_id,environment,realm_id,entity,external_id) do update set version_id=excluded.version_id,sync_token=excluded.sync_token,conflicted=excluded.conflicted,last_observed_at=excluded.last_observed_at;
 return v;end $$;
create table fixture_finance_customer as select fixture_finance_source('production','Customer','C1','{"Id":"C1","DisplayName":"Test customer","Balance":4}') id;
create function fixture_customer_version() returns uuid language sql security definer as $$select id from fixture_finance_customer$$;
select fixture_finance_source('production','Invoice','I1','{"Id":"I1","CustomerRef":{"value":"C1"},"CurrencyRef":{"value":"GBP"},"TotalAmt":9007199254740993.01,"Balance":0.10}');
select fixture_finance_source('production','Invoice','I2','{"Id":"I2","CustomerRef":{"value":"C1"},"CurrencyRef":{"value":"GBP"},"TotalAmt":0.10,"Balance":0.20}');
select fixture_finance_source('production','Invoice','I3','{"Id":"I3","CustomerRef":{"value":"C1"},"CurrencyRef":{"value":"USD"},"TotalAmt":99,"Balance":49}');
select fixture_finance_source('production','Invoice','I4','{"Id":"I4","CustomerRef":{"value":"C1"},"TotalAmt":20,"Balance":10}');
select fixture_finance_source('production','Invoice','I5','{"Id":"I5","CustomerRef":{"value":"C1"},"CurrencyRef":{"value":"EUR"},"TotalAmt":"9","Balance":"5"}');
select fixture_finance_source('production','Invoice','I6','{"Id":"I6","CustomerRef":{"value":"C1"},"CurrencyRef":{"value":"GBP"},"TotalAmt":999,"Balance":999}',true);
select fixture_finance_source('production','Payment','P1','{"Id":"P1","CustomerRef":{"value":"C1"},"CurrencyRef":{"value":"GBP"},"TotalAmt":50}');
select fixture_finance_source('sandbox','Invoice','I1','{"Id":"I1","CustomerRef":{"value":"C1"},"CurrencyRef":{"value":"GBP"},"TotalAmt":1000,"Balance":1000}');
select fixture_finance_source('production','Customer','CHILD','{"Id":"CHILD","DisplayName":"Sub customer","ParentRef":{"value":"C1"},"Job":true}');
select fixture_finance_source('production','Invoice','CHILD1','{"Id":"CHILD1","CustomerRef":{"value":"CHILD"},"CurrencyRef":{"value":"GBP"},"TotalAmt":1000,"Balance":1000}');
set role authenticated;
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(501),'production',null,'Review test')->>'linked_customers'='0','no automatic customer merge');
select fixture_finance_denied('select learn_quickbooks_customer_link(fixture_id(1),fixture_customer_version(),fixture_id(502),0,''Review test'')','42501');
select fixture_assert(learn_quickbooks_customer_link(fixture_id(1),fixture_customer_version(),fixture_id(501),0,'Review test')->>'revision'='1','reviewed link');
select fixture_finance_denied('select learn_quickbooks_customer_link(fixture_id(1),fixture_customer_version(),fixture_id(503),0,''Review test'')','40001');
do $$declare r jsonb;g jsonb;begin
 r:=learn_quickbooks_customer_finance(fixture_id(1),fixture_id(501),'production',null,'Review test');
 perform fixture_assert(r->>'records'='6' and r->>'conflicted_records'='1','scope: excludes conflicts, sandbox and unreviewed children');
 select x into g from jsonb_array_elements(r->'groups') x where x->>'currency'='GBP' and x->>'entity'='Invoice';
 perform fixture_assert(g->>'total'='9007199254740993.11' and g->>'outstanding'='0.30','exact decimals; payment not deducted twice');
 select x into g from jsonb_array_elements(r->'groups') x where x->>'currency'='USD';
 perform fixture_assert(g->>'outstanding'='49','separate USD group');
 select x into g from jsonb_array_elements(r->'groups') x where x->>'currency' is null;
 perform fixture_assert(g->>'outstanding' is null and g->>'total' is null,'unknown currencies not combined');
 select x into g from jsonb_array_elements(r->'groups') x where x->>'currency'='EUR';
 perform fixture_assert(g->>'total' is null and g->>'missing_amounts'='1' and g->>'missing_balances'='1','malformed monetary strings not coerced');
 perform fixture_assert(r->>'coverage'='retained_unreconciled_records','no full-coverage claim');
end $$;
select fixture_finance_denied('select * from learn_quickbooks_customer_links','42501');
select fixture_finance_denied('select learn_quickbooks_customer_finance(fixture_id(2),fixture_id(501),''production'',null,''Review test'')','42501');
-- Changing balance alone preserves review; changing identity withholds finance.
reset role;
update fixture_finance_customer set id=fixture_finance_source('production','Customer','C1','{"Id":"C1","DisplayName":"Test customer","Balance":8,"SyncToken":"1"}');
set role authenticated;
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(501),'production',null,'Review test')->>'records'='6','balance change retains link');
reset role;
update fixture_finance_customer set id=fixture_finance_source('production','Customer','C1','{"Id":"C1","DisplayName":"Changed identity","Balance":8,"SyncToken":"2"}');
set role authenticated;
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(501),'production',null,'Review test')->>'links_needing_review'='1','changed identity flagged');
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(501),'production',null,'Review test')->>'records'='0','changed identity finance withheld');
select learn_quickbooks_customer_link(fixture_id(1),fixture_customer_version(),fixture_id(501),1,'Reviewed changed identity');
-- Company admins can read their card, but cannot link as an operator.
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000011';
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(501))->>'records'='6','tenant admin read');
select fixture_finance_denied('select learn_quickbooks_customer_link(fixture_id(1),fixture_customer_version(),fixture_id(501),2,''Review test'')','42501');
select fixture_finance_denied('select learn_quickbooks_customer_finance(fixture_id(2),fixture_id(502))','42501');
reset role;update profiles set role='staff' where id=fixture_id(11);set role authenticated;
select fixture_finance_denied('select learn_quickbooks_customer_finance(fixture_id(1),fixture_id(501))','42501');
reset role;update profiles set role='admin' where id=fixture_id(11);update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=fixture_id(11);set role authenticated;
select fixture_finance_denied('select learn_quickbooks_customer_finance(fixture_id(1),fixture_id(501))','42501');
reset role;update auth.users set banned_until=null where id=fixture_id(11);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';set role authenticated;
select learn_quickbooks_customer_link(fixture_id(1),fixture_customer_version(),null,2,'Unlink test customer');
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(501),'production',null,'Review test')->>'linked_customers'='0','unlink reversible and retained');
reset role;
select fixture_assert((select count(*)=3 from learn_quickbooks_finance_events where event='customer.link'),'only successful decisions audited');
select fixture_finance_denied('delete from learn_quickbooks_finance_events','55000');
select fixture_assert(not has_function_privilege('anon','learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)','execute'),'anonymous access denied');
select fixture_assert(not has_function_privilege('service_role','learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)','execute'),'no service bypass of user context');
