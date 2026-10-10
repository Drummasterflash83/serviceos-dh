-- Synthetic only: real operator, queue, permit, publication and resume functions.
insert into platform_authority_grants(profile_id,permission,granted_by) values(fixture_id(180),'platform.controlplane.admin','synthetic');
insert into vault.decrypted_secrets values(fixture_id(107),'provider_secret:'||fixture_id(100)||':commusoft:api_key','SYNTHETIC_NO_NETWORK');
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;
select learn_operator_input_request(fixture_id(100),fixture_id(190),fixture_id(180),fixture_definition('enable'))->>'state';
do $$begin
 begin
  perform learn_operator_input_request(fixture_id(100),fixture_id(193),fixture_id(180),fixture_definition('start')||'{"resource":"propertyContacts","contact_type":"customer"}');
  raise exception 'Missing property traversal accepted';
 exception when object_not_in_prerequisite_state then
  if sqlerrm<>'learn_operator_property_traversal_required' then raise;end if;
 end;
end$$;
select learn_operator_input_request(fixture_id(100),fixture_id(194),fixture_id(180),fixture_definition('start'))->>'state';
reset role;

-- Force a failure after page and source-version inserts to prove atomic rollback.
create function fixture_contact_late_failure() returns trigger language plpgsql as $$begin
 if exists(select 1 from public.learn_business_input_versions where id=new.version_id and payload->>'firstName'='FAIL_LATE') then
  raise exception 'Synthetic late failure' using errcode='P0002';end if;return new;
end$$;
create trigger fixture_contact_late_failure before insert on learn_business_input_observations
 for each row execute function fixture_contact_late_failure();

create function fixture_contact_capture(p_data jsonb,p_more boolean,p_next bigint) returns jsonb language plpgsql as $$
declare j platform_jobs%rowtype;a connector_accounts%rowtype;c provider_connections%rowtype;
 b jsonb;r jsonb;target jsonb;envelope jsonb;saved jsonb;replayed jsonb;begin
 update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
 update platform_jobs set available_at=clock_timestamp()-interval '1 second' where status='queued' and tenant_id=fixture_id(100);
 select * into j from learn_commusoft_claim_jobs(fixture_id(170));
 if j.id is null then raise exception 'No synthetic job claimed';end if;
 select * into a from connector_accounts where id=(j.payload->>'connector_account_id')::uuid;
 select * into c from provider_connections where id=(a.settings->'commusoft_import'->>'connectionId')::uuid;
 b:=jsonb_build_object('tenantId',a.tenant_id,'jobId',j.id,'accountId',a.id,'connectorId',a.tenant_connector_id,'connectionId',c.id,'connectionRevision',c.updated_at,'secretId',c.secret_refs->>'api_key','approval',a.settings->'commusoft_import','checkpoint',a.sync_cursor,'pages',coalesce(a.sync_cursor->'pages','0'::jsonb),'complete',coalesce(a.sync_cursor->'complete','false'::jsonb),'request',jsonb_build_object('region','uk','resource',a.settings->'commusoft_import'->>'resource','after',a.sync_cursor->'after','limit',a.settings->'commusoft_import'->'pageSize'));
 if a.settings->'commusoft_import'->>'resource'='propertyContacts' then
  target:=learn_commusoft_contact_target(a.tenant_id,c.id,a.settings->'commusoft_import',a.sync_cursor);
  if target is null then raise exception 'Missing target';end if;
  b:=b||jsonb_build_object('contactTarget',target,'request',b->'request'||jsonb_build_object('contactType',a.settings->'commusoft_import'->>'contactType','propertyId',target->'propertyId'));
  if learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,jsonb_set(b,'{request,propertyId}','9999')) is not null then raise exception 'Caller property override allowed';end if;
  if learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,jsonb_set(b,'{contactTarget,nextPropertyId}','9999')) is not null then raise exception 'Caller successor override allowed';end if;
 end if;
 r:=learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,b);
 if r->>'state' is distinct from 'ready' then raise exception 'Synthetic permit unavailable';end if;
 if target is not null then
  begin
   perform learn_commusoft_commit_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,(r->>'permitId')::uuid,'{"data":[{"id":999999,"propertyID":9999}],"pagination":{"hasMore":false,"nextCursor":null}}');
   raise exception 'Wrong parent accepted';
  exception when invalid_parameter_value then
   if sqlerrm<>'commusoft_contact_parent_mismatch' then raise;end if;
  end;
  if exists(select 1 from learn_business_input_pages where job_id=j.id) then raise exception 'Rejected page retained';end if;
  begin
   perform learn_commusoft_commit_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,(r->>'permitId')::uuid,
    jsonb_build_object('data',jsonb_build_array(jsonb_build_object('id',999999,'propertyID',target->'propertyId','firstName','FAIL_LATE')),'pagination',jsonb_build_object('hasMore',false,'nextCursor',null)));
   raise exception 'Late failure not exercised';exception when no_data_found then
    if sqlerrm<>'Synthetic late failure' then raise;end if;
  end;
  if exists(select 1 from learn_business_input_pages where job_id=j.id)
   or exists(select 1 from learn_business_input_versions where payload->>'firstName'='FAIL_LATE')
   or (select sync_cursor from connector_accounts where id=a.id) is distinct from a.sync_cursor then raise exception 'Late failure left partial state';end if;
  if learn_commusoft_contact_target(fixture_id(101),c.id,a.settings->'commusoft_import',a.sync_cursor) is not null
   or learn_commusoft_contact_target(a.tenant_id,fixture_id(999),a.settings->'commusoft_import',a.sync_cursor) is not null then raise exception 'Cross-source target resolved';end if;

 end if;
 envelope:=jsonb_build_object('data',p_data,'pagination',jsonb_build_object('hasMore',p_more,'nextCursor',p_next));
 saved:=learn_commusoft_commit_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,(r->>'permitId')::uuid,envelope);
 replayed:=learn_commusoft_commit_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,(r->>'permitId')::uuid,envelope);
 if replayed is distinct from saved||'{"already":true}'::jsonb then raise exception 'Replay changed receipt';end if;
 if learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,b) is not null then raise exception 'Committed job reacquired secret';end if;
 perform learn_commusoft_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 return saved;
end$$;
set request.jwt.claim.role='service_role';
select fixture_contact_capture('[{"id":101,"type":"customer"},{"id":202,"type":"customer"},{"id":303,"type":"workaddress","parentPropertyID":101}]',false,null)->'checkpoint';
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_operator_input_request(fixture_id(100),fixture_id(195),fixture_id(180),fixture_definition('start')||'{"resource":"propertyContacts","contact_type":"customer","max_pages":2}')->>'state';
-- A retry of the original approval reuses the fixed plan and job.
select learn_operator_input_request(fixture_id(100),fixture_id(195),fixture_id(180),fixture_definition('start')||'{"resource":"propertyContacts","contact_type":"customer","max_pages":2}')->>'state';
reset role;
do $$begin
 if (select count(*) from learn_commusoft_contact_targets)<>2 then raise exception 'Plan has extra or missing properties';end if;
 if not exists(select 1 from learn_commusoft_contact_targets where property_id=101 and next_property_id=202 and position=1)
  or not exists(select 1 from learn_commusoft_contact_targets where property_id=202 and next_property_id is null and position=2) then raise exception 'Plan ordering differs';end if;
 if exists(select 1 from learn_commusoft_contact_targets t join learn_business_input_versions v on v.id=t.source_version_id where v.tenant_id<>t.tenant_id or v.connection_id<>t.connection_id or v.external_id<>t.property_id::text or v.payload->>'type'<>t.property_type) then raise exception 'Plan source mismatch';end if;
 if has_table_privilege('authenticated','learn_commusoft_contact_targets','SELECT') or has_table_privilege('service_role','learn_commusoft_contact_targets','INSERT')
  or has_function_privilege('service_role','learn_commusoft_contact_target(uuid,uuid,jsonb,jsonb)','execute') then raise exception 'Private plan permissions broadened';end if;
 begin update learn_commusoft_contact_targets set next_property_id=999;raise exception 'Plan changed';exception when insufficient_privilege then null;end;
end$$;
set request.jwt.claim.role='service_role';
select fixture_contact_capture('[{"id":1,"propertyID":101,"firstName":"Synthetic"}]',true,1)->'checkpoint';
select fixture_contact_capture('[]',false,null)->'checkpoint';
do $$declare a connector_accounts%rowtype;begin
 select * into a from connector_accounts where tenant_id=fixture_id(100);
 if a.sync_cursor is distinct from jsonb_build_object('approvalId',fixture_id(195),'after',null,'pages',2,'complete',false,'propertyId',202,'propertiesCompleted',1) then raise exception 'Property transition checkpoint differs';end if;
 if exists(select 1 from platform_jobs where tenant_id=fixture_id(100) and status in ('queued','running','retrying')) then raise exception 'Page budget ignored';end if;
end$$;
-- Resume exactly at the boundary; no cursor from the old property may carry over.
create function fixture_contact_resume_definition() returns jsonb language sql as $$
 select jsonb_build_object('kind','resume_commusoft','reason','Synthetic boundary continuation','account_id',a.id,'approval_id',fixture_id(195),'job_id',j.id,'connection_id',fixture_id(105),'revision','2026-01-01T00:00:00Z','checkpoint',a.sync_cursor,'max_pages',10002,'expires_at',clock_timestamp()+interval '2 hours')
 from connector_accounts a join lateral(select id from platform_jobs where tenant_id=a.tenant_id and payload->>'connector_account_id'=a.id::text order by created_at desc,id desc limit 1) j on true where a.tenant_id=fixture_id(100)
$$;
insert into fixture_input_definitions values('contact_resume',fixture_contact_resume_definition());
set request.jwt.claim.role='authenticated';set role authenticated;
do $$begin
 begin perform learn_operator_resume_commusoft(fixture_id(100),fixture_id(196),fixture_id(180),jsonb_set(fixture_definition('contact_resume'),'{checkpoint,propertyId}','101'));
  raise exception 'Old property resumed';exception when sqlstate 'PT409' then null;end;
end$$;
do $$begin
 begin perform learn_operator_resume_commusoft(fixture_id(100),fixture_id(196),fixture_id(180),fixture_definition('contact_resume')||'{"max_pages":10003}');
  raise exception 'Excess continuation allowance accepted';exception when invalid_parameter_value then null;end;
end$$;
select learn_operator_resume_commusoft(fixture_id(100),fixture_id(197),fixture_id(180),fixture_definition('contact_resume'))->>'state';
reset role;
set request.jwt.claim.role='service_role';
select fixture_contact_capture('[]',false,null)->'checkpoint';
do $$declare a connector_accounts%rowtype;begin
 select * into a from connector_accounts where tenant_id=fixture_id(100);
 if a.sync_cursor is distinct from jsonb_build_object('approvalId',fixture_id(195),'after',null,'pages',3,'complete',true,'propertyId',null,'propertiesCompleted',2) then raise exception 'Whole-plan completion differs';end if;
 if (select count(*) from learn_business_input_pages where collection='propertyContacts')<>3 or (select count(*) from learn_business_input_versions where collection='propertyContacts')<>1 then raise exception 'Retained pages duplicated or lost';end if;
 if (select count(*) from learn_commusoft_contact_targets)<>2 then raise exception 'Resume changed plan';end if;
end$$;
-- A work-address approval derives its own disjoint plan from the same traversal.
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_operator_input_request(fixture_id(100),fixture_id(198),fixture_id(180),fixture_definition('start')||'{"resource":"propertyContacts","contact_type":"workaddress"}')->>'state';
reset role;
set request.jwt.claim.role='service_role';
select fixture_contact_capture('[{"id":1,"propertyID":303,"firstName":"Synthetic site contact"}]',false,null)->'checkpoint';
-- Same contact ID with changed parent is retained as a separate source version,
-- not guessed into a new canonical person. Projection remains governed separately.
select 'Property discovery, scoped credential release, parent checks, pagination, empty properties, boundary resume, exact replay, plan retention and work-address traversal passed';
