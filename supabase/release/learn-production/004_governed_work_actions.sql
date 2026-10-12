-- DRAFT production governed work. Existing registry rows, policies and grants retained.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations,public.object_classes,public.domain_object_types,public.state_definitions,public.state_transitions,public.authority_permissions in share row exclusive mode;
do $$ declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
  or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production action target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_measurements_work_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='d3a2abaccbb2542f3ec8cf92d9b48b7fd3eed9d0505d050b04828304b4fc6b27') then raise exception 'Pinned production work prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_governed_work_actions_v1')
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_work_cover_day','learn_work_authority','work_transition_apply','learn_work_authority_input_lock','learn_work_registry_input_lock'])) then
  raise exception 'Production action candidate already exists; inspect before retry';end if;
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
) as inventory) q,
  lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['authority_grants','authority_permissions','domain_object_types','intelligence_objects','object_classes','object_state_history','objective_links','objectives','org_units','profiles','responsibility_assignments','state_definitions','state_transitions','team_members','tenants','view_as_context']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"authority_grants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"member_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"permission","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"scope","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"d679a3ceab4be7171bc3625c14f15138"},{"name":"scope_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc1aa1465ec03c693f1c71ed37ae624c"},{"name":"confirmed","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"1ec4dcbc8a2de2a92bb377baa527ecca","name":"authority_grants_pkey","valid":true},{"hash":"728031138b677deba916ee6ec3cadad5","name":"authority_grants_uk","valid":true}],"forceRls":false,"policies":[{"name":"authority_grants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"c4ff8b55b497abfc2828f30ea5376ddb","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"72259ce48876664267c3bd95d8882c9d","kind":"f","name":"authority_grants_member_id_fkey","validated":true},{"hash":"6955543725589d3d6e35aa41f8b28493","kind":"f","name":"authority_grants_permission_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"authority_grants_pkey","validated":true},{"hash":"70490051b4b27184b3abc86a15e80fef","kind":"c","name":"authority_grants_scope_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"authority_grants_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"authority_permissions","owner":"postgres","columns":[{"name":"permission","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"category","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"99377c3e568e76469e14a0d3d2f9eeaa","name":"authority_permissions_pkey","valid":true}],"forceRls":false,"policies":[{"name":"authority_permissions_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"6dd7316dfb8327cd8cc395b10b596265","kind":"p","name":"authority_permissions_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"domain_object_types","owner":"postgres","columns":[{"name":"domain","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"object_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"attributes_schema","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"object_class","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"caeab4150e3a8b57a49efc824db1d6ea","name":"domain_object_types_pkey","valid":true}],"forceRls":false,"policies":[{"name":"dot_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"ed84e3da79e13c3d1c93e3269f8cacfc","kind":"f","name":"domain_object_types_object_class_fk","validated":true},{"hash":"779b7212460e8fa0f077f8a1d7d93db0","kind":"p","name":"domain_object_types_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"intelligence_objects","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"object_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"responsible_ref","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"accountable_ref","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"waiting_on_ref","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"severity","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"ambiguity","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"risk","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"reversibility","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"domain_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"deadline","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"blocking","type":"uuid[]","notNull":true,"identity":"","generated":"","defaultHash":"30c8ce2479a7d03ad0036cb8f8bf8a8d"},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source_interactions","type":"uuid[]","notNull":true,"identity":"","generated":"","defaultHash":"30c8ce2479a7d03ad0036cb8f8bf8a8d"},{"name":"source_entities","type":"uuid[]","notNull":true,"identity":"","generated":"","defaultHash":"30c8ce2479a7d03ad0036cb8f8bf8a8d"},{"name":"created_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_from","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"policy_applied","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"decision_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"attributes","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"object_class","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"learning_applied","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"3befa4b26c5c69251cd117dab3179f90","name":"intelligence_objects_pkey","valid":true},{"hash":"6e8ab043def32a70b5801a13b5d9012b","name":"io_class","valid":true},{"hash":"7f510d307522cb4ba9dcc3067e0e6ae6","name":"io_deadline","valid":true},{"hash":"f9c6d8dc6e7d4b8eb817dd2ee9554f48","name":"io_entities","valid":true},{"hash":"f37314084809a4c722370a02628a6ab8","name":"io_lookup","valid":true},{"hash":"01926df76cee0788c0707cc60f190e1a","name":"io_srcint","valid":true}],"forceRls":false,"policies":[{"name":"io_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"0422320a2ff1673051b765915492b803","name":"io_set_updated_at","enabled":"O"},{"hash":"a9eb61d2185ce33a3bcfd4bc13f4f580","name":"learn_capture_work_change","enabled":"O"},{"hash":"0da8636a666b72d1b553580f160c4e8b","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"0eca77799b17696a29a8341e552b3aa2","kind":"c","name":"intelligence_objects_ambiguity_check","validated":true},{"hash":"fe05d9f5fdc7c955f732c72e312b120c","kind":"c","name":"intelligence_objects_confidence_check","validated":true},{"hash":"ed84e3da79e13c3d1c93e3269f8cacfc","kind":"f","name":"intelligence_objects_object_class_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"intelligence_objects_pkey","validated":true},{"hash":"0fdcd936867b15707fee1110621a0167","kind":"c","name":"intelligence_objects_reversibility_check","validated":true},{"hash":"05f42cecf82696b448e25f6a522a52d2","kind":"c","name":"intelligence_objects_risk_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"intelligence_objects_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"object_classes","owner":"postgres","columns":[{"name":"class","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"7d7da070dff405cadb2216675c8976ea","name":"object_classes_pkey","valid":true}],"forceRls":false,"policies":[{"name":"object_classes_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"4ae183000a8c113d6f2662477a85de8e","kind":"p","name":"object_classes_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"object_state_history","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"object_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"from_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"decision_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"work_before","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"work_after","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"transition_verb","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"capture_kind","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"capture_sequence","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"e4dd772f39843ea4840616e4b4369651","name":"object_state_history_pkey","valid":true},{"hash":"02081c539f0f477bb6aba6bb6ab18f0b","name":"osh_capture_read","valid":true},{"hash":"eb68666fc8eaeb9a9dac4090c8a9e5ba","name":"osh_capture_sequence","valid":true},{"hash":"98e163f583b8ae11499933a37ef28af4","name":"osh_object","valid":true},{"hash":"0a48bbf1a5dca8b9863d7a0ad1e9a75e","name":"osh_work_snapshot_lookup","valid":true}],"forceRls":false,"policies":[{"name":"osh_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"df778357df349262fc1f60ebd435c3a1","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"ff84cf30e416b9d536144481f4cf6495","name":"learn_work_history_immutable","enabled":"O"},{"hash":"243abad39de7ae27d411efe295d5439a","name":"learn_work_history_no_truncate","enabled":"O"}],"constraints":[{"hash":"efecd18ba36d7d20042cee469dff8f6a","kind":"c","name":"object_state_history_capture_kind_check","validated":true},{"hash":"506e57bbdbee163754b18e2781fe4b79","kind":"f","name":"object_state_history_object_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"object_state_history_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"object_state_history_tenant_id_fkey","validated":true},{"hash":"dcd5986e4cfd07a7b9a58a669ac1e700","kind":"c","name":"osh_capture_shape","validated":true},{"hash":"ffc7c3acdb4530bc3309cbd96c795d18","kind":"c","name":"osh_work_snapshot_pair","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_links","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"objective_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"target_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"target_ref","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"relation","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"expected_contribution","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"actual_contribution","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"contribution_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"rationale","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"created_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"approved","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"version_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"verification_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":"c52f9c62eaaccb25ee4a31f5d7985d5f"}],"indexes":[{"hash":"f2400abaa6ab6d7c28e4e74dfd9eef54","name":"objective_links_obj","valid":true},{"hash":"f6fbfa660665293eaa88f356550bcf7c","name":"objective_links_pkey","valid":true},{"hash":"d082c40c0375523bf7532c362a2de652","name":"objective_links_target","valid":true},{"hash":"1db70d4cceb1c5df36e93d7609860891","name":"objective_links_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"objective_links_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"0b218c3835ede77ed43b4a08e1ff94ab","name":"learn_measurement_reference_guard","enabled":"O"},{"hash":"de06df778b78e5d6538b4b60d6ed56c8","name":"objective_links_marketing_campaign_guard","enabled":"O"}],"constraints":[{"hash":"a9a2bc8bff2b0137ecd1ba7f05eef79c","kind":"f","name":"objective_links_contribution_state_fkey","validated":true},{"hash":"ffb444408a3a750f5e66b3adead548c4","kind":"f","name":"objective_links_objective_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"objective_links_pkey","validated":true},{"hash":"a9f3ffdf487f2e067f22761f303929ee","kind":"f","name":"objective_links_relation_fkey","validated":true},{"hash":"96fbc61977c4a331289e263b8ed1112e","kind":"c","name":"objective_links_target_kind_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"objective_links_tenant_id_fkey","validated":true},{"hash":"8500371a582f5a6df1c127938631b080","kind":"f","name":"objective_links_verification_state_fkey","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"objective_links_version_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objectives","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"objective_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"parent_objective_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c248d674101d8b24c97279095c3a6dde"},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"weight","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"starts_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"target_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"review_cadence","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"f6a437c55f28f335bfc36cfa2f313fca"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"stale_after_hours","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"owner","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"accountable_owner","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"domain_pack_keys","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"capability_keys","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"version_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"supersedes","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"created_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"published_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"published_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"8525f677e0ce1d145d41400656d1e461","name":"objectives_parent","valid":true},{"hash":"427b5951aabf5fd0d0c6915af1c2fea7","name":"objectives_pkey","valid":true},{"hash":"1bcda2ec3b4ca44e7a751891eea2d1a2","name":"objectives_tenant","valid":true},{"hash":"5cb2c97442ace0a9cf5e9403cfcd4e4c","name":"objectives_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"objectives_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"027ab10846ce4e2ff461747aab4d0e3e","name":"learn_measurement_reference_guard","enabled":"O"},{"hash":"d889c94d975ce58c1d6a2e79a3274b6d","name":"objectives_no_parent_cycle","enabled":"O"},{"hash":"168af831151ef06ab5ce5854001b75a5","name":"objectives_strategic_guard","enabled":"O"}],"constraints":[{"hash":"2ac28c636623d917a42aa9c4c4ea9837","kind":"f","name":"objectives_objective_type_fkey","validated":true},{"hash":"3ddc4ebfd5abbd43fac77b136f013db7","kind":"f","name":"objectives_parent_objective_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"objectives_pkey","validated":true},{"hash":"3f75217bea7569d65493b87154fc98c1","kind":"f","name":"objectives_status_fkey","validated":true},{"hash":"35eafd1d37a4b65b95daca9bace07a82","kind":"f","name":"objectives_supersedes_fkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"objectives_tenant_id_fkey","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"objectives_version_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"org_units","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"parent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"977befb3251c01656fc9bf6c7d98e947","name":"org_units_id_tenant_uk","valid":true},{"hash":"89c7906b33ff47cfa0c22c491aa601bd","name":"org_units_pkey","valid":true},{"hash":"9ad08482ebb4aec4838a12c279cb7567","name":"org_units_tenant","valid":true}],"forceRls":false,"policies":[{"name":"org_units_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"05a71fc442922c364f5b8b415e6c80ec","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"d5cfd4d30554ccb75b30b8ef9a34e9d4","name":"org_units_set_updated_at","enabled":"O"}],"constraints":[{"hash":"d5fcca4b41cda0d74e531fcdd52cfa71","kind":"f","name":"org_units_parent_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"org_units_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"org_units_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"full_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ebe5151db32cb9795191097a4f9511a9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b7142bbffc23de763c1bd9f00489ec05","name":"profiles_pkey","valid":true},{"hash":"c07a523f1ebc968ab6b32bd5c984f32b","name":"profiles_role_idx","valid":true},{"hash":"610436088a5788625dd6956b9059f8c9","name":"profiles_tenant_id_idx","valid":true},{"hash":"84b975915f84814cf35c7604d4f94ecf","name":"profiles_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_profile","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"profiles_select_own","roles":["public"],"command":"SELECT","checkHash":null,"usingHash":"bc9c729a84690340789a4e4f01175335","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8a97ecad600d272e906bb06dea0b91c4","name":"profiles_set_updated_at","enabled":"O"}],"constraints":[{"hash":"0061c9fb3a9abcf2edbcd4a42467a9c3","kind":"f","name":"profiles_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"profiles_pkey","validated":true},{"hash":"4b3bd90c7f38a26788aecebbe2479ad7","kind":"c","name":"profiles_role_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"responsibility_assignments","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"member_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"target_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"raci_role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"2ef3b270424c5036114ebb63785b3c8e"},{"name":"is_shared","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"weekday_mask","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cover_for","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc1aa1465ec03c693f1c71ed37ae624c"},{"name":"confirmed","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"6922306320908150f4429f75cc0b4d39","name":"resp_member","valid":true},{"hash":"53731852231c1d7a7e82209dcd2dfd45","name":"resp_target","valid":true},{"hash":"72a86912d62912db7c13ffd96f8d552a","name":"responsibility_assignments_pkey","valid":true}],"forceRls":false,"policies":[{"name":"resp_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"308731284205250c0816d60608d611b2","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"fe05d9f5fdc7c955f732c72e312b120c","kind":"c","name":"responsibility_assignments_confidence_check","validated":true},{"hash":"c726adb4cf42d5834fb07b874b42a9e9","kind":"f","name":"responsibility_assignments_cover_for_fkey","validated":true},{"hash":"05445f8bc4bb2e08013b64f3aae73414","kind":"c","name":"responsibility_assignments_kind_check","validated":true},{"hash":"72259ce48876664267c3bd95d8882c9d","kind":"f","name":"responsibility_assignments_member_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"responsibility_assignments_pkey","validated":true},{"hash":"58c31d351bfb1dba507257415ebb2857","kind":"c","name":"responsibility_assignments_raci_role_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"responsibility_assignments_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"state_definitions","owner":"postgres","columns":[{"name":"domain","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"object_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"maps_to_universal","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"is_terminal","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"}],"indexes":[{"hash":"02cf21076af93c99e54de571c14b6382","name":"state_definitions_pkey","valid":true}],"forceRls":false,"policies":[{"name":"sd_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"32c050ff5412a8299c54e33e0f4f9b41","kind":"p","name":"state_definitions_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"state_transitions","owner":"postgres","columns":[{"name":"domain","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"object_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"from_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"to_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"guard","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"de654af41eb718411704abd8e494d5f9","name":"state_transitions_pkey","valid":true}],"forceRls":false,"policies":[{"name":"st_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"990fd557fc967649940ca9dc94007cd0","kind":"p","name":"state_transitions_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"team_members","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"profile_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"org_unit_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"formal_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"observed_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"observed_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c52f9c62eaaccb25ee4a31f5d7985d5f"},{"name":"authority_level","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"af8c0c74e3183c2818bc9d953905fd3b"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc1aa1465ec03c693f1c71ed37ae624c"},{"name":"confirmed_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confirmed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"702f51d0616b95af6acceac770041d90","name":"team_members_id_tenant_uk","valid":true},{"hash":"3050f5b55154f2c1f333d5ac4620ed9f","name":"team_members_pkey","valid":true},{"hash":"4c7c3c5008c60803c6e0cdc1c63d4724","name":"team_members_profile","valid":true},{"hash":"d1291cf097138ed6a8e370ba09879e2c","name":"team_members_tenant","valid":true}],"forceRls":false,"policies":[{"name":"team_members_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"20470c2fa4bfa1cfd511bff609c9327a","name":"learn_capture_member_change","enabled":"O"},{"hash":"1f88777e8f895faa6f75f677f577a205","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"81116ed1f8bd3359a358eb8c192755eb","name":"learn_member_no_delete","enabled":"O"},{"hash":"4903df4fb40be1ac178cfdf9148826be","name":"learn_member_no_truncate","enabled":"O"},{"hash":"b419d5db1c118ff5d4e1f4a175ef311a","name":"team_members_set_updated_at","enabled":"O"}],"constraints":[{"hash":"ff1dd41640b0c5def6891c12630f5f29","kind":"c","name":"team_members_authority_level_check","validated":true},{"hash":"fe05d9f5fdc7c955f732c72e312b120c","kind":"c","name":"team_members_confidence_check","validated":true},{"hash":"0b3438f4f2c60569832a789b448f8a4d","kind":"c","name":"team_members_observed_status_check","validated":true},{"hash":"c773fa58011794721f1db6b5021ef422","kind":"f","name":"team_members_org_unit_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"team_members_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"team_members_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"slug","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"industry","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5284b9c618f8618b72a402ea2c593753","name":"tenants_pkey","valid":true},{"hash":"6260c986ce2d58a0ad3de3f74ec6eb6f","name":"tenants_slug_key","valid":true}],"forceRls":false,"policies":[{"name":"tenants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"831f798d620de1d73971187d41079b4d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8a4d62ca55c88b97023eab7696e527ce","name":"tenants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenants_pkey","validated":true},{"hash":"687397275d0e852fb2a4b50394adffee","kind":"u","name":"tenants_slug_key","validated":true},{"hash":"7702cc7b97df1ebce81e13bb05db5c2d","kind":"c","name":"tenants_status_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"view_as_context","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor_user_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"mode","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d3f83345a22c6bbd79692e353599f18"},{"name":"read_only","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"expires_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"dae782846028bc8168db98a8dd4b9193"},{"name":"ended_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5325064a8cf3f1e500b2308ea36b3343","name":"view_as_actor","valid":true},{"hash":"3b4560fae7e0f79297469f029ab77627","name":"view_as_context_pkey","valid":true}],"forceRls":false,"policies":[{"name":"view_as_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"565594dabafccb3adbde49e7a3f8790a","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"db8d41fae95b78d4a530a37cc023f719","kind":"c","name":"view_as_context_mode_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"view_as_context_pkey","validated":true},{"hash":"9579aceb86350661ce8f9dd1b4211a9b","kind":"c","name":"view_as_context_subject_kind_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"view_as_context_tenant_id_fkey","validated":true}]}]'::jsonb then raise exception 'Production action baseline catalog differs';end if;
 -- Validate only the known Action vocabulary. Other domains, guards and permissions remain untouched.
 if not exists(select 1 from object_classes where class='action')
  or (select count(*) from domain_object_types where domain in ('serviceos','productos') and object_type='Action' and object_class='action')<>2
  or not exists(select 1 from authority_permissions where permission='tenant.superadmin')
  or exists(select 1 from (values ('proposed','ready',false),('ready','ready',false),('in_progress','monitoring',false),('waiting','waiting',false),('blocked','blocked',false),('escalated','escalated',false),('complete','complete',true),('cancelled','cancelled',true)) s(state,maps_to_universal,is_terminal)
   cross join (values ('serviceos'),('productos')) d(domain) where not exists(select 1 from state_definitions x where x.domain=d.domain and x.object_type='Action' and x.state=s.state and x.maps_to_universal=s.maps_to_universal and x.is_terminal=s.is_terminal))
  or exists(select 1 from (values ('proposed','ready'),('ready','in_progress'),('in_progress','waiting'),('waiting','in_progress'),('in_progress','blocked'),('blocked','escalated'),('in_progress','complete'),('ready','cancelled'),('proposed','cancelled'),('in_progress','cancelled'),('waiting','cancelled'),('blocked','cancelled'),('escalated','cancelled'),('blocked','in_progress'),('escalated','in_progress')) e(from_state,to_state)
   cross join (values ('serviceos'),('productos')) d(domain) where not exists(select 1 from state_transitions x where x.domain=d.domain and x.object_type='Action' and x.from_state=e.from_state and x.to_state=e.to_state and x.guard is null)) then
   raise exception 'Existing Action vocabulary requires review; no registry rows changed';end if;
end $$;
-- SOURCE 20261029210000_learn_work_scoped_authority.sql
-- Original SHA-256 903f04817334ecbd88736ebba939e11aa7dc4d4e60561c77bec380829fd8290f
-- Cover semantics recovered from 20260916120000 jcc_cover_active and
-- 20260918120000 cp_active_cover_for in serviceos-dh. No tenant rows are changed.
create function public.learn_work_cover_day(p_mask int,p_timezone text,p_at timestamptz)
returns boolean language plpgsql stable set search_path=public as $$
declare day_number int;
begin
  if p_mask is null or p_mask=127 then return true; end if;
  if p_mask not between 0 and 127 or p_timezone is null or p_at is null or not isfinite(p_at) then return false; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then return false; end if;
  day_number:=extract(isodow from p_at at time zone p_timezone)::int;
  return ((p_mask >> (day_number-1)) & 1)=1;
end $$;

create function public.learn_work_authority(p_tenant uuid,p_object uuid,p_actor uuid,p_target_member uuid default null,p_claim boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  o intelligence_objects%rowtype; actor_profile profiles%rowtype;
  actor_member uuid; matches uuid[]; owners uuid[]:='{}'; teams uuid[]:='{}';
  reference jsonb; owner_member uuid; owner_team uuid; target_team uuid;
  at_time timestamptz; tz text; owner_count int:=0; unresolved boolean:=false;
  direct_owner boolean:=false; via_cover boolean:=false; grant_row authority_grants%rowtype;
  permissions text[]:='{}'; used_grants uuid[]:='{}'; used_cover uuid[]:='{}';
begin
  perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
  at_time:=clock_timestamp();
  select * into actor_profile from profiles where id=p_actor and tenant_id=p_tenant for share;
  if not found or coalesce(actor_profile.role,'') not in ('owner','admin','ops','viewer') then
    raise exception 'Authorized tenant profile required' using errcode='42501';
  end if;
  if exists(select 1 from view_as_context where actor_user_id=p_actor and ended_at is null
      and (expires_at is null or expires_at>at_time)) then
    raise exception 'Exit View-As before changing work' using errcode='42501';
  end if;
  select * into o from intelligence_objects where id=p_object and tenant_id=p_tenant;
  if not found then raise exception 'Tenant work item required' using errcode='P0002'; end if;
  select array_agg(id) into matches from team_members where tenant_id=p_tenant and profile_id=p_actor
    and confirmed_at is not null and effective_from<=at_time and (effective_to is null or effective_to>at_time);
  if cardinality(matches)>1 then raise exception 'Ambiguous active member identity' using errcode='42501'; end if;
  actor_member:=matches[1];
  if actor_profile.role='viewer' and actor_member is null then
    raise exception 'Confirmed staff membership required for work self-service' using errcode='42501';
  end if;
  -- RACI owners only. A waiting-on reference is not authority to move this work.
  for reference in select value from jsonb_array_elements(jsonb_build_array(o.responsible_ref,o.accountable_ref)) loop
    if reference='null'::jsonb then continue; end if;
    owner_count:=owner_count+1; owner_member:=null; owner_team:=null;
    if reference->>'kind'='user' and (reference->>'ref'=p_actor::text
       or (length(actor_profile.email)>0 and reference->>'ref'=actor_profile.email)) then direct_owner:=true; end if;
    if reference->>'kind'='member' then
      select id,org_unit_id into owner_member,owner_team from team_members
        where tenant_id=p_tenant and id::text=reference->>'ref' and confirmed_at is not null
          and effective_from<=at_time and (effective_to is null or effective_to>at_time);
      if owner_member=actor_member then direct_owner:=true; end if;
    elsif reference->>'kind'='user' then
      -- Legacy email references remain usable by their direct owner, but cannot
      -- establish another person's team or cover authority by name/email matching.
      select array_agg(id) into matches from team_members where tenant_id=p_tenant
        and profile_id::text=reference->>'ref' and confirmed_at is not null
        and exists(select 1 from profiles where id=team_members.profile_id and tenant_id=p_tenant)
        and effective_from<=at_time and (effective_to is null or effective_to>at_time);
      if cardinality(matches)=1 then
        owner_member:=matches[1]; select org_unit_id into owner_team from team_members where id=owner_member;
      end if;
    elsif reference->>'kind' in ('team','org_unit') then
      select id into owner_team from org_units where tenant_id=p_tenant and id::text=reference->>'ref';
    end if;
    if owner_member is not null then owners:=array_append(owners,owner_member); end if;
    if owner_team is null or not exists(select 1 from org_units where id=owner_team and tenant_id=p_tenant) then
      unresolved:=true;
    else teams:=array_append(teams,owner_team); end if;
  end loop;
  if p_claim then p_target_member:=actor_member; end if;
  if p_target_member is not null then
    select org_unit_id into target_team from team_members where id=p_target_member and tenant_id=p_tenant
      and confirmed_at is not null and effective_from<=at_time and (effective_to is null or effective_to>at_time);
    if not found then raise exception 'Active confirmed tenant assignment target required' using errcode='22023'; end if;
  end if;
  select nullif(btrim(metadata->>'timezone'),'') into tz from tenants where id=p_tenant;
  if not direct_owner and actor_member is not null then
    select array_agg(id) into used_cover from responsibility_assignments where tenant_id=p_tenant
      and member_id=actor_member and kind='cover' and cover_for=any(owners) and confirmed
      and raci_role in ('responsible','accountable') and effective_from<=at_time
      and (effective_to is null or effective_to>at_time)
      and learn_work_cover_day(weekday_mask,tz,at_time);
    via_cover:=coalesce(cardinality(used_cover)>0,false);
  end if;
  if actor_member is not null then
    for grant_row in select * from authority_grants where tenant_id=p_tenant and member_id=actor_member
      and confirmed and effective_from<=at_time and (effective_to is null or effective_to>at_time)
      and permission in ('work.assign','work.approve','ownership.confirm','tenant.superadmin') for share loop
      if (grant_row.scope='company' and nullif(grant_row.scope_ref,'') is null)
        or (grant_row.permission<>'tenant.superadmin' and grant_row.scope='self' and direct_owner
          and nullif(grant_row.scope_ref,'') is null and (p_target_member is null or p_target_member=actor_member))
        or (grant_row.permission<>'tenant.superadmin' and grant_row.scope='team' and owner_count>0
          and not unresolved and cardinality(teams)=owner_count
          and not exists(select 1 from unnest(teams) t where t::text<>grant_row.scope_ref)
          and grant_row.scope_ref is not null
          and (p_target_member is null or target_team::text=grant_row.scope_ref)) then
        permissions:=array_append(permissions,grant_row.permission);
        used_grants:=array_append(used_grants,grant_row.id);
      end if;
    end loop;
  end if;
  return jsonb_build_object('contract','work-authority@1','tenantId',p_tenant,'objectId',p_object,'actorId',p_actor,
    'objectVersion',o.version,'memberId',actor_member,'directOwner',direct_owner,'viaCover',via_cover,
    'isAssignee',direct_owner or via_cover,'isSuperadmin','tenant.superadmin'=any(permissions),
    'canAssign','work.assign'=any(permissions),'canApprove','work.approve'=any(permissions),
    'canConfirmOwnership','ownership.confirm'=any(permissions),'canClaimUnassigned',actor_member is not null,
    'canAcceptAssigned',direct_owner or 'work.assign'=any(permissions) or 'tenant.superadmin'=any(permissions),
    'grantIds',to_jsonb(used_grants),'coverIds',to_jsonb(coalesce(used_cover,'{}'::uuid[])));
end $$;
revoke all on function public.learn_work_cover_day(int,text,timestamptz),
  public.learn_work_authority(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_authority(uuid,uuid,uuid,uuid,boolean) to service_role;

-- Recheck authority under the work lock immediately before persistence.
create or replace function public.work_transition_apply(
  p_tenant uuid, p_object uuid, p_expected_version int,
  p_to_status text, p_patch jsonb, p_history jsonb, p_objective jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_obj intelligence_objects%rowtype;
  v_after intelligence_objects%rowtype;
  v_history uuid;
  v_actor uuid;
  v_verb text;
  v_ref jsonb;
  v_now timestamptz;
  v_authority jsonb; v_target uuid; v_allowed boolean;
begin
  if p_expected_version is null or p_expected_version < 1
     or p_patch is null or jsonb_typeof(p_patch)<>'object'
     or p_history is null or jsonb_typeof(p_history)<>'object'
     or p_to_status is null then
    raise exception 'Version, patch, history and target status required' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where k not in
    ('responsible_ref','accountable_ref','waiting_on_ref','attributes')) then
    raise exception 'Unsupported work patch' using errcode='22023';
  end if;
  v_actor := (p_history->'actor'->>'user_id')::uuid;
  v_verb := p_history->>'verb';
  if v_actor is null or not exists(select 1 from profiles where id=v_actor and tenant_id=p_tenant
      and role in ('owner','admin','ops','viewer')) then
    raise exception 'Work actor must be an authorized tenant profile' using errcode='42501';
  end if;
  if v_verb is null or v_verb not in ('acknowledge','start','wait','resume','block','unblock',
      'escalate','complete','dismiss','accept','assign','correct_owner','correct_objective') then
    raise exception 'Known work verb required' using errcode='22023';
  end if;
  if exists(select 1 from view_as_context where actor_user_id=v_actor and ended_at is null
      and (expires_at is null or expires_at>clock_timestamp())) then
    raise exception 'Exit View-As before changing work' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
  select * into v_obj from intelligence_objects where id=p_object and tenant_id=p_tenant for update;
  if not found then raise exception 'Work item not found in tenant' using errcode='P0002'; end if;
  if v_obj.version <> p_expected_version then
    raise exception 'Work version changed; refresh before retrying' using errcode='P0409';
  end if;
  v_target:=case v_verb when 'assign' then (p_patch#>>'{responsible_ref,ref}')::uuid
    when 'correct_owner' then (p_patch#>>'{accountable_ref,ref}')::uuid else null end;
  v_authority:=learn_work_authority(p_tenant,p_object,v_actor,v_target,v_verb='accept');
  v_allowed:=coalesce((v_authority->>'isSuperadmin')::boolean,false);
  if v_verb='assign' then v_allowed:=v_allowed or (v_authority->>'canAssign')::boolean;
  elsif v_verb in ('correct_owner','correct_objective') then
    v_allowed:=v_allowed or (v_authority->>'canConfirmOwnership')::boolean;
  elsif v_verb='accept' and coalesce(v_obj.responsible_ref->>'ref','')=''
      and coalesce(v_obj.accountable_ref->>'ref','')='' then
    v_allowed:=(v_authority->>'canClaimUnassigned')::boolean;
  elsif v_verb='accept' then v_allowed:=(v_authority->>'canAcceptAssigned')::boolean;
  else v_allowed:=v_allowed or (v_authority->>'isAssignee')::boolean or (v_authority->>'canAssign')::boolean;
  end if;
  if not coalesce(v_allowed,false) then raise exception 'Work authority changed or does not cover this item' using errcode='42501'; end if;
  if v_verb='accept' and (p_patch->'responsible_ref' is distinct from jsonb_build_object('kind','user','ref',v_actor::text)) then
    raise exception 'Accept may only claim for the authenticated actor' using errcode='22023';
  end if;
  if v_verb='complete' and length(btrim(coalesce(v_obj.attributes->>'done_when','')))=0
    and not (coalesce((p_history->>'approved_exception')::boolean,false)
      and ((v_authority->>'canApprove')::boolean or (v_authority->>'isSuperadmin')::boolean)) then
    raise exception 'Completion exception authority is not established' using errcode='42501';
  end if;
  -- Persist the database's final authority decision, never a stale client label.
  p_history:=jsonb_set(p_history,'{actor}',coalesce(p_history->'actor','{}'::jsonb)||jsonb_build_object(
    'user_id',v_actor,'member_id',v_authority->'memberId','superadmin',v_authority->'isSuperadmin',
    'acted_via',case when (v_authority->>'viaCover')::boolean then 'cover' else 'direct_or_grant' end,
    'authority_grant_ids',v_authority->'grantIds','cover_assignment_ids',v_authority->'coverIds'));
  if coalesce(v_obj.object_class,'') <> 'action' and not exists(
      select 1 from domain_object_types where domain=v_obj.domain
        and object_type=v_obj.object_type and object_class='action') then
    raise exception 'Only action work items may transition here' using errcode='22023';
  end if;
  if p_to_status<>v_obj.status and not exists(select 1 from state_transitions
      where domain=v_obj.domain and object_type=v_obj.object_type
        and from_state=v_obj.status and to_state=p_to_status) then
    raise exception 'Illegal work state transition' using errcode='22023';
  end if;
  -- Resolve new ownership targets in this tenant; never accept a foreign member
  -- or a name-only assignment. Existing legacy refs are retained in snapshots.
  for v_ref in select value from jsonb_each(p_patch)
      where key in ('responsible_ref','accountable_ref') loop
    if jsonb_typeof(v_ref)<>'object' then
      raise exception 'Ownership target must be a canonical reference' using errcode='22023';
    end if;
    if v_ref->>'kind'='member' then
      if not exists(select 1 from team_members where id=(v_ref->>'ref')::uuid and tenant_id=p_tenant
          and effective_from<=clock_timestamp() and (effective_to is null or effective_to>clock_timestamp())
          and confirmed_at is not null) then
        raise exception 'Ownership target must be an active confirmed tenant member' using errcode='22023';
      end if;
    elsif v_ref->>'kind'='user' then
      if not exists(select 1 from profiles where id=(v_ref->>'ref')::uuid and tenant_id=p_tenant) then
        raise exception 'Ownership user must belong to tenant' using errcode='22023';
      end if;
    else
      raise exception 'Unsupported ownership reference' using errcode='22023';
    end if;
  end loop;
  if p_patch ? 'attributes' and jsonb_typeof(p_patch->'attributes')<>'object' then
    raise exception 'Attributes must be an object' using errcode='22023';
  end if;
  if p_objective is not null and (jsonb_typeof(p_objective)<>'object' or not exists(
      select 1 from objectives where id=(p_objective->>'objective_id')::uuid and tenant_id=p_tenant)) then
    raise exception 'Objective must belong to tenant' using errcode='22023';
  end if;
  update intelligence_objects set
    status=p_to_status,
    responsible_ref=case when p_patch?'responsible_ref' then p_patch->'responsible_ref' else responsible_ref end,
    accountable_ref=case when p_patch?'accountable_ref' then p_patch->'accountable_ref' else accountable_ref end,
    waiting_on_ref=case when p_patch?'waiting_on_ref' then p_patch->'waiting_on_ref' else waiting_on_ref end,
    attributes=case when p_patch?'attributes' then p_patch->'attributes' else attributes end,
    version=version+1
    where id=p_object returning * into v_after;
  v_now := clock_timestamp();
  insert into object_state_history(tenant_id,object_id,from_state,to_state,actor,reason,
      occurred_at,transition_verb,work_before,work_after)
    values(p_tenant,p_object,v_obj.status,v_after.status,p_history->'actor',p_history->>'reason',v_now,v_verb,
      jsonb_build_object('status',v_obj.status,'version',v_obj.version,
        'responsible_ref',v_obj.responsible_ref,'accountable_ref',v_obj.accountable_ref,
        'waiting_on_ref',v_obj.waiting_on_ref,'attributes',v_obj.attributes),
      jsonb_build_object('status',v_after.status,'version',v_after.version,
        'responsible_ref',v_after.responsible_ref,'accountable_ref',v_after.accountable_ref,
        'waiting_on_ref',v_after.waiting_on_ref,'attributes',v_after.attributes))
    returning id into v_history;
  if p_objective is not null then
    insert into objective_links(tenant_id,objective_id,target_kind,target_ref,relation,rationale,created_by,approved)
      values(p_tenant,(p_objective->>'objective_id')::uuid,'intelligence_object',p_object::text,
        p_objective->>'relation',p_objective->>'rationale',v_actor::text,
        (v_authority->>'isSuperadmin')::boolean);
  end if;
  return jsonb_build_object('object_id',p_object,'version',v_after.version,
    'history_id',v_history,'status',v_after.status,'occurred_at',v_now);
end $$;
revoke all on function public.work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb) to service_role;

-- SOURCE 20261030070000_learn_work_action_validation.sql
-- Original SHA-256 b09ca1b9dc00d8b2b5f2db50d065b8d032de862c26e177cebad1f0b59b6d0514
-- Recheck verb, evidence and configured transition conditions at persistence.
-- No source rows, grants or historical captures are rewritten.
alter function public.learn_work_cover_day(int,text,timestamptz) set search_path=public,pg_temp;
alter function public.learn_work_authority(uuid,uuid,uuid,uuid,boolean) set search_path=public,pg_temp;

create or replace function public.work_transition_apply(
  p_tenant uuid, p_object uuid, p_expected_version int,
  p_to_status text, p_patch jsonb, p_history jsonb, p_objective jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_obj intelligence_objects%rowtype;
  v_after intelligence_objects%rowtype;
  v_history uuid;
  v_actor uuid;
  v_verb text;
  v_ref jsonb;
  v_now timestamptz;
  v_authority jsonb; v_target uuid; v_allowed boolean;
begin
  if p_expected_version is null or p_expected_version < 1
     or p_patch is null or jsonb_typeof(p_patch)<>'object'
     or p_history is null or jsonb_typeof(p_history)<>'object'
     or p_to_status is null then
    raise exception 'Version, patch, history and target status required' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where k not in
    ('responsible_ref','accountable_ref','waiting_on_ref','attributes')) then
    raise exception 'Unsupported work patch' using errcode='22023';
  end if;
  v_actor := (p_history->'actor'->>'user_id')::uuid;
  v_verb := p_history->>'verb';
  if v_actor is null or not exists(select 1 from profiles where id=v_actor and tenant_id=p_tenant
      and role in ('owner','admin','ops','viewer')) then
    raise exception 'Work actor must be an authorized tenant profile' using errcode='42501';
  end if;
  if v_verb is null or v_verb not in ('acknowledge','start','wait','resume','block','unblock',
      'escalate','complete','dismiss','accept','assign','correct_owner','correct_objective') then
    raise exception 'Known work verb required' using errcode='22023';
  end if;
  if exists(select 1 from view_as_context where actor_user_id=v_actor and ended_at is null
      and (expires_at is null or expires_at>clock_timestamp())) then
    raise exception 'Exit View-As before changing work' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
  select * into v_obj from intelligence_objects where id=p_object and tenant_id=p_tenant for update;
  if not found then raise exception 'Work item not found in tenant' using errcode='P0002'; end if;
  if v_obj.version <> p_expected_version then
    raise exception 'Work version changed; refresh before retrying' using errcode='P0409';
  end if;
  v_target:=case v_verb when 'assign' then (p_patch#>>'{responsible_ref,ref}')::uuid
    when 'correct_owner' then (p_patch#>>'{accountable_ref,ref}')::uuid else null end;
  v_authority:=learn_work_authority(p_tenant,p_object,v_actor,v_target,v_verb='accept');
  v_allowed:=coalesce((v_authority->>'isSuperadmin')::boolean,false);
  if v_verb='assign' then v_allowed:=v_allowed or (v_authority->>'canAssign')::boolean;
  elsif v_verb in ('correct_owner','correct_objective') then
    v_allowed:=v_allowed or (v_authority->>'canConfirmOwnership')::boolean;
  elsif v_verb='accept' and coalesce(v_obj.responsible_ref->>'ref','')=''
      and coalesce(v_obj.accountable_ref->>'ref','')='' then
    v_allowed:=(v_authority->>'canClaimUnassigned')::boolean;
  elsif v_verb='accept' then v_allowed:=(v_authority->>'canAcceptAssigned')::boolean;
  else v_allowed:=v_allowed or (v_authority->>'isAssignee')::boolean or (v_authority->>'canAssign')::boolean;
  end if;
  if not coalesce(v_allowed,false) then raise exception 'Work authority changed or does not cover this item' using errcode='42501'; end if;
  if v_verb='accept' and (p_patch->'responsible_ref' is distinct from jsonb_build_object('kind','user','ref',v_actor::text)) then
    raise exception 'Accept may only claim for the authenticated actor' using errcode='22023';
  end if;
  if v_verb='complete' and length(btrim(coalesce(v_obj.attributes->>'done_when','')))=0
    and not (coalesce((p_history->>'approved_exception')::boolean,false)
      and ((v_authority->>'canApprove')::boolean or (v_authority->>'isSuperadmin')::boolean)) then
    raise exception 'Completion exception authority is not established' using errcode='42501';
  end if;
  -- Persist the database's final authority decision, never a stale client label.
  p_history:=jsonb_set(p_history,'{actor}',coalesce(p_history->'actor','{}'::jsonb)||jsonb_build_object(
    'user_id',v_actor,'member_id',v_authority->'memberId','superadmin',v_authority->'isSuperadmin',
    'acted_via',case when (v_authority->>'viaCover')::boolean then 'cover' else 'direct_or_grant' end,
    'authority_grant_ids',v_authority->'grantIds','cover_assignment_ids',v_authority->'coverIds'));
  if coalesce(v_obj.object_class,'') <> 'action' and not exists(
      select 1 from domain_object_types where domain=v_obj.domain
        and object_type=v_obj.object_type and object_class='action') then
    raise exception 'Only action work items may transition here' using errcode='22023';
  end if;
  if p_to_status<>v_obj.status and not exists(select 1 from state_transitions
      where domain=v_obj.domain and object_type=v_obj.object_type
        and from_state=v_obj.status and to_state=p_to_status and guard is null) then
    raise exception 'Illegal or unsupported guarded work state transition' using errcode='22023';
  end if;
  -- The service RPC repeats the endpoint's verb/effect boundary. An allowed
  -- state edge is not permission to disguise reassignment or missing evidence.
  if p_to_status is distinct from (case v_verb
      when 'acknowledge' then 'ready' when 'start' then 'in_progress'
      when 'wait' then 'waiting' when 'resume' then 'in_progress'
      when 'block' then 'blocked' when 'unblock' then 'in_progress'
      when 'escalate' then 'escalated' when 'complete' then 'complete'
      when 'dismiss' then 'cancelled'
      when 'accept' then case when v_obj.status='proposed' then 'ready' else v_obj.status end
      else v_obj.status end) then
    raise exception 'Work verb and target status disagree' using errcode='22023';
  end if;
  if v_verb in ('acknowledge','start','wait','resume','block','unblock','escalate','complete','dismiss')
      and p_to_status=v_obj.status then
    raise exception 'Work status already reached' using errcode='P0409';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where not (k=any(case v_verb
      when 'accept' then array['responsible_ref']
      when 'assign' then array['responsible_ref']
      when 'correct_owner' then array['accountable_ref','attributes']
      when 'wait' then array['waiting_on_ref']
      when 'block' then array['attributes']
      when 'complete' then array['attributes'] else array[]::text[] end))) then
    raise exception 'Patch does not match work verb' using errcode='22023';
  end if;
  if v_verb in ('assign','correct_owner') and
      (v_target is null or (case v_verb when 'assign' then p_patch->'responsible_ref'
          else p_patch->'accountable_ref' end)->>'kind' is distinct from 'member') then
    raise exception 'Assignment requires a canonical member target' using errcode='22023';
  end if;
  if v_verb in ('dismiss','correct_owner','correct_objective')
      and length(btrim(coalesce(p_history->>'reason','')))=0 then
    raise exception 'Work reason required' using errcode='22023';
  end if;
  if p_patch ? 'attributes' and
      (p_patch->'attributes') - (case v_verb when 'block' then 'blocker'
          when 'complete' then 'completion_evidence' else 'owner_corrections' end)
      is distinct from v_obj.attributes - (case v_verb when 'block' then 'blocker'
          when 'complete' then 'completion_evidence' else 'owner_corrections' end) then
    raise exception 'Unrelated work attributes must be preserved' using errcode='22023';
  end if;
  if (v_verb='wait' and (p_patch#>>'{waiting_on_ref,kind}' is distinct from 'note'
        or length(btrim(coalesce(p_patch#>>'{waiting_on_ref,ref}','')))=0))
      or (v_verb='block' and (coalesce(p_patch#>'{attributes,blocker}','null'::jsonb)='null'::jsonb
        or length(btrim(coalesce(p_patch#>>'{attributes,blocker}','')))=0))
      or (v_verb='complete' and length(btrim(coalesce(v_obj.attributes->>'done_when','')))>0
        and (coalesce(p_patch#>'{attributes,completion_evidence}','null'::jsonb)='null'::jsonb
          or length(btrim(coalesce(p_patch#>>'{attributes,completion_evidence}','')))=0)) then
    raise exception 'Work evidence required' using errcode='22023';
  end if;
  if (v_verb='correct_objective') is distinct from (p_objective is not null)
      or (p_objective is not null and (p_objective->>'relation' is distinct from 'contributes_to'
        or length(btrim(coalesce(p_objective->>'rationale','')))=0)) then
    raise exception 'Objective correction requires its own explicit relation and reason' using errcode='22023';
  end if;
  -- Resolve new ownership targets in this tenant; never accept a foreign member
  -- or a name-only assignment. Existing legacy refs are retained in snapshots.
  for v_ref in select value from jsonb_each(p_patch)
      where key in ('responsible_ref','accountable_ref') loop
    if jsonb_typeof(v_ref)<>'object' then
      raise exception 'Ownership target must be a canonical reference' using errcode='22023';
    end if;
    if v_ref->>'kind'='member' then
      if not exists(select 1 from team_members where id=(v_ref->>'ref')::uuid and tenant_id=p_tenant
          and effective_from<=clock_timestamp() and (effective_to is null or effective_to>clock_timestamp())
          and confirmed_at is not null) then
        raise exception 'Ownership target must be an active confirmed tenant member' using errcode='22023';
      end if;
    elsif v_ref->>'kind'='user' then
      if not exists(select 1 from profiles where id=(v_ref->>'ref')::uuid and tenant_id=p_tenant) then
        raise exception 'Ownership user must belong to tenant' using errcode='22023';
      end if;
    else
      raise exception 'Unsupported ownership reference' using errcode='22023';
    end if;
  end loop;
  if p_patch ? 'attributes' and jsonb_typeof(p_patch->'attributes')<>'object' then
    raise exception 'Attributes must be an object' using errcode='22023';
  end if;
  if p_objective is not null and (jsonb_typeof(p_objective)<>'object' or not exists(
      select 1 from objectives where id=(p_objective->>'objective_id')::uuid and tenant_id=p_tenant)) then
    raise exception 'Objective must belong to tenant' using errcode='22023';
  end if;
  update intelligence_objects set
    status=p_to_status,
    responsible_ref=case when p_patch?'responsible_ref' then p_patch->'responsible_ref' else responsible_ref end,
    accountable_ref=case when p_patch?'accountable_ref' then p_patch->'accountable_ref' else accountable_ref end,
    waiting_on_ref=case when p_patch?'waiting_on_ref' then p_patch->'waiting_on_ref' else waiting_on_ref end,
    attributes=case when p_patch?'attributes' then p_patch->'attributes' else attributes end,
    version=version+1
    where id=p_object returning * into v_after;
  v_now := clock_timestamp();
  insert into object_state_history(tenant_id,object_id,from_state,to_state,actor,reason,
      occurred_at,transition_verb,work_before,work_after)
    values(p_tenant,p_object,v_obj.status,v_after.status,p_history->'actor',p_history->>'reason',v_now,v_verb,
      jsonb_build_object('status',v_obj.status,'version',v_obj.version,
        'responsible_ref',v_obj.responsible_ref,'accountable_ref',v_obj.accountable_ref,
        'waiting_on_ref',v_obj.waiting_on_ref,'attributes',v_obj.attributes),
      jsonb_build_object('status',v_after.status,'version',v_after.version,
        'responsible_ref',v_after.responsible_ref,'accountable_ref',v_after.accountable_ref,
        'waiting_on_ref',v_after.waiting_on_ref,'attributes',v_after.attributes))
    returning id into v_history;
  if p_objective is not null then
    insert into objective_links(tenant_id,objective_id,target_kind,target_ref,relation,rationale,created_by,approved)
      values(p_tenant,(p_objective->>'objective_id')::uuid,'intelligence_object',p_object::text,
        p_objective->>'relation',p_objective->>'rationale',v_actor::text,
        (v_authority->>'isSuperadmin')::boolean);
  end if;
  return jsonb_build_object('object_id',p_object,'version',v_after.version,
    'history_id',v_history,'status',v_after.status,'occurred_at',v_now);
end $$;
revoke all on function public.work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb) to service_role;

-- SOURCE 20261030080000_learn_work_authority_serialization.sql
-- Original SHA-256 d572c486a87818f319660177c633b2ed8f8af748bcb87e8dedc737814e3bf9f6
-- Every ordinary row mutation of an authority input participates in the same
-- tenant lock as work actions. Try-locks avoid row-lock/advisory-lock inversion:
-- a competing update is refused with a retryable HTTP conflict, never allowed
-- to commit an authority change halfway through a work action.
create function public.learn_work_authority_input_lock()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
 old_row jsonb;new_row jsonb;tenant_ids uuid[]:='{}';actor_id uuid;actor_tenant uuid;t uuid;
begin
 if tg_op<>'INSERT' then old_row:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then new_row:=to_jsonb(new); end if;
 if tg_table_name='tenants' then
  tenant_ids:=array[(old_row->>'id')::uuid,(new_row->>'id')::uuid];
 else
  tenant_ids:=array[(old_row->>'tenant_id')::uuid,(new_row->>'tenant_id')::uuid];
 end if;
 if tg_table_name='view_as_context' then
  -- Preview checks follow the real actor, even in legacy cross-tenant contexts.
  for actor_id in select distinct x from unnest(array[(old_row->>'actor_user_id')::uuid,(new_row->>'actor_user_id')::uuid]) x where x is not null loop
   select tenant_id into actor_tenant from profiles where id=actor_id;
   if not found and actor_id=(new_row->>'actor_user_id')::uuid
       and new_row->>'ended_at' is null
       and (new_row->>'expires_at' is null or (new_row->>'expires_at')::timestamptz>clock_timestamp()) then
    raise exception 'An active preview requires an existing actor profile' using errcode='22023';
   end if;
   tenant_ids:=array_append(tenant_ids,actor_tenant);
  end loop;
 end if;
 for t in select distinct x from unnest(tenant_ids) x where x is not null order by x loop
  if not pg_try_advisory_xact_lock(hashtextextended('learn-roster:'||t::text,0)) then
   raise exception 'Work or authority is changing; refresh and retry this change' using errcode='PT409';
  end if;
 end loop;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.learn_work_authority_input_lock() from public,anon,authenticated,service_role;

-- Configured classifications/edges are global vocabulary. Work holds a shared
-- lock; only mutation needs an exclusive lock. Different tenants can still act
-- concurrently. Registry edits never silently invalidate an in-flight action.
create function public.learn_work_registry_input_lock()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('learn-work-registry',0)) then
  raise exception 'Work is using this registry; retry the configuration change' using errcode='PT409';
 end if;
 return null;
end $$;
revoke all on function public.learn_work_registry_input_lock() from public,anon,authenticated,service_role;

do $$ declare n text;begin
 foreach n in array array['tenants','profiles','team_members','org_units','responsibility_assignments','authority_grants','view_as_context'] loop
  execute format('create trigger learn_work_authority_input_lock before insert or update or delete on public.%I for each row execute function public.learn_work_authority_input_lock()',n);
  -- A privileged truncate has no row triggers. Serialize it globally as well;
  -- existing retention guards and table privileges continue to apply.
  execute format('create trigger learn_work_authority_truncate_lock before truncate on public.%I for each statement execute function public.learn_work_registry_input_lock()',n);
 end loop;
 foreach n in array array['object_classes','domain_object_types','state_definitions','state_transitions','authority_permissions'] loop
  execute format('create trigger learn_work_registry_input_lock before insert or update or delete or truncate on public.%I for each statement execute function public.learn_work_registry_input_lock()',n);
 end loop;
end $$;

-- Keep the reviewed authority and evidence implementations, adding the mutex
-- before their tenant lock. READ COMMITTED gives each post-lock SQL statement
-- a fresh snapshot; a pre-existing repeatable-read snapshot is not sufficient.
do $$ declare signature text;definition text;needle text;
begin
 needle:='  perform pg_advisory_xact_lock(hashtextextended(''learn-roster:''||p_tenant::text,0));';
 foreach signature in array array['public.learn_work_authority(uuid,uuid,uuid,uuid,boolean)',
   'public.work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if length(definition)-length(replace(definition,needle,''))<>length(needle) then
   raise exception 'Reviewed authority locking contract changed';
  end if;
  definition:=replace(definition,needle,$patch$  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Work authority requires a fresh read-committed snapshot' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
$patch$||needle);
  execute definition;
 end loop;
end $$;


insert into of_learn_deploy.migrations values('learn_governed_work_actions_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
