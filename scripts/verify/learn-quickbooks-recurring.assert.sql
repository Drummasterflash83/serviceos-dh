reset role;
-- Reuse synthetic worker connection; seed a completed baseline only in fixture.
update learn_quickbooks_imports set state='paused' where connection_id=fixture_id(90);
update learn_quickbooks_connections set status='paused',access_expires_at=clock_timestamp()+interval '1 hour' where id=fixture_id(90);
insert into learn_quickbooks_imports(id,tenant_id,connection_id,connection_revision,actor_id,definition,environment,realm_id,entities,page_size,minor_version,max_requests,expires_at,state)
select fixture_id(950),tenant_id,id,revision,fixture_id(10),'{}',environment,realm_id,array['Customer','Invoice','Payment','CreditMemo','SalesReceipt','Estimate','Vendor','Bill','BillPayment','Purchase','VendorCredit','Account','Item'],100,75,2000,clock_timestamp()+interval '24 hours','traversed' from learn_quickbooks_connections where id=fixture_id(90);
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';set role authenticated;
select fixture_assert(learn_quickbooks_recurring_control(fixture_id(1),fixture_id(90),true,0,2000,6,'Approved synthetic refresh')->>'enabled'='true','explicit approval');
reset role;select fixture_assert((select next_at<=clock_timestamp() from learn_quickbooks_recurring where connection_id=fixture_id(90)),'initial verification is due immediately');set role authenticated;
select fixture_finance_denied('select learn_quickbooks_recurring_control(fixture_id(1),fixture_id(90),true,0,2000,6,''Stale revision'')','PT409');
select fixture_finance_denied('select learn_quickbooks_schedule_tick()','42501');
reset role;update learn_quickbooks_recurring set next_at=clock_timestamp()-interval '1 second';set request.jwt.claim.role='service_role';set role service_role;
select fixture_assert(learn_quickbooks_schedule_tick()->>'queued'='1','due approved cycle queued');
reset role;
select fixture_assert((select count(*)=1 from learn_quickbooks_imports i join learn_quickbooks_recurring s on s.current_run=i.id where i.max_requests=2000 and i.page_size=100 and i.actor_id=fixture_id(10) and cardinality(i.entities)=13),'bounded original authority');
update learn_quickbooks_recurring set next_at=clock_timestamp()-interval '1 second';set role service_role;
select fixture_assert(learn_quickbooks_schedule_tick()->>'queued'='0','active cycle not duplicated');
reset role;set request.jwt.claim.role='authenticated';set role authenticated;
select fixture_assert(learn_quickbooks_recurring_control(fixture_id(1),fixture_id(90),false,1,2000,6,'Pause synthetic schedule')->>'enabled'='false','pause policy');
reset role;
select fixture_assert((select i.state='paused' and c.status='paused' from learn_quickbooks_recurring s join learn_quickbooks_imports i on i.id=s.current_run join learn_quickbooks_connections c on c.id=s.connection_id),'pause fences active capture');
select fixture_assert(not has_function_privilege('anon','learn_quickbooks_recurring_control(uuid,uuid,boolean,bigint,integer,integer,text)','execute') and not has_function_privilege('service_role','learn_quickbooks_recurring_control(uuid,uuid,boolean,bigint,integer,integer,text)','execute'),'only authenticated operator approval');
select fixture_assert(not has_table_privilege('authenticated','learn_quickbooks_recurring','select'),'policy table private');
-- Incomplete scan cannot be promoted into an ongoing authority.
set role authenticated;
select fixture_finance_denied('select learn_quickbooks_recurring_control(fixture_id(1),fixture_id(90),true,2,2000,6,''Incomplete baseline'')','PT409');
reset role;

-- Completed cycles can be reapproved, but each unattended tick rechecks authority.
update learn_quickbooks_imports i set state='traversed',connection_revision=c.revision,updated_at=clock_timestamp() from learn_quickbooks_connections c where i.id=(select current_run from learn_quickbooks_recurring where connection_id=fixture_id(90)) and c.id=i.connection_id;
set role authenticated;
select learn_quickbooks_recurring_control(fixture_id(1),fixture_id(90),true,2,2000,6,'Reapproved complete baseline');
reset role;update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=fixture_id(10);update learn_quickbooks_recurring set next_at=clock_timestamp()-interval '1 second';
set request.jwt.claim.role='service_role';set role service_role;
select fixture_assert(learn_quickbooks_schedule_tick()->>'held'='1','banned actor blocks unattended capture');
reset role;update auth.users set banned_until=null where id=fixture_id(10);update feature_flags set value='false' where tenant_id=fixture_id(1) and flag='learn.enabled';update learn_quickbooks_recurring set next_at=clock_timestamp()-interval '1 second';set role service_role;
select fixture_assert(learn_quickbooks_schedule_tick()->>'held'='1','master switch blocks new cycle');
reset role;update feature_flags set value='true' where tenant_id=fixture_id(1);update learn_quickbooks_connections set revision=revision+1 where id=fixture_id(90);update learn_quickbooks_recurring set next_at=clock_timestamp()-interval '1 second';set role service_role;
select fixture_assert(learn_quickbooks_schedule_tick()->>'held'='1','external connection change holds policy');
reset role;
select fixture_assert((select count(*)=1 from learn_quickbooks_events where event='scheduled_import_started'),'held ticks create no new run');
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_quickbooks_recurring_control(fixture_id(1),fixture_id(90),false,3,2000,6,'End synthetic approval');
reset role;
