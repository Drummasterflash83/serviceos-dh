-- ServiceOS — Default import profiles (platform defaults, tenant_id null; source-neutral).
--
-- Commusoft mapping lives HERE as data, not in engine code. Tenants inherit these and may clone/
-- override. Idempotent on (source_system, entity_type, name) for platform rows. Additive.
--
-- ROLLBACK: delete from import_profiles where tenant_id is null and source_system in ('commusoft','generic');

create unique index if not exists import_profiles_platform_uk
  on import_profiles (source_system, entity_type, name) where tenant_id is null;

insert into import_profiles (tenant_id, source_system, entity_type, name, definition)
values
-- ── Commusoft customers ──────────────────────────────────────────────────────
(null, 'commusoft', 'customers', 'Commusoft Customers', jsonb_build_object(
  'columns', jsonb_build_array(
    jsonb_build_object('canonical','external_id','aliases',jsonb_build_array('customer id','customer_ref','customer reference','id'),'type','text'),
    jsonb_build_object('canonical','company_name','aliases',jsonb_build_array('company','company name','account name'),'type','text'),
    jsonb_build_object('canonical','first_name','aliases',jsonb_build_array('first name','forename'),'type','text'),
    jsonb_build_object('canonical','last_name','aliases',jsonb_build_array('surname','last name'),'type','text'),
    jsonb_build_object('canonical','primary_phone','aliases',jsonb_build_array('telephone','phone','tel','mobile','primary telephone'),'type','phone','required',true),
    jsonb_build_object('canonical','secondary_phone','aliases',jsonb_build_array('secondary telephone','alt phone','landline'),'type','phone'),
    jsonb_build_object('canonical','primary_email','aliases',jsonb_build_array('email','e-mail','email address'),'type','email'),
    jsonb_build_object('canonical','address_text','aliases',jsonb_build_array('address','billing address','service address','site address'),'type','text'),
    jsonb_build_object('canonical','postcode','aliases',jsonb_build_array('post code','postcode','zip'),'type','postcode'),
    jsonb_build_object('canonical','customer_type','aliases',jsonb_build_array('type','customer type'),'type','text'),
    jsonb_build_object('canonical','active','aliases',jsonb_build_array('active','active status','status'),'type','bool')
  ))),
-- ── Commusoft jobs ───────────────────────────────────────────────────────────
(null, 'commusoft', 'jobs', 'Commusoft Jobs', jsonb_build_object(
  'columns', jsonb_build_array(
    jsonb_build_object('canonical','external_id','aliases',jsonb_build_array('job id','id'),'type','text'),
    jsonb_build_object('canonical','job_number','aliases',jsonb_build_array('job number','job no','job ref','number'),'type','text'),
    jsonb_build_object('canonical','customer_external_id','aliases',jsonb_build_array('customer id','customer_ref','customer reference'),'type','text'),
    jsonb_build_object('canonical','customer_name','aliases',jsonb_build_array('customer','customer name'),'type','text'),
    jsonb_build_object('canonical','site','aliases',jsonb_build_array('site','site address'),'type','text'),
    jsonb_build_object('canonical','postcode','aliases',jsonb_build_array('post code','postcode'),'type','postcode'),
    jsonb_build_object('canonical','description','aliases',jsonb_build_array('job description','description','work'),'type','text'),
    jsonb_build_object('canonical','job_type','aliases',jsonb_build_array('job type','type'),'type','text'),
    jsonb_build_object('canonical','status','aliases',jsonb_build_array('status','job status'),'type','text'),
    jsonb_build_object('canonical','priority','aliases',jsonb_build_array('priority'),'type','text'),
    jsonb_build_object('canonical','created_date','aliases',jsonb_build_array('created date','created','logged date'),'type','date'),
    jsonb_build_object('canonical','booked_date','aliases',jsonb_build_array('booked date','appointment date'),'type','date'),
    jsonb_build_object('canonical','completed_date','aliases',jsonb_build_array('completed date','completion date'),'type','date'),
    jsonb_build_object('canonical','engineer','aliases',jsonb_build_array('engineer','assigned engineer','technician'),'type','text'),
    jsonb_build_object('canonical','team','aliases',jsonb_build_array('team','department'),'type','text'),
    jsonb_build_object('canonical','invoice_status','aliases',jsonb_build_array('invoice status','invoiced'),'type','text'),
    jsonb_build_object('canonical','quote_status','aliases',jsonb_build_array('quote status','quoted'),'type','text'),
    jsonb_build_object('canonical','value','aliases',jsonb_build_array('value','job value','total','amount'),'type','money')
  ))),
-- ── Commusoft staff / engineers ──────────────────────────────────────────────
(null, 'commusoft', 'staff', 'Commusoft Staff', jsonb_build_object(
  'columns', jsonb_build_array(
    jsonb_build_object('canonical','external_id','aliases',jsonb_build_array('employee id','staff id','id'),'type','text'),
    jsonb_build_object('canonical','display_name','aliases',jsonb_build_array('name','full name','engineer'),'type','text'),
    jsonb_build_object('canonical','first_name','aliases',jsonb_build_array('first name','forename'),'type','text'),
    jsonb_build_object('canonical','last_name','aliases',jsonb_build_array('surname','last name'),'type','text'),
    jsonb_build_object('canonical','primary_email','aliases',jsonb_build_array('email','work email','e-mail'),'type','email'),
    jsonb_build_object('canonical','primary_phone','aliases',jsonb_build_array('phone','mobile','telephone'),'type','phone'),
    jsonb_build_object('canonical','team','aliases',jsonb_build_array('team'),'type','text'),
    jsonb_build_object('canonical','department','aliases',jsonb_build_array('department'),'type','text'),
    jsonb_build_object('canonical','role','aliases',jsonb_build_array('role','job title'),'type','text'),
    jsonb_build_object('canonical','engineer_ref','aliases',jsonb_build_array('engineer reference','engineer ref'),'type','text'),
    jsonb_build_object('canonical','active','aliases',jsonb_build_array('active','active status'),'type','bool')
  )))
on conflict do nothing;
