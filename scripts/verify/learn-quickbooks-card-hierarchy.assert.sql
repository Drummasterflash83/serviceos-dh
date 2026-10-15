-- Synthetic native QuickBooks hierarchy. A reviewed main account anchors its
-- descendants, but an explicit child-card decision fences that subtree.
reset role;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';
insert into customer_cards values(fixture_id(504),fixture_id(1));
create table fixture_hierarchy_root as
 select fixture_finance_source('production','Customer','HROOT',
  '{"Id":"HROOT","DisplayName":"Synthetic root"}') id;
create table fixture_hierarchy_child as
 select fixture_finance_source('production','Customer','HCHILD',
  '{"Id":"HCHILD","DisplayName":"Synthetic child","ParentRef":{"value":"HROOT"},"Job":true}') id;
grant select on fixture_hierarchy_root,fixture_hierarchy_child to authenticated;
select fixture_finance_source('production','Customer','HGRAND',
 '{"Id":"HGRAND","DisplayName":"Synthetic grandchild","ParentRef":{"value":"HCHILD"},"Job":true}');
select fixture_finance_source('production','Customer','HCONFLICT',
 '{"Id":"HCONFLICT","ParentRef":{"value":"HROOT"},"Job":true}',true);
select fixture_finance_source('production','Invoice','HINV1',
 '{"Id":"HINV1","CustomerRef":{"value":"HROOT"},"CurrencyRef":{"value":"GBP"},"TotalAmt":10,"Balance":10}');
select fixture_finance_source('production','Invoice','HINV2',
 '{"Id":"HINV2","CustomerRef":{"value":"HCHILD"},"CurrencyRef":{"value":"GBP"},"TotalAmt":20,"Balance":20}');
select fixture_finance_source('production','Payment','HPAY3',
 '{"Id":"HPAY3","CustomerRef":{"value":"HGRAND"},"CurrencyRef":{"value":"GBP"},"TotalAmt":5}');
select fixture_finance_source('production','Invoice','HINV4',
 '{"Id":"HINV4","CustomerRef":{"value":"HCONFLICT"},"CurrencyRef":{"value":"GBP"},"TotalAmt":40,"Balance":40}');
set role authenticated;
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(504),'production',null,'Hierarchy review')->>'records'='0',
 'no finance before root identity review');
select learn_quickbooks_customer_link(fixture_id(1),(select id from fixture_hierarchy_root),fixture_id(504),0,'Hierarchy review');
do $$declare r jsonb;invoices jsonb;begin
 r:=learn_quickbooks_customer_finance(fixture_id(1),fixture_id(504),'production',null,'Hierarchy review');
 perform fixture_assert(r->>'records'='3' and r->>'conflicted_records'='0',
  'reviewed root includes direct, child and grandchild transactions but not conflicted child');
 select x into invoices from jsonb_array_elements(r->'groups') x where x->>'entity'='Invoice' and x->>'currency'='GBP';
 perform fixture_assert(invoices->>'records'='2' and invoices->>'total'='30' and invoices->>'outstanding'='30',
  'exact GBP totals include native child invoice once');
end $$;
select learn_quickbooks_customer_link(fixture_id(1),(select id from fixture_hierarchy_child),fixture_id(503),0,'Separate child card');
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(504),'production',null,'Hierarchy review')->>'records'='1',
 'separately linked child and its subtree excluded from parent');
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(503),'production',null,'Hierarchy review')->>'records'='2',
 'separately reviewed child card receives native child and grandchild transactions');
select learn_quickbooks_customer_link(fixture_id(1),(select id from fixture_hierarchy_child),null,1,'Explicit child unlink');
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(504),'production',null,'Hierarchy review')->>'records'='1',
 'explicit child unlink still fences parent aggregate');
select learn_quickbooks_customer_link(fixture_id(1),(select id from fixture_hierarchy_child),fixture_id(504),2,'Same card child review');
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(504),'production',null,'Hierarchy review')->>'records'='3',
 'same-card overlapping roots do not double count transactions');
select fixture_assert(learn_quickbooks_customer_finance(fixture_id(1),fixture_id(503),'production',null,'Hierarchy review')->>'records'='0',
 'old child card no longer receives finance');
select fixture_finance_denied('select learn_quickbooks_customer_finance(fixture_id(2),fixture_id(504),''production'',null,''Hierarchy review'')','42501');
reset role;
select fixture_assert(not has_function_privilege('anon','learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)','execute'),
 'anonymous finance access remains denied');
