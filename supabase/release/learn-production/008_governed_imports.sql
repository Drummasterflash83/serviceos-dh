-- DRAFT production governed imports. No provider access or activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Import target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_capture_controls_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='178edb3a1e61397ba7cac593276269ea06dfd25d91d5206844e1948473610947') then raise exception 'Pinned production capture-control prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_governed_imports_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['import_entity_links','import_conflicts','import_row_results']))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['import_normalize_phone_uk','import_normalize_postcode','import_normalize_address','import_entity_links_guard','import_row_results_guard','import_validate_row_shape','import_validate_customer_row','import_validate_site_row','import_validate_job_row','import_resolve_customer','import_match_customer','import_match_site','import_resolve_job_site','import_match_job','import_row_preamble','import_row_prior','import_customer_row','import_site_row','import_job_row','import_row_outcome','import_run_finalize','import_person_contact_points','import_resolve_job_site_exact','import_resolve_job_site_v2','learn_import_customer_card','learn_import_customer_card_after_link','learn_import_customer_cards_reconcile','learn_import_batch_authority','learn_import_match_batch','learn_import_apply_batch'])) then
 raise exception 'Production Import candidate already exists; inspect before retry';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['tenants','profiles','view_as_context','people','companies','sites','jobs','data_imports','contact_points','customer_cards','import_row_provenance','import_profiles','job_number_aliases','communication_preferences','contact_suppressions']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"}],"rls":true,"name":"communication_preferences","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"contact_point_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"channel","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"b67a248b52b38f978a933b263ffad1ba"},{"name":"topic","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c08e9b72a1f5c2105a2649c074575a84"},{"name":"lawful_basis","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"effective_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"recorded_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"d7e8a120e901ffc2aec07a944f673bac","name":"comm_pref_person_idx","valid":true},{"hash":"9d43935dc4eb48b66903b5f9a1e926b3","name":"comm_pref_point_idx","valid":true},{"hash":"c567ff65e6ba8ec75a80dcfd2e3b8bfc","name":"communication_preferences_pkey","valid":true}],"forceRls":false,"policies":[{"name":"communication_preferences_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"f561f2d858976074e1c5cf15885a1d7d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"b59bc8d2f07fb6c2776c382717636992","name":"comm_pref_append_only","enabled":"O"},{"hash":"e810af9228a4157ab4a3e7a9e6dcb9b9","name":"communication_preferences_tenant_guard","enabled":"O"}],"constraints":[{"hash":"06f1c1faa3504bc7bd74ea6468bbec2d","kind":"c","name":"communication_preferences_channel_check","validated":true},{"hash":"17ea36880a312ddb42631d56f9c7832f","kind":"f","name":"communication_preferences_contact_point_id_fkey","validated":true},{"hash":"0c21263bddd28b58a7de36ac14a47c2d","kind":"f","name":"communication_preferences_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"communication_preferences_pkey","validated":true},{"hash":"4a052bf86d750c254246e29ebad74491","kind":"c","name":"communication_preferences_state_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"communication_preferences_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"companies","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"phone","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"address_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"postcode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5432bdbc84f521fbeb2451145455865c","name":"companies_pkey","valid":true},{"hash":"fc269a5aba437e691699dc5e15eadfa4","name":"companies_tenant_domain_idx","valid":true},{"hash":"01e053c9a52440e526bdec9651204659","name":"companies_tenant_id_uk","valid":true},{"hash":"fb22c282bd61679b4b62d77c9a219662","name":"companies_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"companies_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"291253580df21bff12714595b473a146","name":"companies_set_updated_at","enabled":"O"},{"hash":"780795e08f2f556db33bb7ab3e9af749","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"companies_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"contact_points","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"channel","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"b67a248b52b38f978a933b263ffad1ba"},{"name":"value","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"normalized_value","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"is_primary","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"verification_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ae78135a76f40a08be4bca5971585398"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c08e9b72a1f5c2105a2649c074575a84"},{"name":"source_record_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_observed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"9181f67f0cc9aba022da75b9378d71ae","name":"contact_points_endpoint_idx","valid":true},{"hash":"26f91ea7e8cba260c8efebbeba1cf989","name":"contact_points_person_idx","valid":true},{"hash":"ddd2ba588cfcb82fda62527060f576bc","name":"contact_points_person_value_uk","valid":true},{"hash":"0acabd6d4d789a0a73cadc9efd85fcbc","name":"contact_points_pkey","valid":true},{"hash":"5e318c7f8f222918352f208e34d39514","name":"contact_points_primary_uk","valid":true},{"hash":"b120aa0f1937597bbe24aa04a26d2a42","name":"contact_points_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"contact_points_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"f561f2d858976074e1c5cf15885a1d7d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"459cf7b338a26d76277057f96c061455","name":"contact_points_set_updated_at","enabled":"O"},{"hash":"101ddec5756b0a1d8c934a3815b3619a","name":"contact_points_tenant_guard","enabled":"O"}],"constraints":[{"hash":"06f1c1faa3504bc7bd74ea6468bbec2d","kind":"c","name":"contact_points_channel_check","validated":true},{"hash":"0c21263bddd28b58a7de36ac14a47c2d","kind":"f","name":"contact_points_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"contact_points_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"contact_points_tenant_id_fkey","validated":true},{"hash":"aa8b3887f01bbc4a8634c17f0bda64d3","kind":"c","name":"contact_points_verification_state_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"contact_suppressions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"contact_point_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"channel","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"b67a248b52b38f978a933b263ffad1ba"},{"name":"normalized_value","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"reason","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c08e9b72a1f5c2105a2649c074575a84"},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"suppressed_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"lifted_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recorded_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"493683451d275880dfbb2da73cdd6a14","name":"contact_suppressions_pkey","valid":true},{"hash":"86fc7f6b50bd94de1614f23ab64cee5d","name":"suppression_active_idx","valid":true},{"hash":"ee016294b328a56119a64154e4657a2e","name":"suppression_active_person_uk","valid":true},{"hash":"bb1027c3ca3c6d83a2d21ea14ade152e","name":"suppression_active_point_uk","valid":true},{"hash":"a0d701ed05239159772176c6d7435c0e","name":"suppression_active_value_uk","valid":true},{"hash":"042b3986f7c8e819cccba78173c6e9b1","name":"suppression_person_idx","valid":true}],"forceRls":false,"policies":[{"name":"contact_suppressions_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"f561f2d858976074e1c5cf15885a1d7d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"37f2026b07d1a88d0f83167144ea20b2","name":"contact_suppressions_tenant_guard","enabled":"O"},{"hash":"f0c51b5dfde552c1395d347f02e966c3","name":"suppression_set_updated_at","enabled":"O"}],"constraints":[{"hash":"06f1c1faa3504bc7bd74ea6468bbec2d","kind":"c","name":"contact_suppressions_channel_check","validated":true},{"hash":"17ea36880a312ddb42631d56f9c7832f","kind":"f","name":"contact_suppressions_contact_point_id_fkey","validated":true},{"hash":"0c21263bddd28b58a7de36ac14a47c2d","kind":"f","name":"contact_suppressions_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"contact_suppressions_pkey","validated":true},{"hash":"7c3cdac698244e03e214da1fe0ae7324","kind":"c","name":"contact_suppressions_reason_check","validated":true},{"hash":"45fb80bd716bb948aab4f5f5c70fd667","kind":"c","name":"contact_suppressions_target_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"contact_suppressions_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"customer_cards","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"summary","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d2e629d884dd34355a15552e5b518a5"},{"name":"priority","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"85d245f36de3b9cecc91228801a5247d"},{"name":"owner_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"due_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"latest_activity_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recommended_action","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"context","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"assigned_team_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"watchers","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"followers","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"helper_suggestions","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"priority_score","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority_inputs","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"locked_fields","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"a353edc9afd9f0fc7e68f00793ab2cc4","name":"customer_cards_pkey","valid":true},{"hash":"3e66bfccc40049ca8a2bda1f99447e58","name":"customer_cards_tenant_activity_idx","valid":true},{"hash":"e6846f1fa5da9015a49bebc34efc5a0b","name":"customer_cards_tenant_company_idx","valid":true},{"hash":"5266765be7d2d1dbb11d350513b8d662","name":"customer_cards_tenant_person_idx","valid":true},{"hash":"0e7faa01b3e9d4f1ca7ff2b0b22a7762","name":"customer_cards_tenant_priority_idx","valid":true},{"hash":"c627136b94cf9123bfd3e965d14129e9","name":"customer_cards_tenant_score_idx","valid":true},{"hash":"8aec36a2a422bac4e872b104db4e8dc6","name":"customer_cards_tenant_status_idx","valid":true}],"forceRls":false,"policies":[{"name":"customer_cards_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"e9fe5f91503ebba1c507f9e0c30f4f4d","name":"customer_cards_set_updated_at","enabled":"O"},{"hash":"efe1e538d97c8e8cdd6f3def4ce9fb7f","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"c393f886f52b6010a512c5c0980ab536","kind":"f","name":"customer_cards_company_id_fkey","validated":true},{"hash":"bcfe24d956220872d4db2fac32db2f22","kind":"f","name":"customer_cards_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"customer_cards_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"data_imports","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"profile_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"entity_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"original_filename","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"file_checksum","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"file_size","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"storage_path","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"f055f88588e0cc1a81df286181061e9e"},{"name":"row_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"valid_rows","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"invalid_rows","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"created_records","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"updated_records","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"skipped_records","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"duplicate_records","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"conflict_records","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"preview","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"failure","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"import_version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"uploaded_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"1bc9c91a4439fb7763f30a12a10147e3","name":"data_imports_checksum_idx","valid":true},{"hash":"51f3ada29fc6a78b9fe3a61af4a763d6","name":"data_imports_pkey","valid":true},{"hash":"7878cf1c276e70098f0eb93ec8397db0","name":"data_imports_tenant_id_uk","valid":true},{"hash":"80dbea33d8da4ad39d678f0fd2780bb9","name":"data_imports_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"data_imports_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"aef9e1ce50f8f2bb37d23889ffe27c52","name":"data_imports_set_updated_at","enabled":"O"},{"hash":"87e4cc8f1f3ecd568e22b41205fdc39d","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"data_imports_pkey","validated":true},{"hash":"739256ebd7a5ef30d14ef1e56d770b8c","kind":"f","name":"data_imports_profile_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"import_profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"entity_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"definition","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2e9cf5dc540f4b417571a059b4172fe9","name":"import_profiles_pkey","valid":true},{"hash":"e7275d25ff919d0c327c05b28533b392","name":"import_profiles_platform_uk","valid":true},{"hash":"0092a423512b6392dd67918c9fe9957e","name":"import_profiles_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"import_profiles_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"5e04f130ee9396f8722a08e40f559c7a","permissive":"PERMISSIVE"}],"triggers":[{"hash":"e328dc526a840169a8de2f402f178b50","name":"import_profiles_set_updated_at","enabled":"O"},{"hash":"a826f2090927eafe1b7c6c585767e012","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"import_profiles_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"import_row_provenance","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"import_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"entity_table","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"entity_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_row_number","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"imported_fields","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"match_strategy","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"action","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"conflicts","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"imported_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"8a91572f41fdca9e9d86120c4e387354","name":"import_row_provenance_entity_idx","valid":true},{"hash":"b825c39c5982688a894f863b5d3a22ee","name":"import_row_provenance_import_idx","valid":true},{"hash":"00401bcbce241d08cad8d2ea21657fb2","name":"import_row_provenance_pkey","valid":true}],"forceRls":false,"policies":[{"name":"import_row_provenance_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"5b10240d5d0c6958c1ddc2ac12e62327","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"bc3fd8ae9e0cd1fc887a2f0b036c1550","kind":"f","name":"import_row_provenance_import_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"import_row_provenance_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"job_number_aliases","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"job_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"alias","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"normalized","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"860249067912f301780644722dd2bc1c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"1ba7a5de450dcfc4d20b25910b9efb88","name":"job_number_aliases_job_idx","valid":true},{"hash":"98d0a3a4d95dcfd3e0fc73e78eef8cd0","name":"job_number_aliases_norm_uk","valid":true},{"hash":"0dacfd5a20de47c3017697145fe92014","name":"job_number_aliases_pkey","valid":true}],"forceRls":false,"policies":[{"name":"job_number_aliases_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"cd3cc9977d4b1c34769c1fbe48b8cdee","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"3363fb35cd81816b8a54f0c41e132aa1","kind":"f","name":"job_number_aliases_job_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"job_number_aliases_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"site_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"engineer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"invoice_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"quote_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"value_pennies","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"booked_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ee37b3b19e0eb6a9ec843fb638bb846b"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"e2b5d04060b50f96e02ff49b339ed40c","name":"jobs_number_uk","valid":true},{"hash":"47262421c727307ac344956cf7d14923","name":"jobs_pkey","valid":true},{"hash":"e34e04d2ff2d6c0312b227bd2c49508c","name":"jobs_source_uk","valid":true},{"hash":"cc280df5dbcf661faf07141d3eecca73","name":"jobs_tenant_customer_idx","valid":true},{"hash":"184a00fe1e8d9d8202141da43859208a","name":"jobs_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"6531df5998769ed5ffb7779d6ce6dfbb","name":"jobs_set_updated_at","enabled":"O"},{"hash":"9e38c2eb0e81c9ead9a4527ff2bc657e","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"08723955dee11c6cd8edfc8398afbaa0","kind":"f","name":"jobs_customer_company_id_fkey","validated":true},{"hash":"916bf00abad8f3f94f73abdcedf20f1d","kind":"f","name":"jobs_customer_person_id_fkey","validated":true},{"hash":"e51bea4de5e209d1bec8820944969827","kind":"f","name":"jobs_engineer_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"jobs_pkey","validated":true},{"hash":"d17aadc9a7f4da0432796d76a1939418","kind":"f","name":"jobs_site_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"people","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"first_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"primary_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"primary_phone","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"address_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"postcode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"1a8b3beb83e2f08c9500a4a18238042d","name":"people_pkey","valid":true},{"hash":"1e2102652fc5b864ea0d57177355974f","name":"people_tenant_company_idx","valid":true},{"hash":"cb1a308c5d9e9b5215cd6c95b9457f38","name":"people_tenant_email_idx","valid":true},{"hash":"9b4fe18f0a581f205f2e61e3e4b38164","name":"people_tenant_id_uk","valid":true},{"hash":"fa3e7cb1191bafb9f0e8edd6a6f60434","name":"people_tenant_idx","valid":true},{"hash":"301186b8ad8b84b5970039e703cf0b60","name":"people_tenant_name_idx","valid":true},{"hash":"c8712f809e58386d8e5cc526441e3b9f","name":"people_tenant_phone_idx","valid":true}],"forceRls":false,"policies":[{"name":"people_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"a49717171f853266db7a99a56baaba1c","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"7dd86e31a8486f3dd2deddede5d2eded","name":"people_set_updated_at","enabled":"O"}],"constraints":[{"hash":"c393f886f52b6010a512c5c0980ab536","kind":"f","name":"people_company_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"people_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"full_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ebe5151db32cb9795191097a4f9511a9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b7142bbffc23de763c1bd9f00489ec05","name":"profiles_pkey","valid":true},{"hash":"c07a523f1ebc968ab6b32bd5c984f32b","name":"profiles_role_idx","valid":true},{"hash":"610436088a5788625dd6956b9059f8c9","name":"profiles_tenant_id_idx","valid":true},{"hash":"84b975915f84814cf35c7604d4f94ecf","name":"profiles_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_profile","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"profiles_select_own","roles":["public"],"command":"SELECT","checkHash":null,"usingHash":"bc9c729a84690340789a4e4f01175335","permissive":"PERMISSIVE"}],"triggers":[{"hash":"bb3752d7064fd9e06fbe457f475928cc","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"83b0936855bf3bb7daa4f8356eb3c926","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a97ecad600d272e906bb06dea0b91c4","name":"profiles_set_updated_at","enabled":"O"}],"constraints":[{"hash":"0061c9fb3a9abcf2edbcd4a42467a9c3","kind":"f","name":"profiles_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"profiles_pkey","validated":true},{"hash":"4b3bd90c7f38a26788aecebbe2479ad7","kind":"c","name":"profiles_role_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"sites","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"address_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"postcode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ee37b3b19e0eb6a9ec843fb638bb846b"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"db11bebb617b7cb1565ee66b7abf621d","name":"sites_pkey","valid":true},{"hash":"25f0a10f9e618e7f684aa2e2d7baec5a","name":"sites_source_uk","valid":true},{"hash":"46840696beb4d91590d8e64c152aefcb","name":"sites_tenant_idx","valid":true},{"hash":"3866cde8dab18c2dcd81931a079f345d","name":"sites_tenant_postcode_idx","valid":true}],"forceRls":false,"policies":[{"name":"sites_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"145981fe4f7485544cdeb6f3553b7926","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"b16b17b99256b41ecefa302ae59a1ff7","name":"sites_set_updated_at","enabled":"O"}],"constraints":[{"hash":"c393f886f52b6010a512c5c0980ab536","kind":"f","name":"sites_company_id_fkey","validated":true},{"hash":"bcfe24d956220872d4db2fac32db2f22","kind":"f","name":"sites_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"sites_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"slug","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"industry","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5284b9c618f8618b72a402ea2c593753","name":"tenants_pkey","valid":true},{"hash":"6260c986ce2d58a0ad3de3f74ec6eb6f","name":"tenants_slug_key","valid":true}],"forceRls":false,"policies":[{"name":"tenants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"831f798d620de1d73971187d41079b4d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8009f8efa07661ab809d3f9e077da55e","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"742cd63e2f0ed7809f0911b17d02869d","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a4d62ca55c88b97023eab7696e527ce","name":"tenants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenants_pkey","validated":true},{"hash":"687397275d0e852fb2a4b50394adffee","kind":"u","name":"tenants_slug_key","validated":true},{"hash":"7702cc7b97df1ebce81e13bb05db5c2d","kind":"c","name":"tenants_status_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"view_as_context","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor_user_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"mode","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d3f83345a22c6bbd79692e353599f18"},{"name":"read_only","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"expires_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"dae782846028bc8168db98a8dd4b9193"},{"name":"ended_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5325064a8cf3f1e500b2308ea36b3343","name":"view_as_actor","valid":true},{"hash":"3b4560fae7e0f79297469f029ab77627","name":"view_as_context_pkey","valid":true}],"forceRls":false,"policies":[{"name":"view_as_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"565594dabafccb3adbde49e7a3f8790a","permissive":"PERMISSIVE"}],"triggers":[{"hash":"aaf4c57e4c5a9674a6979f95139e4746","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"1b0ebc4a05c69edafb63e927ba619765","name":"learn_work_authority_truncate_lock","enabled":"O"}],"constraints":[{"hash":"db8d41fae95b78d4a530a37cc023f719","kind":"c","name":"view_as_context_mode_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"view_as_context_pkey","validated":true},{"hash":"9579aceb86350661ce8f9dd1b4211a9b","kind":"c","name":"view_as_context_subject_kind_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"view_as_context_tenant_id_fkey","validated":true}]}]'::jsonb then raise exception 'Production Import table baseline differs';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['marketing_normalize_endpoint','set_updated_at','current_tenant_id','current_user_role']);
 if actual_helpers is distinct from '[{"hash":"58873c19368521e21e846890ee429301","name":"current_tenant_id","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"760512ca1d1f925421f3faf36e9d4447","name":"current_user_role","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"31de8566dd72dd3ba1c9bac4a5c712a6","name":"marketing_normalize_endpoint","owner":"postgres","arguments":"p_channel text, p_value text","anonExecute":false,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"4d6804d5850641a33867814c9e76a714","name":"set_updated_at","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true}]'::jsonb then raise exception 'Production Import helper baseline differs';end if;
 if exists(select 1 from import_profiles where tenant_id is null and source_system='commusoft' and name in ('Commusoft Prepared Customers','Commusoft Prepared Sites','Commusoft Prepared Jobs')) then raise exception 'Prepared import profiles already exist; review definitions before applying';end if;
 if exists(select 1 from contact_points c join people p on p.id=c.person_id where c.tenant_id<>p.tenant_id) then raise exception 'Existing contact parent mismatch';end if;
end $$;
-- Existing source/marketing structures remain intact. Three reusable import templates are added; no customer import or card backfill is performed.
alter table public.contact_points add constraint contact_points_person_tenant_fk foreign key(tenant_id,person_id) references public.people(tenant_id,id) on delete cascade;
-- INPUT supabase/release/learn-test/022_governed_imports.sql
-- SOURCE 20260912120000_commusoft_governed_import.sql; SHA-256 e0147060ae2f3ed4bbb6806b1d90484027c924f1daa4aeb8bdfa8c76576332f9
-- ===========================================================================
-- GOVERNED UNIVERSAL IMPORT — customers / sites / jobs (Commusoft-first).
--
-- Extends the proven governed-contacts import machinery (20260831120000) to
-- the operational entities so the Drummonds Commusoft migration can run with
-- the same guarantees the contacts importer already has:
--   * sealed preview contract (profile snapshot + SHA-256 + final mapping);
--   * a DURABLE per-row outcome ledger (import_row_results) whose terminal
--     outcomes are immutable and whose failed/held rows are retryable with an
--     attempt counter that must advance;
--   * per-(import,row) and per-identity advisory locks;
--   * an authoritative external-identity map (import_entity_links): once a
--     (source_system, entity_kind, external_id) has a canonical entity, every
--     rerun resolves to the SAME entity — never a duplicate;
--   * durable, reviewable conflicts (import_conflicts) with bounded evidence:
--     ambiguous channels, email/phone disagreement, and ambiguous site
--     resolution are HELD for review, never auto-merged and never guessed;
--   * honest finalisation: an import with held/conflicted rows is
--     'needs_review', never 'completed'.
--
-- Identity rules enforced here (the importer's constitution):
--   * source_system + external id is the authoritative import identity;
--   * ONE unambiguous existing person supported by a strong channel (email or
--     canonical-UK phone) may be linked; name-only evidence NEVER merges;
--   * a channel matching several people, or email and phone pointing at
--     different people, is a durable conflict with ZERO canonical mutation;
--   * company-like customers become canonical companies — the importer never
--     invents a named individual, and never auto-merges companies on name;
--   * jobs link a person XOR a company customer, and link a site only when
--     address/postcode evidence resolves to EXACTLY one site of that customer.
--
-- MARKETING SAFETY: nothing in this migration writes communication_preferences,
-- contact_suppressions or marketing permission records. Imported contact
-- points remain 'unverified' and their eligibility resolves to the safe
-- 'unknown' state — imports can never make an endpoint sendable.
-- ===========================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- Canonical normalisers (SQL side). import_normalize_phone_uk mirrors the
-- TypeScript importer normalizePhone EXACTLY (including the 0044… fix) so
-- preview (TS) and apply/resolve (SQL) can never disagree about a value.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_normalize_phone_uk(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v text := trim(coalesce(p_value, ''));
  v_plus boolean;
  d text;
begin
  if v = '' then return null; end if;
  v_plus := left(v, 1) = '+';
  d := regexp_replace(v, '[^0-9]', '', 'g');
  if d = '' then return null; end if;
  -- international-access form FIRST: 0044… → 44… (before the leading-0 rule)
  if d like '0044%' then d := '44' || substr(d, 5); end if;
  if v_plus then return '+' || d; end if;
  if d like '0%' then return '+44' || substr(d, 2); end if;
  if d like '44%' then return '+' || d; end if;
  return d;  -- unknown format → digits only (still comparable)
end $$;

create or replace function import_normalize_postcode(p_value text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '\s+', '', 'g')), '');
$$;

-- Address canonical form for DETERMINISTIC site matching: lowercase, strip
-- punctuation, collapse whitespace. Equality on this form is the only address
-- evidence the importer accepts — never fuzzy similarity, never a guess.
create or replace function import_normalize_address(p_value text)
returns text
language sql
immutable
as $$
  select nullif(trim(regexp_replace(
    regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9 ]+', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- import_entity_links — the authoritative external-identity map. Exactly one
-- canonical entity per (tenant, source_system, entity_kind, external_id).
-- Once a link exists, rerunning the same source row resolves to the same
-- entity for ever. Links are IMMUTABLE (only the FK-driven import_id set-null
-- may update a row); removing a link is a governed service-role quarantine
-- action, never a client operation.
-- ───────────────────────────────────────────────────────────────────────────
create table import_entity_links (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  source_system text not null,
  entity_kind   text not null check (entity_kind in ('customer', 'site', 'job')),
  external_id   text not null,
  entity_table  text not null check (entity_table in ('people', 'companies', 'sites', 'jobs')),
  entity_id     uuid not null,
  link_strategy text not null,   -- created | external_id | email | phone | email+phone
  confidence    numeric,
  evidence      jsonb not null default '{}'::jsonb,
  import_id     uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, source_system, entity_kind, external_id),
  constraint iel_kind_table_check check (
    (entity_kind = 'customer' and entity_table in ('people', 'companies'))
    or (entity_kind = 'site' and entity_table = 'sites')
    or (entity_kind = 'job'  and entity_table = 'jobs')),
  constraint iel_import_fk foreign key (tenant_id, import_id)
    references data_imports (tenant_id, id) on delete set null (import_id)
);
create index import_entity_links_entity_idx
  on import_entity_links (tenant_id, entity_table, entity_id);

create or replace function import_entity_links_guard()
returns trigger
language plpgsql
as $$
declare
  v_ok boolean;
begin
  if tg_op = 'INSERT' then
    -- the linked entity must exist and belong to the SAME tenant (the
    -- entity_table vocabulary is CHECK-bounded, so %I is safe here)
    execute format(
      'select exists (select 1 from %I e where e.id = $1 and e.tenant_id = $2)',
      new.entity_table) into v_ok using new.entity_id, new.tenant_id;
    if not v_ok then
      raise exception 'import link target %/% does not exist in tenant',
        new.entity_table, new.entity_id
        using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end if;
  -- UPDATE: links are immutable. The ONLY legal update is the FK-driven
  -- import_id set-null with every other column identical.
  if new.id = old.id and new.tenant_id = old.tenant_id
     and new.source_system = old.source_system
     and new.entity_kind = old.entity_kind
     and new.external_id = old.external_id
     and new.entity_table = old.entity_table
     and new.entity_id = old.entity_id
     and new.link_strategy = old.link_strategy
     and new.confidence is not distinct from old.confidence
     and new.evidence = old.evidence
     and new.created_at = old.created_at
     and new.import_id is null and old.import_id is not null then
    return new;
  end if;
  raise exception 'import entity links are immutable';
end $$;
create trigger import_entity_links_guard
  before insert or update on import_entity_links
  for each row execute function import_entity_links_guard();
create trigger import_entity_links_set_updated_at
  before update on import_entity_links
  for each row execute function set_updated_at();

alter table import_entity_links enable row level security;
create policy import_entity_links_select_tenant on import_entity_links
  for select to authenticated using (tenant_id = current_tenant_id());
grant select on import_entity_links to authenticated;
grant select, insert, update, delete on import_entity_links to service_role;
revoke truncate on import_entity_links from anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- import_conflicts — durable, reviewable import conflicts with bounded
-- per-identifier evidence. `blocking` conflicts hold the source row (and its
-- dependants) out of the canonical model; non-blocking conflicts are review
-- annotations beside an applied row (e.g. a company whose mailbox matches an
-- interaction-created person, or an ambiguous site link on a created job).
-- One OPEN conflict per (tenant, source, kind, external id, type).
-- ───────────────────────────────────────────────────────────────────────────
create table import_conflicts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  import_id     uuid,
  source_system text not null,
  entity_kind   text not null check (entity_kind in ('customer', 'site', 'job')),
  external_id   text not null,
  conflict_type text not null check (conflict_type in
    ('ambiguous_channel', 'channel_disagreement', 'multiple_candidates',
     'company_person_overlap', 'site_ambiguous')),
  blocking      boolean not null default true,
  identifiers   jsonb not null default '[]'::jsonb,  -- [{channel,label,value,candidate_person_ids,truncated}]
  candidates    jsonb not null default '[]'::jsonb,  -- bounded [{entity_table, entity_id}]
  truncated     boolean not null default false,
  detail        jsonb not null default '{}'::jsonb,
  status        text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution    jsonb,
  resolved_by   uuid,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ic_import_fk foreign key (tenant_id, import_id)
    references data_imports (tenant_id, id) on delete set null (import_id)
);
create unique index import_conflicts_tenant_id_uk on import_conflicts (tenant_id, id);
create unique index import_conflicts_open_uk on import_conflicts
  (tenant_id, source_system, entity_kind, external_id, conflict_type)
  where status = 'open';
create index import_conflicts_status_idx on import_conflicts (tenant_id, status, entity_kind);
create trigger import_conflicts_set_updated_at
  before update on import_conflicts
  for each row execute function set_updated_at();

alter table import_conflicts enable row level security;
create policy import_conflicts_select_tenant on import_conflicts
  for select to authenticated using (tenant_id = current_tenant_id());
grant select on import_conflicts to authenticated;
grant select, insert, update, delete on import_conflicts to service_role;
revoke truncate on import_conflicts from anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- import_row_results — the durable per-row outcome ledger for GOVERNED
-- non-contacts imports (the generalisation of marketing_import_row_results).
-- TERMINAL outcomes: created / linked / updated / conflict / invalid / skipped.
-- RETRYABLE outcomes: failed (transient error) and held (a dependency — the
-- customer of a site/job — is unresolved or conflicted; resolving it and
-- re-running the import reprocesses exactly these rows).
-- Aggregate counts and completion are ALWAYS recomputed from these rows.
-- ───────────────────────────────────────────────────────────────────────────
create table import_row_results (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  import_id    uuid not null,
  row_number   int not null check (row_number > 0),
  outcome      text not null check (outcome in
                 ('created', 'linked', 'updated', 'conflict', 'held',
                  'invalid', 'skipped', 'failed')),
  reason       text,
  fields       text[] not null default '{}',
  entity_table text check (entity_table in ('people', 'companies', 'sites', 'jobs')),
  entity_id    uuid,
  conflict_id  uuid,
  attempt      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, import_id, row_number),
  constraint irr_import_fk foreign key (tenant_id, import_id)
    references data_imports (tenant_id, id) on delete cascade,
  constraint irr_conflict_fk foreign key (tenant_id, conflict_id)
    references import_conflicts (tenant_id, id) on delete set null (conflict_id),
  constraint irr_entity_shape check (
    (entity_id is null and entity_table is null)
    or (entity_id is not null and entity_table is not null))
);
create index import_row_results_idx on import_row_results (tenant_id, import_id, outcome);

-- Structural transition guard (same honest contract as the marketing ledger):
--   * identity + lineage immutable on EVERY update;
--   * failed/held rows may transition only with attempt advancing by exactly 1;
--   * terminal rows are immutable;
--   * the only other legal shape is a genuine FK-driven set-null of the
--     conflict reference with every business column identical.
create or replace function import_row_results_guard()
returns trigger
language plpgsql
as $$
declare
  v_ok boolean;
begin
  if tg_op = 'INSERT' then
    if new.entity_id is not null then
      execute format(
        'select exists (select 1 from %I e where e.id = $1 and e.tenant_id = $2)',
        new.entity_table) into v_ok using new.entity_id, new.tenant_id;
      if not v_ok then
        raise exception 'row result entity %/% does not exist in tenant',
          new.entity_table, new.entity_id
          using errcode = 'integrity_constraint_violation';
      end if;
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.import_id is distinct from old.import_id
     or new.row_number is distinct from old.row_number
     or new.created_at is distinct from old.created_at then
    raise exception 'import row result identity/lineage is immutable (id, tenant, import, row, created_at)';
  end if;
  -- genuine FK-driven conflict set-null (legal for every outcome)
  if new.outcome = old.outcome
     and new.reason is not distinct from old.reason
     and new.fields = old.fields
     and new.attempt = old.attempt
     and new.entity_table is not distinct from old.entity_table
     and new.entity_id is not distinct from old.entity_id
     and new.conflict_id is null and old.conflict_id is not null then
    return new;
  end if;
  if old.outcome in ('failed', 'held') then
    if new.attempt is distinct from old.attempt + 1 then
      raise exception 'a failed/held-row retry must increment attempt by exactly one';
    end if;
    if new.entity_id is not null then
      execute format(
        'select exists (select 1 from %I e where e.id = $1 and e.tenant_id = $2)',
        new.entity_table) into v_ok using new.entity_id, new.tenant_id;
      if not v_ok then
        raise exception 'row result entity %/% does not exist in tenant',
          new.entity_table, new.entity_id
          using errcode = 'integrity_constraint_violation';
      end if;
    end if;
    return new;
  end if;
  raise exception 'terminal import row outcomes are immutable (only failed/held rows may transition)';
end $$;
create trigger import_row_results_guard
  before insert or update on import_row_results
  for each row execute function import_row_results_guard();
create trigger import_row_results_set_updated_at
  before update on import_row_results
  for each row execute function set_updated_at();

alter table import_row_results enable row level security;  -- deny-all for clients
grant select, insert, update on import_row_results to service_role;
revoke delete, truncate on import_row_results from anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Prepared-package import profiles (data, not code). `governed: true` routes
-- these profiles through the sealed governed engine in the data-import Edge
-- Function; the legacy profiles and their behaviour are untouched. Canonical
-- names equal the prepared CSV headers, so mapping is exact. Job dates are
-- typed TEXT deliberately: the prepared package carries full ISO timestamps
-- and the row RPC casts them to timestamptz without losing time-of-day.
-- ───────────────────────────────────────────────────────────────────────────
insert into import_profiles (tenant_id, source_system, entity_type, name, definition)
values
(null, 'commusoft', 'customers', 'Commusoft Prepared Customers', jsonb_build_object(
  'governed', true,
  'columns', jsonb_build_array(
    jsonb_build_object('canonical','source_system','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','external_id','aliases',jsonb_build_array('customer account number'),'type','text','required',true),
    jsonb_build_object('canonical','record_kind','aliases',jsonb_build_array(),'type','text','required',true),
    jsonb_build_object('canonical','display_name','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','title','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','first_name','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','last_name','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','company_name','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','primary_phone','aliases',jsonb_build_array(),'type','phone'),
    jsonb_build_object('canonical','secondary_phone','aliases',jsonb_build_array(),'type','phone'),
    jsonb_build_object('canonical','primary_email','aliases',jsonb_build_array(),'type','email'),
    jsonb_build_object('canonical','address_text','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','postcode','aliases',jsonb_build_array(),'type','postcode'),
    jsonb_build_object('canonical','active','aliases',jsonb_build_array(),'type','bool'),
    jsonb_build_object('canonical','metadata_json','aliases',jsonb_build_array(),'type','text')
  ))),
(null, 'commusoft', 'sites', 'Commusoft Prepared Sites', jsonb_build_object(
  'governed', true,
  'columns', jsonb_build_array(
    jsonb_build_object('canonical','source_system','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','external_id','aliases',jsonb_build_array('workaddress account number'),'type','text','required',true),
    jsonb_build_object('canonical','customer_external_id','aliases',jsonb_build_array(),'type','text','required',true),
    jsonb_build_object('canonical','label','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','address_text','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','postcode','aliases',jsonb_build_array(),'type','postcode'),
    jsonb_build_object('canonical','primary_phone','aliases',jsonb_build_array(),'type','phone'),
    jsonb_build_object('canonical','primary_email','aliases',jsonb_build_array(),'type','email'),
    jsonb_build_object('canonical','active','aliases',jsonb_build_array(),'type','bool'),
    jsonb_build_object('canonical','metadata_json','aliases',jsonb_build_array(),'type','text')
  ))),
(null, 'commusoft', 'jobs', 'Commusoft Prepared Jobs', jsonb_build_object(
  'governed', true,
  'columns', jsonb_build_array(
    jsonb_build_object('canonical','source_system','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','external_id','aliases',jsonb_build_array(),'type','text','required',true),
    jsonb_build_object('canonical','job_number','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','customer_external_id','aliases',jsonb_build_array(),'type','text','required',true),
    jsonb_build_object('canonical','site_external_id','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','site_address_text','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','site_postcode','aliases',jsonb_build_array(),'type','postcode'),
    jsonb_build_object('canonical','title','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','description','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','status','aliases',jsonb_build_array(),'type','text','required',true),
    jsonb_build_object('canonical','active','aliases',jsonb_build_array(),'type','bool'),
    jsonb_build_object('canonical','created_date','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','completed_date','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','value_pennies','aliases',jsonb_build_array(),'type','number'),
    jsonb_build_object('canonical','quoted_value_pennies','aliases',jsonb_build_array(),'type','number'),
    jsonb_build_object('canonical','engineer','aliases',jsonb_build_array(),'type','text'),
    jsonb_build_object('canonical','metadata_json','aliases',jsonb_build_array(),'type','text')
  )))
on conflict do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- Shared row validation — PREVIEW and APPLY make the SAME decision. Contract
-- breaches (unknown keys, wrong jsonb types) raise 22023; honest per-row
-- invalidity returns {reason, fields}. NULL = the row is valid.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_validate_row_shape(
  p_record jsonb, p_allowed text[], p_bool_keys text[], p_num_keys text[]
) returns void
language plpgsql
immutable
as $$
declare
  v_key text;
  v_type text;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'record must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_record) loop
    if not (v_key = any (p_allowed)) then
      raise exception 'unknown record key %', v_key using errcode = '22023';
    end if;
    v_type := jsonb_typeof(p_record -> v_key);
    if v_type = 'null' then
      continue;
    elsif v_key = any (p_bool_keys) then
      if v_type <> 'boolean' then
        raise exception 'record value % must be a boolean', v_key using errcode = '22023';
      end if;
    elsif v_key = any (p_num_keys) then
      if v_type <> 'number' then
        raise exception 'record value % must be a number', v_key using errcode = '22023';
      end if;
    else
      if v_type <> 'string' then
        raise exception 'record value % must be a string', v_key using errcode = '22023';
      end if;
      if length(p_record ->> v_key) > 4000 then
        raise exception 'record value % is too long', v_key using errcode = '22023';
      end if;
    end if;
  end loop;
end $$;

create or replace function import_validate_customer_row(
  p_tenant uuid, p_source text, p_record jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_kind text;
  v_fields text[] := array[]::text[];
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  perform import_validate_row_shape(p_record,
    array['source_system','external_id','record_kind','display_name','title',
          'first_name','last_name','company_name','primary_phone',
          'secondary_phone','primary_email','address_text','postcode',
          'active','metadata_json'],
    array['active'], array[]::text[]);
  if nullif(trim(coalesce(p_record ->> 'external_id', '')), '') is null then
    return jsonb_build_object('reason', 'missing external id',
                              'fields', array['external_id']);
  end if;
  if p_record ->> 'source_system' is not null
     and p_record ->> 'source_system' <> p_source then
    return jsonb_build_object('reason', 'row source_system does not match the import source',
                              'fields', array['source_system']);
  end if;
  v_kind := nullif(trim(coalesce(p_record ->> 'record_kind', '')), '');
  if v_kind is null or v_kind not in ('person', 'company_contact') then
    return jsonb_build_object('reason', 'record_kind must be person or company_contact',
                              'fields', array['record_kind']);
  end if;
  if v_kind = 'company_contact'
     and nullif(trim(coalesce(p_record ->> 'company_name', '')), '') is null then
    return jsonb_build_object('reason', 'a company customer requires a company name',
                              'fields', array['company_name']);
  end if;
  if v_kind = 'person'
     and nullif(trim(coalesce(p_record ->> 'display_name', '')), '') is null
     and nullif(trim(coalesce(p_record ->> 'first_name', '')), '') is null
     and nullif(trim(coalesce(p_record ->> 'last_name', '')), '') is null then
    return jsonb_build_object('reason', 'a person customer requires a name',
                              'fields', array['display_name']);
  end if;
  if p_record ->> 'metadata_json' is not null then
    begin
      if jsonb_typeof((p_record ->> 'metadata_json')::jsonb) <> 'object' then
        v_fields := array['metadata_json'];
      end if;
    exception when others then
      v_fields := array['metadata_json'];
    end;
    if array_length(v_fields, 1) > 0 then
      return jsonb_build_object('reason', 'metadata_json is not a JSON object',
                                'fields', v_fields);
    end if;
  end if;
  return null;
end $$;

create or replace function import_validate_site_row(
  p_tenant uuid, p_source text, p_record jsonb
) returns jsonb
language plpgsql
stable
as $$
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  perform import_validate_row_shape(p_record,
    array['source_system','external_id','customer_external_id','label',
          'address_text','postcode','primary_phone','primary_email',
          'active','metadata_json'],
    array['active'], array[]::text[]);
  if nullif(trim(coalesce(p_record ->> 'external_id', '')), '') is null then
    return jsonb_build_object('reason', 'missing external id',
                              'fields', array['external_id']);
  end if;
  if nullif(trim(coalesce(p_record ->> 'customer_external_id', '')), '') is null then
    return jsonb_build_object('reason', 'missing customer external id',
                              'fields', array['customer_external_id']);
  end if;
  if p_record ->> 'source_system' is not null
     and p_record ->> 'source_system' <> p_source then
    return jsonb_build_object('reason', 'row source_system does not match the import source',
                              'fields', array['source_system']);
  end if;
  if p_record ->> 'metadata_json' is not null then
    begin
      if jsonb_typeof((p_record ->> 'metadata_json')::jsonb) <> 'object' then
        return jsonb_build_object('reason', 'metadata_json is not a JSON object',
                                  'fields', array['metadata_json']);
      end if;
    exception when others then
      return jsonb_build_object('reason', 'metadata_json is not a JSON object',
                                'fields', array['metadata_json']);
    end;
  end if;
  return null;
end $$;

create or replace function import_validate_job_row(
  p_tenant uuid, p_source text, p_record jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_status text;
  v_d text;
  v_ts timestamptz;
  v_key text;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  perform import_validate_row_shape(p_record,
    array['source_system','external_id','job_number','customer_external_id',
          'site_external_id','site_address_text','site_postcode','title',
          'description','status','active','created_date','completed_date',
          'value_pennies','quoted_value_pennies','engineer','metadata_json'],
    array['active'], array['value_pennies','quoted_value_pennies']);
  if nullif(trim(coalesce(p_record ->> 'external_id', '')), '') is null then
    return jsonb_build_object('reason', 'missing external id',
                              'fields', array['external_id']);
  end if;
  if nullif(trim(coalesce(p_record ->> 'customer_external_id', '')), '') is null then
    return jsonb_build_object('reason', 'missing customer external id',
                              'fields', array['customer_external_id']);
  end if;
  if p_record ->> 'source_system' is not null
     and p_record ->> 'source_system' <> p_source then
    return jsonb_build_object('reason', 'row source_system does not match the import source',
                              'fields', array['source_system']);
  end if;
  v_status := nullif(trim(coalesce(p_record ->> 'status', '')), '');
  if v_status is null or v_status not in ('open', 'completed', 'aborted') then
    return jsonb_build_object('reason', 'status must be open, completed or aborted',
                              'fields', array['status']);
  end if;
  foreach v_key in array array['created_date', 'completed_date'] loop
    v_d := nullif(trim(coalesce(p_record ->> v_key, '')), '');
    if v_d is not null then
      begin
        v_ts := v_d::timestamptz;
      exception when others then
        return jsonb_build_object('reason', v_key || ' is not a valid timestamp',
                                  'fields', array[v_key]);
      end;
    end if;
  end loop;
  foreach v_key in array array['value_pennies', 'quoted_value_pennies'] loop
    if p_record -> v_key is not null and jsonb_typeof(p_record -> v_key) = 'number' then
      if (p_record ->> v_key)::numeric <> floor((p_record ->> v_key)::numeric) then
        return jsonb_build_object('reason', v_key || ' must be integer pennies',
                                  'fields', array[v_key]);
      end if;
    end if;
  end loop;
  if p_record ->> 'metadata_json' is not null then
    begin
      if jsonb_typeof((p_record ->> 'metadata_json')::jsonb) <> 'object' then
        return jsonb_build_object('reason', 'metadata_json is not a JSON object',
                                  'fields', array['metadata_json']);
      end if;
    exception when others then
      return jsonb_build_object('reason', 'metadata_json is not a JSON object',
                                'fields', array['metadata_json']);
    end;
  end if;
  return null;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- import_resolve_customer — EVIDENCE-CONVERGED customer identity, mirroring
-- marketing_import_resolve_contact:
--   * an existing import link is authoritative ('linked');
--   * person rows resolve each supplied channel INDEPENDENTLY against
--     people scalars AND contact_points (invalid endpoints are never usable
--     evidence): >1 candidates on a channel → ambiguous; two channels naming
--     different people → conflicting; exactly one person → matched; none →
--     new_person. Name evidence is NEVER queried — a name cannot merge.
--   * company rows are ALWAYS new_company (companies have no strong shared
--     identifier — name-matching is forbidden); people matching the company's
--     channels are returned as bounded overlap evidence for review.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_resolve_customer(
  p_tenant uuid, p_source text, p_record jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_kind text := nullif(trim(coalesce(p_record ->> 'record_kind', '')), '');
  v_link import_entity_links%rowtype;
  v_channels text[];
  v_labels text[];
  v_vals text[];
  v_ids uuid[];
  v_i int;
  v_evidence jsonb := '[]'::jsonb;
  v_ambiguous boolean := false;
  v_matched uuid[] := array[]::uuid[];
  v_matched_channels text[] := array[]::text[];
  v_union uuid[] := array[]::uuid[];
  v_supplied int := 0;
  v_strategy text;
  v_confidence numeric;
begin
  if p_tenant is null or p_source is null then
    raise exception 'tenant and source required' using errcode = '22023';
  end if;
  if v_ext is null then
    raise exception 'external id required' using errcode = '22023';
  end if;

  -- authoritative external-identity map first
  select * into v_link from import_entity_links l
   where l.tenant_id = p_tenant and l.source_system = p_source
     and l.entity_kind = 'customer' and l.external_id = v_ext;
  if found then
    return jsonb_build_object('decision', 'linked',
      'entity_table', v_link.entity_table, 'entity_id', v_link.entity_id,
      'strategy', 'external_id', 'confidence', 1.0);
  end if;

  -- channel evidence, each channel resolved independently. People already
  -- linked to a DIFFERENT external id of the SAME source are NEVER candidates:
  -- two Commusoft accounts sharing an email/phone (landlord/tenant, spouses)
  -- are two distinct customers — a shared channel must never merge them.
  v_channels := array['email', 'phone', 'phone'];
  v_labels := array['primary_email', 'primary_phone', 'secondary_phone'];
  v_vals := array[
    marketing_normalize_endpoint('email', p_record ->> 'primary_email'),
    import_normalize_phone_uk(p_record ->> 'primary_phone'),
    import_normalize_phone_uk(p_record ->> 'secondary_phone')];
  for v_i in 1..3 loop
    continue when v_vals[v_i] is null;
    v_supplied := v_supplied + 1;
    if v_channels[v_i] = 'email' then
      select array_agg(x.pid order by x.pid) into v_ids from (
        select pp.id as pid from people pp
         where pp.tenant_id = p_tenant
           and marketing_normalize_endpoint('email', pp.primary_email) = v_vals[v_i]
           and not exists (select 1 from contact_points cpx
                            where cpx.tenant_id = p_tenant and cpx.person_id = pp.id
                              and cpx.channel = 'email'
                              and cpx.normalized_value = v_vals[v_i]
                              and cpx.verification_state = 'invalid')
        union
        select cp.person_id from contact_points cp
          join people pj on pj.id = cp.person_id and pj.tenant_id = p_tenant
         where cp.tenant_id = p_tenant and cp.channel = 'email'
           and cp.normalized_value = v_vals[v_i]
           and cp.verification_state <> 'invalid') x
       where not exists (select 1 from import_entity_links il
                          where il.tenant_id = p_tenant
                            and il.source_system = p_source
                            and il.entity_kind = 'customer'
                            and il.entity_table = 'people'
                            and il.entity_id = x.pid
                            and il.external_id <> v_ext);
    else
      -- BOTH sides are canonicalised to the +44 form, so 0…/44…/+44…/0044…
      -- written forms of the same number always converge
      select array_agg(x.pid order by x.pid) into v_ids from (
        select pp.id as pid from people pp
         where pp.tenant_id = p_tenant
           and import_normalize_phone_uk(pp.primary_phone) = v_vals[v_i]
           and not exists (select 1 from contact_points cpx
                            where cpx.tenant_id = p_tenant and cpx.person_id = pp.id
                              and cpx.channel = 'phone'
                              and import_normalize_phone_uk(cpx.normalized_value) = v_vals[v_i]
                              and cpx.verification_state = 'invalid')
        union
        select cp.person_id from contact_points cp
          join people pj on pj.id = cp.person_id and pj.tenant_id = p_tenant
         where cp.tenant_id = p_tenant and cp.channel = 'phone'
           and import_normalize_phone_uk(cp.normalized_value) = v_vals[v_i]
           and cp.verification_state <> 'invalid') x
       where not exists (select 1 from import_entity_links il
                          where il.tenant_id = p_tenant
                            and il.source_system = p_source
                            and il.entity_kind = 'customer'
                            and il.entity_table = 'people'
                            and il.entity_id = x.pid
                            and il.external_id <> v_ext);
    end if;
    v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
      'channel', v_channels[v_i], 'label', v_labels[v_i], 'value', v_vals[v_i],
      'candidate_person_ids', to_jsonb(coalesce(v_ids[1:25], '{}'::uuid[])),
      'truncated', coalesce(array_length(v_ids, 1), 0) > 25));
    if coalesce(array_length(v_ids, 1), 0) > 1 then
      v_ambiguous := true;
      v_union := v_union || v_ids[1:25];
    elsif coalesce(array_length(v_ids, 1), 0) = 1 then
      if not (v_ids[1] = any (v_matched)) then
        v_matched := array_append(v_matched, v_ids[1]);
      end if;
      v_matched_channels := array_append(v_matched_channels, v_labels[v_i]);
      v_union := v_union || v_ids;
    end if;
  end loop;
  select array_agg(u order by u) into v_union
    from (select distinct unnest(v_union) as u) s;

  -- company customers: canonical company, channels reported as overlap only
  if v_kind = 'company_contact' then
    return jsonb_build_object('decision', 'new_company',
      'strategy', 'created', 'confidence', 1.0,
      'evidence', v_evidence,
      'person_overlap', to_jsonb(coalesce(v_union[1:25], '{}'::uuid[])),
      'truncated', coalesce(array_length(v_union, 1), 0) > 25,
      'supplied_identifiers', v_supplied);
  end if;

  if v_ambiguous then
    return jsonb_build_object('decision', 'ambiguous',
      'evidence', v_evidence,
      'candidate_union', to_jsonb(coalesce(v_union[1:25], '{}'::uuid[])),
      'truncated', coalesce(array_length(v_union, 1), 0) > 25,
      'supplied_identifiers', v_supplied);
  end if;
  if coalesce(array_length(v_matched, 1), 0) > 1 then
    return jsonb_build_object('decision', 'conflicting',
      'evidence', v_evidence,
      'candidate_union', to_jsonb(coalesce(v_union[1:25], '{}'::uuid[])),
      'truncated', coalesce(array_length(v_union, 1), 0) > 25,
      'supplied_identifiers', v_supplied);
  end if;
  if coalesce(array_length(v_matched, 1), 0) = 1 then
    if exists (select 1 from unnest(v_matched_channels) c where c = 'primary_email') then
      if array_length(v_matched_channels, 1) > 1 then
        v_strategy := 'email+phone'; v_confidence := 0.97;
      else
        v_strategy := 'email'; v_confidence := 0.95;
      end if;
    else
      v_strategy := 'phone'; v_confidence := 0.92;
    end if;
    return jsonb_build_object('decision', 'matched',
      'entity_table', 'people', 'entity_id', v_matched[1],
      'strategy', v_strategy, 'confidence', v_confidence,
      'matched_on', to_jsonb(v_matched_channels),
      'evidence', v_evidence, 'supplied_identifiers', v_supplied);
  end if;
  return jsonb_build_object('decision', 'new_person',
    'strategy', 'created', 'confidence', 1.0,
    'evidence', v_evidence, 'supplied_identifiers', v_supplied);
end $$;

-- Read-only preview matchers: the SAME validation + resolution decisions the
-- apply path uses — action + strategy + candidate COUNT only.
create or replace function import_match_customer(
  p_tenant uuid, p_source text, p_record jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_invalid jsonb;
  v_res jsonb;
begin
  v_invalid := import_validate_customer_row(p_tenant, p_source, p_record);
  if v_invalid is not null then
    return jsonb_build_object('action', 'invalid', 'strategy', 'invalid',
      'confidence', 0, 'reason', v_invalid ->> 'reason', 'candidates', 0);
  end if;
  v_res := import_resolve_customer(p_tenant, p_source, p_record);
  if v_res ->> 'decision' = 'linked' then
    return jsonb_build_object('action', 'matched', 'strategy', 'external_id',
      'confidence', 1.0, 'candidates', 1);
  elsif v_res ->> 'decision' = 'matched' then
    return jsonb_build_object('action', 'matched',
      'strategy', v_res ->> 'strategy',
      'confidence', (v_res ->> 'confidence')::numeric, 'candidates', 1);
  elsif v_res ->> 'decision' in ('ambiguous', 'conflicting') then
    return jsonb_build_object('action', 'probable', 'strategy', v_res ->> 'decision',
      'confidence', 0.5,
      'candidates', jsonb_array_length(v_res -> 'candidate_union'));
  end if;
  return jsonb_build_object('action', 'new', 'strategy', v_res ->> 'decision',
    'confidence', 1.0, 'candidates', 0);
end $$;

create or replace function import_match_site(
  p_tenant uuid, p_source text, p_record jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_invalid jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_cust text := nullif(trim(coalesce(p_record ->> 'customer_external_id', '')), '');
begin
  v_invalid := import_validate_site_row(p_tenant, p_source, p_record);
  if v_invalid is not null then
    return jsonb_build_object('action', 'invalid', 'strategy', 'invalid',
      'confidence', 0, 'reason', v_invalid ->> 'reason', 'candidates', 0);
  end if;
  if exists (select 1 from import_entity_links l
              where l.tenant_id = p_tenant and l.source_system = p_source
                and l.entity_kind = 'site' and l.external_id = v_ext) then
    return jsonb_build_object('action', 'matched', 'strategy', 'external_id',
      'confidence', 1.0, 'candidates', 1);
  end if;
  if not exists (select 1 from import_entity_links l
                  where l.tenant_id = p_tenant and l.source_system = p_source
                    and l.entity_kind = 'customer' and l.external_id = v_cust) then
    return jsonb_build_object('action', 'held', 'strategy', 'customer_not_imported',
      'confidence', 0, 'candidates', 0);
  end if;
  return jsonb_build_object('action', 'new', 'strategy', 'created',
    'confidence', 1.0, 'candidates', 0);
end $$;

-- Deterministic site resolution for a job: EXACTLY one qualifying site of the
-- SAME customer, by canonical postcode then canonical address equality —
-- several qualifiers → ambiguous (review), zero → honestly unlinked.
create or replace function import_resolve_job_site(
  p_tenant uuid, p_source text, p_cust_table text, p_cust_id uuid,
  p_postcode text, p_address text
) returns jsonb
language plpgsql
stable
as $$
declare
  v_pc text := import_normalize_postcode(p_postcode);
  v_addr text := import_normalize_address(p_address);
  v_ids uuid[];
  v_n int;
begin
  if p_cust_table is null or p_cust_id is null then
    return jsonb_build_object('outcome', 'none', 'reason', 'customer_unresolved');
  end if;
  select array_agg(s.id order by s.id) into v_ids from sites s
   where s.tenant_id = p_tenant and s.source_system = p_source
     and ((p_cust_table = 'people' and s.person_id = p_cust_id)
       or (p_cust_table = 'companies' and s.company_id = p_cust_id));
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    return jsonb_build_object('outcome', 'none', 'reason', 'customer_has_no_imported_sites');
  end if;
  if v_pc is not null then
    select array_agg(s.id order by s.id) into v_ids from sites s
     where s.id = any (v_ids)
       and import_normalize_postcode(s.postcode) = v_pc;
    v_n := coalesce(array_length(v_ids, 1), 0);
    if v_n = 0 then
      return jsonb_build_object('outcome', 'none', 'reason', 'no_site_at_postcode');
    end if;
    if v_n = 1 then
      return jsonb_build_object('outcome', 'resolved', 'site_id', v_ids[1],
        'strategy', 'postcode_unique');
    end if;
    -- several sites share the postcode → the address must decide, exactly
    select array_agg(s.id order by s.id) into v_ids from sites s
     where s.id = any (v_ids)
       and import_normalize_address(s.address_text) is not distinct from v_addr
       and v_addr is not null;
    v_n := coalesce(array_length(v_ids, 1), 0);
    if v_n = 1 then
      return jsonb_build_object('outcome', 'resolved', 'site_id', v_ids[1],
        'strategy', 'postcode_and_address');
    end if;
    if v_n > 1 then
      return jsonb_build_object('outcome', 'ambiguous',
        'candidate_site_ids', to_jsonb(v_ids[1:25]),
        'truncated', v_n > 25, 'reason', 'several_sites_share_postcode_and_address');
    end if;
    return jsonb_build_object('outcome', 'none', 'reason', 'address_does_not_match_any_postcode_site');
  end if;
  -- no postcode on the job: canonical address equality must be unique
  if v_addr is null then
    return jsonb_build_object('outcome', 'none', 'reason', 'no_address_evidence');
  end if;
  select array_agg(s.id order by s.id) into v_ids from sites s
   where s.id = any (v_ids)
     and import_normalize_address(s.address_text) = v_addr;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 1 then
    return jsonb_build_object('outcome', 'resolved', 'site_id', v_ids[1],
      'strategy', 'address_unique');
  end if;
  if v_n > 1 then
    return jsonb_build_object('outcome', 'ambiguous',
      'candidate_site_ids', to_jsonb(v_ids[1:25]),
      'truncated', v_n > 25, 'reason', 'several_sites_share_address');
  end if;
  return jsonb_build_object('outcome', 'none', 'reason', 'no_site_matches_address');
end $$;

create or replace function import_match_job(
  p_tenant uuid, p_source text, p_record jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_invalid jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_cust text := nullif(trim(coalesce(p_record ->> 'customer_external_id', '')), '');
  v_link import_entity_links%rowtype;
  v_site jsonb;
begin
  v_invalid := import_validate_job_row(p_tenant, p_source, p_record);
  if v_invalid is not null then
    return jsonb_build_object('action', 'invalid', 'strategy', 'invalid',
      'confidence', 0, 'reason', v_invalid ->> 'reason', 'candidates', 0);
  end if;
  if exists (select 1 from import_entity_links l
              where l.tenant_id = p_tenant and l.source_system = p_source
                and l.entity_kind = 'job' and l.external_id = v_ext) then
    return jsonb_build_object('action', 'matched', 'strategy', 'external_id',
      'confidence', 1.0, 'candidates', 1);
  end if;
  select * into v_link from import_entity_links l
   where l.tenant_id = p_tenant and l.source_system = p_source
     and l.entity_kind = 'customer' and l.external_id = v_cust;
  if not found then
    return jsonb_build_object('action', 'held', 'strategy', 'customer_not_imported',
      'confidence', 0, 'candidates', 0);
  end if;
  v_site := import_resolve_job_site(p_tenant, p_source,
    v_link.entity_table, v_link.entity_id,
    p_record ->> 'site_postcode', p_record ->> 'site_address_text');
  return jsonb_build_object('action', 'new', 'strategy', 'created',
    'confidence', 1.0, 'candidates', 0,
    'site_outcome', v_site ->> 'outcome');
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Shared per-row preamble checks (structural validation used by all three
-- row RPCs): tenant/import/actor binding, entity type, legal status, sealed
-- contract equality and row range. Raises on contract breach.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_row_preamble(
  p_tenant uuid, p_import uuid, p_actor uuid, p_row_number int,
  p_record jsonb, p_options jsonb, p_entity text
) returns data_imports
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_actor_tenant uuid;
  v_actor_role text;
  v_sealed jsonb;
begin
  if p_tenant is null or p_import is null or p_actor is null or p_row_number is null then
    raise exception 'tenant, import, actor and row number required' using errcode = '22023';
  end if;
  if p_record is null or jsonb_typeof(p_record) <> 'object'
     or p_options is null or jsonb_typeof(p_options) <> 'object' then
    raise exception 'record and options must be objects' using errcode = '22023';
  end if;
  select tenant_id, role into v_actor_tenant, v_actor_role
    from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  if coalesce(v_actor_role, '') not in ('owner', 'admin') then
    raise exception 'actor lacks import authority (owner/admin required)'
      using errcode = '42501';
  end if;
  select * into v_imp from data_imports
   where id = p_import and tenant_id = p_tenant;
  if not found then
    raise exception 'import not found for tenant' using errcode = 'P0002';
  end if;
  if v_imp.entity_type <> p_entity then
    raise exception 'import is not a % import', p_entity using errcode = '22023';
  end if;
  if v_imp.status not in ('previewed', 'importing', 'failed', 'needs_review') then
    raise exception 'import status % does not allow row apply', v_imp.status
      using errcode = '22023';
  end if;
  if p_row_number < 2 or p_row_number > v_imp.row_count + 1 then
    raise exception 'row number is outside the sealed import' using errcode = '22023';
  end if;
  v_sealed := v_imp.preview -> 'sealed';
  if v_sealed is null or jsonb_typeof(v_sealed) is distinct from 'object'
     or jsonb_typeof(v_sealed -> 'import_options') is distinct from 'object' then
    raise exception 'import has no sealed contract — a new preview is required'
      using errcode = '22023';
  end if;
  if p_options is distinct from v_sealed -> 'import_options' then
    raise exception 'options do not match the sealed import contract'
      using errcode = '22023';
  end if;
  return v_imp;
end $$;

-- Prior-outcome check under the per-(import,row) advisory lock. Returns the
-- authoritative short-circuit response, or NULL when the row must process
-- (setting p_attempt for retries of failed/held rows).
create or replace function import_row_prior(
  p_tenant uuid, p_import uuid, p_row_number int, out o_short jsonb, out o_attempt int
)
language plpgsql
as $$
declare
  v_prior import_row_results%rowtype;
  v_prov import_row_provenance%rowtype;
begin
  o_attempt := 1;
  o_short := null;
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|import|' || p_import::text || '|' || p_row_number, 42));
  select * into v_prior from import_row_results r
   where r.tenant_id = p_tenant and r.import_id = p_import
     and r.row_number = p_row_number;
  if found then
    if v_prior.outcome in ('created', 'linked', 'updated', 'conflict', 'invalid', 'skipped') then
      o_short := jsonb_build_object('action', 'already_applied',
                                    'prior_outcome', v_prior.outcome);
      return;
    end if;
    o_attempt := v_prior.attempt + 1;
  end if;
  -- defence in depth: provenance for this (import,row) with a missing/stuck
  -- ledger row is REPAIRED deterministically, mirroring the marketing ledger
  select pr.* into v_prov from import_row_provenance pr
   where pr.tenant_id = p_tenant and pr.import_id = p_import
     and pr.source_row_number = p_row_number
   order by pr.imported_at limit 1;
  if found then
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason,
       entity_table, entity_id, conflict_id, attempt)
    values (p_tenant, p_import, p_row_number,
            case v_prov.action
              when 'created' then 'created'
              when 'linked' then 'linked'
              when 'updated' then 'updated'
              else 'conflict' end,
            'ledger reconstructed from provenance',
            case when v_prov.entity_table in ('people', 'companies', 'sites', 'jobs')
                 then v_prov.entity_table end,
            case when v_prov.entity_table in ('people', 'companies', 'sites', 'jobs')
                 then v_prov.entity_id end,
            case when v_prov.entity_table = 'import_conflicts'
                 then v_prov.entity_id end,
            o_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          entity_table = excluded.entity_table, entity_id = excluded.entity_id,
          conflict_id = excluded.conflict_id, attempt = excluded.attempt;
    o_short := jsonb_build_object('action', 'already_applied',
      'prior_outcome', case v_prov.action
        when 'created' then 'created'
        when 'linked' then 'linked'
        when 'updated' then 'updated'
        else 'conflict' end,
      'repaired', true);
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- import_customer_row — atomic per-row CUSTOMER apply.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_customer_row(
  p_tenant uuid, p_import uuid, p_actor uuid, p_row_number int,
  p_record jsonb, p_options jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_source text;
  v_short jsonb;
  v_attempt int;
  v_invalid jsonb;
  v_res jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_kind text := nullif(trim(coalesce(p_record ->> 'record_kind', '')), '');
  v_email text := marketing_normalize_endpoint('email', p_record ->> 'primary_email');
  v_phone text := import_normalize_phone_uk(p_record ->> 'primary_phone');
  v_phone2 text := import_normalize_phone_uk(p_record ->> 'secondary_phone');
  v_lock_keys text[] := array[]::text[];
  v_lk text;
  v_display text;
  v_active boolean := coalesce((p_record ->> 'active')::boolean, true);
  v_meta jsonb;
  v_import_meta jsonb;
  v_conflict_id uuid;
  v_person uuid;
  v_company uuid;
  v_p people%rowtype;
  v_writable jsonb := '{}'::jsonb;
  v_field_conflicts text[] := array[]::text[];
  v_entity_table text;
  v_entity_id uuid;
  v_outcome text;
  v_strategy text;
  v_confidence numeric;
begin
  v_imp := import_row_preamble(p_tenant, p_import, p_actor, p_row_number,
                               p_record, p_options, 'customers');
  v_source := v_imp.preview -> 'sealed' ->> 'provenance_source';
  select o_short, o_attempt into v_short, v_attempt
    from import_row_prior(p_tenant, p_import, p_row_number);
  if v_short is not null then return v_short; end if;

  v_invalid := import_validate_customer_row(p_tenant, v_source, p_record);
  if v_invalid is not null then
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'invalid',
            v_invalid ->> 'reason',
            coalesce((select array_agg(e) from jsonb_array_elements_text(
                        v_invalid -> 'fields') e), '{}'::text[]),
            v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'invalid', 'reason', v_invalid ->> 'reason');
  end if;

  -- identity locks: SAME key format as the marketing manual-create/import
  -- paths (customers share the People identity space), deterministic order
  if v_email is not null then v_lock_keys := array_append(v_lock_keys, 'email|' || v_email); end if;
  if v_phone is not null then v_lock_keys := array_append(v_lock_keys, 'phone|' || v_phone); end if;
  if v_phone2 is not null then v_lock_keys := array_append(v_lock_keys, 'phone|' || v_phone2); end if;
  v_lock_keys := array_append(v_lock_keys, 'ext|' || v_source || '|' || v_ext);
  for v_lk in select distinct u from unnest(v_lock_keys) t(u) order by u loop
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|' || v_lk, 42));
  end loop;

  v_res := import_resolve_customer(p_tenant, v_source, p_record);

  v_display := nullif(trim(coalesce(p_record ->> 'display_name', '')), '');
  if v_display is null then
    v_display := nullif(trim(concat_ws(' ',
      nullif(trim(coalesce(p_record ->> 'first_name', '')), ''),
      nullif(trim(coalesce(p_record ->> 'last_name', '')), ''))), '');
  end if;
  v_import_meta := jsonb_strip_nulls(jsonb_build_object(
    'source', v_source,
    'external_id', v_ext,
    'record_kind', v_kind,
    'active', v_active,
    'title', nullif(trim(coalesce(p_record ->> 'title', '')), ''),
    'company_name', nullif(trim(coalesce(p_record ->> 'company_name', '')), '')));
  v_meta := jsonb_build_object('import', v_import_meta);
  if p_record ->> 'metadata_json' is not null then
    v_meta := v_meta || jsonb_build_object('source_payload',
      (p_record ->> 'metadata_json')::jsonb);
  end if;

  -- ── ambiguous / conflicting channel evidence: ONE durable blocking
  --    conflict, ZERO canonical mutation ──
  if v_res ->> 'decision' in ('ambiguous', 'conflicting') then
    insert into import_conflicts
      (tenant_id, import_id, source_system, entity_kind, external_id,
       conflict_type, blocking, identifiers, candidates, truncated, detail)
    values (p_tenant, p_import, v_source, 'customer', v_ext,
            case when v_res ->> 'decision' = 'ambiguous'
                 then 'ambiguous_channel' else 'channel_disagreement' end,
            true,
            coalesce(v_res -> 'evidence', '[]'::jsonb),
            coalesce((select jsonb_agg(jsonb_build_object(
                        'entity_table', 'people', 'entity_id', c))
                      from jsonb_array_elements_text(v_res -> 'candidate_union') c),
                     '[]'::jsonb),
            coalesce((v_res ->> 'truncated')::boolean, false),
            jsonb_build_object('row_number', p_row_number))
    on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
      where status = 'open'
    do update set identifiers = excluded.identifiers,
                  candidates = excluded.candidates,
                  truncated = excluded.truncated,
                  import_id = excluded.import_id
    returning id into v_conflict_id;
    insert into import_row_provenance
      (tenant_id, import_id, entity_table, entity_id, source_system,
       source_row_number, external_id, imported_fields, match_strategy,
       confidence, action, conflicts)
    values (p_tenant, p_import, 'import_conflicts', v_conflict_id, v_source,
            p_row_number, v_ext,
            array(select jsonb_object_keys(p_record)),
            v_res ->> 'decision', 0.5, 'conflict',
            coalesce(v_res -> 'evidence', '[]'::jsonb));
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, conflict_id, attempt)
    values (p_tenant, p_import, p_row_number, 'conflict',
            case when v_res ->> 'decision' = 'ambiguous'
              then 'a contact channel matches several existing people'
              else 'email and phone point to different existing people' end,
            v_conflict_id, v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          conflict_id = excluded.conflict_id, attempt = excluded.attempt;
    return jsonb_build_object('action', 'conflict', 'conflict_id', v_conflict_id);
  end if;

  -- ── already linked (idempotent rerun of the same source row) ──
  if v_res ->> 'decision' = 'linked' then
    v_entity_table := v_res ->> 'entity_table';
    v_entity_id := (v_res ->> 'entity_id')::uuid;
    v_outcome := 'linked';
    v_strategy := 'external_id';
    v_confidence := 1.0;

  -- ── exactly ONE existing person on strong channel evidence: link, fill
  --    blanks only, never overwrite, never touch verified/created_source ──
  elsif v_res ->> 'decision' = 'matched' then
    v_person := (v_res ->> 'entity_id')::uuid;
    select * into v_p from people where id = v_person and tenant_id = p_tenant
      for update;
    if not found then
      raise exception 'matched person vanished — retry' using errcode = '40001';
    end if;
    v_writable := '{}'::jsonb;
    if v_p.display_name is null and v_display is not null then
      v_writable := v_writable || jsonb_build_object('display_name', v_display); end if;
    if v_p.first_name is null and nullif(trim(coalesce(p_record ->> 'first_name', '')), '') is not null then
      v_writable := v_writable || jsonb_build_object('first_name', trim(p_record ->> 'first_name')); end if;
    if v_p.last_name is null and nullif(trim(coalesce(p_record ->> 'last_name', '')), '') is not null then
      v_writable := v_writable || jsonb_build_object('last_name', trim(p_record ->> 'last_name')); end if;
    if v_p.primary_email is null and p_record ->> 'primary_email' is not null then
      v_writable := v_writable || jsonb_build_object('primary_email', p_record ->> 'primary_email'); end if;
    if v_p.primary_phone is null and p_record ->> 'primary_phone' is not null then
      v_writable := v_writable || jsonb_build_object('primary_phone', p_record ->> 'primary_phone'); end if;
    if v_p.address_text is null and nullif(trim(coalesce(p_record ->> 'address_text', '')), '') is not null then
      v_writable := v_writable || jsonb_build_object('address_text', trim(p_record ->> 'address_text')); end if;
    if v_p.postcode is null and p_record ->> 'postcode' is not null then
      v_writable := v_writable || jsonb_build_object('postcode', p_record ->> 'postcode'); end if;
    -- differing non-blank values are recorded, never overwritten
    if v_p.display_name is not null and v_display is not null
       and v_p.display_name <> v_display then
      v_field_conflicts := array_append(v_field_conflicts, 'display_name'); end if;
    if v_p.primary_email is not null and p_record ->> 'primary_email' is not null
       and marketing_normalize_endpoint('email', v_p.primary_email) is distinct from v_email then
      v_field_conflicts := array_append(v_field_conflicts, 'primary_email'); end if;
    if v_p.primary_phone is not null and p_record ->> 'primary_phone' is not null
       and import_normalize_phone_uk(v_p.primary_phone) is distinct from v_phone then
      v_field_conflicts := array_append(v_field_conflicts, 'primary_phone'); end if;
    if v_p.postcode is not null and p_record ->> 'postcode' is not null
       and import_normalize_postcode(v_p.postcode) is distinct from import_normalize_postcode(p_record ->> 'postcode') then
      v_field_conflicts := array_append(v_field_conflicts, 'postcode'); end if;
    update people set
      display_name = coalesce(v_writable ->> 'display_name', display_name),
      first_name = coalesce(v_writable ->> 'first_name', first_name),
      last_name = coalesce(v_writable ->> 'last_name', last_name),
      primary_email = coalesce(v_writable ->> 'primary_email', primary_email),
      primary_phone = coalesce(v_writable ->> 'primary_phone', primary_phone),
      address_text = coalesce(v_writable ->> 'address_text', address_text),
      postcode = coalesce(v_writable ->> 'postcode', postcode),
      metadata = coalesce(metadata, '{}'::jsonb) || v_meta
    where id = v_person;
    v_entity_table := 'people';
    v_entity_id := v_person;
    v_outcome := 'linked';
    v_strategy := v_res ->> 'strategy';
    v_confidence := (v_res ->> 'confidence')::numeric;

  -- ── new company customer: canonical company, NEVER a named individual ──
  elsif v_res ->> 'decision' = 'new_company' then
    insert into companies (tenant_id, name, phone, address_text, postcode,
                           verified, created_source, metadata)
    values (p_tenant, trim(p_record ->> 'company_name'),
            p_record ->> 'primary_phone',
            nullif(trim(coalesce(p_record ->> 'address_text', '')), ''),
            p_record ->> 'postcode',
            false, 'import:' || v_source,
            v_meta || jsonb_build_object('import',
              v_import_meta || jsonb_strip_nulls(jsonb_build_object(
                'primary_email', p_record ->> 'primary_email'))))
    returning id into v_company;
    -- channels matching existing interaction-created PEOPLE are review
    -- evidence beside the applied row — never an automatic association
    if jsonb_array_length(coalesce(v_res -> 'person_overlap', '[]'::jsonb)) > 0 then
      insert into import_conflicts
        (tenant_id, import_id, source_system, entity_kind, external_id,
         conflict_type, blocking, identifiers, candidates, truncated, detail)
      values (p_tenant, p_import, v_source, 'customer', v_ext,
              'company_person_overlap', false,
              coalesce(v_res -> 'evidence', '[]'::jsonb),
              coalesce((select jsonb_agg(jsonb_build_object(
                          'entity_table', 'people', 'entity_id', c))
                        from jsonb_array_elements_text(v_res -> 'person_overlap') c),
                       '[]'::jsonb),
              coalesce((v_res ->> 'truncated')::boolean, false),
              jsonb_build_object('row_number', p_row_number,
                                 'company_id', v_company))
      on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
        where status = 'open'
      do update set identifiers = excluded.identifiers,
                    candidates = excluded.candidates,
                    truncated = excluded.truncated,
                    import_id = excluded.import_id,
                    detail = excluded.detail
      returning id into v_conflict_id;
    end if;
    v_entity_table := 'companies';
    v_entity_id := v_company;
    v_outcome := 'created';
    v_strategy := 'created';
    v_confidence := 1.0;

  -- ── new person customer ──
  else
    insert into people (tenant_id, display_name, first_name, last_name,
                        primary_email, primary_phone, address_text, postcode,
                        verified, created_source, metadata)
    values (p_tenant, v_display,
            nullif(trim(coalesce(p_record ->> 'first_name', '')), ''),
            nullif(trim(coalesce(p_record ->> 'last_name', '')), ''),
            p_record ->> 'primary_email',
            p_record ->> 'primary_phone',
            nullif(trim(coalesce(p_record ->> 'address_text', '')), ''),
            p_record ->> 'postcode',
            false, 'import:customers:' || v_source, v_meta)
    returning id into v_person;
    v_entity_table := 'people';
    v_entity_id := v_person;
    v_outcome := 'created';
    v_strategy := 'created';
    v_confidence := 1.0;
  end if;

  -- contact points for PERSON customers: unverified import endpoints. This is
  -- deliberately the ONLY marketing-adjacent write — no preference, no
  -- suppression, no permission record: eligibility stays 'unknown'.
  if v_entity_table = 'people' then
    insert into contact_points
      (tenant_id, person_id, channel, value, normalized_value, is_primary,
       verification_state, source, last_observed_at)
    select p_tenant, v_entity_id, x.channel, x.value, x.norm,
           not exists (select 1 from contact_points cpp
                        where cpp.tenant_id = p_tenant
                          and cpp.person_id = v_entity_id
                          and cpp.channel = x.channel and cpp.is_primary),
           'unverified', 'import', now()
      from (values
        ('email', p_record ->> 'primary_email',
         marketing_normalize_endpoint('email', p_record ->> 'primary_email')),
        ('phone', p_record ->> 'primary_phone',
         marketing_normalize_endpoint('phone', p_record ->> 'primary_phone')),
        ('phone', p_record ->> 'secondary_phone',
         marketing_normalize_endpoint('phone', p_record ->> 'secondary_phone'))
      ) as x (channel, value, norm)
     where x.norm is not null
    on conflict (tenant_id, person_id, channel, normalized_value) do update
      set last_observed_at = now();
  end if;

  -- authoritative external-identity link (idempotent for ever after)
  if v_res ->> 'decision' <> 'linked' then
    insert into import_entity_links
      (tenant_id, source_system, entity_kind, external_id, entity_table,
       entity_id, link_strategy, confidence, evidence, import_id)
    values (p_tenant, v_source, 'customer', v_ext, v_entity_table, v_entity_id,
            case when v_outcome = 'created' then 'created' else v_strategy end,
            v_confidence,
            jsonb_build_object('matched_on', coalesce(v_res -> 'matched_on', '[]'::jsonb)),
            p_import)
    on conflict (tenant_id, source_system, entity_kind, external_id) do nothing;
  end if;

  insert into import_row_provenance
    (tenant_id, import_id, entity_table, entity_id, source_system,
     source_row_number, external_id, imported_fields, match_strategy,
     confidence, action, conflicts)
  values (p_tenant, p_import, v_entity_table, v_entity_id, v_source,
          p_row_number, v_ext,
          array(select jsonb_object_keys(p_record)),
          v_strategy, v_confidence,
          case when v_outcome = 'created' then 'created' else 'linked' end,
          coalesce((select jsonb_agg(jsonb_build_object('field', f))
                    from unnest(v_field_conflicts) f), '[]'::jsonb));
  insert into import_row_results
    (tenant_id, import_id, row_number, outcome, reason, fields,
     entity_table, entity_id, conflict_id, attempt)
  values (p_tenant, p_import, p_row_number, v_outcome,
          case when array_length(v_field_conflicts, 1) > 0
            then 'linked with differing fields recorded (never overwritten)'
            else null end,
          coalesce(v_field_conflicts, '{}'::text[]),
          v_entity_table, v_entity_id, v_conflict_id, v_attempt)
  on conflict (tenant_id, import_id, row_number) do update
    set outcome = excluded.outcome, reason = excluded.reason,
        fields = excluded.fields, entity_table = excluded.entity_table,
        entity_id = excluded.entity_id, conflict_id = excluded.conflict_id,
        attempt = excluded.attempt;
  return jsonb_build_object('action', v_outcome,
    'entity_table', v_entity_table, 'entity_id', v_entity_id,
    'strategy', v_strategy, 'field_conflicts', to_jsonb(v_field_conflicts));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- import_site_row — atomic per-row SITE apply. Sites REQUIRE their imported
-- customer: a missing or conflicted customer HOLDS the row (retryable), it is
-- never guessed and never silently reported as imported.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_site_row(
  p_tenant uuid, p_import uuid, p_actor uuid, p_row_number int,
  p_record jsonb, p_options jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_source text;
  v_short jsonb;
  v_attempt int;
  v_invalid jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_cust_ext text := nullif(trim(coalesce(p_record ->> 'customer_external_id', '')), '');
  v_link import_entity_links%rowtype;
  v_site sites%rowtype;
  v_site_id uuid;
  v_outcome text;
  v_active boolean := coalesce((p_record ->> 'active')::boolean, true);
  v_meta jsonb;
  v_hold_reason text;
begin
  v_imp := import_row_preamble(p_tenant, p_import, p_actor, p_row_number,
                               p_record, p_options, 'sites');
  v_source := v_imp.preview -> 'sealed' ->> 'provenance_source';
  select o_short, o_attempt into v_short, v_attempt
    from import_row_prior(p_tenant, p_import, p_row_number);
  if v_short is not null then return v_short; end if;

  v_invalid := import_validate_site_row(p_tenant, v_source, p_record);
  if v_invalid is not null then
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'invalid',
            v_invalid ->> 'reason',
            coalesce((select array_agg(e) from jsonb_array_elements_text(
                        v_invalid -> 'fields') e), '{}'::text[]),
            v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'invalid', 'reason', v_invalid ->> 'reason');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|ext|' || v_source || '|site|' || v_ext, 42));

  -- the customer relationship is REQUIRED and never guessed
  select * into v_link from import_entity_links l
   where l.tenant_id = p_tenant and l.source_system = v_source
     and l.entity_kind = 'customer' and l.external_id = v_cust_ext;
  if not found then
    if exists (select 1 from import_conflicts c
                where c.tenant_id = p_tenant and c.source_system = v_source
                  and c.entity_kind = 'customer' and c.external_id = v_cust_ext
                  and c.blocking and c.status = 'open') then
      v_hold_reason := 'customer_conflict_open';
    else
      v_hold_reason := 'customer_not_imported';
    end if;
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'held', v_hold_reason,
            array['customer_external_id'], v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'held', 'reason', v_hold_reason);
  end if;

  v_meta := jsonb_build_object('import', jsonb_strip_nulls(jsonb_build_object(
    'source', v_source, 'external_id', v_ext,
    'customer_external_id', v_cust_ext, 'active', v_active,
    'primary_email', p_record ->> 'primary_email',
    'primary_phone', p_record ->> 'primary_phone')));
  if p_record ->> 'metadata_json' is not null then
    v_meta := v_meta || jsonb_build_object('source_payload',
      (p_record ->> 'metadata_json')::jsonb);
  end if;

  select * into v_site from sites s
   where s.tenant_id = p_tenant and s.source_system = v_source
     and s.external_id = v_ext;
  if found then
    update sites set
      label = coalesce(sites.label, nullif(trim(coalesce(p_record ->> 'label', '')), '')),
      address_text = coalesce(sites.address_text, nullif(trim(coalesce(p_record ->> 'address_text', '')), '')),
      postcode = coalesce(sites.postcode, p_record ->> 'postcode'),
      metadata = coalesce(sites.metadata, '{}'::jsonb) || v_meta
    where id = v_site.id;
    v_site_id := v_site.id;
    v_outcome := 'linked';
  else
    insert into sites (tenant_id, source_system, external_id, person_id,
                       company_id, label, address_text, postcode,
                       created_source, verified, metadata)
    values (p_tenant, v_source, v_ext,
            case when v_link.entity_table = 'people' then v_link.entity_id end,
            case when v_link.entity_table = 'companies' then v_link.entity_id end,
            nullif(trim(coalesce(p_record ->> 'label', '')), ''),
            nullif(trim(coalesce(p_record ->> 'address_text', '')), ''),
            p_record ->> 'postcode',
            'import:' || v_source, false, v_meta)
    returning id into v_site_id;
    v_outcome := 'created';
  end if;

  insert into import_entity_links
    (tenant_id, source_system, entity_kind, external_id, entity_table,
     entity_id, link_strategy, confidence, evidence, import_id)
  values (p_tenant, v_source, 'site', v_ext, 'sites', v_site_id,
          case when v_outcome = 'created' then 'created' else 'external_id' end,
          1.0, jsonb_build_object('customer_external_id', v_cust_ext), p_import)
  on conflict (tenant_id, source_system, entity_kind, external_id) do nothing;

  insert into import_row_provenance
    (tenant_id, import_id, entity_table, entity_id, source_system,
     source_row_number, external_id, imported_fields, match_strategy,
     confidence, action, conflicts)
  values (p_tenant, p_import, 'sites', v_site_id, v_source, p_row_number,
          v_ext, array(select jsonb_object_keys(p_record)),
          case when v_outcome = 'created' then 'created' else 'external_id' end,
          1.0,
          case when v_outcome = 'created' then 'created' else 'linked' end,
          '[]'::jsonb);
  insert into import_row_results
    (tenant_id, import_id, row_number, outcome, entity_table, entity_id, attempt)
  values (p_tenant, p_import, p_row_number, v_outcome, 'sites', v_site_id, v_attempt)
  on conflict (tenant_id, import_id, row_number) do update
    set outcome = excluded.outcome, reason = null, fields = '{}'::text[],
        entity_table = excluded.entity_table, entity_id = excluded.entity_id,
        attempt = excluded.attempt;
  return jsonb_build_object('action', v_outcome, 'entity_table', 'sites',
                            'entity_id', v_site_id);
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- import_job_row — atomic per-row JOB apply. Jobs REQUIRE their imported
-- customer (person XOR company). Sites link ONLY on deterministic evidence:
-- ambiguity is a durable reviewable conflict beside the created job, absence
-- is an honestly-unlinked job with the reason recorded.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_job_row(
  p_tenant uuid, p_import uuid, p_actor uuid, p_row_number int,
  p_record jsonb, p_options jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_source text;
  v_short jsonb;
  v_attempt int;
  v_invalid jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_cust_ext text := nullif(trim(coalesce(p_record ->> 'customer_external_id', '')), '');
  v_link import_entity_links%rowtype;
  v_job jobs%rowtype;
  v_job_id uuid;
  v_outcome text;
  v_status text := trim(coalesce(p_record ->> 'status', ''));
  v_active boolean := coalesce((p_record ->> 'active')::boolean, true);
  v_site jsonb;
  v_site_id uuid;
  v_conflict_id uuid;
  v_meta jsonb;
  v_hold_reason text;
  v_jn text;
begin
  v_imp := import_row_preamble(p_tenant, p_import, p_actor, p_row_number,
                               p_record, p_options, 'jobs');
  v_source := v_imp.preview -> 'sealed' ->> 'provenance_source';
  select o_short, o_attempt into v_short, v_attempt
    from import_row_prior(p_tenant, p_import, p_row_number);
  if v_short is not null then return v_short; end if;

  v_invalid := import_validate_job_row(p_tenant, v_source, p_record);
  if v_invalid is not null then
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'invalid',
            v_invalid ->> 'reason',
            coalesce((select array_agg(e) from jsonb_array_elements_text(
                        v_invalid -> 'fields') e), '{}'::text[]),
            v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'invalid', 'reason', v_invalid ->> 'reason');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|ext|' || v_source || '|job|' || v_ext, 42));

  -- the customer relationship is REQUIRED — an orphan job is held, never
  -- created against nothing and never cross-tenant
  select * into v_link from import_entity_links l
   where l.tenant_id = p_tenant and l.source_system = v_source
     and l.entity_kind = 'customer' and l.external_id = v_cust_ext;
  if not found then
    if exists (select 1 from import_conflicts c
                where c.tenant_id = p_tenant and c.source_system = v_source
                  and c.entity_kind = 'customer' and c.external_id = v_cust_ext
                  and c.blocking and c.status = 'open') then
      v_hold_reason := 'customer_conflict_open';
    else
      v_hold_reason := 'customer_not_imported';
    end if;
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'held', v_hold_reason,
            array['customer_external_id'], v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'held', 'reason', v_hold_reason);
  end if;

  -- deterministic site resolution (never a guess)
  v_site := import_resolve_job_site(p_tenant, v_source,
    v_link.entity_table, v_link.entity_id,
    p_record ->> 'site_postcode', p_record ->> 'site_address_text');
  if v_site ->> 'outcome' = 'resolved' then
    v_site_id := (v_site ->> 'site_id')::uuid;
  elsif v_site ->> 'outcome' = 'ambiguous' then
    insert into import_conflicts
      (tenant_id, import_id, source_system, entity_kind, external_id,
       conflict_type, blocking, identifiers, candidates, truncated, detail)
    values (p_tenant, p_import, v_source, 'job', v_ext,
            'site_ambiguous', false,
            jsonb_build_array(jsonb_build_object(
              'channel', 'address',
              'label', 'site_address',
              'value', import_normalize_address(p_record ->> 'site_address_text'),
              'postcode', import_normalize_postcode(p_record ->> 'site_postcode'))),
            coalesce((select jsonb_agg(jsonb_build_object(
                        'entity_table', 'sites', 'entity_id', c))
                      from jsonb_array_elements_text(v_site -> 'candidate_site_ids') c),
                     '[]'::jsonb),
            coalesce((v_site ->> 'truncated')::boolean, false),
            jsonb_build_object('row_number', p_row_number,
                               'reason', v_site ->> 'reason'))
    on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
      where status = 'open'
    do update set identifiers = excluded.identifiers,
                  candidates = excluded.candidates,
                  truncated = excluded.truncated,
                  import_id = excluded.import_id,
                  detail = excluded.detail
    returning id into v_conflict_id;
  end if;

  v_meta := jsonb_build_object('import', jsonb_strip_nulls(jsonb_build_object(
    'source', v_source, 'external_id', v_ext,
    'customer_external_id', v_cust_ext, 'active', v_active,
    'engineer_name', nullif(trim(coalesce(p_record ->> 'engineer', '')), ''),
    'quoted_value_pennies', (p_record -> 'quoted_value_pennies'),
    'site_resolution', jsonb_build_object(
      'outcome', v_site ->> 'outcome',
      'strategy', v_site ->> 'strategy',
      'reason', v_site ->> 'reason'),
    'site_address_text', nullif(trim(coalesce(p_record ->> 'site_address_text', '')), ''),
    'site_postcode', p_record ->> 'site_postcode')));
  if p_record ->> 'metadata_json' is not null then
    v_meta := v_meta || jsonb_build_object('source_payload',
      (p_record ->> 'metadata_json')::jsonb);
  end if;

  select * into v_job from jobs j
   where j.tenant_id = p_tenant and j.source_system = v_source
     and j.external_id = v_ext;
  if found then
    update jobs set
      site_id = coalesce(jobs.site_id, v_site_id),
      metadata = coalesce(jobs.metadata, '{}'::jsonb) || v_meta
    where id = v_job.id;
    v_job_id := v_job.id;
    v_outcome := 'linked';
  else
    insert into jobs (tenant_id, source_system, external_id, job_number,
                      customer_person_id, customer_company_id, site_id,
                      title, description, status, active,
                      value_pennies, created_date, completed_date,
                      created_source, verified, metadata)
    values (p_tenant, v_source, v_ext,
            nullif(trim(coalesce(p_record ->> 'job_number', '')), ''),
            case when v_link.entity_table = 'people' then v_link.entity_id end,
            case when v_link.entity_table = 'companies' then v_link.entity_id end,
            v_site_id,
            nullif(trim(coalesce(p_record ->> 'title', '')), ''),
            nullif(trim(coalesce(p_record ->> 'description', '')), ''),
            v_status, v_active,
            (p_record ->> 'value_pennies')::bigint,
            (nullif(trim(coalesce(p_record ->> 'created_date', '')), ''))::timestamptz,
            (nullif(trim(coalesce(p_record ->> 'completed_date', '')), ''))::timestamptz,
            'import:' || v_source, false, v_meta)
    returning id into v_job_id;
    v_outcome := 'created';
  end if;

  v_jn := regexp_replace(coalesce(p_record ->> 'job_number', ''), '[^0-9]', '', 'g');
  if v_jn <> '' then
    insert into job_number_aliases (tenant_id, job_id, alias, normalized, source)
    values (p_tenant, v_job_id, p_record ->> 'job_number', v_jn, 'import')
    on conflict (tenant_id, normalized) do nothing;
  end if;

  insert into import_entity_links
    (tenant_id, source_system, entity_kind, external_id, entity_table,
     entity_id, link_strategy, confidence, evidence, import_id)
  values (p_tenant, v_source, 'job', v_ext, 'jobs', v_job_id,
          case when v_outcome = 'created' then 'created' else 'external_id' end,
          1.0, jsonb_build_object('customer_external_id', v_cust_ext), p_import)
  on conflict (tenant_id, source_system, entity_kind, external_id) do nothing;

  insert into import_row_provenance
    (tenant_id, import_id, entity_table, entity_id, source_system,
     source_row_number, external_id, imported_fields, match_strategy,
     confidence, action, conflicts)
  values (p_tenant, p_import, 'jobs', v_job_id, v_source, p_row_number, v_ext,
          array(select jsonb_object_keys(p_record)),
          case when v_outcome = 'created' then 'created' else 'external_id' end,
          1.0,
          case when v_outcome = 'created' then 'created' else 'linked' end,
          jsonb_build_array(jsonb_build_object('site_resolution', v_site))
    );
  insert into import_row_results
    (tenant_id, import_id, row_number, outcome, reason, fields,
     entity_table, entity_id, conflict_id, attempt)
  values (p_tenant, p_import, p_row_number, v_outcome,
          'site: ' || coalesce(v_site ->> 'strategy', v_site ->> 'reason',
                               v_site ->> 'outcome'),
          case when v_site_id is not null then array['site_linked']
               when v_site ->> 'outcome' = 'ambiguous' then array['site_ambiguous']
               else array['site_unlinked'] end,
          'jobs', v_job_id, v_conflict_id, v_attempt)
  on conflict (tenant_id, import_id, row_number) do update
    set outcome = excluded.outcome, reason = excluded.reason,
        fields = excluded.fields, entity_table = excluded.entity_table,
        entity_id = excluded.entity_id, conflict_id = excluded.conflict_id,
        attempt = excluded.attempt;
  return jsonb_build_object('action', v_outcome, 'entity_table', 'jobs',
    'entity_id', v_job_id, 'site_outcome', v_site ->> 'outcome');
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- import_row_outcome — the governed recorder for edge-side invalid/failed
-- outcomes (mapping failures, transient RPC errors). Same per-row lock;
-- NEVER downgrades a terminal outcome; failed/held retries advance attempt.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_row_outcome(
  p_tenant uuid, p_import uuid, p_row_number int,
  p_outcome text, p_reason text, p_fields text[] default '{}'::text[]
) returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_prior import_row_results%rowtype;
  v_attempt int := 1;
begin
  if p_tenant is null or p_import is null or p_row_number is null then
    raise exception 'tenant, import and row number required' using errcode = '22023';
  end if;
  if p_outcome not in ('invalid', 'failed') then
    raise exception 'recorder outcome must be invalid or failed' using errcode = '22023';
  end if;
  select * into v_imp from data_imports
   where id = p_import and tenant_id = p_tenant;
  if not found then
    raise exception 'import not found for tenant' using errcode = 'P0002';
  end if;
  if p_row_number < 2 or p_row_number > v_imp.row_count + 1 then
    raise exception 'row number is outside the sealed import' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|import|' || p_import::text || '|' || p_row_number, 42));
  select * into v_prior from import_row_results r
   where r.tenant_id = p_tenant and r.import_id = p_import
     and r.row_number = p_row_number;
  if found then
    if v_prior.outcome not in ('failed', 'held') then
      return jsonb_build_object('already', true, 'outcome', v_prior.outcome);
    end if;
    v_attempt := v_prior.attempt + 1;
  end if;
  insert into import_row_results
    (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
  values (p_tenant, p_import, p_row_number, p_outcome, p_reason,
          coalesce(p_fields, '{}'::text[]), v_attempt)
  on conflict (tenant_id, import_id, row_number) do update
    set outcome = excluded.outcome, reason = excluded.reason,
        fields = excluded.fields, attempt = excluded.attempt,
        entity_table = null, entity_id = null, conflict_id = null;
  return jsonb_build_object('already', false, 'outcome', p_outcome);
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- import_run_finalize — concurrency-safe finalisation from DURABLE outcomes
-- under the locked import row. HONEST statuses:
--   failed rows        → 'failed'      (retry the import)
--   unprocessed rows   → 'importing'   (resume)
--   held/conflict rows → 'needs_review' (NEVER 'completed' with unresolved
--                                        relationships or identity conflicts)
--   everything terminal→ 'completed'
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_run_finalize(p_tenant uuid, p_import uuid)
returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_created int; v_linked int; v_updated int; v_conflict int; v_held int;
  v_invalid int; v_skipped int; v_failed int; v_counted int;
  v_status text;
begin
  if p_tenant is null or p_import is null then
    raise exception 'tenant and import required' using errcode = '22023';
  end if;
  select * into v_imp from data_imports
   where id = p_import and tenant_id = p_tenant
   for update;
  if not found then
    raise exception 'import not found for tenant' using errcode = 'P0002';
  end if;
  select
    count(*) filter (where outcome = 'created'),
    count(*) filter (where outcome = 'linked'),
    count(*) filter (where outcome = 'updated'),
    count(*) filter (where outcome = 'conflict'),
    count(*) filter (where outcome = 'held'),
    count(*) filter (where outcome = 'invalid'),
    count(*) filter (where outcome = 'skipped'),
    count(*) filter (where outcome = 'failed'),
    count(*)
  into v_created, v_linked, v_updated, v_conflict, v_held, v_invalid,
       v_skipped, v_failed, v_counted
  from import_row_results r
  where r.tenant_id = p_tenant and r.import_id = p_import;

  if v_failed > 0 then
    v_status := 'failed';
  elsif v_counted < v_imp.row_count then
    v_status := 'importing';
  elsif v_held > 0 or v_conflict > 0 then
    v_status := 'needs_review';
  else
    v_status := 'completed';
  end if;

  update data_imports set
    status = v_status,
    created_records = v_created,
    updated_records = v_linked + v_updated,
    conflict_records = v_conflict,
    skipped_records = v_skipped + v_held,
    invalid_rows = v_invalid,
    failure = case when v_status = 'failed'
                   then v_failed || ' row(s) failed — retry the import'
                   else null end,
    completed_at = case when v_status in ('completed', 'needs_review')
                        then coalesce(completed_at, now()) end
  where id = p_import
  returning * into v_imp;

  return jsonb_build_object(
    'status', v_status,
    'created', v_created, 'linked', v_linked, 'updated', v_updated,
    'conflicts', v_conflict, 'held', v_held, 'invalid', v_invalid,
    'skipped', v_skipped, 'failed', v_failed,
    'unprocessed', greatest(v_imp.row_count - v_counted, 0),
    'import', to_jsonb(v_imp));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Function privileges: every governed import function is service-role only.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'import_normalize_phone_uk(text)',
    'import_normalize_postcode(text)',
    'import_normalize_address(text)',
    'import_validate_row_shape(jsonb, text[], text[], text[])',
    'import_validate_customer_row(uuid, text, jsonb)',
    'import_validate_site_row(uuid, text, jsonb)',
    'import_validate_job_row(uuid, text, jsonb)',
    'import_resolve_customer(uuid, text, jsonb)',
    'import_match_customer(uuid, text, jsonb)',
    'import_match_site(uuid, text, jsonb)',
    'import_resolve_job_site(uuid, text, text, uuid, text, text)',
    'import_match_job(uuid, text, jsonb)',
    'import_row_preamble(uuid, uuid, uuid, int, jsonb, jsonb, text)',
    'import_row_prior(uuid, uuid, int)',
    'import_customer_row(uuid, uuid, uuid, int, jsonb, jsonb)',
    'import_site_row(uuid, uuid, uuid, int, jsonb, jsonb)',
    'import_job_row(uuid, uuid, uuid, int, jsonb, jsonb)',
    'import_row_outcome(uuid, uuid, int, text, text, text[])',
    'import_run_finalize(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;


-- SOURCE 20260929120000_contact_point_primary_fix.sql; SHA-256 5725c71ec95c462118127545fe9acada09d5f25b5d5676847b6935f30c1835db
-- ServiceOS — Phase 11N: corrected person contact-point projection (Defect B).
--
-- Phase 11M's controlled pilot failed 262 of 264 otherwise-valid customer rows
-- with "duplicate key value violates unique constraint contact_points_primary_uk".
--
-- CAUSE. import_customer_row (migration 20260912120000, immutable and NOT edited
-- here) inserted its endpoint candidates in ONE statement whose is_primary was a
-- `not exists` subquery over contact_points. A subquery in a multi-row INSERT ...
-- SELECT sees the PRE-STATEMENT snapshot, so for a person carrying two distinct
-- normalising phone numbers BOTH candidates evaluated is_primary = true, and the
-- partial unique index (tenant_id, person_id, channel) where is_primary — which
-- is CORRECT and is deliberately left in place — rejected the statement. The
-- whole row RPC then errored, so an entirely ordinary customer (two phone
-- numbers) could never be imported.
--
-- FIX. One helper, import_person_contact_points, decides primacy WITHIN the
-- statement over a deterministically ranked candidate set:
--   rank 1  primary_email   (channel email)
--   rank 1  primary_phone   (channel phone)
--   rank 2  secondary_phone (channel phone)
-- Candidates are deduplicated by (channel, normalized_value) keeping the BEST
-- rank, so two source fields normalising to one endpoint converge to one row at
-- the stronger rank. Exactly one candidate per channel — the best-ranked one —
-- may be primary, and only when that channel has NO existing primary for the
-- person. An existing primary is never demoted, and the ON CONFLICT path
-- deliberately touches last_observed_at ONLY, so a rerun can never flip primacy.
--
-- A secondary phone therefore becomes primary only when it is the sole surviving
-- phone endpoint for a person with no existing primary — never alongside one.
--
-- Marketing safety is unchanged: endpoints only, always verification_state
-- 'unverified' and source 'import'. No permission, preference or suppression row
-- is created here or anywhere in the customer import path, so eligibility stays
-- 'unknown'.

-- ───────────────────────────────────────────────────────────────────────────
-- import_person_contact_points — the ONLY writer of import-sourced endpoints.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_person_contact_points(
  p_tenant uuid, p_person uuid, p_record jsonb
) returns void
language sql
as $fn$
  with candidate as (
    -- deterministic rank: the explicitly primary source field always wins
    select * from (values
      ('email'::text, p_record ->> 'primary_email', 1),
      ('phone'::text, p_record ->> 'primary_phone', 1),
      ('phone'::text, p_record ->> 'secondary_phone', 2)
    ) as c (channel, raw, rank)
  ),
  normalised as (
    select c.channel, c.raw, c.rank,
           marketing_normalize_endpoint(c.channel, c.raw) as norm
      from candidate c
     where marketing_normalize_endpoint(c.channel, c.raw) is not null
  ),
  -- two source fields normalising to ONE endpoint converge to a single row,
  -- keeping the stronger rank (and, at equal rank, a stable raw ordering)
  deduped as (
    select distinct on (channel, norm) channel, raw, norm, rank
      from normalised
     order by channel, norm, rank, raw
  ),
  -- an existing primary for this person+channel is authoritative and is NEVER
  -- demoted by an import
  ranked as (
    select d.*,
           row_number() over (partition by d.channel order by d.rank, d.norm) as chan_rank,
           exists (select 1 from contact_points cpp
                    where cpp.tenant_id = p_tenant
                      and cpp.person_id = p_person
                      and cpp.channel = d.channel
                      and cpp.is_primary) as channel_has_primary
      from deduped d
  )
  insert into contact_points
    (tenant_id, person_id, channel, value, normalized_value, is_primary,
     verification_state, source, last_observed_at)
  select p_tenant, p_person, r.channel, r.raw, r.norm,
         (r.chan_rank = 1 and not r.channel_has_primary),
         'unverified', 'import', now()
    from ranked r
  on conflict (tenant_id, person_id, channel, normalized_value) do update
    set last_observed_at = now();
$fn$;

comment on function import_person_contact_points(uuid, uuid, jsonb) is
  'Phase 11N: writes import-sourced contact points for a person. At most one '
  'primary per (person, channel), decided within the statement over a ranked '
  'candidate set; never demotes an existing primary; idempotent on rerun.';

-- ───────────────────────────────────────────────────────────────────────────
-- import_customer_row — byte-identical to 20260912120000 except that the
-- contact-point block now delegates to the helper above. Nothing else changes.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_customer_row(
  p_tenant uuid, p_import uuid, p_actor uuid, p_row_number int,
  p_record jsonb, p_options jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_source text;
  v_short jsonb;
  v_attempt int;
  v_invalid jsonb;
  v_res jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_kind text := nullif(trim(coalesce(p_record ->> 'record_kind', '')), '');
  v_email text := marketing_normalize_endpoint('email', p_record ->> 'primary_email');
  v_phone text := import_normalize_phone_uk(p_record ->> 'primary_phone');
  v_phone2 text := import_normalize_phone_uk(p_record ->> 'secondary_phone');
  v_lock_keys text[] := array[]::text[];
  v_lk text;
  v_display text;
  v_active boolean := coalesce((p_record ->> 'active')::boolean, true);
  v_meta jsonb;
  v_import_meta jsonb;
  v_conflict_id uuid;
  v_person uuid;
  v_company uuid;
  v_p people%rowtype;
  v_writable jsonb := '{}'::jsonb;
  v_field_conflicts text[] := array[]::text[];
  v_entity_table text;
  v_entity_id uuid;
  v_outcome text;
  v_strategy text;
  v_confidence numeric;
begin
  v_imp := import_row_preamble(p_tenant, p_import, p_actor, p_row_number,
                               p_record, p_options, 'customers');
  v_source := v_imp.preview -> 'sealed' ->> 'provenance_source';
  select o_short, o_attempt into v_short, v_attempt
    from import_row_prior(p_tenant, p_import, p_row_number);
  if v_short is not null then return v_short; end if;

  v_invalid := import_validate_customer_row(p_tenant, v_source, p_record);
  if v_invalid is not null then
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'invalid',
            v_invalid ->> 'reason',
            coalesce((select array_agg(e) from jsonb_array_elements_text(
                        v_invalid -> 'fields') e), '{}'::text[]),
            v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'invalid', 'reason', v_invalid ->> 'reason');
  end if;

  -- identity locks: SAME key format as the marketing manual-create/import
  -- paths (customers share the People identity space), deterministic order
  if v_email is not null then v_lock_keys := array_append(v_lock_keys, 'email|' || v_email); end if;
  if v_phone is not null then v_lock_keys := array_append(v_lock_keys, 'phone|' || v_phone); end if;
  if v_phone2 is not null then v_lock_keys := array_append(v_lock_keys, 'phone|' || v_phone2); end if;
  v_lock_keys := array_append(v_lock_keys, 'ext|' || v_source || '|' || v_ext);
  for v_lk in select distinct u from unnest(v_lock_keys) t(u) order by u loop
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|' || v_lk, 42));
  end loop;

  v_res := import_resolve_customer(p_tenant, v_source, p_record);

  v_display := nullif(trim(coalesce(p_record ->> 'display_name', '')), '');
  if v_display is null then
    v_display := nullif(trim(concat_ws(' ',
      nullif(trim(coalesce(p_record ->> 'first_name', '')), ''),
      nullif(trim(coalesce(p_record ->> 'last_name', '')), ''))), '');
  end if;
  v_import_meta := jsonb_strip_nulls(jsonb_build_object(
    'source', v_source,
    'external_id', v_ext,
    'record_kind', v_kind,
    'active', v_active,
    'title', nullif(trim(coalesce(p_record ->> 'title', '')), ''),
    'company_name', nullif(trim(coalesce(p_record ->> 'company_name', '')), '')));
  v_meta := jsonb_build_object('import', v_import_meta);
  if p_record ->> 'metadata_json' is not null then
    v_meta := v_meta || jsonb_build_object('source_payload',
      (p_record ->> 'metadata_json')::jsonb);
  end if;

  -- ── ambiguous / conflicting channel evidence: ONE durable blocking
  --    conflict, ZERO canonical mutation ──
  if v_res ->> 'decision' in ('ambiguous', 'conflicting') then
    insert into import_conflicts
      (tenant_id, import_id, source_system, entity_kind, external_id,
       conflict_type, blocking, identifiers, candidates, truncated, detail)
    values (p_tenant, p_import, v_source, 'customer', v_ext,
            case when v_res ->> 'decision' = 'ambiguous'
                 then 'ambiguous_channel' else 'channel_disagreement' end,
            true,
            coalesce(v_res -> 'evidence', '[]'::jsonb),
            coalesce((select jsonb_agg(jsonb_build_object(
                        'entity_table', 'people', 'entity_id', c))
                      from jsonb_array_elements_text(v_res -> 'candidate_union') c),
                     '[]'::jsonb),
            coalesce((v_res ->> 'truncated')::boolean, false),
            jsonb_build_object('row_number', p_row_number))
    on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
      where status = 'open'
    do update set identifiers = excluded.identifiers,
                  candidates = excluded.candidates,
                  truncated = excluded.truncated,
                  import_id = excluded.import_id
    returning id into v_conflict_id;
    insert into import_row_provenance
      (tenant_id, import_id, entity_table, entity_id, source_system,
       source_row_number, external_id, imported_fields, match_strategy,
       confidence, action, conflicts)
    values (p_tenant, p_import, 'import_conflicts', v_conflict_id, v_source,
            p_row_number, v_ext,
            array(select jsonb_object_keys(p_record)),
            v_res ->> 'decision', 0.5, 'conflict',
            coalesce(v_res -> 'evidence', '[]'::jsonb));
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, conflict_id, attempt)
    values (p_tenant, p_import, p_row_number, 'conflict',
            case when v_res ->> 'decision' = 'ambiguous'
              then 'a contact channel matches several existing people'
              else 'email and phone point to different existing people' end,
            v_conflict_id, v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          conflict_id = excluded.conflict_id, attempt = excluded.attempt;
    return jsonb_build_object('action', 'conflict', 'conflict_id', v_conflict_id);
  end if;

  -- ── already linked (idempotent rerun of the same source row) ──
  if v_res ->> 'decision' = 'linked' then
    v_entity_table := v_res ->> 'entity_table';
    v_entity_id := (v_res ->> 'entity_id')::uuid;
    v_outcome := 'linked';
    v_strategy := 'external_id';
    v_confidence := 1.0;

  -- ── exactly ONE existing person on strong channel evidence: link, fill
  --    blanks only, never overwrite, never touch verified/created_source ──
  elsif v_res ->> 'decision' = 'matched' then
    v_person := (v_res ->> 'entity_id')::uuid;
    select * into v_p from people where id = v_person and tenant_id = p_tenant
      for update;
    if not found then
      raise exception 'matched person vanished — retry' using errcode = '40001';
    end if;
    v_writable := '{}'::jsonb;
    if v_p.display_name is null and v_display is not null then
      v_writable := v_writable || jsonb_build_object('display_name', v_display); end if;
    if v_p.first_name is null and nullif(trim(coalesce(p_record ->> 'first_name', '')), '') is not null then
      v_writable := v_writable || jsonb_build_object('first_name', trim(p_record ->> 'first_name')); end if;
    if v_p.last_name is null and nullif(trim(coalesce(p_record ->> 'last_name', '')), '') is not null then
      v_writable := v_writable || jsonb_build_object('last_name', trim(p_record ->> 'last_name')); end if;
    if v_p.primary_email is null and p_record ->> 'primary_email' is not null then
      v_writable := v_writable || jsonb_build_object('primary_email', p_record ->> 'primary_email'); end if;
    if v_p.primary_phone is null and p_record ->> 'primary_phone' is not null then
      v_writable := v_writable || jsonb_build_object('primary_phone', p_record ->> 'primary_phone'); end if;
    if v_p.address_text is null and nullif(trim(coalesce(p_record ->> 'address_text', '')), '') is not null then
      v_writable := v_writable || jsonb_build_object('address_text', trim(p_record ->> 'address_text')); end if;
    if v_p.postcode is null and p_record ->> 'postcode' is not null then
      v_writable := v_writable || jsonb_build_object('postcode', p_record ->> 'postcode'); end if;
    -- differing non-blank values are recorded, never overwritten
    if v_p.display_name is not null and v_display is not null
       and v_p.display_name <> v_display then
      v_field_conflicts := array_append(v_field_conflicts, 'display_name'); end if;
    if v_p.primary_email is not null and p_record ->> 'primary_email' is not null
       and marketing_normalize_endpoint('email', v_p.primary_email) is distinct from v_email then
      v_field_conflicts := array_append(v_field_conflicts, 'primary_email'); end if;
    if v_p.primary_phone is not null and p_record ->> 'primary_phone' is not null
       and import_normalize_phone_uk(v_p.primary_phone) is distinct from v_phone then
      v_field_conflicts := array_append(v_field_conflicts, 'primary_phone'); end if;
    if v_p.postcode is not null and p_record ->> 'postcode' is not null
       and import_normalize_postcode(v_p.postcode) is distinct from import_normalize_postcode(p_record ->> 'postcode') then
      v_field_conflicts := array_append(v_field_conflicts, 'postcode'); end if;
    update people set
      display_name = coalesce(v_writable ->> 'display_name', display_name),
      first_name = coalesce(v_writable ->> 'first_name', first_name),
      last_name = coalesce(v_writable ->> 'last_name', last_name),
      primary_email = coalesce(v_writable ->> 'primary_email', primary_email),
      primary_phone = coalesce(v_writable ->> 'primary_phone', primary_phone),
      address_text = coalesce(v_writable ->> 'address_text', address_text),
      postcode = coalesce(v_writable ->> 'postcode', postcode),
      metadata = coalesce(metadata, '{}'::jsonb) || v_meta
    where id = v_person;
    v_entity_table := 'people';
    v_entity_id := v_person;
    v_outcome := 'linked';
    v_strategy := v_res ->> 'strategy';
    v_confidence := (v_res ->> 'confidence')::numeric;

  -- ── new company customer: canonical company, NEVER a named individual ──
  elsif v_res ->> 'decision' = 'new_company' then
    insert into companies (tenant_id, name, phone, address_text, postcode,
                           verified, created_source, metadata)
    values (p_tenant, trim(p_record ->> 'company_name'),
            p_record ->> 'primary_phone',
            nullif(trim(coalesce(p_record ->> 'address_text', '')), ''),
            p_record ->> 'postcode',
            false, 'import:' || v_source,
            v_meta || jsonb_build_object('import',
              v_import_meta || jsonb_strip_nulls(jsonb_build_object(
                'primary_email', p_record ->> 'primary_email'))))
    returning id into v_company;
    -- channels matching existing interaction-created PEOPLE are review
    -- evidence beside the applied row — never an automatic association
    if jsonb_array_length(coalesce(v_res -> 'person_overlap', '[]'::jsonb)) > 0 then
      insert into import_conflicts
        (tenant_id, import_id, source_system, entity_kind, external_id,
         conflict_type, blocking, identifiers, candidates, truncated, detail)
      values (p_tenant, p_import, v_source, 'customer', v_ext,
              'company_person_overlap', false,
              coalesce(v_res -> 'evidence', '[]'::jsonb),
              coalesce((select jsonb_agg(jsonb_build_object(
                          'entity_table', 'people', 'entity_id', c))
                        from jsonb_array_elements_text(v_res -> 'person_overlap') c),
                       '[]'::jsonb),
              coalesce((v_res ->> 'truncated')::boolean, false),
              jsonb_build_object('row_number', p_row_number,
                                 'company_id', v_company))
      on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
        where status = 'open'
      do update set identifiers = excluded.identifiers,
                    candidates = excluded.candidates,
                    truncated = excluded.truncated,
                    import_id = excluded.import_id,
                    detail = excluded.detail
      returning id into v_conflict_id;
    end if;
    v_entity_table := 'companies';
    v_entity_id := v_company;
    v_outcome := 'created';
    v_strategy := 'created';
    v_confidence := 1.0;

  -- ── new person customer ──
  else
    insert into people (tenant_id, display_name, first_name, last_name,
                        primary_email, primary_phone, address_text, postcode,
                        verified, created_source, metadata)
    values (p_tenant, v_display,
            nullif(trim(coalesce(p_record ->> 'first_name', '')), ''),
            nullif(trim(coalesce(p_record ->> 'last_name', '')), ''),
            p_record ->> 'primary_email',
            p_record ->> 'primary_phone',
            nullif(trim(coalesce(p_record ->> 'address_text', '')), ''),
            p_record ->> 'postcode',
            false, 'import:customers:' || v_source, v_meta)
    returning id into v_person;
    v_entity_table := 'people';
    v_entity_id := v_person;
    v_outcome := 'created';
    v_strategy := 'created';
    v_confidence := 1.0;
  end if;

  -- contact points for PERSON customers: unverified import endpoints, written
  -- through the corrected helper (11N Defect B). This remains the ONLY
  -- marketing-adjacent write — no preference, no suppression, no permission
  -- record: eligibility stays 'unknown'.
  if v_entity_table = 'people' then
    perform import_person_contact_points(p_tenant, v_entity_id, p_record);
  end if;

  -- authoritative external-identity link (idempotent for ever after)
  if v_res ->> 'decision' <> 'linked' then
    insert into import_entity_links
      (tenant_id, source_system, entity_kind, external_id, entity_table,
       entity_id, link_strategy, confidence, evidence, import_id)
    values (p_tenant, v_source, 'customer', v_ext, v_entity_table, v_entity_id,
            case when v_outcome = 'created' then 'created' else v_strategy end,
            v_confidence,
            jsonb_build_object('matched_on', coalesce(v_res -> 'matched_on', '[]'::jsonb)),
            p_import)
    on conflict (tenant_id, source_system, entity_kind, external_id) do nothing;
  end if;

  insert into import_row_provenance
    (tenant_id, import_id, entity_table, entity_id, source_system,
     source_row_number, external_id, imported_fields, match_strategy,
     confidence, action, conflicts)
  values (p_tenant, p_import, v_entity_table, v_entity_id, v_source,
          p_row_number, v_ext,
          array(select jsonb_object_keys(p_record)),
          v_strategy, v_confidence,
          case when v_outcome = 'created' then 'created' else 'linked' end,
          coalesce((select jsonb_agg(jsonb_build_object('field', f))
                    from unnest(v_field_conflicts) f), '[]'::jsonb));
  insert into import_row_results
    (tenant_id, import_id, row_number, outcome, reason, fields,
     entity_table, entity_id, conflict_id, attempt)
  values (p_tenant, p_import, p_row_number, v_outcome,
          case when array_length(v_field_conflicts, 1) > 0
            then 'linked with differing fields recorded (never overwritten)'
            else null end,
          coalesce(v_field_conflicts, '{}'::text[]),
          v_entity_table, v_entity_id, v_conflict_id, v_attempt)
  on conflict (tenant_id, import_id, row_number) do update
    set outcome = excluded.outcome, reason = excluded.reason,
        fields = excluded.fields, entity_table = excluded.entity_table,
        entity_id = excluded.entity_id, conflict_id = excluded.conflict_id,
        attempt = excluded.attempt;
  return jsonb_build_object('action', v_outcome,
    'entity_table', v_entity_table, 'entity_id', v_entity_id,
    'strategy', v_strategy, 'field_conflicts', to_jsonb(v_field_conflicts));
end $$;


-- SOURCE 20260930120000_exact_job_site_resolution.sql; SHA-256 85df31a8f0ba2d968e54a4c780e964f3aa77e8d29b821c063ab4a3b4a624abb7
-- ServiceOS — Phase 11P: EXACT Job→Site resolution (Defect D).
--
-- Phase 11O imported package v4 into the controlled pilot and only afterwards
-- was it noticed that import_job_row never passed the record's site_external_id
-- to the resolver: import_resolve_job_site takes (tenant, source, customer,
-- postcode, address) and nothing else. So the package's 228 exact work-address
-- references — reconstructed in 11K only where every corroborating source agreed,
-- and proven in-package by the contract — were discarded in favour of
-- postcode/address matching. Of those 228, 89 linked by weaker evidence, 99
-- became `site_ambiguous` review conflicts and 40 linked to nothing.
--
-- This migration makes the exact reference the FIRST and STRONGEST path, and —
-- critically — the ONLY path when it is present. Silently degrading a
-- contradictory exact reference to address matching would be a guess dressed as
-- evidence, which is precisely what the whole importer refuses to do.
--
-- Behaviour:
--   EMPTY site_external_id  → the existing postcode/address fallback, unchanged.
--   NON-EMPTY               → resolve through the tenant- and source-scoped
--                             immutable site import link; the site must exist and
--                             must belong to the Job's own resolved customer;
--                             returns strategy `exact_external_id`. A missing,
--                             cross-customer or otherwise contradictory reference
--                             returns `error` and NEVER falls back.
--
-- Preview and apply share the resolver, so an exact reference is visible in the
-- preview rather than discovered at apply. An exact reference can never produce
-- `site_ambiguous`: it either resolves exactly or fails closed.
--
-- Migrations 20260912120000 and 20260929120000 are NOT edited. import_match_job
-- and import_job_row are replaced with identical bodies except for the site
-- resolution block.

-- ───────────────────────────────────────────────────────────────────────────
-- A contradictory EXACT reference is a NEW, BLOCKING conflict type. The check
-- constraint is widened rather than dropped, so every existing type stays
-- enumerated and an unknown type is still rejected.
-- ───────────────────────────────────────────────────────────────────────────
alter table import_conflicts drop constraint if exists import_conflicts_conflict_type_check;
alter table import_conflicts add constraint import_conflicts_conflict_type_check
  check (conflict_type = any (array[
    'ambiguous_channel',
    'channel_disagreement',
    'multiple_candidates',
    'company_person_overlap',
    'site_ambiguous',
    'site_exact_unresolvable'
  ]));

-- ───────────────────────────────────────────────────────────────────────────
-- import_resolve_job_site_exact — the exact path. Fail-closed by construction.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_resolve_job_site_exact(
  p_tenant uuid, p_source text, p_cust_table text, p_cust_id uuid,
  p_site_external_id text
) returns jsonb
language plpgsql
stable
as $fn$
declare
  v_ref text := nullif(trim(coalesce(p_site_external_id, '')), '');
  v_link import_entity_links%rowtype;
  v_site sites%rowtype;
  v_owner uuid;
begin
  if v_ref is null then
    return jsonb_build_object('outcome', 'absent');
  end if;
  if p_cust_table is null or p_cust_id is null then
    return jsonb_build_object('outcome', 'error', 'reason', 'customer_unresolved');
  end if;

  -- The immutable identity map is the ONLY way an external id becomes an entity.
  select * into v_link from import_entity_links l
   where l.tenant_id = p_tenant and l.source_system = p_source
     and l.entity_kind = 'site' and l.external_id = v_ref;
  if not found then
    return jsonb_build_object('outcome', 'error',
      'reason', 'exact_site_reference_not_imported');
  end if;
  if v_link.entity_table <> 'sites' then
    return jsonb_build_object('outcome', 'error',
      'reason', 'exact_site_reference_points_at_unexpected_table');
  end if;

  select * into v_site from sites s
   where s.id = v_link.entity_id and s.tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('outcome', 'error',
      'reason', 'exact_site_missing_in_tenant');
  end if;

  -- An exact link may NEVER cross customers: that would attach one customer's
  -- job to another customer's address.
  v_owner := case when p_cust_table = 'people' then v_site.person_id
                  when p_cust_table = 'companies' then v_site.company_id
                  else null end;
  if v_owner is null or v_owner <> p_cust_id then
    return jsonb_build_object('outcome', 'error',
      'reason', 'exact_site_belongs_to_a_different_customer');
  end if;

  return jsonb_build_object('outcome', 'resolved', 'site_id', v_site.id,
    'strategy', 'exact_external_id');
end $fn$;

comment on function import_resolve_job_site_exact(uuid, text, text, uuid, text) is
  'Phase 11P: resolves a Job site from an EXACT site_external_id through the '
  'immutable import identity map. Fails closed on a missing, cross-tenant, '
  'cross-customer or otherwise contradictory reference; never guesses.';

-- ───────────────────────────────────────────────────────────────────────────
-- import_resolve_job_site_v2 — exact first; the ORIGINAL fallback otherwise.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_resolve_job_site_v2(
  p_tenant uuid, p_source text, p_cust_table text, p_cust_id uuid,
  p_site_external_id text, p_postcode text, p_address text
) returns jsonb
language plpgsql
stable
as $fn$
declare
  v_exact jsonb;
begin
  v_exact := import_resolve_job_site_exact(p_tenant, p_source, p_cust_table,
                                           p_cust_id, p_site_external_id);
  -- Present but contradictory → error, and NO fallback. Present and good →
  -- exact wins over any weaker postcode/address agreement.
  if v_exact ->> 'outcome' <> 'absent' then
    return v_exact;
  end if;
  return import_resolve_job_site(p_tenant, p_source, p_cust_table, p_cust_id,
                                 p_postcode, p_address);
end $fn$;

comment on function import_resolve_job_site_v2(uuid, text, text, uuid, text, text, text) is
  'Phase 11P: exact site_external_id first and, when present, exclusively; '
  'otherwise the unchanged deterministic postcode/address fallback.';

-- ───────────────────────────────────────────────────────────────────────────
-- import_match_job (PREVIEW) — identical except that it resolves through v2.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_match_job(
  p_tenant uuid, p_source text, p_record jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_invalid jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_cust text := nullif(trim(coalesce(p_record ->> 'customer_external_id', '')), '');
  v_link import_entity_links%rowtype;
  v_site jsonb;
begin
  v_invalid := import_validate_job_row(p_tenant, p_source, p_record);
  if v_invalid is not null then
    return jsonb_build_object('action', 'invalid', 'strategy', 'invalid',
      'confidence', 0, 'reason', v_invalid ->> 'reason', 'candidates', 0);
  end if;
  if exists (select 1 from import_entity_links l
              where l.tenant_id = p_tenant and l.source_system = p_source
                and l.entity_kind = 'job' and l.external_id = v_ext) then
    return jsonb_build_object('action', 'matched', 'strategy', 'external_id',
      'confidence', 1.0, 'candidates', 1);
  end if;
  select * into v_link from import_entity_links l
   where l.tenant_id = p_tenant and l.source_system = p_source
     and l.entity_kind = 'customer' and l.external_id = v_cust;
  if not found then
    return jsonb_build_object('action', 'held', 'strategy', 'customer_not_imported',
      'confidence', 0, 'candidates', 0);
  end if;
  -- 11P: EXACT site evidence first. A contradictory exact reference is a
  -- conflict the preview must SHOW, not a create the operator discovers later.
  v_site := import_resolve_job_site_v2(p_tenant, p_source,
    v_link.entity_table, v_link.entity_id,
    p_record ->> 'site_external_id',
    p_record ->> 'site_postcode', p_record ->> 'site_address_text');
  if v_site ->> 'outcome' = 'error' then
    return jsonb_build_object('action', 'probable', 'strategy', 'site_exact_unresolvable',
      'confidence', 0, 'candidates', 0,
      'site_outcome', 'error', 'site_reason', v_site ->> 'reason');
  end if;
  return jsonb_build_object('action', 'new', 'strategy', 'created',
    'confidence', 1.0, 'candidates', 0,
    'site_outcome', v_site ->> 'outcome',
    'site_strategy', v_site ->> 'strategy');
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- import_job_row (APPLY) — identical except for the site resolution block.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function import_job_row(
  p_tenant uuid, p_import uuid, p_actor uuid, p_row_number int,
  p_record jsonb, p_options jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_source text;
  v_short jsonb;
  v_attempt int;
  v_invalid jsonb;
  v_ext text := nullif(trim(coalesce(p_record ->> 'external_id', '')), '');
  v_cust_ext text := nullif(trim(coalesce(p_record ->> 'customer_external_id', '')), '');
  v_link import_entity_links%rowtype;
  v_job jobs%rowtype;
  v_job_id uuid;
  v_outcome text;
  v_status text := trim(coalesce(p_record ->> 'status', ''));
  v_active boolean := coalesce((p_record ->> 'active')::boolean, true);
  v_site jsonb;
  v_site_id uuid;
  v_conflict_id uuid;
  v_meta jsonb;
  v_hold_reason text;
  v_jn text;
begin
  v_imp := import_row_preamble(p_tenant, p_import, p_actor, p_row_number,
                               p_record, p_options, 'jobs');
  v_source := v_imp.preview -> 'sealed' ->> 'provenance_source';
  select o_short, o_attempt into v_short, v_attempt
    from import_row_prior(p_tenant, p_import, p_row_number);
  if v_short is not null then return v_short; end if;

  v_invalid := import_validate_job_row(p_tenant, v_source, p_record);
  if v_invalid is not null then
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'invalid',
            v_invalid ->> 'reason',
            coalesce((select array_agg(e) from jsonb_array_elements_text(
                        v_invalid -> 'fields') e), '{}'::text[]),
            v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'invalid', 'reason', v_invalid ->> 'reason');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant::text || '|ext|' || v_source || '|job|' || v_ext, 42));

  -- the customer relationship is REQUIRED — an orphan job is held, never
  -- created against nothing and never cross-tenant
  select * into v_link from import_entity_links l
   where l.tenant_id = p_tenant and l.source_system = v_source
     and l.entity_kind = 'customer' and l.external_id = v_cust_ext;
  if not found then
    if exists (select 1 from import_conflicts c
                where c.tenant_id = p_tenant and c.source_system = v_source
                  and c.entity_kind = 'customer' and c.external_id = v_cust_ext
                  and c.blocking and c.status = 'open') then
      v_hold_reason := 'customer_conflict_open';
    else
      v_hold_reason := 'customer_not_imported';
    end if;
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, attempt)
    values (p_tenant, p_import, p_row_number, 'held', v_hold_reason,
            array['customer_external_id'], v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, attempt = excluded.attempt;
    return jsonb_build_object('action', 'held', 'reason', v_hold_reason);
  end if;

  -- deterministic site resolution (never a guess). 11P: an EXACT
  -- site_external_id is tried FIRST and, if present, is the ONLY path — a
  -- contradictory exact reference never silently degrades to address matching.
  v_site := import_resolve_job_site_v2(p_tenant, v_source,
    v_link.entity_table, v_link.entity_id,
    p_record ->> 'site_external_id',
    p_record ->> 'site_postcode', p_record ->> 'site_address_text');
  if v_site ->> 'outcome' = 'error' then
    -- FAIL CLOSED: a BLOCKING durable conflict and NO canonical Job. The package
    -- contract refuses such a package outright, so reaching here means the
    -- package was not contract-verified — that is a person's decision, never a
    -- guess, and certainly never an address fallback.
    insert into import_conflicts
      (tenant_id, import_id, source_system, entity_kind, external_id,
       conflict_type, blocking, identifiers, candidates, truncated, detail)
    values (p_tenant, p_import, v_source, 'job', v_ext,
            'site_exact_unresolvable', true,
            jsonb_build_array(jsonb_build_object(
              'channel', 'external_id', 'label', 'site_external_id')),
            '[]'::jsonb, false,
            jsonb_build_object('row_number', p_row_number,
                               'reason', v_site ->> 'reason'))
    on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
      where status = 'open'
    do update set import_id = excluded.import_id, detail = excluded.detail
    returning id into v_conflict_id;
    insert into import_row_results
      (tenant_id, import_id, row_number, outcome, reason, fields, conflict_id, attempt)
    values (p_tenant, p_import, p_row_number, 'conflict', v_site ->> 'reason',
            array['site_external_id'], v_conflict_id, v_attempt)
    on conflict (tenant_id, import_id, row_number) do update
      set outcome = excluded.outcome, reason = excluded.reason,
          fields = excluded.fields, conflict_id = excluded.conflict_id,
          attempt = excluded.attempt;
    return jsonb_build_object('action', 'conflict', 'conflict_id', v_conflict_id,
      'reason', v_site ->> 'reason');
  end if;
  if v_site ->> 'outcome' = 'resolved' then
    v_site_id := (v_site ->> 'site_id')::uuid;
  elsif v_site ->> 'outcome' = 'ambiguous' then
    insert into import_conflicts
      (tenant_id, import_id, source_system, entity_kind, external_id,
       conflict_type, blocking, identifiers, candidates, truncated, detail)
    values (p_tenant, p_import, v_source, 'job', v_ext,
            'site_ambiguous', false,
            jsonb_build_array(jsonb_build_object(
              'channel', 'address',
              'label', 'site_address',
              'value', import_normalize_address(p_record ->> 'site_address_text'),
              'postcode', import_normalize_postcode(p_record ->> 'site_postcode'))),
            coalesce((select jsonb_agg(jsonb_build_object(
                        'entity_table', 'sites', 'entity_id', c))
                      from jsonb_array_elements_text(v_site -> 'candidate_site_ids') c),
                     '[]'::jsonb),
            coalesce((v_site ->> 'truncated')::boolean, false),
            jsonb_build_object('row_number', p_row_number,
                               'reason', v_site ->> 'reason'))
    on conflict (tenant_id, source_system, entity_kind, external_id, conflict_type)
      where status = 'open'
    do update set identifiers = excluded.identifiers,
                  candidates = excluded.candidates,
                  truncated = excluded.truncated,
                  import_id = excluded.import_id,
                  detail = excluded.detail
    returning id into v_conflict_id;
  end if;

  v_meta := jsonb_build_object('import', jsonb_strip_nulls(jsonb_build_object(
    'source', v_source, 'external_id', v_ext,
    'customer_external_id', v_cust_ext, 'active', v_active,
    'engineer_name', nullif(trim(coalesce(p_record ->> 'engineer', '')), ''),
    'quoted_value_pennies', (p_record -> 'quoted_value_pennies'),
    'site_resolution', jsonb_build_object(
      'outcome', v_site ->> 'outcome',
      'strategy', v_site ->> 'strategy',
      'reason', v_site ->> 'reason'),
    'site_address_text', nullif(trim(coalesce(p_record ->> 'site_address_text', '')), ''),
    'site_postcode', p_record ->> 'site_postcode')));
  if p_record ->> 'metadata_json' is not null then
    v_meta := v_meta || jsonb_build_object('source_payload',
      (p_record ->> 'metadata_json')::jsonb);
  end if;

  select * into v_job from jobs j
   where j.tenant_id = p_tenant and j.source_system = v_source
     and j.external_id = v_ext;
  if found then
    update jobs set
      site_id = coalesce(jobs.site_id, v_site_id),
      metadata = coalesce(jobs.metadata, '{}'::jsonb) || v_meta
    where id = v_job.id;
    v_job_id := v_job.id;
    v_outcome := 'linked';
  else
    insert into jobs (tenant_id, source_system, external_id, job_number,
                      customer_person_id, customer_company_id, site_id,
                      title, description, status, active,
                      value_pennies, created_date, completed_date,
                      created_source, verified, metadata)
    values (p_tenant, v_source, v_ext,
            nullif(trim(coalesce(p_record ->> 'job_number', '')), ''),
            case when v_link.entity_table = 'people' then v_link.entity_id end,
            case when v_link.entity_table = 'companies' then v_link.entity_id end,
            v_site_id,
            nullif(trim(coalesce(p_record ->> 'title', '')), ''),
            nullif(trim(coalesce(p_record ->> 'description', '')), ''),
            v_status, v_active,
            (p_record ->> 'value_pennies')::bigint,
            (nullif(trim(coalesce(p_record ->> 'created_date', '')), ''))::timestamptz,
            (nullif(trim(coalesce(p_record ->> 'completed_date', '')), ''))::timestamptz,
            'import:' || v_source, false, v_meta)
    returning id into v_job_id;
    v_outcome := 'created';
  end if;

  v_jn := regexp_replace(coalesce(p_record ->> 'job_number', ''), '[^0-9]', '', 'g');
  if v_jn <> '' then
    insert into job_number_aliases (tenant_id, job_id, alias, normalized, source)
    values (p_tenant, v_job_id, p_record ->> 'job_number', v_jn, 'import')
    on conflict (tenant_id, normalized) do nothing;
  end if;

  insert into import_entity_links
    (tenant_id, source_system, entity_kind, external_id, entity_table,
     entity_id, link_strategy, confidence, evidence, import_id)
  values (p_tenant, v_source, 'job', v_ext, 'jobs', v_job_id,
          case when v_outcome = 'created' then 'created' else 'external_id' end,
          1.0, jsonb_build_object('customer_external_id', v_cust_ext), p_import)
  on conflict (tenant_id, source_system, entity_kind, external_id) do nothing;

  insert into import_row_provenance
    (tenant_id, import_id, entity_table, entity_id, source_system,
     source_row_number, external_id, imported_fields, match_strategy,
     confidence, action, conflicts)
  values (p_tenant, p_import, 'jobs', v_job_id, v_source, p_row_number, v_ext,
          array(select jsonb_object_keys(p_record)),
          case when v_outcome = 'created' then 'created' else 'external_id' end,
          1.0,
          case when v_outcome = 'created' then 'created' else 'linked' end,
          jsonb_build_array(jsonb_build_object('site_resolution', v_site))
    );
  insert into import_row_results
    (tenant_id, import_id, row_number, outcome, reason, fields,
     entity_table, entity_id, conflict_id, attempt)
  values (p_tenant, p_import, p_row_number, v_outcome,
          'site: ' || coalesce(v_site ->> 'strategy', v_site ->> 'reason',
                               v_site ->> 'outcome'),
          case when v_site_id is not null then array['site_linked']
               when v_site ->> 'outcome' = 'ambiguous' then array['site_ambiguous']
               else array['site_unlinked'] end,
          'jobs', v_job_id, v_conflict_id, v_attempt)
  on conflict (tenant_id, import_id, row_number) do update
    set outcome = excluded.outcome, reason = excluded.reason,
        fields = excluded.fields, entity_table = excluded.entity_table,
        entity_id = excluded.entity_id, conflict_id = excluded.conflict_id,
        attempt = excluded.attempt;
  return jsonb_build_object('action', v_outcome, 'entity_table', 'jobs',
    'entity_id', v_job_id, 'site_outcome', v_site ->> 'outcome');
end $$;


-- SOURCE 20261029170000_learn_import_boundaries.sql; SHA-256 907aa6713a567417ecbcfe0e6e4e6a6b41cfe95d7ba511bf222b671cec96b3fb
-- Recovery hardening: do not depend on a database's default table/function
-- privileges. Some historical local environments grant new tables to API roles.
-- The durable row ledger belongs to the server; safe tenant-scoped conflict and
-- identity reads remain available through their existing RLS policies.
revoke all on public.import_row_results from public, anon, authenticated;
grant select, insert, update on public.import_row_results to service_role;
revoke delete, truncate on public.import_row_results from service_role;

revoke all on public.import_entity_links, public.import_conflicts
  from public, anon, authenticated;
grant select on public.import_entity_links, public.import_conflicts to authenticated;
grant select, insert, update, delete on public.import_entity_links, public.import_conflicts
  to service_role;
revoke truncate on public.import_entity_links, public.import_conflicts from service_role;

-- Helpers introduced after the base import migration need the same explicit
-- server-only boundary as the row RPCs which call them.
revoke all on function public.import_person_contact_points(uuid, uuid, jsonb),
  public.import_resolve_job_site_exact(uuid, text, text, uuid, text),
  public.import_resolve_job_site_v2(uuid, text, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.import_person_contact_points(uuid, uuid, jsonb),
  public.import_resolve_job_site_exact(uuid, text, text, uuid, text),
  public.import_resolve_job_site_v2(uuid, text, text, uuid, text, text, text)
  to service_role;

-- Explicitly bound privileges, including the two trigger helpers omitted from
-- the original function-grant loop. Default database grants are not authority.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['import_customer_row','import_entity_links_guard','import_job_row','import_match_customer','import_match_job','import_match_site','import_normalize_address','import_normalize_phone_uk','import_normalize_postcode','import_person_contact_points','import_resolve_customer','import_resolve_job_site','import_resolve_job_site_exact','import_resolve_job_site_v2','import_row_outcome','import_row_preamble','import_row_prior','import_row_results_guard','import_run_finalize','import_site_row','import_validate_customer_row','import_validate_job_row','import_validate_row_shape','import_validate_site_row','marketing_normalize_endpoint']) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- INPUT supabase/release/learn-test/023_import_authority.sql
create or replace function import_row_preamble(
  p_tenant uuid, p_import uuid, p_actor uuid, p_row_number int,
  p_record jsonb, p_options jsonb, p_entity text
) returns data_imports
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_actor_tenant uuid;
  v_actor_role text;
  v_sealed jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Import apply requires a fresh snapshot' using errcode='22023';
  end if;
  if p_tenant is null or p_import is null or p_actor is null or p_row_number is null then
    raise exception 'tenant, import, actor and row number required' using errcode = '22023';
  end if;
  if p_record is null or jsonb_typeof(p_record) <> 'object'
     or p_options is null or jsonb_typeof(p_options) <> 'object' then
    raise exception 'record and options must be objects' using errcode = '22023';
  end if;
  -- Match the existing LEARN authority-input trigger lock order. A context,
  -- profile or company change cannot race this row's authorization check.
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
  perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
  select tenant_id, role into v_actor_tenant, v_actor_role
    from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  if coalesce(v_actor_role, '') not in ('owner', 'admin') then
    raise exception 'actor lacks import authority (owner/admin required)'
      using errcode = '42501';
  end if;
  if not exists(select 1 from tenants where id=p_tenant and status='active') then
    raise exception 'Company access is unavailable' using errcode='42501';
  end if;
  if exists(select 1 from view_as_context where actor_user_id=p_actor and ended_at is null
      and (expires_at is null or expires_at>clock_timestamp())) then
    raise exception 'Exit View As before importing' using errcode='42501';
  end if;
  select * into v_imp from data_imports
   where id = p_import and tenant_id = p_tenant;
  if not found then
    raise exception 'import not found for tenant' using errcode = 'P0002';
  end if;
  if v_imp.entity_type <> p_entity then
    raise exception 'import is not a % import', p_entity using errcode = '22023';
  end if;
  if v_imp.status not in ('previewed', 'importing', 'failed', 'needs_review') then
    raise exception 'import status % does not allow row apply', v_imp.status
      using errcode = '22023';
  end if;
  if p_row_number < 2 or p_row_number > v_imp.row_count + 1 then
    raise exception 'row number is outside the sealed import' using errcode = '22023';
  end if;
  v_sealed := v_imp.preview -> 'sealed';
  if v_sealed is null or jsonb_typeof(v_sealed) is distinct from 'object'
     or jsonb_typeof(v_sealed -> 'import_options') is distinct from 'object' then
    raise exception 'import has no sealed contract — a new preview is required'
      using errcode = '22023';
  end if;
  if p_options is distinct from v_sealed -> 'import_options' then
    raise exception 'options do not match the sealed import contract'
      using errcode = '22023';
  end if;
  return v_imp;
end $$;
revoke all on function public.import_row_preamble(uuid,uuid,uuid,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.import_row_preamble(uuid,uuid,uuid,integer,jsonb,jsonb,text) to service_role;

-- INPUT supabase/release/learn-test/024_import_customer_cards.sql
-- Person cards may carry their company; they remain distinct from the company's
-- own card. Refuse duplicate pre-existing identities rather than merging history.
create unique index learn_customer_card_person_uk
 on customer_cards(tenant_id,person_id) where person_id is not null;
create unique index learn_customer_card_company_uk
 on customer_cards(tenant_id,company_id) where person_id is null and company_id is not null;

create function learn_import_customer_card(p_tenant uuid,p_link uuid)
returns uuid language plpgsql set search_path=public,pg_temp as $$
declare l import_entity_links%rowtype;card uuid;label text;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Card projection requires a fresh snapshot' using errcode='22023';
 end if;
 if p_tenant is null or p_link is null then
  raise exception 'Company and source link required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 -- Existing approved identity projection only: this does not approve/import a
 -- file, infer a contact match, or create a person/company from supplied values.
 select * into l from import_entity_links where id=p_link and tenant_id=p_tenant;
 if not found or l.entity_kind<>'customer' or l.entity_table not in ('people','companies') then
  raise exception 'Imported customer link unavailable in company' using errcode='22023';
 end if;
 if not exists(select 1 from tenants where id=p_tenant and status='active') then
  raise exception 'Company access unavailable' using errcode='42501';
 end if;
 if l.entity_table='people' then
  select display_name into label from people where id=l.entity_id and tenant_id=p_tenant;
  if not found then raise exception 'Customer identity unavailable in company' using errcode='23503';end if;
  insert into customer_cards(tenant_id,person_id,title,metadata)
   values(p_tenant,l.entity_id,coalesce(nullif(btrim(label),''),'Imported customer'),
    jsonb_build_object('learn_import_identity',jsonb_build_object('link_id',l.id,'import_id',l.import_id,'source_system',l.source_system)))
   on conflict(tenant_id,person_id) where person_id is not null do nothing
   returning id into card;
  if card is null then select id into card from customer_cards where tenant_id=p_tenant and person_id=l.entity_id;end if;
 else
  select name into label from companies where id=l.entity_id and tenant_id=p_tenant;
  if not found then raise exception 'Customer identity unavailable in company' using errcode='23503';end if;
  insert into customer_cards(tenant_id,company_id,title,metadata)
   values(p_tenant,l.entity_id,coalesce(nullif(btrim(label),''),'Imported customer'),
    jsonb_build_object('learn_import_identity',jsonb_build_object('link_id',l.id,'import_id',l.import_id,'source_system',l.source_system)))
   on conflict(tenant_id,company_id) where person_id is null and company_id is not null do nothing
   returning id into card;
  if card is null then select id into card from customer_cards where tenant_id=p_tenant and company_id=l.entity_id and person_id is null;end if;
 end if;
 if card is null then raise exception 'Card changed during projection; retry' using errcode='40001';end if;
 return card;
end $$;

create function learn_import_customer_card_after_link()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.entity_kind='customer' then perform learn_import_customer_card(new.tenant_id,new.id);end if;
 return new;
end $$;
create trigger learn_import_customer_card_after_link
 after insert on import_entity_links for each row
 execute function learn_import_customer_card_after_link();

-- Bounded explicit repair for already imported identities. Private service
-- operation; installation does not run it or modify any retained source row.
create function learn_import_customer_cards_reconcile(p_tenant uuid,p_after uuid default null,p_limit integer default 100)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare l record;last_id uuid;seen integer:=0;more boolean;
begin
 if p_tenant is null or p_limit is null or p_limit<1 or p_limit>200 then
  raise exception 'Company and page size 1..200 required' using errcode='22023';
 end if;
 if not exists(select 1 from tenants where id=p_tenant and status='active') then
  raise exception 'Company access unavailable' using errcode='42501';
 end if;
 for l in select id from import_entity_links where tenant_id=p_tenant and entity_kind='customer'
  and (p_after is null or id>p_after) order by id limit p_limit loop
  perform learn_import_customer_card(p_tenant,l.id);last_id:=l.id;seen:=seen+1;
 end loop;
 select exists(select 1 from import_entity_links where tenant_id=p_tenant and entity_kind='customer' and id>last_id) into more;
 return jsonb_build_object('version','learn-import-cards/1','tenant_id',p_tenant,'processed',seen,'next_cursor',case when more then last_id end);
end $$;
revoke all on function learn_import_customer_card(uuid,uuid),learn_import_customer_card_after_link(),learn_import_customer_cards_reconcile(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function learn_import_customer_card(uuid,uuid),learn_import_customer_card_after_link(),learn_import_customer_cards_reconcile(uuid,uuid,integer) to service_role;

-- INPUT supabase/release/learn-test/025_import_batches.sql
create function learn_import_batch_authority(p_tenant uuid,p_actor uuid)
returns void language plpgsql set search_path=public,pg_temp as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Import batch requires a fresh snapshot' using errcode='22023';
 end if;
 if p_tenant is null or p_actor is null then
  raise exception 'Company and actor required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 if not exists(select 1 from profiles where id=p_actor and tenant_id=p_tenant and role in ('owner','admin'))
  or not exists(select 1 from tenants where id=p_tenant and status='active')
  or exists(select 1 from view_as_context where actor_user_id=p_actor and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Current company import authority required' using errcode='42501';
 end if;
end $$;

create function learn_import_match_batch(p_tenant uuid,p_actor uuid,p_source text,p_entity text,p_rows jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare item jsonb;result jsonb;results jsonb:='[]';seen integer[]:='{}';n integer;
begin
 perform learn_import_batch_authority(p_tenant,p_actor);
 if p_entity is null or p_entity not in ('customers','sites','jobs') or nullif(btrim(p_source),'') is null
  or jsonb_typeof(p_rows) is distinct from 'array' then
  raise exception 'Governed entity, source and rows required' using errcode='22023';
 end if;
 if jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Batch must contain 1..100 rows' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'record') is distinct from 'object'
   or jsonb_typeof(item->'row_number') is distinct from 'number' or (item->>'row_number')!~'^[0-9]{1,4}$' then
   raise exception 'Invalid batch row' using errcode='22023';
  end if;
  n:=(item->>'row_number')::integer;
  if n not between 2 and 5001 or n=any(seen) then raise exception 'Duplicate or out-of-range row' using errcode='22023';end if;
  seen:=array_append(seen,n);
  case p_entity
   when 'customers' then result:=import_match_customer(p_tenant,p_source,item->'record');
   when 'sites' then result:=import_match_site(p_tenant,p_source,item->'record');
   when 'jobs' then result:=import_match_job(p_tenant,p_source,item->'record');
  end case;
  results:=results||jsonb_build_array(jsonb_build_object('row_number',n,'result',result));
 end loop;
 return results;
end $$;

create function learn_import_apply_batch(p_tenant uuid,p_import uuid,p_actor uuid,p_entity text,p_options jsonb,p_rows jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare item jsonb;result jsonb;results jsonb:='[]';seen integer[]:='{}';n integer;fields text[];code text;
begin
 perform learn_import_batch_authority(p_tenant,p_actor);
 if p_entity is null or p_entity not in ('customers','sites','jobs') or jsonb_typeof(p_rows) is distinct from 'array' then
  raise exception 'Governed entity and rows required' using errcode='22023';
 end if;
 if jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Batch must contain 1..100 rows' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'record') is distinct from 'object'
   or jsonb_typeof(item->'row_number') is distinct from 'number' or (item->>'row_number')!~'^[0-9]{1,4}$' then
   raise exception 'Invalid batch row' using errcode='22023';
  end if;
  n:=(item->>'row_number')::integer;
  if n not between 2 and 5001 or n=any(seen) then raise exception 'Duplicate or out-of-range row' using errcode='22023';end if;
  seen:=array_append(seen,n);
  -- Also validates sealed options, entity, row bounds, current role/company/View As.
  -- A contract or authority error aborts the batch, rather than becoming a row failure.
  perform import_row_preamble(p_tenant,p_import,p_actor,n,item->'record',p_options,p_entity);
  if item ? 'invalid_fields' then
   if jsonb_typeof(item->'invalid_fields') is distinct from 'array' then raise exception 'Invalid field list' using errcode='22023';end if;
   if jsonb_array_length(item->'invalid_fields') not between 1 and 20 or exists(select 1 from jsonb_array_elements(item->'invalid_fields') f where jsonb_typeof(f) is distinct from 'string' or length(f#>>'{}') not between 1 and 80) then raise exception 'Invalid field list' using errcode='22023';end if;
   select array_agg(value) into fields from jsonb_array_elements_text(item->'invalid_fields');
   result:=import_row_outcome(p_tenant,p_import,n,'invalid','row failed column validation',fields);
   result:=jsonb_build_object('action',case when (result->>'already')::boolean then 'already_applied' else 'invalid' end);
  else
   -- Isolate row failures in subtransactions; successful rows commit together
   -- at this bounded batch's transaction boundary.
   -- Return SQLSTATE only, never customer values from a database error message.
   -- Edge retains classified failures using the existing outcome recorder. A
   -- lost response requires inspection: a committed batch retains successes,
   -- while a rolled-back batch retains none. Row errors remain unprocessed.
   begin
    case p_entity
     when 'customers' then result:=import_customer_row(p_tenant,p_import,p_actor,n,item->'record',p_options);
     when 'sites' then result:=import_site_row(p_tenant,p_import,p_actor,n,item->'record',p_options);
     when 'jobs' then result:=import_job_row(p_tenant,p_import,p_actor,n,item->'record',p_options);
    end case;
   exception when insufficient_privilege then raise;
    when others then get stacked diagnostics code=returned_sqlstate;result:=jsonb_build_object('error_code',code);
   end;
  end if;
  results:=results||jsonb_build_array(jsonb_build_object('row_number',n,'result',result));
 end loop;
 return results;
end $$;
revoke all on function learn_import_batch_authority(uuid,uuid),learn_import_match_batch(uuid,uuid,text,text,jsonb),learn_import_apply_batch(uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function learn_import_batch_authority(uuid,uuid),learn_import_match_batch(uuid,uuid,text,text,jsonb),learn_import_apply_batch(uuid,uuid,uuid,text,jsonb,jsonb) to service_role;

insert into of_learn_deploy.migrations values('learn_governed_imports_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
