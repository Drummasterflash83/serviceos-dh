-- DRAFT: additive roster support; no tenant seeds, user grants or production execution.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production roster target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_operator_context_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='f4413fe47a9eaa1eb7774e35e22f10f78bf94a55345f4fbe19fe690b4e7d8556') then raise exception 'Pinned production roster prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_roster_support_v1')
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_roster_write_guard','cp_roster_upsert_member','cp_member_lifecycle','cp_upsert_responsibility','cp_end_responsibility','cp_grant_authority','cp_end_authority'])) then raise exception 'Production roster candidate already exists; inspect before retry';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['authority_grants','authority_permissions','controlplane_change_log','org_units','responsibility_assignments','team_members','tenants']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"authority_grants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"member_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"permission","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"scope","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"d679a3ceab4be7171bc3625c14f15138"},{"name":"scope_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc1aa1465ec03c693f1c71ed37ae624c"},{"name":"confirmed","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"1ec4dcbc8a2de2a92bb377baa527ecca","name":"authority_grants_pkey","valid":true},{"hash":"728031138b677deba916ee6ec3cadad5","name":"authority_grants_uk","valid":true}],"forceRls":false,"policies":[{"name":"authority_grants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"c4ff8b55b497abfc2828f30ea5376ddb","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"b262cb3b711f7b9350a42e406f60bee1","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"afd01aca1fa8c1c9813128a89b5285aa","name":"learn_work_authority_truncate_lock","enabled":"O"}],"constraints":[{"hash":"72259ce48876664267c3bd95d8882c9d","kind":"f","name":"authority_grants_member_id_fkey","validated":true},{"hash":"6955543725589d3d6e35aa41f8b28493","kind":"f","name":"authority_grants_permission_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"authority_grants_pkey","validated":true},{"hash":"70490051b4b27184b3abc86a15e80fef","kind":"c","name":"authority_grants_scope_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"authority_grants_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"authority_permissions","owner":"postgres","columns":[{"name":"permission","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"category","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"99377c3e568e76469e14a0d3d2f9eeaa","name":"authority_permissions_pkey","valid":true}],"forceRls":false,"policies":[{"name":"authority_permissions_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[{"hash":"25c4430b5f4b947dcfbc73957f799918","name":"learn_work_registry_input_lock","enabled":"O"}],"constraints":[{"hash":"6dd7316dfb8327cd8cc395b10b596265","kind":"p","name":"authority_permissions_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"controlplane_change_log","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"actor","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"action","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"resource_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"resource_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"before","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"after","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"effective_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"correlation_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"view_as_active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3db2c9ad92f63447699691ce96afc514"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"d7f2e1ad547723d764c67f2a698be4da","name":"controlplane_change_log_pkey","valid":true},{"hash":"1a87d3321cff97fcc25e7f90fd78511c","name":"cpcl_resource","valid":true},{"hash":"88ed6329f01ea2cb7040cd4dd21df50e","name":"cpcl_tenant","valid":true}],"forceRls":false,"policies":[{"name":"controlplane_change_log_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"ab3044cecbbd365f8b11b781f958e96f","permissive":"PERMISSIVE"}],"triggers":[{"hash":"104fab7e50d2011088a3a5f931f20d8b","name":"controlplane_change_log_no_delete","enabled":"O"},{"hash":"f69cbdea06ca614d15e128a73f54b466","name":"controlplane_change_log_no_update","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"controlplane_change_log_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"controlplane_change_log_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"org_units","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"parent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"977befb3251c01656fc9bf6c7d98e947","name":"org_units_id_tenant_uk","valid":true},{"hash":"89c7906b33ff47cfa0c22c491aa601bd","name":"org_units_pkey","valid":true},{"hash":"9ad08482ebb4aec4838a12c279cb7567","name":"org_units_tenant","valid":true}],"forceRls":false,"policies":[{"name":"org_units_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"05a71fc442922c364f5b8b415e6c80ec","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"dc2a972fad8ade815a16649ad7632e74","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"10515e6a015c6f4e3fe0ae000c44e665","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"d5cfd4d30554ccb75b30b8ef9a34e9d4","name":"org_units_set_updated_at","enabled":"O"}],"constraints":[{"hash":"d5fcca4b41cda0d74e531fcdd52cfa71","kind":"f","name":"org_units_parent_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"org_units_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"org_units_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"responsibility_assignments","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"member_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"target_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"raci_role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"2ef3b270424c5036114ebb63785b3c8e"},{"name":"is_shared","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"weekday_mask","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cover_for","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc1aa1465ec03c693f1c71ed37ae624c"},{"name":"confirmed","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"6922306320908150f4429f75cc0b4d39","name":"resp_member","valid":true},{"hash":"53731852231c1d7a7e82209dcd2dfd45","name":"resp_target","valid":true},{"hash":"72a86912d62912db7c13ffd96f8d552a","name":"responsibility_assignments_pkey","valid":true}],"forceRls":false,"policies":[{"name":"resp_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"308731284205250c0816d60608d611b2","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"b496ba07cfc371b9485be912ff65ba2f","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"67bb2fa9aee5fb8822ea771c6dde1a88","name":"learn_work_authority_truncate_lock","enabled":"O"}],"constraints":[{"hash":"fe05d9f5fdc7c955f732c72e312b120c","kind":"c","name":"responsibility_assignments_confidence_check","validated":true},{"hash":"c726adb4cf42d5834fb07b874b42a9e9","kind":"f","name":"responsibility_assignments_cover_for_fkey","validated":true},{"hash":"05445f8bc4bb2e08013b64f3aae73414","kind":"c","name":"responsibility_assignments_kind_check","validated":true},{"hash":"72259ce48876664267c3bd95d8882c9d","kind":"f","name":"responsibility_assignments_member_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"responsibility_assignments_pkey","validated":true},{"hash":"58c31d351bfb1dba507257415ebb2857","kind":"c","name":"responsibility_assignments_raci_role_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"responsibility_assignments_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"team_members","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"profile_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"org_unit_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"formal_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"observed_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"observed_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c52f9c62eaaccb25ee4a31f5d7985d5f"},{"name":"authority_level","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"af8c0c74e3183c2818bc9d953905fd3b"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc1aa1465ec03c693f1c71ed37ae624c"},{"name":"confirmed_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confirmed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"702f51d0616b95af6acceac770041d90","name":"team_members_id_tenant_uk","valid":true},{"hash":"3050f5b55154f2c1f333d5ac4620ed9f","name":"team_members_pkey","valid":true},{"hash":"4c7c3c5008c60803c6e0cdc1c63d4724","name":"team_members_profile","valid":true},{"hash":"d1291cf097138ed6a8e370ba09879e2c","name":"team_members_tenant","valid":true}],"forceRls":false,"policies":[{"name":"team_members_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"20470c2fa4bfa1cfd511bff609c9327a","name":"learn_capture_member_change","enabled":"O"},{"hash":"1f88777e8f895faa6f75f677f577a205","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"81116ed1f8bd3359a358eb8c192755eb","name":"learn_member_no_delete","enabled":"O"},{"hash":"4903df4fb40be1ac178cfdf9148826be","name":"learn_member_no_truncate","enabled":"O"},{"hash":"d45827f37e95f2ee646f5f6fa087fd33","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"d436df6318ac765e417b873eaff97451","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"b419d5db1c118ff5d4e1f4a175ef311a","name":"team_members_set_updated_at","enabled":"O"}],"constraints":[{"hash":"ff1dd41640b0c5def6891c12630f5f29","kind":"c","name":"team_members_authority_level_check","validated":true},{"hash":"fe05d9f5fdc7c955f732c72e312b120c","kind":"c","name":"team_members_confidence_check","validated":true},{"hash":"0b3438f4f2c60569832a789b448f8a4d","kind":"c","name":"team_members_observed_status_check","validated":true},{"hash":"c773fa58011794721f1db6b5021ef422","kind":"f","name":"team_members_org_unit_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"team_members_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"team_members_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"slug","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"industry","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5284b9c618f8618b72a402ea2c593753","name":"tenants_pkey","valid":true},{"hash":"6260c986ce2d58a0ad3de3f74ec6eb6f","name":"tenants_slug_key","valid":true}],"forceRls":false,"policies":[{"name":"tenants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"831f798d620de1d73971187d41079b4d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8009f8efa07661ab809d3f9e077da55e","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"742cd63e2f0ed7809f0911b17d02869d","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a4d62ca55c88b97023eab7696e527ce","name":"tenants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenants_pkey","validated":true},{"hash":"687397275d0e852fb2a4b50394adffee","kind":"u","name":"tenants_slug_key","validated":true},{"hash":"7702cc7b97df1ebce81e13bb05db5c2d","kind":"c","name":"tenants_status_check","validated":true}]}]'::jsonb then raise exception 'Production roster table baseline differs';end if;
end$$;
alter table public.team_members add column formal_role_status text not null default 'proposed', add column target_role text;
alter table public.team_members add constraint team_members_formal_role_status_check check(formal_role_status in ('proposed','confirmed'));
-- Harden recovered roster writers without seeding or editing tenant rows.
-- The original recovered migrations remain intact for provenance.
create function public.learn_roster_write_guard(p_tenant uuid,p_actor text,p_reason text,p_view_as boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if length(btrim(coalesce(p_actor,''))) not between 1 and 500
    or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
    or p_view_as is distinct from false then
    raise exception 'Roster writes require an actor, reason and no View-As';
  end if;
  if not exists(select 1 from tenants where id=p_tenant) then raise exception 'Unknown tenant'; end if;
  -- Serializes this tenant's roster lifecycle, replacements and grants so
  -- concurrent supersedes cannot branch and leave two active successors.
  perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
end $$;
revoke all on function public.learn_roster_write_guard(uuid,text,text,boolean) from public,anon,authenticated,service_role;

create function public.cp_roster_upsert_member(
  p_tenant uuid, p_member_id uuid, p_display_name text, p_org_unit uuid,
  p_formal_role text, p_formal_role_status text, p_target_role text,
  p_authority_level text, p_effective_from timestamptz,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_before jsonb := '{}'::jsonb; v_row team_members;
begin
  perform learn_roster_write_guard(p_tenant,p_actor,p_reason,p_view_as);
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_roster_upsert_member: actor is required';
  end if;
  if p_org_unit is not null and not exists(select 1 from org_units where id=p_org_unit and tenant_id=p_tenant) then
    raise exception 'Roster team must belong to tenant';
  end if;
  if p_effective_from is not null and not isfinite(p_effective_from) then raise exception 'Finite start date required'; end if;
  if p_formal_role_status is not null
     and p_formal_role_status not in ('proposed','confirmed') then
    raise exception 'cp_roster_upsert_member: invalid formal_role_status';
  end if;
  if p_authority_level is not null
     and p_authority_level not in ('individual','lead','manager','director','owner') then
    raise exception 'cp_roster_upsert_member: invalid authority_level';
  end if;
  if p_member_id is not null then
    select * into v_row from team_members where id = p_member_id and tenant_id = p_tenant for update;
    if not found then raise exception 'cp_roster_upsert_member: member not found in tenant'; end if;
    v_id := v_row.id; v_before := to_jsonb(v_row);
    update team_members set
      display_name       = coalesce(p_display_name, display_name),
      org_unit_id        = coalesce(p_org_unit, org_unit_id),
      formal_role        = coalesce(p_formal_role, formal_role),
      formal_role_status = coalesce(p_formal_role_status, formal_role_status),
      target_role        = coalesce(p_target_role, target_role),
      authority_level    = coalesce(p_authority_level, authority_level),
      version            = version + 1
     where id = v_id;
  else
    if p_display_name is null or length(trim(p_display_name)) = 0 then
      raise exception 'cp_roster_upsert_member: display_name is required to create a member';
    end if;
    insert into team_members
      (tenant_id, display_name, org_unit_id, formal_role, formal_role_status, target_role,
       authority_level, effective_from, source)
    values (p_tenant, p_display_name, p_org_unit, p_formal_role,
       coalesce(p_formal_role_status, 'proposed'), p_target_role,
       coalesce(p_authority_level, 'individual'), coalesce(p_effective_from, now()), 'openfolk')
    returning id into v_id;
  end if;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.member_upsert', 'team_member', v_id::text,
     v_before, (select to_jsonb(m) from team_members m where m.id = v_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return v_id;
end $$;

-- ── Member lifecycle: end (leaver) / reactivate (rejoiner) — history preserved ─
create function public.cp_member_lifecycle(
  p_tenant uuid, p_member_id uuid, p_op text, p_effective timestamptz,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_row team_members; v_when timestamptz := coalesce(p_effective, now());
begin
  perform learn_roster_write_guard(p_tenant,p_actor,p_reason,p_view_as);
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_member_lifecycle: actor is required';
  end if;
  if p_op is null or p_op not in ('end','reactivate') then
    raise exception 'cp_member_lifecycle: op must be end|reactivate';
  end if;
  select * into v_row from team_members where id = p_member_id and tenant_id = p_tenant for update;
  if not found then raise exception 'cp_member_lifecycle: member not found in tenant'; end if;
  if not isfinite(v_when) or v_when>clock_timestamp() or v_when<v_row.effective_from then
    raise exception 'Lifecycle date must be finite, not future, and after membership began';
  end if;
  v_before := to_jsonb(v_row);
  if p_op = 'end' then
    if v_row.effective_to is not null then
      raise exception 'cp_member_lifecycle: member is already ended';
    end if;
    update team_members set effective_to = v_when, version = version + 1
     where id = p_member_id;
    -- Ending the person ends their open responsibilities the same instant (history kept).
    update responsibility_assignments set effective_to = greatest(v_when,effective_from)
     where tenant_id = p_tenant and member_id = p_member_id and effective_to is null;
    update authority_grants set effective_to = greatest(v_when,effective_from)
     where tenant_id = p_tenant and member_id = p_member_id and effective_to is null;
  else
    if v_row.effective_to is null then
      raise exception 'cp_member_lifecycle: member is already active';
    end if;
    -- Reactivation restores the person only; responsibilities/authority are re-proposed
    -- deliberately (a rejoiner's duties are a decision, never an automatic restore).
    if v_when<v_row.effective_to then raise exception 'Rejoin cannot precede leaving'; end if;
    update team_members set effective_from = v_when, effective_to = null, version = version + 1
     where id = p_member_id;
  end if;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.member_' || p_op, 'team_member', p_member_id::text,
     v_before, (select to_jsonb(m) from team_members m where m.id = p_member_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return p_member_id;
end $$;

-- ── Responsibilities: create / supersede (end-and-replace preserves history) ──
create function public.cp_upsert_responsibility(
  p_tenant uuid, p_assignment_id uuid, p_member uuid, p_kind text, p_target_ref text,
  p_label text, p_raci text, p_is_shared boolean, p_weekday_mask int, p_cover_for uuid,
  p_confirmed boolean, p_effective_from timestamptz,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old responsibility_assignments; v_before jsonb := '{}'::jsonb;
        v_from timestamptz := coalesce(p_effective_from, now());
        v_member uuid; v_cover uuid;
begin
  perform learn_roster_write_guard(p_tenant,p_actor,p_reason,p_view_as);
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_upsert_responsibility: actor is required';
  end if;
  if not isfinite(v_from) or (p_weekday_mask is not null and p_weekday_mask not between 0 and 127) then
    raise exception 'Valid start date and weekday mask required';
  end if;
  if p_assignment_id is not null then
    -- Supersede: validate the RESOLVED successor values against the tenant BEFORE
    -- touching the old row, so a refusal leaves the existing assignment untouched.
    select * into v_old from responsibility_assignments
     where id = p_assignment_id and tenant_id = p_tenant for update;
    if not found then raise exception 'cp_upsert_responsibility: assignment not found in tenant'; end if;
    if v_old.effective_to is not null then
      raise exception 'cp_upsert_responsibility: assignment is already ended';
    end if;
    if v_from<v_old.effective_from then raise exception 'Successor cannot precede prior assignment'; end if;
    v_member := coalesce(p_member, v_old.member_id);
    v_cover  := coalesce(p_cover_for, v_old.cover_for);
    if not exists (select 1 from team_members
                    where id = v_member and tenant_id = p_tenant and effective_from<=v_from and (effective_to is null or effective_to>v_from)) then
      raise exception 'cp_upsert_responsibility: successor member is not active in tenant';
    end if;
    if v_cover is not null and not exists
       (select 1 from team_members
         where id = v_cover and tenant_id = p_tenant and effective_from<=v_from and (effective_to is null or effective_to>v_from)) then
      raise exception 'cp_upsert_responsibility: successor cover member is not active in tenant';
    end if;
    v_before := to_jsonb(v_old);
    update responsibility_assignments set effective_to = v_from where id = v_old.id;
    insert into responsibility_assignments
      (tenant_id, member_id, kind, target_ref, label, raci_role, is_shared, weekday_mask,
       cover_for, confirmed, effective_from, version, source)
    values (p_tenant, v_member, coalesce(p_kind, v_old.kind),
       coalesce(p_target_ref, v_old.target_ref), coalesce(p_label, v_old.label),
       coalesce(p_raci, v_old.raci_role), coalesce(p_is_shared, v_old.is_shared),
       coalesce(p_weekday_mask, v_old.weekday_mask), v_cover,
       coalesce(p_confirmed, v_old.confirmed), v_from, v_old.version + 1, 'openfolk')
    returning id into v_id;
  else
    if p_member is null or p_kind is null or p_label is null then
      raise exception 'cp_upsert_responsibility: member, kind and label are required';
    end if;
    if not exists (select 1 from team_members
                    where id = p_member and tenant_id = p_tenant and effective_from<=v_from and (effective_to is null or effective_to>v_from)) then
      raise exception 'cp_upsert_responsibility: member is not active in tenant';
    end if;
    if p_cover_for is not null and not exists
       (select 1 from team_members
         where id = p_cover_for and tenant_id = p_tenant and effective_from<=v_from and (effective_to is null or effective_to>v_from)) then
      raise exception 'cp_upsert_responsibility: cover_for member is not active in tenant';
    end if;
    insert into responsibility_assignments
      (tenant_id, member_id, kind, target_ref, label, raci_role, is_shared, weekday_mask,
       cover_for, confirmed, effective_from, source)
    values (p_tenant, p_member, p_kind, p_target_ref, p_label,
       coalesce(p_raci, 'responsible'), coalesce(p_is_shared, false), p_weekday_mask,
       p_cover_for, coalesce(p_confirmed, false), v_from, 'openfolk')
    returning id into v_id;
  end if;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.responsibility_upsert', 'responsibility_assignment',
     v_id::text, v_before,
     (select to_jsonb(r) from responsibility_assignments r where r.id = v_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return v_id;
end $$;

create function public.cp_end_responsibility(
  p_tenant uuid, p_assignment_id uuid, p_effective_to timestamptz,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_old responsibility_assignments;
begin
  perform learn_roster_write_guard(p_tenant,p_actor,p_reason,p_view_as);
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_end_responsibility: actor is required';
  end if;
  select * into v_old from responsibility_assignments
   where id = p_assignment_id and tenant_id = p_tenant for update;
  if not found then raise exception 'cp_end_responsibility: assignment not found in tenant'; end if;
  if v_old.effective_to is not null then
    raise exception 'cp_end_responsibility: assignment is already ended';
  end if;
  if not isfinite(coalesce(p_effective_to,now())) or coalesce(p_effective_to,now())<v_old.effective_from then
    raise exception 'End date cannot precede assignment';
  end if;
  update responsibility_assignments set effective_to = coalesce(p_effective_to, now())
   where id = p_assignment_id;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.responsibility_end', 'responsibility_assignment',
     p_assignment_id::text, to_jsonb(v_old),
     (select to_jsonb(r) from responsibility_assignments r where r.id = p_assignment_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return p_assignment_id;
end $$;

-- ── Authority: grant / end (reactivates an ended identical grant in place) ────
create function public.cp_grant_authority(
  p_tenant uuid, p_member uuid, p_permission text, p_scope text, p_scope_ref text,
  p_confirmed boolean,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_before jsonb := '{}'::jsonb; v_row authority_grants;
begin
  perform learn_roster_write_guard(p_tenant,p_actor,p_reason,p_view_as);
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_grant_authority: actor is required';
  end if;
  if not exists (select 1 from team_members
                  where id = p_member and tenant_id = p_tenant and effective_from<=now() and (effective_to is null or effective_to>now())) then
    raise exception 'cp_grant_authority: member is not active in tenant';
  end if;
  if not exists (select 1 from authority_permissions where permission = p_permission) then
    raise exception 'cp_grant_authority: unknown permission';
  end if;
  if coalesce(p_scope,'self') not in ('self','team','company')
     or (coalesce(p_scope,'self')<>'team' and nullif(p_scope_ref,'') is not null) then
    raise exception 'Invalid authority scope';
  end if;
  if p_scope='team' and not exists(select 1 from org_units where id::text=p_scope_ref and tenant_id=p_tenant) then
    raise exception 'Team authority requires a canonical tenant team';
  end if;
  -- The unique key spans ended rows too, so an identical prior grant is reactivated
  -- in place (its history remains in the change log), never duplicated.
  select * into v_row from authority_grants
   where tenant_id = p_tenant and member_id = p_member and permission = p_permission
     and scope = coalesce(p_scope, 'self') and coalesce(scope_ref, '') = coalesce(p_scope_ref, '');
  if found then
    v_id := v_row.id; v_before := to_jsonb(v_row);
    update authority_grants
       set effective_to = null,
           effective_from = case when v_row.effective_to is not null then now() else effective_from end,
           confirmed = case when v_row.effective_to is not null then coalesce(p_confirmed,false) else coalesce(p_confirmed,confirmed) end
     where id = v_id;
  else
    insert into authority_grants
      (tenant_id, member_id, permission, scope, scope_ref, confirmed, source)
    values (p_tenant, p_member, p_permission, coalesce(p_scope, 'self'), p_scope_ref,
       coalesce(p_confirmed, false), 'openfolk')
    returning id into v_id;
  end if;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.authority_grant', 'authority_grant', v_id::text,
     v_before, (select to_jsonb(g) from authority_grants g where g.id = v_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return v_id;
end $$;

create function public.cp_end_authority(
  p_tenant uuid, p_grant_id uuid,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_old authority_grants;
begin
  perform learn_roster_write_guard(p_tenant,p_actor,p_reason,p_view_as);
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_end_authority: actor is required';
  end if;
  select * into v_old from authority_grants
   where id = p_grant_id and tenant_id = p_tenant for update;
  if not found then raise exception 'cp_end_authority: grant not found in tenant'; end if;
  if v_old.effective_to is not null then
    raise exception 'cp_end_authority: grant is already ended';
  end if;
  update authority_grants set effective_to = now() where id = p_grant_id;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.authority_end', 'authority_grant',
     p_grant_id::text, to_jsonb(v_old),
     (select to_jsonb(g) from authority_grants g where g.id = p_grant_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return p_grant_id;
end $$;


revoke all on function public.cp_roster_upsert_member(uuid,uuid,text,uuid,text,text,text,text,timestamptz,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.cp_roster_upsert_member(uuid,uuid,text,uuid,text,text,text,text,timestamptz,text,text,text,boolean) to service_role;
revoke all on function public.cp_member_lifecycle(uuid,uuid,text,timestamptz,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.cp_member_lifecycle(uuid,uuid,text,timestamptz,text,text,text,boolean) to service_role;
revoke all on function public.cp_upsert_responsibility(uuid,uuid,uuid,text,text,text,text,boolean,int,uuid,boolean,timestamptz,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.cp_upsert_responsibility(uuid,uuid,uuid,text,text,text,text,boolean,int,uuid,boolean,timestamptz,text,text,text,boolean) to service_role;
revoke all on function public.cp_end_responsibility(uuid,uuid,timestamptz,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.cp_end_responsibility(uuid,uuid,timestamptz,text,text,text,boolean) to service_role;
revoke all on function public.cp_grant_authority(uuid,uuid,text,text,text,boolean,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.cp_grant_authority(uuid,uuid,text,text,text,boolean,text,text,text,boolean) to service_role;
revoke all on function public.cp_end_authority(uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.cp_end_authority(uuid,uuid,text,text,text,boolean) to service_role;
insert into of_learn_deploy.migrations values('learn_roster_support_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
