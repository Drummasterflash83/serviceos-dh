-- DRAFT production Slack intake/recovery. No provider access or activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Slack target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_scoring_working_time_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='d69899c63c83bfb974282599ffa4a6183b29e8f53b652796459d2c1e235ae066') then raise exception 'Pinned production scoring prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_intake_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['slack_messages','slack_message_versions','slack_history_imports','slack_thread_imports','slack_workspace_pacing','slack_recurring_channels','slack_recurring_requests','slack_recurring_thread_windows','slack_recurring_thread_members']))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['slack_version_immutable','slack_history_commit_page','learn_slack_start_import','learn_slack_claim_jobs','learn_slack_finish_job','learn_slack_read_credential','learn_slack_thread_immutable','learn_slack_start_thread_import','slack_thread_commit_page','learn_slack_read_thread_credential','learn_slack_finish_thread_job','learn_slack_accounts_read','learn_slack_threads_read','learn_slack_history_state','learn_slack_history_read','learn_slack_resume_history','learn_slack_thread_recovery_state','learn_slack_thread_recovery_read','learn_slack_resume_thread','learn_capture_allowed','learn_slack_recurring_access','learn_slack_recurring_control','learn_slack_schedule_recurring','learn_slack_recurring_read','learn_slack_recurring_threads_control','learn_slack_recurring_thread_allowed','learn_slack_recurring_thread_window_progress','learn_slack_recurring_thread_window_complete','learn_slack_recurring_threads_status','learn_slack_queue_recurring_threads','learn_slack_commit_page_private','learn_slack_store_records'])) then
 raise exception 'Production Slack candidate already exists; inspect before retry';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['tenants','profiles','team_members','view_as_context','platform_authority_grants','feature_flags','tenant_connectors','connector_accounts','provider_connections','provider_connection_events','platform_jobs','interactions']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"connector_accounts","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_connector_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"account_key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"settings","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"sync_cursor","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"last_successful_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_failed_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"87038fc7b898fc166bc4afe6e3808ea0","name":"connector_accounts_pkey","valid":true},{"hash":"65449ecbc756cb8abd7ec274359ed101","name":"connector_accounts_tenant_connector_id_account_key_key","valid":true},{"hash":"2b651203438a7f6b7dc3805be39fb611","name":"connector_accounts_tenant_connector_idx","valid":true},{"hash":"a366fa56cd9ccf2d01e76c6c91dd58b6","name":"connector_accounts_tenant_id_idx","valid":true}],"forceRls":false,"policies":[{"name":"connector_accounts_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"11bff68c3a6c7d3d8917929650c7c634","name":"connector_accounts_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"connector_accounts_pkey","validated":true},{"hash":"ce81b1bbe8e19e1ef8737b2016099474","kind":"u","name":"connector_accounts_tenant_connector_id_account_key_key","validated":true},{"hash":"1dec77e8d0a31578e156b528a94701f7","kind":"f","name":"connector_accounts_tenant_connector_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"feature_flags","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"flag","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"value","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"version_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2e8d1320288e4f240aabeaf4c772df0d","name":"feature_flags_natural_uk","valid":true},{"hash":"4a37620023f13aecfadf61f85ed52394","name":"feature_flags_pkey","valid":true}],"forceRls":false,"policies":[{"name":"ff_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"4da561cf20b60ddd6d041662476ff459","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"feature_flags_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"feature_flags_tenant_id_fkey","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"feature_flags_version_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"interactions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_connector_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_table","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"interaction_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"summary","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_preview","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_address","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_addresses","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"cc_addresses","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"phone_from","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"phone_to","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"processing_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"sentiment","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_task_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"source_updated_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_version","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"386b7aa4a596d1f7a436f82ee5cd30d1","name":"interactions_pkey","valid":true},{"hash":"e9634fa8eca4b28f9d63657404df3fae","name":"interactions_related_campaign_idx","valid":true},{"hash":"8eaaf68213fe01dc3342f1135af48b37","name":"interactions_tenant_company_idx","valid":true},{"hash":"344e9c6e9a40d3f4cc5ffdd75d892e06","name":"interactions_tenant_connector_occurred_idx","valid":true},{"hash":"78eb70cc7e2fa21d550574b7d7fd2567","name":"interactions_tenant_id_source_table_source_id_key","valid":true},{"hash":"b872f2d916dee27b2d740a273b3a3a86","name":"interactions_tenant_occurred_idx","valid":true},{"hash":"9ab02b39c0a9dcb409371595dd22b317","name":"interactions_tenant_person_idx","valid":true},{"hash":"9026abb0805ac33730d78a21bdc85364","name":"interactions_tenant_processing_idx","valid":true},{"hash":"60847df577987b97a1aa8e49893f6740","name":"interactions_tenant_type_occurred_idx","valid":true},{"hash":"cfa31edad77dc169ce86ec6f0bb18c10","name":"interactions_tenant_type_source_idx","valid":true}],"forceRls":false,"policies":[{"name":"interactions_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"3b4c64fd9157e1dab30e91b351a56128","name":"interactions_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"interactions_pkey","validated":true},{"hash":"2e6cb81b96ef1f338484943fdb13da96","kind":"f","name":"interactions_related_campaign_fk","validated":true},{"hash":"2dc4fa1294c5cf8d6796d8b4c37f0fa0","kind":"u","name":"interactions_tenant_id_source_table_source_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_authority_grants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"profile_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"permission","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"granted_by","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc97b758bffd09b45099ebab12c88e76"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"7203023825de39b8d2b239a3df06b89c","name":"pag_active_uk","valid":true},{"hash":"7815833259b2bc3637228c97fbc18e9a","name":"pag_profile","valid":true},{"hash":"075f7de621b125970296a39f8ad10de6","name":"platform_authority_grants_pkey","valid":true}],"forceRls":false,"policies":[{"name":"platform_authority_grants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"ab3044cecbbd365f8b11b781f958e96f","permissive":"PERMISSIVE"}],"triggers":[{"hash":"63a86109bbf433dc05eee635c79ddd44","name":"pag_set_updated_at","enabled":"O"}],"constraints":[{"hash":"6955543725589d3d6e35aa41f8b28493","kind":"f","name":"platform_authority_grants_permission_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_authority_grants_pkey","validated":true},{"hash":"f988a65e629c3c1eeeeabe337f44b428","kind":"f","name":"platform_authority_grants_profile_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"module_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"job_key","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"7c86ea6e5094355ad44b6867fa51b433"},{"name":"priority","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"f899139df5e1059396431415e770c6dd"},{"name":"progress_current","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"progress_total","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"attempt_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"max_attempts","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"eccbc87e4b5ce2fe28308fd9f2a7baf3"},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"failed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cancelled_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"next_run_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"result","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"available_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"lease_expires_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"dead_lettered_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"error_code","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"parent_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"e8ec53579fc23c9f8c7ec9cbcc9a0fe8","name":"platform_jobs_active_job_key_uk","valid":true},{"hash":"0c8ea2ecee43cf1b569083bac92b3889","name":"platform_jobs_claim_idx","valid":true},{"hash":"95f16cdddc29e798beb223f90905fec3","name":"platform_jobs_lease_idx","valid":true},{"hash":"a2be2946f7e3402dc0501da0f336f113","name":"platform_jobs_parent_idx","valid":true},{"hash":"f8699761f53393f77b94bc724a99e825","name":"platform_jobs_pkey","valid":true},{"hash":"95bfc00526e7f302fb99702339694c04","name":"platform_jobs_tenant_connector_idx","valid":true},{"hash":"1ed91a0d9b3bf296158e7c4558ce3189","name":"platform_jobs_tenant_next_run_idx","valid":true},{"hash":"a22868c903eedcb64e7366fb3249911f","name":"platform_jobs_tenant_status_idx","valid":true},{"hash":"a3359af1d6c9ed909e3b424d77e7a174","name":"platform_jobs_tenant_type_idx","valid":true}],"forceRls":false,"policies":[{"name":"platform_jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"885bc7f92806b78eac67d45a9143c9ca","name":"platform_jobs_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_jobs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"full_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ebe5151db32cb9795191097a4f9511a9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b7142bbffc23de763c1bd9f00489ec05","name":"profiles_pkey","valid":true},{"hash":"c07a523f1ebc968ab6b32bd5c984f32b","name":"profiles_role_idx","valid":true},{"hash":"610436088a5788625dd6956b9059f8c9","name":"profiles_tenant_id_idx","valid":true},{"hash":"84b975915f84814cf35c7604d4f94ecf","name":"profiles_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_profile","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"profiles_select_own","roles":["public"],"command":"SELECT","checkHash":null,"usingHash":"bc9c729a84690340789a4e4f01175335","permissive":"PERMISSIVE"}],"triggers":[{"hash":"bb3752d7064fd9e06fbe457f475928cc","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"83b0936855bf3bb7daa4f8356eb3c926","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a97ecad600d272e906bb06dea0b91c4","name":"profiles_set_updated_at","enabled":"O"}],"constraints":[{"hash":"0061c9fb3a9abcf2edbcd4a42467a9c3","kind":"f","name":"profiles_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"profiles_pkey","validated":true},{"hash":"4b3bd90c7f38a26788aecebbe2479ad7","kind":"c","name":"profiles_role_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"provider_connection_events","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"event","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"detail","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"922082f60531c1908713a0e5370d9be6","name":"provider_connection_events_pkey","valid":true},{"hash":"0d33b21429d031aa957f749f757bf264","name":"provider_connection_events_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"provider_connection_events_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"provider_connection_events_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"provider_connections","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"0559cbfcad8ccb1a01b1bc92200b821a"},{"name":"auth_mode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"account_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"non_secret_config","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"configured_fields","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"secret_refs","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"verified_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_test","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"updated_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"revoked_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"revoked_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"36a25605cb477bfe7168236a8e6b767f","name":"provider_connections_pkey","valid":true},{"hash":"3f743b104a717ded94bace2427a3c30e","name":"provider_connections_tenant_provider_uk","valid":true}],"forceRls":false,"policies":[{"name":"provider_connections_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"887c6c309bc52d55fe3e3bfef5fd54ac","name":"provider_connections_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"provider_connections_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"team_members","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"profile_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"org_unit_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"formal_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"observed_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"observed_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c52f9c62eaaccb25ee4a31f5d7985d5f"},{"name":"authority_level","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"af8c0c74e3183c2818bc9d953905fd3b"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc1aa1465ec03c693f1c71ed37ae624c"},{"name":"confirmed_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confirmed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"702f51d0616b95af6acceac770041d90","name":"team_members_id_tenant_uk","valid":true},{"hash":"3050f5b55154f2c1f333d5ac4620ed9f","name":"team_members_pkey","valid":true},{"hash":"4c7c3c5008c60803c6e0cdc1c63d4724","name":"team_members_profile","valid":true},{"hash":"d1291cf097138ed6a8e370ba09879e2c","name":"team_members_tenant","valid":true}],"forceRls":false,"policies":[{"name":"team_members_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"20470c2fa4bfa1cfd511bff609c9327a","name":"learn_capture_member_change","enabled":"O"},{"hash":"1f88777e8f895faa6f75f677f577a205","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"81116ed1f8bd3359a358eb8c192755eb","name":"learn_member_no_delete","enabled":"O"},{"hash":"4903df4fb40be1ac178cfdf9148826be","name":"learn_member_no_truncate","enabled":"O"},{"hash":"d45827f37e95f2ee646f5f6fa087fd33","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"d436df6318ac765e417b873eaff97451","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"b419d5db1c118ff5d4e1f4a175ef311a","name":"team_members_set_updated_at","enabled":"O"}],"constraints":[{"hash":"ff1dd41640b0c5def6891c12630f5f29","kind":"c","name":"team_members_authority_level_check","validated":true},{"hash":"fe05d9f5fdc7c955f732c72e312b120c","kind":"c","name":"team_members_confidence_check","validated":true},{"hash":"0b3438f4f2c60569832a789b448f8a4d","kind":"c","name":"team_members_observed_status_check","validated":true},{"hash":"c773fa58011794721f1db6b5021ef422","kind":"f","name":"team_members_org_unit_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"team_members_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"team_members_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenant_connectors","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"category","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"5dbf8349d9384bba7422dab65d75d428"},{"name":"health_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"enabled","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"settings","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"last_successful_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_failed_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2a999164558672de593a5cee2ad1199a","name":"tenant_connectors_pkey","valid":true},{"hash":"6909a1d595c44c251b88ae925a11c1ed","name":"tenant_connectors_tenant_id_connector_id_key","valid":true},{"hash":"b0d64bed4b9196a44db82e7ae165547f","name":"tenant_connectors_tenant_id_idx","valid":true}],"forceRls":false,"policies":[{"name":"tenant_connectors_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"05f7b4b7a819d47c4f9215eed99d9365","name":"tenant_connectors_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenant_connectors_pkey","validated":true},{"hash":"24cb83f88599181c6922a60d2bfb8328","kind":"u","name":"tenant_connectors_tenant_id_connector_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"slug","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"industry","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5284b9c618f8618b72a402ea2c593753","name":"tenants_pkey","valid":true},{"hash":"6260c986ce2d58a0ad3de3f74ec6eb6f","name":"tenants_slug_key","valid":true}],"forceRls":false,"policies":[{"name":"tenants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"831f798d620de1d73971187d41079b4d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8009f8efa07661ab809d3f9e077da55e","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"742cd63e2f0ed7809f0911b17d02869d","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a4d62ca55c88b97023eab7696e527ce","name":"tenants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenants_pkey","validated":true},{"hash":"687397275d0e852fb2a4b50394adffee","kind":"u","name":"tenants_slug_key","validated":true},{"hash":"7702cc7b97df1ebce81e13bb05db5c2d","kind":"c","name":"tenants_status_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"view_as_context","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor_user_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"mode","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d3f83345a22c6bbd79692e353599f18"},{"name":"read_only","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"expires_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"dae782846028bc8168db98a8dd4b9193"},{"name":"ended_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5325064a8cf3f1e500b2308ea36b3343","name":"view_as_actor","valid":true},{"hash":"3b4560fae7e0f79297469f029ab77627","name":"view_as_context_pkey","valid":true}],"forceRls":false,"policies":[{"name":"view_as_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"565594dabafccb3adbde49e7a3f8790a","permissive":"PERMISSIVE"}],"triggers":[{"hash":"aaf4c57e4c5a9674a6979f95139e4746","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"1b0ebc4a05c69edafb63e927ba619765","name":"learn_work_authority_truncate_lock","enabled":"O"}],"constraints":[{"hash":"db8d41fae95b78d4a530a37cc023f719","kind":"c","name":"view_as_context_mode_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"view_as_context_pkey","validated":true},{"hash":"9579aceb86350661ce8f9dd1b4211a9b","kind":"c","name":"view_as_context_subject_kind_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"view_as_context_tenant_id_fkey","validated":true}]}]'::jsonb then raise exception 'Production Slack table baseline differs';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['platform_jobs_claim','current_tenant_id','current_user_role','current_user_is_openfolk_operator','learn_foundation_reference_guard','set_updated_at']);
 if actual_helpers is distinct from '[{"hash":"58873c19368521e21e846890ee429301","name":"current_tenant_id","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"e902fd2c89c12fda752bf28e32acfcb3","name":"current_user_is_openfolk_operator","owner":"postgres","arguments":"required_permission text","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"760512ca1d1f925421f3faf36e9d4447","name":"current_user_role","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"c42b841a4e53ba5ba7580f340c9bd465","name":"learn_foundation_reference_guard","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"4a6f7c4f01eac6bf5615e4fe2d218501","name":"platform_jobs_claim","owner":"postgres","arguments":"p_worker text, p_batch integer, p_lease_seconds integer, p_job_types text[]","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"4d6804d5850641a33867814c9e76a714","name":"set_updated_at","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true}]'::jsonb then raise exception 'Production Slack helper baseline differs';end if;
 if not exists(select 1 from pg_extension where extname='supabase_vault' and extversion='0.3.1') or not has_schema_privilege('postgres','vault','USAGE') or not has_table_privilege('postgres','vault.decrypted_secrets','SELECT') then raise exception 'Existing Vault prerequisite unavailable';end if;
 if exists(select 1 from connector_accounts a left join tenant_connectors c on c.id=a.tenant_connector_id where c.id is null or a.tenant_id<>c.tenant_id) then raise exception 'Existing connector references require review';end if;
end $$;
-- Existing connector tables, policies and grants remain intact. Tenant FKs,
-- same-company references and retained metadata/audit guards are additive.
-- INPUT supabase/release/learn-test/009_slack_storage_setup.sql
-- SOURCE 20261029130000_learn_slack_history.sql
-- Original SHA-256 8e2517ca0f01b5ef660b5e431bae7988704f3c08fb6bfadd6a2e3cd837b26656
-- LEARN: additive storage for approved bounded Slack channel-history reads.
-- Apply only after target schema review. Does not enable a connection, grant
-- Slack scopes, schedule a job, change email/phone data or fetch a provider.

create table public.slack_messages (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 source_external_id text not null,
 team_id text not null,
 channel_id text not null,
 provider_timestamp text not null,
 thread_timestamp text,
 message_text text not null,
 provider_payload jsonb not null,
 source_version text not null,
 source_updated_at numeric not null,
 unique(tenant_id,id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(tenant_id, source_external_id)
);
alter table public.slack_messages enable row level security;
-- Retain every observed version. Replaying the same provider content is a no-op.
create table public.slack_message_versions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 message_id uuid not null,
 foreign key(tenant_id,message_id) references public.slack_messages(tenant_id,id),
 source_version text not null,
 provider_payload jsonb not null,
 observed_at timestamptz not null default now(),
 unique(tenant_id,message_id,source_version)
);
alter table public.slack_message_versions enable row level security;
create policy slack_messages_read on public.slack_messages for select to authenticated
 using(tenant_id=public.current_tenant_id());
create policy slack_versions_read on public.slack_message_versions for select to authenticated
 using(tenant_id=public.current_tenant_id());
revoke all on public.slack_messages,public.slack_message_versions from public,anon,authenticated,service_role;
grant select on public.slack_messages,public.slack_message_versions to authenticated;
grant select,insert,update on public.slack_messages to service_role;
grant select,insert on public.slack_message_versions to service_role;
create function public.slack_version_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Slack source versions are immutable' using errcode='55000'; end $$;
create trigger slack_versions_immutable before update or delete on public.slack_message_versions
 for each row execute function public.slack_version_immutable();


create or replace function public.slack_history_commit_page(
 p_tenant_id uuid,p_job_id uuid,p_account_id uuid,
 p_expected jsonb,p_next jsonb,p_records jsonb
) returns boolean language plpgsql security invoker set search_path=public as $$
declare
 a public.connector_accounts%rowtype;
 cfg jsonb;
 c public.tenant_connectors%rowtype;
 r jsonb;
 sid uuid;
 scope_identity jsonb;
 version_hash text;
 provider_updated numeric;
 current_version text;
 seen text[]:=array[]::text[];
begin
 if p_tenant_id is null or p_job_id is null or p_account_id is null then raise exception 'history_identity_required'; end if;
 if auth.role() is distinct from 'service_role' then raise exception 'history_service_role_required'; end if;
 if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_next) is distinct from 'object'
  or not (p_expected ?& array['scopeKey','cursor','pages','complete'])
  or not (p_next ?& array['scopeKey','cursor','pages','complete'])
  or jsonb_typeof(p_expected->'pages') is distinct from 'number'
  or jsonb_typeof(p_next->'pages') is distinct from 'number'
  or jsonb_typeof(p_expected->'complete') is distinct from 'boolean'
  or jsonb_typeof(p_next->'complete') is distinct from 'boolean'
  or (p_expected->>'pages') !~ '^[0-9]+$' or (p_next->>'pages') !~ '^[0-9]+$'
  or jsonb_typeof(p_expected->'scopeKey') is distinct from 'string'
  or jsonb_typeof(p_next->'scopeKey') is distinct from 'string'
  or jsonb_typeof(p_expected->'cursor') not in ('null','string')
  or jsonb_typeof(p_next->'cursor') not in ('null','string')
  or (select count(*) from jsonb_object_keys(p_expected))<>4
  or (select count(*) from jsonb_object_keys(p_next))<>4
  or (p_expected->>'pages')::integer<0
 then raise exception 'history_checkpoint_invalid'; end if;
 -- Lock authoritative job and account; concurrent checkpoint or revocation is
 -- serialised. The worker's own lifecycle owns completion/retry/dead-letter.
 perform 1 from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id
  and status='running' and job_type='slack.history_sync'
  and payload->>'connector_account_id'=p_account_id::text for update;
 if not found then raise exception 'history_job_unavailable'; end if;
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id for update;
 if not found or a.status<>'active' then raise exception 'history_account_unavailable'; end if;
 select * into c from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id for update;
 if not found or c.connector_id<>'slack' or not c.enabled or c.status<>'active' then raise exception 'history_connector_unavailable'; end if;
 cfg=a.settings->'slack_history';
 if cfg is null or cfg->'approved' is distinct from 'true'::jsonb
  or jsonb_typeof(cfg->'maxPages') is distinct from 'number'
  or length(btrim(cfg->>'consentReference')) not between 1 and 2000
  or coalesce(cfg->>'maxPages','') !~ '^[1-9]$|^10$' or coalesce(cfg->>'consentReference','')=''
  or coalesce(cfg->>'teamId','') !~ '^T[A-Z0-9]+$'
  or coalesce(cfg->>'channelId','') !~ '^C[A-Z0-9]+$'
  or coalesce(cfg->>'oldest','') !~ '^\d{1,12}\.\d{1,6}$'
  or coalesce(cfg->>'latest','') !~ '^\d{1,12}\.\d{1,6}$'
  or (cfg->>'oldest')::numeric>(cfg->>'latest')::numeric
  or (cfg->>'latest')::numeric-(cfg->>'oldest')::numeric>86400
  or cfg->>'expiresAt' is null or (cfg->>'expiresAt')::timestamptz<=clock_timestamp()
 then raise exception 'history_scope_unavailable'; end if;
 -- Recheck the credential connection inside the same transaction as publication.
 -- A revoke after the HTTP response must not publish against a disabled connection.
 perform 1 from public.provider_connections where id=(cfg->>'connectionId')::uuid
  and tenant_id=p_tenant_id and provider='slack' and status='configured'
  and revoked_at is null and non_secret_config->>'team_id'=cfg->>'teamId' for share;
 if not found then raise exception 'history_connection_unavailable'; end if;
 scope_identity=jsonb_build_array(p_tenant_id::text,cfg->>'teamId',cfg->>'channelId',cfg->>'oldest',cfg->>'latest',cfg->>'consentReference');
 if (p_expected->>'scopeKey')::jsonb is distinct from scope_identity
  or p_next->>'scopeKey' is distinct from p_expected->>'scopeKey'
  or (p_next->>'pages')::integer<>(p_expected->>'pages')::integer+1
  or (p_next->>'pages')::integer>least(10,(cfg->>'maxPages')::integer)
  or (p_expected->>'complete')::boolean
  or p_next->>'complete' not in ('true','false')
  or (p_next->>'complete')::boolean and p_next->>'cursor' is not null
  or not (p_next->>'complete')::boolean and coalesce(p_next->>'cursor','')=''
  or length(coalesce(p_next->>'cursor',''))>1024
  or p_next->>'cursor' is not null and p_next->>'cursor'=p_expected->>'cursor'
  or length(coalesce(p_expected->>'cursor',''))>1024
 then raise exception 'history_checkpoint_invalid'; end if;
 if a.sync_cursor is distinct from p_expected then
  if a.sync_cursor<>'{}'::jsonb or p_expected->>'cursor' is not null
   or (p_expected->>'pages')::integer<>0 then raise exception 'history_checkpoint_conflict'; end if;
 end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>15 then raise exception 'history_page_invalid'; end if;
 for r in select value from jsonb_array_elements(p_records) loop
  if r->>'tenant_id' is distinct from p_tenant_id::text
   or r->>'channel_id' is distinct from cfg->>'channelId'
   or r->>'source_external_id' is distinct from concat(cfg->>'teamId',':',cfg->>'channelId',':',r->>'provider_timestamp')
   or coalesce(r->>'provider_timestamp','') !~ '^\d{1,12}\.\d{1,6}$'
   or (r->>'provider_timestamp')::numeric<(cfg->>'oldest')::numeric
   or (r->>'provider_timestamp')::numeric>(cfg->>'latest')::numeric
   or r->>'provider_timestamp'=any(seen)
   or r->>'thread_timestamp' is not null and r->>'thread_timestamp' !~ '^\d{1,12}\.\d{1,6}$'
   or jsonb_typeof(r->'provider_payload') is distinct from 'object'
   or octet_length((r->'provider_payload')::text)>262144
   or r->'provider_payload'->>'ts' is distinct from r->>'provider_timestamp'
   or r->'provider_payload'->>'text' is distinct from r->>'text'
   or r->'provider_payload'->'edited' is not null and (coalesce(r->'provider_payload'->'edited'->>'ts','') !~ '^\d{1,12}\.\d{1,6}$')
   or r->'provider_payload'->>'thread_ts' is distinct from r->>'thread_timestamp'
   or jsonb_typeof(r->'text') is distinct from 'string' or length(r->>'text')>40000
  then raise exception 'history_record_invalid'; end if;
  seen=array_append(seen,r->>'provider_timestamp');
  version_hash=encode(sha256(convert_to((r->'provider_payload')::text,'UTF8')),'hex');
  provider_updated=coalesce(r->'provider_payload'->'edited'->>'ts',r->>'provider_timestamp')::numeric;
  if provider_updated<(r->>'provider_timestamp')::numeric then raise exception 'history_edit_timestamp_invalid'; end if;
  sid=md5(p_tenant_id::text||':'||(r->>'source_external_id'))::uuid;
  insert into public.slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,thread_timestamp,message_text,provider_payload,source_version,source_updated_at)
   values(sid,p_tenant_id,r->>'source_external_id',cfg->>'teamId',cfg->>'channelId',r->>'provider_timestamp',r->>'thread_timestamp',r->>'text',r->'provider_payload',version_hash,provider_updated)
   on conflict(tenant_id,source_external_id) do update set message_text=excluded.message_text,thread_timestamp=excluded.thread_timestamp,provider_payload=excluded.provider_payload,source_version=excluded.source_version,source_updated_at=excluded.source_updated_at,updated_at=now()
   where slack_messages.source_updated_at<=excluded.source_updated_at and slack_messages.source_version is distinct from excluded.source_version;
  insert into public.slack_message_versions(tenant_id,message_id,source_version,provider_payload)
   values(p_tenant_id,sid,version_hash,r->'provider_payload') on conflict do nothing;
  select source_version into current_version from public.slack_messages where id=sid and tenant_id=p_tenant_id;
  if current_version<>version_hash then continue; end if; -- Older replay is retained, not made current.
  -- Reuse the single existing interaction/observation engine. No AI execution,
  -- event fan-out or consequential follow-on jobs are introduced by this page.
  insert into public.interactions(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,interaction_type,direction,occurred_at,body_preview,metadata)
   values(p_tenant_id,'slack','chat','slack_messages',sid,r->>'source_external_id','slack_message','unknown',to_timestamp((r->>'provider_timestamp')::numeric),left(r->>'text',2000),jsonb_build_object('channel_id',cfg->>'channelId','coverage','bounded_history_page','threads','unverified','source_version',version_hash))
   on conflict(tenant_id,source_table,source_id) do update set body_preview=excluded.body_preview,metadata=interactions.metadata||excluded.metadata,
    processing_status=case when interactions.metadata->>'source_version' is distinct from excluded.metadata->>'source_version' then 'pending' else interactions.processing_status end
   where interactions.metadata->>'source_version' is distinct from excluded.metadata->>'source_version';
 end loop;
 update public.connector_accounts set sync_cursor=p_next where id=p_account_id and tenant_id=p_tenant_id;
 return true;
end $$;

revoke all on function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;

-- SOURCE 20261029140000_learn_slack_import_setup.sql
-- Original SHA-256 f598f6a99da6a886cb6df70cd790fbeafa75cbad69799088e81dc0b11342acde
-- Owner/admin approval and durable enqueue for the existing Slack history worker.
-- Additive; does not create credentials, change provider grants or import on apply.

create table public.slack_history_imports (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 account_id uuid not null references public.connector_accounts(id),
 job_id uuid not null references public.platform_jobs(id),
 approved_by uuid not null references public.profiles(id),
 approved_at timestamptz not null default now(),
 definition jsonb not null,
 previous_state jsonb
);
alter table public.slack_history_imports enable row level security;
create policy slack_import_read on public.slack_history_imports for select to authenticated
 using(tenant_id=public.current_tenant_id());
revoke all on public.slack_history_imports from public,anon,authenticated,service_role;
grant select on public.slack_history_imports to authenticated,service_role;
create trigger slack_import_immutable before update or delete on public.slack_history_imports
 for each row execute function public.slack_version_immutable();

create function public.learn_slack_start_import(
 p_tenant_id uuid,p_request_id uuid,p_connection_id uuid,p_expected_revision text,
 p_channel_id text,p_start timestamptz,p_end timestamptz,p_max_pages integer,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 c public.provider_connections%rowtype;
 tc public.tenant_connectors%rowtype;
 a public.connector_accounts%rowtype;
 prior public.slack_history_imports%rowtype;
 definition jsonb;
 scope jsonb;
 checkpoint jsonb;
 previous_state jsonb;
 aid uuid;
 jid uuid:=gen_random_uuid();
begin
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id()
  or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>now())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';
 end if;
 if p_request_id is null or p_connection_id is null or p_expected_revision is null
  or coalesce(p_channel_id,'') !~ '^C[A-Z0-9]+$' or length(p_channel_id)>100
  or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end-p_start>interval '24 hours' or p_end>clock_timestamp()
  or p_start<to_timestamp(0) or p_max_pages is null or p_max_pages not between 1 and 10
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'Choose a past window up to 24 hours, a public channel and a reason' using errcode='22023';
 end if;
 definition:=jsonb_build_object('connectionId',p_connection_id,'connectionRevision',p_expected_revision,
  'channelId',p_channel_id,'start',p_start,'end',p_end,'maxPages',p_max_pages,'reason',btrim(p_reason));
 -- Serialise retries before looking up an existing request. A lost response must
 -- never produce a second approval or job, even if no job is still active.
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-request:'||p_request_id::text,0));
 select * into prior from public.slack_history_imports where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.definition<>definition then
   raise exception 'Import request identity has changed' using errcode='40001';
  end if;
  return jsonb_build_object('requestId',prior.id,'accountId',prior.account_id,'jobId',prior.job_id,'reused',true);
 end if;
 -- Shared tenant connector before channel/account follows the same order for
 -- all setup requests. Publication takes row locks separately and stays atomic.
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant_id::text,0));
 select * into c from public.provider_connections where id=p_connection_id and tenant_id=p_tenant_id for share;
 if not found or c.provider<>'slack' or c.status<>'configured' or c.revoked_at is not null
  or c.updated_at is distinct from p_expected_revision::timestamptz
  or coalesce(c.non_secret_config->>'team_id','') !~ '^T[A-Z0-9]+$'
  or not ('bot_token'=any(c.configured_fields)) or c.secret_refs->>'bot_token' is null then
  raise exception 'Slack connection unavailable or changed; reload setup' using errcode='40001';
 end if;
 select * into tc from public.tenant_connectors where tenant_id=p_tenant_id and connector_id='slack';
 if not found then
  insert into public.tenant_connectors(tenant_id,connector_id,provider,category,status,enabled)
   values(p_tenant_id,'slack','slack','communications','active',true) returning * into tc;
 elsif not tc.enabled or tc.status<>'active' then
  raise exception 'Slack connector is disabled; restore it before importing' using errcode='55000';
 end if;
 select * into a from public.connector_accounts where tenant_connector_id=tc.id and tenant_id=p_tenant_id
  and account_key=(c.non_secret_config->>'team_id')||':'||p_channel_id for update;
 if found then
  if a.status<>'active' or exists(select 1 from public.platform_jobs where tenant_id=p_tenant_id
   and job_type='slack.history_sync' and payload->>'connector_account_id'=a.id::text
   and status in ('queued','running','retrying')) then
   raise exception 'A channel import is active or the account is disabled' using errcode='55000';
  end if;
  if a.settings ? 'slack_history' and a.sync_cursor->'complete' is distinct from 'true'::jsonb then
   raise exception 'Previous window is incomplete; retain its checkpoint for review' using errcode='55000';
  end if;
  previous_state:=jsonb_build_object('settings',a.settings->'slack_history','checkpoint',a.sync_cursor);
  aid:=a.id;
 else
  insert into public.connector_accounts(tenant_id,tenant_connector_id,account_key,display_name,status)
   values(p_tenant_id,tc.id,(c.non_secret_config->>'team_id')||':'||p_channel_id,p_channel_id,'active') returning id into aid;
 end if;
 scope:=jsonb_build_object('approved',true,'connectionId',c.id,'teamId',c.non_secret_config->>'team_id',
  'channelId',p_channel_id,'oldest',to_char(extract(epoch from p_start),'FM999999999999.000000'),
  'latest',to_char(extract(epoch from p_end),'FM999999999999.000000'),
  'consentReference','learn-slack-import:'||p_request_id::text,'expiresAt',clock_timestamp()+interval '24 hours','maxPages',p_max_pages);
 checkpoint:='{}'::jsonb; -- Worker creates the exact canonical scope key.
 select * into tc from public.tenant_connectors where id=tc.id and tenant_id=p_tenant_id for update;
 if not found or not tc.enabled or tc.status<>'active' then raise exception 'Slack connector changed' using errcode='55000'; end if;
 update public.connector_accounts set settings=settings||jsonb_build_object('slack_history',scope),sync_cursor=checkpoint where id=aid;
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(jid,p_tenant_id,'slack','slack.history_sync','slack.history:'||aid::text,'queued',5,clock_timestamp(),
   jsonb_build_object('connector_account_id',aid),auth.uid());
 insert into public.slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition,previous_state)
  values(p_request_id,p_tenant_id,aid,jid,auth.uid(),definition,previous_state);
 return jsonb_build_object('requestId',p_request_id,'accountId',aid,'jobId',jid,'reused',false);
end $$;
revoke all on function public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text) from public,anon;
grant execute on function public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text) to authenticated;

-- SOURCE 20261030090000_learn_slack_import_integrity.sql
-- Original SHA-256 0e56a4308dcd350493da2b59d92ae3d2f4edb80e4936f9bde06f887d16829dee
-- Preserve Slack source and approval evidence, and align setup with the
-- serialized owner/preview authority introduced for governed work actions.

-- A narrow service-only writer avoids granting direct queue/source DML merely
-- to publish a validated Slack page. Its body checks job, tenant and account.
alter function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb)
 security definer;
alter function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb)
 set search_path=public,pg_temp;
do $$ declare t text;begin
 foreach t in array array['slack_messages','slack_message_versions','slack_history_imports'] loop
  execute format('create trigger learn_slack_retain_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',t);
 end loop;
end $$;
create trigger learn_slack_retain_message before delete on public.slack_messages
 for each row execute function public.slack_version_immutable();

do $$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)'::regprocedure);
 needle:='errcode=''40001''';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
  raise exception 'Reviewed Slack conflict contract changed';
 end if;
 definition:=replace(definition,needle,'errcode=''PT409''');
 needle:=E'begin\n if auth.uid() is null';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then
  raise exception 'Reviewed Slack authority contract changed';
 end if;
 definition:=replace(definition,needle,$patch$begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Slack approval requires a fresh read-committed snapshot' using errcode='22023';
 end if;
 -- Same order as governed work. Authority mutations take the matching tenant
 -- mutex; privileged truncation takes the global exclusive lock.
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant_id::text,0));
 if auth.uid() is null$patch$);
 execute definition;
end $$;

-- Portable least privileges; publishing uses only the verified service RPC.
do $$ declare n text;begin
 foreach n in array array['slack_messages','slack_message_versions','slack_history_imports'] loop
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
  execute format('grant select on public.%I to authenticated,service_role',n);
 end loop;
 foreach n in array array['tenant_connectors','connector_accounts','provider_connections'] loop
  execute format('grant insert,update on public.%I to service_role',n);
  execute format('alter table public.%I add constraint learn_connector_tenant_fk foreign key(tenant_id) references public.tenants(id)',n);
  execute format('create trigger learn_connector_reference_guard before insert or update on public.%I for each row execute function public.learn_foundation_reference_guard()',n);
  execute format('create trigger learn_connector_retain before delete on public.%I for each row execute function public.slack_version_immutable()',n);
  execute format('create trigger learn_connector_retain_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',n);
 end loop;
end $$;
alter table provider_connection_events add constraint learn_provider_event_tenant_fk foreign key(tenant_id) references tenants(id);
grant insert on provider_connection_events to service_role;
create trigger learn_provider_events_retain before update or delete on provider_connection_events for each row execute function slack_version_immutable();
create trigger learn_provider_events_retain_truncate before truncate on provider_connection_events for each statement execute function slack_version_immutable();
create trigger learn_slack_import_reference_guard before insert or update on slack_history_imports for each row execute function learn_foundation_reference_guard();
revoke all on function slack_version_immutable() from public,anon,authenticated,service_role;

-- INPUT supabase/release/learn-test/010_slack_durable_worker.sql
-- SOURCE supabase/migrations/20261030100000_learn_slack_worker.sql
-- SHA-256 1a06eb01b97cfc314c02abb260a9f398601d1d0ecb08bffa7f4123910a9a2fa1
-- Slack-only durable execution on the existing queue. No schedules, credentials,
-- source deletion or activation. Deploy together with the fenced Slack worker.

-- Preserve the reviewed generic queue implementation, reserving Slack claims for
-- the bounded worker. Other job types retain their existing claim behaviour.
do $$ declare d text;needle text:='where c.status in (''queued'', ''retrying'')';begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then
  raise exception 'Reviewed generic claim function changed';
 end if;
 execute replace(d,needle,needle||E'\n      and c.job_type <> ''slack.history_sync''');
end $$;

create function public.learn_slack_claim_jobs(p_worker uuid,p_batch integer default 1)
returns setof public.platform_jobs language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;begin
 if current_user<>'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if p_worker is null or p_batch is null or p_batch not between 1 and 5 then
  raise exception 'slack_queue_invalid' using errcode='22023';end if;
 -- One locked scan also recovers crashed workers. Exhausted attempts are retained
 -- as dead letters; no generic unbounded reclaim pass is needed.
 for j in select * from public.platform_jobs q where q.job_type='slack.history_sync'
  and ((q.status in ('queued','retrying') and coalesce(q.available_at,'-infinity')<=clock_timestamp()
    and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp())
   or (q.status='running' and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp()))
  order by q.priority,q.created_at,q.id for update skip locked limit p_batch
 loop
  if j.attempt_count is null or j.max_attempts is null or j.max_attempts<1 or j.attempt_count>=j.max_attempts then
   update public.platform_jobs set status='dead_letter',dead_lettered_at=clock_timestamp(),
    failed_at=clock_timestamp(),lease_expires_at=null,error_code='slack_history_attempts_exhausted'
    where id=j.id;
  else
   update public.platform_jobs set status='running',claimed_by='learn-slack:'||p_worker::text,
    claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '180 seconds',
    attempt_count=j.attempt_count+1,last_attempt_at=clock_timestamp(),
    started_at=coalesce(started_at,clock_timestamp()) where id=j.id returning * into j;
   return next j;
  end if;
 end loop;
end $$;

-- The original validated source writer becomes private. There must be no
-- service-callable six-argument overload that can bypass ownership fencing.
alter function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb)
 rename to learn_slack_commit_page_private;
revoke all on function public.learn_slack_commit_page_private(uuid,uuid,uuid,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role;
create function public.slack_history_commit_page(
 p_tenant_id uuid,p_job_id uuid,p_account_id uuid,p_claimed_by text,p_attempt_count integer,
 p_expected jsonb,p_next jsonb,p_records jsonb
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;max_pages integer;receipt jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_queue_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.status<>'running' or j.job_type<>'slack.history_sync'
  or p_claimed_by is null or j.claimed_by is distinct from p_claimed_by
  or p_attempt_count is null or j.attempt_count is distinct from p_attempt_count
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then
  raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'slack_page_v1';
 if receipt is not null then
  -- Exact publication replay can resolve an uncertain HTTP response. A different
  -- page must run as a delayed successor, never a second page in this job.
  if receipt->>'account_id'=p_account_id::text and receipt->'expected'=p_expected and receipt->'next'=p_next
   and receipt->>'records_hash'=md5(p_records::text) then return true;end if;
  raise exception 'slack_page_already_committed' using errcode='PT409';
 end if;
 perform public.learn_slack_commit_page_private(p_tenant_id,p_job_id,p_account_id,p_expected,p_next,p_records);
 select (settings->'slack_history'->>'maxPages')::integer into max_pages
  from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id;
 receipt:=jsonb_build_object('account_id',p_account_id,'expected',p_expected,'next',p_next,
  'max_pages',max_pages,'records_hash',md5(p_records::text),'records_processed',jsonb_array_length(p_records),
  'committed_at',clock_timestamp());
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('slack_page_v1',receipt) where id=j.id;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 return true;
end $$;

create function public.learn_slack_finish_job(
 p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_outcome jsonb
) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;
 receipt jsonb;page jsonb;checkpoint jsonb;result_doc jsonb;successor uuid;account_id uuid;
 max_pages integer;stop_reason text;delay_seconds integer;next_status text;failure_code text;answer jsonb;
begin
 if current_user<>'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_queue_snapshot' using errcode='22023';end if;
 if p_claimed_by is null or p_attempt_count is null or p_attempt_count<1 or jsonb_typeof(p_outcome) is distinct from 'object'
  or jsonb_typeof(p_outcome->'success') is distinct from 'boolean' then
  raise exception 'slack_queue_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.job_type<>'slack.history_sync' or j.claimed_by is distinct from p_claimed_by
  or j.attempt_count is distinct from p_attempt_count then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'slack_finish_v1';
 if j.status in ('succeeded','retrying','dead_letter') and receipt->>'claimed_by'=p_claimed_by
  and (receipt->>'attempt_count')::integer=p_attempt_count then
  if receipt->'outcome'=p_outcome then return receipt->'answer';end if;
  raise exception 'slack_queue_replay_conflict' using errcode='PT409';
 end if;
 if j.status<>'running' or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then
  raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 if p_outcome->'success'='true'::jsonb then
  if p_outcome<>'{"success":true}'::jsonb then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  account_id:=(j.payload->>'connector_account_id')::uuid;
  if account_id is null or j.job_key is distinct from 'slack.history:'||account_id::text then
   raise exception 'slack_queue_identity' using errcode='22023';end if;
  select * into a from public.connector_accounts where id=account_id and tenant_id=p_tenant_id for share;
  if not found then raise exception 'slack_queue_identity' using errcode='22023';end if;
  page:=j.metadata->'slack_page_v1';
  if page is not null then
   if page->>'account_id' is distinct from account_id::text or page->'next' is distinct from a.sync_cursor then
    raise exception 'slack_queue_checkpoint_changed' using errcode='PT409';end if;
   checkpoint:=page->'next';max_pages:=(page->>'max_pages')::integer;
  else
   checkpoint:=a.sync_cursor;max_pages:=(a.settings->'slack_history'->>'maxPages')::integer;
   if checkpoint->'complete' is distinct from 'true'::jsonb and
    coalesce((checkpoint->>'pages')::integer,-1)<coalesce(max_pages,1) then
    raise exception 'slack_queue_page_missing' using errcode='PT409';end if;
  end if;
  if max_pages is null or max_pages not between 1 and 10 or
   jsonb_typeof(checkpoint->'pages') is distinct from 'number' or
   jsonb_typeof(checkpoint->'complete') is distinct from 'boolean' then
   raise exception 'slack_queue_checkpoint_invalid' using errcode='22023';end if;
  stop_reason:=case when checkpoint->'complete'='true'::jsonb then 'window_pages_complete'
   when (checkpoint->>'pages')::integer>=max_pages then 'page_budget_exhausted' else 'run_page_limit' end;
  -- Continuation remains subject to the stored consent and connector state. No
  -- token or caller-supplied continuation payload participates in this decision.
  if stop_reason='run_page_limit' and (a.status<>'active' or
   a.settings->'slack_history'->'approved' is distinct from 'true'::jsonb or
   coalesce((a.settings->'slack_history'->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
   or not exists(select 1 from public.tenant_connectors c where c.id=a.tenant_connector_id
    and c.tenant_id=p_tenant_id and c.enabled and c.status='active' and c.connector_id='slack')
   or not exists(select 1 from public.provider_connections c where c.id=(a.settings->'slack_history'->>'connectionId')::uuid
    and c.tenant_id=p_tenant_id and c.provider='slack' and c.status='configured' and c.revoked_at is null)) then
   stop_reason:='authorisation_changed';
  end if;
  result_doc:=checkpoint||jsonb_build_object('stopReason',stop_reason,'threadCoverage','unverified',
   'coverage','bounded_channel_history','ingestion_complete',false);
  update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),lease_expires_at=null,
   error_code=null,result=result_doc,records_processed=coalesce((page->>'records_processed')::integer,0) where id=j.id;
  if stop_reason='run_page_limit' then
   -- Failure here rolls back completion; replay cannot lose or duplicate the next page.
   insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,
    priority,max_attempts,available_at,parent_job_id,payload)
   values(j.tenant_id,j.connector_id,j.module_id,j.job_type,j.job_key,'queued',j.priority,j.max_attempts,
    greatest(clock_timestamp(),(page->>'committed_at')::timestamptz)+interval '60 seconds',j.id,j.payload)
   returning id into successor;
  end if;
  next_status:='succeeded';
 else
  if not p_outcome ?& array['success','code','retryable','retry_after_seconds'] or
   (select count(*) from jsonb_object_keys(p_outcome))<>4 or
   jsonb_typeof(p_outcome->'retryable') is distinct from 'boolean' or
   jsonb_typeof(p_outcome->'code') is distinct from 'string' or
   p_outcome->>'code' !~ '^slack_history_[a-z_]{1,80}$' or
   jsonb_typeof(p_outcome->'retry_after_seconds') is distinct from 'number' or
   p_outcome->>'retry_after_seconds' !~ '^[0-9]{1,8}$' then
   raise exception 'slack_queue_invalid' using errcode='22023';end if;
  delay_seconds:=(p_outcome->>'retry_after_seconds')::integer;
  if delay_seconds>31536000 then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  delay_seconds:=greatest(delay_seconds,case j.attempt_count when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end);
  next_status:=case when p_outcome->'retryable'='true'::jsonb and j.attempt_count<j.max_attempts then 'retrying' else 'dead_letter' end;
  failure_code:=p_outcome->>'code';
  update public.platform_jobs set status=next_status,lease_expires_at=null,error_code=failure_code,
   error_count=coalesce(error_count,0)+1,failed_at=clock_timestamp(),
   available_at=case when next_status='retrying' then clock_timestamp()+make_interval(secs=>delay_seconds) else available_at end,
   dead_lettered_at=case when next_status='dead_letter' then clock_timestamp() else dead_lettered_at end where id=j.id;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 answer:=jsonb_build_object('job_id',j.id,'status',next_status,'successor_id',successor);
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('slack_finish_v1',
  jsonb_build_object('claimed_by',p_claimed_by,'attempt_count',p_attempt_count,'outcome',p_outcome,'answer',answer)) where id=j.id;
 return answer;
end $$;

revoke all on function public.learn_slack_claim_jobs(uuid,integer),
 public.slack_history_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb),
 public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.learn_slack_claim_jobs(uuid,integer),
 public.slack_history_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb),
 public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb) to service_role;

-- SOURCE supabase/migrations/20261030110000_learn_slack_credential_binding.sql
-- SHA-256 727937cc01f04a38e854f5aea48455829e8f7cf31716b69da2674989feb3195c
-- Read an existing credential only for an owned, approved Slack job. This does
-- not create/rotate/revoke credentials, expose Vault to clients, or call Slack.

create function public.learn_slack_read_credential(
 p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,
 p_connection_id uuid,p_revision timestamptz,p_secret_id uuid
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cfg jsonb;secret text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_credential_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_credential_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.status<>'running' or j.job_type<>'slack.history_sync' or
  p_claimed_by is null or j.claimed_by is distinct from p_claimed_by or
  p_attempt_count is null or j.attempt_count is distinct from p_attempt_count or
  j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() or j.metadata ? 'slack_page_v1' then return null;end if;
 select * into a from public.connector_accounts where id=(j.payload->>'connector_account_id')::uuid
  and tenant_id=p_tenant_id for share;
 if not found or a.status<>'active' then return null;end if;
 cfg:=a.settings->'slack_history';
 if cfg->'approved' is distinct from 'true'::jsonb or
  coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp() or
  (cfg->>'connectionId')::uuid is distinct from p_connection_id then return null;end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
  and connector_id='slack' and enabled and status='active' for share;
 if not found then return null;end if;
 perform 1 from public.provider_connections where id=p_connection_id and tenant_id=p_tenant_id
  and provider='slack' and status='configured' and revoked_at is null and updated_at=p_revision
  and non_secret_config->>'team_id'=cfg->>'teamId' and 'bot_token'=any(configured_fields)
  and secret_refs->>'bot_token'=p_secret_id::text for share;
 if not found then return null;end if;
 -- Require both the stored reference and the existing broker's tenant-qualified
 -- name. A foreign/mismatched reference or a stale connection resolves nothing.
 select decrypted_secret into secret from vault.decrypted_secrets
  where id=p_secret_id and name='provider_secret:'||p_tenant_id::text||':slack:bot_token';
 if j.lease_expires_at<=clock_timestamp() then return null;end if;
 return secret;
end $$;
revoke all on function public.learn_slack_read_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid)
 from public,anon,authenticated;
grant execute on function public.learn_slack_read_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid) to service_role;


-- INPUT supabase/release/learn-test/011_slack_threads.sql
-- SOURCE supabase/migrations/20261030120000_learn_slack_thread_storage.sql
-- SHA-256 c04cb34944a5ca00c6c1f438f42e00937dd767d8fab359a4290234c3b0a04968
-- Retained, explicitly approved thread windows. No approval, credential, job,
-- schedule or provider request is created by applying this migration.

-- Share the existing source/version/interaction transaction with thread pages.
-- Extract only the reviewed validation/upsert block; preserve its semantics.
do $migration$ declare d text;block text;original_block text;start_at integer;end_at integer;begin
 d:=pg_get_functiondef('public.learn_slack_commit_page_private(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 start_at:=strpos(d,' if jsonb_typeof(p_records) is distinct from ''array''');
 end_at:=strpos(d,' update public.connector_accounts set sync_cursor=p_next');
 if start_at=0 or end_at<=start_at or
  strpos(substr(d,start_at,end_at-start_at),'insert into public.slack_message_versions')=0 then
  raise exception 'Reviewed Slack source writer differs';end if;
 block:=substr(d,start_at,end_at-start_at);
 original_block:=block;
 if strpos(block,'''coverage'',''bounded_history_page'',''threads'',''unverified''')=0 then
  raise exception 'Reviewed Slack interaction provenance differs';end if;
 block:=replace(block,'''coverage'',''bounded_history_page'',''threads'',''unverified''',
  '''coverage'',case when p_parent_timestamp is null then ''bounded_history_page'' else ''observed_thread_page'' end,''threads'',''unverified''');
 execute $head$create function public.learn_slack_store_records(p_tenant_id uuid,cfg jsonb,p_records jsonb,p_parent_timestamp text)
 returns void language plpgsql security invoker set search_path=public,pg_temp as $body$
 declare r jsonb;sid uuid;version_hash text;provider_updated numeric;current_version text;seen text[]:=array[]::text[];
 begin
  if p_parent_timestamp is not null then
   if p_parent_timestamp !~ '^\d{1,12}\.\d{1,6}$' then raise exception 'thread_parent_invalid';end if;
   for r in select value from jsonb_array_elements(p_records) loop
    if r->>'provider_timestamp'=p_parent_timestamp then
     if r->>'thread_timestamp' is not null and r->>'thread_timestamp'<>p_parent_timestamp then raise exception 'thread_record_mismatch';end if;
    elsif r->>'thread_timestamp' is distinct from p_parent_timestamp then raise exception 'thread_record_mismatch';end if;
    if (r->>'provider_timestamp')::numeric<p_parent_timestamp::numeric then raise exception 'thread_record_mismatch';end if;
   end loop;
  end if;
 $head$||block||E'\nend $body$;';
 execute replace(d,original_block,E' perform public.learn_slack_store_records(p_tenant_id,cfg,p_records,null);\n');
end $migration$;
revoke all on function public.learn_slack_store_records(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;

create table public.slack_thread_imports(
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 account_id uuid not null references public.connector_accounts(id),
 source_message_id uuid not null references public.slack_messages(id),
 initial_job_id uuid not null references public.platform_jobs(id),
 approved_by uuid not null references public.profiles(id),
 approved_at timestamptz not null default clock_timestamp(),
 definition jsonb not null,
 scope jsonb not null,
 checkpoint jsonb not null default '{}'::jsonb
);
alter table public.slack_thread_imports enable row level security;
create policy slack_threads_read on public.slack_thread_imports for select to authenticated
 using(tenant_id=public.current_tenant_id());
revoke all on public.slack_thread_imports from public,anon,authenticated,service_role;
grant select on public.slack_thread_imports to authenticated,service_role;
create trigger learn_thread_reference_guard before insert or update on public.slack_thread_imports
 for each row execute function public.learn_foundation_reference_guard();
create trigger learn_thread_retain before delete on public.slack_thread_imports
 for each row execute function public.slack_version_immutable();
create trigger learn_thread_retain_truncate before truncate on public.slack_thread_imports
 for each statement execute function public.slack_version_immutable();
create function public.learn_slack_thread_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if to_jsonb(old)-'checkpoint' is distinct from to_jsonb(new)-'checkpoint' then
  raise exception 'Thread approval evidence is immutable' using errcode='55000';end if;
 return new;
end $$;
revoke all on function public.learn_slack_thread_immutable() from public,anon,authenticated,service_role;
create trigger learn_thread_approval_immutable before update on public.slack_thread_imports
 for each row execute function public.learn_slack_thread_immutable();

create function public.learn_slack_start_thread_import(
 p_tenant_id uuid,p_request_id uuid,p_account_id uuid,p_source_message_id uuid,p_source_version text,
 p_connection_revision timestamptz,p_start timestamptz,p_end timestamptz,p_max_pages integer,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;m public.slack_messages%rowtype;c public.provider_connections%rowtype;
 prior public.slack_thread_imports%rowtype;definition jsonb;scope jsonb;parent text;job_id uuid:=gen_random_uuid();key text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Thread approval requires a fresh snapshot' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant_id::text,0));
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id()
  or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';end if;
 if p_request_id is null or p_account_id is null or p_source_message_id is null
  or coalesce(p_source_version,'') !~ '^[a-f0-9]{64}$' or p_connection_revision is null
  or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start<to_timestamp(0) or p_end<=p_start or p_end>clock_timestamp() or p_end-p_start>interval '24 hours'
  or p_max_pages is null or p_max_pages not between 1 and 10 or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'Invalid thread approval' using errcode='22023';end if;
 definition:=jsonb_build_object('accountId',p_account_id,'sourceMessageId',p_source_message_id,'sourceVersion',p_source_version,
  'connectionRevision',p_connection_revision,'start',p_start,'end',p_end,'maxPages',p_max_pages,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-thread-request:'||p_request_id::text,0));
 select * into prior from public.slack_thread_imports where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.definition<>definition then raise exception 'Thread request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('requestId',prior.id,'accountId',prior.account_id,'jobId',prior.initial_job_id,'reused',true);
 end if;
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id for share;
 if not found or a.status<>'active' then raise exception 'Thread account unavailable' using errcode='55000';end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
  and connector_id='slack' and enabled and status='active' for share;
 if not found then raise exception 'Slack connector unavailable' using errcode='55000';end if;
 select * into c from public.provider_connections where id=(a.settings->'slack_history'->>'connectionId')::uuid
  and tenant_id=p_tenant_id and provider='slack' and status='configured' and revoked_at is null for share;
 if not found or c.updated_at is distinct from p_connection_revision or not ('bot_token'=any(c.configured_fields))
  or c.secret_refs->>'bot_token' is null then raise exception 'Slack connection changed' using errcode='PT409';end if;
 select * into m from public.slack_messages where id=p_source_message_id and tenant_id=p_tenant_id for share;
 if not found or m.source_version<>p_source_version or m.team_id is distinct from c.non_secret_config->>'team_id'
  or m.channel_id is distinct from a.settings->'slack_history'->>'channelId' then
  raise exception 'Observed thread source changed' using errcode='PT409';end if;
 -- A stored reply or broadcast identifies its parent; a root needs a provider
 -- reply count. Unthreaded messages and guessed timestamps cannot grant access.
 if m.thread_timestamp is not null and m.thread_timestamp<>m.provider_timestamp then parent:=m.thread_timestamp;
 elsif coalesce(m.provider_payload->>'reply_count','') ~ '^[0-9]+$' and (m.provider_payload->>'reply_count')::numeric>0 then parent:=m.provider_timestamp;
 else raise exception 'No observed thread on this source' using errcode='22023';end if;
 if parent !~ '^\d{1,12}\.\d{1,6}$' or parent::numeric>extract(epoch from p_end) or parent::numeric>m.provider_timestamp::numeric then
  raise exception 'Observed thread timestamp invalid' using errcode='22023';end if;
 key:='slack.thread:'||p_account_id::text||':'||parent||':'||extract(epoch from p_start)::text||':'||extract(epoch from p_end)::text;
 perform pg_advisory_xact_lock(hashtextextended(key,0));
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant_id and job_key=key and status in ('queued','running','retrying')) then
  raise exception 'Thread import already active' using errcode='55000';end if;
 scope:=jsonb_build_object('approved',true,'connectionId',c.id,'teamId',m.team_id,'channelId',m.channel_id,
  'parentTimestamp',parent,'oldest',to_char(extract(epoch from p_start),'FM999999999999.000000'),
  'latest',to_char(extract(epoch from p_end),'FM999999999999.000000'),'consentReference','learn-slack-thread:'||p_request_id::text,
  'expiresAt',clock_timestamp()+interval '24 hours','maxPages',p_max_pages);
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(job_id,p_tenant_id,'slack','slack.thread_sync',key,'queued',5,clock_timestamp(),jsonb_build_object('thread_import_id',p_request_id,'connector_account_id',p_account_id),auth.uid());
 insert into public.slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope)
  values(p_request_id,p_tenant_id,p_account_id,p_source_message_id,job_id,auth.uid(),definition,scope);
 return jsonb_build_object('requestId',p_request_id,'accountId',p_account_id,'jobId',job_id,'reused',false);
end $$;
revoke all on function public.learn_slack_start_thread_import(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,integer,text) from public,anon,service_role;
grant execute on function public.learn_slack_start_thread_import(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,integer,text) to authenticated;

create function public.slack_thread_commit_page(p_tenant_id uuid,p_job_id uuid,p_import_id uuid,p_claimed_by text,p_attempt_count integer,
 p_expected jsonb,p_next jsonb,p_records jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;t public.slack_thread_imports%rowtype;a public.connector_accounts%rowtype;
 cfg jsonb;scope_key jsonb;receipt jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_queue_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.status<>'running' or j.job_type<>'slack.thread_sync' or j.payload->>'thread_import_id' is distinct from p_import_id::text
  or p_claimed_by is null or j.claimed_by is distinct from p_claimed_by or p_attempt_count is null or j.attempt_count is distinct from p_attempt_count
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'slack_page_v1';
 if receipt is not null then
  if receipt->>'thread_import_id'=p_import_id::text and receipt->'expected'=p_expected and receipt->'next'=p_next and receipt->>'records_hash'=md5(p_records::text) then return true;end if;
  raise exception 'slack_page_already_committed' using errcode='PT409';
 end if;
 select * into t from public.slack_thread_imports where id=p_import_id and tenant_id=p_tenant_id for update;
 if not found or j.payload->>'connector_account_id' is distinct from t.account_id::text then raise exception 'thread_import_unavailable';end if;
 select * into a from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id for share;
 if not found or a.status<>'active' then raise exception 'thread_account_unavailable';end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack' and enabled and status='active' for share;
 if not found then raise exception 'thread_connector_unavailable';end if;
 cfg:=t.scope;
 if cfg->'approved' is distinct from 'true'::jsonb or coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp() then raise exception 'thread_scope_unavailable';end if;
 perform 1 from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant_id and provider='slack'
  and status='configured' and revoked_at is null and non_secret_config->>'team_id'=cfg->>'teamId' for share;
 if not found then raise exception 'thread_connection_unavailable';end if;
 scope_key:=jsonb_build_array(p_tenant_id::text,cfg->>'teamId',cfg->>'channelId',cfg->>'oldest',cfg->>'latest',cfg->>'consentReference',cfg->>'parentTimestamp');
 if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_next) is distinct from 'object'
  or not(p_expected ?& array['scopeKey','cursor','pages','complete']) or not(p_next ?& array['scopeKey','cursor','pages','complete'])
  or (select count(*) from jsonb_object_keys(p_expected))<>4 or (select count(*) from jsonb_object_keys(p_next))<>4
  or jsonb_typeof(p_expected->'scopeKey') is distinct from 'string' or jsonb_typeof(p_next->'scopeKey') is distinct from 'string'
  or (p_expected->>'scopeKey')::jsonb is distinct from scope_key or p_next->>'scopeKey' is distinct from p_expected->>'scopeKey'
  or jsonb_typeof(p_expected->'pages') is distinct from 'number' or jsonb_typeof(p_next->'pages') is distinct from 'number'
  or (p_expected->>'pages') !~ '^[0-9]+$' or (p_next->>'pages') !~ '^[0-9]+$'
  or (p_next->>'pages')::integer<>(p_expected->>'pages')::integer+1 or (p_next->>'pages')::integer>(cfg->>'maxPages')::integer
  or p_expected->'complete' is distinct from 'false'::jsonb or jsonb_typeof(p_next->'complete') is distinct from 'boolean'
  or jsonb_typeof(p_expected->'cursor') not in ('null','string') or jsonb_typeof(p_next->'cursor') not in ('null','string')
  or p_next->'complete'='true'::jsonb and p_next->>'cursor' is not null
  or p_next->'complete'='false'::jsonb and coalesce(p_next->>'cursor','')=''
  or length(coalesce(p_next->>'cursor',''))>1024 or length(coalesce(p_expected->>'cursor',''))>1024
  or p_next->>'cursor' is not null and p_next->>'cursor'=p_expected->>'cursor' then raise exception 'thread_checkpoint_invalid';end if;
 if t.checkpoint is distinct from p_expected and not(t.checkpoint='{}'::jsonb and p_expected->'pages'='0'::jsonb and p_expected->'cursor'='null'::jsonb) then
  raise exception 'thread_checkpoint_conflict' using errcode='PT409';end if;
 perform public.learn_slack_store_records(p_tenant_id,cfg,p_records,cfg->>'parentTimestamp');
 update public.slack_thread_imports set checkpoint=p_next where id=t.id;
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('slack_page_v1',jsonb_build_object(
  'kind','thread','thread_import_id',t.id,'account_id',t.account_id,'expected',p_expected,'next',p_next,'max_pages',(cfg->>'maxPages')::integer,
  'records_hash',md5(p_records::text),'records_processed',jsonb_array_length(p_records),'committed_at',clock_timestamp())) where id=j.id;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 return true;
end $$;
revoke all on function public.slack_thread_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.slack_thread_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb) to service_role;

-- SOURCE supabase/migrations/20261030130000_learn_slack_thread_worker.sql
-- SHA-256 05fc686bdf849362ce71a17e511ed1aa8be62ef78ae9d2a38791ecce81627c81
-- Add thread jobs to the existing bounded Slack executor. No schedule or import.

do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 needle:='c.job_type <> ''slack.history_sync''';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed generic Slack exclusion differs';end if;
 execute replace(d,needle,'c.job_type not in (''slack.history_sync'',''slack.thread_sync'')');
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 needle:='q.job_type=''slack.history_sync''';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack claim differs';end if;
 execute replace(d,needle,'q.job_type in (''slack.history_sync'',''slack.thread_sync'')');
end $$;

create function public.learn_slack_read_thread_credential(
 p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,
 p_connection_id uuid,p_revision timestamptz,p_secret_id uuid
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;t public.slack_thread_imports%rowtype;a public.connector_accounts%rowtype;cfg jsonb;secret text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_credential_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_credential_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.status<>'running' or j.job_type<>'slack.thread_sync' or
  p_claimed_by is null or j.claimed_by is distinct from p_claimed_by or p_attempt_count is null or j.attempt_count is distinct from p_attempt_count
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() or j.metadata ? 'slack_page_v1' then return null;end if;
 select * into t from public.slack_thread_imports where id=(j.payload->>'thread_import_id')::uuid and tenant_id=p_tenant_id for share;
 if not found or j.payload->>'connector_account_id' is distinct from t.account_id::text then return null;end if;
 select * into a from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id for share;
 if not found or a.status<>'active' then return null;end if;
 cfg:=t.scope;
 if cfg->'approved' is distinct from 'true'::jsonb or coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
  or (cfg->>'connectionId')::uuid is distinct from p_connection_id then return null;end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack' and enabled and status='active' for share;
 if not found then return null;end if;
 perform 1 from public.provider_connections where id=p_connection_id and tenant_id=p_tenant_id and provider='slack'
  and status='configured' and revoked_at is null and updated_at=p_revision and non_secret_config->>'team_id'=cfg->>'teamId'
  and 'bot_token'=any(configured_fields) and secret_refs->>'bot_token'=p_secret_id::text for share;
 if not found then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id=p_secret_id and name='provider_secret:'||p_tenant_id::text||':slack:bot_token';
 if j.lease_expires_at<=clock_timestamp() then return null;end if;
 return secret;
end $$;

create function public.learn_slack_finish_thread_job(p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_outcome jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;t public.slack_thread_imports%rowtype;a public.connector_accounts%rowtype;
 receipt jsonb;page jsonb;checkpoint jsonb;result_doc jsonb;successor uuid;delay_seconds integer;next_status text;stop_reason text;answer jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_queue_snapshot' using errcode='22023';end if;
 if p_claimed_by is null or p_attempt_count is null or p_attempt_count<1 or jsonb_typeof(p_outcome) is distinct from 'object'
  or jsonb_typeof(p_outcome->'success') is distinct from 'boolean' then raise exception 'slack_queue_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.job_type<>'slack.thread_sync' or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count then
  raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'slack_finish_v1';
 if j.status in ('succeeded','retrying','dead_letter') and receipt->>'claimed_by'=p_claimed_by and (receipt->>'attempt_count')::integer=p_attempt_count then
  if receipt->'outcome'=p_outcome then return receipt->'answer';end if;
  raise exception 'slack_queue_replay_conflict' using errcode='PT409';end if;
 if j.status<>'running' or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 if p_outcome->'success'='true'::jsonb then
  if p_outcome<>'{"success":true}'::jsonb then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  select * into t from public.slack_thread_imports where id=(j.payload->>'thread_import_id')::uuid and tenant_id=p_tenant_id for share;
  if not found or j.payload->>'connector_account_id' is distinct from t.account_id::text then raise exception 'slack_queue_identity' using errcode='22023';end if;
  page:=j.metadata->'slack_page_v1';checkpoint:=t.checkpoint;
  if page is null and checkpoint->'complete' is distinct from 'true'::jsonb and coalesce((checkpoint->>'pages')::integer,-1)<(t.scope->>'maxPages')::integer then
   raise exception 'slack_queue_page_missing' using errcode='PT409';end if;
  if page is not null and (page->>'kind' is distinct from 'thread' or page->>'thread_import_id' is distinct from t.id::text or page->'next' is distinct from checkpoint) then
   raise exception 'slack_queue_checkpoint_changed' using errcode='PT409';end if;
  stop_reason:=case when checkpoint->'complete'='true'::jsonb then 'window_pages_complete'
   when (checkpoint->>'pages')::integer>=(t.scope->>'maxPages')::integer then 'page_budget_exhausted' else 'run_page_limit' end;
  select * into a from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id for share;
  if not found then raise exception 'slack_queue_identity' using errcode='22023';end if;
  if stop_reason='run_page_limit' and (a.status<>'active' or coalesce((t.scope->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
   or not exists(select 1 from public.tenant_connectors c where c.id=a.tenant_connector_id and c.tenant_id=p_tenant_id and c.connector_id='slack' and c.enabled and c.status='active')
   or not exists(select 1 from public.provider_connections c where c.id=(t.scope->>'connectionId')::uuid and c.tenant_id=p_tenant_id and c.provider='slack' and c.status='configured' and c.revoked_at is null)) then stop_reason:='authorisation_changed';end if;
  result_doc:=checkpoint||jsonb_build_object('stopReason',stop_reason,'coverage','observed_thread_window','parentTimestamp',t.scope->>'parentTimestamp',
   'threadCoverage',case when checkpoint->'complete'='true'::jsonb then 'observed_thread_window_complete' else 'observed_thread_window_incomplete' end,'ingestion_complete',false);
  update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),lease_expires_at=null,error_code=null,
   result=result_doc,records_processed=coalesce((page->>'records_processed')::integer,0) where id=j.id;
  if stop_reason='run_page_limit' then
   insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,available_at,parent_job_id,payload)
    values(j.tenant_id,j.connector_id,j.module_id,j.job_type,j.job_key,'queued',j.priority,j.max_attempts,
     greatest(clock_timestamp(),(page->>'committed_at')::timestamptz)+interval '60 seconds',j.id,j.payload) returning id into successor;
  end if;
  next_status:='succeeded';
 else
  if not(p_outcome ?& array['success','code','retryable','retry_after_seconds']) or (select count(*) from jsonb_object_keys(p_outcome))<>4
   or jsonb_typeof(p_outcome->'retryable') is distinct from 'boolean' or jsonb_typeof(p_outcome->'code') is distinct from 'string'
   or p_outcome->>'code' !~ '^slack_history_[a-z_]{1,80}$' or jsonb_typeof(p_outcome->'retry_after_seconds') is distinct from 'number'
   or p_outcome->>'retry_after_seconds' !~ '^[0-9]{1,8}$' then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  delay_seconds:=(p_outcome->>'retry_after_seconds')::integer;
  if delay_seconds>31536000 then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  delay_seconds:=greatest(delay_seconds,case j.attempt_count when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end);
  next_status:=case when p_outcome->'retryable'='true'::jsonb and j.attempt_count<j.max_attempts then 'retrying' else 'dead_letter' end;
  update public.platform_jobs set status=next_status,lease_expires_at=null,error_code=p_outcome->>'code',error_count=coalesce(error_count,0)+1,
   failed_at=clock_timestamp(),available_at=case when next_status='retrying' then clock_timestamp()+make_interval(secs=>delay_seconds) else available_at end,
   dead_lettered_at=case when next_status='dead_letter' then clock_timestamp() else dead_lettered_at end where id=j.id;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 answer:=jsonb_build_object('job_id',j.id,'status',next_status,'successor_id',successor);
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('slack_finish_v1',jsonb_build_object(
  'claimed_by',p_claimed_by,'attempt_count',p_attempt_count,'outcome',p_outcome,'answer',answer)) where id=j.id;
 return answer;
end $$;
revoke all on function public.learn_slack_read_thread_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid),
 public.learn_slack_finish_thread_job(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.learn_slack_read_thread_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid),
 public.learn_slack_finish_thread_job(uuid,uuid,text,integer,jsonb) to service_role;


-- INPUT supabase/release/learn-test/012_slack_operator.sql
-- SOURCE supabase/migrations/20261030140000_learn_slack_operator_reads.sql
-- SHA-256 5771f64d34218713784172aa345255a651641d93d8b161b646d75fc23f8ca5ad
-- Company-scoped read models for stored Slack channels and observed threads.
-- No provider request, approval, queue mutation, credential or table grant.

create function public.learn_slack_accounts_read(p_tenant_id uuid,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare rows jsonb;more boolean;last_id uuid;begin
 if auth.uid() is null or p_tenant_id is null or p_tenant_id is distinct from public.current_tenant_id() then
  raise exception 'Company access required' using errcode='42501';end if;
 with candidates as (
  select a.id,a.display_name,a.status,a.settings->'slack_history'->>'teamId' as team_id,a.settings->'slack_history'->>'channelId' as channel_id
  from public.connector_accounts a join public.tenant_connectors c on c.id=a.tenant_connector_id and c.tenant_id=a.tenant_id
  where a.tenant_id=p_tenant_id and c.connector_id='slack' and a.settings ? 'slack_history'
   and (p_after_id is null or a.id>p_after_id) order by a.id limit 21
 ), page as (select * from candidates order by id limit 20)
 select coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',coalesce(display_name,channel_id),'status',status,'teamId',team_id,'channelId',channel_id) order by id) from page),'[]'),
 (select count(*)>20 from candidates),(select id from page order by id desc limit 1) into rows,more,last_id;
 return jsonb_build_object('version','learn-slack-accounts/1','tenantId',p_tenant_id,'accounts',rows,'nextCursor',case when more then last_id else null end);
end $$;

create function public.learn_slack_threads_read(p_tenant_id uuid,p_account_id uuid,p_before_parent text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;c public.provider_connections%rowtype;cfg jsonb;rows jsonb;more boolean;last_parent text;can_import boolean;begin
 if auth.uid() is null or p_tenant_id is null or p_tenant_id is distinct from public.current_tenant_id() then
  raise exception 'Company access required' using errcode='42501';end if;
 if p_account_id is null or p_before_parent is not null and p_before_parent !~ '^\d{1,12}\.\d{1,6}$' then
  raise exception 'Invalid thread page' using errcode='22023';end if;
 select a1.* into a from public.connector_accounts a1 join public.tenant_connectors tc on tc.id=a1.tenant_connector_id and tc.tenant_id=a1.tenant_id
  where a1.id=p_account_id and a1.tenant_id=p_tenant_id and tc.connector_id='slack';
 if not found then raise exception 'Stored Slack channel unavailable' using errcode='42501';end if;
 cfg:=a.settings->'slack_history';
 select * into c from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant_id and provider='slack';
 can_import:=found and a.status='active' and c.status='configured' and c.revoked_at is null
  and c.non_secret_config->>'team_id'=cfg->>'teamId' and 'bot_token'=any(c.configured_fields)
  and c.secret_refs->>'bot_token' is not null and exists(select 1 from public.tenant_connectors tc where tc.id=a.tenant_connector_id and tc.tenant_id=p_tenant_id and tc.enabled and tc.status='active');
 with observed as (
  select m.*,case when m.thread_timestamp is not null and m.thread_timestamp<>m.provider_timestamp then m.thread_timestamp else m.provider_timestamp end as parent
  from public.slack_messages m where m.tenant_id=p_tenant_id and m.team_id=cfg->>'teamId' and m.channel_id=cfg->>'channelId'
  and ((m.thread_timestamp is not null and m.thread_timestamp<>m.provider_timestamp)
   or case when coalesce(m.provider_payload->>'reply_count','') ~ '^[0-9]+$' then (m.provider_payload->>'reply_count')::numeric>0 else false end)
 ), roots as (
  select distinct on (parent::numeric) id,source_version,message_text,provider_timestamp,parent
  from observed where (p_before_parent is null or parent::numeric<p_before_parent::numeric)
  order by parent::numeric desc,(provider_timestamp=parent) desc,source_updated_at desc,id
 ), candidates as (select * from roots order by parent::numeric desc limit 21), page as (select * from candidates order by parent::numeric desc limit 20),
 detail as (
  select p.*,t.id as import_id,t.approved_at,t.definition,t.checkpoint,t.scope,j.id as job_id,j.status as job_status,j.available_at,j.error_code,j.result
  from page p left join lateral (select t1.* from public.slack_thread_imports t1 where t1.tenant_id=p_tenant_id and t1.account_id=p_account_id and (t1.scope->>'parentTimestamp')::numeric=p.parent::numeric order by t1.approved_at desc,t1.id desc limit 1)t on true
  left join lateral (select j1.* from public.platform_jobs j1 where j1.tenant_id=p_tenant_id and j1.job_type='slack.thread_sync'
   and j1.payload->>'thread_import_id'=t.id::text and j1.payload->>'connector_account_id'=p_account_id::text order by j1.created_at desc,j1.id desc limit 1)j on true
 ) select coalesce((select jsonb_agg(jsonb_build_object('sourceId',id,'sourceVersion',source_version,'parentTimestamp',parent,'observedTimestamp',provider_timestamp,
  'excerpt',left(message_text,400),'latestImport',case when import_id is null then null else jsonb_build_object('id',import_id,'approvedAt',approved_at,'start',definition->>'start','end',definition->>'end',
   'pages',coalesce((checkpoint->>'pages')::integer,0),'pageLimit',(scope->>'maxPages')::integer,'complete',coalesce((checkpoint->>'complete')::boolean,false),
   'status',job_status,'availableAt',case when job_status in ('queued','retrying') then available_at else null end,
   'errorCode',case when error_code ~ '^slack_history_[a-z_]{1,80}$' then error_code else null end,
   'stopReason',case when result->>'stopReason' in ('window_pages_complete','page_budget_exhausted','run_page_limit','authorisation_changed') then result->>'stopReason' else null end) end) order by parent::numeric desc) from detail),'[]'),
  (select count(*)>20 from candidates),(select parent from page order by parent::numeric limit 1) into rows,more,last_parent;
 return jsonb_build_object('version','learn-slack-threads/1','tenantId',p_tenant_id,'accountId',p_account_id,'teamId',cfg->>'teamId','channelId',cfg->>'channelId',
  'canImport',coalesce(can_import,false),'connectionRevision',c.updated_at,'threads',rows,'nextCursor',case when more then last_parent else null end,'coverage','observed_threads_only');
end $$;
revoke all on function public.learn_slack_accounts_read(uuid,uuid),public.learn_slack_threads_read(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.learn_slack_accounts_read(uuid,uuid),public.learn_slack_threads_read(uuid,uuid,text) to authenticated;


-- INPUT supabase/release/learn-test/013_slack_pacing.sql
-- SOURCE supabase/migrations/20261030150000_learn_slack_workspace_pacing.sql
-- SHA-256 5f5ae2fbd3d0b44d785aab41ac18ae1d6ff8efdd50cd967d79bef02b30edbf74
-- One bounded provider job at a time per Slack workspace across channels,
-- threads, connections and ServiceOS companies. Conservative across Slack apps
-- until an authenticated app identity and its rate tier are verified.
-- No schedule, provider request, source rewrite or credential change.

create table public.slack_workspace_pacing (
 team_id text primary key check(team_id ~ '^T[A-Z0-9]+$'),
 next_allowed_at timestamptz not null,
 blocked_until timestamptz not null default '-infinity',
 active_job_id uuid references public.platform_jobs(id) on delete restrict,
 last_started_at timestamptz not null,
 last_finished_at timestamptz
);
alter table public.slack_workspace_pacing enable row level security;
revoke all on public.slack_workspace_pacing from public,anon,authenticated,service_role;
grant select,insert,update on public.slack_workspace_pacing to service_role;

create or replace function public.learn_slack_claim_jobs(p_worker uuid,p_batch integer default 1)
returns setof public.platform_jobs language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;team text;pace public.slack_workspace_pacing%rowtype;
 claimed integer:=0;expires timestamptz;candidate uuid;begin
 if current_user<>'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_queue_snapshot' using errcode='22023';end if;
 if p_worker is null or p_batch is null or p_batch not between 1 and 5 then raise exception 'slack_queue_invalid' using errcode='22023';end if;
 -- Bounded scan; paced entries move out of the ready queue without consuming an
 -- attempt or becoming an error. Other workspaces can proceed in the same scan.
 for candidate in select q.id from public.platform_jobs q where q.job_type in ('slack.history_sync','slack.thread_sync')
  and q.status in ('queued','retrying','running') and coalesce(q.available_at,'-infinity')<=clock_timestamp()
  and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp()
  order by q.priority,q.created_at,q.id limit 100
 loop
  exit when claimed>=p_batch;
  -- Lock only the row being considered: a prefetched FOR UPDATE cursor would
  -- otherwise lock other workspaces before this worker has chosen its one job.
  select * into j from public.platform_jobs q where q.id=candidate
   and q.job_type in ('slack.history_sync','slack.thread_sync') and q.status in ('queued','retrying','running')
   and coalesce(q.available_at,'-infinity')<=clock_timestamp() and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp()
   for update skip locked;
  if not found then continue;end if;
  if j.attempt_count is null or j.max_attempts is null or j.max_attempts<1 or (j.attempt_count>=j.max_attempts and not(coalesce(j.metadata,'{}') ? 'slack_page_v1')) then
   update public.platform_jobs set status='dead_letter',dead_lettered_at=clock_timestamp(),failed_at=clock_timestamp(),
    lease_expires_at=null,error_code='slack_history_attempts_exhausted' where id=j.id;
   continue;
  end if;
  team:=null;
  -- A committed page needs only settlement. It never requests another provider
  -- page, so crash recovery is allowed even while that workspace is cooling down.
  if not(coalesce(j.metadata,'{}') ? 'slack_page_v1') then
   if j.job_type='slack.history_sync' then
    select a.settings->'slack_history'->>'teamId' into team from public.connector_accounts a
     join public.tenant_connectors c on c.id=a.tenant_connector_id and c.tenant_id=a.tenant_id and c.connector_id='slack'
     where a.id::text=j.payload->>'connector_account_id' and a.tenant_id=j.tenant_id;
   else
    select t.scope->>'teamId' into team from public.slack_thread_imports t
     join public.connector_accounts a on a.id=t.account_id and a.tenant_id=t.tenant_id
     join public.tenant_connectors c on c.id=a.tenant_connector_id and c.tenant_id=a.tenant_id and c.connector_id='slack'
     where t.id::text=j.payload->>'thread_import_id' and t.tenant_id=j.tenant_id and a.id::text=j.payload->>'connector_account_id';
   end if;
   if team is null or team !~ '^T[A-Z0-9]+$' then
    update public.platform_jobs set status='dead_letter',dead_lettered_at=clock_timestamp(),failed_at=clock_timestamp(),
     lease_expires_at=null,error_code='slack_history_binding_unavailable' where id=j.id;
    continue;
   end if;
   -- Never wait while holding other queue/gate rows. This also serializes the
   -- first insert when two workers see a previously unseen workspace.
   if not pg_try_advisory_xact_lock(hashtextextended('learn-slack-workspace:'||team,0)) then continue;end if;
   select * into pace from public.slack_workspace_pacing where team_id=team for update;
   if found and greatest(pace.next_allowed_at,pace.blocked_until)>clock_timestamp() then
    update public.platform_jobs set available_at=greatest(pace.blocked_until,least(pace.next_allowed_at,clock_timestamp()+interval '60 seconds')) where id=j.id;
    continue;
   end if;
  end if;
  expires:=clock_timestamp()+interval '180 seconds';
  if team is not null then
   insert into public.slack_workspace_pacing(team_id,next_allowed_at,active_job_id,last_started_at)
    values(team,expires+interval '60 seconds',j.id,clock_timestamp())
    on conflict(team_id) do update set next_allowed_at=excluded.next_allowed_at,active_job_id=excluded.active_job_id,last_started_at=excluded.last_started_at;
  end if;
  update public.platform_jobs set status='running',claimed_by='learn-slack:'||p_worker::text,
   claimed_at=clock_timestamp(),lease_expires_at=expires,attempt_count=j.attempt_count+1,last_attempt_at=clock_timestamp(),
   started_at=coalesce(started_at,clock_timestamp()),
   metadata=case when team is null then metadata else coalesce(metadata,'{}')||jsonb_build_object('slack_workspace_v1',jsonb_build_object('teamId',team)) end
   where id=j.id returning * into j;
  claimed:=claimed+1;
  return next j;
 end loop;
end $$;

-- Keep all completion/publication/replay/lease contracts. Only an acknowledged
-- terminal/retry settlement releases its workspace reservation. A lost completion
-- response replays the retained receipt without extending the cooldown again.
do $$declare name text;definition text;needle text:=' return answer;';addition text;begin
 addition:=$patch$
 -- Shared workspace pacing is infrastructure-only. Ownership and unexpired
 -- lease were verified above. No caller-supplied team or budget participates.
 if j.metadata->'slack_workspace_v1'->>'teamId' is not null then
  perform pg_advisory_xact_lock(hashtextextended('learn-slack-workspace:'||(j.metadata->'slack_workspace_v1'->>'teamId'),0));
  update public.slack_workspace_pacing set
   blocked_until=case when p_outcome->>'code'='slack_history_rate_limited' then greatest(blocked_until,clock_timestamp()+make_interval(secs=>greatest(60,(p_outcome->>'retry_after_seconds')::integer))) else blocked_until end,
   next_allowed_at=greatest(clock_timestamp()+interval '60 seconds',blocked_until,
    case when p_outcome->>'code'='slack_history_rate_limited' then clock_timestamp()+make_interval(secs=>greatest(60,(p_outcome->>'retry_after_seconds')::integer)) else '-infinity'::timestamptz end),
   active_job_id=null,last_finished_at=clock_timestamp()
   where team_id=j.metadata->'slack_workspace_v1'->>'teamId' and active_job_id=j.id;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 return answer;$patch$;
 foreach name in array array['learn_slack_finish_job','learn_slack_finish_thread_job'] loop
  definition:=pg_get_functiondef(('public.'||name||'(uuid,uuid,text,integer,jsonb)')::regprocedure);
  if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Reviewed Slack completion differs';end if;
  execute replace(definition,needle,addition);
 end loop;
end $$;


-- INPUT supabase/release/learn-test/014_slack_recovery.sql
-- SOURCE supabase/migrations/20261030160000_learn_slack_history_resume.sql
-- SHA-256 a40a14c793251bbca78d1d75c9f2ef82c1df38854500502dea1d86621001fc29
-- Reviewed recovery of an incomplete channel window. Preserve every prior
-- approval/checkpoint; reuse the same provider bounds and, when selected, cursor.
-- No source import, provider request, credential, schedule or existing-row change
-- occurs when this migration is installed.

create function public.learn_slack_history_state(p_tenant_id uuid,p_account_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;c public.provider_connections%rowtype;tc public.tenant_connectors%rowtype;
 h public.slack_history_imports%rowtype;j public.platform_jobs%rowtype;cfg jsonb;cp jsonb;valid boolean:=false;
 ready boolean:=false;active boolean;fingerprint text;begin
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id;
 if not found then return null;end if;
 select * into tc from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack';
 if not found then return null;end if;
 cfg:=a.settings->'slack_history';cp:=a.sync_cursor;
 select * into c from public.provider_connections where id::text=cfg->>'connectionId' and tenant_id=p_tenant_id and provider='slack';
 ready:=found and a.status='active' and tc.enabled and tc.status='active' and c.status='configured' and c.revoked_at is null
  and c.non_secret_config->>'team_id'=cfg->>'teamId' and 'bot_token'=any(c.configured_fields) and c.secret_refs->>'bot_token' is not null;
 select * into h from public.slack_history_imports where tenant_id=p_tenant_id and account_id=p_account_id
  and 'learn-slack-import:'||id::text=cfg->>'consentReference';
 if found then
  begin
   valid:=cfg->'approved'='true'::jsonb and cfg->>'teamId' ~ '^T[A-Z0-9]+$' and cfg->>'channelId' ~ '^C[A-Z0-9]+$'
    and cfg->>'oldest' ~ '^\d{1,12}\.\d{1,6}$' and cfg->>'latest' ~ '^\d{1,12}\.\d{1,6}$'
    and (cfg->>'latest')::numeric>(cfg->>'oldest')::numeric and (cfg->>'latest')::numeric-(cfg->>'oldest')::numeric<=86400
    and cfg->>'connectionId'=h.definition->>'connectionId' and cfg->>'channelId'=h.definition->>'channelId'
    and (cfg->>'oldest')::numeric=extract(epoch from (h.definition->>'start')::timestamptz)
    and (cfg->>'latest')::numeric=extract(epoch from (h.definition->>'end')::timestamptz)
    and (cfg->>'maxPages')::integer between 1 and 10 and cfg->'maxPages'=h.definition->'maxPages'
    and (cp='{}'::jsonb or (jsonb_typeof(cp)='object'
     and (cp->>'scopeKey')::jsonb=jsonb_build_array(p_tenant_id::text,cfg->>'teamId',cfg->>'channelId',cfg->>'oldest',cfg->>'latest',cfg->>'consentReference')
     and jsonb_typeof(cp->'pages')='number' and cp->>'pages' ~ '^\d+$' and (cp->>'pages')::integer between 0 and (cfg->>'maxPages')::integer
     and jsonb_typeof(cp->'complete')='boolean' and (cp->'cursor'='null'::jsonb or jsonb_typeof(cp->'cursor')='string' and length(cp->>'cursor') between 1 and 1024)
     and (cp->'complete'<>'true'::jsonb or cp->'cursor'='null'::jsonb)));
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then valid:=false;
  end;
 end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant_id and job_type='slack.history_sync'
  and payload->>'connector_account_id'=p_account_id::text order by created_at desc,id desc limit 1;
 select exists(select 1 from public.platform_jobs where tenant_id=p_tenant_id and job_type='slack.history_sync'
  and payload->>'connector_account_id'=p_account_id::text and status in ('queued','running','retrying')) into active;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(a.id,a.tenant_id,a.status,cfg,cp,h.id,
  tc.enabled,tc.status,c.id,c.updated_at,c.status,c.revoked_at,c.non_secret_config->>'team_id',ready,active,
  j.id,j.status,j.attempt_count,j.available_at,j.error_code,j.result->>'stopReason')::text,'UTF8')),'hex');
 return jsonb_build_object('tenantId',p_tenant_id,'accountId',p_account_id,'name',coalesce(a.display_name,cfg->>'channelId'),
  'scope',cfg,'checkpoint',cp,'approvalId',h.id,'approvedAt',h.approved_at,'stateVersion',fingerprint,
  'previousApprovalId',h.definition->>'resumesImportId','recoveryMode',h.definition->'recovery'->>'mode',
  'stateValid',coalesce(valid,false),'connectionReady',coalesce(ready,false),'active',active,
  'latestJob',case when j.id is null then null else jsonb_build_object('id',j.id,'status',j.status,
   'availableAt',case when j.status in ('queued','retrying') then j.available_at else null end,
   'errorCode',case when j.error_code ~ '^slack_history_[a-z_]{1,80}$' then j.error_code else null end,
   'stopReason',case when j.result->>'stopReason' in ('window_pages_complete','page_budget_exhausted','run_page_limit','authorisation_changed') then j.result->>'stopReason' else null end) end);
end $$;
revoke all on function public.learn_slack_history_state(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_slack_history_read(p_tenant_id uuid,p_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare state jsonb;cfg jsonb;cp jsonb;can_resume boolean;begin
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id() then raise exception 'Company access required' using errcode='42501';end if;
 state:=public.learn_slack_history_state(p_tenant_id,p_account_id);
 if state is null then raise exception 'Stored Slack channel unavailable' using errcode='42501';end if;
 cfg:=state->'scope';cp:=state->'checkpoint';
 can_resume:=state->'stateValid'='true'::jsonb and state->'connectionReady'='true'::jsonb and state->'active'='false'::jsonb and cp->'complete' is distinct from 'true'::jsonb;
 return (state-array['scope','checkpoint','connectionReady'])||jsonb_build_object('version','learn-slack-history/1','teamId',cfg->>'teamId','channelId',cfg->>'channelId',
  'window',case when state->'stateValid'='true'::jsonb then jsonb_build_object('start',to_timestamp((cfg->>'oldest')::numeric),'end',to_timestamp((cfg->>'latest')::numeric),
   'pageLimit',cfg->'maxPages','expiresAt',cfg->>'expiresAt') else null end,
  'progress',case when state->'stateValid'='true'::jsonb then jsonb_build_object('pagesThisApproval',coalesce((cp->>'pages')::integer,0),'complete',coalesce((cp->>'complete')::boolean,false),'hasCursor',cp->>'cursor' is not null) else null end,
  'canContinue',can_resume and (cp='{}'::jsonb or cp->>'cursor' is not null or cp->'pages'='0'::jsonb),
  'canRestart',can_resume,'coverage','bounded_channel_window');
end $$;
revoke all on function public.learn_slack_history_read(uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_history_read(uuid,uuid) to authenticated;

create function public.learn_slack_resume_history(p_tenant_id uuid,p_request_id uuid,p_account_id uuid,
 p_expected_state_version text,p_mode text,p_max_pages integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;c public.provider_connections%rowtype;tc public.tenant_connectors%rowtype;
 prior public.slack_history_imports%rowtype;state jsonb;cfg jsonb;cp jsonb;definition jsonb;scope jsonb;checkpoint jsonb;job_id uuid:=gen_random_uuid();begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Slack recovery requires a fresh snapshot' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant_id::text,0));
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id() or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';end if;
 if p_request_id is null or p_account_id is null or coalesce(p_expected_state_version,'') !~ '^[a-f0-9]{64}$'
  or p_mode is null or p_mode not in ('continue','restart') or p_max_pages is null or p_max_pages not between 1 and 10
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Invalid channel recovery approval' using errcode='22023';end if;
 -- Store supplied review identity separately so exact retries still resolve after
 -- later pages or approvals have changed the current channel state.
 definition:=jsonb_build_object('recovery',jsonb_build_object('accountId',p_account_id,'stateVersion',p_expected_state_version,'mode',p_mode,'maxPages',p_max_pages,'reason',btrim(p_reason)));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-request:'||p_request_id::text,0));
 select * into prior from public.slack_history_imports where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.account_id<>p_account_id or prior.definition->'recovery' is distinct from definition->'recovery' then
   raise exception 'Recovery request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('requestId',prior.id,'accountId',prior.account_id,'jobId',prior.job_id,'reused',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant_id::text,0));
 -- Follow initial setup's connection-before-account lock order. A different
 -- connection/config observed after the account lock makes the review stale.
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id;
 if not found then raise exception 'Stored Slack channel unavailable' using errcode='42501';end if;
 select * into c from public.provider_connections where id::text=a.settings->'slack_history'->>'connectionId' and tenant_id=p_tenant_id and provider='slack' for share;
 if not found then raise exception 'Slack connection unavailable' using errcode='55000';end if;
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id for update;
 select * into tc from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack' for share;
 if not found or a.settings->'slack_history'->>'connectionId' is distinct from c.id::text then raise exception 'Slack channel changed' using errcode='PT409';end if;
 state:=public.learn_slack_history_state(p_tenant_id,p_account_id);
 if state->>'stateVersion' is distinct from p_expected_state_version then raise exception 'Channel progress changed; reload review' using errcode='PT409';end if;
 if state->'stateValid' is distinct from 'true'::jsonb or state->'connectionReady' is distinct from 'true'::jsonb then raise exception 'Channel recovery unavailable' using errcode='55000';end if;
 if state->'active'='true'::jsonb then raise exception 'A channel import is still active' using errcode='55000';end if;
 cfg:=state->'scope';cp:=state->'checkpoint';
 if cp->'complete'='true'::jsonb then raise exception 'This window is already captured' using errcode='55000';end if;
 if p_mode='continue' and cp<>'{}'::jsonb and cp->>'cursor' is null and cp->'pages'<>'0'::jsonb then
  raise exception 'No saved cursor is available; review a restart' using errcode='55000';end if;
 scope:=cfg||jsonb_build_object('approved',true,'maxPages',p_max_pages,'expiresAt',clock_timestamp()+interval '24 hours','consentReference','learn-slack-import:'||p_request_id::text);
 checkpoint:=jsonb_build_object('scopeKey',array_to_json(array[p_tenant_id::text,scope->>'teamId',scope->>'channelId',scope->>'oldest',scope->>'latest',scope->>'consentReference'])::text,
  'cursor',case when p_mode='continue' then cp->>'cursor' else null end,'pages',0,'complete',false);
 definition:=definition||jsonb_build_object('connectionId',c.id,'connectionRevision',c.updated_at,'channelId',scope->>'channelId',
  'start',to_timestamp((scope->>'oldest')::numeric),'end',to_timestamp((scope->>'latest')::numeric),'maxPages',p_max_pages,'reason',btrim(p_reason),'resumesImportId',state->>'approvalId');
 update public.connector_accounts set settings=settings||jsonb_build_object('slack_history',scope),sync_cursor=checkpoint where id=p_account_id and tenant_id=p_tenant_id;
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(job_id,p_tenant_id,'slack','slack.history_sync','slack.history:'||p_account_id::text,'queued',5,clock_timestamp(),
   jsonb_build_object('connector_account_id',p_account_id,'history_import_id',p_request_id),auth.uid());
 insert into public.slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition,previous_state)
  values(p_request_id,p_tenant_id,p_account_id,job_id,auth.uid(),definition,jsonb_build_object('settings',cfg,'checkpoint',cp));
 return jsonb_build_object('requestId',p_request_id,'accountId',p_account_id,'jobId',job_id,'reused',false);
end $$;
revoke all on function public.learn_slack_resume_history(uuid,uuid,uuid,text,text,integer,text) from public,anon,service_role;
grant execute on function public.learn_slack_resume_history(uuid,uuid,uuid,text,text,integer,text) to authenticated;


-- INPUT supabase/release/learn-test/021_slack_thread_recovery.sql
create index learn_slack_thread_approval_order on public.slack_thread_imports(tenant_id,account_id,approved_at desc,id desc);
create unique index learn_slack_thread_one_recovery on public.slack_thread_imports(tenant_id,(definition->>'resumesImportId')) where definition ? 'resumesImportId';

create function public.learn_slack_thread_recovery_state(p_tenant_id uuid,p_import_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare t public.slack_thread_imports%rowtype;a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 tc public.tenant_connectors%rowtype;j public.platform_jobs%rowtype;cfg jsonb;cp jsonb;valid boolean:=false;ready boolean:=false;
 active boolean;newer uuid;key text;fingerprint text;
begin
 select * into t from public.slack_thread_imports where id=p_import_id and tenant_id=p_tenant_id;
 if not found then return null;end if;
 select * into a from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id;
 if not found then return null;end if;
 select * into tc from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack';
 if not found then return null;end if;
 cfg:=t.scope;cp:=t.checkpoint;
 select * into c from public.provider_connections where id::text=cfg->>'connectionId' and tenant_id=p_tenant_id and provider='slack';
 ready:=found and a.status='active' and tc.enabled and tc.status='active' and c.status='configured' and c.revoked_at is null
  and c.non_secret_config->>'team_id'=cfg->>'teamId' and 'bot_token'=any(c.configured_fields) and c.secret_refs->>'bot_token' is not null
  and a.settings->'slack_history'->>'connectionId'=cfg->>'connectionId'
  and a.settings->'slack_history'->>'teamId'=cfg->>'teamId' and a.settings->'slack_history'->>'channelId'=cfg->>'channelId';
 begin
  valid:=cfg->'approved'='true'::jsonb and cfg->>'consentReference'='learn-slack-thread:'||t.id::text
   and cfg->>'teamId' ~ '^T[A-Z0-9]+$' and cfg->>'channelId' ~ '^C[A-Z0-9]+$'
   and cfg->>'parentTimestamp' ~ '^\d{1,12}\.\d{1,6}$' and cfg->>'oldest' ~ '^\d{1,12}\.\d{1,6}$' and cfg->>'latest' ~ '^\d{1,12}\.\d{1,6}$'
   and (cfg->>'latest')::numeric>(cfg->>'oldest')::numeric and (cfg->>'latest')::numeric-(cfg->>'oldest')::numeric<=86400
   and (cfg->>'parentTimestamp')::numeric<=(cfg->>'latest')::numeric
   and (cfg->>'oldest')::numeric=extract(epoch from (t.definition->>'start')::timestamptz)
   and (cfg->>'latest')::numeric=extract(epoch from (t.definition->>'end')::timestamptz)
   and isfinite((cfg->>'expiresAt')::timestamptz)
   and jsonb_typeof(cfg->'maxPages')='number' and cfg->>'maxPages' ~ '^[0-9]+$' and (cfg->>'maxPages')::integer between 1 and 10 and cfg->'maxPages'=t.definition->'maxPages'
   and (cp='{}'::jsonb or (jsonb_typeof(cp)='object' and (select count(*)=4 from jsonb_object_keys(cp))
    and (cp->>'scopeKey')::jsonb=jsonb_build_array(p_tenant_id::text,cfg->>'teamId',cfg->>'channelId',cfg->>'oldest',cfg->>'latest',cfg->>'consentReference',cfg->>'parentTimestamp')
    and jsonb_typeof(cp->'pages')='number' and cp->>'pages' ~ '^\d+$' and (cp->>'pages')::integer between 0 and (cfg->>'maxPages')::integer
    and jsonb_typeof(cp->'complete')='boolean' and (cp->'cursor'='null'::jsonb or jsonb_typeof(cp->'cursor')='string' and length(cp->>'cursor') between 1 and 1024)
    and (cp->'complete'<>'true'::jsonb or cp->'cursor'='null'::jsonb)));
  key:='slack.thread:'||t.account_id::text||':'||(cfg->>'parentTimestamp')||':'||extract(epoch from (t.definition->>'start')::timestamptz)::text||':'||extract(epoch from (t.definition->>'end')::timestamptz)::text;
 exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then valid:=false;
 end;
 select id into newer from public.slack_thread_imports where tenant_id=p_tenant_id and account_id=t.account_id
  and ((approved_at,id)>(t.approved_at,t.id) or definition->>'resumesImportId'=t.id::text) and scope->>'parentTimestamp'=cfg->>'parentTimestamp'
  and scope->>'oldest'=cfg->>'oldest' and scope->>'latest'=cfg->>'latest' order by approved_at desc,id desc limit 1;
 select * into j from public.platform_jobs where tenant_id=p_tenant_id and job_type='slack.thread_sync'
  and payload->>'thread_import_id'=t.id::text order by created_at desc,id desc limit 1;
 select exists(select 1 from public.platform_jobs where tenant_id=p_tenant_id and job_type='slack.thread_sync'
  and (job_key=key or payload->>'thread_import_id'=t.id::text) and status in ('queued','running','retrying')) into active;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(t.id,t.definition,cfg,cp,a.id,a.status,a.settings->'slack_history'->>'connectionId',
  a.settings->'slack_history'->>'teamId',a.settings->'slack_history'->>'channelId',tc.enabled,tc.status,c.id,c.updated_at,c.status,c.revoked_at,
  c.non_secret_config->>'team_id',ready,active,newer,j.id,j.status,j.attempt_count,j.available_at,j.error_code,j.result->>'stopReason')::text,'UTF8')),'hex');
 return jsonb_build_object('tenantId',p_tenant_id,'accountId',t.account_id,'importId',t.id,'approvedAt',t.approved_at,
  'previousImportId',t.definition->>'resumesImportId','recoveryMode',t.definition->'recovery'->>'mode','supersededBy',newer,
  'scope',cfg,'checkpoint',cp,'jobKey',key,'stateVersion',fingerprint,'stateValid',coalesce(valid,false),'connectionReady',coalesce(ready,false),'active',active,
  'latestJob',case when j.id is null then null else jsonb_build_object('id',j.id,'status',j.status,
   'availableAt',case when j.status in ('queued','retrying') then j.available_at else null end,
   'errorCode',case when j.error_code ~ '^slack_history_[a-z_]{1,80}$' then j.error_code else null end,
   'stopReason',case when j.result->>'stopReason' in ('window_pages_complete','page_budget_exhausted','run_page_limit','authorisation_changed') then j.result->>'stopReason' else null end) end);
end $$;
revoke all on function public.learn_slack_thread_recovery_state(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_slack_thread_recovery_read(p_tenant_id uuid,p_import_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare state jsonb;cfg jsonb;cp jsonb;eligible boolean;
begin
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id() then raise exception 'Company access required' using errcode='42501';end if;
 state:=public.learn_slack_thread_recovery_state(p_tenant_id,p_import_id);
 if state is null then raise exception 'Stored thread import unavailable' using errcode='42501';end if;
 cfg:=state->'scope';cp:=state->'checkpoint';
 eligible:=state->'stateValid'='true'::jsonb and state->'connectionReady'='true'::jsonb and state->'active'='false'::jsonb
  and state->>'supersededBy' is null and cp->'complete' is distinct from 'true'::jsonb;
 return (state-array['scope','checkpoint','jobKey','connectionReady'])||jsonb_build_object('version','learn-slack-thread-recovery/1',
  'teamId',cfg->>'teamId','channelId',cfg->>'channelId','parentTimestamp',cfg->>'parentTimestamp','coverage','observed_thread_window',
  'window',case when state->'stateValid'='true'::jsonb then jsonb_build_object('start',to_timestamp((cfg->>'oldest')::numeric),'end',to_timestamp((cfg->>'latest')::numeric),'pageLimit',cfg->'maxPages','expiresAt',cfg->>'expiresAt') else null end,
  'progress',case when state->'stateValid'='true'::jsonb then jsonb_build_object('pagesThisApproval',coalesce((cp->>'pages')::integer,0),'complete',coalesce((cp->>'complete')::boolean,false),'hasCursor',cp->>'cursor' is not null) else null end,
  'canContinue',eligible and (cp='{}'::jsonb or cp->>'cursor' is not null or cp->'pages'='0'::jsonb),'canRestart',eligible);
end $$;
revoke all on function public.learn_slack_thread_recovery_read(uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_thread_recovery_read(uuid,uuid) to authenticated;

create function public.learn_slack_resume_thread(p_tenant_id uuid,p_request_id uuid,p_import_id uuid,p_expected_state_version text,p_mode text,p_max_pages integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.slack_thread_imports%rowtype;prior public.slack_thread_imports%rowtype;a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 state jsonb;cfg jsonb;cp jsonb;definition jsonb;scope jsonb;checkpoint jsonb;key text;job_id uuid:=gen_random_uuid();
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Thread recovery requires a fresh snapshot' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant_id::text,0));
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id() or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';end if;
 if p_request_id is null or p_import_id is null or coalesce(p_expected_state_version,'') !~ '^[a-f0-9]{64}$'
  or p_mode is null or p_mode not in ('continue','restart') or p_max_pages is null or p_max_pages not between 1 and 10
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Invalid thread recovery approval' using errcode='22023';end if;
 definition:=jsonb_build_object('recovery',jsonb_build_object('importId',p_import_id,'stateVersion',p_expected_state_version,'mode',p_mode,'maxPages',p_max_pages,'reason',btrim(p_reason)));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-thread-request:'||p_request_id::text,0));
 select * into prior from public.slack_thread_imports where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.approved_by<>auth.uid() or prior.definition->'recovery' is distinct from definition->'recovery' then raise exception 'Thread recovery request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('requestId',prior.id,'previousImportId',p_import_id,'accountId',prior.account_id,'jobId',prior.initial_job_id,'reused',true);
 end if;
 select * into t from public.slack_thread_imports where id=p_import_id and tenant_id=p_tenant_id;
 if not found then raise exception 'Stored thread import unavailable' using errcode='42501';end if;
 state:=public.learn_slack_thread_recovery_state(p_tenant_id,p_import_id);key:=state->>'jobKey';
 if state->'stateValid' is distinct from 'true'::jsonb or key is null then raise exception 'Thread recovery unavailable' using errcode='55000';end if;
 -- Share initial approval's exact window lock. Existing workers lock their import
 -- before publishing or completing; a still-active job always refuses recovery.
 perform pg_advisory_xact_lock(hashtextextended(key,0));
 select * into c from public.provider_connections where id::text=t.scope->>'connectionId' and tenant_id=p_tenant_id and provider='slack' for share;
 if not found then raise exception 'Thread connection unavailable' using errcode='55000';end if;
 select * into a from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id for share;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack' for share;
 select * into t from public.slack_thread_imports where id=p_import_id and tenant_id=p_tenant_id for update;
 state:=public.learn_slack_thread_recovery_state(p_tenant_id,p_import_id);
 if state->>'stateVersion' is distinct from p_expected_state_version then raise exception 'Thread progress changed; reload review' using errcode='PT409';end if;
 if state->'stateValid' is distinct from 'true'::jsonb or state->'connectionReady' is distinct from 'true'::jsonb
  or state->'active'='true'::jsonb or state->>'supersededBy' is not null then raise exception 'Thread recovery unavailable' using errcode='55000';end if;
 cfg:=state->'scope';cp:=state->'checkpoint';
 if cp->'complete'='true'::jsonb then raise exception 'This thread window is already captured' using errcode='55000';end if;
 if p_mode='continue' and cp<>'{}'::jsonb and cp->>'cursor' is null and cp->'pages'<>'0'::jsonb then raise exception 'No saved cursor; review a thread restart' using errcode='55000';end if;
 scope:=cfg||jsonb_build_object('approved',true,'maxPages',p_max_pages,'expiresAt',clock_timestamp()+interval '24 hours','consentReference','learn-slack-thread:'||p_request_id::text);
 checkpoint:=jsonb_build_object('scopeKey',array_to_json(array[p_tenant_id::text,scope->>'teamId',scope->>'channelId',scope->>'oldest',scope->>'latest',scope->>'consentReference',scope->>'parentTimestamp'])::text,
  'cursor',case when p_mode='continue' then cp->>'cursor' else null end,'pages',0,'complete',false);
 definition:=(t.definition-array['recovery','previousState','resumesImportId'])||definition||jsonb_build_object('connectionRevision',c.updated_at,'maxPages',p_max_pages,'reason',btrim(p_reason),
  'resumesImportId',t.id,'previousState',jsonb_build_object('scope',cfg,'checkpoint',cp));
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(job_id,p_tenant_id,'slack','slack.thread_sync',key,'queued',5,clock_timestamp(),jsonb_build_object('thread_import_id',p_request_id,'connector_account_id',t.account_id),auth.uid());
 insert into public.slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope,checkpoint)
  values(p_request_id,p_tenant_id,t.account_id,t.source_message_id,job_id,auth.uid(),definition,scope,checkpoint);
 return jsonb_build_object('requestId',p_request_id,'previousImportId',t.id,'accountId',t.account_id,'jobId',job_id,'reused',false);
end $$;
revoke all on function public.learn_slack_resume_thread(uuid,uuid,uuid,text,text,integer,text) from public,anon,service_role;
grant execute on function public.learn_slack_resume_thread(uuid,uuid,uuid,text,text,integer,text) to authenticated;

-- INPUT supabase/migrations/20261031230000_learn_capture_controls.sql
create function public.learn_capture_allowed(p_tenant uuid,p_source text) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 if p_tenant is null or p_source is null or p_source not in ('email','phone','slack') then
  raise exception 'learn_capture_source_invalid' using errcode='22023';end if;
 return exists(select 1 from public.tenants where id=p_tenant and status='active')
  and not exists(select 1 from public.feature_flags where tenant_id=p_tenant
   and flag in ('learn.enabled','learn.inputs.'||p_source||'.enabled')
   and (jsonb_typeof(value) is distinct from 'boolean' or value is distinct from 'true'::jsonb));
end $$;

revoke all on function public.learn_capture_allowed(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_capture_allowed(uuid,text) to service_role;

-- INPUT supabase/migrations/20261101003000_learn_slack_recurring.sql
-- Explicit ongoing channel approval; no activation, credentials or schedule seeded.
-- Each new window uses the existing fenced Slack worker and retained page protocol.

create function public.learn_slack_recurring_access(p_tenant uuid,p_write boolean) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(auth.uid() is not null and p_tenant is not null and p_write is not null
  and (case when p_write then
   ((p_tenant=public.current_tenant_id() and public.current_user_role() in ('owner','admin'))
     or public.current_user_is_openfolk_operator('platform.controlplane.admin'))
   and not exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null
    and (expires_at is null or expires_at>now()))
  else p_tenant=public.current_tenant_id() or public.current_user_is_openfolk_operator('platform.controlplane.view') end),false);
$$;
revoke all on function public.learn_slack_recurring_access(uuid,boolean) from public,anon;
grant execute on function public.learn_slack_recurring_access(uuid,boolean) to authenticated;
create table public.slack_recurring_channels (
 account_id uuid primary key references public.connector_accounts(id),
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null references public.provider_connections(id),
 connection_revision timestamptz not null,
 team_id text not null check(team_id ~ '^T[A-Z0-9]+$'),
 channel_id text not null check(channel_id ~ '^C[A-Z0-9]+$'),
 approved_by uuid not null references public.profiles(id),
 enabled boolean not null,
 revision bigint not null default 1 check(revision>0),
 next_start timestamptz not null,
 current_import uuid references public.slack_history_imports(id),
 last_state text not null default 'ready',
 next_check_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(isfinite(next_start) and next_start>=to_timestamp(0))
);
alter table public.slack_recurring_channels enable row level security;
create index slack_recurring_due on public.slack_recurring_channels(next_check_at,account_id) where enabled;
revoke all on public.slack_recurring_channels from public,anon,authenticated,service_role;
grant select on public.slack_recurring_channels to authenticated,service_role;
create policy slack_recurring_read on public.slack_recurring_channels for select to authenticated
 using(public.learn_slack_recurring_access(tenant_id,false));
create table public.slack_recurring_requests (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),definition jsonb not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.slack_recurring_requests enable row level security;
revoke all on public.slack_recurring_requests from public,anon,authenticated,service_role;
create trigger slack_recurring_request_immutable before update or delete on public.slack_recurring_requests
 for each row execute function public.slack_version_immutable();

create function public.learn_slack_recurring_control(p_tenant uuid,p_request uuid,p_account uuid,
 p_revision bigint,p_enabled boolean,p_reason text,p_mode text default 'apply',p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 s public.slack_recurring_channels%rowtype;r public.slack_recurring_requests%rowtype;
 definition jsonb;answer jsonb;cfg jsonb;boundary timestamptz;resume_paused boolean;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'slack_recurring_snapshot' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 if p_actor is distinct from auth.uid() or not public.learn_slack_recurring_access(p_tenant,true) then
  raise exception 'slack_recurring_forbidden' using errcode='42501';end if;
 if p_request is null or p_account is null or p_revision is null or p_revision<0 or p_enabled is null
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or p_mode is null or p_mode not in ('apply','check','cancel') then
  raise exception 'slack_recurring_invalid' using errcode='22023';end if;
 definition:=jsonb_build_object('accountId',p_account,'revision',p_revision,'enabled',p_enabled,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-recurring-request:'||p_request::text,0));
 select * into r from public.slack_recurring_requests where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.actor_id<>auth.uid() or r.definition<>definition then
   raise exception 'slack_recurring_request_changed' using errcode='40001';end if;
  return r.receipt;
 end if;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'accountId',p_account,
  'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return answer;end if;
 if p_mode='cancel' then
  insert into public.slack_recurring_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,auth.uid(),definition,answer);
  return answer;
 end if;
 -- Same setup lock as manual channel imports; subscription precedes account locks.
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant::text,0));
 select * into s from public.slack_recurring_channels where account_id=p_account for update;
 if (found and (s.tenant_id<>p_tenant or s.revision<>p_revision)) or (not found and p_revision<>0) then
  raise exception 'slack_recurring_changed' using errcode='40001';end if;
 select * into a from public.connector_accounts where id=p_account and tenant_id=p_tenant for update;
 if not found then raise exception 'slack_recurring_account_unavailable' using errcode='42501';end if;
 cfg:=a.settings->'slack_history';
 resume_paused:=s.account_id is not null and not s.enabled and s.current_import is not null
  and cfg->>'consentReference'='learn-slack-import:'||s.current_import::text
  and cfg->'approved'='false'::jsonb;
 resume_paused:=coalesce(resume_paused,false);
 if p_enabled then
  if a.status is distinct from 'active' or coalesce(cfg->>'channelId','') !~ '^C[A-Z0-9]+$'
   or coalesce(cfg->>'teamId','') !~ '^T[A-Z0-9]+$'
   or coalesce(cfg->>'latest','') !~ '^\d{1,12}\.\d{1,6}$'
   or not exists(select 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant
    and connector_id='slack' and enabled and status='active') then
   raise exception 'slack_recurring_finish_initial_import' using errcode='55000';end if;
  if not resume_paused and a.sync_cursor->'complete' is distinct from 'true'::jsonb then
   raise exception 'slack_recurring_finish_initial_import' using errcode='55000';end if;
  if not resume_paused and exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='slack.history_sync'
   and payload->>'connector_account_id'=p_account::text and status in ('queued','running','retrying')) then
   raise exception 'slack_recurring_window_active' using errcode='55000';end if;
  -- A true checkpoint alone is insufficient: require matching durable publication.
  if not resume_paused and not exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='slack.history_sync'
   and payload->>'connector_account_id'=p_account::text and status='succeeded'
   and metadata->'slack_page_v1'->'next'=a.sync_cursor
   and metadata->'slack_page_v1'->>'account_id'=p_account::text) then
   raise exception 'slack_recurring_completion_unverified' using errcode='55000';end if;
  select * into c from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant for share;
  if not found or c.provider is distinct from 'slack' or c.status is distinct from 'configured' or c.revoked_at is not null
   or c.non_secret_config->>'team_id' is distinct from cfg->>'teamId'
   or ('bot_token'=any(c.configured_fields)) is distinct from true or c.secret_refs->>'bot_token' is null then
   raise exception 'slack_recurring_connection_unavailable' using errcode='55000';end if;
  boundary:=to_timestamp((cfg->>'latest')::double precision);
  if boundary>clock_timestamp() then raise exception 'slack_recurring_future_window' using errcode='22023';end if;
  if resume_paused then
   if c.id<>s.connection_id or c.updated_at<>s.connection_revision or cfg->>'teamId'<>s.team_id or cfg->>'channelId'<>s.channel_id then
    raise exception 'slack_recurring_connection_changed' using errcode='40001';end if;
   -- Restore only the approved unfinished scope. Expiry and page limits stay as
   -- recorded; exhausted work still uses the explicit existing recovery flow.
   update public.slack_recurring_channels set enabled=true,revision=revision+1,approved_by=auth.uid(),
    last_state='ready',next_check_at=clock_timestamp(),updated_at=clock_timestamp()
    where account_id=p_account returning * into s;
  else
  insert into public.slack_recurring_channels(account_id,tenant_id,connection_id,connection_revision,team_id,channel_id,approved_by,enabled,next_start)
   values(p_account,p_tenant,c.id,c.updated_at,cfg->>'teamId',cfg->>'channelId',auth.uid(),true,boundary)
   on conflict(account_id) do update set connection_id=excluded.connection_id,connection_revision=excluded.connection_revision,
    team_id=excluded.team_id,channel_id=excluded.channel_id,
    approved_by=excluded.approved_by,enabled=true,next_start=excluded.next_start,current_import=null,
    revision=slack_recurring_channels.revision+1,last_state='ready',next_check_at=clock_timestamp(),updated_at=clock_timestamp()
   returning * into s;
  end if;
  update public.connector_accounts set settings=jsonb_set(settings,'{slack_history,approved}','true') where id=p_account;
 else
  if s.account_id is null then raise exception 'slack_recurring_not_configured' using errcode='55000';end if;
  update public.slack_recurring_channels set enabled=false,revision=revision+1,last_state='disabled',updated_at=clock_timestamp()
   where account_id=p_account returning * into s;
  -- Stop further requests for this recurring window without erasing its checkpoint.
  if s.current_import is not null and cfg->>'consentReference'='learn-slack-import:'||s.current_import::text then
   update public.connector_accounts set settings=jsonb_set(settings,'{slack_history,approved}','false') where id=p_account;
  end if;
 end if;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'accountId',p_account,'state','recorded','enabled',s.enabled,'revision',s.revision);
 insert into public.slack_recurring_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,auth.uid(),definition,answer);
 return answer;
end $$;

create function public.learn_slack_schedule_recurring(p_batch integer default 10) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.slack_recurring_channels%rowtype;a public.connector_accounts%rowtype;
 c public.provider_connections%rowtype;cfg jsonb;previous jsonb;approval jsonb;
 boundary timestamptz;ending timestamptz;request_id uuid;job_id uuid;state text;
 checked integer:=0;queued integer:=0;held integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_recurring_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_batch is null or p_batch not between 1 and 50 then
  raise exception 'slack_recurring_invalid' using errcode='22023';end if;
 -- Select due IDs before taking the established tenant setup lock. All callers
 -- then take the subscription and account locks in that same order.
 for s in select * from public.slack_recurring_channels where enabled and next_check_at<=clock_timestamp()
  order by next_check_at,account_id limit p_batch
 loop
  if not pg_try_advisory_xact_lock(hashtextextended('learn-slack-setup:'||s.tenant_id::text,0)) then continue;end if;
  select * into s from public.slack_recurring_channels where account_id=s.account_id and enabled
   and next_check_at<=clock_timestamp() for update;
  if not found then continue;end if;
  checked:=checked+1;state:='ready';boundary:=s.next_start;
  if not public.learn_capture_allowed(s.tenant_id,'slack') then state:='capture_paused';
  end if;
  perform 1 from public.profiles p where p.id=s.approved_by and
   ((p.tenant_id=s.tenant_id and p.role in ('owner','admin')) or exists(select 1 from public.platform_authority_grants g
     where g.profile_id=p.id and g.permission='platform.controlplane.admin'
     and coalesce(g.effective_from,'-infinity')<=now() and coalesce(g.effective_to,'infinity')>now())) for share;
  if state='ready' and not found then state:='approval_changed';end if;
  select * into a from public.connector_accounts where id=s.account_id and tenant_id=s.tenant_id for update;
  if not found or a.status is distinct from 'active' then state:='account_unavailable';end if;
  cfg:=a.settings->'slack_history';
  if state='ready' and cfg->'approved' is distinct from 'true'::jsonb then state:='approval_changed';end if;
  select * into c from public.provider_connections where id=s.connection_id and tenant_id=s.tenant_id for share;
  if not found or c.provider is distinct from 'slack' or c.status is distinct from 'configured' or c.revoked_at is not null
   or c.updated_at is distinct from s.connection_revision or c.non_secret_config->>'team_id' is distinct from cfg->>'teamId'
   or cfg->>'connectionId' is distinct from s.connection_id::text or ('bot_token'=any(c.configured_fields)) is distinct from true
   or cfg->>'teamId' is distinct from s.team_id or cfg->>'channelId' is distinct from s.channel_id
   or c.secret_refs->>'bot_token' is null then state:='connection_changed';end if;
  if not exists(select 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=s.tenant_id
   and connector_id='slack' and enabled and status='active') then state:='connector_paused';end if;
  if state='ready' and exists(select 1 from public.platform_jobs where tenant_id=s.tenant_id and job_type='slack.history_sync'
   and payload->>'connector_account_id'=s.account_id::text and status in ('queued','running','retrying')) then state:='window_active';end if;
  if state='ready' then
   if s.current_import is not null and cfg->>'consentReference' is distinct from 'learn-slack-import:'||s.current_import::text then state:='window_changed';
   elsif a.sync_cursor->'complete' is distinct from 'true'::jsonb then state:='window_incomplete';
   elsif not exists(select 1 from public.platform_jobs where tenant_id=s.tenant_id and job_type='slack.history_sync'
    and payload->>'connector_account_id'=s.account_id::text and status='succeeded'
    and metadata->'slack_page_v1'->'next'=a.sync_cursor and metadata->'slack_page_v1'->>'account_id'=s.account_id::text)
    then state:='completion_unverified';
   elsif coalesce(cfg->>'latest','') !~ '^\d{1,12}\.\d{1,6}$' then state:='window_changed';
   else
    boundary:=to_timestamp((cfg->>'latest')::double precision);
    if (s.current_import is null and boundary is distinct from s.next_start) or boundary<s.next_start then state:='window_changed';end if;
   end if;
  end if;
  if state='ready' then
   -- Fifteen-minute windows bound busy-channel pages; 2-minute settling delay.
   ending:=least(boundary+interval '15 minutes',clock_timestamp()-interval '2 minutes');
   if ending-boundary<interval '1 minute' then state:='caught_up';
   else
    request_id:=gen_random_uuid();job_id:=gen_random_uuid();
    previous:=jsonb_build_object('settings',cfg,'checkpoint',a.sync_cursor);
    approval:=jsonb_build_object('approved',true,'connectionId',c.id,'teamId',cfg->>'teamId','channelId',cfg->>'channelId',
     'oldest',to_char(extract(epoch from boundary),'FM999999999999.000000'),
     'latest',to_char(extract(epoch from ending),'FM999999999999.000000'),
     'consentReference','learn-slack-import:'||request_id::text,'expiresAt',clock_timestamp()+interval '24 hours','maxPages',10);
    update public.connector_accounts set settings=settings||jsonb_build_object('slack_history',approval),sync_cursor='{}' where id=a.id;
    insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
     values(job_id,s.tenant_id,'slack','slack.history_sync','slack.history:'||a.id::text,'queued',5,clock_timestamp(),jsonb_build_object('connector_account_id',a.id),s.approved_by);
    insert into public.slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition,previous_state)
     values(request_id,s.tenant_id,a.id,job_id,s.approved_by,jsonb_build_object('connectionId',c.id,'connectionRevision',c.updated_at,
      'channelId',cfg->>'channelId','start',boundary,'end',ending,'maxPages',10,'recurringAccountId',a.id,
      'recurringRevision',s.revision,'reason','Approved recurring channel capture'),previous);
    update public.slack_recurring_channels set current_import=request_id,next_start=boundary where account_id=a.id;
    queued:=queued+1;state:='window_queued';
   end if;
  end if;
  if state not in ('window_queued','window_active','caught_up') then held:=held+1;end if;
  update public.slack_recurring_channels set last_state=state,next_check_at=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() where account_id=s.account_id;
 end loop;
 return jsonb_build_object('checked',checked,'queued',queued,'held',held);
end $$;
revoke all on function public.learn_slack_recurring_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_recurring_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid) to authenticated;
revoke all on function public.learn_slack_schedule_recurring(integer) from public,anon,authenticated;
grant execute on function public.learn_slack_schedule_recurring(integer) to service_role;

create function public.learn_slack_recurring_read(p_tenant uuid,p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;begin
 if not public.learn_slack_recurring_access(p_tenant,false) then raise exception 'slack_recurring_forbidden' using errcode='42501';end if;
 with candidates as (
  select a.* from public.connector_accounts a join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=p_tenant
  where a.tenant_id=p_tenant and tc.connector_id='slack' and (p_after is null or a.id>p_after)
   and a.settings ? 'slack_history' order by a.id limit 51
 ), page as (select * from candidates order by id limit 50), rows as (
  select a.id,jsonb_build_object('accountId',a.id,'name',left(coalesce(a.display_name,'Slack channel'),200),
   'teamId',case when a.settings->'slack_history'->>'teamId' ~ '^T[A-Z0-9]+$' then a.settings->'slack_history'->>'teamId' else null end,
   'channelId',case when a.settings->'slack_history'->>'channelId' ~ '^C[A-Z0-9]+$' then a.settings->'slack_history'->>'channelId' else null end,
   'enabled',coalesce(s.enabled,false),'revision',coalesce(s.revision,0),'state',coalesce(s.last_state,'not_configured'),
   'nextStart',s.next_start,'nextCheckAt',s.next_check_at,'updatedAt',s.updated_at,
   'completeVerified',coalesce(a.sync_cursor->'complete'='true'::jsonb and exists(select 1 from public.platform_jobs j
    where j.tenant_id=p_tenant and j.job_type='slack.history_sync' and j.payload->>'connector_account_id'=a.id::text and j.status='succeeded'
     and j.metadata->'slack_page_v1'->'next'=a.sync_cursor and j.metadata->'slack_page_v1'->>'account_id'=a.id::text),false),
   'pausedWindow',coalesce(not s.enabled and s.current_import is not null
    and a.settings->'slack_history'->>'consentReference'='learn-slack-import:'||s.current_import::text
    and a.settings->'slack_history'->'approved'='false'::jsonb,false)
  ) as item from page a left join public.slack_recurring_channels s on s.account_id=a.id and s.tenant_id=p_tenant
 ) select jsonb_build_object('version','learn-slack-recurring/1','tenantId',p_tenant,
  'canWrite',public.learn_slack_recurring_access(p_tenant,true),'channels',coalesce((select jsonb_agg(item order by id) from rows),'[]'),
  'next',case when (select count(*) from candidates)>50 then (select id from page order by id desc limit 1) else null end)
 into result;
 return result;
end $$;
revoke all on function public.learn_slack_recurring_read(uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_recurring_read(uuid,uuid) to authenticated;

-- INPUT supabase/migrations/20261101005000_learn_slack_recurring_threads.sql
-- Opt-in recurring observed-thread capture. No subscriptions, jobs or credentials seeded.

alter table public.slack_recurring_channels add column include_threads boolean not null default false,
 add column thread_revision bigint not null default 0;
create table public.slack_recurring_thread_windows (
 history_import_id uuid primary key references public.slack_history_imports(id),
 tenant_id uuid not null references public.tenants(id),
 account_id uuid not null references public.connector_accounts(id),
 recurring_revision bigint not null,
 after_parent numeric,
 discovery_complete boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.slack_recurring_thread_windows enable row level security;
revoke all on public.slack_recurring_thread_windows from public,anon,authenticated,service_role;
grant select on public.slack_recurring_thread_windows to service_role;
create table public.slack_recurring_thread_members (
 history_import_id uuid not null references public.slack_recurring_thread_windows(history_import_id),
 parent_timestamp numeric not null,
 thread_import_id uuid not null unique references public.slack_thread_imports(id),
 primary key(history_import_id,parent_timestamp)
);
alter table public.slack_recurring_thread_members enable row level security;
revoke all on public.slack_recurring_thread_members from public,anon,authenticated,service_role;
grant select on public.slack_recurring_thread_members to service_role;

-- Separate control preserves the existing ongoing-channel request contract.
create function public.learn_slack_recurring_threads_control(p_tenant uuid,p_request uuid,p_account uuid,p_revision bigint,p_enabled boolean,p_reason text,p_mode text default 'apply',p_actor uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.slack_recurring_channels%rowtype;r public.slack_recurring_requests%rowtype;definition jsonb;answer jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_recurring_snapshot' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 if p_actor is distinct from auth.uid() or not public.learn_slack_recurring_access(p_tenant,true) then raise exception 'slack_recurring_forbidden' using errcode='42501';end if;
 if p_request is null or p_account is null or p_revision is null or p_revision<1 or p_enabled is null
 or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or p_mode is null or p_mode not in ('apply','check','cancel') then raise exception 'slack_recurring_invalid' using errcode='22023';end if;
 definition:=jsonb_build_object('kind','observed_threads','accountId',p_account,'revision',p_revision,'enabled',p_enabled,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-recurring-request:'||p_request::text,0));
 select * into r from public.slack_recurring_requests where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.actor_id<>auth.uid() or r.definition<>definition then raise exception 'slack_recurring_request_changed' using errcode='40001';end if;
  return r.receipt;
 end if;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'accountId',p_account,'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return answer;end if;
 if p_mode='cancel' then
  insert into public.slack_recurring_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,auth.uid(),definition,answer);
  return answer;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant::text,0));
 select * into s from public.slack_recurring_channels where account_id=p_account and tenant_id=p_tenant for update;
 if not found or s.revision<>p_revision then raise exception 'slack_recurring_changed' using errcode='40001';end if;
 if p_enabled and not s.enabled then raise exception 'slack_recurring_channel_disabled' using errcode='55000';end if;
 -- Do not attach a new approval to an already-discovered window. Disabling is always allowed;
 -- re-enabling waits for a fresh channel window, retaining all earlier thread evidence.
 if p_enabled and exists(select 1 from public.slack_recurring_thread_windows where history_import_id=s.current_import) then
  raise exception 'slack_recurring_thread_window_started' using errcode='55000';end if;
 update public.slack_recurring_channels set include_threads=p_enabled,thread_revision=thread_revision+1,revision=revision+1,approved_by=auth.uid(),
  next_check_at=clock_timestamp(),updated_at=clock_timestamp() where account_id=p_account returning * into s;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'accountId',p_account,'state','recorded','enabled',s.include_threads,'revision',s.revision);
 insert into public.slack_recurring_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,auth.uid(),definition,answer);
 return answer;
end $$;
revoke all on function public.learn_slack_recurring_threads_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid) from public,anon,service_role;
grant execute on function public.learn_slack_recurring_threads_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid) to authenticated;

-- Rechecked before credential access and page publication. Manual approvals retain
-- their existing gate; recurring approvals additionally depend on the live subscription.
create function public.learn_slack_recurring_thread_allowed(p_tenant uuid,p_import uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.slack_thread_imports t where t.id=p_import and t.tenant_id=p_tenant
 and (not (t.definition ? 'recurringHistoryImportId') or exists(
  select 1 from public.slack_recurring_channels s
  join public.provider_connections c on c.id=s.connection_id and c.tenant_id=s.tenant_id
  join public.profiles p on p.id=t.approved_by
  where s.account_id=t.account_id and s.tenant_id=p_tenant and s.enabled and s.include_threads
  and s.thread_revision=(t.definition->>'recurringRevision')::bigint
  and c.updated_at=s.connection_revision and c.updated_at=(t.definition->>'connectionRevision')::timestamptz
  and c.status='configured' and c.revoked_at is null and c.provider='slack'
  and public.learn_capture_allowed(p_tenant,'slack')
  and ((p.tenant_id=p_tenant and p.role in ('owner','admin')) or exists(select 1 from public.platform_authority_grants g
   where g.profile_id=p.id and g.permission='platform.controlplane.admin'
   and coalesce(g.effective_from,'-infinity')<=now() and coalesce(g.effective_to,'infinity')>now())))));
$$;
revoke all on function public.learn_slack_recurring_thread_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.learn_slack_recurring_thread_allowed(uuid,uuid) to service_role;

-- Follow explicit recovery lineage while retaining every earlier approval.
create function public.learn_slack_recurring_thread_window_progress(p_window uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 with recursive lineage(root,id,tenant_id,account_id,scope,definition,checkpoint,approved_at) as (
  select m.thread_import_id,t.id,t.tenant_id,t.account_id,t.scope,t.definition,t.checkpoint,t.approved_at
  from public.slack_recurring_thread_members m join public.slack_thread_imports t on t.id=m.thread_import_id where m.history_import_id=p_window
  union
  select l.root,t.id,t.tenant_id,t.account_id,t.scope,t.definition,t.checkpoint,t.approved_at
  from lineage l join public.slack_thread_imports t on t.definition->>'resumesImportId'=l.id::text
  and t.tenant_id=l.tenant_id and t.account_id=l.account_id
  and t.definition->>'recurringHistoryImportId'=p_window::text
  and t.scope->>'parentTimestamp'=l.scope->>'parentTimestamp'
  and t.scope->>'oldest'=l.scope->>'oldest' and t.scope->>'latest'=l.scope->>'latest'
 ), latest as (select distinct on(root) * from lineage order by root,approved_at desc,id desc)
 select jsonb_build_object('discoveryComplete',(select discovery_complete from public.slack_recurring_thread_windows where history_import_id=p_window),
 'observed',(select count(*) from latest),'completed',(select count(*) from latest t where t.checkpoint->'complete'='true'::jsonb and exists(
  select 1 from public.platform_jobs j where j.tenant_id=t.tenant_id and j.job_type='slack.thread_sync' and j.status='succeeded'
  and j.payload->>'thread_import_id'=t.id::text and j.metadata->'slack_page_v1'->'next'=t.checkpoint
  and j.metadata->'slack_page_v1'->>'thread_import_id'=t.id::text)));
$$;
revoke all on function public.learn_slack_recurring_thread_window_progress(uuid) from public,anon,authenticated,service_role;
create function public.learn_slack_recurring_thread_window_complete(p_window uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(p->'discoveryComplete'='true'::jsonb and p->'observed'=p->'completed',false)
 from public.learn_slack_recurring_thread_window_progress(p_window) p;
$$;
revoke all on function public.learn_slack_recurring_thread_window_complete(uuid) from public,anon,authenticated,service_role;
create function public.learn_slack_recurring_threads_status(p_account uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('enabled',coalesce(s.include_threads,false),'canEnable',coalesce(s.enabled and w.history_import_id is null,false),
 'discoveryComplete',case when w.history_import_id is not null then w.discovery_complete else null end,
 'observed',case when w.history_import_id is not null then progress->'observed' else 'null'::jsonb end,
 'completed',case when w.history_import_id is not null then progress->'completed' else 'null'::jsonb end)
 from (select 1) seed left join public.slack_recurring_channels s on s.account_id=p_account
 left join public.slack_recurring_thread_windows w on w.history_import_id=s.current_import
 left join lateral public.learn_slack_recurring_thread_window_progress(w.history_import_id) progress on true;
$$;
revoke all on function public.learn_slack_recurring_threads_status(uuid) from public,anon,authenticated,service_role;
-- Only the existing tenant-scoped reader exposes this non-secret summary.
do $patch$declare d text;needle text:='   ''pausedWindow'',coalesce';begin
 d:=pg_get_functiondef('public.learn_slack_recurring_read(uuid,uuid)'::regprocedure);
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed recurring reader changed';end if;
 execute replace(d,needle,'   ''threads'',public.learn_slack_recurring_threads_status(a.id),'||chr(10)||needle);
end $patch$;

-- Called under the existing scheduler's subscription/account locks. At most twenty
-- observed parents are queued per pass. Numeric timestamps deduplicate equivalent IDs.
create function public.learn_slack_queue_recurring_threads(p_account uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.slack_recurring_channels%rowtype;a public.connector_accounts%rowtype;i public.slack_history_imports%rowtype;
 w public.slack_recurring_thread_windows%rowtype;m record;request_id uuid;job_id uuid;key text;cfg jsonb;scope jsonb;scanned integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_recurring_forbidden' using errcode='42501';end if;
 select * into s from public.slack_recurring_channels where account_id=p_account;
 if not found then return false;end if;
 -- Serialize direct calls with the channel scheduler and controls, in their lock order.
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||s.tenant_id::text,0));
 select * into s from public.slack_recurring_channels where account_id=p_account for update;
 if not s.enabled or not s.include_threads or s.current_import is null then return false;end if;
 if not public.learn_capture_allowed(s.tenant_id,'slack') then return false;end if;
 perform 1 from public.profiles p where p.id=s.approved_by and
 ((p.tenant_id=s.tenant_id and p.role in ('owner','admin')) or exists(select 1 from public.platform_authority_grants g
 where g.profile_id=p.id and g.permission='platform.controlplane.admin'
 and coalesce(g.effective_from,'-infinity')<=now() and coalesce(g.effective_to,'infinity')>now())) for share;
 if not found then return false;end if;
 select * into a from public.connector_accounts where id=s.account_id and tenant_id=s.tenant_id for update;
 cfg:=a.settings->'slack_history';
 if not found or a.status<>'active' or cfg->'approved' is distinct from 'true'::jsonb
 or cfg->>'consentReference' is distinct from 'learn-slack-import:'||s.current_import::text
 or cfg->>'connectionId' is distinct from s.connection_id::text or cfg->>'teamId' is distinct from s.team_id
 or cfg->>'channelId' is distinct from s.channel_id or a.sync_cursor->'complete' is distinct from 'true'::jsonb then return false;end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=s.tenant_id and connector_id='slack' and enabled and status='active' for share;
 if not found then return false;end if;
 perform 1 from public.provider_connections where id=s.connection_id and tenant_id=s.tenant_id and provider='slack'
 and status='configured' and revoked_at is null and updated_at=s.connection_revision and non_secret_config->>'team_id'=s.team_id
 and 'bot_token'=any(configured_fields) and secret_refs->>'bot_token' is not null for share;
 if not found then return false;end if;
 select * into i from public.slack_history_imports where id=s.current_import and tenant_id=s.tenant_id and account_id=s.account_id;
 if not found or i.definition->>'recurringAccountId' is distinct from s.account_id::text then return false;end if;
 if not exists(select 1 from public.platform_jobs where tenant_id=s.tenant_id and job_type='slack.history_sync' and status='succeeded'
 and payload->>'connector_account_id'=s.account_id::text and metadata->'slack_page_v1'->'next'=a.sync_cursor
 and metadata->'slack_page_v1'->>'account_id'=s.account_id::text) then return false;end if;
 insert into public.slack_recurring_thread_windows(history_import_id,tenant_id,account_id,recurring_revision)
 values(i.id,s.tenant_id,s.account_id,s.thread_revision) on conflict do nothing;
 select * into w from public.slack_recurring_thread_windows where history_import_id=i.id for update;
 if w.recurring_revision<>s.thread_revision then return false;end if;
 if not w.discovery_complete then
  for m in
   with observed as (
    select sm.*,case when sm.thread_timestamp is not null and sm.thread_timestamp::numeric<sm.provider_timestamp::numeric then sm.thread_timestamp
    when coalesce(sm.provider_payload->>'reply_count','') ~ '^[0-9]+$' and (sm.provider_payload->>'reply_count')::numeric>0 then sm.provider_timestamp end as parent
    from public.slack_messages sm where sm.tenant_id=s.tenant_id and sm.team_id=s.team_id and sm.channel_id=s.channel_id
   ), parents as (
    select distinct on (parent::numeric) id,source_version,parent from observed where parent is not null
    and parent::numeric<=(cfg->>'latest')::numeric and (w.after_parent is null or parent::numeric>w.after_parent)
    order by parent::numeric,id
   ) select * from parents order by parent::numeric limit 20
  loop
   request_id:=gen_random_uuid();job_id:=gen_random_uuid();
   key:='slack.thread:'||a.id::text||':'||m.parent||':'||extract(epoch from (i.definition->>'start')::timestamptz)::text||':'||extract(epoch from (i.definition->>'end')::timestamptz)::text;
   -- Recovery locks the window before the account. Do not wait while holding the account.
   if not pg_try_advisory_xact_lock(hashtextextended(key,0)) then return false;end if;
   if exists(select 1 from public.platform_jobs where tenant_id=s.tenant_id and job_key=key and status in ('queued','running','retrying')) then return false;end if;
   scope:=jsonb_build_object('approved',true,'connectionId',s.connection_id,'teamId',s.team_id,'channelId',s.channel_id,
    'parentTimestamp',m.parent,'oldest',cfg->>'oldest','latest',cfg->>'latest','consentReference','learn-slack-thread:'||request_id::text,
    'expiresAt',clock_timestamp()+interval '24 hours','maxPages',10);
   insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
   values(job_id,s.tenant_id,'slack','slack.thread_sync',key,'queued',5,clock_timestamp(),jsonb_build_object('thread_import_id',request_id,'connector_account_id',a.id),s.approved_by);
   insert into public.slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope)
   values(request_id,s.tenant_id,a.id,m.id,job_id,s.approved_by,jsonb_build_object('accountId',a.id,'sourceMessageId',m.id,'sourceVersion',m.source_version,
    'connectionRevision',s.connection_revision,'start',i.definition->'start','end',i.definition->'end','maxPages',10,
    'recurringHistoryImportId',i.id,'recurringRevision',s.thread_revision,'reason','Approved recurring observed-thread capture'),scope);
   insert into public.slack_recurring_thread_members values(i.id,m.parent::numeric,request_id);
   update public.slack_recurring_thread_windows set after_parent=m.parent::numeric where history_import_id=i.id;
   scanned:=scanned+1;
  end loop;
  if scanned<20 then update public.slack_recurring_thread_windows set discovery_complete=true where history_import_id=i.id;else return false;end if;
 end if;
 return public.learn_slack_recurring_thread_window_complete(i.id);
end $$;
revoke all on function public.learn_slack_queue_recurring_threads(uuid) from public,anon,authenticated;
grant execute on function public.learn_slack_queue_recurring_threads(uuid) to service_role;

-- Preserve the existing channel protocol, inserting only the new optional gate.
do $patch$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_schedule_recurring(integer)'::regprocedure);
 needle:='  if state=''ready'' then'||chr(10)||'   -- Fifteen-minute windows';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed channel scheduler changed';end if;
 execute replace(d,needle,'  if state=''ready'' and s.include_threads and s.current_import is not null then'||chr(10)||
 '   if not public.learn_slack_queue_recurring_threads(s.account_id) then state:=''threads_pending'';end if;'||chr(10)||'  end if;'||chr(10)||needle);
end $patch$;
-- Re-approving an already-enabled channel must not discard unfinished replies.
do $patch$declare d text;needle text:=' resume_paused:=coalesce(resume_paused,false);';begin
 d:=pg_get_functiondef('public.learn_slack_recurring_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid)'::regprocedure);
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed recurring control changed';end if;
 execute replace(d,needle,needle||chr(10)||' if p_enabled and s.include_threads and s.current_import is not null and not resume_paused and not public.learn_slack_recurring_thread_window_complete(s.current_import) then raise exception ''slack_recurring_threads_incomplete'' using errcode=''55000'';end if;');
end $patch$;

-- Both server-side credential and publication paths enforce pause/revocation.
do $patch$declare d text;signature text;needle text:=' cfg:=t.scope;';begin
 foreach signature in array array['public.learn_slack_read_thread_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid)',
  'public.slack_thread_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed thread gate changed: %',signature;end if;
  execute replace(d,needle,' if not public.learn_slack_recurring_thread_allowed(p_tenant_id,t.id) then raise exception ''slack_recurring_thread_paused'' using errcode=''42501'';end if;'||chr(10)||needle);
 end loop;
end $patch$;

insert into of_learn_deploy.migrations values('learn_slack_intake_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
