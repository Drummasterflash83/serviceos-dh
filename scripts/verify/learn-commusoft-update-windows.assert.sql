-- Synthetic operator -> approval -> permit -> page -> recovery -> contact plan.
reset role;
create temporary table window_old_pages as select * from learn_business_input_pages;
create temporary table window_old_versions as select * from learn_business_input_versions;
create temporary table window_old_targets as select * from learn_commusoft_contact_targets;
do $$declare role_name text;v jsonb;begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(role_name,'learn_commusoft_update_window(jsonb)','execute') then
   raise exception 'Private helper exposed';end if;
 end loop;
 foreach v in array array[
  '{"updatedFrom":"2026-01-01T00:00:00.000Z"}'::jsonb,
  '{"updatedBefore":"2026-01-02T00:00:00.000Z"}'::jsonb,
  '{"updatedFrom":null,"updatedBefore":null}'::jsonb,
  '{"updatedFrom":"2026-02-30T00:00:00.000Z","updatedBefore":"2026-03-02T00:00:00.000Z"}'::jsonb,
  '{"updatedFrom":"2026-01-01T00:00:00Z","updatedBefore":"2026-01-02T00:00:00.000Z"}'::jsonb,
  '{"updatedFrom":"2026-01-02T00:00:00.000Z","updatedBefore":"2026-01-01T00:00:00.000Z"}'::jsonb
 ] loop
  begin perform learn_commusoft_update_window(v);raise exception 'Invalid window accepted';
  exception when invalid_parameter_value then null;end;
 end loop;
 if learn_commusoft_update_window('{}')<>'{}' then raise exception 'Full import changed';end if;
end$$;

-- Extend the synthetic provider bridge with the exact request-bound window.
do $$declare d text;needle text:=' r:=learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,b);';begin
 d:=pg_get_functiondef('fixture_contact_capture(jsonb,boolean,bigint)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Bridge drift';end if;
 execute replace(d,needle,$new$
 if a.settings->'commusoft_import' ? 'updatedFrom' then
  if learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,b) is not null then
   raise exception 'Window omitted from permit';end if;
  b:=jsonb_set(b,'{request}',b->'request'||learn_commusoft_update_window(a.settings->'commusoft_import'));
  if learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,
    jsonb_set(b,'{request,updatedFrom}','"2020-01-01T00:00:00.000Z"')) is not null then
   raise exception 'Expanded window accepted';end if;
 end if;
 r:=learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,b);$new$);
end$$;

set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;
do $$begin
 begin perform learn_operator_input_request(fixture_id(100),fixture_id(300),fixture_id(180),fixture_definition('start')||
  '{"updatedFrom":"2026-01-01T00:00:00.000Z","updatedBefore":"9999-01-01T00:00:00.000Z"}');
  raise exception 'Future window accepted';exception when invalid_parameter_value then null;end;
end$$;
select learn_operator_input_request(fixture_id(100),fixture_id(301),fixture_id(180),fixture_definition('start')||
 '{"max_pages":1,"updatedFrom":"2026-01-01T00:00:00.000Z","updatedBefore":"2026-01-02T00:00:00.000Z"}')->>'state';
reset role;
set request.jwt.claim.role='service_role';
select fixture_contact_capture('[{"id":101,"type":"customer","description":"Updated synthetic customer"}]',true,101)->'checkpoint';
insert into fixture_input_definitions
 select 'window_resume',jsonb_build_object('kind','resume_commusoft','reason','Synthetic update window continuation',
  'account_id',a.id,'approval_id',a.settings->'commusoft_import'->>'approvalId','job_id',j.id,
  'connection_id',fixture_id(105),'revision','2026-01-01T00:00:00Z','checkpoint',a.sync_cursor,
  'max_pages',2,'expires_at',clock_timestamp()+interval '3 hours')
 from connector_accounts a join platform_jobs j on j.tenant_id=a.tenant_id
  and j.metadata->'commusoft_page_v1'->'checkpoint'=a.sync_cursor
 where a.tenant_id=fixture_id(100);
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_operator_resume_commusoft(fixture_id(100),fixture_id(302),fixture_id(180),fixture_definition('window_resume'))->>'state';
reset role;
set request.jwt.claim.role='service_role';
select fixture_contact_capture('[]',false,null)->'checkpoint';
do $$begin
 if (select count(*) from learn_business_input_versions where collection='properties' and external_id='101')<>2 then
  raise exception 'Changed record did not retain both versions';end if;
 if exists(select * from window_old_pages except select * from learn_business_input_pages)
  or exists(select * from window_old_versions except select * from learn_business_input_versions)
  or exists(select * from window_old_targets except select * from learn_commusoft_contact_targets) then
  raise exception 'Prior source history changed';end if;
 if (select count(*) from learn_business_input_request_permits where binding->'approval'->>'approvalId'=fixture_id(301)::text
  and binding->'request'->>'updatedFrom'='2026-01-01T00:00:00.000Z'
  and binding->'request'->>'updatedBefore'='2026-01-02T00:00:00.000Z')<>2 then
  raise exception 'Window changed on continuation';end if;
 if exists(select 1 from platform_jobs where result->'receipt'->'checkpoint'->>'approvalId'=fixture_id(301)::text
  and result->>'coverage'<>'one_update_window') then raise exception 'Window called whole collection';end if;
end$$;

set request.jwt.claim.role='authenticated';set role authenticated;
select learn_operator_input_request(fixture_id(100),fixture_id(303),fixture_id(180),fixture_definition('start')||
 '{"resource":"propertyContacts","contact_type":"customer"}')->>'state';
reset role;
do $$begin
 if (select array_agg(property_id order by position) from learn_commusoft_contact_targets where approval_id=fixture_id(303))
  is distinct from array[101,202]::bigint[] then raise exception 'Incremental pass shrank contact coverage';end if;
 if (select settings->'commusoft_import'->>'propertyTraversalApprovalId' from connector_accounts where tenant_id=fixture_id(100))
  is distinct from fixture_id(194)::text then raise exception 'Partial window used as complete property inventory';end if;
end$$;
select 'Fixed bounds, future/partial rejection, exact permit binding, resumed window, changed-version retention and full contact-parent coverage passed';
