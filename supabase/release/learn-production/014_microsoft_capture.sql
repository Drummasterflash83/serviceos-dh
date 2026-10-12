-- DRAFT: requires matched Microsoft workers and explicit production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;actual_views jsonb;actual_storage jsonb;actual_buckets jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Microsoft target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_voicemail_capture_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='d145d65687abb1b277323295b1ee57c22a7407c33294982d681b8a2418b47fd7') then raise exception 'Pinned production Voicemail prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_microsoft_capture_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['learn_microsoft_mailbox_bindings','learn_microsoft_capture_streams','learn_microsoft_source_pages','learn_microsoft_job_completions','learn_microsoft_folder_dispatches','learn_microsoft_projection_receipts','learn_microsoft_discovery_rounds','learn_microsoft_job_stops']))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_microsoft_journal_immutable','learn_microsoft_binding_guard','learn_microsoft_checkpoint_valid','learn_microsoft_journal_guard','learn_microsoft_journal_open','learn_microsoft_journal_commit','learn_microsoft_journal_job','learn_microsoft_job_settle','learn_microsoft_dispatch_folders','learn_microsoft_projection_time','learn_microsoft_projection_fields_valid','learn_microsoft_page_project','learn_microsoft_job_settle_before_projection','learn_microsoft_credential_read','learn_microsoft_credential_refresh','learn_microsoft_job_stop','learn_microsoft_job_claimable','learn_operator_microsoft_status'])) then raise exception 'Production Microsoft candidate already exists; inspect before retry';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['email_accounts','email_messages','email_oauth_tokens','email_threads','google_workspace_connections','google_workspace_mailboxes','interactions','jobs','marketing_sender_profiles','outcomes','platform_events','platform_jobs','profiles','tenant_connector_capabilities','tenant_connectors']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_accounts","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"email_address","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"backfill_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"4211c0ccfcd36b328b71623726ce8860"},{"name":"backfill_started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_page_token","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_total_fetched","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"backfill_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"history_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"auth_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"auth_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"auth_state_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_incremental_success_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_incremental_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_sync_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"8c5f1fef9bc0a6370581ec2612f6593c","name":"email_accounts_pkey","valid":true},{"hash":"ff306db49bb9dce90ff69d94e1efedb3","name":"email_accounts_tenant_id_idx","valid":true},{"hash":"448b9e573800fcb3258f76a4e34378ff","name":"email_accounts_tenant_id_provider_email_address_key","valid":true},{"hash":"89919591661cca90db7edf45969364bb","name":"email_accounts_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"email_account_protocol_select_v2","roles":["email_ingestion_protocol_owner"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"},{"name":"email_account_protocol_update_v2","roles":["email_ingestion_protocol_owner"],"command":"UPDATE","checkHash":"b326b5062b2f0e69046810717534cb09","usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"},{"name":"email_accounts_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"3b4b9e3afc4712c0a2eca19c2229c541","name":"email_accounts_set_updated_at","enabled":"O"},{"hash":"accbfe67aad061aa9a75c8245235fa8a","name":"email_ingestion_account_guard_v2","enabled":"O"},{"hash":"594d8a952306667e5cf9b6c8df56c8df","name":"marketing_capability_sync_email_accounts","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_accounts_pkey","validated":true},{"hash":"6a887a787213a24fb65c3f1c76dab1b6","kind":"u","name":"email_accounts_tenant_id_provider_email_address_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_messages","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"provider_message_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"provider_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"cc_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"snippet","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_html","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sent_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"received_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"origin","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_delivery_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_automation_intent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"ddab13827db6fc862b347926210f2b5f","name":"email_messages_from_idx","valid":true},{"hash":"aa0806d4070a7b3212a80a84eb9c7d5c","name":"email_messages_pkey","valid":true},{"hash":"b6c142a1e1681434cb7a2e0292da277d","name":"email_messages_received_idx","valid":true},{"hash":"fe1c7bcc6524405f48f28a236599ee8e","name":"email_messages_tenant_id_idx","valid":true},{"hash":"ca8629c22d3dd310b1126f117b9b008b","name":"email_messages_tenant_id_provider_provider_message_id_key","valid":true},{"hash":"a2e59fd4b71cb47545b35622ff50fd81","name":"email_messages_thread_idx","valid":true},{"hash":"d2f23ed96915739aff2cdbed6759982a","name":"email_messages_voicemail_scan_idx","valid":true}],"forceRls":false,"policies":[{"name":"email_messages_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_card_email_source_read","roles":["learn_card_communication_reader"],"command":"SELECT","checkHash":null,"usingHash":"2a5553540e81f719dbc24055f40ca56d","permissive":"PERMISSIVE"},{"name":"learn_cards_production_boundary","roles":["learn_card_communication_reader"],"command":"SELECT","checkHash":null,"usingHash":"2a5553540e81f719dbc24055f40ca56d","permissive":"RESTRICTIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"87e7af360d7a3fb98bcdea12d9105317","name":"email_messages_set_updated_at","enabled":"O"},{"hash":"f0031e3b13fd91945cc5615cee21adab","name":"learn_email_preserve_source_version","enabled":"O"}],"constraints":[{"hash":"b62110fa0a5753efbae5ef5b8caccc97","kind":"f","name":"email_messages_origin_campaign_fk","validated":true},{"hash":"1220af29a1985a4dabe03353bd48d8fe","kind":"c","name":"email_messages_origin_check","validated":true},{"hash":"a30c441924cbce62b8ad5027db53e1c5","kind":"f","name":"email_messages_origin_delivery_fk","validated":true},{"hash":"19a3d8f70792afd54bb9f0f14df3e6a6","kind":"f","name":"email_messages_origin_intent_fk","validated":true},{"hash":"e865d926f40b1e90e54c88f2d92a7bc1","kind":"f","name":"email_messages_origin_person_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_messages_pkey","validated":true},{"hash":"7b594e8645b3085fdc803326bd97c4e4","kind":"u","name":"email_messages_tenant_id_provider_provider_message_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_oauth_tokens","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"email_account_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"access_token","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"refresh_token","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"expires_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"scope","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"token_type","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"099ec43ca9cdc3be76171a0a19ccb69b","name":"email_oauth_tokens_email_account_id_key","valid":true},{"hash":"a62869289b332aa32336e7d39ad91be8","name":"email_oauth_tokens_pkey","valid":true},{"hash":"75f7bbc022edb0343c7ef139e3f7c018","name":"email_oauth_tokens_tenant_id_idx","valid":true}],"forceRls":false,"policies":[],"triggers":[{"hash":"cbc795ded4105af6b9952079c66ad848","name":"email_oauth_tokens_set_updated_at","enabled":"O"},{"hash":"cb18eaee90553a36c36d745b937390c2","name":"marketing_capability_sync_tokens_del","enabled":"O"},{"hash":"67049a0a76b28c8a1a34bff776b0312c","name":"marketing_capability_sync_tokens_ins","enabled":"O"},{"hash":"a5d099dee9f6ad3975c6c07fab3c3175","name":"marketing_capability_sync_tokens_upd","enabled":"O"}],"constraints":[{"hash":"c029969f6095ed267e5f37e582e1f30f","kind":"f","name":"email_oauth_tokens_account_tenant_fk","validated":true},{"hash":"d3ae20d46567cd6573502a0748d2e3ca","kind":"f","name":"email_oauth_tokens_email_account_id_fkey","validated":true},{"hash":"b1f3fdc1ced9b6fdc0baecc6210e9fb4","kind":"u","name":"email_oauth_tokens_email_account_id_key","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_oauth_tokens_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_threads","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"provider_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"participants","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"last_message_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"dbd0e1d90a51f9299560440f90f9dd7b","name":"email_threads_feed_idx","valid":true},{"hash":"4bc2786fbe6972c3138aa949b5d924db","name":"email_threads_pkey","valid":true},{"hash":"bb947bbcebbba1737fdaacbe8bca5536","name":"email_threads_tenant_id_idx","valid":true},{"hash":"5550cfbf0f1bde75d4b708715b5b83df","name":"email_threads_tenant_id_provider_provider_thread_id_key","valid":true}],"forceRls":false,"policies":[{"name":"email_threads_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"93a9ba7c54a19a43b0f49190b52a73d3","name":"email_threads_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_threads_pkey","validated":true},{"hash":"24542bdf15f55b51057f8337cfa35506","kind":"u","name":"email_threads_tenant_id_provider_provider_thread_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"google_workspace_connections","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"customer_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"service_account_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"b8521f074b5072cdc34cf836cacde18e"},{"name":"delegated_scopes","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"impersonation_subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"service_account_client_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"authorised_scopes","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"last_verified_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"error_message","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"aa6aa8b849aaf6bf9d6c450c7de05096","name":"google_workspace_connections_pkey","valid":true},{"hash":"816977195191281fc40d0ea43ebbc28e","name":"google_workspace_connections_tenant_id_domain_key","valid":true},{"hash":"1cec1b51c70ee22ac853fe6fd9bc468d","name":"google_workspace_connections_tenant_id_idx","valid":true}],"forceRls":false,"policies":[{"name":"google_workspace_connections_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"644067b0d0054cba653b67fc50f0abf9","name":"google_workspace_connections_set_updated_at","enabled":"O"},{"hash":"7c9569ae33c98ce1b92a7e847507c018","name":"marketing_capability_sync_ws_connections","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"google_workspace_connections_pkey","validated":true},{"hash":"33444317a44b9aae4621c12710722677","kind":"u","name":"google_workspace_connections_tenant_id_domain_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"google_workspace_mailboxes","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connection_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"email_address","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"mailbox_type","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sync_enabled","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"last_seen_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"directory_primary_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"directory_identity_conflict","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"}],"indexes":[{"hash":"3bb61befc7e925951516b82516d896fb","name":"google_workspace_mailboxes_connection_id_email_address_key","valid":true},{"hash":"2c729c54213e0f58a702288e302af3db","name":"google_workspace_mailboxes_connection_idx","valid":true},{"hash":"92ce203416b14bb5cffa6bf4b7985769","name":"google_workspace_mailboxes_pkey","valid":true},{"hash":"81aa08655308b279dd0f19e0d4add6c8","name":"google_workspace_mailboxes_tenant_id_idx","valid":true},{"hash":"76184dff842c473570bf262f78573db5","name":"google_workspace_mailboxes_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"google_workspace_mailboxes_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"5189be9344bac2363011825a28d3e356","name":"google_workspace_mailboxes_set_updated_at","enabled":"O"},{"hash":"9b61656a9031530f44e32220436310eb","name":"learn_workspace_identity_guard","enabled":"O"},{"hash":"d60e5f4e8d471d86e7873c247d7557e5","name":"marketing_capability_sync_ws_mailboxes","enabled":"O"}],"constraints":[{"hash":"b70185eaaae7fb5de318ccf258282257","kind":"c","name":"google_workspace_directory_primary_email_valid","validated":true},{"hash":"c1d02a80091317001416b0eb6478ecdb","kind":"u","name":"google_workspace_mailboxes_connection_id_email_address_key","validated":true},{"hash":"f7758b7c5c21f0235f6e645b45652ca4","kind":"f","name":"google_workspace_mailboxes_connection_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"google_workspace_mailboxes_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"interactions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_connector_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_table","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"interaction_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"summary","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_preview","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_address","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_addresses","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"cc_addresses","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"phone_from","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"phone_to","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"processing_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"sentiment","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_task_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"source_updated_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_version","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"386b7aa4a596d1f7a436f82ee5cd30d1","name":"interactions_pkey","valid":true},{"hash":"e9634fa8eca4b28f9d63657404df3fae","name":"interactions_related_campaign_idx","valid":true},{"hash":"8eaaf68213fe01dc3342f1135af48b37","name":"interactions_tenant_company_idx","valid":true},{"hash":"344e9c6e9a40d3f4cc5ffdd75d892e06","name":"interactions_tenant_connector_occurred_idx","valid":true},{"hash":"78eb70cc7e2fa21d550574b7d7fd2567","name":"interactions_tenant_id_source_table_source_id_key","valid":true},{"hash":"b872f2d916dee27b2d740a273b3a3a86","name":"interactions_tenant_occurred_idx","valid":true},{"hash":"9ab02b39c0a9dcb409371595dd22b317","name":"interactions_tenant_person_idx","valid":true},{"hash":"9026abb0805ac33730d78a21bdc85364","name":"interactions_tenant_processing_idx","valid":true},{"hash":"60847df577987b97a1aa8e49893f6740","name":"interactions_tenant_type_occurred_idx","valid":true},{"hash":"cfa31edad77dc169ce86ec6f0bb18c10","name":"interactions_tenant_type_source_idx","valid":true}],"forceRls":false,"policies":[{"name":"interactions_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_card_communication_read","roles":["learn_card_communication_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_cards_production_boundary","roles":["learn_card_communication_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"3b4c64fd9157e1dab30e91b351a56128","name":"interactions_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"interactions_pkey","validated":true},{"hash":"2e6cb81b96ef1f338484943fdb13da96","kind":"f","name":"interactions_related_campaign_fk","validated":true},{"hash":"2dc4fa1294c5cf8d6796d8b4c37f0fa0","kind":"u","name":"interactions_tenant_id_source_table_source_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"site_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"engineer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"invoice_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"quote_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"value_pennies","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"booked_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ee37b3b19e0eb6a9ec843fb638bb846b"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"e2b5d04060b50f96e02ff49b339ed40c","name":"jobs_number_uk","valid":true},{"hash":"47262421c727307ac344956cf7d14923","name":"jobs_pkey","valid":true},{"hash":"e34e04d2ff2d6c0312b227bd2c49508c","name":"jobs_source_uk","valid":true},{"hash":"cc280df5dbcf661faf07141d3eecca73","name":"jobs_tenant_customer_idx","valid":true},{"hash":"184a00fe1e8d9d8202141da43859208a","name":"jobs_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"6531df5998769ed5ffb7779d6ce6dfbb","name":"jobs_set_updated_at","enabled":"O"},{"hash":"9e38c2eb0e81c9ead9a4527ff2bc657e","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"08723955dee11c6cd8edfc8398afbaa0","kind":"f","name":"jobs_customer_company_id_fkey","validated":true},{"hash":"916bf00abad8f3f94f73abdcedf20f1d","kind":"f","name":"jobs_customer_person_id_fkey","validated":true},{"hash":"e51bea4de5e209d1bec8820944969827","kind":"f","name":"jobs_engineer_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"jobs_pkey","validated":true},{"hash":"d17aadc9a7f4da0432796d76a1939418","kind":"f","name":"jobs_site_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"marketing_sender_profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"email_account_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"workspace_mailbox_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"mailbox_address","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"86e751880b3791dd7c2efae188915799"},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"reply_to","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"signature_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"enabled","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"send_scope_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"scope_checked_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_verified_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"verification_note","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"updated_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"9d0b8be5eab53878cb8c4bcb5e6aa080","name":"marketing_sender_profiles_account_uk","valid":true},{"hash":"7a82e08a68de153530206c2038e2308e","name":"marketing_sender_profiles_idx","valid":true},{"hash":"e1571aa4db61135b9aec507c14bcac75","name":"marketing_sender_profiles_mailbox_uk","valid":true},{"hash":"e733e0d94c9a2794c07f8d9df5afd930","name":"marketing_sender_profiles_pkey","valid":true},{"hash":"948621b97d05c326d80d666d2be489eb","name":"marketing_sender_profiles_tenant_id_id_key","valid":true},{"hash":"cd7ca45d015d6c9027d33f0cbee9978c","name":"marketing_sender_profiles_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"marketing_sender_profiles_select","roles":["public"],"command":"SELECT","checkHash":null,"usingHash":"f561f2d858976074e1c5cf15885a1d7d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"b077eccbc7d15af6a6ea5ee2cdbfa20d","name":"marketing_capability_sync_sender_source_lost","enabled":"O"},{"hash":"5dd97121f393129dbcf9d90b35fc2a03","name":"marketing_sender_profiles_guard","enabled":"O"},{"hash":"1dcb3dbce643851d514e2f3cf2f045c9","name":"marketing_sender_profiles_set_updated_at","enabled":"O"}],"constraints":[{"hash":"e2543ffeb83cd012e62e33212eca20a3","kind":"c","name":"marketing_sender_profiles_from_name_check","validated":true},{"hash":"6298c5b175bbb176be9323e009983a3f","kind":"c","name":"marketing_sender_profiles_label_check","validated":true},{"hash":"85f2f051f17e193461c3d32b72e112df","kind":"c","name":"marketing_sender_profiles_mailbox_address_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"marketing_sender_profiles_pkey","validated":true},{"hash":"074404a0ec2d3b25a13b0eeb598e195a","kind":"c","name":"marketing_sender_profiles_reply_to_check","validated":true},{"hash":"c61d9ad83d7c4d5c78938e701128ecd8","kind":"c","name":"marketing_sender_profiles_send_scope_state_check","validated":true},{"hash":"6d44ea5e2360d71166483dcd5e7e8ba2","kind":"c","name":"marketing_sender_profiles_signature_text_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"marketing_sender_profiles_tenant_id_fkey","validated":true},{"hash":"51ee2716dc1abea90609c31b3f3c041c","kind":"u","name":"marketing_sender_profiles_tenant_id_id_key","validated":true},{"hash":"44a5fc49488f894cc89177b67bfd5517","kind":"c","name":"marketing_sender_profiles_verification_note_check","validated":true},{"hash":"031ebe18b6b6c02b523d31baef9ba570","kind":"f","name":"msp_account_fk","validated":true},{"hash":"69f668561c72d5014a31695fa6c268a7","kind":"f","name":"msp_created_by_fk","validated":true},{"hash":"a9a27d9f5d15e2cc604fc46fdae084fd","kind":"f","name":"msp_mailbox_fk","validated":true},{"hash":"eed6c7d73789625d16baf523dbb7cb85","kind":"c","name":"msp_source_kind_shape","validated":true},{"hash":"662f1d4ed48833358c7a30717ecf5a16","kind":"c","name":"msp_source_kind_v2","validated":true},{"hash":"7ff2f692be96f820f7246041455acb3f","kind":"f","name":"msp_updated_by_fk","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"outcomes","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"action_object_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"automation_intent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"execution_attempt_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"outcome_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"outcome_layer","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3ca1fec6889bdd1075274fd1bec86a6b"},{"name":"observed_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_reference","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"correlation_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"supersedes","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"verification_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":"a25c891ea2bcab2d12cb42513bb86644"},{"name":"source_kind","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_record_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"fe03634b029212aeb18679cc66b5d94d","name":"outcomes_intent","valid":true},{"hash":"9649035c89cf8c2db29d56abfa1d2488","name":"outcomes_pkey","valid":true},{"hash":"2e76e1f53a07c342e85fd2b39b113d19","name":"outcomes_series","valid":true},{"hash":"09f84baecb062b9e6d5c3243ed475506","name":"outcomes_supersedes","valid":true}],"forceRls":false,"policies":[{"name":"outcomes_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"385139ad3a07fd854bfd4c3e6010bbbe","name":"automation_outcomes_inherit_correlation","enabled":"O"},{"hash":"ed852c8a53a1207359d72bd7439658ec","name":"outcomes_business_needs_verification","enabled":"O"},{"hash":"fb79c5d40c52130f4255c2e712f2eb79","name":"outcomes_no_delete","enabled":"O"},{"hash":"f7114b7e3e1180f8449a7ba0029c9ea5","name":"outcomes_no_update","enabled":"O"},{"hash":"818595b1c6eead06ff70af3cee0b8ef2","name":"outcomes_tenant_consistency","enabled":"O"}],"constraints":[{"hash":"f60b9a62423dd5362879f03e0ea3ad50","kind":"f","name":"outcomes_action_object_id_fkey","validated":true},{"hash":"365c3b1d11a9793678381b94a5149032","kind":"f","name":"outcomes_automation_intent_id_fkey","validated":true},{"hash":"48594af42f103c2c2a955b854e00a070","kind":"f","name":"outcomes_execution_attempt_id_fkey","validated":true},{"hash":"6f3bd1d9093bba685449a06a6554f8cd","kind":"f","name":"outcomes_outcome_layer_fkey","validated":true},{"hash":"4fd603db982be64136e41cb9b94bcd3b","kind":"f","name":"outcomes_outcome_type_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"outcomes_pkey","validated":true},{"hash":"30d71e4054f0cac38ef6be189ea6c4b2","kind":"f","name":"outcomes_status_fkey","validated":true},{"hash":"482362860c2049874b25a9db3f4934dc","kind":"f","name":"outcomes_supersedes_fkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"outcomes_tenant_id_fkey","validated":true},{"hash":"22c384c67f261549bde7d9430b5f631b","kind":"f","name":"outcomes_verification_state_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_events","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"event_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"attempts","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"published_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"consumed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"actor","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"correlation_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"b492f6fbb2f09e1b0f0f0048d548841d","name":"platform_events_pending_subject_uk","valid":true},{"hash":"bc384965f69238d3fc29ecb7dcd53441","name":"platform_events_pkey","valid":true},{"hash":"542001a3bb43c8d86c0c3651a78b77bc","name":"platform_events_tenant_subject_idx","valid":true},{"hash":"eccb61d59f70f50973014ee590e1a674","name":"platform_events_tenant_type_status_idx","valid":true}],"forceRls":false,"policies":[{"name":"platform_events_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"9bf4a16275ca9fd32d48e04d21dcfb43","name":"platform_events_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_events_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"module_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"job_key","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"7c86ea6e5094355ad44b6867fa51b433"},{"name":"priority","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"f899139df5e1059396431415e770c6dd"},{"name":"progress_current","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"progress_total","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"attempt_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"max_attempts","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"eccbc87e4b5ce2fe28308fd9f2a7baf3"},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"failed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cancelled_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"next_run_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"result","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"available_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"lease_expires_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"dead_lettered_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"error_code","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"parent_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"e8ec53579fc23c9f8c7ec9cbcc9a0fe8","name":"platform_jobs_active_job_key_uk","valid":true},{"hash":"0c8ea2ecee43cf1b569083bac92b3889","name":"platform_jobs_claim_idx","valid":true},{"hash":"95f16cdddc29e798beb223f90905fec3","name":"platform_jobs_lease_idx","valid":true},{"hash":"a2be2946f7e3402dc0501da0f336f113","name":"platform_jobs_parent_idx","valid":true},{"hash":"f8699761f53393f77b94bc724a99e825","name":"platform_jobs_pkey","valid":true},{"hash":"95bfc00526e7f302fb99702339694c04","name":"platform_jobs_tenant_connector_idx","valid":true},{"hash":"1ed91a0d9b3bf296158e7c4558ce3189","name":"platform_jobs_tenant_next_run_idx","valid":true},{"hash":"a22868c903eedcb64e7366fb3249911f","name":"platform_jobs_tenant_status_idx","valid":true},{"hash":"a3359af1d6c9ed909e3b424d77e7a174","name":"platform_jobs_tenant_type_idx","valid":true}],"forceRls":false,"policies":[{"name":"platform_jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"885bc7f92806b78eac67d45a9143c9ca","name":"platform_jobs_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_jobs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"full_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ebe5151db32cb9795191097a4f9511a9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b7142bbffc23de763c1bd9f00489ec05","name":"profiles_pkey","valid":true},{"hash":"c07a523f1ebc968ab6b32bd5c984f32b","name":"profiles_role_idx","valid":true},{"hash":"610436088a5788625dd6956b9059f8c9","name":"profiles_tenant_id_idx","valid":true},{"hash":"84b975915f84814cf35c7604d4f94ecf","name":"profiles_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"learn_card_communication_profile","roles":["learn_card_communication_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_cards_production_boundary","roles":["learn_card_communication_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"learn_launch_metadata_profile","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"profiles_select_own","roles":["public"],"command":"SELECT","checkHash":null,"usingHash":"bc9c729a84690340789a4e4f01175335","permissive":"PERMISSIVE"}],"triggers":[{"hash":"bb3752d7064fd9e06fbe457f475928cc","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"83b0936855bf3bb7daa4f8356eb3c926","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a97ecad600d272e906bb06dea0b91c4","name":"profiles_set_updated_at","enabled":"O"}],"constraints":[{"hash":"0061c9fb3a9abcf2edbcd4a42467a9c3","kind":"f","name":"profiles_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"profiles_pkey","validated":true},{"hash":"4b3bd90c7f38a26788aecebbe2479ad7","kind":"c","name":"profiles_role_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenant_connector_capabilities","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"capability_key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"enabled","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"config","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"93e8e7a07495c6472ef1a7a3beca625f","name":"tcc_lookup","valid":true},{"hash":"b6028ef5907b9d593ee97dbf5730633a","name":"tenant_connector_capabilities_pkey","valid":true},{"hash":"46dcc8fde4a2947e0accf44f94e19548","name":"tenant_connector_capabilities_tenant_id_connector_id_capabi_key","valid":true}],"forceRls":false,"policies":[{"name":"tenant_connector_capabilities_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"956336a60323852d31c70a4080bf0bf8","kind":"f","name":"tenant_connector_capabilities_capability_key_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenant_connector_capabilities_pkey","validated":true},{"hash":"b631f48d2b2b574706b1420838c1a7c9","kind":"u","name":"tenant_connector_capabilities_tenant_id_connector_id_capabi_key","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"tenant_connector_capabilities_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenant_connectors","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"category","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"5dbf8349d9384bba7422dab65d75d428"},{"name":"health_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"enabled","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"settings","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"last_successful_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_failed_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2a999164558672de593a5cee2ad1199a","name":"tenant_connectors_pkey","valid":true},{"hash":"6909a1d595c44c251b88ae925a11c1ed","name":"tenant_connectors_tenant_id_connector_id_key","valid":true},{"hash":"b0d64bed4b9196a44db82e7ae165547f","name":"tenant_connectors_tenant_id_idx","valid":true}],"forceRls":false,"policies":[{"name":"tenant_connectors_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"45a4a9345cd9fdacc7eec28d9e54eed7","name":"learn_connector_reference_guard","enabled":"O"},{"hash":"9902ab88fa7717f94aad8e8d210311f1","name":"learn_connector_retain","enabled":"O"},{"hash":"69e86bf6f6593d14968522a1e6958d38","name":"learn_connector_retain_truncate","enabled":"O"},{"hash":"05f7b4b7a819d47c4f9215eed99d9365","name":"tenant_connectors_set_updated_at","enabled":"O"}],"constraints":[{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_connector_tenant_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenant_connectors_pkey","validated":true},{"hash":"24cb83f88599181c6922a60d2bfb8328","kind":"u","name":"tenant_connectors_tenant_id_connector_id_key","validated":true}]}]'::jsonb then raise exception 'Production Microsoft table baseline differs';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['current_tenant_id','current_user_role','learn_capture_allowed','learn_capture_job_allowed','learn_operator_input_access','marketing_scope_has','marketing_sender_capability_sync','marketing_sender_readiness','marketing_source_capability_sync','platform_jobs_claim']);
 if actual_helpers is distinct from '[{"hash":"58873c19368521e21e846890ee429301","name":"current_tenant_id","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"760512ca1d1f925421f3faf36e9d4447","name":"current_user_role","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"cc8bc01c1ebd3da0c5f0ec5de3754667","name":"learn_capture_allowed","owner":"postgres","arguments":"p_tenant uuid, p_source text","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"a775d5552608ae0e222cee9ac3d3e51b","name":"learn_capture_job_allowed","owner":"postgres","arguments":"p_tenant uuid, p_type text, p_metadata jsonb","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"d35ae90b9c0c38e1b26197d72f87f740","name":"learn_capture_job_allowed","owner":"postgres","arguments":"p_tenant uuid, p_type text, p_metadata jsonb, p_job uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"6ebce242963afa929b7465a99e7608c6","name":"learn_operator_input_access","owner":"postgres","arguments":"p_tenant uuid, p_actor uuid, p_write boolean","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"fcd95f4ead50b148dbb3e920dfdd67c9","name":"marketing_scope_has","owner":"postgres","arguments":"p_scope text, p_required text","anonExecute":false,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"3eb566207278800df53426e6a16a07fa","name":"marketing_sender_capability_sync","owner":"postgres","arguments":"p_tenant uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"9781e4a29980d854d59e54c1f87e944c","name":"marketing_sender_readiness","owner":"postgres","arguments":"p_tenant uuid, p_sender uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"49dc0c4c04820973dfe0651025918056","name":"marketing_source_capability_sync","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"27fb43fbc97dd2f276fc274ada9101b9","name":"platform_jobs_claim","owner":"postgres","arguments":"p_worker text, p_batch integer, p_lease_seconds integer, p_job_types text[]","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false}]'::jsonb then raise exception 'Production Microsoft helper baseline differs';end if;
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
 if actual_views is distinct from '[{"hash":"f9c7f18fbcf81cbd78d3ffae9ae65402","name":"controlplane_current_ownership_v","owner":"postgres","options":["security_invoker=true"]},{"hash":"a0e44ad30cc37aaa59ff57b4c1eff2e1","name":"learn_launch_email_accounts","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"1e1cc7c2951a77221ae568bc1c8b6b48","name":"learn_launch_email_messages","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"7e335ca092e0b76374c040c58c4083c4","name":"learn_launch_email_sync_runs","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"75b31dd7c4a5fbc66a3edd2af7714e63","name":"learn_launch_google_workspace_mailboxes","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"5b71f81069d25c9bc5325ce969212a5a","name":"learn_launch_phone_calls","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"5ee434eb72215563c83dd1851683a0b6","name":"learn_launch_phone_recordings","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"561f405293a8d41abe634d9c5b95649d","name":"learn_launch_phone_sync_runs","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"cbdbc17f610ecd6cc3965a17713670de","name":"learn_launch_phone_transcripts","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"2fd37022d57de7c4c6578bd92ee31b81","name":"phone_recording_pipeline_state","owner":"postgres","options":["security_invoker=on"]},{"hash":"afd8b68d88fdbeddfe6dc42c8be29f82","name":"recommendation_objects","owner":"postgres","options":["security_invoker=on"]},{"hash":"f03f36c81d9588d216b8a3b4ea66ceee","name":"recommendations_compat","owner":"postgres","options":["security_invoker=on"]},{"hash":"46995b89f37421d838589b7fb5b1462a","name":"response_refinement_trail","owner":"postgres","options":["security_invoker=true"]}]'::jsonb then raise exception 'Production Microsoft view baseline differs';end if;
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
 if actual_storage is distinct from '{"views":[],"tables":[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":true,"privilege":"DELETE"},{"role":"postgres","grantable":true,"privilege":"INSERT"},{"role":"postgres","grantable":true,"privilege":"MAINTAIN"},{"role":"postgres","grantable":true,"privilege":"REFERENCES"},{"role":"postgres","grantable":true,"privilege":"SELECT"},{"role":"postgres","grantable":true,"privilege":"TRIGGER"},{"role":"postgres","grantable":true,"privilege":"TRUNCATE"},{"role":"postgres","grantable":true,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":true,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":true,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":true,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":true,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":true,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"UPDATE"}],"rls":true,"name":"buckets","owner":"supabase_storage_admin","columns":[{"name":"id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"owner","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"public","type":"boolean","notNull":false,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"avif_autodetection","type":"boolean","notNull":false,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"file_size_limit","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"allowed_mime_types","type":"text[]","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"owner_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"type","type":"storage.buckettype","notNull":true,"identity":"","generated":"","defaultHash":"5485714ce72f40c6ffe2818e53862fca"},{"name":"versioning_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"63c248537d1b4fd4346b2a9fdab80c93"},{"name":"lifecycle_configuration","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"lifecycle_configuration_generation","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"edb8be523c6e3c1ed9e7bd0eb32213af","name":"bname","valid":true},{"hash":"ff95cddc14c418511f2faaf69e4fe6b1","name":"buckets_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[{"hash":"7774f4b5e39e4ad07a16a589aef6277c","name":"enforce_bucket_name_length_trigger","enabled":"O"},{"hash":"5c2f86adf97481d45808f2ed4eb4673b","name":"protect_bucket_control_insert","enabled":"O"},{"hash":"ae169c5f8d35b69020459ddddbe65d7e","name":"protect_bucket_control_update","enabled":"O"},{"hash":"34d64d2c71ac2a26720ae99bd0da100b","name":"protect_bucket_control_update_role","enabled":"O"},{"hash":"50288cfc0da92cd8f2f573c018c16382","name":"protect_buckets_delete","enabled":"O"}],"constraints":[{"hash":"8ab704b1e9b6d3b352ee627be25d1152","kind":"c","name":"buckets_lifecycle_configuration_pair_check","validated":true},{"hash":"7081eb4a5d6997a885f9aa46e10a9dae","kind":"c","name":"buckets_lifecycle_configuration_shape_check","validated":true},{"hash":"7da5700c5c8fd72c4b2477f1fae46f56","kind":"c","name":"buckets_lifecycle_configuration_standard_only_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"buckets_pkey","validated":true},{"hash":"8204da0258fb5df422b3e93c39a44bf6","kind":"c","name":"buckets_versioning_dark_check","validated":true},{"hash":"3705d86bc1c7a8420a3130c600f3eeec","kind":"c","name":"buckets_versioning_standard_only_check","validated":true},{"hash":"243285ca65c9836f911c96b530d1034c","kind":"c","name":"buckets_versioning_status_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"buckets_analytics","owner":"supabase_storage_admin","columns":[{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"type","type":"storage.buckettype","notNull":true,"identity":"","generated":"","defaultHash":"3cb5e61e8db0bf1e9527d7e23bde376e"},{"name":"format","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"0cd243a7d4afac3e81595b9647e1dc0f"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"deleted_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5faafdbaaf23fb01463574b2f9d093d3","name":"buckets_analytics_pkey","valid":true},{"hash":"c04dcbc3e058e7be512a0af226a83443","name":"buckets_analytics_unique_name_idx","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"buckets_analytics_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"buckets_vectors","owner":"supabase_storage_admin","columns":[{"name":"id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"type","type":"storage.buckettype","notNull":true,"identity":"","generated":"","defaultHash":"e328c68de51bb97caf262ef02fb152f1"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"50a8be61a88b2ea09eed1b6497bddf51","name":"buckets_vectors_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"buckets_vectors_pkey","validated":true}]},{"acl":[{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"migrations","owner":"supabase_storage_admin","columns":[{"name":"id","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"character varying(100)","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"hash","type":"character varying(40)","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"executed_at","type":"timestamp without time zone","notNull":false,"identity":"","generated":"","defaultHash":"b96c3e81c1a3dc6db69a2e652bb5449c"}],"indexes":[{"hash":"bff6fa1f83cacf3970401c52c08db11c","name":"migrations_name_key","valid":true},{"hash":"0b7efb4a3feab972e1da5ad75b523221","name":"migrations_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"6cd240145af2a9dad30030041a41b7af","kind":"u","name":"migrations_name_key","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"migrations_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":true,"privilege":"DELETE"},{"role":"postgres","grantable":true,"privilege":"INSERT"},{"role":"postgres","grantable":true,"privilege":"MAINTAIN"},{"role":"postgres","grantable":true,"privilege":"REFERENCES"},{"role":"postgres","grantable":true,"privilege":"SELECT"},{"role":"postgres","grantable":true,"privilege":"TRIGGER"},{"role":"postgres","grantable":true,"privilege":"TRUNCATE"},{"role":"postgres","grantable":true,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":true,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":true,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":true,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":true,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":true,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":true,"privilege":"UPDATE"}],"rls":true,"name":"objects","owner":"supabase_storage_admin","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"bucket_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"owner","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"last_accessed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"metadata","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"path_tokens","type":"text[]","notNull":false,"identity":"","generated":"s","defaultHash":"c4a7508a4dc51cf699a0187b121cf908"},{"name":"version","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"owner_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"user_metadata","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"archived_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"is_delete_marker","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"is_versioned","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"}],"indexes":[{"hash":"28cc0d373399f6286fcc084d53ac1a9b","name":"idx_objects_bucket_id_name","valid":true},{"hash":"7011cc4c480885d4ad90a454ba646e00","name":"idx_objects_bucket_id_name_lower","valid":true},{"hash":"b072a4b9a2a417d3fe22d83e468bc484","name":"idx_objects_current_version","valid":true},{"hash":"0bbb7a0c69d7fdb5f6d231e50584cf57","name":"idx_objects_delete_markers","valid":true},{"hash":"3045da3705e39c1755c3657b190b50aa","name":"idx_objects_null_version","valid":true},{"hash":"723adc11317cf50c0b081f17b15306eb","name":"name_prefix_search","valid":true},{"hash":"225899b1e036a165909fbd0fffafccfc","name":"objects_bucket_id_name_version_key","valid":true},{"hash":"554c83fddeb715d0c8ab40f49647bbf4","name":"objects_pkey","valid":true}],"forceRls":false,"policies":[{"name":"client_invoice_file_read","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"4ae92d003e4dac4a6062ae6837252e0f","permissive":"PERMISSIVE"},{"name":"voicemail_no_direct_storage_access","roles":["anon","authenticated"],"command":"ALL","checkHash":"8efd5f3537b0dd220dc60022053991dc","usingHash":"8efd5f3537b0dd220dc60022053991dc","permissive":"RESTRICTIVE"},{"name":"voicemail_source_no_direct_storage_access","roles":["anon","authenticated"],"command":"ALL","checkHash":"3d50574d66d4d54a7c8eb5df0b8b8017","usingHash":"3d50574d66d4d54a7c8eb5df0b8b8017","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"45c5692d486583888bac16ef789d847f","name":"protect_objects_delete","enabled":"O"},{"hash":"7457963f6a733c584baf08e4e7a451d0","name":"update_objects_updated_at","enabled":"O"}],"constraints":[{"hash":"7d59449dc108c67c37986a9d87ad757f","kind":"f","name":"objects_bucketId_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"objects_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"s3_multipart_uploads","owner":"supabase_storage_admin","columns":[{"name":"id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"in_progress_size","type":"bigint","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"upload_signature","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"bucket_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"owner_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"user_metadata","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"90fb4b2091d10452dcd11f661d9cc533","name":"idx_multipart_uploads_list","valid":true},{"hash":"c46135605d6e820073e2778c240ceb64","name":"s3_multipart_uploads_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"7d59449dc108c67c37986a9d87ad757f","kind":"f","name":"s3_multipart_uploads_bucket_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"s3_multipart_uploads_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"s3_multipart_uploads_parts","owner":"supabase_storage_admin","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"upload_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"size","type":"bigint","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"part_number","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"bucket_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"etag","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"owner_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"6b54fd822b51110fb8f5cc41f3e3114d","name":"s3_multipart_uploads_parts_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"7d59449dc108c67c37986a9d87ad757f","kind":"f","name":"s3_multipart_uploads_parts_bucket_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"s3_multipart_uploads_parts_pkey","validated":true},{"hash":"7a2ad081f21448eeef11ae8d441d0df0","kind":"f","name":"s3_multipart_uploads_parts_upload_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"DELETE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"INSERT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"MAINTAIN"},{"role":"supabase_storage_admin","grantable":false,"privilege":"REFERENCES"},{"role":"supabase_storage_admin","grantable":false,"privilege":"SELECT"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRIGGER"},{"role":"supabase_storage_admin","grantable":false,"privilege":"TRUNCATE"},{"role":"supabase_storage_admin","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"vector_indexes","owner":"supabase_storage_admin","columns":[{"name":"id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"bucket_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"data_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"dimension","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"distance_metric","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"metadata_configuration","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"8328b4a594fa6b91d45ab4544c853b8f","name":"vector_indexes_name_bucket_id_idx","valid":true},{"hash":"84c07398a69ca4bfe5ad07e3848f2818","name":"vector_indexes_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"0d1b602396b6a71660454b92f80b94a7","kind":"f","name":"vector_indexes_bucket_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"vector_indexes_pkey","validated":true}]}],"functions":[{"hash":"ccefb34283c346cc88e224d075bd5312","name":"allow_any_operation","owner":"supabase_storage_admin","arguments":"expected_operations text[]","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"e2f7d55adc027df69ec4b42c6c08f50f","name":"allow_only_operation","owner":"supabase_storage_admin","arguments":"expected_operation text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"73733c9319875273d5937b05d68a7930","name":"can_insert_object","owner":"supabase_storage_admin","arguments":"bucketid text, name text, owner uuid, metadata jsonb","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"b839722d462ea1003fbcf028bd6f6c01","name":"enforce_bucket_lifecycle_service_role","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"11b3bd509f6b254ec1cd859e712e8c78","name":"enforce_bucket_name_length","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"75d83971130753081a84c3270878d8e7","name":"extension","owner":"supabase_storage_admin","arguments":"name text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"0e8171709dc2934861de959d743ff809","name":"filename","owner":"supabase_storage_admin","arguments":"name text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"93671af66e1fe108a56068ad4137d001","name":"foldername","owner":"supabase_storage_admin","arguments":"name text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"0dc62b74fb855d4f504f50f900f93927","name":"get_common_prefix","owner":"supabase_storage_admin","arguments":"p_key text, p_prefix text, p_delimiter text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"75dc6041ab2b273a08279126efecbcd0","name":"get_size_by_bucket","owner":"supabase_storage_admin","arguments":"noncurrent_versions text, delete_markers text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"961eef74f03a12751abf768384b84371","name":"list_multipart_uploads_with_delimiter","owner":"supabase_storage_admin","arguments":"bucket_id text, prefix_param text, delimiter_param text, max_keys integer, next_key_token text, next_upload_token text, raw_prefix_param text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"7747efec8583d78cd01449d9b99cd2eb","name":"list_objects_with_delimiter","owner":"supabase_storage_admin","arguments":"_bucket_id text, prefix_param text, delimiter_param text, max_keys integer, start_after text, next_token text, sort_order text, noncurrent_versions text, delete_markers text, next_token_archived_at timestamp with time zone, next_token_version text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"0720a7c3d1b49f9a8eee19e90d73bb97","name":"operation","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"7c31ae406e2f6281ead4009fff69fc68","name":"protect_bucket_control_columns","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"4371ae544fb1ef704f9c5d42265ac324","name":"protect_delete","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"fed15c85bb96faaa21ec40176026a0fd","name":"search","owner":"supabase_storage_admin","arguments":"prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text, noncurrent_versions text, delete_markers text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"323c4e2739e9c9bcfc082f7f14289338","name":"search_by_timestamp","owner":"supabase_storage_admin","arguments":"p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text, noncurrent_versions text, delete_markers text, p_start_after_version text","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"7a010a87c94770b1c8f0b49a616082f4","name":"search_v2","owner":"supabase_storage_admin","arguments":"prefix text, bucket_name text, limits integer, levels integer, start_after text, sort_order text, sort_column text, sort_column_after text, noncurrent_versions text, delete_markers text, start_after_archived_at timestamp with time zone, start_after_version text, start_after_is_continuation boolean","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"bfecc08a6034296258f0c3e10193076c","name":"update_updated_at_column","owner":"supabase_storage_admin","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true}]}'::jsonb then raise exception 'Production Microsoft storage baseline differs';end if;
 select coalesce(jsonb_agg(case when b.id='learn-voicemail-sources' then to_jsonb(b)-array['created_at','updated_at'] else to_jsonb(b) end order by id),'[]') into actual_buckets from storage.buckets b where id in ('receptionist-voicemails','learn-voicemail-sources');
 if actual_buckets is distinct from '[{"id":"learn-voicemail-sources","name":"learn-voicemail-sources","type":"STANDARD","owner":null,"public":false,"owner_id":null,"file_size_limit":1048576,"versioning_status":"DISABLED","allowed_mime_types":["message/rfc822"],"avif_autodetection":false,"lifecycle_configuration":null,"lifecycle_configuration_generation":null},{"id":"receptionist-voicemails","name":"receptionist-voicemails","type":"STANDARD","owner":null,"public":false,"owner_id":null,"created_at":"2026-10-01T10:30:47.462135+00:00","updated_at":"2026-10-01T10:30:47.462135+00:00","file_size_limit":26214400,"versioning_status":"DISABLED","allowed_mime_types":["audio/mpeg","audio/wav","audio/x-wav","audio/ogg","audio/mp4"],"avif_autodetection":false,"lifecycle_configuration":null,"lifecycle_configuration_generation":null}]'::jsonb then raise exception 'Production Microsoft bucket baseline differs';end if;
end$$;
-- INPUT supabase/migrations/20261101180000_learn_microsoft_source_journal.sql
-- Additive Microsoft source journal. No credentials, capture activation, queue
-- scheduling, projection writes or existing email modifications. Local until released.

create table public.learn_microsoft_mailbox_bindings (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 email_account_id uuid not null, microsoft_tenant_id uuid not null, mailbox_id uuid not null,
 enabled boolean not null default false, created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,email_account_id,id,mailbox_id),
 foreign key(tenant_id,email_account_id) references public.email_accounts(tenant_id,id) on delete restrict
);
create unique index learn_microsoft_one_enabled_binding on public.learn_microsoft_mailbox_bindings(tenant_id,email_account_id) where enabled;
create table public.learn_microsoft_capture_streams (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, email_account_id uuid not null,
 binding_id uuid not null, mailbox_id uuid not null, kind text not null check(kind in ('folders','messages')),
 folder_id text not null, revision bigint not null default 0 check(revision between 0 and 9007199254740991),
 checkpoint jsonb not null check(jsonb_typeof(checkpoint)='object' and octet_length(checkpoint::text)<=16777216),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check((kind='folders' and folder_id='') or (kind='messages' and length(folder_id) between 1 and 2048 and folder_id~'^[A-Za-z0-9+/_=-]+$')),
 unique(tenant_id,email_account_id,binding_id,kind,folder_id), unique(tenant_id,id),
 foreign key(tenant_id,email_account_id,binding_id,mailbox_id) references public.learn_microsoft_mailbox_bindings(tenant_id,email_account_id,id,mailbox_id) on delete restrict
);
create table public.learn_microsoft_source_pages (
 id uuid primary key, tenant_id uuid not null, stream_id uuid not null, job_id uuid not null references public.platform_jobs(id) on delete restrict,
 revision bigint not null check(revision between 1 and 9007199254740991),
 before_checkpoint jsonb not null, source_page jsonb not null, after_checkpoint jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 unique(stream_id,revision), foreign key(tenant_id,stream_id) references public.learn_microsoft_capture_streams(tenant_id,id) on delete restrict
);
alter table public.learn_microsoft_mailbox_bindings enable row level security;
alter table public.learn_microsoft_capture_streams enable row level security;
alter table public.learn_microsoft_source_pages enable row level security;
revoke all on public.learn_microsoft_mailbox_bindings,public.learn_microsoft_capture_streams,public.learn_microsoft_source_pages from public,anon,authenticated,service_role;

create function public.learn_microsoft_journal_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$begin raise exception 'learn_microsoft_retained_evidence_immutable' using errcode='42501';end $$;
create trigger learn_microsoft_pages_immutable before update or delete on public.learn_microsoft_source_pages for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_pages_no_truncate before truncate on public.learn_microsoft_source_pages for each statement execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_streams_no_delete before delete on public.learn_microsoft_capture_streams for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_streams_no_truncate before truncate on public.learn_microsoft_capture_streams for each statement execute function public.learn_microsoft_journal_immutable();
create function public.learn_microsoft_binding_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$begin
 if (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled') then raise exception 'learn_microsoft_binding_identity_immutable' using errcode='42501';end if;
 return new;
end $$;
create trigger learn_microsoft_binding_identity before update on public.learn_microsoft_mailbox_bindings for each row execute function public.learn_microsoft_binding_guard();
create trigger learn_microsoft_bindings_no_delete before delete on public.learn_microsoft_mailbox_bindings for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_bindings_no_truncate before truncate on public.learn_microsoft_mailbox_bindings for each statement execute function public.learn_microsoft_journal_immutable();

-- Internal shape check. Full Graph semantics remain the resource readers' job.
-- A journal receipt proves atomic storage, never provider authenticity or coverage.
create function public.learn_microsoft_checkpoint_valid(p jsonb,t uuid,a uuid,m uuid,k text,f text) returns boolean
language sql immutable set search_path=pg_catalog as $$ select coalesce(
 jsonb_typeof(p)='object' and octet_length(p::text)<=16777216
 and p->'scope'=jsonb_build_object('tenantId',t,'accountId',a,'mailboxId',m)||case when k='messages' then jsonb_build_object('folderId',f) else '{}'::jsonb end
 and jsonb_typeof(p->'pageSize')='number' and (p->>'pageSize')~'^[1-9][0-9]{0,2}$' and (p->>'pageSize')::integer between 1 and 100
 and case when k='folders' then
  p->>'contract'='microsoft-folder-discovery/1' and jsonb_typeof(p->'pending')='array'
  and jsonb_typeof(p->'completedParents')='array' and jsonb_typeof(p->'visitedRequests')='array' and jsonb_typeof(p->'folders')='array'
  and jsonb_array_length(p->'folders')<=10000 and jsonb_array_length(p->'visitedRequests')<=10000
 when k='messages' then p->>'contract'='microsoft-message-checkpoint/1'
  and (p->'continuation'='null'::jsonb or (jsonb_typeof(p->'continuation')='object'
   and p->'continuation'->>'kind' in ('next','delta') and jsonb_typeof(p->'continuation'->'url')='string'
   and length(p->'continuation'->>'url') between 1 and 32768)) else false end,false) $$;

-- Lock order: capture switch, queue job, account, binding, stream. Recheck the
-- queue lease after writes so an overlong transaction cannot settle stale work.
create function public.learn_microsoft_journal_guard(t uuid,a uuid,m uuid,b uuid,k text,f text,j uuid,w text,c integer) returns void
language plpgsql security definer set search_path=pg_catalog as $$declare q public.platform_jobs%rowtype;begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_microsoft_snapshot_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||t::text,0));
 if not public.learn_capture_allowed(t,'email') then raise exception 'learn_microsoft_capture_paused' using errcode='PT409';end if;
 select * into q from public.platform_jobs where tenant_id=t and id=j for update;
 if not found or q.status<>'running' or q.claimed_by is distinct from w or nullif(w,'') is null or c is null or c<1 or q.attempt_count is distinct from c
  or q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 if q.connector_id is distinct from 'microsoft-365' or q.module_id is distinct from 'communications.email'
  or q.job_type is distinct from (case when k='folders' then 'email.microsoft_discovery' else 'email.microsoft_sync' end)
  or q.payload is distinct from jsonb_build_object('email_account_id',a,'mailbox_id',m,'binding_id',b,'kind',k,'folder_id',f)
 then raise exception 'learn_microsoft_job_identity_invalid' using errcode='PT409';end if;
 perform 1 from public.email_accounts where tenant_id=t and id=a and provider='microsoft_365' and status='active' and auth_state='ok' for share;
 if not found then raise exception 'learn_microsoft_account_ineligible' using errcode='PT409';end if;
 perform 1 from public.learn_microsoft_mailbox_bindings where tenant_id=t and email_account_id=a and id=b and mailbox_id=m and enabled for share;
 if not found then raise exception 'learn_microsoft_binding_ineligible' using errcode='PT409';end if;
end $$;

create function public.learn_microsoft_journal_open(p_tenant uuid,p_account uuid,p_mailbox uuid,p_binding uuid,p_kind text,p_folder text,p_initial jsonb,p_job uuid,p_worker text,p_claim integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare s public.learn_microsoft_capture_streams%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_mailbox is null or p_binding is null or p_kind is null or p_folder is null
  or not public.learn_microsoft_checkpoint_valid(p_initial,p_tenant,p_account,p_mailbox,p_kind,p_folder)
  or (p_kind='messages' and p_initial->'continuation' is distinct from 'null'::jsonb)
  or (p_kind='folders' and (p_initial->'pending' is distinct from '[{"parentFolderId":null,"nextUrl":null}]'::jsonb
   or p_initial->'completedParents' is distinct from '[]'::jsonb or p_initial->'visitedRequests' is distinct from '[]'::jsonb or p_initial->'folders' is distinct from '[]'::jsonb))
 then raise exception 'learn_microsoft_initial_invalid' using errcode='22023';end if;
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 insert into public.learn_microsoft_capture_streams(tenant_id,email_account_id,binding_id,mailbox_id,kind,folder_id,checkpoint)
 values(p_tenant,p_account,p_binding,p_mailbox,p_kind,p_folder,p_initial)
 on conflict(tenant_id,email_account_id,binding_id,kind,folder_id) do nothing;
 select * into strict s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and email_account_id=p_account and binding_id=p_binding and kind=p_kind and folder_id=p_folder for update;
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 return jsonb_build_object('contract','microsoft-journal-stream/1','tenantId',s.tenant_id,'streamId',s.id,'revision',s.revision::text,'checkpoint',s.checkpoint);
end $$;

create function public.learn_microsoft_journal_commit(p_tenant uuid,p_stream uuid,p_request uuid,p_revision bigint,p_before jsonb,p_page jsonb,p_after jsonb,p_job uuid,p_worker text,p_claim integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare s public.learn_microsoft_capture_streams%rowtype;r public.learn_microsoft_source_pages%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_stream is null or p_request is null or p_revision is null or p_revision<0 or p_revision>=9007199254740991
  or p_job is null or p_before is null or p_after is null or p_page is null then raise exception 'learn_microsoft_page_invalid' using errcode='22023';end if;
 select * into s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and id=p_stream;
 if not found then raise exception 'learn_microsoft_stream_unavailable' using errcode='PT409';end if;
 -- An exact stored receipt can be recovered after lease expiry/pause. This branch
 -- returns metadata only and cannot authorize further reads or advance progress.
 select * into r from public.learn_microsoft_source_pages where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.stream_id<>p_stream or r.job_id<>p_job or r.revision<>p_revision+1 or r.before_checkpoint is distinct from p_before
   or r.source_page is distinct from p_page or r.after_checkpoint is distinct from p_after then raise exception 'learn_microsoft_request_conflict' using errcode='PT409';end if;
  return jsonb_build_object('contract','microsoft-journal-receipt/1','tenantId',p_tenant,'streamId',p_stream,'requestId',p_request,'revision',r.revision::text,'recordedAt',r.recorded_at);
 end if;
 perform public.learn_microsoft_journal_guard(s.tenant_id,s.email_account_id,s.mailbox_id,s.binding_id,s.kind,s.folder_id,p_job,p_worker,p_claim);
 select * into strict s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and id=p_stream for update;
 -- A competing exact submission may have committed while this request waited.
 select * into r from public.learn_microsoft_source_pages where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.stream_id<>p_stream or r.job_id<>p_job or r.revision<>p_revision+1 or r.before_checkpoint is distinct from p_before
   or r.source_page is distinct from p_page or r.after_checkpoint is distinct from p_after then raise exception 'learn_microsoft_request_conflict' using errcode='PT409';end if;
  return jsonb_build_object('contract','microsoft-journal-receipt/1','tenantId',p_tenant,'streamId',p_stream,'requestId',p_request,'revision',r.revision::text,'recordedAt',r.recorded_at);
 end if;
 if s.revision<>p_revision or s.checkpoint is distinct from p_before then raise exception 'learn_microsoft_checkpoint_changed' using errcode='PT409';end if;
 if not public.learn_microsoft_checkpoint_valid(p_after,s.tenant_id,s.email_account_id,s.mailbox_id,s.kind,s.folder_id)
  or p_after->'pageSize' is distinct from p_before->'pageSize' or jsonb_typeof(p_page) is distinct from 'object' or octet_length(p_page::text)>33554432
  or p_page->'scope' is distinct from p_before->'scope' or p_page->>'persistence' is distinct from 'not_attempted'
  or jsonb_typeof(p_page->'requestUrl') is distinct from 'string' or length(p_page->>'requestUrl') not between 1 and 32768
  or jsonb_typeof(p_page->'fetchedAt') is distinct from 'string'
 then raise exception 'learn_microsoft_page_invalid' using errcode='22023';end if;
 if s.kind='messages' then
  if p_page->>'contract' is distinct from 'microsoft-mail-page/1' or jsonb_typeof(p_page->'events') is distinct from 'array'
   or jsonb_array_length(p_page->'events')>1000 or p_after->'continuation' is distinct from p_page->'continuation'
   or (p_before->'continuation'<>'null'::jsonb and p_page->'requestUrl' is distinct from p_before->'continuation'->'url')
  then raise exception 'learn_microsoft_page_invalid' using errcode='22023';end if;
 else
  if p_page->>'contract' is distinct from 'microsoft-folder-page/1' or jsonb_typeof(p_page->'folders') is distinct from 'array'
   or jsonb_array_length(p_page->'folders')>1000 or jsonb_array_length(p_before->'pending')=0
   or p_page->'parentFolderId' is distinct from p_before->'pending'->0->'parentFolderId'
   or (p_before->'pending'->0->'nextUrl'<>'null'::jsonb and p_page->'requestUrl' is distinct from p_before->'pending'->0->'nextUrl')
   or p_after->'visitedRequests' is distinct from (p_before->'visitedRequests'||jsonb_build_array(p_page->'requestUrl'))
  then raise exception 'learn_microsoft_page_invalid' using errcode='22023';end if;
 end if;
 insert into public.learn_microsoft_source_pages(id,tenant_id,stream_id,job_id,revision,before_checkpoint,source_page,after_checkpoint)
 values(p_request,p_tenant,p_stream,p_job,p_revision+1,p_before,p_page,p_after) returning * into r;
 update public.learn_microsoft_capture_streams set revision=r.revision,checkpoint=p_after,updated_at=r.recorded_at where id=s.id;
 perform public.learn_microsoft_journal_guard(s.tenant_id,s.email_account_id,s.mailbox_id,s.binding_id,s.kind,s.folder_id,p_job,p_worker,p_claim);
 return jsonb_build_object('contract','microsoft-journal-receipt/1','tenantId',p_tenant,'streamId',p_stream,'requestId',p_request,'revision',r.revision::text,'recordedAt',r.recorded_at);
end $$;
revoke all on function public.learn_microsoft_journal_immutable(),public.learn_microsoft_binding_guard(),public.learn_microsoft_checkpoint_valid(jsonb,uuid,uuid,uuid,text,text),public.learn_microsoft_journal_guard(uuid,uuid,uuid,uuid,text,text,uuid,text,integer),public.learn_microsoft_journal_open(uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,integer),public.learn_microsoft_journal_commit(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_microsoft_journal_open(uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,integer),public.learn_microsoft_journal_commit(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,uuid,text,integer) to service_role;

-- INPUT supabase/migrations/20261101181000_learn_microsoft_job_receipts.sql
-- One bounded source page per owned Microsoft queue job. No scheduling/activation.

create unique index learn_microsoft_source_page_job_unique on public.learn_microsoft_source_pages(job_id);
create function public.learn_microsoft_journal_job(p_tenant uuid,p_job uuid,p_worker text,p_claim integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;r public.learn_microsoft_source_pages%rowtype;s public.learn_microsoft_capture_streams%rowtype;receipt jsonb:=null;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_worker or nullif(p_worker,'') is null or p_claim is null or p_claim<1 or j.attempt_count is distinct from p_claim
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 if j.connector_id is distinct from 'microsoft-365' or j.module_id is distinct from 'communications.email'
  or j.job_type not in ('email.microsoft_discovery','email.microsoft_sync') or jsonb_typeof(j.payload) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(j.payload))<>5
  or not(j.payload ?& array['email_account_id','mailbox_id','binding_id','kind','folder_id'])
 then raise exception 'learn_microsoft_job_identity_invalid' using errcode='PT409';end if;
 -- Keep the queue payload identical to the journal binding contract.
 if j.payload is distinct from jsonb_build_object('email_account_id',(j.payload->>'email_account_id')::uuid,
  'mailbox_id',(j.payload->>'mailbox_id')::uuid,'binding_id',(j.payload->>'binding_id')::uuid,
  'kind',case when j.job_type='email.microsoft_discovery' then 'folders' else 'messages' end,'folder_id',j.payload->>'folder_id')
  or not coalesce(case when j.job_type='email.microsoft_discovery' then j.payload->>'folder_id'='' else length(j.payload->>'folder_id') between 1 and 2048 and j.payload->>'folder_id'~'^[A-Za-z0-9+/_=-]+$' end,false)
 then raise exception 'learn_microsoft_job_identity_invalid' using errcode='PT409';end if;
 select * into r from public.learn_microsoft_source_pages where tenant_id=p_tenant and job_id=p_job;
 if found then
  select * into strict s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and id=r.stream_id;
  if j.payload is distinct from jsonb_build_object('email_account_id',s.email_account_id,'mailbox_id',s.mailbox_id,'binding_id',s.binding_id,'kind',s.kind,'folder_id',s.folder_id)
  then raise exception 'learn_microsoft_job_identity_invalid' using errcode='PT409';end if;
  receipt:=jsonb_build_object('contract','microsoft-journal-receipt/1','tenantId',p_tenant,'streamId',r.stream_id,'requestId',r.id,
   'revision',r.revision::text,'recordedAt',r.recorded_at,'checkpoint',r.after_checkpoint,
   'observationsStored',jsonb_array_length(case when s.kind='folders' then r.source_page->'folders' else r.source_page->'events' end));
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 return jsonb_build_object('contract','microsoft-journal-job/1','tenantId',p_tenant,'jobId',p_job,'jobType',j.job_type,'payload',j.payload,'receipt',receipt);
end $$;
revoke all on function public.learn_microsoft_journal_job(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_microsoft_journal_job(uuid,uuid,text,integer) to service_role;

-- INPUT supabase/migrations/20261101182000_learn_microsoft_queue_completion.sql
-- Atomic completion and same-stream continuation. No provider activation or schedules.

create table public.learn_microsoft_job_completions (
 job_id uuid primary key references public.platform_jobs(id) on delete restrict,
 tenant_id uuid not null, definition jsonb not null,
 source_receipt_id uuid references public.learn_microsoft_source_pages(id) on delete restrict,
 successor_id uuid references public.platform_jobs(id) on delete restrict,
 result jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_microsoft_job_completions enable row level security;
revoke all on public.learn_microsoft_job_completions from public,anon,authenticated,service_role;
create trigger learn_microsoft_completions_immutable before update or delete on public.learn_microsoft_job_completions for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_completions_no_truncate before truncate on public.learn_microsoft_job_completions for each statement execute function public.learn_microsoft_journal_immutable();

create function public.learn_microsoft_job_settle(p_tenant uuid,p_job uuid,p_worker text,p_claim integer,p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;s public.learn_microsoft_capture_streams%rowtype;r public.learn_microsoft_source_pages%rowtype;
 done public.learn_microsoft_job_completions%rowtype;n public.platform_jobs%rowtype;
 definition jsonb;job_state jsonb;answer jsonb;needs_more boolean;receipt_id uuid;observations integer:=0;
 key text;successor uuid;lease_end timestamptz;step integer;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or p_apply is null then raise exception 'learn_microsoft_settlement_invalid' using errcode='22023';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_microsoft_snapshot_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception 'learn_microsoft_job_unavailable' using errcode='PT409';end if;
 definition:=jsonb_build_object('tenant_id',j.tenant_id,'connector_id',j.connector_id,'module_id',j.module_id,'job_type',j.job_type,'job_key',j.job_key,'payload',j.payload);
 select * into done from public.learn_microsoft_job_completions where job_id=p_job;
 if found then
  if done.tenant_id<>p_tenant or done.definition is distinct from definition or j.status<>'succeeded'
   or j.result is distinct from done.result then raise exception 'learn_microsoft_settlement_conflict' using errcode='PT409';end if;
  return done.result;
 end if;
 -- This validates the live lease and exact server-owned Microsoft job payload.
 -- Completion consumes retained evidence, so pause/revocation need not block it.
 job_state:=public.learn_microsoft_journal_job(p_tenant,p_job,p_worker,p_claim);
 key:=j.job_type||':'||(j.payload->>'binding_id')||':'||(j.payload->>'folder_id');
 if j.job_key is distinct from key then raise exception 'learn_microsoft_job_key_invalid' using errcode='PT409';end if;
 if not p_apply then return jsonb_build_object('contract','microsoft-job-settlement/1','state','pending','tenantId',p_tenant,'jobId',p_job);end if;
 lease_end:=j.lease_expires_at;
 select * into s from public.learn_microsoft_capture_streams where tenant_id=p_tenant
  and email_account_id=(j.payload->>'email_account_id')::uuid and binding_id=(j.payload->>'binding_id')::uuid
  and mailbox_id=(j.payload->>'mailbox_id')::uuid and kind=j.payload->>'kind' and folder_id=j.payload->>'folder_id' for update;
 if not found or not public.learn_microsoft_checkpoint_valid(s.checkpoint,s.tenant_id,s.email_account_id,s.mailbox_id,s.kind,s.folder_id)
 then raise exception 'learn_microsoft_stream_unavailable' using errcode='PT409';end if;
 select * into r from public.learn_microsoft_source_pages where tenant_id=p_tenant and job_id=p_job;
 if found then
  if r.stream_id<>s.id or r.revision>s.revision then raise exception 'learn_microsoft_settlement_evidence_invalid' using errcode='PT409';end if;
  receipt_id:=r.id;
  observations:=jsonb_array_length(case when s.kind='folders' then r.source_page->'folders' else r.source_page->'events' end);
 else
  -- An already-exhausted folder traversal may settle without fabricating a page.
  if s.kind<>'folders' or s.checkpoint->'pending' is distinct from '[]'::jsonb or s.revision=0
   or not exists(select 1 from public.learn_microsoft_source_pages where stream_id=s.id and revision=s.revision and after_checkpoint=s.checkpoint)
  then raise exception 'learn_microsoft_saved_page_required' using errcode='PT409';end if;
 end if;
 needs_more:=case when s.kind='folders' then jsonb_array_length(s.checkpoint->'pending')>0
  else s.checkpoint->'continuation'->>'kind'='next' end;
 if needs_more is null then raise exception 'learn_microsoft_checkpoint_invalid' using errcode='PT409';end if;
 -- Release this active key and insert/reuse the continuation in the SAME transaction.
 update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),records_processed=observations,
  claimed_by=null,lease_expires_at=null,error_code=null,updated_at=clock_timestamp() where id=p_job;
 if needs_more then
  for step in 1..3 loop
   insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,payload,parent_job_id,available_at)
    values(p_tenant,'microsoft-365','communications.email',j.job_type,key,'queued',j.priority,j.max_attempts,j.payload,p_job,clock_timestamp()+interval '1 second')
    on conflict(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying') do nothing returning * into n;
   if found then successor:=n.id;exit;end if;
   select * into n from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in ('queued','running','retrying');
   if not found then continue;end if;
   if n.id=p_job or n.job_type is distinct from j.job_type or n.connector_id is distinct from j.connector_id
    or n.module_id is distinct from j.module_id or n.payload is distinct from j.payload
   then raise exception 'learn_microsoft_successor_conflict' using errcode='PT409';end if;
   successor:=n.id;exit;
  end loop;
  if successor is null then raise exception 'learn_microsoft_successor_unconfirmed' using errcode='PT409';end if;
 end if;
 answer:=jsonb_build_object('contract','microsoft-job-settlement/1','state','completed','tenantId',p_tenant,'jobId',p_job,
  'sourceReceiptId',receipt_id,'successorId',successor,'observationsStored',observations,'mailboxCoverage','unverified');
 update public.platform_jobs set result=answer where id=p_job;
 insert into public.learn_microsoft_job_completions(job_id,tenant_id,definition,source_receipt_id,successor_id,result)
  values(p_job,p_tenant,definition,receipt_id,successor,answer);
 if lease_end<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 return answer;
end $$;
revoke all on function public.learn_microsoft_job_settle(uuid,uuid,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_microsoft_job_settle(uuid,uuid,text,integer,boolean) to service_role;

-- INPUT supabase/migrations/20261101192000_learn_microsoft_folder_dispatch.sql
-- Connect retained discovery pages to message jobs. No credentials or capture activation.

set local lock_timeout='3s';
-- Serialize the upgrade against queue writers and retained completions.
lock table public.platform_jobs,public.learn_microsoft_job_completions in access exclusive mode;
-- Old completed discovery receipts cannot silently acquire a different meaning.
-- No Microsoft migrations are hosted yet; a populated installation needs an
-- explicit retained-page backfill before adopting this release.
do $$begin
 if exists(select 1 from public.learn_microsoft_job_completions c join public.platform_jobs j on j.id=c.job_id
  where j.job_type='email.microsoft_discovery') then
  raise exception 'learn_microsoft_existing_discovery_requires_backfill';
 end if;
end $$;
create table public.learn_microsoft_folder_dispatches (
 stream_id uuid not null, tenant_id uuid not null,
 folder_id text not null check(length(folder_id) between 1 and 2048 and folder_id~'^[A-Za-z0-9+/_=-]+$'),
 kind text not null check(kind in ('physical','search')),
 source_page_id uuid not null references public.learn_microsoft_source_pages(id) on delete restrict,
 message_job_id uuid references public.platform_jobs(id) on delete restrict,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(stream_id,folder_id),
 foreign key(tenant_id,stream_id) references public.learn_microsoft_capture_streams(tenant_id,id) on delete restrict,
 check((kind='physical' and message_job_id is not null) or (kind='search' and message_job_id is null))
);
alter table public.learn_microsoft_folder_dispatches enable row level security;
revoke all on public.learn_microsoft_folder_dispatches from public,anon,authenticated,service_role;
create trigger learn_microsoft_dispatches_immutable before update or delete on public.learn_microsoft_folder_dispatches for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_dispatches_no_truncate before truncate on public.learn_microsoft_folder_dispatches for each statement execute function public.learn_microsoft_journal_immutable();

-- Private helper, reachable only inside lease-bound settlement. The caller holds
-- the discovery job and stream locks; every source page is immutable. One page
-- creates at most 1,000 dispatch decisions, never a mailbox-sized transaction.
create function public.learn_microsoft_dispatch_folders(p_tenant uuid,p_page uuid,p_job uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare s public.learn_microsoft_capture_streams%rowtype;r public.learn_microsoft_source_pages%rowtype;
 parent public.platform_jobs%rowtype;child public.platform_jobs%rowtype;old public.learn_microsoft_folder_dispatches%rowtype;
 folder_observation jsonb;payload jsonb;key text;child_id uuid;step integer;
 physical integer:=0;searches integer:=0;created integer:=0;reused integer:=0;previous integer:=0;
begin
 select * into r from public.learn_microsoft_source_pages where id=p_page and tenant_id=p_tenant and job_id=p_job;
 if not found then raise exception 'learn_microsoft_dispatch_evidence_invalid' using errcode='PT409';end if;
 select * into strict s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and id=r.stream_id;
 select * into strict parent from public.platform_jobs where tenant_id=p_tenant and id=p_job;
 if s.kind<>'folders' or parent.job_type<>'email.microsoft_discovery'
  or parent.payload is distinct from jsonb_build_object('email_account_id',s.email_account_id,'mailbox_id',s.mailbox_id,'binding_id',s.binding_id,'kind','folders','folder_id','')
  or jsonb_typeof(r.source_page->'folders') is distinct from 'array' or jsonb_array_length(r.source_page->'folders')>1000
 then raise exception 'learn_microsoft_dispatch_evidence_invalid' using errcode='PT409';end if;
 -- All observed folder identities must agree with the reader's saved checkpoint.
 -- Duplicate observations share one decision; conflicting identity/type is refused.
 if exists(select 1 from jsonb_array_elements(r.source_page->'folders') f where
   jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'id') is distinct from 'string'
   or not coalesce(length(f->>'id') between 1 and 2048 and f->>'id'~'^[A-Za-z0-9+/_=-]+$',false)
   or not coalesce(f->>'kind' in ('physical','search'),false)
   or not exists(select 1 from jsonb_array_elements(r.after_checkpoint->'folders') saved
    where saved->'id'=f->'id' and saved->'kind'=f->'kind' and saved->'parentFolderId'=f->'parentFolderId'))
  or exists(select 1 from jsonb_array_elements(r.source_page->'folders') f group by f->>'id'
    having count(distinct f->>'kind')<>1 or count(distinct f->>'parentFolderId')<>1)
 then raise exception 'learn_microsoft_dispatch_evidence_invalid' using errcode='PT409';end if;
 for folder_observation in select distinct on (v->>'id') v from jsonb_array_elements(r.source_page->'folders') v order by v->>'id' loop
  child_id:=null;
  if folder_observation->>'kind'='physical' then physical:=physical+1;else searches:=searches+1;end if;
  payload:=jsonb_build_object('email_account_id',s.email_account_id,'mailbox_id',s.mailbox_id,'binding_id',s.binding_id,'kind','messages','folder_id',folder_observation->>'id');
  key:='email.microsoft_sync:'||s.binding_id||':'||(folder_observation->>'id');
  select * into old from public.learn_microsoft_folder_dispatches where stream_id=s.id and folder_id=folder_observation->>'id';
  if found then
   if old.tenant_id<>p_tenant or old.kind<>folder_observation->>'kind' then raise exception 'learn_microsoft_dispatch_conflict' using errcode='PT409';end if;
   if old.message_job_id is not null then
    select * into child from public.platform_jobs where id=old.message_job_id;
    if not found or child.tenant_id<>p_tenant or child.payload is distinct from payload or child.job_type<>'email.microsoft_sync' or child.job_key is distinct from key
     or child.connector_id is distinct from 'microsoft-365' or child.module_id is distinct from 'communications.email'
    then raise exception 'learn_microsoft_dispatch_conflict' using errcode='PT409';end if;
   end if;
   previous:=previous+1;continue;
  end if;
  if folder_observation->>'kind'='physical' then
   for step in 1..3 loop
    insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,payload,parent_job_id,available_at)
     values(p_tenant,'microsoft-365','communications.email','email.microsoft_sync',key,'queued',parent.priority,parent.max_attempts,payload,p_job,clock_timestamp()+interval '1 second')
     on conflict(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying') do nothing returning * into child;
    if found then child_id:=child.id;created:=created+1;exit;end if;
    select * into child from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in ('queued','running','retrying') for share;
    if not found then continue;end if;
    if child.payload is distinct from payload or child.job_type<>'email.microsoft_sync' or child.job_key is distinct from key
     or child.connector_id is distinct from 'microsoft-365' or child.module_id is distinct from 'communications.email'
    then raise exception 'learn_microsoft_dispatch_conflict' using errcode='PT409';end if;
    child_id:=child.id;reused:=reused+1;exit;
   end loop;
   if child_id is null then raise exception 'learn_microsoft_dispatch_unconfirmed' using errcode='PT409';end if;
  end if;
  insert into public.learn_microsoft_folder_dispatches(stream_id,tenant_id,folder_id,kind,source_page_id,message_job_id)
   values(s.id,p_tenant,folder_observation->>'id',folder_observation->>'kind',p_page,child_id);
 end loop;
 return jsonb_build_object('physicalFolders',physical,'searchFolders',searches,'newJobs',created,'reusedJobs',reused,'previouslyDispatched',previous);
end $$;
revoke all on function public.learn_microsoft_dispatch_folders(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.learn_microsoft_job_settle(p_tenant uuid,p_job uuid,p_worker text,p_claim integer,p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;s public.learn_microsoft_capture_streams%rowtype;r public.learn_microsoft_source_pages%rowtype;
 done public.learn_microsoft_job_completions%rowtype;n public.platform_jobs%rowtype;
 definition jsonb;job_state jsonb;answer jsonb;needs_more boolean;receipt_id uuid;observations integer:=0;
 dispatch jsonb:=null;key text;successor uuid;lease_end timestamptz;step integer;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or p_apply is null then raise exception 'learn_microsoft_settlement_invalid' using errcode='22023';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_microsoft_snapshot_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception 'learn_microsoft_job_unavailable' using errcode='PT409';end if;
 definition:=jsonb_build_object('tenant_id',j.tenant_id,'connector_id',j.connector_id,'module_id',j.module_id,'job_type',j.job_type,'job_key',j.job_key,'payload',j.payload);
 select * into done from public.learn_microsoft_job_completions where job_id=p_job;
 if found then
  if done.tenant_id<>p_tenant or done.definition is distinct from definition or j.status<>'succeeded'
   or j.result is distinct from done.result then raise exception 'learn_microsoft_settlement_conflict' using errcode='PT409';end if;
  return done.result;
 end if;
 -- This validates the live lease and exact server-owned Microsoft job payload.
 -- Completion consumes retained evidence, so pause/revocation need not block it.
 job_state:=public.learn_microsoft_journal_job(p_tenant,p_job,p_worker,p_claim);
 key:=j.job_type||':'||(j.payload->>'binding_id')||':'||(j.payload->>'folder_id');
 if j.job_key is distinct from key then raise exception 'learn_microsoft_job_key_invalid' using errcode='PT409';end if;
 if not p_apply then return jsonb_build_object('contract','microsoft-job-settlement/1','state','pending','tenantId',p_tenant,'jobId',p_job);end if;
 lease_end:=j.lease_expires_at;
 select * into s from public.learn_microsoft_capture_streams where tenant_id=p_tenant
  and email_account_id=(j.payload->>'email_account_id')::uuid and binding_id=(j.payload->>'binding_id')::uuid
  and mailbox_id=(j.payload->>'mailbox_id')::uuid and kind=j.payload->>'kind' and folder_id=j.payload->>'folder_id' for update;
 if not found or not public.learn_microsoft_checkpoint_valid(s.checkpoint,s.tenant_id,s.email_account_id,s.mailbox_id,s.kind,s.folder_id)
 then raise exception 'learn_microsoft_stream_unavailable' using errcode='PT409';end if;
 select * into r from public.learn_microsoft_source_pages where tenant_id=p_tenant and job_id=p_job;
 if found then
  if r.stream_id<>s.id or r.revision>s.revision then raise exception 'learn_microsoft_settlement_evidence_invalid' using errcode='PT409';end if;
  receipt_id:=r.id;
  observations:=jsonb_array_length(case when s.kind='folders' then r.source_page->'folders' else r.source_page->'events' end);
 else
  -- An already-exhausted folder traversal may settle without fabricating a page.
  if s.kind<>'folders' or s.checkpoint->'pending' is distinct from '[]'::jsonb or s.revision=0
   or not exists(select 1 from public.learn_microsoft_source_pages where stream_id=s.id and revision=s.revision and after_checkpoint=s.checkpoint)
  then raise exception 'learn_microsoft_saved_page_required' using errcode='PT409';end if;
 end if;
 if s.kind='folders' and receipt_id is not null then
  dispatch:=public.learn_microsoft_dispatch_folders(p_tenant,receipt_id,p_job);
 end if;
 needs_more:=case when s.kind='folders' then jsonb_array_length(s.checkpoint->'pending')>0
  else s.checkpoint->'continuation'->>'kind'='next' end;
 if needs_more is null then raise exception 'learn_microsoft_checkpoint_invalid' using errcode='PT409';end if;
 -- Release this active key and insert/reuse the continuation in the SAME transaction.
 update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),records_processed=observations,
  claimed_by=null,lease_expires_at=null,error_code=null,updated_at=clock_timestamp() where id=p_job;
 if needs_more then
  for step in 1..3 loop
   insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,payload,parent_job_id,available_at)
    values(p_tenant,'microsoft-365','communications.email',j.job_type,key,'queued',j.priority,j.max_attempts,j.payload,p_job,clock_timestamp()+interval '1 second')
    on conflict(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying') do nothing returning * into n;
   if found then successor:=n.id;exit;end if;
   select * into n from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in ('queued','running','retrying');
   if not found then continue;end if;
   if n.id=p_job or n.job_type is distinct from j.job_type or n.connector_id is distinct from j.connector_id
    or n.module_id is distinct from j.module_id or n.payload is distinct from j.payload
   then raise exception 'learn_microsoft_successor_conflict' using errcode='PT409';end if;
   successor:=n.id;exit;
  end loop;
  if successor is null then raise exception 'learn_microsoft_successor_unconfirmed' using errcode='PT409';end if;
 end if;
 answer:=jsonb_build_object('contract','microsoft-job-settlement/1','state','completed','tenantId',p_tenant,'jobId',p_job,
  'sourceReceiptId',receipt_id,'successorId',successor,'observationsStored',observations,'mailboxCoverage','unverified','folderDispatch',dispatch);
 update public.platform_jobs set result=answer where id=p_job;
 insert into public.learn_microsoft_job_completions(job_id,tenant_id,definition,source_receipt_id,successor_id,result)
  values(p_job,p_tenant,definition,receipt_id,successor,answer);
 if lease_end<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 return answer;
end $$;
-- Replacing the existing entrypoint preserves its owner and execute grants.

-- INPUT supabase/migrations/20261101260000_learn_microsoft_incremental_queue.sql
-- Continue completed Microsoft message rounds from retained delta checkpoints.
-- No credentials, initial jobs, scheduler activation or historical receipt changes.

set local lock_timeout='3s';
create or replace function public.learn_microsoft_job_settle(p_tenant uuid,p_job uuid,p_worker text,p_claim integer,p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;s public.learn_microsoft_capture_streams%rowtype;r public.learn_microsoft_source_pages%rowtype;
 done public.learn_microsoft_job_completions%rowtype;n public.platform_jobs%rowtype;
 definition jsonb;job_state jsonb;answer jsonb;needs_more boolean;receipt_id uuid;observations integer:=0;
 dispatch jsonb:=null;continuation_kind text;next_check_at timestamptz;key text;successor uuid;lease_end timestamptz;step integer;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or p_apply is null then raise exception 'learn_microsoft_settlement_invalid' using errcode='22023';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_microsoft_snapshot_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception 'learn_microsoft_job_unavailable' using errcode='PT409';end if;
 definition:=jsonb_build_object('tenant_id',j.tenant_id,'connector_id',j.connector_id,'module_id',j.module_id,'job_type',j.job_type,'job_key',j.job_key,'payload',j.payload);
 select * into done from public.learn_microsoft_job_completions where job_id=p_job;
 if found then
  if done.tenant_id<>p_tenant or done.definition is distinct from definition or j.status<>'succeeded'
   or j.result is distinct from done.result then raise exception 'learn_microsoft_settlement_conflict' using errcode='PT409';end if;
  return done.result;
 end if;
 -- This validates the live lease and exact server-owned Microsoft job payload.
 -- Completion consumes retained evidence, so pause/revocation need not block it.
 job_state:=public.learn_microsoft_journal_job(p_tenant,p_job,p_worker,p_claim);
 key:=j.job_type||':'||(j.payload->>'binding_id')||':'||(j.payload->>'folder_id');
 if j.job_key is distinct from key then raise exception 'learn_microsoft_job_key_invalid' using errcode='PT409';end if;
 if not p_apply then return jsonb_build_object('contract','microsoft-job-settlement/1','state','pending','tenantId',p_tenant,'jobId',p_job);end if;
 lease_end:=j.lease_expires_at;
 select * into s from public.learn_microsoft_capture_streams where tenant_id=p_tenant
  and email_account_id=(j.payload->>'email_account_id')::uuid and binding_id=(j.payload->>'binding_id')::uuid
  and mailbox_id=(j.payload->>'mailbox_id')::uuid and kind=j.payload->>'kind' and folder_id=j.payload->>'folder_id' for update;
 if not found or not public.learn_microsoft_checkpoint_valid(s.checkpoint,s.tenant_id,s.email_account_id,s.mailbox_id,s.kind,s.folder_id)
 then raise exception 'learn_microsoft_stream_unavailable' using errcode='PT409';end if;
 select * into r from public.learn_microsoft_source_pages where tenant_id=p_tenant and job_id=p_job;
 if found then
  if r.stream_id<>s.id or r.revision>s.revision then raise exception 'learn_microsoft_settlement_evidence_invalid' using errcode='PT409';end if;
  receipt_id:=r.id;
  observations:=jsonb_array_length(case when s.kind='folders' then r.source_page->'folders' else r.source_page->'events' end);
 else
  -- An already-exhausted folder traversal may settle without fabricating a page.
  if s.kind<>'folders' or s.checkpoint->'pending' is distinct from '[]'::jsonb or s.revision=0
   or not exists(select 1 from public.learn_microsoft_source_pages where stream_id=s.id and revision=s.revision and after_checkpoint=s.checkpoint)
  then raise exception 'learn_microsoft_saved_page_required' using errcode='PT409';end if;
 end if;
 if s.kind='folders' and receipt_id is not null then
  dispatch:=public.learn_microsoft_dispatch_folders(p_tenant,receipt_id,p_job);
 end if;
 needs_more:=case when s.kind='folders' then jsonb_array_length(s.checkpoint->'pending')>0
  else s.checkpoint->'continuation'->>'kind'='next' end;
 if needs_more is null then raise exception 'learn_microsoft_checkpoint_invalid' using errcode='PT409';end if;
 -- Each completed message round schedules the next read of the stored opaque
 -- delta URL. Discovery completion still needs a separate rescan workflow.
 if s.kind='messages' and not needs_more and s.checkpoint->'continuation'->>'kind' is distinct from 'delta'
 then raise exception 'learn_microsoft_checkpoint_invalid' using errcode='PT409';end if;
 continuation_kind:=case when needs_more then 'page' when s.kind='messages' then 'incremental' else null end;
 next_check_at:=case continuation_kind when 'page' then clock_timestamp()+interval '1 second'
  when 'incremental' then clock_timestamp()+interval '5 minutes' else null end;
 -- Release the key and insert the due successor in the SAME transaction.
 -- It may remain queued during pause; journal admission forbids new provider
 -- work until current tenant/account/binding authority is valid again.
 update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),records_processed=observations,
  claimed_by=null,lease_expires_at=null,error_code=null,updated_at=clock_timestamp() where id=p_job;
 if continuation_kind is not null then
  for step in 1..3 loop
   insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,payload,parent_job_id,available_at)
    values(p_tenant,'microsoft-365','communications.email',j.job_type,key,'queued',j.priority,j.max_attempts,j.payload,p_job,next_check_at)
    on conflict(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying') do nothing returning * into n;
   if found then successor:=n.id;next_check_at:=n.available_at;exit;end if;
   select * into n from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in ('queued','running','retrying');
   if not found then continue;end if;
   if n.id=p_job or n.job_type is distinct from j.job_type or n.connector_id is distinct from j.connector_id
    or n.module_id is distinct from j.module_id or n.payload is distinct from j.payload
    or n.available_at is null or (continuation_kind='incremental' and n.available_at<next_check_at)
   then raise exception 'learn_microsoft_successor_conflict' using errcode='PT409';end if;
   successor:=n.id;next_check_at:=n.available_at;exit;
  end loop;
  if successor is null then raise exception 'learn_microsoft_successor_unconfirmed' using errcode='PT409';end if;
 end if;
 answer:=jsonb_build_object('contract','microsoft-job-settlement/1','state','completed','tenantId',p_tenant,'jobId',p_job,
  'sourceReceiptId',receipt_id,'successorId',successor,'observationsStored',observations,'mailboxCoverage','unverified','folderDispatch',dispatch,
  'continuationKind',continuation_kind,'nextCheckAt',next_check_at);
 update public.platform_jobs set result=answer where id=p_job;
 insert into public.learn_microsoft_job_completions(job_id,tenant_id,definition,source_receipt_id,successor_id,result)
  values(p_job,p_tenant,definition,receipt_id,successor,answer);
 if lease_end<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 return answer;
end $$;
-- CREATE OR REPLACE retains the existing owner and execute grants.

-- INPUT supabase/migrations/20261101280000_learn_microsoft_message_projection.sql
-- Publish complete retained Microsoft observations into the common email store.
-- Does not acquire credentials, activate capture, discard source pages or infer
-- deletion from a folder removal. Sparse/ambiguous observations remain held.

create table public.learn_microsoft_projection_receipts (
 page_id uuid primary key references public.learn_microsoft_source_pages(id) on delete restrict,
 tenant_id uuid not null, result jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_microsoft_projection_receipts enable row level security;
revoke all on public.learn_microsoft_projection_receipts from public,anon,authenticated,service_role;
create trigger learn_microsoft_projection_immutable before update or delete on public.learn_microsoft_projection_receipts
 for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_projection_no_truncate before truncate on public.learn_microsoft_projection_receipts
 for each statement execute function public.learn_microsoft_journal_immutable();

-- Lexically comparable UTC value retains Graph's seventh fractional digit.
-- Casting the full value to PostgreSQL first would round away that ordering.
create function public.learn_microsoft_projection_time(v text) returns text
language plpgsql immutable set search_path=pg_catalog as $$declare base timestamptz;fraction text;begin
 if v is null or v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,7})?Z$' then return null;end if;
 begin base:=(left(v,19)||'Z')::timestamptz;exception when others then return null;end;
 if to_char(base at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(v,19) then return null;end if;
 fraction:=case when substr(v,20,1)='.' then substr(v,21,length(v)-21) else '' end;
 return left(v,19)||'.'||rpad(fraction,7,'0')||'Z';
end $$;

create function public.learn_microsoft_projection_fields_valid(f jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$declare k text;r jsonb;begin
 if jsonb_typeof(f) is distinct from 'object' or not(f ?& array['changeKey','conversationId','subject','body','bodyPreview','from','toRecipients','ccRecipients','sentDateTime','receivedDateTime','lastModifiedDateTime','isDraft','hasAttachments'])
  or jsonb_typeof(f->'isDraft') is distinct from 'boolean' or jsonb_typeof(f->'hasAttachments') is distinct from 'boolean'
  or jsonb_typeof(f->'changeKey') is distinct from 'string' or length(f->>'changeKey') not between 1 and 2048
  or (f->>'changeKey')!~'^[A-Za-z0-9+/_=-]+$'
  or public.learn_microsoft_projection_time(f->>'lastModifiedDateTime') is null then return false;end if;
 foreach k in array array['subject','bodyPreview','conversationId'] loop
  if jsonb_typeof(f->k) not in ('string','null') or length(f->>k)>65536 then return false;end if;
 end loop;
 if f->'conversationId'<>'null'::jsonb and (length(f->>'conversationId') not between 1 and 2048 or (f->>'conversationId')!~'^[A-Za-z0-9+/_=-]+$') then return false;end if;
 foreach k in array array['sentDateTime','receivedDateTime'] loop
  if f->k<>'null'::jsonb and public.learn_microsoft_projection_time(f->>k) is null then return false;end if;
 end loop;
 if f->'sentDateTime'='null'::jsonb and f->'receivedDateTime'='null'::jsonb then return false;end if;
 if jsonb_typeof(f->'body') is distinct from 'object' or coalesce(f->'body'->>'contentType','') not in ('text','html')
  or jsonb_typeof(f->'body'->'content') is distinct from 'string' or octet_length(f->'body'->>'content')>16777216 then return false;end if;
 if f->'from'<>'null'::jsonb then
  r:=f->'from'->'emailAddress';
  if jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'address') is distinct from 'string'
   or length(r->>'address') not between 1 and 2048 or (r ? 'name' and jsonb_typeof(r->'name') not in ('string','null')) then return false;end if;
 end if;
 foreach k in array array['toRecipients','ccRecipients'] loop
  if jsonb_typeof(f->k) is distinct from 'array' or jsonb_array_length(f->k)>2000 then return false;end if;
  for r in select value->'emailAddress' from jsonb_array_elements(f->k) loop
   if jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'address') is distinct from 'string'
    or length(r->>'address') not between 1 and 2048 then return false;end if;
  end loop;
 end loop;
 return true;
end $$;

create function public.learn_microsoft_page_project(p_tenant uuid,p_page uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.learn_microsoft_source_pages%rowtype;s public.learn_microsoft_capture_streams%rowtype;
 b public.learn_microsoft_mailbox_bindings%rowtype;old public.email_messages%rowtype;
 receipt public.learn_microsoft_projection_receipts%rowtype;mailbox text;e jsonb;f jsonb;row_data jsonb;meta jsonb;
 message_key text;thread_key text;namespace text;version_time text;old_time text;observed_time timestamptz;
 published integer:=0;unchanged integer:=0;held integer:=0;drafts integer:=0;removed integer:=0;older integer:=0;
 result jsonb;participants jsonb;source_identity jsonb;message_id uuid;interaction_id uuid;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_projection_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_microsoft_snapshot_invalid' using errcode='22023';end if;
 select * into p from public.learn_microsoft_source_pages where tenant_id=p_tenant and id=p_page;
 if not found then raise exception 'learn_microsoft_source_page_unavailable' using errcode='PT409';end if;
 select * into strict s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and id=p.stream_id;
 if s.kind<>'messages' or p.source_page->>'contract' is distinct from 'microsoft-mail-page/1' then raise exception 'learn_microsoft_message_page_required' using errcode='22023';end if;
 select * into strict b from public.learn_microsoft_mailbox_bindings where tenant_id=p_tenant and id=s.binding_id;
 namespace:=b.microsoft_tenant_id::text||':'||b.mailbox_id::text||':';
 -- Serialize all folders/bindings for this real mailbox; provider timestamps, not
 -- fetch order, decide which complete observation becomes the current record.
 perform pg_advisory_xact_lock(hashtextextended('microsoft-project:'||p_tenant::text||':'||namespace,0));
 select * into receipt from public.learn_microsoft_projection_receipts where page_id=p_page;
 if found then
  if receipt.tenant_id<>p_tenant then raise exception 'learn_microsoft_projection_conflict' using errcode='PT409';end if;
  return receipt.result;
 end if;
 select lower(email_address) into mailbox from public.email_accounts where tenant_id=p_tenant and id=s.email_account_id and provider='microsoft_365';
 if not found then raise exception 'learn_microsoft_account_unavailable' using errcode='PT409';end if;
 for e in select value from jsonb_array_elements(p.source_page->'events') loop
  if jsonb_typeof(e->'id') is distinct from 'string' or length(e->>'id') not between 1 and 2048 or (e->>'id')!~'^[A-Za-z0-9+/_=-]+$' then held:=held+1;continue;end if;
  if e->>'kind'='removed_from_folder' then removed:=removed+1;continue;end if;
  f:=e->'fields';
  if e->>'kind' is distinct from 'observed' or not public.learn_microsoft_projection_fields_valid(f) then held:=held+1;continue;end if;
  if (f->>'isDraft')::boolean then drafts:=drafts+1;continue;end if;
  message_key:=namespace||(e->>'id');
  thread_key:=case when f->>'conversationId' is not null then namespace||(f->>'conversationId') end;
  version_time:=public.learn_microsoft_projection_time(f->>'lastModifiedDateTime');
  source_identity:=jsonb_build_object('directory_id',b.microsoft_tenant_id,'mailbox_id',b.mailbox_id,'message_id',e->>'id');
  meta:=jsonb_build_object('microsoft_source',source_identity||jsonb_build_object('source_page_id',p.id,'source_folder_id',s.folder_id,
   'change_key',f->>'changeKey','last_modified',version_time,'attachments_captured',false,'has_attachments',(f->>'hasAttachments')::boolean));
  row_data:=jsonb_build_object('provider_thread_id',thread_key,'from_email',lower(f->'from'->'emailAddress'->>'address'),
   'from_name',f->'from'->'emailAddress'->>'name',
   'to_emails',(select coalesce(jsonb_agg(lower(value->'emailAddress'->>'address') order by ord),'[]') from jsonb_array_elements(f->'toRecipients') with ordinality r(value,ord)),
   'cc_emails',(select coalesce(jsonb_agg(lower(value->'emailAddress'->>'address') order by ord),'[]') from jsonb_array_elements(f->'ccRecipients') with ordinality r(value,ord)),
   'subject',f->>'subject','snippet',f->>'bodyPreview',
   'body_text',case when f->'body'->>'contentType'='text' then f->'body'->>'content' end,
   'body_html',case when f->'body'->>'contentType'='html' then f->'body'->>'content' end,
   'sent_at',(f->>'sentDateTime')::timestamptz,'received_at',(f->>'receivedDateTime')::timestamptz,
   'direction',case when nullif(mailbox,'') is not null and lower(f->'from'->'emailAddress'->>'address')=mailbox then 'outbound'
    when nullif(mailbox,'') is not null and exists(select 1 from jsonb_array_elements((f->'toRecipients')||(f->'ccRecipients')) r where lower(r->'emailAddress'->>'address')=mailbox) then 'inbound' end);
  meta:=jsonb_set(meta,'{microsoft_source,content_hash}',to_jsonb(md5(row_data::text)));
  select * into old from public.email_messages where tenant_id=p_tenant and provider='microsoft_365' and provider_message_id=message_key for update;
  if found then
   if (old.raw_payload->'microsoft_source'->'directory_id') is distinct from source_identity->'directory_id'
    or (old.raw_payload->'microsoft_source'->'mailbox_id') is distinct from source_identity->'mailbox_id'
    or (old.raw_payload->'microsoft_source'->'message_id') is distinct from source_identity->'message_id'
    or public.learn_microsoft_projection_time(old.raw_payload->'microsoft_source'->>'last_modified') is null then held:=held+1;continue;end if;
   old_time:=old.raw_payload->'microsoft_source'->>'last_modified';
   if version_time<old_time then older:=older+1;continue;end if;
   if version_time=old_time then
    if old.raw_payload->'microsoft_source'->>'change_key'=f->>'changeKey'
     and (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(old)) where key in(select jsonb_object_keys(row_data)))=row_data
     and old.raw_payload->'microsoft_source'->'has_attachments'=f->'hasAttachments'
    then unchanged:=unchanged+1;else held:=held+1;end if;
    continue;
   end if;
  end if;
  insert into public.email_messages(tenant_id,provider,provider_message_id,provider_thread_id,from_email,from_name,to_emails,cc_emails,subject,snippet,body_text,body_html,sent_at,received_at,direction,raw_payload)
   select p_tenant,'microsoft_365',message_key,x.provider_thread_id,x.from_email,x.from_name,x.to_emails,x.cc_emails,x.subject,x.snippet,x.body_text,x.body_html,x.sent_at,x.received_at,x.direction,meta
   from jsonb_populate_record(null::public.email_messages,row_data)x
   on conflict(tenant_id,provider,provider_message_id) do update set provider_thread_id=excluded.provider_thread_id,
    from_email=excluded.from_email,from_name=excluded.from_name,to_emails=excluded.to_emails,cc_emails=excluded.cc_emails,
    subject=excluded.subject,snippet=excluded.snippet,body_text=excluded.body_text,body_html=excluded.body_html,
    sent_at=excluded.sent_at,received_at=excluded.received_at,direction=excluded.direction,
    raw_payload=public.email_messages.raw_payload||excluded.raw_payload returning id into message_id;
  insert into public.interactions as i(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,
   interaction_type,direction,occurred_at,subject,body_preview,from_address,from_name,to_addresses,cc_addresses,
   related_thread_id,processing_status,metadata)
  values(p_tenant,'microsoft-365','email','email_messages',message_id,message_key,'email_message',coalesce(row_data->>'direction','unknown'),
   coalesce((f->>'receivedDateTime')::timestamptz,(f->>'sentDateTime')::timestamptz),f->>'subject',f->>'bodyPreview',
   row_data->>'from_email',row_data->>'from_name',array(select jsonb_array_elements_text(row_data->'to_emails')),array(select jsonb_array_elements_text(row_data->'cc_emails')),thread_key,'pending',
   jsonb_build_object('connector','microsoft-365','provider_thread_id',thread_key)||meta)
  on conflict(tenant_id,source_table,source_id) do update set source_connector_id=excluded.source_connector_id,
   source_external_id=excluded.source_external_id,direction=excluded.direction,occurred_at=excluded.occurred_at,
   subject=excluded.subject,body_preview=excluded.body_preview,from_address=excluded.from_address,from_name=excluded.from_name,
   to_addresses=excluded.to_addresses,cc_addresses=excluded.cc_addresses,related_thread_id=excluded.related_thread_id,
   processing_status=case when i.metadata->'microsoft_source'->>'content_hash' is distinct from excluded.metadata->'microsoft_source'->>'content_hash' then 'pending' else i.processing_status end,
   metadata=i.metadata||excluded.metadata returning id into interaction_id;
  insert into public.platform_events(tenant_id,event_type,subject_type,subject_id,source,status,payload)
   values(p_tenant,'interaction.ready','interaction',interaction_id,'microsoft-projection','pending',jsonb_build_object('source_page_id',p.id))
   on conflict(tenant_id,event_type,subject_id) where status='pending' do nothing;
  if thread_key is not null then
   observed_time:=coalesce((f->>'receivedDateTime')::timestamptz,(f->>'sentDateTime')::timestamptz);
   select coalesce(jsonb_agg(v order by v),'[]') into participants from(select distinct v from jsonb_array_elements_text((row_data->'to_emails')||(row_data->'cc_emails')||jsonb_build_array(row_data->>'from_email')) as a(v) where v is not null)x;
   insert into public.email_threads as t(tenant_id,provider,provider_thread_id,subject,participants,last_message_at,raw_payload)
    values(p_tenant,'microsoft_365',thread_key,f->>'subject',participants,observed_time,jsonb_build_object('latest_microsoft_message',message_key))
    on conflict(tenant_id,provider,provider_thread_id) do update set
     subject=case when t.last_message_at is null or excluded.last_message_at>t.last_message_at
      or (excluded.last_message_at=t.last_message_at and excluded.raw_payload->>'latest_microsoft_message'>=coalesce(t.raw_payload->>'latest_microsoft_message','')) then excluded.subject else t.subject end,
     raw_payload=case when t.last_message_at is null or excluded.last_message_at>t.last_message_at
      or (excluded.last_message_at=t.last_message_at and excluded.raw_payload->>'latest_microsoft_message'>=coalesce(t.raw_payload->>'latest_microsoft_message','')) then t.raw_payload||excluded.raw_payload else t.raw_payload end,
     last_message_at=greatest(t.last_message_at,excluded.last_message_at),
     participants=(select jsonb_agg(v order by v) from(select distinct v from jsonb_array_elements_text(t.participants||excluded.participants) as a(v))x);
  end if;
  published:=published+1;
 end loop;
 result:=jsonb_build_object('contract','microsoft-projection-receipt/1','tenantId',p_tenant,'sourcePageId',p_page,
  'published',published,'unchanged',unchanged,'held',held,'drafts',drafts,'removedFromFolder',removed,'older',older,
  'coverage','unverified','attachmentsCaptured',false);
 insert into public.learn_microsoft_projection_receipts(page_id,tenant_id,result) values(p_page,p_tenant,result);
 return result;
end $$;

-- The existing settlement still owns its lease, continuation and immutable result.
-- Publishing a message page and settling its job are now one transaction. A
-- failed/expired settlement rolls back all canonical changes and the receipt.
alter function public.learn_microsoft_job_settle(uuid,uuid,text,integer,boolean) rename to learn_microsoft_job_settle_before_projection;
revoke all on function public.learn_microsoft_job_settle_before_projection(uuid,uuid,text,integer,boolean) from public,anon,authenticated,service_role;
create function public.learn_microsoft_job_settle(p_tenant uuid,p_job uuid,p_worker text,p_claim integer,p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare prior jsonb;page_id uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_projection_forbidden' using errcode='42501';end if;
 if p_apply is null then raise exception 'learn_microsoft_settlement_invalid' using errcode='22023';end if;
 prior:=public.learn_microsoft_job_settle_before_projection(p_tenant,p_job,p_worker,p_claim,false);
 if prior->>'state'='completed' or not p_apply then return prior;end if;
 select p.id into page_id from public.learn_microsoft_source_pages p join public.learn_microsoft_capture_streams s on s.id=p.stream_id and s.tenant_id=p.tenant_id
  where p.tenant_id=p_tenant and p.job_id=p_job and s.kind='messages';
 if page_id is not null then perform public.learn_microsoft_page_project(p_tenant,page_id);end if;
 return public.learn_microsoft_job_settle_before_projection(p_tenant,p_job,p_worker,p_claim,true);
end $$;
revoke all on function public.learn_microsoft_projection_time(text),public.learn_microsoft_projection_fields_valid(jsonb),public.learn_microsoft_page_project(uuid,uuid),public.learn_microsoft_job_settle(uuid,uuid,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_microsoft_page_project(uuid,uuid),public.learn_microsoft_job_settle(uuid,uuid,text,integer,boolean) to service_role;

-- INPUT supabase/migrations/20261101350000_learn_microsoft_recurring_discovery.sql
-- Repeat folder-tree discovery without losing terminal source evidence.
-- No initial jobs, credentials, schedules or account activation are installed.
-- Historical completed receipts remain unchanged; old exhausted installations
-- need an explicitly admitted discovery job to start recurrence.

set local lock_timeout='3s';
create table public.learn_microsoft_discovery_rounds (
 stream_id uuid not null,tenant_id uuid not null,
 terminal_revision bigint not null check(terminal_revision between 1 and 9007199254740990),
 terminal_page_id uuid not null references public.learn_microsoft_source_pages(id) on delete restrict,
 settlement_job_id uuid not null unique references public.platform_jobs(id) on delete restrict,
 reset_revision bigint not null check(reset_revision=terminal_revision+1),
 reset_checkpoint jsonb not null check(jsonb_typeof(reset_checkpoint)='object' and octet_length(reset_checkpoint::text)<=16777216),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(stream_id,terminal_revision),
 foreign key(tenant_id,stream_id) references public.learn_microsoft_capture_streams(tenant_id,id) on delete restrict
);
alter table public.learn_microsoft_discovery_rounds enable row level security;
revoke all on public.learn_microsoft_discovery_rounds from public,anon,authenticated,service_role;
create trigger learn_microsoft_rounds_immutable before update or delete on public.learn_microsoft_discovery_rounds
 for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_rounds_no_truncate before truncate on public.learn_microsoft_discovery_rounds
 for each statement execute function public.learn_microsoft_journal_immutable();
-- Replace the private settlement implementation, preserving the public wrapper
-- that atomically projects message evidence into canonical records.
create or replace function public.learn_microsoft_job_settle_before_projection(p_tenant uuid,p_job uuid,p_worker text,p_claim integer,p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;s public.learn_microsoft_capture_streams%rowtype;r public.learn_microsoft_source_pages%rowtype;
 done public.learn_microsoft_job_completions%rowtype;n public.platform_jobs%rowtype;
 definition jsonb;job_state jsonb;answer jsonb;needs_more boolean;receipt_id uuid;observations integer:=0;
 dispatch jsonb:=null;reset_checkpoint jsonb;terminal_page uuid;continuation_kind text;next_check_at timestamptz;key text;successor uuid;lease_end timestamptz;step integer;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or p_apply is null then raise exception 'learn_microsoft_settlement_invalid' using errcode='22023';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_microsoft_snapshot_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception 'learn_microsoft_job_unavailable' using errcode='PT409';end if;
 definition:=jsonb_build_object('tenant_id',j.tenant_id,'connector_id',j.connector_id,'module_id',j.module_id,'job_type',j.job_type,'job_key',j.job_key,'payload',j.payload);
 select * into done from public.learn_microsoft_job_completions where job_id=p_job;
 if found then
  if done.tenant_id<>p_tenant or done.definition is distinct from definition or j.status<>'succeeded'
   or j.result is distinct from done.result then raise exception 'learn_microsoft_settlement_conflict' using errcode='PT409';end if;
  return done.result;
 end if;
 -- This validates the live lease and exact server-owned Microsoft job payload.
 -- Completion consumes retained evidence, so pause/revocation need not block it.
 job_state:=public.learn_microsoft_journal_job(p_tenant,p_job,p_worker,p_claim);
 key:=j.job_type||':'||(j.payload->>'binding_id')||':'||(j.payload->>'folder_id');
 if j.job_key is distinct from key then raise exception 'learn_microsoft_job_key_invalid' using errcode='PT409';end if;
 if not p_apply then return jsonb_build_object('contract','microsoft-job-settlement/1','state','pending','tenantId',p_tenant,'jobId',p_job);end if;
 lease_end:=j.lease_expires_at;
 select * into s from public.learn_microsoft_capture_streams where tenant_id=p_tenant
  and email_account_id=(j.payload->>'email_account_id')::uuid and binding_id=(j.payload->>'binding_id')::uuid
  and mailbox_id=(j.payload->>'mailbox_id')::uuid and kind=j.payload->>'kind' and folder_id=j.payload->>'folder_id' for update;
 if not found or not public.learn_microsoft_checkpoint_valid(s.checkpoint,s.tenant_id,s.email_account_id,s.mailbox_id,s.kind,s.folder_id)
 then raise exception 'learn_microsoft_stream_unavailable' using errcode='PT409';end if;
 select * into r from public.learn_microsoft_source_pages where tenant_id=p_tenant and job_id=p_job;
 if found then
  if r.stream_id<>s.id or r.revision<>s.revision or r.after_checkpoint is distinct from s.checkpoint then raise exception 'learn_microsoft_settlement_evidence_invalid' using errcode='PT409';end if;
  receipt_id:=r.id;
  observations:=jsonb_array_length(case when s.kind='folders' then r.source_page->'folders' else r.source_page->'events' end);
 else
  -- An already-exhausted folder traversal may settle without fabricating a page.
  if s.kind<>'folders' or s.checkpoint->'pending' is distinct from '[]'::jsonb or s.revision=0
   or not exists(select 1 from public.learn_microsoft_source_pages where stream_id=s.id and revision=s.revision and after_checkpoint=s.checkpoint)
  then raise exception 'learn_microsoft_saved_page_required' using errcode='PT409';end if;
 end if;
 if s.kind='folders' and receipt_id is not null then
  dispatch:=public.learn_microsoft_dispatch_folders(p_tenant,receipt_id,p_job);
 end if;
 needs_more:=case when s.kind='folders' then jsonb_array_length(s.checkpoint->'pending')>0
  else s.checkpoint->'continuation'->>'kind'='next' end;
 if needs_more is null then raise exception 'learn_microsoft_checkpoint_invalid' using errcode='PT409';end if;
 -- A terminal folder traversal schedules a fresh tree scan; terminal message
 -- rounds continue from their retained opaque delta URL.
 if s.kind='messages' and not needs_more and s.checkpoint->'continuation'->>'kind' is distinct from 'delta'
 then raise exception 'learn_microsoft_checkpoint_invalid' using errcode='PT409';end if;
 continuation_kind:=case when needs_more then 'page' when s.kind='messages' then 'incremental' else 'discovery' end;
 next_check_at:=case continuation_kind when 'page' then clock_timestamp()+interval '1 second'
  when 'incremental' then clock_timestamp()+interval '5 minutes'
  when 'discovery' then clock_timestamp()+interval '15 minutes' else null end;
 if continuation_kind='discovery' then
  select id into terminal_page from public.learn_microsoft_source_pages
   where stream_id=s.id and revision=s.revision and after_checkpoint=s.checkpoint;
  if terminal_page is null or s.revision>=9007199254740991 then
   raise exception 'learn_microsoft_discovery_evidence_invalid' using errcode='PT409';end if;
  -- Save a separate transition, never overwrite a source page or old completion.
  -- Increment revision to fence stale in-flight readers across the reset.
  reset_checkpoint:=s.checkpoint||jsonb_build_object('pending','[{"parentFolderId":null,"nextUrl":null}]'::jsonb,
   'completedParents','[]'::jsonb,'visitedRequests','[]'::jsonb,'folders','[]'::jsonb);
  if not public.learn_microsoft_checkpoint_valid(reset_checkpoint,s.tenant_id,s.email_account_id,s.mailbox_id,s.kind,s.folder_id) then
   raise exception 'learn_microsoft_checkpoint_invalid' using errcode='PT409';end if;
  insert into public.learn_microsoft_discovery_rounds(stream_id,tenant_id,terminal_revision,terminal_page_id,settlement_job_id,reset_revision,reset_checkpoint)
   values(s.id,p_tenant,s.revision,terminal_page,p_job,s.revision+1,reset_checkpoint);
  update public.learn_microsoft_capture_streams set revision=s.revision+1,checkpoint=reset_checkpoint,updated_at=clock_timestamp() where id=s.id;
 end if;
 -- Release the key and insert the due successor in the SAME transaction.
 -- It may remain queued during pause; journal admission forbids new provider
 -- work until current tenant/account/binding authority is valid again.
 update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),records_processed=observations,
  claimed_by=null,lease_expires_at=null,error_code=null,updated_at=clock_timestamp() where id=p_job;
 if continuation_kind is not null then
  for step in 1..3 loop
   insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,payload,parent_job_id,available_at)
    values(p_tenant,'microsoft-365','communications.email',j.job_type,key,'queued',j.priority,j.max_attempts,j.payload,p_job,next_check_at)
    on conflict(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying') do nothing returning * into n;
   if found then successor:=n.id;next_check_at:=n.available_at;exit;end if;
   select * into n from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in ('queued','running','retrying');
   if not found then continue;end if;
   if n.id=p_job or n.job_type is distinct from j.job_type or n.connector_id is distinct from j.connector_id
    or n.module_id is distinct from j.module_id or n.payload is distinct from j.payload
    or n.available_at is null or (continuation_kind in ('incremental','discovery') and n.available_at<next_check_at)
   then raise exception 'learn_microsoft_successor_conflict' using errcode='PT409';end if;
   successor:=n.id;next_check_at:=n.available_at;exit;
  end loop;
  if successor is null then raise exception 'learn_microsoft_successor_unconfirmed' using errcode='PT409';end if;
 end if;
 answer:=jsonb_build_object('contract','microsoft-job-settlement/1','state','completed','tenantId',p_tenant,'jobId',p_job,
  'sourceReceiptId',receipt_id,'successorId',successor,'observationsStored',observations,'mailboxCoverage','unverified','folderDispatch',dispatch,
  'continuationKind',continuation_kind,'nextCheckAt',next_check_at);
 update public.platform_jobs set result=answer where id=p_job;
 insert into public.learn_microsoft_job_completions(job_id,tenant_id,definition,source_receipt_id,successor_id,result)
  values(p_job,p_tenant,definition,receipt_id,successor,answer);
 if lease_end<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 return answer;
end $$;
-- CREATE OR REPLACE retains the existing owner and execute grants.

-- INPUT supabase/migrations/20261101470000_learn_microsoft_credentials.sql
-- Credential access for owned Microsoft queue jobs. Reuses the private OAuth
-- table; adds no credentials, consent, account, schedule, or capture activation.
-- A future trusted consent callback must verify identity before writing the
-- learnMicrosoft association. Unbound legacy token rows fail closed.

create function public.learn_microsoft_credential_read(
 p_tenant uuid,p_account uuid,p_mailbox uuid,p_binding uuid,p_kind text,p_folder text,
 p_job uuid,p_worker text,p_claim integer,p_client uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.learn_microsoft_mailbox_bindings%rowtype; t public.email_oauth_tokens%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception 'learn_microsoft_credential_forbidden' using errcode='42501';end if;
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 select * into strict b from public.learn_microsoft_mailbox_bindings where id=p_binding and tenant_id=p_tenant;
 select * into t from public.email_oauth_tokens where tenant_id=p_tenant and email_account_id=p_account and provider='microsoft_365' for share;
 if not found or p_client is null or t.raw_payload->'learnMicrosoft' is distinct from
  jsonb_build_object('contract','microsoft-delegated-credential/1','microsoftTenantId',b.microsoft_tenant_id,
   'mailboxId',b.mailbox_id,'bindingId',b.id,'clientId',p_client)
 then raise exception 'learn_microsoft_credential_unbound' using errcode='PT409';end if;
 -- A long lock wait must not allow an expired claim to acquire credentials.
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 return jsonb_build_object('contract','microsoft-credential/1','tenantId',p_tenant,'accountId',p_account,
  'mailboxId',b.mailbox_id,'bindingId',b.id,'microsoftTenantId',b.microsoft_tenant_id,'clientId',p_client,
  'tokenId',t.id,'updatedAt',t.updated_at,'accessToken',t.access_token,'refreshToken',t.refresh_token,
  'expiresAt',t.expires_at,'scope',t.scope,'tokenType',t.token_type);
end $$;

create function public.learn_microsoft_credential_refresh(
 p_tenant uuid,p_account uuid,p_mailbox uuid,p_binding uuid,p_kind text,p_folder text,
 p_job uuid,p_worker text,p_claim integer,p_client uuid,p_token uuid,p_updated_at timestamptz,
 p_old_refresh text,p_access text,p_refresh text,p_expires timestamptz,p_scope text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.email_oauth_tokens%rowtype; proof jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception 'learn_microsoft_credential_forbidden' using errcode='42501';end if;
 -- Lock consistently: capture switch, job, account, binding, then credential.
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 select * into t from public.email_oauth_tokens where tenant_id=p_tenant and email_account_id=p_account and provider='microsoft_365' for update;
 if not found then raise exception 'learn_microsoft_credential_unbound' using errcode='PT409';end if;
 proof:=public.learn_microsoft_credential_read(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim,p_client);
 if p_token is null or p_updated_at is null or p_old_refresh is null or
    t.id is distinct from p_token or t.updated_at is distinct from p_updated_at or t.refresh_token is distinct from p_old_refresh then
  return jsonb_build_object('contract','microsoft-credential-refresh/1','state','changed');end if;
 if p_access is null or octet_length(p_access) not between 1 and 32768 or p_access~'[[:space:][:cntrl:]]'
  or p_refresh is null or octet_length(p_refresh) not between 1 and 32768 or p_refresh~'[[:space:][:cntrl:]]'
  or p_expires is null or p_expires<=clock_timestamp()+interval '120 seconds' or p_expires>clock_timestamp()+interval '1 day'
  or p_scope is null or octet_length(p_scope)>4096 or not
   (regexp_split_to_array(lower(p_scope),'\s+') && array['mail.read','https://graph.microsoft.com/mail.read'])
 then raise exception 'learn_microsoft_credential_invalid' using errcode='22023';end if;
 update public.email_oauth_tokens set access_token=p_access,refresh_token=p_refresh,expires_at=p_expires,
  scope=p_scope,token_type='Bearer',updated_at=clock_timestamp() where id=t.id;
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 return jsonb_build_object('contract','microsoft-credential-refresh/1','state','saved');
end $$;
revoke all on function public.learn_microsoft_credential_read(uuid,uuid,uuid,uuid,text,text,uuid,text,integer,uuid) from public,anon,authenticated;
revoke all on function public.learn_microsoft_credential_refresh(uuid,uuid,uuid,uuid,text,text,uuid,text,integer,uuid,uuid,timestamptz,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.learn_microsoft_credential_read(uuid,uuid,uuid,uuid,text,text,uuid,text,integer,uuid) to service_role;
grant execute on function public.learn_microsoft_credential_refresh(uuid,uuid,uuid,uuid,text,text,uuid,text,integer,uuid,uuid,timestamptz,text,text,text,timestamptz,text) to service_role;

-- INPUT supabase/migrations/20261101480000_learn_microsoft_worker_failures.sql
-- Microsoft worker failures and pause deferral are owned, atomic queue outcomes.
-- No new jobs, credentials or schedules are seeded.

create table public.learn_microsoft_job_stops (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.platform_jobs(id),
 tenant_id uuid not null, worker text not null, attempt integer not null,
 lease_end timestamptz not null, definition jsonb not null, request jsonb not null,
 result jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
 unique(job_id,worker,attempt,lease_end)
);
alter table public.learn_microsoft_job_stops enable row level security;
revoke all on public.learn_microsoft_job_stops from public,anon,authenticated,service_role;
create trigger learn_microsoft_stops_immutable before update or delete on public.learn_microsoft_job_stops
 for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_stops_no_truncate before truncate on public.learn_microsoft_job_stops
 for each statement execute function public.learn_microsoft_journal_immutable();

create function public.learn_microsoft_job_stop(p_tenant uuid,p_job uuid,p_worker text,p_claim integer,p_code text,p_retry_after integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;prior public.learn_microsoft_job_stops%rowtype;
 definition jsonb;request jsonb;answer jsonb;owned jsonb;outcome text;code text;delay integer;
 due timestamptz;new_attempt integer;at_time timestamptz;paused boolean;retryable boolean;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_stop_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_tenant is null or p_job is null
  or nullif(p_worker,'') is null or length(p_worker)>256 or p_claim is null or p_claim<1
  or p_code is null or p_code not in ('invalid_scope','invalid_continuation','fetch_failed','invalid_response','response_too_large',
   'auth_required','access_denied','folder_unavailable','delta_expired','throttled','provider_unavailable','pagination_no_progress',
   'invalid_discovery_state','hierarchy_conflict','discovery_limit','credential_unavailable','refresh_failed',
   'reauthorization_required','capture_unconfirmed','retry_delay_requires_review')
  or (p_retry_after is not null and (p_retry_after<0 or p_retry_after>31536000))
 then raise exception 'learn_microsoft_stop_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found or j.job_type not in ('email.microsoft_discovery','email.microsoft_sync')
  or j.connector_id is distinct from 'microsoft-365' or j.module_id is distinct from 'communications.email'
 then raise exception 'learn_microsoft_stop_identity_invalid' using errcode='PT409';end if;
 definition:=jsonb_build_object('tenant_id',j.tenant_id,'connector_id',j.connector_id,'module_id',j.module_id,
  'job_type',j.job_type,'job_key',j.job_key,'payload',j.payload);
 request:=jsonb_build_object('code',p_code,'retry_after',p_retry_after);
 if j.status<>'running' then
  select * into prior from public.learn_microsoft_job_stops where job_id=p_job and tenant_id=p_tenant
   and worker=p_worker and attempt=p_claim order by recorded_at desc limit 1;
  if found and prior.definition=definition and prior.request=request and j.result=prior.result
   and j.attempt_count=(prior.result->>'attemptCount')::integer
   and j.status=(case prior.result->>'state' when 'waiting' then 'queued' when 'retrying' then 'retrying' else 'dead_letter' end)
  then return prior.result||jsonb_build_object('historicalReceipt',true);end if;
  -- A late worker may never turn a completed or newly claimed job into failure.
  raise exception 'learn_microsoft_stop_claim_lost' using errcode='PT409';
 end if;
 owned:=public.learn_microsoft_journal_job(p_tenant,p_job,p_worker,p_claim);
 if j.job_key is distinct from j.job_type||':'||(j.payload->>'binding_id')||':'||(j.payload->>'folder_id')
 then raise exception 'learn_microsoft_stop_identity_invalid' using errcode='PT409';end if;
 if owned->'receipt' is distinct from 'null'::jsonb then
  -- Storage may have succeeded despite a lost reply. The page's original
  -- completion path owns it; failure or pause cannot discard/replace this work.
  return jsonb_build_object('contract','microsoft-job-stop/1','tenantId',p_tenant,'jobId',p_job,'state','recover');
 end if;
 at_time:=clock_timestamp();paused:=not public.learn_capture_allowed(p_tenant,'email');
 retryable:=p_code in ('fetch_failed','throttled','provider_unavailable','refresh_failed','capture_unconfirmed');
 new_attempt:=j.attempt_count;
 if paused then
  outcome:='waiting';code:='capture_paused';new_attempt:=p_claim-1;due:=at_time+interval '60 seconds';
 elsif retryable and j.attempt_count<j.max_attempts then
  outcome:='retrying';code:=p_code;
  delay:=greatest(case j.attempt_count when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end,coalesce(p_retry_after,0));
  due:=at_time+make_interval(secs=>delay);
 else outcome:='failed';code:=p_code;due:=null;end if;
 answer:=jsonb_build_object('contract','microsoft-job-stop/1','tenantId',p_tenant,'jobId',p_job,
  'state',outcome,'code',code,'attemptCount',new_attempt,'availableAt',due,'historicalReceipt',false);
 update public.platform_jobs set status=case outcome when 'waiting' then 'queued' when 'retrying' then 'retrying' else 'dead_letter' end,
  attempt_count=new_attempt,claimed_by=null,claimed_at=null,lease_expires_at=null,available_at=due,next_run_at=due,
  dead_lettered_at=case when outcome='failed' then at_time else null end,
  failed_at=case when outcome='failed' then at_time else null end,
  error_code='microsoft_'||code,last_error='Microsoft mail capture: '||code,
  error_count=case when paused then j.error_count else j.attempt_count end,result=answer,updated_at=at_time
 where id=p_job;
 insert into public.learn_microsoft_job_stops(job_id,tenant_id,worker,attempt,lease_end,definition,request,result)
  values(p_job,p_tenant,p_worker,p_claim,j.lease_expires_at,definition,request,answer);
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_microsoft_stop_claim_lost' using errcode='PT409';end if;
 return answer;
end $$;
revoke all on function public.learn_microsoft_job_stop(uuid,uuid,text,integer,text,integer) from public,anon,authenticated;
grant execute on function public.learn_microsoft_job_stop(uuid,uuid,text,integer,text,integer) to service_role;

-- Preserve the existing shared capture filter verbatim and add only the two
-- Microsoft types. Retained pages may still be claimed for completion while paused.
create function public.learn_microsoft_job_claimable(p_tenant uuid,p_type text,p_job uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select case when p_type in ('email.microsoft_discovery','email.microsoft_sync') then
  public.learn_capture_allowed(p_tenant,'email') or exists(
   select 1 from public.learn_microsoft_source_pages p join public.platform_jobs j on j.id=p.job_id and j.tenant_id=p.tenant_id
   where p.tenant_id=p_tenant and p.job_id=p_job and j.job_type=p_type and j.connector_id='microsoft-365'
  ) else true end;
$$;
revoke all on function public.learn_microsoft_job_claimable(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.learn_microsoft_job_claimable(uuid,text,uuid) to service_role;
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 needle:='and (p_job_types is null or c.job_type = any(p_job_types))';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_microsoft_claim_shape_changed';end if;
 execute replace(d,needle,needle||E'\n      and public.learn_microsoft_job_claimable(c.tenant_id,c.job_type,c.id)');
end $$;

-- INPUT supabase/migrations/20261101490000_learn_microsoft_operator_status.sql
-- Read-only OpenFolk diagnostics. No capture activation, credentials or source content.

create function public.learn_operator_microsoft_status(p_tenant uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 with accounts as materialized(
  select a.id,a.email_address,(a.status='active' and a.auth_state='ok') as account_active
  from public.email_accounts a where a.tenant_id=p_tenant and a.provider='microsoft_365'
   and (p_after is null or a.id>p_after) order by a.id limit 21
 ), shown as materialized(select * from accounts order by id limit 20),
 entries as(select a.id,jsonb_build_object(
  'account_id',a.id,'email_address',a.email_address,'account_active',coalesce(a.account_active,false),
  'capture_allowed',public.learn_capture_allowed(p_tenant,'email'),
  'bindings',(select count(*) from public.learn_microsoft_mailbox_bindings b where b.tenant_id=p_tenant and b.email_account_id=a.id),
  'enabled_bindings',(select count(*) from public.learn_microsoft_mailbox_bindings b where b.tenant_id=p_tenant and b.email_account_id=a.id and b.enabled),
  'coverage_complete',false,'attachments_captured',false,
  'saved_pages',pages.saved,'settled_pages',pages.settled,'last_saved_at',pages.last_saved,'last_settled_at',pages.last_settled,
  'published_observations',pages.published,'held_observations',pages.held,
  'draft_observations',pages.drafts,'removal_observations',pages.removed,
  'physical_folders',folders.physical,'search_folders',folders.search,
  'discovery_rounds',rounds.rounds,'last_discovery_at',rounds.last_discovery,
  'jobs',jobs.counts,'next_job_at',jobs.next_at,
  'issue_code',issue.code,'issue_at',issue.updated_at
 ) as entry from shown a
 cross join lateral(
  select count(*) as saved,count(c.job_id) as settled,max(p.recorded_at) as last_saved,max(c.recorded_at) as last_settled,
   coalesce(sum((r.result->>'published')::bigint),0) as published,coalesce(sum((r.result->>'held')::bigint),0) as held,
   coalesce(sum((r.result->>'drafts')::bigint),0) as drafts,coalesce(sum((r.result->>'removedFromFolder')::bigint),0) as removed
  from public.learn_microsoft_capture_streams s join public.learn_microsoft_source_pages p on p.stream_id=s.id and p.tenant_id=s.tenant_id
  left join public.learn_microsoft_job_completions c on c.source_receipt_id=p.id and c.tenant_id=p.tenant_id
  left join public.learn_microsoft_projection_receipts r on r.page_id=p.id and r.tenant_id=p.tenant_id
  where s.tenant_id=p_tenant and s.email_account_id=a.id
 ) pages
 cross join lateral(
  select count(*) filter(where d.kind='physical') as physical,count(*) filter(where d.kind='search') as search
  from public.learn_microsoft_folder_dispatches d join public.learn_microsoft_capture_streams s on s.id=d.stream_id and s.tenant_id=d.tenant_id
  where s.tenant_id=p_tenant and s.email_account_id=a.id
 ) folders
 cross join lateral(
  select count(*) as rounds,max(d.recorded_at) as last_discovery from public.learn_microsoft_discovery_rounds d
  join public.learn_microsoft_capture_streams s on s.id=d.stream_id and s.tenant_id=d.tenant_id
  where s.tenant_id=p_tenant and s.email_account_id=a.id
 ) rounds
 cross join lateral(
  select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) as counts,min(due) as next_at from(
   select case when status in('queued','retrying','running','succeeded','dead_letter','failed','cancelled','skipped') then status else 'unknown' end as status,
    count(*) as n,min(available_at) filter(where status in('queued','retrying')) as due
   from public.platform_jobs where tenant_id=p_tenant and connector_id='microsoft-365' and module_id='communications.email'
    and job_type in('email.microsoft_discovery','email.microsoft_sync') and payload->>'email_account_id'=a.id::text group by 1
  ) grouped
 ) jobs
 left join lateral(
  select case when error_code in('microsoft_auth_required','microsoft_access_denied','microsoft_folder_unavailable','microsoft_delta_expired',
   'microsoft_throttled','microsoft_provider_unavailable','microsoft_fetch_failed','microsoft_refresh_failed','microsoft_credential_unavailable',
   'microsoft_reauthorization_required','microsoft_capture_unconfirmed','microsoft_retry_delay_requires_review','microsoft_capture_paused')
   then error_code else 'microsoft_review_required' end as code,updated_at
  from public.platform_jobs where tenant_id=p_tenant and connector_id='microsoft-365' and module_id='communications.email'
   and job_type in('email.microsoft_discovery','email.microsoft_sync') and payload->>'email_account_id'=a.id::text
   and status in('retrying','dead_letter','failed') order by updated_at desc,id desc limit 1
 ) issue on true)
 select jsonb_build_object('version','learn-microsoft-status/1','tenant_id',p_tenant,'observed_at',clock_timestamp(),
  'accounts',coalesce((select jsonb_agg(entry order by id) from entries),'[]'::jsonb),
  'next_after',case when (select count(*) from accounts)>20 then (select id from shown order by id desc limit 1) else null end)
 into result;
 return result;
end$$;
revoke all on function public.learn_operator_microsoft_status(uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_operator_microsoft_status(uuid,uuid) to authenticated;

-- INPUT supabase/release/learn-production/patches/marketing_source_capability_schema.sql
-- OAuth refresh writers use a restricted search_path. Preserve the installed
-- Marketing invoker functions, readiness rules and grants while qualifying the
-- exact dependency chain. The enclosing package pins all three definitions.
do $$declare signature text;d text;reference_name text;begin
 foreach signature in array array[
  'public.marketing_source_capability_sync()',
  'public.marketing_sender_capability_sync(uuid)',
  'public.marketing_sender_readiness(uuid,uuid)'
 ] loop
  d:=pg_get_functiondef(signature::regprocedure);
  foreach reference_name in array array[
   'marketing_sender_profiles','email_accounts','email_oauth_tokens',
   'google_workspace_mailboxes','google_workspace_connections',
   'tenant_connectors','tenant_connector_capabilities',
   'marketing_sender_capability_sync','marketing_sender_readiness','marketing_scope_has'
  ] loop
   d:=regexp_replace(d,'(?<![[:alnum:]_.])'||reference_name||'\M','public.'||reference_name,'g');
  end loop;
  execute d;
  execute 'alter function '||signature||' set search_path=pg_catalog';
 end loop;
end$$;

insert into of_learn_deploy.migrations values('learn_microsoft_capture_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
