-- Synthetic refresh rehearsal, rolled back by the disposable-database runner.
-- Re-observe one unchanged property, change one, add one and omit one. Retain
-- history while deriving the next contact plan only from the completed refresh.
create temporary table refresh_old_versions as select * from learn_business_input_versions;
create temporary table refresh_old_pages as select * from learn_business_input_pages;
create temporary table refresh_old_targets as select * from learn_commusoft_contact_targets;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_operator_input_request(fixture_id(100),fixture_id(220),fixture_id(180),fixture_definition('start'))->>'state';
reset role;
set request.jwt.claim.role='service_role';
select fixture_contact_capture('[{"id":101,"type":"customer"},{"id":303,"type":"workaddress","parentPropertyID":101,"description":"Updated synthetic site"}]',true,303)->'checkpoint';
-- No partial property list may become a replacement contact plan.
set request.jwt.claim.role='authenticated';set role authenticated;
do $$begin
 begin
  perform learn_operator_input_request(fixture_id(100),fixture_id(221),fixture_id(180),fixture_definition('start')||'{"resource":"propertyContacts","contact_type":"customer"}');
  raise exception 'Incomplete property refresh accepted for a contact plan';
 exception when object_not_in_prerequisite_state then
  if sqlerrm not in ('learn_operator_import_active','learn_operator_import_incomplete') then raise;end if;
 end;
end$$;
reset role;
set request.jwt.claim.role='service_role';
select fixture_contact_capture('[{"id":404,"type":"customer"}]',false,null)->'checkpoint';
do $$begin
 if exists(select * from refresh_old_versions except select * from learn_business_input_versions)
  or exists(select * from refresh_old_pages except select * from learn_business_input_pages)
  or exists(select * from refresh_old_targets except select * from learn_commusoft_contact_targets) then
  raise exception 'Refresh changed or removed retained history';end if;
 if (select count(*) from learn_business_input_versions where collection='properties' and external_id='101')<>1 then
  raise exception 'Unchanged property created a duplicate version';end if;
 if (select count(*) from learn_business_input_versions where collection='properties' and external_id='303')<>2 then
  raise exception 'Updated property did not retain both versions';end if;
 if not exists(select 1 from learn_business_input_versions where collection='properties' and external_id='202') then
  raise exception 'Omitted property history was lost';end if;
end$$;
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_operator_input_request(fixture_id(100),fixture_id(222),fixture_id(180),fixture_definition('start')||'{"resource":"propertyContacts","contact_type":"customer"}')->>'state';
reset role;
do $$begin
 if (select array_agg(property_id order by position) from learn_commusoft_contact_targets where approval_id=fixture_id(222))
  is distinct from array[101,404]::bigint[] then raise exception 'Contact plan did not use exactly the refreshed customer list';end if;
 if not exists(select 1 from connector_accounts where tenant_id=fixture_id(100)
  and settings->'commusoft_import'->>'propertyTraversalApprovalId'=fixture_id(220)::text) then
  raise exception 'Contact plan references an older traversal';end if;
 if exists(select * from refresh_old_targets except select * from learn_commusoft_contact_targets) then
  raise exception 'Starting refreshed contacts changed an earlier plan';end if;
end$$;
set request.jwt.claim.role='service_role';
select fixture_contact_capture('[]',false,null)->'checkpoint';
select fixture_contact_capture('[{"id":44,"propertyID":404,"firstName":"New synthetic customer contact"}]',false,null)->'checkpoint';
do $$begin
 if not exists(select 1 from connector_accounts where tenant_id=fixture_id(100)
  and sync_cursor->'complete'='true' and sync_cursor->>'propertiesCompleted'='2') then
  raise exception 'Refreshed customer contact traversal did not complete';end if;
 if exists(select * from refresh_old_versions except select * from learn_business_input_versions) then
  raise exception 'Refreshed contacts changed prior source versions';end if;
end$$;
select 'Completed refresh discovers new customers, retains changed/omitted history, deduplicates unchanged sources and freezes a fresh contact plan.';
