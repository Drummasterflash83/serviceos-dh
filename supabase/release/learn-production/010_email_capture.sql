-- DRAFT: requires coordinated email worker deployment and production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Email target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_api_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='02cd8ccd3d806eacc30976edd89bdfd30b05e90d45bbf36cab2828a8765cc253') then raise exception 'Pinned production Commusoft prerequisite missing';end if;
 if exists(select 1 from pg_roles where rolname='email_ingestion_protocol_owner') or exists(select 1 from of_learn_deploy.migrations where migration_name='learn_email_capture_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['email_ingestion_checkpoints','email_ingestion_transitions','learn_email_transition_requests','learn_email_transition_settlements','learn_email_job_attempts','learn_email_source_versions']))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['email_ingestion_account_guard_v2','email_ingestion_checkpoint_json_v2','email_ingestion_count_v2','email_ingestion_evidence_v2','email_ingestion_keys_v2','email_ingestion_payload_v2','email_ingestion_recovery_v2','email_ingestion_run_guard_v2','email_ingestion_transition_result_v2','email_ingestion_transition_v2','platform_jobs_complete_email_v1','learn_email_transition_immutable','learn_email_transition_prepare','learn_email_transition_pending','learn_email_transition_apply','learn_email_job_attempt','learn_email_attempt_lease','learn_email_store_guard','learn_email_store_existing','learn_email_store_page','learn_email_job_fail','learn_email_enqueue','learn_workspace_identity_guard','learn_email_preserve_source_version','learn_email_store_unavailable'])) then raise exception 'Production Email candidate already exists; inspect before retry';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['email_accounts','email_messages','email_sync_runs','email_threads','google_workspace_mailboxes','platform_jobs','tenants']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_accounts","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"email_address","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"backfill_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"4211c0ccfcd36b328b71623726ce8860"},{"name":"backfill_started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_page_token","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_total_fetched","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"backfill_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"history_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"auth_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"auth_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"auth_state_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_incremental_success_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_incremental_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_sync_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"8c5f1fef9bc0a6370581ec2612f6593c","name":"email_accounts_pkey","valid":true},{"hash":"ff306db49bb9dce90ff69d94e1efedb3","name":"email_accounts_tenant_id_idx","valid":true},{"hash":"448b9e573800fcb3258f76a4e34378ff","name":"email_accounts_tenant_id_provider_email_address_key","valid":true},{"hash":"89919591661cca90db7edf45969364bb","name":"email_accounts_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"email_accounts_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"3b4b9e3afc4712c0a2eca19c2229c541","name":"email_accounts_set_updated_at","enabled":"O"},{"hash":"594d8a952306667e5cf9b6c8df56c8df","name":"marketing_capability_sync_email_accounts","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_accounts_pkey","validated":true},{"hash":"6a887a787213a24fb65c3f1c76dab1b6","kind":"u","name":"email_accounts_tenant_id_provider_email_address_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_messages","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"provider_message_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"provider_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"cc_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"snippet","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_html","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sent_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"received_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"origin","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_delivery_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_automation_intent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"ddab13827db6fc862b347926210f2b5f","name":"email_messages_from_idx","valid":true},{"hash":"aa0806d4070a7b3212a80a84eb9c7d5c","name":"email_messages_pkey","valid":true},{"hash":"b6c142a1e1681434cb7a2e0292da277d","name":"email_messages_received_idx","valid":true},{"hash":"fe1c7bcc6524405f48f28a236599ee8e","name":"email_messages_tenant_id_idx","valid":true},{"hash":"ca8629c22d3dd310b1126f117b9b008b","name":"email_messages_tenant_id_provider_provider_message_id_key","valid":true},{"hash":"a2e59fd4b71cb47545b35622ff50fd81","name":"email_messages_thread_idx","valid":true}],"forceRls":false,"policies":[{"name":"email_messages_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"87e7af360d7a3fb98bcdea12d9105317","name":"email_messages_set_updated_at","enabled":"O"}],"constraints":[{"hash":"b62110fa0a5753efbae5ef5b8caccc97","kind":"f","name":"email_messages_origin_campaign_fk","validated":true},{"hash":"1220af29a1985a4dabe03353bd48d8fe","kind":"c","name":"email_messages_origin_check","validated":true},{"hash":"a30c441924cbce62b8ad5027db53e1c5","kind":"f","name":"email_messages_origin_delivery_fk","validated":true},{"hash":"19a3d8f70792afd54bb9f0f14df3e6a6","kind":"f","name":"email_messages_origin_intent_fk","validated":true},{"hash":"e865d926f40b1e90e54c88f2d92a7bc1","kind":"f","name":"email_messages_origin_person_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_messages_pkey","validated":true},{"hash":"7b594e8645b3085fdc803326bd97c4e4","kind":"u","name":"email_messages_tenant_id_provider_provider_message_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_sync_runs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"sync_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"412b424d07d3e1e0d1cf66fe0bdfee56"},{"name":"started_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_message","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"}],"indexes":[{"hash":"16794814da9a7d2eb23073a006bdb248","name":"email_sync_runs_pkey","valid":true},{"hash":"45d0df2326d6e27bc87b9e4650e38b30","name":"email_sync_runs_tenant_id_idx","valid":true},{"hash":"6f9b90d0b384aee536b31476a85e620e","name":"email_sync_runs_type_status_idx","valid":true}],"forceRls":false,"policies":[{"name":"email_sync_runs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_sync_runs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_threads","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"provider_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"participants","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"last_message_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"dbd0e1d90a51f9299560440f90f9dd7b","name":"email_threads_feed_idx","valid":true},{"hash":"4bc2786fbe6972c3138aa949b5d924db","name":"email_threads_pkey","valid":true},{"hash":"bb947bbcebbba1737fdaacbe8bca5536","name":"email_threads_tenant_id_idx","valid":true},{"hash":"5550cfbf0f1bde75d4b708715b5b83df","name":"email_threads_tenant_id_provider_provider_thread_id_key","valid":true}],"forceRls":false,"policies":[{"name":"email_threads_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"93a9ba7c54a19a43b0f49190b52a73d3","name":"email_threads_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_threads_pkey","validated":true},{"hash":"24542bdf15f55b51057f8337cfa35506","kind":"u","name":"email_threads_tenant_id_provider_provider_thread_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"google_workspace_mailboxes","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connection_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"email_address","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"mailbox_type","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sync_enabled","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"last_seen_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"3bb61befc7e925951516b82516d896fb","name":"google_workspace_mailboxes_connection_id_email_address_key","valid":true},{"hash":"2c729c54213e0f58a702288e302af3db","name":"google_workspace_mailboxes_connection_idx","valid":true},{"hash":"92ce203416b14bb5cffa6bf4b7985769","name":"google_workspace_mailboxes_pkey","valid":true},{"hash":"81aa08655308b279dd0f19e0d4add6c8","name":"google_workspace_mailboxes_tenant_id_idx","valid":true},{"hash":"76184dff842c473570bf262f78573db5","name":"google_workspace_mailboxes_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"google_workspace_mailboxes_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"5189be9344bac2363011825a28d3e356","name":"google_workspace_mailboxes_set_updated_at","enabled":"O"},{"hash":"d60e5f4e8d471d86e7873c247d7557e5","name":"marketing_capability_sync_ws_mailboxes","enabled":"O"}],"constraints":[{"hash":"c1d02a80091317001416b0eb6478ecdb","kind":"u","name":"google_workspace_mailboxes_connection_id_email_address_key","validated":true},{"hash":"f7758b7c5c21f0235f6e645b45652ca4","kind":"f","name":"google_workspace_mailboxes_connection_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"google_workspace_mailboxes_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"module_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"job_key","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"7c86ea6e5094355ad44b6867fa51b433"},{"name":"priority","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"f899139df5e1059396431415e770c6dd"},{"name":"progress_current","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"progress_total","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"attempt_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"max_attempts","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"eccbc87e4b5ce2fe28308fd9f2a7baf3"},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"failed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cancelled_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"next_run_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"result","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"available_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"lease_expires_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"dead_lettered_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"error_code","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"parent_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"e8ec53579fc23c9f8c7ec9cbcc9a0fe8","name":"platform_jobs_active_job_key_uk","valid":true},{"hash":"0c8ea2ecee43cf1b569083bac92b3889","name":"platform_jobs_claim_idx","valid":true},{"hash":"95f16cdddc29e798beb223f90905fec3","name":"platform_jobs_lease_idx","valid":true},{"hash":"a2be2946f7e3402dc0501da0f336f113","name":"platform_jobs_parent_idx","valid":true},{"hash":"f8699761f53393f77b94bc724a99e825","name":"platform_jobs_pkey","valid":true},{"hash":"95bfc00526e7f302fb99702339694c04","name":"platform_jobs_tenant_connector_idx","valid":true},{"hash":"1ed91a0d9b3bf296158e7c4558ce3189","name":"platform_jobs_tenant_next_run_idx","valid":true},{"hash":"a22868c903eedcb64e7366fb3249911f","name":"platform_jobs_tenant_status_idx","valid":true},{"hash":"a3359af1d6c9ed909e3b424d77e7a174","name":"platform_jobs_tenant_type_idx","valid":true}],"forceRls":false,"policies":[{"name":"platform_jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"885bc7f92806b78eac67d45a9143c9ca","name":"platform_jobs_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_jobs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"slug","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"industry","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5284b9c618f8618b72a402ea2c593753","name":"tenants_pkey","valid":true},{"hash":"6260c986ce2d58a0ad3de3f74ec6eb6f","name":"tenants_slug_key","valid":true}],"forceRls":false,"policies":[{"name":"tenants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"831f798d620de1d73971187d41079b4d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8009f8efa07661ab809d3f9e077da55e","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"742cd63e2f0ed7809f0911b17d02869d","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a4d62ca55c88b97023eab7696e527ce","name":"tenants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenants_pkey","validated":true},{"hash":"687397275d0e852fb2a4b50394adffee","kind":"u","name":"tenants_slug_key","validated":true},{"hash":"7702cc7b97df1ebce81e13bb05db5c2d","kind":"c","name":"tenants_status_check","validated":true}]}]'::jsonb then raise exception 'Production Email table baseline differs';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['platform_jobs_claim','learn_capture_job_allowed','learn_capture_allowed','set_updated_at']);
 if actual_helpers is distinct from '[{"hash":"cc8bc01c1ebd3da0c5f0ec5de3754667","name":"learn_capture_allowed","owner":"postgres","arguments":"p_tenant uuid, p_source text","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"a775d5552608ae0e222cee9ac3d3e51b","name":"learn_capture_job_allowed","owner":"postgres","arguments":"p_tenant uuid, p_type text, p_metadata jsonb","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"93f1d9174a25d7433ae67106ba130773","name":"platform_jobs_claim","owner":"postgres","arguments":"p_worker text, p_batch integer, p_lease_seconds integer, p_job_types text[]","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"4d6804d5850641a33867814c9e76a714","name":"set_updated_at","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true}]'::jsonb then raise exception 'Production Email helper baseline differs';end if;
end$$;
create role email_ingestion_protocol_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant email_ingestion_protocol_owner to postgres with inherit true, set true;
grant usage on schema public,auth to email_ingestion_protocol_owner;
grant create on schema public to email_ingestion_protocol_owner;
create unique index email_sync_runs_tenant_id_id_v2 on public.email_sync_runs(tenant_id,id);
create table public."email_ingestion_checkpoints" ("tenant_id" uuid not null,"email_account_id" uuid not null,"stream" text not null,"contract_version" integer default 2 not null,"generation" uuid default gen_random_uuid() not null,"revision" bigint not null,"state" text not null,"owner_attempt_id" uuid,"continuation" jsonb,"block_code" text,"created_at" timestamp with time zone default now() not null,"updated_at" timestamp with time zone default now() not null);
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_check" CHECK (((state = 'claimed'::text) = (owner_attempt_id IS NOT NULL)));
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_check1" CHECK (((state = 'blocked'::text) = (block_code IS NOT NULL)));
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_check2" CHECK (((stream <> 'historical'::text) OR (continuation IS NULL)));
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_continuation_check" CHECK (((continuation IS NULL) OR (jsonb_typeof(continuation) = 'object'::text)));
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_contract_version_check" CHECK ((contract_version = 2));
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_pkey" PRIMARY KEY (tenant_id, email_account_id, stream);
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_revision_check" CHECK ((revision >= 0));
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_state_check" CHECK ((state = ANY (ARRAY['ready'::text, 'claimed'::text, 'blocked'::text, 'completed'::text])));
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_stream_check" CHECK ((stream = ANY (ARRAY['recent'::text, 'historical'::text])));
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_tenant_id_email_account_id_fkey" FOREIGN KEY (tenant_id, email_account_id) REFERENCES email_accounts(tenant_id, id) ON DELETE RESTRICT;
alter table public."email_ingestion_checkpoints" add constraint "email_ingestion_checkpoints_tenant_id_owner_attempt_id_fkey" FOREIGN KEY (tenant_id, owner_attempt_id) REFERENCES email_sync_runs(tenant_id, id) ON DELETE RESTRICT;
alter table public."email_ingestion_checkpoints" enable row level security;
revoke all on public."email_ingestion_checkpoints" from public,anon,authenticated,service_role;
grant select on public."email_ingestion_checkpoints" to service_role;
create table public."email_ingestion_transitions" ("tenant_id" uuid not null,"email_account_id" uuid not null,"stream" text not null,"transition_id" uuid not null,"contract_version" integer default 2 not null,"operation" text not null,"attempt_id" uuid not null,"expected_generation" uuid,"expected_revision" bigint,"expected_owner_attempt_id" uuid,"request_document" jsonb not null,"request_fingerprint" text not null,"accepted_result" jsonb not null,"checkpoint_stream" text,"result_generation" uuid,"result_revision" bigint,"created_at" timestamp with time zone default now() not null);
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_accepted_result_check" CHECK ((jsonb_typeof(accepted_result) = 'object'::text));
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_check" CHECK ((((checkpoint_stream IS NULL) AND (operation = 'finish_attempt'::text) AND (result_generation IS NULL) AND (result_revision IS NULL)) OR ((checkpoint_stream IS NOT NULL) AND (checkpoint_stream = stream) AND (result_generation IS NOT NULL) AND (result_revision IS NOT NULL))));
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_check1" CHECK (((checkpoint_stream IS NOT NULL) OR (accepted_result @> '{"revision": null, "generation": null, "attempt_status": "failed", "checkpoint_state": null, "owner_attempt_id": null, "coverage_complete": false, "checkpoint_present": false}'::jsonb)));
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_contract_version_check" CHECK ((contract_version = 2));
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_expected_revision_check" CHECK ((expected_revision >= 0));
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_operation_check" CHECK ((operation = ANY (ARRAY['claim'::text, 'initialize_traversal'::text, 'checkpoint'::text, 'release'::text, 'block'::text, 'takeover'::text, 'restart'::text, 'finish_attempt'::text])));
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_pkey" PRIMARY KEY (tenant_id, email_account_id, stream, transition_id);
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_request_document_check" CHECK ((jsonb_typeof(request_document) = 'object'::text));
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_result_revision_check" CHECK ((result_revision >= 0));
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_stream_check" CHECK ((stream = ANY (ARRAY['recent'::text, 'historical'::text])));
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_tenant_id_attempt_id_fkey" FOREIGN KEY (tenant_id, attempt_id) REFERENCES email_sync_runs(tenant_id, id) ON DELETE RESTRICT;
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_tenant_id_email_account_id_che_fkey" FOREIGN KEY (tenant_id, email_account_id, checkpoint_stream) REFERENCES email_ingestion_checkpoints(tenant_id, email_account_id, stream) ON DELETE RESTRICT;
alter table public."email_ingestion_transitions" add constraint "email_ingestion_transitions_tenant_id_email_account_id_fkey" FOREIGN KEY (tenant_id, email_account_id) REFERENCES email_accounts(tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX email_ingestion_attempt_v2 ON public.email_ingestion_transitions USING btree (attempt_id);
CREATE INDEX email_ingestion_input_token_v2 ON public.email_ingestion_transitions USING btree (tenant_id, email_account_id, stream, result_generation, (((request_document -> 'payload'::text) ->> 'label'::text)), md5(COALESCE(((request_document -> 'payload'::text) ->> 'expected_input_page_token'::text), ((request_document -> 'payload'::text) ->> 'expected_page_token'::text)))) WHERE (operation = 'checkpoint'::text);
CREATE INDEX email_ingestion_output_token_v2 ON public.email_ingestion_transitions USING btree (tenant_id, email_account_id, stream, result_generation, (((request_document -> 'payload'::text) ->> 'label'::text)), md5(((request_document -> 'payload'::text) ->> 'returned_next_page_token'::text))) WHERE (operation = 'checkpoint'::text);
alter table public."email_ingestion_transitions" enable row level security;
revoke all on public."email_ingestion_transitions" from public,anon,authenticated,service_role;
grant select on public."email_ingestion_transitions" to service_role;
create policy "email_account_protocol_select_v2" on public."email_accounts" as PERMISSIVE for SELECT to email_ingestion_protocol_owner using(true);
create policy "email_account_protocol_update_v2" on public."email_accounts" as PERMISSIVE for UPDATE to email_ingestion_protocol_owner using(true) with check(true);
create policy "email_checkpoint_insert_v2" on public."email_ingestion_checkpoints" as PERMISSIVE for INSERT to email_ingestion_protocol_owner with check(true);
create policy "email_checkpoint_select_v2" on public."email_ingestion_checkpoints" as PERMISSIVE for SELECT to email_ingestion_protocol_owner using(true);
create policy "email_checkpoint_update_v2" on public."email_ingestion_checkpoints" as PERMISSIVE for UPDATE to email_ingestion_protocol_owner using(true) with check(true);
create policy "email_receipt_insert_v2" on public."email_ingestion_transitions" as PERMISSIVE for INSERT to email_ingestion_protocol_owner with check(true);
create policy "email_receipt_select_v2" on public."email_ingestion_transitions" as PERMISSIVE for SELECT to email_ingestion_protocol_owner using(true);
create policy "email_run_protocol_select_v2" on public."email_sync_runs" as PERMISSIVE for SELECT to email_ingestion_protocol_owner using(true);
create policy "email_run_protocol_update_v2" on public."email_sync_runs" as PERMISSIVE for UPDATE to email_ingestion_protocol_owner using(true) with check(true);
grant SELECT("auth_state") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("backfill_completed_at") on public."email_accounts" to email_ingestion_protocol_owner;
grant UPDATE("backfill_completed_at") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("backfill_error") on public."email_accounts" to email_ingestion_protocol_owner;
grant UPDATE("backfill_error") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("backfill_page_token") on public."email_accounts" to email_ingestion_protocol_owner;
grant UPDATE("backfill_page_token") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("backfill_started_at") on public."email_accounts" to email_ingestion_protocol_owner;
grant UPDATE("backfill_started_at") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("backfill_status") on public."email_accounts" to email_ingestion_protocol_owner;
grant UPDATE("backfill_status") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("backfill_total_fetched") on public."email_accounts" to email_ingestion_protocol_owner;
grant UPDATE("backfill_total_fetched") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("history_id") on public."email_accounts" to email_ingestion_protocol_owner;
grant UPDATE("history_id") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("id") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("provider") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("status") on public."email_accounts" to email_ingestion_protocol_owner;
grant SELECT("tenant_id") on public."email_accounts" to email_ingestion_protocol_owner;
grant UPDATE("block_code") on public."email_ingestion_checkpoints" to email_ingestion_protocol_owner;
grant UPDATE("continuation") on public."email_ingestion_checkpoints" to email_ingestion_protocol_owner;
grant UPDATE("generation") on public."email_ingestion_checkpoints" to email_ingestion_protocol_owner;
grant UPDATE("owner_attempt_id") on public."email_ingestion_checkpoints" to email_ingestion_protocol_owner;
grant UPDATE("revision") on public."email_ingestion_checkpoints" to email_ingestion_protocol_owner;
grant UPDATE("state") on public."email_ingestion_checkpoints" to email_ingestion_protocol_owner;
grant UPDATE("updated_at") on public."email_ingestion_checkpoints" to email_ingestion_protocol_owner;
grant INSERT on public."email_ingestion_checkpoints" to email_ingestion_protocol_owner;
grant SELECT on public."email_ingestion_checkpoints" to email_ingestion_protocol_owner;
grant INSERT on public."email_ingestion_transitions" to email_ingestion_protocol_owner;
grant SELECT on public."email_ingestion_transitions" to email_ingestion_protocol_owner;
grant UPDATE("completed_at") on public."email_sync_runs" to email_ingestion_protocol_owner;
grant UPDATE("error_message") on public."email_sync_runs" to email_ingestion_protocol_owner;
grant UPDATE("metadata") on public."email_sync_runs" to email_ingestion_protocol_owner;
grant UPDATE("records_processed") on public."email_sync_runs" to email_ingestion_protocol_owner;
grant UPDATE("status") on public."email_sync_runs" to email_ingestion_protocol_owner;
grant SELECT on public."email_sync_runs" to email_ingestion_protocol_owner;
CREATE OR REPLACE FUNCTION public.email_ingestion_account_guard_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$ begin
  if current_user='email_ingestion_protocol_owner' then return new; end if;
  if tg_op='INSERT' then
    if new.history_id is not null or new.backfill_status<>'idle' or new.backfill_started_at is not null or new.backfill_completed_at is not null or new.backfill_page_token is not null or new.backfill_total_fetched<>0 or new.backfill_error is not null then
      raise exception using errcode='42501',message='email_progress_requires_protocol';
    end if;
  elsif row(new.history_id,new.backfill_status,new.backfill_started_at,new.backfill_completed_at,new.backfill_page_token,new.backfill_total_fetched,new.backfill_error)
    is distinct from row(old.history_id,old.backfill_status,old.backfill_started_at,old.backfill_completed_at,old.backfill_page_token,old.backfill_total_fetched,old.backfill_error) then
    raise exception using errcode='42501',message='email_progress_requires_protocol';
  end if;
  return new;
end $function$
;
alter function public."email_ingestion_account_guard_v2"() owner to "postgres";
revoke all on function public."email_ingestion_account_guard_v2"() from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.email_ingestion_checkpoint_json_v2(c email_ingestion_checkpoints)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select case when c.tenant_id is null then null else to_jsonb(c)||jsonb_build_object('revision',c.revision::text,
   'continuation',case when c.stream='recent' and jsonb_typeof(c.continuation)='object' and not (c.continuation ? 'fetch_policy')
     then c.continuation||jsonb_build_object('fetch_policy','missing_only') else c.continuation end) end
$function$
;
alter function public."email_ingestion_checkpoint_json_v2"(c email_ingestion_checkpoints) owner to "postgres";
revoke all on function public."email_ingestion_checkpoint_json_v2"(c email_ingestion_checkpoints) from public,anon,authenticated,service_role;
grant execute on function public."email_ingestion_checkpoint_json_v2"(c email_ingestion_checkpoints) to "email_ingestion_protocol_owner";
CREATE OR REPLACE FUNCTION public.email_ingestion_count_v2(v jsonb, nullable boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$ begin
  if v='null'::jsonb then return nullable; end if;
  if v is null or jsonb_typeof(v)<>'number' then return false; end if;
  return (v#>>'{}')::numeric between 0 and 2147483647 and trunc((v#>>'{}')::numeric)=(v#>>'{}')::numeric;
end $function$
;
alter function public."email_ingestion_count_v2"(v jsonb, nullable boolean) owner to "postgres";
revoke all on function public."email_ingestion_count_v2"(v jsonb, nullable boolean) from public,anon,authenticated,service_role;
grant execute on function public."email_ingestion_count_v2"(v jsonb, nullable boolean) to "email_ingestion_protocol_owner";
CREATE OR REPLACE FUNCTION public.email_ingestion_evidence_v2(v jsonb, kind text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare k text; names text[]:=array['persistence','message_upsert_count','thread_upsert_count','ids_seen','gone_count','unresolved_count'];
begin
  if kind='failure' then names:=names||array['classification','coverage_complete'];
  elsif kind='release' then names:=names||array['coverage_complete'];
  elsif kind<>'success' then raise exception using errcode='22023',message='invalid_evidence'; end if;
  perform public.email_ingestion_keys_v2(v,names);
  if kind='failure' then
    if not coalesce(v->>'classification'=any(array['provider_expired','pagination_cycle','fetch_failure','parse_failure','persistence_failure','checkpoint_conflict','source_ineligible','unexpected_failure']),false)
      or not coalesce(v->>'persistence'=any(array['confirmed','unknown']),false) then
      raise exception using errcode='22023',message='invalid_evidence';
    end if;
  elsif v->>'persistence' is distinct from 'confirmed' or v->'unresolved_count' is distinct from '0'::jsonb then
    raise exception using errcode='22023',message='invalid_evidence';
  end if;
  if kind<>'success' and v->'coverage_complete' is distinct from 'false'::jsonb then raise exception using errcode='22023',message='invalid_evidence'; end if;
  foreach k in array array['message_upsert_count','thread_upsert_count','ids_seen','gone_count','unresolved_count'] loop
    if not public.email_ingestion_count_v2(v->k,kind='failure' and v->>'persistence'='unknown') then
      raise exception using errcode='22023',message='invalid_evidence';
    end if;
  end loop;
end $function$
;
alter function public."email_ingestion_evidence_v2"(v jsonb, kind text) owner to "postgres";
revoke all on function public."email_ingestion_evidence_v2"(v jsonb, kind text) from public,anon,authenticated,service_role;
grant execute on function public."email_ingestion_evidence_v2"(v jsonb, kind text) to "email_ingestion_protocol_owner";
CREATE OR REPLACE FUNCTION public.email_ingestion_keys_v2(v jsonb, names text[])
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$ begin
  if v is null or jsonb_typeof(v)<>'object' then raise exception using errcode='22023',message='invalid_payload'; end if;
  if (select count(*) from jsonb_object_keys(v))<>cardinality(names) or not (v ?& names) then
    raise exception using errcode='22023',message='invalid_payload';
  end if;
end $function$
;
alter function public."email_ingestion_keys_v2"(v jsonb, names text[]) owner to "postgres";
revoke all on function public."email_ingestion_keys_v2"(v jsonb, names text[]) from public,anon,authenticated,service_role;
grant execute on function public."email_ingestion_keys_v2"(v jsonb, names text[]) to "email_ingestion_protocol_owner";
CREATE OR REPLACE FUNCTION public.email_ingestion_payload_v2(op text, stream text, v jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare names text[]; t jsonb; k text;
begin
  case op
  when 'claim' then
    names:=array['recovery'];
    if stream='recent' and v ? 'force' then
      names:=names||array['force'];
      if jsonb_typeof(v->'force') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_force'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names);
    if v->'recovery'<>'null'::jsonb then perform public.email_ingestion_recovery_v2(v->'recovery'); end if;
  when 'initialize_traversal' then
    perform public.email_ingestion_keys_v2(v,array['captured_history_id','captured_at','page_size','query']);
    if stream<>'recent' or jsonb_typeof(v->'captured_history_id') is distinct from 'string' or
      not coalesce(v->>'captured_history_id'~'^(0|[1-9][0-9]{0,19})$',false) then raise exception using errcode='22023',message='invalid_boundary'; end if;
    if (v->>'captured_history_id')::numeric>18446744073709551615 or v->'query'<>'null'::jsonb or
      not public.email_ingestion_count_v2(v->'page_size') or (v->>'page_size')::integer not between 1 and 500 or
      not coalesce(v->>'captured_at'~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$',false) then raise exception using errcode='22023',message='invalid_boundary'; end if;
    perform (v->>'captured_at')::timestamptz;
  when 'checkpoint' then
    names:=array['returned_next_page_token','exhausted','page_evidence','yield_after_page'];
    if stream='recent' then names:=names||array['label','expected_input_page_token'];
    else names:=names||array['expected_page_token','expected_total','listed_count']; end if;
    perform public.email_ingestion_keys_v2(v,names);
    perform public.email_ingestion_evidence_v2(v->'page_evidence','success');
    if stream='recent' then
      if not coalesce(v->>'label'=any(array['INBOX','SENT']),false) then raise exception using errcode='22023',message='invalid_page'; end if;
      k:='expected_input_page_token';
    else
      k:='expected_page_token';
      if not public.email_ingestion_count_v2(v->'expected_total') or not public.email_ingestion_count_v2(v->'listed_count') then raise exception using errcode='22023',message='invalid_page'; end if;
    end if;
    foreach t in array array[v->k,v->'returned_next_page_token'] loop
      if t<>'null'::jsonb and (jsonb_typeof(t)<>'string' or length(t#>>'{}') not between 1 and 8192) then raise exception using errcode='22023',message='invalid_token'; end if;
    end loop;
    if jsonb_typeof(v->'exhausted')<>'boolean' or jsonb_typeof(v->'yield_after_page')<>'boolean' or
      (v->>'exhausted')::boolean is distinct from (v->'returned_next_page_token'='null'::jsonb) then raise exception using errcode='22023',message='invalid_page'; end if;
  when 'release' then
    perform public.email_ingestion_keys_v2(v,array['reason_code','attempt_evidence']);
    if not coalesce(v->>'reason_code'=any(array['page_budget','time_budget','requested_yield']),false) then raise exception using errcode='22023',message='invalid_release'; end if;
    perform public.email_ingestion_evidence_v2(v->'attempt_evidence','release');
  when 'block','finish_attempt' then
    names:=array['error_code','attempt_evidence'];
    if op='finish_attempt' then names:=names||array['outcome'];
      if not coalesce(v->>'outcome'=any(array['failed','superseded']),false) then raise exception using errcode='22023',message='invalid_outcome'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names);
    if not coalesce(v->>'error_code'=any(array['history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure']),false) then raise exception using errcode='22023',message='invalid_error'; end if;
    perform public.email_ingestion_evidence_v2(v->'attempt_evidence','failure');
  when 'takeover' then
    perform public.email_ingestion_keys_v2(v,array['recovery']); perform public.email_ingestion_recovery_v2(v->'recovery');
  when 'restart' then
    names:=array['reason_code','recovery'];
    if stream='recent' and v ? 'fetch_policy' then
      names:=names||array['fetch_policy'];
      if not coalesce(v->>'fetch_policy'=any(array['missing_only','refetch_all']),false) then raise exception using errcode='22023',message='invalid_fetch_policy'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names); perform public.email_ingestion_recovery_v2(v->'recovery');
    if not coalesce(v->>'reason_code'=any(array['operator_restart','history_expired','continuation_expired']),false) then raise exception using errcode='22023',message='invalid_restart'; end if;
  else raise exception using errcode='22023',message='invalid_operation';
  end case;
end $function$
;
alter function public."email_ingestion_payload_v2"(op text, stream text, v jsonb) owner to "postgres";
revoke all on function public."email_ingestion_payload_v2"(op text, stream text, v jsonb) from public,anon,authenticated,service_role;
grant execute on function public."email_ingestion_payload_v2"(op text, stream text, v jsonb) to "email_ingestion_protocol_owner";
CREATE OR REPLACE FUNCTION public.email_ingestion_recovery_v2(v jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$ begin
  perform public.email_ingestion_keys_v2(v,array['actor_user_id','authorization_reference','reason_code']);
  if jsonb_typeof(v->'actor_user_id') is distinct from 'string' or
    not coalesce(v->>'actor_user_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) or
    not coalesce(v->>'authorization_reference'~'^[A-Za-z0-9_.:/-][A-Za-z0-9_.:/-]{0,255}$',false) or
    not coalesce(v->>'reason_code'=any(array['operator_resume','operator_takeover','operator_restart','history_expired','continuation_expired']),false) then
    raise exception using errcode='22023',message='invalid_recovery';
  end if;
end $function$
;
alter function public."email_ingestion_recovery_v2"(v jsonb) owner to "postgres";
revoke all on function public."email_ingestion_recovery_v2"(v jsonb) from public,anon,authenticated,service_role;
grant execute on function public."email_ingestion_recovery_v2"(v jsonb) to "email_ingestion_protocol_owner";
CREATE OR REPLACE FUNCTION public.email_ingestion_run_guard_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare protected boolean;
begin
  if tg_op='INSERT' then
    if new.sync_type in ('messages','workspace_messages','workspace_backfill') then
      if new.status<>'running' or new.completed_at is not null or new.records_processed<>0 or
        jsonb_typeof(new.metadata->'email_account_id') is distinct from 'string' or
        not coalesce(new.metadata->>'email_account_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) or new.metadata ? 'email_ingestion_v2' then
        raise exception using errcode='42501',message='invalid_ingestion_attempt';
      end if;
    end if;
    return new;
  end if;
  protected:=old.sync_type in ('messages','workspace_messages','workspace_backfill');
  if tg_op='UPDATE' then protected:=protected or new.sync_type in ('messages','workspace_messages','workspace_backfill'); end if;
  if not protected then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' or current_user<>'email_ingestion_protocol_owner' then
    raise exception using errcode='42501',message='email_attempt_requires_protocol';
  end if;
  if row(new.id,new.tenant_id,new.provider,new.sync_type,new.started_at,new.metadata->'email_account_id') is distinct from
     row(old.id,old.tenant_id,old.provider,old.sync_type,old.started_at,old.metadata->'email_account_id') then
    raise exception using errcode='42501',message='immutable_ingestion_attempt';
  end if;
  return new;
end $function$
;
alter function public."email_ingestion_run_guard_v2"() owner to "postgres";
revoke all on function public."email_ingestion_run_guard_v2"() from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.email_ingestion_transition_result_v2(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare c public.email_ingestion_checkpoints%rowtype; r public.email_ingestion_transitions%rowtype;
 a public.email_sync_runs%rowtype; has_receipt boolean;
begin
 if p_tenant_id is null or p_email_account_id is null or p_attempt_id is null or p_transition_id is null or p_stream is null or p_stream not in ('recent','historical') then
   raise exception using errcode='22023',message='invalid_request';
 end if;
 perform 1 from public.email_accounts where tenant_id=p_tenant_id and id=p_email_account_id and provider='gmail' for update;
 if not found then raise exception using errcode='42501',message='account_not_found'; end if;
 perform 1 from public.email_ingestion_checkpoints where tenant_id=p_tenant_id and email_account_id=p_email_account_id
   order by case stream when 'recent' then 0 else 1 end for update;
 select * into c from public.email_ingestion_checkpoints where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream;
 select * into r from public.email_ingestion_transitions where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream and transition_id=p_transition_id;
 has_receipt:=found;
 select * into a from public.email_sync_runs where tenant_id=p_tenant_id and id=p_attempt_id for update;
 if not found or a.provider<>'gmail' or jsonb_typeof(a.metadata->'email_account_id') is distinct from 'string' or
   not coalesce(a.metadata->>'email_account_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) then
   raise exception using errcode='42501',message='attempt_mismatch';
 end if;
 if (a.metadata->>'email_account_id')::uuid<>p_email_account_id or
   (p_stream='historical' and a.sync_type<>'workspace_backfill') or (p_stream='recent' and a.sync_type not in ('messages','workspace_messages')) or
   (has_receipt and r.attempt_id<>p_attempt_id) or
   exists(select 1 from public.email_ingestion_transitions where attempt_id=p_attempt_id and
     (tenant_id<>p_tenant_id or email_account_id<>p_email_account_id or stream<>p_stream)) then raise exception using errcode='42501',message='attempt_mismatch'; end if;
 -- Terminal attempts and subsequently disabled sources can still inspect their receipts.
 return jsonb_build_object('contract_version',2,'disposition',case when has_receipt then 'replayed' else 'conflict' end,
   'code',case when has_receipt then 'receipt_replayed' else 'not_found' end,'transition_id',p_transition_id,
   'accepted_result',case when has_receipt then r.accepted_result else null end,
   'current_checkpoint',public.email_ingestion_checkpoint_json_v2(c),'historical_receipt',has_receipt);
end $function$
;
alter function public."email_ingestion_transition_result_v2"(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid) owner to "email_ingestion_protocol_owner";
revoke all on function public."email_ingestion_transition_result_v2"(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid) from public,anon,authenticated,service_role;
grant execute on function public."email_ingestion_transition_result_v2"(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid) to "service_role";
CREATE OR REPLACE FUNCTION public.email_ingestion_transition_v2(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid, p_operation text, p_expected_generation uuid, p_expected_revision bigint, p_expected_owner_attempt_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 a record; c public.email_ingestion_checkpoints%rowtype; receipt public.email_ingestion_transitions%rowtype;
 attempt public.email_sync_runs%rowtype; doc jsonb; result jsonb; evidence jsonb;
 exists_checkpoint boolean; replay boolean; changed boolean:=true; eligible boolean;
 done boolean:=false; terminal boolean:=false; attempt_status text:='running'; error_code text;
 records integer; label text; input_token text; next_token text; mode text; current_cursor text;
 new_total bigint; code text; v_attempt_metadata jsonb; confirmed_count integer; v_fetch_policy text; v_force boolean;
begin
 if p_tenant_id is null or p_email_account_id is null or p_attempt_id is null or p_transition_id is null or
   p_stream is null or p_stream not in ('recent','historical') or p_operation is null or
   p_expected_revision<0 then raise exception using errcode='22023',message='invalid_request'; end if;
 perform public.email_ingestion_payload_v2(p_operation,p_stream,p_payload);
 -- Defaults do not rewrite the frozen request_document: omitted/false remain
 -- different requests for same-ID replay equality, even when semantically equal.
 v_force:=p_stream='recent' and p_operation='claim' and coalesce((p_payload->>'force')::boolean,false);
 -- No whole account SELECT: this role has no token, identity-write or authority privileges.
 select id,tenant_id,provider,status,auth_state,history_id,backfill_status,backfill_started_at,
   backfill_completed_at,backfill_page_token,backfill_total_fetched,backfill_error
 into a from public.email_accounts where tenant_id=p_tenant_id and id=p_email_account_id and provider='gmail' for update;
 if not found then raise exception using errcode='P0001',message='account_not_found'; end if;
 perform 1 from public.email_ingestion_checkpoints where tenant_id=p_tenant_id and email_account_id=p_email_account_id
   order by case stream when 'recent' then 0 else 1 end for update;
 select * into c from public.email_ingestion_checkpoints where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream;
 exists_checkpoint:=found;
 select * into receipt from public.email_ingestion_transitions where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream and transition_id=p_transition_id;
 replay:=found;
 -- Own attempt lock comes BEFORE mutable status/association validation and mutation.
 select * into attempt from public.email_sync_runs where id=p_attempt_id and tenant_id=p_tenant_id for update;
 if not found or attempt.provider<>'gmail' or jsonb_typeof(attempt.metadata->'email_account_id') is distinct from 'string' or
   not coalesce(attempt.metadata->>'email_account_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) then
   raise exception using errcode='P0001',message='attempt_mismatch';
 end if;
 if (attempt.metadata->>'email_account_id')::uuid<>p_email_account_id or
   (p_stream='historical' and attempt.sync_type<>'workspace_backfill') or
   (p_stream='recent' and attempt.sync_type not in ('messages','workspace_messages')) or
   exists(select 1 from public.email_ingestion_transitions where attempt_id=p_attempt_id and
     (tenant_id<>p_tenant_id or email_account_id<>p_email_account_id or stream<>p_stream)) or
   exists(select 1 from public.email_ingestion_checkpoints where owner_attempt_id=p_attempt_id and
     (tenant_id<>p_tenant_id or email_account_id<>p_email_account_id or stream<>p_stream)) then
   raise exception using errcode='P0001',message='attempt_mismatch';
 end if;
 doc:=jsonb_build_object('tenant_id',p_tenant_id,'email_account_id',p_email_account_id,'stream',p_stream,
   'attempt_id',p_attempt_id,'transition_id',p_transition_id,'operation',p_operation,
   'expected_generation',p_expected_generation,'expected_revision',p_expected_revision::text,
   'expected_owner_attempt_id',p_expected_owner_attempt_id,'payload',p_payload);
 if replay then
   if receipt.attempt_id<>p_attempt_id or receipt.request_document<>doc then raise exception using errcode='P0001',message='transition_id_reused'; end if;
   return jsonb_build_object('contract_version',2,'disposition','replayed','code','receipt_replayed','transition_id',p_transition_id,
     'accepted_result',receipt.accepted_result,'current_checkpoint',public.email_ingestion_checkpoint_json_v2(c),'historical_receipt',true);
 end if;
 if attempt.status<>'running' then raise exception using errcode='P0001',message='attempt_terminal'; end if;
 records:=attempt.records_processed;
 -- Slice A account check ONLY; DWD relationship/revision locking is not claimed.
 eligible:=case when attempt.sync_type='messages' then a.status='active' and a.auth_state in ('ok','unknown')
   else a.status in ('pending_tokenless_dwd','active_dwd') end;
 if p_operation not in ('block','release','finish_attempt') and not eligible then raise exception using errcode='P0001',message='source_ineligible'; end if;
 if p_operation='finish_attempt' then
   if exists_checkpoint and c.owner_attempt_id=p_attempt_id then raise exception using errcode='P0001',message='owner_must_release'; end if;
   if not exists_checkpoint and (p_expected_generation is not null or p_expected_revision is not null or p_expected_owner_attempt_id is not null) then
     raise exception using errcode='22023',message='absent_checkpoint_requires_null_fences';
   end if;
   -- Explicit stale-version exception: only caller's own evidence; no progress update.
   changed:=false; terminal:=true; attempt_status:='failed'; error_code:=p_payload->>'error_code';
   evidence:=p_payload->'attempt_evidence';
 else
   if not exists_checkpoint then
     if p_operation<>'claim' or p_expected_generation is not null or p_expected_revision is not null or p_expected_owner_attempt_id is not null or p_payload->'recovery'<>'null'::jsonb then
       raise exception using errcode='P0001',message='checkpoint_missing';
     end if;
     c.tenant_id:=p_tenant_id; c.email_account_id:=p_email_account_id; c.stream:=p_stream; c.contract_version:=2;
     c.generation:=gen_random_uuid(); c.revision:=0; c.state:='ready'; c.owner_attempt_id:=null;
     c.created_at:=now(); c.updated_at:=now();
     if p_stream='recent' then c.continuation:=jsonb_build_object('version',2,'phase','uninitialized',
       'intent',case when v_force then 'reconcile' else 'normal' end,
       'fetch_policy',case when v_force then 'refetch_all' else 'missing_only' end);
     elsif a.backfill_status='completed' then c.state:='completed';
     elsif a.backfill_status='error' then
       c.state:='blocked';
       -- Preserve recognised classifications, especially restart-only expiry.
       -- Unknown legacy error text must not leak into protocol evidence.
       c.block_code:=case when a.backfill_error in (
         'history_expired','continuation_expired','pagination_no_progress',
         'fetch_failed','parse_failed','persistence_failed','checkpoint_conflict',
         'source_ineligible','unexpected_failure') then a.backfill_error else 'unexpected_failure' end;
     elsif a.backfill_status not in ('idle','running') then raise exception using errcode='P0001',message='legacy_state_invalid'; end if;
   elsif c.generation is distinct from p_expected_generation or c.revision is distinct from p_expected_revision or c.owner_attempt_id is distinct from p_expected_owner_attempt_id then
     raise exception using errcode='P0001',message='checkpoint_conflict';
   end if;
   if p_stream='recent' and p_operation<>'restart' then
     -- Known pre-policy generations were missing-only. Materialize only an
     -- absent field, never coalesce explicit null/invalid policy into permission.
     if jsonb_typeof(c.continuation) is distinct from 'object' then raise exception using errcode='P0001',message='invalid_legacy_policy'; end if;
     if not (c.continuation ? 'fetch_policy') then c.continuation:=c.continuation||jsonb_build_object('fetch_policy','missing_only'); end if;
     v_fetch_policy:=c.continuation->>'fetch_policy';
     if not coalesce(v_fetch_policy=any(array['missing_only','refetch_all']),false) or
       (v_fetch_policy='refetch_all' and not coalesce(
         (c.continuation->>'phase'='uninitialized' and c.continuation->>'intent'='reconcile') or
         (c.continuation->>'phase'='initialized' and c.continuation->>'mode'='reconcile'),false)) then
       raise exception using errcode='P0001',message='invalid_legacy_policy';
     end if;
   end if;
   case p_operation
   when 'claim' then
     if p_stream='recent' and exists_checkpoint and c.state<>'completed' and v_force and v_fetch_policy<>'refetch_all' then
       raise exception using errcode='P0001',message='force_generation_busy';
     end if;
     if not exists_checkpoint and c.state in ('completed','blocked') then
       terminal:=true; done:=c.state='completed'; attempt_status:=case when done then 'success' else 'failed' end;
       error_code:=case when done then null else c.block_code end;
     elsif p_stream='historical' and c.state='completed' then
       if p_payload->'recovery'<>'null'::jsonb then raise exception using errcode='P0001',message='invalid_recovery_state'; end if;
       changed:=false; done:=true; terminal:=true; attempt_status:='success';
     else
       if c.state='blocked' then
         if p_payload->'recovery'='null'::jsonb or c.block_code in ('history_expired','continuation_expired') then
           raise exception using errcode='P0001',message='explicit_recovery_required';
         end if;
       elsif p_payload->'recovery'<>'null'::jsonb then raise exception using errcode='P0001',message='invalid_recovery_state';
       elsif c.state<>'ready' and not(p_stream='recent' and c.state='completed') then raise exception using errcode='P0001',message='already_claimed'; end if;
       if p_stream='recent' and c.state='completed' then
         c.generation:=gen_random_uuid(); c.continuation:=jsonb_build_object('version',2,'phase','uninitialized',
           'intent',case when v_force then 'reconcile' else 'normal' end,
           'fetch_policy',case when v_force then 'refetch_all' else 'missing_only' end);
       end if;
       c.state:='claimed'; c.owner_attempt_id:=p_attempt_id; c.block_code:=null;
       if p_stream='historical' then
         update public.email_accounts set backfill_status='running',backfill_error=null,
           backfill_started_at=case when backfill_status='idle' and backfill_started_at is null then now() else backfill_started_at end
           where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if;
       end if;
     end if;
   when 'takeover' then
     if c.state<>'claimed' or c.owner_attempt_id=p_attempt_id then raise exception using errcode='P0001',message='invalid_recovery_state'; end if;
     c.owner_attempt_id:=p_attempt_id;
     if p_stream='historical' then update public.email_accounts set backfill_status='running',backfill_error=null where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
   when 'restart' then
     c.generation:=gen_random_uuid(); c.state:='claimed'; c.owner_attempt_id:=p_attempt_id; c.block_code:=null;
     if p_stream='recent' then c.continuation:=jsonb_build_object('version',2,'phase','uninitialized','intent','reconcile',
       'fetch_policy',coalesce(p_payload->>'fetch_policy','missing_only'));
     else update public.email_accounts set backfill_status='running',backfill_page_token=null,backfill_total_fetched=0,
       backfill_started_at=now(),backfill_completed_at=null,backfill_error=null where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
   else
     if c.state<>'claimed' or c.owner_attempt_id is distinct from p_attempt_id then raise exception using errcode='P0001',message='not_owner'; end if;
     case p_operation
     when 'initialize_traversal' then
       if c.continuation->>'phase' is distinct from 'uninitialized' then raise exception using errcode='P0001',message='already_initialized'; end if;
       current_cursor:=a.history_id;
       if current_cursor is not null then
         if current_cursor!~'^(0|[1-9][0-9]{0,19})$' then raise exception using errcode='P0001',message='invalid_legacy_cursor'; end if;
         if current_cursor::numeric>18446744073709551615 or (p_payload->>'captured_history_id')::numeric<current_cursor::numeric then raise exception using errcode='P0001',message='boundary_regression'; end if;
       end if;
       mode:=case when c.continuation->>'intent'='normal' and current_cursor is not null then 'history' else 'reconcile' end;
       c.continuation:=jsonb_build_object('version',2,'phase','initialized','mode',mode,'origin_history_id',current_cursor,
         'fetch_policy',c.continuation->>'fetch_policy',
         'captured_history_id',p_payload->>'captured_history_id','captured_at',p_payload->>'captured_at',
         'page_size',p_payload->'page_size','query',null,'labels',jsonb_build_array('INBOX','SENT'),
         'labels_state',jsonb_build_object('INBOX',jsonb_build_object('next_page_token',null,'complete',false),
           'SENT',jsonb_build_object('next_page_token',null,'complete',false)));
     when 'checkpoint' then
       next_token:=p_payload->>'returned_next_page_token'; evidence:=p_payload->'page_evidence';
       if p_stream='recent' then
         label:=p_payload->>'label'; input_token:=p_payload->>'expected_input_page_token';
         if c.continuation->>'phase' is distinct from 'initialized' then raise exception using errcode='P0001',message='not_initialized'; end if;
         if c.continuation#>>array['labels_state',label,'complete'] is distinct from 'false' or
           c.continuation#>>array['labels_state',label,'next_page_token'] is distinct from input_token then raise exception using errcode='P0001',message='page_conflict'; end if;
         if a.history_id is distinct from c.continuation->>'origin_history_id' then raise exception using errcode='P0001',message='cursor_conflict'; end if;
       else
         label:=null; input_token:=p_payload->>'expected_page_token';
         if a.backfill_status<>'running' or a.backfill_page_token is distinct from input_token or a.backfill_total_fetched<>(p_payload->>'expected_total')::integer then raise exception using errcode='P0001',message='page_conflict'; end if;
       end if;
       if next_token is not null and (next_token is not distinct from input_token or exists(
         select 1 from public.email_ingestion_transitions t where t.tenant_id=p_tenant_id and t.email_account_id=p_email_account_id
           and t.stream=p_stream and t.result_generation=c.generation and t.operation='checkpoint'
           and (t.request_document->'payload'->>'label') is not distinct from label
           and ((md5(coalesce(t.request_document->'payload'->>'expected_input_page_token',t.request_document->'payload'->>'expected_page_token'))=md5(next_token)
             and coalesce(t.request_document->'payload'->>'expected_input_page_token',t.request_document->'payload'->>'expected_page_token')=next_token)
           or (md5(t.request_document->'payload'->>'returned_next_page_token')=md5(next_token) and t.request_document->'payload'->>'returned_next_page_token'=next_token))
       )) then raise exception using errcode='P0001',message='pagination_no_progress'; end if;
       if p_stream='recent' then
         c.continuation:=jsonb_set(c.continuation,array['labels_state',label],jsonb_build_object('next_page_token',next_token,'complete',(p_payload->>'exhausted')::boolean));
         done:=(c.continuation#>>'{labels_state,INBOX,complete}')::boolean and (c.continuation#>>'{labels_state,SENT,complete}')::boolean;
         if done then update public.email_accounts set history_id=c.continuation->>'captured_history_id' where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
       else
         new_total:=a.backfill_total_fetched::bigint+(p_payload->>'listed_count')::bigint;
         if new_total>2147483647 then raise exception using errcode='P0001',message='total_overflow'; end if;
         done:=(p_payload->>'exhausted')::boolean;
         update public.email_accounts set backfill_page_token=next_token,backfill_total_fetched=new_total::integer,
           backfill_status=case when done then 'completed' else 'running' end,
           backfill_completed_at=case when done then now() else null end,backfill_error=null
           where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if;
       end if;
       new_total:=records::bigint+(evidence->>'message_upsert_count')::bigint;
       if new_total>2147483647 then raise exception using errcode='P0001',message='total_overflow'; end if;
       records:=new_total::integer;
       if done or (p_payload->>'yield_after_page')::boolean then
         c.state:=case when done then 'completed' else 'ready' end; c.owner_attempt_id:=null; terminal:=true; attempt_status:='success';
       end if;
     when 'release' then
       c.state:='ready'; c.owner_attempt_id:=null; terminal:=true; attempt_status:='success'; evidence:=p_payload->'attempt_evidence';
     when 'block' then
       c.state:='blocked'; c.owner_attempt_id:=null; c.block_code:=p_payload->>'error_code';
       terminal:=true; attempt_status:='failed'; error_code:=c.block_code; evidence:=p_payload->'attempt_evidence';
       if p_stream='historical' then update public.email_accounts set backfill_status='error',backfill_error=c.block_code where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
     else raise exception using errcode='22023',message='invalid_operation';
     end case;
   end case;
 end if;
 if changed then
   if c.revision=9223372036854775807 then raise exception using errcode='P0001',message='revision_exhausted'; end if;
   c.revision:=c.revision+1; c.updated_at:=now();
   if not exists_checkpoint then
     insert into public.email_ingestion_checkpoints(tenant_id,email_account_id,stream,contract_version,generation,revision,state,owner_attempt_id,continuation,block_code,created_at,updated_at)
     values(c.tenant_id,c.email_account_id,c.stream,c.contract_version,c.generation,c.revision,c.state,c.owner_attempt_id,c.continuation,c.block_code,c.created_at,c.updated_at);
   else
     update public.email_ingestion_checkpoints set generation=c.generation,revision=c.revision,state=c.state,
       owner_attempt_id=c.owner_attempt_id,continuation=c.continuation,block_code=c.block_code,updated_at=c.updated_at
       where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream;
     if not found then raise exception 'checkpoint update affected no row'; end if;
   end if;
 end if;
 if p_operation in ('block','release','finish_attempt') then
   -- These counts are attempt-wide known totals; NULL never overwrites with zero.
   confirmed_count:=(evidence->>'message_upsert_count')::integer;
   if confirmed_count is not null then
     if confirmed_count<records then raise exception using errcode='22023',message='count_regression'; end if;
     records:=confirmed_count;
   end if;
 end if;
 result:=jsonb_build_object('operation',p_operation,'attempt_id',p_attempt_id,'tenant_id',p_tenant_id,'email_account_id',p_email_account_id,'stream',p_stream,
   'checkpoint_present',c.tenant_id is not null,'generation',c.generation,'revision',c.revision::text,
   'checkpoint_state',c.state,'owner_attempt_id',c.owner_attempt_id,'attempt_status',attempt_status,
   'records_processed',records,'coverage_complete',done);
 insert into public.email_ingestion_transitions(tenant_id,email_account_id,stream,transition_id,operation,attempt_id,
   expected_generation,expected_revision,expected_owner_attempt_id,request_document,request_fingerprint,accepted_result,checkpoint_stream,result_generation,result_revision)
 values(p_tenant_id,p_email_account_id,p_stream,p_transition_id,p_operation,p_attempt_id,p_expected_generation,p_expected_revision,
   p_expected_owner_attempt_id,doc,md5(doc::text),result,case when c.tenant_id is not null then p_stream else null end,c.generation,c.revision);
 v_attempt_metadata:=attempt.metadata||jsonb_build_object('email_ingestion_v2',jsonb_build_object('contract_version',2,'stream',p_stream,
   'transition_id',p_transition_id,'operation',p_operation,'checkpoint_present',c.tenant_id is not null,'generation',c.generation,'revision',c.revision::text,
   'coverage_complete',done,'continuation_pending',c.state<>'completed','evidence',evidence,
   'classification',case when p_operation='finish_attempt' then p_payload->>'outcome' else null end));
 update public.email_sync_runs as target_run set status=attempt_status,completed_at=case when terminal then now() else null end,
   records_processed=records,error_message=error_code,metadata=v_attempt_metadata
   where target_run.id=p_attempt_id and target_run.tenant_id=p_tenant_id and target_run.status='running';
 if not found then raise exception 'attempt update disappeared'; end if;
 return jsonb_build_object('contract_version',2,'disposition','applied','code','transition_applied','transition_id',p_transition_id,
   'accepted_result',result,'current_checkpoint',public.email_ingestion_checkpoint_json_v2(c),'historical_receipt',false);
exception
 when invalid_parameter_value or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
   return jsonb_build_object('contract_version',2,'disposition','denied','code','invalid_request','transition_id',p_transition_id,'accepted_result',null,'current_checkpoint',null,'historical_receipt',false);
 when sqlstate 'P0001' then
   code:=sqlerrm;
   if code<>all(array['account_not_found','attempt_mismatch','transition_id_reused','attempt_terminal','source_ineligible','owner_must_release',
     'checkpoint_missing','legacy_state_invalid','checkpoint_conflict','invalid_recovery_state','explicit_recovery_required','already_claimed',
     'not_owner','already_initialized','invalid_legacy_cursor','boundary_regression','not_initialized','page_conflict','cursor_conflict',
     'pagination_no_progress','total_overflow','revision_exhausted','force_generation_busy','invalid_legacy_policy']) then raise; end if;
   -- Exception subtransaction rolled back ALL writes; never return staged c as current.
   return jsonb_build_object('contract_version',2,'disposition',case when code in ('account_not_found','attempt_mismatch','transition_id_reused','source_ineligible') then 'denied' else 'conflict' end,
     'code',code,'transition_id',p_transition_id,'accepted_result',null,'current_checkpoint',null,'historical_receipt',false);
end $function$
;
alter function public."email_ingestion_transition_v2"(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid, p_operation text, p_expected_generation uuid, p_expected_revision bigint, p_expected_owner_attempt_id uuid, p_payload jsonb) owner to "email_ingestion_protocol_owner";
revoke all on function public."email_ingestion_transition_v2"(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid, p_operation text, p_expected_generation uuid, p_expected_revision bigint, p_expected_owner_attempt_id uuid, p_payload jsonb) from public,anon,authenticated,service_role;
grant execute on function public."email_ingestion_transition_v2"(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid, p_operation text, p_expected_generation uuid, p_expected_revision bigint, p_expected_owner_attempt_id uuid, p_payload jsonb) to "service_role";
CREATE OR REPLACE FUNCTION public.platform_jobs_complete_email_v1(p_job_id uuid, p_tenant_id uuid, p_claimed_by text, p_attempt_count integer, p_document jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
 j public.platform_jobs%rowtype; run_row public.email_sync_runs%rowtype;
 successor public.platform_jobs%rowtype; receipt jsonb; result_doc jsonb;
 ingestion jsonb; continuation jsonb; expected_payload jsonb;
 account_id uuid; run_id uuid; successor_id uuid; expected_sync text;
 expected_stream text; expected_connector text; expected_priority integer;
 processed integer; affected integer;
BEGIN
 IF current_user <> 'service_role' THEN
  RAISE EXCEPTION USING errcode='42501',message='queue_completion_forbidden';
 END IF;
 IF p_job_id IS NULL OR p_tenant_id IS NULL OR p_claimed_by IS NULL OR
    p_claimed_by='' OR p_attempt_count IS NULL OR p_attempt_count<1 OR
    jsonb_typeof(p_document) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING errcode='22023',message='queue_completion_invalid';
 END IF;
 IF NOT p_document ?& ARRAY['result','records_processed','continuation'] OR
    (SELECT count(*) FROM jsonb_object_keys(p_document))<>3 OR
    jsonb_typeof(p_document->'result') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING errcode='22023',message='queue_completion_invalid';
 END IF;
 SELECT * INTO j FROM public.platform_jobs WHERE id=p_job_id AND tenant_id=p_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='P0001',message='queue_completion_not_owned'; END IF;
 receipt:=j.metadata->'email_queue_completion_v1';
 IF j.status='succeeded' THEN
  IF j.claimed_by=p_claimed_by AND j.attempt_count=p_attempt_count AND
     jsonb_typeof(receipt)='object' AND receipt->>'version'='1' AND
     receipt->>'claimed_by'=p_claimed_by AND
     receipt->>'attempt_count'=p_attempt_count::text AND
     receipt->'document'=p_document THEN
   RETURN jsonb_build_object('version',1,'disposition','replayed','job_id',j.id,
     'successor_id',receipt->'successor_id');
  END IF;
  RAISE EXCEPTION USING errcode='P0001',message='queue_completion_replay_conflict';
 END IF;
 IF j.status<>'running' OR j.claimed_by IS DISTINCT FROM p_claimed_by OR
    j.attempt_count<>p_attempt_count OR j.lease_expires_at IS NULL OR
    j.lease_expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION USING errcode='P0001',message='queue_completion_not_owned';
 END IF;
 IF j.job_type NOT IN ('email.gmail_sync','email.workspace_sync','email.workspace_backfill') OR
    jsonb_typeof(j.payload) IS DISTINCT FROM 'object' OR
    jsonb_typeof(j.payload->'email_account_id') IS DISTINCT FROM 'string' OR
    jsonb_typeof(j.metadata) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING errcode='22023',message='queue_completion_invalid';
 END IF;
 account_id:=(j.payload->>'email_account_id')::uuid;
 IF j.job_key IS DISTINCT FROM j.job_type||':'||(j.payload->>'email_account_id') THEN
  RAISE EXCEPTION USING errcode='22023',message='queue_completion_identity';
 END IF;
 expected_sync:=CASE j.job_type WHEN 'email.gmail_sync' THEN 'messages'
  WHEN 'email.workspace_sync' THEN 'workspace_messages' ELSE 'workspace_backfill' END;
 expected_stream:=CASE WHEN j.job_type='email.workspace_backfill' THEN 'historical' ELSE 'recent' END;
 expected_connector:=CASE WHEN j.job_type='email.gmail_sync' THEN 'gmail' ELSE 'google-workspace' END;
 expected_priority:=CASE WHEN j.job_type='email.workspace_backfill' THEN 200 ELSE 100 END;
 result_doc:=p_document->'result'; ingestion:=result_doc->'ingestion';
 IF jsonb_typeof(ingestion) IS DISTINCT FROM 'object' OR ingestion->'success' IS DISTINCT FROM 'true'::jsonb OR
    ingestion->>'stream' IS DISTINCT FROM expected_stream OR
    (ingestion->>'email_account_id')::uuid IS DISTINCT FROM account_id OR
    jsonb_typeof(result_doc->'sync_run_id') IS DISTINCT FROM 'string' OR
    result_doc->>'sync_run_id' IS DISTINCT FROM ingestion->>'sync_run_id' THEN
  RAISE EXCEPTION USING errcode='22023',message='queue_completion_identity';
 END IF;
 run_id:=(result_doc->>'sync_run_id')::uuid;
 PERFORM 1 FROM public.email_accounts WHERE id=account_id AND tenant_id=j.tenant_id AND provider='gmail' FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='22023',message='queue_completion_identity'; END IF;
 SELECT * INTO run_row FROM public.email_sync_runs WHERE id=run_id AND tenant_id=j.tenant_id
  AND provider='gmail' AND sync_type=expected_sync AND status='success' AND completed_at IS NOT NULL
  AND (metadata->>'email_account_id')::uuid=account_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='22023',message='queue_completion_identity'; END IF;
 -- Worker counts are invocation-local; historical receipts retain the run's cumulative count.
 IF jsonb_typeof(p_document->'records_processed') IS DISTINCT FROM 'number' OR
    jsonb_typeof(ingestion->'records_processed') IS DISTINCT FROM 'number' OR
    jsonb_typeof(ingestion->'invocation_records_processed') IS DISTINCT FROM 'number' OR
    ingestion->'historical_receipt' NOT IN ('true'::jsonb,'false'::jsonb) OR
    ingestion->'historical_receipt' IS NULL THEN
  RAISE EXCEPTION USING errcode='22023',message='queue_completion_invalid';
 END IF;
 processed:=(p_document->>'records_processed')::integer;
 IF processed<0 OR (ingestion->>'records_processed')::integer<>run_row.records_processed OR
    processed<>(ingestion->>'invocation_records_processed')::integer THEN
  RAISE EXCEPTION USING errcode='22023',message='queue_completion_identity';
 END IF;
 IF ingestion->'historical_receipt'='true'::jsonb THEN
  IF processed<>0 OR ingestion->'threads_processed' IS DISTINCT FROM 'null'::jsonb OR
     ingestion->>'retry_action' IS DISTINCT FROM 'none' OR
     ingestion->>'persistence_certainty' IS DISTINCT FROM 'confirmed' OR
     ingestion->>'checkpoint_certainty' IS DISTINCT FROM 'confirmed' OR
     p_document->'continuation' IS DISTINCT FROM 'null'::jsonb THEN
   RAISE EXCEPTION USING errcode='22023',message='queue_completion_identity';
  END IF;
 ELSIF processed<>run_row.records_processed THEN
  RAISE EXCEPTION USING errcode='22023',message='queue_completion_identity';
 END IF;
 continuation:=p_document->'continuation';
 IF continuation<>'null'::jsonb THEN
  expected_payload:=jsonb_build_object('email_account_id',j.payload->'email_account_id')||
    CASE WHEN j.payload ? 'max_results' THEN jsonb_build_object('max_results',j.payload->'max_results') ELSE '{}'::jsonb END;
  IF jsonb_typeof(continuation) IS DISTINCT FROM 'object' OR
     ingestion->>'retry_action' IS DISTINCT FROM 'continue' OR
     ingestion->'historical_receipt' IS DISTINCT FROM 'false'::jsonb OR
     continuation IS DISTINCT FROM jsonb_build_object('job_type',j.job_type,'job_key',j.job_key,
       'connector_id',expected_connector,'module_id','communications.email',
       'priority',expected_priority,'payload',expected_payload) THEN
   RAISE EXCEPTION USING errcode='22023',message='queue_completion_identity';
  END IF;
 ELSIF ingestion->>'retry_action'='continue' THEN
  RAISE EXCEPTION USING errcode='22023',message='queue_completion_identity';
 END IF;
 UPDATE public.platform_jobs SET status='succeeded',completed_at=clock_timestamp(),lease_expires_at=NULL,
  error_code=NULL,result=result_doc,records_processed=coalesce(processed,j.records_processed) WHERE id=j.id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'queue_completion_disappeared'; END IF;
 IF continuation<>'null'::jsonb THEN
  INSERT INTO public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,
    max_attempts,available_at,payload)
  VALUES(j.tenant_id,expected_connector,'communications.email',j.job_type,j.job_key,'queued',expected_priority,
    5,clock_timestamp(),expected_payload)
  ON CONFLICT (tenant_id,job_key) WHERE job_key IS NOT NULL AND status IN ('queued','running','retrying')
  DO NOTHING RETURNING id INTO successor_id;
  IF successor_id IS NULL THEN
   SELECT * INTO successor FROM public.platform_jobs WHERE tenant_id=j.tenant_id AND job_key=j.job_key
    AND status IN ('queued','running','retrying') FOR UPDATE;
   IF NOT FOUND OR successor.job_type<>j.job_type OR successor.payload IS DISTINCT FROM expected_payload OR
      successor.connector_id IS DISTINCT FROM expected_connector OR
      successor.module_id IS DISTINCT FROM 'communications.email' OR successor.priority<>expected_priority THEN
    RAISE EXCEPTION USING errcode='P0001',message='queue_completion_successor_conflict';
   END IF;
   successor_id:=successor.id;
  END IF;
 END IF;
 IF j.lease_expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION USING errcode='P0001',message='queue_completion_not_owned';
 END IF;
 receipt:=jsonb_build_object('version',1,'claimed_by',p_claimed_by,'attempt_count',p_attempt_count,
  'document',p_document,'successor_id',successor_id);
 UPDATE public.platform_jobs SET metadata=metadata||jsonb_build_object('email_queue_completion_v1',receipt) WHERE id=j.id;
 RETURN jsonb_build_object('version',1,'disposition','applied','job_id',j.id,'successor_id',successor_id);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION USING errcode='22023',message='queue_completion_invalid';
END $function$
;
alter function public."platform_jobs_complete_email_v1"(p_job_id uuid, p_tenant_id uuid, p_claimed_by text, p_attempt_count integer, p_document jsonb) owner to "postgres";
revoke all on function public."platform_jobs_complete_email_v1"(p_job_id uuid, p_tenant_id uuid, p_claimed_by text, p_attempt_count integer, p_document jsonb) from public,anon,authenticated,service_role;
grant execute on function public."platform_jobs_complete_email_v1"(p_job_id uuid, p_tenant_id uuid, p_claimed_by text, p_attempt_count integer, p_document jsonb) to "service_role";
CREATE TRIGGER email_ingestion_account_guard_v2 BEFORE INSERT OR UPDATE ON public.email_accounts FOR EACH ROW EXECUTE FUNCTION email_ingestion_account_guard_v2();
CREATE TRIGGER email_ingestion_run_guard_v2 BEFORE INSERT OR DELETE OR UPDATE ON public.email_sync_runs FOR EACH ROW EXECUTE FUNCTION email_ingestion_run_guard_v2();
-- INPUT supabase/migrations/20261031233000_learn_email_transition_outbox.sql
-- Durable requests for the existing v2 email ingestion protocol. No provider
-- calls, source edits, credentials, switches or schedules are seeded.

create table public.learn_email_transition_requests (
 id uuid primary key,tenant_id uuid not null,email_account_id uuid not null,
 stream text not null check(stream in ('recent','historical')),attempt_id uuid not null,
 document jsonb not null check(jsonb_typeof(document)='object'),
 check(document @> jsonb_build_object('transitionId',id,'tenantId',tenant_id,'accountId',email_account_id,'stream',stream,'attemptId',attempt_id)),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,email_account_id) references public.email_accounts(tenant_id,id) on delete restrict,
 foreign key(tenant_id,attempt_id) references public.email_sync_runs(tenant_id,id) on delete restrict
);
create index learn_email_transition_attempt on public.learn_email_transition_requests(tenant_id,email_account_id,stream,attempt_id,created_at,id);
create table public.learn_email_transition_settlements (
 request_id uuid primary key references public.learn_email_transition_requests(id) on delete restrict,
 result jsonb not null check(jsonb_typeof(result)='object'),
 check(result @> jsonb_build_object('contract_version',2,'transition_id',request_id)),
 check((result->>'disposition'=any(array['applied','replayed','conflict','denied'])) is true),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_email_transition_requests enable row level security;
alter table public.learn_email_transition_settlements enable row level security;
revoke all on public.learn_email_transition_requests,public.learn_email_transition_settlements from public,anon,authenticated,service_role;
grant select,insert on public.learn_email_transition_requests,public.learn_email_transition_settlements to service_role;
create function public.learn_email_transition_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 raise exception 'learn_email_transition_immutable' using errcode='42501';end $$;
revoke all on function public.learn_email_transition_immutable() from public,anon,authenticated,service_role;
create trigger learn_email_request_immutable before update or delete on public.learn_email_transition_requests
 for each row execute function public.learn_email_transition_immutable();
create trigger learn_email_settlement_immutable before update or delete on public.learn_email_transition_settlements
 for each row execute function public.learn_email_transition_immutable();

create function public.learn_email_transition_prepare(p_document jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare tenant uuid;account uuid;attempt uuid;request uuid;stream text;prior public.learn_email_transition_requests%rowtype;run public.email_sync_runs%rowtype; k text;
begin
 if current_user<>'service_role' then raise exception 'learn_email_outbox_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>65536
  or not p_document ?& array['tenantId','accountId','attemptId','stream','transitionId','operation','expectedGeneration','expectedRevision','expectedOwner','payload']
  or (p_document-array['tenantId','accountId','attemptId','stream','transitionId','operation','expectedGeneration','expectedRevision','expectedOwner','payload'])<>'{}'::jsonb then
  raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 foreach k in array array['tenantId','accountId','attemptId','transitionId'] loop
  if jsonb_typeof(p_document->k) is distinct from 'string' or not coalesce(p_document->>k~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false) then
   raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 end loop;
 foreach k in array array['expectedGeneration','expectedOwner'] loop
  if p_document->k<>'null'::jsonb and (jsonb_typeof(p_document->k) is distinct from 'string' or not coalesce(p_document->>k~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false)) then
   raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 end loop;
 if p_document->'expectedRevision'<>'null'::jsonb then
  if jsonb_typeof(p_document->'expectedRevision') is distinct from 'string' or not coalesce(p_document->>'expectedRevision'~'^(0|[1-9][0-9]{0,18})$',false) then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
  if (p_document->>'expectedRevision')::numeric>9223372036854775807 then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 end if;
 if (p_document->'expectedGeneration'='null'::jsonb) is distinct from (p_document->'expectedRevision'='null'::jsonb)
  or (p_document->'expectedGeneration'='null'::jsonb and p_document->'expectedOwner'<>'null'::jsonb)
  or jsonb_typeof(p_document->'payload') is distinct from 'object'
  or not coalesce(p_document->>'stream'=any(array['recent','historical']),false)
  or not coalesce(p_document->>'operation'=any(array['claim','initialize_traversal','checkpoint','release','block','finish_attempt','takeover','restart']),false) then
   raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 tenant:=(p_document->>'tenantId')::uuid;account:=(p_document->>'accountId')::uuid;
 attempt:=(p_document->>'attemptId')::uuid;request:=(p_document->>'transitionId')::uuid;stream:=p_document->>'stream';
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||attempt::text,0));
 select * into prior from public.learn_email_transition_requests where id=request;
 if found then
  if prior.document<>p_document then raise exception 'learn_email_outbox_request_changed' using errcode='PT409';end if;
  return prior.document;
 end if;
 select * into run from public.email_sync_runs where tenant_id=tenant and id=attempt;
 if not found or run.provider<>'gmail' or run.status<>'running' or jsonb_typeof(run.metadata->'email_account_id') is distinct from 'string'
  or not coalesce(run.metadata->>'email_account_id'~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false) then
  raise exception 'learn_email_outbox_attempt_mismatch' using errcode='42501';end if;
 if (run.metadata->>'email_account_id')::uuid<>account
  or (stream='recent' and run.sync_type not in ('messages','workspace_messages')) or (stream='historical' and run.sync_type<>'workspace_backfill') then
  raise exception 'learn_email_outbox_attempt_mismatch' using errcode='42501';end if;
 if exists(select 1 from public.learn_email_transition_requests r where r.attempt_id=attempt and not exists(select 1 from public.learn_email_transition_settlements s where s.request_id=r.id)) then
  raise exception 'learn_email_outbox_pending_request' using errcode='PT409';end if;
 insert into public.learn_email_transition_requests(id,tenant_id,email_account_id,stream,attempt_id,document) values(request,tenant,account,stream,attempt,p_document);
 return p_document;
end $$;

create function public.learn_email_transition_pending(p_tenant uuid,p_account uuid,p_stream text,p_attempt uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare answer jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_email_outbox_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_attempt is null or p_stream is null or p_stream not in ('recent','historical') then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||p_attempt::text,0));
 select r.document into answer from public.learn_email_transition_requests r
 where r.tenant_id=p_tenant and r.email_account_id=p_account and r.stream=p_stream and r.attempt_id=p_attempt
 and not exists(select 1 from public.learn_email_transition_settlements s where s.request_id=r.id) order by r.created_at,r.id limit 1;
 return answer;
end $$;

create function public.learn_email_transition_apply(p_tenant uuid,p_account uuid,p_stream text,p_attempt uuid,p_request uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare r public.learn_email_transition_requests%rowtype; prior jsonb;answer jsonb;d jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_email_outbox_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_attempt is null or p_request is null or p_stream is null or p_stream not in ('recent','historical') then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||p_attempt::text,0));
 select * into r from public.learn_email_transition_requests where id=p_request and tenant_id=p_tenant and email_account_id=p_account and stream=p_stream and attempt_id=p_attempt;
 if not found then raise exception 'learn_email_outbox_request_missing' using errcode='42501';end if;
 select result into prior from public.learn_email_transition_settlements where request_id=r.id;
 -- A refused request has a final decision. It cannot apply later simply because
 -- account eligibility or checkpoint state changes; a new reviewed request is needed.
 if found and prior->>'disposition' in ('conflict','denied') then return prior;end if;
 d:=r.document;
 answer:=public.email_ingestion_transition_v2(r.tenant_id,r.email_account_id,r.stream,r.attempt_id,r.id,
  d->>'operation',(d->>'expectedGeneration')::uuid,(d->>'expectedRevision')::bigint,(d->>'expectedOwner')::uuid,d->'payload');
 if prior is null then
  insert into public.learn_email_transition_settlements(request_id,result) values(r.id,answer);
 end if;
 -- Replaying the protocol reads today's checkpoint alongside its historical
 -- receipt. Never return a cached successful response as current ownership.
 return answer;
end $$;
revoke all on function public.learn_email_transition_prepare(jsonb),public.learn_email_transition_pending(uuid,uuid,text,uuid),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_transition_prepare(jsonb),public.learn_email_transition_pending(uuid,uuid,text,uuid),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid) to service_role;

-- INPUT supabase/migrations/20261031234500_learn_email_job_attempts.sql
-- One durable email sync attempt per queue job, independent of worker leases.
-- Replacements recover the same attempt; only the current lease may submit work.

create table public.learn_email_job_attempts (
 job_id uuid primary key references public.platform_jobs(id) on delete restrict,
 tenant_id uuid not null,email_account_id uuid not null,attempt_id uuid not null unique,
 stream text not null check(stream in ('recent','historical')),
 sync_type text not null check(sync_type in ('messages','workspace_messages','workspace_backfill')),
 definition jsonb not null check(jsonb_typeof(definition)='object'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,email_account_id) references public.email_accounts(tenant_id,id) on delete restrict,
 foreign key(tenant_id,attempt_id) references public.email_sync_runs(tenant_id,id) on delete restrict
);
alter table public.learn_email_job_attempts enable row level security;
revoke all on public.learn_email_job_attempts from public,anon,authenticated,service_role;
grant select,insert on public.learn_email_job_attempts to service_role;
create trigger learn_email_job_attempt_immutable before update or delete on public.learn_email_job_attempts
 for each row execute function public.learn_email_transition_immutable();

create function public.learn_email_job_attempt(p_tenant uuid,p_job uuid,p_claimed_by text,p_claim integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;b public.learn_email_job_attempts%rowtype;run public.email_sync_runs%rowtype;
 account uuid;kind text;stream_name text;definition jsonb;recovered boolean;begin
 if current_user<>'service_role' then raise exception 'learn_email_job_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or nullif(p_claimed_by,'') is null or p_claim is null or p_claim<1 then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_claim
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 if j.job_type not in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill')
  or jsonb_typeof(j.payload) is distinct from 'object' or octet_length(j.payload::text)>4000
  or jsonb_typeof(j.payload->'email_account_id') is distinct from 'string'
  or not coalesce(j.payload->>'email_account_id'~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false)
  or (j.payload-array['email_account_id','max_results','force','restart'])<>'{}'::jsonb then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 if j.payload ? 'max_results' then
  if jsonb_typeof(j.payload->'max_results') is distinct from 'number' or not coalesce(j.payload->>'max_results'~'^[0-9]{1,3}$',false) then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
  if (j.payload->>'max_results')::integer not between 1 and 500 then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 end if;
 if (j.payload ? 'force' and jsonb_typeof(j.payload->'force') is distinct from 'boolean')
  or (j.payload ? 'restart' and jsonb_typeof(j.payload->'restart') is distinct from 'boolean') then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 account:=(j.payload->>'email_account_id')::uuid;
 if j.job_key is distinct from j.job_type||':'||(j.payload->>'email_account_id') then raise exception 'learn_email_job_identity' using errcode='22023';end if;
 perform 1 from public.email_accounts where id=account and tenant_id=p_tenant and provider='gmail';
 if not found then raise exception 'learn_email_job_identity' using errcode='42501';end if;
 kind:=case j.job_type when 'email.gmail_sync' then 'messages' when 'email.workspace_sync' then 'workspace_messages' else 'workspace_backfill' end;
 stream_name:=case when j.job_type='email.workspace_backfill' then 'historical' else 'recent' end;
 definition:=jsonb_build_object('job_type',j.job_type,'job_key',j.job_key,'payload',j.payload,'connector_id',j.connector_id,'module_id',j.module_id);
 select * into b from public.learn_email_job_attempts where job_id=j.id;
 recovered:=found;
 if recovered then
  if b.tenant_id<>p_tenant or b.email_account_id<>account or b.stream<>stream_name or b.sync_type<>kind or b.definition<>definition then raise exception 'learn_email_job_definition_changed' using errcode='PT409';end if;
 else
  b.attempt_id:=gen_random_uuid();
  insert into public.email_sync_runs(id,tenant_id,provider,sync_type,status,metadata)
   values(b.attempt_id,p_tenant,'gmail',kind,'running',jsonb_build_object('email_account_id',account,'learn_email_job_id',j.id));
  insert into public.learn_email_job_attempts(job_id,tenant_id,email_account_id,attempt_id,stream,sync_type,definition)
   values(j.id,p_tenant,account,b.attempt_id,stream_name,kind,definition);
 end if;
 select * into run from public.email_sync_runs where id=b.attempt_id and tenant_id=p_tenant;
 if not found or run.provider<>'gmail' or run.sync_type<>kind or run.status not in ('running','success','failed')
  or (run.metadata->>'email_account_id')::uuid is distinct from account then raise exception 'learn_email_job_attempt_mismatch' using errcode='PT409';end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 return jsonb_build_object('version','learn-email-job-attempt/1','tenant_id',p_tenant,'job_id',j.id,'email_account_id',account,
  'attempt_id',b.attempt_id,'stream',stream_name,'sync_type',kind,'status',run.status,'records_processed',run.records_processed,
  'recovered',recovered,'claimed_by',p_claimed_by,'claim',p_claim,'lease_expires_at',j.lease_expires_at,'payload',j.payload);
end $$;

-- Job lock precedes the outbox attempt lock and the protocol's account/run locks.
-- Standalone attempts retain their original server-only behavior.
create function public.learn_email_attempt_lease(p_attempt uuid,p_claimed_by text,p_claim integer) returns void
language plpgsql security invoker set search_path=pg_catalog as $$declare j public.platform_jobs%rowtype;b public.learn_email_job_attempts%rowtype;begin
 if current_user<>'service_role' then raise exception 'learn_email_job_forbidden' using errcode='42501';end if;
 select * into b from public.learn_email_job_attempts where attempt_id=p_attempt;
 if not found then
  if p_claimed_by is not null or p_claim is not null then raise exception 'learn_email_job_binding_missing' using errcode='PT409';end if;
  return;
 end if;
 select * into j from public.platform_jobs where id=b.job_id and tenant_id=b.tenant_id for update;
 if not found or j.status<>'running' or nullif(p_claimed_by,'') is null or p_claim is null
  or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_claim
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
  or b.definition is distinct from jsonb_build_object('job_type',j.job_type,'job_key',j.job_key,'payload',j.payload,'connector_id',j.connector_id,'module_id',j.module_id)
 then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
end $$;

-- Add lease arguments to the two outbox mutation APIs. Remove the old signatures
-- so job-bound callers cannot accidentally use an entrypoint without lease checks.
do $$declare d text;needle text;signature text;begin
 d:=pg_get_functiondef('public.learn_email_transition_prepare(jsonb)'::regprocedure);
 needle:='p_document jsonb)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_prepare_shape_changed';end if;
 d:=replace(d,needle,'p_document jsonb, p_claimed_by text DEFAULT NULL, p_claim integer DEFAULT NULL)');
 needle:='perform pg_advisory_xact_lock(hashtextextended(''learn-email-attempt:''||attempt::text,0));';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_prepare_lock_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 needle:='return p_document;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_prepare_return_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 drop function public.learn_email_transition_prepare(jsonb);
 execute d;
 d:=pg_get_functiondef('public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid)'::regprocedure);
 needle:='p_request uuid)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_apply_shape_changed';end if;
 d:=replace(d,needle,'p_request uuid, p_claimed_by text DEFAULT NULL, p_claim integer DEFAULT NULL)');
 needle:='perform pg_advisory_xact_lock(hashtextextended(''learn-email-attempt:''||p_attempt::text,0));';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_apply_lock_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(p_attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 -- A long-running transition that outlives its lease must roll back, not settle.
 needle:='return answer;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_apply_return_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(p_attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 drop function public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid);
 execute d;
end $$;
revoke all on function public.learn_email_job_attempt(uuid,uuid,text,integer),public.learn_email_attempt_lease(uuid,text,integer),public.learn_email_transition_prepare(jsonb,text,integer),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_job_attempt(uuid,uuid,text,integer),public.learn_email_attempt_lease(uuid,text,integer),public.learn_email_transition_prepare(jsonb,text,integer),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid,text,integer) to service_role;

-- INPUT supabase/migrations/20261031235500_learn_email_page_store.sql
-- Additive server-only page persistence. No cursor, run or queue completion writes.
-- Existing identities and source rows are retained. Requires the local job/outbox
-- migrations and the installed v2 ingestion protocol; not a standalone release.

create function public.learn_email_store_guard(p_context jsonb,p_claimed_by text,p_claim integer) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare a public.email_accounts%rowtype;r public.email_sync_runs%rowtype;c public.email_ingestion_checkpoints%rowtype;
 v_tenant uuid;v_account uuid;v_attempt uuid;v_generation uuid;v_revision bigint;v_stream text;
begin
 if current_user<>'service_role' then raise exception 'learn_email_store_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_context) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_context))<>8
  or not (p_context ?& array['tenant_id','email_account_id','attempt_id','stream','generation','revision','mailbox','fetch_policy'])
  or exists(select 1 from jsonb_each(p_context) e where jsonb_typeof(e.value)<>'string')
  or not coalesce(p_context->>'revision'~'^(0|[1-9][0-9]{0,18})$',false)
  or p_context->>'stream' not in ('recent','historical') or p_context->>'fetch_policy' not in ('missing_only','refetch_all')
  or nullif(btrim(p_context->>'mailbox'),'') is null
 then raise exception 'learn_email_store_context_invalid' using errcode='22023';end if;
 v_tenant:=(p_context->>'tenant_id')::uuid;v_account:=(p_context->>'email_account_id')::uuid;
 v_attempt:=(p_context->>'attempt_id')::uuid;v_generation:=(p_context->>'generation')::uuid;v_revision:=(p_context->>'revision')::bigint;v_stream:=p_context->>'stream';
 perform public.learn_email_attempt_lease(v_attempt,p_claimed_by,p_claim);
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||v_attempt::text,0));
 select * into a from public.email_accounts where id=v_account and tenant_id=v_tenant and provider='gmail' for update;
 if not found or lower(a.email_address) is distinct from lower(p_context->>'mailbox') then raise exception 'learn_email_store_account_mismatch' using errcode='PT409';end if;
 -- The account row serializes this read with all protocol transitions. The
 -- service role retains SELECT-only checkpoint access; no new progress privilege.
 select * into c from public.email_ingestion_checkpoints where tenant_id=v_tenant and email_account_id=v_account and email_ingestion_checkpoints.stream=v_stream;
 if not found or c.contract_version<>2 or c.state<>'claimed' or c.owner_attempt_id is distinct from v_attempt
  or c.generation is distinct from v_generation or c.revision is distinct from v_revision then raise exception 'learn_email_store_checkpoint_changed' using errcode='PT409';end if;
 select * into r from public.email_sync_runs where id=v_attempt and tenant_id=v_tenant for update;
 if not found or r.provider<>'gmail' or r.status<>'running' or (r.metadata->>'email_account_id')::uuid is distinct from v_account
  or (v_stream='historical' and r.sync_type<>'workspace_backfill') or (v_stream='recent' and r.sync_type not in ('messages','workspace_messages'))
 then raise exception 'learn_email_store_attempt_invalid' using errcode='PT409';end if;
 if not coalesce(case when r.sync_type='messages' then a.status='active' and a.auth_state in ('ok','unknown') else a.status in ('pending_tokenless_dwd','active_dwd') end,false)
 then raise exception 'learn_email_store_ineligible' using errcode='PT409';end if;
 if (v_stream='recent' and (c.continuation->>'phase' is distinct from 'initialized' or c.continuation->>'fetch_policy' is distinct from p_context->>'fetch_policy'))
  or (v_stream='historical' and p_context->>'fetch_policy'<>'missing_only') then raise exception 'learn_email_store_policy_changed' using errcode='PT409';end if;
end $$;

create function public.learn_email_store_existing(p_context jsonb,p_ids jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare result jsonb;begin
 perform public.learn_email_store_guard(p_context,p_claimed_by,p_claim);
 if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>2000
  or exists(select 1 from jsonb_array_elements(p_ids)e where jsonb_typeof(e)<>'string' or (not (e#>>'{}')~'^[a-zA-Z0-9_-]+$' or length(e#>>'{}')>256))
 then raise exception 'learn_email_store_ids_invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(provider_message_id order by provider_message_id),'[]') into result from public.email_messages
  where tenant_id=(p_context->>'tenant_id')::uuid and provider='gmail' and provider_message_id in (select jsonb_array_elements_text(p_ids));
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'existing_ids',result);
end $$;

create function public.learn_email_store_page(p_context jsonb,p_threads jsonb,p_messages jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare tenant uuid;thread_count integer;message_count integer;v jsonb;begin
 perform public.learn_email_store_guard(p_context,p_claimed_by,p_claim);
 tenant:=(p_context->>'tenant_id')::uuid;
 if jsonb_typeof(p_threads) is distinct from 'array' or jsonb_typeof(p_messages) is distinct from 'array'
  or jsonb_array_length(p_threads)>2000 or jsonb_array_length(p_messages)>2000
  or octet_length(p_threads::text)+octet_length(p_messages::text)>67108864
 then raise exception 'learn_email_store_rows_invalid' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_threads) loop
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>7
   or not(v ?& array['tenant_id','provider','provider_thread_id','subject','participants','last_message_at','updated_at'])
   or v->>'tenant_id' is distinct from tenant::text or v->>'provider' is distinct from 'gmail'
   or (not coalesce(v->>'provider_thread_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_thread_id')>256)
   or jsonb_typeof(v->'participants') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements(v->'participants')e where jsonb_typeof(e)<>'string')
   or jsonb_typeof(v->'subject') not in ('string','null') or jsonb_typeof(v->'last_message_at') is distinct from 'string'
  then raise exception 'learn_email_store_thread_invalid' using errcode='22023';end if;
 end loop;
 for v in select value from jsonb_array_elements(p_messages) loop
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>16
   or not(v ?& array['tenant_id','provider','provider_message_id','provider_thread_id','from_email','from_name','to_emails','cc_emails','subject','snippet','body_text','body_html','sent_at','received_at','direction','raw_payload'])
   or v->>'tenant_id' is distinct from tenant::text or v->>'provider' is distinct from 'gmail'
   or (not coalesce(v->>'provider_message_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_message_id')>256)
   or (not coalesce(v->>'provider_thread_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_thread_id')>256)
   or jsonb_typeof(v->'to_emails') is distinct from 'array' or jsonb_typeof(v->'cc_emails') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements((v->'to_emails')||(v->'cc_emails'))e where jsonb_typeof(e)<>'string')
   or jsonb_typeof(v->'raw_payload') is distinct from 'object' or jsonb_typeof(v->'direction') is distinct from 'string' or v->>'direction' not in ('inbound','outbound')
   or exists(select 1 from jsonb_each(v)e where e.key=any(array['from_email','from_name','subject','snippet','body_text','body_html','sent_at','received_at']) and jsonb_typeof(e.value) not in ('string','null'))
  then raise exception 'learn_email_store_message_invalid' using errcode='22023';end if;
 end loop;
 -- Each thread summary must come from a message in this page and vice versa.
 if exists(select 1 from jsonb_array_elements(p_messages)m where not exists(select 1 from jsonb_array_elements(p_threads)t where t->>'provider_thread_id'=m->>'provider_thread_id'))
  or exists(select 1 from jsonb_array_elements(p_threads)t where not exists(select 1 from jsonb_array_elements(p_messages)m where m->>'provider_thread_id'=t->>'provider_thread_id'))
  or (select count(distinct elem->>'provider_thread_id') from jsonb_array_elements(p_threads)elem)<>jsonb_array_length(p_threads)
  or (select count(distinct elem->>'provider_message_id') from jsonb_array_elements(p_messages)elem)<>jsonb_array_length(p_messages)
 then raise exception 'learn_email_store_page_mismatch' using errcode='22023';end if;
 insert into public.email_threads as retained(tenant_id,provider,provider_thread_id,subject,participants,last_message_at)
 select tenant,'gmail',x.provider_thread_id,x.subject,x.participants,x.last_message_at
 from jsonb_populate_recordset(null::public.email_threads,p_threads)x order by x.provider_thread_id
 on conflict(tenant_id,provider,provider_thread_id) do update set
  subject=case when retained.last_message_at is null or excluded.last_message_at>retained.last_message_at then coalesce(excluded.subject,retained.subject) else retained.subject end,
  last_message_at=greatest(retained.last_message_at,excluded.last_message_at),
  participants=(select coalesce(jsonb_agg(distinct e order by e),'[]') from jsonb_array_elements(retained.participants||excluded.participants)e);
 get diagnostics thread_count=row_count;
 insert into public.email_messages as retained(tenant_id,provider,provider_message_id,provider_thread_id,from_email,from_name,to_emails,cc_emails,subject,snippet,body_text,body_html,sent_at,received_at,direction,raw_payload)
 select tenant,'gmail',x.provider_message_id,x.provider_thread_id,x.from_email,x.from_name,x.to_emails,x.cc_emails,x.subject,x.snippet,x.body_text,x.body_html,x.sent_at,x.received_at,x.direction,x.raw_payload
 from jsonb_populate_recordset(null::public.email_messages,p_messages)x order by x.provider_message_id
 on conflict(tenant_id,provider,provider_message_id) do update set
  provider_thread_id=excluded.provider_thread_id,from_email=coalesce(excluded.from_email,retained.from_email),from_name=coalesce(excluded.from_name,retained.from_name),
  to_emails=excluded.to_emails,cc_emails=excluded.cc_emails,subject=coalesce(excluded.subject,retained.subject),snippet=coalesce(excluded.snippet,retained.snippet),
  body_text=coalesce(excluded.body_text,retained.body_text),body_html=coalesce(excluded.body_html,retained.body_html),sent_at=coalesce(excluded.sent_at,retained.sent_at),received_at=coalesce(excluded.received_at,retained.received_at),direction=excluded.direction,raw_payload=retained.raw_payload||excluded.raw_payload
 where p_context->>'fetch_policy'='refetch_all'
  and case when retained.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
    then case when excluded.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
      then (excluded.raw_payload->>'history_id')::numeric >= (retained.raw_payload->>'history_id')::numeric else false end
    else true end;
 get diagnostics message_count=row_count;
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'message_upsert_count',message_count,'thread_upsert_count',thread_count);
end $$;
revoke all on function public.learn_email_store_guard(jsonb,text,integer),public.learn_email_store_existing(jsonb,jsonb,text,integer),public.learn_email_store_page(jsonb,jsonb,jsonb,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_store_guard(jsonb,text,integer),public.learn_email_store_existing(jsonb,jsonb,text,integer),public.learn_email_store_page(jsonb,jsonb,jsonb,text,integer) to service_role;

-- INPUT supabase/migrations/20261031235900_learn_email_job_failure.sql
-- Settle a protocol-failed email job under its current lease. The generic
-- ID-only failure updater must not overwrite a replacement email worker.

create function public.learn_email_job_fail(p_tenant uuid,p_job uuid,p_attempt uuid,p_claimed_by text,p_claim integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;b public.learn_email_job_attempts%rowtype;r public.email_sync_runs%rowtype;receipt jsonb;code text;answer jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_email_job_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or p_attempt is null or nullif(p_claimed_by,'') is null or p_claim is null or p_claim<1 then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'learn_email_failure_v1';
 if j.status='dead_letter' and j.claimed_by=p_claimed_by and j.attempt_count=p_claim
  and receipt->>'attempt_id'=p_attempt::text and receipt->>'claimed_by'=p_claimed_by and receipt->>'claim'=p_claim::text
  and receipt->>'version'='learn-email-job-failure/1' then return receipt->'answer'||jsonb_build_object('disposition','replayed');end if;
 select * into b from public.learn_email_job_attempts where job_id=p_job and tenant_id=p_tenant and attempt_id=p_attempt;
 if not found then raise exception 'learn_email_job_binding_missing' using errcode='PT409';end if;
 perform public.learn_email_attempt_lease(p_attempt,p_claimed_by,p_claim);
 select * into r from public.email_sync_runs where id=b.attempt_id and tenant_id=b.tenant_id for key share;
 if not found or r.provider<>'gmail' or r.sync_type<>b.sync_type or r.status<>'failed' or r.completed_at is null
  or (r.metadata->>'email_account_id')::uuid is distinct from b.email_account_id then raise exception 'learn_email_attempt_not_failed' using errcode='PT409';end if;
 code:=case when r.error_message=any(array['history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure']) then r.error_message else 'capture_failed' end;
 answer:=jsonb_build_object('version','learn-email-job-failure/1','disposition','applied','job_id',j.id,'attempt_id',r.id,'code',code);
 receipt:=jsonb_build_object('version','learn-email-job-failure/1','attempt_id',r.id,'claimed_by',p_claimed_by,'claim',p_claim,'answer',answer);
 update public.platform_jobs set status='dead_letter',completed_at=clock_timestamp(),lease_expires_at=null,error_code=code,
  result=jsonb_build_object('sync_run_id',r.id,'error_code',code),metadata=coalesce(metadata,'{}')||jsonb_build_object('learn_email_failure_v1',receipt) where id=j.id;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 return answer;
end $$;
revoke all on function public.learn_email_job_fail(uuid,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_job_fail(uuid,uuid,uuid,text,integer) to service_role;

-- INPUT supabase/migrations/20261101000500_learn_email_paused_recovery.sql
-- Permit settlement of durable email work while fresh capture is paused. The
-- engine must still check capture admission before resolving provider credentials.

create function public.learn_capture_job_allowed(p_tenant uuid,p_type text,p_metadata jsonb,p_job uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select public.learn_capture_job_allowed(p_tenant,p_type,p_metadata)
 or (p_type in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill') and exists(
  select 1 from public.learn_email_job_attempts b
  join public.platform_jobs j on j.id=b.job_id and j.tenant_id=b.tenant_id
  join public.email_sync_runs r on r.id=b.attempt_id and r.tenant_id=b.tenant_id
  where b.job_id=p_job and b.tenant_id=p_tenant and j.job_type=p_type
   and b.definition=jsonb_build_object('job_type',j.job_type,'job_key',j.job_key,'payload',j.payload,'connector_id',j.connector_id,'module_id',j.module_id)
   and r.provider='gmail' and r.sync_type=b.sync_type
   and r.metadata->>'email_account_id'=b.email_account_id::text
   and ((r.status in ('success','failed') and r.completed_at is not null)
    or (r.status='running' and exists(
     select 1 from public.learn_email_transition_requests pending
     where pending.tenant_id=b.tenant_id and pending.email_account_id=b.email_account_id
      and pending.attempt_id=b.attempt_id and pending.stream=b.stream
      and not exists(select 1 from public.learn_email_transition_settlements settled where settled.request_id=pending.id)
    )))
 ));
$$;
revoke all on function public.learn_capture_job_allowed(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_capture_job_allowed(uuid,text,jsonb,uuid) to service_role;

-- Keep priority, due/lease checks, locking and dedicated-worker exclusions intact.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 needle:='public.learn_capture_job_allowed(c.tenant_id,c.job_type,c.metadata)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_recovery_queue_shape_changed';end if;
 execute replace(d,needle,'public.learn_capture_job_allowed(c.tenant_id,c.job_type,c.metadata,c.id)');
end $$;

-- INPUT supabase/migrations/20261101001500_learn_email_enqueue.sql
-- Manual capture requests use the same durable queue as scheduled capture.

create function public.learn_email_enqueue(p_tenant uuid,p_account uuid,p_type text,p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare a public.email_accounts%rowtype;j public.platform_jobs%rowtype;
 payload jsonb;connector text;key text;duplicate boolean;n integer;begin
 if current_user<>'service_role' then raise exception 'learn_email_enqueue_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_type is null or p_type not in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill')
  or jsonb_typeof(p_options) is distinct from 'object' or (p_options-array['max_results','force','restart'])<>'{}'::jsonb then
  raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
 if (p_options ? 'force' and jsonb_typeof(p_options->'force') is distinct from 'boolean')
  or (p_options ? 'restart' and jsonb_typeof(p_options->'restart') is distinct from 'boolean')
  or (p_type='email.workspace_backfill' and p_options ? 'force')
  or (p_type<>'email.workspace_backfill' and p_options ? 'restart') then
  raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
 if p_options ? 'max_results' then
  if jsonb_typeof(p_options->'max_results') is distinct from 'number' or not coalesce(p_options->>'max_results'~'^[0-9]{1,3}$',false) then
   raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
  if (p_options->>'max_results')::integer not between 1 and 500 then raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
 end if;
 if p_options->'restart'='true'::jsonb then raise exception 'learn_email_explicit_recovery_required' using errcode='PT409';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_capture_snapshot_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 if not public.learn_capture_allowed(p_tenant,'email') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into a from public.email_accounts where id=p_account and tenant_id=p_tenant and provider='gmail';
 if not found or (p_type='email.gmail_sync' and (a.status<>'active' or a.auth_state not in ('ok','unknown') or a.auth_state is null))
  or (p_type<>'email.gmail_sync' and a.status not in ('pending_tokenless_dwd','active_dwd')) then
  raise exception 'learn_email_source_ineligible' using errcode='PT409';end if;
 -- The worker rechecks all current mailbox/connection authority before tokens.
 payload:=jsonb_build_object('email_account_id',p_account);
 if p_type<>'email.workspace_backfill' or p_options ? 'max_results' then
  payload:=payload||jsonb_build_object('max_results',coalesce((p_options->>'max_results')::integer,25));end if;
 if p_options->'force'='true'::jsonb then payload:=payload||'{"force":true}'::jsonb;end if;
 connector:=case when p_type='email.gmail_sync' then 'gmail' else 'google-workspace' end;
 key:=p_type||':'||p_account::text;
 -- The unique active-job key arbitrates concurrent schedulers and requests.
 -- Never overwrite an existing payload, including a different rescan intent.
 for n in 1..3 loop
  insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,priority,max_attempts,payload)
   values(p_tenant,connector,'communications.email',p_type,key,case when p_type='email.workspace_backfill' then 200 else 100 end,5,payload)
   on conflict(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying') do nothing returning * into j;
  duplicate:=not found;
  if duplicate then
   select * into j from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in ('queued','running','retrying') for share;
   if not found then continue;end if;
   if j.job_type is distinct from p_type or j.connector_id is distinct from connector or j.module_id is distinct from 'communications.email' or j.payload is distinct from payload then
    raise exception 'learn_email_active_request_conflict' using errcode='PT409';end if;
  end if;
  return jsonb_build_object('version','learn-email-enqueue/1','success',true,'state','queued','job_id',j.id,'duplicate',duplicate,'provider','gmail','email_account_id',p_account);
 end loop;
 raise exception 'learn_email_enqueue_busy' using errcode='PT409';
end $$;
revoke all on function public.learn_email_enqueue(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_enqueue(uuid,uuid,text,jsonb) to service_role;

-- INPUT supabase/migrations/20261101190000_learn_email_safe_failures.sql
-- Preserve allowlisted Workspace diagnostics through the existing durable protocol.
-- No source rows, authority, function owners or grants are changed.

CREATE OR REPLACE FUNCTION public.email_ingestion_payload_v2(op text, stream text, v jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare names text[]; t jsonb; k text;
begin
  case op
  when 'claim' then
    names:=array['recovery'];
    if stream='recent' and v ? 'force' then
      names:=names||array['force'];
      if jsonb_typeof(v->'force') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_force'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names);
    if v->'recovery'<>'null'::jsonb then perform public.email_ingestion_recovery_v2(v->'recovery'); end if;
  when 'initialize_traversal' then
    perform public.email_ingestion_keys_v2(v,array['captured_history_id','captured_at','page_size','query']);
    if stream<>'recent' or jsonb_typeof(v->'captured_history_id') is distinct from 'string' or
      not coalesce(v->>'captured_history_id'~'^(0|[1-9][0-9]{0,19})$',false) then raise exception using errcode='22023',message='invalid_boundary'; end if;
    if (v->>'captured_history_id')::numeric>18446744073709551615 or v->'query'<>'null'::jsonb or
      not public.email_ingestion_count_v2(v->'page_size') or (v->>'page_size')::integer not between 1 and 500 or
      not coalesce(v->>'captured_at'~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$',false) then raise exception using errcode='22023',message='invalid_boundary'; end if;
    perform (v->>'captured_at')::timestamptz;
  when 'checkpoint' then
    names:=array['returned_next_page_token','exhausted','page_evidence','yield_after_page'];
    if stream='recent' then names:=names||array['label','expected_input_page_token'];
    else names:=names||array['expected_page_token','expected_total','listed_count']; end if;
    perform public.email_ingestion_keys_v2(v,names);
    perform public.email_ingestion_evidence_v2(v->'page_evidence','success');
    if stream='recent' then
      if not coalesce(v->>'label'=any(array['INBOX','SENT']),false) then raise exception using errcode='22023',message='invalid_page'; end if;
      k:='expected_input_page_token';
    else
      k:='expected_page_token';
      if not public.email_ingestion_count_v2(v->'expected_total') or not public.email_ingestion_count_v2(v->'listed_count') then raise exception using errcode='22023',message='invalid_page'; end if;
    end if;
    foreach t in array array[v->k,v->'returned_next_page_token'] loop
      if t<>'null'::jsonb and (jsonb_typeof(t)<>'string' or length(t#>>'{}') not between 1 and 8192) then raise exception using errcode='22023',message='invalid_token'; end if;
    end loop;
    if jsonb_typeof(v->'exhausted')<>'boolean' or jsonb_typeof(v->'yield_after_page')<>'boolean' or
      (v->>'exhausted')::boolean is distinct from (v->'returned_next_page_token'='null'::jsonb) then raise exception using errcode='22023',message='invalid_page'; end if;
  when 'release' then
    perform public.email_ingestion_keys_v2(v,array['reason_code','attempt_evidence']);
    if not coalesce(v->>'reason_code'=any(array['page_budget','time_budget','requested_yield']),false) then raise exception using errcode='22023',message='invalid_release'; end if;
    perform public.email_ingestion_evidence_v2(v->'attempt_evidence','release');
  when 'block','finish_attempt' then
    names:=array['error_code','attempt_evidence'];
    if op='finish_attempt' then names:=names||array['outcome'];
      if not coalesce(v->>'outcome'=any(array['failed','superseded']),false) then raise exception using errcode='22023',message='invalid_outcome'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names);
    if not coalesce(v->>'error_code'=any(array['history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure','sa_config_missing','sa_credentials_invalid','admin_delegation_missing','scopes_missing','delegation_grant_invalid','delegation_denied']),false) then raise exception using errcode='22023',message='invalid_error'; end if;
    perform public.email_ingestion_evidence_v2(v->'attempt_evidence','failure');
  when 'takeover' then
    perform public.email_ingestion_keys_v2(v,array['recovery']); perform public.email_ingestion_recovery_v2(v->'recovery');
  when 'restart' then
    names:=array['reason_code','recovery'];
    if stream='recent' and v ? 'fetch_policy' then
      names:=names||array['fetch_policy'];
      if not coalesce(v->>'fetch_policy'=any(array['missing_only','refetch_all']),false) then raise exception using errcode='22023',message='invalid_fetch_policy'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names); perform public.email_ingestion_recovery_v2(v->'recovery');
    if not coalesce(v->>'reason_code'=any(array['operator_restart','history_expired','continuation_expired']),false) then raise exception using errcode='22023',message='invalid_restart'; end if;
  else raise exception using errcode='22023',message='invalid_operation';
  end case;
end $function$
;
create or replace function public.learn_email_job_fail(p_tenant uuid,p_job uuid,p_attempt uuid,p_claimed_by text,p_claim integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;b public.learn_email_job_attempts%rowtype;r public.email_sync_runs%rowtype;receipt jsonb;code text;answer jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_email_job_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or p_attempt is null or nullif(p_claimed_by,'') is null or p_claim is null or p_claim<1 then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'learn_email_failure_v1';
 if j.status='dead_letter' and j.claimed_by=p_claimed_by and j.attempt_count=p_claim
  and receipt->>'attempt_id'=p_attempt::text and receipt->>'claimed_by'=p_claimed_by and receipt->>'claim'=p_claim::text
  and receipt->>'version'='learn-email-job-failure/1' then return receipt->'answer'||jsonb_build_object('disposition','replayed');end if;
 select * into b from public.learn_email_job_attempts where job_id=p_job and tenant_id=p_tenant and attempt_id=p_attempt;
 if not found then raise exception 'learn_email_job_binding_missing' using errcode='PT409';end if;
 perform public.learn_email_attempt_lease(p_attempt,p_claimed_by,p_claim);
 select * into r from public.email_sync_runs where id=b.attempt_id and tenant_id=b.tenant_id for key share;
 if not found or r.provider<>'gmail' or r.sync_type<>b.sync_type or r.status<>'failed' or r.completed_at is null
  or (r.metadata->>'email_account_id')::uuid is distinct from b.email_account_id then raise exception 'learn_email_attempt_not_failed' using errcode='PT409';end if;
 code:=case when r.error_message=any(array['history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure','sa_config_missing','sa_credentials_invalid','admin_delegation_missing','scopes_missing','delegation_grant_invalid','delegation_denied']) then r.error_message else 'capture_failed' end;
 answer:=jsonb_build_object('version','learn-email-job-failure/1','disposition','applied','job_id',j.id,'attempt_id',r.id,'code',code);
 receipt:=jsonb_build_object('version','learn-email-job-failure/1','attempt_id',r.id,'claimed_by',p_claimed_by,'claim',p_claim,'answer',answer);
 update public.platform_jobs set status='dead_letter',completed_at=clock_timestamp(),lease_expires_at=null,error_code=code,
  result=jsonb_build_object('sync_run_id',r.id,'error_code',code),metadata=coalesce(metadata,'{}')||jsonb_build_object('learn_email_failure_v1',receipt) where id=j.id;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 return answer;
end $$;

-- INPUT supabase/migrations/20261101360000_learn_workspace_mailbox_identity.sql
-- Directory-verified profile identity for existing Workspace aliases.
-- Do not infer bindings for retained accounts or rename historical source keys.

set local lock_timeout='3s';
alter table public.google_workspace_mailboxes
 add column directory_primary_email text,
 add column directory_identity_conflict boolean not null default false,
 add constraint google_workspace_directory_primary_email_valid check(
  directory_primary_email is null or
  (length(directory_primary_email)<=320 and directory_primary_email=lower(directory_primary_email)
   and directory_primary_email~'^[^[:space:]@]+@[^[:space:]@]+$'));
comment on column public.google_workspace_mailboxes.directory_primary_email is
 'Primary email returned by the complete tenant-bound directory scan. Null means unverified; never infer from an alias string.';
comment on column public.google_workspace_mailboxes.directory_identity_conflict is
 'Latched when a known address resolves to a different directory owner. Capture remains held pending explicit identity review; history is retained.';
-- Serialize conflicting directory refreshes at the row update, so two scans
-- that both read an unbound address cannot silently replace the first owner.
create function public.learn_workspace_identity_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$begin
 if old.directory_primary_email is not null then
  if (new.tenant_id,new.connection_id,lower(new.email_address)) is distinct from
     (old.tenant_id,old.connection_id,lower(old.email_address)) then
   raise exception 'workspace_identity_scope_changed' using errcode='PT409';
  end if;
  if new.directory_primary_email is distinct from old.directory_primary_email then
   new.directory_primary_email:=old.directory_primary_email;
   new.directory_identity_conflict:=true;
  end if;
 end if;
 new.directory_identity_conflict:=old.directory_identity_conflict or new.directory_identity_conflict;
 return new;
end $$;
revoke all on function public.learn_workspace_identity_guard() from public,anon,authenticated,service_role;
create trigger learn_workspace_identity_guard before update on public.google_workspace_mailboxes
 for each row execute function public.learn_workspace_identity_guard();

-- INPUT supabase/migrations/20261101370000_learn_email_mailbox_coverage.sql
-- Mailbox-wide recent capture, continuation version 3; RPC envelope remains v2.
-- New accounts and completed legacy generations first reconcile ALL messages,
-- including Spam/Trash. Only a completed v3 generation may reuse its history cursor.
-- In-flight v2 pages, request documents and receipts keep their original label scope.
-- Historical backfill checkpoints are unchanged; the v3 reconciliation fills their gaps.
-- No stored records/cursors, owners, grants or queue activation are changed at install.

do $$begin
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='email_ingestion_transition_v2') is distinct from 'f3ec156589e8509cc6dceac9ceb0b291'
 then raise exception 'Expected reviewed email transition definition'; end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='email_ingestion_payload_v2') is distinct from '2ce6628952e324bc4ec8586fb2adb2d2'
 then raise exception 'Expected reviewed email payload definition'; end if;
end$$;
CREATE OR REPLACE FUNCTION public.email_ingestion_payload_v2(op text, stream text, v jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare names text[]; t jsonb; k text;
begin
  case op
  when 'claim' then
    names:=array['recovery'];
    if stream='recent' and v ? 'force' then
      names:=names||array['force'];
      if jsonb_typeof(v->'force') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_force'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names);
    if v->'recovery'<>'null'::jsonb then perform public.email_ingestion_recovery_v2(v->'recovery'); end if;
  when 'initialize_traversal' then
    perform public.email_ingestion_keys_v2(v,array['captured_history_id','captured_at','page_size','query']);
    if stream<>'recent' or jsonb_typeof(v->'captured_history_id') is distinct from 'string' or
      not coalesce(v->>'captured_history_id'~'^(0|[1-9][0-9]{0,19})$',false) then raise exception using errcode='22023',message='invalid_boundary'; end if;
    if (v->>'captured_history_id')::numeric>18446744073709551615 or v->'query'<>'null'::jsonb or
      not public.email_ingestion_count_v2(v->'page_size') or (v->>'page_size')::integer not between 1 and 500 or
      not coalesce(v->>'captured_at'~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$',false) then raise exception using errcode='22023',message='invalid_boundary'; end if;
    perform (v->>'captured_at')::timestamptz;
  when 'checkpoint' then
    names:=array['returned_next_page_token','exhausted','page_evidence','yield_after_page'];
    if stream='recent' then names:=names||array['label','expected_input_page_token'];
    else names:=names||array['expected_page_token','expected_total','listed_count']; end if;
    perform public.email_ingestion_keys_v2(v,names);
    perform public.email_ingestion_evidence_v2(v->'page_evidence','success');
    if stream='recent' then
      if not coalesce(v->>'label'=any(array['INBOX','SENT','ALL']),false) then raise exception using errcode='22023',message='invalid_page'; end if;
      k:='expected_input_page_token';
    else
      k:='expected_page_token';
      if not public.email_ingestion_count_v2(v->'expected_total') or not public.email_ingestion_count_v2(v->'listed_count') then raise exception using errcode='22023',message='invalid_page'; end if;
    end if;
    foreach t in array array[v->k,v->'returned_next_page_token'] loop
      if t<>'null'::jsonb and (jsonb_typeof(t)<>'string' or length(t#>>'{}') not between 1 and 8192) then raise exception using errcode='22023',message='invalid_token'; end if;
    end loop;
    if jsonb_typeof(v->'exhausted')<>'boolean' or jsonb_typeof(v->'yield_after_page')<>'boolean' or
      (v->>'exhausted')::boolean is distinct from (v->'returned_next_page_token'='null'::jsonb) then raise exception using errcode='22023',message='invalid_page'; end if;
  when 'release' then
    perform public.email_ingestion_keys_v2(v,array['reason_code','attempt_evidence']);
    if not coalesce(v->>'reason_code'=any(array['page_budget','time_budget','requested_yield']),false) then raise exception using errcode='22023',message='invalid_release'; end if;
    perform public.email_ingestion_evidence_v2(v->'attempt_evidence','release');
  when 'block','finish_attempt' then
    names:=array['error_code','attempt_evidence'];
    if op='finish_attempt' then names:=names||array['outcome'];
      if not coalesce(v->>'outcome'=any(array['failed','superseded']),false) then raise exception using errcode='22023',message='invalid_outcome'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names);
    if not coalesce(v->>'error_code'=any(array['history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure','sa_config_missing','sa_credentials_invalid','admin_delegation_missing','scopes_missing','delegation_grant_invalid','delegation_denied']),false) then raise exception using errcode='22023',message='invalid_error'; end if;
    perform public.email_ingestion_evidence_v2(v->'attempt_evidence','failure');
  when 'takeover' then
    perform public.email_ingestion_keys_v2(v,array['recovery']); perform public.email_ingestion_recovery_v2(v->'recovery');
  when 'restart' then
    names:=array['reason_code','recovery'];
    if stream='recent' and v ? 'fetch_policy' then
      names:=names||array['fetch_policy'];
      if not coalesce(v->>'fetch_policy'=any(array['missing_only','refetch_all']),false) then raise exception using errcode='22023',message='invalid_fetch_policy'; end if;
    end if;
    perform public.email_ingestion_keys_v2(v,names); perform public.email_ingestion_recovery_v2(v->'recovery');
    if not coalesce(v->>'reason_code'=any(array['operator_restart','history_expired','continuation_expired']),false) then raise exception using errcode='22023',message='invalid_restart'; end if;
  else raise exception using errcode='22023',message='invalid_operation';
  end case;
end $function$
;

CREATE OR REPLACE FUNCTION public.email_ingestion_transition_v2(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid, p_operation text, p_expected_generation uuid, p_expected_revision bigint, p_expected_owner_attempt_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 a record; c public.email_ingestion_checkpoints%rowtype; receipt public.email_ingestion_transitions%rowtype;
 attempt public.email_sync_runs%rowtype; doc jsonb; result jsonb; evidence jsonb;
 exists_checkpoint boolean; replay boolean; changed boolean:=true; eligible boolean;
 done boolean:=false; terminal boolean:=false; attempt_status text:='running'; error_code text;
 records integer; label text; input_token text; next_token text; mode text; current_cursor text;
 new_total bigint; code text; v_attempt_metadata jsonb; confirmed_count integer; v_fetch_policy text; v_force boolean;
begin
 if p_tenant_id is null or p_email_account_id is null or p_attempt_id is null or p_transition_id is null or
   p_stream is null or p_stream not in ('recent','historical') or p_operation is null or
   p_expected_revision<0 then raise exception using errcode='22023',message='invalid_request'; end if;
 perform public.email_ingestion_payload_v2(p_operation,p_stream,p_payload);
 -- Defaults do not rewrite the frozen request_document: omitted/false remain
 -- different requests for same-ID replay equality, even when semantically equal.
 v_force:=p_stream='recent' and p_operation='claim' and coalesce((p_payload->>'force')::boolean,false);
 -- No whole account SELECT: this role has no token, identity-write or authority privileges.
 select id,tenant_id,provider,status,auth_state,history_id,backfill_status,backfill_started_at,
   backfill_completed_at,backfill_page_token,backfill_total_fetched,backfill_error
 into a from public.email_accounts where tenant_id=p_tenant_id and id=p_email_account_id and provider='gmail' for update;
 if not found then raise exception using errcode='P0001',message='account_not_found'; end if;
 perform 1 from public.email_ingestion_checkpoints where tenant_id=p_tenant_id and email_account_id=p_email_account_id
   order by case stream when 'recent' then 0 else 1 end for update;
 select * into c from public.email_ingestion_checkpoints where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream;
 exists_checkpoint:=found;
 select * into receipt from public.email_ingestion_transitions where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream and transition_id=p_transition_id;
 replay:=found;
 -- Own attempt lock comes BEFORE mutable status/association validation and mutation.
 select * into attempt from public.email_sync_runs where id=p_attempt_id and tenant_id=p_tenant_id for update;
 if not found or attempt.provider<>'gmail' or jsonb_typeof(attempt.metadata->'email_account_id') is distinct from 'string' or
   not coalesce(attempt.metadata->>'email_account_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) then
   raise exception using errcode='P0001',message='attempt_mismatch';
 end if;
 if (attempt.metadata->>'email_account_id')::uuid<>p_email_account_id or
   (p_stream='historical' and attempt.sync_type<>'workspace_backfill') or
   (p_stream='recent' and attempt.sync_type not in ('messages','workspace_messages')) or
   exists(select 1 from public.email_ingestion_transitions where attempt_id=p_attempt_id and
     (tenant_id<>p_tenant_id or email_account_id<>p_email_account_id or stream<>p_stream)) or
   exists(select 1 from public.email_ingestion_checkpoints where owner_attempt_id=p_attempt_id and
     (tenant_id<>p_tenant_id or email_account_id<>p_email_account_id or stream<>p_stream)) then
   raise exception using errcode='P0001',message='attempt_mismatch';
 end if;
 doc:=jsonb_build_object('tenant_id',p_tenant_id,'email_account_id',p_email_account_id,'stream',p_stream,
   'attempt_id',p_attempt_id,'transition_id',p_transition_id,'operation',p_operation,
   'expected_generation',p_expected_generation,'expected_revision',p_expected_revision::text,
   'expected_owner_attempt_id',p_expected_owner_attempt_id,'payload',p_payload);
 if replay then
   if receipt.attempt_id<>p_attempt_id or receipt.request_document<>doc then raise exception using errcode='P0001',message='transition_id_reused'; end if;
   return jsonb_build_object('contract_version',2,'disposition','replayed','code','receipt_replayed','transition_id',p_transition_id,
     'accepted_result',receipt.accepted_result,'current_checkpoint',public.email_ingestion_checkpoint_json_v2(c),'historical_receipt',true);
 end if;
 if attempt.status<>'running' then raise exception using errcode='P0001',message='attempt_terminal'; end if;
 records:=attempt.records_processed;
 -- Slice A account check ONLY; DWD relationship/revision locking is not claimed.
 eligible:=case when attempt.sync_type='messages' then a.status='active' and a.auth_state in ('ok','unknown')
   else a.status in ('pending_tokenless_dwd','active_dwd') end;
 if p_operation not in ('block','release','finish_attempt') and not eligible then raise exception using errcode='P0001',message='source_ineligible'; end if;
 if p_operation='finish_attempt' then
   if exists_checkpoint and c.owner_attempt_id=p_attempt_id then raise exception using errcode='P0001',message='owner_must_release'; end if;
   if not exists_checkpoint and (p_expected_generation is not null or p_expected_revision is not null or p_expected_owner_attempt_id is not null) then
     raise exception using errcode='22023',message='absent_checkpoint_requires_null_fences';
   end if;
   -- Explicit stale-version exception: only caller's own evidence; no progress update.
   changed:=false; terminal:=true; attempt_status:='failed'; error_code:=p_payload->>'error_code';
   evidence:=p_payload->'attempt_evidence';
 else
   if not exists_checkpoint then
     if p_operation<>'claim' or p_expected_generation is not null or p_expected_revision is not null or p_expected_owner_attempt_id is not null or p_payload->'recovery'<>'null'::jsonb then
       raise exception using errcode='P0001',message='checkpoint_missing';
     end if;
     c.tenant_id:=p_tenant_id; c.email_account_id:=p_email_account_id; c.stream:=p_stream; c.contract_version:=2;
     c.generation:=gen_random_uuid(); c.revision:=0; c.state:='ready'; c.owner_attempt_id:=null;
     c.created_at:=now(); c.updated_at:=now();
     if p_stream='recent' then c.continuation:=jsonb_build_object('version',3,'phase','uninitialized',
       'intent','reconcile',
       'fetch_policy',case when v_force then 'refetch_all' else 'missing_only' end);
     elsif a.backfill_status='completed' then c.state:='completed';
     elsif a.backfill_status='error' then
       c.state:='blocked';
       -- Preserve recognised classifications, especially restart-only expiry.
       -- Unknown legacy error text must not leak into protocol evidence.
       c.block_code:=case when a.backfill_error in (
         'history_expired','continuation_expired','pagination_no_progress',
         'fetch_failed','parse_failed','persistence_failed','checkpoint_conflict',
         'source_ineligible','unexpected_failure') then a.backfill_error else 'unexpected_failure' end;
     elsif a.backfill_status not in ('idle','running') then raise exception using errcode='P0001',message='legacy_state_invalid'; end if;
   elsif c.generation is distinct from p_expected_generation or c.revision is distinct from p_expected_revision or c.owner_attempt_id is distinct from p_expected_owner_attempt_id then
     raise exception using errcode='P0001',message='checkpoint_conflict';
   end if;
   if p_stream='recent' and p_operation<>'restart' then
     -- Known pre-policy generations were missing-only. Materialize only an
     -- absent field, never coalesce explicit null/invalid policy into permission.
     if jsonb_typeof(c.continuation) is distinct from 'object' then raise exception using errcode='P0001',message='invalid_legacy_policy'; end if;
     if not (c.continuation ? 'fetch_policy') then c.continuation:=c.continuation||jsonb_build_object('fetch_policy','missing_only'); end if;
     if not coalesce(c.continuation->>'version' in ('2','3'),false) then
       raise exception using errcode='P0001',message='invalid_legacy_policy'; end if;
     v_fetch_policy:=c.continuation->>'fetch_policy';
     if not coalesce(v_fetch_policy=any(array['missing_only','refetch_all']),false) or
       (v_fetch_policy='refetch_all' and not coalesce(
         (c.continuation->>'phase'='uninitialized' and c.continuation->>'intent'='reconcile') or
         (c.continuation->>'phase'='initialized' and c.continuation->>'mode'='reconcile'),false)) then
       raise exception using errcode='P0001',message='invalid_legacy_policy';
     end if;
   end if;
   case p_operation
   when 'claim' then
     if p_stream='recent' and exists_checkpoint and c.state<>'completed' and v_force and v_fetch_policy<>'refetch_all' then
       raise exception using errcode='P0001',message='force_generation_busy';
     end if;
     if not exists_checkpoint and c.state in ('completed','blocked') then
       terminal:=true; done:=c.state='completed'; attempt_status:=case when done then 'success' else 'failed' end;
       error_code:=case when done then null else c.block_code end;
     elsif p_stream='historical' and c.state='completed' then
       if p_payload->'recovery'<>'null'::jsonb then raise exception using errcode='P0001',message='invalid_recovery_state'; end if;
       changed:=false; done:=true; terminal:=true; attempt_status:='success';
     else
       if c.state='blocked' then
         if p_payload->'recovery'='null'::jsonb or c.block_code in ('history_expired','continuation_expired') then
           raise exception using errcode='P0001',message='explicit_recovery_required';
         end if;
       elsif p_payload->'recovery'<>'null'::jsonb then raise exception using errcode='P0001',message='invalid_recovery_state';
       elsif c.state<>'ready' and not(p_stream='recent' and c.state='completed') then raise exception using errcode='P0001',message='already_claimed'; end if;
       if p_stream='recent' and c.state='completed' then
         c.generation:=gen_random_uuid(); c.continuation:=jsonb_build_object('version',3,'phase','uninitialized',
           'intent',case when v_force or c.continuation->>'version' is distinct from '3' then 'reconcile' else 'normal' end,
           'fetch_policy',case when v_force then 'refetch_all' else 'missing_only' end);
       end if;
       c.state:='claimed'; c.owner_attempt_id:=p_attempt_id; c.block_code:=null;
       if p_stream='historical' then
         update public.email_accounts set backfill_status='running',backfill_error=null,
           backfill_started_at=case when backfill_status='idle' and backfill_started_at is null then now() else backfill_started_at end
           where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if;
       end if;
     end if;
   when 'takeover' then
     if c.state<>'claimed' or c.owner_attempt_id=p_attempt_id then raise exception using errcode='P0001',message='invalid_recovery_state'; end if;
     c.owner_attempt_id:=p_attempt_id;
     if p_stream='historical' then update public.email_accounts set backfill_status='running',backfill_error=null where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
   when 'restart' then
     c.generation:=gen_random_uuid(); c.state:='claimed'; c.owner_attempt_id:=p_attempt_id; c.block_code:=null;
     if p_stream='recent' then c.continuation:=jsonb_build_object('version',3,'phase','uninitialized','intent','reconcile',
       'fetch_policy',coalesce(p_payload->>'fetch_policy','missing_only'));
     else update public.email_accounts set backfill_status='running',backfill_page_token=null,backfill_total_fetched=0,
       backfill_started_at=now(),backfill_completed_at=null,backfill_error=null where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
   else
     if c.state<>'claimed' or c.owner_attempt_id is distinct from p_attempt_id then raise exception using errcode='P0001',message='not_owner'; end if;
     case p_operation
     when 'initialize_traversal' then
       if c.continuation->>'phase' is distinct from 'uninitialized' then raise exception using errcode='P0001',message='already_initialized'; end if;
       current_cursor:=a.history_id;
       if current_cursor is not null then
         if current_cursor!~'^(0|[1-9][0-9]{0,19})$' then raise exception using errcode='P0001',message='invalid_legacy_cursor'; end if;
         if current_cursor::numeric>18446744073709551615 or (p_payload->>'captured_history_id')::numeric<current_cursor::numeric then raise exception using errcode='P0001',message='boundary_regression'; end if;
       end if;
       mode:=case when c.continuation->>'intent'='normal' and current_cursor is not null then 'history' else 'reconcile' end;
       c.continuation:=jsonb_build_object('version',(c.continuation->>'version')::integer,'phase','initialized','mode',mode,'origin_history_id',current_cursor,
         'fetch_policy',c.continuation->>'fetch_policy',
         'captured_history_id',p_payload->>'captured_history_id','captured_at',p_payload->>'captured_at',
         'page_size',p_payload->'page_size','query',null,
         'labels',case when c.continuation->>'version'='3' then jsonb_build_array('ALL') else jsonb_build_array('INBOX','SENT') end,
         'labels_state',case when c.continuation->>'version'='3' then
           jsonb_build_object('ALL',jsonb_build_object('next_page_token',null,'complete',false))
         else jsonb_build_object('INBOX',jsonb_build_object('next_page_token',null,'complete',false),
           'SENT',jsonb_build_object('next_page_token',null,'complete',false)) end);
     when 'checkpoint' then
       next_token:=p_payload->>'returned_next_page_token'; evidence:=p_payload->'page_evidence';
       if p_stream='recent' then
         label:=p_payload->>'label'; input_token:=p_payload->>'expected_input_page_token';
         if c.continuation->>'phase' is distinct from 'initialized' then raise exception using errcode='P0001',message='not_initialized'; end if;
         if not coalesce(case c.continuation->>'version'
           when '3' then label='ALL' and c.continuation->'labels'='["ALL"]'::jsonb
           when '2' then label in ('INBOX','SENT') and c.continuation->'labels'='["INBOX","SENT"]'::jsonb
           else false end,false) then raise exception using errcode='P0001',message='page_conflict'; end if;
         if c.continuation#>>array['labels_state',label,'complete'] is distinct from 'false' or
           c.continuation#>>array['labels_state',label,'next_page_token'] is distinct from input_token then raise exception using errcode='P0001',message='page_conflict'; end if;
         if a.history_id is distinct from c.continuation->>'origin_history_id' then raise exception using errcode='P0001',message='cursor_conflict'; end if;
       else
         label:=null; input_token:=p_payload->>'expected_page_token';
         if a.backfill_status<>'running' or a.backfill_page_token is distinct from input_token or a.backfill_total_fetched<>(p_payload->>'expected_total')::integer then raise exception using errcode='P0001',message='page_conflict'; end if;
       end if;
       if next_token is not null and (next_token is not distinct from input_token or exists(
         select 1 from public.email_ingestion_transitions t where t.tenant_id=p_tenant_id and t.email_account_id=p_email_account_id
           and t.stream=p_stream and t.result_generation=c.generation and t.operation='checkpoint'
           and (t.request_document->'payload'->>'label') is not distinct from label
           and ((md5(coalesce(t.request_document->'payload'->>'expected_input_page_token',t.request_document->'payload'->>'expected_page_token'))=md5(next_token)
             and coalesce(t.request_document->'payload'->>'expected_input_page_token',t.request_document->'payload'->>'expected_page_token')=next_token)
           or (md5(t.request_document->'payload'->>'returned_next_page_token')=md5(next_token) and t.request_document->'payload'->>'returned_next_page_token'=next_token))
       )) then raise exception using errcode='P0001',message='pagination_no_progress'; end if;
       if p_stream='recent' then
         c.continuation:=jsonb_set(c.continuation,array['labels_state',label],jsonb_build_object('next_page_token',next_token,'complete',(p_payload->>'exhausted')::boolean));
         done:=case when c.continuation->>'version'='3' then (c.continuation#>>'{labels_state,ALL,complete}')::boolean
           else (c.continuation#>>'{labels_state,INBOX,complete}')::boolean and (c.continuation#>>'{labels_state,SENT,complete}')::boolean end;
         if done then update public.email_accounts set history_id=c.continuation->>'captured_history_id' where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
       else
         new_total:=a.backfill_total_fetched::bigint+(p_payload->>'listed_count')::bigint;
         if new_total>2147483647 then raise exception using errcode='P0001',message='total_overflow'; end if;
         done:=(p_payload->>'exhausted')::boolean;
         update public.email_accounts set backfill_page_token=next_token,backfill_total_fetched=new_total::integer,
           backfill_status=case when done then 'completed' else 'running' end,
           backfill_completed_at=case when done then now() else null end,backfill_error=null
           where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if;
       end if;
       new_total:=records::bigint+(evidence->>'message_upsert_count')::bigint;
       if new_total>2147483647 then raise exception using errcode='P0001',message='total_overflow'; end if;
       records:=new_total::integer;
       if done or (p_payload->>'yield_after_page')::boolean then
         c.state:=case when done then 'completed' else 'ready' end; c.owner_attempt_id:=null; terminal:=true; attempt_status:='success';
       end if;
     when 'release' then
       c.state:='ready'; c.owner_attempt_id:=null; terminal:=true; attempt_status:='success'; evidence:=p_payload->'attempt_evidence';
     when 'block' then
       c.state:='blocked'; c.owner_attempt_id:=null; c.block_code:=p_payload->>'error_code';
       terminal:=true; attempt_status:='failed'; error_code:=c.block_code; evidence:=p_payload->'attempt_evidence';
       if p_stream='historical' then update public.email_accounts set backfill_status='error',backfill_error=c.block_code where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
     else raise exception using errcode='22023',message='invalid_operation';
     end case;
   end case;
 end if;
 if changed then
   if c.revision=9223372036854775807 then raise exception using errcode='P0001',message='revision_exhausted'; end if;
   c.revision:=c.revision+1; c.updated_at:=now();
   if not exists_checkpoint then
     insert into public.email_ingestion_checkpoints(tenant_id,email_account_id,stream,contract_version,generation,revision,state,owner_attempt_id,continuation,block_code,created_at,updated_at)
     values(c.tenant_id,c.email_account_id,c.stream,c.contract_version,c.generation,c.revision,c.state,c.owner_attempt_id,c.continuation,c.block_code,c.created_at,c.updated_at);
   else
     update public.email_ingestion_checkpoints set generation=c.generation,revision=c.revision,state=c.state,
       owner_attempt_id=c.owner_attempt_id,continuation=c.continuation,block_code=c.block_code,updated_at=c.updated_at
       where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream;
     if not found then raise exception 'checkpoint update affected no row'; end if;
   end if;
 end if;
 if p_operation in ('block','release','finish_attempt') then
   -- These counts are attempt-wide known totals; NULL never overwrites with zero.
   confirmed_count:=(evidence->>'message_upsert_count')::integer;
   if confirmed_count is not null then
     if confirmed_count<records then raise exception using errcode='22023',message='count_regression'; end if;
     records:=confirmed_count;
   end if;
 end if;
 result:=jsonb_build_object('operation',p_operation,'attempt_id',p_attempt_id,'tenant_id',p_tenant_id,'email_account_id',p_email_account_id,'stream',p_stream,
   'checkpoint_present',c.tenant_id is not null,'generation',c.generation,'revision',c.revision::text,
   'checkpoint_state',c.state,'owner_attempt_id',c.owner_attempt_id,'attempt_status',attempt_status,
   'records_processed',records,'coverage_complete',done);
 insert into public.email_ingestion_transitions(tenant_id,email_account_id,stream,transition_id,operation,attempt_id,
   expected_generation,expected_revision,expected_owner_attempt_id,request_document,request_fingerprint,accepted_result,checkpoint_stream,result_generation,result_revision)
 values(p_tenant_id,p_email_account_id,p_stream,p_transition_id,p_operation,p_attempt_id,p_expected_generation,p_expected_revision,
   p_expected_owner_attempt_id,doc,md5(doc::text),result,case when c.tenant_id is not null then p_stream else null end,c.generation,c.revision);
 v_attempt_metadata:=attempt.metadata||jsonb_build_object('email_ingestion_v2',jsonb_build_object('contract_version',2,'stream',p_stream,
   'transition_id',p_transition_id,'operation',p_operation,'checkpoint_present',c.tenant_id is not null,'generation',c.generation,'revision',c.revision::text,
   'coverage_complete',done,'continuation_pending',c.state<>'completed','evidence',evidence,
   'classification',case when p_operation='finish_attempt' then p_payload->>'outcome' else null end));
 update public.email_sync_runs as target_run set status=attempt_status,completed_at=case when terminal then now() else null end,
   records_processed=records,error_message=error_code,metadata=v_attempt_metadata
   where target_run.id=p_attempt_id and target_run.tenant_id=p_tenant_id and target_run.status='running';
 if not found then raise exception 'attempt update disappeared'; end if;
 return jsonb_build_object('contract_version',2,'disposition','applied','code','transition_applied','transition_id',p_transition_id,
   'accepted_result',result,'current_checkpoint',public.email_ingestion_checkpoint_json_v2(c),'historical_receipt',false);
exception
 when invalid_parameter_value or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
   return jsonb_build_object('contract_version',2,'disposition','denied','code','invalid_request','transition_id',p_transition_id,'accepted_result',null,'current_checkpoint',null,'historical_receipt',false);
 when sqlstate 'P0001' then
   code:=sqlerrm;
   if code<>all(array['account_not_found','attempt_mismatch','transition_id_reused','attempt_terminal','source_ineligible','owner_must_release',
     'checkpoint_missing','legacy_state_invalid','checkpoint_conflict','invalid_recovery_state','explicit_recovery_required','already_claimed',
     'not_owner','already_initialized','invalid_legacy_cursor','boundary_regression','not_initialized','page_conflict','cursor_conflict',
     'pagination_no_progress','total_overflow','revision_exhausted','force_generation_busy','invalid_legacy_policy']) then raise; end if;
   -- Exception subtransaction rolled back ALL writes; never return staged c as current.
   return jsonb_build_object('contract_version',2,'disposition',case when code in ('account_not_found','attempt_mismatch','transition_id_reused','source_ineligible') then 'denied' else 'conflict' end,
     'code',code,'transition_id',p_transition_id,'accepted_result',null,'current_checkpoint',null,'historical_receipt',false);
end $function$
;

-- INPUT supabase/migrations/20261101400000_learn_email_mailbox_changes.sql
-- Gmail continuation v4: retain content, refresh labels and record provider absence.
-- Existing in-flight v2/v3 requests and receipts keep their original semantics.
-- A new/finished generation reconciles current messages before incremental changes.
-- No account, cursor, provider activation or source row changes at installation.

CREATE OR REPLACE FUNCTION public.email_ingestion_transition_v2(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid, p_operation text, p_expected_generation uuid, p_expected_revision bigint, p_expected_owner_attempt_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 a record; c public.email_ingestion_checkpoints%rowtype; receipt public.email_ingestion_transitions%rowtype;
 attempt public.email_sync_runs%rowtype; doc jsonb; result jsonb; evidence jsonb;
 exists_checkpoint boolean; replay boolean; changed boolean:=true; eligible boolean;
 done boolean:=false; terminal boolean:=false; attempt_status text:='running'; error_code text;
 records integer; label text; input_token text; next_token text; mode text; current_cursor text;
 new_total bigint; code text; v_attempt_metadata jsonb; confirmed_count integer; v_fetch_policy text; v_force boolean;
begin
 if p_tenant_id is null or p_email_account_id is null or p_attempt_id is null or p_transition_id is null or
   p_stream is null or p_stream not in ('recent','historical') or p_operation is null or
   p_expected_revision<0 then raise exception using errcode='22023',message='invalid_request'; end if;
 perform public.email_ingestion_payload_v2(p_operation,p_stream,p_payload);
 -- Defaults do not rewrite the frozen request_document: omitted/false remain
 -- different requests for same-ID replay equality, even when semantically equal.
 v_force:=p_stream='recent' and p_operation='claim' and coalesce((p_payload->>'force')::boolean,false);
 -- No whole account SELECT: this role has no token, identity-write or authority privileges.
 select id,tenant_id,provider,status,auth_state,history_id,backfill_status,backfill_started_at,
   backfill_completed_at,backfill_page_token,backfill_total_fetched,backfill_error
 into a from public.email_accounts where tenant_id=p_tenant_id and id=p_email_account_id and provider='gmail' for update;
 if not found then raise exception using errcode='P0001',message='account_not_found'; end if;
 perform 1 from public.email_ingestion_checkpoints where tenant_id=p_tenant_id and email_account_id=p_email_account_id
   order by case stream when 'recent' then 0 else 1 end for update;
 select * into c from public.email_ingestion_checkpoints where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream;
 exists_checkpoint:=found;
 select * into receipt from public.email_ingestion_transitions where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream and transition_id=p_transition_id;
 replay:=found;
 -- Own attempt lock comes BEFORE mutable status/association validation and mutation.
 select * into attempt from public.email_sync_runs where id=p_attempt_id and tenant_id=p_tenant_id for update;
 if not found or attempt.provider<>'gmail' or jsonb_typeof(attempt.metadata->'email_account_id') is distinct from 'string' or
   not coalesce(attempt.metadata->>'email_account_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) then
   raise exception using errcode='P0001',message='attempt_mismatch';
 end if;
 if (attempt.metadata->>'email_account_id')::uuid<>p_email_account_id or
   (p_stream='historical' and attempt.sync_type<>'workspace_backfill') or
   (p_stream='recent' and attempt.sync_type not in ('messages','workspace_messages')) or
   exists(select 1 from public.email_ingestion_transitions where attempt_id=p_attempt_id and
     (tenant_id<>p_tenant_id or email_account_id<>p_email_account_id or stream<>p_stream)) or
   exists(select 1 from public.email_ingestion_checkpoints where owner_attempt_id=p_attempt_id and
     (tenant_id<>p_tenant_id or email_account_id<>p_email_account_id or stream<>p_stream)) then
   raise exception using errcode='P0001',message='attempt_mismatch';
 end if;
 doc:=jsonb_build_object('tenant_id',p_tenant_id,'email_account_id',p_email_account_id,'stream',p_stream,
   'attempt_id',p_attempt_id,'transition_id',p_transition_id,'operation',p_operation,
   'expected_generation',p_expected_generation,'expected_revision',p_expected_revision::text,
   'expected_owner_attempt_id',p_expected_owner_attempt_id,'payload',p_payload);
 if replay then
   if receipt.attempt_id<>p_attempt_id or receipt.request_document<>doc then raise exception using errcode='P0001',message='transition_id_reused'; end if;
   return jsonb_build_object('contract_version',2,'disposition','replayed','code','receipt_replayed','transition_id',p_transition_id,
     'accepted_result',receipt.accepted_result,'current_checkpoint',public.email_ingestion_checkpoint_json_v2(c),'historical_receipt',true);
 end if;
 if attempt.status<>'running' then raise exception using errcode='P0001',message='attempt_terminal'; end if;
 records:=attempt.records_processed;
 -- Slice A account check ONLY; DWD relationship/revision locking is not claimed.
 eligible:=case when attempt.sync_type='messages' then a.status='active' and a.auth_state in ('ok','unknown')
   else a.status in ('pending_tokenless_dwd','active_dwd') end;
 if p_operation not in ('block','release','finish_attempt') and not eligible then raise exception using errcode='P0001',message='source_ineligible'; end if;
 if p_operation='finish_attempt' then
   if exists_checkpoint and c.owner_attempt_id=p_attempt_id then raise exception using errcode='P0001',message='owner_must_release'; end if;
   if not exists_checkpoint and (p_expected_generation is not null or p_expected_revision is not null or p_expected_owner_attempt_id is not null) then
     raise exception using errcode='22023',message='absent_checkpoint_requires_null_fences';
   end if;
   -- Explicit stale-version exception: only caller's own evidence; no progress update.
   changed:=false; terminal:=true; attempt_status:='failed'; error_code:=p_payload->>'error_code';
   evidence:=p_payload->'attempt_evidence';
 else
   if not exists_checkpoint then
     if p_operation<>'claim' or p_expected_generation is not null or p_expected_revision is not null or p_expected_owner_attempt_id is not null or p_payload->'recovery'<>'null'::jsonb then
       raise exception using errcode='P0001',message='checkpoint_missing';
     end if;
     c.tenant_id:=p_tenant_id; c.email_account_id:=p_email_account_id; c.stream:=p_stream; c.contract_version:=2;
     c.generation:=gen_random_uuid(); c.revision:=0; c.state:='ready'; c.owner_attempt_id:=null;
     c.created_at:=now(); c.updated_at:=now();
     if p_stream='recent' then c.continuation:=jsonb_build_object('version',4,'phase','uninitialized',
       'intent','reconcile',
       'fetch_policy','refetch_all');
     elsif a.backfill_status='completed' then c.state:='completed';
     elsif a.backfill_status='error' then
       c.state:='blocked';
       -- Preserve recognised classifications, especially restart-only expiry.
       -- Unknown legacy error text must not leak into protocol evidence.
       c.block_code:=case when a.backfill_error in (
         'history_expired','continuation_expired','pagination_no_progress',
         'fetch_failed','parse_failed','persistence_failed','checkpoint_conflict',
         'source_ineligible','unexpected_failure') then a.backfill_error else 'unexpected_failure' end;
     elsif a.backfill_status not in ('idle','running') then raise exception using errcode='P0001',message='legacy_state_invalid'; end if;
   elsif c.generation is distinct from p_expected_generation or c.revision is distinct from p_expected_revision or c.owner_attempt_id is distinct from p_expected_owner_attempt_id then
     raise exception using errcode='P0001',message='checkpoint_conflict';
   end if;
   if p_stream='recent' and p_operation<>'restart' then
     -- Known pre-policy generations were missing-only. Materialize only an
     -- absent field, never coalesce explicit null/invalid policy into permission.
     if jsonb_typeof(c.continuation) is distinct from 'object' then raise exception using errcode='P0001',message='invalid_legacy_policy'; end if;
     if not (c.continuation ? 'fetch_policy') then c.continuation:=c.continuation||jsonb_build_object('fetch_policy','missing_only'); end if;
     if not coalesce(c.continuation->>'version' in ('2','3','4'),false) then
       raise exception using errcode='P0001',message='invalid_legacy_policy'; end if;
     v_fetch_policy:=c.continuation->>'fetch_policy';
     if not coalesce(v_fetch_policy=any(array['missing_only','refetch_all']),false) or
       (v_fetch_policy='refetch_all' and c.continuation->>'version'<>'4' and not coalesce(
         (c.continuation->>'phase'='uninitialized' and c.continuation->>'intent'='reconcile') or
         (c.continuation->>'phase'='initialized' and c.continuation->>'mode'='reconcile'),false)) then
       raise exception using errcode='P0001',message='invalid_legacy_policy';
     end if;
   end if;
   case p_operation
   when 'claim' then
     if p_stream='recent' and exists_checkpoint and c.state<>'completed' and v_force and v_fetch_policy<>'refetch_all' then
       raise exception using errcode='P0001',message='force_generation_busy';
     end if;
     if not exists_checkpoint and c.state in ('completed','blocked') then
       terminal:=true; done:=c.state='completed'; attempt_status:=case when done then 'success' else 'failed' end;
       error_code:=case when done then null else c.block_code end;
     elsif p_stream='historical' and c.state='completed' then
       if p_payload->'recovery'<>'null'::jsonb then raise exception using errcode='P0001',message='invalid_recovery_state'; end if;
       changed:=false; done:=true; terminal:=true; attempt_status:='success';
     else
       if c.state='blocked' then
         if p_payload->'recovery'='null'::jsonb or c.block_code in ('history_expired','continuation_expired') then
           raise exception using errcode='P0001',message='explicit_recovery_required';
         end if;
       elsif p_payload->'recovery'<>'null'::jsonb then raise exception using errcode='P0001',message='invalid_recovery_state';
       elsif c.state<>'ready' and not(p_stream='recent' and c.state='completed') then raise exception using errcode='P0001',message='already_claimed'; end if;
       if p_stream='recent' and c.state='completed' then
         c.generation:=gen_random_uuid(); c.continuation:=jsonb_build_object('version',4,'phase','uninitialized',
           'intent',case when v_force or c.continuation->>'version' is distinct from '4' then 'reconcile' else 'normal' end,
           'fetch_policy','refetch_all');
       end if;
       c.state:='claimed'; c.owner_attempt_id:=p_attempt_id; c.block_code:=null;
       if p_stream='historical' then
         update public.email_accounts set backfill_status='running',backfill_error=null,
           backfill_started_at=case when backfill_status='idle' and backfill_started_at is null then now() else backfill_started_at end
           where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if;
       end if;
     end if;
   when 'takeover' then
     if c.state<>'claimed' or c.owner_attempt_id=p_attempt_id then raise exception using errcode='P0001',message='invalid_recovery_state'; end if;
     c.owner_attempt_id:=p_attempt_id;
     if p_stream='historical' then update public.email_accounts set backfill_status='running',backfill_error=null where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
   when 'restart' then
     c.generation:=gen_random_uuid(); c.state:='claimed'; c.owner_attempt_id:=p_attempt_id; c.block_code:=null;
     if p_stream='recent' then c.continuation:=jsonb_build_object('version',4,'phase','uninitialized','intent','reconcile',
       'fetch_policy',coalesce(p_payload->>'fetch_policy','missing_only'));
     else update public.email_accounts set backfill_status='running',backfill_page_token=null,backfill_total_fetched=0,
       backfill_started_at=now(),backfill_completed_at=null,backfill_error=null where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
   else
     if c.state<>'claimed' or c.owner_attempt_id is distinct from p_attempt_id then raise exception using errcode='P0001',message='not_owner'; end if;
     case p_operation
     when 'initialize_traversal' then
       if c.continuation->>'phase' is distinct from 'uninitialized' then raise exception using errcode='P0001',message='already_initialized'; end if;
       current_cursor:=a.history_id;
       if current_cursor is not null then
         if current_cursor!~'^(0|[1-9][0-9]{0,19})$' then raise exception using errcode='P0001',message='invalid_legacy_cursor'; end if;
         if current_cursor::numeric>18446744073709551615 or (p_payload->>'captured_history_id')::numeric<current_cursor::numeric then raise exception using errcode='P0001',message='boundary_regression'; end if;
       end if;
       mode:=case when c.continuation->>'intent'='normal' and current_cursor is not null then 'history' else 'reconcile' end;
       c.continuation:=jsonb_build_object('version',(c.continuation->>'version')::integer,'phase','initialized','mode',mode,'origin_history_id',current_cursor,
         'fetch_policy',c.continuation->>'fetch_policy',
         'captured_history_id',p_payload->>'captured_history_id','captured_at',p_payload->>'captured_at',
         'page_size',p_payload->'page_size','query',null,
         'labels',case when c.continuation->>'version' in ('3','4') then jsonb_build_array('ALL') else jsonb_build_array('INBOX','SENT') end,
         'labels_state',case when c.continuation->>'version' in ('3','4') then
           jsonb_build_object('ALL',jsonb_build_object('next_page_token',null,'complete',false))
         else jsonb_build_object('INBOX',jsonb_build_object('next_page_token',null,'complete',false),
           'SENT',jsonb_build_object('next_page_token',null,'complete',false)) end);
     when 'checkpoint' then
       next_token:=p_payload->>'returned_next_page_token'; evidence:=p_payload->'page_evidence';
       if p_stream='recent' then
         label:=p_payload->>'label'; input_token:=p_payload->>'expected_input_page_token';
         if c.continuation->>'phase' is distinct from 'initialized' then raise exception using errcode='P0001',message='not_initialized'; end if;
         if not coalesce(case c.continuation->>'version'
           when '4' then label='ALL' and c.continuation->'labels'='["ALL"]'::jsonb
           when '3' then label='ALL' and c.continuation->'labels'='["ALL"]'::jsonb
           when '2' then label in ('INBOX','SENT') and c.continuation->'labels'='["INBOX","SENT"]'::jsonb
           else false end,false) then raise exception using errcode='P0001',message='page_conflict'; end if;
         if c.continuation#>>array['labels_state',label,'complete'] is distinct from 'false' or
           c.continuation#>>array['labels_state',label,'next_page_token'] is distinct from input_token then raise exception using errcode='P0001',message='page_conflict'; end if;
         if a.history_id is distinct from c.continuation->>'origin_history_id' then raise exception using errcode='P0001',message='cursor_conflict'; end if;
       else
         label:=null; input_token:=p_payload->>'expected_page_token';
         if a.backfill_status<>'running' or a.backfill_page_token is distinct from input_token or a.backfill_total_fetched<>(p_payload->>'expected_total')::integer then raise exception using errcode='P0001',message='page_conflict'; end if;
       end if;
       if next_token is not null and (next_token is not distinct from input_token or exists(
         select 1 from public.email_ingestion_transitions t where t.tenant_id=p_tenant_id and t.email_account_id=p_email_account_id
           and t.stream=p_stream and t.result_generation=c.generation and t.operation='checkpoint'
           and (t.request_document->'payload'->>'label') is not distinct from label
           and ((md5(coalesce(t.request_document->'payload'->>'expected_input_page_token',t.request_document->'payload'->>'expected_page_token'))=md5(next_token)
             and coalesce(t.request_document->'payload'->>'expected_input_page_token',t.request_document->'payload'->>'expected_page_token')=next_token)
           or (md5(t.request_document->'payload'->>'returned_next_page_token')=md5(next_token) and t.request_document->'payload'->>'returned_next_page_token'=next_token))
       )) then raise exception using errcode='P0001',message='pagination_no_progress'; end if;
       if p_stream='recent' then
         c.continuation:=jsonb_set(c.continuation,array['labels_state',label],jsonb_build_object('next_page_token',next_token,'complete',(p_payload->>'exhausted')::boolean));
         done:=case when c.continuation->>'version' in ('3','4') then (c.continuation#>>'{labels_state,ALL,complete}')::boolean
           else (c.continuation#>>'{labels_state,INBOX,complete}')::boolean and (c.continuation#>>'{labels_state,SENT,complete}')::boolean end;
         if done then update public.email_accounts set history_id=c.continuation->>'captured_history_id' where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
       else
         new_total:=a.backfill_total_fetched::bigint+(p_payload->>'listed_count')::bigint;
         if new_total>2147483647 then raise exception using errcode='P0001',message='total_overflow'; end if;
         done:=(p_payload->>'exhausted')::boolean;
         update public.email_accounts set backfill_page_token=next_token,backfill_total_fetched=new_total::integer,
           backfill_status=case when done then 'completed' else 'running' end,
           backfill_completed_at=case when done then now() else null end,backfill_error=null
           where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if;
       end if;
       new_total:=records::bigint+(evidence->>'message_upsert_count')::bigint;
       if new_total>2147483647 then raise exception using errcode='P0001',message='total_overflow'; end if;
       records:=new_total::integer;
       if done or (p_payload->>'yield_after_page')::boolean then
         c.state:=case when done then 'completed' else 'ready' end; c.owner_attempt_id:=null; terminal:=true; attempt_status:='success';
       end if;
     when 'release' then
       c.state:='ready'; c.owner_attempt_id:=null; terminal:=true; attempt_status:='success'; evidence:=p_payload->'attempt_evidence';
     when 'block' then
       c.state:='blocked'; c.owner_attempt_id:=null; c.block_code:=p_payload->>'error_code';
       terminal:=true; attempt_status:='failed'; error_code:=c.block_code; evidence:=p_payload->'attempt_evidence';
       if p_stream='historical' then update public.email_accounts set backfill_status='error',backfill_error=c.block_code where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
     else raise exception using errcode='22023',message='invalid_operation';
     end case;
   end case;
 end if;
 if changed then
   if c.revision=9223372036854775807 then raise exception using errcode='P0001',message='revision_exhausted'; end if;
   c.revision:=c.revision+1; c.updated_at:=now();
   if not exists_checkpoint then
     insert into public.email_ingestion_checkpoints(tenant_id,email_account_id,stream,contract_version,generation,revision,state,owner_attempt_id,continuation,block_code,created_at,updated_at)
     values(c.tenant_id,c.email_account_id,c.stream,c.contract_version,c.generation,c.revision,c.state,c.owner_attempt_id,c.continuation,c.block_code,c.created_at,c.updated_at);
   else
     update public.email_ingestion_checkpoints set generation=c.generation,revision=c.revision,state=c.state,
       owner_attempt_id=c.owner_attempt_id,continuation=c.continuation,block_code=c.block_code,updated_at=c.updated_at
       where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream;
     if not found then raise exception 'checkpoint update affected no row'; end if;
   end if;
 end if;
 if p_operation in ('block','release','finish_attempt') then
   -- These counts are attempt-wide known totals; NULL never overwrites with zero.
   confirmed_count:=(evidence->>'message_upsert_count')::integer;
   if confirmed_count is not null then
     if confirmed_count<records then raise exception using errcode='22023',message='count_regression'; end if;
     records:=confirmed_count;
   end if;
 end if;
 result:=jsonb_build_object('operation',p_operation,'attempt_id',p_attempt_id,'tenant_id',p_tenant_id,'email_account_id',p_email_account_id,'stream',p_stream,
   'checkpoint_present',c.tenant_id is not null,'generation',c.generation,'revision',c.revision::text,
   'checkpoint_state',c.state,'owner_attempt_id',c.owner_attempt_id,'attempt_status',attempt_status,
   'records_processed',records,'coverage_complete',done);
 insert into public.email_ingestion_transitions(tenant_id,email_account_id,stream,transition_id,operation,attempt_id,
   expected_generation,expected_revision,expected_owner_attempt_id,request_document,request_fingerprint,accepted_result,checkpoint_stream,result_generation,result_revision)
 values(p_tenant_id,p_email_account_id,p_stream,p_transition_id,p_operation,p_attempt_id,p_expected_generation,p_expected_revision,
   p_expected_owner_attempt_id,doc,md5(doc::text),result,case when c.tenant_id is not null then p_stream else null end,c.generation,c.revision);
 v_attempt_metadata:=attempt.metadata||jsonb_build_object('email_ingestion_v2',jsonb_build_object('contract_version',2,'stream',p_stream,
   'transition_id',p_transition_id,'operation',p_operation,'checkpoint_present',c.tenant_id is not null,'generation',c.generation,'revision',c.revision::text,
   'coverage_complete',done,'continuation_pending',c.state<>'completed','evidence',evidence,
   'classification',case when p_operation='finish_attempt' then p_payload->>'outcome' else null end));
 update public.email_sync_runs as target_run set status=attempt_status,completed_at=case when terminal then now() else null end,
   records_processed=records,error_message=error_code,metadata=v_attempt_metadata
   where target_run.id=p_attempt_id and target_run.tenant_id=p_tenant_id and target_run.status='running';
 if not found then raise exception 'attempt update disappeared'; end if;
 return jsonb_build_object('contract_version',2,'disposition','applied','code','transition_applied','transition_id',p_transition_id,
   'accepted_result',result,'current_checkpoint',public.email_ingestion_checkpoint_json_v2(c),'historical_receipt',false);
exception
 when invalid_parameter_value or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
   return jsonb_build_object('contract_version',2,'disposition','denied','code','invalid_request','transition_id',p_transition_id,'accepted_result',null,'current_checkpoint',null,'historical_receipt',false);
 when sqlstate 'P0001' then
   code:=sqlerrm;
   if code<>all(array['account_not_found','attempt_mismatch','transition_id_reused','attempt_terminal','source_ineligible','owner_must_release',
     'checkpoint_missing','legacy_state_invalid','checkpoint_conflict','invalid_recovery_state','explicit_recovery_required','already_claimed',
     'not_owner','already_initialized','invalid_legacy_cursor','boundary_regression','not_initialized','page_conflict','cursor_conflict',
     'pagination_no_progress','total_overflow','revision_exhausted','force_generation_busy','invalid_legacy_policy']) then raise; end if;
   -- Exception subtransaction rolled back ALL writes; never return staged c as current.
   return jsonb_build_object('contract_version',2,'disposition',case when code in ('account_not_found','attempt_mismatch','transition_id_reused','source_ineligible') then 'denied' else 'conflict' end,
     'code',code,'transition_id',p_transition_id,'accepted_result',null,'current_checkpoint',null,'historical_receipt',false);
end $function$
;

create or replace function public.learn_email_store_page(p_context jsonb,p_threads jsonb,p_messages jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare tenant uuid;thread_count integer;message_count integer;v jsonb;begin
 perform public.learn_email_store_guard(p_context,p_claimed_by,p_claim);
 tenant:=(p_context->>'tenant_id')::uuid;
 if jsonb_typeof(p_threads) is distinct from 'array' or jsonb_typeof(p_messages) is distinct from 'array'
  or jsonb_array_length(p_threads)>2000 or jsonb_array_length(p_messages)>2000
  or octet_length(p_threads::text)+octet_length(p_messages::text)>67108864
 then raise exception 'learn_email_store_rows_invalid' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_threads) loop
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>7
   or not(v ?& array['tenant_id','provider','provider_thread_id','subject','participants','last_message_at','updated_at'])
   or v->>'tenant_id' is distinct from tenant::text or v->>'provider' is distinct from 'gmail'
   or (not coalesce(v->>'provider_thread_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_thread_id')>256)
   or jsonb_typeof(v->'participants') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements(v->'participants')e where jsonb_typeof(e)<>'string')
   or jsonb_typeof(v->'subject') not in ('string','null') or jsonb_typeof(v->'last_message_at') is distinct from 'string'
  then raise exception 'learn_email_store_thread_invalid' using errcode='22023';end if;
 end loop;
 for v in select value from jsonb_array_elements(p_messages) loop
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>16
   or not(v ?& array['tenant_id','provider','provider_message_id','provider_thread_id','from_email','from_name','to_emails','cc_emails','subject','snippet','body_text','body_html','sent_at','received_at','direction','raw_payload'])
   or v->>'tenant_id' is distinct from tenant::text or v->>'provider' is distinct from 'gmail'
   or (not coalesce(v->>'provider_message_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_message_id')>256)
   or (not coalesce(v->>'provider_thread_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_thread_id')>256)
   or jsonb_typeof(v->'to_emails') is distinct from 'array' or jsonb_typeof(v->'cc_emails') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements((v->'to_emails')||(v->'cc_emails'))e where jsonb_typeof(e)<>'string')
   or jsonb_typeof(v->'raw_payload') is distinct from 'object' or jsonb_typeof(v->'direction') is distinct from 'string' or not coalesce(v->>'direction' in ('inbound','outbound') or (v->>'direction'='unknown' and v->'raw_payload'->'label_ids' @> '["DRAFT"]'::jsonb and v->'sent_at'='null'::jsonb),false)
   or exists(select 1 from jsonb_each(v)e where e.key=any(array['from_email','from_name','subject','snippet','body_text','body_html','sent_at','received_at']) and jsonb_typeof(e.value) not in ('string','null'))
  then raise exception 'learn_email_store_message_invalid' using errcode='22023';end if;
 end loop;
 -- Each thread summary must come from a message in this page and vice versa.
 if exists(select 1 from jsonb_array_elements(p_messages)m where not exists(select 1 from jsonb_array_elements(p_threads)t where t->>'provider_thread_id'=m->>'provider_thread_id'))
  or exists(select 1 from jsonb_array_elements(p_threads)t where not exists(select 1 from jsonb_array_elements(p_messages)m where m->>'provider_thread_id'=t->>'provider_thread_id'))
  or (select count(distinct elem->>'provider_thread_id') from jsonb_array_elements(p_threads)elem)<>jsonb_array_length(p_threads)
  or (select count(distinct elem->>'provider_message_id') from jsonb_array_elements(p_messages)elem)<>jsonb_array_length(p_messages)
 then raise exception 'learn_email_store_page_mismatch' using errcode='22023';end if;
 -- Mailbox history IDs are not comparable across accounts. A discovered
 -- cross-account source collision requires review, never silent replacement.
 if exists(select 1 from jsonb_array_elements(p_messages)entry join public.email_messages m
  on m.tenant_id=tenant and m.provider='gmail' and m.provider_message_id=entry->>'provider_message_id'
  where m.raw_payload ? 'provider_account_id' and m.raw_payload->>'provider_account_id' is distinct from p_context->>'email_account_id')
 then raise exception 'learn_email_store_mailbox_collision' using errcode='PT409';end if;
 insert into public.email_threads as retained(tenant_id,provider,provider_thread_id,subject,participants,last_message_at)
 select tenant,'gmail',x.provider_thread_id,x.subject,x.participants,x.last_message_at
 from jsonb_populate_recordset(null::public.email_threads,p_threads)x order by x.provider_thread_id
 on conflict(tenant_id,provider,provider_thread_id) do update set
  subject=case when retained.last_message_at is null or excluded.last_message_at>retained.last_message_at then coalesce(excluded.subject,retained.subject) else retained.subject end,
  last_message_at=greatest(retained.last_message_at,excluded.last_message_at),
  participants=(select coalesce(jsonb_agg(distinct e order by e),'[]') from jsonb_array_elements(retained.participants||excluded.participants)e);
 get diagnostics thread_count=row_count;
 insert into public.email_messages as retained(tenant_id,provider,provider_message_id,provider_thread_id,from_email,from_name,to_emails,cc_emails,subject,snippet,body_text,body_html,sent_at,received_at,direction,raw_payload)
 select tenant,'gmail',x.provider_message_id,x.provider_thread_id,x.from_email,x.from_name,x.to_emails,x.cc_emails,x.subject,x.snippet,x.body_text,x.body_html,x.sent_at,x.received_at,x.direction,x.raw_payload||jsonb_build_object('provider_account_id',p_context->>'email_account_id')
 from jsonb_populate_recordset(null::public.email_messages,p_messages)x order by x.provider_message_id
 on conflict(tenant_id,provider,provider_message_id) do update set
  provider_thread_id=excluded.provider_thread_id,from_email=coalesce(excluded.from_email,retained.from_email),from_name=coalesce(excluded.from_name,retained.from_name),
  to_emails=excluded.to_emails,cc_emails=excluded.cc_emails,subject=coalesce(excluded.subject,retained.subject),snippet=coalesce(excluded.snippet,retained.snippet),
  body_text=coalesce(excluded.body_text,retained.body_text),body_html=coalesce(excluded.body_html,retained.body_html),sent_at=case when excluded.direction='unknown' and excluded.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb then null else coalesce(excluded.sent_at,retained.sent_at) end,received_at=coalesce(excluded.received_at,retained.received_at),direction=excluded.direction,raw_payload=retained.raw_payload||excluded.raw_payload||case when excluded.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$' then jsonb_build_object('provider_availability','available','provider_observed_history_id',excluded.raw_payload->>'history_id') else '{}'::jsonb end
 where p_context->>'fetch_policy'='refetch_all'
  and case when retained.raw_payload->>'provider_observed_history_id'~'^(0|[1-9][0-9]{0,19})$'
    then case when excluded.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
      then (excluded.raw_payload->>'history_id')::numeric >= (retained.raw_payload->>'provider_observed_history_id')::numeric else false end
    else true end
  and case when retained.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
    then case when excluded.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
      then (excluded.raw_payload->>'history_id')::numeric >= (retained.raw_payload->>'history_id')::numeric else false end
    else true end;
 get diagnostics message_count=row_count;
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'message_upsert_count',message_count,'thread_upsert_count',thread_count);
end $$;

-- Prior message versions are private source history, never client-readable snapshots.
-- No backfill: versions are appended only when retained source fields actually change.
create table public.learn_email_source_versions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 email_message_id uuid not null references public.email_messages(id),
 captured_at timestamptz not null default clock_timestamp(),
 source_row jsonb not null check(jsonb_typeof(source_row)='object')
);
alter table public.learn_email_source_versions enable row level security;
revoke all on public.learn_email_source_versions from public,anon,authenticated,service_role;
create index learn_email_source_versions_message on public.learn_email_source_versions(tenant_id,email_message_id,captured_at);
create function public.learn_email_preserve_source_version() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if old.provider='gmail' and (to_jsonb(old)-'updated_at') is distinct from (to_jsonb(new)-'updated_at') then
  insert into public.learn_email_source_versions(tenant_id,email_message_id,source_row)
   values(old.tenant_id,old.id,to_jsonb(old));
 end if;
 return new;
end $$;
revoke all on function public.learn_email_preserve_source_version() from public,anon,authenticated,service_role;
create trigger learn_email_preserve_source_version before update on public.email_messages
for each row execute function public.learn_email_preserve_source_version();

-- This is a provider-presence observation, not permission to delete local history.
-- A confirmed 404/410 is bounded by the traversal boundary, not by an invented
-- deletion timestamp. A newer stored history ID wins over an older traversal.
create function public.learn_email_store_unavailable(p_context jsonb,p_ids jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.email_ingestion_checkpoints%rowtype; boundary text; observed integer;
begin
 perform public.learn_email_store_guard(p_context,p_claimed_by,p_claim);
 select * into strict c from public.email_ingestion_checkpoints
  where tenant_id=(p_context->>'tenant_id')::uuid and email_account_id=(p_context->>'email_account_id')::uuid and stream='recent';
 if p_context->>'stream'<>'recent' or c.continuation->>'version' is distinct from '4'
  or jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>2000
  or exists(select 1 from jsonb_array_elements(p_ids)e where jsonb_typeof(e)<>'string' or (not (e#>>'{}')~'^[a-zA-Z0-9_-]+$' or length(e#>>'{}')>256))
  or (select count(distinct value) from jsonb_array_elements(p_ids))<>jsonb_array_length(p_ids)
 then raise exception 'learn_email_availability_invalid' using errcode='22023';end if;
 boundary:=c.continuation->>'captured_history_id';
 if not coalesce(boundary~'^(0|[1-9][0-9]{0,19})$',false) or boundary::numeric>18446744073709551615 then
  raise exception 'learn_email_availability_boundary_invalid' using errcode='22023';end if;
 update public.email_messages m set raw_payload=m.raw_payload||jsonb_build_object(
   'provider_availability','unavailable','provider_observed_history_id',boundary)
 where m.tenant_id=(p_context->>'tenant_id')::uuid and m.provider='gmail'
  and m.raw_payload->>'provider_account_id'=p_context->>'email_account_id'
  and m.provider_message_id in(select jsonb_array_elements_text(p_ids))
  and case when m.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$' then (m.raw_payload->>'history_id')::numeric<=boundary::numeric else true end
  and case when m.raw_payload->>'provider_observed_history_id'~'^(0|[1-9][0-9]{0,19})$' then (m.raw_payload->>'provider_observed_history_id')::numeric<=boundary::numeric else true end
  and (m.raw_payload->>'provider_availability' is distinct from 'unavailable' or m.raw_payload->>'provider_observed_history_id' is distinct from boundary);
 get diagnostics observed=row_count;
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'observed_count',observed);
end $$;
revoke all on function public.learn_email_store_unavailable(jsonb,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.learn_email_store_unavailable(jsonb,jsonb,text,integer) to service_role;

revoke create on schema public from email_ingestion_protocol_owner;
revoke email_ingestion_protocol_owner from postgres;
insert into of_learn_deploy.migrations values('learn_email_capture_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
