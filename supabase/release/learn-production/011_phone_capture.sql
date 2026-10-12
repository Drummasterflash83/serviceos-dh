-- DRAFT: requires matched phone workers and explicit production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;actual_views jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Phone target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_email_capture_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='c66f74df447fa77a2fdbd914900ae43b1ce88cd544b769ad6d6b864f071e98a6') then raise exception 'Pinned production Email prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_phone_capture_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['learn_phone_capture_pages','learn_phone_import_completions','learn_phone_schedule_settlements','learn_phone_processing_attempts','learn_phone_result_versions','learn_phone_operator_reconciliations','learn_phone_playback_audit','learn_phone_handoff_receipts']))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_operator_capture_health','learn_phone_capture_flag_lock','learn_phone_publish_page','learn_phone_complete_import','learn_phone_settle_schedule','learn_phone_account_evidence','learn_phone_processing_evidence','learn_phone_download_attempt','learn_phone_apply_intelligence','learn_phone_derived_attempt','learn_operator_phone_attempts','learn_operator_phone_reconcile','learn_phone_recordings_read','learn_phone_playback_authorize','learn_phone_saved_results_read','learn_scheduler_health_read','learn_phone_handoff'])) then raise exception 'Production Phone candidate already exists; inspect before retry';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['call_directions','call_participants','call_transcript_normalisations','connector_accounts','corrections','email_accounts','email_messages','email_sync_runs','feature_flags','graph_nodes','interactions','learn_email_source_versions','phone_ai_insights','phone_calls','phone_recordings','phone_sync_runs','phone_transcripts','platform_events','platform_jobs','profiles','telephony_directory','tenant_connectors','tenant_vocabulary','tenants','view_as_context']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"call_directions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"call_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"provider_direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"originating_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"destination_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_party_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"originating_extension","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"answering_extension","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"pickup_extension","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"transferred_from_extension","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"transferred_to_extension","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction_evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"direction_confidence","type":"numeric","notNull":true,"identity":"","generated":"","defaultHash":"30565a8911a6bb487e3745c0ea3c8224"},{"name":"classifier_version","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"934b931a0e05c4f4c5f655a17bc2c44c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"ba9b18b017a76ff805ed7c9678d990c0","name":"call_directions_call_uk","valid":true},{"hash":"3b8a5701bca4b13f7ece0b5aebb1a23a","name":"call_directions_pkey","valid":true},{"hash":"8a09f2b9522b4ca8bcd978993cbd6580","name":"call_directions_tenant_dir_idx","valid":true}],"forceRls":false,"policies":[{"name":"call_directions_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"66861c5583017e6af6f48520a1e10452","name":"call_directions_set_updated_at","enabled":"O"}],"constraints":[{"hash":"ccea795a9d04c1b3d010f90611c4ec70","kind":"f","name":"call_directions_call_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"call_directions_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"call_participants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"call_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"participant_role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"resolved_entity_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":true,"identity":"","generated":"","defaultHash":"30565a8911a6bb487e3745c0ea3c8224"},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"conflicts","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source_fields","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"resolver_version","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"934b931a0e05c4f4c5f655a17bc2c44c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2caf97e95c4d8eb8b769ba9cb33f7bec","name":"call_participants_call_idx","valid":true},{"hash":"33e04bc3a0b51a29e415f4b7a397716b","name":"call_participants_entity_idx","valid":true},{"hash":"db6416498c5fcf4b5ebd8f8e8e4bdbcd","name":"call_participants_pkey","valid":true}],"forceRls":false,"policies":[{"name":"call_participants_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"ff5cb205121b3726b8017a0d2984bc22","name":"call_participants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"ccea795a9d04c1b3d010f90611c4ec70","kind":"f","name":"call_participants_call_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"call_participants_pkey","validated":true},{"hash":"7b8b4b0d3000d626d8b383fdf6ac8586","kind":"f","name":"call_participants_resolved_entity_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"call_transcript_normalisations","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"transcript_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"normalised_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"corrections","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"normalisation_version","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"934b931a0e05c4f4c5f655a17bc2c44c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"29a7598d8fb375657098a133dcc7331e","name":"call_transcript_norm_uk","valid":true},{"hash":"4ea5366f4c2028dfe10516c5a38eeebd","name":"call_transcript_normalisations_pkey","valid":true}],"forceRls":false,"policies":[{"name":"call_transcript_normalisations_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"09d1912feec6c2b672e31f8c0eb0918e","name":"call_transcript_normalisations_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"call_transcript_normalisations_pkey","validated":true},{"hash":"e7737d682030cea7e26e2cff6fea4eec","kind":"f","name":"call_transcript_normalisations_transcript_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"connector_accounts","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_connector_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"account_key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"settings","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"sync_cursor","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"last_successful_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_failed_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"87038fc7b898fc166bc4afe6e3808ea0","name":"connector_accounts_pkey","valid":true},{"hash":"65449ecbc756cb8abd7ec274359ed101","name":"connector_accounts_tenant_connector_id_account_key_key","valid":true},{"hash":"2b651203438a7f6b7dc3805be39fb611","name":"connector_accounts_tenant_connector_idx","valid":true},{"hash":"a366fa56cd9ccf2d01e76c6c91dd58b6","name":"connector_accounts_tenant_id_idx","valid":true}],"forceRls":false,"policies":[{"name":"connector_accounts_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"11bff68c3a6c7d3d8917929650c7c634","name":"connector_accounts_set_updated_at","enabled":"O"},{"hash":"15acf83bbfeb3b3ad01da15ed046b602","name":"learn_connector_reference_guard","enabled":"O"},{"hash":"e86808e986e786889335c1f286d16df0","name":"learn_connector_retain","enabled":"O"},{"hash":"992d00296f194a61fa9f08ff1de3ba3d","name":"learn_connector_retain_truncate","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"connector_accounts_pkey","validated":true},{"hash":"ce81b1bbe8e19e1ef8737b2016099474","kind":"u","name":"connector_accounts_tenant_connector_id_account_key_key","validated":true},{"hash":"1dec77e8d0a31578e156b528a94701f7","kind":"f","name":"connector_accounts_tenant_connector_id_fkey","validated":true},{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_connector_tenant_fk","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"corrections","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"object_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"decision_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"before","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"after","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"correction_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"scope_hint","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"actor","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"review_level","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"proposed_version_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2e8a0234a4cbd226729e0aed08b56420","name":"corrections_lookup","valid":true},{"hash":"d550b36b3cbe7a9a181c8da2c7d8d5e2","name":"corrections_pkey","valid":true}],"forceRls":false,"policies":[{"name":"corr_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"d52777bee9bdc9bf16994f2017b79fb5","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"9bee66c4a8ce566d7dd3a2e2005f4332","kind":"c","name":"corrections_correction_kind_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"corrections_pkey","validated":true},{"hash":"7b8641871bf85099d758dab093d4a1e2","kind":"f","name":"corrections_proposed_version_id_fkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"corrections_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_accounts","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"email_address","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"backfill_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"4211c0ccfcd36b328b71623726ce8860"},{"name":"backfill_started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_page_token","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"backfill_total_fetched","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"backfill_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"history_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"auth_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"auth_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"auth_state_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_incremental_success_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_incremental_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_sync_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"8c5f1fef9bc0a6370581ec2612f6593c","name":"email_accounts_pkey","valid":true},{"hash":"ff306db49bb9dce90ff69d94e1efedb3","name":"email_accounts_tenant_id_idx","valid":true},{"hash":"448b9e573800fcb3258f76a4e34378ff","name":"email_accounts_tenant_id_provider_email_address_key","valid":true},{"hash":"89919591661cca90db7edf45969364bb","name":"email_accounts_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"email_account_protocol_select_v2","roles":["email_ingestion_protocol_owner"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"},{"name":"email_account_protocol_update_v2","roles":["email_ingestion_protocol_owner"],"command":"UPDATE","checkHash":"b326b5062b2f0e69046810717534cb09","usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"},{"name":"email_accounts_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"3b4b9e3afc4712c0a2eca19c2229c541","name":"email_accounts_set_updated_at","enabled":"O"},{"hash":"accbfe67aad061aa9a75c8245235fa8a","name":"email_ingestion_account_guard_v2","enabled":"O"},{"hash":"594d8a952306667e5cf9b6c8df56c8df","name":"marketing_capability_sync_email_accounts","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_accounts_pkey","validated":true},{"hash":"6a887a787213a24fb65c3f1c76dab1b6","kind":"u","name":"email_accounts_tenant_id_provider_email_address_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_messages","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"provider_message_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"provider_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"cc_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"snippet","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_html","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sent_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"received_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"origin","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_delivery_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_automation_intent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"ddab13827db6fc862b347926210f2b5f","name":"email_messages_from_idx","valid":true},{"hash":"aa0806d4070a7b3212a80a84eb9c7d5c","name":"email_messages_pkey","valid":true},{"hash":"b6c142a1e1681434cb7a2e0292da277d","name":"email_messages_received_idx","valid":true},{"hash":"fe1c7bcc6524405f48f28a236599ee8e","name":"email_messages_tenant_id_idx","valid":true},{"hash":"ca8629c22d3dd310b1126f117b9b008b","name":"email_messages_tenant_id_provider_provider_message_id_key","valid":true},{"hash":"a2e59fd4b71cb47545b35622ff50fd81","name":"email_messages_thread_idx","valid":true}],"forceRls":false,"policies":[{"name":"email_messages_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"87e7af360d7a3fb98bcdea12d9105317","name":"email_messages_set_updated_at","enabled":"O"},{"hash":"f0031e3b13fd91945cc5615cee21adab","name":"learn_email_preserve_source_version","enabled":"O"}],"constraints":[{"hash":"b62110fa0a5753efbae5ef5b8caccc97","kind":"f","name":"email_messages_origin_campaign_fk","validated":true},{"hash":"1220af29a1985a4dabe03353bd48d8fe","kind":"c","name":"email_messages_origin_check","validated":true},{"hash":"a30c441924cbce62b8ad5027db53e1c5","kind":"f","name":"email_messages_origin_delivery_fk","validated":true},{"hash":"19a3d8f70792afd54bb9f0f14df3e6a6","kind":"f","name":"email_messages_origin_intent_fk","validated":true},{"hash":"e865d926f40b1e90e54c88f2d92a7bc1","kind":"f","name":"email_messages_origin_person_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_messages_pkey","validated":true},{"hash":"7b594e8645b3085fdc803326bd97c4e4","kind":"u","name":"email_messages_tenant_id_provider_provider_message_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"email_ingestion_protocol_owner","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_sync_runs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"sync_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"412b424d07d3e1e0d1cf66fe0bdfee56"},{"name":"started_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_message","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"}],"indexes":[{"hash":"16794814da9a7d2eb23073a006bdb248","name":"email_sync_runs_pkey","valid":true},{"hash":"ff8bf491f0bdf1bf75400795c0a344db","name":"email_sync_runs_tenant_id_id_v2","valid":true},{"hash":"45d0df2326d6e27bc87b9e4650e38b30","name":"email_sync_runs_tenant_id_idx","valid":true},{"hash":"6f9b90d0b384aee536b31476a85e620e","name":"email_sync_runs_type_status_idx","valid":true}],"forceRls":false,"policies":[{"name":"email_run_protocol_select_v2","roles":["email_ingestion_protocol_owner"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"},{"name":"email_run_protocol_update_v2","roles":["email_ingestion_protocol_owner"],"command":"UPDATE","checkHash":"b326b5062b2f0e69046810717534cb09","usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"},{"name":"email_sync_runs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"081d547fa9a924bc6453c5779ede25e6","name":"email_ingestion_run_guard_v2","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_sync_runs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"feature_flags","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"flag","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"value","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"version_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2e8d1320288e4f240aabeaf4c772df0d","name":"feature_flags_natural_uk","valid":true},{"hash":"4a37620023f13aecfadf61f85ed52394","name":"feature_flags_pkey","valid":true}],"forceRls":false,"policies":[{"name":"ff_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"4da561cf20b60ddd6d041662476ff459","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"feature_flags_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"feature_flags_tenant_id_fkey","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"feature_flags_version_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"graph_nodes","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"node_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_table","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"properties","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"774984bcd5fd2ab92ca3e6619364496d","name":"graph_nodes_pkey","valid":true},{"hash":"e04eed166ae85aa6006fed90f4d72649","name":"graph_nodes_source_uk","valid":true},{"hash":"b79e6a25b52e9a783d30870fd2b3d6f4","name":"graph_nodes_tenant_created_idx","valid":true},{"hash":"756dc7644f1296779abf8fcbcdbfe3c5","name":"graph_nodes_tenant_source_idx","valid":true},{"hash":"0145410027db1618c04f7827de5845a1","name":"graph_nodes_tenant_type_idx","valid":true}],"forceRls":false,"policies":[{"name":"graph_nodes_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8bab0683a0aaa36fa7503751203844f5","name":"graph_nodes_set_updated_at","enabled":"O"},{"hash":"a986b0df019624ddefcf5e10ad135fd4","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"graph_nodes_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"interactions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_connector_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_table","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"interaction_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"summary","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_preview","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_address","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_addresses","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"cc_addresses","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"phone_from","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"phone_to","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"processing_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"sentiment","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_task_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"source_updated_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_version","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"386b7aa4a596d1f7a436f82ee5cd30d1","name":"interactions_pkey","valid":true},{"hash":"e9634fa8eca4b28f9d63657404df3fae","name":"interactions_related_campaign_idx","valid":true},{"hash":"8eaaf68213fe01dc3342f1135af48b37","name":"interactions_tenant_company_idx","valid":true},{"hash":"344e9c6e9a40d3f4cc5ffdd75d892e06","name":"interactions_tenant_connector_occurred_idx","valid":true},{"hash":"78eb70cc7e2fa21d550574b7d7fd2567","name":"interactions_tenant_id_source_table_source_id_key","valid":true},{"hash":"b872f2d916dee27b2d740a273b3a3a86","name":"interactions_tenant_occurred_idx","valid":true},{"hash":"9ab02b39c0a9dcb409371595dd22b317","name":"interactions_tenant_person_idx","valid":true},{"hash":"9026abb0805ac33730d78a21bdc85364","name":"interactions_tenant_processing_idx","valid":true},{"hash":"60847df577987b97a1aa8e49893f6740","name":"interactions_tenant_type_occurred_idx","valid":true},{"hash":"cfa31edad77dc169ce86ec6f0bb18c10","name":"interactions_tenant_type_source_idx","valid":true}],"forceRls":false,"policies":[{"name":"interactions_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"3b4c64fd9157e1dab30e91b351a56128","name":"interactions_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"interactions_pkey","validated":true},{"hash":"2e6cb81b96ef1f338484943fdb13da96","kind":"f","name":"interactions_related_campaign_fk","validated":true},{"hash":"2dc4fa1294c5cf8d6796d8b4c37f0fa0","kind":"u","name":"interactions_tenant_id_source_table_source_id_key","validated":true}]},{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"learn_email_source_versions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"email_message_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"captured_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"c92679b3a5f2d209d86c588ae97c31ed"},{"name":"source_row","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"03ca7d7e4de96bc59d21f61d1f83020d","name":"learn_email_source_versions_message","valid":true},{"hash":"ad7515f9488727c23784f453d82cd54b","name":"learn_email_source_versions_pkey","valid":true}],"forceRls":false,"policies":[],"triggers":[],"constraints":[{"hash":"8545ba7c506d599a02346cfe467796e7","kind":"f","name":"learn_email_source_versions_email_message_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"learn_email_source_versions_pkey","validated":true},{"hash":"db005c81b1dca913572d1ccbc8d39f41","kind":"c","name":"learn_email_source_versions_source_row_check","validated":true},{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_email_source_versions_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"phone_ai_insights","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"call_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recording_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"intent","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"urgency","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sentiment","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"summary","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"action_required","type":"boolean","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"suggested_owner","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric(5,4)","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"transcript_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"identity_summary","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"}],"indexes":[{"hash":"5b3ce9fa9e1da91d3a912911dcb81a09","name":"phone_ai_insights_call_id_idx","valid":true},{"hash":"1ad25720fd908e0aa42c747b6419439c","name":"phone_ai_insights_call_updated_idx","valid":true},{"hash":"988fba6d3650baf38ab610e26554c37f","name":"phone_ai_insights_one_per_recording","valid":true},{"hash":"f5fb4e253c5ddce9025ade78d6a17a43","name":"phone_ai_insights_pkey","valid":true},{"hash":"4694c65e8e0c22acc899f05ad2146bff","name":"phone_ai_insights_recording_id_idx","valid":true},{"hash":"0df1a1bf73df5025b668d1e347fe479f","name":"phone_ai_insights_recording_idx","valid":true},{"hash":"9dc858678da7d966d5a44cb7de8340a5","name":"phone_ai_insights_tenant_id_idx","valid":true},{"hash":"77be822015b573611aed0c8422fa0dbe","name":"phone_ai_insights_transcript_idx","valid":true}],"forceRls":false,"policies":[{"name":"phone_ai_insights_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"6c25079f4cef02df86962f5d58699f9b","name":"phone_ai_insights_set_updated_at","enabled":"O"}],"constraints":[{"hash":"ccea795a9d04c1b3d010f90611c4ec70","kind":"f","name":"phone_ai_insights_call_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"phone_ai_insights_pkey","validated":true},{"hash":"e0d6ff1cd5856026818abe929c887a14","kind":"f","name":"phone_ai_insights_recording_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"phone_calls","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"8635fd7ef6f459e4bf239c48fc2077a6"},{"name":"provider_call_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"linked_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"duration_seconds","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"outcome","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cost","type":"numeric(12,4)","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"ad06f1828a4b92c109adb1f762c295e3","name":"phone_calls_feed_idx","valid":true},{"hash":"041a21ecbe4a029507ed2f7077d990ef","name":"phone_calls_from_number_idx","valid":true},{"hash":"ea8afbddb27a43baff209fb09069515d","name":"phone_calls_linked_id_idx","valid":true},{"hash":"aa6bc6fbd4a69f5048ec6912e1af7d76","name":"phone_calls_pkey","valid":true},{"hash":"07dd19ebb1744536c0e4fecc4ecd33e8","name":"phone_calls_started_at_idx","valid":true},{"hash":"1a4214891dce0f770f8c49b1a78faaf6","name":"phone_calls_tenant_id_idx","valid":true},{"hash":"8743c824e2d12b7edb49176233d498fa","name":"phone_calls_tenant_id_provider_provider_call_id_key","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"},{"name":"phone_calls_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8f5a3046c7ffdc57f3903d1c00bf7231","name":"phone_calls_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"phone_calls_pkey","validated":true},{"hash":"93e9bfc0ac59cbc413c644fe7309a0ea","kind":"u","name":"phone_calls_tenant_id_provider_provider_call_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"phone_recordings","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"8635fd7ef6f459e4bf239c48fc2077a6"},{"name":"provider_recording_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"provider_call_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"linked_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recording_uri","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"file_size","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"duration_seconds","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"storage_path","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"e9b8cb4fa73612656b762a0dba9c2733","name":"phone_recordings_feed_idx","valid":true},{"hash":"984f7e1f561e0692b066ac1595709bbc","name":"phone_recordings_pkey","valid":true},{"hash":"72d3cb038f69fcae71277ac20c30881b","name":"phone_recordings_provider_call_id_idx","valid":true},{"hash":"79c1b0d656c6d1bb7be6450e453758dd","name":"phone_recordings_tenant_id_idx","valid":true},{"hash":"51f2ebc8c93acd85ebe42f2eac97d331","name":"phone_recordings_tenant_id_provider_provider_recording_id_key","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"},{"name":"phone_recordings_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"118396f378009025373f5159a2b2e09e","name":"phone_recordings_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"phone_recordings_pkey","validated":true},{"hash":"1264fb8f6704b74ca974958dc202fdaa","kind":"u","name":"phone_recordings_tenant_id_provider_provider_recording_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"phone_sync_runs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"8635fd7ef6f459e4bf239c48fc2077a6"},{"name":"sync_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"412b424d07d3e1e0d1cf66fe0bdfee56"},{"name":"started_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_message","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"}],"indexes":[{"hash":"df5fe456f04f5fdb69dacebee30a1bd7","name":"phone_sync_runs_pkey","valid":true},{"hash":"9d5205da6633dbbc0fe7216948bbb399","name":"phone_sync_runs_recording_retry_idx","valid":true},{"hash":"d4f0b7f48936003ad3c6bc80857e2fdd","name":"phone_sync_runs_started_at_idx","valid":true},{"hash":"b757da236abfada2677cdece4ea2cb14","name":"phone_sync_runs_tenant_id_idx","valid":true},{"hash":"07982b684e927094313fef29c2197ea3","name":"phone_sync_runs_type_status_idx","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"},{"name":"phone_sync_runs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"phone_sync_runs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"phone_transcripts","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"recording_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"transcript_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"language","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"model","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b20870b0ec771834b55c79cf9f3c573b","name":"phone_transcripts_one_completed_per_recording","valid":true},{"hash":"cc0338b81be0eec9dd9aa293507ff887","name":"phone_transcripts_pkey","valid":true},{"hash":"b8f9440018000194beb72ad52172a140","name":"phone_transcripts_recording_id_idx","valid":true},{"hash":"9b4bb15639feb01b4c5221d21ddb81ae","name":"phone_transcripts_recording_idx","valid":true},{"hash":"abca77a0eeb91beb7b0ddf746fff629b","name":"phone_transcripts_tenant_id_idx","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"},{"name":"phone_transcripts_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"0d8ad4e4ea527bbee6bca6c57e52b6bc","name":"phone_transcripts_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"phone_transcripts_pkey","validated":true},{"hash":"e0d6ff1cd5856026818abe929c887a14","kind":"f","name":"phone_transcripts_recording_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_events","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"event_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"attempts","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"published_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"consumed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"actor","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"correlation_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"b492f6fbb2f09e1b0f0f0048d548841d","name":"platform_events_pending_subject_uk","valid":true},{"hash":"bc384965f69238d3fc29ecb7dcd53441","name":"platform_events_pkey","valid":true},{"hash":"542001a3bb43c8d86c0c3651a78b77bc","name":"platform_events_tenant_subject_idx","valid":true},{"hash":"eccb61d59f70f50973014ee590e1a674","name":"platform_events_tenant_type_status_idx","valid":true}],"forceRls":false,"policies":[{"name":"platform_events_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"9bf4a16275ca9fd32d48e04d21dcfb43","name":"platform_events_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_events_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"module_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"job_key","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"7c86ea6e5094355ad44b6867fa51b433"},{"name":"priority","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"f899139df5e1059396431415e770c6dd"},{"name":"progress_current","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"progress_total","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"attempt_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"max_attempts","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"eccbc87e4b5ce2fe28308fd9f2a7baf3"},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"failed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cancelled_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"next_run_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"result","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"available_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"lease_expires_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"dead_lettered_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"error_code","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"parent_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"e8ec53579fc23c9f8c7ec9cbcc9a0fe8","name":"platform_jobs_active_job_key_uk","valid":true},{"hash":"0c8ea2ecee43cf1b569083bac92b3889","name":"platform_jobs_claim_idx","valid":true},{"hash":"95f16cdddc29e798beb223f90905fec3","name":"platform_jobs_lease_idx","valid":true},{"hash":"a2be2946f7e3402dc0501da0f336f113","name":"platform_jobs_parent_idx","valid":true},{"hash":"f8699761f53393f77b94bc724a99e825","name":"platform_jobs_pkey","valid":true},{"hash":"95bfc00526e7f302fb99702339694c04","name":"platform_jobs_tenant_connector_idx","valid":true},{"hash":"1ed91a0d9b3bf296158e7c4558ce3189","name":"platform_jobs_tenant_next_run_idx","valid":true},{"hash":"a22868c903eedcb64e7366fb3249911f","name":"platform_jobs_tenant_status_idx","valid":true},{"hash":"a3359af1d6c9ed909e3b424d77e7a174","name":"platform_jobs_tenant_type_idx","valid":true}],"forceRls":false,"policies":[{"name":"platform_jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"885bc7f92806b78eac67d45a9143c9ca","name":"platform_jobs_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_jobs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"full_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ebe5151db32cb9795191097a4f9511a9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b7142bbffc23de763c1bd9f00489ec05","name":"profiles_pkey","valid":true},{"hash":"c07a523f1ebc968ab6b32bd5c984f32b","name":"profiles_role_idx","valid":true},{"hash":"610436088a5788625dd6956b9059f8c9","name":"profiles_tenant_id_idx","valid":true},{"hash":"84b975915f84814cf35c7604d4f94ecf","name":"profiles_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_profile","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"profiles_select_own","roles":["public"],"command":"SELECT","checkHash":null,"usingHash":"bc9c729a84690340789a4e4f01175335","permissive":"PERMISSIVE"}],"triggers":[{"hash":"bb3752d7064fd9e06fbe457f475928cc","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"83b0936855bf3bb7daa4f8356eb3c926","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a97ecad600d272e906bb06dea0b91c4","name":"profiles_set_updated_at","enabled":"O"}],"constraints":[{"hash":"0061c9fb3a9abcf2edbcd4a42467a9c3","kind":"f","name":"profiles_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"profiles_pkey","validated":true},{"hash":"4b3bd90c7f38a26788aecebbe2479ad7","kind":"c","name":"profiles_role_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"telephony_directory","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"extension","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"e164_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"person_node_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"device_label","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"is_shared_device","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":true,"identity":"","generated":"","defaultHash":"e4c2e8edac362acab7123654b9e73432"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"b89b352ea3c3ad81c8ad368151f462f4"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"endpoint_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"241247c54e406d0992aa1246d21b3295"}],"indexes":[{"hash":"21ffb38499633ce8370ba8ef16b82279","name":"telephony_directory_active_endpoint_uk","valid":true},{"hash":"b03529e7f9962b9e743ccf025a9ada68","name":"telephony_directory_active_ext_uk","valid":true},{"hash":"f5813dcab5cc7d5e92c0bd4789f7b715","name":"telephony_directory_person_idx","valid":true},{"hash":"67cd2089fc8735c14cff99e249614a5f","name":"telephony_directory_pkey","valid":true},{"hash":"e7a0ed92d36ae9ad9cc0d805a8e41b18","name":"telephony_directory_tenant_ext_idx","valid":true},{"hash":"c6cda0ed5102e6e2de41bbfbbd0c75f2","name":"telephony_directory_tenant_status_idx","valid":true}],"forceRls":false,"policies":[{"name":"telephony_directory_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"4433908e04b2d63f8b07a8ea37b469dd","name":"telephony_directory_set_updated_at","enabled":"O"}],"constraints":[{"hash":"ced53bd451ce471d82b22e199f74b5f6","kind":"f","name":"telephony_directory_person_node_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"telephony_directory_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenant_connectors","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"category","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"5dbf8349d9384bba7422dab65d75d428"},{"name":"health_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"enabled","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"settings","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"last_successful_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_failed_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2a999164558672de593a5cee2ad1199a","name":"tenant_connectors_pkey","valid":true},{"hash":"6909a1d595c44c251b88ae925a11c1ed","name":"tenant_connectors_tenant_id_connector_id_key","valid":true},{"hash":"b0d64bed4b9196a44db82e7ae165547f","name":"tenant_connectors_tenant_id_idx","valid":true}],"forceRls":false,"policies":[{"name":"tenant_connectors_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"45a4a9345cd9fdacc7eec28d9e54eed7","name":"learn_connector_reference_guard","enabled":"O"},{"hash":"9902ab88fa7717f94aad8e8d210311f1","name":"learn_connector_retain","enabled":"O"},{"hash":"69e86bf6f6593d14968522a1e6958d38","name":"learn_connector_retain_truncate","enabled":"O"},{"hash":"05f7b4b7a819d47c4f9215eed99d9365","name":"tenant_connectors_set_updated_at","enabled":"O"}],"constraints":[{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_connector_tenant_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenant_connectors_pkey","validated":true},{"hash":"24cb83f88599181c6922a60d2bfb8328","kind":"u","name":"tenant_connectors_tenant_id_connector_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenant_vocabulary","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"term","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"category","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"2de56f918647c26b2966136dd7db2a01"},{"name":"aliases","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"phonetic_variants","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"confidence","type":"numeric","notNull":true,"identity":"","generated":"","defaultHash":"e4c2e8edac362acab7123654b9e73432"},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"6b3a8a63530baf2b2ee71618782c987d","name":"tenant_vocabulary_pkey","valid":true},{"hash":"37291acb0cb2f7f2a8ba25e281a428d4","name":"tenant_vocabulary_tenant_cat_idx","valid":true},{"hash":"ea616dadbc21607e1b875af7a559791a","name":"tenant_vocabulary_tenant_term_uk","valid":true}],"forceRls":false,"policies":[{"name":"tenant_vocabulary_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"3a25579c90057b61246a51343580962d","name":"tenant_vocabulary_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenant_vocabulary_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"slug","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"industry","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5284b9c618f8618b72a402ea2c593753","name":"tenants_pkey","valid":true},{"hash":"6260c986ce2d58a0ad3de3f74ec6eb6f","name":"tenants_slug_key","valid":true}],"forceRls":false,"policies":[{"name":"tenants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"831f798d620de1d73971187d41079b4d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8009f8efa07661ab809d3f9e077da55e","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"742cd63e2f0ed7809f0911b17d02869d","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a4d62ca55c88b97023eab7696e527ce","name":"tenants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenants_pkey","validated":true},{"hash":"687397275d0e852fb2a4b50394adffee","kind":"u","name":"tenants_slug_key","validated":true},{"hash":"7702cc7b97df1ebce81e13bb05db5c2d","kind":"c","name":"tenants_status_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"view_as_context","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor_user_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"mode","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d3f83345a22c6bbd79692e353599f18"},{"name":"read_only","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"expires_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"dae782846028bc8168db98a8dd4b9193"},{"name":"ended_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5325064a8cf3f1e500b2308ea36b3343","name":"view_as_actor","valid":true},{"hash":"3b4560fae7e0f79297469f029ab77627","name":"view_as_context_pkey","valid":true}],"forceRls":false,"policies":[{"name":"view_as_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"565594dabafccb3adbde49e7a3f8790a","permissive":"PERMISSIVE"}],"triggers":[{"hash":"aaf4c57e4c5a9674a6979f95139e4746","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"1b0ebc4a05c69edafb63e927ba619765","name":"learn_work_authority_truncate_lock","enabled":"O"}],"constraints":[{"hash":"db8d41fae95b78d4a530a37cc023f719","kind":"c","name":"view_as_context_mode_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"view_as_context_pkey","validated":true},{"hash":"9579aceb86350661ce8f9dd1b4211a9b","kind":"c","name":"view_as_context_subject_kind_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"view_as_context_tenant_id_fkey","validated":true}]}]'::jsonb then raise exception 'Production Phone table baseline differs';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['learn_capture_allowed','learn_operator_input_access','learn_operator_input_immutable','phone_pending_readiness','phone_projection_version','phone_retry_state']);
 if actual_helpers is distinct from '[{"hash":"cc8bc01c1ebd3da0c5f0ec5de3754667","name":"learn_capture_allowed","owner":"postgres","arguments":"p_tenant uuid, p_source text","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"6ebce242963afa929b7465a99e7608c6","name":"learn_operator_input_access","owner":"postgres","arguments":"p_tenant uuid, p_actor uuid, p_write boolean","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"0f17d77fbd9a9d6e3d9cff0c0ccee5c1","name":"learn_operator_input_immutable","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"e6b894831d23c55fab640ed0f8a96e9f","name":"phone_pending_readiness","owner":"postgres","arguments":"p_tenant_id uuid","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"0429243e146a8cc7a7b5a9760c5f6eec","name":"phone_projection_version","owner":"postgres","arguments":"p_tenant_id uuid, p_call_id uuid","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"1ace638d6114ab99cb15a498820f4946","name":"phone_retry_state","owner":"postgres","arguments":"p_stage text, p_runs jsonb, p_now timestamp with time zone","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true}]'::jsonb then raise exception 'Production Phone helper baseline differs';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'views') v where v->>'name'=any(array['phone_recording_pipeline_state']);
 if actual_views is distinct from '[{"hash":"fbdb8ee97d47f4877ae98d06ca2d3ace","name":"phone_recording_pipeline_state","owner":"postgres","options":["security_invoker=on"]}]'::jsonb then raise exception 'Production Phone view baseline differs';end if;
end$$;
-- INPUT supabase/migrations/20261031210000_learn_operator_capture_health.sql
-- OpenFolk capture metadata. No credentials, provider error text, message bodies,
-- account settings, cursor tokens or new source work are exposed or changed.

create function public.learn_operator_capture_health(p_tenant uuid,p_after text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;more boolean;last_key text;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 if p_after is not null and p_after!~'^(email|phone|slack):[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'learn_operator_health_cursor_invalid' using errcode='22023';end if;
 with candidates as (
  select 'email:'||a.id::text as key,jsonb_build_object(
   'id',a.id,'source','email','provider',case when a.provider='gmail' and a.status in ('active_dwd','pending_tokenless_dwd') then 'google_workspace' when a.provider in ('gmail','google_workspace') then a.provider else 'other_email' end,
   'label',left(coalesce(nullif(a.display_name,''),'Mailbox'),120),
   'enabled',null,'account_state',case when a.status in ('active','active_dwd','pending_tokenless_dwd','disabled','paused','revoked') then a.status else 'unknown' end,
   'auth_state',case when a.status in ('active_dwd','pending_tokenless_dwd') or a.provider='google_workspace' then 'unknown' when a.auth_state in ('ok','expired','revoked','needs_reconnect') then a.auth_state else 'unknown' end,
   'last_success_at',a.last_incremental_success_at,'last_attempt_at',a.last_incremental_attempt_at,
   'last_failure_at',case when a.last_sync_error is not null and a.last_incremental_attempt_at>=coalesce(a.last_incremental_success_at,'-infinity') then a.last_incremental_attempt_at else null end,
   'latest_job',null,'bounded_complete',null) as row
  from public.email_accounts a where a.tenant_id=p_tenant
  union all
  select (case when tc.connector_id='slack' then 'slack:' else 'phone:' end)||a.id::text as key,jsonb_build_object(
   'id',a.id,'source',case when tc.connector_id='slack' then 'slack' else 'phone' end,'provider',tc.connector_id,
   'label',left(coalesce(nullif(a.display_name,''),case when tc.connector_id='slack' then 'Slack channel' else 'Phone account' end),120),
   'enabled',tc.enabled and (case when tc.connector_id='slack' then tc.status='active' else tc.status in ('active','error') end),
   'account_state',case when a.status in ('active','disabled','paused','revoked') then a.status else 'unknown' end,
   'auth_state','unknown','last_success_at',a.last_successful_sync_at,'last_attempt_at',null,'last_failure_at',a.last_failed_sync_at,
   'latest_job',case when j.id is null then null else jsonb_build_object('id',j.id,
    'status',case when j.status in ('queued','running','retrying','succeeded','dead_letter','cancelled') then j.status else 'unknown' end,
    'available_at',j.available_at,'lease_expires_at',j.lease_expires_at,'completed_at',j.completed_at) end,
   'bounded_complete',case when tc.connector_id='slack' then coalesce(
    j.status='succeeded' and j.completed_at is not null
    and j.result->>'stopReason'='window_pages_complete'
    and j.result->'complete'='true'::jsonb and a.sync_cursor->'complete'='true'::jsonb
    and jsonb_typeof(a.sync_cursor->'scopeKey')='string' and a.sync_cursor->>'scopeKey'<>''
    and j.result->'scopeKey'=a.sync_cursor->'scopeKey'
    and j.result->'pages'=a.sync_cursor->'pages',false) else null end) as row
  from public.connector_accounts a join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  left join lateral(select q.id,q.status,q.available_at,q.lease_expires_at,q.completed_at,q.result from public.platform_jobs q
   where tc.connector_id='slack' and q.tenant_id=p_tenant and q.job_type='slack.history_sync' and q.payload->>'connector_account_id'=a.id::text
   order by q.created_at desc,q.id desc limit 1) j on true
  where a.tenant_id=p_tenant and ((tc.connector_id='simwood' and tc.provider='simwood') or (tc.connector_id='slack' and tc.provider='slack'))
 ), bounded as (select * from candidates where p_after is null or key>p_after order by key limit 51), page as (select * from bounded order by key limit 50)
 select coalesce((select jsonb_agg(row||jsonb_build_object('key',key) order by key) from page),'[]'),
  (select count(*)>50 from bounded),(select key from page order by key desc limit 1) into rows,more,last_key;
 return jsonb_build_object('version','learn-operator-capture-health/1','tenant_id',p_tenant,'checked_at',clock_timestamp(),'rows',rows,'next_cursor',case when more then last_key else null end);
end $$;
revoke all on function public.learn_operator_capture_health(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_capture_health(uuid,text) to authenticated;

-- INPUT supabase/migrations/20261031220000_learn_email_capture_evidence.sql
-- Include mailbox-specific completed sync runs: legacy Workspace capture does not
-- populate the newer account-success field. Scheduler heartbeats are not capture.

create index learn_email_capture_run_lookup on public.email_sync_runs
 (tenant_id,(metadata->>'email_account_id'),started_at desc,id desc)
 where provider='gmail' and sync_type in ('messages','workspace_messages');
create or replace function public.learn_operator_capture_health(p_tenant uuid,p_after text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;more boolean;last_key text;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 if p_after is not null and p_after!~'^(email|phone|slack):[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'learn_operator_health_cursor_invalid' using errcode='22023';end if;
 with candidates as (
  select 'email:'||a.id::text as key,jsonb_build_object(
   'id',a.id,'source','email','provider',case when a.provider='gmail' and a.status in ('active_dwd','pending_tokenless_dwd') then 'google_workspace' when a.provider in ('gmail','google_workspace') then a.provider else 'other_email' end,
   'label',left(coalesce(nullif(a.display_name,''),'Mailbox'),120),
   'enabled',null,'account_state',case when a.status in ('active','active_dwd','pending_tokenless_dwd','disabled','paused','revoked') then a.status else 'unknown' end,
   'auth_state',case when a.status in ('active_dwd','pending_tokenless_dwd') or a.provider='google_workspace' then 'unknown' when a.auth_state in ('ok','expired','revoked','needs_reconnect') then a.auth_state else 'unknown' end,
   'last_success_at',greatest(a.last_incremental_success_at,case when er.status='success' and er.completed_at>=er.started_at then er.completed_at end),
   'last_attempt_at',greatest(a.last_incremental_attempt_at,er.started_at),
   'last_failure_at',greatest(
    case when a.last_sync_error is not null and a.last_incremental_attempt_at>=coalesce(a.last_incremental_success_at,'-infinity') then a.last_incremental_attempt_at end,
    case when er.status='failed' then coalesce(er.completed_at,er.started_at)
     when er.status='success' and (er.completed_at is null or er.completed_at<er.started_at) then er.started_at end),
   'latest_job',null,'bounded_complete',null) as row
  from public.email_accounts a
  left join lateral (
   select r.status,r.started_at,r.completed_at from public.email_sync_runs r
   where a.provider in ('gmail','google_workspace') and r.tenant_id=a.tenant_id
    and r.metadata->>'email_account_id'=a.id::text and r.provider='gmail'
    and r.sync_type in ('messages','workspace_messages')
    and r.sync_type=case when a.provider='google_workspace' or a.status in ('active_dwd','pending_tokenless_dwd') then 'workspace_messages' else 'messages' end
    and r.status in ('success','failed')
   order by r.started_at desc,r.id desc limit 1
  ) er on true
  where a.tenant_id=p_tenant
  union all
  select (case when tc.connector_id='slack' then 'slack:' else 'phone:' end)||a.id::text as key,jsonb_build_object(
   'id',a.id,'source',case when tc.connector_id='slack' then 'slack' else 'phone' end,'provider',tc.connector_id,
   'label',left(coalesce(nullif(a.display_name,''),case when tc.connector_id='slack' then 'Slack channel' else 'Phone account' end),120),
   'enabled',tc.enabled and (case when tc.connector_id='slack' then tc.status='active' else tc.status in ('active','error') end),
   'account_state',case when a.status in ('active','disabled','paused','revoked') then a.status else 'unknown' end,
   'auth_state','unknown','last_success_at',a.last_successful_sync_at,'last_attempt_at',null,'last_failure_at',a.last_failed_sync_at,
   'latest_job',case when j.id is null then null else jsonb_build_object('id',j.id,
    'status',case when j.status in ('queued','running','retrying','succeeded','dead_letter','cancelled') then j.status else 'unknown' end,
    'available_at',j.available_at,'lease_expires_at',j.lease_expires_at,'completed_at',j.completed_at) end,
   'bounded_complete',case when tc.connector_id='slack' then coalesce(
    j.status='succeeded' and j.completed_at is not null
    and j.result->>'stopReason'='window_pages_complete'
    and j.result->'complete'='true'::jsonb and a.sync_cursor->'complete'='true'::jsonb
    and jsonb_typeof(a.sync_cursor->'scopeKey')='string' and a.sync_cursor->>'scopeKey'<>''
    and j.result->'scopeKey'=a.sync_cursor->'scopeKey'
    and j.result->'pages'=a.sync_cursor->'pages',false) else null end) as row
  from public.connector_accounts a join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  left join lateral(select q.id,q.status,q.available_at,q.lease_expires_at,q.completed_at,q.result from public.platform_jobs q
   where tc.connector_id='slack' and q.tenant_id=p_tenant and q.job_type='slack.history_sync' and q.payload->>'connector_account_id'=a.id::text
   order by q.created_at desc,q.id desc limit 1) j on true
  where a.tenant_id=p_tenant and ((tc.connector_id='simwood' and tc.provider='simwood') or (tc.connector_id='slack' and tc.provider='slack'))
 ), bounded as (select * from candidates where p_after is null or key>p_after order by key limit 51), page as (select * from bounded order by key limit 50)
 select coalesce((select jsonb_agg(row||jsonb_build_object('key',key) order by key) from page),'[]'),
  (select count(*)>50 from bounded),(select key from page order by key desc limit 1) into rows,more,last_key;
 return jsonb_build_object('version','learn-operator-capture-health/1','tenant_id',p_tenant,'checked_at',clock_timestamp(),'rows',rows,'next_cursor',case when more then last_key else null end);
end $$;
revoke all on function public.learn_operator_capture_health(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_capture_health(uuid,text) to authenticated;

-- INPUT supabase/migrations/20261101006000_learn_phone_page_publication.sql
-- Phone page publication: controller/account checks, source writes and receipt commit together.
-- Additive; no capture activation, credentials, schedules or source rewrites on installation.

create table public.learn_phone_capture_pages (
 run_id uuid not null references public.phone_sync_runs(id),
 page integer not null check(page between 1 and 50),
 tenant_id uuid not null references public.tenants(id),
 definition jsonb not null,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(run_id,page)
);
alter table public.learn_phone_capture_pages enable row level security;
revoke all on public.learn_phone_capture_pages from public,anon,authenticated,service_role;
grant select on public.learn_phone_capture_pages to service_role;
create trigger learn_phone_pages_immutable before update or delete on public.learn_phone_capture_pages
 for each row execute function public.learn_operator_input_immutable();
create trigger learn_phone_pages_no_truncate before truncate on public.learn_phone_capture_pages
 for each statement execute function public.learn_operator_input_immutable();

-- Also fence direct flag edits, including insertion of a previously absent switch.
-- Publisher never row-locks flags, avoiding a flag-row/advisory-lock inversion.
create function public.learn_phone_capture_flag_lock() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare old_tenant uuid;new_tenant uuid;t uuid;
begin
 if TG_OP<>'INSERT' and OLD.flag in ('learn.enabled','learn.inputs.phone.enabled') then old_tenant:=OLD.tenant_id;end if;
 if TG_OP<>'DELETE' and NEW.flag in ('learn.enabled','learn.inputs.phone.enabled') then new_tenant:=NEW.tenant_id;end if;
 for t in select distinct v from unnest(array[old_tenant,new_tenant])v where v is not null order by v loop
  perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||t::text,0));
 end loop;
 if TG_OP='DELETE' then return OLD;end if;return NEW;
end $$;
revoke all on function public.learn_phone_capture_flag_lock() from public,anon,authenticated,service_role;
create trigger learn_phone_capture_flags before insert or update or delete on public.feature_flags
 for each row execute function public.learn_phone_capture_flag_lock();

create function public.learn_phone_publish_page(
 p_tenant uuid,p_run uuid,p_account uuid,p_connector uuid,p_customer text,
 p_kind text,p_page integer,p_records jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.phone_sync_runs%rowtype;a public.connector_accounts%rowtype;c public.tenant_connectors%rowtype;
 prior public.learn_phone_capture_pages%rowtype;d jsonb;answer jsonb;item jsonb;identity_key text;keys text[];
 inserted_id uuid;new_ids jsonb:='[]'::jsonb;previous_page integer;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_page_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_account is null or p_connector is null or p_customer is null
 or p_customer!~'^[A-Za-z0-9_-]{1,128}$' or p_kind is null or p_kind not in ('calls','recordings')
 or p_page is null or p_page not between 1 and 50 or jsonb_typeof(p_records) is distinct from 'array'
 or jsonb_array_length(p_records)>200 or octet_length(p_records::text)>2097152 then
  raise exception 'phone_page_invalid' using errcode='22023';end if;
 identity_key:=case when p_kind='calls' then 'provider_call_id' else 'provider_recording_id' end;
 keys:=case when p_kind='calls' then array['tenant_id','provider','provider_call_id','linked_id','direction','from_number','to_number','started_at','duration_seconds','outcome','cost','raw_payload']
  else array['tenant_id','provider','provider_recording_id','provider_call_id','linked_id','recording_uri','file_size','started_at','duration_seconds','raw_payload'] end;
 if exists(select 1 from jsonb_array_elements(p_records)x where jsonb_typeof(x) is distinct from 'object'
  or x->>'tenant_id' is distinct from p_tenant::text or x->>'provider' is distinct from 'simwood'
  or jsonb_typeof(x->identity_key) is distinct from 'string' or length(btrim(x->>identity_key)) not between 1 and 200
  or (x-keys)<>'{}'::jsonb or jsonb_typeof(x->'raw_payload') is distinct from 'object')
 or (select count(distinct x->>identity_key) from jsonb_array_elements(p_records)x)<>jsonb_array_length(p_records) then
  raise exception 'phone_page_records_invalid' using errcode='22023';end if;
 d:=jsonb_build_object('accountId',p_account,'connectorId',p_connector,'customerId',p_customer,'kind',p_kind,
  'recordsSha256',encode(sha256(convert_to(p_records::text,'UTF8')),'hex'));
 -- Lock order shared with controller changes, then the run. Replays only read a receipt.
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.phone_sync_runs where id=p_run and tenant_id=p_tenant for update;
 if not found or r.provider<>'simwood' or r.sync_type<>p_kind then raise exception 'phone_page_run_changed' using errcode='PT409';end if;
 select * into prior from public.learn_phone_capture_pages where run_id=p_run and page=p_page;
 if found then
  if prior.tenant_id<>p_tenant or prior.definition<>d then raise exception 'phone_page_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if r.status<>'running' then raise exception 'phone_page_run_changed' using errcode='PT409';end if;
 select max(page) into previous_page from public.learn_phone_capture_pages where run_id=p_run;
 if p_page<>coalesce(previous_page,0)+1 or exists(select 1 from public.learn_phone_capture_pages where run_id=p_run
  and (definition-'recordsSha256')<>(d-'recordsSha256')) then raise exception 'phone_page_sequence_changed' using errcode='PT409';end if;
 -- Native row locks fence direct tenant/account/connector changes through commit.
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found or not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into c from public.tenant_connectors where id=p_connector and tenant_id=p_tenant for share;
 if not found or c.connector_id<>'simwood' or c.provider<>'simwood' or not c.enabled or c.status not in ('active','error') then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 select * into a from public.connector_accounts where id=p_account and tenant_id=p_tenant for share;
 if not found or a.tenant_connector_id<>p_connector or a.status<>'active'
 or coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key) is distinct from p_customer then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 -- Stable source-key order avoids deadlocks between concurrent pages/runs.
 for item in select x from jsonb_array_elements(p_records)x order by x->>identity_key loop
  if p_kind='calls' then
   insert into public.phone_calls(tenant_id,provider,provider_call_id,linked_id,direction,from_number,to_number,started_at,duration_seconds,outcome,cost,raw_payload)
   values(p_tenant,'simwood',item->>'provider_call_id',item->>'linked_id',item->>'direction',item->>'from_number',item->>'to_number',
    (item->>'started_at')::timestamptz,(item->>'duration_seconds')::integer,item->>'outcome',(item->>'cost')::numeric,item->'raw_payload')
   on conflict(tenant_id,provider,provider_call_id) do update set linked_id=excluded.linked_id,direction=excluded.direction,
    from_number=excluded.from_number,to_number=excluded.to_number,started_at=excluded.started_at,duration_seconds=excluded.duration_seconds,
    outcome=excluded.outcome,cost=excluded.cost,raw_payload=excluded.raw_payload;
  else
   inserted_id:=null;
   insert into public.phone_recordings(tenant_id,provider,provider_recording_id,provider_call_id,linked_id,recording_uri,file_size,started_at,duration_seconds,raw_payload)
   values(p_tenant,'simwood',item->>'provider_recording_id',item->>'provider_call_id',item->>'linked_id',item->>'recording_uri',
    (item->>'file_size')::bigint,(item->>'started_at')::timestamptz,(item->>'duration_seconds')::integer,item->'raw_payload')
   on conflict(tenant_id,provider,provider_recording_id) do nothing returning id into inserted_id;
   if inserted_id is not null then new_ids:=new_ids||jsonb_build_array(inserted_id);
   else
    update public.phone_recordings set provider_call_id=item->>'provider_call_id',linked_id=item->>'linked_id',recording_uri=item->>'recording_uri',
     file_size=(item->>'file_size')::bigint,started_at=(item->>'started_at')::timestamptz,duration_seconds=(item->>'duration_seconds')::integer,
     raw_payload=item->'raw_payload' where tenant_id=p_tenant and provider='simwood' and provider_recording_id=item->>'provider_recording_id';
   end if;
  end if;
 end loop;
 answer:=jsonb_build_object('version','learn-phone-page/1','tenantId',p_tenant,'runId',p_run,'page',p_page,'kind',p_kind,
  'recordsProcessed',jsonb_array_length(p_records),'newRecordingIds',new_ids);
 insert into public.learn_phone_capture_pages(run_id,page,tenant_id,definition,receipt) values(p_run,p_page,p_tenant,d,answer);
 return answer;
end $$;
revoke all on function public.learn_phone_publish_page(uuid,uuid,uuid,uuid,text,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_publish_page(uuid,uuid,uuid,uuid,text,text,integer,jsonb) to service_role;

-- INPUT supabase/migrations/20261101008000_learn_phone_import_completion.sql
-- Final import status and its immutable evidence commit together. This does not
-- activate capture, advance a scheduler cursor, or modify existing source rows.

create table public.learn_phone_import_completions (
 run_id uuid primary key references public.phone_sync_runs(id),
 tenant_id uuid not null references public.tenants(id),
 definition jsonb not null,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_import_completions enable row level security;
revoke all on public.learn_phone_import_completions from public,anon,authenticated,service_role;
grant select on public.learn_phone_import_completions to service_role;
create trigger learn_phone_completions_immutable before update or delete on public.learn_phone_import_completions
 for each row execute function public.learn_operator_input_immutable();
create trigger learn_phone_completions_no_truncate before truncate on public.learn_phone_import_completions
 for each statement execute function public.learn_operator_input_immutable();

create function public.learn_phone_complete_import(
 p_tenant uuid,p_run uuid,p_account uuid,p_connector uuid,p_customer text,
 p_kind text,p_pages integer,p_records integer,p_metadata jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.phone_sync_runs%rowtype;a public.connector_accounts%rowtype;c public.tenant_connectors%rowtype;
 prior public.learn_phone_import_completions%rowtype;d jsonb;scope jsonb;answer jsonb;
 page_count integer;last_page integer;record_count integer;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_completion_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_account is null or p_connector is null or p_customer is null
 or p_customer!~'^[A-Za-z0-9_-]{1,128}$' or p_kind is null or p_kind not in ('calls','recordings')
 or p_pages is null or p_pages not between 1 and 50 or p_records is null or p_records not between 0 and 10000
 or jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text)>16384
 or p_metadata->'window_complete' is distinct from 'true'::jsonb
 or p_metadata->'pages_fetched' is distinct from to_jsonb(p_pages)
 or p_metadata->>'customer_id' is distinct from p_customer
 or p_metadata->(case when p_kind='calls' then 'skipped_no_call_id' else 'skipped_no_recording_id' end) is distinct from '0'::jsonb then
  raise exception 'phone_completion_invalid' using errcode='22023';end if;
 scope:=jsonb_build_object('accountId',p_account,'connectorId',p_connector,'customerId',p_customer,'kind',p_kind);
 d:=scope||jsonb_build_object('pages',p_pages,'recordsProcessed',p_records,'metadata',p_metadata);
 -- Same ordering as publication/controller: controller lock, run, tenant,
 -- connector, account. An exact receipt replay is read-only even after a pause.
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.phone_sync_runs where id=p_run and tenant_id=p_tenant for update;
 if not found or r.provider<>'simwood' or r.sync_type<>p_kind then raise exception 'phone_completion_run_changed' using errcode='PT409';end if;
 select * into prior from public.learn_phone_import_completions where run_id=p_run;
 if found then
  if prior.tenant_id<>p_tenant or prior.definition<>d then raise exception 'phone_completion_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if r.status<>'running' then raise exception 'phone_completion_run_changed' using errcode='PT409';end if;
 if jsonb_typeof(r.metadata->'from') is distinct from 'string' or jsonb_typeof(r.metadata->'to') is distinct from 'string'
 or not (p_metadata @> r.metadata) or not isfinite((r.metadata->>'from')::timestamptz)
 or not isfinite((r.metadata->>'to')::timestamptz) or (r.metadata->>'from')::timestamptz >= (r.metadata->>'to')::timestamptz then
  raise exception 'phone_completion_window_changed' using errcode='PT409';end if;
 select count(*),max(page),coalesce(sum((receipt->>'recordsProcessed')::integer),0)
 into page_count,last_page,record_count from public.learn_phone_capture_pages where run_id=p_run;
 if page_count<>p_pages or last_page is distinct from p_pages or record_count<>p_records
 or exists(select 1 from public.learn_phone_capture_pages where run_id=p_run
  and (tenant_id<>p_tenant or (definition-'recordsSha256')<>scope)) then
  raise exception 'phone_completion_pages_changed' using errcode='PT409';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found or not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into c from public.tenant_connectors where id=p_connector and tenant_id=p_tenant for share;
 if not found or c.connector_id<>'simwood' or c.provider<>'simwood' or not c.enabled or c.status not in ('active','error') then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 select * into a from public.connector_accounts where id=p_account and tenant_id=p_tenant for share;
 if not found or a.tenant_connector_id<>p_connector or a.status<>'active'
 or coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key) is distinct from p_customer then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 answer:=scope||jsonb_build_object('version','learn-phone-import/1','tenantId',p_tenant,'runId',p_run,
  'pages',p_pages,'recordsProcessed',p_records,'from',r.metadata->>'from','to',r.metadata->>'to','windowComplete',true);
 update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=p_records,
  error_message=null,metadata=p_metadata where id=p_run and tenant_id=p_tenant;
 insert into public.learn_phone_import_completions(run_id,tenant_id,definition,receipt) values(p_run,p_tenant,d,answer);
 return answer;
end $$;
revoke all on function public.learn_phone_complete_import(uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_complete_import(uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb) to service_role;

-- INPUT supabase/migrations/20261101009000_learn_phone_schedule_settlement.sql
-- Scheduler settlement derives progress from retained child evidence. Run, job,
-- account cursor and connector health commit together, or none of them do.

create table public.learn_phone_schedule_settlements (
 run_id uuid primary key references public.phone_sync_runs(id),
 tenant_id uuid not null references public.tenants(id),
 definition jsonb not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_schedule_settlements enable row level security;
revoke all on public.learn_phone_schedule_settlements from public,anon,authenticated,service_role;
grant select on public.learn_phone_schedule_settlements to service_role;
create trigger learn_phone_schedule_immutable before update or delete on public.learn_phone_schedule_settlements
 for each row execute function public.learn_operator_input_immutable();
create trigger learn_phone_schedule_no_truncate before truncate on public.learn_phone_schedule_settlements
 for each statement execute function public.learn_operator_input_immutable();
create function public.learn_phone_settle_schedule(p_tenant uuid,p_run uuid,p_calls uuid,p_recordings uuid,p_outcome text,p_errors jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.phone_sync_runs%rowtype;child public.phone_sync_runs%rowtype;j public.platform_jobs%rowtype;
 a public.connector_accounts%rowtype;c public.tenant_connectors%rowtype;prior public.learn_phone_schedule_settlements%rowtype;
 proof public.learn_phone_import_completions%rowtype;d jsonb;answer jsonb;scope jsonb;child_id uuid;k text;
 account_id uuid;connector uuid;job uuid;customer text;owner text;counts jsonb:='{}';n integer;
 window_from timestamptz;window_to timestamptz;cursor_at timestamptz;health text;checked_at timestamptz:=clock_timestamp();
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_schedule_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_outcome is null or p_outcome not in ('success','failed','paused')
 or jsonb_typeof(p_errors) is distinct from 'object' or octet_length(p_errors::text)>512 then
  raise exception 'phone_schedule_invalid' using errcode='22023';end if;
 if exists(select 1 from jsonb_each(p_errors)e where e.key not in ('calls','recordings') or jsonb_typeof(e.value)<>'string' or e.value#>>'{}' !~ '^[a-z][a-z0-9_]{0,79}$')
 or (p_outcome='success' and (p_errors<>'{}' or p_calls is null or p_recordings is null))
 or (p_outcome<>'success' and p_errors='{}')
 or (p_outcome='paused' and exists(select 1 from jsonb_each_text(p_errors)e where e.value not in ('learn_capture_paused','learn_capture_unavailable'))) then
  raise exception 'phone_schedule_invalid' using errcode='22023';end if;
 d:=jsonb_build_object('callsRunId',p_calls,'recordingsRunId',p_recordings,'outcome',p_outcome,'errors',p_errors);
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.phone_sync_runs where id=p_run and tenant_id=p_tenant for update;
 if not found or r.provider<>'simwood' or r.sync_type<>'scheduled_sync' then raise exception 'phone_schedule_run_changed' using errcode='PT409';end if;
 select * into prior from public.learn_phone_schedule_settlements where run_id=p_run;
 if found then
  if prior.tenant_id<>p_tenant or prior.definition<>d then raise exception 'phone_schedule_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if r.status<>'running' then raise exception 'phone_schedule_run_changed' using errcode='PT409';end if;
 account_id:=(r.metadata->>'connector_account_id')::uuid;connector:=(r.metadata->>'tenant_connector_id')::uuid;
 job:=(r.metadata->>'job_id')::uuid;owner:=r.metadata->>'job_owner';customer:=r.metadata->>'provider_customer_id';
 window_from:=(r.metadata->>'from')::timestamptz;window_to:=(r.metadata->>'to')::timestamptz;
 if account_id is null or connector is null or job is null or owner is null or owner='' or customer is null
 or window_from is null or window_to is null or not isfinite(window_from) or not isfinite(window_to) or window_from>=window_to
 or jsonb_typeof(r.metadata->'include_local') is distinct from 'boolean' or r.metadata->>'account_updated_at' is null then
  raise exception 'phone_schedule_scope_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=job and tenant_id=p_tenant for update;
 if not found or j.job_type<>'phone.scheduled_sync' or j.connector_id is distinct from 'simwood' or j.status<>'running'
 or j.claimed_by is distinct from owner or j.attempt_count<>1 or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
 or j.payload->>'provider_customer_id' is distinct from customer or j.payload->>'from' is distinct from r.metadata->>'from'
 or j.payload->>'to' is distinct from r.metadata->>'to' then raise exception 'phone_schedule_job_changed' using errcode='PT409';end if;
 -- Successful children require an immutable completion receipt, matching filters
 -- and the same time window. Counts come from saved pages, never HTTP claims.
 foreach k in array array['calls','recordings'] loop
  child_id:=case when k='calls' then p_calls else p_recordings end;n:=0;
  if child_id is not null then
   select * into child from public.phone_sync_runs where id=child_id and tenant_id=p_tenant for share;
   if not found or child.provider<>'simwood' or child.sync_type<>k
   or child.metadata->>'from' is distinct from r.metadata->>'from' or child.metadata->>'to' is distinct from r.metadata->>'to' then
    raise exception 'phone_schedule_child_changed' using errcode='PT409';end if;
   scope:=jsonb_build_object('accountId',account_id,'connectorId',connector,'customerId',customer,'kind',k);
   if exists(select 1 from public.learn_phone_capture_pages where run_id=child_id and (tenant_id<>p_tenant or definition-'recordsSha256'<>scope)) then
    raise exception 'phone_schedule_child_changed' using errcode='PT409';end if;
   select coalesce(sum((receipt->>'recordsProcessed')::integer),0) into n from public.learn_phone_capture_pages where run_id=child_id;
   if not (p_errors ? k) then
    select * into proof from public.learn_phone_import_completions where run_id=child_id and tenant_id=p_tenant;
    if not found or child.status<>'success' or proof.receipt->>'version' is distinct from 'learn-phone-import/1'
    or proof.receipt->'windowComplete' is distinct from 'true'::jsonb or proof.definition-(array['pages','recordsProcessed','metadata'])<>scope
    or proof.definition->'metadata' is distinct from child.metadata or proof.receipt->>'from' is distinct from r.metadata->>'from'
    or proof.receipt->>'to' is distinct from r.metadata->>'to' or proof.receipt->'recordsProcessed' is distinct from to_jsonb(n)
    or child.metadata->'limit' is distinct from 'null'::jsonb
    or (k='calls' and (child.metadata->'direction' is distinct from 'null'::jsonb or child.metadata->'include_local' is distinct from r.metadata->'include_local'))
    or (k='recordings' and (child.metadata->'call_id' is distinct from 'null'::jsonb or child.metadata->'linked_id' is distinct from 'null'::jsonb)) then
     raise exception 'phone_schedule_child_unconfirmed' using errcode='PT409';end if;
   end if;
  elsif not (p_errors ? k) then raise exception 'phone_schedule_child_unconfirmed' using errcode='PT409';
  end if;
  counts:=counts||jsonb_build_object(k,n);
 end loop;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 if p_outcome='success' and not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into c from public.tenant_connectors where id=connector and tenant_id=p_tenant for update;
 if not found or c.connector_id<>'simwood' or c.provider<>'simwood' or not c.enabled or c.status not in ('active','error') then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 select * into a from public.connector_accounts where id=account_id and tenant_id=p_tenant for update;
 if not found or a.tenant_connector_id<>connector or a.status<>'active'
 or coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key) is distinct from customer then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 if a.updated_at is distinct from (r.metadata->>'account_updated_at')::timestamptz
 or coalesce(a.settings->'include_local_calls'='true'::jsonb,false) is distinct from (r.metadata->>'include_local')::boolean then
  raise exception 'phone_schedule_account_changed' using errcode='PT409';end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'phone_schedule_job_changed' using errcode='PT409';end if;
 if jsonb_typeof(a.sync_cursor) is distinct from 'object' then raise exception 'phone_schedule_cursor_invalid' using errcode='PT409';end if;
 cursor_at:=coalesce((a.sync_cursor->>'last_synced_until')::timestamptz,a.last_successful_sync_at);
 if p_outcome='success' then
  if (cursor_at is not null and (not isfinite(cursor_at) or window_from>cursor_at or window_to<cursor_at))
  or (cursor_at is null and window_from>window_to-interval '24 hours') then raise exception 'phone_schedule_window_gap' using errcode='PT409';end if;
  update public.connector_accounts set sync_cursor=sync_cursor||jsonb_build_object('last_synced_until',r.metadata->>'to'),
   last_successful_sync_at=window_to,last_error=null where id=account_id;
  -- One successful account must not hide another account's missing/failed sync.
  health:=case when exists(select 1 from public.connector_accounts where tenant_connector_id=connector and tenant_id=p_tenant
   and status='active' and (last_successful_sync_at is null or last_error is not null)) then 'warning' else 'healthy' end;
  update public.tenant_connectors set last_successful_sync_at=greatest(last_successful_sync_at,window_to),health_status=health,
   last_error=case when health='healthy' then null else 'phone_accounts_need_attention' end where id=connector;
 elsif p_outcome='failed' then
  update public.connector_accounts set last_failed_sync_at=checked_at,last_error='phone_sync_failed' where id=account_id;
  update public.tenant_connectors set last_failed_sync_at=checked_at,health_status='warning',last_error='phone_sync_failed' where id=connector;
 end if;
 answer:=jsonb_build_object('version','learn-phone-schedule/1','tenantId',p_tenant,'runId',p_run,'accountId',account_id,
  'connectorId',connector,'customerId',customer,'jobId',job,'outcome',p_outcome,'callsRunId',p_calls,'recordingsRunId',p_recordings,
  'callsProcessed',counts->'calls','recordingsProcessed',counts->'recordings','from',r.metadata->>'from','to',r.metadata->>'to',
  'cursorAdvanced',p_outcome='success');
 n:=(counts->>'calls')::integer+(counts->>'recordings')::integer;
 update public.phone_sync_runs set status=p_outcome,completed_at=checked_at,records_processed=n,
  error_message=case when p_outcome='failed' then 'phone_sync_failed' else null end,
  metadata=metadata||jsonb_build_object('calls_sync_run_id',p_calls,'recordings_sync_run_id',p_recordings,
   'calls_processed',counts->'calls','recordings_processed',counts->'recordings','errors',p_errors,'settlement',answer) where id=p_run;
 update public.platform_jobs set status=case p_outcome when 'success' then 'succeeded' when 'paused' then 'cancelled' else 'failed' end,
  completed_at=checked_at,failed_at=case when p_outcome='failed' then checked_at else failed_at end,
  cancelled_at=case when p_outcome='paused' then checked_at else cancelled_at end,
  last_error=case when p_outcome='failed' then 'phone_sync_failed' else null end,records_processed=n,progress_current=n,
  error_count=case when p_outcome='failed' then 1 else 0 end,
  result=answer||jsonb_build_object('capture_waiting',p_outcome='paused'),lease_expires_at=null where id=job;
 insert into public.learn_phone_schedule_settlements(run_id,tenant_id,definition,receipt) values(p_run,p_tenant,d,answer);
 return answer;
end $$;
revoke all on function public.learn_phone_settle_schedule(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_settle_schedule(uuid,uuid,uuid,uuid,text,jsonb) to service_role;

-- INPUT supabase/migrations/20261101010000_learn_phone_operator_evidence.sql
-- Operator-only scheduled Phone capture evidence and company-wide processing
-- counts. Original content, credentials, provider identifiers and errors stay private.

-- Reuse the existing retry selector safely from the restricted operator context.
-- Only qualify its dependencies; retry semantics and existing grants are retained.
create or replace function public.phone_pending_readiness(p_tenant_id uuid)
returns table(recording_id uuid, stage text, sort_at timestamptz, retry_state text)
language sql stable set search_path=pg_catalog as $$
  select s.id, s.stage, s.sort_at,
    public.phone_retry_state(s.stage, coalesce(r.runs,'[]'::jsonb), now())
  from public.phone_recording_pipeline_state s
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'status', x.status, 'started_at', x.started_at,
      'failed_step', x.metadata->>'failed_step',
      'error_code', x.metadata->>'error_code'
    ) order by x.started_at desc) runs
    from (
      select status, started_at, metadata from public.phone_sync_runs
      where tenant_id = s.tenant_id and sync_type = 'pipeline'
        and metadata->>'recording_id' = s.id::text
      order by started_at desc limit 5
    ) x
  ) r on true
  where s.tenant_id = p_tenant_id and s.is_incomplete;
$$;

create index learn_phone_schedule_health_lookup on public.phone_sync_runs
 (tenant_id,(metadata->>'connector_account_id'),started_at desc,id desc)
 where provider='simwood' and sync_type='scheduled_sync';

create function public.learn_phone_account_evidence(p_tenant uuid,p_account uuid)
returns jsonb language sql stable set search_path=pg_catalog as $$
 with account as (
  select a.*,c.id as connector from public.connector_accounts a join public.tenant_connectors c
   on c.id=a.tenant_connector_id and c.tenant_id=a.tenant_id
  where a.id=p_account and a.tenant_id=p_tenant and c.connector_id='simwood' and c.provider='simwood'
 ), attempts as not materialized (
  select r.*,s.receipt,q.id as job_id,q.status as job_status,q.lease_expires_at,
   coalesce(q.status='running' and q.claimed_by=r.metadata->>'job_owner' and q.attempt_count=1 and q.lease_expires_at>now()
    and q.connector_id='simwood' and q.payload->>'provider_customer_id'=r.metadata->>'provider_customer_id'
    and q.payload->>'from'=r.metadata->>'from' and q.payload->>'to'=r.metadata->>'to'
    and r.metadata->>'tenant_connector_id'=a.connector::text
    and r.metadata->'include_local'=to_jsonb(coalesce(a.settings->'include_local_calls'='true'::jsonb,false)),false) as ownership_current,
   coalesce(s.tenant_id=p_tenant and s.receipt->>'version'='learn-phone-schedule/1'
    and s.receipt->>'tenantId'=p_tenant::text and s.receipt->>'runId'=r.id::text
    and s.receipt->>'accountId'=a.id::text and s.receipt->>'connectorId'=a.connector::text
    and s.receipt->>'customerId'=coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key)
    and r.metadata->>'tenant_connector_id'=a.connector::text
    and r.metadata->'include_local'=to_jsonb(coalesce(a.settings->'include_local_calls'='true'::jsonb,false))
    and s.receipt->>'outcome'=r.status and s.receipt->>'jobId'=q.id::text
    and q.connector_id='simwood' and q.attempt_count=1
    and q.payload->>'provider_customer_id'=r.metadata->>'provider_customer_id'
    and q.payload->>'from'=r.metadata->>'from' and q.payload->>'to'=r.metadata->>'to'
    and s.receipt->>'from'=r.metadata->>'from' and s.receipt->>'to'=r.metadata->>'to'
    and q.completed_at=r.completed_at
    and r.completed_at is not null and r.completed_at>=r.started_at
    and ((r.status='success' and q.status='succeeded' and s.receipt->'cursorAdvanced'='true'::jsonb)
     or (r.status='failed' and q.status='failed' and s.receipt->'cursorAdvanced'='false'::jsonb)
     or (r.status='paused' and q.status='cancelled' and s.receipt->'cursorAdvanced'='false'::jsonb)),false) as confirmed
  from account a join public.phone_sync_runs r on r.tenant_id=a.tenant_id and r.provider='simwood' and r.sync_type='scheduled_sync'
   and r.metadata->>'connector_account_id'=a.id::text
   and r.metadata->>'provider_customer_id'=coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key)
  left join public.learn_phone_schedule_settlements s on s.run_id=r.id and s.tenant_id=r.tenant_id
  left join public.platform_jobs q on q.id=case when r.metadata->>'job_id' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (r.metadata->>'job_id')::uuid end
   and q.tenant_id=r.tenant_id and q.job_type='phone.scheduled_sync'
 ), latest as (select * from attempts order by started_at desc,id desc limit 1),
 successful as (select * from attempts where confirmed and status='success' order by started_at desc,id desc limit 1)
 select jsonb_build_object('version','learn-phone-account-evidence/1','tenant_id',p_tenant,'account_id',p_account,
  'scope','scheduled_capture','capture_allowed',public.learn_capture_allowed(p_tenant,'phone'),
  'latest_attempt',(select jsonb_build_object('id',id,'status',case when status in ('running','success','failed','paused') then status else 'unknown' end,
   'started_at',started_at,'completed_at',completed_at,'confirmed',confirmed,
   'job',case when job_id is null then null else jsonb_build_object('id',job_id,'status',case when job_status in ('queued','running','retrying','succeeded','failed','dead_letter','cancelled') then job_status else 'unknown' end,
    'lease_expires_at',lease_expires_at,'ownership_current',ownership_current) end) from latest),
  'last_confirmed',(select jsonb_build_object('id',id,'completed_at',completed_at,'from',receipt->>'from','to',receipt->>'to',
   'calls_processed',receipt->'callsProcessed','recordings_processed',receipt->'recordingsProcessed') from successful));
$$;
revoke all on function public.learn_phone_account_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_phone_processing_evidence(p_tenant uuid)
returns jsonb language sql stable set search_path=pg_catalog as $$
 with source as materialized (select * from public.phone_recording_pipeline_state where tenant_id=p_tenant),
 readiness as materialized (select * from public.phone_pending_readiness(p_tenant)),
 counts as (select count(*)::int as total,count(*) filter(where s.stage='complete')::int as complete,
  count(*) filter(where s.stage='download')::int as download_pending,
  count(*) filter(where s.stage='transcribe')::int as transcribe_pending,
  count(*) filter(where s.stage='analyse')::int as analyse_pending,
  count(*) filter(where r.retry_state='needs_review')::int as needs_review,
  count(*) filter(where r.retry_state='cooldown')::int as cooling_down,
  count(*) filter(where r.retry_state='in_progress')::int as recent_processing,
  count(*) filter(where r.retry_state='ready' and (s.stage<>'download' or (s.has_provider_id and s.sort_at<=now()-interval '120 seconds')))::int as ready,
  count(*) filter(where r.retry_state='ready' and s.stage='download' and (not s.has_provider_id or s.sort_at>now()-interval '120 seconds'))::int as waiting_provider,
  count(*) filter(where s.is_incomplete and (r.retry_state is null or r.retry_state not in ('needs_review','cooldown','in_progress','ready')))::int as unknown_retry
  from source s left join readiness r on r.recording_id=s.id)
 select jsonb_build_object('version','learn-phone-processing-evidence/1','tenant_id',p_tenant,'scope','company')||to_jsonb(counts) from counts;
$$;
revoke all on function public.learn_phone_processing_evidence(uuid) from public,anon,authenticated,service_role;

create or replace function public.learn_operator_capture_health(p_tenant uuid,p_after text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;more boolean;last_key text;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 if p_after is not null and p_after!~'^(email|phone|slack):[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'learn_operator_health_cursor_invalid' using errcode='22023';end if;
 with candidates as (
  select 'email:'||a.id::text as key,jsonb_build_object(
   'id',a.id,'source','email','provider',case when a.provider='gmail' and a.status in ('active_dwd','pending_tokenless_dwd') then 'google_workspace' when a.provider in ('gmail','google_workspace') then a.provider else 'other_email' end,
   'label',left(coalesce(nullif(a.display_name,''),'Mailbox'),120),
   'enabled',null,'account_state',case when a.status in ('active','active_dwd','pending_tokenless_dwd','disabled','paused','revoked') then a.status else 'unknown' end,
   'auth_state',case when a.status in ('active_dwd','pending_tokenless_dwd') or a.provider='google_workspace' then 'unknown' when a.auth_state in ('ok','expired','revoked','needs_reconnect') then a.auth_state else 'unknown' end,
   'last_success_at',greatest(a.last_incremental_success_at,case when er.status='success' and er.completed_at>=er.started_at then er.completed_at end),
   'last_attempt_at',greatest(a.last_incremental_attempt_at,er.started_at),
   'last_failure_at',greatest(
    case when a.last_sync_error is not null and a.last_incremental_attempt_at>=coalesce(a.last_incremental_success_at,'-infinity') then a.last_incremental_attempt_at end,
    case when er.status='failed' then coalesce(er.completed_at,er.started_at)
     when er.status='success' and (er.completed_at is null or er.completed_at<er.started_at) then er.started_at end),
   'latest_job',null,'bounded_complete',null) as row
  from public.email_accounts a
  left join lateral (
   select r.status,r.started_at,r.completed_at from public.email_sync_runs r
   where a.provider in ('gmail','google_workspace') and r.tenant_id=a.tenant_id
    and r.metadata->>'email_account_id'=a.id::text and r.provider='gmail'
    and r.sync_type in ('messages','workspace_messages')
    and r.sync_type=case when a.provider='google_workspace' or a.status in ('active_dwd','pending_tokenless_dwd') then 'workspace_messages' else 'messages' end
    and r.status in ('success','failed')
   order by r.started_at desc,r.id desc limit 1
  ) er on true
  where a.tenant_id=p_tenant
  union all
  select (case when tc.connector_id='slack' then 'slack:' else 'phone:' end)||a.id::text as key,jsonb_build_object(
   'id',a.id,'source',case when tc.connector_id='slack' then 'slack' else 'phone' end,'provider',tc.connector_id,
   'label',left(coalesce(nullif(a.display_name,''),case when tc.connector_id='slack' then 'Slack channel' else 'Phone account' end),120),
   'enabled',tc.enabled and (case when tc.connector_id='slack' then tc.status='active' else tc.status in ('active','error') end),
   'account_state',case when a.status in ('active','disabled','paused','revoked') then a.status else 'unknown' end,
   'auth_state','unknown','last_success_at',a.last_successful_sync_at,'last_attempt_at',null,'last_failure_at',a.last_failed_sync_at,
   'latest_job',case when j.id is null then null else jsonb_build_object('id',j.id,
    'status',case when j.status in ('queued','running','retrying','succeeded','dead_letter','cancelled') then j.status else 'unknown' end,
    'available_at',j.available_at,'lease_expires_at',j.lease_expires_at,'completed_at',j.completed_at) end,
   'phone_evidence',case when tc.connector_id='simwood' then public.learn_phone_account_evidence(p_tenant,a.id) else null end,
   'bounded_complete',case when tc.connector_id='slack' then coalesce(
    j.status='succeeded' and j.completed_at is not null
    and j.result->>'stopReason'='window_pages_complete'
    and j.result->'complete'='true'::jsonb and a.sync_cursor->'complete'='true'::jsonb
    and jsonb_typeof(a.sync_cursor->'scopeKey')='string' and a.sync_cursor->>'scopeKey'<>''
    and j.result->'scopeKey'=a.sync_cursor->'scopeKey'
    and j.result->'pages'=a.sync_cursor->'pages',false) else null end) as row
  from public.connector_accounts a join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  left join lateral(select q.id,q.status,q.available_at,q.lease_expires_at,q.completed_at,q.result from public.platform_jobs q
   where tc.connector_id='slack' and q.tenant_id=p_tenant and q.job_type='slack.history_sync' and q.payload->>'connector_account_id'=a.id::text
   order by q.created_at desc,q.id desc limit 1) j on true
  where a.tenant_id=p_tenant and ((tc.connector_id='simwood' and tc.provider='simwood') or (tc.connector_id='slack' and tc.provider='slack'))
 ), bounded as (select * from candidates where p_after is null or key>p_after order by key limit 51), page as (select * from bounded order by key limit 50)
 select coalesce((select jsonb_agg(row||jsonb_build_object('key',key) order by key) from page),'[]'),
  (select count(*)>50 from bounded),(select key from page order by key desc limit 1) into rows,more,last_key;
 return jsonb_build_object('version','learn-operator-capture-health/1','tenant_id',p_tenant,'checked_at',clock_timestamp(),'phone_processing',public.learn_phone_processing_evidence(p_tenant),'rows',rows,'next_cursor',case when more then last_key else null end);
end $$;
revoke all on function public.learn_operator_capture_health(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_capture_health(uuid,text) to authenticated;

-- INPUT supabase/migrations/20261101200000_learn_phone_download_attempts.sql
-- Exclusive recording download attempts and immutable audio versions. No capture is activated.

set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.learn_phone_processing_attempts (
 run_id uuid primary key references public.phone_sync_runs(id),
 tenant_id uuid not null references public.tenants(id),
 recording_id uuid not null references public.phone_recordings(id),
 stage text not null check(stage in ('download','transcription','analysis')),
 state text not null check(state in ('running','prepared','needs_review','succeeded','failed')),
 definition jsonb not null,
 prepared jsonb,
 receipt jsonb,
 started_at timestamptz not null default clock_timestamp(),
 review_after timestamptz not null default clock_timestamp()+interval '10 minutes',
 completed_at timestamptz,
 error_code text
);
create unique index learn_phone_one_recording_attempt on public.learn_phone_processing_attempts(tenant_id,recording_id)
 where state in ('running','prepared','needs_review');
alter table public.learn_phone_processing_attempts enable row level security;
revoke all on public.learn_phone_processing_attempts from public,anon,authenticated,service_role;
grant select on public.learn_phone_processing_attempts to service_role;
-- Only the definer RPC can mutate this journal. Expiry never grants a replacement owner.
create function public.learn_phone_download_attempt(
 p_tenant uuid,p_run uuid,p_recording uuid,p_phase text,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.learn_phone_processing_attempts%rowtype;r public.phone_recordings%rowtype;
 run public.phone_sync_runs%rowtype;account public.connector_accounts%rowtype;connector public.tenant_connectors%rowtype;
 d jsonb;src jsonb;answer jsonb;key text;code text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_attempt_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_recording is null or p_phase is null
 or p_phase not in ('claim','prepare','complete','fail','inspect') or jsonb_typeof(p_data) is distinct from 'object'
 or octet_length(p_data::text)>16384 then raise exception 'phone_attempt_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 -- One recording lock precedes every attempt/run lock, including direct step calls.
 select * into r from public.phone_recordings where id=p_recording and tenant_id=p_tenant for update;
 if not found or r.provider<>'simwood' then raise exception 'phone_attempt_recording_changed' using errcode='PT409';end if;
 select * into run from public.phone_sync_runs where id=p_run and tenant_id=p_tenant for update;
 if not found or run.provider<>'simwood' or run.sync_type<>'recording_download'
 or run.metadata->>'recording_id' is distinct from p_recording::text then
  raise exception 'phone_attempt_run_changed' using errcode='PT409';end if;
 select * into a from public.learn_phone_processing_attempts where run_id=p_run for update;
 if found and (a.tenant_id<>p_tenant or a.recording_id<>p_recording or a.stage<>'download') then
  raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
 if p_phase='inspect' then
  if p_data<>'{}'::jsonb or a.run_id is null then raise exception 'phone_attempt_missing' using errcode='PT409';end if;
  return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
   'recordingId',p_recording,'state',a.state,'replayed',true,'prepared',a.prepared);
 end if;
 src:=jsonb_build_object('providerRecordingId',r.provider_recording_id,'recordingUri',r.recording_uri,
  'storagePath',r.storage_path,'fileSize',r.file_size);
 if p_phase='claim' then
  if (p_data-array['accountId','connectorId','customerId','source'])<>'{}'::jsonb
   or jsonb_typeof(p_data->'source') is distinct from 'object'
   or p_data->>'customerId' is null or p_data->>'customerId'!~'^[A-Za-z0-9_-]{1,128}$' then
   raise exception 'phone_attempt_invalid' using errcode='22023';end if;
  if a.run_id is not null then
   if a.definition<>p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
   return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
    'recordingId',p_recording,'state',a.state,'replayed',true);
  end if;
  if run.status<>'running' or p_data->'source'<>src then raise exception 'phone_attempt_source_changed' using errcode='PT409';end if;
  if exists(select 1 from public.learn_phone_processing_attempts where tenant_id=p_tenant and recording_id=p_recording
   and state in ('running','dispatched','prepared','needs_review')) then raise exception 'phone_recording_processing_held' using errcode='PT409';end if;
  d:=p_data;
 else
  if a.run_id is null then raise exception 'phone_attempt_missing' using errcode='PT409';end if;
  d:=a.definition;
  if p_phase='complete' and a.state='succeeded' then
   if a.prepared<>p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
   return a.receipt;
  end if;
  if p_phase='prepare' and a.prepared is not null then
   if a.prepared<>p_data or a.state not in ('prepared','needs_review','succeeded') then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
   return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
    'recordingId',p_recording,'state',a.state,'replayed',true,'prepared',a.prepared);
  end if;
  if p_phase='fail' then
   code:=p_data->>'code';
   if (p_data-'code')<>'{}' or code is null or code not in ('provider_rate_limited','provider_timeout','download_failed',
    'provider_recording_missing','recording_not_ready','auth_failed','empty_audio','audio_too_large',
    'storage_unconfirmed','download_integrity_unconfirmed','source_changed','unexpected_failure') then
    raise exception 'phone_attempt_error_invalid' using errcode='22023';end if;
   if a.state in ('succeeded','failed') then raise exception 'phone_attempt_closed' using errcode='PT409';end if;
   update public.learn_phone_processing_attempts set state=case when prepared is null then 'failed' else 'needs_review' end,
    error_code=code,completed_at=case when prepared is null then clock_timestamp() end where run_id=p_run returning * into a;
   update public.phone_sync_runs set status=case when a.state='failed' then 'failed' else 'running' end,
    completed_at=a.completed_at,error_message=code,metadata=metadata||jsonb_build_object('processing_attempt_state',a.state,'error_code',code)
    where id=p_run;
   return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
    'recordingId',p_recording,'state',a.state,'replayed',false);
  end if;
  if run.status<>'running' or a.state not in ('running','prepared','needs_review') or d->'source'<>src then
   raise exception 'phone_attempt_source_changed' using errcode='PT409';end if;
 end if;
 -- New provider/upload/publication work must still be admitted. Receipt replay above is read-only.
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found or not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into connector from public.tenant_connectors where id=(d->>'connectorId')::uuid and tenant_id=p_tenant for share;
 if not found or connector.connector_id<>'simwood' or connector.provider<>'simwood' or not connector.enabled
 or connector.status not in ('active','error') then raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 select * into account from public.connector_accounts where id=(d->>'accountId')::uuid and tenant_id=p_tenant for share;
 if not found or account.tenant_connector_id<>connector.id or account.status<>'active'
 or coalesce(nullif(btrim(account.settings->>'provider_customer_id'),''),account.account_key) is distinct from d->>'customerId' then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 if p_phase='claim' then
  insert into public.learn_phone_processing_attempts(run_id,tenant_id,recording_id,stage,state,definition)
  values(p_run,p_tenant,p_recording,'download','running',d);
  return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
   'recordingId',p_recording,'state','running','replayed',false);
 end if;
 key:=p_tenant::text||'/simwood/recordings/versions/'||p_recording::text||'/'||p_run::text||'.wav';
 if (p_data-array['storagePath','sha256','bytes'])<>'{}' or p_data->>'storagePath' is distinct from key
 or jsonb_typeof(p_data->'sha256') is distinct from 'string' or p_data->>'sha256'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(p_data->'bytes') is distinct from 'number' or (p_data->>'bytes')::numeric<>trunc((p_data->>'bytes')::numeric)
 or (p_data->>'bytes')::numeric not between 1 and 67108864 then raise exception 'phone_attempt_output_invalid' using errcode='22023';end if;
 if p_phase='prepare' then
  if a.state<>'running' then raise exception 'phone_attempt_closed' using errcode='PT409';end if;
  update public.learn_phone_processing_attempts set prepared=p_data,state='prepared' where run_id=p_run;
  return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
   'recordingId',p_recording,'state','prepared','replayed',false,'prepared',p_data);
 end if;
 if a.prepared is null or a.prepared<>p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
 answer:=jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
  'recordingId',p_recording,'state','succeeded','prepared',p_data,'previousStoragePath',r.storage_path);
 update public.phone_recordings set storage_path=key where id=p_recording and tenant_id=p_tenant;
 update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=1,error_message=null,
  metadata=metadata||jsonb_build_object('storage_path',key,'downloaded_bytes',p_data->'bytes','sha256',p_data->>'sha256','processing_attempt_state','succeeded')
  where id=p_run and tenant_id=p_tenant;
 update public.learn_phone_processing_attempts set state='succeeded',receipt=answer,completed_at=clock_timestamp() where run_id=p_run;
 return answer;
end $$;
revoke all on function public.learn_phone_download_attempt(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_download_attempt(uuid,uuid,uuid,text,jsonb) to service_role;

-- Hold later scheduled/manual selections as well as the current job. Retained
-- completed recordings remain readable; this only changes new processing eligibility.
create or replace function public.phone_pending_readiness(p_tenant_id uuid)
returns table(recording_id uuid,stage text,sort_at timestamptz,retry_state text)
language sql stable set search_path=pg_catalog as $$
 select s.id,s.stage,s.sort_at,
  case when a.run_id is not null then
   case when a.state='needs_review' or a.review_after<=now() then 'needs_review' else 'in_progress' end
  else public.phone_retry_state(s.stage,coalesce(r.runs,'[]'::jsonb),now()) end
 from public.phone_recording_pipeline_state s
 left join public.learn_phone_processing_attempts a on a.tenant_id=s.tenant_id and a.recording_id=s.id
  and a.state in ('running','dispatched','prepared','needs_review')
 left join lateral (
  select jsonb_agg(jsonb_build_object('status',x.status,'started_at',x.started_at,
   'failed_step',x.metadata->>'failed_step','error_code',x.metadata->>'error_code') order by x.started_at desc) runs
  from (select status,started_at,metadata from public.phone_sync_runs where tenant_id=s.tenant_id and sync_type='pipeline'
   and metadata->>'recording_id'=s.id::text order by started_at desc limit 5)x
 )r on true where s.tenant_id=p_tenant_id and s.is_incomplete;
$$;

-- INPUT supabase/migrations/20261101210000_learn_phone_derived_versions.sql
-- Retained result history and exclusive, recoverable transcription/analysis attempts.
-- Additive candidate only; does not configure credentials or activate capture.

set local lock_timeout='5s';set local statement_timeout='30s';
alter table public.phone_transcripts add column source_storage_path text,add column source_sha256 text,add column processing_run_id uuid references public.phone_sync_runs(id);
alter table public.phone_ai_insights add column source_transcript_sha256 text,add column processing_run_id uuid references public.phone_sync_runs(id);
create table public.learn_phone_result_versions(
 run_id uuid primary key references public.phone_sync_runs(id),tenant_id uuid not null references public.tenants(id),
 recording_id uuid not null references public.phone_recordings(id),stage text not null check(stage in ('transcription','analysis')),
 result_id uuid not null,source jsonb not null,result jsonb not null,previous_result jsonb,previous_intelligence jsonb,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_result_versions enable row level security;
revoke all on public.learn_phone_result_versions from public,anon,authenticated,service_role;
grant select on public.learn_phone_result_versions to service_role;
alter table public.learn_phone_processing_attempts add column dispatch jsonb;
alter table public.learn_phone_processing_attempts drop constraint learn_phone_processing_attempts_state_check;
alter table public.learn_phone_processing_attempts add constraint learn_phone_processing_attempts_state_check
 check(state in ('running','dispatched','prepared','needs_review','succeeded','failed'));
drop index public.learn_phone_one_recording_attempt;
create unique index learn_phone_one_recording_attempt on public.learn_phone_processing_attempts(tenant_id,recording_id)
 where state in ('running','dispatched','prepared','needs_review');

-- Called only inside the analysis publication transaction. Prior identity rows are
-- archived with the result before replacing their current projections.
create function public.learn_phone_apply_intelligence(p_tenant uuid,p_run uuid,p_recording uuid,p_transcript uuid,p_insight uuid,p jsonb)
returns void language plpgsql set search_path=pg_catalog as $$
declare c public.phone_calls%rowtype;r public.phone_recordings%rowtype;d public.call_directions%rowtype;
 participant public.call_participants%rowtype;n public.call_transcript_normalisations%rowtype;old jsonb;item jsonb;v text;
begin
 if p is null or p='null'::jsonb then return;end if;
 if jsonb_typeof(p) is distinct from 'object' or (p-array['callId','callSource','resolverVersion','direction','participants','normalisation','identitySummary'])<>'{}'
 or jsonb_typeof(p->'direction') is distinct from 'object' or jsonb_typeof(p->'participants') is distinct from 'array'
 or jsonb_array_length(p->'participants')>20 or jsonb_typeof(p->'identitySummary') is distinct from 'object'
 or coalesce(p->>'resolverVersion','')!~'^[A-Za-z0-9_.:-]{1,128}$' then raise exception 'phone_intelligence_invalid' using errcode='22023';end if;
 select * into r from public.phone_recordings where tenant_id=p_tenant and id=p_recording;
 select * into c from public.phone_calls where tenant_id=p_tenant and id=(p->>'callId')::uuid for update;
 if not found or c.provider<>r.provider or not coalesce((r.provider_call_id=c.provider_call_id or r.linked_id=c.linked_id),false) then
  raise exception 'phone_intelligence_source_changed' using errcode='PT409';end if;
 if p->'callSource' is distinct from jsonb_build_object('raw_payload',c.raw_payload,'from_number',c.from_number,'to_number',c.to_number) then raise exception 'phone_intelligence_source_changed' using errcode='PT409';end if;
 v:=p->>'resolverVersion';
 old:=jsonb_build_object('direction',(select to_jsonb(x) from public.call_directions x where tenant_id=p_tenant and call_id=c.id),
  'participants',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.call_participants x where tenant_id=p_tenant and call_id=c.id and resolver_version=v),
  'normalisation',(select to_jsonb(x) from public.call_transcript_normalisations x where tenant_id=p_tenant and transcript_id=p_transcript and normalisation_version=p->'normalisation'->>'normalisation_version'));
 update public.learn_phone_result_versions set previous_intelligence=old where run_id=p_run and tenant_id=p_tenant;
 d:=jsonb_populate_record(null::public.call_directions,p->'direction'||jsonb_build_object('id',gen_random_uuid(),'tenant_id',p_tenant,'call_id',c.id,'created_at',clock_timestamp(),'updated_at',clock_timestamp()));
 if d.direction is null or d.direction_confidence is null or d.direction_confidence not between 0 and 1 or d.classifier_version is null then raise exception 'phone_intelligence_invalid' using errcode='22023';end if;
 insert into public.call_directions select (d).* on conflict(tenant_id,call_id) do update set
  direction=excluded.direction,provider_direction=excluded.provider_direction,originating_number=excluded.originating_number,
  destination_number=excluded.destination_number,external_party_number=excluded.external_party_number,originating_extension=excluded.originating_extension,
  answering_extension=excluded.answering_extension,pickup_extension=excluded.pickup_extension,transferred_from_extension=excluded.transferred_from_extension,
  transferred_to_extension=excluded.transferred_to_extension,direction_evidence=excluded.direction_evidence,direction_confidence=excluded.direction_confidence,classifier_version=excluded.classifier_version;
 delete from public.call_participants where tenant_id=p_tenant and call_id=c.id and resolver_version=v;
 for item in select value from jsonb_array_elements(p->'participants') loop
  if item->>'resolver_version' is distinct from v then raise exception 'phone_intelligence_invalid' using errcode='22023';end if;
  participant:=jsonb_populate_record(null::public.call_participants,item||jsonb_build_object('id',gen_random_uuid(),'tenant_id',p_tenant,'call_id',c.id,'created_at',clock_timestamp(),'updated_at',clock_timestamp()));
  if participant.confidence is null or participant.confidence not between 0 and 1 or (participant.resolved_entity_id is not null and not exists(
   select 1 from public.graph_nodes where tenant_id=p_tenant and id=participant.resolved_entity_id)) then raise exception 'phone_intelligence_invalid' using errcode='22023';end if;
  insert into public.call_participants select (participant).*;
 end loop;
 if p->'normalisation' is not null and p->'normalisation'<>'null'::jsonb then
  n:=jsonb_populate_record(null::public.call_transcript_normalisations,p->'normalisation'||jsonb_build_object('id',gen_random_uuid(),'tenant_id',p_tenant,'transcript_id',p_transcript,'created_at',clock_timestamp(),'updated_at',clock_timestamp()));
  insert into public.call_transcript_normalisations select (n).* on conflict(tenant_id,transcript_id,normalisation_version) do update set
   normalised_text=excluded.normalised_text,corrections=excluded.corrections;
 end if;
 update public.phone_ai_insights set identity_summary=p->'identitySummary' where tenant_id=p_tenant and id=p_insight;
end $$;
revoke all on function public.learn_phone_apply_intelligence(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.learn_phone_derived_attempt(p_tenant uuid,p_run uuid,p_recording uuid,p_stage text,p_phase text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.learn_phone_processing_attempts%rowtype;r public.phone_recordings%rowtype;run public.phone_sync_runs%rowtype;
 t public.phone_transcripts%rowtype;i public.phone_ai_insights%rowtype;d jsonb;src jsonb;prior jsonb;result jsonb;answer jsonb;
 result_id uuid;cached boolean;code text;next_state text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_attempt_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_recording is null or p_stage is null or p_stage not in ('transcription','analysis')
 or p_phase is null or p_phase not in ('claim','dispatch','prepare','complete','inspect','fail')
 or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>2097152 then raise exception 'phone_attempt_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.phone_recordings where id=p_recording and tenant_id=p_tenant for update;
 if not found then raise exception 'phone_attempt_recording_changed' using errcode='PT409';end if;
 select * into run from public.phone_sync_runs where id=p_run and tenant_id=p_tenant for update;
 if not found or run.provider<>'openai' or run.sync_type<>(case when p_stage='transcription' then 'transcription' else 'ai_analysis' end)
 or run.metadata->>'recording_id' is distinct from p_recording::text then raise exception 'phone_attempt_run_changed' using errcode='PT409';end if;
 select * into a from public.learn_phone_processing_attempts where run_id=p_run for update;
 if found and (a.tenant_id<>p_tenant or a.recording_id<>p_recording or a.stage<>p_stage) then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
 answer:=jsonb_build_object('version','learn-phone-derived-attempt/1','tenantId',p_tenant,'runId',p_run,'recordingId',p_recording,'stage',p_stage,'transcriptId',run.metadata->>'transcript_id');
 if p_phase='inspect' then
  if a.run_id is null or p_data<>'{}' then raise exception 'phone_attempt_missing' using errcode='PT409';end if;
  return answer||jsonb_build_object('state',a.state,'prepared',a.prepared,'receipt',a.receipt,'replayed',true);
 end if;
 if p_phase='complete' and a.state='succeeded' then
  if a.prepared is distinct from p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;return a.receipt;
 end if;
 if p_phase='claim' and a.run_id is not null then
  if a.definition->'request' is distinct from p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
  return answer||jsonb_build_object('state',a.state,'replayed',true,'receipt',a.receipt);
 end if;
 if p_phase<>'claim' and a.run_id is null then raise exception 'phone_attempt_missing' using errcode='PT409';end if;
 if p_phase='fail' then
  code:=p_data->>'code';
  if (p_data-'code')<>'{}' or code is null or code not in ('missing_audio','empty_audio','audio_too_large','config_error','input_unavailable',
   'openai_rate_limited','openai_auth_failed','openai_quota_exhausted','openai_invalid_request','audio_too_short','invalid_audio',
   'processing_unconfirmed','malformed_response') or a.state not in ('running','dispatched','prepared','needs_review') then
   raise exception 'phone_attempt_error_invalid' using errcode='22023';end if;
  -- Only a confirmed rejection before any saved output releases ownership.
  next_state:=case when a.state='running' or (a.state='dispatched' and code in ('openai_rate_limited','openai_auth_failed',
   'openai_quota_exhausted','openai_invalid_request','audio_too_short','audio_too_large','invalid_audio')) then 'failed' else 'needs_review' end;
  update public.learn_phone_processing_attempts set state=next_state,error_code=code,
   completed_at=case when next_state='failed' then clock_timestamp() end where run_id=p_run;
  update public.phone_sync_runs set status=case when next_state='failed' then 'failed' else 'running' end,
   completed_at=case when next_state='failed' then clock_timestamp() end,error_message=code,
   metadata=metadata||jsonb_build_object('processing_attempt_state',next_state,'error_code',code) where id=p_run;
  return answer||jsonb_build_object('state',next_state,'replayed',false);
 end if;
 if p_phase='prepare' and a.prepared is not null then
  if a.prepared is distinct from p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
  return answer||jsonb_build_object('state',a.state,'prepared',a.prepared,'replayed',true);
 end if;
 if p_phase='dispatch' and a.dispatch is not null then
  if a.dispatch is distinct from p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
  return answer||jsonb_build_object('state',a.state,'replayed',true);
 end if;
 if run.status<>'running' then raise exception 'phone_attempt_closed' using errcode='PT409';end if;
 if p_phase='claim' then
  if p_stage='analysis' and run.metadata->>'transcript_id' is distinct from p_data->>'transcriptId' then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
  if (p_data-array['model','force','transcriptId'])<>'{}' or jsonb_typeof(p_data->'force') is distinct from 'boolean'
   or coalesce(p_data->>'model','')!~'^[A-Za-z0-9_.:-]{1,128}$' or run.metadata->>'model' is distinct from p_data->>'model' then
   raise exception 'phone_attempt_invalid' using errcode='22023';end if;
  d:=jsonb_build_object('request',p_data);
 else d:=a.definition;end if;
 -- Retain an already-returned provider result even after a pause/source change.
 -- Only publication below requires the input and admission to remain current.
 if p_phase='prepare' then
  if a.state<>'dispatched' then raise exception 'phone_attempt_closed' using errcode='PT409';end if;
  if p_stage='transcription' then
   if (p_data-array['text','language','model'])<>'{}' or jsonb_typeof(p_data->'text') is distinct from 'string'
    or coalesce(btrim(p_data->>'text'),'')='' or length(p_data->>'text')>1000000
    or jsonb_typeof(p_data->'language') is distinct from 'string' or length(p_data->>'language')>64
    or p_data->>'model' is distinct from d->'request'->>'model' then raise exception 'phone_attempt_output_invalid' using errcode='22023';end if;
  else
   if (p_data-array['intent','urgency','sentiment','summary','action_required','suggested_owner','confidence','raw_payload'])<>'{}'
    or jsonb_typeof(p_data->'intent') is distinct from 'string' or length(p_data->>'intent') not between 1 and 64
    or coalesce(p_data->>'urgency','') not in ('low','medium','high','emergency')
    or coalesce(p_data->>'sentiment','') not in ('negative','neutral','positive','mixed')
    or jsonb_typeof(p_data->'summary') is distinct from 'string' or length(p_data->>'summary')>20000
    or jsonb_typeof(p_data->'action_required') is distinct from 'boolean'
    or coalesce(p_data->>'suggested_owner','') not in ('office','accounts','engineer','manager','unknown')
    or jsonb_typeof(p_data->'confidence') is distinct from 'number' or (p_data->>'confidence')::numeric not between 0 and 1
    or jsonb_typeof(p_data->'raw_payload') is distinct from 'object' then raise exception 'phone_attempt_output_invalid' using errcode='22023';end if;
  end if;
  update public.learn_phone_processing_attempts set prepared=p_data,state='prepared' where run_id=p_run;
  return answer||jsonb_build_object('state','prepared','prepared',p_data,'replayed',false);
 end if;
 if r.storage_path is null then raise exception 'phone_attempt_source_changed' using errcode='PT409';end if;
 if p_stage='transcription' then
  select * into t from public.phone_transcripts where tenant_id=p_tenant and recording_id=p_recording order by (status='completed') desc,created_at desc,id desc limit 1 for update;
  prior:=case when t.id is null then null else to_jsonb(t) end;
  src:=jsonb_build_object('storagePath',r.storage_path);
  cached:=t.status='completed' and coalesce(btrim(t.transcript_text),'')<>'' and (t.source_storage_path=r.storage_path or (t.source_storage_path is null and
   not exists(select 1 from public.learn_phone_processing_attempts where tenant_id=p_tenant and recording_id=p_recording and stage='download' and state='succeeded')));
  result_id:=t.id;result:=jsonb_build_object('text',t.transcript_text,'language',t.language,'model',t.model);
 else
  select * into t from public.phone_transcripts where id=(d->'request'->>'transcriptId')::uuid and tenant_id=p_tenant and recording_id=p_recording for update;
  if not found or t.status<>'completed' or coalesce(btrim(t.transcript_text),'')='' or not coalesce(t.source_storage_path=r.storage_path or (t.source_storage_path is null and
   not exists(select 1 from public.learn_phone_processing_attempts where tenant_id=p_tenant and recording_id=p_recording and stage='download' and state='succeeded')),false) then
   raise exception 'phone_attempt_source_changed' using errcode='PT409';end if;
  src:=jsonb_build_object('storagePath',r.storage_path,'transcriptId',t.id,'transcriptSha256',encode(sha256(convert_to(t.transcript_text,'UTF8')),'hex'),'text',t.transcript_text);
  select * into i from public.phone_ai_insights where tenant_id=p_tenant and recording_id=p_recording for update;
  prior:=case when i.id is null then null else to_jsonb(i) end;
  cached:=i.id is not null and ((i.transcript_id=t.id and i.source_transcript_sha256=src->>'transcriptSha256') or
   (i.source_transcript_sha256 is null and t.processing_run_id is null and (i.transcript_id is null or i.transcript_id=t.id)));
  result_id:=i.id;result:=to_jsonb(i);
 end if;
 if p_phase='claim' then
  if exists(select 1 from public.learn_phone_processing_attempts where tenant_id=p_tenant and recording_id=p_recording and state in ('running','dispatched','prepared','needs_review')) then
   raise exception 'phone_recording_processing_held' using errcode='PT409';end if;
  d:=d||jsonb_build_object('source',src,'previous',prior);
  if coalesce(cached,false) and p_data->'force'='false' then
   answer:=answer||jsonb_build_object('state','succeeded','cached',true,'resultId',result_id,'result',result,'replayed',false,'intelligencePublished',p_stage='analysis' and exists(select 1 from public.learn_phone_result_versions v where v.run_id=i.processing_run_id and v.tenant_id=p_tenant and v.previous_intelligence is not null and v.result->'raw_payload'=i.raw_payload));
   insert into public.learn_phone_processing_attempts(run_id,tenant_id,recording_id,stage,state,definition,receipt,completed_at)
    values(p_run,p_tenant,p_recording,p_stage,'succeeded',d,answer,clock_timestamp());
   update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=0,
    metadata=metadata||jsonb_build_object('already_processed',true,'result_id',result_id) where id=p_run;
   return answer;
  end if;
 else
  if d->'source' is distinct from src or d->'previous' is distinct from coalesce(prior,'null'::jsonb) then raise exception 'phone_attempt_source_changed' using errcode='PT409';end if;
 end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found or not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 if p_phase='claim' then
  insert into public.learn_phone_processing_attempts(run_id,tenant_id,recording_id,stage,state,definition) values(p_run,p_tenant,p_recording,p_stage,'running',d);
  return answer||jsonb_build_object('state','running','source',src,'replayed',false);
 end if;
 if p_phase='dispatch' then
  if a.state<>'running' or (p_data-array['sha256','bytes'])<>'{}' or jsonb_typeof(p_data->'sha256') is distinct from 'string'
   or p_data->>'sha256'!~'^[a-f0-9]{64}$' or jsonb_typeof(p_data->'bytes') is distinct from 'number'
   or (p_data->>'bytes')::numeric not between 1 and 67108864 then raise exception 'phone_attempt_invalid' using errcode='22023';end if;
  update public.learn_phone_processing_attempts set dispatch=p_data,state='dispatched' where run_id=p_run;
  return answer||jsonb_build_object('state','dispatched','replayed',false);
 end if;
 if a.state not in ('prepared','needs_review') or a.prepared is null or a.prepared is distinct from p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
 result_id:=coalesce(result_id,gen_random_uuid());
 insert into public.learn_phone_result_versions(run_id,tenant_id,recording_id,stage,result_id,source,result,previous_result)
 values(p_run,p_tenant,p_recording,p_stage,result_id,src||jsonb_build_object('request',a.dispatch),p_data,prior);
 if p_stage='transcription' then
  insert into public.phone_transcripts(id,tenant_id,recording_id,transcript_text,language,model,status,source_storage_path,source_sha256,processing_run_id)
  values(result_id,p_tenant,p_recording,p_data->>'text',p_data->>'language',p_data->>'model','completed',r.storage_path,a.dispatch->>'sha256',p_run)
  on conflict(id) do update set transcript_text=excluded.transcript_text,language=excluded.language,model=excluded.model,status='completed',
   source_storage_path=excluded.source_storage_path,source_sha256=excluded.source_sha256,processing_run_id=p_run;
 else
  insert into public.phone_ai_insights(id,tenant_id,recording_id,transcript_id,intent,urgency,sentiment,summary,action_required,suggested_owner,confidence,raw_payload,source_transcript_sha256,processing_run_id)
  values(result_id,p_tenant,p_recording,t.id,p_data->>'intent',p_data->>'urgency',p_data->>'sentiment',p_data->>'summary',(p_data->>'action_required')::boolean,
   p_data->>'suggested_owner',(p_data->>'confidence')::numeric,p_data->'raw_payload',src->>'transcriptSha256',p_run)
  on conflict(id) do update set transcript_id=excluded.transcript_id,intent=excluded.intent,urgency=excluded.urgency,sentiment=excluded.sentiment,
   summary=excluded.summary,action_required=excluded.action_required,suggested_owner=excluded.suggested_owner,confidence=excluded.confidence,
   raw_payload=excluded.raw_payload,source_transcript_sha256=excluded.source_transcript_sha256,processing_run_id=p_run,identity_summary='{}'::jsonb;
  perform public.learn_phone_apply_intelligence(p_tenant,p_run,p_recording,t.id,result_id,p_data->'raw_payload'->'phone_intelligence');
 end if;
 answer:=answer||jsonb_build_object('state','succeeded','cached',false,'resultId',result_id,'result',p_data,'intelligencePublished',p_stage='analysis' and jsonb_typeof(p_data->'raw_payload'->'phone_intelligence')='object');
 update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=1,error_message=null,
  metadata=metadata||jsonb_build_object('result_id',result_id,'processing_attempt_state','succeeded') where id=p_run;
 update public.learn_phone_processing_attempts set state='succeeded',receipt=answer,completed_at=clock_timestamp() where run_id=p_run;
 return answer;
end $$;
revoke all on function public.learn_phone_derived_attempt(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_derived_attempt(uuid,uuid,uuid,text,text,jsonb) to service_role;
-- Keep legacy observations available without inventing historical content hashes.
-- Once a versioned input changes, its earlier result no longer counts as current.
create or replace view phone_recording_pipeline_state
with (security_invoker = on) as
select
  r.id,
  r.tenant_id,
  r.provider,
  r.provider_recording_id,
  r.provider_call_id,
  r.recording_uri,
  r.storage_path,
  r.started_at,
  r.created_at,
  coalesce(r.started_at, r.created_at)               as sort_at,
  (r.provider_recording_id is not null)              as has_provider_id,
  (r.storage_path is not null)                       as has_download,
  (ct.recording_id is not null)                      as has_transcript,
  (ins.recording_id is not null)                     as has_insight,
  case
    when r.storage_path is null            then 'download'
    when ct.recording_id is null           then 'transcribe'
    when ins.recording_id is null          then 'analyse'
    else 'complete'
  end                                                as stage,
  (
    r.storage_path is null
    or ct.recording_id is null
    or ins.recording_id is null
  )                                                  as is_incomplete
from phone_recordings r
left join lateral (
  select t.recording_id,t.id,t.transcript_text,t.processing_run_id
  from phone_transcripts t
  where t.recording_id = r.id
    and t.tenant_id = r.tenant_id
    and t.status = 'completed'
    and (t.source_storage_path=r.storage_path or (t.source_storage_path is null and not exists(
      select 1 from public.learn_phone_processing_attempts a where a.tenant_id=r.tenant_id and a.recording_id=r.id and a.stage='download' and a.state='succeeded')))

  limit 1
) ct on true
left join lateral (
  select i.recording_id
  from phone_ai_insights i
  where i.recording_id = r.id
    and i.tenant_id = r.tenant_id
    and ct.id is not null
    and ((i.transcript_id=ct.id and i.source_transcript_sha256=encode(sha256(convert_to(ct.transcript_text,'UTF8')),'hex'))
      or (i.source_transcript_sha256 is null and ct.processing_run_id is null and (i.transcript_id is null or i.transcript_id=ct.id)))
  limit 1
) ins on true;

-- The server reads current results and their provenance, including insight ID
-- and created_at for the attribution loader. Result writes still use the atomic
-- definer RPC; this grants no INSERT/UPDATE/DELETE or browser access.
grant select on public.phone_transcripts,public.phone_ai_insights to service_role;
-- These configuration tables may be newly created under hardened default ACLs.
-- Without explicit read access a permission error can look like empty context.
grant select on public.telephony_directory,public.tenant_vocabulary to service_role;

-- INPUT supabase/migrations/20261101220000_learn_phone_operator_attempts.sql
-- OpenFolk attempt review and saved-result reconciliation. No provider dispatch,
-- automatic abandonment, source deletion or raw-content access is introduced.

create index learn_phone_attempt_review_page on public.learn_phone_processing_attempts(tenant_id,started_at desc,run_id desc);
create table public.learn_phone_operator_reconciliations(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),run_id uuid not null references public.phone_sync_runs(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_operator_reconciliations enable row level security;
revoke all on public.learn_phone_operator_reconciliations from public,anon,authenticated,service_role;
create trigger learn_phone_reconciliation_immutable before update or delete on public.learn_phone_operator_reconciliations
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_operator_phone_attempts(p_tenant uuid,p_recording uuid default null,p_after uuid default null,p_held_only boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;more boolean;last_id uuid;after_time timestamptz;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 if p_held_only is null then raise exception 'phone_review_filter_invalid' using errcode='22023';end if;
 if p_recording is not null and not exists(select 1 from public.phone_recordings where tenant_id=p_tenant and id=p_recording) then
  raise exception 'phone_review_recording_unavailable' using errcode='42501';end if;
 if p_after is not null then
  select started_at into after_time from public.learn_phone_processing_attempts where tenant_id=p_tenant and run_id=p_after
   and (p_recording is null or recording_id=p_recording);
  if not found then raise exception 'phone_review_cursor_invalid' using errcode='22023';end if;
 end if;
 with bounded as materialized(
  select a.* from public.learn_phone_processing_attempts a where tenant_id=p_tenant
   and (p_recording is null or recording_id=p_recording)
   and (not p_held_only or state in ('running','dispatched','prepared','needs_review'))
   and (p_after is null or (started_at,run_id)<(after_time,p_after))
  order by started_at desc,run_id desc limit 31
 ), page as materialized(select * from bounded order by started_at desc,run_id desc limit 30)
 select coalesce((select jsonb_agg(jsonb_build_object(
  'run_id',a.run_id,'recording_id',a.recording_id,'stage',a.stage,'state',a.state,
  'started_at',a.started_at,'completed_at',a.completed_at,'review_after',a.review_after,
  'has_prepared_result',a.prepared is not null,'has_receipt',a.receipt is not null,
  'error_code',case when a.error_code in ('missing_audio','empty_audio','audio_too_large','config_error','input_unavailable',
   'openai_rate_limited','openai_auth_failed','openai_quota_exhausted','openai_invalid_request','audio_too_short','invalid_audio',
   'processing_unconfirmed','malformed_response','provider_rate_limited','provider_timeout','download_failed',
   'provider_recording_missing','recording_not_ready','auth_failed','storage_unconfirmed','download_integrity_unconfirmed','source_changed','unexpected_failure') then a.error_code else null end,
  'retained_previous_result',coalesce(v.previous_result is not null and v.previous_result<>'null'::jsonb,false),
  'retained_previous_attribution',v.previous_intelligence is not null,
  'can_reconcile',a.stage in ('transcription','analysis') and a.prepared is not null and a.state in ('prepared','needs_review') and public.learn_capture_allowed(p_tenant,'phone')
 ) order by a.started_at desc,a.run_id desc) from page a left join public.learn_phone_result_versions v on v.run_id=a.run_id and v.tenant_id=p_tenant),'[]'),
 (select count(*)>30 from bounded),(select run_id from page order by started_at,run_id limit 1) into rows,more,last_id;
 return jsonb_build_object('version','learn-operator-phone-attempts/1','tenant_id',p_tenant,'recording_id',p_recording,
  'held_only',p_held_only,'checked_at',clock_timestamp(),'capture_allowed',public.learn_capture_allowed(p_tenant,'phone'),
  'rows',rows,'next_cursor',case when more then last_id else null end);
end $$;
revoke all on function public.learn_operator_phone_attempts(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_phone_attempts(uuid,uuid,uuid,boolean) to authenticated;

-- The request ID is durable across response loss. Check and cancel never publish.
-- Cancel leaves a tombstone so a delayed original apply cannot publish afterward.
create function public.learn_operator_phone_reconcile(p_tenant uuid,p_request uuid,p_actor uuid,p_run uuid,p_reason text,p_mode text default 'apply')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_phone_operator_reconciliations%rowtype;a public.learn_phone_processing_attempts%rowtype;
 answer jsonb;published jsonb;already boolean;begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_run is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'phone_reconciliation_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('phone-operator-reconciliation:'||p_request::text,0));
 select * into prior from public.learn_phone_operator_reconciliations where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.run_id<>p_run or prior.reason<>btrim(p_reason) then
   raise exception 'phone_reconciliation_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 -- Read without taking an attempt lock: the publication RPC acquires recording,
 -- run and attempt locks in that order, shared with every processing path.
 select * into a from public.learn_phone_processing_attempts where tenant_id=p_tenant and run_id=p_run;
 if not found then raise exception 'phone_review_attempt_unavailable' using errcode='42501';end if;
 answer:=jsonb_build_object('version','learn-operator-phone-reconciliation/1','tenant_id',p_tenant,'request_id',p_request,'run_id',p_run);
 if p_mode='check' then return answer||jsonb_build_object('state','pending');end if;
 if p_mode='cancel' then answer:=answer||jsonb_build_object('state','cancelled');
 else
  if a.stage not in ('transcription','analysis') then raise exception 'phone_download_verification_required' using errcode='PT409';end if;
  already:=a.state='succeeded';
  if already then
   if a.receipt->>'state' is distinct from 'succeeded' or a.receipt->>'runId' is distinct from p_run::text
    or a.receipt->>'tenantId' is distinct from p_tenant::text then raise exception 'phone_completion_unconfirmed' using errcode='PT409';end if;
  else
   if a.state not in ('prepared','needs_review') or a.prepared is null then raise exception 'phone_saved_result_unavailable' using errcode='PT409';end if;
   published:=public.learn_phone_derived_attempt(p_tenant,p_run,a.recording_id,a.stage,'complete',a.prepared);
   if published->>'state' is distinct from 'succeeded' then raise exception 'phone_completion_unconfirmed' using errcode='PT409';end if;
  end if;
  -- Return only a processing receipt, never transcript, summary or attribution.
  answer:=answer||jsonb_build_object('state','recorded','stage',a.stage,'recording_id',a.recording_id,'already_completed',already);
 end if;
 insert into public.learn_phone_operator_reconciliations(id,tenant_id,actor_id,run_id,reason,receipt)
  values(p_request,p_tenant,p_actor,p_run,btrim(p_reason),answer);
 return answer;
end $$;
revoke all on function public.learn_operator_phone_reconcile(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_phone_reconcile(uuid,uuid,uuid,uuid,text,text) to authenticated;

-- INPUT supabase/migrations/20261101230000_learn_phone_playback.sql
-- Retained Phone audio on LEARN cards. No provider fetch, capture or source writes.

create table public.learn_phone_playback_audit(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),recording_id uuid not null references public.phone_recordings(id),
 source_digest text not null check(source_digest ~ '^[a-f0-9]{64}$'),
 authorised_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_playback_audit enable row level security;
revoke all on public.learn_phone_playback_audit from public,anon,authenticated,service_role;
create trigger learn_phone_playback_audit_immutable before update or delete on public.learn_phone_playback_audit
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_phone_recordings_read(p_tenant uuid,p_table text,p_id uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor public.profiles%rowtype;available boolean;call_provider text;call_ref text;rows jsonb;more boolean;last_id uuid;
begin
 if p_table is null or p_table not in ('phone_calls','phone_recordings') then raise exception 'phone_source_invalid' using errcode='22023';end if;
 -- Match the existing source reader's actual-caller company owner/admin boundary.
 -- No new raw-table grants or changes to the existing source reader's ACL.
 select * into actor from public.profiles where id=auth.uid() for share;
 if not found or p_tenant is null or actor.tenant_id is distinct from p_tenant or (actor.role is null or actor.role not in ('owner','admin')) then raise exception 'phone_source_unavailable' using errcode='42501';end if;
 if p_id is null then raise exception 'phone_source_invalid' using errcode='22023';end if;
 if p_table='phone_calls' then
  select provider,provider_call_id into call_provider,call_ref from public.phone_calls where tenant_id=p_tenant and id=p_id;available:=found;
 else select exists(select 1 from public.phone_recordings where tenant_id=p_tenant and id=p_id) into available;end if;
 if not available then
  return jsonb_build_object('version','learn-phone-recordings/1','tenant_id',p_tenant,'table',p_table,'id',p_id,'source_available',false,'rows','[]'::jsonb,'next_cursor',null);
 end if;
 if p_after is not null and not exists(select 1 from public.phone_recordings r where r.tenant_id=p_tenant and r.id=p_after
  and ((p_table='phone_recordings' and r.id=p_id) or (p_table='phone_calls' and r.provider=call_provider and r.provider_call_id=call_ref)))
 then raise exception 'phone_recording_cursor_invalid' using errcode='22023';end if;
 with bounded as materialized(
  select r.id,r.started_at,r.duration_seconds,(r.storage_path is not null and r.storage_path<>'') as audio_stored
  from public.phone_recordings r where r.tenant_id=p_tenant and (p_after is null or r.id>p_after)
   and ((p_table='phone_recordings' and r.id=p_id) or (p_table='phone_calls' and r.provider=call_provider and r.provider_call_id=call_ref))
  order by r.id limit 31
 ),page as materialized(select * from bounded order by id limit 30)
 select coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from page p),'[]'),(select count(*)>30 from bounded),(select id from page order by id desc limit 1)
 into rows,more,last_id;
 return jsonb_build_object('version','learn-phone-recordings/1','tenant_id',p_tenant,'table',p_table,'id',p_id,'source_available',true,'rows',rows,'next_cursor',case when more then last_id else null end);
end $$;
revoke all on function public.learn_phone_recordings_read(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_recordings_read(uuid,text,uuid,uuid) to authenticated;

-- Only the authenticated-user Edge path may call this with its verified actor.
-- Recheck current profile and pointer after signing, before releasing any link.
create function public.learn_phone_playback_authorize(p_tenant uuid,p_actor uuid,p_recording uuid,p_source_digest text default null,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor public.profiles%rowtype;r public.phone_recordings%rowtype;fingerprint text;prior public.learn_phone_playback_audit%rowtype;
begin
 if p_tenant is null or p_actor is null or p_recording is null or (p_request is null)<>(p_source_digest is null) then raise exception 'phone_playback_invalid' using errcode='22023';end if;
 select * into actor from public.profiles where id=p_actor for share;
 if not found or actor.tenant_id is distinct from p_tenant or (actor.role is null or actor.role not in ('owner','admin')) then raise exception 'phone_playback_unavailable' using errcode='42501';end if;
 select * into r from public.phone_recordings where tenant_id=p_tenant and id=p_recording for share;
 if not found or r.storage_path is null or r.storage_path='' or r.storage_path not like p_tenant::text||'/%'
 then raise exception 'phone_playback_unavailable' using errcode='42501';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',r.id,'tenant',r.tenant_id,'path',r.storage_path,'size',r.file_size)::text,'UTF8')),'hex');
 if p_request is not null then
  if p_source_digest is distinct from fingerprint then raise exception 'phone_playback_source_changed' using errcode='PT409';end if;
  perform pg_advisory_xact_lock(hashtextextended('phone-playback:'||p_request::text,0));
  select * into prior from public.learn_phone_playback_audit where id=p_request;
  if found then
   if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.recording_id<>p_recording or prior.source_digest<>fingerprint then raise exception 'phone_playback_request_conflict' using errcode='PT409';end if;
  else insert into public.learn_phone_playback_audit(id,tenant_id,actor_id,recording_id,source_digest) values(p_request,p_tenant,p_actor,p_recording,fingerprint);end if;
 end if;
 return jsonb_build_object('version','learn-phone-playback-target/1','tenant_id',p_tenant,'recording_id',p_recording,'storage_path',r.storage_path,'source_digest',fingerprint,'request_id',p_request);
end $$;
revoke all on function public.learn_phone_playback_authorize(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_playback_authorize(uuid,uuid,uuid,text,uuid) to service_role;

-- INPUT supabase/migrations/20261101240000_learn_phone_saved_results.sql
-- Read retained call results without processing, provider requests or source mutation.

set local lock_timeout='3s';set local statement_timeout='30s';
create function public.learn_phone_saved_results_read(p_tenant uuid,p_recording uuid,p_offset integer default 0,p_transcript_sha256 text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor public.profiles%rowtype;r public.phone_recordings%rowtype;t public.phone_transcripts%rowtype;i public.phone_ai_insights%rowtype;
 v public.learn_phone_result_versions%rowtype;download jsonb;digest text;tf text:='unverified';af text:='unverified';n integer;answer jsonb;
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or p_tenant is null or actor.tenant_id is distinct from p_tenant or coalesce(actor.role,'') not in ('owner','admin') then
  raise exception 'phone_results_unavailable' using errcode='42501';end if;
 if p_recording is null or p_offset is null or p_offset<0 or p_offset>1048576 or p_offset%12000<>0
 or (p_offset>0 and p_transcript_sha256 is null) or (p_transcript_sha256 is not null and p_transcript_sha256!~'^[a-f0-9]{64}$') then
  raise exception 'phone_results_cursor_invalid' using errcode='22023';end if;
 answer:=jsonb_build_object('version','learn-phone-saved-results/1','tenant_id',p_tenant,'recording_id',p_recording,'checked_at',statement_timestamp());
 select * into r from public.phone_recordings where tenant_id=p_tenant and id=p_recording;
 if not found then return answer||jsonb_build_object('source_available',false,'transcript',null,'analysis',null);end if;
 select * into t from public.phone_transcripts where tenant_id=p_tenant and recording_id=p_recording
  order by (status='completed') desc,created_at desc,id desc limit 1;
 select * into i from public.phone_ai_insights where tenant_id=p_tenant and recording_id=p_recording
  order by created_at desc,id desc limit 1;
 if t.id is not null then
  digest:=encode(sha256(convert_to(coalesce(t.transcript_text,''),'UTF8')),'hex');n:=length(coalesce(t.transcript_text,''));
  if (p_transcript_sha256 is not null and digest<>p_transcript_sha256) or (p_offset>0 and p_offset>=n) then
   raise exception 'phone_results_changed' using errcode='PT409';end if;
  select * into v from public.learn_phone_result_versions where tenant_id=p_tenant and recording_id=p_recording and stage='transcription' and run_id=t.processing_run_id and result_id=t.id;
  select a.prepared into download from public.learn_phone_processing_attempts a where a.tenant_id=p_tenant and a.recording_id=p_recording and a.stage='download' and a.state='succeeded' and a.prepared->>'storagePath'=r.storage_path order by a.completed_at desc,a.run_id desc limit 1;
  if r.storage_path is null or (t.source_storage_path is not null and t.source_storage_path<>r.storage_path)
   or (v.run_id is not null and (v.source->>'storagePath' is distinct from r.storage_path or v.result->>'text' is distinct from t.transcript_text))
   or (download->>'sha256' is not null and t.source_sha256 is not null and download->>'sha256'<>t.source_sha256) then tf:='stale';
  elsif t.status='completed' and n>0 and t.source_storage_path=r.storage_path and t.source_sha256~'^[a-f0-9]{64}$'
   and v.run_id is not null then tf:='source_matched';end if;
 elsif p_offset>0 or p_transcript_sha256 is not null then raise exception 'phone_results_changed' using errcode='PT409';end if;
 if i.id is not null then
  if tf='stale' or (i.transcript_id is not null and i.transcript_id is distinct from t.id)
   or (i.source_transcript_sha256 is not null and i.source_transcript_sha256 is distinct from digest) then af:='stale';
  elsif tf='source_matched' and i.transcript_id=t.id and i.source_transcript_sha256=digest then af:='source_matched';end if;
 end if;
 return answer||jsonb_build_object('source_available',true,
  'transcript',case when t.id is not null then jsonb_build_object('id',t.id,'status',t.status,'text',substring(coalesce(t.transcript_text,'') from p_offset+1 for 12000),
   'offset',p_offset,'next_offset',case when p_offset+12000<n then p_offset+12000 else null end,'total_characters',n,'sha256',digest,'freshness',tf,'updated_at',t.updated_at) end,
  'analysis',case when i.id is not null then jsonb_build_object('id',i.id,'summary',left(coalesce(i.summary,''),20000),'summary_truncated',length(coalesce(i.summary,''))>20000,
   'source_transcript_id',i.transcript_id,'freshness',af,'updated_at',i.updated_at) end);
end $$;
revoke all on function public.learn_phone_saved_results_read(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_saved_results_read(uuid,uuid,integer,text) to authenticated;

-- INPUT supabase/migrations/20261101270000_learn_scheduler_health.sql
-- Bounded scheduler summaries. No raw-table client grants, source changes or schedules.

set local lock_timeout='3s';
set local statement_timeout='30s';
create index learn_email_scheduler_latest_idx on public.email_sync_runs(tenant_id,sync_type,started_at desc nulls last,id desc);
create index learn_phone_scheduler_latest_idx on public.phone_sync_runs(tenant_id,sync_type,started_at desc nulls last,id desc);

create function public.learn_scheduler_health_read(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor_tenant uuid;actor_role text;result jsonb;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null or p_tenant is null
  or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'scheduler_health_forbidden' using errcode='42501';end if;
 select tenant_id,role into actor_tenant,actor_role from public.profiles where id=auth.uid() for share;
 if not found then raise exception 'scheduler_health_forbidden' using errcode='42501';end if;
 -- Own-company summary follows the existing tenant SELECT policy, including viewers.
 -- Other-company reads require the existing effective-dated OpenFolk view grant.
 if actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin','ops','viewer') then
  perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 end if;
 if exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null
  and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'scheduler_health_preview_forbidden' using errcode='42501';end if;
 with definitions(name,source,kind) as (values
  ('phone-scheduled-sync','phone','scheduled_sync'),
  ('phone-processing-scheduled-sync','job','phone.process_pending'),
  ('email-scheduled-sync','email','scheduled_sync'),
  ('email-workspace-scheduled-sync','email','workspace_scheduled_sync'),
  ('email-workspace-backfill-scheduled-sync','email','workspace_backfill_scheduled'),
  ('interactions-scheduled-sync','job','interactions.sync'),
  ('identity-scheduled-sync','job','identity.resolve'),
  ('business-graph-scheduled-sync','job','graph.sync'),
  ('customer-card-scheduled-sync','job','customer_card.sync'),
  ('recommendation-scheduled-sync','job','recommendation.sync')
 ), observations as (
  select d.name,x.observed_at,x.status,x.metadata from definitions d
  left join lateral (
   (select r.started_at as observed_at,r.status,r.metadata from public.email_sync_runs r
    where d.source='email' and r.tenant_id=p_tenant and r.sync_type=d.kind
    order by r.started_at desc nulls last,r.id desc limit 1)
   union all
   (select r.started_at,r.status,null::jsonb from public.phone_sync_runs r
    where d.source='phone' and r.tenant_id=p_tenant and r.sync_type=d.kind
    order by r.started_at desc nulls last,r.id desc limit 1)
   union all
   (select j.created_at,j.status,null::jsonb from public.platform_jobs j
    where d.source='job' and j.tenant_id=p_tenant and j.job_type=d.kind
    order by j.created_at desc nulls last,j.id desc limit 1)
  ) x on true
 ) select jsonb_agg(jsonb_build_object(
   'name',name,'observed_at',observed_at,
   'status',case when status in ('success','failed','queued','running','succeeded','retrying','dead_letter','cancelled') then status when status is not null then 'unknown' end,
   'capture_paused',case when jsonb_typeof(metadata->'capture_paused')='number' and metadata->>'capture_paused' ~ '^[0-9]{1,9}$' then (metadata->>'capture_paused')::integer end,
   'enqueue_unconfirmed',case when jsonb_typeof(metadata->'enqueue_unconfirmed')='number' and metadata->>'enqueue_unconfirmed' ~ '^[0-9]{1,9}$' then (metadata->>'enqueue_unconfirmed')::integer end,
   'inventory_unavailable',case when jsonb_typeof(metadata->'inventory_unavailable')='boolean' then (metadata->>'inventory_unavailable')::boolean end
  ) order by name) into result from observations;
 return jsonb_build_object('version','learn-scheduler-health/1','tenant_id',p_tenant,
  'checked_at',statement_timestamp(),'rows',result);
end $$;
revoke all on function public.learn_scheduler_health_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_scheduler_health_read(uuid) to authenticated;

-- INPUT supabase/migrations/20261101290000_learn_phone_atomic_handoff.sql
-- Atomic phone -> canonical interaction/event publication. Requires the existing
-- platform event and phone projection migrations. No capture activation or raw
-- DML grants. Retained/legacy sources without exact provenance stay untouched.

set local lock_timeout='5s';set local statement_timeout='30s';
-- The legacy SQL version helper uses unqualified table names. Pin its resolution
-- when called from this publisher's restricted search path; retain invoker security.
alter function public.phone_projection_version(uuid,uuid) set search_path=pg_catalog,public;
create table public.learn_phone_handoff_receipts(
 run_id uuid primary key references public.phone_sync_runs(id),
 tenant_id uuid not null references public.tenants(id),
 recording_id uuid not null references public.phone_recordings(id),
 transcript_id uuid not null references public.phone_transcripts(id),
 insight_id uuid not null references public.phone_ai_insights(id),
 call_id uuid not null references public.phone_calls(id),
 interaction_id uuid not null references public.interactions(id),
 event_id uuid references public.platform_events(id),
 source_fingerprint text not null check(source_fingerprint ~ '^[a-f0-9]{64}$'),
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_handoff_receipts enable row level security;
revoke all on public.learn_phone_handoff_receipts from public,anon,authenticated,service_role;
create trigger learn_phone_handoff_receipts_immutable before update or delete
 on public.learn_phone_handoff_receipts for each row execute function public.learn_operator_input_immutable();

create function public.learn_phone_handoff(p_tenant uuid,p_run uuid,p_recording uuid,p_transcript uuid,p_insight uuid,p_phase text)
returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare r public.phone_recordings%rowtype;t public.phone_transcripts%rowtype;
 a public.phone_ai_insights%rowtype;c public.phone_calls%rowtype;run public.phone_sync_runs%rowtype;
 old public.interactions%rowtype;saved public.learn_phone_handoff_receipts%rowtype;
 v text;fingerprint text;transcript_hash text;latest uuid;interaction_id uuid;event_id uuid;
 same_source boolean;enriched boolean;answer jsonb;projection_metadata jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_handoff_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_recording is null or p_transcript is null or p_insight is null
 or p_phase is null or p_phase not in('publish','inspect') then raise exception 'phone_handoff_invalid' using errcode='22023';end if;
 -- An immutable receipt is historical evidence, available after a lost reply or
 -- later pause. It is not a claim that source data or downstream cards are current.
 select * into saved from public.learn_phone_handoff_receipts where run_id=p_run;
 if found then
  if saved.tenant_id<>p_tenant or saved.recording_id<>p_recording or saved.transcript_id<>p_transcript or saved.insight_id<>p_insight
  then raise exception 'phone_handoff_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if p_phase='inspect' then raise exception 'phone_handoff_missing' using errcode='PT409';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 -- Match the existing processing lock order: recording, run, transcript, insight,
 -- then call. All publications for recordings of the same call serialize there.
 select * into r from public.phone_recordings where tenant_id=p_tenant and id=p_recording for update;
 if not found then raise exception 'phone_handoff_source_changed' using errcode='PT409';end if;
 select * into run from public.phone_sync_runs where tenant_id=p_tenant and id=p_run for update;
 if not found or run.provider<>'pipeline' or run.sync_type<>'pipeline' or run.metadata->>'recording_id' is distinct from p_recording::text
 then raise exception 'phone_handoff_run_changed' using errcode='PT409';end if;
 -- A concurrent publisher may have committed while this request waited for locks.
 select * into saved from public.learn_phone_handoff_receipts where run_id=p_run;
 if found then
  if saved.tenant_id<>p_tenant or saved.recording_id<>p_recording or saved.transcript_id<>p_transcript or saved.insight_id<>p_insight
  then raise exception 'phone_handoff_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if run.status<>'running' then raise exception 'phone_handoff_run_changed' using errcode='PT409';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found or not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into t from public.phone_transcripts where tenant_id=p_tenant and id=p_transcript and recording_id=p_recording for share;
 select * into a from public.phone_ai_insights where tenant_id=p_tenant and id=p_insight and recording_id=p_recording for update;
 if t.id is null or a.id is null or r.storage_path is null or t.status<>'completed' or coalesce(btrim(t.transcript_text),'')=''
 or t.source_storage_path is distinct from r.storage_path or coalesce(t.source_sha256,'') !~ '^[a-f0-9]{64}$'
 or a.transcript_id is distinct from t.id then raise exception 'phone_handoff_source_unverified' using errcode='PT409';end if;
 transcript_hash:=encode(sha256(convert_to(t.transcript_text,'UTF8')),'hex');
 if a.source_transcript_sha256 is distinct from transcript_hash then raise exception 'phone_handoff_source_changed' using errcode='PT409';end if;
 select * into c from public.phone_calls where tenant_id=p_tenant and provider=r.provider and provider_call_id=r.provider_call_id for update;
 if not found or (a.call_id is not null and a.call_id<>c.id) then raise exception 'phone_handoff_call_changed' using errcode='PT409';end if;
 -- Do not let an older recording overwrite a later analysis of this call.
 select i.id into latest from public.phone_ai_insights i
 left join public.phone_recordings pr on pr.id=i.recording_id and pr.tenant_id=i.tenant_id
 where i.tenant_id=p_tenant and (i.call_id=c.id or (pr.provider=c.provider and pr.provider_call_id=c.provider_call_id))
 order by i.created_at desc,i.id desc limit 1;
 if latest is distinct from a.id or exists(select 1 from public.phone_ai_insights i where i.tenant_id=p_tenant and i.call_id=c.id and i.id<>a.id and i.created_at=a.created_at)
 then raise exception 'phone_handoff_superseded' using errcode='PT409';end if;
 if a.call_id is null then update public.phone_ai_insights set call_id=c.id where tenant_id=p_tenant and id=a.id;end if;
 v:=public.phone_projection_version(p_tenant,c.id);
 if v is null then raise exception 'phone_handoff_source_changed' using errcode='PT409';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('version',v,'recordingId',r.id,'storagePath',r.storage_path,
  'audioSha256',t.source_sha256,'transcriptId',t.id,'transcriptSha256',transcript_hash,'insightId',a.id,
  'intent',a.intent,'urgency',a.urgency,'actionRequired',a.action_required,'suggestedOwner',a.suggested_owner,'confidence',a.confidence)::text,'UTF8')),'hex');
 select * into old from public.interactions where tenant_id=p_tenant and source_table='phone_calls' and source_id=c.id for update;
 same_source:=coalesce(old.metadata->'phone_handoff'->>'sourceFingerprint'=fingerprint,false) and old.source_version is not distinct from v;
 enriched:=same_source and old.processing_status='enriched';
 projection_metadata:=jsonb_build_object('duration_seconds',c.duration_seconds,'outcome',c.outcome,'has_ai_insight',true,'recording_id',r.id,
  'phone_handoff',jsonb_build_object('version','learn-phone-handoff/1','sourceFingerprint',fingerprint,'recordingId',r.id,'transcriptId',t.id,'insightId',a.id,
   'audioSha256',t.source_sha256,'transcriptSha256',transcript_hash,'provenance','source_linked','coverage','unverified'));
 if same_source then interaction_id:=old.id;
 else
  insert into public.interactions as target(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,
   interaction_type,direction,occurred_at,summary,body_preview,phone_from,phone_to,sentiment,related_thread_id,source_version,processing_status,metadata)
  values(p_tenant,r.provider,'phone','phone_calls',c.id,c.provider_call_id,'phone_call',case c.direction when 'IN' then 'inbound' when 'OUT' then 'outbound' else 'unknown' end,
   coalesce(c.started_at,c.created_at),a.summary,coalesce(a.summary,'Call recording; analysis summary unavailable'),c.from_number,c.to_number,a.sentiment,c.linked_id,v,'ready',projection_metadata)
  on conflict(tenant_id,source_table,source_id) do update set source_connector_id=excluded.source_connector_id,source_type=excluded.source_type,
   source_external_id=excluded.source_external_id,interaction_type=excluded.interaction_type,direction=excluded.direction,occurred_at=excluded.occurred_at,
   summary=excluded.summary,body_preview=excluded.body_preview,phone_from=excluded.phone_from,phone_to=excluded.phone_to,sentiment=excluded.sentiment,
   related_thread_id=excluded.related_thread_id,source_version=excluded.source_version,processing_status='ready',metadata=target.metadata||excluded.metadata
  returning id into interaction_id;
 end if;
 if not enriched then
  insert into public.platform_events as event(tenant_id,event_type,subject_type,subject_id,source,status,payload)
   values(p_tenant,'interaction.ready','interaction',interaction_id,'phone-process-pipeline','pending',
    jsonb_build_object('source_type','phone','call_id',c.id,'recording_id',r.id,'source_fingerprint',fingerprint))
   on conflict(tenant_id,event_type,subject_id) where status='pending' do update set payload=event.payload||excluded.payload
   returning id into event_id;
 end if;
 answer:=jsonb_build_object('version','learn-phone-handoff/1','tenantId',p_tenant,'runId',p_run,'recordingId',r.id,
  'transcriptId',t.id,'insightId',a.id,'callId',c.id,'interactionId',interaction_id,'eventId',event_id,
  'sourceFingerprint',fingerprint,'eventPublished',event_id is not null,'alreadyEnriched',enriched,'state','committed');
 insert into public.learn_phone_handoff_receipts(run_id,tenant_id,recording_id,transcript_id,insight_id,call_id,interaction_id,event_id,source_fingerprint,receipt)
  values(p_run,p_tenant,r.id,t.id,a.id,c.id,interaction_id,event_id,fingerprint,answer);
 return answer;
end$$;
revoke all on function public.learn_phone_handoff(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_handoff(uuid,uuid,uuid,uuid,uuid,text) to service_role;

-- INPUT supabase/migrations/20261101410000_learn_email_retention_health.sql
-- Operator-only retained email inventory. Counts are observations, not live provider coverage.
-- Replace the latest health reader without changing its owner or ACL.

create or replace function public.learn_operator_capture_health(p_tenant uuid,p_after text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;more boolean;last_key text;email_retention jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 if p_after is not null and p_after!~'^(email|phone|slack):[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'learn_operator_health_cursor_invalid' using errcode='22023';end if;
 with candidates as (
  select 'email:'||a.id::text as key,jsonb_build_object(
   'id',a.id,'source','email','provider',case when a.provider='gmail' and a.status in ('active_dwd','pending_tokenless_dwd') then 'google_workspace' when a.provider in ('gmail','google_workspace') then a.provider else 'other_email' end,
   'label',left(coalesce(nullif(a.display_name,''),'Mailbox'),120),
   'enabled',null,'account_state',case when a.status in ('active','active_dwd','pending_tokenless_dwd','disabled','paused','revoked') then a.status else 'unknown' end,
   'auth_state',case when a.status in ('active_dwd','pending_tokenless_dwd') or a.provider='google_workspace' then 'unknown' when a.auth_state in ('ok','expired','revoked','needs_reconnect') then a.auth_state else 'unknown' end,
   'last_success_at',greatest(a.last_incremental_success_at,case when er.status='success' and er.completed_at>=er.started_at then er.completed_at end),
   'last_attempt_at',greatest(a.last_incremental_attempt_at,er.started_at),
   'last_failure_at',greatest(
    case when a.last_sync_error is not null and a.last_incremental_attempt_at>=coalesce(a.last_incremental_success_at,'-infinity') then a.last_incremental_attempt_at end,
    case when er.status='failed' then coalesce(er.completed_at,er.started_at)
     when er.status='success' and (er.completed_at is null or er.completed_at<er.started_at) then er.started_at end),
   'email_failure',case when er.status='failed' then jsonb_build_object('attempt_id',er.id,
    'occurred_at',coalesce(er.completed_at,er.started_at),'code',case when er.error_message=any(array['sa_config_missing','sa_credentials_invalid','admin_delegation_missing','scopes_missing','delegation_grant_invalid','delegation_denied','history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure']) then er.error_message else 'capture_failed' end) else null end,
   'latest_job',null,'bounded_complete',null) as row
  from public.email_accounts a
  left join lateral (
   select r.id,r.status,r.started_at,r.completed_at,r.error_message from public.email_sync_runs r
   where a.provider in ('gmail','google_workspace') and r.tenant_id=a.tenant_id
    and r.metadata->>'email_account_id'=a.id::text and r.provider='gmail'
    and r.sync_type in ('messages','workspace_messages')
    and r.sync_type=case when a.provider='google_workspace' or a.status in ('active_dwd','pending_tokenless_dwd') then 'workspace_messages' else 'messages' end
    and r.status in ('success','failed')
   order by r.started_at desc,r.id desc limit 1
  ) er on true
  where a.tenant_id=p_tenant
  union all
  select (case when tc.connector_id='slack' then 'slack:' else 'phone:' end)||a.id::text as key,jsonb_build_object(
   'id',a.id,'source',case when tc.connector_id='slack' then 'slack' else 'phone' end,'provider',tc.connector_id,
   'label',left(coalesce(nullif(a.display_name,''),case when tc.connector_id='slack' then 'Slack channel' else 'Phone account' end),120),
   'enabled',tc.enabled and (case when tc.connector_id='slack' then tc.status='active' else tc.status in ('active','error') end),
   'account_state',case when a.status in ('active','disabled','paused','revoked') then a.status else 'unknown' end,
   'auth_state','unknown','last_success_at',a.last_successful_sync_at,'last_attempt_at',null,'last_failure_at',a.last_failed_sync_at,
   'latest_job',case when j.id is null then null else jsonb_build_object('id',j.id,
    'status',case when j.status in ('queued','running','retrying','succeeded','dead_letter','cancelled') then j.status else 'unknown' end,
    'available_at',j.available_at,'lease_expires_at',j.lease_expires_at,'completed_at',j.completed_at) end,
   'phone_evidence',case when tc.connector_id='simwood' then public.learn_phone_account_evidence(p_tenant,a.id) else null end,
   'bounded_complete',case when tc.connector_id='slack' then coalesce(
    j.status='succeeded' and j.completed_at is not null
    and j.result->>'stopReason'='window_pages_complete'
    and j.result->'complete'='true'::jsonb and a.sync_cursor->'complete'='true'::jsonb
    and jsonb_typeof(a.sync_cursor->'scopeKey')='string' and a.sync_cursor->>'scopeKey'<>''
    and j.result->'scopeKey'=a.sync_cursor->'scopeKey'
    and j.result->'pages'=a.sync_cursor->'pages',false) else null end) as row
  from public.connector_accounts a join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  left join lateral(select q.id,q.status,q.available_at,q.lease_expires_at,q.completed_at,q.result from public.platform_jobs q
   where tc.connector_id='slack' and q.tenant_id=p_tenant and q.job_type='slack.history_sync' and q.payload->>'connector_account_id'=a.id::text
   order by q.created_at desc,q.id desc limit 1) j on true
  where a.tenant_id=p_tenant and ((tc.connector_id='simwood' and tc.provider='simwood') or (tc.connector_id='slack' and tc.provider='slack'))
 ), bounded as (select * from candidates where p_after is null or key>p_after order by key limit 51), page as (select * from bounded order by key limit 50)
 select coalesce((select jsonb_agg(row||jsonb_build_object('key',key) order by key) from page),'[]'),
  (select count(*)>50 from bounded),(select key from page order by key desc limit 1) into rows,more,last_key;
 -- Aggregate every retained row in this company, independently of account paging.
 -- Legacy/unbound/malformed observations stay unverified. No raw content leaves this RPC.
 with source as (
  select m.raw_payload,
   exists(select 1 from public.email_accounts a where a.tenant_id=p_tenant
    and a.id::text=m.raw_payload->>'provider_account_id' and a.provider=m.provider) as bound
  from public.email_messages m where m.tenant_id=p_tenant
 ), classified as (
  select bound,case when bound and jsonb_typeof(raw_payload->'provider_observed_history_id')='string'
   and case when raw_payload->>'provider_observed_history_id' ~ '^(0|[1-9][0-9]{0,19})$'
    then (raw_payload->>'provider_observed_history_id')::numeric<=18446744073709551615 else false end
   and raw_payload->>'provider_availability' in ('available','unavailable')
   then raw_payload->>'provider_availability' else 'unverified' end as availability
  from source
 ), counts as (
  select count(*) as total,
   count(*) filter(where availability='available') as available,
   count(*) filter(where availability='unavailable') as unavailable,
   count(*) filter(where availability='unverified') as unverified,
   count(*) filter(where not bound) as unbound from classified
 )
 select jsonb_build_object('version','learn-email-retention/1','tenant_id',p_tenant,'scope','company')
  ||to_jsonb(counts)||jsonb_build_object('archived_versions',
    (select count(*) from public.learn_email_source_versions where tenant_id=p_tenant))
 into email_retention from counts;
 return jsonb_build_object('version','learn-operator-capture-health/1','tenant_id',p_tenant,'checked_at',clock_timestamp(),'email_retention',email_retention,'phone_processing',public.learn_phone_processing_evidence(p_tenant),'rows',rows,'next_cursor',case when more then last_key else null end);
end $$;

insert into of_learn_deploy.migrations values('learn_phone_capture_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
