-- DRAFT production measurements and forward work history. No hosted executor.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$ declare observed jsonb; actual_helpers jsonb; begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
  or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production measurement target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_foundation_rules_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='1ea226e5da475464b1b6ccccf3cc1e027b6a17417e99f582b81f10206459e1d4') then raise exception 'Pinned production rules prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_measurements_work_v1')
  or to_regclass('public.learn_performance_reviews') is not null or to_regclass('public.learn_work_measurement_runs') is not null
  or to_regclass('public.learn_work_capture_sequence') is not null
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_metric_scope_guard','learn_performance_append','learn_performance_review','learn_performance_insert_guard','learn_member_group_covers','learn_work_history_immutable','learn_work_snapshot','learn_capture_work_change','learn_work_capture_baseline','learn_work_history_read','learn_work_handoffs_collect','learn_handoff_owner','learn_work_residence_collect'])) then
  raise exception 'Production measurement candidate already exists; inspect before retry';end if;
 select jsonb_agg(jsonb_set(t,'{triggers}',coalesce((select jsonb_agg(g order by g->>'name') from jsonb_array_elements(t->'triggers') g
   where g->>'name'<>'learn_foundation_reference_guard'),'[]')) order by t->>'name') into observed
  from (-- Read-only release planning metadata. No source rows, credentials or SQL bodies.
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['contribution_states','intelligence_objects','measurements','metric_definitions','metric_directions','object_state_history','objective_constraints','objective_health','objective_health_statuses','objective_link_relations','objective_links','objective_metrics','objective_reason_codes','objective_statuses','objective_types','objective_verification_states','objectives']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"contribution_states","owner":"postgres","columns":[{"name":"state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5ab186a1a16de1f23cdd19df915ccf8f","name":"contribution_states_pkey","valid":true}],"forceRls":false,"policies":[{"name":"contribution_states_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"7281052ddfa4b123b2ff383858a4f3c3","kind":"p","name":"contribution_states_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"intelligence_objects","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"object_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"responsible_ref","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"accountable_ref","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"waiting_on_ref","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"severity","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"ambiguity","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"risk","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"reversibility","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"domain_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"deadline","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"blocking","type":"uuid[]","notNull":true,"identity":"","generated":"","defaultHash":"30c8ce2479a7d03ad0036cb8f8bf8a8d"},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source_interactions","type":"uuid[]","notNull":true,"identity":"","generated":"","defaultHash":"30c8ce2479a7d03ad0036cb8f8bf8a8d"},{"name":"source_entities","type":"uuid[]","notNull":true,"identity":"","generated":"","defaultHash":"30c8ce2479a7d03ad0036cb8f8bf8a8d"},{"name":"created_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_from","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"policy_applied","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"decision_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"attributes","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"object_class","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"learning_applied","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"3befa4b26c5c69251cd117dab3179f90","name":"intelligence_objects_pkey","valid":true},{"hash":"6e8ab043def32a70b5801a13b5d9012b","name":"io_class","valid":true},{"hash":"7f510d307522cb4ba9dcc3067e0e6ae6","name":"io_deadline","valid":true},{"hash":"f9c6d8dc6e7d4b8eb817dd2ee9554f48","name":"io_entities","valid":true},{"hash":"f37314084809a4c722370a02628a6ab8","name":"io_lookup","valid":true},{"hash":"01926df76cee0788c0707cc60f190e1a","name":"io_srcint","valid":true}],"forceRls":false,"policies":[{"name":"io_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"0422320a2ff1673051b765915492b803","name":"io_set_updated_at","enabled":"O"}],"constraints":[{"hash":"0eca77799b17696a29a8341e552b3aa2","kind":"c","name":"intelligence_objects_ambiguity_check","validated":true},{"hash":"fe05d9f5fdc7c955f732c72e312b120c","kind":"c","name":"intelligence_objects_confidence_check","validated":true},{"hash":"ed84e3da79e13c3d1c93e3269f8cacfc","kind":"f","name":"intelligence_objects_object_class_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"intelligence_objects_pkey","validated":true},{"hash":"0fdcd936867b15707fee1110621a0167","kind":"c","name":"intelligence_objects_reversibility_check","validated":true},{"hash":"05f42cecf82696b448e25f6a522a52d2","kind":"c","name":"intelligence_objects_risk_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"intelligence_objects_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"measurements","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"metric_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"value","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"unit","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"currency","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"window_start","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"window_end","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"measured_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"calculation_method","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"freshness","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"milestone_reached","type":"boolean","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"19f260de653ff2cd2d947fe48aea59ef","name":"measurements_pkey","valid":true},{"hash":"52f4ab40df343700f02d6bce523da631","name":"measurements_series","valid":true}],"forceRls":false,"policies":[{"name":"measurements_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"c3b15733f04f3be83febc5d0fc899b29","name":"measurements_no_delete","enabled":"O"},{"hash":"21b2ab9e4b71b511e65213a43cbbcf8e","name":"measurements_no_update","enabled":"O"}],"constraints":[{"hash":"d3fe51859e3d1856b9c17f4f1e41a3ab","kind":"f","name":"measurements_metric_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"measurements_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"measurements_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"metric_definitions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"unit","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"currency","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"calculation_method","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"update_cadence","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"owner","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"version_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"4ea85c002a5b0e0fee929029b23d3cca","name":"metric_definitions_pkey","valid":true},{"hash":"01c65625210ba556b0a49e4a5afa0648","name":"metric_definitions_tenant_id_key_key","valid":true}],"forceRls":false,"policies":[{"name":"metric_definitions_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"012e85940f86b6bf7f0140204ca9a5e6","name":"metric_definitions_guard","enabled":"O"}],"constraints":[{"hash":"253f87e577ce9351787745a86a41b936","kind":"f","name":"metric_definitions_direction_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"metric_definitions_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"metric_definitions_tenant_id_fkey","validated":true},{"hash":"b37e0ea493c33424fc5ffb8b2bbadf93","kind":"u","name":"metric_definitions_tenant_id_key_key","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"metric_definitions_version_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"metric_directions","owner":"postgres","columns":[{"name":"direction","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"7fad9864191ad232e96ad34390d20a9f","name":"metric_directions_pkey","valid":true}],"forceRls":false,"policies":[{"name":"metric_directions_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"d48d571ac2344f7ca24be33aab50b944","kind":"p","name":"metric_directions_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"object_state_history","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"object_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"from_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"decision_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"e4dd772f39843ea4840616e4b4369651","name":"object_state_history_pkey","valid":true},{"hash":"98e163f583b8ae11499933a37ef28af4","name":"osh_object","valid":true}],"forceRls":false,"policies":[{"name":"osh_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"506e57bbdbee163754b18e2781fe4b79","kind":"f","name":"object_state_history_object_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"object_state_history_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"object_state_history_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_constraints","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"objective_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"metric_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"threshold","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"unit","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"authority_required","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"version_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"3d59f1e086606f78337d63ff31130868","name":"objective_constraints_objective_id_key_key","valid":true},{"hash":"b0408dcee113af4bcb91ee628b91cb78","name":"objective_constraints_pkey","valid":true}],"forceRls":false,"policies":[{"name":"objective_constraints_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"580c561f7f578644add945c938852e82","name":"objective_constraints_guard","enabled":"O"}],"constraints":[{"hash":"253f87e577ce9351787745a86a41b936","kind":"f","name":"objective_constraints_direction_fkey","validated":true},{"hash":"b0efe632e910b6f9e118fc129dac0e9d","kind":"c","name":"objective_constraints_kind_check","validated":true},{"hash":"3b2b5a39a017e5d34a891589b456f3f6","kind":"f","name":"objective_constraints_metric_id_fkey","validated":true},{"hash":"ffb444408a3a750f5e66b3adead548c4","kind":"f","name":"objective_constraints_objective_id_fkey","validated":true},{"hash":"98b3ed268c9d26e68c06cb014d9c4c5a","kind":"u","name":"objective_constraints_objective_id_key_key","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"objective_constraints_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"objective_constraints_tenant_id_fkey","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"objective_constraints_version_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_health","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"objective_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"progress","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"reasons","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"blockers","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"stale_measurements","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"evaluated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"objective_version_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evaluator_version","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"input_hash","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"triggered_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"snapshot","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"correlation_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"supersedes","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"c3c2e9c22dc6e12fc24715b509375c0f","name":"objective_health_idem_uk","valid":true},{"hash":"c52aca2e2fe86e84f3e011a82bf23839","name":"objective_health_job","valid":true},{"hash":"dbde491299e8c1c5d0b89215f9d731b4","name":"objective_health_pkey","valid":true},{"hash":"23eea8b3a048311cab5a1fff2972b62a","name":"objective_health_series","valid":true},{"hash":"868a55e48ca4c3f68ced1161752ad589","name":"objective_health_supersedes","valid":true}],"forceRls":false,"policies":[{"name":"objective_health_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"f160425e0e07ed3bdd8ca65a69ff47e4","name":"objective_health_no_delete","enabled":"O"},{"hash":"148b7820dd12b37508ab739ead7951c5","name":"objective_health_no_update","enabled":"O"}],"constraints":[{"hash":"a0e09f51ece83d5963f6fe42b12c8ec7","kind":"f","name":"objective_health_job_id_fkey","validated":true},{"hash":"ffb444408a3a750f5e66b3adead548c4","kind":"f","name":"objective_health_objective_id_fkey","validated":true},{"hash":"3e8c920a44eeee937ef01ce1fd19a157","kind":"f","name":"objective_health_objective_version_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"objective_health_pkey","validated":true},{"hash":"9611c9c893c9a785b17ee2fa4d8d8192","kind":"f","name":"objective_health_status_fkey","validated":true},{"hash":"cb9445b093f48cc7ffc4371dfcca7835","kind":"f","name":"objective_health_supersedes_fkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"objective_health_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_health_statuses","owner":"postgres","columns":[{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"4327d963680ab2afe92b0741e0380c3d","name":"objective_health_statuses_pkey","valid":true}],"forceRls":false,"policies":[{"name":"objective_health_statuses_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"eba0238902590ea62eeaaca0860c3c8f","kind":"p","name":"objective_health_statuses_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_link_relations","owner":"postgres","columns":[{"name":"relation","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"7f622194eee3215d305633ea3ef3829d","name":"objective_link_relations_pkey","valid":true}],"forceRls":false,"policies":[{"name":"objective_link_relations_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"80b9b146f8f5edf947e770f0fcaeba2b","kind":"p","name":"objective_link_relations_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_links","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"objective_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"target_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"target_ref","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"relation","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"expected_contribution","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"actual_contribution","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"contribution_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"rationale","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"created_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"approved","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"version_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"verification_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":"c52f9c62eaaccb25ee4a31f5d7985d5f"}],"indexes":[{"hash":"f2400abaa6ab6d7c28e4e74dfd9eef54","name":"objective_links_obj","valid":true},{"hash":"f6fbfa660665293eaa88f356550bcf7c","name":"objective_links_pkey","valid":true},{"hash":"d082c40c0375523bf7532c362a2de652","name":"objective_links_target","valid":true},{"hash":"1db70d4cceb1c5df36e93d7609860891","name":"objective_links_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"objective_links_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"de06df778b78e5d6538b4b60d6ed56c8","name":"objective_links_marketing_campaign_guard","enabled":"O"}],"constraints":[{"hash":"a9a2bc8bff2b0137ecd1ba7f05eef79c","kind":"f","name":"objective_links_contribution_state_fkey","validated":true},{"hash":"ffb444408a3a750f5e66b3adead548c4","kind":"f","name":"objective_links_objective_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"objective_links_pkey","validated":true},{"hash":"a9f3ffdf487f2e067f22761f303929ee","kind":"f","name":"objective_links_relation_fkey","validated":true},{"hash":"96fbc61977c4a331289e263b8ed1112e","kind":"c","name":"objective_links_target_kind_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"objective_links_tenant_id_fkey","validated":true},{"hash":"8500371a582f5a6df1c127938631b080","kind":"f","name":"objective_links_verification_state_fkey","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"objective_links_version_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_metrics","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"objective_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"metric_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"87a6d2246cf72d07c1ccd1ac336c2412"},{"name":"direction","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"baseline_value","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"baseline_unit","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"baseline_currency","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"target_value","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"target_unit","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"target_currency","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"target_range_min","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"target_range_max","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"weight","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"683365b18d24b238c2a12327e324c7f5","name":"objective_metrics_objective_id_metric_id_role_key","valid":true},{"hash":"44f60223caa44dd99bc52174f662f082","name":"objective_metrics_pkey","valid":true}],"forceRls":false,"policies":[{"name":"objective_metrics_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"d71f097405e438689504d2a31e459e8f","name":"objective_metrics_guard","enabled":"O"}],"constraints":[{"hash":"253f87e577ce9351787745a86a41b936","kind":"f","name":"objective_metrics_direction_fkey","validated":true},{"hash":"d3fe51859e3d1856b9c17f4f1e41a3ab","kind":"f","name":"objective_metrics_metric_id_fkey","validated":true},{"hash":"ffb444408a3a750f5e66b3adead548c4","kind":"f","name":"objective_metrics_objective_id_fkey","validated":true},{"hash":"f164b500d5663cd38d404f0b5a0691fa","kind":"u","name":"objective_metrics_objective_id_metric_id_role_key","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"objective_metrics_pkey","validated":true},{"hash":"b69f009268b363b2d2cf779dc3c0fa46","kind":"c","name":"objective_metrics_role_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"objective_metrics_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_reason_codes","owner":"postgres","columns":[{"name":"code","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"category","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"b7a820cf63b1c6cb6d28f38f3cabe52d","name":"objective_reason_codes_pkey","valid":true}],"forceRls":false,"policies":[{"name":"objective_reason_codes_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"2a68b71499916a5a6818f1705331ee51","kind":"p","name":"objective_reason_codes_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_statuses","owner":"postgres","columns":[{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"7f0b44e51982815170d8d524b49b043e","name":"objective_statuses_pkey","valid":true}],"forceRls":false,"policies":[{"name":"objective_statuses_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"eba0238902590ea62eeaaca0860c3c8f","kind":"p","name":"objective_statuses_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_types","owner":"postgres","columns":[{"name":"objective_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"label","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"6793b221b8bc02f4fdb42f93ba487e71","name":"objective_types_pkey","valid":true}],"forceRls":false,"policies":[{"name":"objective_types_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"ab382ddf1204b8cd90cb90ac53dbb6e2","kind":"p","name":"objective_types_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objective_verification_states","owner":"postgres","columns":[{"name":"state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"937457f9e24297abf1f6b852965cac85","name":"objective_verification_states_pkey","valid":true}],"forceRls":false,"policies":[{"name":"ovs_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"b326b5062b2f0e69046810717534cb09","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"7281052ddfa4b123b2ff383858a4f3c3","kind":"p","name":"objective_verification_states_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"objectives","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"objective_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"parent_objective_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c248d674101d8b24c97279095c3a6dde"},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"weight","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"starts_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"target_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"review_cadence","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"f6a437c55f28f335bfc36cfa2f313fca"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"stale_after_hours","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"owner","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"accountable_owner","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"domain_pack_keys","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"capability_keys","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"version_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"supersedes","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"created_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"published_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"published_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"8525f677e0ce1d145d41400656d1e461","name":"objectives_parent","valid":true},{"hash":"427b5951aabf5fd0d0c6915af1c2fea7","name":"objectives_pkey","valid":true},{"hash":"1bcda2ec3b4ca44e7a751891eea2d1a2","name":"objectives_tenant","valid":true},{"hash":"5cb2c97442ace0a9cf5e9403cfcd4e4c","name":"objectives_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"objectives_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"d889c94d975ce58c1d6a2e79a3274b6d","name":"objectives_no_parent_cycle","enabled":"O"},{"hash":"168af831151ef06ab5ce5854001b75a5","name":"objectives_strategic_guard","enabled":"O"}],"constraints":[{"hash":"2ac28c636623d917a42aa9c4c4ea9837","kind":"f","name":"objectives_objective_type_fkey","validated":true},{"hash":"3ddc4ebfd5abbd43fac77b136f013db7","kind":"f","name":"objectives_parent_objective_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"objectives_pkey","validated":true},{"hash":"3f75217bea7569d65493b87154fc98c1","kind":"f","name":"objectives_status_fkey","validated":true},{"hash":"35eafd1d37a4b65b95daca9bace07a82","kind":"f","name":"objectives_supersedes_fkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"objectives_tenant_id_fkey","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"objectives_version_id_fkey","validated":true}]}]'::jsonb then raise exception 'Production measurement baseline catalog differs';end if;
 select jsonb_agg(f order by f->>'name') into actual_helpers from (-- Read-only release planning metadata. No source rows, credentials or SQL bodies.
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
  lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['objectives_strategic_guard','objectives_child_guard','metric_definitions_guard','objectives_append_only']);
 if actual_helpers is distinct from '[{"hash":"f6b9e94a585edb2bfe373e5d2c0cb8c4","name":"metric_definitions_guard","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"4ae8319a887f1e1905b47cdd220c2bed","name":"objectives_append_only","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"869326657bd01e9f2ceb3da9949d7283","name":"objectives_child_guard","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true},{"hash":"66f186fa10912299a5818601f7f4e873","name":"objectives_strategic_guard","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true}]'::jsonb then raise exception 'Existing objective guard definitions differ';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.object_state_history'::regclass and tgname='learn_foundation_reference_guard')
  or not exists(select 1 from pg_trigger where tgrelid='public.intelligence_objects'::regclass and tgname='learn_foundation_reference_guard') then
  raise exception 'Foundation reference prerequisites missing';end if;
end $$;
-- Keep original objective schema, registry rows, policies, grants and guards.
-- SOURCE 20261029150000_learn_performance_measurements.sql
-- Original SHA-256 1a65cade2ab26cffdc82ea2f17f0f25e82397d624cc15e7b93bb3f9871030a39
-- Add subject-scoped evidence to the existing measurement model. No data is
-- seeded or scored, and no historical communications are changed.
alter table public.metric_definitions add column measurement_scope text not null default 'tenant'
 check(measurement_scope in ('tenant','performance'));
alter table public.measurements
 add column subject_kind text not null default 'tenant' check(subject_kind in ('tenant','member','team','job','customer')),
 add column subject_id uuid,
 add column policy_version_id uuid references public.config_versions(id),
 add column policy_id uuid,
 add column policy_revision integer,
 add column metric_key text,
 add column sample_count bigint,
 add column covered_count bigint,
 add column eligible_count bigint,
 add column source_through timestamptz,
 add column review_state text,
 add column exclusions jsonb,
 add column supersedes uuid references public.measurements(id),
 add column group_ids uuid[],
 add column request_payload jsonb,
 add column change_reason text;
alter table public.measurements add constraint measurements_performance_shape check(
 (subject_kind='tenant' and subject_id is null and policy_version_id is null and policy_id is null
  and policy_revision is null and metric_key is null and review_state is null and request_payload is null)
 or (subject_kind<>'tenant' and subject_id is not null and policy_version_id is not null
  and policy_id is not null and policy_revision is not null and policy_revision>0 and metric_key is not null
  and sample_count>=0 and sample_count<=9007199254740991 and sample_count is not null
  and covered_count>=0 and covered_count<=9007199254740991 and covered_count is not null
  and (eligible_count is null or (eligible_count>=covered_count and eligible_count<=9007199254740991))
  and window_start is not null and window_end is not null and isfinite(window_start) and isfinite(window_end)
  and window_start<window_end and isfinite(measured_at) and measured_at>=window_end
  and (source_through is null or (isfinite(source_through) and source_through<=measured_at))
  and review_state in ('inferred','confirmed','disputed') and review_state is not null
  and exclusions is not null and jsonb_typeof(exclusions)='array'
  and group_ids is not null and request_payload is not null and jsonb_typeof(request_payload)='object'
  and length(btrim(change_reason)) between 1 and 1000 and change_reason is not null)
);
create index measurements_performance_series on public.measurements
 (tenant_id,policy_id,policy_revision,subject_kind,subject_id,window_start,window_end)
 where subject_kind<>'tenant';
create unique index measurements_one_correction on public.measurements(supersedes) where supersedes is not null;
-- Existing tenant-wide objective reads remain unchanged; staff performance starts
-- with owner/admin visibility until explicit team/self access is implemented.
create policy measurements_performance_read on public.measurements as restrictive for select to authenticated
 using(subject_kind='tenant' or (tenant_id=public.current_tenant_id()
  and coalesce(public.current_user_role(),'') in ('owner','admin')));

create function public.learn_metric_scope_guard() returns trigger language plpgsql as $$
declare d public.metric_definitions%rowtype;
begin
 if tg_table_name='metric_definitions' then
  if new.measurement_scope is distinct from old.measurement_scope
   or (old.measurement_scope='performance' and (new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id or new.key is distinct from old.key
    or new.version_id is distinct from old.version_id)) then
   raise exception 'Metric scope is immutable' using errcode='23514';
  end if;
  return new;
 end if;
 if new.metric_id is null then return new; end if;
 select * into d from public.metric_definitions where id=new.metric_id for share;
 if not found or d.tenant_id<>new.tenant_id then
  raise exception 'Metric belongs to another tenant or is missing' using errcode='23514';
 end if;
 if tg_table_name='measurements' then
  if (new.subject_kind='tenant') is distinct from (d.measurement_scope='tenant') then
   raise exception 'Measurement and metric scopes differ' using errcode='23514';
  end if;
 elsif d.measurement_scope<>'tenant' then
  raise exception 'Performance metrics cannot drive company objectives' using errcode='23514';
 end if;
 return new;
end $$;
create trigger learn_metric_scope_guard before update on public.metric_definitions for each row execute function public.learn_metric_scope_guard();
create trigger learn_measurement_scope_guard before insert on public.measurements for each row execute function public.learn_metric_scope_guard();
create trigger learn_objective_metric_scope_guard before insert or update on public.objective_metrics for each row execute function public.learn_metric_scope_guard();
create trigger learn_objective_constraint_scope_guard before insert or update on public.objective_constraints for each row execute function public.learn_metric_scope_guard();

-- Trusted adapters may append unconfirmed observations. Human review/publication
-- is separate: callers cannot claim a confirmed score through this RPC.
create function public.learn_performance_append(p_tenant_id uuid,p_measurement jsonb,p_reason text)
 returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p jsonb:=p_measurement;
 mid uuid:=(p->>'id')::uuid;
 pid uuid:=(p->>'policyId')::uuid;
 revision integer:=(p->>'policyVersion')::integer;
 sid uuid:=(p#>>'{subject,id}')::uuid;
 kind text:=p#>>'{subject,kind}';
 start_at timestamptz:=(p#>>'{period,start}')::timestamptz;
 end_at timestamptz:=(p#>>'{period,end}')::timestamptz;
 observed timestamptz:=(p->>'observedAt')::timestamptz;
 through_at timestamptz:=(p->>'sourceThrough')::timestamptz;
 previous uuid:=(p->>'supersedes')::uuid;
 policy jsonb;
 rule jsonb;
 v_version_id uuid;
 metric uuid;
 existing public.measurements%rowtype;
 parent public.measurements%rowtype;
 member public.team_members%rowtype;
 groups uuid[]:='{}';
 source_table text;
 ref jsonb;
 exclusion jsonb;
 exists_ref boolean;
begin
 if p_tenant_id is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>262144
  or mid is null or pid is null or sid is null or revision is null or revision<1
  or (p->>'tenantId')::uuid is distinct from p_tenant_id
  or coalesce(kind,'') not in ('member','team','job','customer')
  or coalesce(p->>'review','')<>'inferred'
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
  or start_at is null or end_at is null or observed is null or not isfinite(start_at) or not isfinite(end_at)
  or not isfinite(observed) or start_at>=end_at or observed<end_at or observed>clock_timestamp()
  or (through_at is not null and (not isfinite(through_at) or through_at>observed))
  or jsonb_typeof(p->'value') not in ('number','null') or not (p ? 'value')
  or abs((p->>'value')::numeric)>1.7976931348623157e308
  or jsonb_typeof(p->'sampleCount') is distinct from 'number'
  or jsonb_typeof(p->'coveredCount') is distinct from 'number'
  or jsonb_typeof(p->'eligibleCount') not in ('number','null') or not (p ? 'eligibleCount')
  or (p->>'sampleCount')::numeric<>trunc((p->>'sampleCount')::numeric)
  or (p->>'coveredCount')::numeric<>trunc((p->>'coveredCount')::numeric)
  or ((p->>'eligibleCount')::numeric is not null and (p->>'eligibleCount')::numeric<>trunc((p->>'eligibleCount')::numeric))
  or jsonb_typeof(p->'evidence') is distinct from 'array' or jsonb_typeof(p->'exclusions') is distinct from 'array' then
  raise exception 'Invalid performance observation' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-performance:'||mid::text,0));
 select * into existing from public.measurements where id=mid;
 if found then
  if existing.tenant_id<>p_tenant_id or existing.request_payload is distinct from p
   or existing.change_reason is distinct from btrim(p_reason) then
   raise exception 'Measurement request identity changed' using errcode='40001';
  end if;
  return jsonb_build_object('measurementId',mid,'reused',true);
 end if;
 select e.value,c.id into policy,v_version_id from public.operating_profile_entries e
  join public.config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
  where e.tenant_id=p_tenant_id and e.namespace='learn_scorecards' and e.scope_kind='tenant'
   and e.key like 'definition.%' and e.value->>'id'=pid::text and e.value->>'version'=revision::text
   and c.artifact_kind='learn_scorecard' and c.version=revision and c.status in ('draft','published');
 if not found or policy->>'subjectKind' is distinct from kind then
  raise exception 'Unknown scorecard revision or subject kind' using errcode='22023';
 end if;
 select r into rule from jsonb_array_elements(policy->'metrics') r where r->>'key'=p->>'metricKey';
 if rule is null or rule->>'unit' is distinct from p->>'unit'
  or not coalesce((rule->'sourceSystems') ? (p->>'sourceSystem'),false) then
  raise exception 'Unknown measure, unit or source' using errcode='22023';
 end if;
 source_table:=case kind when 'member' then 'team_members' when 'team' then 'org_units'
  when 'job' then 'jobs' when 'customer' then 'customer_cards' end;
 execute format('select exists(select 1 from public.%I where tenant_id=$1 and id=$2)',source_table)
  into exists_ref using p_tenant_id,sid;
 if not exists_ref then raise exception 'Unknown tenant subject' using errcode='22023'; end if;
 if policy->>'groupId' is not null then
  if kind='team' and sid=(policy->>'groupId')::uuid then groups:=array[sid];
  elsif kind='member' then
   select * into member from public.team_members where id=sid and tenant_id=p_tenant_id for share;
   if member.org_unit_id is distinct from (policy->>'groupId')::uuid or member.confirmed_at is null
    or member.effective_from>start_at or (member.effective_to is not null and member.effective_to<end_at) then
    raise exception 'Team membership does not establish the entire period' using errcode='22023';
   end if;
   groups:=array[member.org_unit_id];
  else raise exception 'Subject differs from policy team' using errcode='22023'; end if;
 end if;
 if jsonb_array_length(p->'evidence') not between 1 and 1000 or jsonb_array_length(p->'exclusions')>100 then
  raise exception 'Evidence bounds exceeded' using errcode='22023';
 end if;
 for exclusion in select value from jsonb_array_elements(p->'exclusions') loop
  if jsonb_typeof(exclusion) is distinct from 'object' or length(btrim(coalesce(exclusion->>'reason',''))) not between 1 and 200
   or jsonb_typeof(exclusion->'count') is distinct from 'number' or (exclusion->>'count')::numeric<0
   or (exclusion->>'count')::numeric>9007199254740991
   or (exclusion->>'count')::numeric<>trunc((exclusion->>'count')::numeric)
   or jsonb_typeof(exclusion->'evidence') is distinct from 'array' then
   raise exception 'Invalid exclusion' using errcode='22023';
  end if;
  if jsonb_array_length(exclusion->'evidence') not between 1 and 1000 then
   raise exception 'Exclusion evidence required' using errcode='22023';
  end if;
 end loop;
 for ref in select value from jsonb_array_elements(p->'evidence')
  union all select ev.value from jsonb_array_elements(p->'exclusions') ex cross join lateral jsonb_array_elements(ex->'evidence') ev loop
  if coalesce(ref->>'table','') not in ('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members')
   or ref->>'id' is null then raise exception 'Unsupported evidence reference' using errcode='22023'; end if;
  execute format('select exists(select 1 from public.%I where tenant_id=$1 and id=$2)',ref->>'table')
   into exists_ref using p_tenant_id,(ref->>'id')::uuid;
  if not exists_ref then raise exception 'Missing or foreign evidence' using errcode='22023'; end if;
 end loop;
 insert into public.metric_definitions(tenant_id,key,name,unit,source_system,calculation_method,version_id,measurement_scope)
  values(p_tenant_id,'learn.scorecard.'||v_version_id::text||'.'||(p->>'metricKey'),rule->>'label',rule->>'unit',
   'learn_performance','evidence_adapter',v_version_id,'performance') on conflict(tenant_id,key) do nothing;
 select id into metric from public.metric_definitions where tenant_id=p_tenant_id
  and key='learn.scorecard.'||v_version_id::text||'.'||(p->>'metricKey')
  and measurement_scope='performance' and unit=rule->>'unit' and metric_definitions.version_id=v_version_id;
 if metric is null then raise exception 'Metric registry conflict' using errcode='40001'; end if;
 if previous is not null then
  select * into parent from public.measurements where id=previous for update;
  if not found or parent.tenant_id<>p_tenant_id or parent.metric_id<>metric
   or parent.subject_kind<>kind or parent.subject_id<>sid or parent.window_start<>start_at or parent.window_end<>end_at
   or parent.measured_at>=observed or exists(select 1 from public.measurements where supersedes=previous) then
   raise exception 'Correction history changed or differs in scope' using errcode='40001';
  end if;
 end if;
 insert into public.measurements(id,tenant_id,metric_id,value,unit,window_start,window_end,measured_at,source,evidence,
  subject_kind,subject_id,policy_version_id,policy_id,policy_revision,metric_key,sample_count,covered_count,eligible_count,
  source_through,review_state,exclusions,supersedes,group_ids,request_payload,change_reason)
 values(mid,p_tenant_id,metric,(p->>'value')::numeric,p->>'unit',start_at,end_at,observed,p->>'sourceSystem',p->'evidence',
  kind,sid,v_version_id,pid,revision,p->>'metricKey',(p->>'sampleCount')::bigint,(p->>'coveredCount')::bigint,(p->>'eligibleCount')::bigint,
  through_at,'inferred',p->'exclusions',previous,groups,p,btrim(p_reason));
 return jsonb_build_object('measurementId',mid,'reused',false);
end $$;
revoke all on function public.learn_performance_append(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.learn_performance_append(uuid,jsonb,text) to service_role;

-- SOURCE 20261029160000_learn_performance_reviews.sql
-- Original SHA-256 d177f4426dc7e35189b04569a78c3094b512e642243b96c7500aabca4cb261f1
-- Human review is an append-only ledger, separate from immutable source facts.
-- Confirming an observation must never refresh its source timestamp or coverage.
create table public.learn_performance_reviews (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 measurement_id uuid not null references public.measurements(id),
 revision integer not null check(revision>0),
 decision text not null check(decision in ('confirmed','disputed')),
 reviewed_by uuid not null references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 created_at timestamptz not null default clock_timestamp(),
 unique(measurement_id,revision)
);
alter table public.learn_performance_reviews enable row level security;
create policy learn_performance_review_read on public.learn_performance_reviews for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
revoke all on public.learn_performance_reviews from public,anon,authenticated,service_role;
grant select on public.learn_performance_reviews to authenticated,service_role;
create trigger learn_performance_reviews_immutable before update or delete on public.learn_performance_reviews
 for each row execute function public.objectives_append_only();
create function public.learn_performance_review(
 p_tenant_id uuid,p_measurement_id uuid,p_request_id uuid,p_expected_revision integer,p_decision text,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 prior public.learn_performance_reviews%rowtype;
 observed public.measurements%rowtype;
 current_revision integer;
begin
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id()
  or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>now())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';
 end if;
 if p_measurement_id is null or p_request_id is null or p_expected_revision is null
  or p_expected_revision<0 or p_expected_revision>=2147483647
  or coalesce(p_decision,'') not in ('confirmed','disputed')
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'A measurement, review decision, revision and reason are required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-performance-review:'||p_request_id::text,0));
 select * into prior from public.learn_performance_reviews where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.measurement_id<>p_measurement_id or prior.reviewed_by<>auth.uid()
   or prior.revision<>p_expected_revision+1 or prior.decision<>p_decision or prior.reason<>btrim(p_reason) then
   raise exception 'Review request identity changed' using errcode='40001';
  end if;
  return jsonb_build_object('reviewId',prior.id,'measurementId',prior.measurement_id,'revision',prior.revision,'decision',prior.decision,'reused',true);
 end if;
 -- The adapter correction path takes this same row lock. A stale card cannot
 -- approve an observation that has already been replaced by a new source fact.
 select * into observed from public.measurements where id=p_measurement_id and tenant_id=p_tenant_id for update;
 if not found or observed.subject_kind='tenant' then
  raise exception 'Performance observation unavailable' using errcode='22023';
 end if;
 if exists(select 1 from public.measurements where supersedes=observed.id) then
  raise exception 'Observation was corrected; reload before reviewing' using errcode='40001';
 end if;
 select coalesce(max(revision),0) into current_revision from public.learn_performance_reviews where measurement_id=observed.id;
 if current_revision<>p_expected_revision then
  raise exception 'Review changed; reload before reviewing' using errcode='40001';
 end if;
 insert into public.learn_performance_reviews(id,tenant_id,measurement_id,revision,decision,reviewed_by,reason)
  values(p_request_id,p_tenant_id,observed.id,current_revision+1,p_decision,auth.uid(),btrim(p_reason));
 return jsonb_build_object('reviewId',p_request_id,'measurementId',observed.id,'revision',current_revision+1,'decision',p_decision,'reused',false);
end $$;
revoke all on function public.learn_performance_review(uuid,uuid,uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.learn_performance_review(uuid,uuid,uuid,integer,text,text) to authenticated;

-- SOURCE 20261030040000_learn_measurement_conflicts_retention.sql
-- Original SHA-256 b06d2d58de4a1a2ede326a83279832b23657cd330cd17d708fd2df660a98327e
-- Manual business conflicts must not request database serialization retries.
-- Preserve whichever retained append implementation is installed (the work
-- collector later extends its evidence allowlist without changing this contract).
do $$ declare signature text; definition text; expected_count int; begin
 foreach signature in array array[
  'public.learn_performance_append(uuid,jsonb,text)',
  'public.learn_performance_review(uuid,uuid,uuid,integer,text,text)'
 ] loop
  if to_regprocedure(signature) is null then raise exception 'Measurement writer prerequisite missing';end if;
  select pg_get_functiondef(to_regprocedure(signature)) into definition;
  expected_count:=(length(definition)-length(replace(definition,'errcode=''40001''','')))/length('errcode=''40001''');
  if expected_count<>3 then raise exception 'Unexpected measurement conflict contract';end if;
  execute replace(definition,'errcode=''40001''','errcode=''PT409''');
 end loop;
end $$;
-- Row-level guards do not fire for TRUNCATE. Retain all evidence ledgers even
-- when a privileged maintenance caller attempts to truncate the whole table.
create trigger learn_measurements_no_truncate before truncate on public.measurements
 for each statement execute function public.objectives_append_only();
create trigger learn_performance_reviews_no_truncate before truncate on public.learn_performance_reviews
 for each statement execute function public.objectives_append_only();
create trigger learn_objective_health_no_truncate before truncate on public.objective_health
 for each statement execute function public.objectives_append_only();
-- Existing service writers may still insert company-wide objective measurements.
-- Staff performance observations must pass the validated SECURITY DEFINER adapter;
-- the service role cannot bypass it and insert a self-confirmed performance fact.
create function public.learn_performance_insert_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if new.subject_kind<>'tenant' and current_user is distinct from
   (select r.rolname from pg_class c join pg_roles r on r.oid=c.relowner where c.oid=tg_relid) then
  raise exception 'Use the validated performance append adapter' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.learn_performance_insert_guard() from public,anon,authenticated,service_role;
create trigger learn_performance_insert_guard before insert on public.measurements
 for each row execute function public.learn_performance_insert_guard();

-- SOURCE 20261030050000_learn_measurement_group_history.sql
-- Original SHA-256 c8c7d49b891ee1586822dc6f369de956b9ea97624a8210db4f2612c87349d702
-- A current roster row cannot prove that somebody belonged to a team for an
-- earlier assessment period. Use retained, reconciled observed membership.
create function public.learn_member_group_covers(p_tenant uuid,p_member uuid,p_group uuid,p_start timestamptz,p_end timestamptz)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare m team_members%rowtype; h learn_member_history%rowtype; previous learn_member_history%rowtype;
 head learn_member_history%rowtype; n int; cursor_at timestamptz; segment_end timestamptz; s jsonb;
begin
 if p_tenant is null or p_member is null or p_group is null or p_start is null or p_end is null
   or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end or p_end>statement_timestamp() then return false;end if;
 select * into m from team_members where id=p_member and tenant_id=p_tenant for share;
 if not found or not exists(select 1 from org_units where id=p_group and tenant_id=p_tenant) then return false;end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.team_members'::regclass
   and tgname='learn_capture_member_change' and tgenabled in ('O','A')) then
  raise exception 'Membership capture unavailable' using errcode='55000';end if;
 select count(*) into n from learn_member_history where tenant_id=p_tenant and member_id=p_member;
 if n>1000 then raise exception 'Membership history exceeds bounded proof' using errcode='54000';end if;
 if n=0 then return false;end if;
 select * into head from learn_member_history where tenant_id=p_tenant and member_id=p_member order by sequence desc limit 1;
 if head.after_state is distinct from learn_member_snapshot(m) or head.observed_at>statement_timestamp() then
  raise exception 'Current membership does not reconcile with history' using errcode='55000';end if;
 cursor_at:=p_start;
 for h in select * from learn_member_history where tenant_id=p_tenant and member_id=p_member order by sequence loop
  if previous.id is not null then
   if h.observed_at<previous.observed_at or h.before_state is distinct from previous.after_state then
    raise exception 'Membership history has an unexplained gap' using errcode='55000';end if;
   segment_end:=least(h.observed_at,p_end);
   if segment_end>cursor_at then
    if previous.observed_at>cursor_at then return false;end if;
    s:=previous.after_state;
    if s->>'teamId' is distinct from p_group::text or s->>'confirmedAt' is null
      or (s->>'confirmedAt')::timestamptz>cursor_at or s->>'effectiveFrom' is null
      or (s->>'effectiveFrom')::timestamptz>cursor_at
      or (s->>'effectiveTo' is not null and (s->>'effectiveTo')::timestamptz<segment_end) then return false;end if;
    cursor_at:=segment_end;
   end if;
  end if;
  previous:=h;
 end loop;
 if cursor_at<p_end then
  if previous.observed_at>cursor_at then return false;end if;
  s:=previous.after_state;
  if s->>'teamId' is distinct from p_group::text or s->>'confirmedAt' is null
    or (s->>'confirmedAt')::timestamptz>cursor_at or s->>'effectiveFrom' is null
    or (s->>'effectiveFrom')::timestamptz>cursor_at
    or (s->>'effectiveTo' is not null and (s->>'effectiveTo')::timestamptz<p_end) then return false;end if;
 end if;
 return true;
end $$;
revoke all on function public.learn_member_group_covers(uuid,uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
-- Retain all existing adapter validation and its current evidence allowlist.
do $patch$ declare definition text; original text; replacement text; begin
 select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure) into definition;
 original:=$old$   select * into member from public.team_members where id=sid and tenant_id=p_tenant_id for share;
   if member.org_unit_id is distinct from (policy->>'groupId')::uuid or member.confirmed_at is null
    or member.effective_from>start_at or (member.effective_to is not null and member.effective_to<end_at) then
    raise exception 'Team membership does not establish the entire period' using errcode='22023';
   end if;
   groups:=array[member.org_unit_id];$old$;
 replacement:=$new$   if not public.learn_member_group_covers(p_tenant_id,sid,(policy->>'groupId')::uuid,start_at,end_at) then
    raise exception 'Observed team membership does not cover the entire period' using errcode='22023';
   end if;
   groups:=array[(policy->>'groupId')::uuid];$new$;
 if strpos(definition,original)=0 or array_length(string_to_array(definition,original),1)<>2 then
  raise exception 'Unexpected adapter membership contract';end if;
 execute replace(definition,original,replacement);
end $patch$;


create trigger learn_measurement_reference_guard before insert or update on public.metric_definitions
 for each row execute function public.learn_foundation_reference_guard();
create trigger learn_measurement_reference_guard before insert or update on public.measurements
 for each row execute function public.learn_foundation_reference_guard();
create trigger learn_measurement_reference_guard before insert or update on public.objectives
 for each row execute function public.learn_foundation_reference_guard();
create trigger learn_measurement_reference_guard before insert or update on public.objective_metrics
 for each row execute function public.learn_foundation_reference_guard();
create trigger learn_measurement_reference_guard before insert or update on public.objective_constraints
 for each row execute function public.learn_foundation_reference_guard();
create trigger learn_measurement_reference_guard before insert or update on public.objective_links
 for each row execute function public.learn_foundation_reference_guard();
create trigger learn_measurement_reference_guard before insert or update on public.objective_health
 for each row execute function public.learn_foundation_reference_guard();
create trigger learn_measurement_reference_guard before insert or update on public.learn_performance_reviews
 for each row execute function public.learn_foundation_reference_guard();
revoke all on function public.learn_metric_scope_guard() from public,anon,authenticated,service_role;
-- SOURCE 20261029180000_learn_work_transition_history.sql
-- Original SHA-256 60fa23defd764b107b4f75c2c57335e92d7835035966ac526c1047812e7f695b
-- Extend the existing work ledger, preserving every historical row. Atomic
-- persistence is adapted from serviceos-dh commit 27eb4ad's work_transition_apply.
-- Old rows have NULL snapshots: they do not prove historical ownership intervals.
alter table public.object_state_history
  add column work_before jsonb,
  add column work_after jsonb,
  add column transition_verb text;
alter table public.object_state_history add constraint osh_work_snapshot_pair check (
  (work_before is null and work_after is null and transition_verb is null) or
  (work_before is not null and work_after is not null
    and jsonb_typeof(work_before) = 'object' and jsonb_typeof(work_after) = 'object'
    and work_before ?& array['status','version','responsible_ref','accountable_ref','waiting_on_ref','attributes']
    and work_after ?& array['status','version','responsible_ref','accountable_ref','waiting_on_ref','attributes']
    and transition_verb is not null)
);
create index osh_work_snapshot_lookup on public.object_state_history(tenant_id, object_id, occurred_at, id)
  where work_before is not null;

create function public.learn_work_history_immutable() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.work_before is not null or (tg_op='UPDATE' and new.work_before is not null) then
    raise exception 'Structured work history is append-only';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger learn_work_history_immutable before update or delete on public.object_state_history
  for each row execute function public.learn_work_history_immutable();
revoke insert, update, delete, truncate on public.object_state_history from public, anon, authenticated;
revoke truncate on public.object_state_history from service_role;


-- SOURCE 20261029190000_learn_work_source_capture.sql
-- Original SHA-256 7fad2334d4ecf1bca5f4dcdbca6349a0879355aacc896d01cfd85dcc900e2243
-- Complete forward capture on the existing work ledger, including background
-- writers. No historical timestamps/owners are reconstructed or rewritten.
alter table public.object_state_history
  add column capture_kind text check(capture_kind in ('insert','update','baseline')),
  add column capture_sequence bigint;
alter table public.object_state_history add constraint osh_capture_shape check (
  (capture_kind is null and capture_sequence is null) or
  (capture_kind is not null and capture_sequence is not null and capture_sequence>0
    and work_before is not null and work_after is not null)
);
create sequence public.learn_work_capture_sequence;
create unique index osh_capture_sequence on public.object_state_history(capture_sequence)
  where capture_sequence is not null;
create index osh_capture_read on public.object_state_history(tenant_id,object_id,occurred_at,capture_sequence)
  where capture_kind is not null;

create function public.learn_work_snapshot(p public.intelligence_objects) returns jsonb
language sql immutable set search_path=public as $$
  select jsonb_build_object('status',p.status,'version',p.version,
    'responsible_ref',p.responsible_ref,'accountable_ref',p.accountable_ref,
    'waiting_on_ref',p.waiting_on_ref,'attributes',p.attributes);
$$;

create function public.learn_capture_work_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare b jsonb; a jsonb;
begin
  a:=learn_work_snapshot(new);
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Work identity and tenant are immutable' using errcode='23514';
    end if;
    b:=learn_work_snapshot(old);
    if a=b then return new; end if;
  else b:=a;
  end if;
  insert into object_state_history(tenant_id,object_id,from_state,to_state,actor,reason,
    occurred_at,work_before,work_after,transition_verb,capture_kind,capture_sequence)
  values(new.tenant_id,new.id,b->>'status',a->>'status',
    '{"kind":"system","ref":"database_work_capture"}',
    'Database-observed work change; actor attribution is separate transition evidence',
    clock_timestamp(),b,a,'observed_'||lower(tg_op),lower(tg_op),nextval('learn_work_capture_sequence'));
  return new;
end $$;
create trigger learn_capture_work_change after insert or update on public.intelligence_objects
  for each row execute function public.learn_capture_work_change();

-- Explicit, bounded baseline for an existing item. It starts coverage NOW,
-- never at created_at and never at a guessed historical assignment time.
create function public.learn_work_capture_baseline(p_tenant uuid,p_object uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare o intelligence_objects%rowtype; snapshot jsonb; result uuid;
begin
  select * into o from intelligence_objects where tenant_id=p_tenant and id=p_object for update;
  if not found then raise exception 'Work item not found in tenant' using errcode='P0002'; end if;
  select id into result from object_state_history where tenant_id=p_tenant and object_id=p_object
    and capture_kind is not null order by capture_sequence limit 1;
  if found then return result; end if;
  snapshot:=learn_work_snapshot(o);
  insert into object_state_history(tenant_id,object_id,from_state,to_state,actor,reason,
    occurred_at,work_before,work_after,transition_verb,capture_kind,capture_sequence)
  values(p_tenant,p_object,o.status,o.status,'{"kind":"system","ref":"database_work_baseline"}',
    'Current state baseline; prior ownership duration is unknown',clock_timestamp(),snapshot,snapshot,
    'observed_baseline','baseline',nextval('learn_work_capture_sequence')) returning id into result;
  return result;
end $$;

-- One statement snapshot: period events, preceding state, capture watermark and
-- current object agree. A browser cannot declare history complete using a count
-- from a different read. The reader never creates baselines or writes anything.
create function public.learn_work_history_read(p_tenant uuid,p_object uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  o intelligence_objects%rowtype; head object_state_history%rowtype;
  coverage_start timestamptz; predecessor bigint; event_count int; events jsonb;
  observed timestamptz:=statement_timestamp(); result jsonb;
begin
  if auth.uid() is null or p_tenant is distinct from current_tenant_id()
    or coalesce(current_user_role(),'') not in ('owner','admin') then
    raise exception 'Owner/admin access in this tenant required' using errcode='42501';
  end if;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_start>=p_end or p_end>observed or p_end-p_start>interval '366 days' then
    raise exception 'Choose a completed period of at most 366 days' using errcode='22023';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.intelligence_objects'::regclass
    and tgname='learn_capture_work_change' and tgenabled in ('O','A')) then
    raise exception 'Work capture is unavailable' using errcode='55000';
  end if;
  select * into o from intelligence_objects where id=p_object and tenant_id=p_tenant;
  if not found then raise exception 'Work item unavailable in tenant' using errcode='P0002'; end if;
  select * into head from object_state_history where tenant_id=p_tenant and object_id=p_object
    and capture_kind is not null order by capture_sequence desc limit 1;
  if found and (head.work_after is distinct from learn_work_snapshot(o) or head.occurred_at>observed) then
    raise exception 'Current work state does not reconcile with captured history' using errcode='55000';
  end if;
  if exists(select 1 from (
    select occurred_at,work_before,
      lag(occurred_at) over(order by capture_sequence) prior_at,
      lag(work_after) over(order by capture_sequence) prior_state
    from object_state_history where tenant_id=p_tenant and object_id=p_object and capture_kind is not null
  ) h where occurred_at<prior_at or (prior_state is not null and work_before is distinct from prior_state)) then
    raise exception 'Work capture contains an unexplained history gap' using errcode='55000';
  end if;
  select min(occurred_at) into coverage_start from object_state_history
    where tenant_id=p_tenant and object_id=p_object and capture_kind is not null;
  select capture_sequence into predecessor from object_state_history
    where tenant_id=p_tenant and object_id=p_object and capture_kind is not null and occurred_at<p_start
    order by capture_sequence desc limit 1;
  select count(*) into event_count from object_state_history where tenant_id=p_tenant and object_id=p_object
    and capture_kind is not null and (capture_sequence=predecessor or occurred_at between p_start and p_end);
  if event_count>1000 then raise exception 'Work history exceeds this bounded review window' using errcode='54000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'tenantId',tenant_id,'objectId',object_id,'sequence',capture_sequence::text,
    'kind',capture_kind,'occurredAt',occurred_at,'before',work_before,'after',work_after
  ) order by capture_sequence),'[]') into events from object_state_history
    where tenant_id=p_tenant and object_id=p_object and capture_kind is not null
    and (capture_sequence=predecessor or occurred_at between p_start and p_end);
  result:=jsonb_build_object('tenantId',p_tenant,'objectId',p_object,
    'period',jsonb_build_object('start',p_start,'end',p_end),'observedAt',observed,
    'sourceThrough',case when coverage_start is not null then observed end,
    'coverageStart',coverage_start,'count',event_count,'events',events,
    'contract','work-capture@1');
  if octet_length(result::text)>2097152 then raise exception 'Work history exceeds review payload limit' using errcode='54000'; end if;
  return result;
end $$;
revoke all on sequence public.learn_work_capture_sequence from public,anon,authenticated,service_role;
revoke all on function public.learn_work_snapshot(public.intelligence_objects),
  public.learn_capture_work_change(),public.learn_work_capture_baseline(uuid,uuid),
  public.learn_work_history_read(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_capture_baseline(uuid,uuid) to service_role;
grant execute on function public.learn_work_history_read(uuid,uuid,timestamptz,timestamptz) to authenticated;

-- SOURCE 20261029230000_learn_work_handoff_measurements.sql
-- Original SHA-256 95a8dfa1afaaef4c81ef504498ad9905fcf2b1f47c854d06dd76bcc075d9e5fc
-- First source adapter: observed outgoing ownership transfers, not speed or quality.
-- Source history and provider inputs are never modified.
create table public.learn_work_measurement_runs (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 member_id uuid not null references public.team_members(id),
 actor_id uuid not null,
 request jsonb not null,
 observed_at timestamptz not null,
 source_system text not null default 'serviceos.work.handoffs@1',
 metric_key text not null default 'work.recorded_handoffs',
 explanation text not null,
 proof jsonb not null check(octet_length(proof::text)<=1048576)
);
alter table public.learn_work_measurement_runs enable row level security;
revoke all on public.learn_work_measurement_runs from public,anon,authenticated,service_role;
grant select on public.learn_work_measurement_runs to authenticated;
create policy learn_work_measurement_runs_read on public.learn_work_measurement_runs for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create trigger learn_work_measurement_runs_immutable before update or delete on public.learn_work_measurement_runs
 for each row execute function public.learn_member_history_immutable();
create trigger learn_work_measurement_runs_no_truncate before truncate on public.learn_work_measurement_runs
 for each statement execute function public.learn_member_history_immutable();

create function public.learn_work_handoffs_collect(p_tenant uuid,p_member uuid,p_policy uuid,p_revision int,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); descriptor jsonb; prior learn_work_measurement_runs%rowtype;
 roster jsonb; history jsonb; o intelligence_objects%rowtype; first_capture object_state_history%rowtype;
 policy jsonb; rule jsonb; ev jsonb; before_owner text; after_owner text; at timestamptz;
 observed timestamptz:=statement_timestamp(); source_through timestamptz:=statement_timestamp();
 eligible int:=0; covered int:=0; transfers int:=0; total_events int:=0; object_complete boolean;
 proof jsonb; items jsonb:='[]'; credited jsonb:='[]'; issues jsonb:='[]'; payload jsonb; ack jsonb;
 count_objects int; result_value int;
begin
 -- Lock the actor's real profile, so revocation cannot race a long calculation.
 if actor is null or p_tenant is distinct from current_tenant_id() then
   raise exception 'Owner/admin access required' using errcode='42501'; end if;
 perform 1 from profiles where id=actor and tenant_id=p_tenant and role in ('owner','admin') for share;
 if not found then raise exception 'Owner/admin access required' using errcode='42501'; end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'View-As cannot collect performance observations' using errcode='42501'; end if;
 if p_member is null or p_policy is null or p_request is null or p_revision is null or p_revision<1
   or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
   or p_start>=p_end or p_end>observed or p_end-p_start>interval '366 days'
   or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
   raise exception 'A member, policy, completed period and reason are required' using errcode='22023'; end if;
 descriptor:=jsonb_build_object('memberId',p_member,'policyId',p_policy,'policyVersion',p_revision,
   'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor);
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into prior from learn_work_measurement_runs where id=p_request;
 if found then
   if prior.tenant_id<>p_tenant or prior.request is distinct from descriptor then
     raise exception 'Collection request identity changed' using errcode='40001'; end if;
   if not exists(select 1 from measurements where id=p_request and tenant_id=p_tenant) then
     raise exception 'Collection receipt is incomplete' using errcode='55000'; end if;
   return jsonb_build_object('measurementId',p_request,'reused',true);
 end if;
 perform 1 from team_members where id=p_member and tenant_id=p_tenant;
 if not found then raise exception 'Member not found in tenant' using errcode='22023'; end if;
 select e.value into policy from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
 where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant'
   and e.key like 'definition.%' and e.value->>'id'=p_policy::text and e.value->>'version'=p_revision::text
   and c.artifact_kind='learn_scorecard' and c.version=p_revision and c.status in ('draft','published');
 if policy is null or policy->>'subjectKind'<>'member' or policy->>'groupId' is not null then
   raise exception 'Choose a company-wide member policy for recorded handoffs' using errcode='22023'; end if;
 select value into rule from jsonb_array_elements(policy->'metrics') where value->>'key'='work.recorded_handoffs';
 if rule is null or rule->>'unit'<>'handoffs' or not coalesce((rule->'sourceSystems') ? 'serviceos.work.handoffs@1',false) then
   raise exception 'Policy does not define the recorded handoff measure' using errcode='22023'; end if;
 -- Serialize one observation per exact cell. Refreshes must use a separately
 -- reviewed correction workflow, not create two competing independent counts.
 perform pg_advisory_xact_lock(hashtextextended('learn-handoff-cell:'||p_tenant::text||p_member::text||p_policy::text||p_revision::text||extract(epoch from p_start)::text||':'||extract(epoch from p_end)::text,0));
 if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind='member' and subject_id=p_member
   and policy_id=p_policy and policy_revision=p_revision and metric_key='work.recorded_handoffs'
   and window_start=p_start and window_end=p_end) then
   raise exception 'An observation already exists for this cell; review or correct it' using errcode='40001'; end if;
 roster:=learn_member_history_read(p_tenant,p_start,p_end);
 select count(*) into count_objects from intelligence_objects where tenant_id=p_tenant;
 if count_objects>2000 then raise exception 'Work population exceeds bounded collection; no partial score saved' using errcode='54000'; end if;
 for o in select * from intelligence_objects where tenant_id=p_tenant order by id loop
   select * into first_capture from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null
     order by capture_sequence limit 1;
   -- A proven database insertion after the period cannot contain period handoffs.
   if first_capture.capture_kind='insert' and first_capture.occurred_at>=p_end then continue; end if;
   eligible:=eligible+1;
   history:=learn_work_history_read(p_tenant,o.id,p_start,p_end);
   total_events:=total_events+(history->>'count')::int;
   if total_events>5000 then raise exception 'Work events exceed bounded collection' using errcode='54000'; end if;
   object_complete:=history->>'coverageStart' is not null and (
     (history->>'coverageStart')::timestamptz<=p_start or first_capture.capture_kind='insert');
   if history->>'sourceThrough' is not null then source_through:=least(source_through,(history->>'sourceThrough')::timestamptz); end if;
   for ev in select value from jsonb_array_elements(history->'events') loop
     at:=(ev->>'occurredAt')::timestamptz;
     if ev->>'kind'<>'update' or at<p_start or at>=p_end
       or ev#>'{before,responsible_ref}'='null'::jsonb or ev#>'{after,responsible_ref}'='null'::jsonb
       or ev#>'{before,responsible_ref}'=ev#>'{after,responsible_ref}' then continue; end if;
     before_owner:=learn_handoff_owner(p_tenant,roster,ev#>'{before,responsible_ref}',at);
     if before_owner is null then object_complete:=false; continue; end if;
     if before_owner<>'member:'||p_member::text then continue; end if;
     after_owner:=learn_handoff_owner(p_tenant,roster,ev#>'{after,responsible_ref}',at);
     if after_owner is null then object_complete:=false; continue; end if;
     if before_owner=after_owner then continue; end if; -- user/member aliases are not a transfer.
     transfers:=transfers+1;
     credited:=credited||jsonb_build_array(jsonb_build_object('objectId',o.id,'eventId',ev->>'id',
       'occurredAt',at,'from',before_owner,'to',after_owner));
   end loop;
   if object_complete then covered:=covered+1; else issues:=issues||jsonb_build_array(o.id); end if;
   items:=items||jsonb_build_array(jsonb_build_object('objectId',o.id,'complete',object_complete,
     'coverageStart',history->'coverageStart','sourceThrough',history->'sourceThrough',
     'eventIds',(select coalesce(jsonb_agg(v->'id'),'[]') from jsonb_array_elements(history->'events') v)));
 end loop;
 -- Even zero must be supported: unknown history never becomes zero handoffs.
 result_value:=case when covered=eligible then transfers else null end;
 proof:=jsonb_build_object('contract','work-handoffs@1','population','all retained intelligence objects',
   'value',result_value,'knownHandoffs',transfers,'eligibleItems',eligible,'coveredItems',covered,
   'incompleteObjectIds',issues,'items',items,'credited',credited,'membership',roster);
 if octet_length(proof::text)>1048576 then raise exception 'Calculation evidence exceeds retention limit' using errcode='54000'; end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'View-As cannot collect performance observations' using errcode='42501'; end if;
 insert into learn_work_measurement_runs(id,tenant_id,member_id,actor_id,request,observed_at,explanation,proof)
 values(p_request,p_tenant,p_member,actor,descriptor,observed,
   'Recorded outgoing ownership transfers. Not speed, quality or hours worked. '
   ||covered||' of '||eligible||' retained work items have complete history/identity coverage. '
   ||case when result_value is null then 'Value withheld because coverage is incomplete.' else 'Confirmed review is still required.' end,proof);
 payload:=jsonb_build_object('id',p_request,'tenantId',p_tenant,'subject',jsonb_build_object('kind','member','id',p_member),
   'metricKey','work.recorded_handoffs','policyId',p_policy,'policyVersion',p_revision,
   'period',jsonb_build_object('start',p_start,'end',p_end),'value',result_value,'unit','handoffs',
   'sampleCount',covered,'coveredCount',covered,'eligibleCount',eligible,'observedAt',observed,
   'sourceThrough',case when covered=eligible then source_through end,'sourceSystem','serviceos.work.handoffs@1',
   'review','inferred','evidence',jsonb_build_array(jsonb_build_object('table','learn_work_measurement_runs','id',p_request)),
   'exclusions','[]'::jsonb);
 ack:=learn_performance_append(p_tenant,payload,btrim(p_reason));
 return ack;
end $$;
revoke all on function public.learn_work_handoffs_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_handoffs_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) to authenticated;

-- SOURCE 20261030010000_learn_work_residence_measurements.sql
-- Original SHA-256 a3fc08c70b854dcade484eb8f9ab4b6656e78f7032e5b50cff3c6ed71edc36f4
create or replace function public.learn_handoff_owner(p_tenant uuid,p_roster jsonb,p_ref jsonb,p_at timestamptz)
returns text language plpgsql stable security definer set search_path=public as $$
declare m jsonb; e jsonb; state jsonb; found_owner text; n int:=0; ref_id uuid;
begin
 if p_ref is null or p_ref='null'::jsonb or coalesce(p_ref->>'kind','') not in ('member','user','team','org_unit') then return null; end if;
 begin ref_id:=(p_ref->>'ref')::uuid; exception when invalid_text_representation then return null; end;
 if ref_id is null then return null; end if;
 if p_ref->>'kind' in ('team','org_unit') then
   if exists(select 1 from org_units where tenant_id=p_tenant and id=ref_id) then return 'team:'||ref_id::text; end if;
   return null;
 end if;
 for m in select value from jsonb_array_elements(p_roster->'members') loop
   if p_ref->>'kind'='member' and m->>'memberId'<>ref_id::text then continue; end if;
   if m->>'coverageStart' is null then return null; end if;
   if (m->>'coverageStart')::timestamptz>p_at then
     if m->>'firstKind'='insert' then continue; else return null; end if;
   end if;
   select value into e from jsonb_array_elements(m->'events') where (value->>'observedAt')::timestamptz<=p_at
     order by (value->>'sequence')::bigint desc limit 1;
   if e is null then return null; end if;
   state:=e->'after';
   if p_ref->>'kind'='user' and state->>'profileId' is distinct from ref_id::text then continue; end if;
   if (state->>'effectiveFrom')::timestamptz>p_at or
     (state->>'effectiveTo' is not null and (state->>'effectiveTo')::timestamptz<=p_at) then continue; end if;
   n:=n+1;
   -- An unconfirmed duplicate must not be ignored in favour of a confirmed row.
   if state->>'confirmedAt' is null or (state->>'confirmedAt')::timestamptz>p_at then return null; end if;
   found_owner:='member:'||(m->>'memberId');
 end loop;
 if n=1 then return found_owner; end if;
 return null;
end $$;
revoke all on function public.learn_handoff_owner(uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;

-- Source-owned elapsed item-minutes; no calendar or productivity claim.
-- Uses preserved capture history without modifying source records.
create function public.learn_work_residence_collect(p_tenant uuid,p_member uuid,p_policy uuid,p_revision int,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); descriptor jsonb; prior learn_work_measurement_runs%rowtype;
 roster jsonb; history jsonb; o intelligence_objects%rowtype; first_capture object_state_history%rowtype;
 policy jsonb; rule jsonb; ev jsonb; next_ev jsonb; owner text;
 interval_start timestamptz; interval_end timestamptz; segment_start timestamptz; segment_end timestamptz;
 boundaries timestamptz[]; points timestamptz[]; i int; j int; segment_count int:=0;
 observed timestamptz:=statement_timestamp(); source_through timestamptz:=statement_timestamp();
 eligible int:=0; covered int:=0; item_minutes numeric:=0; total_events int:=0; object_complete boolean;
 proof jsonb; items jsonb:='[]'; credited jsonb:='[]'; issues jsonb:='[]'; payload jsonb; ack jsonb;
 count_objects int; result_value numeric;
begin
 -- Lock the actor's real profile, so revocation cannot race a long calculation.
 if actor is null or p_tenant is distinct from current_tenant_id() then
   raise exception 'Owner/admin access required' using errcode='42501'; end if;
 perform 1 from profiles where id=actor and tenant_id=p_tenant and role in ('owner','admin') for share;
 if not found then raise exception 'Owner/admin access required' using errcode='42501'; end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'View-As cannot collect performance observations' using errcode='42501'; end if;
 if p_member is null or p_policy is null or p_request is null or p_revision is null or p_revision<1
   or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
   or p_start>=p_end or p_end>observed or p_end-p_start>interval '366 days'
   or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
   raise exception 'A member, policy, completed period and reason are required' using errcode='22023'; end if;
 descriptor:=jsonb_build_object('memberId',p_member,'policyId',p_policy,'policyVersion',p_revision,
   'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor,'algorithm','work-residence@1');
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into prior from learn_work_measurement_runs where id=p_request;
 if found then
   if prior.tenant_id<>p_tenant or prior.request is distinct from descriptor then
     raise exception 'Collection request identity changed' using errcode='40001'; end if;
   if not exists(select 1 from measurements where id=p_request and tenant_id=p_tenant) then
     raise exception 'Collection receipt is incomplete' using errcode='55000'; end if;
   return jsonb_build_object('measurementId',p_request,'reused',true);
 end if;
 perform 1 from team_members where id=p_member and tenant_id=p_tenant;
 if not found then raise exception 'Member not found in tenant' using errcode='22023'; end if;
 select e.value into policy from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
 where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant'
   and e.key like 'definition.%' and e.value->>'id'=p_policy::text and e.value->>'version'=p_revision::text
   and c.artifact_kind='learn_scorecard' and c.version=p_revision and c.status in ('draft','published');
 if policy is null or policy->>'subjectKind' is distinct from 'member' or policy->>'groupId' is not null then
   raise exception 'Choose a company-wide member policy for owned item minutes' using errcode='22023'; end if;
 select value into rule from jsonb_array_elements(policy->'metrics') where value->>'key'='work.owned_item_minutes';
 if rule is null or rule->>'unit' is distinct from 'item_minutes' or not coalesce((rule->'sourceSystems') ? 'serviceos.work.residence@1',false) then
   raise exception 'Policy does not define the owned item-minute measure' using errcode='22023'; end if;
 -- Serialize one observation per exact cell. Refreshes must use a separately
 -- reviewed correction workflow, not create two competing independent counts.
 perform pg_advisory_xact_lock(hashtextextended('learn-residence-cell:'||p_tenant::text||p_member::text||p_policy::text||p_revision::text||extract(epoch from p_start)::text||':'||extract(epoch from p_end)::text,0));
 if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind='member' and subject_id=p_member
   and policy_id=p_policy and policy_revision=p_revision and metric_key='work.owned_item_minutes'
   and window_start=p_start and window_end=p_end) then
   raise exception 'An observation already exists for this cell; review or correct it' using errcode='40001'; end if;
 roster:=learn_member_history_read(p_tenant,p_start,p_end);
 -- Ownership can change meaning without a work write: split at roster capture,
 -- effective-from/to and confirmation boundaries before resolving identity.
 select coalesce(array_agg(distinct boundary order by boundary),'{}'::timestamptz[]) into boundaries from (
   select (m->>'coverageStart')::timestamptz boundary from jsonb_array_elements(roster->'members') m
   union all select (e->>'observedAt')::timestamptz from jsonb_array_elements(roster->'members') m
     cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,effectiveFrom}')::timestamptz from jsonb_array_elements(roster->'members') m
     cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,effectiveTo}')::timestamptz from jsonb_array_elements(roster->'members') m
     cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,confirmedAt}')::timestamptz from jsonb_array_elements(roster->'members') m
     cross join lateral jsonb_array_elements(m->'events') e
 ) b where boundary>p_start and boundary<p_end;
 select count(*) into count_objects from intelligence_objects where tenant_id=p_tenant;
 if count_objects>2000 then raise exception 'Work population exceeds bounded collection; no partial score saved' using errcode='54000'; end if;
 for o in select * from intelligence_objects where tenant_id=p_tenant order by id loop
   select * into first_capture from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null
     order by capture_sequence limit 1;
   -- A proven database insertion after the period cannot contain period ownership.
   if first_capture.capture_kind='insert' and first_capture.occurred_at>=p_end then continue; end if;
   eligible:=eligible+1;
   history:=learn_work_history_read(p_tenant,o.id,p_start,p_end);
   total_events:=total_events+(history->>'count')::int;
   if total_events>5000 then raise exception 'Work events exceed bounded collection' using errcode='54000'; end if;
   object_complete:=history->>'coverageStart' is not null and (
     (history->>'coverageStart')::timestamptz<=p_start or first_capture.capture_kind='insert');
   if history->>'sourceThrough' is not null then source_through:=least(source_through,(history->>'sourceThrough')::timestamptz); end if;
   for i in 0..jsonb_array_length(history->'events')-1 loop
     ev:=history->'events'->i;
     next_ev:=history->'events'->(i+1);
     interval_start:=greatest(p_start,(ev->>'occurredAt')::timestamptz);
     interval_end:=least(p_end,coalesce((next_ev->>'occurredAt')::timestamptz,p_end));
     if interval_end<=interval_start then continue; end if;
     points:=array[interval_start]||array(select b from unnest(boundaries) b
       where b>interval_start and b<interval_end order by b)||array[interval_end];
     for j in 1..cardinality(points)-1 loop
       segment_count:=segment_count+1;
       if segment_count>10000 then raise exception 'Attribution segments exceed bounded collection' using errcode='54000'; end if;
       segment_start:=points[j]; segment_end:=points[j+1];
       if ev#>'{after,responsible_ref}' is null or ev#>'{after,responsible_ref}'='null'::jsonb then continue; end if;
       owner:=learn_handoff_owner(p_tenant,roster,ev#>'{after,responsible_ref}',segment_start);
       if owner is null then object_complete:=false; continue; end if;
       if owner<>'member:'||p_member::text then continue; end if;
       item_minutes:=item_minutes+extract(epoch from segment_end-segment_start)/60;
       credited:=credited||jsonb_build_array(jsonb_build_object('objectId',o.id,
         'start',segment_start,'end',segment_end,'itemMinutes',extract(epoch from segment_end-segment_start)/60,
         'owner',owner,'responsible',ev#>'{after,responsible_ref}','status',ev#>'{after,status}',
         'waitingOn',ev#>'{after,waiting_on_ref}',
         'workEventIds',case when next_ev is null then jsonb_build_array(ev->>'id') else jsonb_build_array(ev->>'id',next_ev->>'id') end));
     end loop;
   end loop;
   if object_complete then covered:=covered+1; else issues:=issues||jsonb_build_array(o.id); end if;
   items:=items||jsonb_build_array(jsonb_build_object('objectId',o.id,'complete',object_complete,
     'coverageStart',history->'coverageStart','sourceThrough',history->'sourceThrough',
     'eventIds',(select coalesce(jsonb_agg(v->'id'),'[]') from jsonb_array_elements(history->'events') v)));
 end loop;
 -- Even zero must be supported: unknown history never becomes zero residence.
 result_value:=case when covered=eligible then item_minutes else null end;
 proof:=jsonb_build_object('contract','work-residence@1','population','all retained intelligence objects',
   'value',result_value,'knownItemMinutes',item_minutes,'eligibleItems',eligible,'coveredItems',covered,
   'incompleteObjectIds',issues,'items',items,'credited',credited,'membership',roster);
 if octet_length(proof::text)>1048576 then raise exception 'Calculation evidence exceeds retention limit' using errcode='54000'; end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'View-As cannot collect performance observations' using errcode='42501'; end if;
 insert into learn_work_measurement_runs(id,tenant_id,member_id,actor_id,request,observed_at,explanation,proof,source_system,metric_key)
 values(p_request,p_tenant,p_member,actor,descriptor,observed,
   'Elapsed owned item-minutes across all recorded states, including waiting and closed states. Concurrent items add separately; this is not working hours, speed or productivity. No business calendar or delay exclusion applied. '
   ||covered||' of '||eligible||' retained work items have complete history/identity coverage. '
   ||case when result_value is null then 'Value withheld because coverage is incomplete.' else 'Confirmed review is still required.' end,proof,'serviceos.work.residence@1','work.owned_item_minutes');
 payload:=jsonb_build_object('id',p_request,'tenantId',p_tenant,'subject',jsonb_build_object('kind','member','id',p_member),
   'metricKey','work.owned_item_minutes','policyId',p_policy,'policyVersion',p_revision,
   'period',jsonb_build_object('start',p_start,'end',p_end),'value',result_value,'unit','item_minutes',
   'sampleCount',covered,'coveredCount',covered,'eligibleCount',eligible,'observedAt',observed,
   'sourceThrough',case when covered=eligible then source_through end,'sourceSystem','serviceos.work.residence@1',
   'review','inferred','evidence',jsonb_build_array(jsonb_build_object('table','learn_work_measurement_runs','id',p_request)),
   'exclusions','[]'::jsonb);
 ack:=learn_performance_append(p_tenant,payload,btrim(p_reason));
 return ack;
end $$;
revoke all on function public.learn_work_residence_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_residence_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) to authenticated;

-- SOURCE 20261030060000_learn_work_collection_release_guards.sql
-- Original SHA-256 513e1070acd01fc80b9e5e8ae1d3835eedb612427c94518008c6927f85e47313
-- Preserve the current validated append implementation when adding work receipts.
-- On a complete migration replay this evidence source is already present; the
-- selective TEST release adds it without overwriting newer membership guards.
do $patch$ declare d text; old_list text; new_list text; signature text; begin
 select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure) into d;
 old_list:=$old$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members')$old$;
 new_list:=$new$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs')$new$;
 if array_length(string_to_array(d,old_list),1)=2 then execute replace(d,old_list,new_list);
 elsif array_length(string_to_array(d,new_list),1)<>2 then raise exception 'Unexpected adapter evidence contract';end if;
 foreach signature in array array[
  'public.learn_work_handoffs_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text)',
  'public.learn_work_residence_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text)'
 ] loop
  select pg_get_functiondef(to_regprocedure(signature)) into d;
  if d is null or array_length(string_to_array(d,'errcode=''40001'''),1)<>3 then
   raise exception 'Unexpected collection conflict contract';end if;
  execute replace(d,'errcode=''40001''','errcode=''PT409''');
 end loop;
end $patch$;
-- The retained row trigger does not cover a whole-table TRUNCATE.
create trigger learn_work_history_no_truncate before truncate on public.object_state_history
 for each statement execute function public.learn_member_history_immutable();
alter table public.learn_work_measurement_runs add constraint learn_work_measurement_actor_fkey
 foreign key(actor_id) references public.profiles(id);
-- Put temporary schemas last explicitly in every released work function.
alter function public.learn_work_history_immutable() set search_path=public,pg_temp;
alter function public.learn_work_snapshot(public.intelligence_objects) set search_path=public,pg_temp;
alter function public.learn_capture_work_change() set search_path=public,pg_temp;
alter function public.learn_work_capture_baseline(uuid,uuid) set search_path=public,pg_temp;
alter function public.learn_work_history_read(uuid,uuid,timestamptz,timestamptz) set search_path=public,pg_temp;
alter function public.learn_handoff_owner(uuid,jsonb,jsonb,timestamptz) set search_path=public,pg_temp;
alter function public.learn_work_handoffs_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text) set search_path=public,pg_temp;
alter function public.learn_work_residence_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text) set search_path=public,pg_temp;
revoke all on function public.learn_work_history_immutable() from public,anon,authenticated,service_role;

create trigger learn_work_receipt_reference_guard before insert or update on public.learn_work_measurement_runs
 for each row execute function public.learn_foundation_reference_guard();

insert into of_learn_deploy.migrations values('learn_measurements_work_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
