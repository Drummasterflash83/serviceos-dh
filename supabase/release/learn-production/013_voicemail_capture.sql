-- DRAFT: requires matched voicemail workers and explicit production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;actual_views jsonb;actual_storage jsonb;actual_buckets jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Voicemail target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_cards_delivery_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='57eb47d78df8352b6e24cd2d26081231381ca6e37a6ef86f51e2a9ce9584e166') then raise exception 'Pinned production Cards prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_voicemail_capture_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['receptionist_voicemail_email_routes','receptionist_voicemail_intakes','receptionist_voicemail_sources','receptionist_voicemail_jobs','receptionist_voicemail_job_receipts','receptionist_voicemail_scans','receptionist_voicemail_candidates','receptionist_voicemail_scan_receipts','receptionist_voicemail_dispatch_receipts']))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['voicemail_intake_immutable','voicemail_intake_route','voicemail_intake_prepare','voicemail_intake_publish','voicemail_job_immutable','voicemail_queue_step','voicemail_queue_recover','voicemail_discover_page','voicemail_discovery_status','voicemail_schedule_tick','voicemail_discovery_status_data','learn_operator_voicemail_status','learn_voicemail_mailboxes'])) then raise exception 'Production Voicemail candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (-- Read-only release planning metadata. No source rows, credentials or SQL bodies.
select jsonb_build_object(
 'tables',(select coalesce(jsonb_agg(x order by x->>'name'),'[]') from (
  select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),
   'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,
    'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,
    'defaultHash',md5(pg_get_expr(d.adbin,d.adrelid))) order by a.attnum),'[]')
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,
    'kind',k.contype,'validated',k.convalidated,'hash',md5(pg_get_constraintdef(k.oid))) order by k.conname),'[]')
    from pg_constraint k where k.conrelid=c.oid),
   'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',i.relname,
    'valid',z.indisvalid,'hash',md5(pg_get_indexdef(i.oid))) order by i.relname),'[]')
    from pg_index z join pg_class i on i.oid=z.indexrelid where z.indrelid=c.oid),
   'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,
    'enabled',t.tgenabled,'hash',md5(pg_get_triggerdef(t.oid))) order by t.tgname),'[]')
    from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.policyname,
    'roles',p.roles,'command',p.cmd,'permissive',p.permissive,
    'usingHash',md5(p.qual),'checkHash',md5(p.with_check)) order by p.policyname),'[]')
    from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
   'acl',(select coalesce(jsonb_agg(jsonb_build_object('role',case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
    'privilege',g.privilege_type,'grantable',g.is_grantable) order by g.grantee=0,pg_get_userbyid(g.grantee),g.privilege_type),'[]')
    from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) g)
  ) x from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
 ) q),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
  'arguments',pg_get_function_identity_arguments(p.oid),'hash',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,
  'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,
  'hash',md5(pg_get_viewdef(c.oid)),'owner',pg_get_userbyid(c.relowner),'options',c.reloptions) order by c.relname),'[]')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m'))
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['email_accounts','email_messages','jobs','people','platform_jobs','profiles','receptionist_mailbox_managers','receptionist_mailboxes','receptionist_voicemail_access_log','receptionist_voicemails','tenants']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_accounts","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"email_address","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"backfill_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"4211c0ccfcd36b328b71623726ce8860"},{"name":"backfill_started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_page_token","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_total_fetched","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"backfill_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"history_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"auth_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"auth_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"auth_state_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_incremental_success_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_incremental_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_sync_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"8c5f1fef9bc0a6370581ec2612f6593c","name":"email_accounts_pkey","valid":true},{"hash":"ff306db49bb9dce90ff69d94e1efedb3","name":"email_accounts_tenant_id_idx","valid":true},{"hash":"448b9e573800fcb3258f76a4e34378ff","name":"email_accounts_tenant_id_provider_email_address_key","valid":true},{"hash":"89919591661cca90db7edf45969364bb","name":"email_accounts_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"email_account_protocol_select_v2","roles":["email_ingestion_protocol_owner"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"},{"name":"email_account_protocol_update_v2","roles":["email_ingestion_protocol_owner"],"command":"UPDATE","checkHash":"b326b5062b2f0e69046810717534cb09","usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"},{"name":"email_accounts_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"3b4b9e3afc4712c0a2eca19c2229c541","name":"email_accounts_set_updated_at","enabled":"O"},{"hash":"accbfe67aad061aa9a75c8245235fa8a","name":"email_ingestion_account_guard_v2","enabled":"O"},{"hash":"594d8a952306667e5cf9b6c8df56c8df","name":"marketing_capability_sync_email_accounts","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_accounts_pkey","validated":true},{"hash":"6a887a787213a24fb65c3f1c76dab1b6","kind":"u","name":"email_accounts_tenant_id_provider_email_address_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_messages","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"provider_message_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"provider_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"cc_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"snippet","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_html","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sent_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"received_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"origin","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_delivery_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_automation_intent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"ddab13827db6fc862b347926210f2b5f","name":"email_messages_from_idx","valid":true},{"hash":"aa0806d4070a7b3212a80a84eb9c7d5c","name":"email_messages_pkey","valid":true},{"hash":"b6c142a1e1681434cb7a2e0292da277d","name":"email_messages_received_idx","valid":true},{"hash":"fe1c7bcc6524405f48f28a236599ee8e","name":"email_messages_tenant_id_idx","valid":true},{"hash":"ca8629c22d3dd310b1126f117b9b008b","name":"email_messages_tenant_id_provider_provider_message_id_key","valid":true},{"hash":"a2e59fd4b71cb47545b35622ff50fd81","name":"email_messages_thread_idx","valid":true}],"forceRls":false,"policies":[{"name":"email_messages_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_card_email_source_read","roles":["learn_card_communication_reader"],"command":"SELECT","checkHash":null,"usingHash":"2a5553540e81f719dbc24055f40ca56d","permissive":"PERMISSIVE"},{"name":"learn_cards_production_boundary","roles":["learn_card_communication_reader"],"command":"SELECT","checkHash":null,"usingHash":"2a5553540e81f719dbc24055f40ca56d","permissive":"RESTRICTIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"87e7af360d7a3fb98bcdea12d9105317","name":"email_messages_set_updated_at","enabled":"O"},{"hash":"f0031e3b13fd91945cc5615cee21adab","name":"learn_email_preserve_source_version","enabled":"O"}],"constraints":[{"hash":"b62110fa0a5753efbae5ef5b8caccc97","kind":"f","name":"email_messages_origin_campaign_fk","validated":true},{"hash":"1220af29a1985a4dabe03353bd48d8fe","kind":"c","name":"email_messages_origin_check","validated":true},{"hash":"a30c441924cbce62b8ad5027db53e1c5","kind":"f","name":"email_messages_origin_delivery_fk","validated":true},{"hash":"19a3d8f70792afd54bb9f0f14df3e6a6","kind":"f","name":"email_messages_origin_intent_fk","validated":true},{"hash":"e865d926f40b1e90e54c88f2d92a7bc1","kind":"f","name":"email_messages_origin_person_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_messages_pkey","validated":true},{"hash":"7b594e8645b3085fdc803326bd97c4e4","kind":"u","name":"email_messages_tenant_id_provider_provider_message_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"site_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"engineer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"invoice_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"quote_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"value_pennies","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"booked_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ee37b3b19e0eb6a9ec843fb638bb846b"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"e2b5d04060b50f96e02ff49b339ed40c","name":"jobs_number_uk","valid":true},{"hash":"47262421c727307ac344956cf7d14923","name":"jobs_pkey","valid":true},{"hash":"e34e04d2ff2d6c0312b227bd2c49508c","name":"jobs_source_uk","valid":true},{"hash":"cc280df5dbcf661faf07141d3eecca73","name":"jobs_tenant_customer_idx","valid":true},{"hash":"184a00fe1e8d9d8202141da43859208a","name":"jobs_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"6531df5998769ed5ffb7779d6ce6dfbb","name":"jobs_set_updated_at","enabled":"O"},{"hash":"9e38c2eb0e81c9ead9a4527ff2bc657e","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"08723955dee11c6cd8edfc8398afbaa0","kind":"f","name":"jobs_customer_company_id_fkey","validated":true},{"hash":"916bf00abad8f3f94f73abdcedf20f1d","kind":"f","name":"jobs_customer_person_id_fkey","validated":true},{"hash":"e51bea4de5e209d1bec8820944969827","kind":"f","name":"jobs_engineer_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"jobs_pkey","validated":true},{"hash":"d17aadc9a7f4da0432796d76a1939418","kind":"f","name":"jobs_site_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"people","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"first_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"primary_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"primary_phone","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"address_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"postcode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"1a8b3beb83e2f08c9500a4a18238042d","name":"people_pkey","valid":true},{"hash":"1e2102652fc5b864ea0d57177355974f","name":"people_tenant_company_idx","valid":true},{"hash":"cb1a308c5d9e9b5215cd6c95b9457f38","name":"people_tenant_email_idx","valid":true},{"hash":"9b4fe18f0a581f205f2e61e3e4b38164","name":"people_tenant_id_uk","valid":true},{"hash":"fa3e7cb1191bafb9f0e8edd6a6f60434","name":"people_tenant_idx","valid":true},{"hash":"301186b8ad8b84b5970039e703cf0b60","name":"people_tenant_name_idx","valid":true},{"hash":"c8712f809e58386d8e5cc526441e3b9f","name":"people_tenant_phone_idx","valid":true}],"forceRls":false,"policies":[{"name":"people_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"a49717171f853266db7a99a56baaba1c","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"7dd86e31a8486f3dd2deddede5d2eded","name":"people_set_updated_at","enabled":"O"}],"constraints":[{"hash":"c393f886f52b6010a512c5c0980ab536","kind":"f","name":"people_company_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"people_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"module_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"job_key","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"7c86ea6e5094355ad44b6867fa51b433"},{"name":"priority","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"f899139df5e1059396431415e770c6dd"},{"name":"progress_current","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"progress_total","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"attempt_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"max_attempts","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"eccbc87e4b5ce2fe28308fd9f2a7baf3"},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"failed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cancelled_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"next_run_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"result","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"available_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"lease_expires_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"dead_lettered_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"error_code","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"parent_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"e8ec53579fc23c9f8c7ec9cbcc9a0fe8","name":"platform_jobs_active_job_key_uk","valid":true},{"hash":"0c8ea2ecee43cf1b569083bac92b3889","name":"platform_jobs_claim_idx","valid":true},{"hash":"95f16cdddc29e798beb223f90905fec3","name":"platform_jobs_lease_idx","valid":true},{"hash":"a2be2946f7e3402dc0501da0f336f113","name":"platform_jobs_parent_idx","valid":true},{"hash":"f8699761f53393f77b94bc724a99e825","name":"platform_jobs_pkey","valid":true},{"hash":"95bfc00526e7f302fb99702339694c04","name":"platform_jobs_tenant_connector_idx","valid":true},{"hash":"1ed91a0d9b3bf296158e7c4558ce3189","name":"platform_jobs_tenant_next_run_idx","valid":true},{"hash":"a22868c903eedcb64e7366fb3249911f","name":"platform_jobs_tenant_status_idx","valid":true},{"hash":"a3359af1d6c9ed909e3b424d77e7a174","name":"platform_jobs_tenant_type_idx","valid":true}],"forceRls":false,"policies":[{"name":"platform_jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"885bc7f92806b78eac67d45a9143c9ca","name":"platform_jobs_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_jobs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"full_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ebe5151db32cb9795191097a4f9511a9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b7142bbffc23de763c1bd9f00489ec05","name":"profiles_pkey","valid":true},{"hash":"c07a523f1ebc968ab6b32bd5c984f32b","name":"profiles_role_idx","valid":true},{"hash":"610436088a5788625dd6956b9059f8c9","name":"profiles_tenant_id_idx","valid":true},{"hash":"84b975915f84814cf35c7604d4f94ecf","name":"profiles_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"learn_card_communication_profile","roles":["learn_card_communication_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_cards_production_boundary","roles":["learn_card_communication_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"learn_launch_metadata_profile","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"profiles_select_own","roles":["public"],"command":"SELECT","checkHash":null,"usingHash":"bc9c729a84690340789a4e4f01175335","permissive":"PERMISSIVE"}],"triggers":[{"hash":"bb3752d7064fd9e06fbe457f475928cc","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"83b0936855bf3bb7daa4f8356eb3c926","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a97ecad600d272e906bb06dea0b91c4","name":"profiles_set_updated_at","enabled":"O"}],"constraints":[{"hash":"0061c9fb3a9abcf2edbcd4a42467a9c3","kind":"f","name":"profiles_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"profiles_pkey","validated":true},{"hash":"4b3bd90c7f38a26788aecebbe2479ad7","kind":"c","name":"profiles_role_check","validated":true}]},{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"receptionist_mailbox_managers","owner":"postgres","columns":[{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"mailbox_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"user_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"granted_by","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"granted_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2fc1886c37ce7743e8003e613e1d95ce","name":"receptionist_mailbox_managers_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"0f0ffae05b084668885444fceb55548c","kind":"f","name":"receptionist_mailbox_managers_granted_by_fkey","validated":true},{"hash":"3e36c585668d5387ed438e8246fe8946","kind":"p","name":"receptionist_mailbox_managers_pkey","validated":true},{"hash":"b609582b96875a0b479cbf4ca77208bb","kind":"f","name":"receptionist_mailbox_managers_tenant_id_mailbox_id_fkey","validated":true},{"hash":"e6f2b822f3d1e554defc759e49a034fa","kind":"f","name":"receptionist_mailbox_managers_user_id_fkey","validated":true}]},{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"receptionist_mailboxes","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"1e7fbedb66a5b27204a728ef5abf3ac0"},{"name":"provider_mailbox_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"extension","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"owner_user_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"notification_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email_enabled","type":"boolean","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sync_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"28ce5a71e69be110f3df83353630000c"},{"name":"last_synced_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"a7ef3ba4ec400f7fb92a99180d47ec06","name":"receptionist_mailboxes_pkey","valid":true},{"hash":"0bb70960aa4bd2dae0864f3954cff3f5","name":"receptionist_mailboxes_tenant_id_id_key","valid":true},{"hash":"c290fb9d3cf2294717f8cae72846b09d","name":"receptionist_mailboxes_tenant_id_provider_provider_mailbox__key","valid":true}],"forceRls":false,"policies":[{"name":"voicemail_mailbox_read","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"992574d7e134ceeb046b472c5521b3b3","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"afd0f955a8d6f96959d1535f2be99a1d","kind":"c","name":"receptionist_mailboxes_check","validated":true},{"hash":"7057c0107225a0582d64dc6f36793dc7","kind":"f","name":"receptionist_mailboxes_owner_user_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"receptionist_mailboxes_pkey","validated":true},{"hash":"912248302464031ce895e7145c8294b8","kind":"c","name":"receptionist_mailboxes_sync_state_check","validated":true},{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"receptionist_mailboxes_tenant_id_fkey","validated":true},{"hash":"51ee2716dc1abea90609c31b3f3c041c","kind":"u","name":"receptionist_mailboxes_tenant_id_id_key","validated":true},{"hash":"786dd5ad16619b6e399cb02efd330b8b","kind":"u","name":"receptionist_mailboxes_tenant_id_provider_provider_mailbox__key","validated":true}]},{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"receptionist_voicemail_access_log","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"message_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"action","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"79dc036e784e5d614cebc357246eb118","name":"receptionist_voicemail_access_log_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"24c9030190c753ba2b826b734a267cac","kind":"c","name":"receptionist_voicemail_access_log_action_check","validated":true},{"hash":"508a4cf20410e80e6cb722233bc03330","kind":"f","name":"receptionist_voicemail_access_log_actor_id_fkey","validated":true},{"hash":"97e26dd2b4409c8aa88c152de89be62a","kind":"f","name":"receptionist_voicemail_access_log_message_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"receptionist_voicemail_access_log_pkey","validated":true}]},{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"receptionist_voicemails","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"mailbox_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider_message_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"owner_user_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"received_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"caller_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"caller_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"duration_seconds","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"transcript","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"email_evidence_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email_evidence_reference","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email_recipient","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recording_path","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recording_available","type":"boolean","notNull":false,"identity":"","generated":"s","defaultHash":"30fceb280b7557d3d7b431ae34931a70"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b3661596ea2625287c74fe88f3943dcf","name":"receptionist_voicemails_mailbox_id_provider_message_id_key","valid":true},{"hash":"9c8b1c18af75d8370d90b183c7c75a93","name":"receptionist_voicemails_pkey","valid":true},{"hash":"132dca08a095a78799e22c58cdaf7edb","name":"receptionist_voicemails_tenant_id_mailbox_id_received_at_id_idx","valid":true}],"forceRls":false,"policies":[{"name":"voicemail_message_read","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"45560f96dd06a3f80d3518b6b79c63c8","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"a5d2f5b43698ba8e25d6b759bea82eab","kind":"c","name":"receptionist_voicemails_check","validated":true},{"hash":"42fc1d659c1296f70b21f6ffc0902f3a","kind":"c","name":"receptionist_voicemails_check1","validated":true},{"hash":"fdfa3ef9bd4f3d417db2a2daf4294fd8","kind":"c","name":"receptionist_voicemails_duration_seconds_check","validated":true},{"hash":"df218027cc0ac12578c0847f76bd5f4f","kind":"c","name":"receptionist_voicemails_email_status_check","validated":true},{"hash":"16d4b5d7ecdbef4a689a4aefc3c43d9a","kind":"u","name":"receptionist_voicemails_mailbox_id_provider_message_id_key","validated":true},{"hash":"7057c0107225a0582d64dc6f36793dc7","kind":"f","name":"receptionist_voicemails_owner_user_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"receptionist_voicemails_pkey","validated":true},{"hash":"b609582b96875a0b479cbf4ca77208bb","kind":"f","name":"receptionist_voicemails_tenant_id_mailbox_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"slug","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"industry","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5284b9c618f8618b72a402ea2c593753","name":"tenants_pkey","valid":true},{"hash":"6260c986ce2d58a0ad3de3f74ec6eb6f","name":"tenants_slug_key","valid":true}],"forceRls":false,"policies":[{"name":"tenants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"831f798d620de1d73971187d41079b4d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8009f8efa07661ab809d3f9e077da55e","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"742cd63e2f0ed7809f0911b17d02869d","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a4d62ca55c88b97023eab7696e527ce","name":"tenants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenants_pkey","validated":true},{"hash":"687397275d0e852fb2a4b50394adffee","kind":"u","name":"tenants_slug_key","validated":true},{"hash":"7702cc7b97df1ebce81e13bb05db5c2d","kind":"c","name":"tenants_status_check","validated":true}]}]'::jsonb then raise exception 'Production Voicemail table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (-- Read-only release planning metadata. No source rows, credentials or SQL bodies.
select jsonb_build_object(
 'tables',(select coalesce(jsonb_agg(x order by x->>'name'),'[]') from (
  select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),
   'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,
    'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,
    'defaultHash',md5(pg_get_expr(d.adbin,d.adrelid))) order by a.attnum),'[]')
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,
    'kind',k.contype,'validated',k.convalidated,'hash',md5(pg_get_constraintdef(k.oid))) order by k.conname),'[]')
    from pg_constraint k where k.conrelid=c.oid),
   'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',i.relname,
    'valid',z.indisvalid,'hash',md5(pg_get_indexdef(i.oid))) order by i.relname),'[]')
    from pg_index z join pg_class i on i.oid=z.indexrelid where z.indrelid=c.oid),
   'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,
    'enabled',t.tgenabled,'hash',md5(pg_get_triggerdef(t.oid))) order by t.tgname),'[]')
    from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.policyname,
    'roles',p.roles,'command',p.cmd,'permissive',p.permissive,
    'usingHash',md5(p.qual),'checkHash',md5(p.with_check)) order by p.policyname),'[]')
    from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
   'acl',(select coalesce(jsonb_agg(jsonb_build_object('role',case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
    'privilege',g.privilege_type,'grantable',g.is_grantable) order by g.grantee=0,pg_get_userbyid(g.grantee),g.privilege_type),'[]')
    from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) g)
  ) x from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
 ) q),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
  'arguments',pg_get_function_identity_arguments(p.oid),'hash',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,
  'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,
  'hash',md5(pg_get_viewdef(c.oid)),'owner',pg_get_userbyid(c.relowner),'options',c.reloptions) order by c.relname),'[]')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m'))
) as inventory) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['can_manage_voicemail','current_tenant_id','learn_capture_allowed','learn_operator_input_access','voicemail_mailbox_summary']);
 if actual_helpers is distinct from '[{"hash":"560038503773df9976cf6017700c9da8","name":"can_manage_voicemail","owner":"postgres","arguments":"p_tenant uuid, p_mailbox uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"58873c19368521e21e846890ee429301","name":"current_tenant_id","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"cc8bc01c1ebd3da0c5f0ec5de3754667","name":"learn_capture_allowed","owner":"postgres","arguments":"p_tenant uuid, p_source text","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"6ebce242963afa929b7465a99e7608c6","name":"learn_operator_input_access","owner":"postgres","arguments":"p_tenant uuid, p_actor uuid, p_write boolean","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"90d2c6813f3bf4b31486c6d948923d7c","name":"voicemail_mailbox_summary","owner":"postgres","arguments":"p_tenant uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true}]'::jsonb then raise exception 'Production Voicemail helper baseline differs';end if;
 select jsonb_agg(v order by v->>'name') into actual_views from (-- Read-only release planning metadata. No source rows, credentials or SQL bodies.
select jsonb_build_object(
 'tables',(select coalesce(jsonb_agg(x order by x->>'name'),'[]') from (
  select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),
   'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,
    'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,
    'defaultHash',md5(pg_get_expr(d.adbin,d.adrelid))) order by a.attnum),'[]')
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,
    'kind',k.contype,'validated',k.convalidated,'hash',md5(pg_get_constraintdef(k.oid))) order by k.conname),'[]')
    from pg_constraint k where k.conrelid=c.oid),
   'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',i.relname,
    'valid',z.indisvalid,'hash',md5(pg_get_indexdef(i.oid))) order by i.relname),'[]')
    from pg_index z join pg_class i on i.oid=z.indexrelid where z.indrelid=c.oid),
   'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,
    'enabled',t.tgenabled,'hash',md5(pg_get_triggerdef(t.oid))) order by t.tgname),'[]')
    from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.policyname,
    'roles',p.roles,'command',p.cmd,'permissive',p.permissive,
    'usingHash',md5(p.qual),'checkHash',md5(p.with_check)) order by p.policyname),'[]')
    from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
   'acl',(select coalesce(jsonb_agg(jsonb_build_object('role',case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
    'privilege',g.privilege_type,'grantable',g.is_grantable) order by g.grantee=0,pg_get_userbyid(g.grantee),g.privilege_type),'[]')
    from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) g)
  ) x from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
 ) q),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
  'arguments',pg_get_function_identity_arguments(p.oid),'hash',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,
  'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,
  'hash',md5(pg_get_viewdef(c.oid)),'owner',pg_get_userbyid(c.relowner),'options',c.reloptions) order by c.relname),'[]')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m'))
) as inventory) q,lateral jsonb_array_elements(q.inventory->'views') v where v->>'name'=any(array['controlplane_current_ownership_v','learn_launch_email_accounts','learn_launch_email_messages','learn_launch_email_sync_runs','learn_launch_google_workspace_mailboxes','learn_launch_phone_calls','learn_launch_phone_recordings','learn_launch_phone_sync_runs','learn_launch_phone_transcripts','phone_recording_pipeline_state','recommendation_objects','recommendations_compat','response_refinement_trail']);
 if actual_views is distinct from '[{"hash":"f9c7f18fbcf81cbd78d3ffae9ae65402","name":"controlplane_current_ownership_v","owner":"postgres","options":["security_invoker=true"]},{"hash":"a0e44ad30cc37aaa59ff57b4c1eff2e1","name":"learn_launch_email_accounts","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"1e1cc7c2951a77221ae568bc1c8b6b48","name":"learn_launch_email_messages","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"7e335ca092e0b76374c040c58c4083c4","name":"learn_launch_email_sync_runs","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"75b31dd7c4a5fbc66a3edd2af7714e63","name":"learn_launch_google_workspace_mailboxes","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"5b71f81069d25c9bc5325ce969212a5a","name":"learn_launch_phone_calls","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"5ee434eb72215563c83dd1851683a0b6","name":"learn_launch_phone_recordings","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"561f405293a8d41abe634d9c5b95649d","name":"learn_launch_phone_sync_runs","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"cbdbc17f610ecd6cc3965a17713670de","name":"learn_launch_phone_transcripts","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"2fd37022d57de7c4c6578bd92ee31b81","name":"phone_recording_pipeline_state","owner":"postgres","options":["security_invoker=on"]},{"hash":"afd8b68d88fdbeddfe6dc42c8be29f82","name":"recommendation_objects","owner":"postgres","options":["security_invoker=on"]},{"hash":"f03f36c81d9588d216b8a3b4ea66ceee","name":"recommendations_compat","owner":"postgres","options":["security_invoker=on"]},{"hash":"46995b89f37421d838589b7fb5b1462a","name":"response_refinement_trail","owner":"postgres","options":["security_invoker=true"]}]'::jsonb then raise exception 'Production Voicemail view baseline differs';end if;
 select inventory into actual_storage from (-- Read-only release planning metadata. No source rows, credentials or SQL bodies.
select jsonb_build_object(
 'tables',(select coalesce(jsonb_agg(x order by x->>'name'),'[]') from (
  select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),
   'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,
    'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,
    'defaultHash',md5(pg_get_expr(d.adbin,d.adrelid))) order by a.attnum),'[]')
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,
    'kind',k.contype,'validated',k.convalidated,'hash',md5(pg_get_constraintdef(k.oid))) order by k.conname),'[]')
    from pg_constraint k where k.conrelid=c.oid),
   'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',i.relname,
    'valid',z.indisvalid,'hash',md5(pg_get_indexdef(i.oid))) order by i.relname),'[]')
    from pg_index z join pg_class i on i.oid=z.indexrelid where z.indrelid=c.oid),
   'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,
    'enabled',t.tgenabled,'hash',md5(pg_get_triggerdef(t.oid))) order by t.tgname),'[]')
    from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.policyname,
    'roles',p.roles,'command',p.cmd,'permissive',p.permissive,
    'usingHash',md5(p.qual),'checkHash',md5(p.with_check)) order by p.policyname),'[]')
    from pg_policies p where p.schemaname='storage' and p.tablename=c.relname),
   'acl',(select coalesce(jsonb_agg(jsonb_build_object('role',case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
    'privilege',g.privilege_type,'grantable',g.is_grantable) order by g.grantee=0,pg_get_userbyid(g.grantee),g.privilege_type),'[]')
    from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) g)
  ) x from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='storage' and c.relkind in ('r','p')
 ) q),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
  'arguments',pg_get_function_identity_arguments(p.oid),'hash',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,
  'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='storage' and p.prokind in ('f','p')),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,
  'hash',md5(pg_get_viewdef(c.oid)),'owner',pg_get_userbyid(c.relowner),'options',c.reloptions) order by c.relname),'[]')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relkind in ('v','m'))
) as inventory) q;
 if actual_storage is distinct from '{"views":[],"tables":[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":true,"privilege":"DELETE"},{"role":"postgres","grantable":true,"privilege":"INSERT"},{"role":"postgres","grantable":true,"privilege":"MAINTAIN"},{"role":"postgres","grantable":true,"privilege":"REFERENCES"},{"role":"postgres","grantable":true,"privilege":"SELECT"},{"role":"postgres","grantable":true,"privilege":"TRIGGER"},{"role":"postgres","grantable":true,"privilege":"TRUNCATE"},{"role":"postgres","grantable":true,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":true,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":true,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":true,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":true,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":true,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"UPDATE"}],"rls":true,"name":"buckets","owner":"supabase_storage_admin","columns":[{"name":"id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"owner","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"public","type":"boolean","notNull":false,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"avif_autodetection","type":"boolean","notNull":false,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"file_size_limit","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"allowed_mime_types","type":"text[]","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"owner_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"type","type":"storage.buckettype","notNull":true,"identity":"","generated":"","defaultHash":"5485714ce72f40c6ffe2818e53862fca"},{"name":"versioning_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"63c248537d1b4fd4346b2a9fdab80c93"},{"name":"lifecycle_configuration","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"lifecycle_configuration_generation","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"edb8be523c6e3c1ed9e7bd0eb32213af","name":"bname","valid":true},{"hash":"ff95cddc14c418511f2faaf69e4fe6b1","name":"buckets_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[{"hash":"7774f4b5e39e4ad07a16a589aef6277c","name":"enforce_bucket_name_length_trigger","enabled":"O"},{"hash":"5c2f86adf97481d45808f2ed4eb4673b","name":"protect_bucket_control_insert","enabled":"O"},{"hash":"ae169c5f8d35b69020459ddddbe65d7e","name":"protect_bucket_control_update","enabled":"O"},{"hash":"34d64d2c71ac2a26720ae99bd0da100b","name":"protect_bucket_control_update_role","enabled":"O"},{"hash":"50288cfc0da92cd8f2f573c018c16382","name":"protect_buckets_delete","enabled":"O"}],"constraints":[{"hash":"8ab704b1e9b6d3b352ee627be25d1152","kind":"c","name":"buckets_lifecycle_configuration_pair_check","validated":true},{"hash":"7081eb4a5d6997a885f9aa46e10a9dae","kind":"c","name":"buckets_lifecycle_configuration_shape_check","validated":true},{"hash":"7da5700c5c8fd72c4b2477f1fae46f56","kind":"c","name":"buckets_lifecycle_configuration_standard_only_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"buckets_pkey","validated":true},{"hash":"8204da0258fb5df422b3e93c39a44bf6","kind":"c","name":"buckets_versioning_dark_check","validated":true},{"hash":"3705d86bc1c7a8420a3130c600f3eeec","kind":"c","name":"buckets_versioning_standard_only_check","validated":true},{"hash":"243285ca65c9836f911c96b530d1034c","kind":"c","name":"buckets_versioning_status_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"buckets_analytics","owner":"supabase_storage_admin","columns":[{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"type","type":"storage.buckettype","notNull":true,"identity":"","generated":"","defaultHash":"3cb5e61e8db0bf1e9527d7e23bde376e"},{"name":"format","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"0cd243a7d4afac3e81595b9647e1dc0f"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"deleted_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5faafdbaaf23fb01463574b2f9d093d3","name":"buckets_analytics_pkey","valid":true},{"hash":"c04dcbc3e058e7be512a0af226a83443","name":"buckets_analytics_unique_name_idx","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"buckets_analytics_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"buckets_vectors","owner":"supabase_storage_admin","columns":[{"name":"id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"type","type":"storage.buckettype","notNull":true,"identity":"","generated":"","defaultHash":"e328c68de51bb97caf262ef02fb152f1"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"50a8be61a88b2ea09eed1b6497bddf51","name":"buckets_vectors_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"buckets_vectors_pkey","validated":true}]},{"acl":[{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"migrations","owner":"supabase_storage_admin","columns":[{"name":"id","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"character varying(100)","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"hash","type":"character varying(40)","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"executed_at","type":"timestamp without time zone","notNull":false,"identity":"","generated":"","defaultHash":"b96c3e81c1a3dc6db69a2e652bb5449c"}],"indexes":[{"hash":"bff6fa1f83cacf3970401c52c08db11c","name":"migrations_name_key","valid":true},{"hash":"0b7efb4a3feab972e1da5ad75b523221","name":"migrations_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"6cd240145af2a9dad30030041a41b7af","kind":"u","name":"migrations_name_key","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"migrations_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":true,"privilege":"DELETE"},{"role":"postgres","grantable":true,"privilege":"INSERT"},{"role":"postgres","grantable":true,"privilege":"MAINTAIN"},{"role":"postgres","grantable":true,"privilege":"REFERENCES"},{"role":"postgres","grantable":true,"privilege":"SELECT"},{"role":"postgres","grantable":true,"privilege":"TRIGGER"},{"role":"postgres","grantable":true,"privilege":"TRUNCATE"},{"role":"postgres","grantable":true,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":true,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":true,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":true,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":true,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":true,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"UPDATE"}],"rls":true,"name":"objects","owner":"supabase_storage_admin","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"bucket_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"owner","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"last_accessed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"metadata","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"path_tokens","type":"text[]","notNull":false,"identity":"","generated":"s","defaultHash":"c4a7508a4dc51cf699a0187b121cf908"},{"name":"version","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"owner_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"user_metadata","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"archived_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"is_delete_marker","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"is_versioned","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"}],"indexes":[{"hash":"28cc0d373399f6286fcc084d53ac1a9b","name":"idx_objects_bucket_id_name","valid":true},{"hash":"7011cc4c480885d4ad90a454ba646e00","name":"idx_objects_bucket_id_name_lower","valid":true},{"hash":"b072a4b9a2a417d3fe22d83e468bc484","name":"idx_objects_current_version","valid":true},{"hash":"0bbb7a0c69d7fdb5f6d231e50584cf57","name":"idx_objects_delete_markers","valid":true},{"hash":"3045da3705e39c1755c3657b190b50aa","name":"idx_objects_null_version","valid":true},{"hash":"723adc11317cf50c0b081f17b15306eb","name":"name_prefix_search","valid":true},{"hash":"225899b1e036a165909fbd0fffafccfc","name":"objects_bucket_id_name_version_key","valid":true},{"hash":"554c83fddeb715d0c8ab40f49647bbf4","name":"objects_pkey","valid":true}],"forceRls":false,"policies":[{"name":"client_invoice_file_read","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"4ae92d003e4dac4a6062ae6837252e0f","permissive":"PERMISSIVE"},{"name":"voicemail_no_direct_storage_access","roles":["anon","authenticated"],"command":"ALL","checkHash":"8efd5f3537b0dd220dc60022053991dc","usingHash":"8efd5f3537b0dd220dc60022053991dc","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"45c5692d486583888bac16ef789d847f","name":"protect_objects_delete","enabled":"O"},{"hash":"7457963f6a733c584baf08e4e7a451d0","name":"update_objects_updated_at","enabled":"O"}],"constraints":[{"hash":"7d59449dc108c67c37986a9d87ad757f","kind":"f","name":"objects_bucketId_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"objects_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"s3_multipart_uploads","owner":"supabase_storage_admin","columns":[{"name":"id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"in_progress_size","type":"bigint","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"upload_signature","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"bucket_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"owner_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"user_metadata","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"90fb4b2091d10452dcd11f661d9cc533","name":"idx_multipart_uploads_list","valid":true},{"hash":"c46135605d6e820073e2778c240ceb64","name":"s3_multipart_uploads_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"7d59449dc108c67c37986a9d87ad757f","kind":"f","name":"s3_multipart_uploads_bucket_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"s3_multipart_uploads_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"s3_multipart_uploads_parts","owner":"supabase_storage_admin","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"upload_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"size","type":"bigint","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"part_number","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"bucket_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"etag","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"owner_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"6b54fd822b51110fb8f5cc41f3e3114d","name":"s3_multipart_uploads_parts_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"7d59449dc108c67c37986a9d87ad757f","kind":"f","name":"s3_multipart_uploads_parts_bucket_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"s3_multipart_uploads_parts_pkey","validated":true},{"hash":"7a2ad081f21448eeef11ae8d441d0df0","kind":"f","name":"s3_multipart_uploads_parts_upload_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"vector_indexes","owner":"supabase_storage_admin","columns":[{"name":"id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"bucket_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"data_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"dimension","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"distance_metric","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"metadata_configuration","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"8328b4a594fa6b91d45ab4544c853b8f","name":"vector_indexes_name_bucket_id_idx","valid":true},{"hash":"84c07398a69ca4bfe5ad07e3848f2818","name":"vector_indexes_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"0d1b602396b6a71660454b92f80b94a7","kind":"f","name":"vector_indexes_bucket_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"vector_indexes_pkey","validated":true}]}],"functions":[{"hash":"ccefb34283c346cc88e224d075bd5312","name":"allow_any_operation","owner":"supabase_storage_admin","arguments":"expected_operations text[]","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"e2f7d55adc027df69ec4b42c6c08f50f","name":"allow_only_operation","owner":"supabase_storage_admin","arguments":"expected_operation text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"73733c9319875273d5937b05d68a7930","name":"can_insert_object","owner":"supabase_storage_admin","arguments":"bucketid text, name text, owner uuid, metadata jsonb","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"b839722d462ea1003fbcf028bd6f6c01","name":"enforce_bucket_lifecycle_service_role","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"11b3bd509f6b254ec1cd859e712e8c78","name":"enforce_bucket_name_length","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"75d83971130753081a84c3270878d8e7","name":"extension","owner":"supabase_storage_admin","arguments":"name text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"0e8171709dc2934861de959d743ff809","name":"filename","owner":"supabase_storage_admin","arguments":"name text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"93671af66e1fe108a56068ad4137d001","name":"foldername","owner":"supabase_storage_admin","arguments":"name text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"0dc62b74fb855d4f504f50f900f93927","name":"get_common_prefix","owner":"supabase_storage_admin","arguments":"p_key text, p_prefix text, p_delimiter text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"75dc6041ab2b273a08279126efecbcd0","name":"get_size_by_bucket","owner":"supabase_storage_admin","arguments":"noncurrent_versions text, delete_markers text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"961eef74f03a12751abf768384b84371","name":"list_multipart_uploads_with_delimiter","owner":"supabase_storage_admin","arguments":"bucket_id text, prefix_param text, delimiter_param text, max_keys integer, next_key_token text, next_upload_token text, raw_prefix_param text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"7747efec8583d78cd01449d9b99cd2eb","name":"list_objects_with_delimiter","owner":"supabase_storage_admin","arguments":"_bucket_id text, prefix_param text, delimiter_param text, max_keys integer, start_after text, next_token text, sort_order text, noncurrent_versions text, delete_markers text, next_token_archived_at timestamp with time zone, next_token_version text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"0720a7c3d1b49f9a8eee19e90d73bb97","name":"operation","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"7c31ae406e2f6281ead4009fff69fc68","name":"protect_bucket_control_columns","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"4371ae544fb1ef704f9c5d42265ac324","name":"protect_delete","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"fed15c85bb96faaa21ec40176026a0fd","name":"search","owner":"supabase_storage_admin","arguments":"prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text, noncurrent_versions text, delete_markers text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"323c4e2739e9c9bcfc082f7f14289338","name":"search_by_timestamp","owner":"supabase_storage_admin","arguments":"p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text, noncurrent_versions text, delete_markers text, p_start_after_version text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"7a010a87c94770b1c8f0b49a616082f4","name":"search_v2","owner":"supabase_storage_admin","arguments":"prefix text, bucket_name text, limits integer, levels integer, start_after text, sort_order text, sort_column text, sort_column_after text, noncurrent_versions text, delete_markers text, start_after_archived_at timestamp with time zone, start_after_version text, start_after_is_continuation boolean","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"bfecc08a6034296258f0c3e10193076c","name":"update_updated_at_column","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true}]}'::jsonb then raise exception 'Production Voicemail storage baseline differs';end if;
 select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]') into actual_buckets from storage.buckets b where id in ('receptionist-voicemails','learn-voicemail-sources');
 if actual_buckets is distinct from '[{"id":"receptionist-voicemails","name":"receptionist-voicemails","type":"STANDARD","owner":null,"public":false,"owner_id":null,"created_at":"2026-10-01T10:30:47.462135+00:00","updated_at":"2026-10-01T10:30:47.462135+00:00","file_size_limit":26214400,"versioning_status":"DISABLED","allowed_mime_types":["audio/mpeg","audio/wav","audio/x-wav","audio/ogg","audio/mp4"],"avif_autodetection":false,"lifecycle_configuration":null,"lifecycle_configuration_generation":null}]'::jsonb then raise exception 'Production Voicemail bucket baseline differs';end if;
end$$;
-- INPUT supabase/migrations/20261101420000_learn_voicemail_private_intake.sql
-- Private voicemail intake. No routes, capture activation, user grants or source rows seeded.

create table public.receptionist_voicemail_email_routes (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 mailbox_id uuid not null, email_account_id uuid not null references public.email_accounts(id),
 recipient_email text not null check(recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
 signing_domain text not null check(signing_domain ~ '^[a-z0-9.-]+$'),
 owner_user_id uuid references auth.users(id), access_mode text not null check(access_mode in ('owner','managers_only')),
 received_from timestamptz not null, received_until timestamptz,
 binding_evidence text not null check(length(btrim(binding_evidence)) between 1 and 1000),
 verified_by uuid not null references auth.users(id), verified_at timestamptz not null default clock_timestamp(),
 enabled boolean not null default false,
 unique(tenant_id,id), foreign key(tenant_id,mailbox_id) references public.receptionist_mailboxes(tenant_id,id),
 check((access_mode='owner')=(owner_user_id is not null)),
 check(received_until is null or received_until>received_from)
);
create table public.receptionist_voicemail_intakes (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 mailbox_id uuid not null, route_id uuid not null, provider_reference uuid not null,
 owner_user_id uuid references auth.users(id), candidate jsonb not null,
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
 audio_sha256 text not null check(audio_sha256 ~ '^[a-f0-9]{64}$'),
 audio_bytes integer not null check(audio_bytes between 1 and 26214400),
 state text not null default 'prepared' check(state in ('prepared','published')),
 created_at timestamptz not null default clock_timestamp(), published_at timestamptz,
 unique(tenant_id,id), unique(tenant_id,mailbox_id,provider_reference),
 foreign key(tenant_id,mailbox_id) references public.receptionist_mailboxes(tenant_id,id),
 foreign key(tenant_id,route_id) references public.receptionist_voicemail_email_routes(tenant_id,id),
 check((state='published')=(published_at is not null))
);
create table public.receptionist_voicemail_sources (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, intake_id uuid not null,
 route_id uuid not null, email_account_id uuid not null references public.email_accounts(id),
 provider_email_id text not null check(provider_email_id ~ '^[a-f0-9]{1,64}$'),
 received_at timestamptz not null,
 raw_sha256 text not null check(raw_sha256 ~ '^[a-f0-9]{64}$'), raw_bytes integer not null check(raw_bytes between 1 and 1048576),
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,email_account_id,provider_email_id), unique(tenant_id,id),
 foreign key(tenant_id,intake_id) references public.receptionist_voicemail_intakes(tenant_id,id),
 foreign key(tenant_id,route_id) references public.receptionist_voicemail_email_routes(tenant_id,id)
);
-- These records include private communication evidence. No owner/operator browser access.
alter table public.receptionist_voicemail_email_routes enable row level security;
alter table public.receptionist_voicemail_intakes enable row level security;
alter table public.receptionist_voicemail_sources enable row level security;
revoke all on public.receptionist_voicemail_email_routes,public.receptionist_voicemail_intakes,public.receptionist_voicemail_sources from public,anon,authenticated;
grant select,insert,update on public.receptionist_voicemail_email_routes,public.receptionist_voicemail_intakes,public.receptionist_voicemail_sources to service_role;

create function public.voicemail_intake_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'voicemail_evidence_immutable' using errcode='22023';end if;
 if tg_table_name='receptionist_voicemail_email_routes' and (to_jsonb(new)-'enabled')=(to_jsonb(old)-'enabled') then return new;end if;
 if tg_table_name='receptionist_voicemail_intakes' then
  if old.state='prepared' and new.state='published'
   and new.published_at is not null and (to_jsonb(new)-array['state','published_at'])=(to_jsonb(old)-array['state','published_at']) then return new;end if;
 end if;
 raise exception 'voicemail_evidence_immutable' using errcode='22023';
end $$;
create trigger voicemail_routes_immutable before update or delete on public.receptionist_voicemail_email_routes for each row execute function public.voicemail_intake_immutable();
create trigger voicemail_intakes_immutable before update or delete on public.receptionist_voicemail_intakes for each row execute function public.voicemail_intake_immutable();
create trigger voicemail_sources_immutable before update or delete on public.receptionist_voicemail_sources for each row execute function public.voicemail_intake_immutable();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('learn-voicemail-sources','learn-voicemail-sources',false,1048576,array['message/rfc822'])
on conflict(id) do nothing;
do $$begin if exists(select 1 from storage.buckets where id in ('learn-voicemail-sources','receptionist-voicemails') and public)
 then raise exception 'voicemail_bucket_not_private';end if;end $$;
create policy voicemail_source_no_direct_storage_access on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'learn-voicemail-sources') with check(bucket_id<>'learn-voicemail-sources');

-- Locks match the operator master/input switch transaction. Routes are explicitly
-- enabled only after provider-account, recipient and historical access verification.
create function public.voicemail_intake_route(p_tenant uuid,p_route uuid,p_received timestamptz)
returns public.receptionist_voicemail_email_routes language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.receptionist_voicemail_email_routes%rowtype;begin
 if current_user<>'service_role' then raise exception 'voicemail_intake_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'voicemail_snapshot_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.receptionist_voicemail_email_routes where id=p_route and tenant_id=p_tenant for share;
 if not found or not r.enabled or p_received is null or p_received<r.received_from or (r.received_until is not null and p_received>=r.received_until)
  then raise exception 'voicemail_route_unverified' using errcode='22023';end if;
 if not public.learn_capture_allowed(p_tenant,'email') or not public.learn_capture_allowed(p_tenant,'phone') then
  raise exception 'voicemail_capture_paused' using errcode='55000';end if;
 if not exists(select 1 from public.email_accounts a where a.id=r.email_account_id and a.tenant_id=p_tenant
  and a.provider='gmail' and a.status='active_dwd' and lower(a.email_address)=lower(r.recipient_email)) then
  raise exception 'voicemail_email_binding_changed' using errcode='22023';end if;
 return r;
end $$;

-- The trusted server has already verified the original signature, recipient,
-- parser and decoded audio. JSON contains no caller-supplied owner or storage path.
create function public.voicemail_intake_prepare(p_tenant uuid,p_route uuid,p_source jsonb,p_candidate jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.receptionist_voicemail_email_routes%rowtype;i public.receptionist_voicemail_intakes%rowtype;
 s public.receptionist_voicemail_sources%rowtype;received timestamptz;reference uuid;begin
 if current_user<>'service_role' then raise exception 'voicemail_intake_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_source) is distinct from 'object' or jsonb_typeof(p_candidate) is distinct from 'object'
  or octet_length(p_candidate::text)>100000 or octet_length(p_source::text)>4000
  or not p_source ?& array['email_id','received_at','raw_sha256','raw_bytes','content_sha256','audio_sha256','audio_bytes','signing_domain']
  or (p_source-array['email_id','received_at','raw_sha256','raw_bytes','content_sha256','audio_sha256','audio_bytes','signing_domain'])<>'{}'::jsonb
  or not p_candidate ?& array['version','system_reference','extension','caller_number','caller_name','duration_seconds','transcript']
  or (p_candidate-array['version','system_reference','extension','caller_number','caller_name','duration_seconds','transcript'])<>'{}'::jsonb
  or p_candidate->>'version' is distinct from 'birchills-voicemail-email/1'
  or p_candidate->>'extension'!~'^[0-9]{3}$'
  or p_source->>'email_id'!~'^[a-f0-9]{1,64}$'
  or coalesce(p_source->>'raw_sha256','')!~'^[a-f0-9]{64}$'
  or coalesce(p_source->>'audio_sha256','')!~'^[a-f0-9]{64}$'
  or coalesce(p_source->>'content_sha256','')!~'^[a-f0-9]{64}$'
  or coalesce(p_source->>'audio_bytes','')!~'^[0-9]+$' or coalesce(p_source->>'raw_bytes','')!~'^[0-9]+$'
  or coalesce(p_candidate->>'duration_seconds','')!~'^[0-9]+$'
  or (p_candidate->>'duration_seconds')::bigint not between 0 and 7200
  or jsonb_typeof(p_candidate->'transcript') not in ('string','null')
  or jsonb_typeof(p_candidate->'caller_number') not in ('string','null')
  or jsonb_typeof(p_candidate->'caller_name') not in ('string','null')
  or length(coalesce(p_candidate->>'caller_number',''))>30 or length(coalesce(p_candidate->>'caller_name',''))>200
  or length(coalesce(p_candidate->>'transcript',''))>50000 then
  raise exception 'voicemail_source_invalid' using errcode='22023';end if;
 received:=(p_source->>'received_at')::timestamptz; reference:=(p_candidate->>'system_reference')::uuid;
 if reference is null or not isfinite(received) then raise exception 'voicemail_source_invalid' using errcode='22023';end if;
 r:=public.voicemail_intake_route(p_tenant,p_route,received);
 if p_source->>'signing_domain' is distinct from r.signing_domain or not exists(select 1 from public.receptionist_mailboxes
  where tenant_id=p_tenant and id=r.mailbox_id and provider='birchills' and extension=p_candidate->>'extension') then
  raise exception 'voicemail_provider_binding_changed' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('voicemail-intake:'||p_tenant::text||':'||r.mailbox_id::text||':'||reference::text,0));
 select * into i from public.receptionist_voicemail_intakes where tenant_id=p_tenant and mailbox_id=r.mailbox_id and provider_reference=reference for update;
 if found then
  if i.candidate<>p_candidate or i.content_sha256<>p_source->>'content_sha256' or i.audio_sha256<>p_source->>'audio_sha256'
   or i.audio_bytes<>(p_source->>'audio_bytes')::integer or i.owner_user_id is distinct from r.owner_user_id then
   raise exception 'voicemail_duplicate_conflict' using errcode='PT409';end if;
 else
  insert into public.receptionist_voicemail_intakes(tenant_id,mailbox_id,route_id,provider_reference,owner_user_id,candidate,content_sha256,audio_sha256,audio_bytes)
  values(p_tenant,r.mailbox_id,r.id,reference,r.owner_user_id,p_candidate,p_source->>'content_sha256',p_source->>'audio_sha256',(p_source->>'audio_bytes')::integer) returning * into i;
 end if;
 insert into public.receptionist_voicemail_sources(tenant_id,intake_id,route_id,email_account_id,provider_email_id,received_at,raw_sha256,raw_bytes)
 values(p_tenant,i.id,r.id,r.email_account_id,p_source->>'email_id',received,p_source->>'raw_sha256',(p_source->>'raw_bytes')::integer)
 on conflict(tenant_id,email_account_id,provider_email_id) do nothing;
 select * into s from public.receptionist_voicemail_sources where tenant_id=p_tenant and email_account_id=r.email_account_id and provider_email_id=p_source->>'email_id';
 if s.intake_id<>i.id or s.route_id<>r.id or s.received_at<>received or s.raw_sha256<>p_source->>'raw_sha256' or s.raw_bytes<>(p_source->>'raw_bytes')::integer then
  raise exception 'voicemail_email_replay_conflict' using errcode='PT409';end if;
 return jsonb_build_object('intake_id',i.id,'source_id',s.id,'state',i.state,'audio_path',p_tenant::text||'/'||r.mailbox_id::text||'/'||i.id::text,
  'source_path',p_tenant::text||'/'||i.id::text||'/'||s.id::text||'.eml');
end $$;

-- Service must read back each uploaded object's actual bytes and verify both
-- digests before calling. Storage metadata alone does NOT establish integrity.
create function public.voicemail_intake_publish(p_tenant uuid,p_intake uuid,p_source uuid,p_raw_sha256 text,p_audio_sha256 text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare i public.receptionist_voicemail_intakes%rowtype;s public.receptionist_voicemail_sources%rowtype;
 r public.receptionist_voicemail_email_routes%rowtype; audio_path text;source_path text;begin
 if current_user<>'service_role' then raise exception 'voicemail_intake_forbidden' using errcode='42501';end if;
 select * into i from public.receptionist_voicemail_intakes where id=p_intake and tenant_id=p_tenant for update;
 select * into s from public.receptionist_voicemail_sources where id=p_source and tenant_id=p_tenant and intake_id=p_intake;
 if i.id is null or s.id is null or p_raw_sha256 is distinct from s.raw_sha256 or p_audio_sha256 is distinct from i.audio_sha256 then
  raise exception 'voicemail_upload_unverified' using errcode='22023';end if;
 audio_path:=p_tenant::text||'/'||i.mailbox_id::text||'/'||i.id::text;
 source_path:=p_tenant::text||'/'||i.id::text||'/'||s.id::text||'.eml';
 if exists(select 1 from storage.buckets where id in ('learn-voicemail-sources','receptionist-voicemails') and public)
  or not exists(select 1 from storage.objects where bucket_id='receptionist-voicemails' and name=audio_path
   and metadata->>'size'=i.audio_bytes::text and metadata->>'mimetype'='audio/mpeg')
  or not exists(select 1 from storage.objects where bucket_id='learn-voicemail-sources' and name=source_path
   and metadata->>'size'=s.raw_bytes::text and metadata->>'mimetype'='message/rfc822') then
  raise exception 'voicemail_upload_incomplete' using errcode='55000';end if;
 if i.state='published' then
  if not exists(select 1 from public.receptionist_voicemails where id=i.id and tenant_id=p_tenant and mailbox_id=i.mailbox_id
   and owner_user_id is not distinct from i.owner_user_id and provider_message_id=i.provider_reference::text and recording_path=audio_path) then
   raise exception 'voicemail_publication_changed' using errcode='PT409';end if;
  return jsonb_build_object('state','published','message_id',i.id);
 end if;
 r:=public.voicemail_intake_route(p_tenant,s.route_id,s.received_at);
 if r.owner_user_id is distinct from i.owner_user_id or r.mailbox_id<>i.mailbox_id then raise exception 'voicemail_route_changed' using errcode='PT409';end if;
 insert into public.receptionist_voicemails(id,tenant_id,mailbox_id,provider_message_id,owner_user_id,received_at,
  caller_number,caller_name,duration_seconds,transcript,recording_path)
 values(i.id,p_tenant,i.mailbox_id,i.provider_reference::text,i.owner_user_id,s.received_at,
  i.candidate->>'caller_number',i.candidate->>'caller_name',(i.candidate->>'duration_seconds')::integer,i.candidate->>'transcript',audio_path);
 update public.receptionist_voicemail_intakes set state='published',published_at=clock_timestamp() where id=i.id;
 return jsonb_build_object('state','published','message_id',i.id);
end $$;
revoke all on function public.voicemail_intake_immutable(),public.voicemail_intake_route(uuid,uuid,timestamptz),
 public.voicemail_intake_prepare(uuid,uuid,jsonb,jsonb),public.voicemail_intake_publish(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.voicemail_intake_route(uuid,uuid,timestamptz),public.voicemail_intake_prepare(uuid,uuid,jsonb,jsonb),
 public.voicemail_intake_publish(uuid,uuid,uuid,text,text) to service_role;

-- INPUT supabase/migrations/20261101430000_learn_voicemail_queue.sql
-- One-message voicemail jobs use the existing queue. No jobs, routes or schedules
-- are seeded. The private binding freezes source identity across attempts.

set local lock_timeout='5s';set local statement_timeout='30s';
create table public.receptionist_voicemail_jobs(
 job_id uuid primary key references public.platform_jobs(id),
 tenant_id uuid not null references public.tenants(id),request jsonb not null,
 intake_id uuid,source_id uuid,created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,intake_id) references public.receptionist_voicemail_intakes(tenant_id,id),
 foreign key(tenant_id,source_id) references public.receptionist_voicemail_sources(tenant_id,id),
 check((intake_id is null)=(source_id is null))
);
create table public.receptionist_voicemail_job_receipts(
 job_id uuid not null references public.platform_jobs(id),attempt integer not null,
 tenant_id uuid not null references public.tenants(id),worker text not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(job_id,attempt)
);
alter table public.receptionist_voicemail_jobs enable row level security;
alter table public.receptionist_voicemail_job_receipts enable row level security;
revoke all on public.receptionist_voicemail_jobs,public.receptionist_voicemail_job_receipts from public,anon,authenticated;
grant select,insert,update on public.receptionist_voicemail_jobs to service_role;
grant select,insert on public.receptionist_voicemail_job_receipts to service_role;
create function public.voicemail_job_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' and tg_table_name='receptionist_voicemail_jobs' then
  if old.intake_id is null and new.intake_id is not null and new.source_id is not null
   and to_jsonb(new)-array['intake_id','source_id']=to_jsonb(old)-array['intake_id','source_id'] then return new;end if;
 end if;
 raise exception 'voicemail_job_evidence_immutable' using errcode='22023';
end$$;
create trigger voicemail_job_binding_immutable before update or delete on public.receptionist_voicemail_jobs for each row execute function public.voicemail_job_immutable();
create trigger voicemail_job_receipt_immutable before update or delete on public.receptionist_voicemail_job_receipts for each row execute function public.voicemail_job_immutable();

-- Every operation locks the capture gate before the job and intake rows. The job
-- lock serializes reclaim/publication; the clock is checked again before commit.
-- Inspect returns historical settlement evidence, not fresh health/coverage.
create function public.voicemail_queue_step(p_tenant uuid,p_job uuid,p_worker text,p_attempt integer,p_operation text,p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog set timezone='UTC' as $$
declare j public.platform_jobs%rowtype;b public.receptionist_voicemail_jobs%rowtype;s public.receptionist_voicemail_job_receipts%rowtype;
 r public.receptionist_voicemail_email_routes%rowtype;request jsonb;result jsonb;receipt jsonb;received timestamptz;
 code text;outcome text;failures integer;delay integer;paused boolean;at_time timestamptz;
begin
 if current_user<>'service_role' then raise exception 'voicemail_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_tenant is null or p_job is null
  or p_worker is null or length(p_worker) not between 1 and 200 or p_attempt is null or p_attempt<1
  or p_operation is null or p_operation not in('bind','route','prepare','publish','fail','inspect')
  or jsonb_typeof(p_args) is distinct from 'object' or octet_length(p_args::text)>110000
 then raise exception 'voicemail_queue_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.job_type<>'phone.voicemail_import' then raise exception 'voicemail_queue_claim_lost' using errcode='PT409';end if;
 select * into s from public.receptionist_voicemail_job_receipts where job_id=p_job and attempt=p_attempt;
 if found then
  if s.tenant_id<>p_tenant or s.worker<>p_worker then raise exception 'voicemail_queue_claim_lost' using errcode='PT409';end if;
  if p_operation='bind' then return jsonb_build_object('state','settled','receipt',s.receipt);end if;
  if p_operation in('inspect','fail') then return s.receipt;end if;
  raise exception 'voicemail_queue_already_settled' using errcode='PT409';
 end if;
 if p_operation='inspect' then raise exception 'voicemail_queue_receipt_missing' using errcode='PT409';end if;
 if j.status<>'running' or j.claimed_by is distinct from p_worker or j.attempt_count<>p_attempt
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
 then raise exception 'voicemail_queue_claim_lost' using errcode='PT409';end if;
 request:=j.payload;
 if jsonb_typeof(request) is distinct from 'object' or not request?&array['routeId','accountId','messageId','internalDate']
  or request-array['routeId','accountId','messageId','internalDate']<>'{}'::jsonb
  or jsonb_typeof(request->'routeId') is distinct from 'string' or coalesce(request->>'routeId','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or jsonb_typeof(request->'accountId') is distinct from 'string' or coalesce(request->>'accountId','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or jsonb_typeof(request->'messageId') is distinct from 'string' or coalesce(request->>'messageId','')!~'^[a-f0-9]{1,64}$'
  or jsonb_typeof(request->'internalDate') is distinct from 'string' or coalesce(request->>'internalDate','')!~'^(0|[1-9][0-9]{0,14})$'
 then raise exception 'voicemail_queue_payload_invalid' using errcode='22023';end if;
 received:=to_timestamp((request->>'internalDate')::numeric/1000);
 select * into b from public.receptionist_voicemail_jobs where job_id=p_job;
 if found and (b.tenant_id<>p_tenant or b.request<>request) then raise exception 'voicemail_queue_binding_changed' using errcode='PT409';end if;
 select * into r from public.receptionist_voicemail_email_routes where tenant_id=p_tenant and id=(request->>'routeId')::uuid for share;
 if not found or r.email_account_id<>(request->>'accountId')::uuid then raise exception 'voicemail_queue_route_mismatch' using errcode='PT409';end if;
 if p_operation='bind' then
  if p_args<>'{}'::jsonb then raise exception 'voicemail_queue_request_invalid' using errcode='22023';end if;
  if b.job_id is null then
   insert into public.receptionist_voicemail_jobs(job_id,tenant_id,request) values(p_job,p_tenant,request);
  end if;
  result:=jsonb_build_object('state','bound','request',request||jsonb_build_object('tenantId',p_tenant));
 elsif b.job_id is null then raise exception 'voicemail_queue_binding_missing' using errcode='PT409';
 elsif p_operation='route' then
  if p_args is distinct from jsonb_build_object('p_tenant',p_tenant,'p_route',r.id,'p_received',p_args->>'p_received')
   or (p_args->>'p_received')::timestamptz is distinct from received then raise exception 'voicemail_queue_source_mismatch' using errcode='PT409';end if;
  result:=to_jsonb(public.voicemail_intake_route(p_tenant,r.id,received));
 elsif p_operation='prepare' then
  if not p_args?&array['p_tenant','p_route','p_source','p_candidate'] or p_args-array['p_tenant','p_route','p_source','p_candidate']<>'{}'::jsonb
   or p_args->>'p_tenant' is distinct from p_tenant::text or p_args->>'p_route' is distinct from r.id::text
   or p_args->'p_source'->>'email_id' is distinct from request->>'messageId'
   or (p_args->'p_source'->>'received_at')::timestamptz is distinct from received
  then raise exception 'voicemail_queue_source_mismatch' using errcode='PT409';end if;
  result:=public.voicemail_intake_prepare(p_tenant,r.id,p_args->'p_source',p_args->'p_candidate');
  if b.intake_id is null then
   update public.receptionist_voicemail_jobs set intake_id=(result->>'intake_id')::uuid,source_id=(result->>'source_id')::uuid where job_id=p_job;
  elsif b.intake_id::text is distinct from result->>'intake_id' or b.source_id::text is distinct from result->>'source_id' then
   raise exception 'voicemail_queue_source_mismatch' using errcode='PT409';end if;
 elsif p_operation='publish' then
  if not p_args?&array['p_tenant','p_intake','p_source','p_raw_sha256','p_audio_sha256']
   or p_args-array['p_tenant','p_intake','p_source','p_raw_sha256','p_audio_sha256']<>'{}'::jsonb
   or p_args->>'p_tenant' is distinct from p_tenant::text or b.intake_id is null
   or p_args->>'p_intake' is distinct from b.intake_id::text or p_args->>'p_source' is distinct from b.source_id::text
  then raise exception 'voicemail_queue_source_mismatch' using errcode='PT409';end if;
  -- Byte readback remains the trusted importer's responsibility. This transaction
  -- atomically publishes its validated source and settles exactly the leased job.
  result:=public.voicemail_intake_publish(p_tenant,b.intake_id,b.source_id,p_args->>'p_raw_sha256',p_args->>'p_audio_sha256');
  at_time:=clock_timestamp();outcome:='succeeded';
  update public.platform_jobs set status=outcome,records_processed=1,completed_at=at_time,failed_at=null,dead_lettered_at=null,
   lease_expires_at=null,error_code=null,last_error=null,next_run_at=null,result=jsonb_build_object('message_id',b.intake_id,'coverage_complete',false)
   where id=p_job;
 elsif p_operation='fail' then
  if p_args-array['code']<>'{}'::jsonb or jsonb_typeof(p_args->'code') is distinct from 'string' then raise exception 'voicemail_queue_request_invalid' using errcode='22023';end if;
  code:=p_args->>'code';
  -- Only machine codes survive. Exception text, provider bodies and credentials
  -- cannot enter tenant-visible queue diagnostics.
  if code not in('voicemail_provider_temporary','voicemail_fetch_failed','voicemail_persistence_failed','voicemail_provider_source_unavailable',
   'voicemail_provider_access_denied','voicemail_credentials_unverified','voicemail_sa_config_missing','voicemail_sa_credentials_invalid',
   'voicemail_admin_delegation_missing','voicemail_scopes_missing','voicemail_delegation_grant_invalid','voicemail_delegation_denied',
   'voicemail_source_ineligible','voicemail_provider_response_invalid','voicemail_provider_source_changed','voicemail_mailbox_binding_unverified',
   'voicemail_storage_content_conflict','voicemail_storage_readback_unconfirmed','voicemail_audio_decode_unconfirmed','voicemail_source_mutated',
   'notification_signature_unverified','notification_recipient_unverified','notification_audio_ambiguous','notification_audio_format_unverified',
   'voicemail_route_unconfirmed','voicemail_prepare_unconfirmed','voicemail_publish_unconfirmed','voicemail_route_unverified','voicemail_import_unconfirmed')
  then code:='voicemail_import_unconfirmed';end if;
  paused:=not r.enabled or not public.learn_capture_allowed(p_tenant,'email') or not public.learn_capture_allowed(p_tenant,'phone');
  failures:=j.error_count+case when paused then 0 else 1 end;
  outcome:=case when paused then 'waiting' when failures<greatest(1,j.max_attempts) and code in('voicemail_provider_temporary','voicemail_fetch_failed',
   'voicemail_persistence_failed','voicemail_storage_readback_unconfirmed','voicemail_route_unconfirmed','voicemail_prepare_unconfirmed','voicemail_publish_unconfirmed','voicemail_import_unconfirmed')
   then 'retrying' else 'dead_letter' end;
  if paused then code:='voicemail_capture_paused';end if;
  delay:=case when paused then 300 when failures=1 then 60 when failures=2 then 300 when failures=3 then 900 else 3600 end;
  at_time:=clock_timestamp();
  update public.platform_jobs set status=case when outcome='waiting' then 'retrying' else outcome end,error_count=failures,records_processed=0,
   completed_at=null,failed_at=case when outcome='dead_letter' then at_time else null end,dead_lettered_at=case when outcome='dead_letter' then at_time else null end,
   lease_expires_at=null,error_code=code,last_error=case when paused then 'Voicemail capture is paused. Retained inputs are unchanged.' else 'Voicemail import requires retry or operator review. See the recorded error code.' end,
   available_at=case when outcome<>'dead_letter' then at_time+make_interval(secs=>delay) else null end,
   next_run_at=case when outcome<>'dead_letter' then at_time+make_interval(secs=>delay) else null end,
   result=jsonb_build_object('coverage_complete',false) where id=p_job;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'voicemail_queue_claim_lost' using errcode='PT409';end if;
 if outcome is not null then
  receipt:=jsonb_build_object('version','voicemail-queue/1','tenant_id',p_tenant,'job_id',p_job,'worker',p_worker,'attempt',p_attempt,
   'state',outcome,'records_processed',case when outcome='succeeded' then 1 else 0 end,
   'message_id',case when outcome='succeeded' then b.intake_id else null end,'code',code,'settled_at',at_time,'coverage_complete',false);
  insert into public.receptionist_voicemail_job_receipts(job_id,attempt,tenant_id,worker,receipt) values(p_job,p_attempt,p_tenant,p_worker,receipt);
  return receipt;
 end if;
 return result;
end$$;

-- Bounded recovery for dead workers, including jobs that died before binding.
-- Pause waits never consume the failure budget; lease losses do. No source reads.
create function public.voicemail_queue_recover() returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;n integer:=0;at_time timestamptz;outcome text;
begin
 if current_user<>'service_role' then raise exception 'voicemail_queue_forbidden' using errcode='42501';end if;
 for j in select * from public.platform_jobs where job_type='phone.voicemail_import' and status='running' and lease_expires_at<=clock_timestamp()
  order by lease_expires_at,id for update skip locked limit 100 loop
  at_time:=clock_timestamp();outcome:=case when j.error_count+1>=greatest(1,j.max_attempts) then 'dead_letter' else 'retrying' end;
  update public.platform_jobs set status=outcome,error_count=j.error_count+1,lease_expires_at=null,error_code='voicemail_worker_interrupted',
   last_error='Voicemail import was interrupted. Retained inputs are available for retry or operator review.',
   available_at=case when outcome='retrying' then at_time+interval '60 seconds' else null end,
   next_run_at=case when outcome='retrying' then at_time+interval '60 seconds' else null end,
   failed_at=case when outcome='dead_letter' then at_time else null end,dead_lettered_at=case when outcome='dead_letter' then at_time else null end where id=j.id;
  n:=n+1;
 end loop;
 return n;
end$$;
revoke all on function public.voicemail_job_immutable(),public.voicemail_queue_step(uuid,uuid,text,integer,text,jsonb),public.voicemail_queue_recover() from public,anon,authenticated;
grant execute on function public.voicemail_queue_step(uuid,uuid,text,integer,text,jsonb),public.voicemail_queue_recover() to service_role;

-- INPUT supabase/migrations/20261101440000_learn_voicemail_discovery.sql
-- Retained-email discovery only. No routes, credentials, schedules or grants to
-- people are created. Candidate selection is NOT signature/ownership validation.

set local lock_timeout='5s';set local statement_timeout='30s';
create table public.receptionist_voicemail_scans(
 tenant_id uuid not null,route_id uuid primary key,
 generation integer not null default 1,last_id uuid,rows_examined bigint not null default 0,
 pages integer not null default 0,started_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,next_scan_at timestamptz,
 foreign key(tenant_id,route_id) references public.receptionist_voicemail_email_routes(tenant_id,id)
);
create table public.receptionist_voicemail_candidates(
 tenant_id uuid not null,route_id uuid not null,email_message_id uuid not null references public.email_messages(id),
 job_id uuid unique references public.platform_jobs(id),
 state text not null check(state in('selected','needs_review','excluded')),
 code text not null,observed_at timestamptz not null default clock_timestamp(),
 primary key(route_id,email_message_id),
 foreign key(tenant_id,route_id) references public.receptionist_voicemail_email_routes(tenant_id,id)
);
create table public.receptionist_voicemail_scan_receipts(
 request_id uuid primary key,tenant_id uuid not null,route_id uuid not null,
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,route_id) references public.receptionist_voicemail_email_routes(tenant_id,id)
);
create unique index voicemail_discovery_source_job_uk on public.receptionist_voicemail_candidates(tenant_id,email_message_id) where job_id is not null;
alter table public.receptionist_voicemail_scans enable row level security;
alter table public.receptionist_voicemail_candidates enable row level security;
alter table public.receptionist_voicemail_scan_receipts enable row level security;
revoke all on public.receptionist_voicemail_scans,public.receptionist_voicemail_candidates,public.receptionist_voicemail_scan_receipts from public,anon,authenticated;
grant select,insert,update on public.receptionist_voicemail_scans,public.receptionist_voicemail_candidates to service_role;
grant select,insert on public.receptionist_voicemail_scan_receipts to service_role;
create trigger voicemail_scan_receipt_immutable before update or delete on public.receptionist_voicemail_scan_receipts
 for each row execute function public.voicemail_job_immutable();
create index email_messages_voicemail_scan_idx on public.email_messages(tenant_id,id) where provider='gmail';

-- Each request consumes at most 100 retained rows; a receipt makes a lost reply
-- replayable without advancing a second page. State, candidates and jobs commit
-- together. Repeated passes from the start catch inserts behind the UUID cursor
-- and corrected labels/account bindings; this is not a provider snapshot.
create function public.voicemail_discover_page(p_tenant uuid,p_route uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog set timezone='UTC' as $$
declare r public.receptionist_voicemail_email_routes%rowtype;s public.receptionist_voicemail_scans%rowtype;
 e public.email_messages%rowtype;c public.receptionist_voicemail_candidates%rowtype;
 saved public.receptionist_voicemail_scan_receipts%rowtype;ext text;code text;state text;request jsonb;
 job uuid;previous_request jsonb;matches integer;n integer:=0;selected integer:=0;review integer:=0;excluded_count integer:=0;
 at_time timestamptz;result jsonb;last_seen uuid;finished boolean;millis numeric;
begin
 if current_user<>'service_role' then raise exception 'voicemail_discovery_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_route is null or p_request is null or current_setting('transaction_isolation')<>'read committed'
 then raise exception 'voicemail_discovery_request_invalid' using errcode='22023';end if;
 -- Serialize a request even if it is accidentally reused for another route.
 perform pg_advisory_xact_lock(hashtextextended('voicemail-discovery:'||p_request::text,0));
 select * into saved from public.receptionist_voicemail_scan_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.route_id<>p_route then raise exception 'voicemail_discovery_request_conflict' using errcode='PT409';end if;
  return saved.receipt; -- historical page acknowledgement, not fresh health
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.receptionist_voicemail_email_routes where tenant_id=p_tenant and id=p_route for share;
 if not found then raise exception 'voicemail_route_unverified' using errcode='22023';end if;
 -- Reuse the authoritative route/account/capture gate checks, at its interval start.
 perform public.voicemail_intake_route(p_tenant,p_route,r.received_from);
 select extension into ext from public.receptionist_mailboxes where tenant_id=p_tenant and id=r.mailbox_id and provider='birchills';
 if ext is null or ext!~'^[0-9]{3}$' or r.signing_domain<>'birchills-net.20251104.gappssmtp.com'
 then raise exception 'voicemail_route_unverified' using errcode='22023';end if;
 insert into public.receptionist_voicemail_scans(tenant_id,route_id) values(p_tenant,p_route) on conflict do nothing;
 select * into s from public.receptionist_voicemail_scans where route_id=p_route for update;
 at_time:=clock_timestamp();
 if s.completed_at is not null and s.next_scan_at>at_time then
  result:=jsonb_build_object('state','waiting','generation',s.generation,'observed_at',at_time,'next_scan_at',s.next_scan_at,
   'rows_examined',0,'jobs_enqueued',0,'coverage_complete',false);
 else
  if s.completed_at is not null then
   s.generation:=s.generation+1;s.last_id:=null;s.rows_examined:=0;s.pages:=0;s.started_at:=at_time;s.completed_at:=null;s.next_scan_at:=null;
  end if;
  for e in select * from public.email_messages where tenant_id=p_tenant and provider='gmail'
   and (s.last_id is null or id>s.last_id) order by id limit 100
  loop
   n:=n+1;last_seen:=e.id;
   -- Broad subject/sender hints choose candidates only. Untrusted content never
   -- assigns ownership or bypasses original-message DKIM/audio validation.
   if e.subject is null or e.subject!~('^New message in mailbox '||ext||' from .+$')
    or lower(coalesce(e.from_email,''))!~'^[^[:space:]@]+@birchills[.]net$' then continue;end if;
   if e.raw_payload->>'provider_account_id' is not null and e.raw_payload->>'provider_account_id'<>r.email_account_id::text then continue;end if;
   if e.received_at is not null and isfinite(e.received_at)
    and (e.received_at<r.received_from or (r.received_until is not null and e.received_at>=r.received_until)) then continue;end if;
   code:=null;state:='needs_review';request:=null;job:=null;
   if e.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb then code:='voicemail_source_ineligible';state:='excluded';
   elsif e.raw_payload->>'provider_account_id' is distinct from r.email_account_id::text then code:='voicemail_mailbox_binding_unverified';
   elsif e.raw_payload->>'provider_availability'='unavailable' then code:='voicemail_provider_source_unavailable';
   elsif e.provider_message_id is null or e.provider_message_id!~'^[a-f0-9]{1,64}$' then code:='voicemail_provider_response_invalid';
   elsif e.received_at is null or not isfinite(e.received_at) then code:='voicemail_received_time_unverified';
   else
    millis:=extract(epoch from e.received_at)*1000;
    if millis<0 or millis>8640000000000000 or trunc(millis)<>millis then code:='voicemail_received_time_unverified';
    else
     select count(*) into matches from public.receptionist_voicemail_email_routes other
      join public.receptionist_mailboxes m on m.tenant_id=other.tenant_id and m.id=other.mailbox_id
      where other.tenant_id=p_tenant and other.email_account_id=r.email_account_id and other.enabled
       and m.provider='birchills' and m.extension=ext and e.received_at>=other.received_from
       and (other.received_until is null or e.received_at<other.received_until);
     if matches<>1 then code:='voicemail_route_ambiguous';
     elsif exists(select 1 from public.receptionist_voicemail_candidates prior
      where prior.tenant_id=p_tenant and prior.email_message_id=e.id and prior.route_id<>p_route and prior.job_id is not null)
     then code:='voicemail_source_previously_routed';
     else
      request:=jsonb_build_object('routeId',p_route,'accountId',r.email_account_id,'messageId',e.provider_message_id,'internalDate',trunc(millis)::text);
      code:='voicemail_selected';state:='selected';
     end if;
    end if;
   end if;
   select * into c from public.receptionist_voicemail_candidates where route_id=p_route and email_message_id=e.id for update;
   if found and c.job_id is not null then
    job:=c.job_id;
    select payload into previous_request from public.platform_jobs where id=job and tenant_id=p_tenant and job_type='phone.voicemail_import';
    if request is not null and previous_request is distinct from request then code:='voicemail_provider_source_changed';state:='needs_review';end if;
    -- Retain settled/dead-letter jobs; discovery is never an unbounded retry loop.
   elsif request is not null then
    insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,payload,max_attempts,available_at)
    values(p_tenant,'google-workspace','communications.phone','phone.voicemail_import',
     'voicemail-discovery:'||p_route::text||':'||e.id::text,'queued',request,3,at_time) returning id into job;
    selected:=selected+1;
   end if;
   if state='needs_review' then review:=review+1;elsif state='excluded' then excluded_count:=excluded_count+1;end if;
   insert into public.receptionist_voicemail_candidates(tenant_id,route_id,email_message_id,job_id,state,code,observed_at)
    values(p_tenant,p_route,e.id,job,state,code,at_time)
    on conflict(route_id,email_message_id) do update set job_id=excluded.job_id,state=excluded.state,code=excluded.code,observed_at=excluded.observed_at;
  end loop;
  s.last_id:=coalesce(last_seen,s.last_id);s.rows_examined:=s.rows_examined+n;s.pages:=s.pages+1;
  -- An exact 100-row page conservatively requires an additional empty page.
  finished:=n<100;
  if finished then s.completed_at:=clock_timestamp();s.next_scan_at:=s.completed_at+interval '15 minutes';end if;
  update public.receptionist_voicemail_scans set generation=s.generation,last_id=s.last_id,rows_examined=s.rows_examined,pages=s.pages,
   started_at=s.started_at,completed_at=s.completed_at,next_scan_at=s.next_scan_at where route_id=p_route;
  result:=jsonb_build_object('state',case when finished then 'retained_pass_complete' else 'scanning' end,'generation',s.generation,
   'observed_at',at_time,'rows_examined',n,'pass_rows_examined',s.rows_examined,'jobs_enqueued',selected,
   'needs_review',review,'excluded',excluded_count,'coverage_complete',false);
 end if;
 insert into public.receptionist_voicemail_scan_receipts(request_id,tenant_id,route_id,receipt) values(p_request,p_tenant,p_route,result);
 return result;
end$$;

-- Service-only aggregate for the operator controller. No names, caller numbers,
-- transcripts or source identifiers. Counters are observations, not provider coverage.
create function public.voicemail_discovery_status(p_tenant uuid,p_route uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare result jsonb;
begin
 if current_user<>'service_role' then raise exception 'voicemail_discovery_forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.receptionist_voicemail_email_routes where tenant_id=p_tenant and id=p_route)
 then raise exception 'voicemail_route_unverified' using errcode='22023';end if;
 select jsonb_build_object('scope','retained_email_candidates','coverage_complete',false,
  'generation',s.generation,'pass_started_at',s.started_at,'pass_completed_at',s.completed_at,'rows_examined',s.rows_examined,
  'next_scan_at',s.next_scan_at,'observed_at',clock_timestamp(),
  'candidates',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route),
  'needs_review',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route and state='needs_review'),
  'excluded',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route and state='excluded'),
  'jobs',coalesce((select jsonb_object_agg(status,n) from (
   select j.status,count(*) n from public.receptionist_voicemail_candidates c join public.platform_jobs j on j.id=c.job_id and j.tenant_id=c.tenant_id
   where c.tenant_id=p_tenant and c.route_id=p_route group by j.status) counts),'{}'::jsonb)) into result
 from (select 1) anchor left join public.receptionist_voicemail_scans s on s.route_id=p_route and s.tenant_id=p_tenant;
 return result;
end$$;
revoke all on function public.voicemail_discover_page(uuid,uuid,uuid),public.voicemail_discovery_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.voicemail_discover_page(uuid,uuid,uuid),public.voicemail_discovery_status(uuid,uuid) to service_role;

-- INPUT supabase/migrations/20261101450000_learn_voicemail_dispatch.sql
-- Bounded discovery on the existing platform-worker tick. No cron, credentials,
-- route activation or human access is seeded.

set local lock_timeout='5s';set local statement_timeout='30s';
alter table public.receptionist_voicemail_scans
 add column last_dispatch_at timestamptz,
 add column last_dispatch_success_at timestamptz,
 add column dispatch_next_at timestamptz,
 add column dispatch_code text;
create table public.receptionist_voicemail_dispatch_receipts(
 tick_id uuid primary key,tick_at timestamptz not null unique,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.receptionist_voicemail_dispatch_receipts enable row level security;
revoke all on public.receptionist_voicemail_dispatch_receipts from public,anon,authenticated;
grant select,insert on public.receptionist_voicemail_dispatch_receipts to service_role;
create trigger voicemail_dispatch_receipt_immutable before update or delete on public.receptionist_voicemail_dispatch_receipts
 for each row execute function public.voicemail_job_immutable();

-- One durable batch per UTC minute, shared by concurrent worker invocations.
-- At most two routes / five pages each / 1,000 retained rows per tick. All per-route
-- pages roll back together on error; another route can still make progress.
create function public.voicemail_schedule_tick() returns jsonb
language plpgsql security invoker set search_path=pg_catalog set timezone='UTC' as $$
declare tick timestamptz:=date_trunc('minute',clock_timestamp());request_id uuid;route record;
 cached jsonb;receipt jsonb;result jsonb;page integer;code text;route_pages integer;route_rows integer;route_jobs integer;
 attempted integer:=0;failed integer:=0;pages integer:=0;examined integer:=0;enqueued integer:=0;
begin
 if current_user<>'service_role' then raise exception 'voicemail_dispatch_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'voicemail_snapshot_invalid' using errcode='22023';end if;
 request_id:=md5('voicemail-dispatch/1:'||tick::text)::uuid;
 if not pg_try_advisory_xact_lock(hashtextextended('voicemail-dispatch/1',0)) then
  return jsonb_build_object('state','busy','coverage_complete',false,'historical_receipt',false);
 end if;
 select d.receipt into cached from public.receptionist_voicemail_dispatch_receipts d where d.tick_id=request_id;
 if found then return cached||jsonb_build_object('historical_receipt',true);end if;
 for route in
  select r.tenant_id,r.id from public.receptionist_voicemail_email_routes r
   left join public.receptionist_voicemail_scans s on s.route_id=r.id
   where r.enabled and (s.dispatch_next_at is null or s.dispatch_next_at<=clock_timestamp())
    and (s.next_scan_at is null or s.next_scan_at<=clock_timestamp())
   order by s.last_dispatch_at nulls first,r.id limit 2
 loop
  attempted:=attempted+1;code:=null;route_pages:=0;route_rows:=0;route_jobs:=0;
  -- Consistent capture -> route -> scan lock order with page discovery.
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||route.tenant_id::text,0));
  perform 1 from public.receptionist_voicemail_email_routes where id=route.id for share;
  insert into public.receptionist_voicemail_scans(tenant_id,route_id) values(route.tenant_id,route.id) on conflict do nothing;
  update public.receptionist_voicemail_scans set last_dispatch_at=clock_timestamp() where route_id=route.id;
  begin
   for page in 1..5 loop
    receipt:=public.voicemail_discover_page(route.tenant_id,route.id,md5(request_id::text||':'||route.id::text||':'||page::text)::uuid);
    route_pages:=route_pages+1;route_rows:=route_rows+(receipt->>'rows_examined')::integer;
    route_jobs:=route_jobs+(receipt->>'jobs_enqueued')::integer;
    exit when receipt->>'state'<>'scanning';
   end loop;
  exception when others then
   code:=case sqlstate when '55000' then 'voicemail_capture_paused' when '22023' then 'voicemail_route_unverified' else 'voicemail_discovery_unconfirmed' end;
  end;
  if code is null then
   pages:=pages+route_pages;examined:=examined+route_rows;enqueued:=enqueued+route_jobs;
   update public.receptionist_voicemail_scans set last_dispatch_success_at=clock_timestamp(),dispatch_next_at=tick+interval '1 minute',dispatch_code=null where route_id=route.id;
  else
   failed:=failed+1;
   update public.receptionist_voicemail_scans set dispatch_next_at=clock_timestamp()+interval '5 minutes',dispatch_code=code where route_id=route.id;
  end if;
 end loop;
 result:=jsonb_build_object('state',case when attempted=0 then 'idle' when failed>0 then 'attention' else 'completed' end,
  'observed_at',clock_timestamp(),'tick_at',tick,'routes_attempted',attempted,'routes_failed',failed,
  'pages',pages,'rows_examined',examined,'jobs_enqueued',enqueued,'coverage_complete',false,'historical_receipt',false);
 -- Empty installations make no scheduled writes. No heartbeat proves capture.
 if attempted>0 then insert into public.receptionist_voicemail_dispatch_receipts(tick_id,tick_at,receipt) values(request_id,tick,result);end if;
 return result;
end$$;
revoke all on function public.voicemail_schedule_tick() from public,anon,authenticated;
grant execute on function public.voicemail_schedule_tick() to service_role;
create function public.voicemail_discovery_status_data(p_tenant uuid,p_route uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare result jsonb;
begin
 if not exists(select 1 from public.receptionist_voicemail_email_routes where tenant_id=p_tenant and id=p_route)
 then raise exception 'voicemail_route_unverified' using errcode='22023';end if;
 select jsonb_build_object('scope','retained_email_candidates','coverage_complete',false,
  'generation',s.generation,'pass_started_at',s.started_at,'pass_completed_at',s.completed_at,'rows_examined',s.rows_examined,
  'next_scan_at',s.next_scan_at,'observed_at',clock_timestamp(),
  'capture_allowed',public.learn_capture_allowed(p_tenant,'email') and public.learn_capture_allowed(p_tenant,'phone'),
  'dispatch',jsonb_build_object('last_attempt_at',s.last_dispatch_at,'last_success_at',s.last_dispatch_success_at,'next_attempt_at',s.dispatch_next_at,'code',s.dispatch_code),
  'review_reasons',coalesce((select jsonb_object_agg(code,n) from (
   select code,count(*) n from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route and state='needs_review' group by code) reasons),'{}'::jsonb),
  'candidates',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route),
  'needs_review',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route and state='needs_review'),
  'excluded',(select count(*) from public.receptionist_voicemail_candidates where tenant_id=p_tenant and route_id=p_route and state='excluded'),
  'jobs',coalesce((select jsonb_object_agg(status,n) from (
   select j.status,count(*) n from public.receptionist_voicemail_candidates c join public.platform_jobs j on j.id=c.job_id and j.tenant_id=c.tenant_id
   where c.tenant_id=p_tenant and c.route_id=p_route group by j.status) counts),'{}'::jsonb)) into result
 from (select 1) anchor left join public.receptionist_voicemail_scans s on s.route_id=p_route and s.tenant_id=p_tenant;
 return result;
end$$;
revoke all on function public.voicemail_discovery_status_data(uuid,uuid) from public,anon,authenticated;
grant execute on function public.voicemail_discovery_status_data(uuid,uuid) to service_role;
create or replace function public.voicemail_discovery_status(p_tenant uuid,p_route uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$begin
 if current_user<>'service_role' then raise exception 'voicemail_discovery_forbidden' using errcode='42501';end if;
 return public.voicemail_discovery_status_data(p_tenant,p_route);
end$$;

-- Existing OpenFolk view authority only; no owner/manager bypass and no raw
-- message, transcript, recipient, caller, storage path or credential is returned.
create function public.learn_operator_voicemail_status(p_tenant uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 with rows as materialized(
  select r.id,r.enabled,case when m.extension~'^[0-9]{3}$' then m.extension else null end as extension from public.receptionist_voicemail_email_routes r
   join public.receptionist_mailboxes m on m.tenant_id=r.tenant_id and m.id=r.mailbox_id
   where r.tenant_id=p_tenant and (p_after is null or r.id>p_after) order by r.id limit 21
 ),shown as(select * from rows order by id limit 20)
 select jsonb_build_object('version','learn-voicemail-status/1','tenant_id',p_tenant,'observed_at',clock_timestamp(),
  'routes',coalesce((select jsonb_agg(jsonb_build_object('route_id',id,'enabled',enabled,'extension',extension,
   'status',public.voicemail_discovery_status_data(p_tenant,id)) order by id) from shown),'[]'::jsonb),
  'next_after',case when (select count(*) from rows)>20 then (select id from shown order by id desc limit 1) else null end)
 into result;
 return result;
end$$;
revoke all on function public.learn_operator_voicemail_status(uuid,uuid) from public,anon;
grant execute on function public.learn_operator_voicemail_status(uuid,uuid) to authenticated;

-- INPUT supabase/migrations/20261101460000_learn_voicemail_inbox_history.sql
-- Discover existing caller-visible historical messages after a mailbox is reassigned.
-- SECURITY INVOKER throughout: no new message, mailbox or Storage permission.

create function public.learn_voicemail_mailboxes(p_tenant uuid,p_after uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if current_user <> 'authenticated' or auth.uid() is null or p_tenant is null then
  raise exception using errcode='42501',message='Signed-in voicemail access required';
 end if;
 with visible_ids as materialized (
  select id from public.receptionist_mailboxes where tenant_id=p_tenant
  union
  select mailbox_id from public.receptionist_voicemails where tenant_id=p_tenant
 ), page_ids as materialized (
  select id from visible_ids where p_after is null or id>p_after order by id limit 21
 ), shown as materialized (
  select id from page_ids order by id limit 20
 ), rows as (
  select s.id,
   case when b.id is null then 'Earlier private messages' else b.display_name end as display_name,
   case when b.id is null then '' else b.extension end as extension,
   b.notification_email,b.email_enabled,
   coalesce(b.sync_state,'awaiting_connection') as sync_state,b.last_synced_at,
   (select count(*) from public.receptionist_voicemails v where v.tenant_id=p_tenant and v.mailbox_id=s.id) as message_count,
   case when b.id is null then 'retained_messages' else 'current' end as access_scope
  from shown s left join public.receptionist_mailboxes b on b.tenant_id=p_tenant and b.id=s.id
 )
 select jsonb_build_object('version','learn-voicemail-mailboxes/1','tenant_id',p_tenant,
  'after',p_after,'observed_at',statement_timestamp(),
  'next_after',case when (select count(*) from page_ids)>20 then (select id from shown order by id desc limit 1) else null end,
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by id) from rows r),'[]'::jsonb)) into result;
 return result;
end$$;
revoke all on function public.learn_voicemail_mailboxes(uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_voicemail_mailboxes(uuid,uuid) to authenticated;
comment on function public.learn_voicemail_mailboxes(uuid,uuid) is
 'Caller-RLS paginated private inbox. Historical-only rows contain no current mailbox configuration; count only messages already visible to caller.';

insert into of_learn_deploy.migrations values('learn_voicemail_capture_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
