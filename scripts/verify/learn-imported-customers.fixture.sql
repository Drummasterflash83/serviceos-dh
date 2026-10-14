-- Synthetic source models matching only columns used by the retained reader.
alter table customer_cards add column title text;
create table learn_business_input_versions(id uuid primary key,tenant_id uuid,connection_id uuid,provider text,collection text,external_id text,payload jsonb);
create table learn_business_input_pages(id uuid primary key,tenant_id uuid,connection_id uuid,provider text,collection text,committed_at timestamptz);
create table learn_business_input_observations(page_id uuid,version_id uuid);
create table learn_business_input_links(id uuid primary key,tenant_id uuid,connection_id uuid,provider text,collection text,external_id text,entity_kind text,card_id uuid,source_version_id uuid);
revoke all on learn_business_input_versions,learn_business_input_pages,learn_business_input_observations,learn_business_input_links from public,anon,authenticated,service_role;
insert into customer_cards(id,tenant_id,title) values(fixture_id(990),fixture_id(1),'Paired synthetic customer');
insert into learn_business_input_versions values(fixture_id(991),fixture_id(1),fixture_id(992),'commusoft','properties','100','{"id":100,"type":"customer","companyName":"Paired synthetic customer","contact":{"firstName":"Source","lastName":"Contact","email":"contact@example.invalid"},"addressLine1":"1 Fictional Road","postcode":"FA1 1KE"}');
insert into learn_business_input_pages values(fixture_id(993),fixture_id(1),fixture_id(992),'commusoft','properties',clock_timestamp());
insert into learn_business_input_observations values(fixture_id(993),fixture_id(991));
insert into learn_business_input_links values(fixture_id(994),fixture_id(1),fixture_id(992),'commusoft','properties','100','customer',fixture_id(990),fixture_id(991));
select fixture_finance_source('production','Customer','CAT1','{"Id":"CAT1","DisplayName":"Paired synthetic customer","CompanyName":"Synthetic trading alias","PrimaryEmailAddr":{"Address":"billing@example.invalid"},"BillAddr":{"Line1":"2 Fictional Road","PostalCode":"FA2 2KE"},"Active":true}');
insert into learn_quickbooks_customer_links(tenant_id,environment,realm_id,external_id,card_id,reviewed_version,identity,revision,reviewed_by)
select l.tenant_id,l.environment,l.realm_id,l.external_id,fixture_id(990),l.version_id,learn_quickbooks_customer_identity(v.payload),1,fixture_id(10) from learn_quickbooks_latest l join learn_quickbooks_source_versions v on v.id=l.version_id where l.external_id='CAT1';
select fixture_finance_source('production','Customer','DUPLICATE','{"Id":"DUPLICATE","DisplayName":"Paired synthetic customer","PrimaryEmailAddr":{"Address":"billing@example.invalid"}}');
select fixture_finance_source('production','Customer','CAT_CHILD','{"Id":"CAT_CHILD","DisplayName":"Synthetic subaccount","ParentRef":{"value":"CAT1"},"Job":true}');
select fixture_finance_source('sandbox','Customer','SANDBOX_SENTINEL','{"Id":"SANDBOX_SENTINEL","DisplayName":"Sandbox-only source"}');
insert into learn_business_input_versions values(fixture_id(995),fixture_id(2),fixture_id(996),'commusoft','properties','100','{"id":100,"type":"customer","companyName":"FOREIGN_SOURCE_SENTINEL"}');
insert into learn_business_input_pages values(fixture_id(997),fixture_id(2),fixture_id(996),'commusoft','properties',clock_timestamp());
insert into learn_business_input_observations values(fixture_id(997),fixture_id(995));
