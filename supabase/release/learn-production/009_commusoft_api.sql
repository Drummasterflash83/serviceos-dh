-- DRAFT production Commusoft API. No provider access or activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Commusoft target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_governed_imports_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='33b82c3e902bf4eb1172a6f1750a43ec0b02f69551662eb1392ce4a6bb1d308d') then raise exception 'Pinned production governed-import prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_api_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['learn_business_input_request_gates','learn_business_input_request_permits','learn_business_input_pages','learn_business_input_versions','learn_business_input_observations','learn_business_input_links','learn_business_input_projection_attempts','learn_business_input_projection_batches','learn_operator_input_requests','learn_commusoft_connection_requests','learn_commusoft_verification_requests','learn_commusoft_verification_permits','learn_commusoft_verification_results','learn_commusoft_contact_targets']))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_commusoft_acquire_page','learn_commusoft_defer_page','learn_business_input_retain','learn_commusoft_commit_page','learn_commusoft_committed_page','learn_commusoft_claim_jobs','learn_commusoft_finish_job','learn_commusoft_review_customer','learn_business_input_review_access','learn_business_input_text','learn_business_customer_summary','learn_commusoft_review_connections','learn_commusoft_review_page','learn_commusoft_customer_candidates','learn_commusoft_confirm_customer','learn_business_input_latest','learn_commusoft_property_owner','learn_business_input_projection_result','learn_commusoft_confirm_work_record','learn_commusoft_work_batch','learn_commusoft_work_batch_result','learn_commusoft_work_review_page','learn_operator_input_flags','learn_operator_input_request','learn_operator_inputs','learn_commusoft_configure','learn_commusoft_verification_binding','learn_commusoft_verification_authority','learn_commusoft_verification_receipt','learn_commusoft_verify_request','learn_commusoft_verify_acquire','learn_commusoft_verify_authorized','learn_commusoft_verify_finish','learn_business_contact_phone','learn_commusoft_confirm_contact','learn_commusoft_contact_candidates','learn_operator_resume_commusoft','learn_commusoft_contact_target','learn_commusoft_source_matches','learn_commusoft_review_search','learn_commusoft_work_review_search','learn_business_input_time_detail','learn_commusoft_job_details'])) then
 raise exception 'Production Commusoft candidate already exists; inspect before retry';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['tenants','profiles','view_as_context','config_versions','connector_accounts','provider_connections','provider_connection_events','tenant_connectors','platform_jobs','feature_flags','people','companies','contact_points','customer_cards','sites','jobs','platform_authority_grants','data_imports','import_entity_links','import_row_results','import_profiles','graph_nodes','graph_edges','graph_events','marketing_tags','marketing_segments','marketing_lifecycle_stages']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"companies","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"phone","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"address_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"postcode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5432bdbc84f521fbeb2451145455865c","name":"companies_pkey","valid":true},{"hash":"fc269a5aba437e691699dc5e15eadfa4","name":"companies_tenant_domain_idx","valid":true},{"hash":"01e053c9a52440e526bdec9651204659","name":"companies_tenant_id_uk","valid":true},{"hash":"fb22c282bd61679b4b62d77c9a219662","name":"companies_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"companies_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"291253580df21bff12714595b473a146","name":"companies_set_updated_at","enabled":"O"},{"hash":"780795e08f2f556db33bb7ab3e9af749","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"companies_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"config_versions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"artifact_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"artifact_key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c248d674101d8b24c97279095c3a6dde"},{"name":"supersedes","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"author","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c08e9b72a1f5c2105a2649c074575a84"},{"name":"note","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"payload_hash","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"published_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"d0714a0b99032ac73cb8b84b79a554a5","name":"config_versions_lookup","valid":true},{"hash":"27f7f0de2e695476007b2ee68082c18d","name":"config_versions_pkey","valid":true},{"hash":"13d4094029a2401f65e6ebd9170caabe","name":"config_versions_published_uk","valid":true}],"forceRls":false,"policies":[{"name":"config_versions_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"4da561cf20b60ddd6d041662476ff459","permissive":"PERMISSIVE"}],"triggers":[{"hash":"7c417b821d27e83ff55dbf731af8a1f3","name":"learn_scorecard_revision_immutable","enabled":"O"},{"hash":"97a38f86fce45353cb4c509dd1a3f03f","name":"learn_scorecard_revisions_no_truncate","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"config_versions_pkey","validated":true},{"hash":"64e4f9a670965dbb125f290807ec6f80","kind":"c","name":"config_versions_status_check","validated":true},{"hash":"6ff3b5fcfe868a23f4d1427f16abd05d","kind":"f","name":"config_versions_supersedes_fkey","validated":true},{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"config_versions_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"connector_accounts","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_connector_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"account_key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"settings","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"sync_cursor","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"last_successful_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_failed_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"87038fc7b898fc166bc4afe6e3808ea0","name":"connector_accounts_pkey","valid":true},{"hash":"65449ecbc756cb8abd7ec274359ed101","name":"connector_accounts_tenant_connector_id_account_key_key","valid":true},{"hash":"2b651203438a7f6b7dc3805be39fb611","name":"connector_accounts_tenant_connector_idx","valid":true},{"hash":"a366fa56cd9ccf2d01e76c6c91dd58b6","name":"connector_accounts_tenant_id_idx","valid":true}],"forceRls":false,"policies":[{"name":"connector_accounts_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"11bff68c3a6c7d3d8917929650c7c634","name":"connector_accounts_set_updated_at","enabled":"O"},{"hash":"15acf83bbfeb3b3ad01da15ed046b602","name":"learn_connector_reference_guard","enabled":"O"},{"hash":"e86808e986e786889335c1f286d16df0","name":"learn_connector_retain","enabled":"O"},{"hash":"992d00296f194a61fa9f08ff1de3ba3d","name":"learn_connector_retain_truncate","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"connector_accounts_pkey","validated":true},{"hash":"ce81b1bbe8e19e1ef8737b2016099474","kind":"u","name":"connector_accounts_tenant_connector_id_account_key_key","validated":true},{"hash":"1dec77e8d0a31578e156b528a94701f7","kind":"f","name":"connector_accounts_tenant_connector_id_fkey","validated":true},{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_connector_tenant_fk","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"contact_points","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"channel","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"b67a248b52b38f978a933b263ffad1ba"},{"name":"value","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"normalized_value","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"is_primary","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"verification_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ae78135a76f40a08be4bca5971585398"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c08e9b72a1f5c2105a2649c074575a84"},{"name":"source_record_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_observed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"9181f67f0cc9aba022da75b9378d71ae","name":"contact_points_endpoint_idx","valid":true},{"hash":"26f91ea7e8cba260c8efebbeba1cf989","name":"contact_points_person_idx","valid":true},{"hash":"ddd2ba588cfcb82fda62527060f576bc","name":"contact_points_person_value_uk","valid":true},{"hash":"0acabd6d4d789a0a73cadc9efd85fcbc","name":"contact_points_pkey","valid":true},{"hash":"5e318c7f8f222918352f208e34d39514","name":"contact_points_primary_uk","valid":true},{"hash":"b120aa0f1937597bbe24aa04a26d2a42","name":"contact_points_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"contact_points_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"f561f2d858976074e1c5cf15885a1d7d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"459cf7b338a26d76277057f96c061455","name":"contact_points_set_updated_at","enabled":"O"},{"hash":"101ddec5756b0a1d8c934a3815b3619a","name":"contact_points_tenant_guard","enabled":"O"}],"constraints":[{"hash":"06f1c1faa3504bc7bd74ea6468bbec2d","kind":"c","name":"contact_points_channel_check","validated":true},{"hash":"0c21263bddd28b58a7de36ac14a47c2d","kind":"f","name":"contact_points_person_id_fkey","validated":true},{"hash":"e91e193417d42d74c2a76accd7e1fb9d","kind":"f","name":"contact_points_person_tenant_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"contact_points_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"contact_points_tenant_id_fkey","validated":true},{"hash":"aa8b3887f01bbc4a8634c17f0bda64d3","kind":"c","name":"contact_points_verification_state_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"customer_cards","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"summary","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d2e629d884dd34355a15552e5b518a5"},{"name":"priority","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"85d245f36de3b9cecc91228801a5247d"},{"name":"owner_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"due_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"latest_activity_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recommended_action","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"context","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"assigned_team_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"watchers","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"followers","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"helper_suggestions","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"priority_score","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority_inputs","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"locked_fields","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"a353edc9afd9f0fc7e68f00793ab2cc4","name":"customer_cards_pkey","valid":true},{"hash":"3e66bfccc40049ca8a2bda1f99447e58","name":"customer_cards_tenant_activity_idx","valid":true},{"hash":"e6846f1fa5da9015a49bebc34efc5a0b","name":"customer_cards_tenant_company_idx","valid":true},{"hash":"5266765be7d2d1dbb11d350513b8d662","name":"customer_cards_tenant_person_idx","valid":true},{"hash":"0e7faa01b3e9d4f1ca7ff2b0b22a7762","name":"customer_cards_tenant_priority_idx","valid":true},{"hash":"c627136b94cf9123bfd3e965d14129e9","name":"customer_cards_tenant_score_idx","valid":true},{"hash":"8aec36a2a422bac4e872b104db4e8dc6","name":"customer_cards_tenant_status_idx","valid":true},{"hash":"d0286ddc9d5db787b2e0465dea1a1854","name":"learn_customer_card_company_uk","valid":true},{"hash":"1248c211117be2164f1e12318be31fdc","name":"learn_customer_card_person_uk","valid":true}],"forceRls":false,"policies":[{"name":"customer_cards_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"e9fe5f91503ebba1c507f9e0c30f4f4d","name":"customer_cards_set_updated_at","enabled":"O"},{"hash":"efe1e538d97c8e8cdd6f3def4ce9fb7f","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"c393f886f52b6010a512c5c0980ab536","kind":"f","name":"customer_cards_company_id_fkey","validated":true},{"hash":"bcfe24d956220872d4db2fac32db2f22","kind":"f","name":"customer_cards_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"customer_cards_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"data_imports","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"profile_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"entity_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"original_filename","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"file_checksum","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"file_size","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"storage_path","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"f055f88588e0cc1a81df286181061e9e"},{"name":"row_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"valid_rows","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"invalid_rows","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"created_records","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"updated_records","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"skipped_records","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"duplicate_records","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"conflict_records","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"preview","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"failure","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"import_version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"uploaded_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"1bc9c91a4439fb7763f30a12a10147e3","name":"data_imports_checksum_idx","valid":true},{"hash":"51f3ada29fc6a78b9fe3a61af4a763d6","name":"data_imports_pkey","valid":true},{"hash":"7878cf1c276e70098f0eb93ec8397db0","name":"data_imports_tenant_id_uk","valid":true},{"hash":"80dbea33d8da4ad39d678f0fd2780bb9","name":"data_imports_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"data_imports_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"aef9e1ce50f8f2bb37d23889ffe27c52","name":"data_imports_set_updated_at","enabled":"O"},{"hash":"87e4cc8f1f3ecd568e22b41205fdc39d","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"data_imports_pkey","validated":true},{"hash":"739256ebd7a5ef30d14ef1e56d770b8c","kind":"f","name":"data_imports_profile_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"feature_flags","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"flag","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"value","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"version_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2e8d1320288e4f240aabeaf4c772df0d","name":"feature_flags_natural_uk","valid":true},{"hash":"4a37620023f13aecfadf61f85ed52394","name":"feature_flags_pkey","valid":true}],"forceRls":false,"policies":[{"name":"ff_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"4da561cf20b60ddd6d041662476ff459","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"feature_flags_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"feature_flags_tenant_id_fkey","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"feature_flags_version_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"graph_edges","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"edge_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"from_node_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"to_node_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"properties","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"9105e39ad0f6382f217638800fa5b013","name":"graph_edges_pkey","valid":true},{"hash":"75ea116570fab7a7c7bbea2110b1eaa8","name":"graph_edges_tenant_created_idx","valid":true},{"hash":"9d4c05adb11bdd967b7ab4a63c996b6d","name":"graph_edges_tenant_from_idx","valid":true},{"hash":"f27c970f557e2d014b3778b2bee5782e","name":"graph_edges_tenant_to_idx","valid":true},{"hash":"e27a0bc07fdc583981140e4655a13cb8","name":"graph_edges_tenant_type_idx","valid":true},{"hash":"360140a467dafbfa4a8b445d0dd51449","name":"graph_edges_uk","valid":true}],"forceRls":false,"policies":[{"name":"graph_edges_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"a3175e0d77c41f0021528a530fa63210","name":"graph_edges_set_updated_at","enabled":"O"},{"hash":"4a7e071c1ff583e59417924a47c62b7b","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"86e173a00afc0972684396389fae18d6","kind":"f","name":"graph_edges_from_node_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"graph_edges_pkey","validated":true},{"hash":"e394400eb7483a6e4893ec956097ec08","kind":"f","name":"graph_edges_to_node_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"graph_events","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"event_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"node_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"edge_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_event_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2e2fe303c30e8f41fae2ad7296fbe8a9","name":"graph_events_pkey","valid":true},{"hash":"fe29ee646d9c9a84babfceb427bcdb25","name":"graph_events_tenant_edge_idx","valid":true},{"hash":"4b8ba08d0610c479594f883eaf6cb6cf","name":"graph_events_tenant_node_idx","valid":true},{"hash":"544dc56c4b1a9eea4fe18d5fd26e2c86","name":"graph_events_tenant_type_created_idx","valid":true}],"forceRls":false,"policies":[{"name":"graph_events_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"fa4b7e33bf166a83ddd86b5f1f2c4a1f","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"graph_events_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"graph_nodes","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"node_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_table","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"properties","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"774984bcd5fd2ab92ca3e6619364496d","name":"graph_nodes_pkey","valid":true},{"hash":"e04eed166ae85aa6006fed90f4d72649","name":"graph_nodes_source_uk","valid":true},{"hash":"b79e6a25b52e9a783d30870fd2b3d6f4","name":"graph_nodes_tenant_created_idx","valid":true},{"hash":"756dc7644f1296779abf8fcbcdbfe3c5","name":"graph_nodes_tenant_source_idx","valid":true},{"hash":"0145410027db1618c04f7827de5845a1","name":"graph_nodes_tenant_type_idx","valid":true}],"forceRls":false,"policies":[{"name":"graph_nodes_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8bab0683a0aaa36fa7503751203844f5","name":"graph_nodes_set_updated_at","enabled":"O"},{"hash":"a986b0df019624ddefcf5e10ad135fd4","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"graph_nodes_pkey","validated":true}]},{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"import_entity_links","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"entity_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"external_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"entity_table","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"entity_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"link_strategy","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"import_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"19b248d23b957dc7634e9b9e01bcc14f","name":"import_entity_links_entity_idx","valid":true},{"hash":"d0d4740367ea986f82cb10352fb6f46f","name":"import_entity_links_pkey","valid":true},{"hash":"0f34828d37623b17f792ab40eef58f50","name":"import_entity_links_tenant_id_source_system_entity_kind_ext_key","valid":true}],"forceRls":false,"policies":[{"name":"import_entity_links_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"ee1b7a8240af0c73d6975b978ba0c5cf","name":"import_entity_links_guard","enabled":"O"},{"hash":"1983a08c8220a32b7a521fd82c6b1385","name":"import_entity_links_set_updated_at","enabled":"O"},{"hash":"a6cfdacf4f40eba1fa3390a18388f602","name":"learn_import_customer_card_after_link","enabled":"O"}],"constraints":[{"hash":"14bec2598a908593416d8584327beb6d","kind":"f","name":"iel_import_fk","validated":true},{"hash":"3c390c99d6dc876c501b2a1c98873310","kind":"c","name":"iel_kind_table_check","validated":true},{"hash":"cac847f93b84d593c53f7834f3784916","kind":"c","name":"import_entity_links_entity_kind_check","validated":true},{"hash":"17fd133f0845cf3ddfc4b0eca9e2b7b6","kind":"c","name":"import_entity_links_entity_table_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"import_entity_links_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"import_entity_links_tenant_id_fkey","validated":true},{"hash":"8bed9c87d4cb0a690c5368d6d34c2243","kind":"u","name":"import_entity_links_tenant_id_source_system_entity_kind_ext_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"import_profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"entity_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"definition","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2e9cf5dc540f4b417571a059b4172fe9","name":"import_profiles_pkey","valid":true},{"hash":"e7275d25ff919d0c327c05b28533b392","name":"import_profiles_platform_uk","valid":true},{"hash":"0092a423512b6392dd67918c9fe9957e","name":"import_profiles_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"import_profiles_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"5e04f130ee9396f8722a08e40f559c7a","permissive":"PERMISSIVE"}],"triggers":[{"hash":"e328dc526a840169a8de2f402f178b50","name":"import_profiles_set_updated_at","enabled":"O"},{"hash":"a826f2090927eafe1b7c6c585767e012","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"import_profiles_pkey","validated":true}]},{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"import_row_results","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"import_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"row_number","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"outcome","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"fields","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"entity_table","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"entity_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"conflict_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"attempt","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"08e74e43602d3eb57ec4fbb08769894e","name":"import_row_results_idx","valid":true},{"hash":"56b1e41d0a21e3ff8498f3c9f57f4b07","name":"import_row_results_pkey","valid":true},{"hash":"857791f71a1015894b2dbd43450f1771","name":"import_row_results_tenant_id_import_id_row_number_key","valid":true}],"forceRls":false,"policies":[],"triggers":[{"hash":"5701bed29e43ebc7d4642fdac5396165","name":"import_row_results_guard","enabled":"O"},{"hash":"594092150de1be37ab4c239e2ee2a81a","name":"import_row_results_set_updated_at","enabled":"O"}],"constraints":[{"hash":"17fd133f0845cf3ddfc4b0eca9e2b7b6","kind":"c","name":"import_row_results_entity_table_check","validated":true},{"hash":"688981184a5d3f33375807a8436c3504","kind":"c","name":"import_row_results_outcome_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"import_row_results_pkey","validated":true},{"hash":"04c6ac35a4ca80b11df95a8ac6cfd82b","kind":"c","name":"import_row_results_row_number_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"import_row_results_tenant_id_fkey","validated":true},{"hash":"e3697571adf8ee01d8c2ef59a96d22fc","kind":"u","name":"import_row_results_tenant_id_import_id_row_number_key","validated":true},{"hash":"738c9e7bbc6960e979b3713617979edc","kind":"f","name":"irr_conflict_fk","validated":true},{"hash":"88f7161397541877e3bbc371a16a06dd","kind":"c","name":"irr_entity_shape","validated":true},{"hash":"93eeb0079df872c255e07b7fb8646080","kind":"f","name":"irr_import_fk","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"site_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"engineer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"invoice_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"quote_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"value_pennies","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"booked_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ee37b3b19e0eb6a9ec843fb638bb846b"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"e2b5d04060b50f96e02ff49b339ed40c","name":"jobs_number_uk","valid":true},{"hash":"47262421c727307ac344956cf7d14923","name":"jobs_pkey","valid":true},{"hash":"e34e04d2ff2d6c0312b227bd2c49508c","name":"jobs_source_uk","valid":true},{"hash":"cc280df5dbcf661faf07141d3eecca73","name":"jobs_tenant_customer_idx","valid":true},{"hash":"184a00fe1e8d9d8202141da43859208a","name":"jobs_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"6531df5998769ed5ffb7779d6ce6dfbb","name":"jobs_set_updated_at","enabled":"O"},{"hash":"9e38c2eb0e81c9ead9a4527ff2bc657e","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"08723955dee11c6cd8edfc8398afbaa0","kind":"f","name":"jobs_customer_company_id_fkey","validated":true},{"hash":"916bf00abad8f3f94f73abdcedf20f1d","kind":"f","name":"jobs_customer_person_id_fkey","validated":true},{"hash":"e51bea4de5e209d1bec8820944969827","kind":"f","name":"jobs_engineer_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"jobs_pkey","validated":true},{"hash":"d17aadc9a7f4da0432796d76a1939418","kind":"f","name":"jobs_site_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"marketing_lifecycle_stages","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"stage_key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tone","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"548f5f853dbe8e223b2301f991a0da3a"},{"name":"sort_order","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"terminal_outcome","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"is_default","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"8d2369abb57355be2177f8bb04099f29"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5f107a220e988211c30864c40e5c5e59","name":"marketing_lifecycle_default_uk","valid":true},{"hash":"8ad2a783b5a07831a086bd8e02d61ca4","name":"marketing_lifecycle_stages_pkey","valid":true},{"hash":"69b3591bf05ee12530cffe126009abdd","name":"mls_template_key_uk","valid":true},{"hash":"396d2dc21e72bf14797916dae49d194d","name":"mls_tenant_key_uk","valid":true},{"hash":"d27f2a24499120cb5b0042a0194a6233","name":"mls_tenant_order_idx","valid":true}],"forceRls":false,"policies":[{"name":"marketing_lifecycle_stages_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"85fdb1c9d35c4121b16dec6fcfc0dcf3","permissive":"PERMISSIVE"}],"triggers":[{"hash":"eeb2fdbab623286c4b50fd54e6c49189","name":"mls_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"marketing_lifecycle_stages_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"marketing_lifecycle_stages_tenant_id_fkey","validated":true},{"hash":"1ab7910d07e84a74acd348a4f38cda28","kind":"c","name":"marketing_lifecycle_stages_terminal_outcome_check","validated":true},{"hash":"296126c968859849ed1376483fae86ea","kind":"c","name":"marketing_lifecycle_stages_tone_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"marketing_segments","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"definition","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"definition_version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"estimated_count","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evaluated_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"updated_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"8087c64cf433864998e2a7b9134de9d0","name":"marketing_segments_pkey","valid":true},{"hash":"976395a623774b9e6dfcd69812a5d027","name":"marketing_segments_tenant_id_uk","valid":true},{"hash":"73917a90c331db66cfae8d2433b322f2","name":"marketing_segments_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"marketing_segments_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"f561f2d858976074e1c5cf15885a1d7d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"52898d33615db9bdd886f5662b22b0b3","name":"marketing_segments_set_updated_at","enabled":"O"},{"hash":"6f6cd08d6acd671d4ecddc939fc44c4f","name":"marketing_segments_tenant_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"marketing_segments_pkey","validated":true},{"hash":"bbc3f581b2d27ab6eebb0bf5a18d2c7d","kind":"c","name":"marketing_segments_status_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"marketing_segments_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"marketing_tags","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tone","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"548f5f853dbe8e223b2301f991a0da3a"},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"0c38e7e0916d9a9ccf41fb0c4eb8f2d0","name":"marketing_tags_key_uk","valid":true},{"hash":"02e858cf2572d2d1b87c8de0af079fc3","name":"marketing_tags_pkey","valid":true},{"hash":"4db17421ea4dfcf6ddf234dd76e1e4c1","name":"marketing_tags_tenant_id_uk","valid":true},{"hash":"3dc980590e70b1ce7b28fbae9dc875bd","name":"marketing_tags_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"marketing_tags_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"f561f2d858976074e1c5cf15885a1d7d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"f25cfcc6e733b6c279c216a318fc921f","name":"marketing_tags_set_updated_at","enabled":"O"},{"hash":"5faca92303fde691ef3b1dc0cab4064a","name":"marketing_tags_tenant_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"marketing_tags_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"marketing_tags_tenant_id_fkey","validated":true},{"hash":"296126c968859849ed1376483fae86ea","kind":"c","name":"marketing_tags_tone_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"people","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"first_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"primary_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"primary_phone","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"address_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"postcode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"1a8b3beb83e2f08c9500a4a18238042d","name":"people_pkey","valid":true},{"hash":"1e2102652fc5b864ea0d57177355974f","name":"people_tenant_company_idx","valid":true},{"hash":"cb1a308c5d9e9b5215cd6c95b9457f38","name":"people_tenant_email_idx","valid":true},{"hash":"9b4fe18f0a581f205f2e61e3e4b38164","name":"people_tenant_id_uk","valid":true},{"hash":"fa3e7cb1191bafb9f0e8edd6a6f60434","name":"people_tenant_idx","valid":true},{"hash":"301186b8ad8b84b5970039e703cf0b60","name":"people_tenant_name_idx","valid":true},{"hash":"c8712f809e58386d8e5cc526441e3b9f","name":"people_tenant_phone_idx","valid":true}],"forceRls":false,"policies":[{"name":"people_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"a49717171f853266db7a99a56baaba1c","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"7dd86e31a8486f3dd2deddede5d2eded","name":"people_set_updated_at","enabled":"O"}],"constraints":[{"hash":"c393f886f52b6010a512c5c0980ab536","kind":"f","name":"people_company_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"people_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_authority_grants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"profile_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"permission","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"granted_by","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc97b758bffd09b45099ebab12c88e76"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"7203023825de39b8d2b239a3df06b89c","name":"pag_active_uk","valid":true},{"hash":"7815833259b2bc3637228c97fbc18e9a","name":"pag_profile","valid":true},{"hash":"075f7de621b125970296a39f8ad10de6","name":"platform_authority_grants_pkey","valid":true}],"forceRls":false,"policies":[{"name":"platform_authority_grants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"ab3044cecbbd365f8b11b781f958e96f","permissive":"PERMISSIVE"}],"triggers":[{"hash":"63a86109bbf433dc05eee635c79ddd44","name":"pag_set_updated_at","enabled":"O"}],"constraints":[{"hash":"6955543725589d3d6e35aa41f8b28493","kind":"f","name":"platform_authority_grants_permission_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_authority_grants_pkey","validated":true},{"hash":"f988a65e629c3c1eeeeabe337f44b428","kind":"f","name":"platform_authority_grants_profile_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"module_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"job_key","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"7c86ea6e5094355ad44b6867fa51b433"},{"name":"priority","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"f899139df5e1059396431415e770c6dd"},{"name":"progress_current","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"progress_total","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"attempt_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"max_attempts","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"eccbc87e4b5ce2fe28308fd9f2a7baf3"},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"failed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cancelled_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"next_run_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"result","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"available_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"lease_expires_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"dead_lettered_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"error_code","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"parent_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"e8ec53579fc23c9f8c7ec9cbcc9a0fe8","name":"platform_jobs_active_job_key_uk","valid":true},{"hash":"0c8ea2ecee43cf1b569083bac92b3889","name":"platform_jobs_claim_idx","valid":true},{"hash":"95f16cdddc29e798beb223f90905fec3","name":"platform_jobs_lease_idx","valid":true},{"hash":"a2be2946f7e3402dc0501da0f336f113","name":"platform_jobs_parent_idx","valid":true},{"hash":"f8699761f53393f77b94bc724a99e825","name":"platform_jobs_pkey","valid":true},{"hash":"95bfc00526e7f302fb99702339694c04","name":"platform_jobs_tenant_connector_idx","valid":true},{"hash":"1ed91a0d9b3bf296158e7c4558ce3189","name":"platform_jobs_tenant_next_run_idx","valid":true},{"hash":"a22868c903eedcb64e7366fb3249911f","name":"platform_jobs_tenant_status_idx","valid":true},{"hash":"a3359af1d6c9ed909e3b424d77e7a174","name":"platform_jobs_tenant_type_idx","valid":true}],"forceRls":false,"policies":[{"name":"platform_jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"885bc7f92806b78eac67d45a9143c9ca","name":"platform_jobs_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_jobs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"full_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ebe5151db32cb9795191097a4f9511a9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b7142bbffc23de763c1bd9f00489ec05","name":"profiles_pkey","valid":true},{"hash":"c07a523f1ebc968ab6b32bd5c984f32b","name":"profiles_role_idx","valid":true},{"hash":"610436088a5788625dd6956b9059f8c9","name":"profiles_tenant_id_idx","valid":true},{"hash":"84b975915f84814cf35c7604d4f94ecf","name":"profiles_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_profile","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"profiles_select_own","roles":["public"],"command":"SELECT","checkHash":null,"usingHash":"bc9c729a84690340789a4e4f01175335","permissive":"PERMISSIVE"}],"triggers":[{"hash":"bb3752d7064fd9e06fbe457f475928cc","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"83b0936855bf3bb7daa4f8356eb3c926","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a97ecad600d272e906bb06dea0b91c4","name":"profiles_set_updated_at","enabled":"O"}],"constraints":[{"hash":"0061c9fb3a9abcf2edbcd4a42467a9c3","kind":"f","name":"profiles_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"profiles_pkey","validated":true},{"hash":"4b3bd90c7f38a26788aecebbe2479ad7","kind":"c","name":"profiles_role_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"provider_connection_events","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"event","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"detail","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"922082f60531c1908713a0e5370d9be6","name":"provider_connection_events_pkey","valid":true},{"hash":"0d33b21429d031aa957f749f757bf264","name":"provider_connection_events_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"provider_connection_events_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"47194dc6d44a597c87dd41427d70d866","name":"learn_provider_events_retain","enabled":"O"},{"hash":"0526f671b055624b632c7c977d9ab5e9","name":"learn_provider_events_retain_truncate","enabled":"O"}],"constraints":[{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_provider_event_tenant_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"provider_connection_events_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"provider_connections","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"0559cbfcad8ccb1a01b1bc92200b821a"},{"name":"auth_mode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"account_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"non_secret_config","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"configured_fields","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"secret_refs","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"verified_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_test","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"updated_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"revoked_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"revoked_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"36a25605cb477bfe7168236a8e6b767f","name":"provider_connections_pkey","valid":true},{"hash":"3f743b104a717ded94bace2427a3c30e","name":"provider_connections_tenant_provider_uk","valid":true}],"forceRls":false,"policies":[{"name":"provider_connections_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"dd5c82527d95c5d3b81ada924f201aa0","name":"learn_connector_reference_guard","enabled":"O"},{"hash":"c4f71fe144f25be6cab87bcd0ea10768","name":"learn_connector_retain","enabled":"O"},{"hash":"d96a4bb1779d363cecdca0b0417ca5b9","name":"learn_connector_retain_truncate","enabled":"O"},{"hash":"887c6c309bc52d55fe3e3bfef5fd54ac","name":"provider_connections_set_updated_at","enabled":"O"}],"constraints":[{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_connector_tenant_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"provider_connections_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"sites","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"address_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"postcode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ee37b3b19e0eb6a9ec843fb638bb846b"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"db11bebb617b7cb1565ee66b7abf621d","name":"sites_pkey","valid":true},{"hash":"25f0a10f9e618e7f684aa2e2d7baec5a","name":"sites_source_uk","valid":true},{"hash":"46840696beb4d91590d8e64c152aefcb","name":"sites_tenant_idx","valid":true},{"hash":"3866cde8dab18c2dcd81931a079f345d","name":"sites_tenant_postcode_idx","valid":true}],"forceRls":false,"policies":[{"name":"sites_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"145981fe4f7485544cdeb6f3553b7926","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"b16b17b99256b41ecefa302ae59a1ff7","name":"sites_set_updated_at","enabled":"O"}],"constraints":[{"hash":"c393f886f52b6010a512c5c0980ab536","kind":"f","name":"sites_company_id_fkey","validated":true},{"hash":"bcfe24d956220872d4db2fac32db2f22","kind":"f","name":"sites_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"sites_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenant_connectors","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"category","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"5dbf8349d9384bba7422dab65d75d428"},{"name":"health_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"enabled","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"settings","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"last_successful_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_failed_sync_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"2a999164558672de593a5cee2ad1199a","name":"tenant_connectors_pkey","valid":true},{"hash":"6909a1d595c44c251b88ae925a11c1ed","name":"tenant_connectors_tenant_id_connector_id_key","valid":true},{"hash":"b0d64bed4b9196a44db82e7ae165547f","name":"tenant_connectors_tenant_id_idx","valid":true}],"forceRls":false,"policies":[{"name":"tenant_connectors_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"45a4a9345cd9fdacc7eec28d9e54eed7","name":"learn_connector_reference_guard","enabled":"O"},{"hash":"9902ab88fa7717f94aad8e8d210311f1","name":"learn_connector_retain","enabled":"O"},{"hash":"69e86bf6f6593d14968522a1e6958d38","name":"learn_connector_retain_truncate","enabled":"O"},{"hash":"05f7b4b7a819d47c4f9215eed99d9365","name":"tenant_connectors_set_updated_at","enabled":"O"}],"constraints":[{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_connector_tenant_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenant_connectors_pkey","validated":true},{"hash":"24cb83f88599181c6922a60d2bfb8328","kind":"u","name":"tenant_connectors_tenant_id_connector_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"slug","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"industry","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5284b9c618f8618b72a402ea2c593753","name":"tenants_pkey","valid":true},{"hash":"6260c986ce2d58a0ad3de3f74ec6eb6f","name":"tenants_slug_key","valid":true}],"forceRls":false,"policies":[{"name":"tenants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"831f798d620de1d73971187d41079b4d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8009f8efa07661ab809d3f9e077da55e","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"742cd63e2f0ed7809f0911b17d02869d","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a4d62ca55c88b97023eab7696e527ce","name":"tenants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenants_pkey","validated":true},{"hash":"687397275d0e852fb2a4b50394adffee","kind":"u","name":"tenants_slug_key","validated":true},{"hash":"7702cc7b97df1ebce81e13bb05db5c2d","kind":"c","name":"tenants_status_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"view_as_context","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor_user_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"mode","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d3f83345a22c6bbd79692e353599f18"},{"name":"read_only","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"expires_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"dae782846028bc8168db98a8dd4b9193"},{"name":"ended_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5325064a8cf3f1e500b2308ea36b3343","name":"view_as_actor","valid":true},{"hash":"3b4560fae7e0f79297469f029ab77627","name":"view_as_context_pkey","valid":true}],"forceRls":false,"policies":[{"name":"view_as_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"565594dabafccb3adbde49e7a3f8790a","permissive":"PERMISSIVE"}],"triggers":[{"hash":"aaf4c57e4c5a9674a6979f95139e4746","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"1b0ebc4a05c69edafb63e927ba619765","name":"learn_work_authority_truncate_lock","enabled":"O"}],"constraints":[{"hash":"db8d41fae95b78d4a530a37cc023f719","kind":"c","name":"view_as_context_mode_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"view_as_context_pkey","validated":true},{"hash":"9579aceb86350661ce8f9dd1b4211a9b","kind":"c","name":"view_as_context_subject_kind_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"view_as_context_tenant_id_fkey","validated":true}]}]'::jsonb then raise exception 'Production Commusoft table baseline differs';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['platform_jobs_claim','current_tenant_id','current_user_role','current_user_is_openfolk_operator','provider_secret_name','provider_secret_store','learn_operator_input_immutable','learn_operator_input_access','learn_import_batch_authority','learn_import_customer_card','marketing_tenant_guard']);
 if actual_helpers is distinct from '[{"hash":"58873c19368521e21e846890ee429301","name":"current_tenant_id","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"e902fd2c89c12fda752bf28e32acfcb3","name":"current_user_is_openfolk_operator","owner":"postgres","arguments":"required_permission text","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"760512ca1d1f925421f3faf36e9d4447","name":"current_user_role","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"4b4020b92092a7f09453f765a55dee65","name":"learn_import_batch_authority","owner":"postgres","arguments":"p_tenant uuid, p_actor uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"2995186c9e040ea71cc27a923038976d","name":"learn_import_customer_card","owner":"postgres","arguments":"p_tenant uuid, p_link uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"6ebce242963afa929b7465a99e7608c6","name":"learn_operator_input_access","owner":"postgres","arguments":"p_tenant uuid, p_actor uuid, p_write boolean","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"0f17d77fbd9a9d6e3d9cff0c0ccee5c1","name":"learn_operator_input_immutable","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"88dd71100f8ea7839af280f731768d3c","name":"marketing_tenant_guard","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"832d06462993f871357df525d840d5ae","name":"platform_jobs_claim","owner":"postgres","arguments":"p_worker text, p_batch integer, p_lease_seconds integer, p_job_types text[]","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"a853b2571703b5ab413e5b9e0ed5b24b","name":"provider_secret_name","owner":"postgres","arguments":"p_tenant uuid, p_provider text, p_field text","anonExecute":false,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"0b83ec195b6c4a23ef61583ae1af2813","name":"provider_secret_store","owner":"postgres","arguments":"p_tenant uuid, p_provider text, p_field text, p_secret text","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false}]'::jsonb then raise exception 'Production Commusoft helper baseline differs';end if;
 if not exists(select 1 from pg_extension where extname='supabase_vault' and extversion='0.3.1') or not has_schema_privilege('postgres','vault','USAGE') or not has_table_privilege('postgres','vault.decrypted_secrets','SELECT') then raise exception 'Existing Vault prerequisite unavailable';end if;
end $$;
-- Existing operator grants and source tables remain intact. No controls are activated.
-- INPUT supabase/migrations/20261031090000_learn_commusoft_page_permits.sql
-- Server-only credential release and shared pacing. No credentials, flags,
-- approvals, jobs or provider requests are created by installing this migration.

create table public.learn_business_input_request_gates (
  credential_fingerprint text primary key,
  next_allowed_at timestamptz not null
);
create table public.learn_business_input_request_permits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null,
  claimed_by text not null,
  attempt_count integer not null,
  binding jsonb not null,
  credential_fingerprint text not null references public.learn_business_input_request_gates(credential_fingerprint),
  requested_at timestamptz not null default clock_timestamp(),
  unique(job_id,attempt_count)
);
alter table public.learn_business_input_request_gates enable row level security;
alter table public.learn_business_input_request_permits enable row level security;
revoke all on public.learn_business_input_request_gates,public.learn_business_input_request_permits
  from public,anon,authenticated,service_role;

create function public.learn_commusoft_acquire_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_expected jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  j public.platform_jobs%rowtype;
  a public.connector_accounts%rowtype;
  c public.provider_connections%rowtype;
  cfg jsonb; cp jsonb; req jsonb; pages integer; after_id bigint; flag_name text;
  secret text; fingerprint text; next_at timestamptz; permit_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'commusoft_permit_forbidden' using errcode='42501';
  end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'commusoft_permit_snapshot' using errcode='22023';
  end if;
  if p_tenant_id is null or p_job_id is null or nullif(btrim(p_claimed_by),'') is null
     or p_attempt_count is null or p_attempt_count<1 or jsonb_typeof(p_expected) is distinct from 'object'
     or p_expected->>'tenantId' is distinct from p_tenant_id::text
     or p_expected->>'jobId' is distinct from p_job_id::text then return null; end if;

  select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
  if not found or j.job_type is distinct from 'commusoft.source_sync' or j.status is distinct from 'running'
     or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count
     or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp() then return null; end if;
  perform 1 from public.tenants where id=p_tenant_id and status='active' for share;
  if not found then return null; end if;
  foreach flag_name in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
    perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag=flag_name and value='true'::jsonb for share;
    if not found then return null; end if;
  end loop;
  select * into a from public.connector_accounts where id::text=j.payload->>'connector_account_id'
    and tenant_id=p_tenant_id for share;
  if not found or a.status is distinct from 'active' or a.id::text is distinct from p_expected->>'accountId'
     or nullif(btrim(a.account_key),'') is null or length(a.account_key)>2000
     or a.tenant_connector_id::text is distinct from p_expected->>'connectorId'
     or a.sync_cursor is distinct from p_expected->'checkpoint' then return null; end if;
  perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
    and connector_id='commusoft' and provider='commusoft' and enabled and status='active' for share;
  if not found then return null; end if;
  cfg:=a.settings->'commusoft_import';
  if jsonb_typeof(cfg) is distinct from 'object' or cfg is distinct from p_expected->'approval'
     or cfg->'approved' is distinct from 'true'::jsonb
     or (cfg->>'approvalId')::uuid is null or (cfg->>'connectionId')::uuid is null
     or nullif(btrim(cfg->>'consentReference'),'') is null or length(cfg->>'consentReference')>2000
     or coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
     or jsonb_typeof(cfg->'maxPages') is distinct from 'number' or (cfg->>'maxPages')::integer not between 1 and 10000
     or jsonb_typeof(cfg->'pageSize') is distinct from 'number' or (cfg->>'pageSize')::integer not between 1 and 100
     or coalesce(cfg->>'resource','') not in ('properties','propertyContacts','jobs') then return null; end if;
  if cfg->>'resource'='propertyContacts' then
    if coalesce(cfg->>'contactType','') not in ('customer','workaddress') then return null; end if;
  elsif cfg ? 'contactType' then return null; end if;

  select * into c from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant_id for share;
  if not found or c.id::text is distinct from p_expected->>'connectionId' or c.provider is distinct from 'commusoft'
     or c.status is distinct from 'configured' or c.auth_mode is distinct from 'private_api_key'
     or c.revoked_at is not null or c.verified_at is null or c.verified_at>clock_timestamp()
     or c.updated_at is null or c.updated_at is distinct from (p_expected->>'connectionRevision')::timestamptz
     or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
     or c.non_secret_config->>'account_key' is distinct from a.account_key
     or not coalesce('api_key'=any(c.configured_fields),false)
     or c.secret_refs->>'api_key' is distinct from p_expected->>'secretId' then return null; end if;

  cp:=a.sync_cursor;
  if cp='{}'::jsonb then cp:=jsonb_build_object('approvalId',cfg->>'approvalId','after',null,'pages',0,'complete',false); end if;
  if jsonb_typeof(cp) is distinct from 'object' or cp->>'approvalId' is distinct from cfg->>'approvalId'
     or jsonb_typeof(cp->'pages') is distinct from 'number' or cp->'complete' is distinct from 'false'::jsonb then return null; end if;
  pages:=(cp->>'pages')::integer;
  if pages<0 or pages>=(cfg->>'maxPages')::integer then return null; end if;
  if cp->'after'='null'::jsonb then after_id:=null;
  elsif jsonb_typeof(cp->'after')='number' then after_id:=(cp->>'after')::bigint;
  else return null; end if;
  if pages=0 and after_id is not null or pages>0 and (after_id is null or after_id<1 or after_id>9007199254740991) then return null; end if;
  req:=jsonb_build_object('region',c.non_secret_config->>'region','resource',cfg->>'resource','after',after_id,'limit',(cfg->>'pageSize')::integer);
  if cfg->>'resource'='propertyContacts' then req:=req||jsonb_build_object('contactType',cfg->>'contactType'); end if;
  if req is distinct from p_expected->'request' or p_expected->'pages' is distinct from to_jsonb(pages)
     or p_expected->'complete' is distinct from 'false'::jsonb then return null; end if;

  -- A repeated acquisition cannot release a second credential for this attempt.
  -- An uncertain response is not retried inline; recovery uses a new queue attempt.
  if exists(select 1 from public.learn_business_input_request_permits where job_id=j.id and attempt_count=p_attempt_count) then return null; end if;
  select decrypted_secret into secret from vault.decrypted_secrets
    where id=(c.secret_refs->>'api_key')::uuid and name='provider_secret:'||p_tenant_id::text||':commusoft:api_key';
  if secret is null or length(secret) not between 1 and 4096 or secret !~ '^[!-~]+$' then return null; end if;
  -- The same key stored in different tenant Vault entries still shares quota.
  -- Fingerprints are infrastructure-private, never returned to a worker/client.
  fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
  insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
  select next_allowed_at into next_at from public.learn_business_input_request_gates
    where credential_fingerprint=fingerprint for update;
  if j.lease_expires_at<=clock_timestamp() or (cfg->>'expiresAt')::timestamptz<=clock_timestamp() then return null; end if;
  if next_at>clock_timestamp() then
    return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from next_at)*1000)::bigint);
  end if;
  -- 48 reservations/minute leaves room below the documented 60/minute ceiling.
  update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds'
    where credential_fingerprint=fingerprint;
  insert into public.learn_business_input_request_permits(tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
    values(p_tenant_id,p_job_id,p_claimed_by,p_attempt_count,
      jsonb_build_object('accountId',a.id,'connectorId',a.tenant_connector_id,'connectionId',c.id,
        'connectionRevision',c.updated_at,'secretId',c.secret_refs->>'api_key',
        'approval',cfg,'checkpoint',a.sync_cursor,'request',req),fingerprint) returning id into permit_id;
  -- Short send window prevents delayed workers banking reservations for a burst.
  return jsonb_build_object('state','ready','apiKey',secret,'permitId',permit_id,
    'sendBefore',floor(extract(epoch from clock_timestamp()+interval '5 seconds')*1000)::bigint);
end $$;

create function public.learn_commusoft_defer_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_permit_id uuid,p_retry_at timestamptz
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare permit public.learn_business_input_request_permits%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'commusoft_permit_forbidden' using errcode='42501'; end if;
  if p_retry_at is null or not isfinite(p_retry_at) then return false; end if;
  select * into permit from public.learn_business_input_request_permits where id=p_permit_id
    and tenant_id=p_tenant_id and job_id=p_job_id and claimed_by=p_claimed_by and attempt_count=p_attempt_count;
  if not found then return false; end if;
  -- A delayed 429 still protects other workers after the original job/connection
  -- changes. The acquired permit, not current approval, authorizes only extending
  -- this existing shared gate. Never move the gate backwards or release a key.
  update public.learn_business_input_request_gates set next_allowed_at=greatest(next_allowed_at,p_retry_at)
    where credential_fingerprint=permit.credential_fingerprint;
  return found;
end $$;

revoke all on function public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb),
  public.learn_commusoft_defer_page(uuid,uuid,text,integer,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb),
  public.learn_commusoft_defer_page(uuid,uuid,text,integer,uuid,timestamptz) to service_role;

-- INPUT supabase/migrations/20261031100000_learn_business_input_pages.sql
-- Retained provider-neutral source pages/versions. No canonical projection,
-- scheduler, provider call, backfill or deletion of existing source data.

create table public.learn_business_input_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  connection_id uuid not null,
  provider text not null,
  collection text not null,
  job_id uuid not null unique,
  permit_id uuid not null unique references public.learn_business_input_request_permits(id) on delete restrict,
  envelope jsonb not null,
  checkpoint_before jsonb not null,
  checkpoint_after jsonb not null,
  record_count integer not null,
  committed_at timestamptz not null default clock_timestamp()
);
create table public.learn_business_input_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  connection_id uuid not null,
  provider text not null,
  collection text not null,
  external_id text not null,
  content_hash text not null,
  payload jsonb not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,connection_id,provider,collection,external_id,content_hash)
);
create table public.learn_business_input_observations (
  page_id uuid not null references public.learn_business_input_pages(id) on delete restrict,
  version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
  ordinal integer not null,
  primary key(page_id,ordinal),
  unique(page_id,version_id)
);
alter table public.learn_business_input_pages enable row level security;
alter table public.learn_business_input_versions enable row level security;
alter table public.learn_business_input_observations enable row level security;
revoke all on public.learn_business_input_pages,public.learn_business_input_versions,public.learn_business_input_observations
  from public,anon,authenticated,service_role;

create function public.learn_business_input_retain() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'business_input_history_retained' using errcode='42501';end $$;
revoke all on function public.learn_business_input_retain() from public,anon,authenticated,service_role;
do $$declare t text;begin
  foreach t in array array['learn_business_input_pages','learn_business_input_versions','learn_business_input_observations'] loop
    execute format('create trigger retain_rows before update or delete on public.%I for each row execute function public.learn_business_input_retain()',t);
    execute format('create trigger retain_all before truncate on public.%I for each statement execute function public.learn_business_input_retain()',t);
  end loop;
end $$;

-- An already committed job must be settled, never fetch another page on retry.
do $$declare definition text; needle text:='  -- A repeated acquisition cannot release a second credential for this attempt.';begin
  definition:=pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure);
  if position(needle in definition)=0 or position('commusoft_page_v1' in definition)>0 then
    raise exception 'commusoft_acquisition_contract_changed';
  end if;
  execute replace(definition,needle,'  if coalesce(j.metadata,''{}''::jsonb) ? ''commusoft_page_v1'' then return null; end if;'||chr(10)||needle);
end $$;

create function public.learn_commusoft_commit_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_permit_id uuid,p_envelope jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  permit public.learn_business_input_request_permits%rowtype;
  prior public.learn_business_input_pages%rowtype;
  j public.platform_jobs%rowtype;
  a public.connector_accounts%rowtype;
  connection public.provider_connections%rowtype;
  b jsonb; cfg jsonb; cp jsonb; next_cp jsonb; receipt jsonb; flag_name text;
  page_id uuid; version_id uuid; item jsonb; item_id bigint; previous_id bigint; next_id bigint;
  n integer:=0; pages integer; has_more boolean; v_hash text; saved_payload jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'commusoft_publication_forbidden' using errcode='42501';end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'commusoft_publication_snapshot' using errcode='22023';end if;
  -- Serialize against acquisition and concurrent/repeated publication for this job.
  select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'commusoft_job_unavailable' using errcode='42501';end if;
  select * into permit from public.learn_business_input_request_permits where id=p_permit_id and tenant_id=p_tenant_id
    and job_id=p_job_id and claimed_by=p_claimed_by and attempt_count=p_attempt_count;
  if not found then raise exception 'commusoft_permit_unavailable' using errcode='42501';end if;
  select * into prior from public.learn_business_input_pages where permit_id=p_permit_id;
  if found then
    if prior.envelope is distinct from p_envelope then raise exception 'commusoft_page_conflict' using errcode='PT409';end if;
    -- Exact replay acknowledges retained data without changing it or acquiring authority.
    return jsonb_build_object('pageId',prior.id,'checkpoint',prior.checkpoint_after,'records',prior.record_count,'already',true);
  end if;
  if j.job_type is distinct from 'commusoft.source_sync' or j.status is distinct from 'running'
    or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count
    or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp()
    or coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1' then raise exception 'commusoft_job_unavailable' using errcode='42501';end if;
  perform 1 from public.tenants where id=p_tenant_id and status='active' for share;
  if not found then raise exception 'commusoft_tenant_unavailable' using errcode='42501';end if;
  foreach flag_name in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
    perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag=flag_name and value='true'::jsonb for share;
    if not found then raise exception 'commusoft_module_unavailable' using errcode='42501';end if;
  end loop;
  b:=permit.binding; cfg:=b->'approval'; cp:=b->'checkpoint';
  select * into a from public.connector_accounts where id::text=b->>'accountId' and tenant_id=p_tenant_id for update;
  if not found or a.id::text is distinct from j.payload->>'connector_account_id' or a.status is distinct from 'active'
    or a.tenant_connector_id::text is distinct from b->>'connectorId'
    or a.settings->'commusoft_import' is distinct from cfg or a.sync_cursor is distinct from cp
    or coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp() then
    raise exception 'commusoft_scope_changed' using errcode='PT409';end if;
  perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
    and connector_id='commusoft' and provider='commusoft' and enabled and status='active' for share;
  if not found then raise exception 'commusoft_connector_unavailable' using errcode='42501';end if;
  select * into connection from public.provider_connections where id::text=b->>'connectionId' and tenant_id=p_tenant_id for share;
  if not found or connection.provider is distinct from 'commusoft' or connection.status is distinct from 'configured'
    or connection.auth_mode is distinct from 'private_api_key' or connection.revoked_at is not null
    or connection.verified_at is null or connection.verified_at>clock_timestamp()
    or connection.updated_at is distinct from (b->>'connectionRevision')::timestamptz
    or connection.non_secret_config->>'account_key' is distinct from a.account_key
    or connection.non_secret_config->>'region' is distinct from b->'request'->>'region'
    or not coalesce('api_key'=any(connection.configured_fields),false)
    or connection.secret_refs->>'api_key' is distinct from b->>'secretId' then
    raise exception 'commusoft_connection_changed' using errcode='42501';end if;

  if jsonb_typeof(p_envelope) is distinct from 'object' or octet_length(p_envelope::text)>4194304
    or jsonb_typeof(p_envelope->'data') is distinct from 'array'
    or jsonb_array_length(p_envelope->'data')>(b->'request'->>'limit')::integer
    or jsonb_typeof(p_envelope->'pagination') is distinct from 'object'
    or jsonb_typeof(p_envelope->'pagination'->'hasMore') is distinct from 'boolean' then
    raise exception 'commusoft_page_invalid' using errcode='22023';end if;
  has_more:=(p_envelope->'pagination'->>'hasMore')::boolean;
  previous_id:=coalesce((b->'request'->>'after')::bigint,0);
  pages:=case when cp='{}'::jsonb then 0 else (cp->>'pages')::integer end;
  next_cp:=jsonb_build_object('approvalId',cfg->>'approvalId','after',null,'pages',pages+1,'complete',not has_more);
  page_id:=gen_random_uuid();
  -- Stage checkpoint in a local variable; immutable page is inserted after validation.
  for item in select value from jsonb_array_elements(p_envelope->'data') loop
    if jsonb_typeof(item) is distinct from 'object' or octet_length(item::text)>524288
      or jsonb_typeof(item->'id') is distinct from 'number' or (item->>'id') !~ '^[0-9]+$' then
      raise exception 'commusoft_record_invalid' using errcode='22023';end if;
    item_id:=(item->>'id')::bigint;
    if item_id<=previous_id or item_id>9007199254740991 then raise exception 'commusoft_record_order_invalid' using errcode='22023';end if;
    previous_id:=item_id; n:=n+1;
  end loop;
  if p_envelope->'pagination'->'nextCursor' is null or p_envelope->'pagination'->'nextCursor'='null'::jsonb then next_id:=null;
  elsif jsonb_typeof(p_envelope->'pagination'->'nextCursor')='number' and p_envelope->'pagination'->>'nextCursor' ~ '^[0-9]+$' then
    next_id:=(p_envelope->'pagination'->>'nextCursor')::bigint;
  else raise exception 'commusoft_cursor_invalid' using errcode='22023';end if;
  if has_more and (n=0 or next_id is null or next_id<>previous_id) or
     not has_more and next_id is not null and next_id<>0 and next_id<>previous_id then
    raise exception 'commusoft_cursor_invalid' using errcode='22023';end if;
  if has_more then next_cp:=jsonb_set(next_cp,'{after}',to_jsonb(next_id));end if;
  insert into public.learn_business_input_pages(id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,checkpoint_before,checkpoint_after,record_count)
    values(page_id,p_tenant_id,connection.id,'commusoft',b->'request'->>'resource',p_job_id,p_permit_id,p_envelope,cp,next_cp,n);
  n:=0;
  for item in select value from jsonb_array_elements(p_envelope->'data') loop
    n:=n+1; v_hash:=encode(sha256(convert_to(item::text,'UTF8')),'hex');
    insert into public.learn_business_input_versions(tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
      values(p_tenant_id,connection.id,'commusoft',b->'request'->>'resource',item->>'id',v_hash,item)
      on conflict(tenant_id,connection_id,provider,collection,external_id,content_hash) do nothing;
    select v.id,v.payload into version_id,saved_payload from public.learn_business_input_versions v where v.tenant_id=p_tenant_id
      and v.connection_id=connection.id and v.provider='commusoft' and v.collection=b->'request'->>'resource'
      and v.external_id=item->>'id' and v.content_hash=v_hash;
    if version_id is null or saved_payload is distinct from item then raise exception 'commusoft_version_conflict' using errcode='PT409';end if;
    insert into public.learn_business_input_observations values(page_id,version_id,n);
  end loop;
  if j.lease_expires_at<=clock_timestamp() or (cfg->>'expiresAt')::timestamptz<=clock_timestamp() then
    raise exception 'commusoft_authority_expired' using errcode='42501';end if;
  update public.connector_accounts set sync_cursor=next_cp where id=a.id and tenant_id=p_tenant_id;
  receipt:=jsonb_build_object('pageId',page_id,'checkpoint',next_cp,'records',n,'already',false);
  update public.platform_jobs set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('commusoft_page_v1',receipt) where id=j.id;
  return receipt;
end $$;
revoke all on function public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb) to service_role;

-- Recovery before any provider acquisition: a new queue attempt may acknowledge
-- an older committed page without obtaining its credential or reading its source.
create function public.learn_commusoft_committed_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;p public.learn_business_input_pages%rowtype;begin
  if auth.role() is distinct from 'service_role' then raise exception 'commusoft_receipt_forbidden' using errcode='42501';end if;
  select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for share;
  if not found or j.job_type is distinct from 'commusoft.source_sync' or j.status is distinct from 'running'
    or p_claimed_by is null or j.claimed_by is distinct from p_claimed_by or p_attempt_count is null
    or j.attempt_count is distinct from p_attempt_count or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp() then
    raise exception 'commusoft_job_unavailable' using errcode='42501';end if;
  select * into p from public.learn_business_input_pages where job_id=p_job_id and tenant_id=p_tenant_id;
  if not found then
    if coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1' then raise exception 'commusoft_receipt_missing' using errcode='PT409';end if;
    return null;
  end if;
  if j.metadata->'commusoft_page_v1' is distinct from jsonb_build_object('pageId',p.id,'checkpoint',p.checkpoint_after,'records',p.record_count,'already',false) then
    raise exception 'commusoft_receipt_mismatch' using errcode='PT409';end if;
  return jsonb_build_object('pageId',p.id,'checkpoint',p.checkpoint_after,'records',p.record_count,'already',true);
end $$;
revoke all on function public.learn_commusoft_committed_page(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.learn_commusoft_committed_page(uuid,uuid,text,integer) to service_role;

-- INPUT supabase/migrations/20261031110000_learn_commusoft_worker.sql
-- Dedicated durable worker. No schedule, keys, flags, approvals or queue seed.

do $$declare d text;needle text:='where c.status in (''queued'', ''retrying'')';begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'commusoft_generic_claim_changed';end if;
 execute replace(d,needle,needle||chr(10)||'      and c.job_type <> ''commusoft.source_sync''');
end $$;
-- Bind the durable job key to its approval before any credential release.
do $$declare d text;needle text:='  select * into c from public.provider_connections';begin
 d:=pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure);
 if position(needle in d)=0 then raise exception 'commusoft_acquisition_contract_changed';end if;
 execute replace(d,needle,'  if j.job_key is distinct from ''commusoft.source:''||a.id::text||'':''||(cfg->>''approvalId'') then return null;end if;'||chr(10)||needle);
end $$;

-- The job's approval identity must also survive through publication.
do $$declare d text;needle text:='  b:=permit.binding; cfg:=b->''approval''; cp:=b->''checkpoint'';';begin
 d:=pg_get_functiondef('public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb)'::regprocedure);
 if position(needle in d)=0 then raise exception 'commusoft_publication_contract_changed';end if;
 execute replace(d,needle,needle||chr(10)||'  if j.job_key is distinct from ''commusoft.source:''||(b->>''accountId'')||'':''||(cfg->>''approvalId'') then raise exception ''commusoft_queue_identity'' using errcode=''PT409'';end if;');
end $$;

create function public.learn_commusoft_claim_jobs(p_worker uuid)
returns setof public.platform_jobs language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'commusoft_queue_forbidden' using errcode='42501';end if;
 if p_worker is null or current_setting('transaction_isolation')<>'read committed' then raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
 for j in select * from public.platform_jobs q where q.job_type='commusoft.source_sync'
   and q.status in ('queued','retrying','running') and coalesce(q.available_at,'-infinity')<=clock_timestamp()
   and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp()
   order by q.priority,q.created_at,q.id for update skip locked limit 1
 loop
   if j.attempt_count is null or j.attempt_count<0 or j.max_attempts is null or j.max_attempts<1 or
     (j.attempt_count>=j.max_attempts and not exists(select 1 from public.learn_business_input_pages p where p.job_id=j.id and p.tenant_id=j.tenant_id)) then
     update public.platform_jobs set status='dead_letter',dead_lettered_at=clock_timestamp(),failed_at=clock_timestamp(),
       lease_expires_at=null,error_code='commusoft_attempts_exhausted' where id=j.id;
   else
     update public.platform_jobs set status='running',claimed_by='learn-commusoft:'||p_worker::text,
       claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '180 seconds',
       attempt_count=j.attempt_count+1,last_attempt_at=clock_timestamp(),started_at=coalesce(started_at,clock_timestamp())
       where id=j.id returning * into j;
     return next j;
   end if;
 end loop;
end $$;

create function public.learn_commusoft_finish_job(
 p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_outcome jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;p public.learn_business_input_pages%rowtype;
 permit public.learn_business_input_request_permits%rowtype;a public.connector_accounts%rowtype;
 b jsonb;cfg jsonb;finish jsonb;receipt jsonb;answer jsonb;successor uuid;
 next_status text;stop_reason text;delay_seconds integer;failure_code text;allowed boolean;next_at timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'commusoft_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_claimed_by is null or p_attempt_count is null or p_attempt_count<1
   or jsonb_typeof(p_outcome) is distinct from 'object' or jsonb_typeof(p_outcome->'success') is distinct from 'boolean' then
   raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.job_type is distinct from 'commusoft.source_sync' or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count then
   raise exception 'commusoft_queue_not_owned' using errcode='PT409';end if;
 finish:=j.metadata->'commusoft_finish_v1';
 if j.status in ('succeeded','retrying','dead_letter') and finish->>'claimed_by'=p_claimed_by and (finish->>'attempt_count')::integer=p_attempt_count then
   if finish->'outcome'=p_outcome then return finish->'answer';end if;
   raise exception 'commusoft_queue_replay_conflict' using errcode='PT409';
 end if;
 if j.status is distinct from 'running' or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp() then
   raise exception 'commusoft_queue_not_owned' using errcode='PT409';end if;
 select * into p from public.learn_business_input_pages where job_id=j.id and tenant_id=p_tenant_id;
 if found then
   -- Never overwrite a committed page as failed, including a lost publication reply.
   if p_outcome<>'{"success":true}'::jsonb then raise exception 'commusoft_queue_page_committed' using errcode='PT409';end if;
   receipt:=jsonb_build_object('pageId',p.id,'checkpoint',p.checkpoint_after,'records',p.record_count,'already',false);
   if j.metadata->'commusoft_page_v1' is distinct from receipt then raise exception 'commusoft_queue_receipt_mismatch' using errcode='PT409';end if;
   select * into permit from public.learn_business_input_request_permits where id=p.permit_id;
   if not found then raise exception 'commusoft_queue_receipt_mismatch' using errcode='PT409';end if;
   b:=permit.binding;cfg:=b->'approval';
   if j.job_key is distinct from 'commusoft.source:'||(b->>'accountId')||':'||(cfg->>'approvalId') then
     raise exception 'commusoft_queue_identity' using errcode='PT409';end if;
   stop_reason:=case when p.checkpoint_after->'complete'='true'::jsonb then 'collection_exhausted'
     when (p.checkpoint_after->>'pages')::integer>=(cfg->>'maxPages')::integer then 'page_budget_exhausted' else 'next_page' end;
   if stop_reason='next_page' then
     -- Current switches/approval decide only whether to continue. Prior committed
     -- work is still acknowledged if an operator has since disabled processing.
     perform 1 from public.tenants where id=p_tenant_id and status='active' for share;
     allowed:=found;
     perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag='learn.enabled' and value='true'::jsonb for share;
     allowed:=allowed and found;
     perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
     allowed:=allowed and found;
     select * into a from public.connector_accounts where id::text=b->>'accountId' and tenant_id=p_tenant_id for share;
     allowed:=allowed and found and a.status='active' and a.settings->'commusoft_import'=cfg and a.sync_cursor=p.checkpoint_after
       and coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')>clock_timestamp();
     perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='commusoft'
       and provider='commusoft' and enabled and status='active' for share;
     allowed:=allowed and found;
     perform 1 from public.provider_connections where id::text=b->>'connectionId' and tenant_id=p_tenant_id
       and provider='commusoft' and status='configured' and auth_mode='private_api_key' and revoked_at is null and verified_at is not null
       and verified_at<=clock_timestamp() and updated_at=(b->>'connectionRevision')::timestamptz
       and non_secret_config->>'account_key'=a.account_key and non_secret_config->>'region'=b->'request'->>'region'
       and secret_refs->>'api_key'=b->>'secretId' and 'api_key'=any(configured_fields) for share;
     allowed:=allowed and found;
     if allowed is distinct from true then stop_reason:='authorisation_changed';end if;
   end if;
   update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),lease_expires_at=null,error_code=null,
     records_processed=p.record_count,result=jsonb_build_object('receipt',receipt,'stop_reason',stop_reason,
       'coverage','one_collection_traversal','ingestion_complete',false) where id=j.id;
   if stop_reason='next_page' then
     select next_allowed_at into next_at from public.learn_business_input_request_gates
       where credential_fingerprint=permit.credential_fingerprint for share;
     if not found then raise exception 'commusoft_queue_gate_missing' using errcode='PT409';end if;
     insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,available_at,parent_job_id,payload)
       values(p_tenant_id,j.connector_id,j.module_id,j.job_type,j.job_key,'queued',j.priority,j.max_attempts,
         greatest(clock_timestamp()+interval '1250 milliseconds',next_at),j.id,jsonb_build_object('connector_account_id',a.id)) returning id into successor;
   end if;
   next_status:='succeeded';
 else
   if coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1' then raise exception 'commusoft_queue_receipt_mismatch' using errcode='PT409';end if;
   if p_outcome->'success'='true'::jsonb then raise exception 'commusoft_queue_page_missing' using errcode='PT409';end if;
   if not p_outcome ?& array['success','code','retryable','retry_after_seconds'] or (select count(*) from jsonb_object_keys(p_outcome))<>4
     or jsonb_typeof(p_outcome->'retryable') is distinct from 'boolean' or jsonb_typeof(p_outcome->'code') is distinct from 'string'
     or p_outcome->>'code' !~ '^commusoft_[a-z_]{1,80}$' or jsonb_typeof(p_outcome->'retry_after_seconds') is distinct from 'number'
     or p_outcome->>'retry_after_seconds' !~ '^[0-9]{1,8}$' then raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
   delay_seconds:=(p_outcome->>'retry_after_seconds')::integer;
   if delay_seconds>31536000 then raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
   delay_seconds:=greatest(delay_seconds,case j.attempt_count when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end);
   next_status:=case when p_outcome->'retryable'='true'::jsonb and j.attempt_count<j.max_attempts then 'retrying' else 'dead_letter' end;
   failure_code:=p_outcome->>'code';
   update public.platform_jobs set status=next_status,lease_expires_at=null,error_code=failure_code,error_count=coalesce(error_count,0)+1,
     failed_at=clock_timestamp(),available_at=case when next_status='retrying' then clock_timestamp()+make_interval(secs=>delay_seconds) else available_at end,
     dead_lettered_at=case when next_status='dead_letter' then clock_timestamp() else dead_lettered_at end where id=j.id;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'commusoft_queue_not_owned' using errcode='PT409';end if;
 answer:=jsonb_build_object('job_id',j.id,'status',next_status,'successor_id',successor);
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('commusoft_finish_v1',
   jsonb_build_object('claimed_by',p_claimed_by,'attempt_count',p_attempt_count,'outcome',p_outcome,'answer',answer)) where id=j.id;
 return answer;
end $$;
revoke all on function public.learn_commusoft_claim_jobs(uuid),public.learn_commusoft_finish_job(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.learn_commusoft_claim_jobs(uuid),public.learn_commusoft_finish_job(uuid,uuid,text,integer,jsonb) to service_role;

-- INPUT supabase/migrations/20261031120000_learn_business_input_customers.sql
-- Explicit reviewed customer projection from retained API evidence. No backfill,
-- provider request, inferred match, or automatic projection from a worker.

create index learn_business_input_observations_version_idx
 on public.learn_business_input_observations(version_id,page_id);
create table public.learn_business_input_links (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 connection_id uuid not null,
 provider text not null,
 collection text not null,
 external_id text not null,
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 entity_kind text not null check(entity_kind in ('customer','site','contact','job')),
 entity_table text not null,
 entity_id uuid not null,
 card_id uuid references public.customer_cards(id) on delete restrict,
 request jsonb not null,
 actor_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,connection_id,provider,collection,external_id),
 check((entity_kind='customer' and entity_table in ('people','companies'))
    or (entity_kind='contact' and entity_table='people')
    or (entity_kind='site' and entity_table='sites')
    or (entity_kind='job' and entity_table='jobs'))
);
alter table public.learn_business_input_links enable row level security;
revoke all on public.learn_business_input_links from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_links
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_links
 for each statement execute function public.learn_business_input_retain();

-- The server must authenticate the caller before supplying p_actor. The current
-- tenant owner/admin and View-As guard are also checked inside this transaction.
-- p_target=NULL is an explicit reviewed CREATE, never an automatic match fallback.
-- p_kind is reviewed classification: configurable customerType IDs, a company
-- name, or a shared mailbox do not independently prove person/company identity.
create function public.learn_commusoft_review_customer(
 p_tenant uuid,p_actor uuid,p_version uuid,p_kind text,p_target uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 v public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;
 c public.provider_connections%rowtype;
 request jsonb; contact jsonb; raw jsonb; meta jsonb;
 flag_name text; field_name text; target_table text; label text; address text;
 target uuid; card uuid; latest timestamptz; latest_versions integer; latest_matches integer;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 perform public.learn_import_batch_authority(p_tenant,p_actor);
 if p_version is null or p_kind is null or p_kind not in ('person','company')
  or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
  raise exception 'business_input_review_invalid' using errcode='22023';end if;
 -- Same lock order as the source writer. The exclusive connection lock below
 -- fences a new page publication until this reviewed snapshot has committed.
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'business_input_tenant_unavailable' using errcode='42501';end if;
 foreach flag_name in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=flag_name and value='true'::jsonb for share;
  if not found then raise exception 'business_input_module_unavailable' using errcode='42501';end if;
 end loop;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant;
 if not found or v.provider<>'commusoft' or v.collection<>'properties' then
  raise exception 'business_input_source_unavailable' using errcode='22023';end if;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant and connector_id='commusoft'
  and provider='commusoft' and enabled and status='active' for share;
 if not found then raise exception 'business_input_connector_unavailable' using errcode='42501';end if;
 select * into c from public.provider_connections where id=v.connection_id and tenant_id=p_tenant for update;
 if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured' or c.revoked_at is not null
  or c.verified_at is null or c.verified_at>clock_timestamp() then
  raise exception 'business_input_connection_unavailable' using errcode='42501';end if;
 target_table:=case when p_kind='person' then 'people' else 'companies' end;
 request:=jsonb_build_object('version',p_version,'kind',p_kind,'target',p_target,'actor',p_actor,'reason',btrim(p_reason));
 select * into l from public.learn_business_input_links where tenant_id=p_tenant
  and connection_id=v.connection_id and provider=v.provider and collection=v.collection and external_id=v.external_id;
 if found then
  if l.request is distinct from request then raise exception 'business_input_identity_already_reviewed' using errcode='PT409';end if;
  -- Exact lost-response recovery. Never changes the original target or card.
  execute format('select id from public.%I where tenant_id=$1 and id=$2 for share',l.entity_table)
   into target using p_tenant,l.entity_id;
  perform 1 from public.customer_cards where id=l.card_id and tenant_id=p_tenant
    and ((l.entity_table='people' and person_id=l.entity_id)
      or (l.entity_table='companies' and person_id is null and company_id=l.entity_id)) for share;
  if target is null or not found then
   raise exception 'business_input_target_unavailable' using errcode='PT409';end if;
  return jsonb_build_object('link_id',l.id,'entity_table',l.entity_table,'entity_id',l.entity_id,'card_id',l.card_id,'already',true);
 end if;
 -- Only an observed source version can be approved. Equal-time differing
 -- observations are ambiguous, not UUID-ordered into an invented winner.
 select max(p.committed_at) into latest from public.learn_business_input_observations o
  join public.learn_business_input_pages p on p.id=o.page_id
  join public.learn_business_input_versions s on s.id=o.version_id
  where s.tenant_id=p_tenant and s.connection_id=v.connection_id and s.provider=v.provider
   and s.collection=v.collection and s.external_id=v.external_id
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection;
 select count(distinct s.id),count(distinct s.id) filter(where s.id=v.id) into latest_versions,latest_matches
  from public.learn_business_input_observations o join public.learn_business_input_pages p on p.id=o.page_id
  join public.learn_business_input_versions s on s.id=o.version_id
  where s.tenant_id=p_tenant and s.connection_id=v.connection_id and s.provider=v.provider
   and s.collection=v.collection and s.external_id=v.external_id and p.committed_at=latest
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection;
 if latest_versions<>1 or latest_matches<>1 then raise exception 'business_input_review_stale' using errcode='PT409';end if;
 raw:=v.payload;
 if raw->>'type' is distinct from 'customer' or jsonb_typeof(raw->'id') is distinct from 'number'
  or raw->>'id' is distinct from v.external_id then
  raise exception 'business_input_customer_required' using errcode='22023';end if;
 if p_target is not null then
  execute format('select id from public.%I where tenant_id=$1 and id=$2 for share',target_table)
   into target using p_tenant,p_target;
  if target is null then raise exception 'business_input_target_unavailable' using errcode='22023';end if;
 else
  -- Copy only typed source fields. No invented email, consent, historical
  -- timestamps, performance score, or "verified" status is created.
  contact:=coalesce(nullif(raw->'contact','null'::jsonb),'{}'::jsonb);
  if jsonb_typeof(contact)<>'object' then raise exception 'business_input_customer_invalid' using errcode='22023';end if;
  foreach field_name in array array['firstName','lastName','telephone','mobile','email'] loop
   if contact ? field_name and contact->field_name<>'null'::jsonb and
    (jsonb_typeof(contact->field_name)<>'string' or length(contact->>field_name)>1000) then
    raise exception 'business_input_customer_invalid' using errcode='22023';end if;
  end loop;
  foreach field_name in array array['companyName','addressLine1','addressLine2','addressLine3','town','province','postcode'] loop
   if raw ? field_name and raw->field_name<>'null'::jsonb and
    (jsonb_typeof(raw->field_name)<>'string' or length(raw->>field_name)>1000) then
    raise exception 'business_input_customer_invalid' using errcode='22023';end if;
  end loop;
  address:=nullif(concat_ws(', ',nullif(btrim(raw->>'addressLine1'),''),nullif(btrim(raw->>'addressLine2'),''),
   nullif(btrim(raw->>'addressLine3'),''),nullif(btrim(raw->>'town'),''),nullif(btrim(raw->>'province'),'')),'');
  meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,
   'provider',v.provider,'collection',v.collection,'external_id',v.external_id,'source_version_id',v.id));
  if p_kind='person' then
   label:=nullif(btrim(concat_ws(' ',nullif(btrim(contact->>'firstName'),''),nullif(btrim(contact->>'lastName'),''))),'');
   if label is null then raise exception 'business_input_customer_name_required' using errcode='22023';end if;
   insert into public.people(tenant_id,display_name,first_name,last_name,primary_email,primary_phone,address_text,postcode,verified,created_source,metadata)
    values(p_tenant,label,nullif(btrim(contact->>'firstName'),''),nullif(btrim(contact->>'lastName'),''),
     nullif(btrim(contact->>'email'),''),coalesce(nullif(btrim(contact->>'telephone'),''),nullif(btrim(contact->>'mobile'),'')),
     address,nullif(btrim(raw->>'postcode'),''),false,'business_input:commusoft',meta) returning id into target;
  else
   label:=nullif(btrim(raw->>'companyName'),'');
   if label is null then raise exception 'business_input_customer_name_required' using errcode='22023';end if;
   insert into public.companies(tenant_id,name,phone,address_text,postcode,verified,created_source,metadata)
    values(p_tenant,label,coalesce(nullif(btrim(contact->>'telephone'),''),nullif(btrim(contact->>'mobile'),'')),
     address,nullif(btrim(raw->>'postcode'),''),false,'business_input:commusoft',meta) returning id into target;
  end if;
 end if;
 -- Reuse exactly the customer-card identity indexes used by governed imports.
 -- Existing titles, summaries, ownership, activity, assessments and metadata stay.
 if p_kind='person' then
  select display_name into label from public.people where id=target and tenant_id=p_tenant;
  insert into public.customer_cards(tenant_id,person_id,title,metadata)
   values(p_tenant,target,coalesce(nullif(btrim(label),''),'Imported customer'),jsonb_build_object('learn_source_version_id',v.id))
   on conflict(tenant_id,person_id) where person_id is not null do nothing returning id into card;
  if card is null then select id into card from public.customer_cards where tenant_id=p_tenant and person_id=target;end if;
 else
  select name into label from public.companies where id=target and tenant_id=p_tenant;
  insert into public.customer_cards(tenant_id,company_id,title,metadata)
   values(p_tenant,target,coalesce(nullif(btrim(label),''),'Imported customer'),jsonb_build_object('learn_source_version_id',v.id))
   on conflict(tenant_id,company_id) where person_id is null and company_id is not null do nothing returning id into card;
  if card is null then select id into card from public.customer_cards where tenant_id=p_tenant and company_id=target and person_id is null;end if;
 end if;
 perform 1 from public.customer_cards where id=card and tenant_id=p_tenant
  and ((p_kind='person' and person_id=target) or (p_kind='company' and person_id is null and company_id=target)) for share;
 if card is null or not found then raise exception 'business_input_card_changed' using errcode='40001';end if;
 insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,
  entity_kind,entity_table,entity_id,card_id,request,actor_id)
  values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,'customer',target_table,target,card,request,p_actor)
  returning * into l;
 return jsonb_build_object('link_id',l.id,'entity_table',target_table,'entity_id',target,'card_id',card,'already',false);
end $$;
revoke all on function public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text) to service_role;

-- INPUT supabase/migrations/20261031130000_learn_business_input_review.sql
-- Signed-in customer review reads and confirmation. No source backfill or sync.

create function public.learn_business_input_review_access(p_tenant uuid,p_connection uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare f text;begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 foreach f in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=f and value='true'::jsonb for share;
  if not found then raise exception 'business_input_module_unavailable' using errcode='42501';end if;
 end loop;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant and provider='commusoft' and connector_id='commusoft' and enabled and status='active' for share;
 if not found then raise exception 'business_input_connector_unavailable' using errcode='42501';end if;
 if p_connection is not null then
  perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection and provider='commusoft'
   and status='configured' and revoked_at is null and verified_at<=clock_timestamp() for share;
  if not found then raise exception 'business_input_connection_unavailable' using errcode='42501';end if;
 end if;
end $$;
create function public.learn_business_input_text(p_value jsonb,p_key text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(p_value->p_key)='string' then nullif(left(btrim(p_value->>p_key),1000),'') end;
$$;
create function public.learn_business_customer_summary(p_value jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object(
  'person_name',nullif(concat_ws(' ',public.learn_business_input_text(p_value->'contact','firstName'),public.learn_business_input_text(p_value->'contact','lastName')),''),
  'company_name',public.learn_business_input_text(p_value,'companyName'),
  'email',public.learn_business_input_text(p_value->'contact','email'),
  'phone',coalesce(public.learn_business_input_text(p_value->'contact','telephone'),public.learn_business_input_text(p_value->'contact','mobile')),
  'address',nullif(concat_ws(', ',public.learn_business_input_text(p_value,'addressLine1'),public.learn_business_input_text(p_value,'addressLine2'),public.learn_business_input_text(p_value,'addressLine3'),public.learn_business_input_text(p_value,'town'),public.learn_business_input_text(p_value,'province')),''),
  'postcode',public.learn_business_input_text(p_value,'postcode'),
  'source_type',public.learn_business_input_text(p_value,'type'),
  'customer_type',case when jsonb_typeof(p_value->'customerType') in ('number','string') then left(p_value->>'customerType',100) end);
$$;
create function public.learn_commusoft_review_connections(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;begin
 perform public.learn_business_input_review_access(p_tenant);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(nullif(left(non_secret_config->>'account_key',150),''),'Commusoft connection')) order by id),'[]') into result
  from public.provider_connections where tenant_id=p_tenant and provider='commusoft' and status='configured' and revoked_at is null and verified_at<=clock_timestamp();
 return jsonb_build_object('tenant_id',p_tenant,'connections',result);
end $$;
create function public.learn_commusoft_review_page(p_tenant uuid,p_connection uuid,p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;more boolean;last_id text;begin
 if p_connection is null or p_limit is null or p_limit not between 1 and 50 or
  (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 with identities as (
  select distinct external_id from public.learn_business_input_versions
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft' and collection='properties'
   and (p_after is null or external_id collate "C">p_after collate "C")
 ), latest as (
  select s.*,l.id as link_id,l.entity_table,l.entity_id,l.card_id,l.source_version_id as linked_version
  from identities i cross join lateral (
   select v.id,v.external_id,v.payload,p.committed_at from public.learn_business_input_versions v
   join public.learn_business_input_observations o on o.version_id=v.id join public.learn_business_input_pages p on p.id=o.page_id
   where v.tenant_id=p_tenant and v.connection_id=p_connection and v.provider='commusoft' and v.collection='properties' and v.external_id=i.external_id
    and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id and p.provider=v.provider and p.collection=v.collection
   order by p.committed_at desc,v.id limit 1
  ) s left join public.learn_business_input_links l on l.tenant_id=p_tenant and l.connection_id=p_connection
    and l.provider='commusoft' and l.collection='properties' and l.external_id=s.external_id
  where s.payload->>'type'='customer' or l.entity_kind='customer'
 ), bounded as (select * from latest order by external_id collate "C" limit p_limit+1), output as (
  select *,row_number() over(order by external_id collate "C") as n from bounded
 )
 select coalesce(jsonb_agg(jsonb_build_object('version_id',id,'external_id',external_id,'observed_at',committed_at,
   'summary',public.learn_business_customer_summary(payload),
   'link',case when link_id is not null then jsonb_build_object('entity_table',entity_table,'entity_id',entity_id,'card_id',card_id,'source_version_id',linked_version) end)
   order by external_id collate "C") filter(where n<=p_limit),'[]'),count(*)>p_limit,
   max(external_id collate "C") filter(where n<=p_limit) into result,more,last_id from output;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'rows',result,'next_cursor',case when more then last_id end);
end $$;

create function public.learn_commusoft_customer_candidates(p_tenant uuid,p_version uuid,p_kind text,p_search text default '',p_after uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;s jsonb;q text;result jsonb;more boolean;last_id uuid;
begin
 if p_version is null or p_kind is null or p_kind not in ('person','company') or p_search is null or length(btrim(p_search))>150
  or length(btrim(p_search))=1 or p_limit is null or p_limit not between 1 and 50 then raise exception 'business_input_search_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant);
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft' and collection='properties';
 if not found then raise exception 'business_input_source_unavailable' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 s:=public.learn_business_customer_summary(v.payload);q:=lower(btrim(p_search));
 with candidates as (
  select id,display_name as name,primary_email as email,primary_phone as phone,postcode from public.people where tenant_id=p_tenant and p_kind='person'
  union all select id,name,null,phone,postcode from public.companies where tenant_id=p_tenant and p_kind='company'
 ), matches as (
  select *,case
   when nullif(lower(btrim(email)),'')=nullif(lower(btrim(s->>'email')),'') then 'shared_email'
   when nullif(regexp_replace(phone,'[^0-9]','','g'),'')=nullif(regexp_replace(s->>'phone','[^0-9]','','g'),'') then 'shared_phone'
   when nullif(lower(btrim(name)),'')=nullif(lower(btrim(s->>case when p_kind='person' then 'person_name' else 'company_name' end)),'') then 'same_name'
   else 'search' end as reason from candidates
  where (p_after is null or id>p_after) and (
   (q<>'' and position(q in lower(concat_ws(' ',name,email,phone,postcode)))>0) or
   (q='' and (nullif(lower(btrim(email)),'')=nullif(lower(btrim(s->>'email')),'') or
    nullif(regexp_replace(phone,'[^0-9]','','g'),'')=nullif(regexp_replace(s->>'phone','[^0-9]','','g'),'') or
    nullif(lower(btrim(name)),'')=nullif(lower(btrim(s->>case when p_kind='person' then 'person_name' else 'company_name' end)),'') ))
  ) order by id limit p_limit+1
 ), numbered as (select *,row_number() over(order by id) as n from matches)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',left(name,1000),'email',left(email,1000),'phone',left(phone,1000),'postcode',left(postcode,1000),'reason',reason) order by id) filter(where n<=p_limit),'[]'),
  count(*)>p_limit,(array_agg(id order by id) filter(where n<=p_limit))[p_limit] into result,more,last_id from numbered;
 return jsonb_build_object('tenant_id',p_tenant,'version_id',p_version,'kind',p_kind,'rows',result,'next_cursor',case when more then last_id end);
end $$;

-- The existing private writer remains uncallable by authenticated clients.
-- The new facade supplies auth.uid(), never a caller-selected actor.
do $$declare d text;needle text:='if auth.role() is distinct from ''service_role'' then';begin
 d:=pg_get_functiondef('public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'business_input_writer_contract_changed';end if;
 execute replace(d,needle,'if auth.role() is distinct from ''service_role'' and not (auth.role()=''authenticated'' and auth.uid() is not null and p_actor is not distinct from auth.uid()) then');
end $$;
create function public.learn_commusoft_confirm_customer(p_tenant uuid,p_version uuid,p_kind text,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 return public.learn_commusoft_review_customer(p_tenant,auth.uid(),p_version,p_kind,p_target,p_reason);
end $$;
revoke all on function public.learn_business_input_review_access(uuid,uuid),public.learn_business_input_text(jsonb,text),public.learn_business_customer_summary(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.learn_commusoft_review_connections(uuid),public.learn_commusoft_review_page(uuid,uuid,text,integer),public.learn_commusoft_customer_candidates(uuid,uuid,text,text,uuid,integer),public.learn_commusoft_confirm_customer(uuid,uuid,text,uuid,text) from public,anon,service_role;
grant execute on function public.learn_commusoft_review_connections(uuid),public.learn_commusoft_review_page(uuid,uuid,text,integer),public.learn_commusoft_customer_candidates(uuid,uuid,text,text,uuid,integer),public.learn_commusoft_confirm_customer(uuid,uuid,text,uuid,text) to authenticated;

-- INPUT supabase/migrations/20261031140000_learn_business_input_work.sql
-- Reviewed site/job projection into the existing canonical tables. No backfill,
-- provider request, automatic merge, score or historical ownership inference.

create table public.learn_business_input_projection_attempts (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 actor_id uuid not null,request jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_business_input_projection_attempts enable row level security;
revoke all on public.learn_business_input_projection_attempts from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_projection_attempts
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_projection_attempts
 for each statement execute function public.learn_business_input_retain();
create index learn_business_input_projection_attempts_source_idx
 on public.learn_business_input_projection_attempts(tenant_id,source_version_id,created_at);

create function public.learn_business_input_latest(p_tenant uuid,p_connection uuid,p_provider text,p_collection text,p_external text)
returns public.learn_business_input_versions language plpgsql set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;t timestamptz;n integer;begin
 select max(p.committed_at) into t from public.learn_business_input_versions s
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider=p_provider and s.collection=p_collection and s.external_id=p_external
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection;
 select count(distinct s.id) into n from public.learn_business_input_versions s
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider=p_provider and s.collection=p_collection and s.external_id=p_external
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection and p.committed_at=t;
 if n<>1 then return v;end if;
 select s.* into v from public.learn_business_input_versions s
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider=p_provider and s.collection=p_collection and s.external_id=p_external
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection and p.committed_at=t limit 1;
 return v;
end $$;

-- Called only while the authenticated projector holds connection/roster locks.
-- Resolve each property in its original connection; numeric IDs never become FKs.
create function public.learn_commusoft_property_owner(p_tenant uuid,p_connection uuid,p_external text,p_allow_site boolean default true)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 s public.sites%rowtype;owner jsonb;person uuid;company uuid;parent text;original jsonb;begin
 v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','properties',p_external);
 if v.id is null then return jsonb_build_object('state','held','reason','property_missing_or_ambiguous');end if;
 select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection
  and provider='commusoft' and collection='properties' and external_id=p_external;
 if not found then return jsonb_build_object('state','held','reason','property_identity_unreviewed');end if;
 if v.payload->>'type'='customer' and l.entity_kind='customer' then
  if l.entity_table='people' then
   select id into person from public.people where tenant_id=p_tenant and id=l.entity_id for share;
  elsif l.entity_table='companies' then
   select id into company from public.companies where tenant_id=p_tenant and id=l.entity_id for share;
  end if;
  if person is null and company is null then return jsonb_build_object('state','held','reason','customer_target_missing');end if;
  perform 1 from public.customer_cards where id=l.card_id and tenant_id=p_tenant and
   ((person is not null and person_id=person) or (company is not null and person_id is null and company_id=company)) for share;
  if not found then return jsonb_build_object('state','held','reason','customer_card_changed');end if;
  return jsonb_build_object('state','ready','person_id',person,'company_id',company,'site_id',null,'card_id',l.card_id,'customer_link_id',l.id);
 elsif p_allow_site and v.payload->>'type'='workaddress' and l.entity_kind='site' and l.entity_table='sites' then
  parent:=v.payload->>'parentPropertyID';
  if jsonb_typeof(v.payload->'parentPropertyID') is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$' or parent=p_external then
   return jsonb_build_object('state','held','reason','site_parent_invalid');end if;
  select payload into original from public.learn_business_input_versions where id=l.source_version_id;
  if original->>'parentPropertyID' is distinct from parent then return jsonb_build_object('state','held','reason','site_source_owner_changed');end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,p_connection,parent,false);
  if owner->>'state'<>'ready' then return owner;end if;
  select * into s from public.sites where id=l.entity_id and tenant_id=p_tenant for share;
  if not found or s.person_id is distinct from (owner->>'person_id')::uuid or s.company_id is distinct from (owner->>'company_id')::uuid then
   return jsonb_build_object('state','held','reason','site_canonical_owner_changed');end if;
  return owner||jsonb_build_object('site_id',s.id,'site_link_id',l.id);
 end if;
 return jsonb_build_object('state','held','reason','property_kind_changed');
end $$;

create function public.learn_business_input_projection_result(p_tenant uuid,p_version uuid,p_request jsonb,p_result jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare attempt uuid;begin
 insert into public.learn_business_input_projection_attempts(tenant_id,source_version_id,actor_id,request,result)
  values(p_tenant,p_version,auth.uid(),p_request,p_result) returning id into attempt;
 return p_result||jsonb_build_object('attempt_id',attempt);
end $$;

create function public.learn_commusoft_confirm_work_record(p_tenant uuid,p_version uuid,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;s public.sites%rowtype;j public.jobs%rowtype;
 owner jsonb;request jsonb;result jsonb;meta jsonb;field text;kind text;parent text;reason text;target uuid;
 person uuid;company uuid;site uuid;namespace text;address text;status text;created timestamptz;completed timestamptz;ts text;
begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_version is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
  raise exception 'business_input_review_invalid' using errcode='22023';end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft';
 if not found or not (v.collection='jobs' or (v.collection='properties' and v.payload->>'type'='workaddress')) then
  raise exception 'business_input_work_source_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=v.connection_id for update;
 kind:=case when v.collection='jobs' then 'job' else 'site' end;
 request:=jsonb_build_object('target',p_target,'reason',btrim(p_reason),'kind',kind);
 -- The block exits on a held condition; the final attempt records the reason.
 <<project>> begin
  latest:=public.learn_business_input_latest(p_tenant,v.connection_id,v.provider,v.collection,v.external_id);
  if latest.id is distinct from v.id then reason:='source_changed_or_ambiguous';exit project;end if;
  if jsonb_typeof(v.payload->'id') is distinct from 'number' or v.payload->>'id' is distinct from v.external_id then reason:='source_identity_invalid';exit project;end if;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=v.connection_id
   and provider=v.provider and collection=v.collection and external_id=v.external_id;
  if found and (l.source_version_id<>v.id or l.entity_kind<>kind or (p_target is not null and p_target<>l.entity_id)) then
   reason:='existing_identity_needs_review';exit project;end if;
  field:=case when kind='site' then 'parentPropertyID' else 'propertyID' end;parent:=v.payload->>field;
  if jsonb_typeof(v.payload->field) is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$'
   or (kind='site' and parent=v.external_id) then reason:='property_reference_invalid';exit project;end if;
  if parent::numeric>9007199254740991 then reason:='property_reference_invalid';exit project;end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,v.connection_id,parent,kind='job');
  if owner->>'state'<>'ready' then reason:=owner->>'reason';exit project;end if;
  person:=(owner->>'person_id')::uuid;company:=(owner->>'company_id')::uuid;site:=(owner->>'site_id')::uuid;
  target:=coalesce(l.entity_id,p_target);namespace:='commusoft:connection:'||v.connection_id::text;
  if target is null then
   -- Existing CSV imports are candidates, not proof of the same provider account.
   if kind='site' and exists(select 1 from public.sites where tenant_id=p_tenant and source_system in ('commusoft',namespace) and external_id=v.external_id)
    or kind='job' and exists(select 1 from public.jobs where tenant_id=p_tenant and source_system in ('commusoft',namespace) and external_id=v.external_id) then
    reason:='existing_external_identity_needs_review';exit project;end if;
   meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,'source_version_id',v.id,'property_external_id',parent,'relationships',owner));
   if kind='site' then
    foreach field in array array['addressLine1','addressLine2','addressLine3','town','province','postcode'] loop
     if v.payload ? field and v.payload->field<>'null'::jsonb and (jsonb_typeof(v.payload->field)<>'string' or length(v.payload->>field)>1000) then reason:='site_field_invalid';exit project;end if;
    end loop;
    address:=public.learn_business_customer_summary(v.payload)->>'address';
    insert into public.sites(tenant_id,source_system,external_id,person_id,company_id,label,address_text,postcode,created_source,verified,metadata)
     values(p_tenant,namespace,v.external_id,person,company,coalesce(public.learn_business_input_text(v.payload,'addressLine1'),'Work site '||v.external_id),address,
      public.learn_business_input_text(v.payload,'postcode'),'business_input:commusoft',false,meta) returning id into target;
   else
    if jsonb_typeof(v.payload->'status') is distinct from 'string' or v.payload->>'status' not in ('Open','Complete','Closed') then reason:='job_status_unrecognised';exit project;end if;
    if v.payload ? 'description' and v.payload->'description'<>'null'::jsonb and (jsonb_typeof(v.payload->'description')<>'string' or length(v.payload->>'description')>1000) then reason:='job_field_invalid';exit project;end if;
    status:=case v.payload->>'status' when 'Open' then 'open' when 'Complete' then 'completed' else 'closed' end;
    if v.payload ? 'completed' and v.payload->'completed'<>'null'::jsonb and jsonb_typeof(v.payload->'completed')<>'object' then reason:='job_timestamp_invalid';exit project;end if;
    -- Only explicit source timestamps with a timezone are eligible. Closed does
    -- not mean completed: outcome, money, staff and reward semantics stay raw.
    foreach field in array array['created','completed'] loop
     ts:=case when field='created' then v.payload->>'createdOnDateTime' else v.payload->'completed'->>'completedOnDateTime' end;
     if ts is not null then
      if ts!~'^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then reason:='job_timestamp_invalid';exit project;end if;
      begin if field='created' then created:=ts::timestamptz;else completed:=ts::timestamptz;end if;
      exception when invalid_datetime_format or datetime_field_overflow then reason:='job_timestamp_invalid';exit project;end;
     end if;
    end loop;
    insert into public.jobs(tenant_id,source_system,external_id,job_number,customer_person_id,customer_company_id,site_id,title,description,status,created_date,completed_date,created_source,verified,metadata)
     values(p_tenant,namespace,v.external_id,v.external_id,person,company,site,coalesce(public.learn_business_input_text(v.payload,'description'),'Job '||v.external_id),
      public.learn_business_input_text(v.payload,'description'),status,created,completed,'business_input:commusoft',false,meta) returning id into target;
   end if;
  else
   if kind='site' then
    select * into s from public.sites where tenant_id=p_tenant and id=target for share;
    if not found or s.person_id is distinct from person or s.company_id is distinct from company then reason:='target_site_owner_mismatch';exit project;end if;
   else
    select * into j from public.jobs where tenant_id=p_tenant and id=target for share;
    if not found or j.customer_person_id is distinct from person or j.customer_company_id is distinct from company or j.site_id is distinct from site then reason:='target_job_owner_mismatch';exit project;end if;
   end if;
  end if;
  if l.id is null then
   insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
    values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,kind,case when kind='site' then 'sites' else 'jobs' end,target,(owner->>'card_id')::uuid,request,auth.uid()) returning * into l;
   result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',false);
  else result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',true);end if;
 end project;
 if reason is not null then result:=jsonb_build_object('state','held','reason',reason);end if;
 return public.learn_business_input_projection_result(p_tenant,v.id,request,result);
end $$;
revoke all on function public.learn_business_input_latest(uuid,uuid,text,text,text),public.learn_commusoft_property_owner(uuid,uuid,text,boolean),public.learn_business_input_projection_result(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text) to authenticated;

-- INPUT supabase/migrations/20261031150000_learn_business_input_work_batches.sql
-- Bounded reviewed work batches, source summaries and recoverable/cancellable receipts.

create table public.learn_business_input_projection_batches (
 tenant_id uuid not null,id uuid not null,actor_id uuid not null,request jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,id)
);
alter table public.learn_business_input_projection_batches enable row level security;
revoke all on public.learn_business_input_projection_batches from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_projection_batches
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_projection_batches
 for each statement execute function public.learn_business_input_retain();

create function public.learn_commusoft_work_batch(p_tenant uuid,p_request uuid,p_connection uuid,p_kind text,p_items jsonb,p_reason text,p_cancel boolean default false,p_expected_actor uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.learn_business_input_projection_batches%rowtype;v public.learn_business_input_versions%rowtype;
 request jsonb;result jsonb;outcomes jsonb:='[]';item jsonb;outcome jsonb;version uuid;target uuid;
 seen uuid[]:='{}';identities text[]:='{}';linked integer:=0;held integer:=0;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 if p_expected_actor is distinct from auth.uid() then raise exception 'business_input_actor_changed' using errcode='42501';end if;
 -- Existing tenant roster lock also serializes competing confirmations/cancellations.
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 if p_request is null or p_connection is null or p_kind is null or p_kind not in ('site','job') or p_cancel is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 or jsonb_typeof(p_items) is distinct from 'array'
  or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'business_input_batch_invalid' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>2
   or jsonb_typeof(item->'version_id') is distinct from 'string' or item->>'version_id'!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or not item ? 'target_id' or not (item->'target_id'='null'::jsonb or (jsonb_typeof(item->'target_id')='string' and item->>'target_id'~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')) then
   raise exception 'business_input_batch_item_invalid' using errcode='22023';end if;
  version:=(item->>'version_id')::uuid;
  if version=any(seen) then raise exception 'business_input_batch_duplicate' using errcode='22023';end if;
  seen:=array_append(seen,version);
 end loop;
 request:=jsonb_build_object('connection_id',p_connection,'kind',p_kind,'items',p_items,'reason',btrim(p_reason));
 select * into b from public.learn_business_input_projection_batches where tenant_id=p_tenant and id=p_request;
 if found then
  if b.actor_id is distinct from auth.uid() or b.request is distinct from request then raise exception 'business_input_batch_conflict' using errcode='PT409';end if;
  return b.result; -- A saved cancellation also fences a late original apply.
 end if;
 if not p_cancel then
  perform public.learn_business_input_review_access(p_tenant,p_connection);
  perform 1 from public.provider_connections where id=p_connection and tenant_id=p_tenant for update;
  -- Prevalidate every scope before any row is projected. Unknown/foreign rows
  -- abort the batch, rather than becoming successful partial application.
  for item in select value from jsonb_array_elements(p_items) loop
   select * into v from public.learn_business_input_versions where id=(item->>'version_id')::uuid and tenant_id=p_tenant
    and connection_id=p_connection and provider='commusoft';
   if not found or (p_kind='job' and v.collection<>'jobs') or
    (p_kind='site' and (v.collection<>'properties' or v.payload->>'type' is distinct from 'workaddress')) then
    raise exception 'business_input_batch_scope_invalid' using errcode='22023';end if;
   if v.external_id=any(identities) then raise exception 'business_input_batch_identity_duplicate' using errcode='22023';end if;
   identities:=array_append(identities,v.external_id);
  end loop;
  for item in select value from jsonb_array_elements(p_items) loop
   outcome:=public.learn_commusoft_confirm_work_record(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));
   if outcome->>'state'='linked' then linked:=linked+1;
   elsif outcome->>'state'='held' then held:=held+1;
   else raise exception 'business_input_batch_outcome_invalid';end if;
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('version_id',item->>'version_id','outcome',outcome));
  end loop;
 end if;
 result:=jsonb_build_object('batch_id',p_request,'tenant_id',p_tenant,'actor_id',auth.uid(),'connection_id',p_connection,'kind',p_kind,
  'state',case when p_cancel then 'cancelled' else 'recorded' end,'items',outcomes,'linked',linked,'held',held);
 insert into public.learn_business_input_projection_batches(tenant_id,id,actor_id,request,result) values(p_tenant,p_request,auth.uid(),request,result);
 return result;
end $$;

create function public.learn_commusoft_work_batch_result(p_tenant uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 if p_request is null then raise exception 'business_input_batch_invalid' using errcode='22023';end if;
 select b.result into result from public.learn_business_input_projection_batches b where tenant_id=p_tenant and id=p_request and actor_id=auth.uid();
 return result; -- null is an observed absence, never a cancelled/incomplete write guarantee.
end $$;

create function public.learn_commusoft_work_review_page(p_tenant uuid,p_connection uuid,p_kind text,p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r record;v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 rows jsonb:='[]';owner jsonb;attempt jsonb;label text;parent text;customer text;v_collection text;last_id text;counted integer:=0;more boolean:=false;
begin
 if p_connection is null or p_kind is null or p_kind not in ('site','job') or p_limit is null or p_limit not between 1 and 50
  or (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 v_collection:=case when p_kind='site' then 'properties' else 'jobs' end;
 for r in select distinct s.external_id collate "C" as external_id from public.learn_business_input_versions s where s.tenant_id=p_tenant and s.connection_id=p_connection
  and s.provider='commusoft' and s.collection=v_collection and (p_kind='job' or s.payload->>'type'='workaddress')
  and (p_after is null or s.external_id collate "C">p_after collate "C") order by s.external_id collate "C" limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.external_id;
  v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft',v_collection,r.external_id);
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and learn_business_input_links.collection=v_collection and external_id=r.external_id;
  parent:=case when p_kind='site' then v.payload->>'parentPropertyID' else v.payload->>'propertyID' end;
  owner:=case when v.id is null then jsonb_build_object('state','held','reason','source_changed_or_ambiguous')
   else public.learn_commusoft_property_owner(p_tenant,p_connection,parent,p_kind='job') end;
  customer:=null;
  if owner->>'state'='ready' then
   if owner->>'person_id' is not null then select display_name into customer from public.people where tenant_id=p_tenant and id=(owner->>'person_id')::uuid;
   else select name into customer from public.companies where tenant_id=p_tenant and id=(owner->>'company_id')::uuid;end if;
  end if;
  select a.result into attempt from public.learn_business_input_projection_attempts a where a.tenant_id=p_tenant and a.source_version_id=v.id order by a.created_at desc,a.id desc limit 1;
  label:=case when p_kind='site' then public.learn_business_input_text(v.payload,'addressLine1') else public.learn_business_input_text(v.payload,'description') end;
  rows:=rows||jsonb_build_array(jsonb_build_object('external_id',r.external_id,'version_id',v.id,'title',coalesce(label,initcap(p_kind)||' '||r.external_id),
   'property_reference',case when parent~'^[1-9][0-9]{0,15}$' then parent end,'customer_name',left(customer,1000),'relationship_reason',owner->>'reason',
   'source_status',public.learn_business_input_text(v.payload,'status'),'linked_version_id',l.source_version_id,'last_result',attempt,
   'selectable',v.id is not null and coalesce(p_kind='job' or v.payload->>'type'='workaddress',false)));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'kind',p_kind,'rows',rows,'next_cursor',case when more then last_id end);
end $$;
revoke all on function public.learn_commusoft_work_batch(uuid,uuid,uuid,text,jsonb,text,boolean,uuid),public.learn_commusoft_work_batch_result(uuid,uuid),public.learn_commusoft_work_review_page(uuid,uuid,text,text,integer) from public,anon,service_role;
grant execute on function public.learn_commusoft_work_batch(uuid,uuid,uuid,text,jsonb,text,boolean,uuid),public.learn_commusoft_work_batch_result(uuid,uuid),public.learn_commusoft_work_review_page(uuid,uuid,text,text,integer) to authenticated;

-- INPUT supabase/migrations/20261031160000_learn_operator_inputs.sql
-- OpenFolk input controls. Uses existing platform authority, never tenant roles.
-- No flags, credentials, connections, approvals or jobs are seeded on installation.

create table public.learn_operator_input_requests (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 definition jsonb not null,
 receipt jsonb not null,
 previous_state jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_operator_input_requests enable row level security;
revoke all on public.learn_operator_input_requests from public,anon,authenticated,service_role;
create trigger learn_operator_input_immutable before update or delete on public.learn_operator_input_requests
 for each row execute function public.learn_operator_input_immutable();

-- Explicit booleans only. Missing values remain null in the read model.
create function public.learn_operator_input_flags(p_tenant uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('learn.enabled',(select value from public.feature_flags where tenant_id=p_tenant and flag='learn.enabled'),
  'learn.inputs.commusoft.enabled',(select value from public.feature_flags where tenant_id=p_tenant and flag='learn.inputs.commusoft.enabled'));
$$;

-- One immutable request protocol for approve/check/cancel. A cancellation records
-- a tombstone: a late original apply returns cancellation, never enqueues work.
create function public.learn_operator_input_request(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_operator_input_requests%rowtype;c public.provider_connections%rowtype;
 tc public.tenant_connectors%rowtype;a public.connector_accounts%rowtype;
 receipt jsonb;previous jsonb;scope jsonb;flags jsonb;kind text;reason text;k text;
 connection_id uuid;revision timestamptz;expiry timestamptz;resource text;contact_type text;
 pages integer;page_size integer;aid uuid;jid uuid:=gen_random_uuid();
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000 then
  raise exception 'learn_operator_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-request:'||p_request::text,0));
 select * into prior from public.learn_operator_input_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition then
   raise exception 'learn_operator_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt)
   values(p_request,p_tenant,p_actor,p_definition,receipt);
  return receipt;
 end if;
 kind:=p_definition->>'kind';reason:=p_definition->>'reason';
 if jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(reason)) not between 1 and 1000
  or kind is null or kind not in ('set_modules','start_commusoft') then raise exception 'learn_operator_definition_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 if kind='set_modules' then
  if (select count(*) from jsonb_object_keys(p_definition))<>4
   or jsonb_typeof(p_definition->'expected') is distinct from 'object'
   or jsonb_typeof(p_definition->'values') is distinct from 'object'
   or (select count(*) from jsonb_object_keys(p_definition->'values'))<>2
   or jsonb_typeof(p_definition->'values'->'learn.enabled') is distinct from 'boolean'
   or jsonb_typeof(p_definition->'values'->'learn.inputs.commusoft.enabled') is distinct from 'boolean' then
   raise exception 'learn_operator_flags_invalid' using errcode='22023';end if;
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag in ('learn.enabled','learn.inputs.commusoft.enabled') order by flag for update;
  flags:=public.learn_operator_input_flags(p_tenant);
  if flags is distinct from p_definition->'expected' then raise exception 'learn_operator_flags_changed' using errcode='PT409';end if;
  previous:=flags;
  foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
   update public.feature_flags set value=p_definition->'values'->k where tenant_id=p_tenant and flag=k;
   if not found then insert into public.feature_flags(tenant_id,flag,value) values(p_tenant,k,p_definition->'values'->k);end if;
  end loop;
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','kind',kind,'flags',p_definition->'values');
 else
  if not p_definition ?& array['kind','reason','connection_id','revision','resource','max_pages','page_size','expires_at']
   or (p_definition-array['kind','reason','connection_id','revision','resource','contact_type','max_pages','page_size','expires_at'])<>'{}'::jsonb
   or jsonb_typeof(p_definition->'connection_id') is distinct from 'string'
   or p_definition->>'connection_id'!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or jsonb_typeof(p_definition->'max_pages') is distinct from 'number' or p_definition->>'max_pages'!~'^[0-9]{1,5}$'
   or jsonb_typeof(p_definition->'page_size') is distinct from 'number' or p_definition->>'page_size'!~'^[0-9]{1,3}$'
   or jsonb_typeof(p_definition->'revision') is distinct from 'string'
   or jsonb_typeof(p_definition->'expires_at') is distinct from 'string' then raise exception 'learn_operator_import_invalid' using errcode='22023';end if;
  connection_id:=(p_definition->>'connection_id')::uuid;revision:=(p_definition->>'revision')::timestamptz;
  expiry:=(p_definition->>'expires_at')::timestamptz;resource:=p_definition->>'resource';contact_type:=p_definition->>'contact_type';
  pages:=(p_definition->>'max_pages')::integer;page_size:=(p_definition->>'page_size')::integer;
  if not isfinite(revision) or not isfinite(expiry) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '24 hours'
   or pages not between 1 and 10000 or page_size not between 1 and 100 or resource is null or resource not in ('properties','propertyContacts','jobs')
   or (resource='propertyContacts' and (contact_type is null or contact_type not in ('customer','workaddress')))
   or (resource<>'propertyContacts' and p_definition ? 'contact_type') then raise exception 'learn_operator_import_invalid' using errcode='22023';end if;
  perform 1 from public.tenants where id=p_tenant and status='active';
  if not found then raise exception 'learn_operator_tenant_inactive' using errcode='55000';end if;
  foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
   perform 1 from public.feature_flags where tenant_id=p_tenant and flag=k and value='true'::jsonb for share;
   if not found then raise exception 'learn_operator_module_disabled' using errcode='55000';end if;
  end loop;
  select * into c from public.provider_connections where id=connection_id and tenant_id=p_tenant for share;
  if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured' or c.auth_mode is distinct from 'private_api_key'
   or c.revoked_at is not null or c.verified_at is null or c.verified_at>clock_timestamp() or c.updated_at is distinct from revision
   or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
   or length(btrim(coalesce(c.non_secret_config->>'account_key',''))) not between 1 and 2000
   or not coalesce('api_key'=any(c.configured_fields),false)
   or coalesce(c.secret_refs->>'api_key','')!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'learn_operator_connection_changed' using errcode='PT409';end if;
  -- Existence only: the setup surface never selects a secret value. The worker
  -- still revalidates the tenant-qualified secret and all authority at acquisition.
  perform 1 from vault.secrets where id=(c.secret_refs->>'api_key')::uuid and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
  if not found then raise exception 'learn_operator_credential_missing' using errcode='55000';end if;
  select * into tc from public.tenant_connectors where tenant_id=p_tenant and connector_id='commusoft' for update;
  if not found then
   insert into public.tenant_connectors(tenant_id,connector_id,provider,category,status,enabled)
    values(p_tenant,'commusoft','commusoft','business_input','active',true) returning * into tc;
  elsif tc.provider is distinct from 'commusoft' or tc.enabled is distinct from true or tc.status is distinct from 'active' then
   raise exception 'learn_operator_connector_disabled' using errcode='55000';
  end if;
  select * into a from public.connector_accounts where tenant_id=p_tenant and tenant_connector_id=tc.id and account_key=c.non_secret_config->>'account_key' for update;
  if found then
   if a.status is distinct from 'active' or exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
    and payload->>'connector_account_id'=a.id::text and status in ('queued','running','retrying')) then
    raise exception 'learn_operator_import_active' using errcode='55000';end if;
   if a.settings ? 'commusoft_import' and (a.sync_cursor->'complete' is distinct from 'true'::jsonb
    or a.sync_cursor->>'approvalId' is distinct from a.settings->'commusoft_import'->>'approvalId') then
    raise exception 'learn_operator_import_incomplete' using errcode='55000';end if;
   if a.settings ? 'commusoft_import' and a.settings->'commusoft_import'->>'connectionId' is distinct from c.id::text then
    raise exception 'learn_operator_account_connection_changed' using errcode='PT409';end if;
   previous:=jsonb_build_object('approval',a.settings->'commusoft_import','checkpoint',a.sync_cursor);aid:=a.id;
  else
   insert into public.connector_accounts(tenant_id,tenant_connector_id,account_key,display_name,status)
    values(p_tenant,tc.id,c.non_secret_config->>'account_key','Commusoft','active') returning id into aid;
  end if;
  scope:=jsonb_build_object('approved',true,'approvalId',p_request,'connectionId',c.id,'consentReference','learn-operator-input:'||p_request::text,
   'expiresAt',expiry,'maxPages',pages,'pageSize',page_size,'resource',resource)
   ||case when resource='propertyContacts' then jsonb_build_object('contactType',contact_type) else '{}'::jsonb end;
  update public.connector_accounts set settings=settings||jsonb_build_object('commusoft_import',scope),sync_cursor='{}' where id=aid;
  insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
   values(jid,p_tenant,'commusoft','learn','commusoft.source_sync','commusoft.source:'||aid::text||':'||p_request::text,'queued',5,clock_timestamp(),jsonb_build_object('connector_account_id',aid),p_actor);
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','kind',kind,'account_id',aid,'job_id',jid);
 end if;
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt,previous_state)
  values(p_request,p_tenant,p_actor,p_definition,receipt,previous);
 return receipt;
end $$;

create function public.learn_operator_inputs(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare connections jsonb;accounts jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 select coalesce(jsonb_agg(x.row order by x.id),'[]') into connections from (
  select c.id,jsonb_build_object('id',c.id,'status',c.status,'revision',c.updated_at,'verified_at',c.verified_at,'revoked',c.revoked_at is not null,
   'account_key',left(c.non_secret_config->>'account_key',2000),'region',c.non_secret_config->>'region',
   'credential_bound',exists(select 1 from vault.secrets s where s.id::text=c.secret_refs->>'api_key' and s.name='provider_secret:'||p_tenant::text||':commusoft:api_key')) as row
  from public.provider_connections c where c.tenant_id=p_tenant and c.provider='commusoft' order by c.id limit 21
 ) x;
 if jsonb_array_length(connections)>20 then raise exception 'learn_operator_connection_limit' using errcode='54000';end if;
 select coalesce(jsonb_agg(x.row order by x.id),'[]') into accounts from (
  select a.id,jsonb_build_object('id',a.id,'status',a.status,'connector_enabled',tc.enabled and tc.status='active',
   'connection_id',a.settings->'commusoft_import'->>'connectionId','resource',a.settings->'commusoft_import'->>'resource',
   'approval_id',a.settings->'commusoft_import'->>'approvalId','expires_at',a.settings->'commusoft_import'->>'expiresAt',
   'max_pages',a.settings->'commusoft_import'->'maxPages','checkpoint',jsonb_build_object('approvalId',a.sync_cursor->'approvalId','pages',a.sync_cursor->'pages','after',a.sync_cursor->'after','complete',a.sync_cursor->'complete'),
   'latest_job',(select jsonb_build_object('id',j.id,'status',j.status,'error_code',
    case when j.error_code~'^commusoft_[a-z_]{1,80}$' then j.error_code when j.error_code is not null then 'commusoft_worker_failed' end,
    'attempt_count',j.attempt_count,'available_at',j.available_at,'lease_expires_at',j.lease_expires_at,'completed_at',j.completed_at,
    'stop_reason',case when j.result->>'stop_reason' in ('collection_exhausted','page_budget_exhausted','next_page','authorisation_changed') then j.result->>'stop_reason' end)
    from public.platform_jobs j where j.tenant_id=p_tenant and j.job_type='commusoft.source_sync' and j.payload->>'connector_account_id'=a.id::text order by j.created_at desc,j.id desc limit 1)) as row
  from public.connector_accounts a join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  where a.tenant_id=p_tenant and tc.connector_id='commusoft' and tc.provider='commusoft' order by a.id limit 21
 ) x;
 if jsonb_array_length(accounts)>20 then raise exception 'learn_operator_account_limit' using errcode='54000';end if;
 return jsonb_build_object('tenant_id',p_tenant,'checked_at',clock_timestamp(),'flags',public.learn_operator_input_flags(p_tenant),'connections',connections,'accounts',accounts);
end $$;
revoke all on function public.learn_operator_input_immutable(),public.learn_operator_input_access(uuid,uuid,boolean),public.learn_operator_input_flags(uuid),
 public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text),public.learn_operator_inputs(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text),public.learn_operator_inputs(uuid) to authenticated;

-- INPUT supabase/migrations/20261031170000_learn_commusoft_connection_setup.sql
-- Operator-governed Commusoft setup. Reuses the existing tenant Vault broker.
-- Configuration is not verification and never starts an import or changes flags.

create table public.learn_commusoft_connection_requests (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 definition jsonb not null,
 credential_fingerprint text,
 previous_state jsonb,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_commusoft_connection_requests enable row level security;
revoke all on public.learn_commusoft_connection_requests from public,anon,authenticated,service_role;
create trigger learn_commusoft_connection_immutable before update or delete on public.learn_commusoft_connection_requests
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_commusoft_configure(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply',p_api_key text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_commusoft_connection_requests%rowtype;c public.provider_connections%rowtype;
 wanted_revision timestamptz;region text;account_key text;credential_mode text;secret_id uuid;
 key_fingerprint text;previous jsonb;receipt jsonb;has_connection boolean;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000
  or (p_mode<>'apply' and p_api_key is not null) then
  raise exception 'learn_connection_request_invalid' using errcode='22023';end if;
 if p_api_key is not null then
  if octet_length(p_api_key) not between 1 and 4096 or p_api_key!~'^[!-~]+$' then
   raise exception 'learn_connection_credential_invalid' using errcode='22023';end if;
  key_fingerprint:=encode(sha256(convert_to('commusoft:'||p_api_key,'UTF8')),'hex');
 end if;
 if not p_definition ?& array['kind','reason','region','account_key','expected_revision','credential_mode','same_account_confirmed']
  or (p_definition-array['kind','reason','region','account_key','expected_revision','credential_mode','same_account_confirmed'])<>'{}'::jsonb
  or p_definition->>'kind' is distinct from 'configure_commusoft'
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_definition->'region') is distinct from 'string' or p_definition->>'region' not in ('uk','us')
  or jsonb_typeof(p_definition->'account_key') is distinct from 'string' or length(btrim(p_definition->>'account_key')) not between 1 and 2000
  or jsonb_typeof(p_definition->'expected_revision') not in ('string','null')
  or jsonb_typeof(p_definition->'credential_mode') is distinct from 'string' or p_definition->>'credential_mode' not in ('reuse','replace')
  or p_definition->'same_account_confirmed' is distinct from 'true'::jsonb then
  raise exception 'learn_connection_definition_invalid' using errcode='22023';end if;
 region:=p_definition->>'region';account_key:=btrim(p_definition->>'account_key');credential_mode:=p_definition->>'credential_mode';
 if p_definition->>'expected_revision' is not null then
  wanted_revision:=(p_definition->>'expected_revision')::timestamptz;
  if not isfinite(wanted_revision) then raise exception 'learn_connection_revision_invalid' using errcode='22023';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-connection-request:'||p_request::text,0));
 select * into prior from public.learn_commusoft_connection_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition
   or (p_api_key is not null and prior.receipt->>'state'<>'cancelled' and prior.credential_fingerprint is distinct from key_fingerprint) then
   raise exception 'learn_connection_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_commusoft_connection_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,p_actor,p_definition,receipt);
  return receipt;
 end if;
 if (credential_mode='replace' and p_api_key is null) or (credential_mode='reuse' and p_api_key is not null) then
  raise exception 'learn_connection_credential_mode_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'learn_connection_tenant_inactive' using errcode='55000';end if;
 -- Approval creation uses the same tenant lock. Running/queued work must first
 -- be resolved; do not invalidate a source traversal behind its operator.
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then
  raise exception 'learn_connection_import_active' using errcode='55000';end if;
 select * into c from public.provider_connections where tenant_id=p_tenant and provider='commusoft' for update;
 has_connection:=found;
 if (has_connection and c.updated_at is distinct from wanted_revision) or (not has_connection and wanted_revision is not null) then
  raise exception 'learn_connection_revision_changed' using errcode='PT409';end if;
 -- This is credential maintenance for the same source identity. Moving to a
 -- different provider account/region requires an explicit retained-identity flow.
 if has_connection and ((c.non_secret_config ? 'account_key' and c.non_secret_config->>'account_key' is distinct from account_key)
  or (c.non_secret_config ? 'region' and c.non_secret_config->>'region' is distinct from region)) then
  raise exception 'learn_connection_source_identity_changed' using errcode='PT409';end if;
 if has_connection then
  previous:=jsonb_build_object('connection_id',c.id,'revision',c.updated_at,'status',c.status,'verified_at',c.verified_at,
    'account_key',c.non_secret_config->>'account_key','region',c.non_secret_config->>'region','configured_fields',c.configured_fields);
 end if;
 if credential_mode='reuse' then
  -- Vault grants metadata SELECT, not UPDATE needed by row-lock clauses. The
  -- tenant setup lock and connection row lock fence governed configuration changes.
  select id into secret_id from vault.secrets where name='provider_secret:'||p_tenant::text||':commusoft:api_key';
  if secret_id is null then raise exception 'learn_connection_credential_missing' using errcode='55000';end if;
  if has_connection and c.secret_refs ? 'api_key' and c.secret_refs->>'api_key' is distinct from secret_id::text then
   raise exception 'learn_connection_binding_changed' using errcode='PT409';end if;
 else
  secret_id:=public.provider_secret_store(p_tenant,'commusoft','api_key',p_api_key);
 end if;
 if has_connection then
  update public.provider_connections set status='configured',auth_mode='private_api_key',
   non_secret_config=non_secret_config||jsonb_build_object('region',region,'account_key',account_key),
   configured_fields=array['api_key'],secret_refs=jsonb_build_object('api_key',secret_id),
   verified_at=null,last_test=jsonb_build_object('state','not_verified','code','configuration_changed'),
   updated_by=p_actor,revoked_at=null,revoked_by=null where id=c.id returning * into c;
 else
  insert into public.provider_connections(tenant_id,provider,status,auth_mode,non_secret_config,configured_fields,secret_refs,created_by,updated_by,last_test)
   values(p_tenant,'commusoft','configured','private_api_key',jsonb_build_object('region',region,'account_key',account_key),
    array['api_key'],jsonb_build_object('api_key',secret_id),p_actor,p_actor,jsonb_build_object('state','not_verified','code','configuration_changed')) returning * into c;
 end if;
 insert into public.provider_connection_events(tenant_id,provider,event,actor_id,detail)
  values(p_tenant,'commusoft','learn_connection_configured',p_actor,jsonb_build_object('request_id',p_request,'connection_id',c.id,'credential_mode',credential_mode,'verified',false));
 receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','connection_id',c.id,'revision',c.updated_at,'credential_bound',true,'verification','required');
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_commusoft_connection_requests(id,tenant_id,actor_id,definition,credential_fingerprint,previous_state,receipt)
  values(p_request,p_tenant,p_actor,p_definition,key_fingerprint,previous,receipt);
 return receipt;
end $$;
revoke all on function public.learn_commusoft_configure(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_configure(uuid,uuid,uuid,jsonb,text,text) to authenticated;

-- INPUT supabase/migrations/20261031180000_learn_commusoft_connection_verification.sql
-- Explicit, bounded access checks. No imports, switches, schedules or provider
-- calls on installation. Provider payloads are never retained by this protocol.

create table public.learn_commusoft_verification_requests (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 definition jsonb not null,
 binding jsonb,
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create table public.learn_commusoft_verification_permits (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique references public.learn_commusoft_verification_requests(id),
 credential_fingerprint text not null references public.learn_business_input_request_gates(credential_fingerprint),
 send_before timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create table public.learn_commusoft_verification_results (
 request_id uuid primary key references public.learn_commusoft_verification_requests(id),
 observation_code text,
 retry_at timestamptz,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_commusoft_verification_requests enable row level security;
alter table public.learn_commusoft_verification_permits enable row level security;
alter table public.learn_commusoft_verification_results enable row level security;
revoke all on public.learn_commusoft_verification_requests,public.learn_commusoft_verification_permits,
 public.learn_commusoft_verification_results from public,anon,authenticated,service_role;
create trigger learn_commusoft_verification_request_immutable before update or delete on public.learn_commusoft_verification_requests
 for each row execute function public.learn_operator_input_immutable();
create trigger learn_commusoft_verification_permit_immutable before update or delete on public.learn_commusoft_verification_permits
 for each row execute function public.learn_operator_input_immutable();
create trigger learn_commusoft_verification_result_immutable before update or delete on public.learn_commusoft_verification_results
 for each row execute function public.learn_operator_input_immutable();

-- Internal helpers have no API grants. Service authority comes from the retained
-- authenticated request, never a caller-supplied actor or credential binding.
create function public.learn_commusoft_verification_binding(c public.provider_connections) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('connection_id',c.id,'revision',c.updated_at,'region',c.non_secret_config->>'region',
 'account_key',c.non_secret_config->>'account_key','secret_id',c.secret_refs->>'api_key');
$$;
create function public.learn_commusoft_verification_authority(r public.learn_commusoft_verification_requests)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c public.provider_connections%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' or r.binding is null or r.expires_at<=clock_timestamp() then return false;end if;
 perform 1 from public.profiles where id=r.actor_id for share;
 if not found then return false;end if;
 perform 1 from public.platform_authority_grants where profile_id=r.actor_id and permission='platform.controlplane.admin'
  and coalesce(effective_from,'-infinity')<=clock_timestamp() and coalesce(effective_to,'infinity')>clock_timestamp() for share;
 if not found then return false;end if;
 if exists(select 1 from public.view_as_context where actor_user_id=r.actor_id and ended_at is null
  and (expires_at is null or expires_at>clock_timestamp())) then return false;end if;
 perform 1 from public.tenants where id=r.tenant_id and status='active' for share;
 if not found then return false;end if;
 if exists(select 1 from public.platform_jobs where tenant_id=r.tenant_id and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then return false;end if;
 select * into c from public.provider_connections where id=(r.definition->>'connection_id')::uuid and tenant_id=r.tenant_id for share;
 if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured'
  or c.auth_mode is distinct from 'private_api_key' or c.revoked_at is not null
  or not coalesce('api_key'=any(c.configured_fields),false)
  or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
  or nullif(btrim(c.non_secret_config->>'account_key'),'') is null
  or public.learn_commusoft_verification_binding(c) is distinct from r.binding then return false;end if;
 perform 1 from vault.secrets where id::text=c.secret_refs->>'api_key'
  and name='provider_secret:'||r.tenant_id::text||':commusoft:api_key';
 if not found then return false;end if;
 return r.expires_at>clock_timestamp();
end $$;
create function public.learn_commusoft_verification_receipt(p_tenant uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_verification_requests%rowtype; receipt jsonb;
begin
 select * into r from public.learn_commusoft_verification_requests where id=p_request and tenant_id=p_tenant;
 if not found then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 select x.receipt into receipt from public.learn_commusoft_verification_results x where request_id=r.id;
 if found then return receipt;end if;
 return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state',
  case when r.expires_at<=clock_timestamp() then 'expired'
  when exists(select 1 from public.learn_commusoft_verification_permits where request_id=r.id) then 'running' else 'approved' end,
  'expires_at',r.expires_at);
end $$;

create function public.learn_commusoft_verify_request(p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_verification_requests%rowtype;c public.provider_connections%rowtype;receipt jsonb;revision timestamptz;connection uuid;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000
  or not p_definition ?& array['kind','reason','connection_id','revision','one_read_confirmed']
  or (p_definition-array['kind','reason','connection_id','revision','one_read_confirmed'])<>'{}'::jsonb
  or p_definition->>'kind' is distinct from 'verify_commusoft'
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_definition->'connection_id') is distinct from 'string'
  or jsonb_typeof(p_definition->'revision') is distinct from 'string'
  or p_definition->'one_read_confirmed' is distinct from 'true'::jsonb then
  raise exception 'learn_verification_definition_invalid' using errcode='22023';end if;
 connection:=(p_definition->>'connection_id')::uuid;revision:=(p_definition->>'revision')::timestamptz;
 if not isfinite(revision) then raise exception 'learn_verification_revision_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-verification-request:'||p_request::text,0));
 select * into r from public.learn_commusoft_verification_requests where id=p_request;
 if found and (r.tenant_id<>p_tenant or r.actor_id<>p_actor or r.definition<>p_definition) then
  raise exception 'learn_verification_request_conflict' using errcode='PT409';end if;
 if p_mode='check' then return public.learn_commusoft_verification_receipt(p_tenant,p_request);end if;
 if r.id is not null and (p_mode='apply' or exists(select 1 from public.learn_commusoft_verification_results where request_id=r.id)) then
  return public.learn_commusoft_verification_receipt(p_tenant,p_request);end if;
 if p_mode='cancel' then
  if r.id is null then
   insert into public.learn_commusoft_verification_requests(id,tenant_id,actor_id,definition,expires_at)
    values(p_request,p_tenant,p_actor,p_definition,clock_timestamp());
  end if;
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_commusoft_verification_results(request_id,receipt) values(p_request,receipt);
  return receipt;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 if exists(select 1 from public.learn_commusoft_verification_requests q where q.tenant_id=p_tenant
  and q.expires_at>clock_timestamp() and not exists(select 1 from public.learn_commusoft_verification_results x where x.request_id=q.id)) then
  raise exception 'learn_verification_active' using errcode='55000';end if;
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then
  raise exception 'learn_verification_import_active' using errcode='55000';end if;
 select * into c from public.provider_connections where id=connection and tenant_id=p_tenant for share;
 if not found or c.updated_at is distinct from revision then raise exception 'learn_verification_revision_changed' using errcode='PT409';end if;
 r.id:=p_request;r.tenant_id:=p_tenant;r.actor_id:=p_actor;r.definition:=p_definition;
 r.binding:=public.learn_commusoft_verification_binding(c);r.expires_at:=clock_timestamp()+interval '2 minutes';
 if not public.learn_commusoft_verification_authority(r) then raise exception 'learn_verification_unavailable' using errcode='55000';end if;
 insert into public.learn_commusoft_verification_requests(id,tenant_id,actor_id,definition,binding,expires_at)
  values(r.id,r.tenant_id,r.actor_id,r.definition,r.binding,r.expires_at);
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 return public.learn_commusoft_verification_receipt(p_tenant,p_request);
end $$;

create function public.learn_commusoft_verify_acquire(p_tenant uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_verification_requests%rowtype;secret text;fingerprint text;next_at timestamptz;permit public.learn_commusoft_verification_permits%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'learn_verification_forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-verification-request:'||p_request::text,0));
 select * into r from public.learn_commusoft_verification_requests where id=p_request and tenant_id=p_tenant;
 if not found or exists(select 1 from public.learn_commusoft_verification_results where request_id=r.id)
  or exists(select 1 from public.learn_commusoft_verification_permits where request_id=r.id) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 if not public.learn_commusoft_verification_authority(r) then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id::text=r.binding->>'secret_id'
  and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
 if secret is null or octet_length(secret) not between 1 and 4096 or secret!~'^[!-~]+$' then return null;end if;
 fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
 insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
 select next_allowed_at into next_at from public.learn_business_input_request_gates where credential_fingerprint=fingerprint for update;
 if not public.learn_commusoft_verification_authority(r) then return null;end if;
 if next_at>clock_timestamp() then return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from next_at)*1000)::bigint);end if;
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds' where credential_fingerprint=fingerprint;
 insert into public.learn_commusoft_verification_permits(request_id,credential_fingerprint,send_before)
  values(r.id,fingerprint,least(r.expires_at,clock_timestamp()+interval '5 seconds')) returning * into permit;
 return jsonb_build_object('state','ready','apiKey',secret,'permitId',permit.id,'region',r.binding->>'region',
  'sendBefore',floor(extract(epoch from permit.send_before)*1000)::bigint);
end $$;

create function public.learn_commusoft_verify_authorized(p_tenant uuid,p_request uuid,p_permit uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_verification_requests%rowtype;permit public.learn_commusoft_verification_permits%rowtype;fingerprint text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'learn_verification_forbidden' using errcode='42501';end if;
 select * into r from public.learn_commusoft_verification_requests where id=p_request and tenant_id=p_tenant;
 if not found or exists(select 1 from public.learn_commusoft_verification_results where request_id=r.id) then return false;end if;
 select * into permit from public.learn_commusoft_verification_permits where id=p_permit and request_id=r.id;
 if not found or not public.learn_commusoft_verification_authority(r) then return false;end if;
 select encode(sha256(convert_to('commusoft:'||decrypted_secret,'UTF8')),'hex') into fingerprint from vault.decrypted_secrets
  where id::text=r.binding->>'secret_id' and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
 return fingerprint is not null and fingerprint=permit.credential_fingerprint;
end $$;

create function public.learn_commusoft_verify_finish(p_tenant uuid,p_request uuid,p_permit uuid,p_code text,p_retry_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_verification_requests%rowtype;permit public.learn_commusoft_verification_permits%rowtype;
 prior public.learn_commusoft_verification_results%rowtype;receipt jsonb;code text;verified timestamptz;revision timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'learn_verification_forbidden' using errcode='42501';end if;
 if p_code is null or p_code not in ('access_verified','invalid_request','authority_unavailable','transport_unavailable','authentication_required',
  'access_denied','rate_limited','provider_unavailable','provider_rejected','response_too_large','invalid_response')
  or (p_retry_at is not null and not isfinite(p_retry_at)) then raise exception 'learn_verification_result_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-verification-request:'||p_request::text,0));
 select * into r from public.learn_commusoft_verification_requests where id=p_request and tenant_id=p_tenant;
 if not found then return null;end if;
 select * into permit from public.learn_commusoft_verification_permits where id=p_permit and request_id=r.id;
 if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 -- Even a late response after cancellation/revocation must protect shared quota.
 if p_retry_at is not null then
  update public.learn_business_input_request_gates set next_allowed_at=greatest(next_allowed_at,p_retry_at) where credential_fingerprint=permit.credential_fingerprint;
 end if;
 select * into prior from public.learn_commusoft_verification_results where request_id=r.id;
 if found then
  if prior.receipt->>'state'<>'cancelled' and (prior.observation_code is distinct from p_code or prior.retry_at is distinct from p_retry_at) then
   raise exception 'learn_verification_result_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 -- Acquire the connection update lock before inspecting its revision/authority.
 perform 1 from public.provider_connections where id=(r.definition->>'connection_id')::uuid and tenant_id=p_tenant for update;
 code:=case when public.learn_commusoft_verify_authorized(p_tenant,p_request,p_permit) then p_code else 'authority_changed' end;
 if code<>'authority_changed' then
  if code='access_verified' then verified:=clock_timestamp();end if;
  update public.provider_connections set verified_at=verified,
   last_test=jsonb_build_object('state',case when verified is null then 'failed' else 'verified' end,'code',code,'request_id',r.id,'checked_at',clock_timestamp()),
   updated_by=r.actor_id where id=(r.definition->>'connection_id')::uuid and tenant_id=p_tenant returning updated_at into revision;
  insert into public.provider_connection_events(tenant_id,provider,event,actor_id,detail)
   values(p_tenant,'commusoft','learn_connection_checked',r.actor_id,jsonb_build_object('request_id',r.id,'code',code,'verified',verified is not null));
 end if;
 receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','connection_id',r.definition->>'connection_id',
  'code',code,'verified_at',verified,'revision',revision);
 insert into public.learn_commusoft_verification_results(request_id,observation_code,retry_at,receipt) values(r.id,p_code,p_retry_at,receipt);
 return receipt;
end $$;

revoke all on function public.learn_commusoft_verification_binding(public.provider_connections),
 public.learn_commusoft_verification_authority(public.learn_commusoft_verification_requests),public.learn_commusoft_verification_receipt(uuid,uuid),
 public.learn_commusoft_verify_request(uuid,uuid,uuid,jsonb,text),public.learn_commusoft_verify_acquire(uuid,uuid),
 public.learn_commusoft_verify_authorized(uuid,uuid,uuid),public.learn_commusoft_verify_finish(uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_verify_request(uuid,uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.learn_commusoft_verify_acquire(uuid,uuid),public.learn_commusoft_verify_authorized(uuid,uuid,uuid),
 public.learn_commusoft_verify_finish(uuid,uuid,uuid,text,timestamptz) to service_role;

-- INPUT supabase/migrations/20261031190000_learn_business_input_contacts.sql
-- Reviewed property contacts use canonical People, contact points and graph edges.
-- Source consent flags stay evidence; they never grant marketing permission.

create function public.learn_business_contact_phone(p_value text,p_region text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case when nullif(btrim(p_value),'') is null then null
  when p_region='uk' then public.import_normalize_phone_uk(p_value)
  else nullif((case when left(btrim(p_value),1)='+' then '+' else '' end)||regexp_replace(p_value,'[^0-9]','','g'),'') end;
$$;

create function public.learn_commusoft_confirm_contact(p_tenant uuid,p_version uuid,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;owner jsonb;request jsonb;result jsonb;
 parent text;reason text;field text;label text;email text;region text;phone jsonb;phones jsonb:='[]';normalized text;
 target uuid;namespace text;meta jsonb;person_node uuid;card_node uuid;site_node uuid;edge uuid;phone_count integer;
begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_version is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
  raise exception 'business_input_review_invalid' using errcode='22023';end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft' and collection='propertyContacts';
 if not found then raise exception 'business_input_contact_source_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 select non_secret_config->>'region' into region from public.provider_connections where tenant_id=p_tenant and id=v.connection_id for update;
 request:=jsonb_build_object('target',p_target,'reason',btrim(p_reason),'kind','contact');
 <<project>> begin
  latest:=public.learn_business_input_latest(p_tenant,v.connection_id,v.provider,v.collection,v.external_id);
  if latest.id is distinct from v.id then reason:='source_changed_or_ambiguous';exit project;end if;
  if jsonb_typeof(v.payload->'id') is distinct from 'number' or v.payload->>'id' is distinct from v.external_id then reason:='source_identity_invalid';exit project;end if;
  parent:=v.payload->>'propertyID';
  if jsonb_typeof(v.payload->'propertyID') is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$' then reason:='property_reference_invalid';exit project;end if;
  if parent::numeric>9007199254740991 then reason:='property_reference_invalid';exit project;end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,v.connection_id,parent,true);
  if owner->>'state'<>'ready' then reason:=owner->>'reason';exit project;end if;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=v.connection_id
   and provider=v.provider and collection=v.collection and external_id=v.external_id;
  if found then
   if l.source_version_id<>v.id or l.entity_kind<>'contact' or l.entity_table<>'people'
    or (p_target is not null and p_target<>l.entity_id) or l.card_id is distinct from (owner->>'card_id')::uuid then
    reason:='existing_identity_needs_review';exit project;end if;
   perform 1 from public.people where tenant_id=p_tenant and id=l.entity_id for share;
   if not found then reason:='contact_target_missing';exit project;end if;
   result:=jsonb_build_object('state','linked','entity_id',l.entity_id,'entity_kind','contact','link_id',l.id,'already',true);
   exit project;
  end if;
  foreach field in array array['firstName','lastName','position','email'] loop
   if v.payload ? field and v.payload->field<>'null'::jsonb and (jsonb_typeof(v.payload->field)<>'string' or length(v.payload->>field)>1000) then
    reason:='contact_field_invalid';exit project;end if;
  end loop;
  label:=nullif(btrim(concat_ws(' ',nullif(btrim(v.payload->>'firstName'),''),nullif(btrim(v.payload->>'lastName'),''))),'');
  if label is null then reason:='contact_name_required';exit project;end if;
  email:=nullif(lower(btrim(v.payload->>'email')),'');
  if email is not null and (length(email)>320 or email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then reason:='contact_email_invalid';exit project;end if;
  if v.payload ? 'telephones' and v.payload->'telephones'<>'null'::jsonb then
   if jsonb_typeof(v.payload->'telephones')<>'array' then reason:='contact_phone_invalid';exit project;end if;
   if jsonb_array_length(v.payload->'telephones')>50 then reason:='contact_phone_invalid';exit project;end if;
   for phone in select value from jsonb_array_elements(v.payload->'telephones') loop
    if jsonb_typeof(phone)<>'object' or jsonb_typeof(phone->'number') is distinct from 'string' or length(phone->>'number')>1000
     or (phone ? 'type' and phone->'type'<>'null'::jsonb and (jsonb_typeof(phone->'type')<>'string' or length(phone->>'type')>100)) then
     reason:='contact_phone_invalid';exit project;end if;
    normalized:=public.learn_business_contact_phone(phone->>'number',region);
    if normalized is null or normalized!~'^\+?[0-9]{5,20}$' then reason:='contact_phone_invalid';exit project;end if;
    if not exists(select 1 from jsonb_array_elements(phones) x where x->>'normalized'=normalized) then
     phones:=phones||jsonb_build_array(jsonb_build_object('value',phone->>'number','normalized',normalized,'label',nullif(btrim(phone->>'type'),'')));
    end if;
   end loop;
  end if;
  target:=p_target;
  if target is not null then
   perform 1 from public.people where id=target and tenant_id=p_tenant for share;
   if not found then reason:='contact_target_missing';exit project;end if;
  else
   -- Potential channel matches need explicit selection; never silently duplicate
   -- or merge a customer, household member or shared reception identity.
   if exists(select 1 from public.people p where p.tenant_id=p_tenant and
     ((email is not null and lower(btrim(p.primary_email))=email) or exists(select 1 from jsonb_array_elements(phones) x where public.learn_business_contact_phone(p.primary_phone,region)=x->>'normalized')))
    or exists(select 1 from public.contact_points cp where cp.tenant_id=p_tenant and
     ((email is not null and cp.channel='email' and cp.normalized_value=email) or (cp.channel='phone' and exists(select 1 from jsonb_array_elements(phones) x where cp.normalized_value=x->>'normalized')))) then
    reason:='contact_identity_needs_review';exit project;end if;
  end if;
  -- Existing inactive relationship evidence is not reactivated by an import.
  if target is not null and exists(select 1 from public.graph_edges e
   join public.graph_nodes f on f.id=e.from_node_id and f.tenant_id=e.tenant_id
   join public.graph_nodes t on t.id=e.to_node_id and t.tenant_id=e.tenant_id
   where e.tenant_id=p_tenant and e.edge_type='contact_for' and f.node_type='person' and f.source_table='people' and f.source_id=target
    and ((t.node_type='customer_card' and t.source_table='customer_cards' and t.source_id=(owner->>'card_id')::uuid)
      or (t.node_type='site' and t.source_table='sites' and t.source_id=(owner->>'site_id')::uuid)) and e.status<>'active') then
   reason:='contact_relationship_needs_review';exit project;end if;
  meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,'source_version_id',v.id,'property_external_id',parent,'position',v.payload->'position','relationships',owner));
  phone_count:=jsonb_array_length(phones);
  if target is null then
   insert into public.people(tenant_id,display_name,first_name,last_name,primary_email,primary_phone,verified,created_source,metadata)
    values(p_tenant,label,nullif(btrim(v.payload->>'firstName'),''),nullif(btrim(v.payload->>'lastName'),''),email,
     case when phone_count=1 then phones->0->>'value' end,false,'business_input:commusoft',meta) returning id into target;
  end if;
  -- Existing person fields and endpoint verification/primary choices remain intact.
  if email is not null then
   insert into public.contact_points(tenant_id,person_id,channel,value,normalized_value,is_primary,verification_state,source,source_record_ref,metadata)
    values(p_tenant,target,'email',btrim(v.payload->>'email'),email,false,'unverified','import',v.id::text,meta) on conflict(tenant_id,person_id,channel,normalized_value) do nothing;
  end if;
  for phone in select value from jsonb_array_elements(phones) loop
   insert into public.contact_points(tenant_id,person_id,channel,value,normalized_value,label,is_primary,verification_state,source,source_record_ref,metadata)
    values(p_tenant,target,'phone',phone->>'value',phone->>'normalized',phone->>'label',false,'unverified','import',v.id::text,meta) on conflict(tenant_id,person_id,channel,normalized_value) do nothing;
  end loop;
  insert into public.graph_nodes(tenant_id,node_type,source_table,source_id,label,metadata)
   select p_tenant,'person','people',id,display_name,meta from public.people where id=target and tenant_id=p_tenant
   on conflict(tenant_id,node_type,source_table,source_id) where source_id is not null do nothing;
  select id into person_node from public.graph_nodes where tenant_id=p_tenant and node_type='person' and source_table='people' and source_id=target;
  insert into public.graph_nodes(tenant_id,node_type,source_table,source_id,label,metadata)
   select p_tenant,'customer_card','customer_cards',id,title,meta from public.customer_cards where id=(owner->>'card_id')::uuid and tenant_id=p_tenant
   on conflict(tenant_id,node_type,source_table,source_id) where source_id is not null do nothing;
  select id into card_node from public.graph_nodes where tenant_id=p_tenant and node_type='customer_card' and source_table='customer_cards' and source_id=(owner->>'card_id')::uuid;
  insert into public.graph_edges(tenant_id,edge_type,from_node_id,to_node_id,evidence,metadata)
   values(p_tenant,'contact_for',person_node,card_node,jsonb_build_array(jsonb_build_object('source_version_id',v.id)),meta)
   on conflict(tenant_id,edge_type,from_node_id,to_node_id) do nothing;
  if owner->>'site_id' is not null then
   insert into public.graph_nodes(tenant_id,node_type,source_table,source_id,label,metadata)
    select p_tenant,'site','sites',s.id,s.label,meta from public.sites s where s.id=(owner->>'site_id')::uuid and tenant_id=p_tenant
    on conflict(tenant_id,node_type,source_table,source_id) where source_id is not null do nothing;
   select id into site_node from public.graph_nodes where tenant_id=p_tenant and node_type='site' and source_table='sites' and source_id=(owner->>'site_id')::uuid;
   insert into public.graph_edges(tenant_id,edge_type,from_node_id,to_node_id,evidence,metadata)
    values(p_tenant,'contact_for',person_node,site_node,jsonb_build_array(jsonb_build_object('source_version_id',v.id)),meta)
    on conflict(tenant_id,edge_type,from_node_id,to_node_id) do nothing;
  end if;
  insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
   values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,'contact','people',target,(owner->>'card_id')::uuid,request||jsonb_build_object('relationships',owner),auth.uid()) returning * into l;
  insert into public.graph_events(tenant_id,event_type,node_id,payload) values(p_tenant,'contact.linked',person_node,jsonb_build_object('source_link_id',l.id,'source_version_id',v.id,'customer_card_id',l.card_id));
  result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind','contact','link_id',l.id,'already',false);
 end project;
 if reason is not null then result:=jsonb_build_object('state','held','reason',reason);end if;
 return public.learn_business_input_projection_result(p_tenant,v.id,request,result);
end $$;
revoke all on function public.learn_business_contact_phone(text,text) from public,anon,authenticated,service_role;
revoke all on function public.learn_commusoft_confirm_contact(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.learn_commusoft_confirm_contact(uuid,uuid,uuid,text) to authenticated;

create or replace function public.learn_commusoft_work_batch(p_tenant uuid,p_request uuid,p_connection uuid,p_kind text,p_items jsonb,p_reason text,p_cancel boolean default false,p_expected_actor uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.learn_business_input_projection_batches%rowtype;v public.learn_business_input_versions%rowtype;
 request jsonb;result jsonb;outcomes jsonb:='[]';item jsonb;outcome jsonb;version uuid;target uuid;
 seen uuid[]:='{}';identities text[]:='{}';linked integer:=0;held integer:=0;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 if p_expected_actor is distinct from auth.uid() then raise exception 'business_input_actor_changed' using errcode='42501';end if;
 -- Existing tenant roster lock also serializes competing confirmations/cancellations.
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 if p_request is null or p_connection is null or p_kind is null or p_kind not in ('site','job','contact') or p_cancel is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 or jsonb_typeof(p_items) is distinct from 'array'
  or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'business_input_batch_invalid' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>2
   or jsonb_typeof(item->'version_id') is distinct from 'string' or item->>'version_id'!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or not item ? 'target_id' or not (item->'target_id'='null'::jsonb or (jsonb_typeof(item->'target_id')='string' and item->>'target_id'~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')) then
   raise exception 'business_input_batch_item_invalid' using errcode='22023';end if;
  version:=(item->>'version_id')::uuid;
  if version=any(seen) then raise exception 'business_input_batch_duplicate' using errcode='22023';end if;
  seen:=array_append(seen,version);
 end loop;
 request:=jsonb_build_object('connection_id',p_connection,'kind',p_kind,'items',p_items,'reason',btrim(p_reason));
 select * into b from public.learn_business_input_projection_batches where tenant_id=p_tenant and id=p_request;
 if found then
  if b.actor_id is distinct from auth.uid() or b.request is distinct from request then raise exception 'business_input_batch_conflict' using errcode='PT409';end if;
  return b.result; -- A saved cancellation also fences a late original apply.
 end if;
 if not p_cancel then
  perform public.learn_business_input_review_access(p_tenant,p_connection);
  perform 1 from public.provider_connections where id=p_connection and tenant_id=p_tenant for update;
  -- Prevalidate every scope before any row is projected. Unknown/foreign rows
  -- abort the batch, rather than becoming successful partial application.
  for item in select value from jsonb_array_elements(p_items) loop
   select * into v from public.learn_business_input_versions where id=(item->>'version_id')::uuid and tenant_id=p_tenant
    and connection_id=p_connection and provider='commusoft';
   if not found or (p_kind='contact' and v.collection<>'propertyContacts') or (p_kind='job' and v.collection<>'jobs') or
    (p_kind='site' and (v.collection<>'properties' or v.payload->>'type' is distinct from 'workaddress')) then
    raise exception 'business_input_batch_scope_invalid' using errcode='22023';end if;
   if v.external_id=any(identities) then raise exception 'business_input_batch_identity_duplicate' using errcode='22023';end if;
   identities:=array_append(identities,v.external_id);
  end loop;
  for item in select value from jsonb_array_elements(p_items) loop
   if p_kind='contact' then outcome:=public.learn_commusoft_confirm_contact(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));
   else outcome:=public.learn_commusoft_confirm_work_record(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));end if;
   if outcome->>'state'='linked' then linked:=linked+1;
   elsif outcome->>'state'='held' then held:=held+1;
   else raise exception 'business_input_batch_outcome_invalid';end if;
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('version_id',item->>'version_id','outcome',outcome));
  end loop;
 end if;
 result:=jsonb_build_object('batch_id',p_request,'tenant_id',p_tenant,'actor_id',auth.uid(),'connection_id',p_connection,'kind',p_kind,
  'state',case when p_cancel then 'cancelled' else 'recorded' end,'items',outcomes,'linked',linked,'held',held);
 insert into public.learn_business_input_projection_batches(tenant_id,id,actor_id,request,result) values(p_tenant,p_request,auth.uid(),request,result);
 return result;
end $$;


create or replace function public.learn_commusoft_work_review_page(p_tenant uuid,p_connection uuid,p_kind text,p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r record;v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 rows jsonb:='[]';owner jsonb;attempt jsonb;label text;parent text;customer text;v_collection text;last_id text;counted integer:=0;more boolean:=false;
begin
 if p_connection is null or p_kind is null or p_kind not in ('site','job','contact') or p_limit is null or p_limit not between 1 and 50
  or (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 v_collection:=case when p_kind='site' then 'properties' when p_kind='contact' then 'propertyContacts' else 'jobs' end;
 for r in select distinct s.external_id collate "C" as external_id from public.learn_business_input_versions s where s.tenant_id=p_tenant and s.connection_id=p_connection
  and s.provider='commusoft' and s.collection=v_collection and (p_kind in ('job','contact') or s.payload->>'type'='workaddress')
  and (p_after is null or s.external_id collate "C">p_after collate "C") order by s.external_id collate "C" limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.external_id;
  v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft',v_collection,r.external_id);
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and learn_business_input_links.collection=v_collection and external_id=r.external_id;
  parent:=case when p_kind='site' then v.payload->>'parentPropertyID' else v.payload->>'propertyID' end;
  owner:=case when v.id is null then jsonb_build_object('state','held','reason','source_changed_or_ambiguous')
   else public.learn_commusoft_property_owner(p_tenant,p_connection,parent,p_kind in ('job','contact')) end;
  customer:=null;
  if owner->>'state'='ready' then
   if owner->>'person_id' is not null then select display_name into customer from public.people where tenant_id=p_tenant and id=(owner->>'person_id')::uuid;
   else select name into customer from public.companies where tenant_id=p_tenant and id=(owner->>'company_id')::uuid;end if;
  end if;
  select a.result into attempt from public.learn_business_input_projection_attempts a where a.tenant_id=p_tenant and a.source_version_id=v.id order by a.created_at desc,a.id desc limit 1;
  label:=case when p_kind='site' then public.learn_business_input_text(v.payload,'addressLine1') when p_kind='contact' then nullif(btrim(concat_ws(' ',public.learn_business_input_text(v.payload,'firstName'),public.learn_business_input_text(v.payload,'lastName'))),'') else public.learn_business_input_text(v.payload,'description') end;
  rows:=rows||jsonb_build_array(jsonb_build_object('external_id',r.external_id,'version_id',v.id,'title',coalesce(label,initcap(p_kind)||' '||r.external_id),
   'property_reference',case when parent~'^[1-9][0-9]{0,15}$' then parent end,'customer_name',left(customer,1000),'relationship_reason',owner->>'reason',
   'source_status',public.learn_business_input_text(v.payload,'status'),'linked_version_id',l.source_version_id,'last_result',attempt,
   'contact',case when p_kind='contact' then jsonb_build_object('email',public.learn_business_input_text(v.payload,'email'),'position',public.learn_business_input_text(v.payload,'position'),
    'phones',(select coalesce(jsonb_agg(x.number),'[]'::jsonb) from (select left(concat_ws(': ',ph->>'type',ph->>'number'),1000) as number from jsonb_array_elements(case when jsonb_typeof(v.payload->'telephones')='array' then v.payload->'telephones' else '[]'::jsonb end) ph where jsonb_typeof(ph->'number')='string' limit 50) x)) end,
   'selectable',v.id is not null and coalesce(p_kind in ('job','contact') or v.payload->>'type'='workaddress',false)));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'kind',p_kind,'rows',rows,'next_cursor',case when more then last_id end);
end $$;

create function public.learn_commusoft_contact_candidates(p_tenant uuid,p_version uuid,p_kind text,p_search text default '',p_after uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;region text;label text;email text;r record;rows jsonb:='[]';last_id uuid;counted integer:=0;more boolean:=false;begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_version is null or p_kind is distinct from 'person' or p_search is null or length(btrim(p_search))=1 or length(btrim(p_search))>150
  or p_limit is null or p_limit not between 1 and 50 then raise exception 'business_input_candidates_invalid' using errcode='22023';end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft' and collection='propertyContacts';
 if not found then raise exception 'business_input_contact_source_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 select non_secret_config->>'region' into region from public.provider_connections where id=v.connection_id and tenant_id=p_tenant;
 label:=lower(btrim(concat_ws(' ',public.learn_business_input_text(v.payload,'firstName'),public.learn_business_input_text(v.payload,'lastName'))));
 email:=lower(public.learn_business_input_text(v.payload,'email'));
 for r in with matches as (
  select p.*,
   (email is not null and (lower(btrim(p.primary_email))=email or exists(select 1 from public.contact_points cp where cp.tenant_id=p_tenant and cp.person_id=p.id and cp.channel='email' and cp.normalized_value=email))) as shared_email,
   exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v.payload->'telephones')='array' then v.payload->'telephones' else '[]'::jsonb end) ph
    where jsonb_typeof(ph->'number')='string' and (public.learn_business_contact_phone(p.primary_phone,region)=public.learn_business_contact_phone(ph->>'number',region)
     or exists(select 1 from public.contact_points cp where cp.tenant_id=p_tenant and cp.person_id=p.id and cp.channel='phone' and cp.normalized_value=public.learn_business_contact_phone(ph->>'number',region)))) as shared_phone
  from public.people p where p.tenant_id=p_tenant and (p_after is null or p.id>p_after)
 ) select * from matches m where
  (btrim(p_search)='' and (m.shared_email or m.shared_phone or (label<>'' and lower(btrim(m.display_name))=label)))
  or (btrim(p_search)<>'' and (strpos(lower(m.display_name),lower(btrim(p_search)))>0 or strpos(lower(coalesce(m.primary_email,'')),lower(btrim(p_search)))>0))
  order by m.id limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.id;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',r.id,'name',left(r.display_name,1000),'email',left(r.primary_email,1000),'phone',left(r.primary_phone,1000),'postcode',left(r.postcode,1000),
   'reason',case when r.shared_email then 'shared_email' when r.shared_phone then 'shared_phone' when btrim(p_search)='' then 'same_name' else 'search' end));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'version_id',p_version,'kind','person','rows',rows,'next_cursor',case when more then last_id end);
end $$;
revoke all on function public.learn_commusoft_contact_candidates(uuid,uuid,text,text,uuid,integer) from public,anon,service_role;
grant execute on function public.learn_commusoft_contact_candidates(uuid,uuid,text,text,uuid,integer) to authenticated;

-- INPUT supabase/migrations/20261031200000_learn_commusoft_resume.sql
-- Explicit operator continuation. Retains the approval identity, collection,
-- cursor, source pages and terminal jobs; creates only one new bounded job.

create function public.learn_operator_resume_commusoft(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_operator_input_requests%rowtype;a public.connector_accounts%rowtype;
 c public.provider_connections%rowtype;tc public.tenant_connectors%rowtype;j public.platform_jobs%rowtype;
 cfg jsonb;cp jsonb;observed jsonb;receipt jsonb;previous jsonb;k text;
 expiry timestamptz;revision timestamptz;pages integer;retained integer;jid uuid:=gen_random_uuid();
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000 then
  raise exception 'learn_operator_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-request:'||p_request::text,0));
 select * into prior from public.learn_operator_input_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition then
   raise exception 'learn_operator_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt)
   values(p_request,p_tenant,p_actor,p_definition,receipt);
  return receipt;
 end if;
 if p_definition->>'kind' is distinct from 'resume_commusoft'
  or not p_definition ?& array['kind','reason','account_id','approval_id','job_id','connection_id','revision','checkpoint','max_pages','expires_at']
  or (select count(*) from jsonb_object_keys(p_definition))<>10
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_definition->'revision') is distinct from 'string'
  or jsonb_typeof(p_definition->'expires_at') is distinct from 'string'
  or jsonb_typeof(p_definition->'checkpoint') is distinct from 'object'
  or jsonb_typeof(p_definition->'max_pages') is distinct from 'number' or p_definition->>'max_pages'!~'^[0-9]{1,5}$' then
  raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 foreach k in array array['account_id','approval_id','job_id','connection_id'] loop
  if jsonb_typeof(p_definition->k) is distinct from 'string' or p_definition->>k!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 end loop;
 expiry:=(p_definition->>'expires_at')::timestamptz;revision:=(p_definition->>'revision')::timestamptz;pages:=(p_definition->>'max_pages')::integer;
 if not isfinite(expiry) or not isfinite(revision) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '24 hours' or pages not between 1 and 10000 then
  raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 perform 1 from public.tenants where id=p_tenant and status='active';
 if not found then raise exception 'learn_operator_tenant_inactive' using errcode='55000';end if;
 foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=k and value='true'::jsonb for share;
  if not found then raise exception 'learn_operator_module_disabled' using errcode='55000';end if;
 end loop;
 select * into c from public.provider_connections where id=(p_definition->>'connection_id')::uuid and tenant_id=p_tenant for share;
 if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured' or c.auth_mode is distinct from 'private_api_key'
  or c.revoked_at is not null or c.verified_at is null or c.verified_at>clock_timestamp() or c.updated_at is distinct from revision
  or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
  or not coalesce('api_key'=any(c.configured_fields),false)
  or coalesce(c.secret_refs->>'api_key','')!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'learn_operator_connection_changed' using errcode='PT409';end if;
 perform 1 from vault.secrets where id=(c.secret_refs->>'api_key')::uuid and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
 if not found then raise exception 'learn_operator_credential_missing' using errcode='55000';end if;
 select * into tc from public.tenant_connectors where tenant_id=p_tenant and connector_id='commusoft' for update;
 if not found or tc.provider is distinct from 'commusoft' or tc.enabled is distinct from true or tc.status is distinct from 'active' then
  raise exception 'learn_operator_connector_disabled' using errcode='55000';end if;
 select * into a from public.connector_accounts where id=(p_definition->>'account_id')::uuid and tenant_id=p_tenant and tenant_connector_id=tc.id for update;
 if not found or a.status is distinct from 'active' or a.account_key is distinct from c.non_secret_config->>'account_key' then
  raise exception 'learn_operator_account_changed' using errcode='PT409';end if;
 cfg:=a.settings->'commusoft_import';cp:=a.sync_cursor;
 observed:=jsonb_build_object('approvalId',cp->'approvalId','pages',cp->'pages','after',cp->'after','complete',cp->'complete');
 if cfg->'approved' is distinct from 'true'::jsonb or cfg->>'approvalId' is distinct from p_definition->>'approval_id'
  or cfg->>'connectionId' is distinct from c.id::text or observed is distinct from p_definition->'checkpoint'
  or jsonb_typeof(cfg->'maxPages') is distinct from 'number' or coalesce(cfg->>'maxPages','')!~'^[0-9]{1,5}$'
  or jsonb_typeof(cfg->'expiresAt') is distinct from 'string'
  or coalesce(cfg->>'resource','') not in ('properties','jobs','propertyContacts')
  or (cfg->>'resource'='propertyContacts' and coalesce(cfg->>'contactType','') not in ('customer','workaddress')) then
  raise exception 'learn_operator_progress_changed' using errcode='PT409';end if;
 -- No active attempt is reset or displaced, even after its lease expires.
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
  and payload->>'connector_account_id'=a.id::text and status in ('queued','running','retrying')) then
  raise exception 'learn_operator_import_active' using errcode='55000';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
  and payload->>'connector_account_id'=a.id::text order by created_at desc,id desc limit 1 for update;
 if not found or j.id::text is distinct from p_definition->>'job_id' or j.status not in ('succeeded','dead_letter')
  or j.job_key is distinct from 'commusoft.source:'||a.id::text||':'||(cfg->>'approvalId')
  or coalesce(j.lease_expires_at,'-infinity')>clock_timestamp() then
  raise exception 'learn_operator_progress_changed' using errcode='PT409';end if;
 -- Committed but unsettled work must go through source-free worker recovery.
 if j.status='dead_letter' and (j.metadata ? 'commusoft_page_v1' or exists(select 1 from public.learn_business_input_pages where job_id=j.id)) then
  raise exception 'learn_operator_page_unsettled' using errcode='55000';end if;
 if j.status='succeeded' and not exists(select 1 from public.learn_business_input_pages where job_id=j.id and tenant_id=p_tenant
  and connection_id=c.id and provider='commusoft' and collection=cfg->>'resource' and checkpoint_after=cp) then
  raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 if cp='{}'::jsonb then
  retained:=0;
  if j.status='succeeded' or exists(select 1 from public.learn_business_input_pages where tenant_id=p_tenant and connection_id=c.id and checkpoint_after->>'approvalId'=cfg->>'approvalId') then
   raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 else
  if cp->>'approvalId' is distinct from cfg->>'approvalId' or cp->'complete' is distinct from 'false'::jsonb
   or jsonb_typeof(cp->'pages') is distinct from 'number' or cp->>'pages'!~'^[0-9]{1,5}$' then
   raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
  retained:=(cp->>'pages')::integer;
  -- Require the exact last retained page, not a cursor supplied by the browser.
  select checkpoint_after into observed from public.learn_business_input_pages where tenant_id=p_tenant and connection_id=c.id
   and provider='commusoft' and collection=cfg->>'resource' and checkpoint_after->>'approvalId'=cfg->>'approvalId'
   order by (checkpoint_after->>'pages')::integer desc limit 1;
  if not found or observed is distinct from cp or retained<1 then raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 end if;
 if pages<=retained or pages<(cfg->>'maxPages')::integer or expiry<(cfg->>'expiresAt')::timestamptz then
  raise exception 'learn_operator_resume_limits' using errcode='22023';end if;
 previous:=jsonb_build_object('approval',cfg,'checkpoint',cp,'job_id',j.id,'job_status',j.status);
 cfg:=cfg||jsonb_build_object('expiresAt',expiry,'maxPages',pages);
 update public.connector_accounts set settings=settings||jsonb_build_object('commusoft_import',cfg) where id=a.id;
 insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,max_attempts,available_at,parent_job_id,payload,created_by)
  values(jid,p_tenant,'commusoft','learn','commusoft.source_sync',j.job_key,'queued',5,clock_timestamp(),j.id,jsonb_build_object('connector_account_id',a.id),p_actor);
 receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','kind','resume_commusoft','account_id',a.id,'job_id',jid,'approval_id',cfg->>'approvalId','checkpoint',p_definition->'checkpoint');
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt,previous_state) values(p_request,p_tenant,p_actor,p_definition,receipt,previous);
 return receipt;
end $$;
revoke all on function public.learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text) to authenticated;

-- INPUT supabase/migrations/20261101020000_learn_commusoft_contact_traversal.sql
-- Property-scoped contact traversal. Initial approvals allow at most 10,000 pages;
-- each continuation allows at most 10,000 further pages without discarding prior progress. No provider calls, grants to operators,
-- credentials, tenant switches, jobs, schedules or data backfill on installation.

create table public.learn_commusoft_contact_targets (
 tenant_id uuid not null,
 connection_id uuid not null,
 approval_id uuid not null,
 property_id bigint not null check(property_id between 1 and 9007199254740991),
 property_type text not null check(property_type in ('customer','workaddress')),
 source_version_id uuid not null references public.learn_business_input_versions(id),
 position integer not null check(position>0),
 next_property_id bigint check(next_property_id between 1 and 9007199254740991),
 primary key(tenant_id,connection_id,approval_id,property_id),
 unique(tenant_id,connection_id,approval_id,position)
);
alter table public.learn_commusoft_contact_targets enable row level security;
revoke all on public.learn_commusoft_contact_targets from public,anon,authenticated,service_role;
grant select on public.learn_commusoft_contact_targets to service_role;
create trigger retain_rows before update or delete on public.learn_commusoft_contact_targets
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_commusoft_contact_targets
 for each statement execute function public.learn_business_input_retain();

-- Same private target validation for credential release and page publication.
-- A plan is frozen from one completed property traversal, never caller-supplied IDs.
create function public.learn_commusoft_contact_target(p_tenant uuid,p_connection uuid,p_cfg jsonb,p_cp jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.learn_commusoft_contact_targets%rowtype;prop bigint;done integer;total integer;
begin
 if p_cfg->>'resource' is distinct from 'propertyContacts' or p_cfg->>'contactPlanVersion' is distinct from '1'
  or coalesce(p_cfg->>'contactType','') not in ('customer','workaddress')
  or jsonb_typeof(p_cfg->'contactTargetCount') is distinct from 'number'
  or coalesce(p_cfg->>'contactTargetCount','')!~'^[1-9][0-9]{0,8}$'
  or jsonb_typeof(p_cfg->'firstPropertyId') is distinct from 'number'
  or coalesce(p_cfg->>'firstPropertyId','')!~'^[1-9][0-9]{0,15}$' then return null;end if;
 total:=(p_cfg->>'contactTargetCount')::integer;
 if p_cp='{}'::jsonb then prop:=(p_cfg->>'firstPropertyId')::bigint;done:=0;
 else
  if p_cp->>'approvalId' is distinct from p_cfg->>'approvalId' or p_cp->'complete' is distinct from 'false'::jsonb
   or jsonb_typeof(p_cp->'propertyId') is distinct from 'number' or coalesce(p_cp->>'propertyId','')!~'^[1-9][0-9]{0,15}$'
   or jsonb_typeof(p_cp->'propertiesCompleted') is distinct from 'number' or coalesce(p_cp->>'propertiesCompleted','')!~'^[0-9]{1,9}$' then return null;end if;
  prop:=(p_cp->>'propertyId')::bigint;done:=(p_cp->>'propertiesCompleted')::integer;
 end if;
 select * into t from public.learn_commusoft_contact_targets where tenant_id=p_tenant and connection_id=p_connection
  and approval_id=(p_cfg->>'approvalId')::uuid and property_id=prop;
 if not found or t.property_type is distinct from p_cfg->>'contactType' or t.position<>done+1 or done>=total
  or (t.next_property_id is null) is distinct from (t.position=total) then return null;end if;
 return jsonb_build_object('propertyId',t.property_id,'nextPropertyId',t.next_property_id,'position',t.position,'total',total);
end $$;
revoke all on function public.learn_commusoft_contact_target(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function public.learn_operator_input_request(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_operator_input_requests%rowtype;c public.provider_connections%rowtype;
 tc public.tenant_connectors%rowtype;a public.connector_accounts%rowtype;
 receipt jsonb;previous jsonb;scope jsonb;flags jsonb;kind text;reason text;k text;
 connection_id uuid;revision timestamptz;expiry timestamptz;resource text;contact_type text;
 pages integer;page_size integer;aid uuid;jid uuid:=gen_random_uuid();
 property_approval uuid;target_count integer;first_property bigint;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000 then
  raise exception 'learn_operator_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-request:'||p_request::text,0));
 select * into prior from public.learn_operator_input_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition then
   raise exception 'learn_operator_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt)
   values(p_request,p_tenant,p_actor,p_definition,receipt);
  return receipt;
 end if;
 kind:=p_definition->>'kind';reason:=p_definition->>'reason';
 if jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(reason)) not between 1 and 1000
  or kind is null or kind not in ('set_modules','start_commusoft') then raise exception 'learn_operator_definition_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 if kind='set_modules' then
  if (select count(*) from jsonb_object_keys(p_definition))<>4
   or jsonb_typeof(p_definition->'expected') is distinct from 'object'
   or jsonb_typeof(p_definition->'values') is distinct from 'object'
   or (select count(*) from jsonb_object_keys(p_definition->'values'))<>2
   or jsonb_typeof(p_definition->'values'->'learn.enabled') is distinct from 'boolean'
   or jsonb_typeof(p_definition->'values'->'learn.inputs.commusoft.enabled') is distinct from 'boolean' then
   raise exception 'learn_operator_flags_invalid' using errcode='22023';end if;
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag in ('learn.enabled','learn.inputs.commusoft.enabled') order by flag for update;
  flags:=public.learn_operator_input_flags(p_tenant);
  if flags is distinct from p_definition->'expected' then raise exception 'learn_operator_flags_changed' using errcode='PT409';end if;
  previous:=flags;
  foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
   update public.feature_flags set value=p_definition->'values'->k where tenant_id=p_tenant and flag=k;
   if not found then insert into public.feature_flags(tenant_id,flag,value) values(p_tenant,k,p_definition->'values'->k);end if;
  end loop;
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','kind',kind,'flags',p_definition->'values');
 else
  if not p_definition ?& array['kind','reason','connection_id','revision','resource','max_pages','page_size','expires_at']
   or (p_definition-array['kind','reason','connection_id','revision','resource','contact_type','max_pages','page_size','expires_at'])<>'{}'::jsonb
   or jsonb_typeof(p_definition->'connection_id') is distinct from 'string'
   or p_definition->>'connection_id'!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or jsonb_typeof(p_definition->'max_pages') is distinct from 'number' or p_definition->>'max_pages'!~'^[0-9]{1,5}$'
   or jsonb_typeof(p_definition->'page_size') is distinct from 'number' or p_definition->>'page_size'!~'^[0-9]{1,3}$'
   or jsonb_typeof(p_definition->'revision') is distinct from 'string'
   or jsonb_typeof(p_definition->'expires_at') is distinct from 'string' then raise exception 'learn_operator_import_invalid' using errcode='22023';end if;
  connection_id:=(p_definition->>'connection_id')::uuid;revision:=(p_definition->>'revision')::timestamptz;
  expiry:=(p_definition->>'expires_at')::timestamptz;resource:=p_definition->>'resource';contact_type:=p_definition->>'contact_type';
  pages:=(p_definition->>'max_pages')::integer;page_size:=(p_definition->>'page_size')::integer;
  if not isfinite(revision) or not isfinite(expiry) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '24 hours'
   or pages not between 1 and 10000 or page_size not between 1 and 100 or resource is null or resource not in ('properties','propertyContacts','jobs')
   or (resource='propertyContacts' and (contact_type is null or contact_type not in ('customer','workaddress')))
   or (resource<>'propertyContacts' and p_definition ? 'contact_type') then raise exception 'learn_operator_import_invalid' using errcode='22023';end if;
  perform 1 from public.tenants where id=p_tenant and status='active';
  if not found then raise exception 'learn_operator_tenant_inactive' using errcode='55000';end if;
  foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
   perform 1 from public.feature_flags where tenant_id=p_tenant and flag=k and value='true'::jsonb for share;
   if not found then raise exception 'learn_operator_module_disabled' using errcode='55000';end if;
  end loop;
  select * into c from public.provider_connections where id=connection_id and tenant_id=p_tenant for share;
  if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured' or c.auth_mode is distinct from 'private_api_key'
   or c.revoked_at is not null or c.verified_at is null or c.verified_at>clock_timestamp() or c.updated_at is distinct from revision
   or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
   or length(btrim(coalesce(c.non_secret_config->>'account_key',''))) not between 1 and 2000
   or not coalesce('api_key'=any(c.configured_fields),false)
   or coalesce(c.secret_refs->>'api_key','')!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'learn_operator_connection_changed' using errcode='PT409';end if;
  -- Existence only: the setup surface never selects a secret value. The worker
  -- still revalidates the tenant-qualified secret and all authority at acquisition.
  perform 1 from vault.secrets where id=(c.secret_refs->>'api_key')::uuid and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
  if not found then raise exception 'learn_operator_credential_missing' using errcode='55000';end if;
  select * into tc from public.tenant_connectors where tenant_id=p_tenant and connector_id='commusoft' for update;
  if not found then
   insert into public.tenant_connectors(tenant_id,connector_id,provider,category,status,enabled)
    values(p_tenant,'commusoft','commusoft','business_input','active',true) returning * into tc;
  elsif tc.provider is distinct from 'commusoft' or tc.enabled is distinct from true or tc.status is distinct from 'active' then
   raise exception 'learn_operator_connector_disabled' using errcode='55000';
  end if;
  select * into a from public.connector_accounts where tenant_id=p_tenant and tenant_connector_id=tc.id and account_key=c.non_secret_config->>'account_key' for update;
  if found then
   if a.status is distinct from 'active' or exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
    and payload->>'connector_account_id'=a.id::text and status in ('queued','running','retrying')) then
    raise exception 'learn_operator_import_active' using errcode='55000';end if;
   if a.settings ? 'commusoft_import' and (a.sync_cursor->'complete' is distinct from 'true'::jsonb
    or a.sync_cursor->>'approvalId' is distinct from a.settings->'commusoft_import'->>'approvalId') then
    raise exception 'learn_operator_import_incomplete' using errcode='55000';end if;
   if a.settings ? 'commusoft_import' and a.settings->'commusoft_import'->>'connectionId' is distinct from c.id::text then
    raise exception 'learn_operator_account_connection_changed' using errcode='PT409';end if;
   previous:=jsonb_build_object('approval',a.settings->'commusoft_import','checkpoint',a.sync_cursor);aid:=a.id;
  else
   insert into public.connector_accounts(tenant_id,tenant_connector_id,account_key,display_name,status)
    values(p_tenant,tc.id,c.non_secret_config->>'account_key','Commusoft','active') returning id into aid;
  end if;
  scope:=jsonb_build_object('approved',true,'approvalId',p_request,'connectionId',c.id,'consentReference','learn-operator-input:'||p_request::text,
   'expiresAt',expiry,'maxPages',pages,'pageSize',page_size,'resource',resource)
   ||case when resource='propertyContacts' then jsonb_build_object('contactType',contact_type) else '{}'::jsonb end;
  if resource='propertyContacts' then
   -- Use the last completed property traversal, not the mutable newest union of
   -- source versions. Account/connection locks serialize approvals and imports.
   select (p.checkpoint_after->>'approvalId')::uuid into property_approval
    from public.learn_business_input_pages p where p.tenant_id=p_tenant and p.connection_id=c.id
     and p.provider='commusoft' and p.collection='properties' and p.checkpoint_after->'complete'='true'::jsonb
    order by p.committed_at desc,p.id desc limit 1;
   if property_approval is null then raise exception 'learn_operator_property_traversal_required' using errcode='55000';end if;
   with observed as (
    select distinct on(v.external_id) v.id,v.payload,v.external_id
     from public.learn_business_input_pages p
     join public.learn_business_input_observations o on o.page_id=p.id
     join public.learn_business_input_versions v on v.id=o.version_id and v.tenant_id=p.tenant_id
      and v.connection_id=p.connection_id and v.provider=p.provider and v.collection=p.collection
     where p.tenant_id=p_tenant and p.connection_id=c.id and p.provider='commusoft' and p.collection='properties'
      and p.checkpoint_after->>'approvalId'=property_approval::text
     order by v.external_id,(p.checkpoint_after->>'pages')::integer desc
   ), chosen as (
    select id,(payload->>'id')::bigint as property_id from observed
     where payload->>'type'=contact_type and jsonb_typeof(payload->'id')='number'
      and payload->>'id'~'^[1-9][0-9]{0,15}$' and payload->>'id'=external_id
   ) insert into public.learn_commusoft_contact_targets(tenant_id,connection_id,approval_id,property_id,property_type,source_version_id,position,next_property_id)
    select p_tenant,c.id,p_request,property_id,contact_type,id,row_number() over(order by property_id),lead(property_id) over(order by property_id)
    from chosen where property_id<=9007199254740991;
   select count(*)::integer,min(t.property_id) into target_count,first_property from public.learn_commusoft_contact_targets t
    where t.tenant_id=p_tenant and t.connection_id=c.id and t.approval_id=p_request;
   if target_count=0 then raise exception 'learn_operator_contact_properties_missing' using errcode='55000';end if;
   scope:=scope||jsonb_build_object('contactPlanVersion',1,'contactTargetCount',target_count,'firstPropertyId',first_property,'propertyTraversalApprovalId',property_approval);
  end if;
  update public.connector_accounts set settings=settings||jsonb_build_object('commusoft_import',scope),sync_cursor='{}' where id=aid;
  insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
   values(jid,p_tenant,'commusoft','learn','commusoft.source_sync','commusoft.source:'||aid::text||':'||p_request::text,'queued',5,clock_timestamp(),jsonb_build_object('connector_account_id',aid),p_actor);
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','kind',kind,'account_id',aid,'job_id',jid);
 end if;
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt,previous_state)
  values(p_request,p_tenant,p_actor,p_definition,receipt,previous);
 return receipt;
end $$;

create or replace function public.learn_commusoft_acquire_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_expected jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  j public.platform_jobs%rowtype;
  a public.connector_accounts%rowtype;
  c public.provider_connections%rowtype;
  cfg jsonb; cp jsonb; req jsonb; target jsonb; pages integer; after_id bigint; flag_name text;
  secret text; fingerprint text; next_at timestamptz; permit_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'commusoft_permit_forbidden' using errcode='42501';
  end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'commusoft_permit_snapshot' using errcode='22023';
  end if;
  if p_tenant_id is null or p_job_id is null or nullif(btrim(p_claimed_by),'') is null
     or p_attempt_count is null or p_attempt_count<1 or jsonb_typeof(p_expected) is distinct from 'object'
     or p_expected->>'tenantId' is distinct from p_tenant_id::text
     or p_expected->>'jobId' is distinct from p_job_id::text then return null; end if;

  select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
  if not found or j.job_type is distinct from 'commusoft.source_sync' or j.status is distinct from 'running'
     or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count
     or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp() then return null; end if;
  perform 1 from public.tenants where id=p_tenant_id and status='active' for share;
  if not found then return null; end if;
  foreach flag_name in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
    perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag=flag_name and value='true'::jsonb for share;
    if not found then return null; end if;
  end loop;
  select * into a from public.connector_accounts where id::text=j.payload->>'connector_account_id'
    and tenant_id=p_tenant_id for share;
  if not found or a.status is distinct from 'active' or a.id::text is distinct from p_expected->>'accountId'
     or nullif(btrim(a.account_key),'') is null or length(a.account_key)>2000
     or a.tenant_connector_id::text is distinct from p_expected->>'connectorId'
     or a.sync_cursor is distinct from p_expected->'checkpoint' then return null; end if;
  perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
    and connector_id='commusoft' and provider='commusoft' and enabled and status='active' for share;
  if not found then return null; end if;
  cfg:=a.settings->'commusoft_import';
  if jsonb_typeof(cfg) is distinct from 'object' or cfg is distinct from p_expected->'approval'
     or cfg->'approved' is distinct from 'true'::jsonb
     or (cfg->>'approvalId')::uuid is null or (cfg->>'connectionId')::uuid is null
     or nullif(btrim(cfg->>'consentReference'),'') is null or length(cfg->>'consentReference')>2000
     or coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
     or jsonb_typeof(cfg->'maxPages') is distinct from 'number' or (cfg->>'maxPages')::integer not between 1 and 2147483647
     or jsonb_typeof(cfg->'pageSize') is distinct from 'number' or (cfg->>'pageSize')::integer not between 1 and 100
     or coalesce(cfg->>'resource','') not in ('properties','propertyContacts','jobs') then return null; end if;
  if cfg->>'resource'='propertyContacts' then
    if coalesce(cfg->>'contactType','') not in ('customer','workaddress') then return null; end if;
  elsif cfg ? 'contactType' then return null; end if;

  if j.job_key is distinct from 'commusoft.source:'||a.id::text||':'||(cfg->>'approvalId') then return null;end if;
  select * into c from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant_id for share;
  if not found or c.id::text is distinct from p_expected->>'connectionId' or c.provider is distinct from 'commusoft'
     or c.status is distinct from 'configured' or c.auth_mode is distinct from 'private_api_key'
     or c.revoked_at is not null or c.verified_at is null or c.verified_at>clock_timestamp()
     or c.updated_at is null or c.updated_at is distinct from (p_expected->>'connectionRevision')::timestamptz
     or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
     or c.non_secret_config->>'account_key' is distinct from a.account_key
     or not coalesce('api_key'=any(c.configured_fields),false)
     or c.secret_refs->>'api_key' is distinct from p_expected->>'secretId' then return null; end if;

  cp:=a.sync_cursor;
  if cp='{}'::jsonb then cp:=jsonb_build_object('approvalId',cfg->>'approvalId','after',null,'pages',0,'complete',false); end if;
  if jsonb_typeof(cp) is distinct from 'object' or cp->>'approvalId' is distinct from cfg->>'approvalId'
     or jsonb_typeof(cp->'pages') is distinct from 'number' or cp->'complete' is distinct from 'false'::jsonb then return null; end if;
  pages:=(cp->>'pages')::integer;
  if pages<0 or pages>=(cfg->>'maxPages')::integer then return null; end if;
  if cp->'after'='null'::jsonb then after_id:=null;
  elsif jsonb_typeof(cp->'after')='number' then after_id:=(cp->>'after')::bigint;
  else return null; end if;
  if pages=0 and after_id is not null or pages>0 and after_id is null and cfg->>'resource'<>'propertyContacts'
   or after_id is not null and (after_id<1 or after_id>9007199254740991) then return null;end if;
  req:=jsonb_build_object('region',c.non_secret_config->>'region','resource',cfg->>'resource','after',after_id,'limit',(cfg->>'pageSize')::integer);
  if cfg->>'resource'='propertyContacts' then
   target:=public.learn_commusoft_contact_target(p_tenant_id,c.id,cfg,a.sync_cursor);
   if target is null or target is distinct from p_expected->'contactTarget' then return null;end if;
   req:=req||jsonb_build_object('contactType',cfg->>'contactType','propertyId',target->'propertyId');
  end if;
  if req is distinct from p_expected->'request' or p_expected->'pages' is distinct from to_jsonb(pages)
     or p_expected->'complete' is distinct from 'false'::jsonb then return null; end if;

  if coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1' then return null;end if;
  -- A repeated acquisition cannot release a second credential for this attempt.
  -- An uncertain response is not retried inline; recovery uses a new queue attempt.
  if exists(select 1 from public.learn_business_input_request_permits where job_id=j.id and attempt_count=p_attempt_count) then return null; end if;
  select decrypted_secret into secret from vault.decrypted_secrets
    where id=(c.secret_refs->>'api_key')::uuid and name='provider_secret:'||p_tenant_id::text||':commusoft:api_key';
  if secret is null or length(secret) not between 1 and 4096 or secret !~ '^[!-~]+$' then return null; end if;
  -- The same key stored in different tenant Vault entries still shares quota.
  -- Fingerprints are infrastructure-private, never returned to a worker/client.
  fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
  insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
  select next_allowed_at into next_at from public.learn_business_input_request_gates
    where credential_fingerprint=fingerprint for update;
  if j.lease_expires_at<=clock_timestamp() or (cfg->>'expiresAt')::timestamptz<=clock_timestamp() then return null; end if;
  if next_at>clock_timestamp() then
    return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from next_at)*1000)::bigint);
  end if;
  -- 48 reservations/minute leaves room below the documented 60/minute ceiling.
  update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds'
    where credential_fingerprint=fingerprint;
  insert into public.learn_business_input_request_permits(tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
    values(p_tenant_id,p_job_id,p_claimed_by,p_attempt_count,
      jsonb_build_object('accountId',a.id,'connectorId',a.tenant_connector_id,'connectionId',c.id,
        'connectionRevision',c.updated_at,'secretId',c.secret_refs->>'api_key',
        'approval',cfg,'checkpoint',a.sync_cursor,'request',req),fingerprint) returning id into permit_id;
  -- Short send window prevents delayed workers banking reservations for a burst.
  return jsonb_build_object('state','ready','apiKey',secret,'permitId',permit_id,
    'sendBefore',floor(extract(epoch from clock_timestamp()+interval '5 seconds')*1000)::bigint);
end $$;

create or replace function public.learn_commusoft_commit_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_permit_id uuid,p_envelope jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  permit public.learn_business_input_request_permits%rowtype;
  prior public.learn_business_input_pages%rowtype;
  j public.platform_jobs%rowtype;
  a public.connector_accounts%rowtype;
  connection public.provider_connections%rowtype;
  b jsonb; cfg jsonb; cp jsonb; target jsonb; next_cp jsonb; receipt jsonb; flag_name text;
  page_id uuid; version_id uuid; item jsonb; item_id bigint; previous_id bigint; next_id bigint;
  n integer:=0; pages integer; has_more boolean; v_hash text; saved_payload jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'commusoft_publication_forbidden' using errcode='42501';end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'commusoft_publication_snapshot' using errcode='22023';end if;
  -- Serialize against acquisition and concurrent/repeated publication for this job.
  select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'commusoft_job_unavailable' using errcode='42501';end if;
  select * into permit from public.learn_business_input_request_permits where id=p_permit_id and tenant_id=p_tenant_id
    and job_id=p_job_id and claimed_by=p_claimed_by and attempt_count=p_attempt_count;
  if not found then raise exception 'commusoft_permit_unavailable' using errcode='42501';end if;
  select * into prior from public.learn_business_input_pages where permit_id=p_permit_id;
  if found then
    if prior.envelope is distinct from p_envelope then raise exception 'commusoft_page_conflict' using errcode='PT409';end if;
    -- Exact replay acknowledges retained data without changing it or acquiring authority.
    return jsonb_build_object('pageId',prior.id,'checkpoint',prior.checkpoint_after,'records',prior.record_count,'already',true);
  end if;
  if j.job_type is distinct from 'commusoft.source_sync' or j.status is distinct from 'running'
    or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count
    or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp()
    or coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1' then raise exception 'commusoft_job_unavailable' using errcode='42501';end if;
  perform 1 from public.tenants where id=p_tenant_id and status='active' for share;
  if not found then raise exception 'commusoft_tenant_unavailable' using errcode='42501';end if;
  foreach flag_name in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
    perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag=flag_name and value='true'::jsonb for share;
    if not found then raise exception 'commusoft_module_unavailable' using errcode='42501';end if;
  end loop;
  b:=permit.binding; cfg:=b->'approval'; cp:=b->'checkpoint';
  if j.job_key is distinct from 'commusoft.source:'||(b->>'accountId')||':'||(cfg->>'approvalId') then raise exception 'commusoft_queue_identity' using errcode='PT409';end if;
  select * into a from public.connector_accounts where id::text=b->>'accountId' and tenant_id=p_tenant_id for update;
  if not found or a.id::text is distinct from j.payload->>'connector_account_id' or a.status is distinct from 'active'
    or a.tenant_connector_id::text is distinct from b->>'connectorId'
    or a.settings->'commusoft_import' is distinct from cfg or a.sync_cursor is distinct from cp
    or coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp() then
    raise exception 'commusoft_scope_changed' using errcode='PT409';end if;
  perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
    and connector_id='commusoft' and provider='commusoft' and enabled and status='active' for share;
  if not found then raise exception 'commusoft_connector_unavailable' using errcode='42501';end if;
  select * into connection from public.provider_connections where id::text=b->>'connectionId' and tenant_id=p_tenant_id for share;
  if not found or connection.provider is distinct from 'commusoft' or connection.status is distinct from 'configured'
    or connection.auth_mode is distinct from 'private_api_key' or connection.revoked_at is not null
    or connection.verified_at is null or connection.verified_at>clock_timestamp()
    or connection.updated_at is distinct from (b->>'connectionRevision')::timestamptz
    or connection.non_secret_config->>'account_key' is distinct from a.account_key
    or connection.non_secret_config->>'region' is distinct from b->'request'->>'region'
    or not coalesce('api_key'=any(connection.configured_fields),false)
    or connection.secret_refs->>'api_key' is distinct from b->>'secretId' then
    raise exception 'commusoft_connection_changed' using errcode='42501';end if;

  if cfg->>'resource'='propertyContacts' then
   target:=public.learn_commusoft_contact_target(p_tenant_id,connection.id,cfg,cp);
   if target is null or b->'request'->'propertyId' is distinct from target->'propertyId' then raise exception 'commusoft_contact_scope_changed' using errcode='PT409';end if;
  end if;

  if jsonb_typeof(p_envelope) is distinct from 'object' or octet_length(p_envelope::text)>4194304
    or jsonb_typeof(p_envelope->'data') is distinct from 'array'
    or jsonb_array_length(p_envelope->'data')>(b->'request'->>'limit')::integer
    or jsonb_typeof(p_envelope->'pagination') is distinct from 'object'
    or jsonb_typeof(p_envelope->'pagination'->'hasMore') is distinct from 'boolean' then
    raise exception 'commusoft_page_invalid' using errcode='22023';end if;
  has_more:=(p_envelope->'pagination'->>'hasMore')::boolean;
  previous_id:=coalesce((b->'request'->>'after')::bigint,0);
  pages:=case when cp='{}'::jsonb then 0 else (cp->>'pages')::integer end;
  next_cp:=jsonb_build_object('approvalId',cfg->>'approvalId','after',null,'pages',pages+1,'complete',not has_more);
  page_id:=gen_random_uuid();
  -- Stage checkpoint in a local variable; immutable page is inserted after validation.
  for item in select value from jsonb_array_elements(p_envelope->'data') loop
    if jsonb_typeof(item) is distinct from 'object' or octet_length(item::text)>524288
      or jsonb_typeof(item->'id') is distinct from 'number' or (item->>'id') !~ '^[0-9]+$' then
      raise exception 'commusoft_record_invalid' using errcode='22023';end if;
    if cfg->>'resource'='propertyContacts' and item->'propertyID' is distinct from target->'propertyId' then
     raise exception 'commusoft_contact_parent_mismatch' using errcode='22023';end if;
    item_id:=(item->>'id')::bigint;
    if item_id<=previous_id or item_id>9007199254740991 then raise exception 'commusoft_record_order_invalid' using errcode='22023';end if;
    previous_id:=item_id; n:=n+1;
  end loop;
  if p_envelope->'pagination'->'nextCursor' is null or p_envelope->'pagination'->'nextCursor'='null'::jsonb then next_id:=null;
  elsif jsonb_typeof(p_envelope->'pagination'->'nextCursor')='number' and p_envelope->'pagination'->>'nextCursor' ~ '^[0-9]+$' then
    next_id:=(p_envelope->'pagination'->>'nextCursor')::bigint;
  else raise exception 'commusoft_cursor_invalid' using errcode='22023';end if;
  if has_more and (n=0 or next_id is null or next_id<>previous_id) or
     not has_more and next_id is not null and next_id<>0 and next_id<>previous_id then
    raise exception 'commusoft_cursor_invalid' using errcode='22023';end if;
  if has_more then next_cp:=jsonb_set(next_cp,'{after}',to_jsonb(next_id));end if;
  if target is not null then
   next_cp:=next_cp||jsonb_build_object('propertyId',case when has_more then target->'propertyId' else target->'nextPropertyId' end,
    'propertiesCompleted',(target->>'position')::integer-case when has_more then 1 else 0 end,
    'complete',not has_more and target->'nextPropertyId'='null'::jsonb);
  end if;
  insert into public.learn_business_input_pages(id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,checkpoint_before,checkpoint_after,record_count)
    values(page_id,p_tenant_id,connection.id,'commusoft',b->'request'->>'resource',p_job_id,p_permit_id,p_envelope,cp,next_cp,n);
  n:=0;
  for item in select value from jsonb_array_elements(p_envelope->'data') loop
    n:=n+1; v_hash:=encode(sha256(convert_to(item::text,'UTF8')),'hex');
    insert into public.learn_business_input_versions(tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
      values(p_tenant_id,connection.id,'commusoft',b->'request'->>'resource',item->>'id',v_hash,item)
      on conflict(tenant_id,connection_id,provider,collection,external_id,content_hash) do nothing;
    select v.id,v.payload into version_id,saved_payload from public.learn_business_input_versions v where v.tenant_id=p_tenant_id
      and v.connection_id=connection.id and v.provider='commusoft' and v.collection=b->'request'->>'resource'
      and v.external_id=item->>'id' and v.content_hash=v_hash;
    if version_id is null or saved_payload is distinct from item then raise exception 'commusoft_version_conflict' using errcode='PT409';end if;
    insert into public.learn_business_input_observations values(page_id,version_id,n);
  end loop;
  if j.lease_expires_at<=clock_timestamp() or (cfg->>'expiresAt')::timestamptz<=clock_timestamp() then
    raise exception 'commusoft_authority_expired' using errcode='42501';end if;
  update public.connector_accounts set sync_cursor=next_cp where id=a.id and tenant_id=p_tenant_id;
  receipt:=jsonb_build_object('pageId',page_id,'checkpoint',next_cp,'records',n,'already',false);
  update public.platform_jobs set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('commusoft_page_v1',receipt) where id=j.id;
  return receipt;
end $$;

create or replace function public.learn_operator_inputs(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare connections jsonb;accounts jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 select coalesce(jsonb_agg(x.row order by x.id),'[]') into connections from (
  select c.id,jsonb_build_object('id',c.id,'status',c.status,'revision',c.updated_at,'verified_at',c.verified_at,'revoked',c.revoked_at is not null,
   'account_key',left(c.non_secret_config->>'account_key',2000),'region',c.non_secret_config->>'region',
   'credential_bound',exists(select 1 from vault.secrets s where s.id::text=c.secret_refs->>'api_key' and s.name='provider_secret:'||p_tenant::text||':commusoft:api_key')) as row
  from public.provider_connections c where c.tenant_id=p_tenant and c.provider='commusoft' order by c.id limit 21
 ) x;
 if jsonb_array_length(connections)>20 then raise exception 'learn_operator_connection_limit' using errcode='54000';end if;
 select coalesce(jsonb_agg(x.row order by x.id),'[]') into accounts from (
  select a.id,jsonb_build_object('id',a.id,'status',a.status,'connector_enabled',tc.enabled and tc.status='active',
   'connection_id',a.settings->'commusoft_import'->>'connectionId','resource',a.settings->'commusoft_import'->>'resource',
   'approval_id',a.settings->'commusoft_import'->>'approvalId','expires_at',a.settings->'commusoft_import'->>'expiresAt',
   'contact_target_count',a.settings->'commusoft_import'->'contactTargetCount','max_pages',a.settings->'commusoft_import'->'maxPages','checkpoint',(jsonb_build_object('approvalId',a.sync_cursor->'approvalId','pages',a.sync_cursor->'pages','after',a.sync_cursor->'after','complete',a.sync_cursor->'complete')||case when a.sync_cursor ? 'propertyId' then jsonb_build_object('propertyId',a.sync_cursor->'propertyId','propertiesCompleted',a.sync_cursor->'propertiesCompleted') else '{}'::jsonb end),
   'latest_job',(select jsonb_build_object('id',j.id,'status',j.status,'error_code',
    case when j.error_code~'^commusoft_[a-z_]{1,80}$' then j.error_code when j.error_code is not null then 'commusoft_worker_failed' end,
    'attempt_count',j.attempt_count,'available_at',j.available_at,'lease_expires_at',j.lease_expires_at,'completed_at',j.completed_at,
    'stop_reason',case when j.result->>'stop_reason' in ('collection_exhausted','page_budget_exhausted','next_page','authorisation_changed') then j.result->>'stop_reason' end)
    from public.platform_jobs j where j.tenant_id=p_tenant and j.job_type='commusoft.source_sync' and j.payload->>'connector_account_id'=a.id::text order by j.created_at desc,j.id desc limit 1)) as row
  from public.connector_accounts a join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  where a.tenant_id=p_tenant and tc.connector_id='commusoft' and tc.provider='commusoft' order by a.id limit 21
 ) x;
 if jsonb_array_length(accounts)>20 then raise exception 'learn_operator_account_limit' using errcode='54000';end if;
 return jsonb_build_object('tenant_id',p_tenant,'checked_at',clock_timestamp(),'flags',public.learn_operator_input_flags(p_tenant),'connections',connections,'accounts',accounts);
end $$;

create or replace function public.learn_operator_resume_commusoft(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_operator_input_requests%rowtype;a public.connector_accounts%rowtype;
 c public.provider_connections%rowtype;tc public.tenant_connectors%rowtype;j public.platform_jobs%rowtype;
 cfg jsonb;cp jsonb;observed jsonb;receipt jsonb;previous jsonb;k text;
 expiry timestamptz;revision timestamptz;pages integer;retained integer;jid uuid:=gen_random_uuid();
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000 then
  raise exception 'learn_operator_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-request:'||p_request::text,0));
 select * into prior from public.learn_operator_input_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition then
   raise exception 'learn_operator_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt)
   values(p_request,p_tenant,p_actor,p_definition,receipt);
  return receipt;
 end if;
 if p_definition->>'kind' is distinct from 'resume_commusoft'
  or not p_definition ?& array['kind','reason','account_id','approval_id','job_id','connection_id','revision','checkpoint','max_pages','expires_at']
  or (select count(*) from jsonb_object_keys(p_definition))<>10
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_definition->'revision') is distinct from 'string'
  or jsonb_typeof(p_definition->'expires_at') is distinct from 'string'
  or jsonb_typeof(p_definition->'checkpoint') is distinct from 'object'
  or jsonb_typeof(p_definition->'max_pages') is distinct from 'number' or p_definition->>'max_pages'!~'^[0-9]{1,10}$' then
  raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 foreach k in array array['account_id','approval_id','job_id','connection_id'] loop
  if jsonb_typeof(p_definition->k) is distinct from 'string' or p_definition->>k!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 end loop;
 expiry:=(p_definition->>'expires_at')::timestamptz;revision:=(p_definition->>'revision')::timestamptz;pages:=(p_definition->>'max_pages')::integer;
 if not isfinite(expiry) or not isfinite(revision) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '24 hours' or pages not between 1 and 2147483647 then
  raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 perform 1 from public.tenants where id=p_tenant and status='active';
 if not found then raise exception 'learn_operator_tenant_inactive' using errcode='55000';end if;
 foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=k and value='true'::jsonb for share;
  if not found then raise exception 'learn_operator_module_disabled' using errcode='55000';end if;
 end loop;
 select * into c from public.provider_connections where id=(p_definition->>'connection_id')::uuid and tenant_id=p_tenant for share;
 if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured' or c.auth_mode is distinct from 'private_api_key'
  or c.revoked_at is not null or c.verified_at is null or c.verified_at>clock_timestamp() or c.updated_at is distinct from revision
  or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
  or not coalesce('api_key'=any(c.configured_fields),false)
  or coalesce(c.secret_refs->>'api_key','')!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'learn_operator_connection_changed' using errcode='PT409';end if;
 perform 1 from vault.secrets where id=(c.secret_refs->>'api_key')::uuid and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
 if not found then raise exception 'learn_operator_credential_missing' using errcode='55000';end if;
 select * into tc from public.tenant_connectors where tenant_id=p_tenant and connector_id='commusoft' for update;
 if not found or tc.provider is distinct from 'commusoft' or tc.enabled is distinct from true or tc.status is distinct from 'active' then
  raise exception 'learn_operator_connector_disabled' using errcode='55000';end if;
 select * into a from public.connector_accounts where id=(p_definition->>'account_id')::uuid and tenant_id=p_tenant and tenant_connector_id=tc.id for update;
 if not found or a.status is distinct from 'active' or a.account_key is distinct from c.non_secret_config->>'account_key' then
  raise exception 'learn_operator_account_changed' using errcode='PT409';end if;
 cfg:=a.settings->'commusoft_import';cp:=a.sync_cursor;
 observed:=jsonb_build_object('approvalId',cp->'approvalId','pages',cp->'pages','after',cp->'after','complete',cp->'complete');
 if cp ? 'propertyId' then observed:=observed||jsonb_build_object('propertyId',cp->'propertyId','propertiesCompleted',cp->'propertiesCompleted');end if;
 if cfg->'approved' is distinct from 'true'::jsonb or cfg->>'approvalId' is distinct from p_definition->>'approval_id'
  or cfg->>'connectionId' is distinct from c.id::text or observed is distinct from p_definition->'checkpoint'
  or jsonb_typeof(cfg->'maxPages') is distinct from 'number' or coalesce(cfg->>'maxPages','')!~'^[0-9]{1,10}$'
  or jsonb_typeof(cfg->'expiresAt') is distinct from 'string'
  or coalesce(cfg->>'resource','') not in ('properties','jobs','propertyContacts')
  or (cfg->>'resource'='propertyContacts' and coalesce(cfg->>'contactType','') not in ('customer','workaddress')) then
  raise exception 'learn_operator_progress_changed' using errcode='PT409';end if;
 if cfg->>'resource'='propertyContacts' and public.learn_commusoft_contact_target(p_tenant,c.id,cfg,cp) is null then
  raise exception 'learn_operator_contact_plan_invalid' using errcode='PT409';end if;
 -- No active attempt is reset or displaced, even after its lease expires.
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
  and payload->>'connector_account_id'=a.id::text and status in ('queued','running','retrying')) then
  raise exception 'learn_operator_import_active' using errcode='55000';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
  and payload->>'connector_account_id'=a.id::text order by created_at desc,id desc limit 1 for update;
 if not found or j.id::text is distinct from p_definition->>'job_id' or j.status not in ('succeeded','dead_letter')
  or j.job_key is distinct from 'commusoft.source:'||a.id::text||':'||(cfg->>'approvalId')
  or coalesce(j.lease_expires_at,'-infinity')>clock_timestamp() then
  raise exception 'learn_operator_progress_changed' using errcode='PT409';end if;
 -- Committed but unsettled work must go through source-free worker recovery.
 if j.status='dead_letter' and (j.metadata ? 'commusoft_page_v1' or exists(select 1 from public.learn_business_input_pages where job_id=j.id)) then
  raise exception 'learn_operator_page_unsettled' using errcode='55000';end if;
 if j.status='succeeded' and not exists(select 1 from public.learn_business_input_pages where job_id=j.id and tenant_id=p_tenant
  and connection_id=c.id and provider='commusoft' and collection=cfg->>'resource' and checkpoint_after=cp) then
  raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 if cp='{}'::jsonb then
  retained:=0;
  if j.status='succeeded' or exists(select 1 from public.learn_business_input_pages where tenant_id=p_tenant and connection_id=c.id and checkpoint_after->>'approvalId'=cfg->>'approvalId') then
   raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 else
  if cp->>'approvalId' is distinct from cfg->>'approvalId' or cp->'complete' is distinct from 'false'::jsonb
   or jsonb_typeof(cp->'pages') is distinct from 'number' or cp->>'pages'!~'^[0-9]{1,10}$' then
   raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
  retained:=(cp->>'pages')::integer;
  -- Require the exact last retained page, not a cursor supplied by the browser.
  select checkpoint_after into observed from public.learn_business_input_pages where tenant_id=p_tenant and connection_id=c.id
   and provider='commusoft' and collection=cfg->>'resource' and checkpoint_after->>'approvalId'=cfg->>'approvalId'
   order by (checkpoint_after->>'pages')::integer desc limit 1;
  if not found or observed is distinct from cp or retained<1 then raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 end if;
 if pages<=retained or pages::bigint-retained>10000 or pages<(cfg->>'maxPages')::integer or expiry<(cfg->>'expiresAt')::timestamptz then
  raise exception 'learn_operator_resume_limits' using errcode='22023';end if;
 previous:=jsonb_build_object('approval',cfg,'checkpoint',cp,'job_id',j.id,'job_status',j.status);
 cfg:=cfg||jsonb_build_object('expiresAt',expiry,'maxPages',pages);
 update public.connector_accounts set settings=settings||jsonb_build_object('commusoft_import',cfg) where id=a.id;
 insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,max_attempts,available_at,parent_job_id,payload,created_by)
  values(jid,p_tenant,'commusoft','learn','commusoft.source_sync',j.job_key,'queued',5,clock_timestamp(),j.id,jsonb_build_object('connector_account_id',a.id),p_actor);
 receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','kind','resume_commusoft','account_id',a.id,'job_id',jid,'approval_id',cfg->>'approvalId','checkpoint',p_definition->'checkpoint');
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt,previous_state) values(p_request,p_tenant,p_actor,p_definition,receipt,previous);
 return receipt;
end $$;

-- INPUT supabase/migrations/20261101030000_learn_customer_candidate_endpoints.sql
-- Read-only customer discovery across canonical and additional contact details.
-- A shared endpoint remains a review clue; no identity, card or consent is changed.

create or replace function public.learn_commusoft_customer_candidates(p_tenant uuid,p_version uuid,p_kind text,p_search text default '',p_after uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;s jsonb;q text;region text;source_email text;source_phones text[];search_phone text;
 result jsonb;more boolean;last_id uuid;
begin
 if p_version is null or p_kind is null or p_kind not in ('person','company') or p_search is null or length(btrim(p_search))>150
  or length(btrim(p_search))=1 or p_limit is null or p_limit not between 1 and 50 then raise exception 'business_input_search_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant);
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft' and collection='properties';
 if not found then raise exception 'business_input_source_unavailable' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 select non_secret_config->>'region' into region from public.provider_connections where id=v.connection_id and tenant_id=p_tenant;
 s:=public.learn_business_customer_summary(v.payload);q:=lower(btrim(p_search));source_email:=nullif(lower(btrim(s->>'email')),'');
 select coalesce(array_agg(distinct x) filter(where x is not null),'{}'::text[]) into source_phones from (
  select public.learn_business_contact_phone(public.learn_business_input_text(v.payload->'contact',field),region) x
  from unnest(array['telephone','mobile']) field
 ) numbers;
 search_phone:=case when q ~ '^[+0-9 ().-]+$' then public.learn_business_contact_phone(q,region) end;
 with candidates as (
  select id,display_name as name,primary_email as email,primary_phone as phone,postcode from public.people where tenant_id=p_tenant and p_kind='person' and (p_after is null or id>p_after)
  union all select id,name,null,phone,postcode from public.companies where tenant_id=p_tenant and p_kind='company' and (p_after is null or id>p_after)
 ), evidence as (
  select c.*,
   coalesce(case when nullif(lower(btrim(c.email)),'')=source_email then source_email end,
    (select min(cp.normalized_value) from public.contact_points cp where p_kind='person' and cp.tenant_id=p_tenant and cp.person_id=c.id and cp.channel='email' and cp.verification_state<>'invalid' and cp.normalized_value=source_email)) as matched_email,
   coalesce(case when public.learn_business_contact_phone(c.phone,region)=any(source_phones) then public.learn_business_contact_phone(c.phone,region) end,
    (select min(cp.normalized_value) from public.contact_points cp where p_kind='person' and cp.tenant_id=p_tenant and cp.person_id=c.id and cp.channel='phone' and cp.verification_state<>'invalid' and cp.normalized_value=any(source_phones))) as matched_phone,
   (select jsonb_build_object('channel',cp.channel,'value',left(cp.normalized_value,1000)) from public.contact_points cp
    where p_kind='person' and q<>'' and cp.tenant_id=p_tenant and cp.person_id=c.id and cp.channel in ('email','phone') and cp.verification_state<>'invalid'
     and (position(q in lower(concat_ws(' ',cp.value,cp.normalized_value)))>0 or (cp.channel='phone' and cp.normalized_value=search_phone))
    order by cp.channel,cp.normalized_value,cp.id limit 1) as searched_endpoint
  from candidates c
 ), matches as (
  select *,case when matched_email is not null then 'shared_email' when matched_phone is not null then 'shared_phone'
   when nullif(lower(btrim(name)),'')=nullif(lower(btrim(s->>case when p_kind='person' then 'person_name' else 'company_name' end)),'') then 'same_name'
   else 'search' end as reason,
   case when matched_email is not null then jsonb_build_object('channel','email','value',left(matched_email,1000))
    when matched_phone is not null then jsonb_build_object('channel','phone','value',left(matched_phone,1000)) else searched_endpoint end as match_detail
  from evidence where
   (q<>'' and (position(q in lower(concat_ws(' ',name,email,phone,postcode)))>0 or searched_endpoint is not null or public.learn_business_contact_phone(phone,region)=search_phone)) or
   (q='' and (matched_email is not null or matched_phone is not null or
    nullif(lower(btrim(name)),'')=nullif(lower(btrim(s->>case when p_kind='person' then 'person_name' else 'company_name' end)),'') ))
  order by id limit p_limit+1
 ), numbered as (select *,row_number() over(order by id) as n from matches)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',left(name,1000),'email',left(email,1000),'phone',left(phone,1000),'postcode',left(postcode,1000),'reason',reason,'match_detail',match_detail) order by id) filter(where n<=p_limit),'[]'),
  count(*)>p_limit,(array_agg(id order by id) filter(where n<=p_limit))[p_limit] into result,more,last_id from numbered;
 return jsonb_build_object('tenant_id',p_tenant,'version_id',p_version,'kind',p_kind,'rows',result,'next_cursor',case when more then last_id end);
end $$;
-- CREATE OR REPLACE retains the existing authenticated-only grants and owner.

-- INPUT supabase/migrations/20261101040000_learn_commusoft_job_lifecycle.sql
-- Observed Commusoft v2.1 lifecycle values, alongside documented legacy examples.
-- Empty optional dates mean absent. Unzoned dates stay held for explicit resolution.
-- No source rewrites, backfill, privilege change or implicit timezone conversion.

create or replace function public.learn_commusoft_confirm_work_record(p_tenant uuid,p_version uuid,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;s public.sites%rowtype;j public.jobs%rowtype;
 owner jsonb;request jsonb;result jsonb;meta jsonb;field text;kind text;parent text;reason text;target uuid;
 person uuid;company uuid;site uuid;namespace text;address text;status text;created timestamptz;completed timestamptz;ts text;
begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_version is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
  raise exception 'business_input_review_invalid' using errcode='22023';end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft';
 if not found or not (v.collection='jobs' or (v.collection='properties' and v.payload->>'type'='workaddress')) then
  raise exception 'business_input_work_source_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=v.connection_id for update;
 kind:=case when v.collection='jobs' then 'job' else 'site' end;
 request:=jsonb_build_object('target',p_target,'reason',btrim(p_reason),'kind',kind);
 -- The block exits on a held condition; the final attempt records the reason.
 <<project>> begin
  latest:=public.learn_business_input_latest(p_tenant,v.connection_id,v.provider,v.collection,v.external_id);
  if latest.id is distinct from v.id then reason:='source_changed_or_ambiguous';exit project;end if;
  if jsonb_typeof(v.payload->'id') is distinct from 'number' or v.payload->>'id' is distinct from v.external_id then reason:='source_identity_invalid';exit project;end if;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=v.connection_id
   and provider=v.provider and collection=v.collection and external_id=v.external_id;
  if found and (l.source_version_id<>v.id or l.entity_kind<>kind or (p_target is not null and p_target<>l.entity_id)) then
   reason:='existing_identity_needs_review';exit project;end if;
  field:=case when kind='site' then 'parentPropertyID' else 'propertyID' end;parent:=v.payload->>field;
  if jsonb_typeof(v.payload->field) is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$'
   or (kind='site' and parent=v.external_id) then reason:='property_reference_invalid';exit project;end if;
  if parent::numeric>9007199254740991 then reason:='property_reference_invalid';exit project;end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,v.connection_id,parent,kind='job');
  if owner->>'state'<>'ready' then reason:=owner->>'reason';exit project;end if;
  person:=(owner->>'person_id')::uuid;company:=(owner->>'company_id')::uuid;site:=(owner->>'site_id')::uuid;
  target:=coalesce(l.entity_id,p_target);namespace:='commusoft:connection:'||v.connection_id::text;
  if target is null then
   -- Existing CSV imports are candidates, not proof of the same provider account.
   if kind='site' and exists(select 1 from public.sites where tenant_id=p_tenant and source_system in ('commusoft',namespace) and external_id=v.external_id)
    or kind='job' and exists(select 1 from public.jobs where tenant_id=p_tenant and source_system in ('commusoft',namespace) and external_id=v.external_id) then
    reason:='existing_external_identity_needs_review';exit project;end if;
   meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,'source_version_id',v.id,'property_external_id',parent,'relationships',owner));
   if kind='site' then
    foreach field in array array['addressLine1','addressLine2','addressLine3','town','province','postcode'] loop
     if v.payload ? field and v.payload->field<>'null'::jsonb and (jsonb_typeof(v.payload->field)<>'string' or length(v.payload->>field)>1000) then reason:='site_field_invalid';exit project;end if;
    end loop;
    address:=public.learn_business_customer_summary(v.payload)->>'address';
    insert into public.sites(tenant_id,source_system,external_id,person_id,company_id,label,address_text,postcode,created_source,verified,metadata)
     values(p_tenant,namespace,v.external_id,person,company,coalesce(public.learn_business_input_text(v.payload,'addressLine1'),'Work site '||v.external_id),address,
      public.learn_business_input_text(v.payload,'postcode'),'business_input:commusoft',false,meta) returning id into target;
   else
    if jsonb_typeof(v.payload->'status') is distinct from 'string' or v.payload->>'status' not in ('Open','Complete','Closed','ongoing','completed','on_hold','pending') then reason:='job_status_unrecognised';exit project;end if;
    if v.payload ? 'description' and v.payload->'description'<>'null'::jsonb and (jsonb_typeof(v.payload->'description')<>'string' or length(v.payload->>'description')>1000) then reason:='job_field_invalid';exit project;end if;
    status:=case v.payload->>'status' when 'Open' then 'open' when 'ongoing' then 'open' when 'Complete' then 'completed' when 'completed' then 'completed' when 'Closed' then 'closed' else v.payload->>'status' end;
    if v.payload ? 'completed' and v.payload->'completed'<>'null'::jsonb and jsonb_typeof(v.payload->'completed')<>'object' then reason:='job_timestamp_invalid';exit project;end if;
    -- Only explicit source timestamps with a timezone are eligible. Closed does
    -- not mean completed: outcome, money, staff and reward semantics stay raw.
    foreach field in array array['created','completed'] loop
     ts:=nullif(case when field='created' then v.payload->>'createdOnDateTime' else v.payload->'completed'->>'completedOnDateTime' end,'');
     if ts is not null then
      -- Observed API completion times omit a zone. Retain the source, but do not
      -- invent a UTC instant or publish it into duration/performance evidence.
      if ts ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.[0-9]{1,6})?$' then reason:='job_timestamp_timezone_required';exit project;end if;
      if ts!~'^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then reason:='job_timestamp_invalid';exit project;end if;
      begin if field='created' then created:=ts::timestamptz;else completed:=ts::timestamptz;end if;
      exception when invalid_datetime_format or datetime_field_overflow then reason:='job_timestamp_invalid';exit project;end;
     end if;
    end loop;
    insert into public.jobs(tenant_id,source_system,external_id,job_number,customer_person_id,customer_company_id,site_id,title,description,status,created_date,completed_date,created_source,verified,metadata)
     values(p_tenant,namespace,v.external_id,v.external_id,person,company,site,coalesce(public.learn_business_input_text(v.payload,'description'),'Job '||v.external_id),
      public.learn_business_input_text(v.payload,'description'),status,created,completed,'business_input:commusoft',false,meta) returning id into target;
   end if;
  else
   if kind='site' then
    select * into s from public.sites where tenant_id=p_tenant and id=target for share;
    if not found or s.person_id is distinct from person or s.company_id is distinct from company then reason:='target_site_owner_mismatch';exit project;end if;
   else
    select * into j from public.jobs where tenant_id=p_tenant and id=target for share;
    if not found or j.customer_person_id is distinct from person or j.customer_company_id is distinct from company or j.site_id is distinct from site then reason:='target_job_owner_mismatch';exit project;end if;
   end if;
  end if;
  if l.id is null then
   insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
    values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,kind,case when kind='site' then 'sites' else 'jobs' end,target,(owner->>'card_id')::uuid,request,auth.uid()) returning * into l;
   result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',false);
  else result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',true);end if;
 end project;
 if reason is not null then result:=jsonb_build_object('state','held','reason',reason);end if;
 return public.learn_business_input_projection_result(p_tenant,v.id,request,result);
end $$;
-- CREATE OR REPLACE retains ownership and existing authenticated-only grants.

-- INPUT supabase/migrations/20261101050000_learn_commusoft_review_search.sql
-- Search retained inputs before pagination. Existing readers and writers remain unchanged.
-- No provider calls, source writes or wider review authority.

create function public.learn_commusoft_source_matches(p_payload jsonb,p_external text,p_kind text,p_search text)
returns boolean language sql immutable set search_path=pg_catalog as $$
 with term as (select lower(btrim(p_search)) as query), fields as (
 select case p_kind
  when 'customer' then concat_ws(' ',
   public.learn_business_input_text(p_payload,'companyName'),
   public.learn_business_input_text(p_payload->'contact','firstName'),public.learn_business_input_text(p_payload->'contact','lastName'),
   public.learn_business_input_text(p_payload->'contact','email'),public.learn_business_input_text(p_payload->'contact','telephone'),public.learn_business_input_text(p_payload->'contact','mobile'),
   public.learn_business_input_text(p_payload,'addressLine1'),public.learn_business_input_text(p_payload,'addressLine2'),public.learn_business_input_text(p_payload,'addressLine3'),
   public.learn_business_input_text(p_payload,'town'),public.learn_business_input_text(p_payload,'province'),public.learn_business_input_text(p_payload,'postcode'))
  when 'site' then concat_ws(' ',public.learn_business_input_text(p_payload,'addressLine1'),public.learn_business_input_text(p_payload,'addressLine2'),public.learn_business_input_text(p_payload,'addressLine3'),
   public.learn_business_input_text(p_payload,'town'),public.learn_business_input_text(p_payload,'province'),public.learn_business_input_text(p_payload,'postcode'))
  when 'job' then public.learn_business_input_text(p_payload,'description')
  when 'contact' then concat_ws(' ',public.learn_business_input_text(p_payload,'firstName'),public.learn_business_input_text(p_payload,'lastName'),public.learn_business_input_text(p_payload,'email'),public.learn_business_input_text(p_payload,'position'),
   (select string_agg(public.learn_business_input_text(ph,'number'),' ') from jsonb_array_elements(case when jsonb_typeof(p_payload->'telephones')='array' then p_payload->'telephones' else '[]'::jsonb end) ph)) end as value
 ) select coalesce(query='' or p_external=query or
  (case when p_kind='site' then p_payload->>'parentPropertyID' when p_kind in ('job','contact') then p_payload->>'propertyID' end)=query or
  strpos(lower(value),query)>0,false) from term,fields;
$$;
revoke all on function public.learn_commusoft_source_matches(jsonb,text,text,text) from public,anon,authenticated,service_role;
create function public.learn_commusoft_review_search(p_tenant uuid,p_connection uuid,p_search text default '',p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;more boolean;last_id text;begin
 if p_search is null or length(btrim(p_search))>150 or p_connection is null or p_limit is null or p_limit not between 1 and 50 or
  (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 with identities as (
  select distinct external_id from public.learn_business_input_versions
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft' and collection='properties'
   and (p_after is null or external_id collate "C">p_after collate "C")
 ), latest as (
  select s.*,l.id as link_id,l.entity_table,l.entity_id,l.card_id,l.source_version_id as linked_version
  from identities i cross join lateral (
   select v.id,v.external_id,v.payload,p.committed_at from public.learn_business_input_versions v
   join public.learn_business_input_observations o on o.version_id=v.id join public.learn_business_input_pages p on p.id=o.page_id
   where v.tenant_id=p_tenant and v.connection_id=p_connection and v.provider='commusoft' and v.collection='properties' and v.external_id=i.external_id
    and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id and p.provider=v.provider and p.collection=v.collection
   order by p.committed_at desc,v.id limit 1
  ) s left join public.learn_business_input_links l on l.tenant_id=p_tenant and l.connection_id=p_connection
    and l.provider='commusoft' and l.collection='properties' and l.external_id=s.external_id
  where s.payload->>'type'='customer' or l.entity_kind='customer'
 ), bounded as (select * from latest where public.learn_commusoft_source_matches(payload,external_id,'customer',p_search) order by external_id collate "C" limit p_limit+1), output as (
  select *,row_number() over(order by external_id collate "C") as n from bounded
 )
 select coalesce(jsonb_agg(jsonb_build_object('version_id',id,'external_id',external_id,'observed_at',committed_at,
   'summary',public.learn_business_customer_summary(payload),
   'link',case when link_id is not null then jsonb_build_object('entity_table',entity_table,'entity_id',entity_id,'card_id',card_id,'source_version_id',linked_version) end)
   order by external_id collate "C") filter(where n<=p_limit),'[]'),count(*)>p_limit,
   max(external_id collate "C") filter(where n<=p_limit) into result,more,last_id from output;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'search',btrim(p_search),'rows',result,'next_cursor',case when more then last_id end);
end $$;

create function public.learn_commusoft_work_review_search(p_tenant uuid,p_connection uuid,p_kind text,p_search text default '',p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r record;v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 rows jsonb:='[]';owner jsonb;attempt jsonb;label text;parent text;customer text;v_collection text;last_id text;counted integer:=0;more boolean:=false;
begin
 if p_search is null or length(btrim(p_search))>150 or p_connection is null or p_kind is null or p_kind not in ('site','job','contact') or p_limit is null or p_limit not between 1 and 50
  or (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 v_collection:=case when p_kind='site' then 'properties' when p_kind='contact' then 'propertyContacts' else 'jobs' end;
 -- Resolve latest observations together, including ambiguous/missing sources.
 -- Only the bounded matching page needs relationship and projection lookups.
 for r in with identities as materialized (
  select distinct s.external_id collate "C" as external_id from public.learn_business_input_versions s
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider='commusoft' and s.collection=v_collection
   and (p_kind in ('job','contact') or s.payload->>'type'='workaddress')
   and (p_after is null or s.external_id collate "C">p_after collate "C")
 ), observed as (
  select s.external_id,s.id,dense_rank() over(partition by s.external_id order by p.committed_at desc) as recency
  from identities i join public.learn_business_input_versions s on s.external_id=i.external_id
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider='commusoft' and s.collection=v_collection
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection
 ), latest as (
  select external_id,case when count(distinct id)=1 then min(id::text)::uuid end as version_id from observed where recency=1 group by external_id
 ) select i.external_id,s.id as version_id from identities i left join latest x on x.external_id=i.external_id
  left join public.learn_business_input_versions s on s.id=x.version_id
  where public.learn_commusoft_source_matches(s.payload,i.external_id,p_kind,p_search)
  order by i.external_id collate "C" limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.external_id;
  select * into v from public.learn_business_input_versions where id=r.version_id;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and learn_business_input_links.collection=v_collection and external_id=r.external_id;
  parent:=case when p_kind='site' then v.payload->>'parentPropertyID' else v.payload->>'propertyID' end;
  owner:=case when v.id is null then jsonb_build_object('state','held','reason','source_changed_or_ambiguous')
   else public.learn_commusoft_property_owner(p_tenant,p_connection,parent,p_kind in ('job','contact')) end;
  customer:=null;
  if owner->>'state'='ready' then
   if owner->>'person_id' is not null then select display_name into customer from public.people where tenant_id=p_tenant and id=(owner->>'person_id')::uuid;
   else select name into customer from public.companies where tenant_id=p_tenant and id=(owner->>'company_id')::uuid;end if;
  end if;
  select a.result into attempt from public.learn_business_input_projection_attempts a where a.tenant_id=p_tenant and a.source_version_id=v.id order by a.created_at desc,a.id desc limit 1;
  label:=case when p_kind='site' then public.learn_business_input_text(v.payload,'addressLine1') when p_kind='contact' then nullif(btrim(concat_ws(' ',public.learn_business_input_text(v.payload,'firstName'),public.learn_business_input_text(v.payload,'lastName'))),'') else public.learn_business_input_text(v.payload,'description') end;
  rows:=rows||jsonb_build_array(jsonb_build_object('external_id',r.external_id,'version_id',v.id,'title',coalesce(label,initcap(p_kind)||' '||r.external_id),
   'property_reference',case when parent~'^[1-9][0-9]{0,15}$' then parent end,'customer_name',left(customer,1000),'relationship_reason',owner->>'reason',
   'source_status',public.learn_business_input_text(v.payload,'status'),'linked_version_id',l.source_version_id,'last_result',attempt,
   'contact',case when p_kind='contact' then jsonb_build_object('email',public.learn_business_input_text(v.payload,'email'),'position',public.learn_business_input_text(v.payload,'position'),
    'phones',(select coalesce(jsonb_agg(x.number),'[]'::jsonb) from (select left(concat_ws(': ',ph->>'type',ph->>'number'),1000) as number from jsonb_array_elements(case when jsonb_typeof(v.payload->'telephones')='array' then v.payload->'telephones' else '[]'::jsonb end) ph where jsonb_typeof(ph->'number')='string' limit 50) x)) end,
   'selectable',v.id is not null and coalesce(p_kind in ('job','contact') or v.payload->>'type'='workaddress',false)));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'kind',p_kind,'search',btrim(p_search),'rows',rows,'next_cursor',case when more then last_id end);
end $$;

revoke all on function public.learn_commusoft_review_search(uuid,uuid,text,text,integer),public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_review_search(uuid,uuid,text,text,integer),public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer) to authenticated;

-- INPUT supabase/migrations/20261101070000_learn_commusoft_job_details.sql
-- Read retained job facts without publishing uncertain timestamps or source data.

create function public.learn_business_input_time_detail(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare raw text;local_time timestamp;instant timestamptz;
begin
 if p_value is null or p_value='null'::jsonb or p_value='""'::jsonb then
  return jsonb_build_object('state','absent','source',null,'instant',null);end if;
 if jsonb_typeof(p_value)<>'string' then return jsonb_build_object('state','invalid','source',null,'instant',null);end if;
 raw:=p_value#>>'{}';
 if length(raw)>100 then return jsonb_build_object('state','invalid','source',null,'instant',null);end if;
 if raw ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])[ T]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?$' then
  begin local_time:=raw::timestamp;
  exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('state','invalid','source',raw,'instant',null);end;
  return jsonb_build_object('state','timezone_required','source',raw,'instant',null);
 end if;
 if raw ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then
  begin instant:=raw::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('state','invalid','source',raw,'instant',null);end;
  return jsonb_build_object('state','zoned','source',raw,'instant',to_char(instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 end if;
 return jsonb_build_object('state','invalid','source',raw,'instant',null);
end $$;
revoke all on function public.learn_business_input_time_detail(jsonb) from public,anon,authenticated,service_role;

create function public.learn_commusoft_job_details(p_tenant uuid,p_connection uuid,p_version uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 fields jsonb:='{}';dates jsonb;field text;value text;observed timestamptz;
begin
 if p_tenant is null or p_connection is null or p_version is null then raise exception 'business_input_job_scope_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 select * into v from public.learn_business_input_versions where tenant_id=p_tenant and connection_id=p_connection
  and id=p_version and provider='commusoft' and collection='jobs';
 if not found then raise exception 'business_input_job_unavailable' using errcode='22023';end if;
 select max(p.committed_at) into observed from public.learn_business_input_observations o join public.learn_business_input_pages p on p.id=o.page_id
  where o.version_id=v.id and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id and p.provider=v.provider and p.collection=v.collection;
 if observed is null then raise exception 'business_input_job_unavailable' using errcode='22023';end if;
 latest:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','jobs',v.external_id);
 foreach field in array array['description','status','priority','customerReference','businessUnit','userGroup'] loop
  value:=case when jsonb_typeof(v.payload->field)='string' then v.payload->>field end;
  fields:=fields||jsonb_build_object(field,jsonb_build_object('value',left(value,4000),'shortened',coalesce(length(value)>4000,false)));
 end loop;
 value:=case when jsonb_typeof(v.payload->'closed'->'closedOutcome')='string' then v.payload->'closed'->>'closedOutcome' end;
 fields:=fields||jsonb_build_object('closedOutcome',jsonb_build_object('value',left(value,4000),'shortened',coalesce(length(value)>4000,false)));
 dates:=jsonb_build_object('created',public.learn_business_input_time_detail(v.payload->'createdOnDateTime'),
  'reported',public.learn_business_input_time_detail(v.payload->'jobReportedDateTime'),
  'completed',public.learn_business_input_time_detail(case when v.payload->'completed' is null or v.payload->'completed'='null'::jsonb or jsonb_typeof(v.payload->'completed')='object' then v.payload->'completed'->'completedOnDateTime' else '{}'::jsonb end),
  'closed',public.learn_business_input_time_detail(case when v.payload->'closed' is null or v.payload->'closed'='null'::jsonb or jsonb_typeof(v.payload->'closed')='object' then v.payload->'closed'->'closedOnDateTime' else '{}'::jsonb end));
 return jsonb_build_object('version','commusoft-job-detail/1','tenant_id',p_tenant,'connection_id',p_connection,'version_id',v.id,
  'external_id',v.external_id,'observed_at',observed,'current',latest.id is not distinct from v.id,
  'property_reference',case when jsonb_typeof(v.payload->'propertyID')='number' and v.payload->>'propertyID'~'^[1-9][0-9]{0,15}$' and (v.payload->>'propertyID')::numeric<=9007199254740991 then v.payload->>'propertyID' end,
  'fields',fields,'dates',dates);
end $$;
revoke all on function public.learn_commusoft_job_details(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_job_details(uuid,uuid,uuid) to authenticated;

-- INPUT supabase/migrations/20261101250000_learn_commusoft_partial_job_times.sql
-- Publish useful job identity/status with explicit timing limitations.
-- Valid unzoned timestamps remain raw evidence, never invented UTC instants.
-- Malformed dates and unresolved ownership still hold the record. No backfill.

create or replace function public.learn_commusoft_confirm_work_record(p_tenant uuid,p_version uuid,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;s public.sites%rowtype;j public.jobs%rowtype;
 owner jsonb;request jsonb;result jsonb;meta jsonb;field text;kind text;parent text;reason text;target uuid;
 person uuid;company uuid;site uuid;namespace text;address text;status text;created timestamptz;completed timestamptz;time_detail jsonb;times jsonb:='{}';
begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_version is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
  raise exception 'business_input_review_invalid' using errcode='22023';end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft';
 if not found or not (v.collection='jobs' or (v.collection='properties' and v.payload->>'type'='workaddress')) then
  raise exception 'business_input_work_source_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=v.connection_id for update;
 kind:=case when v.collection='jobs' then 'job' else 'site' end;
 request:=jsonb_build_object('target',p_target,'reason',btrim(p_reason),'kind',kind);
 -- The block exits on a held condition; the final attempt records the reason.
 <<project>> begin
  latest:=public.learn_business_input_latest(p_tenant,v.connection_id,v.provider,v.collection,v.external_id);
  if latest.id is distinct from v.id then reason:='source_changed_or_ambiguous';exit project;end if;
  if jsonb_typeof(v.payload->'id') is distinct from 'number' or v.payload->>'id' is distinct from v.external_id then reason:='source_identity_invalid';exit project;end if;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=v.connection_id
   and provider=v.provider and collection=v.collection and external_id=v.external_id;
  if found and (l.source_version_id<>v.id or l.entity_kind<>kind or (p_target is not null and p_target<>l.entity_id)) then
   reason:='existing_identity_needs_review';exit project;end if;
  field:=case when kind='site' then 'parentPropertyID' else 'propertyID' end;parent:=v.payload->>field;
  if jsonb_typeof(v.payload->field) is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$'
   or (kind='site' and parent=v.external_id) then reason:='property_reference_invalid';exit project;end if;
  if parent::numeric>9007199254740991 then reason:='property_reference_invalid';exit project;end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,v.connection_id,parent,kind='job');
  if owner->>'state'<>'ready' then reason:=owner->>'reason';exit project;end if;
  person:=(owner->>'person_id')::uuid;company:=(owner->>'company_id')::uuid;site:=(owner->>'site_id')::uuid;
  target:=coalesce(l.entity_id,p_target);namespace:='commusoft:connection:'||v.connection_id::text;
  if target is null then
   -- Existing CSV imports are candidates, not proof of the same provider account.
   if kind='site' and exists(select 1 from public.sites where tenant_id=p_tenant and source_system in ('commusoft',namespace) and external_id=v.external_id)
    or kind='job' and exists(select 1 from public.jobs where tenant_id=p_tenant and source_system in ('commusoft',namespace) and external_id=v.external_id) then
    reason:='existing_external_identity_needs_review';exit project;end if;
   meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,'source_version_id',v.id,'property_external_id',parent,'relationships',owner));
   if kind='site' then
    foreach field in array array['addressLine1','addressLine2','addressLine3','town','province','postcode'] loop
     if v.payload ? field and v.payload->field<>'null'::jsonb and (jsonb_typeof(v.payload->field)<>'string' or length(v.payload->>field)>1000) then reason:='site_field_invalid';exit project;end if;
    end loop;
    address:=public.learn_business_customer_summary(v.payload)->>'address';
    insert into public.sites(tenant_id,source_system,external_id,person_id,company_id,label,address_text,postcode,created_source,verified,metadata)
     values(p_tenant,namespace,v.external_id,person,company,coalesce(public.learn_business_input_text(v.payload,'addressLine1'),'Work site '||v.external_id),address,
      public.learn_business_input_text(v.payload,'postcode'),'business_input:commusoft',false,meta) returning id into target;
   else
    if jsonb_typeof(v.payload->'status') is distinct from 'string' or v.payload->>'status' not in ('Open','Complete','Closed','ongoing','completed','on_hold','pending') then reason:='job_status_unrecognised';exit project;end if;
    if v.payload ? 'description' and v.payload->'description'<>'null'::jsonb and (jsonb_typeof(v.payload->'description')<>'string' or length(v.payload->>'description')>1000) then reason:='job_field_invalid';exit project;end if;
    status:=case v.payload->>'status' when 'Open' then 'open' when 'ongoing' then 'open' when 'Complete' then 'completed' when 'completed' then 'completed' when 'Closed' then 'closed' else v.payload->>'status' end;
    if v.payload ? 'completed' and v.payload->'completed'<>'null'::jsonb and jsonb_typeof(v.payload->'completed')<>'object' then reason:='job_timestamp_invalid';exit project;end if;
    -- The source classifier validates calendar/time fields without assuming a zone.
    -- A usable job can be linked while an uncertain instant remains unavailable.
    foreach field in array array['created','completed'] loop
     time_detail:=public.learn_business_input_time_detail(case when field='created'
      then v.payload->'createdOnDateTime' else v.payload->'completed'->'completedOnDateTime' end);
     if time_detail->>'state'='invalid' then reason:='job_timestamp_invalid';exit project;end if;
     if time_detail->>'state'='zoned' then
      if field='created' then created:=(time_detail->>'instant')::timestamptz;
      else completed:=(time_detail->>'instant')::timestamptz;end if;
     end if;
     times:=times||jsonb_build_object(field,time_detail);
    end loop;
    meta:=jsonb_set(meta,'{learn_business_input,timestamps}',times);
    insert into public.jobs(tenant_id,source_system,external_id,job_number,customer_person_id,customer_company_id,site_id,title,description,status,created_date,completed_date,created_source,verified,metadata)
     values(p_tenant,namespace,v.external_id,v.external_id,person,company,site,coalesce(public.learn_business_input_text(v.payload,'description'),'Job '||v.external_id),
      public.learn_business_input_text(v.payload,'description'),status,created,completed,'business_input:commusoft',false,meta) returning id into target;
   end if;
  else
   if kind='site' then
    select * into s from public.sites where tenant_id=p_tenant and id=target for share;
    if not found or s.person_id is distinct from person or s.company_id is distinct from company then reason:='target_site_owner_mismatch';exit project;end if;
   else
    select * into j from public.jobs where tenant_id=p_tenant and id=target for share;
    if not found or j.customer_person_id is distinct from person or j.customer_company_id is distinct from company or j.site_id is distinct from site then reason:='target_job_owner_mismatch';exit project;end if;
    times:=case when jsonb_typeof(j.metadata->'learn_business_input'->'timestamps')='object' then j.metadata->'learn_business_input'->'timestamps' else '{}'::jsonb end;
   end if;
  end if;
  if l.id is null then
   insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
    values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,kind,case when kind='site' then 'sites' else 'jobs' end,target,(owner->>'card_id')::uuid,request,auth.uid()) returning * into l;
   result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',false);
  else result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',true);end if;
  if kind='job' then
   result:=result||jsonb_build_object('timing_limitations',coalesce((select jsonb_agg(key order by key)
    from jsonb_each(times) where key in ('created','completed') and value->>'state'='timezone_required'),'[]'::jsonb));
  end if;
 end project;
 if reason is not null then result:=jsonb_build_object('state','held','reason',reason);end if;
 return public.learn_business_input_projection_result(p_tenant,v.id,request,result);
end $$;
-- CREATE OR REPLACE retains ownership and existing authenticated-only grants.

-- INPUT supabase/release/learn-production/patches/marketing_tenant_guard.sql
-- Preserve the installed invoker trigger and all its tenant checks. Its previous
-- unqualified names fail when a restricted SECURITY DEFINER writer invokes it.
-- Exact installed definition/authority is checked by the enclosing package.
do $$declare d text;table_name text;needle text;begin
 d:=pg_get_functiondef('public.marketing_tenant_guard()'::regprocedure);
 foreach table_name in array array['people','companies','contact_points','marketing_tags','marketing_segments','marketing_lifecycle_stages','profiles'] loop
  needle:='from '||table_name||' ';
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then
   raise exception 'Marketing tenant guard reference contract differs';end if;
  d:=replace(d,needle,'from public.'||table_name||' ');
 end loop;
 execute d;
end$$;
alter function public.marketing_tenant_guard() set search_path=pg_catalog;

insert into of_learn_deploy.migrations values('learn_commusoft_api_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
