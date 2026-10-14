-- Synthetic payloads only. These are provider observations, not edited accounts.
reset role;
select fixture_assert(learn_quickbooks_payload_variant('Customer',
 '{"Id":"1","SyncToken":"0","DisplayName":"Fixture","Balance":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z","CreateTime":"2020-01-01T10:00:00Z"}}',
 '{"Id":"1","SyncToken":"0","DisplayName":"Fixture","Balance":20,"MetaData":{"LastUpdatedTime":"2026-10-13T11:00:00Z","CreateTime":"2020-01-01T10:00:00Z"}}'),'newer computed customer balance compatible');
select fixture_assert(not learn_quickbooks_payload_variant('Customer',
 '{"Id":"1","Balance":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}',
 '{"Id":"1","Balance":20,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}'),'same timestamp different balances remain held');
select fixture_assert(not learn_quickbooks_payload_variant('Customer',
 '{"Id":"1","DisplayName":"Fixture","Balance":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}',
 '{"Id":"1","DisplayName":"Changed identity","Balance":20,"MetaData":{"LastUpdatedTime":"2026-10-13T11:00:00Z"}}'),'identity changes not classified as computed variants');
select fixture_assert(not learn_quickbooks_payload_variant('Customer',
 '{"Id":"1","Balance":10,"MetaData":{"LastUpdatedTime":"bad"}}',
 '{"Id":"1","Balance":20,"MetaData":{"LastUpdatedTime":"2026-10-13T11:00:00Z"}}'),'malformed timestamp held');
select fixture_assert(learn_quickbooks_payload_variant('Invoice',
 '{"Id":"1","TotalAmt":9007199254740993.01,"LinkedTxn":[{"TxnId":"1","TxnType":"Payment"},{"TxnId":"2","TxnType":"Payment"}]}',
 '{"Id":"1","TotalAmt":9007199254740993.01,"LinkedTxn":[{"TxnId":"2","TxnType":"Payment"},{"TxnId":"1","TxnType":"Payment"}]}'),'same transaction-reference multiset compatible');
select fixture_assert(not learn_quickbooks_payload_variant('Invoice',
 '{"Id":"1","TotalAmt":1,"LinkedTxn":[{"TxnId":"1"}]}',
 '{"Id":"1","TotalAmt":2,"LinkedTxn":[{"TxnId":"1"}]}'),'changed invoice amount held');
select fixture_assert(not learn_quickbooks_payload_variant('Invoice',
 '{"Id":"1","LinkedTxn":[{"TxnId":"1"},{"TxnId":"1"}]}',
 '{"Id":"1","LinkedTxn":[{"TxnId":"1"}]}'),'reference multiplicity preserved');
select fixture_assert(not learn_quickbooks_payload_variant('Invoice',
 '{"Id":"1","Line":[{"Id":"1"},{"Id":"2"}],"LinkedTxn":[]}',
 '{"Id":"1","Line":[{"Id":"2"},{"Id":"1"}],"LinkedTxn":[]}'),'invoice lines not reordered');
select fixture_assert(not has_function_privilege('authenticated','learn_quickbooks_payload_variant(text,jsonb,jsonb)','execute') and not has_function_privilege('service_role','learn_quickbooks_versions_compatible(uuid,uuid)','execute'),'no external helper access');
-- Exercise the actual patched page commit, including repeat/out-of-order pages.
create function fixture_variant_page(p_run integer,p_item jsonb) returns void language plpgsql as $$
declare result jsonb;definition jsonb;begin
 update learn_quickbooks_imports set state='paused' where connection_id=fixture_id(80) and state in('queued','running');
 update feature_flags set value='true' where tenant_id=fixture_id(1);
 update learn_quickbooks_connections set status='active',revision=revision+1,access_expires_at=clock_timestamp()+interval '1 hour' where id=fixture_id(80);
 definition:=jsonb_build_object('entities',jsonb_build_array('Customer'),'pageSize',2,'minorVersion',75,'maxRequests',10,'expiresAt',clock_timestamp()+interval '1 hour','reason','Synthetic variant import','resumeFrom',null);
 insert into learn_quickbooks_imports(id,tenant_id,connection_id,connection_revision,actor_id,definition,environment,realm_id,entities,page_size,minor_version,max_requests,expires_at)
 select fixture_id(p_run),tenant_id,id,revision,fixture_id(10),definition,environment,realm_id,array['Customer'],2,75,10,clock_timestamp()+interval '1 hour' from learn_quickbooks_connections where id=fixture_id(80);
 update learn_quickbooks_request_gates set next_at=clock_timestamp();
 result:=learn_quickbooks_import_acquire(fixture_id(p_run));
 perform fixture_assert(result->>'state'='ready','variant page acquired');
 perform learn_quickbooks_import_commit(fixture_id(p_run),(result->>'permitId')::uuid,jsonb_build_object('QueryResponse',jsonb_build_object('Customer',jsonb_build_array(p_item),'startPosition',1,'maxResults',1),'time','2026-10-14T10:00:00Z')::text);
end $$;
set request.jwt.claim.role='service_role';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';
select fixture_variant_page(960,'{"Id":"VARIANT","SyncToken":"0","DisplayName":"Fixture","Balance":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}');
select fixture_variant_page(961,'{"Id":"VARIANT","SyncToken":"0","DisplayName":"Fixture","Balance":20,"MetaData":{"LastUpdatedTime":"2026-10-13T11:00:00Z"}}');
select fixture_assert((select not l.conflicted and v.payload->>'Balance'='20' from learn_quickbooks_latest l join learn_quickbooks_source_versions v on v.id=l.version_id where l.external_id='VARIANT'),'newer timestamp advances the computed balance');
select fixture_variant_page(962,'{"Id":"VARIANT","SyncToken":"0","DisplayName":"Fixture","Balance":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}');
select fixture_assert((select not l.conflicted and v.payload->>'Balance'='20' from learn_quickbooks_latest l join learn_quickbooks_source_versions v on v.id=l.version_id where l.external_id='VARIANT'),'late old observation cannot roll balance back');
select fixture_variant_page(963,'{"Id":"VARIANT","SyncToken":"0","DisplayName":"Contradiction","Balance":20,"MetaData":{"LastUpdatedTime":"2026-10-13T12:00:00Z"}}');
select fixture_assert((select conflicted from learn_quickbooks_latest where external_id='VARIANT'),'unknown contradiction held');
select fixture_variant_page(964,'{"Id":"VARIANT","SyncToken":"0","DisplayName":"Fixture","Balance":30,"MetaData":{"LastUpdatedTime":"2026-10-13T13:00:00Z"}}');
select fixture_assert((select conflicted from learn_quickbooks_latest where external_id='VARIANT'),'compatible later observation cannot erase an existing unknown conflict');
select fixture_assert((select count(*)=4 from learn_quickbooks_source_versions where external_id='VARIANT') and (select count(*)=5 from learn_quickbooks_observations o join learn_quickbooks_source_versions v on v.id=o.version_id where v.external_id='VARIANT'),'all exact versions and repeat observations retained');
reset role;

select fixture_assert(learn_quickbooks_payload_variant('Vendor',
 '{"Id":"V1","SyncToken":"0","DisplayName":"Synthetic supplier","Balance":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}',
 '{"Id":"V1","SyncToken":"0","DisplayName":"Synthetic supplier","Balance":20,"MetaData":{"LastUpdatedTime":"2026-10-13T11:00:00Z"}}'),'newer supplier computed balance compatible');
select fixture_assert(not learn_quickbooks_payload_variant('Vendor',
 '{"Id":"V1","DisplayName":"Supplier","Balance":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}',
 '{"Id":"V1","DisplayName":"Changed supplier","Balance":20,"MetaData":{"LastUpdatedTime":"2026-10-13T11:00:00Z"}}'),'supplier identity change held');
select fixture_assert(not learn_quickbooks_payload_variant('Vendor',
 '{"Id":"V1","Balance":10,"BalanceWithJobs":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}',
 '{"Id":"V1","Balance":20,"BalanceWithJobs":20,"MetaData":{"LastUpdatedTime":"2026-10-13T11:00:00Z"}}'),'supplier does not inherit customer-only ignored fields');

select fixture_assert(learn_quickbooks_payload_variant('Account','{"Id":"A1","CurrentBalance":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}','{"Id":"A1","CurrentBalance":20,"MetaData":{"LastUpdatedTime":"2026-10-13T11:00:00Z"}}'),'ledger derived balance snapshot compatible');
select fixture_assert(not learn_quickbooks_payload_variant('Account','{"Id":"A1","CurrentBalance":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}','{"Id":"A1","CurrentBalance":"20","MetaData":{"LastUpdatedTime":"2026-10-13T11:00:00Z"}}'),'malformed ledger balance held');
select fixture_assert(not learn_quickbooks_payload_variant('Account','{"Id":"A1","Name":"First","CurrentBalance":10,"MetaData":{"LastUpdatedTime":"2026-10-13T10:00:00Z"}}','{"Id":"A1","Name":"Changed identity","CurrentBalance":20,"MetaData":{"LastUpdatedTime":"2026-10-13T11:00:00Z"}}'),'ledger identity change held');
select fixture_assert(learn_quickbooks_payload_variant('Purchase','{"Id":"P1","TotalAmt":1,"EntityRef":{"value":"V1","type":"Vendor","name":"Old label"}}','{"Id":"P1","TotalAmt":1,"EntityRef":{"value":"V1","type":"Vendor","name":"New label"}}'),'payee display label alone compatible');
select fixture_assert(not learn_quickbooks_payload_variant('Purchase','{"Id":"P1","EntityRef":{"value":"V1","type":"Vendor","name":"Label"}}','{"Id":"P1","EntityRef":{"value":"V2","type":"Vendor","name":"Label"}}'),'changed payee reference held');
select fixture_assert(not learn_quickbooks_payload_variant('Purchase','{"Id":"P1","EntityRef":{"value":"V1","type":"Vendor","name":"Label"}}','{"Id":"P1","EntityRef":{"value":"V1","type":"Employee","name":"New label"}}'),'payee type change held');
select fixture_assert(not learn_quickbooks_payload_variant('Purchase','{"Id":"P1","TotalAmt":1,"EntityRef":{"value":"V1","name":"Old label"}}','{"Id":"P1","TotalAmt":2,"EntityRef":{"value":"V1","name":"New label"}}'),'purchase amount change held');
